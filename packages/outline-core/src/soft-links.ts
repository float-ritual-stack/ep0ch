// Soft links (PIE-408): what a note says by convention, without brackets, that a reader can still follow: a property's
// value (`[thread::agent-labour]`, `thread:: agent-labour`), a date (`ctx:: 2026-11-06 @ 4:31 AM`, a bare `2026-11-06`)
// and a pull request (`PR#125`, `[PR::125]`). Ticket keys are soft links too, and are the Work-ID grammar's (work-ids.ts).
//
// This file only recognizes them: the service decides where each lands (the outliner's soft-links.ts) and lists them
// as mentions, so the door, Detail and the publisher agree. The key is never a page, the value is. Properties are open:
// any key's value links, unless a note excludes the key (`[soft-link-ignore::priority, status]`, the service's answer);
// what's left out here is only what can't be a name. Pure: no I/O.
import { type CodeScope, codeRangesOf, blockReferenceEnvelopeRanges, linkOccurrences, pageLinkRanges } from "./link-syntax";
import { codeHides } from "./code-ranges";
import { BLOCK_ID_PATTERN } from "./addressable-resource";
import { looksLikeDate, readDate } from "./dates";
import { isHeadingStyleKey } from "./heading-styles";
import { ADDRESS_KEYS, propertyValueSpan, QUERY_KEYS, splitPropertyValue } from "./property-grammar";
import { parsePropertyRecords } from "./property-parse";
import { isTicketKey } from "./work-ids";

/** The property a rule note lists keys with whose values aren't links: `[soft-link-ignore::priority, status]`. */
export const SOFT_LINK_IGNORE_KEY = "soft-link-ignore";

/** What a soft link names, whatever it was written as: the question `references.soft` answers. */
export type SoftLinkName =
  | { kind: "value"; value: string }
  | { kind: "date"; day: string }
  | { kind: "pr"; number: number };

/** A soft link in a text: what it names, the property it was written in (none for prose), and its offsets. */
export type SoftLinkToken = SoftLinkName & { key?: string; start: number; end: number };

/** A token's name alone: what `references.soft` is asked. */
export const softName = (token: SoftLinkToken): SoftLinkName =>
  token.kind === "value" ? { kind: "value", value: token.value } : token.kind === "date" ? { kind: "date", day: token.day } : { kind: "pr", number: token.number };

/** How a pull request reads, wherever it was written: the words a page or a child note about it starts with. */
export const prWords = (number: number) => `PR#${number}`;

/** The longest value that reads as a name: past this it's a sentence (a line annotation's value runs to its line's end). */
const NAME_MAX_LENGTH = 64;
const NAME_MAX_WORDS = 6;

const ISO_DAY_START = /^(\d{4}-\d{2}-\d{2})(?=$|[\sT@,;])/;
const PROSE_DAY = /(?<![\w./-])\d{4}-\d{2}-\d{2}(?![\w/-]|\.\.)/g;
const PROSE_PR = /(?<![\w#-])PR#(\d+)(?![\w-])/g;
/** A value that says nothing to go to: a number, a measure, a yes or no, an id, a path. */
const NOT_A_NAME = /^(?:[\d.,:%+-]+|true|false|yes|no|[0-9a-f]{8,}|[/~.].*)$/i;

/** A day written first in `text` as a real date (`2026-11-06 @ 4:31 AM`), its time being only provenance. */
function leadingDay(text: string): string | null {
  const day = ISO_DAY_START.exec(text)?.[1];
  return day && readDate(day) ? day : null;
}

/**
 * What one item of a property's value names, or null for what isn't a name: a link already (the link grammar's and the
 * Work IDs'), a URL, a number or an id, a sentence, a date in another form (its year is a guess, so no page is named).
 */
export function softLinkOfValue(key: string, item: string): SoftLinkName | null {
  const value = item.trim();
  if (!value) return null;
  const day = leadingDay(value);
  if (day) return { kind: "date", day };
  if (key.toLowerCase() === "pr") {
    const number = /^(?:PR)?#?(\d+)$/i.exec(value)?.[1];
    if (number) return { kind: "pr", number: Number(number) };
  }
  if (value.length > NAME_MAX_LENGTH || value.split(/\s+/).length > NAME_MAX_WORDS) return null;
  if (/\(\(|\[\[|\{\{|:\/\//.test(value) || NOT_A_NAME.test(value) || BLOCK_ID_PATTERN.test(value) || isTicketKey(value) || looksLikeDate(value)) return null;
  return { kind: "value", value };
}

export interface SoftLinkOptions {
  /** Where code is, whose words are text (link-syntax's `CodeScope`): a whole note by default. */
  code?: CodeScope;
  /** Keys whose values aren't links: the outline's `[soft-link-ignore::…]` notes and its Resource keys. */
  ignore?: readonly string[];
  /** A property is kept as written (a status message's fix reads as what to type): its value is no link. */
  literalProperties?: boolean;
}

/** Whether a key's values can be soft links here: not a key that names the note itself or holds a query, nor one left out. */
export function softLinkableKey(key: string, ignore: Iterable<string> = []): boolean {
  const k = key.toLowerCase();
  // A heading's or a rule's chips are its style, read from its line as written.
  if (ADDRESS_KEYS.has(k) || QUERY_KEYS.has(k) || k === SOFT_LINK_IGNORE_KEY || k === "rule" || k.startsWith("heading-") || isHeadingStyleKey(k)) return false;
  for (const left of ignore) if (left.toLowerCase() === k) return false;
  return true;
}

/** The soft links of `text`, in order, none overlapping a link, a property's own syntax or code. */
export function softLinkTokens(text: string, options: SoftLinkOptions = {}): SoftLinkToken[] {
  if (!/::|PR#|\d{4}-\d{2}-\d{2}/.test(text)) return [];
  const ignore = options.ignore ?? [];
  const code = codeRangesOf(text, options.code);
  const out: SoftLinkToken[] = [];
  const records = text.includes("::") ? parsePropertyRecords(text).filter(record => record.syntax !== "hashtag") : [];
  for (const record of records) {
    if (options.literalProperties || !softLinkableKey(record.key, ignore) || codeHides(record, code)) continue;
    const span = propertyValueSpan(record.raw);
    if (!span) continue;
    const written = record.raw.slice(span.start, span.end), base = record.start + span.start;
    let from = 0;
    for (const item of splitPropertyValue(written)) {
      const at = written.indexOf(item, from);
      if (at < 0) continue;
      from = at + item.length;
      const name = softLinkOfValue(record.key, item);
      if (!name) continue;
      // A date's time is provenance: the link is the day alone.
      const length = name.kind === "date" ? name.day.length : item.length;
      out.push({ ...name, key: record.key, start: base + at, end: base + at + length });
    }
  }
  const taken = [
    ...records, ...linkOccurrences(text, []), ...blockReferenceEnvelopeRanges(text), ...pageLinkRanges(text),
    // A URL holds dates and numbers that are its own (`/2026-11-06/`).
    ...[...text.matchAll(/\S*:\/\/\S*/g)].map(match => ({ start: match.index, end: match.index + match[0].length })),
  ];
  const free = (span: { start: number; end: number }) => !codeHides(span, code) && !taken.some(range => span.start < range.end && range.start < span.end);
  for (const match of text.matchAll(PROSE_DAY)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (free(span) && readDate(match[0])) out.push({ kind: "date", day: match[0], ...span });
  }
  for (const match of text.matchAll(PROSE_PR)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (free(span)) out.push({ kind: "pr", number: Number(match[1]), ...span });
  }
  return out.sort((left, right) => left.start - right.start);
}
