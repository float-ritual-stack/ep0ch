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
import { applyWrite, type McpWriteTool } from "./mcp-write";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import type { AnnotationRecord, AnnotationThread } from "./types";
import { WorkToolRefusal } from "./work-tools";

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
  onQuery?(query: { query: string; limit: number; ids: readonly string[] }): void;
  /** Deferred to a microtask, never awaited; errors are ignored. Keep callbacks brief: they share the host event loop. */
  onStep?(step: HostStep): void;
}

/** What a script's `place()` takes: where, how, and what the region is called. See src/place.ts. */
export interface PlaceOptions { at?: string; mode?: string; label?: string; interpolate?: boolean }

export interface HostApi {
  /** Writes `content` into this run's note as an output region at `at: "^anchor"` (default: after the line that ran it); `mode` is append (default), prepend, replace or upsert. */
  place(content: string, options?: PlaceOptions): Promise<unknown>;
  act(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Every tool, by its name (`outline_read`, `outline_patch`, `view_order`…). */
  readonly tool: Readonly<Record<string, HostTool>>;
  /** The tools this API offers, by name. */
  readonly tools: readonly string[];
  /** One tool by name: what `api.tool[name](input)` does, for a name chosen at run time. */
  call(name: string, input?: Record<string, unknown>): Promise<unknown>;
  /** The blocks a query in the views' grammar holds for (outline_find with `query`): `q("type=ticket due <= +3d")`. */
  q(query: string, options?: { under?: string; limit?: number }): Promise<unknown>;
  /** A note as its record (id, parent, title, header, body, text, properties, fields, tasks, links, backlinks…) with its children (outline_read's, to `depth`): `read("PIE-123", { depth: 2 })`. */
  read(ref: string, options?: { depth?: number; limit?: number }): Promise<unknown>;
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
        } else blockId = (await resolveRef(client, String(ref))).id;
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

/**
 * The host API for code running as the agent `actor` (its writes are `author: agent` with its
 * actor id; a run's `sessionId` names the run). Reads need no actor; a write without one is refused, never written as
 * nobody. Every call is a plain promise: a script awaits what it needs and starts the rest side by side.
 */
export function hostApi(client: AgentToolsClient, actor?: AgentActor, options: HostApiOptions = {}): HostApi {
  let calls = 0;
  const step = (s: Omit<HostStep, "seq">, seq = ++calls) => {
    // Dispatch calls before notifying observers; observer failures must not turn a saved write into a refusal.
    queueMicrotask(() => {
      try { Promise.resolve(options.onStep?.({ seq, ...s }) as unknown).catch(() => {}); } catch { /* as above */ }
    });
    return seq;
  };
  const tools: Record<string, HostTool> = Object.create(null);
  for (const definition of AGENT_TOOL_DEFINITIONS) tools[definition.name] = toolFunction(client, actor, definition, step, options);
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
  const q = async (query: string, opts: { under?: string; limit?: number } = {}) => {
    const found = await call("outline_find", { query, ...opts }) as { blocks?: { id?: unknown }[] } | null;
    if (options.onQuery && opts.under === undefined && Array.isArray(found?.blocks)) options.onQuery({ query, limit: opts.limit ?? 20, ids: found.blocks.flatMap(row => typeof row.id === "string" ? [row.id] : []) });
    return found;
  };
  const read = async (ref: string, opts: { depth?: number; limit?: number } = {}) => {
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
  const act = (name: string, args: Record<string, unknown> = {}) => options.mcpAccess && options.mcpAccess !== "full"
    ? Promise.reject(new WorkToolRefusal(`MCP access is ${options.mcpAccess}: a run may not dispatch door actions (act); ep0ch mcp access full lets it`))
    : options.act
    ? options.act(name, args)
    : Promise.reject(new WorkToolRefusal("act needs a connected door; run this script from the door's power bar"));
  const place = (content: string, opts: PlaceOptions = {}) => options.place
    ? options.place(String(content), opts ?? {})
    : Promise.reject(new WorkToolRefusal("place writes into this run's note: run this script from a note (this run has none)"));
  return Object.freeze({ tool: Object.freeze(tools), tools: names, call, q, read, act, resolve, place });
}
