import { Canvas, type Rect } from "../canvas";
import { keepOnScreen } from "../desk/screen-layout";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { COMPLETION_ROWS, type Completer } from "./completer";

/** Hosts supply the cursor's origin; only the screen float layer places and paints the popup. */
export function drawCompletionFloat(canvas: Canvas, completion: Completer, area: Rect, origin: Rect, values?: StyleValues): Rect | null {
  if (!completion.shown || !completion.drawn) return null;
  const cursor = { col: origin.col + (completion.drawn.anchor ?? 0), row: origin.row + completion.drawn.row - 1, cols: 1, rows: 1 };
  const height = Math.min(COMPLETION_ROWS, Math.max(4, cursor.row - area.row, area.row + area.rows - cursor.row - 1));
  const rect = keepOnScreen({ col: area.col, row: cursor.row + 1, cols: area.cols, rows: height }, area, cursor);
  completion.drawn.row = rect.row - origin.row;
  const lines = completion.inFrame(rect.cols, rect.col - origin.col, height, values);
  rect.rows = lines.length;
  canvas.clear(rect);
  lines.forEach((line, i) => canvas.text(rect.col, rect.row + i, line, rect.cols));
  return rect;
}
