// Literal regions (PIE-422): text between `<!-- literal -->` and `<!-- /literal -->` lines, where the
// service doesn't parse properties (bracket `[key::value]`, bare `key:: value`, hashtags). Links still
// resolve there, and Markdown still renders. Readers hide the matched marker lines, as Detail does.
//
// A mirror of pi-herdr-outliner `src/properties.ts` (`scanLiteralRegions`, `literalMarkerLineStarts`,
// `isLiteralMarkerLine`), line for line, so the door draws a region exactly where the service stops
// parsing. test/literal.test.ts checks it against the service's own functions.

export interface SourceRange { start: number; end: number }
interface SourceLine extends SourceRange { contentEnd: number }
interface FenceMarker { delimiter: "`" | "~"; length: number; end: number }

/** A closed region, marker lines included (offsets into the text). */
export interface LiteralRegion { start: number; end: number; opener: SourceRange; closer: SourceRange }
/** `unterminated`: an opening marker without a closer. It protects nothing, and the scan stops there. */
export interface LiteralRegionScan { regions: LiteralRegion[]; unterminated: SourceRange | null }

function sourceLines(text: string): SourceLine[] {
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

function fenceMarker(text: string, line: SourceLine): FenceMarker | null {
  let cursor = line.start;
  while (cursor < line.contentEnd && text[cursor] === " ") cursor += 1;
  if (cursor - line.start > 3) return null;
  const delimiter = text[cursor];
  if (delimiter !== "`" && delimiter !== "~") return null;
  let end = cursor;
  while (end < line.contentEnd && text[end] === delimiter) end += 1;
  const length = end - cursor;
  return length >= 3 ? { delimiter, length, end } : null;
}

function isClosingFence(text: string, line: SourceLine, opening: FenceMarker): boolean {
  const marker = fenceMarker(text, line);
  if (!marker || marker.delimiter !== opening.delimiter || marker.length < opening.length) return false;
  let cursor = marker.end;
  while (cursor < line.contentEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  return cursor === line.contentEnd;
}

function fencedRanges(text: string, lines: SourceLine[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = fenceMarker(text, lines[index]!);
    if (!opening) continue;
    let closingIndex = index + 1;
    while (closingIndex < lines.length && !isClosingFence(text, lines[closingIndex]!, opening)) closingIndex += 1;
    const end = closingIndex < lines.length ? lines[closingIndex]!.end : text.length;
    ranges.push({ start: lines[index]!.start, end });
    index = closingIndex;
  }
  return ranges;
}

const inRanges = (offset: number, ranges: readonly SourceRange[]) => ranges.some(r => offset >= r.start && offset < r.end);

const OPEN = /^ {0,3}<!--[ \t]*literal[ \t]*-->[ \t]*$/i;
const CLOSE = /^ {0,3}<!--[ \t]*\/literal[ \t]*-->[ \t]*$/i;

/** Whether a line, without its line break, has the form of an opening or closing marker. */
export const isLiteralMarkerLine = (line: string) => OPEN.test(line) || CLOSE.test(line);

/**
 * The regions as the service's save-time parser sees them. Markers count only outside fenced code (so a
 * fence can show the syntax, and a fence inside a region hides a closer in it); regions don't nest; the
 * first closer ends one; an opener without a closer protects nothing and ends the scan.
 */
export function scanLiteralRegions(text: string): LiteralRegionScan {
  const lines = sourceLines(text);
  const fences = fencedRanges(text, lines);
  const matches = (line: SourceLine, pattern: RegExp) => !inRanges(line.start, fences) && pattern.test(text.slice(line.start, line.contentEnd));
  const regions: LiteralRegion[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]!;
    if (!matches(opening, OPEN)) continue;
    let closing = index + 1;
    while (closing < lines.length && !matches(lines[closing]!, CLOSE)) closing += 1;
    if (closing >= lines.length) return { regions, unterminated: { start: opening.start, end: opening.contentEnd } };
    const closer = lines[closing]!;
    regions.push({ start: opening.start, end: closer.end, opener: { start: opening.start, end: opening.contentEnd }, closer: { start: closer.start, end: closer.contentEnd } });
    index = closing;
  }
  return { regions, unterminated: null };
}

/** Start offsets of matched marker lines. An unterminated opener is text, so it isn't one. */
export function literalMarkerLineStarts(text: string): Set<number> {
  return new Set(scanLiteralRegions(text).regions.flatMap(r => [r.opener.start, r.closer.start]));
}

/**
 * The same by line number (0 = the subject line, lines split on "\n"): `markers`, the matched marker
 * lines a reader hides; `inside`, the lines between them, where properties are text; `unterminated`, the
 * line of an opener without a closer (which protects nothing), or null.
 */
export function literalLines(text: string): { markers: Set<number>; inside: Set<number>; unterminated: number | null } {
  const scan = scanLiteralRegions(text);
  const markers = new Set<number>(), inside = new Set<number>();
  if (!scan.regions.length && !scan.unterminated) return { markers, inside, unterminated: null };
  const lineOf = (() => {
    const starts: number[] = [];
    let o = 0;
    for (const l of text.split("\n")) { starts.push(o); o += l.length + 1; }
    return (off: number) => { let i = 0; while (i + 1 < starts.length && starts[i + 1]! <= off) i++; return i; };
  })();
  for (const r of scan.regions) {
    const a = lineOf(r.opener.start), b = lineOf(r.closer.start);
    markers.add(a); markers.add(b);
    for (let i = a + 1; i < b; i++) inside.add(i);
  }
  return { markers, inside, unterminated: scan.unterminated ? lineOf(scan.unterminated.start) : null };
}
