// A figure's answered props as catalogue primitives: every node a primitive of the catalogue, with only its fields.
import { expect, test } from "bun:test";
import { FIGURE_PRIMITIVES, figurePrimitive } from "../src/figure-primitive";
import { FIGURE_MARKDOWN } from "../src/figure-props";
import { parseFigureMarkdown } from "../src/figure-markdown";
import { PRIMITIVE_FIELDS, PRIMITIVE_TYPES, type Primitive } from "../src/primitive";

/** Every node of a view, checked against the catalogue's field lists. */
function check(node: Primitive, seen: string[] = []): string[] {
  expect(PRIMITIVE_TYPES).toContain(node.type);
  for (const key of Object.keys(node)) if (key !== "type") expect(PRIMITIVE_FIELDS[node.type] as readonly string[]).toContain(key);
  seen.push(node.type);
  if ("children" in node) for (const child of node.children ?? []) check(child, seen);
  return seen;
}
const rows = (kind: string, ...lines: string[]) => FIGURE_MARKDOWN[kind]!(parseFigureMarkdown(lines), {});

test("each kind with a primitive form draws its written rows as catalogue primitives", () => {
  const written: Record<string, ReturnType<typeof rows>> = {
    stat: rows("stat", "- beds: 4", "- **sown**: 3"),
    meter: { ...rows("meter", "- north: 3", "- south: 7"), limit: 10 },
    rank: rows("rank", "- beans: 12", "- **peas**: 9", "- *kale*: 2"),
    spark: rows("spark", "2 0 5 11 3"),
    check: rows("check", "- [x] dig the bed", "- [ ] sow the peas — after the frost"),
    timeline: rows("timeline", "- 2031-03: sow", "- 2031-06: **pick**"),
    decision: rows("decision", "- **raised beds** — drains well", "- *pots* — dry out", "", "Decided in spring."),
    chat: rows("chat", "- Ada: who waters?", "- Bo: me"),
    keys: rows("keys", "- ctrl+k: open the bar"),
    props: rows("props", "- **bed**: north, south · north — which bed"),
    example: rows("example", "- `note.new text=Peas` → makes a note (safe)"),
    compare: { ...rows("compare", "- peas: early | tall", "- **beans**: late | taller"), columns: ["sown", "height"] },
    table: { headers: ["Bed", "Sown"], rows: [["North", "peas"], ["South", "beans"]], blocks: ["a1", null] },
    tabs: { tabs: [{ value: "todo", count: 2, headers: ["Chore"], rows: [["dig"], ["sow"]] }, { value: "done", count: 0, rows: [] }] },
    annotate: { code: "sow(peas)", lang: "js", notes: ["the call"] },
    matrix: rows("matrix", "- north: peas=3 kale=1", "- south: beans=4"),
    tree: { nodes: [{ label: "garden", children: [{ label: "beds", meta: 4 }, { label: "shed", accent: true }] }] },
  };
  expect(Object.keys(written).sort()).toEqual(Object.keys(FIGURE_PRIMITIVES).sort());
  for (const [kind, props] of Object.entries(written)) {
    const view = figurePrimitive(kind, props);
    expect(view, kind).not.toBeNull();
    check(view!);
    // With nothing to draw yet it says so, and never an empty frame.
    expect(figurePrimitive(kind, {}), kind).toBeNull();
  }
  expect(figurePrimitive("stat", written.stat!)).toEqual({ type: "row", children: [{ type: "stat", label: "beds", value: "4" }, { type: "stat", label: "sown", value: "3", tone: "accent" }] });
  expect(figurePrimitive("meter", written.meter!)).toMatchObject({ children: [{ type: "bar", label: "north", value: 3, max: 10 }, { type: "bar", value: 7 }] });
  expect(figurePrimitive("meter", { title: "Water butt", value: 0.6 })).toEqual({ type: "bar", label: "Water butt", value: 0.6, max: 1 });
  expect(figurePrimitive("matrix", written.matrix!)).toEqual({ type: "table", columns: ["", "peas", "kale", "beans"], rows: [["north", 3, 1, ""], ["south", "", "", 4]] });
  expect(figurePrimitive("tree", written.tree!)).toEqual({ type: "stack", children: [{ type: "text", text: "garden" }, { type: "text", text: "    └ beds · 4" }, { type: "text", text: "    └ shed", tone: "accent" }] });
  expect(figurePrimitive("check", written.check!)).toEqual({ type: "checklist", items: [{ label: "dig the bed", done: true }, { label: "sow the peas — after the frost", done: false }] });
  expect(figurePrimitive("table", written.table!)).toEqual({ type: "table", columns: ["Bed", "Sown"], rows: [["North", "peas"], ["South", "beans"]], links: ["a1", null] });
});

test("a kind with no primitive form says so", () => {
  expect(figurePrimitive("quadrant", { points: [{ label: "peas", x: "1", y: "2" }] })).toBeNull();
  expect(figurePrimitive("nothing-is-called-this", {})).toBeNull();
});
