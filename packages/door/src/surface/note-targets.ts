// The press targets a drawn note holds (PIE-1543): where the copy controls go, and which target under a cell a press
// presses. One owner for every host that draws a note (the reader's scroll window, a river column's digest).
import type { Doc } from "../doc";
import { C, fg } from "../style";
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
