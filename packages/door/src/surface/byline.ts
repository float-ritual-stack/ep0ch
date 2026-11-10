// The reader's byline laid over rows (PIE-1686): whole pieces (who and when, the property count, the summary's values, the
// comment count, the [sources] and [comment] chips) that move to the next row whole instead of being cut. NoteSurface's
// headerBlock builds the pieces and places its chips and links from what this lays out.
import { C, ellipsize, fg, width } from "../style";
import type { Link } from "./link-model";

/**
 * A piece of the byline (PIE-1686): its words as drawn, a shorter form for a row too narrow for them (the comment
 * count's), the summary's linked values in its cells, the chip a click on it is (`hit`), whether it may be left out
 * (`optional`: the tile menu has it too) and the run it keeps together while one row holds it (`group`: the summary).
 */
export interface BylinePiece { text: string; short?: string; links?: { from: number; to: number; link: Link; key: string }[]; hit?: "props" | "margin" | "sources" | "comment"; optional?: boolean; group?: "summary" }
const BYLINE_SEP = ` · `;
/** A reader this short (rows) keeps its byline to one row (PIE-1686): the rows go to the note and to what is being written. */
export const SHORT_READER_ROWS = 12;

/**
 * The byline's pieces laid over rows `w` cells wide, joined by ` · `: each goes on the row so far while it fits there
 * whole, else starts the next row; a group starts a row of its own when the row so far can't hold all of it. A piece is
 * cut only when it is wider than a row by itself (its short form first). An optional piece goes on the last row, or
 * the first, where it fits whole (the ones after it on the same row), else nowhere. `oneRow`: a piece that doesn't fit
 * the first row is left out whole instead of starting another. `placed`: each piece's row and cells, as drawn.
 */
export function flowByline(pieces: readonly BylinePiece[], w: number, oneRow = false): { rows: string[]; placed: { row: number; from: number; to: number; piece: BylinePiece }[] } {
  const sep = width(BYLINE_SEP), rows: string[] = [], used: number[] = [], placed: { row: number; from: number; to: number; piece: BylinePiece }[] = [];
  const fits = (row: number, n: number) => used[row] !== undefined && (used[row] ? used[row]! + sep : 0) + n <= w;
  const put = (piece: BylinePiece, text: string, row: number) => {
    const from = used[row]! + (used[row] ? sep : 0);
    rows[row] += (used[row] ? fg(C.dark) + BYLINE_SEP : "") + text;
    used[row] = from + width(text);
    placed.push({ row, from, to: used[row]!, piece });
  };
  const fresh = () => { rows.push(""); used.push(0); return rows.length - 1; };
  let optionalRow: number | null = null;
  pieces.forEach((p, i) => {
    const last = rows.length - 1, n = width(p.text);
    if (p.optional) {
      // After the last piece where it fits, else on the first row; the chips that follow keep to the same row.
      const row = (optionalRow !== null ? [optionalRow] : [last, 0]).find(r => fits(r, n));
      if (row !== undefined) { put(p, p.text, row); optionalRow = row; }
      return;
    }
    if (p.group && pieces[i - 1]?.group !== p.group && last >= 0 && used[last] && !oneRow) {
      let cells = 0;
      for (let j = i; pieces[j]?.group === p.group; j++) cells += width(pieces[j]!.text) + (j > i ? sep : 0);
      if (!fits(last, cells)) fresh();
    }
    let row = rows.length - 1;
    if (row >= 0 && used[row] && !fits(row, n) && oneRow) return;
    if (row < 0 || (used[row] && !fits(row, n))) row = fresh();
    put(p, n <= w - (used[row] ? used[row]! + sep : 0) ? p.text : p.short && width(p.short) <= w ? p.short : ellipsize(p.text, w), row);
  });
  return { rows, placed };
}
