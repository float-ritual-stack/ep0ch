// Where each block is on a tailnet page: an empty `<span class="bk" data-block="<id>">` at the end of the block's
// first drawn line, so the page's script can say which blocks are on screen and scroll to one (`ep0ch.view()`,
// `ep0ch.reveal()`, publish-reader.js). It rides through the Markdown renderer as a private-use sentinel, as
// components' and marginalia's do, and is put in its place after (drawAnchors). The span holds no text, so what a
// reader selects (and publish-passage.ts finds) is unchanged.

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
export function placeAnchor(text: string, index: number): string {
  if (index >= MAX_ANCHORS) return text;
  const sentinel = anchorSentinel(index);
  const end = text.indexOf("\n");
  const head = end < 0 ? text : text.slice(0, end);
  if (!head.trim() || /^\s*(?:`{3,}|~{3,}|\||<|(?:[-*_]\s*){3,}$)|^ {4}|^\t/.test(head)) return `${sentinel}\n\n${text}`;
  const at = head.length - (/(?:\\|[ \t]+)$/.exec(head)?.[0].length ?? 0);
  return `${text.slice(0, at)}${sentinel}${text.slice(at)}`;
}

/** The rendered page with each sentinel as its block's anchor; one left alone in a paragraph takes the paragraph's place. */
export function drawAnchors(html: string, ids: readonly string[]): string {
  if (!ids.length) return html;
  return html.replace(SENTINEL, (_, open: string | undefined, high: string, low: string, close: string | undefined) => {
    const id = ids[((high.charCodeAt(0) - BASE) << 8) + low.charCodeAt(0) - BASE];
    const span = id ? `<span class="bk" data-block="${id.replace(/[^0-9A-Za-z-]/g, "")}"></span>` : "";
    return open && close ? span : `${open ?? ""}${span}${close ?? ""}`;
  });
}
