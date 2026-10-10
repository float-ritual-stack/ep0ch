// Highlights and margin notes on a published page (ADR 0004, contract 6): read-only, drawn from the note's open
// annotations. A passage is a `<mark class="ann ann-<tone>">` around its exact words, and an annotation with a body
// is an `<aside class="margin-note">` after the paragraph holding it. On a published page each carries its annotation's id (`data-ann`), so
// the page's reader script (publish-reader.js, PIE-774) can hang its thread on it; the page draws them without it.
//
// The marks ride through the Markdown renderer as private-use sentinels placed around each passage in the block's
// published text, then become tags once the HTML is rendered. A passage whose words fall across markup (a link, a
// half of a bold run) is left unmarked; its aside still follows its paragraph.

import { annotationKind, annotationTone } from "@ep0ch/outline-core/annotation-marks";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import type { AnnotationThread } from "./types";

/** One annotation as a published page draws it. */
export interface PublishedAnnotation {
  readonly annotationId: string;
  readonly exact: string;
  /** Which occurrence of `exact` in the block's text it is (0 for the first). */
  readonly occurrence: number;
  readonly kind: string;
  readonly tone: string;
  readonly tags: readonly string[];
  /** Its body as plain text, references shown by their label; empty for a highlight. */
  readonly body: string;
  readonly replies: number;
}

/** At most this many marks on one page: each takes one private-use sentinel character. */
export const MAX_PUBLISHED_MARKS = 255;

const OPEN = "", CLOSE = "", INDEX_BASE = 0xE100;
const SENTINEL = /[][-]/g;

function count(text: string, exact: string, before: number): number {
  let n = 0;
  for (let at = text.indexOf(exact); at >= 0 && at < before; at = text.indexOf(exact, at + 1)) n += 1;
  return n;
}

/** A body's text with each `((id|label))` shown as its label: a page never prints another note's id. */
export function plainBody(body: string): string {
  let out = "", cursor = 0;
  for (const reference of blockReferenceOccurrences(body)) {
    out += body.slice(cursor, reference.start) + (reference.label ?? "a note");
    cursor = reference.end;
  }
  return (out + body.slice(cursor)).trim();
}

/**
 * The block's open threads that land exactly on its text as it is now (a text-quote anchor whose words are still at
 * its offsets), as the page draws them. `shown` is the annotation blocks the page may show (`[publish::false]` or
 * `never` on one leaves it out).
 */
export function publishedAnnotations(text: string, threads: readonly AnnotationThread[], shown: ReadonlySet<string>): PublishedAnnotation[] {
  return threads.flatMap((thread): PublishedAnnotation[] => {
    if (thread.lifecycle !== "open" || !shown.has(thread.block.id) || thread.currentResolution.status !== "resolved") return [];
    const anchor = thread.resolvedTarget?.anchor;
    if (anchor?.kind !== "text-quote" || anchor.start === null || anchor.end === null || !anchor.exact.trim() ||
      anchor.exact.includes("\n") || text.slice(anchor.start, anchor.end) !== anchor.exact) return [];
    const properties = thread.properties ?? {};
    return [{
      annotationId: thread.block.id,
      exact: anchor.exact,
      occurrence: count(text, anchor.exact, anchor.start),
      kind: annotationKind(properties, thread.body),
      tone: annotationTone(properties),
      tags: [...new Set((properties.tags ?? []).flatMap(tag => tag.split(",")).map(tag => tag.trim()).filter(Boolean))],
      body: plainBody(thread.body),
      replies: thread.replies.length,
    }];
  });
}

/**
 * The block's published Markdown with each mark's passage wrapped in sentinels (`first` is the page-wide index of
 * this block's first mark). A passage not found in the published text (rewritten by a link, say) is left out.
 */
export function placeMarkSentinels(published: string, marks: readonly PublishedAnnotation[], first: number): string {
  type Cut = { at: number; end: number; index: number };
  const cuts: Cut[] = [];
  marks.forEach((mark, offset) => {
    const index = first + offset;
    if (index >= MAX_PUBLISHED_MARKS) return;
    let at = -1;
    for (let n = 0; n <= mark.occurrence; n += 1) {
      at = published.indexOf(mark.exact, at + 1);
      if (at < 0) return;
    }
    const end = at + mark.exact.length;
    // Overlapping passages: the first keeps its mark (marks never cross each other).
    if (cuts.some(cut => at < cut.end && cut.at < end)) return;
    cuts.push({ at, end, index });
  });
  let out = published;
  for (const cut of cuts.sort((a, b) => b.at - a.at)) {
    const id = String.fromCharCode(INDEX_BASE + cut.index);
    out = `${out.slice(0, cut.at)}${OPEN}${id}${out.slice(cut.at, cut.end)}${CLOSE}${id}${out.slice(cut.end)}`;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Whether `at` is in text, not inside a tag (rendered text escapes `<` and `>`, so they only open and close tags). */
function inText(html: string, at: number): boolean {
  return html.lastIndexOf("<", at) <= html.lastIndexOf(">", at);
}

const VOID = new Set(["br", "img", "hr", "input", "wbr"]);

/** Whether the HTML between two points opens and closes its own tags, so a mark around it nests. */
function balanced(fragment: string): boolean {
  const stack: string[] = [];
  for (const match of fragment.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const name = match[2]!.toLowerCase();
    if (VOID.has(name)) continue;
    if (!match[1]) stack.push(name);
    else if (stack.pop() !== name) return false;
  }
  return stack.length === 0;
}

const BLOCK_END = /<\/(?:p|h[1-6]|li|blockquote|td|th|pre)>|<(?:ul|ol)>/g;

/**
 * The rendered page with its sentinels drawn: marks around their words, asides after their paragraphs. `ids`: each
 * carries its annotation's id, for a page that runs the reader script (never for text sent elsewhere).
 */
export function drawMarginalia(html: string, marks: readonly PublishedAnnotation[], ids = false): string {
  const opens = new Map<number, number>(), closes = new Map<number, number>();
  for (const match of html.matchAll(SENTINEL)) {
    (match[0][0] === OPEN ? opens : closes).set(match[0].charCodeAt(1) - INDEX_BASE, match.index!);
  }
  type Edit = { at: number; remove: number; insert: string; order: number };
  const edits: Edit[] = [];
  for (const [index, open] of opens) {
    const mark = marks[index], close = closes.get(index);
    if (!mark || close === undefined || close < open) continue;
    const drawn = inText(html, open) && inText(html, close) && balanced(html.slice(open + 2, close).replace(SENTINEL, ""));
    if (drawn) {
      const tags = mark.tags.length ? ` data-tags="${escapeHtml(mark.tags.join(" "))}"` : "";
      edits.push({ at: open, remove: 0, order: 0,
        insert: `<mark class="ann ann-${escapeHtml(mark.tone)}"${ids ? ` data-ann="${escapeHtml(mark.annotationId)}"` : ""} data-kind="${escapeHtml(mark.kind)}"${tags}>` });
      edits.push({ at: close, remove: 0, order: 0, insert: "</mark>" });
    }
    if (!mark.body) continue;
    BLOCK_END.lastIndex = close;
    const end = BLOCK_END.exec(html);
    const at = end ? (end[0].startsWith("</") ? end.index + end[0].length : end.index) : html.length;
    const replies = mark.replies ? ` <span class="replies">${mark.replies} ${mark.replies === 1 ? "reply" : "replies"}</span>` : "";
    edits.push({ at, remove: 0, order: index + 1,
      insert: `\n<aside class="margin-note ann-${escapeHtml(mark.tone)}"${ids ? ` data-ann="${escapeHtml(mark.annotationId)}"` : ""}><span class="kind">${escapeHtml(mark.kind)}</span> ` +
        `<span class="body">${escapeHtml(mark.body)}</span>${replies}</aside>` });
  }
  // Applied back to front; at one point, asides in mark order.
  let out = html;
  for (const edit of edits.sort((a, b) => b.at - a.at || b.order - a.order)) {
    out = `${out.slice(0, edit.at)}${edit.insert}${out.slice(edit.at + edit.remove)}`;
  }
  return out.replace(SENTINEL, "");
}

/** Dark-first: tone backgrounds capped dark, text left in the page's colour. */
export const MARGINALIA_STYLE = `
mark.ann{color:inherit;border-radius:.15em;padding:0 .1em;background:#2a2d33}
.ann-warn{background:#392e18}.ann-good{background:#173026}.ann-bad{background:#3a2025}
.ann-accent{background:#282139}.ann-dim{background:#1e1f22}.ann-default{background:#2a2d33}
aside.margin-note{margin:.35rem 0 .75rem;padding:.35rem .6rem;border-left:3px solid var(--rule);font:14px/1.5 ui-sans-serif,system-ui,sans-serif;white-space:pre-line}
aside.margin-note .kind{color:var(--dim);text-transform:capitalize}
aside.margin-note .replies{color:var(--dim)}
`;
