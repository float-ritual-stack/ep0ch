/**
 * The Pi extension's tools that name a block, checked once: the model sees `ref` (the one name for "which block or
 * note" on every agent surface), the tool's own handler keeps the argument name it always had, and a wrong call gets
 * the corrective error of @ep0ch/outline-core/tool-args instead of the validator's bare one. It runs as the tool's
 * `prepareArguments`, which Pi calls before its schema validation.
 */
import { checkToolArgs, type ToolSchema } from "@ep0ch/outline-core/tool-args";

export interface PiRefTool {
  /** The argument the handler reads the block from today (`blockId`, `viewId`, `address`). */
  inner: string;
  /** A call that works, with `ref`. */
  example: Record<string, unknown>;
}

/** `((id))`, `((id|label))` and `((id^fragment))` as the bare id these tools' service calls take; anything else as given. */
export function bareBlockRef(ref: string): string {
  const wrapped = /^\(\(([^|)^]+)(?:[|^][^)]*)?\)\)$/.exec(ref.trim());
  return wrapped ? wrapped[1]!.trim() : ref;
}

type ToolDefinitionLike = {
  name: string;
  parameters: any;
  execute: (...args: any[]) => any;
  prepareArguments?: (args: unknown) => any;
  description: string;
};

/** The model-facing schema: the handler's block argument renamed `ref`. */
function schemaWithRef(parameters: any, inner: string): any {
  const properties: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(parameters.properties ?? {})) {
    properties[name === inner ? "ref" : name] = name === inner ? { ...(schema as object), description: refDescription(schema as { description?: string }) } : schema;
  }
  const required = (parameters.required ?? []).map((name: string) => (name === inner ? "ref" : name));
  return { ...parameters, properties, ...(parameters.required ? { required } : {}) };
}

const refDescription = (schema: { description?: string }) =>
  `The block: its id or ((id))${schema.description ? `. ${schema.description}` : ""}`;

/** The tool with `ref` as its block argument. A definition without object parameters (a union) is returned as it is. */
export function withRefArgument<T extends ToolDefinitionLike>(definition: T, { inner, example }: PiRefTool): T {
  const parameters = definition.parameters;
  if (!parameters?.properties || !(inner in parameters.properties)) return definition;
  const shown = schemaWithRef(parameters, inner);
  const spec = { name: definition.name, schema: shown as ToolSchema, example, aliases: { ref: [inner] } };
  return {
    ...definition,
    parameters: shown,
    prepareArguments(args: unknown) {
      const checked = checkToolArgs(spec, args);
      if (!checked.ok) throw new Error(checked.error);
      return checked.args;
    },
    execute(toolCallId: string, params: Record<string, unknown>, ...rest: unknown[]) {
      const { ref, ...others } = params;
      return definition.execute(toolCallId, ref === undefined ? others : { ...others, [inner]: typeof ref === "string" ? bareBlockRef(ref) : ref }, ...rest);
    },
  };
}

/** Per tool: the argument it reads the block from, and a call that works. */
export const PI_REF_TOOLS: Readonly<Record<string, PiRefTool>> = {
  outliner_task: { inner: "address", example: { operation: "start", ref: "PIE-123" } },
  outliner_update: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", text: "Seed swap plan\n\nBorlotti only.", expectedRevision: 3 } },
  outliner_comment: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", expectedRevision: 3, comment: "Is this still true?" } },
  outliner_checklist_query: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" } },
  outliner_checklist_update: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", target: { itemId: "step-1" }, expectedEvidence: "- [ ] Bring labels", change: { kind: "ensure-id" } } },
  outliner_property_patch: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", expectedRevision: 3, operations: [] } },
  outliner_work_id: { inner: "blockId", example: { operation: "allocate", ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", expectedRevision: 3 } },
  outliner_move: { inner: "blockId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", parentId: "2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11", position: 0 } },
  outliner_view: { inner: "viewId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", limit: 50 } },
  outliner_branch_rank: { inner: "viewId", example: { ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", orderedBlockIds: ["2f6c1c0e-5b7a-4d61-9a43-7b0c8f0e1a11"] } },
  outliner_page: { inner: "blockId", example: { operation: "rename", address: "Seed Swap", ref: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" } },
};
