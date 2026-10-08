// The property token's grammar: what a `[key::value]` token and a property key are. This file is the
// one definition. The service's parser (properties.ts), the query language (block-query.ts) and context
// resolution use it, and the door imports it to find tokens while it paints. It lives in outline-core so
// both sides import the same file: any change to what these patterns match bumps PROTOCOL (protocol.ts).
//
// This is the token grammar only. Whether a token counts as a property also depends on where it sits
// (code spans, fences, literal regions, reference labels) and its scope, which `properties.preview`
// answers for a whole text.
//
// A value is not "everything up to the first `]`": it runs to the property's own closing `]`, with the link grammar
// balanced inside it (`[related::[[PC-967]], ((id|plan step 6))]`), and a list of values splits at commas outside links
// (`splitPropertyValue`).

import { blockReferenceOccurrences } from "./link-syntax";

/** A property key: a letter, then letters, digits, `_`, `.` or `-` (`plot.row`, `bed_2`; not `2nd-pass`). */
export const PROPERTY_KEY_SOURCE = "[A-Za-z][A-Za-z0-9_.-]*";
/** The opening of a bracket token: `[key::`. Its value runs on to the property's own closing `]` (`propertyTokenMatches`). */
const PROPERTY_HEAD_SOURCE = String.raw`\[(${PROPERTY_KEY_SOURCE})::`;

export const PROPERTY_KEY_PATTERN = new RegExp(`^${PROPERTY_KEY_SOURCE}$`);

/**
 * A hashtag's value (after the `#`): letters, digits, `_`, marks and `-`, `/` between segments (`#garden/beds`). A
 * hashtag is a property (`tag`) when its value holds a letter and it starts a word; the parser says where.
 */
export const HASHTAG_VALUE_PATTERN = /[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*)*/u;

/** One `[key::value]` token as written: the key as written, the raw value (untrimmed, never empty), offsets of the whole. */
export interface RawPropertyToken {
  key: string;
  value: string;
  raw: string;
  start: number;
  end: number;
}

/**
 * Where the value that starts at `from` ends: the offset of the property's own closing `]`, or -1 when it has none on
 * its line. The link grammar is balanced inside a value: a `((id|label))` reference or embed is skipped whole (its label
 * may hold `]`), and brackets nest (`[[page]]`, `[[page|label]]`). A value whose brackets don't balance on its line
 * (`[note::a [ b]`) ends at the first `]`, as it always did, and never reaches the next line: an unbalanced bracket
 * costs that one value its tail, never the rest of the note.
 */
export function propertyValueEnd(text: string, from: number): number {
  let lineEnd = from;
  while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") lineEnd += 1;
  const line = text.slice(from, lineEnd);
  const first = line.indexOf("]");
  if (first < 1) return -1; // no close, or an empty value (`[key::]` is text)
  // The common value holds no bracket and no reference: the first `]` is its end.
  if (!line.includes("[") && !line.includes("((")) return from + first;
  const references = new Map(blockReferenceOccurrences(line).map(reference => [reference.start, reference.end]));
  let depth = 1;
  for (let at = 0; at < line.length; at += 1) {
    const skip = references.get(at);
    if (skip !== undefined) {
      at = skip - 1;
      continue;
    }
    const character = line[at];
    if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) return at > 0 ? from + at : -1;
  }
  return from + first;
}

/** Every `[key::value]` token of `text` in order, none overlapping, escaped ones included (`isEscapedAt` tells). */
export function propertyTokenMatches(text: string): RawPropertyToken[] {
  const out: RawPropertyToken[] = [];
  const head = new RegExp(PROPERTY_HEAD_SOURCE, "g");
  for (let match = head.exec(text); match; match = head.exec(text)) {
    const valueStart = match.index + match[0].length;
    const close = propertyValueEnd(text, valueStart);
    if (close < 0) continue;
    const end = close + 1;
    out.push({ key: match[1]!, value: text.slice(valueStart, close), raw: text.slice(match.index, end), start: match.index, end });
    head.lastIndex = end;
  }
  return out;
}

/** `text` with each unescaped token replaced by what `replace` makes of it (return `token.raw` to keep it). */
export function replacePropertyTokens(text: string, replace: (token: RawPropertyToken) => string): string {
  let out = "";
  let cursor = 0;
  for (const token of propertyTokenMatches(text)) {
    out += text.slice(cursor, token.start) + (isEscapedAt(text, token.start) ? token.raw : replace(token));
    cursor = token.end;
  }
  return out + text.slice(cursor);
}

/**
 * Whether `value` can be written as `[key::value]` and read back whole: one line, something in it, and the bracket
 * grammar balanced (`[[PC-967]]` can, `a]b` and `a [ b` cannot).
 */
export function isWritablePropertyValue(value: string): boolean {
  if (!value.trim() || /[\r\n]/.test(value)) return false;
  const [token] = propertyTokenMatches(`[k::${value}]`);
  return !!token && token.value === value && token.end === value.length + 5;
}

export function isPropertyKey(key: string): boolean {
  return PROPERTY_KEY_PATTERN.test(key);
}

/** A token preceded by an odd run of backslashes (`\[key::value]`) is escaped: it is text. */
export function isEscapedAt(text: string, offset: number): boolean {
  let cursor = offset;
  while (cursor > 0 && text[cursor - 1] === "\\") cursor -= 1;
  return (offset - cursor) % 2 === 1;
}

export interface PropertyTokenMatch {
  /** The key, lowercased as the service stores it. */
  key: string;
  /** The value, trimmed. */
  value: string;
  raw: string;
  start: number;
  end: number;
}

/** The unescaped `[key::value]` tokens of one line of text, in order. */
export function propertyTokensInLine(line: string): PropertyTokenMatch[] {
  return propertyTokenMatches(line)
    .filter(token => !isEscapedAt(line, token.start))
    .map(token => ({ key: token.key.toLowerCase(), value: token.value.trim(), raw: token.raw, start: token.start, end: token.end }));
}

/** One line with its unescaped tokens taken out (the spaces around them are left as they were). */
export function withoutPropertyTokens(line: string): string {
  let out = "";
  let cursor = 0;
  for (const token of propertyTokensInLine(line)) {
    out += line.slice(cursor, token.start);
    cursor = token.end;
  }
  return out + line.slice(cursor);
}

/** A line holding one or more tokens and nothing else but spaces and tabs. */
export function isPropertyTokenLine(line: string): boolean {
  const tokens = propertyTokensInLine(line);
  return tokens.length > 0 && /^[ \t]*$/.test(withoutPropertyTokens(line));
}

/**
 * A value as a list: split at the commas outside a link or a bracket, trimmed, empty items dropped
 * (`[[PC-967]], ((id|plan, step 6)), notes` is three). A value with no comma is one item.
 */
export function splitPropertyValue(value: string): string[] {
  const references = new Map(blockReferenceOccurrences(value).map(reference => [reference.start, reference.end]));
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < value.length; at += 1) {
    const skip = references.get(at);
    if (skip !== undefined) {
      at = skip - 1;
      continue;
    }
    const character = value[at];
    if (character === "[") depth += 1;
    else if (character === "]") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      items.push(value.slice(from, at));
      from = at + 1;
    }
  }
  items.push(value.slice(from));
  return items.map(item => item.trim()).filter(Boolean);
}

/** A value that is one link written whole: `[[page]]`, `[[page|label]]`, `((id))`, `((id|label))`, `!((id))`. */
export function isLinkValue(value: string): boolean {
  const text = value.trim();
  return /^\[\[[^\]\r\n]+\]\]$/.test(text) || (/^!?\(\(/.test(text) && blockReferenceOccurrences(text.replace(/^!/, "")).some(r => r.start === 0 && r.end === text.replace(/^!/, "").length));
}

/**
 * Whether a property's `value` satisfies a filter's `wanted`: the same, caselessly, or, when `wanted` is one link
 * (`related=[[PC-967]]`), a list of values that holds that link as an item. Anything else compares whole.
 */
export function propertyValueHolds(value: string, wanted: string): boolean {
  const lower = wanted.trim().toLowerCase();
  if (value.trim().toLowerCase() === lower) return true;
  return isLinkValue(wanted) && splitPropertyValue(value).some(item => item.toLowerCase() === lower);
}
