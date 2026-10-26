import { clipText, FULL_END } from "./overflow";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { rowLines } from "./text";
// A cell grid the desk composes into: panes, borders and floating overlays all write here,
// then it becomes one styled line per row. Blank cells keep the default background so the
// CRT underlay shows through.
import { closesHyperlink, DRAWN_PART, OSC8_CLOSE } from "./hyperlink";
import { bgRgb, fgRgb, fitHint, glyphWidth, graphemes, RESET, width } from "./style";
import { floatTheme, theme } from "./theme";
import { printable } from "./text";

/** One terminal cell. A wide glyph's second cell is a spacer: `ch` "", drawn as nothing (the glyph covers it). */
interface Cell { ch: string; sgr: string; link?: string; full?: string }
export interface Rect { col: number; row: number; cols: number; rows: number }
/** Where a view is in its content: the first line shown, how many fit, how many there are. */
export interface Scroll { top: number; room: number; total: number }

/** The content is longer than the view: its frame shows a thumb and how far down it is. */
export const overflows = (s: Scroll | null | undefined): s is Scroll => !!s && s.total > s.room;
/** `42%`: how much has been read by the bottom of the view, as the message reader (screens.ts) says it. */
export const scrollPct = (s: Scroll) => `${Math.round((Math.min(s.top + s.room, s.total) / s.total) * 100)}%`;

const SGR = /(\x1b\[[\d;]*m)/;

/** Whether an SGR sets only the foreground colour (30–37, 90–97, 38;5;n, 38;2;r;g;b, 39), or only the background (40–47, 100–107, 48;…, 49). */
const FG = /^\x1b\[(?:3[0-79]|9[0-7]|38;5;\d+|38;2;\d+;\d+;\d+)m$/, BG = /^\x1b\[(?:4[0-79]|10[0-7]|48;5;\d+|48;2;\d+;\d+;\d+)m$/;
/**
 * The style `sgr` is in after `code`: a colour replaces the one before it rather than piling up after it, so a line
 * that sets a colour per cell (a header's backdrop drawn in cells, overColours) keeps each cell's style one colour
 * long. Piled up, its row was every colour before it again, cell after cell: 45 KB a row (PIE-623).
 */
export function withSgr(sgr: string, code: string): string {
  const fg = FG.test(code);
  if (!fg && !BG.test(code)) return sgr + code;
  const same = fg ? FG : BG;
  return sgr ? sgr.split(SGR).filter(p => p && !same.test(p)).join("") + code : code;
}

/**
 * Whether a line has a background of its own after SGR sequence `sgr`, given whether it had one before: its
 * parameters in order, a reset (0, or none) or 49 letting it go, 40–48 and 100–107 setting one, a colour's own
 * numbers after 38, 48 or 58 skipped.
 */
export function backgroundAfter(sgr: string, own: boolean): boolean {
  const ps = sgr.slice(2, -1).split(";").map(p => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p === 38 || p === 48 || p === 58) { if (p === 48) own = true; i += ps[i + 1] === 2 ? 4 : 2; continue; }
    if (p === 0 || p === 49) own = false;
    else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) own = true;
  }
  return own;
}
/** Whether a cell's style (its SGRs run together) leaves it on a background of its own. */
const hasBackground = (sgr: string) => [...sgr.matchAll(/\x1b\[[\d;]*m/g)].reduce((own, m) => backgroundAfter(m[0], own), false);

/** The characters a box is drawn with. */
export interface BoxGlyphs { top: string; bottom: string; side: string; tl: string; tr: string; bl: string; br: string }
export const LINE_BOX: BoxGlyphs = { top: "─", bottom: "─", side: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" };
/** The frames a look's `border` names (PIE-675): a tile's and a `::box`'s. */
export const BORDER_BOXES: Readonly<Record<"line" | "round" | "heavy" | "double", BoxGlyphs>> = {
  line: LINE_BOX,
  round: { top: "─", bottom: "─", side: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" },
  heavy: { top: "━", bottom: "━", side: "┃", tl: "┏", tr: "┓", bl: "┗", br: "┛" },
  double: { top: "═", bottom: "═", side: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" },
};
/** A frame that draws nothing: a tile with `border=none` keeps its title and hint on blank edges. */
export const NO_BOX: BoxGlyphs = { top: " ", bottom: " ", side: " ", tl: " ", tr: " ", bl: " ", br: " " };
/** The dotted frame of the ep0ch logos (WoE, 1997): dots along, colons down. */
export const DOTTED_BOX: BoxGlyphs = { top: ".", bottom: ".", side: ":", tl: ".", tr: ".", bl: ":", br: ":" };

export class Canvas {
  private cells: Cell[][];
  constructor(readonly cols: number, readonly rows: number) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: " ", sgr: "" })));
  }

  /**
   * Write a styled string at (col,row), clipped to `max` cells. It goes glyph by glyph in terminal cells: a
   * wide one (CJK, an emoji) takes two, the second a spacer; one that wouldn't fit whole leaves a space; a
   * zero-width one joins the glyph before it.
   */
  text(col: number, row: number, s: string, max = this.cols - col): void {
    const line = this.cells[row];
    if (!line || max <= 0) return;
    const end = Math.min(col + max, this.cols);
    let sgr = "", link: string | undefined, full: string | undefined, x = col;
    const drawn = clipText(s, end - col);
    for (const part of drawn.split(DRAWN_PART)) {
      if (!part) continue;
      if (part.startsWith("\x1b[777;")) { full = part; continue; }
      if (part === FULL_END) { full = undefined; continue; }
      if (part.startsWith("\x1b]8;")) { link = closesHyperlink(part) ? undefined : part; continue; }
      if (part.startsWith("\x1b[")) { sgr = part === RESET || part === "\x1b[m" ? "" : withSgr(sgr, part); continue; }
      // Nothing a terminal acts on takes a cell: an escape or control in a title is dropped here (PIE-510).
      for (const g of graphemes(printable(part.includes("\t") ? part.replaceAll("\t", " ") : part))) {
        const w = glyphWidth(g);
        if (!w) { if (x > col && x - 1 >= 0 && x - 1 < this.cols && line[x - 1]!.ch) line[x - 1]!.ch += g; continue; }
        if (x >= end) return;
        if (x + w > end) { if (x >= 0) this.put(line, x, { ch: " ", sgr }); return; }
        if (x >= 0) { this.put(line, x, { ch: g, sgr, link, full }); if (w === 2) this.put(line, x + 1, { ch: "", sgr, link, full }); }
        else if (x + w > 0) this.put(line, 0, { ch: " ", sgr });   // a wide glyph cut by the left edge: its visible half blank
        x += w;
      }
    }
  }

  /**
   * Set one cell. Writing over half of a wide glyph blanks its other half, so the row keeps its width (a
   * float's border over a CJK title, a clear under an overlay).
   */
  private put(line: Cell[], x: number, c: Cell): void {
    const old = line[x];
    if (!old) return;
    if (old.ch === "" && line[x - 1] && c.ch !== "") line[x - 1] = { ch: " ", sgr: line[x - 1]!.sgr };
    if (old.ch !== "" && line[x + 1]?.ch === "") line[x + 1] = { ch: " ", sgr: line[x + 1]!.sgr };
    line[x] = c;
  }

  /**
   * `from`'s cells in `r` written over these (the screen's floats and menus put back above the drawer, PIE-1221). A
   * wide glyph cut by the rectangle's edge leaves a space, so the row keeps its width.
   */
  copy(from: Canvas, r: Rect): void {
    const x0 = Math.max(0, r.col), x1 = Math.min(r.col + r.cols, this.cols, from.cols);
    for (let y = Math.max(0, r.row); y < r.row + r.rows && y < this.rows && y < from.rows; y++) {
      const src = from.cells[y]!, line = this.cells[y]!;
      for (let x = x0; x < x1; x++) {
        const c = src[x]!;
        const cut = (x === x0 && c.ch === "") || (x === x1 - 1 && src[x + 1]?.ch === "");
        this.put(line, x, cut ? { ch: " ", sgr: c.sgr } : { ...c });
      }
    }
  }

  /** Blank a rectangle (used under floating overlays). */
  clear(r: Rect, sgr = ""): void {
    for (let y = r.row; y < r.row + r.rows; y++) {
      const line = this.cells[y];
      if (!line) continue;
      for (let x = Math.max(0, r.col); x < r.col + r.cols && x < this.cols; x++) this.put(line, x, { ch: " ", sgr });
    }
  }

  /**
   * Dim a rectangle: each cell's truecolor foreground scaled by `by` (0..1), and a plain cell given the
   * theme's body text (the terminal's default, classic's VGA grey) scaled the same. Backgrounds stay, so a selection or a ruler still shows under it.
   */
  dim(r: Rect, by = 0.5): void {
    const scale = (m: string) => m.replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, (_, a, b, c) => `\x1b[38;2;${[a, b, c].map(v => Math.round(Number(v) * by)).join(";")}m`);
    const plain = `\x1b[38;2;${(theme().text.body ?? [170, 170, 170]).map(v => Math.round(v * by)).join(";")}m`;
    for (let y = r.row; y < r.row + r.rows; y++) {
      const line = this.cells[y];
      if (!line) continue;
      for (let x = Math.max(0, r.col); x < r.col + r.cols && x < this.cols; x++) {
        const c = line[x]!;
        c.sgr = /\x1b\[38;2;/.test(c.sgr) ? scale(c.sgr) : c.sgr + plain;
      }
    }
  }

  /**
   * A surface under a rectangle (PIE-675, a tile's `bg`): every cell in it without a background of its own gets `sgr`'s
   * (a selection, a ruler, a chip keep theirs), except where `skip` says (a picture drawn under the text: Kitty shows
   * it only through cells on the default background, so a surface yields there).
   */
  under(r: Rect, sgr: string, skip?: (x: number, y: number) => boolean): void {
    if (!sgr) return;
    // Thousands of cells share a handful of styles; parse each once for this fill.
    const styles = new Map<string, string>();
    for (let y = Math.max(0, r.row); y < r.row + r.rows && y < this.rows; y++) {
      const line = this.cells[y]!;
      for (let x = Math.max(0, r.col); x < r.col + r.cols && x < this.cols; x++) {
        const c = line[x]!;
        if (skip?.(x, y)) continue;
        let filled = styles.get(c.sgr);
        if (filled === undefined) {
          filled = hasBackground(c.sgr) ? c.sgr : withSgr(c.sgr, sgr);
          styles.set(c.sgr, filled);
        }
        c.sgr = filled;
      }
    }
  }

  /** A modal backdrop darkens both ink and fill; it never adds light to a cell. */
  backdrop(values?: StyleValues): void {
    const t = theme(), dim = floatTheme(values).dim, scale = (rgb: readonly number[]) => rgb.map(v => Math.round(v * dim)).join(";");
    // Keep this operation's dimming local: another backdrop may use a different theme or depth.
    const styles = new Map<string, string>();
    for (const row of this.cells) for (const cell of row) {
      let dimmed = styles.get(cell.sgr);
      if (dimmed === undefined) {
        dimmed = cell.sgr.replace(/\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/g, (_, kind, r, g, b) => `\x1b[${kind};2;${scale([+r, +g, +b])}m`);
        if (!/\x1b\[38;2;/.test(dimmed)) dimmed += `\x1b[38;2;${scale(t.text.body ?? t.palette[7]!)}m`;
        if (!hasBackground(dimmed)) dimmed += `\x1b[48;2;${scale(t.ground ?? t.palette[0]!)}m`;
        styles.set(cell.sgr, dimmed);
      }
      cell.sgr = dimmed;
    }
  }

  /** Floats share their depth, including the blank cells left after a row's reset. */
  float(r: Rect, title: string, foot: string, draw: () => void, takesKeys = false, values?: StyleValues, glyphs = LINE_BOX): void {
    if (takesKeys) this.backdrop(values);
    const t = floatTheme(values);
    this.clear(r);
    this.box(r, fgRgb(t.border), fgRgb(t.border) + title, foot, glyphs);
    draw();
    this.under(r, bgRgb(t.bg));
  }

  shadow(r: Rect, values?: StyleValues): void {
    const ink = fgRgb(floatTheme(values).shadow);
    this.text(r.col + 1, r.row + r.rows, ink + "▒".repeat(r.cols) + RESET, r.cols);
    for (let y = r.row + 1; y < r.row + r.rows; y++) this.text(r.col + r.cols, y, ink + "▒" + RESET, 1);
  }

  /** A box with a title in the top edge and an optional hint in the bottom edge: single lines, or `g`'s glyphs. */
  box(r: Rect, sgr: string, title = "", hint = "", g: BoxGlyphs = LINE_BOX): void {
    if (r.cols < 2 || r.rows < 2) return;
    const right = r.col + r.cols - 1, bottom = r.row + r.rows - 1;
    const put = (x: number, y: number, ch: string, style = sgr) => { const l = this.cells[y]; if (l && x >= 0 && x < this.cols) this.put(l, x, { ch, sgr: style }); };
    for (let x = r.col + 1; x < right; x++) { put(x, r.row, g.top); put(x, bottom, g.bottom); }
    for (let y = r.row + 1; y < bottom; y++) { put(r.col, y, g.side); put(right, y, g.side); }
    put(r.col, r.row, g.tl); put(right, r.row, g.tr); put(r.col, bottom, g.bl); put(right, bottom, g.br);
    if (title) this.text(r.col + 2, r.row, rowLines(` ${title} `, r.cols - 4, 1)[0]!, r.cols - 4);
    // A hint too long for the edge is cut between its parts (or at a space), ending " …", never mid-word.
    if (hint) this.text(r.col + 2, bottom, ` ${fitHint(hint, r.cols - 6).text} `, r.cols - 4);
  }

  /** A scroll thumb on the right border of box `r`: its length is the share in view, its place how far down. */
  thumb(r: Rect, s: Scroll, sgr: string): void {
    const track = r.rows - 2;
    if (track < 1 || !overflows(s)) return;
    const size = Math.max(1, Math.min(track, Math.round((track * s.room) / s.total)));
    const pos = Math.round((track - size) * Math.min(1, Math.max(0, s.top / (s.total - s.room))));
    for (let i = 0; i < size; i++) this.text(r.col + r.cols - 1, r.row + 1 + pos + i, sgr + "█" + RESET, 1);
  }

  /** The cells as written, row by row: each a glyph (`""` for a wide glyph's spacer) and the SGR it's drawn in. */
  grid(): readonly (readonly Readonly<Cell>[])[] { return this.cells; }

  lines(): string[] {
    return this.cells.map(line => {
      let out = "", last = "", link: string | undefined, full: string | undefined;
      for (const c of line) {
        if (c.full !== full) { out += (full ? FULL_END : "") + (c.full ?? ""); full = c.full; }
        if (c.link !== link) { out += c.link || OSC8_CLOSE; link = c.link; }
        if (c.sgr !== last) { out += RESET + c.sgr; last = c.sgr; }
        out += c.ch;
      }
      return out + (full ? FULL_END : "") + (link ? OSC8_CLOSE : "") + RESET;
    });
  }
}
