// A note's header line: the `[key::value]` chips that end its first line (PIE-534). This file is the one definition.
// The service's parser gives exactly these chips block scope (properties.ts), the service's titles leave them and their
// separators out, Detail's property table marks them `header`, and an export moves them into a Markdown file's front
// matter and back. It sits on the property grammar (property-grammar.ts) and does no I/O; a change to what it matches
// bumps PROTOCOL (and the outliner's PROPERTY_PARSER_VERSION).
//
// The header line is the first line that holds anything but blanks. Its chips are the run of unescaped `[key::value]`
// tokens at its end, separated by blanks or by ` - ` (`Seed order [type::errand] - [area::garden]`), with nothing but
// blanks after the last. A token inside a literal range the caller names (a code span, a fence: the service's literal
// scan) is text, and so is one that other text follows (`[who::Sam] said so` is an inline aside). What comes before the
// run, less a separating ` -`, is the line's prose: usually the note's title. The body is the prose, then every line
// after the header line. A hashtag among the chips doesn't end the run: it stays in the prose (it is prose, and a tag).
//
// Front matter carries the chips as written, in order: values stay verbatim strings (never a date), and a key written
// twice becomes a list at its first place. Rebuilding joins the prose and the chips with ` - `. Only spacing, the
// separators and where a repeated key's values sit are normalized; `headerLine` reads the rebuilt line back to the same
// prose and chips.
import { HASHTAG_VALUE_PATTERN, propertyTokensInLine } from "./property-grammar";

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
  /** How much of the header line, from its start, the prose keeps verbatim (hashtags among the chips follow it). */
  kept: number;
  /** The header line without its chips (and without the ` -` before them); hashtags among them come after. */
  prose: string;
  /**
   * The ` -` separators of the run (each hyphen with the blanks before it), as offsets in the text: what a title takes
   * out with the chips, so `Seed order - [a::1] - [b::2]` reads "Seed order".
   */
  dashes: LiteralRange[];
  chips: HeaderChip[];
  /** The prose, then every line after the header line: the note without its chips. Its first line is always the prose. */
  body: string;
}

/** An offset range of the text that is literal (a code span, a fence): a token there is text. */
export interface LiteralRange { start: number; end: number }

/** What may sit between two chips of the run: blanks, or a ` - ` separator (a hyphen with blanks on both sides). */
const SEPARATOR = /^(?:[ \t]*|[ \t]+-[ \t]+)$/;
/** A hashtag among the chips (`Shed [type::job] #bikes`): it stays with the prose, and the run goes on past it. */
const HASHTAG = new RegExp(`(?<=^|[ \\t])#(?=[^ \\t]*\\p{L})(?:${HASHTAG_VALUE_PATTERN.source})(?=[ \\t]|$)`, "gu");
/** A separating ` - ` (or a trailing blank run) at the end of the prose. */
const PROSE_TAIL = /(?:[ \t]+-)?[ \t]+$/;

/**
 * The text's header line: its prose, its chips and the body without them. `literal`: ranges of the text whose tokens
 * are text (the service passes its literal scan; a caller without one passes none).
 */
export function headerLine(text: string, literal: readonly LiteralRange[] = []): HeaderLine {
  const lines = text.split("\n");
  const line = lines.findIndex(l => l.trim() !== "");
  if (line < 0) return { line: -1, offset: 0, end: 0, kept: 0, prose: "", dashes: [], chips: [], body: "" };
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i]!.length + 1;
  const source = lines[line]!;
  const inLiteral = (at: number) => literal.some(r => r.start <= at && at < r.end);
  const tokens = propertyTokensInLine(source).filter(t => !inLiteral(offset + t.start));
  // The run: back from the line's end, the last token followed by blanks only, each before it by a separator.
  let first = tokens.length, end = source.replace(/[ \t\r]+$/, "").length;
  const tags: string[][] = [];
  const dashes: LiteralRange[] = [];
  const dashIn = (from: number, to: number) => {
    // The hyphen (never one inside a hashtag), with the blanks right before it.
    const k = source.slice(from, to).replace(HASHTAG, h => " ".repeat(h.length)).indexOf("-");
    if (k < 0) return;
    let start = from + k;
    while (start > from && /[ \t]/.test(source[start - 1]!)) start--;
    dashes.unshift({ start: offset + start, end: offset + from + k + 1 });
  };
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    const between = source.slice(t.end, end);
    const after = between.replace(HASHTAG, "");
    if (i === tokens.length - 1 ? after.trim() !== "" : !SEPARATOR.test(after)) break;
    tags.unshift(between.match(HASHTAG) ?? []);
    if (i < tokens.length - 1) dashIn(t.end, end);
    first = i;
    end = t.start;
  }
  const run = tokens.slice(first);
  const chips = run.map(t => ({ key: t.raw.slice(1, t.raw.indexOf("::")), value: t.value, start: offset + t.start, end: offset + t.end }));
  const before = run.length ? source.slice(0, run[0]!.start).replace(PROSE_TAIL, "") : source.replace(/[ \t\r]+$/, "");
  if (run.length && before.length < run[0]!.start) dashIn(before.length, run[0]!.start);
  const prose = [before, ...tags.flat()].filter(Boolean).join(" ");
  return { line, offset, end: offset + source.length, kept: before.length, prose, dashes, chips, body: [prose, ...lines.slice(line + 1)].join("\n") };
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
  return at - (h.end + 1) + h.prose.length + 1;
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
  const close = lines.indexOf("---", 1);
  if (close < 0) return null;
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
  for (const d of headerLine(line).dashes) { out += line.slice(cursor, d.start); cursor = d.end; }
  return out + line.slice(cursor);
}
