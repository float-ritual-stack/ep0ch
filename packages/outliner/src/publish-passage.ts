// Where words selected on a published page are in the outline (PIE-774): the page sends what the reader selected as
// drawn (the quote, with the drawn words around it), and this finds them in the source of the blocks the page shows.
// Contract 5's passage is exact source text, so a selection is mapped, never guessed: found once (the drawn words
// around it pick among repeats), or refused with why.
//
// A block's source is read as the page draws it: property tokens and `^anchors` dropped; `((id|label))`,
// `[[page|label]]` and `[label](url)` read as their label; emphasis, code ticks and a line's list, quote or heading
// marker left out; runs of blanks one space. Each drawn character keeps its offset in the source, so the passage
// covers the source the words were drawn from (a whole link, a styled run). A reference drawn as another note's title
// has no words of its own here: a selection across it isn't found. Pure: no I/O.

import { passageAt, type Passage } from "@ep0ch/outline-core/passage";
import { propertyTokenMatches } from "@ep0ch/outline-core/property-grammar";
import { blockReferenceOccurrences, fragmentAnchorMatch, MARKDOWN_LINK_SOURCE, pageAddressReferences } from "@ep0ch/outline-core/link-syntax";

/** A block's text as a page draws it, with each drawn character's offset in the source. */
export interface DrawnText {
  text: string;
  at: number[];
}

const EMPHASIS = new Set(["*", "_", "`", "~"]);
const LINE_MARKER = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)+/;

/** Words as compared: emphasis left out, blanks one space, trimmed. */
export function drawnWords(text: string): string {
  return [...text].filter(c => !EMPHASIS.has(c)).join("").replace(/\s+/g, " ").trim();
}

export function drawnText(source: string): DrawnText {
  // What isn't drawn as written: skipped wholly, or drawn as a label kept at its own offsets.
  type Span = { start: number; end: number; label?: { start: number; end: number } };
  const spans: Span[] = [];
  for (const token of propertyTokenMatches(source)) spans.push({ start: token.start, end: token.end });
  for (const reference of blockReferenceOccurrences(source, [])) {
    const labelStart = reference.label !== undefined ? source.indexOf("|", reference.start) + 1 : -1;
    spans.push({ start: reference.start - (source[reference.start - 1] === "!" ? 1 : 0), end: reference.end,
      ...(labelStart > 0 ? { label: { start: labelStart, end: labelStart + reference.label!.length } } : {}) });
  }
  for (const page of pageAddressReferences(source, [])) {
    const inner = source.slice(page.start + 2, page.end - 2);
    const bar = inner.indexOf("|");
    const from = page.start + 2 + (bar >= 0 ? bar + 1 : 0);
    spans.push({ start: page.start, end: page.end, label: { start: from, end: page.end - 2 } });
  }
  for (const link of source.matchAll(new RegExp(MARKDOWN_LINK_SOURCE, "g"))) {
    spans.push({ start: link.index!, end: link.index! + link[0].length, label: { start: link.index! + 1, end: link.index! + 1 + link[1]!.length } });
  }
  // Each line's marker and anchor.
  let lineStart = 0;
  for (const line of source.split("\n")) {
    const marker = LINE_MARKER.exec(line);
    if (marker) spans.push({ start: lineStart, end: lineStart + marker[0].length });
    const anchor = fragmentAnchorMatch(line);
    if (anchor) spans.push({ start: lineStart + anchor.index!, end: lineStart + line.length });
    lineStart += line.length + 1;
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const span of spans) if (!kept.length || span.start >= kept[kept.length - 1]!.end) kept.push(span);

  let text = "";
  const at: number[] = [];
  let blank = true;
  const put = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const c = source[i]!;
      if (EMPHASIS.has(c)) continue;
      if (/\s/.test(c)) {
        if (!blank) { text += " "; at.push(i); blank = true; }
        continue;
      }
      text += c; at.push(i); blank = false;
    }
  };
  let cursor = 0;
  for (const span of kept) {
    put(cursor, span.start);
    if (span.label) put(span.label.start, span.label.end);
    cursor = span.end;
  }
  put(cursor, source.length);
  if (text.endsWith(" ")) { text = text.slice(0, -1); at.pop(); }
  return { text, at };
}

/** One block the page shows: its id, revision and source. */
export interface ShownBlock {
  id: string;
  revision: number;
  text: string;
}

/** What the page sends: the words as selected, and the drawn words either side. */
export interface DrawnSelection {
  quote: string;
  prefix?: string;
  suffix?: string;
}

export type FoundPassage = { ok: true; block: ShownBlock; passage: Passage } | { ok: false; why: string };

/** How many characters of `a`'s end and `b`'s end agree (or of their starts, `fromStart`). */
function agreement(a: string, b: string, fromStart: boolean): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && (fromStart ? a[n] === b[n] : a[a.length - 1 - n] === b[b.length - 1 - n])) n += 1;
  return n;
}

/**
 * The passage in `blocks` that a selection on the page is: the source the selected words were drawn from. Found once,
 * or once among repeats by the drawn words around it; anything else is refused with why.
 */
export function findDrawnPassage(blocks: readonly ShownBlock[], selection: DrawnSelection): FoundPassage {
  const quote = drawnWords(selection.quote);
  if (!quote) return { ok: false, why: "nothing is selected: select some words first" };
  if (quote.length > 4000) return { ok: false, why: "that selection is too long to mark: select at most a few paragraphs" };
  const prefix = drawnWords(selection.prefix ?? ""), suffix = drawnWords(selection.suffix ?? "");
  type Hit = { block: ShownBlock; drawn: DrawnText; index: number; score: number };
  const hits: Hit[] = [];
  for (const block of blocks) {
    const drawn = drawnText(block.text);
    for (let index = drawn.text.indexOf(quote); index >= 0; index = drawn.text.indexOf(quote, index + 1)) {
      const before = drawn.text.slice(Math.max(0, index - prefix.length), index).trimEnd();
      const after = drawn.text.slice(index + quote.length, index + quote.length + suffix.length).trimStart();
      const score = agreement(before, prefix.trimEnd(), false) + agreement(after, suffix.trimStart(), true);
      hits.push({ block, drawn, index, score });
    }
  }
  if (!hits.length) {
    return { ok: false, why: "those words aren't in this page's text as written (a selection across a link to another note, an embed or a figure can't be marked): select words in one passage" };
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > 1 && hits[0]!.score === hits[1]!.score) {
    return { ok: false, why: `those words are on this page ${hits.length} times: select a few more words around them` };
  }
  const { block, drawn, index } = hits[0]!;
  const start = drawn.at[index]!;
  let end = drawn.at[index + quote.length - 1]! + 1;
  // A styled run wholly selected takes its marks (`**soil pH**`): the passage is the source the run was drawn from.
  let from = start;
  while (from > 0 && end < block.text.length && EMPHASIS.has(block.text[from - 1]!) && block.text[from - 1] === block.text[end]) { from -= 1; end += 1; }
  return { ok: true, block, passage: passageAt(block.text, from, end, block.id, block.revision) };
}
