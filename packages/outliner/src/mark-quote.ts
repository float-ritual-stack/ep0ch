// Quoting marks into a block of their own (the margin's "quote-tweet", capability "Conversations in the margin",
// primitive 3): a highlight, a comment or a reply, or several, become one new block that transcludes each and links
// back to it. The marks stay where they were; each lists the blocks quoting it (`quotedIn`, read off the `from` lines
// by the annotation repository), so a mark's card says "quoted in" and the new block traces back to its source.
//
// The block, in Blockdown: its title (the person's own words, else `Quoting “…”`), one metadata line of
// `[from::((mark))]`, then `!((mark))` for each mark. Pure: no I/O.
import { plainBody } from "./publish-marginalia";
import type { AnnotationRecord, MarkQuotePlace } from "./types";

/** At most this many marks in one quote. */
export const MAX_QUOTED_MARKS = 20;

/** A mark's words for a title: a comment's or reply's first line, a highlight's quote; references by label, one line. */
export function markSnippet(record: AnnotationRecord): string {
  const anchor = record.resolvedTarget?.anchor ?? record.originalTarget.anchor;
  const quote = anchor && "exact" in anchor && typeof anchor.exact === "string" ? anchor.exact : "";
  const words = plainBody(record.body).split("\n").find((line) => line.trim()) ?? quote;
  // Nothing in a title that reads as a property, link or reference.
  const flat = words.replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** The quoting block's text: its title (or `text`), the back-links, then each mark transcluded. */
export function markQuoteText(records: readonly AnnotationRecord[], text?: string): string {
  const own = text?.replace(/\r\n?/g, "\n").trim();
  const title = own || `Quoting “${markSnippet(records[0]!) || "a mark"}”${records.length > 1 ? ` and ${records.length - 1} more` : ""}`;
  return [title, records.map((record) => `[from::((${record.block.id}))]`).join(" "), ...records.map((record) => `!((${record.block.id}))`)].join("\n");
}

/** A `marks.quote` input from the wire, checked: the mark ids (distinct, in order), where it goes, its own words. */
export function readMarkQuoteInput(input: unknown): { marks: string[]; place: MarkQuotePlace; text?: string } {
  if (!input || typeof input !== "object") throw new Error("marks.quote needs input: { marks: [mark ids], place?: { kind: inbox | note | under, blockId? }, text? }");
  const { marks, place, text } = input as { marks?: unknown; place?: unknown; text?: unknown };
  if (!Array.isArray(marks) || !marks.length || !marks.every((id) => typeof id === "string" && id.trim())) {
    throw new Error("marks.quote needs marks: the ids of the highlights, comments or replies to quote");
  }
  const ids = [...new Set(marks.map((id: string) => id.trim()))];
  if (ids.length > MAX_QUOTED_MARKS) throw new Error(`quote at most ${MAX_QUOTED_MARKS} marks at once (${ids.length} given)`);
  if (text !== undefined && typeof text !== "string") throw new Error("text must be text: the quoting block's own words");
  if (typeof text === "string" && text.length > 64 * 1024) throw new Error("text is too long: up to 64 KiB");
  const kind = place === undefined ? "inbox" : (place as { kind?: unknown })?.kind;
  if (kind === "inbox" || kind === "note") return { marks: ids, place: { kind }, ...(text?.trim() ? { text } : {}) };
  const blockId = (place as { blockId?: unknown }).blockId;
  if (kind === "under" && typeof blockId === "string" && blockId.trim()) return { marks: ids, place: { kind, blockId: blockId.trim() }, ...(text?.trim() ? { text } : {}) };
  throw new Error("place is { kind: \"inbox\" } (the default), { kind: \"note\" } (under the note the first mark is on) or { kind: \"under\", blockId }");
}
