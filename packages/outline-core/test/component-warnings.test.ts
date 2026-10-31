import { describe, expect, test } from "bun:test";
import { blockNameOf, componentReading } from "../src/component-warnings";
import { BUILTIN_COMPONENT_SCHEMAS, mergeComponentSchemas, type ComponentSchema } from "../src/component-schema";
import { schemaOfScript } from "../src/script-component";

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

  test("a key quoted or in a flow map, and a value YAML reads as true or false, are read as the figure reads them", () => {
    const wrong = "the ::graph-table on line 2: density \"snug\" is one of compact, cozy, comfortable";
    expect(read("Garden", "::graph-table", "---", "\"density\": snug", "---", "::").warnings).toEqual([wrong]);
    expect(read("Garden", "::graph-table", "---", "{density: snug}", "---", "::").warnings).toEqual([wrong]);
    expect(read("Garden", "::graph-table", "---", "density: false", "---", "::").warnings).toEqual([wrong.replace("snug", "false")]);
    expect(read("Garden", "::graph-table", "---", "{\"titel\": beds}", "---", "::").warnings).toEqual(["the ::graph-table on line 2 doesn't take titel: did you mean title?"]);
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
    expect(blockNameOf(BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "view")!)).toBe("view");
    for (const id of ["callout", "table", "embed", "image"]) expect(blockNameOf(BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === id)!)).toBeNull();
    expect(blockNameOf(FORECAST)).toBe("forecast");
  });

  test("::views suggests the collection block; ::tables still has no block spelling", () => {
    expect(read("Garden", "::tables", "---", "---", "::")).toEqual({ components: [], warnings: [] });
    expect(read("Garden", "::views", "---", "---", "::").warnings).toContain("the ::views on line 2 isn't a component: did you mean ::view?");
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

// Note components: a render script's note is a component (script-component.ts), its `::name{…}` call read off its line.
describe("a note component's call", () => {
  const BOARD = schemaOfScript({
    name: "board", title: "Errand board", intro: "Lanes of what a query holds, one card per note.", blockId: "b0a7d000",
    fields: ["where query required", "group property default=status", "size choice small|large"],
    example: `::board{where="type=errand" group=status}`,
  }).schema!;
  const { schemas } = mergeComponentSchemas({ extensions: [{ id: "script-board", components: [BOARD], origin: BOARD.origin }] });
  const reading = (...lines: string[]) => componentReading(lines.join("\n"), schemas);

  test("a call that reads is confirmed, with nothing to say", () => {
    expect(reading("Errands", `::board{where="type=errand" group=owner}`)).toEqual({ components: ["board"], warnings: [] });
  });

  test("an attribute it doesn't take: the one it may mean, or the ones it takes", () => {
    expect(reading("Errands", `::board{where="type=errand" grup=owner}`).warnings).toEqual(["the ::board on line 2 doesn't take grup: did you mean group?"]);
    expect(reading("Errands", `::board{where="type=errand" colour=red}`).warnings).toEqual(["the ::board on line 2 doesn't take colour: it takes where, group, size"]);
  });

  test("a required prop left out is named, with the demo's value; one with a default is not", () => {
    expect(reading("Errands", `::board{group=owner}`).warnings).toEqual([`the ::board on line 2 needs where, like where="type=errand"`]);
    expect(reading("Errands", `::board{where="type=errand"}`).warnings).toEqual([]);
  });

  test("a value outside what its prop takes is checked; a {{ }} is the Site's to fill", () => {
    expect(reading("Errands", `::board{where="type=errand" size=huge}`).warnings).toEqual([`the ::board on line 2: size "huge" is one of small, large`]);
    expect(reading("Errands", `::board{where="type=errand" group="not a key"}`).warnings).toEqual([`the ::board on line 2: group "not a key" is a property's name`]);
    expect(reading("Errands", `::board{where="{{this.query}}" size="{{this.size}}"}`).warnings).toEqual([]);
  });

  test("a call in a code fence or a property literal is code shown, not a call", () => {
    expect(reading("Errands", "```", `::board{grup=owner}`, "```").warnings).toEqual([]);
  });

  test("an extension's or a built-in's components are left to the figure pass: the graph YAML warnings are unchanged", () => {
    expect(componentReading(["Plot", "::graph-stat", "---", "titel: the beds", "---", "::", `::board{where="type=errand"}`].join("\n"), schemas).warnings)
      .toEqual(["the ::graph-stat on line 2 doesn't take titel: did you mean title?"]);
  });
});
