/**
 * What each `outliner agent <operation>` takes (the JSON on stdin or --json), as `checkToolArgs` needs it
 * (@ep0ch/outline-core/tool-args): `ref` for the note, its aliases accepted, and a wrong input answered with the
 * arguments and a call that works. Each operation's arguments are its tool's, from the one list of agent tool
 * definitions (@ep0ch/outline-core/agent-tool-definitions, PIE-720) that the Claude mod and the MCP gateway register.
 * `touch-file` is the mod's internal hook call and is not checked here.
 */
import { AGENT_TOOL_DEFINITIONS } from "@ep0ch/outline-core/agent-tool-definitions";
import type { ToolArgsSpec, ToolSchema } from "@ep0ch/outline-core/tool-args";

const str = { type: "string" } as const;
const revision = { type: "integer", minimum: 1, description: "The revision outline_read returned" } as const;
const THREAD = "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11";

/** A call as the CLI takes it: the input as JSON on `--json` (shell-quoted). */
const cliCall = (name: string, args: Record<string, unknown>) => `${name} --json '${JSON.stringify(args).replace(/'/g, "'\\''")}'`;

function spec(operation: string, properties: Record<string, ToolSchema>, required: readonly string[], example: Record<string, unknown>, aliases?: ToolArgsSpec["aliases"]): ToolArgsSpec {
  return { name: `outliner agent ${operation}`, schema: { type: "object", properties, required: [...required] }, example, callText: cliCall, ...(aliases ? { aliases } : {}) };
}

/** The writes that may become a proposal take `propose` (the MCP gateway's access setting decides it). */
const EXTRA: Readonly<Record<string, Record<string, ToolSchema>>> = { "set-property": { propose: { type: "boolean" } } };

/** The checked operations, keyed as the CLI names them. */
export const AGENT_OPERATION_SPECS: Readonly<Record<string, ToolArgsSpec>> = {
  ...Object.fromEntries(AGENT_TOOL_DEFINITIONS.map(d => [d.operation, spec(d.operation, { ...d.properties, ...EXTRA[d.operation] }, d.required, d.example, d.aliases)])),
  // The tidy pass's figure check (PIE-721): the notes under `under` that read as a figure, told once each with comment.
  "figure-fit": spec("figure-fit", { under: str, limit: { type: "integer", minimum: 1, maximum: 500 }, comment: { type: "boolean" } }, ["under"], { under: "[[Garden plans]]", comment: true }),
  // outline_reply is two operations: a reply in a thread here, and its `edit` the operation edit-comment below.
  reply: spec("reply", { thread: str, body: str, requestId: str }, ["thread", "body"], { thread: THREAD, body: "Yes, checked today." }),
  "edit-comment": spec("edit-comment", { mark: str, body: str, observed: str, revision }, ["mark", "body"], { mark: THREAD, observed: "Is this still true?", body: "Is this still true in May?" }),
};
