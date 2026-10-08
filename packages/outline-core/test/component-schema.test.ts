import { expect, test } from "bun:test";
import {
  axisValues, BUILTIN_COMPONENT_SCHEMAS, checkValue, componentBrief, componentBriefs, componentPageMarkdown, componentSchemaProblem, grid, keyCandidates, mergeComponentSchemas,
  propertyAtCursor, spaceSize, spaceVariations, sweep, valueCandidates, variation, variationText, yamlAtCursor, yamlKeyCandidates, type ComponentSchema,
} from "../src/component-schema";
import { BAND_ALIGNS, BAND_LETTERS, BAND_PATTERNS, BAND_ROWS, BUILTIN_HEADING_STYLES, HEADING_FIELD_KEYS, headingStylesFromBlocks } from "../src/heading-styles";
import { BUILT_IN_DECORATIONS, PLACES, RULE_TONES, RULE_KEYS } from "../src/rules";
import { BUILTIN_CALLOUTS, CALLOUT_TONES, calloutTypesFromBlocks } from "../src/callouts";

const schema = (id: string) => BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === id)!;
const values = (id: string, key: string) => axisValues(schema(id).props.find(p => p.key === key)!);

test("the built-ins say the lists the code reads, never a copy that drifts", () => {
  expect(values("heading-style", "heading-pattern")).toEqual([...BAND_PATTERNS]);
  expect(values("heading-style", "heading-align")).toEqual([...BAND_ALIGNS]);
  expect(values("heading-style", "heading-row")).toEqual([...BAND_ROWS]);
  expect(values("heading-style", "heading-letters")).toEqual([...BAND_LETTERS]);
  expect(values("heading-style", "heading-tone")).toEqual([...CALLOUT_TONES]);
  expect(values("heading-style", "heading")).toEqual(BUILTIN_HEADING_STYLES.map(s => s.name));
  expect(values("callout", "callout")).toEqual(BUILTIN_CALLOUTS.map(t => t.name));
  expect(values("callout", "callout-tone")).toEqual([...CALLOUT_TONES]);
  expect(values("rule", "rule-decorate")).toEqual([...BUILT_IN_DECORATIONS]);
  expect(values("rule", "rule-place")).toEqual([...PLACES]);
  expect(values("rule", "rule-tone")).toEqual([...RULE_TONES]);
  expect(values("rule", "rule-pattern")).toEqual([...BAND_PATTERNS]);
  expect(values("rule", "rule-align")).toEqual([...BAND_ALIGNS]);
  expect(schema("rule").props.map(p => p.key).sort()).toEqual([...RULE_KEYS].sort());
  for (const k of HEADING_FIELD_KEYS) expect(schema("heading-style").props.map(p => p.key)).toContain(k);
  // Every heading-* key the declaration reads is in the schema.
  const read = headingStylesFromBlocks([{ id: "aaaaaaaa", properties: schema("heading-style").props.filter(p => p.where === "note").map(p => ({ key: p.key, value: p.key === "heading-style" ? "x" : axisValues(p)[0] ?? "1" })) }]);
  expect(read.problems).toEqual([]);
  for (const s of BUILTIN_COMPONENT_SCHEMAS) expect(componentSchemaProblem(s)).toBeNull();
});

test("heading styles: 5 × 3 × 3 × 3 × 6 × 3 = 2430 combinations, walked a page at a time, never built whole", () => {
  const s = schema("heading-style");
  expect(spaceSize(s)).toEqual({ all: 2430, matching: 2430 });
  expect(spaceSize(s, { "heading-pattern": ["waffle"], "heading-tone": ["amber", "green"] })).toEqual({ all: 2430, matching: 162 });
  const page = spaceVariations(s, { "heading-pattern": ["waffle"], "heading-align": ["left"], "heading-row": ["top"], "heading-letters": ["upper"], "heading-tone": ["amber"] });
  expect(page.map(v => v.values["heading-rows"])).toEqual(["1", "2", "3"]);
  expect(page[0]!.note).toBe("My style [heading-style::mine] [heading-pattern::waffle] [heading-rows::1] [heading-align::left] [heading-row::top] [heading-tone::amber] [heading-letters::upper]");
  expect(page[0]!.use).toBe("## Your calls [heading::mine]");
  expect(spaceVariations(s, {}, 2428, 12)).toHaveLength(2);
});

test("a variation's source: the line alone, or the declaring note and the line that names it; an axis's own use; YAML", () => {
  const h = schema("heading-style");
  expect(variation(h, {})).toEqual({ values: { heading: "band" }, use: "## Your calls [heading::band]" });
  expect(variationText(variation(h, { "heading-pattern": "dots" }))).toBe("My style [heading-style::mine] [heading-pattern::dots]\n\n## Your calls [heading::mine]");
  expect(sweep(h, "rule").map(v => v.use)[6]).toBe("Before the break\n\n--- [rule::fade]\n\nAfter it");
  expect(sweep(h, "heading-default")[2]).toMatchObject({ note: "My style [heading-style::mine] [heading-default::rule]", use: "## Your calls\n\n---" });
  const c = schema("callout");
  expect(variation(c, {}).use).toBe("> [!tip]\n> Water the beds before nine.");
  expect(variation(c, { fold: "-" }).use).toBe("> [!tip]-\n> Water the beds before nine.");
  expect(variation(c, { "callout-tone": "green" })).toMatchObject({ note: "My type [callout-type::mine] [callout-tone::green]", use: "> [!mine]\n> Water the beds before nine." });
  // Naming the declared style outright writes its note under that name, and the line names it.
  expect(variation(h, { "heading-style": "plot" })).toMatchObject({ note: "My style [heading-style::plot]", use: "## Your calls [heading::plot]" });
  expect(variation(h, { "heading-style": "plot", "heading-pattern": "dots" }).note).toBe("My style [heading-style::plot] [heading-pattern::dots]");
  expect(variation(schema("graph-meter"), { limit: "1", caption: "the shared disk" }).use).toBe("::graph-meter\n---\ntitle: Disk\nvalue: 0.6\nlimit: 1\ncaption: the shared disk\n---\n::");
  // A rule's note is written always: it's what declares the rule.
  expect(variation(schema("rule"), {}).note).toBe("Meeting card [rule-name::meeting] [rule-kind::heading:2] [rule-decorate::band] [rule-fields::when, who]");
  expect(grid(h, "heading-pattern", "heading-align").rows.map(r => [r.value, r.cells.length])).toEqual(BAND_PATTERNS.map(p => [p, 3]));
});

test("the outline's own values join the lists; an extension's schemas come after, marked as its", () => {
  const { styles } = headingStylesFromBlocks([{ id: "11111111-plot", properties: [{ key: "heading-style", value: "plot" }, { key: "heading-pattern", value: "dots" }] }, { id: "22222222-band", properties: [{ key: "heading-style", value: "band" }] }]);
  const { types } = calloutTypesFromBlocks([{ id: "33333333-recipe", properties: [{ key: "callout-type", value: "recipe" }, { key: "callout-icon", value: "♨" }] }]);
  const ext: ComponentSchema = { ...schema("graph-spark"), id: "mood", title: "Mood", origin: undefined };
  const clash: ComponentSchema = { ...ext, id: "callout" };
  const withSource: ComponentSchema = { ...ext, id: "mood-style", props: [...ext.props, { key: "mood-heading", where: "line", type: "enum", meaning: "a style", valuesFrom: "heading-styles", values: [] }] };
  const { schemas: merged, problems } = mergeComponentSchemas({ headingStyles: styles, calloutTypes: types, extensions: [{ id: "moods", components: [ext, clash, withSource] }] });
  // An id that's taken is left out and said; an extension's valuesFrom list is filled as a built-in's is.
  expect(problems).toEqual(["extension moods: component callout is a built-in's already; give it another id"]);
  expect(merged.filter(s => s.id === "callout")).toHaveLength(1);
  expect(merged.at(-1)!.props.at(-1)!.values!.map(v => v.value)).toEqual(["plot", "band"]);
  const heading = merged.find(s => s.id === "heading-style")!.props.find(p => p.key === "heading")!;
  expect(heading.values!.map(v => v.value)).toEqual([...BUILTIN_HEADING_STYLES.map(s => s.name), "plot"]);
  expect(heading.values!.find(v => v.value === "plot")).toMatchObject({ declared: "11111111-plot", meaning: expect.stringContaining("this outline's") });
  expect(heading.values!.find(v => v.value === "band")!.meaning).toContain("restyled by this outline");
  expect(merged.find(s => s.id === "rule")!.props.find(p => p.key === "rule-style")!.values!.map(v => v.value)).toContain("plot");
  expect(merged.find(s => s.id === "callout")!.props[0]!.values!.at(-1)).toMatchObject({ value: "recipe", declared: "33333333-recipe" });
  expect(merged.at(-2)).toMatchObject({ id: "mood", origin: "ext:moods" });
  // The built-ins aren't changed by a merge.
  expect(schema("heading-style").props[0]!.values!.map(v => v.value)).not.toContain("plot");
});

test("an extension's schema is checked, each problem naming its field", () => {
  const good = { id: "mood", title: "Mood", intro: "How it went.", where: "on a note", props: [{ key: "mood", where: "line", type: "enum", meaning: "how it went", values: [{ value: "calm", meaning: "fine" }] }], source: { use: "Standup [mood::{mood}]" }, example: { mood: "calm" }, sweep: ["mood"], grids: [], space: ["mood"] };
  expect(componentSchemaProblem(good)).toBeNull();
  expect(componentSchemaProblem({ ...good, id: "Mood" })).toContain("id is a slug");
  expect(componentSchemaProblem({ ...good, props: [{ ...good.props[0], type: "enum", values: undefined }] })).toBe("props/0 is an enum: give its values");
  expect(componentSchemaProblem({ ...good, sweep: ["nope"] })).toBe("sweep is a list of its props' keys");
  expect(componentSchemaProblem({ ...good, example: { nope: "x" } })).toBe("example names nope, which props doesn't declare");
  expect(componentSchemaProblem({ ...good, source: { use: "x", note: { title: "t", name: "other", value: "v" } } })).toContain("source/note");
});

test("checkValue: an enum's values, an int's range, levels and room (what PIE-522's linter can ask)", () => {
  const p = (key: string) => schema("heading-style").props.find(x => x.key === key)!;
  expect(checkValue(p("heading-pattern"), "waffle")).toBeNull();
  expect(checkValue(p("heading-pattern"), "plaid")).toBe('heading-pattern "plaid" is one of stack, waffle, uptime, dots, rule');
  expect(checkValue(p("heading-rows"), "4")).toBe('heading-rows "4" is a whole number from 1 to 3');
  expect(checkValue(p("heading-default"), "1, rule")).toBeNull();
  expect(checkValue(p("heading-default"), "7")).toContain("levels");
  expect(checkValue(p("heading-padding"), "1 4")).toBeNull();
});

test("propertyAtCursor: a key being typed after [, a value after ::, never [[ or [! or a closed one", () => {
  expect(propertyAtCursor("## Calls [head", 14)).toEqual({ kind: "key", start: 9, end: 14, query: "head" });
  expect(propertyAtCursor("## Calls [head::band]", 13)).toEqual({ kind: "key", start: 9, end: 16, query: "hea" });
  expect(propertyAtCursor("## Calls [heading-pattern::wa", 29)).toEqual({ kind: "value", key: "heading-pattern", start: 27, end: 29, query: "wa" });
  expect(propertyAtCursor("[heading::ba] more", 12)).toEqual({ kind: "value", key: "heading", start: 10, end: 13, query: "ba" });
  expect(propertyAtCursor("see [[page", 10)).toBeNull();
  expect(propertyAtCursor("> [!wa", 6)).toBeNull();
  expect(propertyAtCursor("a [", 3)).toBeNull();
  expect(propertyAtCursor("[heading::band] then", 20)).toBeNull();
  // A value with no ] yet: a choice replaces the rest of the word the cursor is in.
  expect(propertyAtCursor("[heading::band and", 11)).toEqual({ kind: "value", key: "heading", start: 10, end: 14, query: "b" });
  // A link's text and a code span are never properties.
  expect(propertyAtCursor("see [heading](#beds)", 9)).toBeNull();
  expect(propertyAtCursor("see [head]", 9)).toBeNull();
  expect(propertyAtCursor("write `[head` like so", 12)).toBeNull();
});

test("yamlAtCursor: a key or value inside a component's YAML, closed or still being written; nothing outside it", () => {
  const lines = ["Note", "::graph-meter", "---", "ti", "value: 0.", "---", "after", "::"];
  expect(yamlAtCursor(lines, 3, 2)).toEqual({ kind: "key", component: "graph-meter", start: 0, end: 2, query: "ti" });
  expect(yamlAtCursor(lines, 4, 9)).toEqual({ kind: "value", component: "graph-meter", key: "value", start: 7, end: 9, query: "0." });
  expect(yamlAtCursor(lines, 6, 3)).toBeNull();
  expect(yamlAtCursor(["::graph-meter", "---", "title: Disk"], 2, 2)).toEqual({ kind: "key", component: "graph-meter", start: 0, end: 7, query: "ti" });
  expect(yamlAtCursor(["::graph-spark", "---", "da"], 2, 2)).toMatchObject({ kind: "key", component: "graph-spark", query: "da" });
  expect(yamlAtCursor(["plain", "---", "da"], 2, 2)).toBeNull();
  // A figure written as an example in a code fence is the fence's text.
  expect(yamlAtCursor(["```", "::graph-spark", "---", "da"], 3, 2)).toBeNull();
});

test("candidates: keys with their meaning, written [key::; values with theirs; YAML keys by the figure's schema", () => {
  const all = BUILTIN_COMPONENT_SCHEMAS;
  const keys = keyCandidates(all, "heading-p");
  expect(keys.map(k => k.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
  expect(keys[0]!.detail).toContain("Heading styles · on the declaring note");
  // A key written another way (a callout's type) and a YAML key are never offered after [.
  expect(keyCandidates(all, "callout").map(k => k.label)).toEqual(["callout-type", "callout-icon", "callout-tone", "callout-title", "callout-aliases"]);
  expect(keyCandidates(all, "valu")).toEqual([]);
  expect(valueCandidates(all, "heading-pattern", "w").map(v => v.insertion)).toEqual(["waffle]"]);
  expect(valueCandidates(all, "heading-rows", "").map(v => v.label)).toEqual(["1", "2", "3"]);
  expect(valueCandidates(all, "heading", "").at(-1)).toMatchObject({ label: "fade", detail: expect.stringContaining("---") });
  expect(yamlKeyCandidates(all, "graph-meter", "").map(k => k.insertion)).toEqual(["title: ", "value: ", "limit: ", "unit: ", "label: ", "caption: "]);
  expect(valueCandidates(all, "value", "0.", false, "graph-meter").map(v => v.insertion)).toEqual(["0.25", "0.6", "0.95"]);
});

test("a page as Markdown: intro, the table, each value with its source and drawing, the grids, the size of the space", () => {
  const md = componentPageMarkdown(schema("heading-style"), v => [`drawn: ${v.use.split("\n")[0]}`]);
  expect(md).toStartWith("# Heading styles\n");
  expect(md).toContain("| `heading-pattern` | on the declaring note | stack, waffle, uptime, dots, rule | `stack` | the glyph track the band is drawn in |");
  expect(md).toContain("#### heading-pattern: waffle\n\n```text\ndrawn: ## Your calls [heading::mine]\n```\n\n*The declaring note:*\n\n```markdown\nMy style [heading-style::mine] [heading-pattern::waffle]\n```");
  expect(md).toContain("## heading-pattern × heading-align");
  expect(md).toContain("heading-pattern × heading-align × heading-row × heading-letters × heading-tone × heading-rows: 2430 variations");
  expect(md).not.toContain("[heading-tone::coral] [heading-letters::spaced] [heading-rows::3]");
});

test("a component's brief: purpose in a line, where, each property as key: values (default) — meaning, one example, nothing drawn", () => {
  const brief = componentBrief(schema("heading-style"));
  const lines = brief.split("\n");
  expect(lines[0]).toBe("## heading-style");
  expect(lines[1]).not.toContain("\n");
  expect(lines).toContain("Properties:");
  expect(lines.some(l => /^- heading-pattern \[on the declaring note\]: stack, waffle/.test(l) && l.includes(" — "))).toBe(true);
  expect(brief).toContain("Example:\n```markdown\n");
  expect(brief).not.toContain("```text");
  expect(componentBriefs([schema("rule"), schema("callout")])).toContain("\n```\n\n## callout\n");
});
