import { describe, expect, test } from "bun:test";
import { blockNameOf, componentReading } from "../src/component-warnings";
import { BUILTIN_COMPONENT_SCHEMAS, mergeComponentSchemas, type ComponentSchema } from "../src/component-schema";

const read = (...lines: string[]) => componentReading(lines.join("\n"), BUILTIN_COMPONENT_SCHEMAS);
const STAT = ["::graph-stat", "---", "title: the beds", "items: [{ value: \"4\", label: raised }, { value: \"2\", label: bags }]", "---", "::"];

describe("what a written note's components will draw", () => {
  test("a figure that reads says only that it is there; each component once, in the order written", () => {
    expect(read("Garden", ...STAT, "", "::links", "---", "title: Links", "---", "::", ...STAT)).toEqual({ components: ["graph-stat", "links"], warnings: [] });
  });

  test("a figure's name with a typo: what it may mean, and nothing counted", () => {
    const r = read("Garden", "::graph-stats", "---", "title: x", "---", "::");
    expect(r.components).toEqual([]);
    expect(r.warnings).toEqual(["the ::graph-stats on line 2 isn't a component: did you mean ::graph-stat?"]);
  });

  test("a graph- name nothing is near says it is drawn as text; another ::name (an extension's own) says nothing", () => {
    expect(read("Garden", "::graph-sparkleplenty", "---", "---", "::").warnings).toEqual(["the ::graph-sparkleplenty on line 2 isn't a component (outline_components lists them); it is drawn as plain text"]);
    expect(read("Garden", "::forecast", "---", "days: 3", "---", "::")).toEqual({ components: [], warnings: [] });
  });

  test("YAML that doesn't read is said, as the figure would draw it", () => {
    const r = read("Garden", "::graph-stat", "---", "title: x", "items: [{ value: 1, label: a", "---", "::");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toStartWith("the ::graph-stat on line 2 doesn't draw: bad YAML");
  });

  test("a key the figure doesn't take, when it is a typo of one it does", () => {
    expect(read("Garden", "::graph-stat", "---", "titel: the beds", "items: [{ value: \"4\", label: raised }]", "---", "::").warnings)
      .toEqual(["the ::graph-stat on line 2 doesn't take titel: did you mean title?"]);
  });

  test("a live figure's own keys read clean; a typo in a tile's keys is said once, since that tile would draw static", () => {
    expect(read("Garden", "::graph-check", "---", "query: type=chore", "done: stage=done", "now: stage=doing", "---", "::",
      "::graph-meter", "---", "query: type=chore", "done: stage=done", "---", "::",
      "::graph-stat", "---", "items: [{ label: open, query: type=chore, accent: true }, { label: views, view: \"[[chores]]\" }]", "---", "::").warnings).toEqual([]);
    expect(read("Garden", "::graph-stat", "---", "items: [{ label: open, qeury: type=chore }, { label: shut, qeury: type=done }]", "---", "::").warnings)
      .toEqual(["the ::graph-stat on line 2: its items don't take qeury: did you mean query?"]);
    // Rows written as Markdown are the figure's own reading, never checked as YAML.
    expect(read("Garden", "::graph-stat", "---", "---", "- open: 4", "- **shut**: 2", "::").warnings).toEqual([]);
  });

  test("a value outside what a property takes", () => {
    const r = read("Garden", "::graph-table", "---", "title: beds", "query: type=bed", "density: snug", "---", "::");
    expect(r.components).toEqual(["graph-table"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toStartWith("the ::graph-table on line 2: density \"snug\" ");
  });

  test("a component written inside a code fence is the code's, never read", () => {
    expect(read("How to write one", "```markdown", "::graph-stats", "---", "titel: x", "---", "::", "```")).toEqual({ components: [], warnings: [] });
  });
});

describe("found by the name it's written with", () => {
  const FORECAST: ComponentSchema = {
    id: "ext-almanac-forecast", title: "Forecast", group: "almanac", intro: "Tomorrow's weather for the garden.", where: "a `::forecast` block",
    props: [{ key: "days", where: "yaml", type: "int", meaning: "how many days", min: 1, max: 7 }],
    source: { use: "::forecast\n---\n{{props.yaml}}---\n::" }, example: { days: "3" }, sweep: [], grids: [], space: [],
  };

  test("a component's ::name is the opener its own source writes; one written otherwise has none", () => {
    expect(blockNameOf(BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "graph-stat")!)).toBe("graph-stat");
    expect(blockNameOf(BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "box")!)).toBe("box");
    for (const id of ["callout", "table", "view", "embed", "image"]) expect(blockNameOf(BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === id)!)).toBeNull();
    expect(blockNameOf(FORECAST)).toBe("forecast");
  });

  test("::tables and ::views are no near miss of anything written with ::, so nothing is suggested", () => {
    expect(read("Garden", "::tables", "---", "---", "::")).toEqual({ components: [], warnings: [] });
    expect(read("Garden", "::views", "---", "---", "::")).toEqual({ components: [], warnings: [] });
  });

  test("an extension's component is counted by its own name", () => {
    const { schemas } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [FORECAST] }] });
    expect(componentReading(["Garden", "::forecast", "---", "days: 3", "---", "::"].join("\n"), schemas)).toEqual({ components: ["ext-almanac-forecast"], warnings: [] });
  });
});

describe("what isn't warned", () => {
  test("a figure without its --- lines is said once, by syntax-warnings, not here", () => {
    expect(read("Garden", "::graph-stat", "title: the beds", "::").warnings).toEqual([]);
  });

  test("a value's comment, quotes and {{ }} read as YAML reads them", () => {
    expect(read("Garden", "::graph-table", "---", "query: type=bed", "density: compact # tighter", "---", "::").warnings).toEqual([]);
    expect(read("Garden", "::graph-table", "---", "query: type=bed", "density: \"cozy\"", "---", "::").warnings).toEqual([]);
    expect(read("Garden", "::graph-table", "---", "query: type=bed", "density: \"{{props.density}}\"", "---", "::").warnings).toEqual([]);
  });
});
