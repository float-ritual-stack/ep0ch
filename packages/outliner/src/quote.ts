// `quote`: materialize(subject, where) (PIE-1247). One operation behind the margin's "quote-tweet", detaching a figure
// into a tile of its own and dragging an element into another note:
//
// - **subjects**: marks (a highlight, a comment or a reply: `{ kind: "mark", id }`) and elements of a note (a figure, a
//   callout, a list item, a paragraph, a heading: `{ kind: "element", blockId, anchor }`, or `line` and `revision` for one
//   with no anchor yet, which the service writes as `fragments.ensure` does: an anchor is written for a durable
//   reference, never for a mark or a comment).
// - **where**: a new block (the top of the Inbox, under the note the first subject is on, under a block named, or under
//   the `.detached` page: a detached element, read in a tile of its own with no header), or `into` a note's text at a
//   line (the drag's drop, through `draft.patch`, so a draft held open takes it in place).
// - **as**: `reference` (the default) transcludes each subject (`!((mark))`, `!((note^anchor))`) and links back with
//   `[from::]`; `copy` writes an element's own lines (a figure with its query, which then answers for the note it's in).
//
// The marks and elements stay where they were; a mark lists the blocks quoting it (`quotedIn`, read off the `from`
// lines by the annotation repository), and an element's note shows the quote among its backlinks, by its anchor.
// Pure: no I/O.
import { plainBody } from "./publish-marginalia";
import type { QuoteAs, QuotePlace, QuoteSubject, QuotedSubject } from "@ep0ch/outline-core/protocol";
import type { AnnotationRecord } from "./types";

/** At most this many subjects in one quote. */
export const MAX_QUOTED = 20;
/** The page a detached element goes under (PIE-1247): one ordinary page until hidden notes exist (PIE-1011). */
export const DETACHED_PAGE = ".detached";

export type { QuoteAs, QuotePlace, QuoteSubject, QuotedSubject } from "@ep0ch/outline-core/protocol";
/** A `quote` input as read: its subjects, where they go (the Inbox by default), as what (reference by default). */
export interface QuoteInput { subjects: QuoteSubject[]; place: QuotePlace; as: QuoteAs; text?: string }

/** A mark's words for a title: a comment's or reply's first line, a highlight's quote; references by label, one line. */
export function markSnippet(record: AnnotationRecord): string {
  const anchor = record.resolvedTarget?.anchor ?? record.originalTarget.anchor;
  const quote = anchor && "exact" in anchor && typeof anchor.exact === "string" ? anchor.exact : "";
  const words = plainBody(record.body).split("\n").find((line) => line.trim()) ?? quote;
  return titleWords(words);
}

/**
 * Words for a title: nothing that reads as a property, link or reference, nor a line's own marks at its start (a
 * component's `::`, a heading's `#`, a quote's `>`), one line, 60 characters at most.
 */
export function titleWords(words: string): string {
  const flat = words.replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:::|[#>*+-])+\s*/, "");
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/**
 * What `as` writes for one subject in a note's text: `!((ref))` for a part that is shown (a figure, a callout, a quote,
 * a heading's section, a mark), `((ref))` for a line of prose (a list item, a paragraph), or, copied, its own lines.
 */
export function quoteLine(s: QuotedSubject, as: QuoteAs): string {
  if (as === "copy" && s.copy !== undefined) return s.copy;
  return s.kind === "list-item" || s.kind === "paragraph" ? `((${s.ref}))` : `!((${s.ref}))`;
}

/**
 * The quoting block's text: its title (`text`'s first line, else `Quoting “…”`, or the element's own words when it is
 * detached), the back-links, then each subject as `as` writes it. A detached block draws with no header
 * (`[header::none]`): it is the element, in a tile of its own, so it always embeds (`!((…))`).
 */
export function quoteText(subjects: readonly QuotedSubject[], as: QuoteAs, opts: { text?: string; detached?: boolean } = {}): string {
  const own = opts.text?.replace(/\r\n?/g, "\n").trim();
  const first = subjects[0]!;
  const title = own || (opts.detached ? first.label || "Detached" : `Quoting “${first.label || "a mark"}”${subjects.length > 1 ? ` and ${subjects.length - 1} more` : ""}`);
  // The title is the first line: a detached block's `[header::none]` goes there, its own words' other lines after.
  const [head, ...rest] = title.split("\n");
  return [
    `${head}${opts.detached ? " [header::none]" : ""}`,
    ...rest,
    subjects.map((s) => `[from::((${s.ref}))]`).join(" "),
    ...subjects.map((s) => (opts.detached && as === "reference" ? `!((${s.ref}))` : quoteLine(s, as))),
  ].join("\n");
}

const MAX_TEXT = 64 * 1024;
const id = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} needs a block id`);
  return v.trim();
};

/** A `quote` input from the wire, checked: its subjects (distinct, in order), where they go, as what, its own words. */
export function readQuoteInput(input: unknown): QuoteInput {
  const shape = "quote needs input: { subjects: [{ kind: mark, id } | { kind: element, blockId, anchor } | { kind: element, blockId, line, revision }], place?: { kind: inbox | note | detached } | { kind: under, blockId } | { kind: into, blockId, line }, as?: reference | copy, text? }";
  if (!input || typeof input !== "object") throw new Error(shape);
  const { subjects, place, as, text } = input as { subjects?: unknown; place?: unknown; as?: unknown; text?: unknown };
  if (!Array.isArray(subjects) || !subjects.length) throw new Error(`${shape}: subjects is empty`);
  const seen = new Set<string>();
  const out: QuoteSubject[] = [];
  for (const raw of subjects as unknown[]) {
    const s = raw as Record<string, unknown> | null;
    let subject: QuoteSubject;
    if (s?.kind === "mark") subject = { kind: "mark", id: id(s.id, "a mark subject") };
    else if (s?.kind === "element") {
      const blockId = id(s.blockId, "an element subject");
      if (typeof s.anchor === "string" && s.anchor.trim()) subject = { kind: "element", blockId, anchor: s.anchor.trim().replace(/^\^/, "") };
      else if (Number.isSafeInteger(s.line) && (s.line as number) >= 0 && Number.isSafeInteger(s.revision)) subject = { kind: "element", blockId, line: s.line as number, revision: s.revision as number, ...(s.next === true ? { next: true as const } : {}) };
      else throw new Error("an element subject names its anchor, or a line of it (from 0) and the note's revision");
    } else throw new Error(`each subject is { kind: "mark", id } or { kind: "element", blockId, … }: ${JSON.stringify(raw)?.slice(0, 80)}`);
    const key = JSON.stringify(subject);
    if (!seen.has(key)) { seen.add(key); out.push(subject); }
  }
  if (out.length > MAX_QUOTED) throw new Error(`quote at most ${MAX_QUOTED} at once (${out.length} given)`);
  if (as !== undefined && as !== "reference" && as !== "copy") throw new Error("as is reference (the default: each transcluded) or copy (an element's own lines)");
  if (as === "copy" && out.some((s) => s.kind === "mark")) throw new Error("a mark is quoted as a reference: copy is for an element's own lines");
  if (text !== undefined && typeof text !== "string") throw new Error("text must be text: the quoting block's own words");
  if (typeof text === "string" && text.length > MAX_TEXT) throw new Error("text is too long: up to 64 KiB");
  const words = typeof text === "string" && text.trim() ? { text } : {};
  const base = { subjects: out, as: (as ?? "reference") as QuoteAs, ...words };
  const kind = place === undefined ? "inbox" : (place as { kind?: unknown })?.kind;
  if (kind === "inbox" || kind === "note" || kind === "detached") return { ...base, place: { kind } };
  if (kind === "under") return { ...base, place: { kind, blockId: id((place as { blockId?: unknown }).blockId, "place under") } };
  if (kind === "into") {
    const p = place as { blockId?: unknown; line?: unknown; observed?: unknown };
    if (!Number.isSafeInteger(p.line) || (p.line as number) < 0) throw new Error("place into names the line (from 0) the quote goes after");
    if (p.observed !== undefined && typeof p.observed !== "string") throw new Error("place into's observed is the line's text, as the dropper saw it");
    return { ...base, place: { kind, blockId: id(p.blockId, "place into"), line: p.line as number, ...(typeof p.observed === "string" ? { observed: p.observed } : {}) } };
  }
  throw new Error("place is { kind: \"inbox\" } (the default), { kind: \"note\" } (under the note the first subject is on), { kind: \"detached\" }, { kind: \"under\", blockId } or { kind: \"into\", blockId, line }");
}
