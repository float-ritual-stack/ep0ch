// The property parser (PIE-533 S0a): every `[key::value]` chip, bare `key:: value` line and #hashtag in a text, with
// where it sits, its scope (block, line or inline) and its placement, in source order. The service's save-time parser
// and every client or extension that reads a note's properties use this one; nobody copies it. Pure: no I/O.
import { codeHides, literalMarkerLineStarts, offsetInRanges, protectedCodeRanges, scanPropertyLiteralRanges, sourceLines, type SourceLine, type SourceRange } from "./code-ranges";
import { maskOutputRegions } from "./output-region";
import { HASHTAG_VALUE_PATTERN, isEscapedAt, isHexColour, PROPERTY_KEY_SOURCE, propertyTokenMatches, type RawPropertyToken } from "./property-grammar";
import { frontMatterLines, headerLine } from "./header-line";
import { isMediaLine } from "./media-line";
import { markTitleLine } from "./annotation-marks";
import { blockReferenceEnvelopeRanges, pageLinkRanges } from "./link-syntax";
import type { BlockProperty } from "./protocol";

export type PropertyPlacement = "inline" | "trailing-metadata" | "metadata-line";
export type PropertyScope = "block" | "line" | "inline";
export type PropertySyntax = "bracket" | "bare" | "hashtag";

/**
 * One property token in a text as the parser reads it: key, value, scope (block / line / inline), where it sits (`start`
 * and `end` are offsets in the text, `line` and `column` the position of its first character) and the `ordinal`
 * `properties.patch` addresses. Ordinals count every token (hashtags too) and hold only for exactly that text.
 */
export interface PropertyRecord extends BlockProperty {
  ordinal: number;
  raw: string;
  start: number;
  end: number;
  line: number;
  column: number;
  placement: PropertyPlacement;
  scope: PropertyScope;
  syntax: PropertySyntax;
}

const BARE_PROPERTY_PATTERN = new RegExp(String.raw`^([ \t]*(?:[-*+][ \t]+)?)(${PROPERTY_KEY_SOURCE})::[ \t]*`);
const DIRECTIVE_LINE_PATTERN = new RegExp(String.raw`^([ \t]*)(?:([-*+])[ \t]+)?(${PROPERTY_KEY_SOURCE})::`);

// Qualified links change the reference candidate index rebuilt with the property index.
export const PROPERTY_PARSER_VERSION = 15;

interface PropertyMatch {
  match: RawPropertyToken;
  start: number;
}

type PropertyCandidate = Omit<PropertyRecord, "ordinal" | "scope">;

function containsNonWhitespace(text: string, start: number, end: number): boolean {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (!/\s/.test(text[cursor]!)) return true;
  }
  return false;
}


function removeRanges(text: string, ranges: SourceRange[], start = 0, end = text.length): string {
  if (ranges.length === 0) return text.slice(start, end);

  const parts: string[] = [];
  let cursor = start;
  for (const range of ranges) {
    if (range.end <= cursor) continue;
    if (range.start >= end) break;
    if (cursor < range.start) parts.push(text.slice(cursor, range.start));
    cursor = Math.min(Math.max(cursor, range.end), end);
  }
  if (cursor < end) parts.push(text.slice(cursor, end));
  return parts.join("");
}

function propertyCandidateLines(
  candidates: readonly PropertyCandidate[],
): Map<number, PropertyCandidate[]> {
  const byLine = new Map<number, PropertyCandidate[]>();
  for (const candidate of candidates) {
    const lineCandidates = byLine.get(candidate.line);
    if (lineCandidates) lineCandidates.push(candidate);
    else byLine.set(candidate.line, [candidate]);
  }
  return byLine;
}

function lineContainsOnlyProperties(
  text: string,
  line: SourceLine,
  candidates: readonly PropertyCandidate[],
): boolean {
  if (candidates.length === 0) return false;
  let cursor = line.start;
  for (const candidate of candidates) {
    if (!/^[ \t]*(?:[-*+][ \t]+)?$/.test(text.slice(cursor, candidate.start))) return false;
    cursor = candidate.end;
  }
  return !containsNonWhitespace(text, cursor, line.contentEnd);
}

function parseBarePropertyCandidate(
  text: string,
  line: SourceLine,
  lineIndex: number,
  literalRanges: readonly SourceRange[],
  bracketCandidates: readonly PropertyCandidate[],
): PropertyCandidate | null {
  const content = text.slice(line.start, line.contentEnd);
  const match = BARE_PROPERTY_PATTERN.exec(content);
  if (!match) return null;

  const start = line.start + match[1]!.length;
  if (offsetInRanges(start, literalRanges)) return null;
  const valueStart = line.start + match[0].length;
  const firstBracket = bracketCandidates.find((candidate) => candidate.start >= valueStart);
  let end = firstBracket?.start ?? line.contentEnd;
  while (end > valueStart && /[ \t]/.test(text[end - 1]!)) end -= 1;
  const value = text.slice(valueStart, end).trim();
  if (!value) return null;

  return {
    key: match[2]!.toLowerCase(),
    value,
    raw: text.slice(start, end),
    start,
    end,
    line: lineIndex,
    column: start - line.start,
    placement: "metadata-line",
    syntax: "bare",
  };
}

function hashtagCandidates(
  text: string,
  lines: readonly SourceLine[],
  literalRanges: readonly SourceRange[],
  properties: readonly PropertyCandidate[],
): PropertyCandidate[] {
  if (!text.includes("#")) return [];
  // Tags are prose, not the fragments or labels inside a link. Property values
  // already have an owner; a hash inside one must not create another property.
  const excluded = [...literalRanges, ...protectedCodeRanges(text), ...properties, ...blockReferenceEnvelopeRanges(text)];
  for (const token of propertyTokenMatches(text)) excluded.push({ start: token.start, end: token.end });
  excluded.push(...pageLinkRanges(text));
  for (const pattern of [
    /!?\[[^\]\r\n]*\]\((?:\\.|[^\\)\r\n])*\)/g,
    /^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*/gm,
    /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi,
  ]) {
    for (const match of text.matchAll(pattern)) {
      excluded.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  const candidates: PropertyCandidate[] = [];
  let lineIndex = 0;
  for (const match of text.matchAll(new RegExp(`#(${HASHTAG_VALUE_PATTERN.source})`, "gu"))) {
    const start = match.index;
    if (!/\p{L}/u.test(match[1]!) || isHexColour(match[1]!) || isEscapedAt(text, start) || offsetInRanges(start, excluded)) continue;
    let boundary = start;
    while (boundary > 0 && text[boundary - 1] === "\\") boundary -= 1;
    if (boundary > 0 && !/[\s([{"'“‘]/u.test(text[boundary - 1]!)) continue;
    while (lineIndex + 1 < lines.length && lines[lineIndex]!.end <= start) lineIndex += 1;
    candidates.push({
      key: "tag",
      value: match[1]!,
      raw: match[0],
      start,
      end: start + match[0].length,
      line: lineIndex,
      column: start - lines[lineIndex]!.start,
      placement: "inline",
      syntax: "hashtag",
    });
  }
  return candidates;
}

export function parsePropertyRecords(source: string): PropertyRecord[] {
  // An output region (a script's or an agent's answer, output-region.ts) is its producer's: its chips aren't the note's properties (PIE-956).
  const text = maskOutputRegions(source);
  const literalRanges = scanPropertyLiteralRanges(text);
  const matches: PropertyMatch[] = [];
  let literalIndex = 0;
  for (const match of propertyTokenMatches(text)) {
    const start = match.start;
    while (literalIndex < literalRanges.length && literalRanges[literalIndex]!.end <= start) {
      literalIndex += 1;
    }
    // Literal ranges are merged and in order: only the ones from here to the token's end can hide it (the one rule,
    // outline-core's codeHides: a span inside the value is the value's, one that holds the token or runs past it isn't).
    let isLiteral = false;
    for (let i = literalIndex; i < literalRanges.length && literalRanges[i]!.start < match.end && !isLiteral; i += 1) {
      isLiteral = codeHides(match, [literalRanges[i]!]);
    }
    if (!isLiteral && !isEscapedAt(text, start)) matches.push({ match, start });
  }

  const lines = sourceLines(text);
  const bracketCandidates: PropertyCandidate[] = [];
  for (let lineIndex = 0, matchIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const lineMatches: PropertyMatch[] = [];
    while (matchIndex < matches.length && matches[matchIndex]!.start < line.end) {
      lineMatches.push(matches[matchIndex]!);
      matchIndex += 1;
    }
    if (lineMatches.length === 0) continue;

    for (let index = 0; index < lineMatches.length; index += 1) {
      const { match, start } = lineMatches[index]!;
      const raw = match.raw;
      bracketCandidates.push({
        key: match.key.toLowerCase(),
        value: match.value.trim(),
        raw,
        start,
        end: start + raw.length,
        line: lineIndex,
        column: start - line.start,
        placement: "inline",
        syntax: "bracket",
      });
    }
  }

  const bracketCandidatesByLine = propertyCandidateLines(bracketCandidates);
  const bareCandidates = lines.flatMap((line, lineIndex) => {
    const candidate = parseBarePropertyCandidate(
      text,
      line,
      lineIndex,
      literalRanges,
      bracketCandidatesByLine.get(lineIndex) ?? [],
    );
    return candidate ? [candidate] : [];
  });
  const explicitCandidates = [...bracketCandidates, ...bareCandidates];
  const candidates = [
    ...explicitCandidates,
    ...hashtagCandidates(text, lines, literalRanges, explicitCandidates),
  ].sort(
    (left, right) => left.start - right.start,
  );
  const candidatesByLine = propertyCandidateLines(candidates);
  // A media line (`[img::path] [size::40%]`, outline-core's media-line grammar) is content to draw, never block
  // metadata, wherever it is: right under the subject too (PIE-598).
  const mediaLine = (lineIndex: number) => isMediaLine(text.slice(lines[lineIndex]!.start, lines[lineIndex]!.contentEnd));
  for (const [lineIndex, lineCandidates] of candidatesByLine) {
    const media = mediaLine(lineIndex);
    const metadataLine = !media && lineContainsOnlyProperties(
      text, lines[lineIndex]!, lineCandidates,
    );
    let trailing = true;
    let end = lines[lineIndex]!.contentEnd;
    for (let index = lineCandidates.length - 1; index >= 0; index -= 1) {
      const candidate = lineCandidates[index]!;
      trailing &&= !containsNonWhitespace(text, candidate.end, end);
      if (candidate.syntax !== "bare") {
        candidate.placement = metadataLine ? "metadata-line"
          : trailing ? "trailing-metadata" : "inline";
      }
      end = candidate.start;
    }
  }

  const front = frontMatterLines(text);

  // The header line's chips (outline-core's one definition: the run of chips ending the first line, blanks or ` - `
  // between them) belong to the block, whatever separates them.
  const header = new Set(headerLine(text, literalRanges).chips.map((chip) => chip.start));
  for (const candidate of candidates) {
    if (header.has(candidate.start) && candidate.placement === "inline") candidate.placement = "trailing-metadata";
  }

  return candidates.map((candidate, ordinal) => {
    let scope: PropertyRecord["scope"];
    if (candidate.syntax === "hashtag") {
      scope = "block";
    } else if (
      front.has(candidate.line) && !mediaLine(candidate.line)
    ) {
      scope = "block";
    } else if (candidate.syntax === "bracket" && header.has(candidate.start)) {
      scope = "block";
    } else {
      scope = candidate.syntax === "bare" ? "line" : "inline";
    }
    return { ...candidate, ordinal, scope };
  });
}

/**
 * A provider line such as `jira::`, `jira:: --comments` or floatty's
 * `- jira:: --comments`. It is recognized only for the keys a caller supplies
 * (provider keys). Empty values remain provider directives rather than properties.
 */
export interface PropertyDirectiveLine {
  key: string;
  /** Trimmed text after `::`, up to any bracket property on the line. */
  value: string;
  /** The key's offset, as a bare property record would report it. */
  start: number;
  end: number;
  line: number;
  /** Leading whitespace of the line, before any bullet. */
  indent: string;
  bullet: boolean;
  /** The block-scope bare record at the same offset, when the line sits in the preamble. */
  blockScope: boolean;
}

export function parsePropertyDirectiveLines(
  text: string,
  keys: ReadonlySet<string>,
): PropertyDirectiveLine[] {
  if (keys.size === 0 || !text.includes("::")) return [];
  const literalRanges = scanPropertyLiteralRanges(text);
  const records = parsePropertyRecords(text);
  const directives: PropertyDirectiveLine[] = [];
  sourceLines(text).forEach((line, lineIndex) => {
    const content = text.slice(line.start, line.contentEnd);
    const match = DIRECTIVE_LINE_PATTERN.exec(content);
    if (!match) return;
    const key = match[3]!.toLowerCase();
    if (!keys.has(key)) return;
    const start = line.start + match[0].length - match[3]!.length - 2;
    if (offsetInRanges(line.start + match[1]!.length, literalRanges)) return;
    const valueStart = line.start + match[0].length;
    const bracket = records.find((record) =>
      record.line === lineIndex && record.syntax === "bracket" && record.start >= valueStart
    );
    let end = bracket?.start ?? line.contentEnd;
    while (end > valueStart && /[ \t]/.test(text[end - 1]!)) end -= 1;
    const bare = records.find((record) => record.syntax === "bare" && record.start === start);
    directives.push({
      key,
      value: text.slice(valueStart, end).trim(),
      start,
      end,
      line: lineIndex,
      indent: match[1]!,
      bullet: match[2] !== undefined,
      blockScope: bare?.scope === "block",
    });
  });
  return directives;
}

export function parseProperties(text: string): BlockProperty[] {
  return parsePropertyRecords(text)
    .filter((property) => property.scope === "block")
    .map(({ key, value }) => ({ key, value }));
}

export function stripPropertyTokens(text: string): string {
  return removeRanges(text, withHeaderDashes(text, parsePropertyRecords(text).filter(property => property.syntax !== "hashtag")));
}

/**
 * Property ranges with the header line's ` -` separators added (outline-core's header-line.ts), in order: what a title
 * takes out of the first line.
 */
export function withHeaderDashes<T extends SourceRange>(text: string, ranges: readonly T[]): (T | SourceRange)[] {
  const dashes = headerLine(text, scanPropertyLiteralRanges(text)).dashes;
  return dashes.length ? [...ranges, ...dashes].sort((left, right) => left.start - right.start) : [...ranges];
}

export function titlePropertyRanges(text: string): SourceRange[] {
  const tags = new Set(headerLine(text, scanPropertyLiteralRanges(text)).tags.map(tag => tag.start));
  return withHeaderDashes(text, parsePropertyRecords(text).filter(property => property.syntax !== "hashtag" || tags.has(property.start)));
}

export function firstLineWithoutPropertyTokens(text: string): string | undefined {
  // A mark's title is its own words, not its generated heading (outline-core's annotation-marks.ts).
  const mark = markTitleLine(text);
  if (mark) return mark.text;
  // The header's chips go with the ` - ` between and before them: `Seed order - [a::1] - [b::2]` is "Seed order".
  const tokens = titlePropertyRanges(text);
  // Matched literal-region markers are hidden in Detail, so they are never the title.
  const markerStarts = literalMarkerLineStarts(text);
  let tokenIndex = 0;
  for (const line of sourceLines(text)) {
    const firstLineToken = tokenIndex;
    while (tokenIndex < tokens.length && tokens[tokenIndex]!.start < line.end) tokenIndex += 1;
    if (markerStarts.has(line.start)) continue;
    const lineWithoutProperties = removeRanges(
      text,
      tokens.slice(firstLineToken, tokenIndex),
      line.start,
      line.contentEnd,
    );
    if (lineWithoutProperties.trim()) return lineWithoutProperties;
  }
  return undefined;
}

export function stripProperties(text: string): string {
  return stripPropertyTokens(text).replace(/\s{2,}/g, " ").trim();
}
