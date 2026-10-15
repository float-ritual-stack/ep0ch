// Where each block is on a tailnet page: an empty `<span class="bk" data-block="<id>">` at the end of the block's
// first drawn line, so the page's script can say which blocks are on screen and scroll to one (`ep0ch.view()`,
// `ep0ch.reveal()`, publish-reader.js). It rides through the Markdown renderer as a private-use sentinel, as
// components' and marginalia's do, and is put in its place after (drawAnchors). The span holds no text, so what a
// reader selects (and publish-passage.ts finds) is unchanged.

import { metadataLines } from "@ep0ch/outline-core/block-tags";
import { quoteDepth } from "@ep0ch/outline-core/callouts";
import { parsePropertyRecords } from "./properties";
import { blockReferenceOccurrences, pageAddressReferences } from "@ep0ch/outline-core/link-syntax";
import { codeLineSet, ensureFragmentAnchor, fragmentCandidates, resolveFragmentSlice } from "./fragments";

/** Stable within a source revision, just like the door's Reveal.at from references.backlinks. */
export const linkingLineId = (at: number) => `at:${at}`;

/** Addresses travel with the original lines through decorations and component replacement. */
export function lineAddresses(text: string, prefix: string, ids: string[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const used = new Set(ids);
  const metadata = metadataLines(text, parsePropertyRecords(text));
  const add = (line: number, id: string) => {
    if (ids.length >= MAX_ANCHORS || used.has(`#${prefix}${id}`)) return;
    used.add(`#${prefix}${id}`);
    const at = ids.push(`#${prefix}${id}`) - 1;
    // Hidden metadata is represented by the title; markers must not turn it into prose.
    if (metadata.has(line)) line = 0;
    out.set(line, [...(out.get(line) ?? []), at]);
  };
  // The fragment module owns both explicit anchors and the slug a heading receives.
  let anchored = text;
  for (const candidate of fragmentCandidates(text)) {
    const id = candidate.fragmentId ?? ensureFragmentAnchor(anchored, candidate.lineIndex).fragmentId;
    if (!candidate.fragmentId) anchored = ensureFragmentAnchor(anchored, candidate.lineIndex).text;
    const slice = candidate.kind === "component" ? resolveFragmentSlice(text, id) : null;
    add(slice?.status === "resolved" ? slice.slice.startLine : candidate.lineIndex, id);
  }
  const code = codeLineSet(text);
  let offset = 0;
  text.split("\n").forEach((line, at) => {
    // An empty quote line separates paragraphs; a marker would make it content.
    if (quoteDepth(line).content.trim() && !code.has(at) && !/^[\s|:=-]+$/.test(line)) add(at, `line:${offset}`);
    offset += line.length + 1;
  });
  for (const ref of [...blockReferenceOccurrences(text), ...pageAddressReferences(text)]) {
    const line = text.slice(0, ref.start).split("\n").length - 1;
    if (!code.has(line)) add(line, linkingLineId(ref.start));
  }
  return out;
}

/** A replacement's marker group is moved inside its rendered container after Markdown draws it. */
export const replacementAddresses = (indices: readonly number[]) => indices.length
  ? `${indices.map(index => anchorSentinel(index)).join("")}` : "";

const MARK = "", BASE = 0xE300;
const SENTINEL = /(<p>)?([-])([-])(<\/p>)?/g;
/** At most this many anchors on one page: two private-use characters each. */
export const MAX_ANCHORS = 256 * 256;

const anchorSentinel = (index: number) =>
  `${MARK}${String.fromCharCode(BASE + (index >> 8))}${String.fromCharCode(BASE + (index & 0xFF))}${MARK}`;

/**
 * `text` (a block's Markdown, as drawn) with block `index`'s sentinel at the end of its first line, before a hard
 * break; on a line of its own before the text when the first line opens a fence, a table, HTML or a rule, which
 * anything after it would change.
 */
export function placeAnchor(text: string, index: number, inCode = /^ {4}|^\t/.test(text)): string {
  if (index >= MAX_ANCHORS) return text;
  const sentinel = anchorSentinel(index);
  const end = text.indexOf("\n");
  const head = end < 0 ? text : text.slice(0, end);
  // A table cell may hold an empty span; a separate sentinel paragraph would split the table.
  if ((/^\s*\|/.test(head) || /\|[ \t]*$/.test(head)) && !/^\s*\|?[\s:|-]+$/.test(head)) {
    const at = /\|[ \t]*$/.exec(head)?.index ?? head.length;
    return `${text.slice(0, at)}${sentinel}${text.slice(at)}`;
  }
  // The line's own construct, under any quote and list markers it opens with.
  const inner = head.replace(/^\s*(?:(?:>[ \t]?)|(?:[-*+]|\d{1,9}[.)])[ \t]+)*/, "");
  if (!head.trim() || inCode || OWN_LINE.test(inner)) return `${sentinel}\n\n${text}`;
  // Before a heading's closing hashes and a hard break, which anything after them would turn into text.
  const closing = /^#{1,6}[ \t]/.test(inner) ? /(?:[ \t]+#+)?(?:\\|[ \t]+)?$/ : /(?:\\|[ \t]+)?$/;
  const at = head.length - (closing.exec(head)?.[0].length ?? 0);
  return `${text.slice(0, at)}${sentinel}${text.slice(at)}`;
}

/** First lines nothing may follow: a fence, a table row, HTML, a rule, a link reference definition, a bare callout tag. */
const OWN_LINE = /^(?:`{3,}|~{3,}|\||<|(?:[-*_][ \t]*){3,}$|\[[^\]]+\]:|\[![^\]]+\][+-]?[ \t]*$)/;

/** The rendered page with each sentinel as its block's anchor; one left alone in a paragraph takes the paragraph's place. */
export function drawAnchors(html: string, ids: readonly string[]): string {
  if (!ids.length) return html;
  // Replacement destinations belong inside the rendered figure/callout, not to its following paragraph.
  html = html
    .replace(/(<\/(?:figure|section|div|p|h[1-6]|table)>)(\s*)<p>((?:[-]{2})+)<\/p>/g, "$3$1$2")
    // When following prose shares the paragraph, keep its opening tag.
    .replace(/(<\/(?:figure|section|div|p|h[1-6]|table)>)(\s*)(<p>)?((?:[-]{2})+)/g, "$4$1$2$3")
    .replace(//g, "");
  return html.replace(SENTINEL, (_, open: string | undefined, high: string, low: string, close: string | undefined) => {
    const id = ids[((high.charCodeAt(0) - BASE) << 8) + low.charCodeAt(0) - BASE];
    const span = id?.startsWith("#") ? `<span class="line-anchor" id="${id.slice(1).replace(/[^0-9A-Za-z_:-]/g, "")}"></span>` : id ? `<span class="bk" data-block="${id.replace(/[^0-9A-Za-z-]/g, "")}"></span>` : "";
    return open && close ? span : `${open ?? ""}${span}${close ?? ""}`;
  });
}
