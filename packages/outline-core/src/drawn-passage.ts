// Where a passage a reader drew is in the source: the one owner of that question, for every client.
//
// Contract 5's passage is exact source text (passage.ts). A client that draws a note and selects in what it drew (a
// published page, the native window, an agent quoting what it read rendered) has the words as drawn: a link's label
// without its target, bold without its marks, two paragraphs with a break between. This module reads the source the
// way a reader draws it, keeps for every drawn character the source it was drawn from, and asks the one quote lookup
// (`findPassage`) of that reading. What comes back is a span of the source: the whole link, the styled run, both
// paragraphs. Nothing here is fuzzy: the words must be the drawn words, in order, with nothing drawn left out between
// them; found once (or nearest `near` among repeats), else refused with why, as a source quote is.
//
// **One reading for every renderer.** Renderers differ in what they draw of the markup (a page hides `[key::value]`, a
// Markdown view shows it; one copies a list item with its `- `, another without). So the quote is read the same way
// the source is (`drawnText` of both), and the two are compared as drawn: what a renderer may or may not show is in
// neither.
//
// What is read (`drawnText`):
// - a property token and a line's `^anchor`: not drawn;
// - `((id|label))`, `[[page|label]]`, `[label](url)`: the label; `[[page]]`: its address; `((id))`: the title of the
//   note it names, when the asker knows it (`reads.title`), each of its words drawn from the whole reference, and
//   read as any words are (a page draws the title through Markdown: its code ticks and emphasis are marks);
// - a callout's `[!type]`: its icon (and the type's own title when the line gives none), as `proseMarkdown` leads it;
// - emphasis marks, code ticks, a backslash that escapes a mark, a line's list, quote or heading marker, a code
//   fence's own two lines, a table's pipes and its separator row, a rule (`---`, with the style it names or none)
//   and the line of dashes or equals signs under a heading: not drawn (a reader that shows such a line as written,
//   in a code fence, has it in the quote, where it is read the same way);
// - any run of blanks, a line break among them: one space.
//
// **A quote may start mid-line.** What a line starts with says what it is (`2026. ` a list's number, `- ` its dash,
// `> ` a quote, `# ` a heading, `---` a rule), and a quote's first characters may be none of those: a selection that
// starts on a year and its full stop. So a quote has two readings (`quoteReadings`): its words with only marks and
// blanks folded, asked first, and the reading the source gets, asked when the first is nowhere in the text.
//
// Offsets are UTF-16, as passage.ts keeps them. Pure: no I/O.

import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, calloutLead, quoteDepth, type CalloutRegistry } from "./callouts";
import { STEP_BOX } from "./checklist-marks";
import { noteCodeFences } from "./component-block";
import { styledLine, underlinesLineAbove } from "./heading-styles";
import { blockReferenceOccurrences, fragmentAnchorMatch, MARKDOWN_LINK_SOURCE, pageAddressReferences } from "./link-syntax";
import { findPassage, isMiss, missMessage, quotePlaces, type FindOptions, type PassageMiss } from "./passage";
import { propertyTokenMatches } from "./property-grammar";
import { Refusal } from "./refusal";
import { startsTable, tableEnd } from "./table-shape";

/** What a reader knows that the source doesn't say: asked while the source is read as drawn. */
export interface DrawnReads {
  /** What an unlabelled `((id))` is drawn as: the title of the note it names. None: its words aren't in this text. */
  title?: (blockId: string) => string | undefined;
  /** The outline's callout types (their icons and titles); the built-in ones when left out. */
  callouts?: CalloutRegistry;
}

/**
 * A text as a reader draws it. `at[i]` and `end[i]` are the span of the source the drawn character `i` came from: one
 * character for a word drawn as written, the whole token for words drawn in its place (a reference's title).
 */
export interface DrawnText {
  text: string;
  at: number[];
  end: number[];
}

const EMPHASIS = new Set(["*", "_", "`", "~"]);
const LINE_MARKER = new RegExp(`^[ \\t]*(?:#{1,6}[ \\t]+|>[ \\t]?|(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:${STEP_BOX}[ \\t]+)?)+`);
const TABLE_RULE = /^\s*\|?\s*:?-{2,}[\s|:-]*$/;
/** A line that is a rule, or the line under a heading written that way: three or more dashes (blanks between them or not), or equals signs, and nothing else. */
const RULE_LINE = /^[ \t]*(?:(?:-[ \t]*){3,}|={3,}[ \t]*)$/;
/** What a backslash escapes in Markdown: before one of these it isn't drawn. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;
/**
 * Whether the character at `i` of `text` (which ends at `to`) is a mark and no word: an emphasis mark or a code tick,
 * or a backslash that escapes a mark (an escaped emphasis mark is left out as any is: the quote's is too).
 */
const isMark = (text: string, i: number, to: number) => EMPHASIS.has(text[i]!) || (text[i] === "\\" && i + 1 < to && ESCAPABLE.test(text[i + 1]!));

/** `text` as a reader draws it, with the source each drawn character came from. */
export function drawnText(source: string, reads: DrawnReads = {}): DrawnText {
  // What isn't drawn as written: left out wholly, drawn as its label (kept at the label's own offsets), or drawn as
  // words the source doesn't hold (`words`, every one of them from the whole span).
  type Span = { start: number; end: number; label?: { start: number; end: number }; words?: string };
  const spans: Span[] = [];
  for (const token of propertyTokenMatches(source)) spans.push({ start: token.start, end: token.end });
  for (const reference of blockReferenceOccurrences(source, [])) {
    const start = reference.start - (source[reference.start - 1] === "!" ? 1 : 0);
    const labelStart = reference.label !== undefined ? source.indexOf("|", reference.start) + 1 : -1;
    const title = labelStart > 0 ? undefined : reads.title?.(reference.blockId);
    spans.push({ start, end: reference.end,
      ...(labelStart > 0 ? { label: { start: labelStart, end: labelStart + reference.label!.length } } : title ? { words: title } : {}) });
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
  const lines = source.split("\n");
  const starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; i++) { starts.push(at); at += lines[i]!.length + 1; }
  // A code fence's own lines (its ticks and its language) and a table's separator row; a table row's pipes.
  const whole = (i: number) => spans.push({ start: starts[i]!, end: starts[i]! + lines[i]!.length });
  for (const fence of noteCodeFences(lines)) { whole(fence.start); if (fence.closed) whole(fence.end); }
  for (let i = 0; i < lines.length; i++) {
    if (!startsTable(lines, i)) continue;
    const end = tableEnd(lines, i);
    for (let row = i; row < end; row++) {
      if (row === i + 1 && TABLE_RULE.test(lines[row]!)) { whole(row); continue; }
      const line = lines[row]!;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === "\\") c++;
        else if (line[c] === "|") spans.push({ start: starts[row]! + c, end: starts[row]! + c + 1, words: " " });
      }
    }
    i = end - 1;
  }
  // A callout's `[!type]`: its icon, and its type's own title when the line has none.
  const registry = reads.callouts ?? BUILTIN_CALLOUT_REGISTRY;
  for (const callout of calloutBlocks(lines)) {
    const line = lines[callout.line]!, content = quoteDepth(line).content;
    const from = starts[callout.line]! + line.length - content.length;
    const close = content.indexOf("]") + 1 + (callout.fold ? 1 : 0);
    const lead = calloutLead(callout, registry);
    spans.push({ start: from, end: from + close, words: callout.title ? lead.slice(0, lead.length - callout.title.length) : lead });
  }
  // Each line's marker and anchor; a rule's line whole, one that names a style too (`--- [rule::fade]`: heading-styles.ts
  // says which lines those are, and a page that draws no style is served it as `---`). Dashes with a style right under
  // a line of prose are no rule to any reader (`underlinesLineAbove`, the question `unstyledLines` asks): they stay
  // words, as they are served.
  lines.forEach((line, i) => {
    if (RULE_LINE.test(line) || (styledLine(line)?.kind === "rule" && !underlinesLineAbove(line, i ? lines[i - 1]! : ""))) return void whole(i);
    const marker = LINE_MARKER.exec(line);
    if (marker) spans.push({ start: starts[i]!, end: starts[i]! + marker[0].length });
    const anchor = fragmentAnchorMatch(line);
    if (anchor) spans.push({ start: starts[i]! + anchor.index!, end: starts[i]! + line.length });
  });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const span of spans) if (!kept.length || span.start >= kept[kept.length - 1]!.end) kept.push(span);

  let text = "";
  const at: number[] = [], end: number[] = [];
  let blank = true;
  const draw = (c: string, from: number, to: number) => {
    if (/\s/.test(c)) {
      if (!blank) { text += " "; at.push(from); end.push(to); blank = true; }
      return;
    }
    text += c; at.push(from); end.push(to); blank = false;
  };
  const put = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (!isMark(source, i, to)) draw(source[i]!, i, i + 1);
  };
  let cursor = 0;
  for (const span of kept) {
    put(cursor, span.start);
    if (span.label) put(span.label.start, span.label.end);
    // Words the source doesn't hold (a title, read as any words are: its marks are no words), each from the whole span.
    else if (span.words) for (let i = 0; i < span.words.length; i++) { if (!isMark(span.words, i, span.words.length)) draw(span.words[i]!, span.start, span.end); }
    cursor = span.end;
  }
  put(cursor, source.length);
  if (text.endsWith(" ")) { text = text.slice(0, -1); at.pop(); end.pop(); }
  return { text, at, end };
}

/** A quote read as the source is: the words of it a reader draws, to compare with a text read the same way. */
export function drawnWords(quote: string, reads: DrawnReads = {}): string {
  return drawnText(quote, reads).text;
}

/** A quote's words with only its marks left out and its blanks folded: nothing in it is read as a line's shape. */
function plainWords(quote: string): string {
  let text = "";
  for (let i = 0; i < quote.length; i++) {
    if (isMark(quote, i, quote.length)) continue;
    if (!/\s/.test(quote[i]!)) text += quote[i];
    else if (text && !text.endsWith(" ")) text += " ";
  }
  return text.trimEnd();
}

/**
 * The ways a quote's words may be read, in the order they are asked: as they are (marks and blanks folded), then as
 * the source is read (a line's marker, a rule, a token, a link's target left out). The first that is in the text is
 * the quote; one reading when both give the same words, none when a reader draws nothing of it.
 */
export function quoteReadings(quote: string, reads: DrawnReads = {}): string[] {
  return [...new Set([plainWords(quote), drawnWords(quote, reads)])].filter(Boolean);
}

/** The first drawn character that came from `offset` of the source or later (the drawn text's length when none did). */
function drawnOffset(drawn: DrawnText, offset: number): number {
  let low = 0, high = drawn.at.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (drawn.at[middle]! < offset) low = middle + 1; else high = middle;
  }
  return low;
}

/** The run of emphasis marks that ends at `at` (`back`) or starts there. */
function marksAt(source: string, at: number, back: boolean): string {
  let n = 0;
  while (back ? at - n > 0 && EMPHASIS.has(source[at - n - 1]!) : at + n < source.length && EMPHASIS.has(source[at + n]!)) n += 1;
  return back ? source.slice(at - n, at) : source.slice(at, at + n);
}

/**
 * The source the drawn characters `[from, to)` were drawn from, as one span. A styled run wholly drawn takes its marks:
 * both when it is all of the passage (`**soil pH**`), the opening ones when the passage starts with it and holds the
 * ones that close it (`**Water** the beds`), the closing ones when it ends with it.
 */
export function drawnSpan(source: string, drawn: DrawnText, from: number, to: number): { start: number; end: number } {
  let start = drawn.at[from]!, end = drawn.end[to - 1]!;
  const inside = source.slice(start, end);
  while (start > 0 && end < source.length && EMPHASIS.has(source[start - 1]!) && source[start - 1] === source[end]) { start -= 1; end += 1; }
  const opens = marksAt(source, start, true), closes = marksAt(source, end, false);
  if (opens && inside.includes(opens)) start -= opens.length;
  if (closes && inside.includes(closes)) end += closes.length;
  return { start, end };
}

/** Every place the drawn words of `quote` are in `drawn`, in order, as offsets of the drawn text (passage.ts's `quotePlaces`), by the first reading of the quote that is there at all. */
export function drawnPlaces(drawn: DrawnText, quote: string, o: FindOptions = {}, reads: DrawnReads = {}): { words: string; places: number[] } {
  let words = "";
  for (words of quoteReadings(quote, reads)) {
    const places = quotePlaces(drawn.text, words, o);
    if (places.length) return { words, places };
  }
  return { words, places: [] };
}

/**
 * Where the passage a reader drew as `quote` is in the source `text`, as one span of it: found once (or the nearest to
 * `near` among several), else why not, in `findPassage`'s own words. The options are a source quote's, said of the
 * source: `near`, `lower`, `upper` and `exclude` are source offsets and spans; `prefix` and `suffix` are the words
 * drawn just before and after. (`start` is a source quote's alone: a drawn passage doesn't know where it starts.)
 */
export function findDrawnPassage(text: string, quote: string, o: Omit<FindOptions, "start"> = {}, reads: DrawnReads = {}): { start: number; end: number } | PassageMiss {
  const drawn = drawnText(text, reads), readings = quoteReadings(quote, reads);
  if (!readings.length) return { why: "the quote has no words a reader draws", count: 0 };
  const before = o.prefix ? quoteReadings(o.prefix, reads) : [], after = o.suffix ? quoteReadings(o.suffix, reads) : [];
  const exclude = o.exclude;
  const asked = (words: string) => findPassage(drawn.text, words, {
    ...(o.near === undefined ? {} : { near: drawnOffset(drawn, o.near) }),
    ...(o.lower === undefined ? {} : { lower: drawnOffset(drawn, o.lower) }),
    ...(o.upper === undefined ? {} : { upper: drawnOffset(drawn, o.upper) }),
    // The words around it are compared as drawn, a blank either side of the quote being nobody's.
    ...(before.length || after.length || exclude ? { exclude: (from, to) => {
      if (before.length && !before.some(words => drawn.text.slice(0, from).trimEnd().endsWith(words))) return true;
      if (after.length && !after.some(words => drawn.text.slice(to).trimStart().startsWith(words))) return true;
      if (!exclude) return false;
      const span = drawnSpan(text, drawn, from, to);
      return exclude(span.start, span.end);
    } } : {}),
  });
  // The quote as it is first; as the source is read when those words are nowhere in the text.
  let found = asked(readings[0]!);
  for (const words of readings.slice(1)) { if (!isMiss(found) || found.count > 0) break; found = asked(words); }
  if (!isMiss(found)) return drawnSpan(text, drawn, found.start, found.end);
  // The nearest words there are, said where they are in the source.
  if (!found.nearest) return found;
  const { start, end } = drawnSpan(text, drawn, found.nearest.start, found.nearest.end);
  return { ...found, nearest: { start, end, text: text.slice(start, end) } };
}

/**
 * A quote as a client sends it with a comment: the words, and what it knows of where they are. A quote is source
 * text unless it says it is `drawn`; context that names a place in the source (`start`, `prefix`, `suffix`) makes it
 * source text whatever else is said.
 */
export interface QuotedPassage {
  /** The words: exactly as the block's text has them, or (with `drawn`) as a reader draws them. */
  readonly quote: string;
  /** Where the quote starts in the block's text, when you know. */
  readonly start?: number;
  /** Among repeats, the one nearest this offset (an agent's `near=`). */
  readonly near?: number;
  /** Text just before the quote, to tell repeats apart. */
  readonly prefix?: string;
  /** Text just after the quote, to tell repeats apart. */
  readonly suffix?: string;
  readonly itemId?: string;
  /** The words were selected in what a reader drew (a link's label, bold without its marks, two paragraphs): the service finds the source they were drawn from. */
  readonly drawn?: boolean;
  /** Only within this span of the block's text (UTF-16), when the reader knows which part of it the words were drawn from. */
  readonly within?: { readonly start: number; readonly end: number };
}

/** A quote said with a place in the source: looked up as source text, and never as drawn. */
const placedInSource = (p: Pick<QuotedPassage, "start" | "prefix" | "suffix">) => p.start !== undefined || p.prefix !== undefined || p.suffix !== undefined;

/**
 * Where a quoted passage is in `text`, whichever way its words were read. A `drawn` quote is found as drawn, and as
 * written only when a reader draws none of its words that way (a token it shows as written). Any other quote is exact
 * source text, as it always was; one that says no place in the source and isn't in the text as written is then read
 * as drawn (an agent quoting what it read rendered). `o`: the range and the exclusions the caller scopes it to.
 */
export function findQuoted(text: string, passage: QuotedPassage, o: Pick<FindOptions, "lower" | "upper" | "exclude"> = {}, reads: DrawnReads = {}): { start: number; end: number } | PassageMiss {
  const lower = Math.max(o.lower ?? 0, passage.within?.start ?? 0), upper = Math.min(o.upper ?? text.length, passage.within?.end ?? text.length);
  const scope = { lower, upper, ...(o.exclude ? { exclude: o.exclude } : {}), ...(passage.near === undefined ? {} : { near: passage.near }) };
  const written = () => findPassage(text, passage.quote, { ...scope,
    ...(passage.start === undefined ? {} : { start: passage.start }),
    ...(passage.prefix === undefined ? {} : { prefix: passage.prefix }),
    ...(passage.suffix === undefined ? {} : { suffix: passage.suffix }) });
  const drawn = () => findDrawnPassage(text, passage.quote, scope, reads);
  if (placedInSource(passage)) return written();
  const [first, second] = passage.drawn ? [drawn(), written] : [written(), drawn];
  // Found, or found more than once: that reading has the answer. Not there at all: the other reading is asked.
  if (!isMiss(first) || first.count > 0) return first;
  const other = second();
  return !isMiss(other) || other.count > 0 ? other : first;
}

/** What a comment whose quote wasn't found (or wasn't found once) is refused with: its kind, why, and the nearest words there are. */
export function quoteRefusal(miss: PassageMiss): Refusal {
  const said = missMessage(miss);
  return miss.count > 1
    ? new Refusal("ambiguous", `Comment quote is ambiguous; supply start, prefix/suffix or a unique checklist itemId (${said})`)
    : new Refusal("not-found", `Comment quote or context was not found; read the current source and select it again (${said})`);
}

// ── a span of the source, in a text written from it; and a passage as whole words ───────────────────────────────

/** The drawn characters `[from, to)` of `drawn` that came from `span` of its source, or null when none did. */
function drawnRange(drawn: DrawnText, span: { start: number; end: number }): { from: number; to: number } | null {
  let from = -1, to = -1;
  for (let i = 0; i < drawn.at.length; i++) {
    if (drawn.at[i]! >= span.end || drawn.end[i]! <= span.start) continue;
    if (from < 0) from = i;
    to = i + 1;
  }
  return from < 0 ? null : { from, to };
}

/** Every place `words` is in `text`, as offsets. */
function places(text: string, words: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(words); at >= 0; at = text.indexOf(words, at + 1)) found.push(at);
  return found;
}

/**
 * What an anchor on a part's drawn words is found by (part-anchor.ts): a place on drawn text other things attach to.
 * Where `span` of `source` is in `rendered`, a text written from that source for a renderer (a prose part's
 * Markdown, `proseMarkdown`): the range of `rendered` the same drawn words are drawn from. Both texts are read as a
 * reader draws them; where the two readings agree the place is the same place, and where they don't (a reference
 * with no title here, drawn as its id there) the span's own words are looked for, the nearest to where they stood.
 * Null: the span holds nothing a reader draws, or its words aren't in `rendered`.
 */
export function spanIn(source: string, span: { start: number; end: number }, rendered: string, reads: DrawnReads = {}): { start: number; end: number } | null {
  const from = drawnText(source, reads), found = drawnRange(from, span);
  if (!found) return null;
  const words = from.text.slice(found.from, found.to);
  if (!words.trim()) return null;
  const to = drawnText(rendered, reads);
  if (to.text.slice(found.from, found.to) === words) return drawnSpan(rendered, to, found.from, found.to);
  const at = places(to.text, words).sort((a, b) => Math.abs(a - found.from) - Math.abs(b - found.from))[0];
  return at === undefined ? null : drawnSpan(rendered, to, at, at + words.length);
}

const WORD = /[\p{L}\p{N}]/u;
const inWord = (text: string, at: number) => at > 0 && at < text.length && WORD.test(text[at - 1]!) && WORD.test(text[at]!);

/**
 * A passage picked by hand is whole words: a selection that starts or ends inside a word (a press that landed past
 * the middle of its first letter) takes the whole word.
 * `span` of `text` as whole words: a passage that starts or ends inside a word takes the whole word, read as a
 * reader draws the text (so `**Act**ion` is one word, and a word is never cut at a mark). The span it is now, and
 * its words as drawn. A span that holds nothing a reader draws is answered as it came.
 */
export function wholePassage(text: string, span: { start: number; end: number }, reads: DrawnReads = {}): { span: { start: number; end: number }; words: string; widened: boolean } {
  const drawn = drawnText(text, reads), found = drawnRange(drawn, span);
  if (!found) return { span, words: "", widened: false };
  let { from, to } = found;
  while (inWord(drawn.text, from)) from -= 1;
  while (inWord(drawn.text, to)) to += 1;
  const widened = from !== found.from || to !== found.to;
  return { span: widened ? drawnSpan(text, drawn, from, to) : span, words: drawn.text.slice(from, to), widened };
}
