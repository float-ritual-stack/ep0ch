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
import { blockReferenceOccurrences } from "./link-syntax";
import { parsePropertyRecords } from "./property-parse";

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
  /** The columns Evan reads a note in: a desk tile, four across his door (loki, Oct 29). The render check draws at it. */
  readingWidth: 44,
  /** The top of a note: its first this many lines under the title (blank ones aside), where an ask reads first. */
  topLines: 3,
  /** A list item is one point; past this many (sentences, and clauses after `;` or a dash) it is points stacked in one bullet (PIE-1388). */
  itemPoints: 2,
  /** A list item past this many characters is a wall whatever its punctuation. */
  itemChars: 240,
  /** A note past this many lines (about a screen) is read by its headings: one with none is a wall of sections. */
  screen: 40,
  /** A count's value comes from a key with at most this many values (a stage, a status): a free-text key's words aren't counts. */
  vocabulary: 20,
} as const;

export type ShapeRule = "title" | "wall" | "stacked" | "prose" | "headings" | "count" | "callout-nesting" | "question" | "bare-id";

/**
 * Evan's rubric for a note an agent wrote (Oct 29), which every finding is filed under, code's and Jev's alike, so the
 * suggestions page and the backfill count by it: dense prose; badly formatted (no headings past a screen, structure not
 * shown as structure); the ask buried; the ask unclear; facts, decisions and investigation mixed; assumes today's
 * context; argues instead of answering. Then the workboard's own rules where agents act (loki, Oct 29): `qa-for-evan`,
 * validation asked of Evan or a completion proved by tests alone (validation is the agents' job), and `experience`, a
 * ticket that doesn't say what Evan will open and do.
 */
export const RUBRIC = ["dense", "format", "buried", "unclear", "mixed", "context", "argues", "qa-for-evan", "experience"] as const;
export type Rubric = typeof RUBRIC[number];

/** The rubric item each of code's rules measures. */
export const RUBRIC_OF: Record<ShapeRule, Rubric> = {
  title: "format", wall: "dense", stacked: "dense", prose: "format", headings: "format", count: "format", "callout-nesting": "format", question: "buried", "bare-id": "context",
};

/** One edit of a ready fix, as outline_patch takes it: the exact text seen, and what replaces it. */
export interface ShapePatch { observed: string; replacement: string }

export interface ShapeFinding {
  rule: ShapeRule;
  /** Stable for the same problem in the same place, so an edit can tell a finding the note already had from a new one. */
  key: string;
  /** The smallest fix, as an instruction. */
  say: string;
  /** The line it is about (1 is the first), when it is about one. */
  line?: number;
  /** The fix made, ready for outline_patch, when code can make it exactly; none when only the writer can. */
  patch?: ShapePatch[];
  /** The exact words it is about, when that's less than its line (the sentence that asks). */
  passage?: string;
}

/**
 * A property value the outline holds, which a count typed in prose may be counting (`work-stage` = `queued`): how many
 * notes carry it, and how many values its key has (a stage or a status has a few; a free-text key has many).
 */
export interface ShapeFacet { key: string; value: string; count?: number; values?: number }

/**
 * `note`: a note or a block (the default); `comment`: a margin comment, which has no title and asks nothing of Evan.
 * `facets`: the outline's property values, so a number typed before one is told to be a live count. `asks`: the lines
 * (0-based) Jev judged to ask Evan something, used instead of the word heuristic when given; `titleIsContent`: Jev
 * judged a short title with several clauses to be the content rather than its name.
 */
export interface ShapeOptions { kind?: "note" | "comment"; facets?: readonly ShapeFacet[]; asks?: ReadonlySet<number>; titleIsContent?: boolean }

/** What every finding is listed under in a write's `warnings`: a gate on calling the write done, not a suggestion. */
export const FIX_BEFORE_DONE = "fix before you call this done: ";

/** The line every write answer ends with. `id` is the block written (a thread's note, for a comment). */
export const shapeNext = (id: string) => `read it as drawn before you call it done, at the width Evan reads in (a 44-column desk tile): \`ep0ch show ${id} --width ${SHAPE_LIMITS.readingWidth}\` (or outline_read it back)`;

const excerpt = (text: string, max = 48) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Sentences in a paragraph: a terminator followed by a space and a capital or digit, or ending it; code, links, properties and abbreviations aren't ends. */
export function sentenceCount(paragraph: string): number {
  // A block reference is one word, label and all (`((id|Rough edges (x)))`), by the link grammar's own scan.
  const refs = blockReferenceOccurrences(paragraph, []);
  const linked = refs.reduceRight((text, ref) => text.slice(0, ref.start) + "x" + text.slice(ref.end), paragraph);
  const flat = linked
    .replace(/\[[\w-]+::[^\]]*\]/g, " ")
    .replace(/`[^`]*`/g, "x")
    .replace(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, "x")
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

interface Paragraph { line: number; end: number; text: string; lines: number; item: boolean }

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
    if (open && text) out.push({ line: open.line, end: open.end, text, lines: open.lines, item: open.item });
    open = null;
  };
  lines.forEach((raw, i) => {
    if (structure[i]! !== -1 || i === title) { close(); return; }
    const { depth } = quoteDepth(raw);
    const content = stripQuotes(raw, depth).replace(/\r$/, "");
    // A line of chips alone (`[type::note] [area::garden]` under the title) is properties, never the start of a paragraph.
    if (!content.trim() || HEADING.test(content) || TABLE_ROW.test(content) || RULE_LINE.test(content) || CALLOUT_OPEN.test(content.trim()) || chipsOnly(content)) { close(); return; }
    if (LIST_ITEM.test(content)) { close(); open = { line: i, end: i, text: content.replace(LIST_ITEM, ""), lines: 1, depth, item: true }; return; }
    if (open && open.depth === depth) { open.text += ` ${content.trim()}`; open.lines++; open.end = i; return; }
    close();
    open = { line: i, end: i, text: content.trim(), lines: 1, depth, item: false };
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
  const header = comment ? null : headerLine(text);

  if (header && header.line >= 0) {
    // A work item's title is drawn after its Work ID ("PIE-1397 — A deploy restarts…"): the lead isn't measured, and the
    // title is never moved down (it's the item's name wherever it's drawn), so the finding comes with no patch.
    const lead = /^[A-Z][A-Z0-9]*-\d+\s*(?:—|–|-|:)\s*/.exec(header.prose.trim());
    const workItem = !!lead || /\[work-id::/.test(lines[header.line]!);
    const title = header.prose.trim().slice(lead?.[0].length ?? 0);
    const clauses = splitPoints(title).length;
    if (title.length > SHAPE_LIMITS.title || (o.titleIsContent && clauses > 1)) {
      const patch = workItem ? undefined : titlePatch(lines[header.line]!, title);
      found.push({
        rule: "title", key: "title", line: header.line + 1,
        say: title.length > SHAPE_LIMITS.title
          ? `the title line is ${title.length} characters (keep it under ${SHAPE_LIMITS.title}): make it a short name, "${excerpt(title, 40)}", and move the rest under it`
          : `the title line reads as the content, not its name ("${excerpt(title, 40)}"): give it a short subject and move the rest under it`,
        ...(patch ? { patch } : {}),
      });
    }
  }

  for (const p of prose) {
    const sentences = sentenceCount(p.text);
    const points = p.item ? splitPoints(p.text) : [];
    if (p.item && (points.length > SHAPE_LIMITS.itemPoints || p.text.length > SHAPE_LIMITS.itemChars)) {
      const patch = stackedPatch(lines, p, patchPoints(rawOf(lines, p)));
      found.push({
        rule: "stacked", key: `stacked:${p.text.slice(0, 24)}…${p.text.slice(-24)}`, line: p.line + 1,
        say: points.length > 1
          ? `line ${p.line + 1} stacks ${points.length} points in one item: a bullet is one point, so make each its own item, or a figure if they share fields${patch ? " (the patch makes the items)" : tooLong(lines, p)}`
          : `line ${p.line + 1} ("${excerpt(p.text, 32)}") is one item of ${p.text.length} characters: a bullet is one short point; cut it, or put the detail in nested items under a short lead`,
        ...(patch ? { patch } : {}),
      });
    } else if (!p.item && (sentences > SHAPE_LIMITS.sentences || p.text.length > SHAPE_LIMITS.paragraphChars)) {
      const patch = wallPatch(lines, p);
      found.push({
        rule: "wall", key: `wall:${p.text.slice(0, 24)}…${p.text.slice(-24)}`, line: p.line + 1,
        say: `line ${p.line + 1} is ${sentences > SHAPE_LIMITS.sentences ? `a paragraph of ${sentences} sentences (keep one to ${SHAPE_LIMITS.sentences})` : `${sentences === 1 ? "one sentence" : `a paragraph of ${sentences} sentences`} of ${p.text.length} characters (keep a paragraph under ${SHAPE_LIMITS.paragraphChars})`}: split it, or make it a list, a callout or a figure${patch ? " (the patch makes it a list)" : tooLong(lines, p)}`,
        ...(patch ? { patch } : {}),
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

    const structure = noteStructure(lines);
    const written = lines.filter((l, i) => structure[i] === -1 && l.trim()).length;
    if (written > SHAPE_LIMITS.screen && !lines.some((l, i) => structure[i] === -1 && HEADING.test(stripQuotes(l, quoteDepth(l).depth)))) {
      found.push({
        rule: "headings", key: "headings",
        say: `${written} lines and no heading: a note past a screen is read by its sections; put a "## " heading over each part (a heading-style band reads at a glance), with the conclusion first`,
      });
    }

    const callouts = calloutBlocks(lines);
    for (const inner of callouts) {
      if (callouts.some(outer => outer !== inner && outer.line < inner.line && inner.line < outer.end && outer.depth < inner.depth)) {
        found.push({ rule: "callout-nesting", key: `nest:${excerpt(lines[inner.line]!, 40)}`, line: inner.line + 1, say: `the callout on line ${inner.line + 1} sits inside another callout: make it a heading, or close the outer one first` });
      }
    }

    // An ask of Evan anywhere but the top (Evan's rubric, "the ask is buried"): the top is the first few lines under the
    // title, where a `- [ ]` reads first. A sentence in a paragraph is buried wherever the paragraph is.
    if (!/\[needs::\s*sysop/i.test(text)) {
      const body = lines.flatMap((l, i) => i > (header?.line ?? -1) && l.trim() ? [i] : []);
      const top = new Set(body.slice(0, SHAPE_LIMITS.topLines));
      // At the top: a "- [ ]" in the first lines, or the first sentence of the first line. Anything else is buried.
      const atTop = (i: number, sentence: string) => (top.has(i) && /^[ \t>]*[-*+][ \t]+\[ \][ \t]/.test(lines[i]!)) ||
        (i === body[0] && splitPoints(lines[i]!.replace(/^[ \t>]*(?:[-*+]|\d+[.)])?[ \t]*/, ""), { clauses: false })[0]?.trim() === sentence.trim());
      const buried = lines.findIndex((line, i) => i !== header?.line && structure[i] === -1 && (o.asks ? o.asks.has(i) : asksEvan(line) || endsAsking(line)) && !atTop(i, askedSentence(line, o.asks !== undefined)));
      if (buried >= 0) {
        const sentence = askedSentence(lines[buried]!, o.asks !== undefined);
        const patch = questionPatch(lines, buried, header?.line ?? 0, sentence);
        found.push({
          rule: "question", key: `question:${excerpt(sentence, 40)}`, line: buried + 1, passage: sentence,
          say: `line ${buried + 1} asks Evan something below the top: move it there as an open checkbox, \`- [ ] …\`, and mark the note \`[needs::sysop: …]\`${patch ? " (the patch does)" : ""}`,
          ...(patch ? { patch } : {}),
        });
      }
    }

    found.push(...bareIds(lines, structure, header?.line ?? -1));
    if (o.facets?.length) found.push(...countFindings(lines, structure, header?.line ?? -1, o.facets));
  }
  return found;
}

// ── Points, and the ready patches ────────────────────────────────────────────

const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|approx|fig|no|cf|dr|mr|mrs|ms|prof|st|jr|sr)\./gi;

/** `text` with what can't end a point (references, code, links, URLs, properties, abbreviations, decimals) blanked, the same length. */
function masked(text: string): string {
  const out = [...text];
  const blank = (start: number, end: number) => { for (let i = start; i < end; i++) out[i] = "x"; };
  for (const ref of blockReferenceOccurrences(text, [])) blank(ref.start, ref.end);
  for (const re of [/\[[\w-]+::[^\]]*\]/g, /`[^`]*`/g, /\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, /\w+:\/\/\S*[^\s.,;:!?)]/g, ABBREVIATION, /\d\.\d/g]) {
    for (const m of text.matchAll(re)) blank(m.index!, m.index! + m[0].length);
  }
  // Nothing ends a point inside brackets, parentheses or quotes: blanked from the innermost out, after code and links.
  let masked = out.join("");
  for (let before = ""; before !== masked;) {
    before = masked;
    masked = masked.replace(/\([^()]*\)|\[[^\[\]]*\]|"[^"\n]*"|“[^”\n]*”/g, m => "x".repeat(m.length));
  }
  return masked;
}

/**
 * The points one prose unit makes, in its own words: its sentences, and (unless `clauses: false`) the clauses a `;` or a
 * spaced dash joins. Counting takes both; a patch cuts at sentences only, so no item starts mid-sentence.
 */
export function splitPoints(text: string, o: { clauses?: boolean } = {}): string[] {
  const m = masked(text);
  const cuts: { at: number; skip: number }[] = [];
  for (const end of m.matchAll(/[.!?]+(?=\s+["'(\[*_`]*[\p{Lu}\d])/gu)) cuts.push({ at: end.index! + end[0].length, skip: 0 });
  if (o.clauses !== false) {
    for (const semi of m.matchAll(/;\s+/g)) cuts.push({ at: semi.index! + 1, skip: 0 });
    for (const dash of m.matchAll(/\s+(?:—|–|--)\s+/g)) cuts.push({ at: dash.index!, skip: dash[0].length });
  }
  cuts.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    const piece = text.slice(from, cut.at).trim();
    if (piece) out.push(piece);
    from = cut.at + cut.skip;
  }
  const rest = text.slice(from).trim();
  if (rest) out.push(rest);
  return out.length ? out : [text.trim()];
}

/** A unit's first line's lead-in (quote marks and indent) and, for an item, its marker. */
function leadOf(line: string): { quote: string; indent: string; marker: string } {
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line)![0];
  const rest = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(rest)![0];
  const marker = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(rest.slice(indent.length))?.[0] ?? "";
  return { quote, indent, marker };
}

const sourceOf = (lines: readonly string[], p: Paragraph) => lines.slice(p.line, p.end + 1).join("\n");

/** A unit's words as written, properties and all (a patch never drops a `[key::value]`): its lines without quote marks, indent or marker. */
function rawOf(lines: readonly string[], p: Paragraph): string {
  return lines.slice(p.line, p.end + 1).map((line, k) => {
    const { quote, indent, marker } = leadOf(line);
    return line.slice(quote.length + indent.length + (k === 0 ? marker.length : 0)).trim();
  }).join(" ").trim();
}

/** A point fit for its own bullet: no longer than an item may be, and one point (PIE-1402: a patch's output passes the same review). */
const fitsBullet = (point: string) => point.length <= SHAPE_LIMITS.itemChars && splitPoints(point).length <= SHAPE_LIMITS.itemPoints;

/**
 * The points a patch cuts a unit into: its sentences, and a sentence that is still several points (clauses joined by
 * `;` or a spaced dash) cut at those, the joiner dropped. Every piece must fit a bullet, or the unit gets no patch.
 */
function patchPoints(raw: string): string[] {
  return splitPoints(raw, { clauses: false }).flatMap(sentence => fitsBullet(sentence) ? [sentence] : splitPoints(sentence).map(clause => clause.replace(/;$/, "")));
}

/** A stacked item made into one item per point: a lead (`**Board:**`) keeps the item and its points nest under it. */
function stackedPatch(lines: readonly string[], p: Paragraph, points: string[]): ShapePatch[] | undefined {
  if (points.length < 2) return undefined;
  const { quote, indent, marker } = leadOf(lines[p.line]!);
  const bullet = /^\d/.test(marker) ? "- " : marker.replace(/\[[ xX]\][ \t]+/, "");
  const lead = /^(\*\*[^*]{1,40}\*\*:?|[^\s:][^:]{0,38}:)\s+(.+)$/s.exec(points[0]!);
  const items = lead ? [lead[2]!, ...points.slice(1)] : points;
  // A sentence too long for a bullet stays the writer's to cut: a patch that leaves one would be told again.
  if (!items.every(fitsBullet)) return undefined;
  const rows = lead
    ? [`${quote}${indent}${marker}${lead[1]}`, ...items.map(point => `${quote}${indent}  ${bullet}${point}`)]
    : [`${quote}${indent}${marker}${points[0]}`, ...points.slice(1).map(point => `${quote}${indent}${bullet}${point}`)];
  return keepsEverything(sourceOf(lines, p), rows.join("\n"));
}

/** A wall of sentences made into a list, one sentence a line; none when a sentence is too long for a bullet. */
function wallPatch(lines: readonly string[], p: Paragraph): ShapePatch[] | undefined {
  const points = patchPoints(rawOf(lines, p));
  if (points.length < 2 || !points.every(fitsBullet)) return undefined;
  const { quote, indent } = leadOf(lines[p.line]!);
  // A list right under a line of chips gets a blank line between: the chips stay the note's, never the first item's.
  const gap = p.line > 0 && lines[p.line - 1]!.trim() ? "\n" : "";
  return keepsEverything(sourceOf(lines, p), gap + points.map(point => `${quote}${indent}- ${point}`).join("\n"));
}

/** The first piece of a unit too long for a bullet, said so the writer knows which to cut (no patch can). */
function tooLong(lines: readonly string[], p: Paragraph): string {
  const long = patchPoints(rawOf(lines, p)).find(point => !fitsBullet(point));
  if (!long) return "";
  return `; no patch, because "${excerpt(long, 32)}" is ${long.length} characters, too long for one bullet: shorten it by hand`;
}

/**
 * The patch, only when it keeps every character the passage had, in order (the bullets, quote marks and indent it adds
 * aside): a ready patch that could drop a word, a code span or a property is worse than none.
 */
function keepsEverything(observed: string, replacement: string): ShapePatch[] | undefined {
  // A clause's joiner (`;`, a spaced dash) may become a bullet break; every other character stays.
  const words = (text: string) => text.replace(/^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+/gm, "").replace(/;(?=\s)|\s(?:—|–|--)(?=\s)/g, " ").replace(/\s+/g, "");
  return words(observed) === words(replacement) ? [{ observed, replacement }] : undefined;
}

/** A title line cut at its first break under the limit (`: `, a dash, `. `, `, `): the name stays, the rest is the first paragraph. */
function titlePatch(line: string, title: string): ShapePatch[] | undefined {
  const at = line.indexOf(title);
  if (at < 0) return undefined;
  const cut = [...title.matchAll(/(?::|\.|,|;)\s+|\s+(?:—|–|--)\s+/g)].find(m => m.index! >= 8 && m.index! <= SHAPE_LIMITS.title);
  if (!cut) return undefined;
  const name = title.slice(0, cut.index!).trim(), rest = title.slice(cut.index! + cut[0].length).trim();
  if (!rest) return undefined;
  const after = line.slice(at + title.length);
  return [{ observed: line, replacement: `${line.slice(0, at)}${name}${after}\n\n${rest[0]!.toUpperCase()}${rest.slice(1)}` }];
}

/** A chip's words cut at a word boundary under `max`, with an ellipsis when cut: never mid-word. */
function chipWords(text: string, max = 80): string {
  const flat = text.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/(?:[\s,;:—–-]|\b(?:and|but|so|or|then)\b)+$/i, "")}…`;
}

/** What is left of a line once its ask moves out: trailing joiners dropped ("…, and" ends nothing). */
const remainderOf = (line: string, ask: string) => line.replace(ask, "").replace(/\s{2,}/g, " ").replace(/(?:[\s,;:—–-]|\b(?:and|but|so|or|then)\b)+$/i, "").trimEnd();

/**
 * A line that holds only property chips (`[type::note] [plot.row::north]`), by the shared property grammar: the title's,
 * when it sits under the title.
 */
function chipsOnly(line: string): boolean {
  const chips = parsePropertyRecords(line).filter(p => p.syntax === "bracket");
  if (!chips.length) return false;
  let rest = line;
  for (const p of [...chips].sort((a, b) => b.start - a.start)) rest = rest.slice(0, p.start) + rest.slice(p.end);
  return !rest.trim();
}

/**
 * A buried question moved to the top, as one `- [ ]` under the title (and under the chip lines right under it, which
 * are the title's), its own paragraph, and the note marked `[needs::sysop: …]` on the title line.
 */
function questionPatch(lines: readonly string[], at: number, title: number, sentence: string): ShapePatch[] | undefined {
  const line = lines[at]!;
  if (lines.filter(l => l === line).length !== 1 || lines.filter(l => l === lines[title]).length !== 1 || at <= title) return undefined;
  const words = line.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])?[ \t]*(?:\[[ xX]\][ \t]*)?/, "").trim();
  let ask = sentence.trim();
  // The ask alone moves: a sentence out of its paragraph (the rest stays), or the whole line when it's only the ask, or
  // when what would stay is a fragment (a few words, or no sentence left in it).
  let rest: string | null = words === ask ? null : remainderOf(line, ask);
  if (rest !== null && rest === line) return undefined;
  if (rest !== null) {
    const left = rest.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])?[ \t]*/, "").trim();
    if (left.split(/\s+/).filter(w => /\p{L}/u.test(w)).length < 3) { rest = null; ask = words; }
  }
  // Where the box goes: after the title, and after the chip lines right under it.
  let anchor = title;
  while (anchor + 1 < at && chipsOnly(lines[anchor + 1]!)) anchor++;
  // Its line must be found once in the whole note (the title may repeat one of its chips): else the patch is ambiguous.
  if (anchor !== title && lines.join("\n").split(lines[anchor]!).length !== 2) return undefined;
  // What comes after the box once the ask has moved: a blank line keeps it out of the box's item.
  const next = anchor + 1 === at ? (rest ?? lines[at + 1]) : lines[anchor + 1];
  const box = `\n\n- [ ] ${ask}${next?.trim() ? "\n" : ""}`;
  const chip = `${lines[title]!.trimEnd()} [needs::sysop: ${chipWords(ask)}]`;
  return [
    rest === null ? { observed: `\n${line}`, replacement: "" } : { observed: line, replacement: rest },
    ...(anchor === title
      ? [{ observed: lines[title]!, replacement: `${chip}${box}` }]
      : [{ observed: lines[title]!, replacement: chip }, { observed: lines[anchor]!, replacement: `${lines[anchor]!.trimEnd()}${box}` }]),
  ];
}

/** The sentence of a line that asks: one with a question mark or naming Evan with a decision, else (Jev judged the line) its last. */
function askedSentence(line: string, judged: boolean): string {
  const words = line.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])?[ \t]*(?:\[[ xX]\][ \t]*)?/, "").trim();
  const sentences = splitPoints(words, { clauses: false });
  return sentences.find(x => asksEvan(x)) ?? sentences.find(x => /\?/.test(x)) ?? (judged ? sentences.at(-1)! : words);
}

/**
 * A note's id typed bare in prose (`8a1c…` or a whole uuid), not as `((id))`: a reader without today's session can't
 * follow it. The patch makes each a reference, which every reader draws as the note's title, linked.
 */
function bareIds(lines: readonly string[], structure: readonly number[], title: number): ShapeFinding[] {
  const out: ShapeFinding[] = [];
  lines.forEach((raw, i) => {
    if (i === title || structure[i] !== -1) return;
    const shown = [...raw];
    for (const ref of blockReferenceOccurrences(raw, [])) for (let k = ref.start; k < ref.end; k++) shown[k] = " ";
    for (const m of raw.matchAll(/\[[\w-]+::[^\]]*\]|`[^`]*`|\w+:\/\/\S+|\]\([^)]*\)|\[\[[^\]]*\]\]/g)) for (let k = m.index!; k < m.index! + m[0].length; k++) shown[k] = " ";
    const ids = [...shown.join("").matchAll(/(?<![\w-]|\(\()[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])/g)];
    if (!ids.length) return;
    let fixed = raw;
    for (const m of [...ids].reverse()) fixed = `${fixed.slice(0, m.index!)}((${m[0]}))${fixed.slice(m.index! + m[0].length)}`;
    out.push({
      rule: "bare-id", key: `bare-id:${ids.map(m => m[0].slice(0, 8)).join(",")}`, line: i + 1,
      say: `line ${i + 1} names a note by its bare id (${ids.map(m => m[0].slice(0, 8)).join(", ")}): write it as ((id)) so it reads as the note's title and opens it`,
      ...(lines.filter(l => l === raw).length === 1 ? { patch: [{ observed: raw, replacement: fixed }] } : {}),
    });
  });
  return out;
}

/** Whether the text types a number before a word anywhere: the count rule asks the outline's facets only then. */
export const hasCountCandidate = (text: string) => /(?<![\w#$€£.\/:-])\d{1,5}(?![\w.:\/%-]|\.\d)\s+\p{L}/u.test(text);

// ── Counts typed in prose ────────────────────────────────────────────────────

const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i;
/** The small words a count's value may follow (`2 in review`): grammar, not anyone's properties. */
const FILLERS = /^(?:in|still|now|are|were|more|left)$/i;

const singular = (word: string) => word.toLowerCase().replace(/(?:ies)$/, "y").replace(/(?:ses|xes)$/, m => m.slice(0, -2)).replace(/(?<=[^s])s$/, "");

/**
 * A number typed before a property value the outline holds (`3 queued`, `14 roadmap items`): a count a query keeps
 * true. Only values the outline has match, so `3 sentences` or `PR 912` never do; dates, versions and money don't
 * either. The patch takes the number out of the sentence and puts a live `::graph-stat` after it, one tile per count.
 */
function countFindings(lines: readonly string[], structure: readonly number[], title: number, facets: readonly ShapeFacet[]): ShapeFinding[] {
  const byWord = new Map<string, ShapeFacet>();
  for (const f of facets) {
    const value = f.value.trim().toLowerCase();
    // A value a count can mean: one of a small vocabulary (a stage, a status, a kind), carried by more than one note.
    if (value.length < 3 || /^\d/.test(value) || /\s{2,}/.test(value) || (f.count ?? 2) < 2 || (f.values ?? 0) > SHAPE_LIMITS.vocabulary) continue;
    for (const w of [value, singular(value), value.replace(/-/g, " "), singular(value.replace(/-/g, " "))]) if (!byWord.has(w)) byWord.set(w, f);
  }
  const out: ShapeFinding[] = [];
  lines.forEach((raw, i) => {
    if (i === title || structure[i] !== -1 || !raw.trim() || HEADING.test(raw) || TABLE_ROW.test(stripQuotes(raw, quoteDepth(raw).depth))) return;
    const m = masked(raw);
    const counts: { number: string; start: number; end: number; facet: ShapeFacet; words: string }[] = [];
    for (const n of m.matchAll(/(?<![\w#$€£.\/:-])(\d{1,5})(?![\w.:\/%-]|\.\d)\s+/gu)) {
      // A day of a month (`Oct 27`) or a time (`9 AM`) is no count.
      if (MONTH_BEFORE.test(raw.slice(0, n.index!)) || /^(?:am|pm)\b/i.test(raw.slice(n.index! + n[0].length))) continue;
      const candidates = (/^[\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,2}/u.exec(raw.slice(n.index! + n[0].length))?.[0] ?? "").split(/\s+/).filter(Boolean);
      // The value is the word right after the number, or after one small word (`2 in review`, `3 still queued`); one word or two (`roadmap items`).
      for (let k = 0; k < Math.min(FILLERS.test(candidates[0] ?? "") ? 2 : 1, candidates.length); k++) {
        const one = candidates[k]!.toLowerCase(), two = candidates[k + 1] ? `${one} ${candidates[k + 1]!.toLowerCase()}` : "";
        const facet = (two && (byWord.get(two) ?? byWord.get(singular(two)))) || byWord.get(one) || byWord.get(singular(one));
        if (facet) { counts.push({ number: n[1]!, start: n.index!, end: n.index! + n[1]!.length, facet, words: candidates.slice(0, k + (byWord.get(two) || byWord.get(singular(two)) ? 2 : 1)).join(" ") }); break; }
      }
    }
    if (!counts.length) return;
    const query = (f: ShapeFacet) => `${f.key}=${/^[\p{L}\p{N}_.\/-]+$/u.test(f.value) ? f.value : JSON.stringify(f.value)}`;
    const said = counts.map(c => `"${c.number} ${c.words}" is ${query(c.facet)}`).join(", ");
    const items = counts.map(c => `{ label: ${JSON.stringify(c.facet.value)}, query: ${JSON.stringify(query(c.facet))} }`).join(", ");
    out.push({
      rule: "count", key: `count:${counts.map(c => query(c.facet)).join(",")}`, line: i + 1,
      say: `line ${i + 1} types a count a query keeps true (${said}): if it means the live count, put ::graph-stat with items: [${items}] in its place; if it's scoped or past, say so and keep it`,
      // No ready patch: a count typed in prose is often scoped or historical ("this project had 3 queued yesterday"), and
      // only the writer knows whether the outline-wide live count says the same. The figure to use is in what's said.
    });
  });
  return out;
}

/**
 * A line whose last sentence is a question, outside a heading, a table row and a ticked box: in a note an agent writes
 * for Evan, a question nobody answers after it asks him, whether or not it names him (PIE-1419). A question answered in
 * the same line ("Why the move? The wind.") isn't.
 */
export function endsAsking(line: string): boolean {
  const content = stripQuotes(line, quoteDepth(line).depth);
  if (HEADING.test(content) || TABLE_ROW.test(content) || /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[^\] ]\]/.test(content)) return false;
  const words = content.replace(/^[ \t]*(?:[-*+]|\d+[.)])?[ \t]*(?:\[ \][ \t]*)?/, "").replace(PROPERTY_CHIP, " ").trim();
  return !!words && /\?["'”)*_]*$/.test(splitPoints(words, { clauses: false }).at(-1)!.trim());
}

/** A line that asks Evan: names him and has a question mark or a decision word. A heuristic until PIE-1251's judgment replaces it. */
export function asksEvan(line: string): boolean {
  return /\bEvan\b/.test(line) && (/\?/.test(line) || /\b(?:decide|decision|should we|needs? (?:your|his)|approve|confirm|pick|choose|sign off)\b/i.test(line));
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
