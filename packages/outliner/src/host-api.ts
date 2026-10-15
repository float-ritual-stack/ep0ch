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
import { AGENT_TOOL_DEFINITIONS, toolArgsSpec, type AgentToolDefinition } from "@ep0ch/outline-core/agent-tool-definitions";
import { checkToolArgs } from "@ep0ch/outline-core/tool-args";
import { runAgentOperation, type AgentActor, type AgentToolsClient } from "./agent-tools";
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
  /** Told of every call as it starts and ends. It is never awaited, and what it throws is ignored. */
  onStep?(step: HostStep): void;
}

export interface HostApi {
  /** Every tool, by its name (`outline_read`, `outline_patch`, `view_order`…). */
  readonly tool: Readonly<Record<string, HostTool>>;
  /** The tools this API offers, by name. */
  readonly tools: readonly string[];
  /** One tool by name: what `api.tool[name](input)` does, for a name chosen at run time. */
  call(name: string, input?: Record<string, unknown>): Promise<unknown>;
  /** The blocks a query in the views' grammar holds for (outline_find with `query`): `q("type=ticket due <= +3d")`. */
  q(query: string, options?: { under?: string; limit?: number }): Promise<unknown>;
  /** A note with its children (outline_read): `read("PIE-123", { depth: 2 })`. */
  read(ref: string, options?: { depth?: number; limit?: number }): Promise<unknown>;
}

/** One tool as a function: its arguments checked as every surface checks them, then its agent operation. */
function toolFunction(client: AgentToolsClient, actor: AgentActor | undefined, definition: AgentToolDefinition, step: (s: Omit<HostStep, "seq">, seq?: number) => number): HostTool {
  return async (input = {}) => {
    const seq = step({ tool: definition.name, writes: definition.writes, phase: "start", input });
    const said = (phase: "done" | "refused", more: Partial<HostStep>) => step({ tool: definition.name, writes: definition.writes, phase, input, ...more }, seq);
    try {
      const checked = checkToolArgs(toolArgsSpec(definition), input);
      if (!checked.ok) throw new WorkToolRefusal(checked.error);
      const command = definition.command(checked.args);
      if (typeof command === "string") throw new WorkToolRefusal(`${definition.name}: ${command}`);
      const result = await runAgentOperation(client, command.operation, command.input, actor);
      said("done", { result });
      return result;
    } catch (e) {
      said("refused", { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
}

/**
 * The host API for code running as `actor`: the person, or the agent they run (its writes are `author: agent` with its
 * actor id; a run's `sessionId` names the run). Reads need no actor; a write without one is refused, never written as
 * nobody. Every call is a plain promise: a script awaits what it needs and starts the rest side by side.
 */
export function hostApi(client: AgentToolsClient, actor?: AgentActor, options: HostApiOptions = {}): HostApi {
  let calls = 0;
  const step = (s: Omit<HostStep, "seq">, seq = ++calls) => {
    try { options.onStep?.({ seq, ...s }); } catch { /* an observer never stops the run */ }
    return seq;
  };
  const tools: Record<string, HostTool> = {};
  for (const definition of AGENT_TOOL_DEFINITIONS) tools[definition.name] = toolFunction(client, actor, definition, step);
  const names = Object.keys(tools);
  const call = (name: string, input?: Record<string, unknown>) => {
    const tool = tools[name];
    if (!tool) return Promise.reject(new WorkToolRefusal(`No tool ${name}. The host API has ${names.join(", ")}.`));
    return tool(input);
  };
  const q = (query: string, opts: { under?: string; limit?: number } = {}) => call("outline_find", { query, ...opts });
  const read = (ref: string, opts: { depth?: number; limit?: number } = {}) => call("outline_read", { ref, ...opts });
  return Object.freeze({ tool: Object.freeze(tools), tools: names, call, q, read });
}
