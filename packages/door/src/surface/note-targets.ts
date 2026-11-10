// The press targets a drawn note holds (PIE-1543): where the copy controls go, and which target under a cell a press
// presses. One owner for every host that draws a note (the reader's scroll window, a river column's digest).
import type { Doc } from "../doc";
import { C, fg, type LinkRange } from "../style";
import type { Link } from "./link-model";
import type { Hit } from "./note";
import { putCell } from "./selection";

const COPY_GLYPH = "⧉";
/** How many of a block's first rows its copy control looks through for a free cell. */
export const COPY_ROWS = 4;

/**
 * Which of the targets under one cell a press presses, for every host (the reader's click, a river column's: PIE-1543):
 * a copy control first, then a link, a thread mark or another control, then a region's mark (over a fold at the same
 * gutter cell), then whatever is there.
 */
export function pickTarget(at: readonly Hit[]): Hit | undefined {
  return at.find(h => "block" in h) ?? at.find(h => "copy" in h || "link" in h || "thread" in h || "history" in h || "pick" in h || "image" in h || "start" in h || ("follow" in h && h.follow)) ?? at.find(h => "region" in h) ?? at[0];
}

/**
 * The copy control (PIE-638) on a code block, a quote and a callout: a dim ⧉ at the block's top right edge, bright while
 * its block (`now`) holds the `[ ]` position, put into `lines` on its first row with a free cell there (a long first
 * line fills its row; never over a code cell it would hide). A code span is a target with no control: it copies its
 * contents. `at`: where a doc row is in `lines` (null: not shown); `bx`: the body's inset. One placement for every host
 * that draws a note (the reader's scroll window, a digest's whole note: PIE-1543); a click is block.copy, as y is.
 */
export function copyControls(lines: string[], doc: Doc, o: { at: (docRow: number) => number | null; bx: number; w: number; now: number | null }): Hit[] {
  const hits: Hit[] = [];
  doc.blocks.forEach((b, n) => {
    if (b.kind === "span") {
      for (const cell of b.cells!) {
        const at = o.at(cell.row);
        if (at !== null && cell.from + o.bx < o.w) hits.push({ row: at, from: cell.from + o.bx, to: Math.min(o.w, cell.to + o.bx), block: n });
      }
      return;
    }
    if (b.col + o.bx >= o.w) return;
    for (let r = b.row; r < b.row + Math.min(b.rows, COPY_ROWS); r++) {
      const at = o.at(r);
      if (at === null || at >= lines.length) continue;
      const put = putCell(lines[at]!, b.col + o.bx, COPY_GLYPH, fg(n === o.now ? C.lcyan : C.dark));
      if (put === null) continue;
      lines[at] = put;
      hits.push({ row: at, from: b.col + o.bx, to: b.col + o.bx + 1, block: n });
      break;
    }
  });
  return hits;
}

/**
 * The body's link and picture targets, built once for every host that draws a note (Nov 3 review card 2): a link's
 * range (its element found by `elemOf`) and a picture's caption and cells. The reader gives rows through its scroll
 * window (`at` is null off screen), a river column's digest the whole note; `dx`/`cols` place a row in its figure's
 * bounds. Copy controls (`copyControls`), fold heads and a status choice's rows are placed against each host's own rows.
 * `elemBx`: the margin the elements' columns count (the surface's `bx`); their hits are moved to this host's `bx`.
 * `top`: how many rows an element's row is below its doc row.
 */
export function bodyTargets(doc: Doc, drawn: readonly Link[], elems: readonly { key: string; row: number; from: number; to: number; link?: Link }[], o: {
  at: (docRow: number) => number | null; dx: (docRow: number) => number; cols: (docRow: number) => number; bx: number; w: number;
  elemBx: number; top: number; elemOf: (r: LinkRange) => string | undefined;
}): Hit[] {
  const hits: Hit[] = [], first = new Map<number, string>();
  for (const r of doc.links) if (!first.has(r.n)) first.set(r.n, o.elemOf(r) ?? "");
  for (const r of doc.links) {
    const row = o.at(r.line), dx = o.dx(r.line), cols = o.cols(r.line), link = drawn[r.n];
    if (link && row !== null && r.from < cols) hits.push({ row, from: r.from + dx, to: Math.min(cols, r.to) + dx, link, elem: first.get(r.n) || undefined });
  }
  for (const e of elems) {
    if (!e.link?.media) continue;
    const row = o.at(e.row - o.top);
    if (row !== null) hits.push({ row, from: e.from - o.elemBx + o.bx, to: Math.min(o.w, e.to - o.elemBx + o.bx), link: e.link, elem: e.key });
    const x = doc.media.find(x => o.top + x.row === e.row), im = x?.image !== undefined ? doc.images[x.image] : undefined;
    if (im) for (let r = im.line; r < im.line + im.rows; r++) {
      const at = o.at(r);
      if (at !== null) hits.push({ row: at, from: o.bx + im.col, to: Math.min(o.w, o.bx + im.col + im.cols), image: e.key });
    }
  }
  return hits;
}

/**
 * The geometry a host draws a note in, for the targets that sit in its rows (Nov 3 review card 2): `at` maps a doc row to
 * the host's row (null: not shown, so a reader's scroll window cuts there and a digest shows the whole note), `from`/`to`
 * the columns of the body (a reader's start at its margin, a digest's at 0: the host adds its inset).
 */
export interface RowGeometry { at: (docRow: number) => number | null; from: number; to: number }

/**
 * The fold heads' targets: every row of a heading folds it (PIE-1349). A host with a gutter (the reader) passes its
 * cells, `gutter`, and where the disclosure drawn at the heading's words is, `glyphCol` (PIE-1403); a host with none (a
 * digest) takes the heading's whole row. `foldOf`: the fold point's number (from 1), or null for a heading that has none.
 */
export function foldHeadTargets(heads: Doc["heads"], foldOf: (key: string) => number | null, g: RowGeometry, o: { gutter?: [number, number]; glyphCol?: (hostRow: number) => number | null } = {}): Hit[] {
  const hits: Hit[] = [];
  for (const h of heads) {
    const fold = foldOf(h.key);
    if (fold === null) continue;
    for (let k = 0; k < (h.rows ?? 1); k++) {
      const row = g.at(h.row + k);
      if (row === null) continue;
      hits.push(o.gutter ? { row, from: o.gutter[0], to: o.gutter[1], fold } : { row, from: g.from, to: h.cols, fold });
      const col = k === 0 ? o.glyphCol?.(row) : null;
      if (col !== null && col !== undefined) hits.push({ row, from: col, to: col + 1, fold });
    }
  }
  return hits;
}

/** An open choice's rows (a step's status, a callout's type: PIE-472): row `i` of `rows` is choice `i`, in the same Hit in every host. */
export function pickTargets(rows: readonly number[], g: RowGeometry): Hit[] {
  const hits: Hit[] = [];
  for (const [i, r] of rows.entries()) { const row = g.at(r); if (row !== null) hits.push({ row, from: g.from, to: g.to, pick: i }); }
  return hits;
}
