import { Canvas } from "../canvas";
import { drawDrop } from "../desk/drop-drawing";
import { zonesOf } from "../desk/drop";
import type { Pane, PaneView } from "../desk/panes";

/** A still of the real drag overlay, so the layout exhibit shows the choices before a person drags. */
export class DropZonesPane implements Pane {
  readonly kind = "exhibit";
  title() { return "Drop zones"; }
  hint() { return "drag a tile title over the reader to try these zones"; }
  render(cols: number, rows: number): PaneView {
    const canvas = new Canvas(cols, rows);
    const rect = { col: 0, row: 0, cols, rows };
    const tile = { id: "seedlings", rect };
    const swap = zonesOf(tile, "watering").find(z => z.kind === "swap");
    if (swap) drawDrop(canvas, rect, swap, "watering", 0, rows - 2, undefined, tile, "watering");
    return { lines: canvas.lines() };
  }
  key() { return false; }
}
