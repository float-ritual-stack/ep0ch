import { createPatch } from "diff";
import type { AgentToolsClient } from "./agent-tools";
import type { ExtensionActRequest, ExtensionActResult } from "./extension-calls";
import type { LoadedExtension, ScriptSource } from "./extension-manifest";
import type { ExtensionRegistry } from "./extension-registry";
import type { ExtensionWrites } from "./extension-writes";
import { hostApi, type HostApi, type HostStep } from "./host-api";
import { runScript, type ScriptSiteGlobals } from "./script-runtime";
import { PRIMITIVE_TYPES, renderComponent, validateComponent } from "./component-primitives";
import { readBlockRecords } from "./block-records";
import { answerSite } from "./site-answer";
import { scriptFence } from "./script-sources";
import { MAX_DEADLINE_MS } from "./extension-manifest";
import type { Address } from "@ep0ch/outline-core/site";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance, OutlinerChange } from "./types";

/** What a script returned, as the text a run note or a drawn line shows: a string as it is, a view (`{ view }`, or one `view.table(…)` itself) as Blockdown, the rest as JSON. */
export function scriptText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // A component carries the data its view shows (`data`); a script that draws a view and has no data says none.
    if ("view" in value) return renderComponent(validateComponent({ data: null, ...value }), "blockdown").body;
    if ((PRIMITIVE_TYPES as readonly unknown[]).includes((value as { type?: unknown }).type)) return renderComponent(validateComponent({ data: null, view: value }), "blockdown").body;
  }
  return JSON.stringify(value);
}

/** `week=42 tag="a b"` as props: each word `name=value` (a repeat adds a value). Words that aren't one are left out. */
export function slotProps(words: string | null | undefined): Record<string, string[]> {
  const props: Record<string, string[]> = {};
  for (const m of (words ?? "").matchAll(/([A-Za-z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/g)) (props[m[1]!] ??= []).push(m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]!);
  return props;
}

/** What a render-mode script drew, and what it read: the notes (with their revision when first read) and the queries (with their rows). */
export interface ScriptRendered { markdown: string; reads: { id: string; revision: number | null }[]; queries: { query: string; limit: number; ids: string[] }[] }

/** One script run's view of the Site: the globals it reads, the path reader behind `resolve`, and the notes it read. */
interface SiteBinding { globals: ScriptSiteGlobals; thisId?: string; resolve?: HostApi["resolve"] }

/** Runs outlive the action that starts them; progress is ordinary outline content beside the source. */
export class ScriptRuns {
  private readonly running = new Set<AbortController>();
  /** The runs that are going, by their undo id (a run note's `script-run::`): what `stop(run)` ends. */
  private readonly runs = new Map<string, AbortController>();
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
    private readonly act: (clientId: string, name: string, args: Record<string, unknown>, actor: MutationProvenance, signal: AbortSignal) => Promise<unknown>) {}

  /**
   * The Site a run reads (`this`, `self`, `caller`, `props`) and answers `resolve` from: `this` is the note the run is
   * about (a rule's matched block, the note a key was pressed in), `self` the script's own note. Read through the
   * service's one resolver (`answerSite`), so a path means what it means in `{{ }}`.
   */
  private bind(source: ScriptSource, input: { blockId?: string; line?: number; trigger?: boolean; props: Record<string, string[]> }, onRead?: (ids: readonly string[]) => void): SiteBinding {
    const record = (id: string | undefined) => {
      const block = id ? this.store.get(id) : null;
      return block && !block.effectiveDeletedRootId ? readBlockRecords(this.store, [block.id]).records[0] : undefined;
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
        onRead?.(answer.deps);
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
  async render(source: ScriptSource, input: { blockId: string; line: number; argument: string | null; signal?: AbortSignal; deadlineMs: number }): Promise<ScriptRendered> {
    const reads = new Map<string, number | null>();
    const queries: ScriptRendered["queries"] = [];
    const onRead = (ids: readonly string[]) => { for (const id of ids) if (!reads.has(id)) reads.set(id, this.store.get(id)?.revision ?? null); };
    const props = slotProps(input.argument);
    const site = this.bind(source, { blockId: input.blockId, line: input.line, props }, onRead);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`The script ran past its deadline (${Math.round(input.deadlineMs / 1000)}s)`)), input.deadlineMs);
    const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    try {
      const api = hostApi(this.client, undefined, {
        effects: "read", onRead, onQuery: query => { queries.push({ ...query, ids: [...query.ids] }); onRead(query.ids); }, ...(site.thisId ? { thisId: site.thisId } : {}), ...(site.resolve ? { resolve: site.resolve } : {}),
      });
      const result = await runScript(source.code, api, signal, undefined, site.globals);
      if (!result.ok) throw new Error(result.error.message);
      return { markdown: result.value === undefined ? "" : scriptText(result.value), reads: [...reads].map(([id, revision]) => ({ id, revision })), queries };
    } finally { clearTimeout(timer); }
  }

  /** Ends one run (`script.stop`): its remaining calls are refused, and its note says it was stopped and by whom. */
  stopRun(run: string, by: MutationProvenance): { stopped: boolean } {
    const controller = this.runs.get(run);
    if (!controller) return { stopped: false };
    controller.abort(new Error(`Stopped by ${by.actorId ?? by.author}`));
    return { stopped: true };
  }

  start(extension: LoadedExtension, request: ExtensionActRequest): ExtensionActResult {
    const source = extension.script!;
    const undo = this.writes.beginRun(`script:${extension.name}`);
    const actor: MutationProvenance = { author: "agent", actorId: `script:${extension.name}`, sessionId: undo, taskId: `trigger:script:${extension.id}` };
    const requestedBy = request.requestedBy ?? { author: "user" as const };
    const controller = new AbortController();
    this.running.add(controller);
    this.runs.set(undo, controller);
    const deadlineMs = source.deadlineMs ?? MAX_DEADLINE_MS;
    const deadline = setTimeout(() => controller.abort(new Error(`The script ran past its deadline (${Math.round(deadlineMs / 1000)}s)`)), deadlineMs);
    const old = this.previous.get(extension.id);
    this.previous.set(extension.id, source.code);
    const lines = [
      `${extension.name} · working [script-run::${undo}] [machine::script]`,
      `Author: ${actor.actorId ?? actor.author} · revision ${source.revision} · onBehalfOf: ${requestedBy.actorId ?? requestedBy.author}`,
      ...(old !== undefined && old !== source.code ? ["", "```diff", createPatch(extension.name, old, source.code), "```"] : []),
    ];
    const captured = <T>(work: () => T): T => {
      const before = new Map<string, Block>();
      const attribution = this.store.changes.attribution({ action: `script:${extension.name}`, actor, requestedBy, collect: true });
      const finish = () => {
        const changes = this.store.changes.committed(attribution);
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
    const log = captured(() => this.store.create(lines.join("\n"), source.blockId ?? request.blockId ?? null, actor.author,
      actor.author === "agent" ? { actorId: actor.actorId ?? "agent", sessionId: undo, taskId: actor.taskId } : undefined));
    const update = () => captured(() => {
      const now = this.store.require(log.id);
      this.store.update(log.id, lines.join("\n"), now.revision, actor);
    });
    let progress: ReturnType<typeof setTimeout> | undefined;
    const step = (s: HostStep) => {
      if (s.phase === "start") return;
      lines.push(`\n${s.seq}. ${s.tool}: ${s.phase === "done" ? JSON.stringify(s.result) : s.error}`);
      // A tight host-call loop must not flood readers and delay the person's save behind progress events.
      progress ??= setTimeout(() => {
        progress = undefined;
        try { update(); } catch (error) { controller.abort(error); }
      }, 50);
    };
    const client: AgentToolsClient = {
      requireCompatibleService: () => this.client.requireCompatibleService(),
      request: async input => {
        if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error("The script run ended");
        // The script is its code: a run that writes into its own note (its output, a log) goes on; an edit of the code ends it.
        const changed = source.blockId
          ? scriptFence(this.store.get(source.blockId)?.text ?? "").code !== source.code
          : await Bun.file(source.file!).text() !== source.code;
        if (changed) {
          controller.abort();
          throw new Error("The script source changed; run its saved revision again");
        }
        return captured(() => this.client.request(input));
      },
    };
    const site = this.bind(source, { blockId: request.blockId, line: request.line, trigger: !!request.trigger, props: Object.fromEntries(Object.entries(request.args ?? {}).map(([k, v]) => [k, [String(v)]])) });
    const api = hostApi(client, { ...actor, actorId: actor.actorId ?? actor.author }, {
      onStep: step,
      ...(site.thisId ? { thisId: site.thisId } : {}),
      ...(site.resolve ? { resolve: site.resolve } : {}),
      effects: source.effects,
      mcpAccess: request.mcpAccess,
      ...(request.clientId ? { act: (name: string, args: Record<string, unknown>) => this.act(request.clientId!, name, args, actor, controller.signal) } : {}),
    });
    const task = (async () => {
      let failure: string | undefined;
      try {
        const result = await runScript(source.code, api, controller.signal, source.format === "actions" ? request.args ?? {} : undefined, site.globals);
        const current = this.registry.extension(extension.id);
        if (!current || current.stamp !== extension.stamp) throw new Error("The script source changed during this run; its remaining output was discarded. Run the saved revision again.");
        lines[0] = `${extension.name} · ${result.ok ? "done" : "failed"} [script-run::${undo}] [machine::script]`;
        for (const output of result.output) if (output.type === "text") lines.push(output.text);
        if (result.ok) {
          if (result.value !== undefined) lines.push(scriptText(result.value));
        }
        else { failure = result.error.message; lines.push(failure); }
      } catch (error) {
        lines[0] = `${extension.name} · failed [script-run::${undo}] [machine::script]`;
        failure = error instanceof Error ? error.message : String(error);
        lines.push(failure);
      } finally {
        if (progress) clearTimeout(progress);
        clearTimeout(deadline);
        controller.abort();
        try {
          const drafts = await this.inverse(undo);
          this.writes.finishRun(undo, drafts);
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error);
          lines.push(`Undo unavailable: ${problem}`);
          this.writes.finishRun(undo, [], problem);
        }
        try { update(); } finally {
          this.captures.delete(undo);
          this.running.delete(controller);
          this.runs.delete(undo);
        }
      }
      return failure;
    })();
    this.tasks.set(undo, task);
    // Inline asks consume their completion after ExtensionCalls has returned, even for a fast parse failure.
    if (!request.background) void task.finally(() => { this.tasks.delete(undo); }).catch(() => {});
    return { extension: extension.id, action: "run", message: `running as ${actor.actorId ?? actor.author}; results in ((${log.id}))`, written: [log.id], undo, undoOn: source.blockId ?? log.id, writtenAs: actor.actorId ?? actor.author };
  }

  async stop(): Promise<void> {
    for (const run of this.running) run.abort();
    await Promise.allSettled(this.tasks.values());
  }
}
