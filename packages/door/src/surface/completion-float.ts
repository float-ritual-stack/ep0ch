import { Canvas, type Rect } from "../canvas";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { width as cells } from "../style";
import { COMPLETION_ROWS, type Completer } from "./completer";
import { anchoredRows, previewBeside } from "./completion-popup";

/** The sheet (B) is about a third of the area, and never shorter than this: a preview needs rows to show a passage. */
export const SHEET_MIN_ROWS = 10;

/**
 * The one placement of the completion popup, for every host and every source (PIE-1511). Hosts supply the cursor's
 * origin; this measures the popup first, then places it, and draws it once.
 * - A (anchored, the default): under the caret, at its column, as wide as its list and preview column and as tall as
 *   its rows; shifted left when it would run off the right edge.
 * - B (sheet): when A won't fit below the caret, a short sheet along the bottom (about a third of the area), list left
 *   and preview right. When the sheet would cover the caret's line, A above the caret instead, where it fits; else the
 *   sheet along the top.
 * - Where even the sheet has no room for the preview beside (44 columns), A again, cut to the taller side of the caret.
 */
export function drawCompletionFloat(canvas: Canvas, completion: Completer, area: Rect, origin: Rect, values?: StyleValues): Rect | null {
  if (!completion.shown || !completion.drawn) return null;
  const at = completion.drawn;
  const cursor = { col: origin.col + (at.anchor ?? 0), row: origin.row + at.row - 1 };
  const below = area.row + area.rows - cursor.row - 1, above = cursor.row - area.row;
  const natural = anchoredRows(completion.shown, area.cols, Math.min(COMPLETION_ROWS, area.rows));
  const anchored = (h: number) => completion.inFrame(area.cols, cursor.col - origin.col, h, values, "anchored");
  const place = (lines: string[], under: boolean): Rect => {
    at.layout = under ? "below" : "above";
    return { col: cursor.col, row: under ? cursor.row + 1 : cursor.row - lines.length, cols: Math.max(1, ...lines.map(cells)), rows: lines.length };
  };
  let lines!: string[], rect!: Rect;
  // The sheet is about a third of the area along the bottom; it opens when A won't fit below the caret, unless it would
  // cover the caret's line (the caret in the bottom rows): then A above, when it fits there, is better (PIE-1511).
  const tall = Math.min(area.rows, Math.max(SHEET_MIN_ROWS, Math.floor(area.rows / 3)));
  const sheet = (top: boolean) => {
    lines = completion.inFrame(area.cols, 0, Math.max(4, Math.min(tall, top ? above : below)), values, "sheet");
    rect = { col: area.col, row: top ? area.row : area.row + area.rows - lines.length, cols: area.cols, rows: lines.length };
    at.layout = "sheet";
  };
  const roomy = previewBeside(completion.shown, area.cols - 2);
  if (natural <= below) { lines = anchored(natural); rect = place(lines, true); }
  else if (roomy && tall <= below) sheet(false);
  else if (natural <= above) { lines = anchored(natural); rect = place(lines, false); }
  else if (roomy) sheet(below < above);
  else {
    // Too narrow for a sheet with the preview beside (44 columns): A again, cut to the taller side of the caret, its list scrolling.
    lines = anchored(Math.max(4, below, above));
    rect = place(lines, below >= above);
  }
  rect.col = Math.max(area.col, Math.min(area.col + area.cols - rect.cols, rect.col));
  at.row = rect.row - origin.row;
  at.col = rect.col - origin.col;
  at.cols = rect.cols;
  canvas.clear(rect);
  lines.forEach((line, i) => canvas.text(rect.col, rect.row + i, line, rect.cols));
  return rect;
}
