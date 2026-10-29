// Shared header presentation and front-matter boundaries. The service uses frontMatterLines for block scope;
// headerLine finds only the trailing chips and tags a displayed title leaves out. Mid-title tags stay prose.
// Exports retain tags in the body and move header chips into YAML, without changing the stored source.
// Display parsing bumps GRAMMAR; a change to patch-named header boundaries bumps PROTOCOL.
// Property parsing also bumps the outliner's PROPERTY_PARSER_VERSION.
import { HASHTAG_VALUE_PATTERN, isEscapedAt, isHexColour, PROPERTY_KEY_SOURCE, propertyTokensInLine } from "./property-grammar";

/** One header chip: its key as written, its value (trimmed, otherwise verbatim), where it sits in the text. */
export interface HeaderChip {
  key: string;
  value: string;
  /** Offsets of `[key::value]` in the whole text. */
  start: number;
  end: number;
}

/** A note's header line, split. */
export interface HeaderLine {
  /** The header line's index (0 is the text's first line); -1 when the text is blank. */
  line: number;
  /** Offset of the header line in the text. */
  offset: number;
  /** Offset of the header line's end (its newline, or the text's end). */
  end: number;
  /** How much of the header line, from its start, the prose keeps verbatim. */
  kept: number;
  /** The header line without its trailing chips, hashtags and separators. */
  prose: string;
  /**
   * The ` -` separators of the run (each hyphen with the blanks before it), as offsets in the text: what a title takes
   * out with the chips, so `Seed order - [a::1] - [b::2]` reads "Seed order".
   */
  dashes: LiteralRange[];
  chips: HeaderChip[];
  tags: LiteralRange[];
  /** Export body: the prose with its hashtags retained, then every line after the header. */
  body: string;
}

/** An offset range of the text that is literal (a code span, a fence): a token there is text. */
export interface LiteralRange { start: number; end: number }

/** What may sit between two chips of the run: blanks, or a ` - ` separator (a hyphen with blanks on both sides). */
const SEPARATOR = /^(?:[ \t]*|[ \t]+-[ \t]+)$/;
/** A hashtag in the trailing metadata run (`Shed [type::job] #bikes`). */
const HASHTAG = new RegExp(`(?<=^|[ \\t])#(?=[^ \\t]*\\p{L})(?:${HASHTAG_VALUE_PATTERN.source})(?=[ \\t\\r]|$)`, "gu");
/** A separating ` - ` (or a trailing blank run) at the end of the prose. */
const PROSE_TAIL = /(?:[ \t]+-)?[ \t]+$/;

/**
 * The text's header line: its prose, its chips and the body without them. `literal`: ranges of the text whose tokens
 * are text (the service passes its literal scan; a caller without one passes none).
 */
export function headerLine(text: string, literal: readonly LiteralRange[] = []): HeaderLine {
  const lines = text.split("\n");
  const line = lines.findIndex(l => l.trim() !== "");
  if (line < 0) return { line: -1, offset: 0, end: 0, kept: 0, prose: "", dashes: [], chips: [], tags: [], body: "" };
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i]!.length + 1;
  const source = lines[line]!;
  const inLiteral = (at: number) => literal.some(r => r.start <= at && at < r.end);
  const tokens = propertyTokensInLine(source).filter(t => !inLiteral(offset + t.start));
  const tagged = [...source.matchAll(HASHTAG)]
    .filter(m => !isHexColour(m[0].slice(1)) && !inLiteral(offset + m.index) && !isEscapedAt(source, m.index) && !tokens.some(t => t.start <= m.index && m.index < t.end))
    .map(m => ({ start: m.index, end: m.index + m[0].length }));
  const pieces = [...tokens, ...tagged].sort((a, b) => a.start - b.start);
  let end = source.trimEnd().length;
  const run: typeof pieces = [];
  const dashes: LiteralRange[] = [];
  for (const piece of [...pieces].reverse()) {
    const gap = source.slice(piece.end, end);
    if (run.length ? !SEPARATOR.test(gap) : gap.trim() !== "") break;
    if (gap.includes("-")) dashes.push({ start: offset + piece.end, end: offset + piece.end + gap.indexOf("-") + 1 });
    run.unshift(piece);
    end = piece.start;
  }
  const before = run.length ? source.slice(0, end).replace(PROSE_TAIL, "") : source.trimEnd();
  if (source.slice(before.length, end).includes("-")) dashes.push({ start: offset + before.length, end: offset + source.slice(0, end).lastIndexOf("-") + 1 });
  dashes.sort((a, b) => a.start - b.start);
  const starts = new Set(run.map(t => t.start));
  const chips = tokens.filter(t => starts.has(t.start)).map(t => ({ key: t.raw.slice(1, t.raw.indexOf("::")), value: t.value, start: offset + t.start, end: offset + t.end }));
  const tags = tagged.filter(t => starts.has(t.start)).map(t => ({ start: offset + t.start, end: offset + t.end }));
  // Export keeps authored tags in the body even though the displayed title leaves them out.
  const bodyTitle = [before, ...tags.map(t => text.slice(t.start, t.end))].filter(Boolean).join(" ");
  return { line, offset, end: offset + source.length, kept: before.length, prose: before, dashes, chips, tags, body: [bodyTitle, ...lines.slice(line + 1)].join("\n") };
}

/** A thematic break: `---`, `***` or `___` (three or more) alone on a line. */
const RULE_LINE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t\r]*$/;
const LIST_LINE = /^[ \t]*[-*+][ \t]+/;
const BARE_PROPERTY = new RegExp(String.raw`^(?:${PROPERTY_KEY_SOURCE})::`);
/** A list item that carries properties (`- [a::b] - [c::d]`, `- re:: why`), as floatty wrote its front matter. */
const listProperty = (line: string) => { const rest = line.replace(LIST_LINE, ""); return propertyTokensInLine(rest).length > 0 || BARE_PROPERTY.test(rest); };

/**
 * The title and its first paragraph, bounded by the first blank line (PIE-684), a rule line (`---`) or a list item
 * that carries no property (`- #a - #b`, `- one`): those begin the body, so tags written under a rule are body text
 * (PIE-970). A bulleted line with properties (`- [a::b]`, `- re:: why`) stays in front matter.
 */
export function frontMatterLines(text: string): Set<number> {
  const lines = text.split("\n");
  const start = lines.findIndex(line => line.trim() !== "");
  const found = new Set<number>();
  for (let i = start; i >= 0 && i < lines.length && lines[i]!.trim(); i++) {
    const line = lines[i]!;
    if (i > start && (RULE_LINE.test(line) || (LIST_LINE.test(line) && !listProperty(line)))) break;
    found.add(i);
  }
  return found;
}

/**
 * Where an offset of the text falls in the body (`HeaderLine.body`): the same place, or -1 when it isn't in the body
 * (a chip, a separator, a blank line before the header line).
 */
export function bodyOffset(h: HeaderLine, at: number): number {
  if (h.line < 0) return at;
  if (at < h.offset) return -1;
  if (at < h.offset + h.kept) return at - h.offset;
  if (at <= h.end) return -1;
  return at - (h.end + 1) + h.body.split("\n", 1)[0]!.length + 1;
}

/** A heading's or a list item's marker at the start of a header line (`## `, `- `, `- [ ] `): a title's words come after it. */
const TITLE_MARKER = /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?)/;

/** What `retitle` replaces: the title's words, without its marker (`## `, `- `) or a property written among them. */
export function titleWords(text: string): string {
  const prose = headerLine(text).prose;
  const marker = TITLE_MARKER.exec(prose)?.[0] ?? "";
  let words = prose.slice(marker.length);
  for (const token of propertyTokensInLine(words).reverse()) words = words.slice(0, token.start) + words.slice(token.end);
  return words.replace(/[ \t]+/g, " ").trim();
}

/**
 * The text with its title's words replaced by `title` (one line): the header line's marker (`## `, `- `), any property
 * written among the words (`[type::chirp] Seed swap`) and the trailing chips and hashtags stay, as does every other line.
 * A text with no header line becomes the title. The one rename of a note's title (a template's stamp, a tile's
 * "rename the note it shows").
 */
export function retitle(text: string, title: string): string {
  title = title.replace(/\s*\n\s*/g, " ").trim();
  const h = headerLine(text);
  if (h.line < 0) return title;
  const prose = text.slice(h.offset, h.offset + h.kept);
  const marker = TITLE_MARKER.exec(prose)?.[0] ?? "";
  const inside = propertyTokensInLine(prose.slice(marker.length)).map(token => token.raw);
  const after = text.slice(h.offset + h.kept);
  const words = [title, ...inside].filter(Boolean).join(" ");
  return text.slice(0, h.offset) + marker + words + (words && after && !/^\s/.test(after) ? " " : "") + after;
}

/** A chip as the outline writes it. */
export const chipText = (c: { key: string; value: string }) => `[${c.key}::${c.value}]`;

/** The header line rebuilt: the prose, then each chip in order, joined by ` - `. */
export function joinHeaderLine(prose: string, chips: readonly { key: string; value: string }[]): string {
  return [prose.trimEnd(), ...chips.map(chipText)].filter(Boolean).join(" - ");
}

/** The note's text rebuilt from its header chips and its body (whose first line is the prose): `headerLine`'s inverse. */
export function textFromHeader(chips: readonly { key: string; value: string }[], body: string): string {
  const [prose = "", ...rest] = body.split("\n");
  return [joinHeaderLine(prose, chips), ...rest].join("\n");
}

/** A front-matter field: a key and its value, or its values when the key was written more than once. */
export type FrontMatterField = [key: string, value: string | string[]];

/** The chips as front-matter fields, in order: a key written twice becomes a list at its first place. */
export function headerFields(chips: readonly { key: string; value: string }[]): FrontMatterField[] {
  const out: FrontMatterField[] = [];
  const at = new Map<string, number>();
  for (const { key, value } of chips) {
    const i = at.get(key);
    if (i === undefined) { at.set(key, out.length); out.push([key, value]); continue; }
    const f = out[i]!;
    f[1] = Array.isArray(f[1]) ? [...f[1], value] : [f[1], value];
  }
  return out;
}

/** Front-matter fields back into chips, in order (a list's values one after another). */
export const fieldChips = (fields: readonly FrontMatterField[]) =>
  fields.flatMap(([key, v]) => (Array.isArray(v) ? v : [v]).map(value => ({ key, value })));

// ── front matter: the YAML a note's file starts with ─────────────────────────────────────────────────────────────

/**
 * Fields as a YAML front-matter block (`---` lines around it). Every value is a double-quoted string (a JSON string is a
 * YAML one), so nothing is read as a date, a number or a boolean; a list is one `- "value"` line per value.
 */
export function frontMatter(fields: readonly FrontMatterField[]): string {
  const lines = ["---"];
  for (const [key, v] of fields) {
    if (!Array.isArray(v)) { lines.push(`${yamlKey(key)}: ${yamlString(v)}`); continue; }
    lines.push(`${yamlKey(key)}:`);
    for (const x of v) lines.push(`  - ${yamlString(x)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * A property key is a plain YAML key (a letter, then letters, digits, `_ . -`), unless YAML reads it as something else
 * (`on`, `yes`, `null`, …): that one, and anything else, is quoted.
 */
const yamlKey = (k: string) => (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(k) && !/^(?:y|n|yes|no|on|off|true|false|null)$/i.test(k) ? k : yamlString(k));
/** A double-quoted YAML string: JSON's, with the line and paragraph separators escaped (YAML breaks lines at them). */
const yamlString = (v: string) => JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * A file's front matter and the rest, as `frontMatter` writes it (quoted or plain scalars, `- ` lists); null when the
 * file doesn't start with a `---` block.
 */
export function readFrontMatter(file: string): { fields: FrontMatterField[]; rest: string } | null {
  const lines = file.split("\n");
  if (lines[0] !== "---") return null;
  // The block is the note's first paragraph (PIE-684: everything before the first blank line). A `---` divider with a
  // blank line after it is a divider; a later `---` is another divider, never this one's close.
  const close = lines.indexOf("---", 1);
  const blank = lines.findIndex(l => l.trim() === "");
  if (close < 0 || (blank >= 0 && blank < close)) return null;
  const fields: FrontMatterField[] = [];
  for (const l of lines.slice(1, close)) {
    const item = /^\s+-\s+(.*)$/.exec(l);
    if (item) {
      const f = fields.at(-1);
      if (!f) continue;
      f[1] = [...(Array.isArray(f[1]) ? f[1] : f[1] === "" ? [] : [f[1]]), scalar(item[1]!)];
      continue;
    }
    const kv = /^("(?:[^"\\]|\\.)*"|[^:\s][^:]*?):\s*(.*)$/.exec(l);
    if (kv) fields.push([kv[1]!.startsWith('"') ? JSON.parse(kv[1]!) : kv[1]!, scalar(kv[2]!)]);
  }
  // Divider lines around prose hold no fields: only a block with a field (or an empty `---`/`---` pair) is front matter.
  if (fields.length === 0 && close > 1) return null;
  return { fields, rest: lines.slice(close + 1).join("\n") };
}

const scalar = (s: string) => {
  const t = s.trim();
  if (t.startsWith('"')) { try { return JSON.parse(t) as string; } catch { return t; } }
  if (t.startsWith("'") && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};

// ── a note as a Markdown file ────────────────────────────────────────────────────────────────────────────────────

/** What a note's front matter says about the note itself, before its header's chips, in this order. */
export const IDENTITY_KEYS = ["id", "parent", "created", "updated", "author", "actor"] as const;
export type NoteIdentity = Partial<Record<(typeof IDENTITY_KEYS)[number], string>>;

/**
 * A note as a Markdown file: front matter (its identity, then its header's chips), then its body. A chip whose key is
 * an identity key would be read back as identity, so it stays where it was written, in the body's first line. The file
 * ends in a newline after the body (a body's own trailing newlines are kept before it).
 */
export function noteFile(identity: NoteIdentity, chips: readonly { key: string; value: string }[], body: string): string {
  const reserved = (k: string) => (IDENTITY_KEYS as readonly string[]).includes(k.toLowerCase());
  const kept = chips.filter(c => reserved(c.key));
  const [prose = "", ...rest] = body.split("\n");
  const fields: FrontMatterField[] = IDENTITY_KEYS.flatMap(k => (identity[k] === undefined ? [] : [[k, identity[k]!] as FrontMatterField]));
  return `${frontMatter([...fields, ...headerFields(chips.filter(c => !reserved(c.key)))])}\n${[joinHeaderLine(prose, kept), ...rest].join("\n")}\n`;
}

/**
 * A note's file read back: its identity, the chips its front matter holds (in order) and its text rebuilt. Chips kept
 * in the body's first line (an identity key's) stay there, before the rebuilt run. Null without front matter.
 */
export function readNoteFile(file: string): { identity: NoteIdentity; chips: { key: string; value: string }[]; text: string } | null {
  const read = readFrontMatter(file);
  if (!read) return null;
  const identity: NoteIdentity = {};
  const header: FrontMatterField[] = [];
  for (const f of read.fields) {
    if ((IDENTITY_KEYS as readonly string[]).includes(f[0]) && !Array.isArray(f[1])) identity[f[0] as keyof NoteIdentity] = f[1];
    else header.push(f);
  }
  const chips = fieldChips(header);
  // The newline noteFile ends a file with is the file's, not the note's.
  return { identity, chips, text: textFromHeader(chips, read.rest.replace(/\n$/, "")) };
}

/** A header line without its run's ` -` separators (the chips stay): for a client that strips the tokens itself. */
export function withoutHeaderDashes(line: string): string {
  let out = "", cursor = 0;
  const header = headerLine(line);
  for (const d of [...header.dashes, ...header.tags].sort((a, b) => a.start - b.start)) { out += line.slice(cursor, d.start); cursor = d.end; }
  return out + line.slice(cursor);
}
