// Component schemas (PIE-618): each component says what its properties are once, as data, and every client reads that
// instead of restating it. One schema drives the door's completion (`[head` offers the keys, `[heading-pattern::` the
// values, the same inside a `::graph-*` block's YAML) and its design-system pages (an intro, a generated properties
// table, each value of each property drawn with the source that made it, two-axis grids, and the whole cartesian space
// behind a filter). The built-ins are here; the service answers the merged list (`components.schemas`: these, the values
// an outline declares, such as `[heading-style::plot]` making `plot` a value of `[heading::]`, and the schemas
// extensions ship in `extension.json`'s `components`). A linter (PIE-522) can validate values with `checkValue`.
// Writing a schema is enough: no client has per-component docs or completion code. Pure: no I/O. A change to what it
// says or matches bumps PROTOCOL (protocol.ts).

import { BUILTIN_HEADING_STYLES, type HeadingStyle } from "./heading-styles";
import { BUILTIN_CALLOUTS, CALLOUT_TONES, type CalloutType } from "./callouts";
import { codeSpanRanges } from "./code-ranges";
import { noteCodeFences } from "./component-block";
import { FIGURE_COMPONENT_SCHEMAS } from "./component-schemas-figures";
import { BLOCK_COMPONENT_SCHEMAS } from "./component-schemas-blocks";

/** What a property's value is. */
export const PROP_TYPES = ["enum", "int", "number", "levels", "name", "room", "text", "list", "ref", "template", "pattern", "query"] as const;
export type PropType = (typeof PROP_TYPES)[number];

/**
 * Where a property is written: on the line that uses the component (`## Your calls [heading::band]`), on the note
 * that declares a style or type (`[heading-pattern::waffle]` beside `[heading-style::plot]`), or in a figure's YAML
 * (`value: 0.4`).
 */
export const PROP_PLACES = ["line", "note", "yaml"] as const;
export type PropPlace = (typeof PROP_PLACES)[number];

/** One allowed value and what it means; `declared`: the note that declares it (an outline's own style or type). */
export interface PropValue { value: string; meaning: string; declared?: string }

/** One property of a component. */
export interface PropSchema {
  key: string;
  where: PropPlace;
  type: PropType;
  /** One line: what it does. */
  meaning: string;
  /** The values it takes (an enum), each with its meaning. */
  values?: PropValue[];
  /** The list the outline extends (`heading-styles`, `callout-types`): the service adds the outline's own to `values`. */
  valuesFrom?: "heading-styles" | "callout-types";
  /** An int's range. */
  min?: number;
  max?: number;
  /** What it is when left out. */
  default?: string;
  /** Values worth drawing for a type with no list (a room, a text): the axis a page sweeps. */
  samples?: string[];
  /**
   * How it's written when that isn't `[key::value]` (a callout's type: `> [!{value}]`). Completion offers `[key::`
   * only for a property without one.
   */
  token?: string;
  /** The source to show this property with when its axis is drawn, in place of the component's `use`. */
  use?: string;
}

/**
 * The note that declares a style or type: its first line is `title [name::value]`, the variation's `note` properties
 * after it; `uses` is the line property that then names it (`heading`: the heading line says `[heading::mine]`).
 */
export interface DeclaringNote { title: string; name: string; value: string; uses?: string }

export interface ComponentSchema {
  /** A slug: `heading-style`, `callout`, `graph-meter`, an extension's `ext-<id>-<name>`. */
  id: string;
  title: string;
  /** What it is, in Markdown: a paragraph or two. */
  intro: string;
  /** One line: where it is written. */
  where: string;
  props: PropSchema[];
  /**
   * The source a variation writes. `use`: the text that uses it, `{key}` standing for a property's value (its default,
   * else nothing, when the variation leaves it out) and `{yaml}` for the YAML properties given, a `key: value` line each.
   * `note`: the declaring note, written only when a variation sets one of its properties.
   */
  source: { use: string; note?: DeclaringNote };
  /** The minimal example's values. */
  example: Record<string, string>;
  /** The properties drawn one value at a time, in order. */
  sweep: string[];
  /** Pairs of properties drawn as a grid. */
  grids: [string, string][];
  /** The axes of the whole cartesian space (filtered, never dumped). */
  space: string[];
  /** `built-in`, or `ext:<id>` for an extension's. */
  origin?: string;
}

// ── the built-ins ─────────────────────────────────────────────────────────────

const STYLE_MEANING: Record<string, string> = {
  band: "spaced capitals in a three-row band of shades fading from both edges",
  tab: "capitals on the top row of a band that fades out to the right, like a folder tab",
  waffle: "a checkerboard of shades, every other column",
  uptime: "an uptime strip's bars, two rows, the heading at the bottom left",
  dots: "sparse dots, the heading at the left",
  rule: "capitals between a frame's ruled lines",
  fade: "one row that fades in from both edges: made for a ---",
};
const styleValues = (styles: readonly HeadingStyle[]): PropValue[] =>
  styles.map(s => ({ value: s.name, meaning: STYLE_MEANING[s.name] ?? `${s.pattern}, ${s.rows} row${s.rows === 1 ? "" : "s"}, ${s.align}, ${s.letters}`, ...(s.block ? { declared: s.block } : {}) }));
const calloutValues = (types: readonly CalloutType[]): PropValue[] =>
  types.map(t => ({ value: t.name, meaning: `${t.icon} ${t.title}, ${t.tone}${t.aliases.length ? `; also ${t.aliases.join(", ")}` : ""}`, ...(t.block ? { declared: t.block } : {}) }));
const enumOf = (meanings: Record<string, string>): PropValue[] => Object.entries(meanings).map(([value, meaning]) => ({ value, meaning }));
const TONE_MEANING: Record<(typeof CALLOUT_TONES)[number], string> = {
  blue: "blue, for notes and information", green: "green, for tips and success", violet: "violet, for questions and examples",
  amber: "amber, for warnings", coral: "coral, for failures and danger", neutral: "the level's own colour, no tone of its own",
};

const HEADING_STYLE: ComponentSchema = {
  id: "heading-style",
  title: "Heading styles",
  intro: "A heading drawn in a band of glyph tracks, or a `---` drawn as one. The source stays Markdown: `## Your calls [heading::band]` is a level-2 heading whatever draws it, so folds, sections and anchors read it as they always did, and a client that doesn't draw styles shows it as written.\n\nA style is the outline's, as callout types are: the built-ins, or a declaration, `[heading-style::name]` with the `heading-*` properties below on any line of any note (or as a note's own properties). The same `heading-*` properties on a heading line restyle that heading alone: `## Odd jobs [heading::dots] [heading-tone::amber]`. Under 48 columns the heading is drawn as written.",
  where: "`[heading::name]` on a heading line, `[rule::name]` after a `---`; the `heading-*` properties on the line that declares a style, or on a heading line to restyle it alone",
  props: [
    { key: "heading", where: "line", type: "enum", meaning: "the style this heading is drawn with", valuesFrom: "heading-styles", values: styleValues(BUILTIN_HEADING_STYLES) },
    { key: "rule", where: "line", type: "enum", meaning: "the style this `---` is drawn with: its band with no heading in it", valuesFrom: "heading-styles", values: styleValues(BUILTIN_HEADING_STYLES), use: "Before the break\n\n--- [rule::{rule}]\n\nAfter it" },
    { key: "heading-style", where: "note", type: "name", meaning: "declares a style by this name (a slug); the other heading-* properties on the same note describe it", samples: ["plot"] },
    { key: "heading-pattern", where: "note", type: "enum", meaning: "the glyph track the band is drawn in", default: "stack", values: enumOf({ stack: "shades fading out from the edge into sparse dots", waffle: "a checkerboard of shades, every other column", uptime: "an uptime strip's bars", dots: "sparse dots, now and then a bright one", rule: "a frame's ruled line, doubled above and below the heading" }) },
    { key: "heading-rows", where: "note", type: "int", meaning: "the band's height in rows", default: "3", min: 1, max: 3 },
    { key: "heading-align", where: "note", type: "enum", meaning: "where the heading sits across the band", default: "center", values: enumOf({ left: "at the left; the band fades out to the right", center: "in the middle; the band fades in from both edges", right: "at the right; the band fades out to the left" }) },
    { key: "heading-row", where: "note", type: "enum", meaning: "the band row the heading is on", default: "middle", values: enumOf({ top: "the first row", middle: "the middle row", bottom: "the last row" }) },
    { key: "heading-padding", where: "note", type: "room", meaning: "room around the heading inside the band: columns, or \"rows columns\" (at most 2 rows, 12 columns)", default: "2", samples: ["0", "2", "1 6"] },
    { key: "heading-margin", where: "note", type: "room", meaning: "room around the band: columns, \"rows columns\" (rows above and below) or \"top columns bottom\" (at most 3 rows, 24 columns)", default: "0", samples: ["0", "6", "1 12", "2 0 1"] },
    { key: "heading-tone", where: "note", type: "enum", meaning: "the heading's colour family (the callouts' tones)", default: "neutral", values: enumOf(TONE_MEANING) },
    { key: "heading-letters", where: "note", type: "enum", meaning: "how the heading's letters are drawn", default: "plain", values: enumOf({ plain: "as written", upper: "in capitals", spaced: "in spaced capitals: Y O U R" }) },
    { key: "heading-default", where: "note", type: "levels", meaning: "the heading levels (1 to 6) it draws when a heading names no style, and `rule` for every `---`", samples: ["2", "1, 2", "rule"], use: "## Your calls\n\n---" },
  ],
  source: { use: "## Your calls [heading::{heading}]", note: { title: "My style", name: "heading-style", value: "mine", uses: "heading" } },
  example: { heading: "band" },
  sweep: ["heading", "rule", "heading-pattern", "heading-rows", "heading-align", "heading-row", "heading-letters", "heading-tone", "heading-padding", "heading-margin", "heading-default"],
  grids: [["heading-pattern", "heading-align"], ["heading-rows", "heading-row"]],
  space: ["heading-pattern", "heading-align", "heading-row", "heading-letters", "heading-tone", "heading-rows"],
};

const CALLOUT: ComponentSchema = {
  id: "callout",
  title: "Callouts",
  intro: "Obsidian's callouts: `> [!type]` opens one, a `+` or `-` after it says whether it starts open or folded, and the rest of the line is its title (none: the type's own). Its body is the lines quoted under it, nested callouts quoted deeper.\n\nThe types are the outline's: Obsidian's, or a note that declares `[callout-type::name]` with an icon, a tone, a title and aliases.",
  where: "`> [!type]` at the start of a quote; the `callout-*` properties on the note that declares a type",
  props: [
    { key: "callout", where: "line", type: "enum", meaning: "the type `> [!type]` names", token: "> [!{value}]", valuesFrom: "callout-types", values: calloutValues(BUILTIN_CALLOUTS) },
    { key: "fold", where: "line", type: "enum", meaning: "whether it can fold, and how it starts", token: "> [!type]{value}", values: enumOf({ "+": "starts open, folds", "-": "starts folded" }) },
    { key: "callout-type", where: "note", type: "name", meaning: "declares a type by this name (a slug); a built-in's name restyles it", samples: ["recipe"] },
    { key: "callout-icon", where: "note", type: "text", meaning: "its icon: one glyph, one column wide", samples: ["♨", "✿", "◆"] },
    { key: "callout-tone", where: "note", type: "enum", meaning: "its colour family", default: "neutral", values: enumOf(TONE_MEANING) },
    { key: "callout-title", where: "note", type: "text", meaning: "the title a callout of it shows when it names none", samples: ["Recipe", "From the kitchen"] },
    { key: "callout-aliases", where: "note", type: "list", meaning: "other names that mean it, comma-separated", samples: ["dish, meal"] },
  ],
  source: { use: "> [!{callout}]{fold}\n> Water the beds before nine.", note: { title: "My type", name: "callout-type", value: "mine", uses: "callout" } },
  example: { callout: "tip" },
  sweep: ["callout", "fold", "callout-tone", "callout-icon", "callout-title"],
  grids: [["callout-tone", "callout-icon"]],
  space: ["callout", "fold"],
};

const KIND_MEANING: Record<string, string> = {
  heading: "any heading", "heading:1": "a level-1 heading (or h1)", "heading:2": "a level-2 heading (or h2)", "heading:3": "a level-3 heading (or h3)",
  callout: "any callout (callout:<type> for one type)", list: "a list: a run of items", rule: "a `---`", image: "an image line",
};

const RULE: ComponentSchema = {
  id: "rule",
  title: "Rules",
  intro: "When a block matches, draw something with it, with no code: a rule note says what it matches (a query, a saved view, a place in the outline, a text pattern, a construct) and what it draws there (a band, a card, a badge, words, a box, a divider), above or below what matched, in its place or around it. The service decides what matches; every client draws what it says, and the note's text never changes.\n\nAn extension's `extension.json` writes the same as `rules[]`. The drawings here are of a sample note that matches.",
  where: "a note with `[rule-name::name]` and the `rule-*` properties below",
  props: [
    { key: "rule-name", where: "note", type: "name", meaning: "declares a rule by this name (lowercase letters, digits, - and _)", samples: ["meeting"] },
    { key: "rule-match", where: "note", type: "query", meaning: "a query in the saved views' grammar: the blocks it holds for match", samples: ["type=meeting"] },
    { key: "rule-view", where: "note", type: "ref", meaning: "a saved view ((id)): the blocks its query holds for match" },
    { key: "rule-under", where: "note", type: "ref", meaning: "only blocks under this one ((id)) match" },
    { key: "rule-text", where: "note", type: "pattern", meaning: "a pattern tested line by line outside code; (?i) ignores case, ] is written \\x5d", samples: ["!!(.+)!!"] },
    { key: "rule-kind", where: "note", type: "enum", meaning: "a construct it matches", values: enumOf(KIND_MEANING) },
    { key: "rule-decorate", where: "note", type: "enum", meaning: "what it draws", values: enumOf({ band: "the heading in a band of glyph tracks (a heading style's)", card: "a header card of the block's properties", badge: "a short label", text: "words in a tone", box: "a frame around what matched", divider: "a plain track: a hard page divider" }) },
    { key: "rule-place", where: "note", type: "enum", meaning: "where it draws: a band and a divider take the line's place, a box goes around, the rest above", values: enumOf({ above: "above what matched", below: "below what matched", replace: "in its place", around: "around it", span: "on the characters a text pattern hit (a tone on the words)", margin: "a card beside them, in the reader's margin" }) },
    { key: "rule-label", where: "note", type: "template", meaning: "its words: {title}, {text}, {level}, {$1} a pattern's capture, {key} any property of the block", samples: ["{title}", "{text} · {when}"] },
    { key: "rule-tone", where: "note", type: "enum", meaning: "the tone it's drawn in", values: enumOf({ default: "the reader's own", good: "green: done, fine", warn: "amber: look at this", bad: "red: something's wrong", dim: "quiet", accent: "the accent" }) },
    { key: "rule-fields", where: "note", type: "list", meaning: "the block's properties a card shows, comma-separated", samples: ["when, who"] },
    { key: "rule-pattern", where: "note", type: "enum", meaning: "a band's or divider's glyph track", values: enumOf({ stack: "shades fading out", waffle: "a checkerboard", uptime: "an uptime strip's bars", dots: "sparse dots", rule: "a ruled line" }) },
    { key: "rule-align", where: "note", type: "enum", meaning: "where a band's words sit", values: enumOf({ left: "at the left", center: "in the middle", right: "at the right" }) },
    { key: "rule-style", where: "note", type: "enum", meaning: "a band's or divider's heading style by name; pattern and align above go over it", valuesFrom: "heading-styles", values: styleValues(BUILTIN_HEADING_STYLES) },
  ],
  source: {
    use: "Planning call [type::meeting] [when::Tuesday] [who::Ada, Ben]\n\n## Decisions\nShip the shelf !!today!!\n\n- buy screws\n- paint it",
    note: { title: "Meeting card", name: "rule-name", value: "meeting" },
  },
  example: { "rule-kind": "heading:2", "rule-decorate": "band", "rule-fields": "when, who" },
  sweep: ["rule-decorate", "rule-place", "rule-kind", "rule-tone", "rule-pattern", "rule-align", "rule-label"],
  grids: [["rule-decorate", "rule-place"]],
  space: ["rule-decorate", "rule-place", "rule-tone", "rule-kind"],
};

const FIGURE_TITLE: PropSchema = { key: "title", where: "yaml", type: "text", meaning: "the title in the figure's frame", samples: ["Disk"] };

const METER: ComponentSchema = {
  id: "graph-meter",
  title: "Meter (::graph-meter)",
  intro: "A share drawn as a bar (`value: 0.4`, or 40 for 40%), or, with `limit:`, a budget: each value drawn up to the limit, the limit a mark at the bar's end, the headroom said beneath, an overrun in red. Rows `- label: 48` under the YAML draw one bar each against the same limit.",
  where: "a `::graph-meter` block, its properties in the YAML between `---` lines",
  props: [
    { ...FIGURE_TITLE },
    { key: "value", where: "yaml", type: "number", meaning: "the share (0 to 1, or a percentage), or with a limit the amount used", samples: ["0.25", "0.6", "0.95"] },
    { key: "limit", where: "yaml", type: "number", meaning: "a budget: the value is drawn against it, and what's left (or over) is said", samples: ["0.5", "1"] },
    { key: "unit", where: "yaml", type: "text", meaning: "the unit a budget's amounts are in", samples: ["TB"] },
    { key: "label", where: "yaml", type: "text", meaning: "the bar's label, with a limit", samples: ["photos"] },
    { key: "caption", where: "yaml", type: "text", meaning: "a quiet line under the bar", samples: ["the shared disk"] },
  ],
  source: { use: "::graph-meter\n---\n{yaml}\n---\n::" },
  example: { title: "Disk", value: "0.6" },
  sweep: ["value", "limit", "unit", "label", "caption"],
  grids: [["value", "limit"]],
  space: ["value", "limit", "caption"],
};

const SPARK: ComponentSchema = {
  id: "graph-spark",
  title: "Sparkline (::graph-spark)",
  intro: "A run of numbers drawn as a line of bars one column each, the last in the accent: a trend at a glance. `::graph-plot` is the same with `labels:` naming the first and last.",
  where: "a `::graph-spark` block, its properties in the YAML between `---` lines",
  props: [
    { ...FIGURE_TITLE, samples: ["Visits"] },
    { key: "data", where: "yaml", type: "list", meaning: "the numbers, in order: [3, 5, 2]", samples: ["[3, 5, 2, 8, 6, 9]", "[9, 7, 5, 3, 1]", "[1, 1, 2, 3, 5, 8, 13]"] },
    { key: "caption", where: "yaml", type: "text", meaning: "a quiet line under it", samples: ["the last seven days"] },
  ],
  source: { use: "::graph-spark\n---\n{yaml}\n---\n::" },
  example: { title: "Visits", data: "[3, 5, 2, 8, 6, 9]" },
  sweep: ["data", "caption"],
  grids: [["data", "caption"]],
  space: ["data", "caption"],
};

/** The components every outline has. */
export const BUILTIN_COMPONENT_SCHEMAS: readonly ComponentSchema[] = [HEADING_STYLE, CALLOUT, RULE, METER, SPARK, ...FIGURE_COMPONENT_SCHEMAS, ...BLOCK_COMPONENT_SCHEMAS].map(s => ({ ...s, origin: "built-in" }));

// ── merging: the outline's values, the extensions' schemas ────────────────────

/** What the service merges into the built-ins: an outline's declared styles and types, and the extensions' schemas. */
export interface ComponentDeclarations {
  headingStyles?: readonly HeadingStyle[];
  calloutTypes?: readonly CalloutType[];
  extensions?: readonly { id: string; components: readonly ComponentSchema[] }[];
}

/**
 * The built-ins with the outline's own values in their lists (a declared `[heading-style::plot]` is a value of
 * `[heading::]`, `[rule::]` and `[rule-style::]`; a declared callout type of `[!type]`), then each extension's schemas,
 * marked `ext:<id>`, their `valuesFrom` lists filled the same way. A declared name that restyles a built-in keeps its
 * place and says so. An extension's component whose id is taken (a built-in's, an earlier extension's) is left out and
 * said in `problems`.
 */
export function mergeComponentSchemas(d: ComponentDeclarations = {}): { schemas: ComponentSchema[]; problems: string[] } {
  const add = (values: readonly PropValue[] | undefined, more: PropValue[]): PropValue[] => {
    const out = (values ?? []).map(v => ({ ...v }));
    for (const m of more) {
      const at = out.findIndex(v => v.value === m.value);
      if (at >= 0) out[at] = { ...out[at]!, meaning: `${out[at]!.meaning} (restyled by this outline)`, ...(m.declared ? { declared: m.declared } : {}) };
      else out.push(m);
    }
    return out;
  };
  const styles = styleValues((d.headingStyles ?? []).filter(s => s.block)).map(v => ({ ...v, meaning: `this outline's: ${v.meaning}` }));
  const types = calloutValues((d.calloutTypes ?? []).filter(t => t.block)).map(v => ({ ...v, meaning: `this outline's: ${v.meaning}` }));
  const filled = (s: ComponentSchema): ComponentSchema => ({
    ...s,
    props: s.props.map(p => p.valuesFrom === "heading-styles" ? { ...p, values: add(p.values, styles) } : p.valuesFrom === "callout-types" ? { ...p, values: add(p.values, types) } : p),
  });
  const schemas = BUILTIN_COMPONENT_SCHEMAS.map(filled), problems: string[] = [];
  for (const ext of d.extensions ?? []) for (const c of ext.components) {
    const taken = schemas.find(s => s.id === c.id);
    if (taken) { problems.push(`extension ${ext.id}: component ${c.id} is ${taken.origin === "built-in" ? "a built-in's" : `${taken.origin}'s`} already; give it another id`); continue; }
    schemas.push(filled({ ...c, origin: `ext:${ext.id}` }));
  }
  return { schemas, problems };
}

// ── checking a schema an extension ships ──────────────────────────────────────

const SLUG = /^[a-z][a-z0-9-]{0,47}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const isStr = (x: unknown, most = 2000): x is string => typeof x === "string" && x.length <= most;
const isRecordOfStrings = (x: unknown): x is Record<string, string> => !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every(v => isStr(v, 300));

/**
 * Why `raw` isn't a component schema (as `extension.json`'s `components[]` writes one), naming the field; null when it
 * is one. Every property the axes and the example name must be one of its props.
 */
export function componentSchemaProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "a component is an object";
  const c = raw as Record<string, unknown>;
  if (!isStr(c.id) || !SLUG.test(c.id)) return "id is a slug (lowercase letters, digits and -)";
  for (const f of ["title", "intro", "where"] as const) if (!isStr(c[f]) || !(c[f] as string).trim()) return `${f} is words`;
  if (!Array.isArray(c.props) || !c.props.length || c.props.length > 32) return "props is a list of 1 to 32 properties";
  const keys = new Set<string>();
  for (const [i, p] of (c.props as unknown[]).entries()) {
    const at = `props/${i}`;
    if (!p || typeof p !== "object") return `${at} is an object`;
    const q = p as Record<string, unknown>;
    if (!isStr(q.key) || !KEY.test(q.key)) return `${at}/key is a property key`;
    if (keys.has(q.key)) return `${at}/key ${q.key} is declared twice`;
    keys.add(q.key);
    if (!(PROP_PLACES as readonly unknown[]).includes(q.where)) return `${at}/where is one of ${PROP_PLACES.join(", ")}`;
    if (!(PROP_TYPES as readonly unknown[]).includes(q.type)) return `${at}/type is one of ${PROP_TYPES.join(", ")}`;
    if (!isStr(q.meaning, 300) || !q.meaning.trim()) return `${at}/meaning is a line of words`;
    if (q.values !== undefined && (!Array.isArray(q.values) || q.values.length > 64 || !q.values.every(v => !!v && typeof v === "object" && isStr((v as PropValue).value, 100) && isStr((v as PropValue).meaning, 300)))) return `${at}/values is a list of { value, meaning }`;
    if (q.type === "enum" && !Array.isArray(q.values)) return `${at} is an enum: give its values`;
    for (const n of ["min", "max"] as const) if (q[n] !== undefined && !Number.isInteger(q[n])) return `${at}/${n} is a whole number`;
    if (q.samples !== undefined && (!Array.isArray(q.samples) || q.samples.length > 16 || !q.samples.every(s => isStr(s, 300)))) return `${at}/samples is a list of values`;
    for (const f of ["default", "token", "use"] as const) if (q[f] !== undefined && !isStr(q[f])) return `${at}/${f} is text`;
    if (q.valuesFrom !== undefined && q.valuesFrom !== "heading-styles" && q.valuesFrom !== "callout-types") return `${at}/valuesFrom is heading-styles or callout-types`;
  }
  const src = c.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== "object" || !isStr(src.use) || !src.use.trim()) return "source/use is the text that uses it";
  if (src.note !== undefined) {
    const n = src.note as Record<string, unknown>;
    if (!n || typeof n !== "object" || !isStr(n.title, 200) || !isStr(n.name, 64) || !keys.has(n.name) || !isStr(n.value, 64)) return "source/note is { title, name (one of its props), value }";
    if (n.uses !== undefined && (!isStr(n.uses, 64) || !keys.has(n.uses))) return "source/note/uses is one of its props";
  }
  if (!isRecordOfStrings(c.example)) return "example is { key: value }";
  for (const k of Object.keys(c.example)) if (!keys.has(k)) return `example names ${k}, which props doesn't declare`;
  for (const f of ["sweep", "space"] as const) {
    if (!Array.isArray(c[f]) || !(c[f] as unknown[]).every(k => isStr(k, 64) && keys.has(k))) return `${f} is a list of its props' keys`;
  }
  if (!Array.isArray(c.grids) || !(c.grids as unknown[]).every(g => Array.isArray(g) && g.length === 2 && g.every(k => isStr(k, 64) && keys.has(k)))) return "grids is a list of [key, key] pairs of its props";
  return null;
}

// ── values ────────────────────────────────────────────────────────────────────

/** The values an axis of `p` runs over: its list, an int's range (at most 12), else its samples. */
export function axisValues(p: PropSchema): string[] {
  if (p.values?.length) return p.values.map(v => v.value);
  if (p.type === "int" && p.min !== undefined && p.max !== undefined) {
    const out: string[] = [];
    for (let i = p.min; i <= p.max && out.length < 12; i++) out.push(String(i));
    return out;
  }
  return [...(p.samples ?? [])];
}

/** Why `value` isn't one `p` takes (an enum's value, an int's range, a list of levels); null when it is, or can't be told here. */
export function checkValue(p: PropSchema, value: string): string | null {
  const v = value.trim();
  if (p.type === "enum" && p.values && !p.values.some(x => x.value === v.toLowerCase() || x.value === v)) return `${p.key} ${JSON.stringify(value)} is one of ${p.values.map(x => x.value).join(", ")}`;
  if (p.type === "int") {
    const n = Number(v);
    if (!/^-?\d+$/.test(v) || (p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return `${p.key} ${JSON.stringify(value)} is a whole number${p.min !== undefined && p.max !== undefined ? ` from ${p.min} to ${p.max}` : ""}`;
  }
  if (p.type === "levels" && !v.split(",").map(x => x.trim()).filter(Boolean).every(x => /^[1-6]$/.test(x) || x.toLowerCase() === "rule")) return `${p.key} ${JSON.stringify(value)} is levels (1 to 6) or rule, comma-separated`;
  if (p.type === "room" && !/^\s*\d+(?:\s+\d+)?\s*$/.test(v)) return `${p.key} ${JSON.stringify(value)} is columns, or "rows columns"`;
  return null;
}

// ── a variation: values to source ─────────────────────────────────────────────

/** One variation of a component: the values that make it, the declaring note (when one is needed) and the text that uses it. */
export interface Variation { values: Record<string, string>; note?: string; use: string }

/** A YAML scalar as written: quoted only when YAML would read it as something else. */
function yamlScalar(v: string): string {
  if (/^\[.*\]$/.test(v) || /^-?\d+(\.\d+)?$/.test(v)) return v;
  return /^[\s*&!%@`'"|>{}#,?-]|: | #|^$|\s$/.test(v) ? JSON.stringify(v) : v;
}

/**
 * The source for `set` over the example's values. A note property given writes the declaring note (its name, then
 * those properties as `[key::value]`) and names it on the line (`uses`); `{key}` in the use is a value, its default when
 * left out, else nothing; `{yaml}` the YAML properties given. An axis drawn alone uses its own `use` when it has one
 * (`axis`).
 */
export function variation(schema: ComponentSchema, set: Record<string, string>, axis?: string): Variation {
  const values: Record<string, string> = { ...schema.example, ...set };
  const prop = new Map(schema.props.map(p => [p.key, p]));
  const n = schema.source.note;
  const noteProps = schema.props.filter(p => p.where === "note" && p.key !== n?.name && values[p.key] !== undefined);
  let note: string | undefined;
  // The declaring note is written when a variation sets one of its properties, names it outright, or is what uses it.
  if (n && (noteProps.length || values[n.name] !== undefined || n.uses === undefined)) {
    const name = values[n.name] ?? n.value;
    note = [`${n.title} [${n.name}::${name}]`, ...noteProps.map(p => `[${p.key}::${values[p.key]}]`)].join(" ");
    values[n.name] = name;
    if (n.uses) values[n.uses] = name;
  }
  // The values the source shows: a note's properties are on the note, never on the line.
  const shown = Object.fromEntries(Object.entries(values).filter(([k]) => prop.get(k)?.where !== "note"));
  const template = (axis && prop.get(axis)?.use) || schema.source.use;
  const yaml = schema.props.filter(p => p.where === "yaml" && shown[p.key] !== undefined && shown[p.key] !== "").map(p => `${p.key}: ${yamlScalar(shown[p.key]!)}`).join("\n");
  const use = template.replace(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g, (whole, key: string) => {
    if (key === "yaml") return yaml;
    const p = prop.get(key);
    return p ? (shown[key] ?? p.default ?? "") : whole;
  });
  return { values: Object.fromEntries(Object.entries(values).filter(([k]) => prop.has(k))), ...(note ? { note } : {}), use };
}

/** A variation's whole source, as copied: the declaring note, a blank line, then the text that uses it. */
export const variationText = (v: Variation): string => (v.note ? `${v.note}\n\n${v.use}` : v.use);

/** Each value of `axis`, one variation each (the others at the example's values). */
export function sweep(schema: ComponentSchema, axis: string): Variation[] {
  const p = schema.props.find(x => x.key === axis);
  return p ? axisValues(p).map(v => variation(schema, { [axis]: v }, axis)) : [];
}

/** A two-axis grid: a row per value of `a`, a variation per value of `b` in it. */
export function grid(schema: ComponentSchema, a: string, b: string): { a: string; rows: { value: string; cells: Variation[] }[] } {
  const pa = schema.props.find(x => x.key === a), pb = schema.props.find(x => x.key === b);
  if (!pa || !pb) return { a, rows: [] };
  return { a, rows: axisValues(pa).map(va => ({ value: va, cells: axisValues(pb).map(vb => variation(schema, { [a]: va, [b]: vb })) })) };
}

/** Picked values per axis of the space: an axis left out (or empty) takes every value. */
export type SpaceFilter = Record<string, readonly string[]>;

/** How many variations the whole space has, and how many `filter` keeps. */
export function spaceSize(schema: ComponentSchema, filter: SpaceFilter = {}): { all: number; matching: number } {
  let all = 1, matching = 1;
  for (const axis of schema.space) {
    const p = schema.props.find(x => x.key === axis);
    const n = p ? axisValues(p).length : 1;
    all *= Math.max(1, n);
    const picked = (filter[axis] ?? []).filter(v => p && axisValues(p).includes(v)).length;
    matching *= Math.max(1, picked || n);
  }
  return { all, matching };
}

/**
 * The variations `filter` keeps, `from` the `from`th, at most `limit`, in order (the first axis slowest): the space is
 * walked, never built whole.
 */
export function spaceVariations(schema: ComponentSchema, filter: SpaceFilter = {}, from = 0, limit = 12): Variation[] {
  const axes = schema.space.flatMap(axis => {
    const p = schema.props.find(x => x.key === axis);
    if (!p) return [];
    const all = axisValues(p), picked = (filter[axis] ?? []).filter(v => all.includes(v));
    return [{ axis, values: picked.length ? picked : all }];
  }).filter(a => a.values.length);
  const total = axes.reduce((n, a) => n * a.values.length, 1);
  const out: Variation[] = [];
  for (let i = Math.max(0, Math.floor(from)); i < total && out.length < Math.floor(limit); i++) {
    let rest = i;
    const set: Record<string, string> = {};
    for (let j = axes.length - 1; j >= 0; j--) {
      const a = axes[j]!;
      set[a.axis] = a.values[rest % a.values.length]!;
      rest = Math.floor(rest / a.values.length);
    }
    out.push(variation(schema, set));
  }
  return out;
}

// ── completion ────────────────────────────────────────────────────────────────

/** A property the cursor is in: its key being typed (`[head`), or its value (`[heading-pattern::wa`). */
export type PropertyAtCursor =
  | { kind: "key"; start: number; end: number; query: string }
  | { kind: "value"; key: string; start: number; end: number; query: string };

/**
 * The `[key::value]` property being typed at column `col` of `line`: its key while there's no `::` yet (`[head`, at
 * least one letter, never `[[` or `[!`), its value after the `::` up to a `]` (which a choice replaces through). `start`
 * is where a choice goes (the `[` for a key, after the `::` for a value). Null anywhere else.
 */
export function propertyAtCursor(line: string, col: number): PropertyAtCursor | null {
  const at = Math.max(0, Math.min(col, line.length));
  // A property in a code span is the code's text (`[head` in an example), never one being written.
  if (codeSpanRanges(line).some(r => r.start < at && at < r.end)) return null;
  const before = line.slice(0, at), after = line.slice(at);
  const value = /\[([A-Za-z][A-Za-z0-9_.-]*)::([^\][]*)$/.exec(before);
  if (value && before[value.index - 1] !== "[") {
    const start = before.length - value[2]!.length;
    // Through its `]`; with none typed yet, through the rest of the word the cursor is in (`[heading::b|and`).
    const close = /^[^\][]*\]/.exec(after) ?? /^[^\s\][]*/.exec(after);
    return { kind: "value", key: value[1]!, start, end: before.length + close![0].length, query: value[2]! };
  }
  const key = /\[([A-Za-z][A-Za-z0-9_.-]*)$/.exec(before);
  if (!key || before[key.index - 1] === "[") return null;
  // Typed in the middle of a key already written: a choice replaces the rest of it and its `::`.
  const rest = /^[A-Za-z0-9_.-]*(?:::)?/.exec(after)![0];
  // `[heading](url)` and `[heading]` are a link's text, not a property.
  if (!rest.endsWith("::") && after.slice(rest.length).startsWith("]")) return null;
  return { kind: "key", start: key.index, end: before.length + rest.length, query: key[1]! };
}

/** The YAML key or value being typed in a component block's YAML: `ti` at a line's start, or `value: 0.` after its key. */
export type YamlAtCursor =
  | { kind: "key"; component: string; start: number; end: number; query: string }
  | { kind: "value"; component: string; key: string; start: number; end: number; query: string };

const COMPONENT_LINE = /^ {0,3}::([a-z][a-z0-9-]*)[ \t]*$/;

/**
 * Where row `row` of `lines` is a line of a component block's YAML (between the `---` after `::name` and the next
 * `---`, closed or not yet), the key or value at column `col` there. Null anywhere else.
 */
export function yamlAtCursor(lines: readonly string[], row: number, col: number): YamlAtCursor | null {
  const line = lines[row] ?? "";
  if (/^\s*---\s*$/.test(line)) return null;
  // A figure written inside a code fence is the code's text, never one being written.
  if (inCodeFence(lines, row)) return null;
  for (let i = row - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (/^\s*---\s*$/.test(l)) {
      // The fence that opens the YAML has the component's line right above it (blank lines between).
      let j = i - 1;
      while (j >= 0 && !lines[j]!.trim()) j--;
      const m = j >= 0 ? COMPONENT_LINE.exec(lines[j]!) : null;
      return m ? at(m[1]!) : null;
    }
    if (COMPONENT_LINE.test(l) || /^ {0,3}::[ \t]*$/.test(l)) return null;
  }
  return null;
  function at(component: string): YamlAtCursor | null {
    const before = line.slice(0, Math.max(0, Math.min(col, line.length)));
    const v = /^([ \t]*)([A-Za-z][A-Za-z0-9_.-]*):[ \t]?(.*)$/.exec(before);
    if (v && !/^[ \t]/.test(line)) return { kind: "value", component, key: v[2]!, start: before.length - v[3]!.length, end: line.length, query: v[3]! };
    const k = /^([A-Za-z][A-Za-z0-9_.-]*)$/.exec(before);
    // Typed in the middle of a key already written: a choice replaces the rest of it and its `: `.
    if (k) return { kind: "key", component, start: 0, end: before.length + /^[A-Za-z0-9_.-]*(?::[ \t]?)?/.exec(line.slice(before.length))![0].length, query: k[1]! };
    return null;
  }
}

/** Whether row `row` of `lines` is inside a fenced code block (outside a component block, whose fences are its own). */
export function inCodeFence(lines: readonly string[], row: number): boolean {
  return noteCodeFences(lines).some(f => row > f.start && row <= f.end);
}

/** A candidate for a key or a value, as completion lists it. */
export interface PropertyCandidate {
  /** What choosing it writes in place of what was typed. */
  insertion: string;
  label: string;
  /** Where it goes and what it means. */
  detail: string;
  /** The component it's from, its property, and the value (a value's candidate), for a preview. */
  component: string;
  key: string;
  value?: string;
}

const rank = (name: string, q: string) => (!q ? 0 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1);
const PLACE_WORDS: Record<PropPlace, string> = { line: "on the line", note: "on the declaring note", yaml: "in the YAML" };

/** The property keys starting with (then holding) `query`, each once, written `[key::`; never a key written another way. */
export function keyCandidates(schemas: readonly ComponentSchema[], query: string): PropertyCandidate[] {
  const q = query.toLowerCase(), seen = new Set<string>(), out: { c: PropertyCandidate; r: number }[] = [];
  for (const s of schemas) for (const p of s.props) {
    if (p.where === "yaml" || p.token || seen.has(p.key)) continue;
    const r = rank(p.key.toLowerCase(), q);
    if (r < 0) continue;
    seen.add(p.key);
    out.push({ r, c: { insertion: `[${p.key}::`, label: p.key, detail: `${s.title} · ${PLACE_WORDS[p.where]} · ${p.meaning}`, component: s.id, key: p.key } });
  }
  return out.sort((a, b) => a.r - b.r).map(x => x.c);
}

/** The values of `key` starting with (then holding) `query`: its list, an int's range, else its samples; `close` adds the `]`. */
export function valueCandidates(schemas: readonly ComponentSchema[], key: string, query: string, close = true, component?: string): PropertyCandidate[] {
  const owner = schemas.find(s => (component === undefined || s.id === component) && s.props.some(p => p.key === key));
  const p = owner?.props.find(x => x.key === key);
  if (!owner || !p) return [];
  const q = query.toLowerCase();
  const meaning = new Map((p.values ?? []).map(v => [v.value, v.meaning]));
  return axisValues(p).map(v => ({ v, r: rank(v.toLowerCase(), q) })).filter(x => x.r >= 0).sort((a, b) => a.r - b.r).map(({ v }) => ({
    insertion: close ? `${v}]` : v, label: v, component: owner.id, key, value: v,
    detail: meaning.get(v) ?? (p.default === v ? `the default · ${p.meaning}` : p.meaning),
  }));
}

/** The YAML keys of component `component` (a figure's) starting with `query`, written `key: `. */
export function yamlKeyCandidates(schemas: readonly ComponentSchema[], component: string, query: string): PropertyCandidate[] {
  const s = schemas.find(x => x.id === component);
  const q = query.toLowerCase();
  return (s?.props ?? []).filter(p => p.where === "yaml").map(p => ({ p, r: rank(p.key.toLowerCase(), q) })).filter(x => x.r >= 0).sort((a, b) => a.r - b.r)
    .map(({ p }) => ({ insertion: `${p.key}: `, label: p.key, detail: `${s!.title} · ${p.meaning}`, component, key: p.key }));
}

// ── a page as Markdown ────────────────────────────────────────────────────────

/** A variation drawn as plain rows by a client (the door's reader), for a page that shows what it draws. */
export type DrawVariation = (v: Variation, axis?: string) => string[] | null;

const fence = (lang: string, text: string) => { const ticks = /```/.test(text) ? "````" : "```"; return `${ticks}${lang}\n${text}\n${ticks}`; };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** A property's values, as the table says them. */
export function valuesWords(p: PropSchema): string {
  if (p.values?.length) return p.values.map(v => v.value).join(", ");
  if (p.type === "int" && p.min !== undefined && p.max !== undefined) return `${p.min} to ${p.max}`;
  return p.type;
}

/**
 * A component's page as Markdown (what the publisher's renderer turns into HTML): the intro, the properties table, the
 * minimal example, each swept axis value by value with its source, the grids, and the size of the whole space (picked
 * through in the door, never dumped). `draw` adds what a client draws above each source.
 */
export function componentPageMarkdown(schema: ComponentSchema, draw?: DrawVariation): string {
  const shown = (v: Variation, axis?: string) => {
    const rows = draw?.(v, axis);
    return [...(rows?.length ? [fence("text", rows.join("\n"))] : []), ...(v.note ? [`*The declaring note:*`, fence("markdown", v.note), `*In your note:*`] : []), fence("markdown", v.use)].join("\n\n");
  };
  const out = [`# ${schema.title}`, schema.intro, `**Where it goes:** ${schema.where}.`];
  out.push("## Minimal example", shown(variation(schema, {})));
  out.push("## Properties", ["| key | where | values | default | meaning |", "|---|---|---|---|---|", ...schema.props.map(p =>
    `| \`${cell(p.token ?? p.key)}\` | ${PLACE_WORDS[p.where]} | ${cell(valuesWords(p))} | ${p.default === undefined ? "" : `\`${cell(p.default)}\``} | ${cell(p.meaning)} |`)].join("\n"));
  const valueMeanings = schema.props.filter(p => p.values?.length);
  for (const p of valueMeanings) out.push(`**\`${p.key}\`:** ${p.values!.map(v => `\`${v.value}\` ${v.meaning}`).join("; ")}.`);
  if (schema.sweep.length) {
    out.push("## One property at a time");
    for (const axis of schema.sweep) {
      const p = schema.props.find(x => x.key === axis);
      if (!p) continue;
      out.push(`### ${axis}`, p.meaning);
      for (const v of sweep(schema, axis)) out.push(`#### ${axis}: ${v.values[axis] || "(none)"}`, shown(v, axis));
    }
  }
  for (const [a, b] of schema.grids) {
    const g = grid(schema, a, b);
    out.push(`## ${a} × ${b}`);
    for (const row of g.rows) for (const c of row.cells) out.push(`#### ${a}: ${row.value} · ${b}: ${c.values[b]}`, shown(c));
  }
  if (schema.space.length) {
    const { all } = spaceSize(schema);
    out.push("## Every combination", `${schema.space.join(" × ")}: ${all} variations. Pick values per property in the door's library (\`ep0ch --screen library\`) and the ones that match are drawn with their source.`);
  }
  return out.join("\n\n") + "\n";
}

// ── the brief: what an agent reads ────────────────────────────────────────────

/** A component's first sentence, on one line: its purpose. */
function purposeOf(schema: ComponentSchema): string {
  const flat = schema.intro.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](?:\s|$)/);
  return end >= 0 ? flat.slice(0, end + 1) : flat;
}

/**
 * A component as an agent reads it (`ep0ch library --brief`, the `outline_components` tools): the id, its purpose in
 * a line, where it goes, each property as `key: values (default) — meaning`, and the minimal example. No drawn
 * variations. A property written anywhere but the component's line says where, in brackets after its key.
 */
export function componentBrief(schema: ComponentSchema): string {
  const origin = schema.origin && schema.origin !== "built-in" ? ` (${schema.origin})` : "";
  const props = schema.props.map(p =>
    `- ${p.token ?? p.key}${p.where === "line" ? "" : ` [${PLACE_WORDS[p.where]}]`}: ${valuesWords(p)}${p.default === undefined ? "" : ` (default ${p.default})`} — ${p.meaning.replace(/\s+/g, " ").trim()}`);
  return [`## ${schema.id}${origin}`, purposeOf(schema), `Where: ${schema.where}.`, "Properties:", ...props, "Example:", fence("markdown", variationText(variation(schema, {})))].join("\n");
}

/** Several components' briefs, one block each. */
export const componentBriefs = (schemas: readonly ComponentSchema[]): string => schemas.map(componentBrief).join("\n\n") + "\n";
