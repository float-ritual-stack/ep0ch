// What a save warns about in the references it wrote (PIE-761): capture first, interpretation second. A note, a comment
// or a reply is written whatever its references say; afterwards each `((` that doesn't reach a note is said, with the
// nearest thing it could have meant. Nothing here refuses anything. Pure: the lookups are the caller's (the service's
// store in process, a client's socket elsewhere).

import { blockReferenceOccurrences, fragmentAnchorMatch } from "./link-syntax";
import { referenceEnvelopeEnd } from "./addressable-resource";
import { offsetInRanges, protectedCodeRanges } from "./code-ranges";

/** A `((` the link grammar reads as no reference: never closed on its line, or closed round something that isn't an id. */
export interface ReferenceSuspect {
  kind: "unclosed" | "not-a-reference";
  start: number;
  end: number;
  /** As written, from its `((` (an unclosed one to its line's end, at most 60 characters). */
  written: string;
  /** What it seems to be looking for: the words after `((` (and before any `^`, `|` or `))`). */
  query: string;
  /** The `^fragment` it names, when it names one. */
  fragment?: string;
}

const MAX_WRITTEN = 60;

/** Every `((` outside code that the link grammar doesn't read as a reference (an embed's included), in order. */
export function referenceSuspects(text: string): ReferenceSuspect[] {
  const code = protectedCodeRanges(text);
  const refs = blockReferenceOccurrences(text);
  const out: ReferenceSuspect[] = [];
  for (let start = text.indexOf("(("); start >= 0; start = text.indexOf("((", start + 2)) {
    const covering = refs.find(r => start >= r.start && start < r.end);
    if (covering) { start = covering.end - 2; continue; }
    if (offsetInRanges(start, code)) continue;
    const lineEnd = (() => { const n = text.indexOf("\n", start); return n < 0 ? text.length : n; })();
    // A `((` that another `((` follows before it closes is unclosed: it ends where the next one starts.
    const next = text.indexOf("((", start + 2);
    const found = referenceEnvelopeEnd(text, start + 2, true);
    const cut = next >= 0 && next < lineEnd && (found < 0 || next < found - 2);
    const close = cut ? -1 : found;
    const end = cut ? next : close < 0 ? lineEnd : close;
    const inner = text.slice(start + 2, close < 0 ? end : end - 2);
    const head = inner.split(/\(\(|\)\)|\|/)[0]!;
    const caret = head.indexOf("^");
    const fragment = caret >= 0 ? head.slice(caret + 1).match(/^[A-Za-z0-9][A-Za-z0-9_-]*/)?.[0] : undefined;
    const query = (caret >= 0 ? head.slice(0, caret) : head).trim().slice(0, MAX_WRITTEN);
    const written = text.slice(start, end).trimEnd();
    out.push({
      kind: close < 0 ? "unclosed" : "not-a-reference", start, end,
      written: written.length > MAX_WRITTEN ? `${written.slice(0, MAX_WRITTEN - 1)}…` : written,
      query, ...(fragment ? { fragment } : {}),
    });
    start = cut ? next - 2 : close < 0 ? Math.max(start, lineEnd - 2) : end - 2;
  }
  return out;
}

/** How the outline reads one `((id…))`: the service's `references.resolve` answer, as much of it as a warning needs. */
export interface ReferenceStatus {
  blockId: string;
  fragmentId?: string;
  status: "resolved" | "missing" | "deleted" | "stale" | "duplicate";
  title?: string;
}

/** What a warning asks of the outline. Each may fail or be absent: a warning then goes without its suggestion. */
export interface ReferenceLookups {
  /** Every `((…))` in `text`, as the service reads it (`references.resolve`). */
  resolve(text: string): Promise<readonly ReferenceStatus[]>;
  /** Notes whose title or text matches `query`, best first. */
  search?(query: string): Promise<readonly { id: string; title: string }[]>;
  /** Note `blockId`'s text, for the `^anchors` it has; null when there's no such note. */
  text?(blockId: string): Promise<string | null>;
}

/** A reference a save kept as written that leads nowhere, and what it may have meant. */
export interface ReferenceWarning {
  /** As written. */
  written: string;
  /** Why it leads nowhere, in a few words. */
  problem: string;
  /** A reference that does lead somewhere, to write instead, with what it names. */
  didYouMean?: { reference: string; title?: string };
}

/** One line per warning: `((Meeting isn't closed · did you mean ((id)) "Meeting notes"?`. */
export function describeReferenceWarning(w: ReferenceWarning): string {
  const dym = w.didYouMean ? ` · did you mean ${w.didYouMean.reference}${w.didYouMean.title ? ` “${w.didYouMean.title}”` : ""}?` : "";
  return `${w.written} ${w.problem}${dym}`;
}

/** All of them on one line, for a status line or a flash; "" when there are none. */
export function describeReferenceWarnings(ws: readonly ReferenceWarning[], max = 3): string {
  if (!ws.length) return "";
  const shown = ws.slice(0, max).map(describeReferenceWarning).join(" · ");
  return `saved; ${ws.length === 1 ? "a reference leads" : `${ws.length} references lead`} nowhere: ${shown}${ws.length > max ? ` · and ${ws.length - max} more` : ""}`;
}

const ID_LIKE = /^[0-9a-f-]{8,}$/i;

async function quietly<T>(work: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (!work) return undefined;
  try { return await work(); } catch { return undefined; }
}

/** The `^anchors` a note's text has, in order (each line's end, as the link grammar reads them). */
export function anchorsOfText(text: string): string[] {
  return text.split("\n").map(line => fragmentAnchorMatch(line)?.[1]).filter((a): a is string => !!a);
}

/** The anchor of `anchors` nearest `wanted`: one it starts, one that starts it, one it contains; else the first. */
function nearestAnchor(wanted: string, anchors: readonly string[]): string | undefined {
  const w = wanted.toLowerCase();
  return anchors.find(a => a.toLowerCase().startsWith(w)) ?? anchors.find(a => w.startsWith(a.toLowerCase()))
    ?? anchors.find(a => a.toLowerCase().includes(w)) ?? anchors[0];
}

/**
 * The warnings for `text` once it is saved: references to no note, a note in the Trash, an anchor the note doesn't
 * have, and `((` forms the grammar doesn't read as references. Each lookup that fails only drops a suggestion.
 */
export async function referenceWarnings(text: string, lookups: ReferenceLookups): Promise<ReferenceWarning[]> {
  if (!text.includes("((")) return [];
  const out: ReferenceWarning[] = [];
  const code = protectedCodeRanges(text);
  const refs = blockReferenceOccurrences(text).filter(r => !offsetInRanges(r.start, code));
  const statuses = refs.length ? await quietly(() => lookups.resolve(refs.map(r => text.slice(r.start, r.end)).join("\n"))) : [];
  for (const [i, r] of refs.entries()) {
    const s = statuses?.[i];
    if (!s || s.status === "resolved") continue;
    const written = text.slice(r.start, r.end);
    if (s.status === "missing") out.push({ written, problem: "names no note in this outline" });
    else if (s.status === "deleted") out.push({ written, problem: `is in the Trash${s.title ? ` (“${s.title}”)` : ""}` });
    else {
      const body = await quietly(lookups.text ? () => lookups.text!(s.blockId) : undefined);
      const anchors = body ? anchorsOfText(body) : [];
      const near = r.fragmentId && anchors.length ? nearestAnchor(r.fragmentId, anchors) : undefined;
      out.push({
        written,
        problem: s.status === "stale" ? `points at ^${r.fragmentId}, which ${s.title ? `“${s.title}”` : "that note"} doesn't have` : `points at ^${r.fragmentId}, which that note has twice`,
        ...(near && near !== r.fragmentId ? { didYouMean: { reference: `((${s.blockId}^${near}))`, ...(s.title ? { title: s.title } : {}) } } : {}),
      });
    }
  }
  for (const s of referenceSuspects(text)) {
    const problem = s.kind === "unclosed" ? "isn't closed with ))" : "isn't a reference (a note's id goes inside (( ))";
    let didYouMean: ReferenceWarning["didYouMean"];
    const id = s.query.split(/\s/)[0]!;
    if (ID_LIKE.test(id)) {
      const [found] = (await quietly(() => lookups.resolve(`((${id}${s.fragment ? `^${s.fragment}` : ""}))`))) ?? [];
      if (found && found.status !== "missing") didYouMean = { reference: `((${found.blockId}${s.fragment ? `^${s.fragment}` : ""}))`, ...(found.title ? { title: found.title } : {}) };
    } else if (s.query) {
      const [hit] = (await quietly(lookups.search ? () => lookups.search!(s.query) : undefined)) ?? [];
      if (hit) didYouMean = { reference: `((${hit.id}))`, title: hit.title };
    }
    out.push({ written: s.written, problem, ...(didYouMean ? { didYouMean } : {}) });
  }
  return out;
}
