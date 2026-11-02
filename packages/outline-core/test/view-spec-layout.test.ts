// PIE-1513: a live ::graph-table's layout reaches the collection renderer; a key it doesn't take is said, never silent.
import { describe, expect, test } from "bun:test";
import { componentBlocks } from "../src/component-block";
import { componentReading } from "../src/component-warnings";
import { BUILTIN_COMPONENT_SCHEMAS, VIEW } from "../src/component-schema";
import { figureProps, figureSource, unknownFigureKeys } from "../src/figure-props";
import { viewSpec } from "../src/view-spec";

const spec = (...lines: string[]) => { const block = componentBlocks(lines)[0]!; return viewSpec(block, lines); };

describe("a live graph-table's layout (PIE-1513)", () => {
  test("layout is read from the YAML and defaults to table", () => {
    expect(spec("::graph-table", "---", "query: type=bed", "layout: feed", "---", "::")!.props.layout).toBe("feed");
    expect(spec("::graph-table", "---", "query: type=bed", "---", "::")!.props.layout).toBe("table");
    expect(spec('::graph-table{query="type=bed" layout=board}', "::")!.props.layout).toBe("board");
  });
  test("columns still become the view's summary-properties", () => {
    expect(spec("::graph-table", "---", "query: type=bed", "columns: [title, owner]", "---", "::")!.props["summary-properties"]).toEqual(["title", "owner"]);
  });
  test("a key the table doesn't take is said with the one it may mean, or the keys it takes", () => {
    expect(spec("::graph-table", "---", "query: type=bed", "layot: feed", "---", "::")!.warning).toBe("doesn't take layot: did you mean layout?");
    expect(spec("::graph-table", "---", "query: type=bed", "---", "::")!.warning).toBeUndefined();
    expect(unknownFigureKeys("table", { query: "type=bed", colour: "red" })[0]).toMatch(/^doesn't take colour: it takes title, headers, .*layout, columns/);
    expect(unknownFigureKeys("table", { query: "type=bed", rows: "children" })).toEqual([]);
    expect(unknownFigureKeys("forecast", { rain: 3 })).toEqual([]);
  });
  test("the write's warning and the static reader's say the same sentence", () => {
    const r = componentReading("Garden\n::graph-table\n---\nquery: type=bed\ncolour: red\n---\n::", BUILTIN_COMPONENT_SCHEMAS);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toStartWith("the ::graph-table on line 2 doesn't take colour: it takes title");
    const read = figureProps("rank", figureSource(["---", "items: [{ label: a, value: 1 }]", "colour: red", "---"]));
    expect("warning" in read && read.warning).toStartWith("this ::graph-rank doesn't take colour: it takes title");
  });
  test("graph-table's layout is the view's one definition: several layouts are tabs over one source (PIE-1513 finding)", () => {
    const table = BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "graph-table")!.props.find(p => p.key === "layout")!;
    const view = VIEW.props.find(p => p.key === "layout")!;
    expect({ ...table, where: "note" }).toEqual(view);
    expect(table.where).toBe("yaml");
    expect(table.question).toEqual({ type: "toggle" });
    expect(spec("::graph-table", "---", "query: type=bed", 'layout: "table, feed"', "---", "::")!.props.layout).toBe("table, feed");
    expect(componentReading('Garden\n::graph-table\n---\nquery: type=bed\nlayout: "table, feed"\n---\n::', BUILTIN_COMPONENT_SCHEMAS).warnings).toEqual([]);
    expect(componentReading("Garden\n::graph-table\n---\nquery: type=bed\nlayout: [table, feed]\n---\n::", BUILTIN_COMPONENT_SCHEMAS).warnings).toEqual([]);
    expect(componentReading("Garden\n::graph-table\n---\nquery: type=bed\nlayout: table, cards\n---\n::", BUILTIN_COMPONENT_SCHEMAS).warnings[0]).toContain('layout "cards" is one of table, gallery, feed, board');
  });
});
