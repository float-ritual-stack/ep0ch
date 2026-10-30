import { expect, test } from "bun:test";
import { componentSchemaProblem, mergeComponentSchemas } from "../src/component-schema";
import { parseFormField } from "../src/form-fields";
import { noteOrigin, oneLineCalls, propSchemaOfField, schemaOfScript } from "../src/script-component";
import { syntaxWarnings } from "../src/syntax-warnings";

const board = {
  name: "board", title: "Errand board", intro: "Lanes of what a query holds, one card per note.", blockId: "0a1b2c3d",
  fields: ["where query required", "group property default=status"],
  example: `::board{where="type=errand" group=status}`,
};

test("form-field chips make the props: query completes as a query, required and default kept", () => {
  const { schema, problem } = schemaOfScript(board);
  expect(problem).toBeUndefined();
  expect(schema!.id).toBe("board");
  expect(schema!.origin).toBe("note:((0a1b2c3d))");
  expect(schema!.props).toEqual([
    { key: "where", where: "line", type: "query", complete: "query", meaning: "a query, in the saved views' grammar, required", required: true },
    { key: "group", where: "line", type: "property", meaning: "a property", default: "status" },
  ]);
  expect(schema!.example).toEqual({ where: "type=errand", group: "status" });
  expect(schema!.source.use).toBe(board.example);
  expect(componentSchemaProblem(schema)).toBeNull();
});

test("a field becomes a prop by its type", () => {
  const prop = (chip: string) => propSchemaOfField(parseFormField(chip) as never);
  expect(prop("who note").type).toBe("ref");
  expect(prop("mood choice good|meh default=good")).toMatchObject({ type: "enum", values: [{ value: "good", meaning: "good" }, { value: "meh", meaning: "meh" }], default: "good" });
  expect(prop("owner property:owner").type).toBe("property:owner");
  expect(prop("n number").type).toBe("text");
  expect(prop("t tag").type).toBe("text");
  expect(prop("w query").complete).toBe("query");
  expect(propSchemaOfField({ name: "x", type: "text" }, "a prop of t").meaning).toBe("a prop of t");
});

test("a note component may take no props; an extension's may not", () => {
  const { schema, problem } = schemaOfScript({ name: "open-count", title: "Open count", intro: "", fields: [], blockId: "feedbeef" });
  expect(problem).toBeUndefined();
  expect(schema!.props).toEqual([]);
  expect(schema!.intro).toBe("Open count");
  expect(schema!.source.use).toBe("::open-count{}");
  expect(componentSchemaProblem({ ...schema, origin: "ext:x" })).toBe("props is a list of 1 to 32 properties");
  expect(componentSchemaProblem({ ...schema, origin: undefined })).toBe("props is a list of 1 to 32 properties");
});

test("a bad slug is dropped with a problem, never a throw", () => {
  const out = schemaOfScript({ ...board, name: "Big_Board" });
  expect(out.schema).toBeUndefined();
  expect(out.problem).toMatch(/^script Big_Board: id is a slug/);
  // Even nonsense in: a problem out.
  expect(() => schemaOfScript(null as never)).not.toThrow();
  expect(schemaOfScript(null as never).problem).toMatch(/^script /);
});

test("unreadable chips and a name twice are left out; the example keeps only declared props", () => {
  const { schema } = schemaOfScript({ ...board, fields: ["where query", "where text", "mood choice", "x nope"], example: `::board{where="a b" grup=owner}` });
  expect(schema!.props.map(p => p.key)).toEqual(["where"]);
  expect(schema!.example).toEqual({ where: "a b" });
  // A demo line of another component isn't this one's example.
  expect(schemaOfScript({ ...board, example: "::stale{where=x}" }).schema!.source.use).toBe("::board{}");
});

test("a note's schema merges marked with its origin; a built-in's name is taken", () => {
  const { schema } = schemaOfScript(board);
  const callout = schemaOfScript({ ...board, name: "callout", blockId: "11111111" }).schema!;
  const { schemas, problems } = mergeComponentSchemas({ extensions: [
    { id: "s-board", components: [schema!], origin: noteOrigin("0a1b2c3d") },
    { id: "s-callout", components: [callout], origin: noteOrigin("11111111") },
  ] });
  expect(schemas.find(s => s.id === "board")!.origin).toBe("note:((0a1b2c3d))");
  expect(problems).toEqual(["extension s-callout: component callout is a built-in's already; give it another id"]);
});

test("oneLineCalls: braces on a line of their own, outside fences and property literals, never ::use", () => {
  const text = [
    "Daily [type::day]",
    `::board{where="type=errand parent:[[errands]]" group=owner} ^b1`,
    "  ::board{}",
    "::board",
    "::board where=x",
    "::stale{}",
    "::use{of=[[t]]}",
    "```",
    "::board{where=inside}",
    "```",
    "    text ::board{x=1}",
    "~~~js",
    "::board{}",
    "~~~",
  ].join("\n");
  const calls = oneLineCalls(text, new Set(["board", "use"]));
  expect(calls.map(c => [c.name, c.line, c.attrs, c.id])).toEqual([
    ["board", 1, [{ key: "where", value: "type=errand parent:[[errands]]" }, { key: "group", value: "owner" }], "b1"],
    ["board", 2, [], undefined],
  ]);
  const first = calls[0]!;
  expect(text.slice(first.start, first.start + 8)).toBe("::board{");
  expect(text.slice(first.start, first.end)).toBe(`::board{where="type=errand parent:[[errands]]" group=owner} ^b1`);
  expect(oneLineCalls(text, new Set())).toEqual([]);
  expect(oneLineCalls("::board{}", new Set(["board"])).length).toBe(1);
});

test("oneLineCalls: a call inside a literal region is text", () => {
  const text = ["Notes", "<!-- literal -->", "::board{}", "<!-- /literal -->", "::board{x=1}"].join("\n");
  expect(oneLineCalls(text, new Set(["board"])).map(c => c.line)).toEqual([4]);
});

test("a one-line ::name{} call is a note component's, not an unclosed block; a built-in's still is", () => {
  const unclosed = (text: string) => syntaxWarnings(text).filter(w => w.kind === "component").map(w => w.message);
  expect(unclosed(`Errands today\n::board{where="type=errand" group=status}\nafter`)).toEqual([]);
  expect(unclosed(`Errands today\n::graph-table{query="type=errand"}\nafter`)).toEqual(["the ::graph-table on line 2 isn't closed with :: on a line of its own: it's plain text"]);
});
