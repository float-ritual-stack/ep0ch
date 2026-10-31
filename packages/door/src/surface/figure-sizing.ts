import type { ContentSize } from "@ep0ch/outline-core/media-line";
import type { Doc, DocPart } from "../doc";
import type { FigureInfo } from "../graphs";
import { resizeEnded, resizeHeld } from "../resize";
import { C, fg, pad, RESET } from "../style";
import type { InlineList } from "./inline-list";

export const wideFigureAt = (doc: Doc, row: number): DocPart | undefined => doc.parts?.find(p => p.full && row >= p.row && row < p.row + (p.rows ?? 0));
type Frame = { figure: FigureInfo; x: number; y: number; cols: number; rows: number; from: number; to: number };

/** The reader's figure rectangles and the one edge currently held; edits stay in its normal patch history. */
export class FigureSizing {
  readonly lists = new Map<string, InlineList>();
  frames: Frame[] = [];
  drag: { frame: Frame; axis: "height" | "width"; x: number; y: number; now?: Partial<ContentSize>; saving?: boolean } | null = null;

  place(doc: Doc, figures: FigureInfo[], col: number, fullCol: number, top: number, bottom: number, scroll: number, heroRows: number) {
    this.frames = (doc.parts ?? []).flatMap(p => {
      const figure = figures.find(f => f.key === p.figure);
      if (!figure) return [];
      const y = top + p.row - scroll + heroRows, rows = p.rows!, cols = p.cols!;
      const x = (p.full ? fullCol : col) + p.col - (Math.max(16, cols) - 3);
      return y + rows > top + heroRows && y < bottom + heroRows ? [{ figure, x, y, cols, rows, from: Math.max(y, top + heroRows), to: Math.min(y + rows, bottom + heroRows) }] : [];
    });
  }
  edge(x: number, y: number) {
    const frame = this.frames.find(f => x >= f.x && x < f.x + f.cols && y >= f.from && y < f.to && (y === f.y + f.rows - 1 || x === f.x + f.cols - 1));
    return frame && { frame, axis: y === frame.y + frame.rows - 1 ? "height" as const : "width" as const };
  }
  preview(key: string) { return this.drag?.frame.figure.key === key ? this.drag.now : undefined; }
  cancel() { if (this.drag) { this.drag = null; resizeEnded(); } }
  move(x: number, y: number) {
    const d = this.drag;
    if (!d || d.saving || x === d.x && y === d.y && !d.now) return;
    d.now = d.axis === "height" ? { height: Math.max(1, (d.frame.figure.size.height ?? d.frame.rows - 4) + y - d.y) }
      : { width: x > d.x ? "full" : x < d.x ? "fit" : d.frame.figure.size.width };
    resizeHeld();
  }
  paint(key: string, lines: string[], cols: number): string[] {
    const d = this.drag;
    if (!d || d.frame.figure.key !== key) return lines;
    const said = d.axis === "height" ? `${d.now?.height ?? d.frame.rows - 4} rows` : d.now?.width ?? d.frame.figure.size.width;
    const out = [...lines], last = out.length - 1;
    out[last] = fg(C.yellow) + pad(`+ ${said} · let go to save · ctrl+z undoes `, cols - 1) + "+" + RESET;
    return out;
  }
}
