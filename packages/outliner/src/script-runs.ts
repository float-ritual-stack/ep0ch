import { DRAFT_PROPOSAL_TYPE } from "./draft-patch";
import { AsyncLocalStorage } from "node:async_hooks";
import { firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { DEFAULT_MACHINERY, isMachinery } from "@ep0ch/outline-core/machinery";
import { rebaseSpans, type DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { createPatch } from "diff";
import { buttonCallAt, type ButtonCall } from "@ep0ch/outline-core/button-call";
import type { SourceEntry } from "@ep0ch/outline-core/sources";
import { scriptsAt } from "./script-sources";
import { actRequestOf, lineWords, slotPairs } from "@ep0ch/outline-core/action-line";
import type { AgentToolsClient } from "./agent-tools";
import type { ExtensionActRequest, ExtensionActResult } from "./extension-calls";
import type { LoadedExtension, ScriptSource } from "./extension-manifest";
import type { ExtensionRegistry } from "./extension-registry";
import type { ExtensionWrites } from "./extension-writes";
import { planPlace, type PlaceMode } from "./place";
import { hostApi, type HostApi, type HostStep } from "./host-api";
import { runScript, type ScriptSiteGlobals } from "./script-runtime";
import { PRIMITIVE_TYPES, renderComponent, validateComponent, type ComponentOutput, type Primitive } from "./component-primitives";
import { textRecord } from "./block-records";
import { blockDisplayTitle } from "./references";
import { visibleMatches } from "./site-producers";
import { bind, answerSite } from "./site-answer";
import { scriptFence } from "./script-sources";
import { MAX_DEADLINE_MS } from "./extension-manifest";
import type { Address, SiteAnswerRequest } from "@ep0ch/outline-core/site";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance, OutlinerChange } from "./types";

const ANSWER_MS = 3000;
/** Lets go of the connection's request queue (the server's `accept` sets it per request): a request that waits can call it. */
export const queueRelease = new AsyncLocalStorage<() => void>();
const RENDER_ERROR = "render scripts draw; use an action script (a button or of=) to change things";

/**
 * The view a script returned (`{ view }`, or one `view.table(…)` itself), checked against the catalogue; null for anything
 * else. A component carries the data its view shows (`data`); a script that draws a view and has no data says none.
 */
export function scriptView(value: unknown): ComponentOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if ("view" in value) return validateComponent({ data: null, ...value });
  if ((PRIMITIVE_TYPES as readonly unknown[]).includes((value as { type?: unknown }).type)) return validateComponent({ data: null, view: value });
  return null;
}

/** What a script returned, as the text a run note or a drawn line shows: a string as it is, a view as Blockdown, the rest as JSON. */
export function scriptText(value: unknown): string {
  if (typeof value === "string") return value;
  const view = scriptView(value);
  return view ? renderComponent(view, "blockdown").body : JSON.stringify(value);
}

/** `week=42 tag="a b"` as props: each word `name=value` (a repeat adds a value). Words that aren't one are left out. */
export function slotProps(words: string | null | undefined): Record<string, string[]> {
  const props: Record<string, string[]> = {};
  for (const { key, value } of slotPairs(words)) (props[key] ??= []).push(value);
  return props;
}

/** What a render-mode script drew, and what it read: the notes (with their revision when first read) and the queries (with their rows). */
export interface ScriptRendered { markdown: string; /** The view it drew, when it returned one (PIE-981: a client that draws views draws this, and presses what it carries). */ view?: Primitive; reads: { id: string; revision: number | null }[]; queries: { query: string; limit: number; ids: string[] }[]; /** It saw more than could be listed: its output depends on notes no list names. */ untracked?: true }

/** One script run's view of the Site: the globals it reads, the path reader behind `resolve`, and the notes it read. */
interface SiteBinding { globals: ScriptSiteGlobals; thisId?: string; resolve?: HostApi["resolve"] }

/** Runs outlive the action that starts them; progress is ordinary outline content beside the source. */
type ChangeWord = NonNullable<ExtensionActResult["changed"]>[number]["change"];
/** What a run's change says it did to a note (PIE-1436), and which word wins when it did several. */
const CHANGED: Partial<Record<OutlinerChange["kind"], ChangeWord>> = { create: "created", edit: "edited", draft: "edited", move: "moved", reorder: "moved", delete: "trashed", restore: "restored" };
const RANK: readonly ChangeWord[] = ["edited", "moved", "restored", "trashed", "created"];
/** Blocks a run writes that aren't notes it changed: its proposals and comments (PIE-1436). */
const NOT_NOTES: ReadonlySet<string> = new Set([DRAFT_PROPOSAL_TYPE, "annotation", "annotation-reply"]);

export class ScriptRuns {
  private readonly running = new Set<AbortController>();
  /** The runs that are going, by their undo id (a run note's `script-run::`): what `stop(run)` ends. */
  private readonly runs = new Map<string, { controller: AbortController; sequence: boolean }>();
  private readonly tasks = new Map<string, Promise<string | undefined>>();

  async finished(run: string): Promise<string | undefined> {
    try { return await this.tasks.get(run); } finally { this.tasks.delete(run); }
  }
  private readonly captures = new Map<string, { actor: MutationProvenance; run: <T>(work: () => T) => T }>();

  capture<T>(id: string, work: (actor: MutationProvenance) => T): T {
    const capture = this.captures.get(id);
    if (!capture) throw new Error("This script run has ended");
    return capture.run(() => work(capture.actor));
  }

  private readonly previous = new Map<string, string>();

  constructor(private readonly store: OutlinerStore, private readonly registry: ExtensionRegistry,
    private readonly writes: ExtensionWrites, private readonly client: AgentToolsClient,
    private readonly publish: (changes: readonly OutlinerChange[]) => void,
    private readonly inverse: (run: string) => Promise<import("./draft-patch").DraftPatchEdit[]>,
    private readonly act: (clientId: string | undefined, name: string, args: Record<string, unknown>, actor: MutationProvenance, signal: AbortSignal, meta: { requestedBy: MutationProvenance; invitation?: string }) => Promise<unknown>,
    /** A run ended (PIE-957): done, stopped or failed. The door holding its layout transaction closes it by that. */
    private readonly ended?: (e: import("@ep0ch/outline-core/protocol").ScriptEnded) => void,
    /** How long `answered` waits for a run to end before it says the run is still going. */
    private readonly answerMs = ANSWER_MS) {}

  /**
   * A run's answer for the one who asked (PIE-1264): `start` returns at once, but a caller of `act` or `script_run` has
   * no `scripts.ended` to hear, so it waits here, a few seconds, for what the run says last (its returned line, the
   * refusal it threw, "done"). A run still going after that answers `running` and how to stop it; its end is still
   * broadcast. A background run (an agent's answer) or a rule's trigger never waits: nobody asked for words. Nor does a
   * person's press: the door they pressed in hears the end (`scripts.ended`) and says it.
   */
  async answered(started: ExtensionActResult, request: ExtensionActRequest): Promise<ExtensionActResult> {
    const task = started.undo ? this.tasks.get(started.undo) : undefined;
    if (!task || request.background || request.trigger || request.requestedBy?.author === "user" || this.answerMs <= 0) return started;
    queueRelease.getStore()?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([task, new Promise<void>(resolve => { timer = setTimeout(resolve, this.answerMs); })]);
    clearTimeout(timer);
    if (started.state !== "running") return { ...started };
    return { ...started, message: `${started.message?.replace(/ working$/, "")} is still running after ${Math.round(this.answerMs / 100) / 10}s · its end is told when it comes; script.stop run=${started.undo} ends it` };
  }

  /**
   * The Site a run reads (`this`, `self`, `caller`, `props`) and answers `resolve` from: `this` is the note the run is
   * about (a rule's matched block, the note a key was pressed in), `self` the script's own note. Read through the
   * service's one resolver (`answerSite`), so a path means what it means in `{{ }}`.
   */
  private bind(source: ScriptSource, input: { blockId?: string; line?: number; trigger?: boolean; props: Record<string, string[]> }, onRead?: (ids: readonly string[]) => void, visibleId?: (id: string) => string | null): SiteBinding {
    // The note's own text as a record (properties, fields, header, tasks); `read()` is the full record, links and backlinks too.
    const record = (id: string | undefined) => {
      const block = id ? this.store.get(id) : null;
      if (!block || block.effectiveDeletedRootId) return undefined;
      onRead?.([block.id]);
      const value = textRecord(block);
      if (value.parent) {
        if (visibleId) value.parent = visibleId(value.parent);
        else onRead?.([value.parent]);
      }
      return value;
    };
    const here = record(input.blockId);
    const own = record(source.blockId);
    const caller: Address | undefined = here && (input.line !== undefined || input.trigger) ? { block: here.id, ...(input.line !== undefined ? { line: input.line } : {}) } : undefined;
    const globals: ScriptSiteGlobals = { ...(here ? { this: here } : {}), ...(own ? { self: own } : {}), ...(caller ? { caller } : {}), props: input.props };
    if (!here) return { globals };
    return {
      globals, thisId: here.id,
      resolve: async path => {
        const answer = answerSite(this.store, { blockId: here.id, paths: [path], ...(input.line !== undefined ? { line: input.line } : {}), ...(own ? { self: own.id } : {}), ...(caller ? { caller } : {}), props: input.props });
        onRead?.([...answer.deps, ...(answer.paths![0]!.links ?? []).map(link => link.id)]);
        const read = answer.paths![0]!;
        return { path: read.path, ...(read.values ? { values: read.values } : {}), ...(read.problem ? { problem: read.problem } : {}), ...(read.links ? { links: read.links } : {}), ...(read.lines ? { lines: read.lines } : {}), route: read.route };
      },
    };
  }

  /**
   * Draws a render-mode script (`[mode::render]`, or a `::=` line) for the line that asks: its result as text, with the
   * notes it read and their revisions then (what it must be drawn again for). No run note, no undo step, and nothing
   * written: the API is read-only, and a refused write says so. Called by ExtensionCalls' one producer path.
   */
  async render(source: ScriptSource, input: { blockId: string; line: number; argument: string | null; signal?: AbortSignal; deadlineMs: number; hidden?: string[]; site?: Pick<SiteAnswerRequest, "chain" | "props">; onCandidates?: (ids: string[]) => void }): Promise<ScriptRendered> {
    const reads = new Map<string, number | null>();
    const queries: ScriptRendered["queries"] = [];
    let untracked = false;
    let hiddenQueryRoot = false;
    const onRead = (ids: readonly string[]) => { for (const id of ids) if (!reads.has(id)) reads.set(id, this.store.get(id)?.revision ?? null); };
    const props = slotProps(input.argument);
    // The script's note supplies self as well as code, so it follows the same visibility cut as an embed.
    if (source.blockId) {
      input.onCandidates?.([source.blockId]);
      if (input.hidden?.includes(source.blockId)) return { markdown: "not shared", reads: [], queries };
      onRead([source.blockId]);
    }
    const visibleId = input.hidden === undefined ? undefined : (id: string) => {
      input.onCandidates?.([id]);
      if (input.hidden!.includes(id)) return null;
      onRead([id]);
      return id;
    };
    const bound = input.hidden === undefined ? undefined : bind(this.store, { ...input.site, blockId: input.blockId, hidden: input.hidden }, Date.now);
    const site = this.bind(source, { blockId: bound?.site.this?.id ?? input.blockId, line: input.line, props: { ...bound?.site.props, ...props } }, onRead, visibleId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`The script ran past its deadline (${Math.round(input.deadlineMs / 1000)}s)`)), input.deadlineMs);
    const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    try {
      const select = <B extends { id: string }>(blocks: B[], where?: string) => {
        const visible = visibleMatches(this.store, bound!.world, blocks, where);
        input.onCandidates?.([...bound!.world.deps]);
        if (bound!.world.hiddenHits) untracked = true;
        return visible;
      };
      const client: AgentToolsClient = bound ? {
        requireCompatibleService: () => this.client.requireCompatibleService(),
        request: async <T>(request: Parameters<AgentToolsClient["request"]>[0]): Promise<T> => {
          const root = request.action === "blocks.query" ? request.query.subtreeRootId : request.action === "views.read" ? request.viewId : undefined;
          if (root && visibleId!(root) === null) {
            hiddenQueryRoot = true;
            throw new Error("not shared");
          }
          if (request.action === "children") return select(this.store.children(request.parentId)) as T;
          if (request.action === "blocks.read") {
            const read = this.store.readBlocks(request.ids, request.fields);
            for (const block of read.blocks) if (block.hasChildren !== undefined) {
              block.hasChildren = select(this.store.children(block.id)).length > 0;
            }
            return read as T;
          }
          if (request.action === "activity.recent") return this.store.recentEditActivity(request, ids =>
            select(ids.map(id => ({ id }))).map(block => block.id)) as T;
          if (request.action === "blocks.query") return this.store.queryBlocks({ ...request.query, machinery: request.query.machinery ?? DEFAULT_MACHINERY }, undefined, select) as T;
          if (request.action === "views.read") return this.store.readSavedView(request.viewId, request, "full", select) as T;
          return this.client.request<T>(request);
        },
      } : this.client;
      const api = hostApi(client, undefined, {
        kind: "render", cutQueries: !!bound, visibleId, onRead, onUntracked: () => { untracked = true; }, onQuery: query => { queries.push({ ...query, ids: [...query.ids] }); onRead(query.ids); }, ...(site.thisId ? { thisId: site.thisId } : {}), ...(site.resolve ? { resolve: site.resolve } : {}),
      });
      const result = await runScript(source.code, api, signal, undefined, site.globals);
      if (hiddenQueryRoot) return { markdown: "not shared", reads: [...reads].map(([id, revision]) => ({ id, revision })), queries };
      if (!result.ok) throw new Error(`${result.error.message}\n${RENDER_ERROR}`);
      const drew = result.value === undefined ? null : scriptView(result.value);
      return { markdown: result.value === undefined ? "" : scriptText(result.value), ...(drew ? { view: drew.view } : {}), reads: [...reads].map(([id, revision]) => ({ id, revision })), queries, ...(untracked ? { untracked: true as const } : {}) };
    } finally { clearTimeout(timer); }
  }

  /** Ends one run (`script.stop`): its remaining calls are refused, and its note says it was stopped and by whom. */
  stopRun(run: string, by: MutationProvenance): { stopped: boolean; sequence?: true } {
    const active = this.runs.get(run);
    if (!active) return { stopped: false };
    active.controller.abort(new Error(`Stopped by ${by.actorId ?? by.author}`));
    return { stopped: true, ...(active.sequence ? { sequence: true } : {}) };
  }

  private readonly sequences = new Map<string, { text: string; source: SourceEntry }>();

  sequenceSource(blockId: string, button: ButtonCall, text: string): SourceEntry {
    const run = this.sequences.get(`${blockId}:${button.line}`);
    if (run?.text === text) return run.source;
    return {
      key: String(button.line), kind: "button", name: button.label, line: button.line, endLine: button.endLine, live: false,
      query: { params: button.slots, text, editable: button.slots.length > 0 },
      transform: { kind: "script", label: button.sequence ? "Sequence: scripts pipe their return; actions tap the value" : "Button: its action, with its slots filled from the line", text: button.steps.map(s => s.kind === "script" ? `((${s.source}))` : s.source).join("\n") },
      result: { rows: 0, columns: ["Step", "Source", "Input", "Output", "Answer", "Effects that remain"], table: [], text: "Not pressed yet" },
      ...(button.problem ? { problem: button.problem } : {}),
    };
  }

  startSequence(request: ExtensionActRequest): ExtensionActResult {
    const note = this.store.require(request.blockId!);
    const button = buttonCallAt(note.text.split("\n"), request.line!);
    if (!button || button.problem) throw new Error(button?.problem ?? "No button on that line; read the note and press its current button");
    if (button.empty.length) throw new Error(`${button.label} has no ${button.empty.join(" or ")} yet: write ${button.empty[0]}= on its line (the door asks for it on a press, button.slot fills it)`);
    return this.start({ id: `button:${note.id}:${button.line}`, name: button.label, script: {
      code: "", effects: "write", keys: [], blockId: note.id, revision: note.revision,
      author: { author: note.author, actorId: note.actorId },
    } }, request, button);
  }

  start(extension: Pick<LoadedExtension, "id" | "name" | "script">, request: ExtensionActRequest, sequence?: ButtonCall): ExtensionActResult {
    let source = extension.script!;
    // Effects in a file's opt-in header describe it; only its body is executing code.
    const body = (code: string) => source.file ? code.split("\n").slice(1).join("\n") : code;
    const undo = this.writes.beginRun(`script:${extension.name}`);
    const actor: MutationProvenance = { author: "agent", actorId: `script:${extension.name}`, sessionId: undo, taskId: `trigger:script:${extension.id}` };
    const requestedBy = request.requestedBy ?? { author: "user" as const };
    // A press (PIE-957): the note that holds the button, and who wrote it last, so the run records both who asked and whose button it was.
    const buttonBlock = request.button ? this.store.get(request.button.block) : undefined;
    const button = request.button && buttonBlock ? { block: buttonBlock.id, author: buttonBlock.actorId ?? buttonBlock.author } : null;
    const controller = new AbortController();
    this.running.add(controller);
    this.runs.set(undo, { controller, sequence: sequence !== undefined });
    const deadlineMs = source.deadlineMs ?? MAX_DEADLINE_MS;
    const deadline = setTimeout(() => controller.abort(new Error(`The script ran past its deadline (${Math.round(deadlineMs / 1000)}s)`)), deadlineMs);
    const old = this.previous.get(extension.id);
    this.previous.set(extension.id, source.code);
    const lines = [
      `${extension.name} · working [script-run::${undo}] [machine::script]`,
      `Author: ${actor.actorId ?? actor.author} · revision ${source.revision} · onBehalfOf: ${requestedBy.actorId ?? requestedBy.author}${button ? ` · button by ${button.author} in ((${button.block}))` : ""}`,
      ...(old !== undefined && old !== source.code ? ["", "```diff", createPatch(extension.name, old, source.code), "```"] : []),
    ];
    const changed = new Map<string, ChangeWord>();
    const captured = <T>(work: () => T): T => {
      const before = new Map<string, Block>();
      const attribution = this.store.changes.attribution({ action: `script:${extension.name}`, actor, requestedBy, collect: true });
      const finish = () => {
        const changes = this.store.changes.committed(attribution);
        for (const c of changes) {
          // Only the run's own writes, and an extension's it asked for (`act`): a write another writer made meanwhile under
          // the same capture (Jev's review records and its suggestions page, made the first time a create is reviewed) is
          // not the run's (PIE-1436).
          if (c.actor?.actorId && c.actor.actorId !== actor.actorId && c.requestedBy?.actorId !== actor.actorId) continue;
          const how = CHANGED[c.kind];
          if (c.blockId && how && (RANK.indexOf(how) > RANK.indexOf(changed.get(c.blockId) ?? "edited") || !changed.has(c.blockId))) changed.set(c.blockId, how);
        }
        this.writes.recordRun(undo, before, changes);
        this.publish(changes);
      };
      try {
        const value = this.store.withBeforeImages(before, () => this.store.changes.run(attribution, work));
        if (value instanceof Promise) return value.finally(finish) as T;
        finish();
        return value;
      } catch (error) { finish(); throw error; }
    };
    this.captures.set(undo, { actor, run: captured });
    let log: Block | undefined;
    const written: string[] = [];
    const keep = () => {
      if (log) return;
      log = captured(() => this.store.create(lines.join("\n"), source.blockId ?? null, actor.author,
        actor.author === "agent" ? { actorId: actor.actorId ?? "agent", sessionId: undo, taskId: actor.taskId } : undefined));
      written.push(log.id);
    };
    if (source.blockId && this.store.get(source.blockId)?.properties.some(p => p.key === "results" && p.value === "keep")) keep();
    const title = source.blockId ? firstLineWithoutPropertyTokens(this.store.get(source.blockId)?.text ?? "")?.trim() : undefined;
    let message = `${title || extension.name} done`;
    // Its words are the run's to change as it goes: the answer (`answered`) is what stands when it ends.
    const result: { -readonly [K in keyof ExtensionActResult]: ExtensionActResult[K] } = { extension: extension.id, action: "run", message: `${extension.name} working`, state: "running", written, undo, undoOn: request.blockId ?? source.blockId, writtenAs: actor.actorId ?? actor.author };
    let returned: string | undefined;
    const update = () => captured(() => {
      if (!log) return;
      const now = this.store.require(log.id);
      this.store.update(log.id, lines.join("\n"), now.revision, actor);
    });
    let progress: ReturnType<typeof setTimeout> | undefined;
    const trace = sequence ? { ...this.sequenceSource(request.blockId!, sequence,
      this.store.require(request.blockId!).text.split("\n").slice(sequence.line, sequence.endLine + 1).join("\n")) } : undefined;
    if (trace) {
      delete trace.readAt;
      delete trace.problem;
      trace.result = { ...trace.result, rows: 0, table: [], text: "Running" };
      this.sequences.set(`${request.blockId}:${sequence!.line}`, { text: trace.query.text, source: trace });
    }
    let effects: string[] = [], actionAnswer: unknown, sequenceAct = sequence !== undefined;
    // What the presser hears when a step stops the sequence, in their words (PIE-1418); Sources keeps each step's spelling.
    let stoppedSaid: string | undefined;
    // Writes that became proposals as comments (a create, a move or a trash at propose access): the thread and its note.
    const commented: { id: string; note: string }[] = [];
    const step = (s: HostStep) => {
      if (trace && s.phase === "done" && s.writes) effects.push(`${s.tool}: ${JSON.stringify(s.result)}`);
      const proposal = s.phase === "done" ? s.result as { outcome?: string; uri?: string; detail?: { thread?: string } } | undefined : undefined;
      const on = proposal?.outcome === "proposed" && proposal.detail?.thread ? /^\(\(([^)|]+)/.exec(proposal.uri ?? "")?.[1] : undefined;
      if (on) commented.push({ id: proposal!.detail!.thread!, note: on });
      if (s.phase === "start") return;
      lines.push(`\n${s.seq}. ${s.tool}: ${s.phase === "done" ? JSON.stringify(s.result) : s.error}`);
      // A tight host-call loop must not flood readers and delay the person's save behind progress events.
      if (log) progress ??= setTimeout(() => {
        progress = undefined;
        try { update(); } catch (error) { controller.abort(error); }
      }, 50);
    };
    const client: AgentToolsClient = {
      requireCompatibleService: () => this.client.requireCompatibleService(),
      request: async input => {
        if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error("The script run ended");
        // The script is its code: a run that writes into its own note (its output, a log) goes on; an edit of the code ends it.
        const changed = sequence && sequenceAct ? false : source.blockId
          ? scriptFence(this.store.get(source.blockId)?.text ?? "", source.fence).code !== source.code
          : body(await Bun.file(source.file!).text()) !== body(source.code);
        if (changed) {
          controller.abort();
          throw new Error("The script source changed; run its saved revision again");
        }
        return captured(() => this.client.request(input));
      },
    };
    const buttonProps = buttonBlock && request.button?.line !== undefined
      ? buttonCallAt(buttonBlock.text.split("\n"), request.button.line)?.props : undefined;
    // args carry each slot's last value; a key the button repeats (`page=a page=b`) reads whole from the button, but only
    // where the press passed that button's own value: an alt press or an override passes its own, and keeps it.
    const slot = (k: string, v: unknown) => { const all = buttonProps && Object.hasOwn(buttonProps, k) ? buttonProps[k] : undefined; return all && all.at(-1) === String(v) ? all : [String(v)]; };
    let site = this.bind(source, { blockId: request.blockId, line: request.line, trigger: !!request.trigger,
      props: Object.fromEntries(Object.entries(request.args ?? {}).map(([k, v]) => [k, slot(k, v)])) });
    let caller: { text: string; span: DraftPatchSpan } | undefined;
    // place(): the plan is made on the note as its draft has it now, sent as this script, applied or one proposal at the caller.
    const place = async (content: string, opts: { at?: string; mode?: string; label?: string; interpolate?: boolean }) => {
      if (!site.thisId) throw new Error("place writes into this run's note: run this script from a note (this run has none)");
      const draft = await client.request<{ text: string; revision: number; holder?: string }>({ action: "drafts.read", blockId: site.thisId });
      const located = caller ? rebaseSpans(caller.text, draft.text, [caller.span]) : undefined;
      if (located && !located.ok && !opts.at) throw new Error(`place's caller changed: ${located.reason}; run it again from the note, or give at: ^anchor`);
      const line = located?.ok ? draft.text.slice(0, located.spans[0]!.start).split("\n").length - 1 : undefined;
      const producer = { id: source.blockId ?? extension.id.replace(/[^A-Za-z0-9_-]/g, "-").padEnd(8, "-"), name: extension.name };
      const plan = planPlace(draft.text, {
        producer, content, ...(opts.at !== undefined ? { at: opts.at } : {}), ...(opts.mode !== undefined ? { mode: opts.mode as PlaceMode } : {}),
        ...(opts.label !== undefined ? { label: opts.label } : {}), ...(line !== undefined ? { here: line } : {}), ...(opts.interpolate ? { interpolate: true } : {}),
      });
      if (!plan.ok && plan.kind === "refused") throw new Error(plan.reason);
      const result = await client.request<{ outcome: string; reason?: string; proposalId?: string }>({
        action: "draft.patch", blockId: site.thisId, revision: draft.revision, patches: plan.spans, mutation: actor, current: true,
        ...(plan.mark ? { mark: { text: plan.mark } } : {}), ...(plan.ok && (!request.mcpAccess || request.mcpAccess === "full") ? {} : { propose: true as const }),
      });
      const said = plan.ok ? plan.summary : plan.reason;
      lines.push(`\nplace: ${result.outcome === "applied" ? said : `proposed instead: ${result.reason ?? said}`}`);
      return { outcome: result.outcome, ...(plan.anchor ? { anchor: plan.anchor } : {}), ...(plan.ok ? { created: plan.created } : {}), message: result.outcome === "applied" ? said : (plan.ok ? (result.reason ?? said) : plan.reason), ...(result.proposalId ? { proposalId: result.proposalId } : {}) };
    };
    const api = hostApi(client, { ...actor, actorId: actor.actorId ?? actor.author }, {
      onStep: step,
      ...(site.thisId ? { thisId: site.thisId } : {}),
      ...(site.resolve ? { resolve: (path: string) => site.resolve!(path) } : {}),
      place: (content, opts) => place(content, opts),
      mcpAccess: request.mcpAccess,
      // The door it asks is the one that started the run (or `door=`); with none, the service picks the only door or says which there are.
      act: async (name: string, args: Record<string, unknown>) => {
        const answer = await this.act(request.clientId, name, args, actor, controller.signal, { requestedBy, ...(request.invitation ? { invitation: request.invitation } : {}) });
        if (trace) { actionAnswer = answer; effects.push(`${name}: ${JSON.stringify(answer)}`); }
        return answer;
      },
    });
    const task = (async () => {
      let failure: string | undefined;
      try {
        if (site.thisId && request.line !== undefined) {
          // Read before executing: the run itself can insert text above the line that asked it.
          const draft = await client.request<{ text: string }>({ action: "drafts.read", blockId: site.thisId });
          const lines = draft.text.split("\n"), observed = lines[request.line];
          if (observed !== undefined) {
            const start = lines.slice(0, request.line).reduce((n, line) => n + line.length + 1, 0);
            caller = { text: draft.text, span: { observed, replacement: observed, range: { start, end: start + observed.length } } };
          }
        }
        const execute = (args = request.args ?? {}) => runScript(source.code, source.render ? hostApi(client, undefined, {
          kind: "render", ...(site.thisId ? { thisId: site.thisId } : {}), ...(site.resolve ? { resolve: site.resolve } : {}),
        }) : api, controller.signal, source.format === "actions" ? args : undefined, site.globals);
        const result = sequence ? await (async () => {
          let value: unknown;
          const show = (v: unknown) => v === undefined ? "undefined" : JSON.stringify(v);
          const output: { type: "text"; text: string }[] = [];
          for (const [index, item] of sequence.steps.entries()) {
            const before = value;
            effects = []; actionAnswer = undefined;
            const spelling = item.kind === "script" ? `((${item.source}))` : item.source;
            try {
              if (controller.signal.aborted) throw controller.signal.reason;
              sequenceAct = item.kind === "act";
              const args: Record<string, string> = {};
              if (item.kind === "script") {
                const entries = scriptsAt(this.store, this.registry.list().extensions, { blockId: request.blockId, line: request.line });
                const call = actRequestOf(lineWords(item.source));
                Object.assign(args, call.args);
                if (call.tile !== undefined) args.tile = call.tile;
                if (call.as !== undefined) args.as = call.as;
                const ref = call.action;
                const entry = entries.find(e => e.script && (e.name === ref || e.script.blockId === ref || e.id === ref));
                if (!entry) throw new Error(`No script ${ref} here; ext ls lists the scripts`);
                if (entry.state === "failed") throw new Error(entry.error);
                source = this.registry.extension(entry.id)!.script!;
              } else source = { ...extension.script!, code: item.source, format: "actions" };
              const props = { ...Object.fromEntries(Object.entries(args).map(([k, v]) => [k, [v]])), ...(item.kind === "script" ? sequence.props : {}) };
              site = this.bind(source, { blockId: request.blockId, line: request.line, props });
              site.globals.input = value;
              const answer = await execute(args);
              output.push(...answer.output.filter((o): o is { type: "text"; text: string } => o.type === "text"));
              if (!answer.ok) throw new Error(`${answer.error.message}${source.render ? `\n${RENDER_ERROR}` : ""}`);
              if (item.kind === "script") value = answer.value;
              trace!.result.table!.push([String(index + 1), spelling, show(before), show(value), item.kind === "act" ? show(actionAnswer) : value === undefined ? "returned nothing" : show(value), effects.join("\n")]);
              trace!.result.rows++;
            } catch (error) {
              // An action step runs as a one-line actions script, whose errors lead with `Line 1: ` or `Line 1 (<action>): `
              // (outline-core's actionScript): the step says where already.
              const raw = error instanceof Error ? error.message : String(error);
              const said = item.kind === "act" ? raw.replace(/^Line 1(?: \([^)]*\))?: /, "") : raw;
              const why = `Step ${index + 1} (${spelling}): ${said}`;
              stoppedSaid = `${sequence.label} stopped at step ${index + 1} of ${sequence.steps.length}: ${said}${index ? ` (${index === 1 ? "the step" : `the ${index} steps`} before it ran)` : ""}`;
              trace!.problem = why;
              trace!.result.table!.push([String(index + 1), spelling, show(before), "failed", why, effects.join("\n")]);
              trace!.result.rows++;
              throw new Error(`${why}. Finished: ${index ? trace!.result.table!.slice(0, -1).map(r => r[0] + " (" + r[1] + ")").join(", ") : "none"}. Effects that remain: ${trace!.result.table!.flatMap(r => r[5] ? [r[5]] : []).join("; ") || "none"}. Undo takes back what is reversible.`);
            } finally {
              trace!.readAt = new Date().toISOString();
              trace!.result.text = trace!.result.table!.map(r => r.join(" | ")).join("\n");
            }
          }
          trace!.result.text += `\nFinished: ${sequence.steps.length} steps. Effects that remain are listed per step; undo takes back what is reversible.`;
          return { ok: true as const, value, output };
        })() : await execute();
        const current = this.registry.extension(extension.id);
        if (!sequence && result.ok && (!current?.script || body(current.script.code) !== body(source.code))) throw new Error("The script source changed during this run; its remaining output was discarded. Run the saved revision again.");
        lines[0] = `${extension.name} · ${result.ok ? "done" : "failed"} [script-run::${undo}] [machine::script]`;
        for (const output of result.output) if (output.type === "text") lines.push(output.text);
        if (result.ok) {
          if (result.value !== undefined) {
            const text = scriptText(result.value);
            returned = text;
            lines.push(text);
            if (!text.includes("\n") && (result.value === null || typeof result.value !== "object")) message = text || message;
            else keep();
          }
        }
        else { failure = result.error.message; lines.push(failure); }
        if (result.output.some(output => output.type === "text")) keep();
      } catch (error) {
        lines[0] = `${extension.name} · failed [script-run::${undo}] [machine::script]`;
        failure = error instanceof Error ? error.message : String(error);
        lines.push(failure);
      } finally {
        if (progress) clearTimeout(progress);
        clearTimeout(deadline);
        // How it ended, before the abort below says it for every run: stopped by someone, failed, or done.
        const why = controller.signal.aborted ? controller.signal.reason : undefined;
        const stoppedBy = why instanceof Error && /^Stopped by/.test(why.message);
        const reason = stoppedBy ? "stopped" as const : failure !== undefined || (why instanceof Error && /^The script ran past/.test(why.message)) ? "failed" as const : "done" as const;
        controller.abort();
        let undoAvailable = true;
        try {
          const drafts = await this.inverse(undo);
          this.writes.finishRun(undo, drafts);
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error);
          undoAvailable = false;
          lines.push(`Undo unavailable: ${problem}`);
          this.writes.finishRun(undo, [], problem);
        }
        try { update(); } finally {
          this.captures.delete(undo);
          this.running.delete(controller);
          this.runs.delete(undo);
          result.message = failure !== undefined ? stoppedSaid ?? `${failure || "Script failed"} · check the script and run it again`
            : reason === "done" ? message : "Script stopped; run it again when ready";
          result.state = reason;
          // Notes only: never its own log, a proposal or comment it wrote (at propose access a write is one), a tool's
          // bookkeeping ([machine::…], a figure-fit record a create leaves), nor a note it made and trashed again in the same run.
          const notes = [...changed].flatMap(([id, change]) => {
            const b = this.store.get(id), type = b?.properties.find(p => p.key === "type")?.value;
            if (!b || id === log?.id || NOT_NOTES.has(type ?? "") || isMachinery(b.properties) || (change === "created" && b.effectiveDeletedRootId)) return [];
            return [{ id, title: blockDisplayTitle(b) || id.slice(0, 8), change }];
          });
          if (notes.length) result.changed = notes;
          // The writes that became proposals (propose access, or a note open in a draft): an edit's proposal beside its
          // note, and a create's, a move's or a trash's comment on it (its thread), each with the note it is for.
          const beside = [...changed].flatMap(([id, change]) => {
            const b = this.store.get(id);
            if (change !== "created" || !b || b.effectiveDeletedRootId || b.properties.find(p => p.key === "type")?.value !== DRAFT_PROPOSAL_TYPE) return [];
            return [{ id, note: b.parentId ?? "" }];
          });
          const proposed = [...beside, ...commented.filter(c => !beside.some(b => b.id === c.id))].map(({ id, note }) => {
            const on = note ? this.store.get(note) : undefined;
            return { id, note, title: on ? blockDisplayTitle(on) : "" };
          });
          if (proposed.length) result.proposed = proposed;
          if (returned !== undefined && returned !== result.message) result.answer = returned;
          if (trace && failure) { trace.problem = failure; trace.result.text += `\n${failure}`; }
          this.ended?.({ run: undo, reason, ...(sequence ? { sequence: true } : {}), message: result.message, written, requestedBy, undo: (sequence !== undefined || reason === "done") && undoAvailable,
            ...(request.clientId && !request.background ? { targetClientId: request.clientId } : {}) });
        }
      }
      return failure;
    })();
    this.tasks.set(undo, task);
    // Inline asks consume their completion after ExtensionCalls has returned, even for a fast parse failure.
    if (!request.background) void task.finally(() => { this.tasks.delete(undo); }).catch(() => {});
    return result;
  }

  async stop(): Promise<void> {
    for (const run of this.running) run.abort();
    await Promise.allSettled(this.tasks.values());
  }
}
