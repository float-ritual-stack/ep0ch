/**
 * What each `outliner agent <operation>` takes (the JSON on stdin or --json), as `checkToolArgs` needs it
 * (@ep0ch/outline-core/tool-args): `ref` for the note, its aliases accepted, and a wrong input answered with the
 * arguments and a call that works. The Claude mod's `outline_*` tools and the Pi extension send these operations; the
 * mod checks its own tool input first (its tools' schemas), so this is the CLI's own check for a person or script.
 * `touch-file` is the mod's internal hook call and is not checked here.
 */
import type { ToolArgsSpec, ToolSchema } from "@ep0ch/outline-core/tool-args";

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const ref = { type: "string", description: "The note: its id, ((id)), [[page]] or a Work ID (PIE-123)" } as const;
const revision = { type: "integer", minimum: 1, description: "The revision outline_read returned" } as const;
const NOTE = "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34";
const THREAD = "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11";

/** A call as the CLI takes it: the input as JSON on `--json` (shell-quoted). */
const cliCall = (name: string, args: Record<string, unknown>) => `${name} --json '${JSON.stringify(args).replace(/'/g, "'\\''")}'`;

function spec(name: string, properties: Record<string, ToolSchema>, required: string[], example: Record<string, unknown>, aliases?: ToolArgsSpec["aliases"]): ToolArgsSpec {
  return { name: `outliner agent ${name}`, schema: { type: "object", properties, required }, example, callText: cliCall, ...(aliases ? { aliases } : {}) };
}

/** The checked operations, keyed as the CLI names them. */
export const AGENT_OPERATION_SPECS: Readonly<Record<string, ToolArgsSpec>> = {
  read: spec("read", { ref, depth: int, limit: int }, ["ref"], { ref: "PIE-123", depth: 1 }),
  find: spec("find", { text: str, property: str, hasKey: str, query: str, view: str, under: str, limit: int }, [], { text: "seed swap" }),
  resolve: spec("resolve", { ref }, ["ref"], { ref: "[[Seed Swap]]" }),
  edit: spec("edit", { ref, expectedRevision: revision, text: str, replaceSection: { type: "object" }, append: str, allowStructural: bool }, ["ref", "expectedRevision"], { ref: "PIE-123", expectedRevision: 3, append: "One more line." }),
  create: spec("create", { parent: str, text: str, position: int }, ["parent", "text"], { parent: "PIE-123", text: "Bring labels" }),
  comment: spec("comment", { ref, body: str, quote: str, whole: bool, start: int, prefix: str, suffix: str, requestId: str, from: str, revision }, ["ref", "body"], { ref: "PIE-123", body: "Is this still true?", whole: true }),
  reply: spec("reply", { thread: str, body: str, requestId: str }, ["thread", "body"], { thread: THREAD, body: "Yes, checked today." }),
  "resolve-thread": spec("resolve-thread", { thread: str, resolved: bool }, ["thread", "resolved"], { thread: THREAD, resolved: true }),
  changes: spec("changes", { since: { type: ["string", "integer"] }, author: str, actor: str, limit: int, before: int }, ["since"], { since: "2026-03-01T09:00:00Z" }),
  patch: spec("patch", { ref, revision, patches: { type: "array", items: { type: "object" } }, mark: str, policy: str, allowStructural: bool, propose: {} }, ["ref", "revision", "patches"],
    { ref: "PIE-123", revision: 3, patches: [{ observed: "Borlotti", replacement: "Borlotti only" }] }),
  "set-property": spec("set-property", { ref, key: str, value: str, revision, propose: {} }, ["ref", "key", "value", "revision"], { ref: "PIE-123", key: "status", value: "open", revision: 3 }),
  "assign-id": spec("assign-id", { ref, revision }, ["ref", "revision"], { ref: NOTE, revision: 3 }),
  "view-order": spec("view-order", { ref: { ...ref, description: "The view (a virtual-branch block)" }, ids: { type: "array", items: str } }, ["ref"], { ref: `((${NOTE}))`, ids: ["PIE-123", "PIE-124"] }, { ref: ["view"] }),
};
