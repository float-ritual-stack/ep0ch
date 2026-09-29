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

/** The characters a box is drawn with. */
export interface BoxGlyphs { top: string; bottom: string; side: string; tl: string; tr: string; bl: string; br: string }
export const LINE_BOX: BoxGlyphs = { top: "─", bottom: "─", side: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" };
/** The dotted frame of the ep0ch logos (WoE, 1997): dots along, colons down. */
export const DOTTED_BOX: BoxGlyphs = { top: ".", bottom: ".", side: ":", tl: ".", tr: ".", bl: ":", br: ":" };

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

  /**
   * Dim a rectangle: each cell's truecolor foreground scaled by `by` (0..1), and a plain cell given the
   * default grey scaled the same. Backgrounds stay, so a selection or a ruler still shows under it.
   */
  dim(r: Rect, by = 0.5): void {
    const scale = (m: string) => m.replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, (_, a, b, c) => `\x1b[38;2;${[a, b, c].map(v => Math.round(Number(v) * by)).join(";")}m`);
    const plain = `\x1b[38;2;${[170, 170, 170].map(v => Math.round(v * by)).join(";")}m`;
    for (let y = r.row; y < r.row + r.rows; y++) {
      const line = this.cells[y];
      if (!line) continue;
      for (let x = Math.max(0, r.col); x < r.col + r.cols && x < this.cols; x++) {
        const c = line[x]!;
        c.sgr = /\x1b\[38;2;/.test(c.sgr) ? scale(c.sgr) : c.sgr + plain;
      }
    }
  }

  /** A box with a title in the top edge and an optional hint in the bottom edge: single lines, or `g`'s glyphs. */
  box(r: Rect, sgr: string, title = "", hint = "", g: BoxGlyphs = LINE_BOX): void {
    if (r.cols < 2 || r.rows < 2) return;
    const right = r.col + r.cols - 1, bottom = r.row + r.rows - 1;
    const put = (x: number, y: number, ch: string, style = sgr) => { const l = this.cells[y]; if (l && x >= 0 && x < this.cols) l[x] = { ch, sgr: style }; };
    for (let x = r.col + 1; x < right; x++) { put(x, r.row, g.top); put(x, bottom, g.bottom); }
    for (let y = r.row + 1; y < bottom; y++) { put(r.col, y, g.side); put(right, y, g.side); }
    put(r.col, r.row, g.tl); put(right, r.row, g.tr); put(r.col, bottom, g.bl); put(right, bottom, g.br);
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
