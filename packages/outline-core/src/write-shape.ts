// How a written note is shaped (PIE-1270): the house rules the write tools' descriptions state, measured in code on the
// text a write left, so the answer can say what to fix before the writer calls it done. Deterministic and pure: a
// title over about 70 characters, a paragraph past three sentences, a long run of prose with no figure or callout, a
// callout inside a callout, a question for Evan below the top with no `[needs::sysop]`. The service never refuses a
// save over these (capture is more reliable than interpretation); the write answer lists them in `warnings`, worded as
// a gate, and always ends with the next check.
//
// Judgments code can't make (is this title a name or a paragraph, does this ask Evan something) are PIE-1251's Jev
// kinds: they add findings of their own beside `writeShape`'s (same `ShapeFinding`, a `rule` and a `key`), and the
// agent tools' `shapeWarnings` is the one place the lists meet.

import { calloutBlocks, quoteDepth, stripQuotes } from "./callouts";
import { componentBlocks, noteStructure } from "./component-block";
import { headerLine } from "./header-line";

/** The limits the rules measure against, said once: the tool descriptions and the findings quote them. */
export const SHAPE_LIMITS = {
  /** A title line is a name; the detail goes in the body. */
  title: 70,
  /** A paragraph holds at most this many sentences. */
  sentences: 3,
  /** A paragraph past this many characters is a wall whatever its punctuation. */
  paragraphChars: 500,
  /** This many lines of prose with no figure, callout or view in the note is prose where a component would read better. */
  proseAlone: 12,
  /** This many lines of prose is too long whatever else the note holds. */
  proseAny: 40,
  /** A question for Evan belongs in the first lines; one below line `top` is buried. */
  top: 8,
} as const;

export type ShapeRule = "title" | "wall" | "prose" | "callout-nesting" | "question";

export interface ShapeFinding {
  rule: ShapeRule;
  /** Stable for the same problem in the same place, so an edit can tell a finding the note already had from a new one. */
  key: string;
  /** The smallest fix, as an instruction. */
  say: string;
}

/** `note`: a note or a block (the default); `comment`: a margin comment, which has no title and asks nothing of Evan. */
export interface ShapeOptions { kind?: "note" | "comment" }

/** What every finding is listed under in a write's `warnings`: a gate on calling the write done, not a suggestion. */
export const FIX_BEFORE_DONE = "fix before you call this done: ";

/** The line every write answer ends with. `id` is the block written (a thread's note, for a comment). */
export const shapeNext = (id: string) => `read it as drawn before you call it done: \`ep0ch show ${id}\` (or outline_read it back)`;

const excerpt = (text: string, max = 48) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Sentences in a paragraph: a terminator followed by a space and a capital or digit, or ending it; code, links, properties and abbreviations aren't ends. */
export function sentenceCount(paragraph: string): number {
  const flat = paragraph
    .replace(/\[[\w-]+::[^\]]*\]/g, " ")
    .replace(/`[^`]*`/g, "x")
    .replace(/\(\([^)]*\)\)|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, "x")
    .replace(/https?:\/\/\S*[^\s.,;:!?)]/g, "x")
    .replace(/\b(?:e\.g|i\.e|etc|vs|approx|fig|no|cf|dr|mr|mrs|ms|prof|st|jr|sr)\./gi, "x")
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return 0;
  return Math.max(1, (flat.match(/[.!?]+(?=\s+["'(\[*_`]*[\p{Lu}\d]|\s*$)/gu) ?? []).length);
}

const HEADING = /^[ \t]{0,3}#{1,6}[ \t]/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
const TABLE_ROW = /^[ \t]*\|/;
const RULE_LINE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const PROPERTY_CHIP = /\[[\w-]+::[^\]]*\]/g;
const CALLOUT_OPEN = /^\[![^\]]+\]/;

interface Paragraph { line: number; text: string; lines: number; item: boolean }

/**
 * The prose units of a note: each run of plain lines, and each list item (with its continuation lines), in or out of a
 * callout, with the line it starts on. Headings, tables, rules, callout headers, components, code fences and a note's
 * title line are not prose.
 */
function paragraphs(text: string, comment: boolean): Paragraph[] {
  const lines = text.split("\n");
  const structure = noteStructure(lines);
  const title = comment ? -1 : headerLine(text).line;
  const out: Paragraph[] = [];
  let open: (Paragraph & { depth: number }) | null = null;
  const close = () => {
    // A `[key::value]` chip is a property, not prose: its value (a URL, a path) never makes a paragraph long.
    const text = open?.text.replace(PROPERTY_CHIP, " ").replace(/\s+/g, " ").trim();
    if (open && text) out.push({ line: open.line, text, lines: open.lines, item: open.item });
    open = null;
  };
  lines.forEach((raw, i) => {
    if (structure[i]! !== -1 || i === title) { close(); return; }
    const { depth } = quoteDepth(raw);
    const content = stripQuotes(raw, depth).replace(/\r$/, "");
    if (!content.trim() || HEADING.test(content) || TABLE_ROW.test(content) || RULE_LINE.test(content) || CALLOUT_OPEN.test(content.trim())) { close(); return; }
    if (LIST_ITEM.test(content)) { close(); open = { line: i, text: content.replace(LIST_ITEM, ""), lines: 1, depth, item: true }; return; }
    if (open && open.depth === depth) { open.text += ` ${content.trim()}`; open.lines++; return; }
    close();
    open = { line: i, text: content.trim(), lines: 1, depth, item: false };
  });
  close();
  return out;
}

/** The measure of `text`, and every rule it breaks. `comment` text is measured for walls alone. */
export function writeShape(text: string, o: ShapeOptions = {}): ShapeFinding[] {
  const found: ShapeFinding[] = [];
  const comment = o.kind === "comment";
  const lines = text.split("\n");
  const prose = paragraphs(text, comment);

  if (!comment) {
    const title = headerLine(text).prose.trim();
    if (title.length > SHAPE_LIMITS.title) {
      found.push({
        rule: "title", key: "title",
        say: `the title line is ${title.length} characters (keep it under ${SHAPE_LIMITS.title}): make it a short name, "${excerpt(title, 40)}", and move the rest under it`,
      });
    }
  }

  for (const p of prose) {
    const sentences = sentenceCount(p.text);
    if (sentences > SHAPE_LIMITS.sentences || p.text.length > SHAPE_LIMITS.paragraphChars) {
      found.push({
        rule: "wall", key: `wall:${p.text.slice(0, 24)}…${p.text.slice(-24)}`,
        say: `line ${p.line + 1} ("${excerpt(p.text, 32)}") is ${sentences} sentences, ${p.text.length} characters: a paragraph is at most ${SHAPE_LIMITS.sentences} sentences; split it, or make it a list, a callout or a figure`,
      });
    }
  }

  if (!comment) {
    const proseLines = prose.reduce((n, p) => n + (p.item ? 0 : p.lines), 0);
    const components = componentBlocks(lines).length + calloutBlocks(lines).length;
    if ((proseLines >= SHAPE_LIMITS.proseAlone && components === 0) || proseLines >= SHAPE_LIMITS.proseAny) {
      found.push({
        rule: "prose", key: "prose",
        say: `${proseLines} lines of prose${components ? ` against ${components} component${components === 1 ? "" : "s"}` : " and no figure, callout or view"}: put counts and statuses in a live figure (graph-stat, graph-table, graph-check), asides in a callout, and keep a section to one component plus three short lines`,
      });
    }

    const callouts = calloutBlocks(lines);
    for (const inner of callouts) {
      if (callouts.some(outer => outer !== inner && outer.line < inner.line && inner.line < outer.end && outer.depth < inner.depth)) {
        found.push({ rule: "callout-nesting", key: `nest:${excerpt(lines[inner.line]!, 40)}`, say: `the callout on line ${inner.line + 1} sits inside another callout: make it a heading, or close the outer one first` });
      }
    }

    if (!/\[needs::\s*sysop/i.test(text)) {
      const structure = noteStructure(lines);
      const buried = lines.findIndex((line, i) => i >= SHAPE_LIMITS.top && structure[i] === -1 && asksEvan(line));
      if (buried >= 0) {
        found.push({
          rule: "question", key: `question:${excerpt(lines[buried]!, 40)}`,
          say: `line ${buried + 1} asks Evan something below the top ("${excerpt(lines[buried]!, 32)}"): put the question first as one "- [ ]" line and mark the note [needs::sysop: the decision]`,
        });
      }
    }
  }
  return found;
}

/** A line that asks Evan: names him and has a question mark or a decision word. A heuristic until PIE-1251's judgment replaces it. */
export function asksEvan(line: string): boolean {
  return /\bEvan\b/.test(line) && (/\?/.test(line) || /\b(?:decide|should we)\b/i.test(line));
}

/**
 * The findings for a write's answer, each worded as a gate. With `before` (the text the write changed), a finding the
 * note already had is left out (a wall is matched by its first and last words, so a word fixed in the middle is still
 * the same wall): an append to an old note is told what the append did, not what the note was.
 */
export function shapeWarnings(text: string, before?: string, o: ShapeOptions = {}): string[] {
  // Counted, not just seen: a second copy of a wall the note already had is a new wall.
  const had = new Map<string, number>();
  for (const f of before === undefined ? [] : writeShape(before, o)) had.set(f.key, (had.get(f.key) ?? 0) + 1);
  return writeShape(text, o).filter(f => { const n = had.get(f.key) ?? 0; if (n) had.set(f.key, n - 1); return !n; }).map(f => FIX_BEFORE_DONE + f.say);
}
