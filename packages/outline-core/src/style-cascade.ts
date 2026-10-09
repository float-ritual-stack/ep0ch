// The style cascade (PIE-673): spacing and list density, declared in the outline's own notes and resolved the same
// way by every renderer (the door now; Detail and the publisher read it next, the publisher as real CSS). A value
// comes from the nearest level that sets it, in this order, each over the one before:
//
//   base → component → global → tile kind → screen → page → this tile → block (this list, a box)
//
// - base: these built-ins, and a tile kind's own defaults (a reader's measure, the links tile's group dividers).
// - component: what a component's own style says for it (a heading style's `heading-margin`, PIE-599). One system:
//   `[heading-margin::1 0 1]` on a heading style and `[style.heading.margin::1 0 1]` on a style note are the same
//   token, read by the same grammar (heading-styles.ts `parseBandMargin`).
// - global, tile kind and screen: a note, or any line of one, that says what it styles and sets fields:
//   `Reading comfort [style-for::global] [style.measure::80]`, `[style-for::tile:detail] [style.pad::1 2]`,
//   `[style-for::screen:desk] [style.list.gap::1]`. A `[style-for::airy]` that names no level is a named style.
// - page: the note shown, by its own fields (`[style.margin.x::4]`) over the named style it uses (`[style::airy]`).
// - this tile (PIE-675): one tile's own look, kept in its tile spec (`look`), so one links tile or one reader can be
//   airy while the others of its kind stay tight.
// - block: a box written into the note, `::box{margin.x=2 list.gap=1}` … `::` (PIE-549's block attributes); a list's own
//   (PIE-675: `[style.list.gap::1]` on its lead-in line or the heading of its section, by placement, listLayers); and a
//   heading line's own `heading-*` fields.
//
// Any field takes a width variant, `style.narrow.margin.x` (`narrow.margin.x=0` in a box): it applies while the tile
// is narrower than `bp.narrow`, `wide` from `bp.wide`, and at its level beats that level's plain value. Each resolved
// value says where it came from (its level, the note, the variant), so a tool can show and change it there.
//
// Cells aren't square: a row is about twice as tall as a column is wide, so the shorthands that set both axes
// (`pad`, `margin`) take one number as rows and give columns twice that (`pad=1` is 1 row, 2 columns), and a nudge
// of both moves 1 row with 2 columns.
//
// Spacing is drawn, never text: a renderer puts it outside the cells it reads back (selection, copy, peek), and an
// export leaves it out. Pure: no I/O. A change to what it matches or computes bumps PROTOCOL (protocol.ts).

import { CALLOUT_TONES, type CalloutTone } from "./callouts";
import { BUILTIN_HEADING_STYLES, bandMarginText, bandPaddingText, liveTokensInLine, parseBandMargin, parseBandPadding, type BandMargin, type BandRoom } from "./heading-styles";

/** How a token's value is written and kept. */
export type StyleTokenKind =
  | { kind: "int"; min: number; max: number; step: number }
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "margin" }
  | { kind: "padding" }
  /** Words of its own (a glyph, a picture's path): at most `max` characters, never a `]` or a line break. `presets`: what a nudge cycles through. */
  | { kind: "text"; max: number; presets?: readonly string[] };

export type StyleValue = number | boolean | string | BandMargin | BandRoom;

export interface StyleTokenSpec {
  /** Its value when nothing sets it. */
  base: StyleValue;
  /** What it is, in a few words (the tune inspector's line, the docs). */
  what: string;
  type: StyleTokenKind;
  /** The axis it spaces, for the nudge ratio: a row is about two columns. */
  axis?: "x" | "y";
}

/** A list's divider: a dim line, dots, dashes, a double line, a line that fades in from both ends (PIE-599's `fade` rule), or `list.divider.glyph` repeated. */
export const LIST_DIVIDERS = ["none", "line", "dots", "dashed", "double", "fade", "glyph"] as const;
export type ListDivider = (typeof LIST_DIVIDERS)[number];
/** Where a divider sits in the gap between two items (`list.gap` rows and the divider's own). */
export const DIVIDER_ALIGNS = ["top", "centre", "bottom"] as const;
export type DividerAlign = (typeof DIVIDER_ALIGNS)[number];
/** The glyphs a nudge of `list.divider.glyph` steps through (any other is written by hand). */
export const DIVIDER_GLYPHS = ["·", "•", "∙", "─", "┄", "╌", "═", "~", "*", "◇", "✦", "░"] as const;

/**
 * A surface (PIE-675): a theme role, never a colour. `raised` and `sunken` are just off the ground, either way; a tone is
 * the callouts' family (blue, green, violet, amber, coral, neutral) mixed into the ground. Every theme draws each one
 * dark, at a strength of 1 to SURFACE_STEPS, under a brightness cap and with text at 4.5:1 or better on it.
 */
export const SURFACES = ["none", "raised", "sunken", ...CALLOUT_TONES] as const;
export type Surface = (typeof SURFACES)[number];
export const SURFACE_STEPS = 6;
/** A frame's lines: `auto` is the place's own (a tile: its screen's frame; a box: none). */
export const BORDERS = ["auto", "none", "line", "round", "heavy", "double"] as const;
export type Border = (typeof BORDERS)[number];
/** An edge's accent in the tone: a bar down the left side, or the whole frame. */
export const EDGES = ["none", "bar", "box"] as const;
export type Edge = (typeof EDGES)[number];
export { CALLOUT_TONES as STYLE_TONES };

const BASE_HEADING = BUILTIN_HEADING_STYLES[0]!;

/** Every token, in the order a tool lists them. */
export const STYLE_TOKENS = {
  "measure": { base: 0, what: "the widest a note's text runs (0: the whole tile), centred when the tile is wider", type: { kind: "int", min: 0, max: 400, step: 4 } },
  "pad.x": { base: 0, what: "blank columns inside a tile's frame", type: { kind: "int", min: 0, max: 16, step: 2 }, axis: "x" },
  "pad.y": { base: 0, what: "blank rows inside a tile's frame", type: { kind: "int", min: 0, max: 8, step: 1 }, axis: "y" },
  "margin.x": { base: 1, what: "columns either side of a note's text", type: { kind: "int", min: 0, max: 24, step: 2 }, axis: "x" },
  "margin.y": { base: 0, what: "blank rows above a note's text (a box's: above and below it)", type: { kind: "int", min: 0, max: 8, step: 1 }, axis: "y" },
  "list.gap": { base: 0, what: "blank rows between a list's items", type: { kind: "int", min: 0, max: 3, step: 1 } },
  "list.zebra": { base: false, what: "every other item on a quiet tint", type: { kind: "bool" } },
  "list.divider": { base: "none", what: "a line between a list's items (the links tile: between its groups): line, dots, dashed, double, fade, or the glyph", type: { kind: "enum", values: LIST_DIVIDERS } },
  "list.divider.glyph": { base: "·", what: "what a glyph divider repeats", type: { kind: "text", max: 4, presets: DIVIDER_GLYPHS } },
  "list.divider.align": { base: "centre", what: "where the divider sits in the gap: top, centre or bottom", type: { kind: "enum", values: DIVIDER_ALIGNS } },
  "list.zebra.bg": { base: "raised", what: "the stripe's surface: raised, sunken or a tone", type: { kind: "enum", values: SURFACES.filter(x => x !== "none") } },
  "list.zebra.strength": { base: 2, what: "how far the stripe is off the ground (1 to 6, capped dark)", type: { kind: "int", min: 1, max: SURFACE_STEPS, step: 1 } },
  "bg": { base: "none", what: "a tile's or a box's surface: raised, sunken or a tone (yields under a header's picture)", type: { kind: "enum", values: SURFACES } },
  "bg.strength": { base: 2, what: "how far the surface is off the ground (1 to 6, capped dark)", type: { kind: "int", min: 1, max: SURFACE_STEPS, step: 1 } },
  "tone": { base: "neutral", what: "the colour family of an edge and a frame: blue, green, violet, amber, coral or neutral", type: { kind: "enum", values: CALLOUT_TONES } },
  "border": { base: "auto", what: "a frame's lines: line, round, heavy, double, none (auto: a tile's screen's, a box none)", type: { kind: "enum", values: BORDERS } },
  "edge": { base: "none", what: "an accent in the tone: a bar down the left side, or the whole frame (box)", type: { kind: "enum", values: EDGES } },
  "header.bg": { base: "none", what: "a reader's sticky header's surface (title, byline, crumbs): raised, sunken or a tone", type: { kind: "enum", values: SURFACES } },
  "header.bg.opacity": { base: 60, what: "how much of the header's surface shows over the ground or its picture (0 to 100, capped dark)", type: { kind: "int", min: 0, max: 100, step: 10 } },
  "header.image": { base: "", what: "the header's picture, over the hero the note gives it: a path or one of the note's pictures (empty: the hero)", type: { kind: "text", max: 400 } },
  "header.image.x": { base: 0, what: "the header picture's crop moved across, in % of the picture (-50 to 50)", type: { kind: "int", min: -50, max: 50, step: 5 } },
  "header.image.y": { base: 0, what: "the header picture's crop moved down, in % of the picture (-50 to 50)", type: { kind: "int", min: -50, max: 50, step: 5 } },
  "heading.margin": { base: BASE_HEADING.margin, what: "rows above, columns beside and rows below a heading", type: { kind: "margin" } },
  "heading.padding": { base: BASE_HEADING.padding, what: "rows and columns around a heading in its band", type: { kind: "padding" } },
  "bp.narrow": { base: 60, what: "narrow below this many columns", type: { kind: "int", min: 20, max: 400, step: 4 } },
  "bp.wide": { base: 140, what: "wide from this many columns", type: { kind: "int", min: 20, max: 400, step: 4 } },
} as const satisfies Record<string, StyleTokenSpec>;

export type StyleToken = keyof typeof STYLE_TOKENS;
export const STYLE_TOKEN_NAMES = Object.keys(STYLE_TOKENS) as StyleToken[];

/** The resolved values, typed. */
export interface StyleValues {
  "measure": number; "pad.x": number; "pad.y": number; "margin.x": number; "margin.y": number;
  "list.gap": number; "list.zebra": boolean; "list.divider": ListDivider; "list.divider.glyph": string; "list.divider.align": DividerAlign;
  "list.zebra.bg": Exclude<Surface, "none">; "list.zebra.strength": number;
  "bg": Surface; "bg.strength": number; "tone": CalloutTone; "border": Border; "edge": Edge;
  "header.bg": Surface; "header.bg.opacity": number; "header.image": string; "header.image.x": number; "header.image.y": number;
  "heading.margin": BandMargin; "heading.padding": BandRoom;
  "bp.narrow": number; "bp.wide": number;
}

export const BASE_STYLE: StyleValues = Object.fromEntries(STYLE_TOKEN_NAMES.map(t => [t, STYLE_TOKENS[t].base])) as unknown as StyleValues;

/** The widths a variant names. `normal` is between the two, and has no variant of its own. */
export const BREAKPOINTS = ["narrow", "wide"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
/** Tokens that can't have a width variant: the breakpoints themselves. */
const NO_VARIANT: ReadonlySet<StyleToken> = new Set(["bp.narrow", "bp.wide"]);
export const hasVariants = (t: StyleToken) => !NO_VARIANT.has(t);

export const isStyleToken = (t: string): t is StyleToken => Object.hasOwn(STYLE_TOKENS, t);

/** The levels, nearest last: a value set at a later one wins. */
export const STYLE_LEVELS = ["base", "component", "global", "tile", "screen", "page", "instance", "block"] as const;
export type StyleLevel = (typeof STYLE_LEVELS)[number];
/**
 * The levels a value can be saved to from a tool: the outline's, this tile's (its tile spec), and this list's (its
 * lead-in or heading line). A box is edited in its note.
 */
export const SAVE_LEVELS = ["global", "tile", "screen", "page", "instance", "list"] as const;
/** The cascade level a save level is (this list is a block's). */
export const levelOfSave = (l: SaveLevel): StyleLevel => (l === "list" ? "block" : l);
export type SaveLevel = (typeof SAVE_LEVELS)[number];

/** A field's key in a layer: the token, or `narrow.token` / `wide.token` for its width variant. */
export type FieldKey = string;
export const fieldKey = (token: StyleToken, variant?: Breakpoint | null): FieldKey => (variant ? `${variant}.${token}` : token);
/** The property that writes a field in a note: `style.margin.x`, `style.narrow.margin.x`. */
export const styleProperty = (token: StyleToken, variant?: Breakpoint | null) => `style.${fieldKey(token, variant)}`;

/** A field key read back: its token and variant, or null for a key that isn't one. */
export function parseFieldKey(key: string): { token: StyleToken; variant: Breakpoint | null } | null {
  const k = key.trim().toLowerCase();
  if (isStyleToken(k)) return { token: k, variant: null };
  const dot = k.indexOf(".");
  const v = k.slice(0, dot), t = k.slice(dot + 1);
  if ((v === "narrow" || v === "wide") && isStyleToken(t) && hasVariants(t)) return { token: t, variant: v };
  return null;
}

/** A value as written, read for `token`: its typed value, or why it can't be used. */
export function parseStyleValue(token: StyleToken, raw: string): { value: StyleValue } | { problem: string } {
  const spec: StyleTokenSpec = STYLE_TOKENS[token], v = raw.trim().toLowerCase();
  const type = spec.type;
  if (type.kind === "int") {
    if (!/^-?\d+$/.test(v)) return { problem: `${token} ${JSON.stringify(raw)} is a whole number, ${type.min} to ${type.max}` };
    const n = Number(v);
    if (n < type.min || n > type.max) return { problem: `${token} ${n} is ${type.min} to ${type.max}` };
    return { value: n };
  }
  if (type.kind === "bool") {
    if (["on", "yes", "true", "1", ""].includes(v)) return { value: true };
    if (["off", "no", "false", "0"].includes(v)) return { value: false };
    return { problem: `${token} ${JSON.stringify(raw)} is on or off` };
  }
  if (type.kind === "margin") {
    const r = parseBandMargin(v, BASE_HEADING.margin);
    return "value" in r ? { value: r.value } : { problem: `${token} ${r.problem}` };
  }
  if (type.kind === "padding") {
    const r = parseBandPadding(v, BASE_HEADING.padding);
    return "value" in r ? { value: r.value } : { problem: `${token} ${r.problem}` };
  }
  if (type.kind === "text") {
    // As written (a path keeps its case); trimmed.
    const t = raw.trim();
    if (t.length > type.max || /[\]\n\r]/.test(t)) return { problem: `${token} is at most ${type.max} characters, without ] or a line break` };
    return { value: t };
  }
  // `center` is `centre`, as either is written.
  const e = v === "center" ? "centre" : v;
  if ((type.values as readonly string[]).includes(e)) return { value: e };
  return { problem: `${token} ${JSON.stringify(raw)} is one of ${type.values.join(", ")}` };
}

/** A value as it's written back into a note. */
export function styleValueText(v: StyleValue): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "object") return "top" in v ? bandMarginText(v) : bandPaddingText(v);
  return String(v);
}

/**
 * `v` moved `by` steps (a nudge): a number by its token's step, clamped; on/off flipped; a choice to the next one; a
 * heading's margin by a row above and below, its padding by a row and two columns.
 */
export function nudgeStyleValue(token: StyleToken, v: StyleValue, by: number): StyleValue {
  const type: StyleTokenKind = STYLE_TOKENS[token].type;
  if (type.kind === "int") return Math.max(type.min, Math.min(type.max, (v as number) + by * (token === "measure" && v === 0 && by > 0 ? 40 : type.step)));
  if (type.kind === "bool") return by === 0 ? v : !v;
  if (type.kind === "text") {
    const p = type.presets ?? [];
    if (!p.length || by === 0) return v;
    const i = p.indexOf(v as string);
    return p[i < 0 ? (by > 0 ? 0 : p.length - 1) : (((i + by) % p.length) + p.length) % p.length]!;
  }
  if (type.kind === "enum") { const i = type.values.indexOf(v as string); return type.values[(((i + by) % type.values.length) + type.values.length) % type.values.length]!; }
  if (type.kind === "margin") { const m = v as BandMargin; const r = (n: number) => Math.max(0, Math.min(3, n + by)); return { top: r(m.top), cols: m.cols, bottom: r(m.bottom) }; }
  const p = v as BandRoom;
  return { rows: Math.max(0, Math.min(2, p.rows + by)), cols: Math.max(0, Math.min(12, p.cols + 2 * by)) };
}

/** One level's fields: who set them, where. */
export interface StyleLayer {
  level: StyleLevel;
  /** What the level is, in words: `global`, `tile detail`, `screen desk`, `page`, `style airy`, `box`. */
  label: string;
  /** The note that sets them, when one does. */
  block?: string;
  /** Its line (from 0), when a line declares them rather than the note's own properties. */
  line?: number;
  /** Field key (`margin.x`, `narrow.margin.x`) → value as written. */
  fields: Readonly<Record<FieldKey, string>>;
}

/** Where a resolved value came from. */
export interface StyleSource { level: StyleLevel; label: string; block?: string; line?: number; variant?: Breakpoint }

export interface ResolvedStyle {
  values: StyleValues;
  sources: Record<StyleToken, StyleSource>;
  /** The width variant in force, or null between them. */
  breakpoint: Breakpoint | null;
  /** The width it was resolved for. */
  width: number;
  problems: string[];
}

const BASE_SOURCE: StyleSource = { level: "base", label: "built-in" };

/** The width variant `width` columns are in, by the breakpoints given. */
export function breakpointOf(width: number, narrow: number, wide: number): Breakpoint | null {
  return width < narrow ? "narrow" : width >= wide ? "wide" : null;
}

/** Layers in the order they apply: by level, and within a level in the order given. */
const ordered = (layers: readonly StyleLayer[]) => [...layers].map((l, i) => ({ l, i })).sort((a, b) => STYLE_LEVELS.indexOf(a.l.level) - STYLE_LEVELS.indexOf(b.l.level) || a.i - b.i).map(x => x.l);

/**
 * The values for a tile `width` columns wide, from `layers` (any order: they're applied by level, and within a level
 * in the order given, a later one winning). At each layer a field's width variant beats its plain value. A value that
 * can't be used is said in `problems` and the level below stands.
 */
export function resolveStyle(layers: readonly StyleLayer[], width: number): ResolvedStyle {
  const order = ordered(layers);
  const problems: string[] = [];
  const values = { ...BASE_STYLE } as Record<StyleToken, StyleValue>;
  const sources = Object.fromEntries(STYLE_TOKEN_NAMES.map(t => [t, BASE_SOURCE])) as Record<StyleToken, StyleSource>;
  const seen = new Set<string>();
  const read = (l: StyleLayer, token: StyleToken, variant: Breakpoint | null): { value: StyleValue } | null => {
    const raw = l.fields[fieldKey(token, variant)];
    if (raw === undefined) return null;
    const r = parseStyleValue(token, raw);
    if ("problem" in r) {
      const said = `${l.label}: ${variant ? `${variant}.` : ""}${r.problem}`;
      if (!seen.has(said)) { seen.add(said); problems.push(said); }
      return null;
    }
    return r;
  };
  const source = (l: StyleLayer, variant: Breakpoint | null): StyleSource => ({
    level: l.level, label: l.label, ...(l.block ? { block: l.block } : {}), ...(l.line !== undefined ? { line: l.line } : {}), ...(variant ? { variant } : {}),
  });
  // The breakpoints first (they have no variants), then everything else by the variant they make.
  for (const l of order) for (const t of ["bp.narrow", "bp.wide"] as const) {
    const r = read(l, t, null);
    if (r) { values[t] = r.value; sources[t] = source(l, null); }
  }
  const breakpoint = breakpointOf(width, values["bp.narrow"] as number, values["bp.wide"] as number);
  for (const l of order) for (const t of STYLE_TOKEN_NAMES) {
    if (!hasVariants(t)) continue;
    const v = (breakpoint && read(l, t, breakpoint)) || null;
    const r = v ?? read(l, t, null);
    if (r) { values[t] = r.value; sources[t] = source(l, v ? breakpoint : null); }
  }
  return { values: values as unknown as StyleValues, sources, breakpoint, width, problems };
}

// ── what the outline declares ─────────────────────────────────────────────────

/** A style declaration as the service lists it: what it styles, and its fields. */
export interface StyleSheet {
  /** `global`, `tile:<kind>`, `screen:<name>`, or a style's own name (a page uses it by `[style::name]`). */
  for: string;
  /** The declaring note, and its line when a line (not the note's own properties) declares it. */
  block: string;
  line?: number;
  fields: Record<FieldKey, string>;
}

/** A target's or a named style's name: a slug. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** What `[style-for::…]` can say. */
export type StyleTarget = { level: "global" } | { level: "tile" | "screen"; name: string } | { level: "named"; name: string };

export function parseStyleTarget(raw: string): StyleTarget | null {
  const v = raw.trim().toLowerCase();
  if (v === "global") return { level: "global" };
  const m = /^(tile|screen):(.+)$/.exec(v);
  if (m) return NAME.test(m[2]!) ? { level: m[1] as "tile" | "screen", name: m[2]! } : null;
  return NAME.test(v) && !(STYLE_LEVELS as readonly string[]).includes(v) ? { level: "named", name: v } : null;
}
export const styleTargetText = (t: StyleTarget): string => (t.level === "global" ? "global" : t.level === "named" ? t.name : `${t.level}:${t.name}`);

/** A note, or one line of it, that may declare a style: its properties (a line's: that line's tokens). */
export interface StyleDeclaringBlock { id: string; line?: number; properties: readonly { key: string; value: string }[] }

/** PIE-599's spellings of the heading tokens, read as the cascade's. */
const HEADING_ALIASES: Readonly<Record<string, StyleToken>> = { "heading-margin": "heading.margin", "heading-padding": "heading.padding" };

/**
 * A shorthand's fields: `pad` and `margin` with one number are rows, and columns twice that (cells are about twice
 * as tall as wide); "R C" gives both. Null for any other key.
 */
function shorthand(key: string, value: string, variant: string): Record<FieldKey, string> | null {
  if (key !== "pad" && key !== "margin") return null;
  const m = /^\s*(\d+)(?:\s+(\d+))?\s*$/.exec(value);
  const rows = m ? m[1]! : value, cols = m ? (m[2] ?? String(Number(m[1]) * 2)) : value;
  return { [`${variant}${key}.y`]: rows, [`${variant}${key}.x`]: cols };
}

/**
 * The `style.*` fields among `props` (and PIE-599's `heading-margin`, `heading-padding`): field key → value as
 * written (the first of a key counts); a key that isn't a token is said in `problems`. `aliases`: read the
 * `heading-*` spellings too (a style note does; a heading line's own are its style's, read by heading-styles.ts).
 */
export function styleFieldsOf(props: readonly { key: string; value: string }[], where: string, problems: string[], aliases = true): Record<FieldKey, string> {
  // Precedence within a note, highest first: a field written out (`style.wide.pad.x`), a shorthand's (`style.wide.pad`),
  // a tier's written out (`style.pad.x::… | … | …`), a tier's shorthand (`style.pad::… | … | …`); the first of each wins.
  const fields: Record<FieldKey, string> = {}, short: Record<FieldKey, string> = {}, tiered: Record<FieldKey, string> = {}, tieredShort: Record<FieldKey, string> = {};
  const put = (into: Record<FieldKey, string>, k: FieldKey, v: string) => { if (!(k in into)) into[k] = v; };
  for (const p0 of props) {
    const k = p0.key.toLowerCase();
    if (aliases && HEADING_ALIASES[k]) { put(fields, HEADING_ALIASES[k]!, p0.value); continue; }
    if (!k.startsWith("style.")) continue;
    const rest = k.slice(6), vm = /^((?:narrow|wide)\.)?(.*)$/.exec(rest)!;
    // Tier-keyed (daddy's post): `[style.pad::0 1 | 1 3 | 1 6]` is narrow | normal | wide in one field, shorthand for
    // its width variants. A variant written out beats the one a tier gives (it's read first wherever it is).
    const tiers = !vm[1] && p0.value.includes("|") ? p0.value.split("|").map(x => x.trim()) : null;
    if (tiers && tiers.length !== 3) { problems.push(`${where}: ${k} "${p0.value}" is narrow | normal | wide, three values`); continue; }
    const each: [string, string][] = tiers ? [["narrow.", tiers[0]!], ["", tiers[1]!], ["wide.", tiers[2]!]] : [[vm[1] ?? "", p0.value]];
    for (const [variant, value] of each) {
      const both = shorthand(vm[2]!, value, variant);
      if (both) { for (const [sk, sv] of Object.entries(both)) put(tiers ? tieredShort : short, sk, sv); continue; }
      const f = parseFieldKey(variant + vm[2]!);
      if (!f) { problems.push(`${where}: ${k} isn't a style token (${STYLE_TOKEN_NAMES.join(", ")}, or pad and margin for both axes; narrow. or wide. before one for a width)`); break; }
      put(tiers ? tiered : fields, fieldKey(f.token, f.variant), value);
    }
  }
  for (const from of [short, tiered, tieredShort]) for (const [k, v] of Object.entries(from)) put(fields, k, v);
  return fields;
}

/**
 * The style sheets an outline declares: each `[style-for::target]` with its `[style.<token>::value]` fields, on a note
 * (its own properties) or any line of one (that line's tokens). Every declaration counts, in the order given (a later
 * one for the same target wins field by field); a target that can't be read is said in `problems` and left out.
 */
export function styleSheetsFromBlocks(blocks: readonly StyleDeclaringBlock[]): { sheets: StyleSheet[]; problems: string[] } {
  const sheets: StyleSheet[] = [], problems: string[] = [];
  for (const b of blocks) {
    const raw = b.properties.find(p => p.key.toLowerCase() === "style-for")?.value;
    if (raw === undefined) continue;
    const where = `note ${b.id.slice(0, 8)}${b.line === undefined ? "" : ` line ${b.line + 1}`}`;
    const target = parseStyleTarget(raw);
    if (!target) { problems.push(`${where}: style-for ${JSON.stringify(raw)} is global, tile:<kind>, screen:<name> or a style's name`); continue; }
    const fields = styleFieldsOf(b.properties, where, problems);
    for (const [k, v] of Object.entries(fields)) { const f = parseFieldKey(k)!; const r = parseStyleValue(f.token, v); if ("problem" in r) problems.push(`${where}: ${r.problem}`); }
    sheets.push({ for: styleTargetText(target), block: b.id, ...(b.line !== undefined ? { line: b.line } : {}), fields });
  }
  return { sheets, problems };
}

/** A line that declares a style (it carries `[style-for::…]`): its sheet as the service reads it, or null. */
export function styleDeclarationLine(line: string): StyleSheet | null {
  const tokens = liveTokensInLine(line);
  if (!tokens.some(t => t.key.toLowerCase() === "style-for")) return null;
  return styleSheetsFromBlocks([{ id: "", line: 0, properties: tokens }]).sheets[0] ?? null;
}

// ── a box's attributes ────────────────────────────────────────────────────────

/** One attribute token: `.class`, `key=value`, `key="value"`, or a bare `key` (on). */
const ATTR = /\.([A-Za-z][\w-]*)|([A-Za-z][\w.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/**
 * A `{…}` attribute list (PIE-549: `{border=round bg=raised pad=1 .accent}`), read for the style fields it sets: `pad` and
 * `margin` set both axes (one number is rows, columns twice that; `"1 2"` both), a bare `list.zebra` is on, `narrow.`
 * / `wide.` before a token its width variant. Classes are kept (roles come with colours); a key that isn't a token is
 * said in `problems` and left out.
 */
export function parseStyleAttrs(attrs: string, where = "box"): { fields: Record<FieldKey, string>; classes: string[]; problems: string[] } {
  const classes: string[] = [], problems: string[] = [], props: { key: string; value: string }[] = [];
  for (const m of attrs.matchAll(ATTR)) {
    if (m[1]) { classes.push(m[1]); continue; }
    if (!m[2]) continue;
    props.push({ key: `style.${m[2].toLowerCase()}`, value: m[3] ?? m[4] ?? m[5] ?? "on" });
  }
  const fields = styleFieldsOf(props, where, problems, false);
  return { fields, classes, problems: problems.map(p => p.replace(/ \(.*$/, "").replace("style.", "")) };
}

// ── the layers for a place ────────────────────────────────────────────────────

/** A tile kind's own defaults, under everything the outline says: a reader's text measure, the links tile's group dividers. */
export const TILE_DEFAULTS: Readonly<Record<string, Readonly<Record<FieldKey, string>>>> = {
  // A reader, wide, gets room around its text (daddy's post: padding 1 4). Drawn, never copied: the door's own
  // selection copies the text; a terminal's own copy carries the insets as spaces, which the inspector's help says.
  detail: { measure: "88", "wide.pad.y": "1", "wide.pad.x": "4" },
  reader: { measure: "88", "wide.pad.y": "1", "wide.pad.x": "4" },
  preview: { measure: "88", "wide.pad.y": "1", "wide.pad.x": "4" },
  backlinks: { "list.divider": "dots" },
};

/** Where a thing is drawn: its tile's kind, its screen, and the note it shows. */
export interface StylePlace {
  tile?: string;
  screen?: string;
  /** The page's own properties (the note shown): its `style.*` fields and `[style::name]`. */
  page?: { id: string; properties: readonly { key: string; value: string }[] };
  /** This tile (PIE-675): its id and its own look, as its tile spec keeps it (field key → value as written). */
  instance?: { id: string; fields: Readonly<Record<FieldKey, string>> };
}

/**
 * The layers that style `place`, nearest last: its tile kind's built-in defaults, global, its tile kind's, its
 * screen's, the page's named style, the page's own fields. A component's and a block's layers come after these (a
 * renderer knows where headings and boxes are).
 */
export function styleLayers(sheets: readonly StyleSheet[], place: StylePlace, problems: string[] = []): StyleLayer[] {
  const layer = (level: StyleLevel, label: string, s: StyleSheet): StyleLayer => ({ level, label, block: s.block, ...(s.line !== undefined ? { line: s.line } : {}), fields: s.fields });
  const out: StyleLayer[] = [];
  const own = place.tile ? TILE_DEFAULTS[place.tile] : undefined;
  if (own) out.push({ level: "base", label: `built-in ${place.tile}`, fields: own });
  for (const s of sheets) if (s.for === "global") out.push(layer("global", "global", s));
  if (place.tile) for (const s of sheets) if (s.for === `tile:${place.tile}`) out.push(layer("tile", `tile ${place.tile}`, s));
  if (place.screen) for (const s of sheets) if (s.for === `screen:${place.screen}`) out.push(layer("screen", `screen ${place.screen}`, s));
  const page = place.page;
  if (page) {
    const named = page.properties.find(p => p.key.toLowerCase() === "style")?.value.trim().toLowerCase();
    if (named) {
      const found = sheets.filter(s => s.for === named);
      if (!found.length) problems.push(`page: style ${JSON.stringify(named)} isn't declared ([style-for::${named}] on a note declares it)`);
      for (const s of found) out.push(layer("page", `style ${named}`, s));
    }
    const fields = styleFieldsOf(page.properties, "page", problems, false);
    if (Object.keys(fields).length) out.push({ level: "page", label: "page", block: page.id, fields });
  }
  if (place.instance && Object.keys(place.instance.fields).length) out.push({ level: "instance", label: "this tile", fields: place.instance.fields });
  return out;
}

/** A heading style's own spacing as the component level: what `[heading::band]` brings with it. */
export function headingComponentLayer(style: { name: string; margin: BandMargin; padding: BandRoom; block?: string }): StyleLayer {
  return {
    level: "component", label: `heading ${style.name || "style"}`, ...(style.block ? { block: style.block } : {}),
    fields: { "heading.margin": bandMarginText(style.margin), "heading.padding": bandPaddingText(style.padding) },
  };
}

/** The `[style-for::…]` a value saved at `level` is written under, for `place`; null for the page (its own note) or a level the place hasn't. */
export function levelTarget(level: StyleLevel, place: StylePlace): string | null {
  if (level === "global") return "global";
  if (level === "tile") return place.tile ? `tile:${place.tile}` : null;
  if (level === "screen") return place.screen ? `screen:${place.screen}` : null;
  return null;
}

// ── a list's own look (PIE-675) ───────────────────────────────────────────────

/** A list item's line: `- `, `* `, `+ `, `1. ` or `1) `, at any indent. */
export const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING_LINE = /^ {0,3}#{1,6}\s/;
const indentOf = (l: string) => l.length - l.trimStart().length;

/** Whether a field is a list's (`list.gap`, `narrow.list.divider`): the only fields a list's own lines set. */
export const isListField = (k: FieldKey) => { const f = parseFieldKey(k); return !!f && f.token.startsWith("list."); };

/**
 * The first item of the list line `at` is in (an item, or a line inside one), as a reader runs a list: blank lines
 * and indented lines carry it on, an unindented line that isn't an item ends it. Null when `at` isn't in a list.
 */
export function listStart(lines: readonly string[], at: number): number | null {
  let first: number | null = null;
  for (let i = at; i >= 0; i--) {
    const l = lines[i]!;
    if (LIST_ITEM.test(l)) { if (indentOf(l) === 0) first = i; continue; }
    if (!l.trim() || indentOf(l) > 0) continue;
    break;
  }
  return first;
}

/**
 * Where a list's own look is written, by placement (PIE-675): its lead-in, the line just above its first item when that
 * line isn't blank, an item or a heading (the line the list belongs to), and the heading of the section it's in. Either
 * can be null. A save goes to the lead-in when there is one, else the heading.
 */
export function listOwners(lines: readonly string[], first: number): { lead: number | null; heading: number | null } {
  const above = first > 0 ? lines[first - 1]! : "";
  const lead = first > 0 && above.trim() && !LIST_ITEM.test(above) && !HEADING_LINE.test(above) && !COMPONENT_FENCE.test(above) && indentOf(above) === 0 ? first - 1 : null;
  // The section's heading, within the component it's in: a box's list doesn't reach past its `::box{…}`, and one after a
  // box looks past the box's lines.
  let heading: number | null = null, depth = 0;
  for (let i = first - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (l === "::") { depth++; continue; }
    if (COMPONENT_FENCE.test(l)) { if (depth) { depth--; continue; } break; }
    if (!depth && HEADING_LINE.test(lines[i]!)) { heading = i; break; }
  }
  return { lead, heading };
}
/** A component's fence line (`::box{…}`, `::graph-meter`, `::`). */
const COMPONENT_FENCE = /^::/;

/** The list fields a line sets (`[style.list.gap::1]` on it), as written. */
export function listFieldsOn(line: string): Record<FieldKey, string> {
  const fields = styleFieldsOf(liveTokensInLine(line), "list", [], false);
  return Object.fromEntries(Object.entries(fields).filter(([k]) => isListField(k)));
}

/**
 * A list's own layers (block level, "this list"), the heading's then the lead-in's (nearer), for the list whose first
 * item is line `first` of `lines`. `line(n)`: line n's number as the inspector names it (a reader's body line to the
 * note's), for each layer's source; `block`: the note.
 */
export function listLayers(lines: readonly string[], first: number, block?: string, line: (n: number) => number = n => n): StyleLayer[] {
  const { lead, heading } = listOwners(lines, first);
  return [heading, lead].flatMap(n => {
    if (n === null) return [];
    const fields = listFieldsOn(lines[n]!);
    return [{ level: "block" as const, label: "this list", ...(block ? { block } : {}), line: line(n), fields }];
  });
}
