import { codeFenceOpen } from "@ep0ch/outline-core/code-fence";
import { literalMarkerLineStarts, offsetInRanges, protectedCodeRanges, scanLiteralRegions, scanPropertyLiteralRanges, sourceLines, type SourceLine, type SourceRange } from "@ep0ch/outline-core/code-ranges";
import { HASHTAG_VALUE_PATTERN, isEscapedAt, PROPERTY_KEY_PATTERN, PROPERTY_KEY_SOURCE, isWritablePropertyValue, propertyTokenMatches, propertyValueHolds, type RawPropertyToken } from "@ep0ch/outline-core/property-grammar";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { isMediaLine } from "@ep0ch/outline-core/media-line";
import { blockReferenceEnvelopeRanges } from "@ep0ch/outline-core/link-syntax";
import type {
  BlockProperty,
  PropertyFilter,
  PropertyParsePreview,
  PropertyPatchOperation,
  PropertyQueryScope,
  PropertyRecord,
} from "./types";

const BARE_PROPERTY_PATTERN = new RegExp(String.raw`^([ \t]*)(${PROPERTY_KEY_SOURCE})::[ \t]*`);
const DIRECTIVE_LINE_PATTERN = new RegExp(String.raw`^([ \t]*)(?:([-*+])[ \t]+)?(${PROPERTY_KEY_SOURCE})::`);

export const PROPERTY_PARSER_VERSION = 8;

interface PropertyMatch {
  match: RawPropertyToken;
  start: number;
}

type PropertyCandidate = Omit<PropertyRecord, "ordinal" | "scope">;

function containsNonWhitespace(text: string, start: number, end: number): boolean {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (!/\s/.test(text[cursor])) return true;
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
    if (containsNonWhitespace(text, cursor, candidate.start)) return false;
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

  const start = line.start + match[1].length;
  if (offsetInRanges(start, literalRanges)) return null;
  const valueStart = line.start + match[0].length;
  const firstBracket = bracketCandidates.find((candidate) => candidate.start >= valueStart);
  let end = firstBracket?.start ?? line.contentEnd;
  while (end > valueStart && /[ \t]/.test(text[end - 1])) end -= 1;
  const value = text.slice(valueStart, end).trim();
  if (!value) return null;

  return {
    key: match[2].toLowerCase(),
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
  for (const pattern of [
    /\[\[[^\]\r\n]*\]\]/g,
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
    if (!/\p{L}/u.test(match[1]!) || isEscapedAt(text, start) || offsetInRanges(start, excluded)) continue;
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

export function parsePropertyRecords(text: string): PropertyRecord[] {
  const literalRanges = scanPropertyLiteralRanges(text);
  const matches: PropertyMatch[] = [];
  let literalIndex = 0;
  for (const match of propertyTokenMatches(text)) {
    const start = match.start;
    while (literalIndex < literalRanges.length && literalRanges[literalIndex].end <= start) {
      literalIndex += 1;
    }
    const literalRange = literalRanges[literalIndex];
    const isLiteral = literalRange !== undefined && literalRange.start <= start;
    if (!isLiteral && !isEscapedAt(text, start)) matches.push({ match, start });
  }

  const lines = sourceLines(text);
  const bracketCandidates: PropertyCandidate[] = [];
  for (let lineIndex = 0, matchIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineMatches: PropertyMatch[] = [];
    while (matchIndex < matches.length && matches[matchIndex].start < line.end) {
      lineMatches.push(matches[matchIndex]);
      matchIndex += 1;
    }
    if (lineMatches.length === 0) continue;

    for (let index = 0; index < lineMatches.length; index += 1) {
      const { match, start } = lineMatches[index];
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
  const purePropertyLines = new Set<number>();
  // A media line (`[img::path] [size::40%]`, outline-core's media-line grammar) is content to draw, never block
  // metadata, wherever it is: right under the subject too (PIE-598).
  const mediaLine = (lineIndex: number) => isMediaLine(text.slice(lines[lineIndex]!.start, lines[lineIndex]!.contentEnd));
  for (const [lineIndex, lineCandidates] of candidatesByLine) {
    const media = mediaLine(lineIndex);
    if (!media && lineContainsOnlyProperties(text, lines[lineIndex], lineCandidates)) {
      purePropertyLines.add(lineIndex);
    }
    const metadataLine = !media && lineContainsOnlyProperties(
      text, lines[lineIndex]!, lineCandidates.filter(candidate => candidate.syntax !== "bare"),
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

  const firstNonblankLine = lines.findIndex((line) =>
    containsNonWhitespace(text, line.start, line.contentEnd)
  );
  let preambleStart = -1;
  if (firstNonblankLine >= 0) {
    if (purePropertyLines.has(firstNonblankLine)) {
      preambleStart = firstNonblankLine;
    } else {
      // Blank lines, and the media lines a note may open with (its picture), come before its preamble.
      let cursor = firstNonblankLine + 1;
      while (
        cursor < lines.length &&
        (!containsNonWhitespace(text, lines[cursor].start, lines[cursor].contentEnd) || mediaLine(cursor))
      ) {
        cursor += 1;
      }
      if (purePropertyLines.has(cursor)) preambleStart = cursor;
    }
  }

  // The header line's chips (outline-core's one definition: the run of chips ending the first line, blanks or ` - `
  // between them) belong to the block, whatever separates them.
  const header = new Set(headerLine(text, literalRanges).chips.map((chip) => chip.start));
  for (const candidate of candidates) {
    if (header.has(candidate.start) && candidate.placement === "inline") candidate.placement = "trailing-metadata";
  }

  let preambleEnd = preambleStart;
  while (preambleEnd >= 0 && purePropertyLines.has(preambleEnd + 1)) {
    preambleEnd += 1;
  }

  return candidates.map((candidate, ordinal) => {
    let scope: PropertyRecord["scope"];
    if (candidate.syntax === "hashtag") {
      scope = "block";
    } else if (
      preambleStart >= 0 &&
      candidate.line >= preambleStart &&
      candidate.line <= preambleEnd
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
 * (provider keys), so general property parsing keeps its meaning: an empty
 * `status::` and a bulleted `- status:: done` remain prose, and
 * `parsePropertyRecords` output is unchanged for every input.
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
/** Reads a draft with the save-time parser without storing or changing anything. */
export function previewPropertyParse(text: unknown): PropertyParsePreview {
  if (typeof text !== "string") throw new Error("properties.preview requires text");
  const tokens = parsePropertyRecords(text);
  return {
    parserVersion: PROPERTY_PARSER_VERSION,
    properties: tokens
      .filter((property) => property.scope === "block")
      .map(({ key, value }) => ({ key, value })),
    tokens,
  };
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

export function firstLineWithoutPropertyTokens(text: string): string | undefined {
  // The header's chips go with the ` - ` between and before them: `Seed order - [a::1] - [b::2]` is "Seed order".
  const tokens = withHeaderDashes(text, parsePropertyRecords(text).filter(property => property.syntax !== "hashtag"));
  // Matched literal-region markers are hidden in Detail, so they are never the title.
  const markerStarts = literalMarkerLineStarts(text);
  let tokenIndex = 0;
  for (const line of sourceLines(text)) {
    const firstLineToken = tokenIndex;
    while (tokenIndex < tokens.length && tokens[tokenIndex].start < line.end) tokenIndex += 1;
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

export function normalizePropertyKey(key: string): string {
  const normalized = key.trim();
  if (!PROPERTY_KEY_PATTERN.test(normalized)) throw new Error(`Invalid property key: ${key}`);
  return normalized.toLowerCase();
}

export function validateProperty(key: string, value: string): BlockProperty {
  const normalizedKey = normalizePropertyKey(key);
  const normalizedValue = value.trim();
  if (!normalizedValue) throw new Error(`Property value cannot be empty: ${key}`);
  if (!isWritablePropertyValue(normalizedValue)) {
    throw new Error(`Property value must be one line with balanced brackets (links such as [[page]] and ((id|label)) are fine): ${key}`);
  }
  return { key: normalizedKey, value: normalizedValue };
}

export function formatProperty(property: BlockProperty): string {
  const validated = validateProperty(property.key, property.value);
  return `[${validated.key}::${validated.value}]`;
}

export function patchPropertyText(text: string, operations: PropertyPatchOperation[]): string {
  const tokens = parsePropertyRecords(text);
  const mutations: Array<{ start: number; end: number; replacement: string }> = [];
  const touchedOrdinals = new Set<number>();
  const appends: BlockProperty[] = [];

  for (const operation of operations) {
    const operationKind: string = operation.op;
    if (operationKind === "append") {
      const append = operation as Extract<PropertyPatchOperation, { op: "append" }>;
      appends.push(validateProperty(append.key, append.value));
      continue;
    }
    if (operationKind !== "remove" && operationKind !== "replace") {
      throw new Error(`Unknown property patch operation: ${operationKind}`);
    }
    const tokenOperation = operation as Exclude<PropertyPatchOperation, { op: "append" }>;
    if (!Number.isInteger(tokenOperation.ordinal) || tokenOperation.ordinal < 0) {
      throw new Error(`Invalid property token ordinal: ${tokenOperation.ordinal}`);
    }
    if (touchedOrdinals.has(tokenOperation.ordinal)) {
      throw new Error(`Property token patched more than once: ${tokenOperation.ordinal}`);
    }
    touchedOrdinals.add(tokenOperation.ordinal);
    const token = tokens[tokenOperation.ordinal];
    if (!token) throw new Error(`Property token not found: ${tokenOperation.ordinal}`);
    let replacement = "";
    if (operationKind === "replace") {
      const key = "key" in tokenOperation ? tokenOperation.key ?? token.key : token.key;
      const value = "value" in tokenOperation ? tokenOperation.value : token.value;
      const validated = validateProperty(key, value);
      const hashtagValue = validated.value.match(HASHTAG_VALUE_PATTERN)?.[0];
      if (token.syntax === "hashtag") {
        if (validated.key === "tag" && hashtagValue === validated.value && /\p{L}/u.test(validated.value)) {
          replacement = `#${validated.value}`;
        } else {
          // Explicit properties in body prose are inline-scoped. Move a value
          // that cannot use hashtag syntax to the preamble to retain its scope.
          appends.push(validated);
        }
      } else {
        replacement = token.syntax === "bare" ? `${validated.key}:: ${validated.value}` : formatProperty(validated);
      }
    }
    mutations.push({ start: token.start, end: token.end, replacement });
  }

  let patched = text;
  for (const mutation of mutations.sort((left, right) => right.start - left.start)) {
    patched = patched.slice(0, mutation.start) + mutation.replacement + patched.slice(mutation.end);
  }
  if (appends.length === 0) return patched;

  const appendedText = appends.map(formatProperty).join(" ");
  const metadataToken = parsePropertyRecords(patched).find(
    (token) => token.scope === "block" && token.placement === "metadata-line" && token.syntax !== "hashtag",
  );
  if (metadataToken) {
    const lineEnd = patched.indexOf("\n", metadataToken.end);
    let insertion = lineEnd < 0 ? patched.length : lineEnd;
    if (insertion > 0 && patched[insertion - 1] === "\r") insertion -= 1;
    const separator = patched.slice(0, insertion).endsWith(" ") ? "" : " ";
    return patched.slice(0, insertion) + separator + appendedText + patched.slice(insertion);
  }
  if (!patched) return appendedText;

  const firstNewline = patched.indexOf("\n");
  const usesCrlf = firstNewline > 0 && patched[firstNewline - 1] === "\r";
  const lineBreak = usesCrlf ? "\r\n" : "\n";
  let firstLineEnd = firstNewline;
  if (firstNewline < 0) {
    firstLineEnd = patched.length;
  } else if (usesCrlf) {
    firstLineEnd -= 1;
  }
  const firstLine = {
    start: 0,
    end: firstNewline < 0 ? patched.length : firstNewline + 1,
    contentEnd: firstLineEnd,
  };
  // A fence or a literal region on the first line would swallow a property
  // appended after it, so the property goes on its own line before it instead.
  if (codeFenceOpen(patched.slice(0, firstLine.contentEnd)) || scanLiteralRegions(patched).regions[0]?.start === 0) {
    return `${appendedText}${lineBreak}${patched}`;
  }
  if (firstNewline < 0) return `${patched}\n${appendedText}`;
  return `${patched.slice(0, firstLineEnd)}${lineBreak}${appendedText}${patched.slice(firstLineEnd)}`;
}

export function matchingPropertyRecords(
  properties: readonly PropertyRecord[],
  filters: readonly PropertyFilter[],
  propertyScope: PropertyQueryScope = "block",
): PropertyRecord[] {
  const scoped = propertyScope === "all"
    ? properties
    : properties.filter((property) => property.scope === propertyScope);
  if (filters.length === 0) return [...scoped];
  return scoped.filter((property) =>
    filters.some(
      (filter) =>
        property.key === filter.key &&
        (filter.value === undefined || valueMatches(property.value, filter.value)),
    )
  );
}

export function matchesFilters(
  properties: readonly (BlockProperty | PropertyRecord)[],
  filters: readonly PropertyFilter[],
  propertyScope: PropertyQueryScope = "block",
): boolean {
  // Asked of every note on each query and view read: no arrays made per note.
  return filters.every((filter) =>
    properties.some(
      (property) =>
        property.key === filter.key &&
        (propertyScope === "all" || ("scope" in property ? property.scope : "block") === propertyScope) &&
        (filter.value === undefined || valueMatches(property.value, filter.value)),
    )
  );
}

function valueMatches(value: string, wanted: string): boolean {
  return propertyValueHolds(value, wanted);
}

export function getProperty(properties: readonly BlockProperty[], key: string): string | undefined {
  return properties.find((property) => property.key === key.toLowerCase())?.value;
}
