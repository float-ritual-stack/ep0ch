import type { ContentSize } from "@ep0ch/outline-core/media-line";
import type { Doc, DocPart } from "../doc";
import type { FigureInfo } from "../graphs";
import { resizeHeld } from "../resize";
import { C, fg, pad, RESET } from "../style";
import type { InlineList } from "./inline-list";
import { ReaderPointer } from "./reader-pointer";

export const wideFigureAt = (doc: Doc, row: number): DocPart | undefined => doc.parts?.find(p => p.full && row >= p.row && row < p.row + (p.rows ?? 0));
type Frame = { figure: FigureInfo; x: number; y: number; cols: number; rows: number; from: number; to: number };
/** The edge held: which, where it was pressed, the reader's scroll then, and the size it's drawn at. */
export type FigureDrag = { frame: Frame; axis: "height" | "width"; x: number; y: number; scroll?: number; now?: Partial<ContentSize> };

/**
 * The reader's figure rectangles and the geometry of the one edge held; edits stay in its normal patch history. Whether
 * one is held is the reader's one gesture (`figure` in src/surface/reader-pointer.ts), so `drag` is a view of it.
 */
export class FigureSizing {
  constructor(private readonly pointer = new ReaderPointer()) {}
  readonly lists = new Map<string, InlineList>();
  frames: Frame[] = [];
  /** The edge as it's drawn: held, or let go with its save on the way. */
  get drag() { return this.pointer.figure; }
  /** The edge the button holds now. */
  get held() { return this.pointer.heldFigure; }
  hold(d: FigureDrag) { this.pointer.hold({ kind: "figure", ...d }); }
  /** The reader's last row on screen, from the last place(). */
  last = 0;

  place(doc: Doc, figures: FigureInfo[], col: number, fullCol: number, top: number, bottom: number, scroll: number, heroRows: number) {
    this.last = bottom + heroRows - 1;
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
  /** Let go: drawn at its size until `save` is over. */
  async landing(save: () => Promise<unknown>) {
    const d = this.held;
    if (!d) return;
    this.pointer.land(d);
    try { await save(); } finally { this.pointer.landed(d); }
  }
  move(x: number, y: number) {
    const d = this.held;
    if (!d || x === d.x && y === d.y && !d.now) return;
    d.now = d.axis === "height" ? { height: Math.max(1, (d.frame.figure.size.height ?? d.frame.rows - 4) + y - d.y) }
      : { width: x > d.x ? "full" : x < d.x ? "fit" : d.frame.figure.size.width };
    resizeHeld();
  }
  /**
   * The reader's scroll that keeps a held bottom edge in sight (PIE-1513): a figure that grows past the reader's last
   * row scrolls it up by as much, so the edge and its row count stay where the person can see them while the pointer
   * goes on below the tile. Measured from the scroll the drag started at, both ways: dragged back up, the scroll it
   * added goes again and the edge comes back under the pointer. `scroll` is the reader's now, kept when nothing is held.
   */
  follow(scroll: number): number {
    const d = this.drag;
    if (!d || d.axis !== "height" || d.now?.height === undefined) return scroll;
    const start = d.scroll ?? scroll, grown = d.now.height - (d.frame.figure.size.height ?? d.frame.rows - 4);
    // The edge's row at the scroll the drag started from.
    const edge = d.frame.y + d.frame.rows - 1 + grown;
    return start + Math.max(0, edge - this.last);
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
