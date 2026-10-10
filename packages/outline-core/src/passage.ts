// The passage target (ADR 0004, contract 5): an exact span of a subject's source text, the one shape a selection in a
// door, a selection in Detail and an agent's `quote=` all become before an action runs on it. It is the annotation
// store's text-quote anchor (`exact`, `prefix`, `suffix`, `start`, `end`) plus the subject and the revision it was
// read at, so a passage becomes an annotation unchanged.
//
// This module is the one place a quote is looked up in text and the one rule for checking it before a write:
//
// - **find**: an agent's quote (or a comment's): every place the words are, narrowed by `start`, `prefix`, `suffix`
//   and a range; `near` picks the nearest among repeats. One place, or refused with why and the nearest match.
// - **check**: a passage read at one revision, against the subject's text now. At the same revision the quote must be
//   at `start`. At a newer one it must be found exactly once with its prefix and suffix, and the passage moves there.
//   Anything else (gone, or found twice) is refused with the nearest match. Never fuzzy: the fuzzy and agent-assisted
//   rungs of the re-anchoring ladder are for showing annotations, never for a write.
// - **cite**: the quote with a reference to where it is, the way copy with a citation writes it.
//
// Offsets are UTF-16, as JavaScript strings index them and the annotation store keeps them. Pure: no I/O.

import { fragmentAnchorMatch } from "./link-syntax";

/** How many characters either side a passage keeps as its context. */
export const PASSAGE_CONTEXT = 32;

export interface Passage {
  /** A block id, or `resource:<id>`. */
  subject: string;
  /** The block's revision, or the Resource's text revision (its content hash, folded: `resourceTextRevision`). */
  revision: number | string;
  /** The exact source text. */
  quote: string;
  /** UTF-16 offsets in the subject's source text. */
  start: number;
  end: number;
  /** Up to PASSAGE_CONTEXT characters before and after. */
  prefix: string;
  suffix: string;
}

/** Where a quote isn't (or isn't once): why, how many places it was found, and the nearest text that is there. */
export interface PassageMiss {
  why: string;
  count: number;
  nearest?: { start: number; end: number; text: string };
}

export const isMiss = (v: unknown): v is PassageMiss => !!v && typeof v === "object" && typeof (v as PassageMiss).why === "string";

/** The passage `[start, end)` of `text`: its quote and context. Throws on a range that selects nothing. */
export function passageAt(text: string, start: number, end: number, subject: string, revision: number | string, context = PASSAGE_CONTEXT): Passage {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) {
    throw new Error(`a passage selects some of the text: start ${start} and end ${end} aren't a span of its ${text.length} characters`);
  }
  return {
    subject, revision,
    quote: text.slice(start, end), start, end,
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, end + context),
  };
}

export interface FindOptions {
  /** The quote starts exactly here. */
  start?: number;
  /** Among several places, the one nearest this offset. */
  near?: number;
  /** The text just before (a suffix of it is enough: what the text has before the quote must end with it). */
  prefix?: string;
  /** The text just after (what follows the quote must start with it). */
  suffix?: string;
  /** Only within `[lower, upper)`. */
  lower?: number;
  upper?: number;
  /** Leave out a place this says no to (a checklist item's children, for a comment on the item). */
  exclude?: (start: number, end: number) => boolean;
}

/** Every place `quote` is in `text` that fits `o`, in order. */
export function quotePlaces(text: string, quote: string, o: FindOptions = {}): number[] {
  const out: number[] = [];
  if (!quote) return out;
  const lower = o.lower ?? 0, upper = o.upper ?? text.length;
  for (let at = text.indexOf(quote, lower); at >= 0 && at + quote.length <= upper; at = text.indexOf(quote, at + 1)) {
    const end = at + quote.length;
    if (o.start !== undefined && at !== o.start) continue;
    if (o.prefix && !text.slice(0, at).endsWith(o.prefix)) continue;
    if (o.suffix && !text.slice(end).startsWith(o.suffix)) continue;
    if (o.exclude?.(at, end)) continue;
    out.push(at);
  }
  return out;
}

/**
 * Where `quote` is in `text`, as one span: found once (or the nearest to `near` among several), else why not. The
 * words must be exact source text: a selection of how a reader draws a link or a bold word won't be found.
 */
export function findPassage(text: string, quote: string, o: FindOptions = {}): { start: number; end: number } | PassageMiss {
  if (!quote.trim()) return { why: "the quote is empty", count: 0 };
  const places = quotePlaces(text, quote, o);
  if (places.length && o.near !== undefined) {
    const at = places.reduce((a, b) => (Math.abs(b - o.near!) < Math.abs(a - o.near!) ? b : a));
    return { start: at, end: at + quote.length };
  }
  if (places.length === 1) return { start: places[0]!, end: places[0]! + quote.length };
  if (places.length > 1) {
    return { why: `"${short(quote)}" is there ${places.length} times: give start, near, prefix or suffix to say which`, count: places.length, nearest: span(text, places[0]!, quote.length) };
  }
  const anywhere = quotePlaces(text, quote, { lower: o.lower, upper: o.upper });
  if (anywhere.length) {
    const why = o.start !== undefined && !o.prefix && !o.suffix ? `"${short(quote)}" isn't at ${o.start}` : `"${short(quote)}" is there, but not with the text around it you gave`;
    return { why, count: 0, nearest: span(text, anywhere.reduce((a, b) => (Math.abs(b - (o.start ?? o.near ?? 0)) < Math.abs(a - (o.start ?? o.near ?? 0)) ? b : a)), quote.length) };
  }
  const nearest = nearestText(text, quote);
  return { why: `"${short(quote)}" isn't in the text now`, count: 0, ...(nearest ? { nearest } : {}) };
}

/**
 * A passage read at `p.revision`, checked against the subject's text now (`text` at `revision`): the passage as it is
 * now (moved, when the text moved under it), or why it can't be acted on. Same revision: the quote must be at
 * `start`. A newer one: found exactly once with its prefix and suffix.
 */
export function checkPassage(text: string, revision: number | string, p: Passage): { passage: Passage; moved: boolean } | PassageMiss {
  if (!p.quote) return { why: "the passage is empty", count: 0 };
  if (String(revision) === String(p.revision)) {
    if (text.slice(p.start, p.end) === p.quote && p.end - p.start === p.quote.length) return { passage: { ...p }, moved: false };
    const found = quotePlaces(text, p.quote);
    return {
      why: `"${short(p.quote)}" isn't at ${p.start} in revision ${String(revision)}: select it again`, count: found.length,
      ...(found.length ? { nearest: span(text, found[0]!, p.quote.length) } : nearestText(text, p.quote) ? { nearest: nearestText(text, p.quote)! } : {}),
    };
  }
  const places = quotePlaces(text, p.quote, { prefix: p.prefix, suffix: p.suffix });
  if (places.length === 1) {
    const moved = passageAt(text, places[0]!, places[0]! + p.quote.length, p.subject, revision);
    return { passage: moved, moved: places[0] !== p.start };
  }
  if (places.length > 1) {
    return { why: `the text changed since revision ${String(p.revision)} and "${short(p.quote)}" is there ${places.length} times with the same words around it: select it again`, count: places.length, nearest: span(text, places[0]!, p.quote.length) };
  }
  const bare = quotePlaces(text, p.quote);
  const nearest = bare.length ? span(text, bare.reduce((a, b) => (Math.abs(b - p.start) < Math.abs(a - p.start) ? b : a)), p.quote.length) : nearestText(text, p.quote);
  return { why: `the text changed since revision ${String(p.revision)} and "${short(p.quote)}" isn't there with the words around it now: select it again`, count: 0, ...(nearest ? { nearest } : {}) };
}

/** A refusal in one line: why, and the nearest text that is there, to select instead. */
export function missMessage(miss: PassageMiss): string {
  return miss.nearest ? `${miss.why} (nearest: "${short(miss.nearest.text)}" at ${miss.nearest.start})` : miss.why;
}

/**
 * The longest run of the quote's words that is in the text, from its start or its end: where the passage most likely
 * went. At least a few characters, else none.
 */
export function nearestText(text: string, quote: string): { start: number; end: number; text: string } | undefined {
  const words = quote.split(/(?<=\s)/);
  for (let n = words.length - 1; n >= 1; n--) {
    for (const part of [words.slice(0, n).join(""), words.slice(words.length - n).join("")]) {
      const t = part.trim();
      if (t.length < 4) continue;
      const at = text.indexOf(t);
      if (at >= 0) return span(text, at, t.length);
    }
  }
  return undefined;
}

/**
 * How a passage is cited: a reference to the block, at the fragment of the line the quote starts on when that line
 * has one (`^id` at its end), else the block itself. A Resource cites as `resource:<id>`.
 */
export function passageReference(subject: string, text: string, start: number): string {
  if (subject.startsWith("resource:")) return subject;
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEnd = text.indexOf("\n", start);
  const anchor = fragmentAnchorMatch(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd));
  return anchor ? `((${subject}^${anchor[1]}))` : `((${subject}))`;
}

/** Copy with a citation: the quote as a Blockdown quote, then where it's from. */
export function citePassage(p: Pick<Passage, "quote">, reference: string): string {
  const quoted = p.quote.trim().split("\n").map(l => `> ${l}`.trimEnd()).join("\n");
  return `${quoted}\n> — ${reference}`;
}

function span(text: string, start: number, length: number) {
  return { start, end: start + length, text: text.slice(start, start + length) };
}

function short(s: string, n = 40): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
