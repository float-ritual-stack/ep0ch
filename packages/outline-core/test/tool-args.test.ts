import { expect, test } from "bun:test";
import { checkToolArgs, REF_ALIASES, sameReference, toolSchemaLine, type ToolArgsSpec } from "../src/tool-args";

const read: ToolArgsSpec = {
  name: "outline_read",
  schema: { type: "object", properties: { ref: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 6 }, mode: { type: "string", enum: ["full", "title"] } }, required: ["ref"] },
  example: { ref: "PIE-123", depth: 1 },
};
const error = (spec: ToolArgsSpec, input: unknown) => { const r = checkToolArgs(spec, input); if (r.ok) throw new Error("accepted"); return r.error; };

test("ref is accepted under every alias and renamed", () => {
  for (const alias of REF_ALIASES) expect(checkToolArgs(read, { [alias]: "PIE-1", depth: 2 })).toMatchObject({ ok: true, args: { ref: "PIE-1", depth: 2 }, renamed: [[alias, "ref"]] });
  expect(checkToolArgs(read, { ref: "PIE-1", tool: "x" })).toMatchObject({ ok: false });
  expect(checkToolArgs({ ...read, ignore: ["tool"] }, { ref: "PIE-1", tool: "x" })).toMatchObject({ ok: true, args: { ref: "PIE-1" } });
});

test("a tool's own aliases are added to the shared ones", () => {
  const stage: ToolArgsSpec = { name: "work_stage", schema: { properties: { ref: { type: "string" }, stage: { type: "string" } }, required: ["ref", "stage"] }, example: { ref: "PIE-1", stage: "doing" }, aliases: { ref: ["item"] } };
  expect(checkToolArgs(stage, { item: "PIE-1", stage: "doing" })).toMatchObject({ ok: true, args: { ref: "PIE-1", stage: "doing" } });
});

test("aliases that name different blocks are refused whichever way they are spelt, naming both; the same block is fine", () => {
  const conflict = error(read, { ref: "PIE-520", id: "PIE-588" });
  expect(conflict).toContain('`ref` is "PIE-520" but `id` is "PIE-588"');
  expect(conflict).toContain("pass one `ref`");
  expect(conflict).toContain('Example: outline_read {"ref":"PIE-123","depth":1}');
  expect(conflict).not.toContain("Missing required");
  expect(error(read, { block: "PIE-1", note: "PIE-2", reference: "PIE-1" })).toContain("Ambiguous");
  const id = "0f3c2a1b-1111-4222-8333-444455556666";
  for (const [a, b] of [[`((${id}))`, id], [`((${id}|label))`, id.toUpperCase()], [`ep0ch://garden@laptop/b/${id}`, id]]) expect(checkToolArgs(read, { ref: a, id: b }).ok).toBe(true);
  // A schema that also declares uri holds ref and uri to the same rule.
  const mcp: ToolArgsSpec = { name: "outline_read", schema: { properties: { uri: { type: "string" }, ref: { type: "string" } }, oneOf: [{ required: ["ref"] }, { required: ["uri"] }] }, example: { ref: "PIE-1" } };
  expect(error(mcp, { ref: id, uri: `ep0ch://garden@laptop/b/${"7a1e0c2d-2222-4333-8444-555566667777"}` })).toContain("Ambiguous");
  expect(checkToolArgs(mcp, { ref: id, uri: `ep0ch://garden@laptop/b/${id}` }).ok).toBe(true);
  expect(checkToolArgs(mcp, { id }).ok).toBe(true);
  expect(error(mcp, {})).toContain("Give one of `ref` or `uri`");
});

test("an unknown argument names the closest valid one, restates the arguments and gives the corrected call", () => {
  const typo = error(read, { refrence: "PIE-1" });
  expect(typo).toContain("`refrence` is not an argument of outline_read; did you mean `ref`?");
  expect(typo).toContain("Arguments: ref (string, required) · depth (integer 0-6) · mode (full|title)");
  expect(typo).toContain('Call it as: outline_read {"ref":"PIE-1"}');
  const odd = error(read, { title: "Seed plan" });
  expect(odd).toContain("the required `ref` is missing, so you probably meant `ref`");
  expect(error(read, { ref: "PIE-1", colour: "red" })).toContain("`colour` is not an argument of outline_read.");
  expect(error(read, { ref: "PIE-1", colour: "red" })).toContain('Example: outline_read {"ref":"PIE-123","depth":1}');
});

test("missing, mistyped and out-of-range values say the expected type; null satisfies a type that allows it", () => {
  expect(error(read, {})).toContain("Missing required `ref` (string)");
  expect(error(read, { ref: 5 })).toContain("`ref` must be string; got number 5");
  expect(error(read, { ref: "x", depth: 9 })).toContain("`depth` must be integer 0-6; got 9");
  expect(error(read, { ref: "x", depth: 1.5 })).toContain("`depth` must be integer 0-6; got number 1.5");
  expect(error(read, { ref: "x", mode: "tiny" })).toContain("`mode` must be one of full, title");
  expect(error(read, [])).toContain("a list");
  const move: ToolArgsSpec = { name: "move", schema: { properties: { ref: { type: "string" }, parentId: { type: ["string", "null"] } }, required: ["ref", "parentId"] }, example: { ref: "a", parentId: null } };
  expect(checkToolArgs(move, { ref: "a", parentId: null }).ok).toBe(true);
  expect(toolSchemaLine(move)).toBe("ref (string, required) · parentId (string|null, required)");
});

test("the same block id in two outlines is two blocks; a corrected call is offered only when it would pass", () => {
  const id = "0f3c2a1b-1111-4222-8333-444455556666";
  expect(sameReference(`ep0ch://garden@laptop/b/${id}`, `ep0ch://archive@server/b/${id}`)).toBe(false);
  expect(sameReference(`ep0ch://garden@laptop/b/${id}`, `((${id}))`)).toBe(true);
  const odd = error(read, { refe: 42 });
  expect(odd).not.toContain("Call it as");
  expect(odd).toContain('Example: outline_read {"ref":"PIE-123","depth":1}');
});

test("dropUnknown drops a name that is near none, and still answers a typo or a missing argument", () => {
  const lenient = { ...read, dropUnknown: true as const };
  expect(checkToolArgs(lenient, { ref: "PIE-1", agentId: "a1" })).toMatchObject({ ok: true, args: { ref: "PIE-1" } });
  expect(error(lenient, { refe: "PIE-1" })).toContain("did you mean `ref`?");
  expect(error(lenient, { agentId: "a1" })).toContain("Missing required `ref`");
});
