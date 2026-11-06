// What a mark is, with no I/O: the words it quotes, the chip it writes, and which chips are its own. Tokens are found by
// the shared property parser, so a fence or a code span is never touched. The judgment (does this line ask?) is the
// service's (`blocks.asks`); this is only where it lands.
import { FRAGMENT_ID_SOURCE, parsePropertyRecords, sourceLines } from "./link-grammar.js";

const NEEDS = "needs", MAYBE = "maybe-needs", MARK = "asks.derived";
const WORDS = 100;

const CHIP = /\[[\w.-]+::[^\]\n]*\]/g;
const LEAD = /^[ \t>]*(?:[-*+][ \t]+(?:\[.\][ \t]+)?|\d+[.)][ \t]+)?/;
const ANSWERED = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[[^ \]]\]/;
const INDENT = /^[ \t>]*/;
const TAIL_ANCHOR = new RegExp(`[ \\t]+\\^${FRAGMENT_ID_SOURCE}[ \\t]*$`);

/** A line's own words: no chips, no list mark, no anchor, links as their labels, nothing a chip's value can't hold. */
export function wordsOf(line: string): string {
  const flat = line.replace(CHIP, " ").replace(TAIL_ANCHOR, "").replace(LEAD, "")
    .replace(/\(\([^)|]*\|([^)]*)\)\)/g, "$1").replace(/\(\([^)]*\)\)/g, " ")
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, page: string, label?: string) => label ?? page)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*[\]]/g, "")
    .replace(/\s+/g, " ").trim();
  return flat.length > WORDS ? `${flat.slice(0, WORDS - 1).trimEnd()}…` : flat;
}

/** The mark's value names the chip it belongs to, by key and value: what's ours wherever it sits on the line. */
const ownerOf = (key: string, value: string) => Bun.hash(`${key}\n${value}`).toString(36);

/** A line with its chip and mark, before an anchor at its end, which only holds there. */
export function withMark(line: string, reads: "yes" | "unsure"): string {
  const [key, value] = reads === "yes" ? [NEEDS, `sysop: ${wordsOf(line)}`] : [MAYBE, "sysop"];
  const anchor = TAIL_ANCHOR.exec(line)?.[0] ?? "";
  const body = line.slice(0, line.length - anchor.length).trimEnd();
  return `${body} [${key}::${value}] [${MARK}::${ownerOf(key, value)}]${anchor}`;
}

/** The lines that already hold a needs chip, by anyone: never marked. */
export const chippedLines = (text: string) => new Set(parsePropertyRecords(text).filter(r => r.key === NEEDS || r.key === MAYBE).map(r => r.line));

export interface Mark { line: number; spans: { start: number; end: number }[] }

/** Each real mark in `text` (never one in a fence or code span), with its own chip if it's still as written. */
export function marksIn(text: string): Mark[] {
  const records = parsePropertyRecords(text);
  return records.filter(r => r.key === MARK).map(mark => {
    const chip = records.find(r => r.line === mark.line && (r.key === NEEDS || r.key === MAYBE) && ownerOf(r.key, r.value) === mark.value);
    return { line: mark.line, spans: [...(chip ? [chip] : []), mark].map(r => ({ start: r.start, end: r.end })) };
  });
}

/** `text` without these marks and their chips, and the space before each. */
export function withoutMarks(text: string, marks: readonly Mark[]): string {
  let out = text;
  for (const span of marks.flatMap(m => m.spans).sort((a, b) => b.start - a.start)) {
    let start = span.start;
    while (start > 0 && (out[start - 1] === " " || out[start - 1] === "\t")) start--;
    out = out.slice(0, start) + out.slice(span.end);
  }
  return out;
}

/** A ticked box, any mark but the open one. */
export const isAnswered = (line: string) => ANSWERED.test(line);

/** The lines right under line `i` that sit deeper than it: what a reply under it adds to. */
export function linesUnder(lines: readonly string[], i: number): number {
  const depth = INDENT.exec(lines[i]!)![0].length;
  let n = 0;
  for (let k = i + 1; k < lines.length; k++) {
    if (!lines[k]!.trim()) { if (n) break; continue; }
    if (INDENT.exec(lines[k]!)![0].length <= depth) break;
    n++;
  }
  return n;
}

/** Stable for the same words, whatever chips or marks the line has since: what "this line again" means. */
export function hashOf(line: string): string {
  return Bun.hash(wordsOf(line).toLowerCase()).toString(36);
}

export type Anchor = { kind: string; itemId?: string; start?: number | null; end?: number | null; exact?: string };

/** What a comment's anchor is about, as a test on a line: every line for the whole note, none when it can't be placed. */
export function aboutLines(anchor: Anchor | undefined, text: string): ((i: number, lines: readonly string[]) => boolean) | null {
  if (anchor?.kind === "whole-subject") return () => true;
  if (anchor?.kind === "list-item") {
    const at = new RegExp(`(?:^|\\s)\\^${anchor.itemId}(?:\\s|$)`);
    return (i, lines) => at.test(lines[i]!);
  }
  if (anchor?.kind !== "text-quote" || !anchor.exact) return null;
  const { start, end, exact } = anchor;
  // Its resolved range; moved since, where its words are now if that's one place.
  const from = typeof start === "number" && typeof end === "number" && text.slice(start, end) === exact ? start : text.indexOf(exact) === text.lastIndexOf(exact) ? text.indexOf(exact) : -1;
  if (from < 0) return null;
  const ranges = sourceLines(text);
  return i => from < ranges[i]!.contentEnd && from + exact.length > ranges[i]!.start;
}

/** One patch per changed line, so a note being typed in elsewhere isn't one span from the first mark to the last. */
export function linePatches(before: string, after: readonly string[]): { observed: string; replacement: string; range: { start: number; end: number } }[] {
  const lines = before.split("\n"), ranges = sourceLines(before);
  return lines.flatMap((line, i) => line === after[i] ? [] : [{ observed: line, replacement: after[i]!, range: { start: ranges[i]!.start, end: ranges[i]!.start + line.length } }]);
}
