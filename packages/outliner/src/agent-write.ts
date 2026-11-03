/*
 * One agent tool's write, carried out as the write gate says (src/write-gate.ts, PIE-1544). The CLI's agent operations
 * (the Claude mod's path) and a script's tools both come here; the MCP gateway reaches the same applyWrite from the door.
 */
import { AGENT_TOOL_SURFACES, type AgentToolDefinition } from "@ep0ch/outline-core/agent-tool-definitions";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { editBlock, resolveRef, runAgentOperation, type AgentActor, type AgentOperation, type AgentToolsClient, type EditInput } from "./agent-tools";
import { AGENT_OPERATION_SPECS } from "./agent-tool-specs";
import { checkToolArgs } from "@ep0ch/outline-core/tool-args";
import { applyWrite, type McpWriteTool } from "./mcp-write";
import type { AnnotationRecord, AnnotationThread } from "./types";
import { gate, type GateWhere } from "./write-gate";
import { WorkToolRefusal } from "./work-tools";

export interface AgentWrite {
  definition: AgentToolDefinition;
  /** The tool's arguments, checked, with its address (`ref`, `parent`, `thread`) as the tool takes it. */
  args: Record<string, unknown>;
  /** The operation and its input, as the definition built them. */
  command: { operation: AgentOperation; input: Record<string, unknown> };
}

/**
 * Carries out an agent's write at `level`. Refused: throws the gate's words. `outline_edit` at propose is one patch beside
 * the note; another write the gate proposes goes through applyWrite, which makes the patch or the comment. Applied, the
 * operation runs as it always has, unless `always` sends it through applyWrite too (a script's tools, whose answer reads
 * the same at every level).
 */
export async function agentWrite(client: AgentToolsClient, w: AgentWrite, actor: AgentActor, level: McpAccessLevel, o: { always?: boolean; where?: GateWhere } = {}): Promise<unknown> {
  const name = w.definition.name;
  const target = w.definition.target ?? "ref";
  const { [target]: ref, ...writeInput } = w.args;
  const top = name === "outline_create" && String(ref).trim() === "root";
  const decided = gate({ tool: name, level, top, ...(o.where ? { where: o.where } : {}) });
  if (decided.becomes === "refused") throw new WorkToolRefusal(decided.why!);
  if (name === "outline_edit" && decided.becomes !== "applied") {
    // The operation's own check first (ref and its aliases), as runAgentOperation makes it.
    const checked = checkToolArgs(AGENT_OPERATION_SPECS.edit!, w.command.input);
    if (!checked.ok) throw new WorkToolRefusal(checked.error);
    return editBlock(client, { ...(checked.args as unknown as EditInput), propose: true }, actor);
  }
  const viaApplyWrite = AGENT_TOOL_SURFACES[name]?.gateway === true && name !== "script_run" && (decided.becomes !== "applied" || o.always);
  if (!viaApplyWrite) return runAgentOperation(client, w.command.operation, w.command.input, actor);
  let blockId: string;
  if (name === "outline_reply" || name === "outline_resolve_thread") {
    const mark = await client.request<AnnotationRecord>({ action: "annotations.get", annotationId: String(writeInput.edit ?? writeInput.thread) });
    const subject = mark.originalTarget.representation.subject;
    if (subject.kind !== "block") throw new WorkToolRefusal(`${name} needs a note's thread`);
    blockId = subject.blockId;
  } else if (top) blockId = "root"; // the top level, as the tool and the CLI take it
  else blockId = (await resolveRef(client, String(ref))).id;
  const outcome = await applyWrite({
    request: (action, args) => client.request({ action, ...args } as Parameters<AgentToolsClient["request"]>[0]),
    info: () => client.requireCompatibleService(),
    comments: async id => (await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: id }, includeResolved: true } }))
      .map(t => ({ id: t.block.id, replies: t.replies.map(r => ({ id: r.block.id })) })),
    ...(o.where ? { address: o.where } : {}),
  }, { tool: name as McpWriteTool, blockId, input: writeInput, ...(typeof writeInput.revision === "number" ? { revision: writeInput.revision } : {}) },
  { level, actor, uri: id => `((${id}))` });
  return outcome.outcome === "proposed" ? outcome : outcome.detail;
}
