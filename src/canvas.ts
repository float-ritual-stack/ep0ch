// A cell grid the desk composes into: panes, borders and floating overlays all write here,
// then it becomes one styled line per row. Blank cells keep the default background so the
// CRT underlay shows through.
import { RESET } from "./style";

interface Cell { ch: string; sgr: string }
export interface Rect { col: number; row: number; cols: number; rows: number }
/** Where a view is in its content: the first line shown, how many fit, how many there are. */
export interface Scroll { top: number; room: number; total: number }

/** The content is longer than the view: its frame shows a thumb and how far down it is. */
export const overflows = (s: Scroll | null | undefined): s is Scroll => !!s && s.total > s.room;
/** `42%`: how much has been read by the bottom of the view, as the message reader (screens.ts) says it. */
export const scrollPct = (s: Scroll) => `${Math.round((Math.min(s.top + s.room, s.total) / s.total) * 100)}%`;

const SGR = /(\x1b\[[\d;]*m)/;

export class Canvas {
  private cells: Cell[][];
  constructor(readonly cols: number, readonly rows: number) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: " ", sgr: "" })));
  }

  /** Write a styled string at (col,row), clipped to `max` cells. */
  text(col: number, row: number, s: string, max = this.cols - col): void {
    const line = this.cells[row];
    if (!line || max <= 0) return;
    let sgr = "", x = col;
    for (const part of s.split(SGR)) {
      if (!part) continue;
      if (part.startsWith("\x1b[")) { sgr = part === RESET || part === "\x1b[m" ? "" : sgr + part; continue; }
      for (const ch of part) {
        if (x >= col + max || x >= this.cols) return;
        if (x >= 0) line[x] = { ch, sgr };
        x++;
      }
    }
  }

  /** Blank a rectangle (used under floating overlays). */
  clear(r: Rect, sgr = ""): void {
    for (let y = r.row; y < r.row + r.rows; y++) {
      const line = this.cells[y];
      if (!line) continue;
      for (let x = r.col; x < r.col + r.cols && x < this.cols; x++) line[x] = { ch: " ", sgr };
    }
  }

  /** Single-line box with a title in the top edge and an optional hint in the bottom edge. */
  box(r: Rect, sgr: string, title = "", hint = ""): void {
    if (r.cols < 2 || r.rows < 2) return;
    const right = r.col + r.cols - 1, bottom = r.row + r.rows - 1;
    const put = (x: number, y: number, ch: string, style = sgr) => { const l = this.cells[y]; if (l && x >= 0 && x < this.cols) l[x] = { ch, sgr: style }; };
    for (let x = r.col + 1; x < right; x++) { put(x, r.row, "─"); put(x, bottom, "─"); }
    for (let y = r.row + 1; y < bottom; y++) { put(r.col, y, "│"); put(right, y, "│"); }
    put(r.col, r.row, "┌"); put(right, r.row, "┐"); put(r.col, bottom, "└"); put(right, bottom, "┘");
    if (title) this.text(r.col + 2, r.row, ` ${title} `, r.cols - 4);
    if (hint) this.text(r.col + 2, bottom, ` ${hint} `, r.cols - 4);
  }

  /** A scroll thumb on the right border of box `r`: its length is the share in view, its place how far down. */
  thumb(r: Rect, s: Scroll, sgr: string): void {
    const track = r.rows - 2;
    if (track < 1 || !overflows(s)) return;
    const size = Math.max(1, Math.min(track, Math.round((track * s.room) / s.total)));
    const pos = Math.round((track - size) * Math.min(1, Math.max(0, s.top / (s.total - s.room))));
    for (let i = 0; i < size; i++) this.text(r.col + r.cols - 1, r.row + 1 + pos + i, sgr + "█" + RESET, 1);
  }

  lines(): string[] {
    return this.cells.map(line => {
      let out = "", last = "";
      for (const c of line) {
        if (c.sgr !== last) { out += RESET + c.sgr; last = c.sgr; }
        out += c.ch;
      }
      return out + RESET;
    });
  }
}
