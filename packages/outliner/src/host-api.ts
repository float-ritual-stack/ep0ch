/**
 * The agent tools as plain functions, for code (scripting slice 1, PIE-720; the design is pie's [[scripting]] note): one
 * function per tool in the one list of definitions (@ep0ch/outline-core/agent-tool-definitions) that the Claude mod and
 * the MCP gateway register, each checked the way those surfaces check it and run by the same agent operation
 * (`runAgentOperation`, src/agent-tools.ts). A script's call, a mod tool and an MCP write reach the same handler.
 *
 *   const api = hostApi(client, { actorId: "kitty", sessionId: "run-7" }, { onStep: s => stream(s) });
 *   const found = await api.q("type=ticket NOT work-stage=done") as { blocks: { id: string }[] };
 *   await api.tool.outline_comment({ ref: found.blocks[0].id, whole: true, body: "Still open?" });
 *
 * Every write is `author: agent`, attributed to `actor`; a wrong call is refused with the tool's arguments and a call
 * that works, as the tools answer an agent.
 */
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_SURFACES, toolArgsSpec, type AgentToolDefinition } from "@ep0ch/outline-core/agent-tool-definitions";
import { checkToolArgs } from "@ep0ch/outline-core/tool-args";
import { findBlocks, runAgentOperation, resolveRef, type AgentActor, type AgentToolsClient, type FindInput } from "./agent-tools";
import { readsOtherNotes } from "./block-query";
import { blockDisplayTitle } from "./references";
import { applyWrite, type McpWriteTool } from "./mcp-write";
import type { McpAccessLevel, QuestionFacet } from "@ep0ch/outline-core/protocol";
import type { AnnotationRecord, AnnotationThread, VisibleBlock, VisibleBlockCollection } from "./types";
import { WorkToolRefusal } from "./work-tools";
import { answerShape, shapeOfAnswer, type ScriptQueryRecord } from "./line-watches";

export type HostTool = (input?: Record<string, unknown>) => Promise<unknown>;

/**
 * One step of a run, as it happens: a call starting, done or refused. A runtime streams these (the ask's line counting
 * its writes, a tile filling beside the note) while the script goes on; nothing waits on the observer.
 */
export interface HostStep {
  /** Which call of this API it is, from 1: a start and its end share it. */
  seq: number;
  tool: string;
  /** It writes: done, it is one attributed change, `author: agent` as the API's actor. */
  writes: boolean;
  phase: "start" | "done" | "refused";
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface HostApiOptions {
  kind?: "render" | "action";
  /** Query totals were computed after the Site’s visibility cut. */
  cutQueries?: boolean;
  /** A parent reference under the reader’s visibility cut; records the check even when withheld. */
  visibleId?(id: string): string | null;
  mcpAccess?: McpAccessLevel;
  act?(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** The note this run is about (`this`): a query's `this` targets (`parent:this`) are bound to it. */
  thisId?: string;
  /** What `resolve(path)` answers: the Site's path reader (`site.answer`), for this run's Site. */
  resolve?(path: string): Promise<unknown>;
  /** `place(content, options)` writes output into the run's note at an address (src/place.ts); only a run that writes has one. */
  place?(content: string, options: PlaceOptions): Promise<unknown>;
  /** Ids of the notes this run read (a read, a resolve, a query's rows): what a render-mode script's output depends on. */
  onRead?(ids: readonly string[]): void;
  /** The run saw more than could be listed (`Reads.untracked`): what it drew depends on notes it can't name. */
  onUntracked?(): void;
  /** A `q(query)` and the rows it found, so a render can be drawn again when the query's answer changes (a new match, not only an edit of a row). */
  onQuery?(query: ScriptQueryRecord): void;
  /** Deferred to a microtask, never awaited; errors are ignored. Keep callbacks brief: they share the host event loop. */
  onStep?(step: HostStep): void;
}

/** What a script's `query()` asks: blocks.query's question (`where`, `group`, `sort`, `limit`, `facets`). */
export interface ScriptQuery { where?: string; group?: string; sort?: string; limit?: number; facets?: true | string[] }
/** One note a `query()` holds: its id, its title and its properties (each key's values, as `props` are). */
export interface ScriptQueryRow { id: string; title: string; props: Record<string, string[]> }
/** What `query()` answers: the rows, the groups (each with its rows), facets and a hint, as blocks.query says them. */
export interface ScriptQueryAnswer {
  rows: ScriptQueryRow[];
  groups?: { value: string | null; count: number; rows: ScriptQueryRow[] }[];
  facets?: QuestionFacet[];
  hint?: string;
  /** Every match, when the service counted them all (a sort, group or facets did); else the rows'. */
  total: number;
  complete: boolean;
}
/** The most notes one `read([...])` takes. */
export const MAX_BATCH_READ = 200;
/** The most rows a `query()` lists (its groups and facets count every match). */
const MAX_QUERY_ROWS = 1000;

/** The most of each stream `sh` and `fetch` hand a script; past it the rest is dropped and `truncated` says so. */
export const MAX_REACH_OUTPUT = 1024 * 1024;
/** How much of a reach's output its step records on the run note: the first lines, and at most this many characters. */
const STEP_LINES = 20;
const STEP_CHARS = 2000;
/** How long a killed command has to end on SIGTERM before it gets SIGKILL. */
const KILL_GRACE_MS = 1000;

/** What `sh(argv, options)` takes: the folder it runs in (the host's own, when left out), text for its stdin, and a timeout of its own. */
export interface ShOptions { cwd?: string; stdin?: string; timeoutMs?: number }
/** What `sh` answers: the exit code and both streams (each at most MAX_REACH_OUTPUT). A command that fails answers too; only a kill refuses. */
export interface ShResult { exit: number; stdout: string; stderr: string; truncated?: true }
/** What `fetch(url, init)` takes: fetch's own method, headers and text body, and a timeout. */
export interface FetchInit { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
/** What `fetch` answers: the status, the headers and the body as text (at most MAX_REACH_OUTPUT). */
export interface FetchResult { status: number; headers: Record<string, string>; text: string; truncated?: true }

/** A stream read whole, keeping at most `cap` bytes; `drain` reads past the cap (a command's pipe must not fill and stall it). */
async function cappedText(stream: ReadableStream<Uint8Array> | null | undefined, drain: boolean): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const kept: Uint8Array[] = [];
  let size = 0, bytes = 0;
  if (stream) for await (const chunk of stream) {
    bytes += chunk.length;
    if (size < MAX_REACH_OUTPUT) { const part = chunk.subarray(0, MAX_REACH_OUTPUT - size); kept.push(part); size += part.length; }
    // At exactly the cap the stream may be done or not: stop once a byte past it is seen, so `truncated` is true.
    if (bytes > MAX_REACH_OUTPUT && !drain) break;
  }
  return { text: new TextDecoder().decode(Buffer.concat(kept)), bytes, truncated: bytes > size };
}

/** The first lines of some output, as a step records it. */
function firstLines(text: string): string {
  const lines = text.split("\n");
  const head = lines.slice(0, STEP_LINES).join("\n");
  return head.length > STEP_CHARS ? `${head.slice(0, STEP_CHARS)}…` : lines.length > STEP_LINES ? `${head}\n…` : head;
}

/** What a script's `place()` takes: where, how, and what the region is called. See src/place.ts. */
export interface PlaceOptions { at?: string; mode?: string; label?: string; interpolate?: boolean }

export interface HostApi {
  /** Writes `content` into this run's note as an output region at `at: "^anchor"` (default: after the line that ran it); `mode` is append (default), prepend, replace or upsert. */
  place(content: string, options?: PlaceOptions): Promise<unknown>;
  act(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /**
   * Runs a command as the host's user, with no shell (`sh(["gh", "issue", "list"])`): its exit code and output. A step on
   * the run note records the argv, exit, bytes and first lines. Killed at `timeoutMs` or when `signal` ends (the run's deadline).
   */
  sh(argv: readonly string[], options?: ShOptions, signal?: AbortSignal): Promise<ShResult>;
  /** An http(s) request (`fetch(url, { method, headers, body })`): `{ status, headers, text }`, recorded as a step like `sh`. */
  fetch(url: string, init?: FetchInit, signal?: AbortSignal): Promise<FetchResult>;
  /** Every name a `::name` or a script answers to here, with who has it: the built-ins, the extensions' and the scripts'. */
  components(): Promise<{ name: string; origin: string }[]>;
  /** Every tool, by its name (`outline_read`, `outline_patch`, `view_order`…). */
  readonly tool: Readonly<Record<string, HostTool>>;
  /** The tools this API offers, by name. */
  readonly tools: readonly string[];
  /** One tool by name: what `api.tool[name](input)` does, for a name chosen at run time. */
  call(name: string, input?: Record<string, unknown>): Promise<unknown>;
  /** The blocks a query in the views' grammar holds for (outline_find with `query`): `q("type=ticket due <= +3d")`; `properties: true` puts each row's properties on it (no read per row). */
  q(query: string, options?: { under?: string; limit?: number; properties?: boolean }): Promise<unknown>;
  /**
   * A note as its record (id, parent, title, header, body, text, properties, fields, tasks, links, backlinks…) with its children (outline_read's, to `depth`): `read("PIE-123", { depth: 2 })`.
   * A list of refs (at most MAX_BATCH_READ) reads each, in order; one that can't be read is `{ ref, problem }` in its place.
   */
  read(ref: string | readonly string[], options?: { depth?: number; limit?: number }): Promise<unknown>;
  /**
   * The notes a query in the views' grammar holds for, as rows a component draws: `query({ where: "type=errand", group:
   * "status" })` answers `{ rows: [{ id, title, props }], groups: [{ value, count, rows }], facets, hint, total, complete }`.
   * `where` reads `this` as the run's note; `group` counts every match (its rows are the ones within `limit`).
   */
  query(question: ScriptQuery): Promise<ScriptQueryAnswer>;
  /** A path as `{{ }}` answers it for this run's Site (`this.owner`, `props.week`, `this.tasks | status=todo`): `{ values }` or `{ problem }`. */
  resolve(path: string): Promise<unknown>;
}

const NOTE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Text longer than this is a note's words, not a reference to a note: its ids aren't scanned. */
const MAX_REFERENCE = 200;
const MAX_NOTE_IDS = 500;

/** The notes a script's answers mention, and whether it saw more than could be listed (or counted notes it was not shown). */
export interface Reads { ids: Set<string>; untracked: boolean }

/**
 * Every note a tool's answer mentions: its rows, children, links, backlinks, ancestors and breadcrumbs, each an id (or
 * `((id))` or a URI holding one) somewhere in the answer. A render script's output depends on all of them, and a reader who
 * may not see one must not be shown the output. An answer too large to list is `untracked`.
 */
export function noteIds(result: unknown, out: Reads = { ids: new Set(), untracked: false }, depth = 0): Reads {
  if (depth > 64 || out.ids.size >= MAX_NOTE_IDS) { out.untracked = true; return out; }
  if (typeof result === "string") { if (result.length <= MAX_REFERENCE) for (const found of result.matchAll(NOTE_ID)) out.ids.add(found[0].toLowerCase()); }
  else if (Array.isArray(result)) for (const item of result) noteIds(item, out, depth + 1);
  else if (result && typeof result === "object") {
    for (const value of Object.values(result)) noteIds(value, out, depth + 1);
  }
  return out;
}

/** Parent references name notes too, even when the answer includes none of their text. */
function visibleParents(result: unknown, visibleId: HostApiOptions["visibleId"]): unknown {
  if (!visibleId) return result;
  if (Array.isArray(result)) return result.map(value => visibleParents(value, visibleId));
  if (result && typeof result === "object") return Object.fromEntries(Object.entries(result).map(([key, value]) => [key,
    (key === "parent" || key === "parentId") && typeof value === "string" ? visibleId(value) : visibleParents(value, visibleId),
  ]));
  return result;
}

/** A find that says more notes matched than it listed (a total, an incomplete answer): its count tells of notes it did not list. */
const countsUnlisted = (result: unknown): boolean => {
  const found = result as { blocks?: unknown[]; complete?: boolean; total?: number } | null;
  return !!found && Array.isArray(found.blocks) && (found.complete === false || (typeof found.total === "number" && found.total > found.blocks.length));
};

/** The rows of a question about other notes read those notes' words: their neighbours, as one more read. */
async function neighbourReads(client: AgentToolsClient, query: string, result: unknown): Promise<Reads> {
  const rows = (result as { blocks?: { id?: unknown }[] } | null)?.blocks;
  if (!Array.isArray(rows) || !rows.length || !readsOtherNotes(query)) return { ids: new Set(), untracked: false };
  const ids = rows.flatMap(row => typeof row.id === "string" ? [row.id] : []);
  return ids.length ? noteIds((await client.request<{ records: object[] }>({ action: "blocks.records", ids: ids.slice(0, 200) })).records) : { ids: new Set(), untracked: false };
}

/** One tool as a function: its arguments checked as every surface checks them, then its agent operation. */
function toolFunction(client: AgentToolsClient, actor: AgentActor | undefined, definition: AgentToolDefinition, step: (s: Omit<HostStep, "seq">, seq?: number) => number, options: HostApiOptions): HostTool {
  return async (input = {}) => {
    const seq = step({ tool: definition.name, writes: definition.writes, phase: "start", input });
    const said = (phase: "done" | "refused", more: Partial<HostStep>) => step({ tool: definition.name, writes: definition.writes, phase, input, ...more }, seq);
    try {
      const checked = checkToolArgs(toolArgsSpec(definition), input);
      if (!checked.ok) throw new WorkToolRefusal(checked.error);
      const command = definition.command(checked.args);
      if (typeof command === "string") throw new WorkToolRefusal(`${definition.name}: ${command}`);
      let result: unknown;
      if (options.mcpAccess && definition.writes) {
        if (!actor || !AGENT_TOOL_SURFACES[definition.name]?.gateway) throw new WorkToolRefusal(`${definition.name} is not an MCP write tool`);
        const target = definition.target ?? "ref";
        const { [target]: ref, ...writeInput } = checked.args;
        let blockId: string;
        if (definition.name === "outline_reply" || definition.name === "outline_resolve_thread") {
          const mark = await client.request<AnnotationRecord>({ action: "annotations.get", annotationId: String(writeInput.edit ?? writeInput.thread) });
          const subject = mark.originalTarget.representation.subject;
          if (subject.kind !== "block") throw new WorkToolRefusal("MCP script replies need a note's thread");
          blockId = subject.blockId;
        } else if (definition.name === "outline_create" && String(ref).trim() === "root") blockId = "root"; // the top level, as the tool and the CLI take it
        else blockId = (await resolveRef(client, String(ref))).id;
        const outcome = await applyWrite({
          request: (action, args) => client.request({ action, ...args } as Parameters<AgentToolsClient["request"]>[0]),
          info: () => client.requireCompatibleService(),
          comments: async id => (await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: id }, includeResolved: true } }))
            .map(t => ({ id: t.block.id, replies: t.replies.map(r => ({ id: r.block.id })) })),
        }, { tool: definition.name as McpWriteTool, blockId, input: writeInput, ...(typeof writeInput.revision === "number" ? { revision: writeInput.revision } : {}) },
        { level: options.mcpAccess, actor, uri: id => `((${id}))` });
        result = outcome.outcome === "proposed" ? outcome : outcome.detail;
      } else if (command.operation === "find" && options.thisId) {
        // A query in a script's note reads `this` (`parent:this`): the tool's arguments don't name it, the run's Site does.
        result = await findBlocks(client, { ...command.input, this: options.thisId } as FindInput);
      } else result = await runAgentOperation(client, command.operation, command.input, actor);
      result = visibleParents(result, options.visibleId);
      said("done", { result });
      if (options.onRead) {
        const reads = noteIds(result);
        if (definition.name === "outline_find") {
          const near = await neighbourReads(client, String(checked.args.query ?? ""), result);
          for (const id of near.ids) reads.ids.add(id);
          if (near.untracked || (!options.cutQueries && countsUnlisted(result))) reads.untracked = true;
        }
        if (reads.ids.size) options.onRead([...reads.ids]);
        if (reads.untracked) options.onUntracked?.();
      }
      return result;
    } catch (e) {
      said("refused", { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
}

/** The agent tools a script is handed: all but script_run (a script runs other scripts through its button's sequence, not by starting a run inside its own). */
export const SCRIPT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = AGENT_TOOL_DEFINITIONS.filter(definition => definition.name !== "script_run");

/**
 * The host API for code running as the agent `actor` (its writes are `author: agent` with its
 * actor id; a run's `sessionId` names the run). Reads need no actor; a write without one is refused, never written as
 * nobody. Every call is a plain promise: a script awaits what it needs and starts the rest side by side.
 */
export type RenderHostApi = Omit<HostApi, "act" | "place" | "sh" | "fetch" | "components">;

export function hostApi(client: AgentToolsClient, actor: undefined, options: HostApiOptions & { kind: "render" }): RenderHostApi;
export function hostApi(client: AgentToolsClient, actor?: AgentActor, options?: HostApiOptions): HostApi;
export function hostApi(client: AgentToolsClient, actor?: AgentActor, options: HostApiOptions = {}): HostApi | RenderHostApi {
  let calls = 0;
  const step = (s: Omit<HostStep, "seq">, seq = ++calls) => {
    // Dispatch calls before notifying observers; observer failures must not turn a saved write into a refusal.
    queueMicrotask(() => {
      try { Promise.resolve(options.onStep?.({ seq, ...s }) as unknown).catch(() => {}); } catch { /* as above */ }
    });
    return seq;
  };
  const tools: Record<string, HostTool> = Object.create(null);
  for (const definition of SCRIPT_TOOL_DEFINITIONS) {
    if (options.kind === "render" && definition.writes) continue;
    tools[definition.name] = toolFunction(client, actor, definition, step, options);
  }
  const names = Object.keys(tools);
  const call = (name: string, input?: Record<string, unknown>) => {
    const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
    if (!tool) {
      const inputArgs = input ?? {};
      const seq = step({ tool: name, writes: false, phase: "start", input: inputArgs });
      const error = new WorkToolRefusal(`No tool ${name}. The host API has ${names.join(", ")}.`);
      step({ tool: name, writes: false, phase: "refused", input: inputArgs, error: error.message }, seq);
      return Promise.reject(error);
    }
    return tool(input);
  };
  const q = async (query: string, opts: { under?: string; limit?: number; properties?: boolean } = {}) => {
    const found = await call("outline_find", { query, ...opts }) as { blocks?: { id?: unknown }[] } | null;
    if (options.onQuery && opts.under === undefined && Array.isArray(found?.blocks)) {
      const ids = found.blocks.flatMap(row => typeof row.id === "string" ? [row.id] : []);
      options.onQuery({ query, limit: opts.limit ?? 20, ids, shape: answerShape({ ids, complete: (found as { complete?: boolean }).complete !== false }) });
    }
    return found;
  };
  const read = async (ref: string | readonly string[], opts: { depth?: number; limit?: number } = {}): Promise<unknown> => {
    if (Array.isArray(ref)) {
      if (ref.length > MAX_BATCH_READ) throw new WorkToolRefusal(`read takes at most ${MAX_BATCH_READ} notes at once (asked ${ref.length}); read them in slices`);
      return Promise.all(ref.map(one => readOne(String(one), opts).catch(e => ({ ref: one, problem: e instanceof Error ? e.message : String(e) }))));
    }
    return readOne(ref as string, opts);
  };
  const query = async (question: ScriptQuery = {}): Promise<ScriptQueryAnswer> => {
    if (!question || typeof question !== "object" || Array.isArray(question)) throw new WorkToolRefusal('query takes { where, group, sort, limit, facets }, such as query({ where: "type=errand", group: "status" })');
    const where = String(question.where ?? "");
    const limit = Math.max(1, Math.min(MAX_QUERY_ROWS, Math.floor(Number(question.limit ?? 200)) || 200));
    const input = { where, ...(question.group ? { group: String(question.group) } : {}), ...(question.sort ? { sort: String(question.sort) } : {}), limit, ...(question.facets ? { facets: question.facets === true ? true as const : [...question.facets].map(String) } : {}) };
    const seq = step({ tool: "query", writes: false, phase: "start", input });
    try {
      if (where) await client.requireCompatibleService();
      const ask = (q: object) => client.request<VisibleBlockCollection>({ action: "blocks.query", query: { ...q, ...(options.thisId ? { this: options.thisId } : {}) } });
      const found = await ask(input);
      const row = (block: VisibleBlock): ScriptQueryRow => {
        const props: Record<string, string[]> = {};
        for (const p of block.properties) (props[p.key] ??= []).push(p.value);
        return { id: block.id, title: blockDisplayTitle(block), props };
      };
      const rows = found.blocks.map(row);
      const byId = new Map(rows.map(r => [r.id, r]));
      const complete = found.completeness.kind === "complete";
      const answer: ScriptQueryAnswer = {
        rows,
        ...(found.groups ? { groups: found.groups.map(g => ({ value: g.value, count: g.count, rows: g.ids.flatMap(id => byId.get(id) ?? []) })) } : {}),
        ...(found.facets ? { facets: found.facets } : {}),
        ...(found.hint ? { hint: found.hint } : {}),
        total: found.completeness.kind === "truncated" ? found.completeness.matched ?? rows.length : rows.length, complete,
      };
      step({ tool: "query", writes: false, phase: "done", input, result: { rows: rows.length, total: answer.total } }, seq);
      // A render is drawn again when the question's answer changes (its rows, the counts over every match, whether the
      // list was complete): the question is recorded whole, with the shape of this answer, and asked again to compare.
      if (options.onQuery) {
        options.onQuery({ query: where, limit, ids: rows.map(r => r.id), shape: shapeOfAnswer(found), ...(input.group ? { group: input.group } : {}), ...(input.sort ? { sort: input.sort } : {}), ...(input.facets ? { facets: input.facets } : {}) });
      }
      if (options.onRead) {
        options.onRead(rows.map(r => r.id));
        // Groups and facets count notes the rows don't list: what it draws depends on notes it can't name.
        if (!complete && !options.cutQueries) options.onUntracked?.();
      }
      return answer;
    } catch (e) {
      step({ tool: "query", writes: false, phase: "refused", input, error: e instanceof Error ? e.message : String(e) }, seq);
      throw e;
    }
  };
  const readOne = async (ref: string, opts: { depth?: number; limit?: number } = {}) => {
    const read = await call("outline_read", { ref, ...opts }) as { id?: string };
    // outline_read's answer is the record's properties and fields already; the rest of the record (header, tasks, links…) joins it.
    if (typeof read?.id !== "string") return read;
    const { records } = await client.request<{ records: object[] }>({ action: "blocks.records", ids: [read.id] });
    const whole = visibleParents({ ...(records[0] ?? {}), ...read }, options.visibleId);
    if (options.onRead) { const reads = noteIds(whole); options.onRead([...reads.ids]); if (reads.untracked) options.onUntracked?.(); }
    return whole;
  };
  const resolve = (path: string) => options.resolve
    ? options.resolve(path)
    : Promise.reject(new WorkToolRefusal("resolve answers for a note: run this script from a note, or pass at= (this run has no note)"));
  if (options.kind === "render") return Object.freeze({ tool: Object.freeze(tools), tools: names, call, q, read, query, resolve });
  // act, sh and fetch reach past the outline: below full MCP access a run may not, in the same words.
  const belowFull = (what: string) => options.mcpAccess && options.mcpAccess !== "full"
    ? new WorkToolRefusal(`MCP access is ${options.mcpAccess}: a run may not ${what}; ep0ch mcp access full lets it`) : undefined;
  /** One reach as a step: started, then done with what `summary` keeps of its answer, or refused with why. */
  const reach = async <T>(tool: string, input: Record<string, unknown>, work: () => Promise<T>, summary: (answer: T) => unknown): Promise<T> => {
    const seq = step({ tool, writes: false, phase: "start", input });
    try {
      const answer = await work();
      step({ tool, writes: false, phase: "done", input, result: summary(answer) }, seq);
      return answer;
    } catch (e) {
      step({ tool, writes: false, phase: "refused", input, error: e instanceof Error ? e.message : String(e) }, seq);
      throw e;
    }
  };
  /** The run's end and a timeout of the call's own, as one signal, and why it ended in the call's words. */
  const ending = (signal: AbortSignal | undefined, timeoutMs: unknown, what: string) => {
    const ms = Number(timeoutMs);
    if (timeoutMs !== undefined && !(Number.isFinite(ms) && ms > 0)) throw new WorkToolRefusal(`${what}: timeoutMs takes a number of milliseconds, such as 30000`);
    const timeout = timeoutMs === undefined ? undefined : AbortSignal.timeout(ms);
    const signals = [signal, timeout].filter((s): s is AbortSignal => !!s);
    const any = signals.length ? AbortSignal.any(signals) : undefined;
    const why = () => timeout?.aborted && !signal?.aborted
      ? new WorkToolRefusal(`${what} ran past its timeoutMs (${ms} ms) and was stopped`)
      : new WorkToolRefusal(`${what} was stopped: ${signal?.reason instanceof Error ? signal.reason.message : "the script run ended"}`);
    return { signal: any, why };
  };
  const sh = (argv: readonly string[], opts: ShOptions = {}, signal?: AbortSignal): Promise<ShResult> => {
    const list = Array.isArray(argv) ? argv.map(String) : [];
    const input = { argv: list, ...(opts?.cwd !== undefined ? { cwd: String(opts.cwd) } : {}), ...(opts?.stdin !== undefined ? { stdin: `${String(opts.stdin).length} chars` } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) };
    return reach("sh", input, async () => {
      const refused = belowFull("run commands (sh)");
      if (refused) throw refused;
      if (!Array.isArray(argv) || !list.length || !list[0]) throw new WorkToolRefusal('sh takes the command as a list, with no shell: sh(["gh", "issue", "list"])');
      const what = `sh ${list[0]}`;
      const end = ending(signal, opts?.timeoutMs, what);
      if (end.signal?.aborted) throw end.why();
      const child = Bun.spawn([...list], {
        ...(opts?.cwd !== undefined ? { cwd: String(opts.cwd) } : {}),
        stdin: opts?.stdin !== undefined ? Buffer.from(String(opts.stdin)) : "ignore", stdout: "pipe", stderr: "pipe",
      });
      let stop: (() => void) | undefined;
      const killed = new Promise<never>((_, reject) => {
        stop = () => {
          child.kill("SIGTERM");
          setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, KILL_GRACE_MS).unref?.();
          reject(end.why());
        };
      });
      end.signal?.addEventListener("abort", stop!, { once: true });
      try {
        const [out, err, exit] = await Promise.race([Promise.all([cappedText(child.stdout, true), cappedText(child.stderr, true), child.exited]), killed]);
        return { exit, stdout: out.text, stderr: err.text, ...(out.truncated || err.truncated ? { truncated: true as const } : {}), bytes: out.bytes, errBytes: err.bytes };
      } finally { end.signal?.removeEventListener("abort", stop!); }
    }, answer => ({ exit: answer.exit, bytes: answer.bytes, ...(answer.stdout ? { lines: firstLines(answer.stdout) } : {}), ...(answer.exit !== 0 && answer.stderr ? { stderr: firstLines(answer.stderr) } : {}), ...(answer.truncated ? { truncated: true } : {}) }))
      .then(({ bytes: _b, errBytes: _e, ...answer }) => answer);
  };
  const fetchUrl = (url: string, init: FetchInit = {}, signal?: AbortSignal): Promise<FetchResult> => {
    const method = String(init?.method ?? "GET").toUpperCase();
    return reach("fetch", { url: String(url), method, ...(init?.timeoutMs !== undefined ? { timeoutMs: init.timeoutMs } : {}) }, async () => {
      const refused = belowFull("fetch URLs (fetch)");
      if (refused) throw refused;
      let parsed: URL | undefined;
      try { parsed = new URL(String(url)); } catch { /* answered below */ }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new WorkToolRefusal(`fetch takes an http or https URL, such as fetch("https://example.com/feed.json") (got ${JSON.stringify(String(url))})`);
      const end = ending(signal, init?.timeoutMs, `fetch ${parsed.host}`);
      if (end.signal?.aborted) throw end.why();
      try {
        const response = await fetch(parsed, {
          method, ...(init?.headers ? { headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k, String(v)])) } : {}),
          ...(init?.body !== undefined ? { body: String(init.body) } : {}), ...(end.signal ? { signal: end.signal } : {}),
        });
        const body = await cappedText(response.body, false);
        return { status: response.status, headers: Object.fromEntries(response.headers), text: body.text, ...(body.truncated ? { truncated: true as const } : {}), bytes: body.bytes };
      } catch (e) {
        if (end.signal?.aborted) throw end.why();
        throw e;
      }
    }, answer => ({ status: answer.status, bytes: answer.bytes, ...(answer.text ? { lines: firstLines(answer.text) } : {}), ...(answer.truncated ? { truncated: true } : {}) }))
      .then(({ bytes: _b, ...answer }) => answer);
  };
  const components = () => reach("components", {}, async () => {
    const [{ schemas }, { extensions }] = await Promise.all([
      client.request<{ schemas: { id: string; origin?: string }[] }>({ action: "components.schemas" }),
      client.request<{ extensions: { id: string; name?: string; state?: string; script?: unknown; handlers?: { key: string }[] }[] }>({ action: "extensions.list" }),
    ]);
    const named = new Map(schemas.map(s => [s.id, s.origin ?? "built-in"]));
    for (const e of extensions) {
      if (e.state === "disabled") continue;
      for (const name of [...(e.script && e.name ? [e.name] : []), ...(e.handlers ?? []).map(h => h.key)]) if (!named.has(name)) named.set(name, e.id);
    }
    return [...named].map(([name, origin]) => ({ name, origin }));
  }, answer => ({ names: answer.length }));
  const act = (name: string, args: Record<string, unknown> = {}) => options.mcpAccess && options.mcpAccess !== "full"
    ? Promise.reject(belowFull("dispatch door actions (act)"))
    : options.act
    ? options.act(name, args)
    : Promise.reject(new WorkToolRefusal("act needs a connected door; run this script from the door's power bar"));
  const place = (content: string, opts: PlaceOptions = {}) => options.place
    ? options.place(String(content), opts ?? {})
    : Promise.reject(new WorkToolRefusal("place writes into this run's note: run this script from a note (this run has none)"));
  return Object.freeze({ tool: Object.freeze(tools), tools: names, call, q, read, query, act, sh, fetch: fetchUrl, components, resolve, place });
}
