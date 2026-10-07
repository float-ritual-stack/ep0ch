// Heading styles (PIE-599): how a heading or a rule (`---`) is drawn, declared in the outline the way callout types
// are. The source stays plain Markdown: `## Your calls [heading::band]` is a level-2 heading whatever draws it, and
// `--- [rule::fade]` a rule. A style names a glyph track (the figures' patterns), how many rows the band takes, where
// the heading sits in it, its padding, margin, tone and lettering. The service lists an outline's styles
// (`headings.styles`: these built-ins plus the notes that declare `[heading-style::name]`); the door draws by them,
// and a client that doesn't (Detail, the publisher, an export) shows the heading or rule as written. A style can be a
// level's default (`[heading-default::1]`, or `rule` for every `---`), so plain Markdown gets the look with no
// property. Pure: no I/O. A change to what it matches bumps PROTOCOL (protocol.ts).

import { CALLOUT_TONES, type CalloutTone } from "./callouts";
import { propertyTokensInLine } from "./property-grammar";

export const BAND_PATTERNS = ["stack", "waffle", "uptime", "dots", "rule"] as const;
export type BandPattern = (typeof BAND_PATTERNS)[number];
export const BAND_ALIGNS = ["left", "center", "right"] as const;
export type BandAlign = (typeof BAND_ALIGNS)[number];
export const BAND_ROWS = ["top", "middle", "bottom"] as const;
export type BandRow = (typeof BAND_ROWS)[number];
/** How the heading's letters are drawn in the band: as written, in capitals, or in spaced capitals (`Y O U R`). */
export const BAND_LETTERS = ["plain", "upper", "spaced"] as const;
export type BandLetters = (typeof BAND_LETTERS)[number];

/** Room in rows and columns (padding around the heading, margin around the band). */
export interface BandRoom { rows: number; cols: number }

/**
 * One heading style. `rows`: the band's height (1 to 3). `row`: the band row the heading is on. `tone`: the heading's
 * colour family (the callouts' tones; neutral keeps the level's own colour). `defaults`: the heading levels (1 to 6)
 * it draws when a heading names no style, and `rule` for a `---` that names none. `block`: the note declaring it.
 */
export interface HeadingStyle {
  name: string;
  pattern: BandPattern;
  rows: number;
  align: BandAlign;
  row: BandRow;
  padding: BandRoom;
  margin: BandRoom;
  tone: CalloutTone;
  letters: BandLetters;
  defaults: readonly (number | "rule")[];
  block?: string;
}

const style = (name: string, s: Partial<HeadingStyle>): HeadingStyle => ({
  name, pattern: "stack", rows: 3, align: "center", row: "middle", padding: { rows: 0, cols: 2 }, margin: { rows: 0, cols: 0 }, tone: "neutral", letters: "plain", defaults: [], ...s,
});

/** The styles every outline has. None is a default: a heading draws plain until the outline says otherwise. */
export const BUILTIN_HEADING_STYLES: readonly HeadingStyle[] = [
  style("band", { letters: "spaced" }),
  style("tab", { align: "left", row: "top", letters: "upper", padding: { rows: 0, cols: 1 } }),
  style("waffle", { pattern: "waffle" }),
  style("uptime", { pattern: "uptime", rows: 2, align: "left", row: "bottom" }),
  style("dots", { pattern: "dots", align: "left" }),
  style("rule", { pattern: "rule", letters: "upper" }),
  // For `---`: one row that fades in from both edges.
  style("fade", { rows: 1 }),
];

export interface HeadingStyleRegistry {
  readonly styles: readonly HeadingStyle[];
  /** The style `name` names, or null when nothing declares it. */
  style(name: string): HeadingStyle | null;
  /** The style a heading of `level` draws with when it names none, or null (plain). */
  forLevel(level: number): HeadingStyle | null;
  /** The style a `---` that names none draws with, or null (plain). */
  forRule(): HeadingStyle | null;
}

/** The built-ins and `custom` styles: a custom one named as a built-in restyles it. The last default a level gets wins. */
export function headingStyleRegistry(custom: readonly HeadingStyle[] = []): HeadingStyleRegistry {
  const styles: HeadingStyle[] = BUILTIN_HEADING_STYLES.map(s => ({ ...s }));
  for (const c of custom) {
    const at = styles.findIndex(s => s.name === c.name);
    if (at >= 0) styles[at] = c; else styles.push(c);
  }
  const by = new Map(styles.map(s => [s.name, s]));
  const defaults = new Map<number | "rule", HeadingStyle>();
  for (const s of styles) for (const d of s.defaults) defaults.set(d, s);
  return {
    styles,
    style: name => by.get(name.trim().toLowerCase()) ?? null,
    forLevel: level => defaults.get(level) ?? null,
    forRule: () => defaults.get("rule") ?? null,
  };
}

/** The built-ins alone: what a client draws with before (or without) the outline's list. */
export const BUILTIN_HEADING_STYLE_REGISTRY = headingStyleRegistry();

// ── styles the outline declares ───────────────────────────────────────────────

/** A style's name: a slug, as `[heading::name]` writes it. */
export const HEADING_STYLE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A note's properties, as the service lists them. */
export interface HeadingStyleDeclaringBlock { id: string; properties: readonly { key: string; value: string }[] }

const ROOM = /^\s*(\d+)(?:\s+(\d+))?\s*$/;

/**
 * The heading styles an outline declares: each note with `[heading-style::name]`, and on the same note
 * `[heading-pattern::stack]` (stack, waffle, uptime, dots or rule), `[heading-rows::3]` (1 to 3),
 * `[heading-align::center]`, `[heading-row::middle]`, `[heading-padding::2]` and `[heading-margin::0]` (columns, or
 * "rows columns"), `[heading-tone::blue]` (a callout tone), `[heading-letters::spaced]` (plain, upper or spaced) and
 * `[heading-default::1, 2]` (the levels it draws when a heading names no style; `rule` for every `---`). A field left
 * out keeps the built-in's of that name, else the default. What can't be used is said in `problems` and falls back,
 * so one mistake never hides the rest. The first note to claim a name has it.
 */
export function headingStylesFromBlocks(blocks: readonly HeadingStyleDeclaringBlock[]): { styles: HeadingStyle[]; problems: string[] } {
  const styles: HeadingStyle[] = [], problems: string[] = [];
  for (const b of blocks) {
    const prop = (k: string) => b.properties.find(p => p.key.toLowerCase() === k)?.value.trim();
    const raw = prop("heading-style");
    if (raw === undefined) continue;
    const name = raw.toLowerCase(), where = `note ${b.id.slice(0, 8)}`;
    if (!HEADING_STYLE_NAME.test(name)) { problems.push(`${where}: heading-style ${JSON.stringify(raw)} isn't a name (letters, digits, - and _)`); continue; }
    if (styles.some(s => s.name === name)) { problems.push(`${where}: heading style ${name} is declared already`); continue; }
    const base = BUILTIN_HEADING_STYLES.find(s => s.name === name) ?? style(name, {});
    const oneOf = <T extends string>(key: string, all: readonly T[], fallback: T): T => {
      const v = prop(key)?.toLowerCase();
      if (v === undefined) return fallback;
      if ((all as readonly string[]).includes(v)) return v as T;
      problems.push(`${where}: ${key} ${JSON.stringify(v)} is one of ${all.join(", ")}`);
      return fallback;
    };
    const room = (key: string, fallback: BandRoom, most: BandRoom): BandRoom => {
      const v = prop(key);
      if (v === undefined) return fallback;
      const m = ROOM.exec(v);
      if (!m) { problems.push(`${where}: ${key} ${JSON.stringify(v)} is columns, or "rows columns"`); return fallback; }
      const [rows, cols] = m[2] === undefined ? [fallback.rows, Number(m[1])] : [Number(m[1]), Number(m[2])];
      return { rows: Math.min(most.rows, rows), cols: Math.min(most.cols, cols) };
    };
    let rows = base.rows;
    const rowsRaw = prop("heading-rows");
    if (rowsRaw !== undefined) {
      if (/^[123]$/.test(rowsRaw)) rows = Number(rowsRaw);
      else problems.push(`${where}: heading-rows ${JSON.stringify(rowsRaw)} is 1, 2 or 3`);
    }
    const defaults: (number | "rule")[] = [];
    for (const d of (prop("heading-default") ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) {
      if (d === "rule") defaults.push("rule");
      else if (/^[1-6]$/.test(d)) defaults.push(Number(d));
      else problems.push(`${where}: heading-default ${JSON.stringify(d)} is a level (1 to 6) or rule`);
    }
    styles.push({
      name,
      pattern: oneOf("heading-pattern", BAND_PATTERNS, base.pattern),
      rows,
      align: oneOf("heading-align", BAND_ALIGNS, base.align),
      row: oneOf("heading-row", BAND_ROWS, base.row),
      padding: room("heading-padding", base.padding, { rows: 2, cols: 12 }),
      margin: room("heading-margin", base.margin, { rows: 3, cols: 24 }),
      tone: oneOf("heading-tone", CALLOUT_TONES, base.tone),
      letters: oneOf("heading-letters", BAND_LETTERS, base.letters),
      defaults,
      block: b.id,
    });
  }
  return { styles, problems };
}

// ── the lines that name one ───────────────────────────────────────────────────

/** A Markdown ATX heading as the door's reader reads one: its `#`s and the rest. */
const ATX = /^(#{1,6})\s+(.*)$/;
/** A thematic break (`---`, `***`, `___`, spaced or not), and what follows it on its line. */
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*(.*)$/;

/** What a line says about its style: a heading's or a rule's `[heading::x]` / `[rule::x]`, and the line without it. */
export interface StyledLine {
  kind: "heading" | "rule";
  /** The heading's level; 0 for a rule. */
  level: number;
  /** The style the line names, lowercased, or null when it names none. */
  style: string | null;
  /** The line without that property (the heading's text keeps any other). */
  text: string;
}

/**
 * The style a heading or rule line names: `## Your calls [heading::band]`, `--- [rule::fade]`. Null when the line is
 * neither (a rule with anything but its property after it is text, as Markdown reads it).
 */
export function styledLine(line: string): StyledLine | null {
  const h = ATX.exec(line);
  const r = h ? null : RULE.exec(line);
  if (!h && !r) return null;
  const key = h ? "heading" : "rule";
  const token = propertyTokensInLine(line).find(t => t.key === key);
  const text = token ? (line.slice(0, token.start).trimEnd() + (line.slice(token.end).trim() ? " " + line.slice(token.end).trim() : "")) : line;
  if (r && RULE.exec(text)![2]!.trim()) return null;
  return { kind: key, level: h ? h[1]!.length : 0, style: token ? token.value.toLowerCase() : null, text };
}
