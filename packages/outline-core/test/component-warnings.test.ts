import { describe, expect, test } from "bun:test";
import { componentReading, nearestName } from "../src/component-warnings";
import { BUILTIN_COMPONENT_SCHEMAS } from "../src/component-schema";

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

describe("nearestName", () => {
  test("within two edits, one for a short name; never the name itself", () => {
    expect(nearestName("graph-stats", ["graph-stat", "graph-spark"])).toBe("graph-stat");
    expect(nearestName("titel", ["title", "items"])).toBe("title");
    expect(nearestName("lnk", ["link", "rows"])).toBe("link");
    expect(nearestName("abc", ["xyz"])).toBeUndefined();
    expect(nearestName("title", ["title"])).toBeUndefined();
  });
});
