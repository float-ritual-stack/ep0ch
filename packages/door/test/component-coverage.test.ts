// Every component the readers draw has a schema (PIE-701), so the library shows it and an agent's `outline_components`
// lists it. The names come from the readers' own registries (the figure kinds, the links components, the media line's
// attributes, the style tokens a box takes), never from the schemas, so a new kind that ships without a schema fails
// here, and the component library cannot lack it. Each schema is also drawn by the figure drawer as the library draws
// it: a variation that comes out as an error is a schema that lies about its component. Pure: no host.
import { describe, expect, test } from "bun:test";
import { BUILTIN_COMPONENT_SCHEMAS, componentBrief, componentSchemaProblem, sweep, variation } from "@ep0ch/outline-core/component-schema";
import { MEDIA_ATTRS } from "@ep0ch/outline-core/media-line";
import { STYLE_TOKEN_NAMES } from "@ep0ch/outline-core/style-cascade";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import { figureSource, GRAPH_KINDS, graphKind, renderGraph } from "../src/graphs";
import { LINK_BLOCK_KINDS } from "../src/links";
import { visible } from "../src/style";

const ids = new Set(BUILTIN_COMPONENT_SCHEMAS.map(s => s.id));
const schema = (id: string) => BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === id)!;

describe("a component without a schema fails here", () => {
  test("every ::graph-* kind the door draws, and every links component, has one", () => {
    const missing = [...GRAPH_KINDS.map(k => `graph-${k}`), ...LINK_BLOCK_KINDS].filter(id => !ids.has(id));
    expect(missing).toEqual([]);
  });

  test("the box documents its style tokens, the media line its attributes, and the forms a note writes are listed", () => {
    // `::box{…}` takes the style tokens; every property the schema names is a token the cascade knows.
    for (const p of schema("box").props) expect(STYLE_TOKEN_NAMES as readonly string[]).toContain(p.key);
    // The media line's attributes are documented between the picture's and the header image's schemas.
    const documented = new Set([...schema("image").props, ...schema("hero-image").props].map(p => p.key));
    expect(MEDIA_ATTRS.filter(a => !documented.has(a))).toEqual([]);
    for (const id of ["embed", "code-fence", "table", "callout", "heading-style", "rule"]) expect(ids.has(id)).toBe(true);
  });

  test("every built-in is a schema an extension could ship (the checker passes), once each", () => {
    expect(BUILTIN_COMPONENT_SCHEMAS.map(s => componentSchemaProblem(s)).filter(Boolean)).toEqual([]);
    expect(ids.size).toBe(BUILTIN_COMPONENT_SCHEMAS.length);
    // A brief for each, the way an agent reads it.
    for (const s of BUILTIN_COMPONENT_SCHEMAS) expect(componentBrief(s)).toContain(`## ${s.id}\n`);
  });
});

describe("a figure schema is drawn as the library draws it", () => {
  const figures = BUILTIN_COMPONENT_SCHEMAS.filter(s => s.id.startsWith("graph-"));
  test("the minimal example and every swept value draw as the figure, never as an error", () => {
    const bad: string[] = [];
    for (const s of figures) {
      const kind = s.id.slice("graph-".length);
      const all = [variation(s, {}), ...s.sweep.flatMap(axis => sweep(s, axis))];
      for (const v of all) {
        const block = componentBlocks(v.use.split("\n"))[0];
        if (!block || graphKind(block) !== kind) { bad.push(`${s.id}: ${JSON.stringify(v.use)} is not a ${s.id} block`); continue; }
        if (/^query:/m.test(v.use)) continue; // live: asked of the outline, which this test has none of
        const lines = v.use.split("\n").slice(block.start + 1, block.end);
        const drawn = renderGraph(kind, figureSource(lines), 80).map(visible).join("\n");
        if (/bad YAML|isn't drawn in the terminal|couldn't draw|is a map of props|asking the outline|no rows|no results/.test(drawn)) bad.push(`${s.id}: ${JSON.stringify(v.use)} draws\n${drawn}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
