/**
 * The agent tools as plain functions, for code (scripting slice 1, PIE-720; the design is pie's [[scripting]] note): one
 * function per tool in the one list of definitions (@ep0ch/outline-core/agent-tool-definitions) that the Claude mod and
 * the MCP gateway register, each checked the way those surfaces check it and run by the same agent operation
 * (`runAgentOperation`, src/agent-tools.ts). A script's call, a mod tool and an MCP write reach the same handler.
 *
 *   const api = hostApi(client, { actorId: "kitty" });
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

export interface HostApi {
  /** Every tool, by its name (`outline_read`, `outline_patch`, `view_order`…). */
  readonly tool: Readonly<Record<string, HostTool>>;
  /** The tools this API offers, by name. */
  readonly tools: readonly string[];
  /** One tool by name: what `api.tool[name](input)` does, for a name chosen at run time. */
  call(name: string, input?: Record<string, unknown>): Promise<unknown>;
  /** The blocks a query in the views' grammar holds for (outline_find with `query`): `q("type=ticket due <= +3d")`. */
  q(query: string, options?: { under?: string; limit?: number }): Promise<unknown>;
}

/** One tool as a function: its arguments checked as every surface checks them, then its agent operation. */
function toolFunction(client: AgentToolsClient, actor: AgentActor | undefined, definition: AgentToolDefinition): HostTool {
  return async (input = {}) => {
    const checked = checkToolArgs(toolArgsSpec(definition), input);
    if (!checked.ok) throw new WorkToolRefusal(checked.error);
    const command = definition.command(checked.args);
    if (typeof command === "string") throw new WorkToolRefusal(`${definition.name}: ${command}`);
    return runAgentOperation(client, command.operation, command.input, actor);
  };
}

/**
 * The host API for code running as `actor`: the person, or the agent they run (its writes are `author: agent` with its
 * actor id). Reads need no actor; a write without one is refused, never written as nobody.
 */
export function hostApi(client: AgentToolsClient, actor?: AgentActor): HostApi {
  const tools: Record<string, HostTool> = {};
  for (const definition of AGENT_TOOL_DEFINITIONS) tools[definition.name] = toolFunction(client, actor, definition);
  const names = Object.keys(tools);
  const call = (name: string, input?: Record<string, unknown>) => {
    const tool = tools[name];
    if (!tool) return Promise.reject(new WorkToolRefusal(`No tool ${name}. The host API has ${names.join(", ")}.`));
    return tool(input);
  };
  const q = (query: string, options: { under?: string; limit?: number } = {}) => call("outline_find", { query, ...options });
  return Object.freeze({ tool: Object.freeze(tools), tools: names, call, q });
}
