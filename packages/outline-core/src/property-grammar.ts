// The property token's grammar: what a `[key::value]` token and a property key are. This file is the
// one definition. The service's parser (properties.ts), the query language (block-query.ts) and context
// resolution use it, and the door imports it to find tokens while it paints. It lives in outline-core so
// both sides import the same file: any change to what these patterns match bumps PROTOCOL (protocol.ts).
//
// `propertyTokenMatches` is the token grammar only. Whether a token counts as a property also depends on where it
// sits (code spans, fences, literal regions, reference labels) and its scope, which `properties.preview` answers for
// a whole text; the line readers (`propertyTokensInLine` and what uses it) leave a line's code spans out themselves.
//
// A value is not "everything up to the first `]`": it runs to the property's own closing `]`, with the link grammar
// balanced inside it (`[related::[[PC-967]], ((id|plan step 6))]`), and a list of values splits at commas outside links
// (`splitPropertyValue`).

import { blockReferenceOccurrences, pageAddressReferences, pageLinkRanges, type BlockReferenceOccurrence, type PageAddressReference } from "./link-syntax";
import { isTicketKey } from "./work-ids";
import { codeHides, codeSpanRanges } from "./code-ranges";

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
 * costs that one value its tail, never the rest of the note. One that another `[key::` opens inside before that `]`
 * is no property at all, so it never swallows the next one.
 */
export function propertyValueEnd(text: string, from: number): number {
  let lineEnd = from;
  while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") lineEnd += 1;
  const line = text.slice(from, lineEnd);
  const first = line.indexOf("]");
  if (first < 1) return -1; // no close, or an empty value (`[key::]` is text)
  // The common value holds no bracket and no reference: the first `]` is its end.
  if (!line.includes("[") && !line.includes("((")) return from + first;
  // The value's own structure: a reference here is grammar, wherever the token sits.
  const references = new Map(blockReferenceOccurrences(line, []).map(reference => [reference.start, reference.end]));
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
  // Unbalanced. When another `[key::` opens before that first `]`, this one was never closed (`[status:: [due::Fri]`):
  // it is text, and the next one is read (PIE-669).
  // So was one whose first `]` would cut a `[[page]]` in two (`[status:: see [[Beds]]`, its own `]` not typed yet).
  const head = new RegExp(PROPERTY_HEAD_SOURCE, "g").exec(line);
  if ((head && head.index < first) || line.slice(0, first).includes("[[")) return -1;
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

/** `text` with each token that is a property (unescaped, outside a code span) replaced by what `replace` makes of it. */
export function replacePropertyTokens(text: string, replace: (token: RawPropertyToken) => string): string {
  let out = "";
  let cursor = 0;
  const code = text.includes("`") ? codeSpanRanges(text) : [];
  for (const token of propertyTokenMatches(text)) {
    out += text.slice(cursor, token.start) + (isEscapedAt(text, token.start) || codeHides(token, code) ? token.raw : replace(token));
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

/**
 * The `[key::value]` tokens of one line of text that are properties, in order: unescaped, and not in a code span
 * (PIE-764: `` `[key::value]` `` quotes the syntax; `codeSpanRanges` is the rule). Fences are the caller's: a line
 * alone can't say it is in one.
 */
export function propertyTokensInLine(line: string): PropertyTokenMatch[] {
  const code = line.includes("`") ? codeSpanRanges(line) : [];
  return propertyTokenMatches(line)
    .filter(token => !isEscapedAt(line, token.start) && !codeHides(token, code))
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
  const references = new Map(blockReferenceOccurrences(value, []).map(reference => [reference.start, reference.end]));
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
  const [page] = text.startsWith("[[") ? pageLinkRanges(text) : [];
  return (!!page && page.start === 0 && page.end === text.length && text.length > 4) || (/^!?\(\(/.test(text) && blockReferenceOccurrences(text.replace(/^!/, ""), []).some(r => r.start === 0 && r.end === text.replace(/^!/, "").length));
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

/**
 * A link written inside a property's value (PIE-874): a `((id))` or `[[page]]` anywhere in it, or an item of the value
 * that is exactly a ticket key (`[ticket::PC-582]`, `[blocks::PIE-12, PIE-14]`), whatever the key: properties are open.
 * Offsets are the whole text's. Anything else in a value stays text.
 */
export type PropertyValueLink =
  | { key: string; kind: "block"; reference: BlockReferenceOccurrence }
  | { key: string; kind: "page"; reference: PageAddressReference }
  | { key: string; kind: "ticket"; workId: string; start: number; end: number };

/**
 * The keys whose value names the note itself (its page address, its Work ID), never a link out: `[page::Seeds]` is
 * the note being Seeds, `[work-id::PIE-12]` the note being PIE-12. Owned by the page addresses and the workboard.
 */
export const ADDRESS_KEYS: ReadonlySet<string> = new Set(["page", "work-id"]);

/** Where a token's value is in its raw text: after `::`, to its closing `]` (a `[key::value]`) or its end (`key:: value`); null for a hashtag. */
export function propertyValueSpan(raw: string): { start: number; end: number } | null {
  const open = raw.indexOf("::");
  if (open < 0) return null;
  return { start: open + 2, end: raw.startsWith("[") && raw.endsWith("]") ? raw.length - 1 : raw.length };
}

/**
 * Every link written in the values of `tokens` (the tokens of `text` that are properties: the service's parser says
 * which; the grammar's own by default), in order: the one scanner for links in values, as `blockReferenceOccurrences`
 * and `pageAddressReferences` are for a note's text. Values of the address keys are skipped (`ADDRESS_KEYS`).
 */
export function propertyValueLinks(text: string, tokens: readonly Pick<RawPropertyToken, "key" | "start" | "raw">[] = propertyTokenMatches(text)): PropertyValueLink[] {
  const out: PropertyValueLink[] = [];
  for (const token of tokens) {
    const key = token.key.toLowerCase();
    if (ADDRESS_KEYS.has(key)) continue;
    const span = propertyValueSpan(token.raw);
    if (!span) continue;
    const base = token.start + span.start, value = token.raw.slice(span.start, span.end);
    for (const r of blockReferenceOccurrences(value, [])) out.push({ key: token.key, kind: "block", reference: { ...r, start: r.start + base, end: r.end + base } });
    for (const r of pageAddressReferences(value, [])) if (!r.nested) out.push({ key: token.key, kind: "page", reference: { ...r, start: r.start + base, end: r.end + base } });
    // An item that is exactly a ticket key, wherever the value's commas put it.
    let from = 0;
    for (const item of splitPropertyValue(value)) {
      const at = value.indexOf(item, from);
      if (at < 0) continue;
      from = at + item.length;
      if (isTicketKey(item)) out.push({ key: token.key, kind: "ticket", workId: item, start: base + at, end: base + at + item.length });
    }
  }
  return out.sort((a, b) => (a.kind === "ticket" ? a.start : a.reference.start) - (b.kind === "ticket" ? b.start : b.reference.start));
}
