// Where a note's text is code or literal, so a token there is text: fenced code, code spans, `<!-- literal -->`
// regions. The service's property parser, reference scanner and section readers and every client's renderer ask
// these, so a fence the service treats as code is drawn as code everywhere. Pure: no I/O.

import { closesCodeFence, codeBlocks, codeFenceOpen, type CodeFence } from "./code-fence";
import { quoteDepth, stripQuotes } from "./callouts";
import { componentBlocks } from "./component-block";

/** An offset range of the text: `start` inclusive, `end` exclusive. */
export interface SourceRange { start: number; end: number }

/** A line of a text by offsets: `end` after its line break, `contentEnd` before it (and before a `\r`). */
export interface SourceLine extends SourceRange { contentEnd: number }

/** The lines of `text` by offsets; an empty text has one empty line. */
export function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    const contentEnd = newline < 0 ? text.length : newline > start && text[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({ start, end, contentEnd });
    start = end;
  }
  if (text.length === 0) lines.push({ start: 0, end: 0, contentEnd: 0 });
  return lines;
}

function fencedRangesOf(text: string, lines: SourceLine[]): SourceRange[] {
  return codeBlocks(lines.map(line => text.slice(line.start, line.contentEnd))).fences
    .map(block => ({ start: lines[block.start]!.start, end: lines[block.end]!.end }));
}

/** The fenced code blocks of `text`, opening and closing lines (with their line breaks) included. */
export function fencedRanges(text: string): SourceRange[] {
  return fencedRangesOf(text, sourceLines(text));
}

/** Whether `offset` falls in one of `ranges`. */
export function offsetInRanges(offset: number, ranges: readonly SourceRange[]): boolean {
  return ranges.some(range => offset >= range.start && offset < range.end);
}

function findEqualBacktickRun(text: string, start: number, end: number, length: number): number {
  let cursor = start;
  while (cursor < end) {
    const opener = text.indexOf("`", cursor);
    if (opener < 0 || opener >= end) return -1;
    let runEnd = opener + 1;
    while (runEnd < end && text[runEnd] === "`") runEnd += 1;
    if (runEnd - opener === length) return opener;
    cursor = runEnd;
  }
  return -1;
}

/**
 * The property parser's code spans outside `blockRanges`: a run of backticks to the next run of the same length, or
 * to the end of its line when none closes it (an unclosed span still protects what follows on its line).
 */
function inlineLiteralRanges(text: string, lines: SourceLine[], blockRanges: SourceRange[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  let lineIndex = 0;

  function scanRegion(start: number, end: number): void {
    let cursor = start;
    while (cursor < end) {
      const opener = text.indexOf("`", cursor);
      if (opener < 0 || opener >= end) return;
      while (lineIndex + 1 < lines.length && lines[lineIndex]!.end <= opener) lineIndex += 1;

      let openerEnd = opener + 1;
      while (openerEnd < end && text[openerEnd] === "`") openerEnd += 1;
      const length = openerEnd - opener;
      const closing = findEqualBacktickRun(text, openerEnd, end, length);
      if (closing >= 0) {
        const rangeEnd = closing + length;
        ranges.push({ start: opener, end: rangeEnd });
        cursor = rangeEnd;
      } else {
        ranges.push({ start: opener, end: lines[lineIndex]!.contentEnd });
        cursor = lines[lineIndex]!.end;
      }
    }
  }

  let regionStart = 0;
  for (const range of blockRanges) {
    scanRegion(regionStart, range.start);
    regionStart = range.end;
  }
  scanRegion(regionStart, text.length);
  return ranges;
}

// ── literal regions (PIE-422): `<!-- literal -->` … `<!-- /literal -->`, where properties are text ─────────────

const LITERAL_REGION_OPEN = /^ {0,3}<!--[ \t]*literal[ \t]*-->[ \t]*$/i;
const LITERAL_REGION_CLOSE = /^ {0,3}<!--[ \t]*\/literal[ \t]*-->[ \t]*$/i;

/** Whether a line, without its line break, has the form of an opening or closing marker. */
export function isLiteralMarkerLine(line: string): boolean {
  return LITERAL_REGION_OPEN.test(line) || LITERAL_REGION_CLOSE.test(line);
}

/** A closed `<!-- literal -->` ... `<!-- /literal -->` region, marker lines included. */
export interface LiteralRegion {
  start: number;
  end: number;
  /** The opening marker line, excluding its line break. */
  opener: SourceRange;
  /** The closing marker line, excluding its line break. */
  closer: SourceRange;
}

export interface LiteralRegionScan {
  regions: LiteralRegion[];
  /** An opening marker without a closer. It protects nothing; clients warn. */
  unterminated: SourceRange | null;
}

function literalRegionsFromLines(text: string, lines: SourceLine[], fences: SourceRange[]): LiteralRegionScan {
  // Markers are recognised only outside fenced code, so a fence can show the
  // marker syntax and a fence inside a region hides a closer it contains.
  const outsideFence = (line: SourceLine) => !offsetInRanges(line.start, fences);
  const matches = (line: SourceLine, pattern: RegExp) =>
    outsideFence(line) && pattern.test(text.slice(line.start, line.contentEnd));
  const regions: LiteralRegion[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]!;
    if (!matches(opening, LITERAL_REGION_OPEN)) continue;
    let closing = index + 1;
    while (closing < lines.length && !matches(lines[closing]!, LITERAL_REGION_CLOSE)) closing += 1;
    if (closing >= lines.length) {
      return { regions, unterminated: { start: opening.start, end: opening.contentEnd } };
    }
    const closer = lines[closing]!;
    regions.push({
      start: opening.start,
      end: closer.end,
      opener: { start: opening.start, end: opening.contentEnd },
      closer: { start: closer.start, end: closer.contentEnd },
    });
    index = closing;
  }
  return { regions, unterminated: null };
}

/**
 * Literal regions as the save-time parser sees them, for renderers that hide markers. Markers count only outside
 * fenced code; regions don't nest; the first closer ends one; an opener without a closer protects nothing and ends
 * the scan.
 */
export function scanLiteralRegions(text: string): LiteralRegionScan {
  const lines = sourceLines(text);
  return literalRegionsFromLines(text, lines, fencedRangesOf(text, lines));
}

/** Start offsets of matched marker lines. An unterminated opener is text, so it is not included. */
export function literalMarkerLineStarts(text: string): Set<number> {
  return new Set(scanLiteralRegions(text).regions.flatMap(region => [region.opener.start, region.closer.start]));
}

/**
 * Matched marker lines with one adjoining line break each, for callers that
 * drop them from single-line summaries. The last line takes its preceding break.
 */
export function literalMarkerLineRanges(text: string): SourceRange[] {
  const lines = sourceLines(text);
  const starts = new Set(literalRegionsFromLines(text, lines, fencedRangesOf(text, lines)).regions
    .flatMap(region => [region.opener.start, region.closer.start]));
  return lines.flatMap((line, index) => {
    if (!starts.has(line.start)) return [];
    if (line.end > line.contentEnd || index === 0) return [{ start: line.start, end: line.end }];
    return [{ start: lines[index - 1]!.contentEnd, end: line.end }];
  });
}

/**
 * The literal regions by line number (0 = the subject line, lines split on "\n"): `markers`, the matched marker
 * lines a reader hides; `inside`, the lines between them, where properties are text; `unterminated`, the line of an
 * opener without a closer (which protects nothing), or null.
 */
export function literalLines(text: string): { markers: Set<number>; inside: Set<number>; unterminated: number | null } {
  const scan = scanLiteralRegions(text);
  const markers = new Set<number>(), inside = new Set<number>();
  if (!scan.regions.length && !scan.unterminated) return { markers, inside, unterminated: null };
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lineOf = (offset: number) => { let i = 0; while (i + 1 < starts.length && starts[i + 1]! <= offset) i++; return i; };
  for (const region of scan.regions) {
    const a = lineOf(region.opener.start), b = lineOf(region.closer.start);
    markers.add(a); markers.add(b);
    for (let i = a + 1; i < b; i++) inside.add(i);
  }
  return { markers, inside, unterminated: scan.unterminated ? lineOf(scan.unterminated.start) : null };
}

// ── structural literals (PIE-690): a component's YAML and a fence inside a quote ──────────────────────────────

const YAML_FENCE_LINE = /^ {0,3}---[ \t]*$/;

/**
 * Line spans (first and last line, inclusive) that are literal because of the block they sit in, not a top-level
 * fence: the front matter of a `::component` (its `---` lines and what they hold: a figure's query string is the
 * figure's, never a tag), and a code fence inside a quote or callout (`> ```` opens one at the depth it is quoted
 * to). Both are bounded the way their readers bound them (PIE-669): an unclosed component is plain text, so it
 * swallows nothing, and an unclosed quoted fence ends where its quote does.
 */
export function structuralLiteralLines(lines: readonly string[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const block of componentBlocks(lines)) {
    let open = -1, closed = false;
    for (let i = block.start + 1; i <= block.end; i++) {
      if (!YAML_FENCE_LINE.test(lines[i]!.replace(/\r$/, ""))) continue;
      if (open < 0) open = i;
      else { spans.push({ start: open, end: i }); closed = true; break; }
    }
    // Front matter the component closes without a second `---`: literal to the block's end.
    if (open >= 0 && !closed) spans.push({ start: open, end: block.end });
  }
  let fence = null as { depth: number; code: CodeFence; start: number } | null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, ""), { depth, content } = quoteDepth(line);
    if (fence && depth < fence.depth) { spans.push({ start: fence.start, end: i - 1 }); fence = null; }
    if (fence) {
      if (closesCodeFence(stripQuotes(line, fence.depth), fence.code)) { spans.push({ start: fence.start, end: i }); fence = null; }
      return;
    }
    const code = depth ? codeFenceOpen(content) : null;
    if (code) fence = { depth, code, start: i };
  });
  const unclosed = fence as { start: number } | null;
  if (unclosed) spans.push({ start: unclosed.start, end: lines.length - 1 });
  return spans;
}

/** `structuralLiteralLines` by offsets: whole lines, line breaks included unless `withBreak` is false. */
function structuralLiteralRanges(text: string, lines: SourceLine[], withBreak = true): SourceRange[] {
  const texts = lines.map(line => text.slice(line.start, line.contentEnd));
  return structuralLiteralLines(texts).map(span => ({ start: lines[span.start]!.start, end: withBreak ? lines[span.end]!.end : lines[span.end]!.contentEnd }));
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  const merged: SourceRange[] = [];
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Where the property parser reads no property (a `[key::value]`, a bare `key::` line, a hashtag): fenced code,
 * literal regions, a component's YAML, fences in quotes and code spans, merged and in order.
 */
export function scanPropertyLiteralRanges(text: string): SourceRange[] {
  const lines = sourceLines(text);
  const fences = fencedRangesOf(text, lines);
  const { regions } = literalRegionsFromLines(text, lines, fences);
  // Fences and regions are block-level; inline code never pairs across them.
  const blockRanges = mergeRanges([...fences, ...regions, ...structuralLiteralRanges(text, lines)]);
  const inlineLiterals = inlineLiteralRanges(text, lines, blockRanges);
  return mergeRanges([...blockRanges, ...inlineLiterals]);
}

// ── code a link can't be in: fences (in list items too), indented code and code spans ─────────────────────────

/**
 * The code a reference or an authored link can't be in: fenced code and indented code (`codeBlocks`), and code
 * spans (`codeSpanRanges`). Ranges are by line, without line
 * breaks, and may overlap.
 */
export function protectedCodeRanges(text: string): SourceRange[] {
  const lines = text.split("\n"), starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
  const lineRange = (i: number) => ({ start: starts[i]!, end: starts[i]! + lines[i]!.length });
  const { fences, indented } = codeBlocks(lines);
  const ranges: SourceRange[] = [];
  for (const block of fences) for (let i = block.start; i <= block.end; i++) ranges.push(lineRange(i));
  for (const i of indented) ranges.push(lineRange(i));
  ranges.push(...structuralLiteralRanges(text, sourceLines(text), false));
  ranges.push(...codeSpanRanges(text));
  return ranges;
}

/** The code spans a link can't be in: a run of backticks to the next as many backticks on its line. */
export function codeSpanRanges(text: string): SourceRange[] {
  return [...text.matchAll(/(`+)[^\n]*?\1/g)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
