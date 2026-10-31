import { describe, expect, test } from "bun:test";
import { agentGuide, componentIndex, GUIDE_NAMES } from "../src/agent-guide";
import { BUILTIN_COMPONENT_SCHEMAS, componentGist, mergeComponentSchemas, type ComponentSchema } from "../src/component-schema";

// A made-up extension's component, the shape `extension.json`'s `components` carries.
const WEATHER: ComponentSchema = {
  id: "ext-almanac-forecast",
  title: "Forecast",
  group: "almanac",
  intro: "Tomorrow's weather for the garden, drawn as a strip. It reads the almanac's own store.",
  where: "a `::forecast` block",
  props: [{ key: "days", where: "yaml", type: "int", meaning: "how many days" }],
  source: { use: "::forecast\n---\n{{props.yaml}}\n---\n::" },
  example: { days: "3" },
  sweep: [], grids: [], space: [],
};

describe("the agent guide", () => {
  test("lists every built-in component, one line each, under the group it names for itself", () => {
    const guide = agentGuide(BUILTIN_COMPONENT_SCHEMAS);
    for (const s of BUILTIN_COMPONENT_SCHEMAS) expect(guide).toContain(`\n- ${s.id}: `);
    const groups = [...new Set(BUILTIN_COMPONENT_SCHEMAS.map(s => s.group))];
    for (const g of groups) expect(guide).toContain(`\n### ${g}\n`);
    expect(guide).toContain(`## Components (${BUILTIN_COMPONENT_SCHEMAS.length} components)`);
  });

  test("marks a component live when it takes a query, itself or on each of its items, and not otherwise", () => {
    const index = componentIndex(BUILTIN_COMPONENT_SCHEMAS);
    expect(index).toMatch(/\n- graph-tabs: [^\n]* · live\n/);
    // A meter's `query:` and `done:`; a stat's and a kpi's tile, each counting its own `query:`.
    for (const id of ["graph-meter", "graph-stat", "graph-kpi"]) expect(index).toMatch(new RegExp(`\\n- ${id}: [^\\n]* · live\\n`));
    expect(index).toMatch(/\n- graph-annotate: [^\n]*\n/);
    expect(index).not.toMatch(/\n- graph-annotate: [^\n]* · live\n/);
  });

  test("an extension's component appears with its origin, counted, with nothing written for it here", () => {
    const { schemas, problems } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [WEATHER] }] });
    expect(problems).toEqual([]);
    const guide = agentGuide(schemas);
    expect(guide).toContain("### almanac\n- ext-almanac-forecast: Tomorrow's weather for the garden, drawn as a strip. (ext:almanac)");
    expect(guide).toContain(`(${schemas.length} components, 1 from extensions)`);
  });

  test("names only components that exist in its house lines", () => {
    const ids = new Set(BUILTIN_COMPONENT_SCHEMAS.map(s => s.id));
    for (const name of GUIDE_NAMES) expect(ids.has(name)).toBe(true);
    const guide = agentGuide(BUILTIN_COMPONENT_SCHEMAS);
    const house = guide.slice(0, guide.indexOf("## Components"));
    for (const named of house.match(/\bgraph-[a-z]+\b/g) ?? []) expect((GUIDE_NAMES as readonly string[]).includes(named)).toBe(true);
  });

  test("takes the surface's tool lines and a scope", () => {
    const guide = agentGuide(BUILTIN_COMPONENT_SCHEMAS, { tools: ["- Orient with outline_query."], scope: "each outline adds its own" });
    expect(guide).toContain("\n- Orient with outline_query.\n");
    expect(guide).toContain("components; each outline adds its own)");
  });

  test("names: each group's ids on one line, live and extension ones marked, small enough for an MCP server's instructions", () => {
    const { schemas } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [WEATHER] }] });
    const guide = agentGuide(schemas, { index: "names" });
    expect(guide).toMatch(/\n- figures: graph-meter \(live\), graph-spark, graph-stat \(live\), [^\n]*graph-tabs \(live\)[^\n]*\n/);
    expect(guide).toContain("\n- almanac: ext-almanac-forecast (ext:almanac)");
    for (const s of schemas) expect(guide).toContain(s.id);
    expect(agentGuide(BUILTIN_COMPONENT_SCHEMAS, { index: "names" }).length).toBeLessThan(3600);
  });

  test("stays small enough to ride in every session's context", () => {
    expect(agentGuide(BUILTIN_COMPONENT_SCHEMAS).length).toBeLessThan(7000);
  });
});

describe("componentGist", () => {
  const schema = (intro: string): ComponentSchema => ({ ...WEATHER, intro });

  test("keeps a short first sentence whole", () => {
    expect(componentGist(schema("Code with numbered callouts. Each marker is said under it."))).toBe("Code with numbered callouts.");
  });

  test("cuts a long one at its first clause past the start", () => {
    const long = "Big numbers with labels under them, tiles that wrap into rows when they don't fit: the counts a note wants at a glance and a little more.";
    expect(componentGist(schema(long))).toBe("Big numbers with labels under them, tiles that wrap into rows when they don't fit");
  });

  test("never cuts inside code, where a colon is the grammar's", () => {
    const view = "A saved view: a note whose `[query::]` gathers the blocks it holds for, sorted and limited, listed as its children wherever the note is.";
    expect(componentGist(schema(view))).toBe("A saved view: a note whose `[query::]` gathers the blocks it holds for, sorted and limited");
    for (const s of BUILTIN_COMPONENT_SCHEMAS) {
      const gist = componentGist(s);
      expect((gist.match(/`/g) ?? []).length % 2).toBe(0);
      const outside = gist.replace(/`[^`]*`/g, "");
      expect((outside.match(/\(/g) ?? []).length).toBe((outside.match(/\)/g) ?? []).length);
    }
  });

  test("cuts at a word with an ellipsis when there's no clause to cut at", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ") + ".";
    const gist = componentGist(schema(words), 60);
    expect(gist.endsWith("…")).toBe(true);
    expect(gist.length).toBeLessThanOrEqual(61);
    expect(gist).not.toContain("  ");
  });
});

describe("note components in the guide", () => {
  const STALE: ComponentSchema = {
    ...WEATHER, id: "stale", title: "Stale", group: "this outline's", intro: "Errands nobody touched this week.",
    props: [{ key: "where", where: "line", type: "query", meaning: "a query" }], source: { use: "::stale{}" }, example: {},
  };

  test("a render script's component is listed under \"from notes\" with the note it is written in, counted apart", () => {
    const { schemas, problems } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [WEATHER] }, { id: "script-stale", components: [STALE], origin: "note:((5a1e0000))" }] });
    expect(problems).toEqual([]);
    const guide = agentGuide(schemas);
    expect(guide).toContain("\n### from notes\n- stale: Errands nobody touched this week. · live (note:((5a1e0000)))");
    expect(guide).not.toContain("### this outline's");
    expect(guide).toContain(`(${schemas.length} components, 1 from extensions, 1 from notes)`);
    expect(guide.trimEnd().endsWith("(note:((5a1e0000)))")).toBe(true);
    expect(agentGuide(schemas, { index: "names" })).toContain("\n- from notes: stale (live) (note:((5a1e0000)))");
  });
});
