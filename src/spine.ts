// A spine: a pane squeezed to a title strip. River columns, board lanes and board readers draw theirs
// here. Under Kitty graphics the title is VGA text turned a quarter clockwise (read top to bottom);
// in cells it stacks one letter per row. Marks (a draft, new comments) sit one per row above it.
import { cp437Code } from "./ansi";
import type { Canvas, Rect } from "./canvas";
import type { Placement } from "./kitty";
import { C, fg, RESET } from "./style";
import { theme } from "./theme";
import { rasterize, rotateCW, type Rgba } from "./vga";

/** How wide a spine is, in cells: two for the title, one for its right border. */
export const SPINE = 3;

const cache = new Map<string, Rgba>();
/** The title as rotated VGA text in the theme's `colour`, transparent around the glyphs. */
export function spineImage(title: string, colour: number): Rgba {
  const t = theme(), key = `${t.name}:${colour}:${title}`;
  let img = cache.get(key);
  if (!img) {
    const row = [...title].map(ch => ({ code: cp437Code(ch), fg: colour, bg: 0 }));
    img = rotateCW(rasterize([row], 0, 0, row.length, 1, { clearBg: true, palette: t.palette }));
    cache.set(key, img);
  }
  return img;
}

export interface Spine {
  /** The placement's stable key (the river's `spine:<uid>`). */
  key: string;
  title: string;
  /** The title's palette colour (`C.*`). */
  colour: number;
  /** One cell each, drawn top down before the title (already coloured). */
  marks?: string[];
  /** How a stacked letter is drawn in cells (default: the title's colour), e.g. a selection highlight. */
  cellStyle?: string;
}

/**
 * Draw a spine into `r` (its right column is the border). Returns the rotated title's placement under
 * Kitty graphics, for the caller to place (and hide under whatever it draws on top), or null in cells.
 */
export function drawSpine(canvas: Canvas, r: Rect, s: Spine, v: { graphics: boolean; t: { cellW: number; cellH: number } }): Placement | null {
  for (let y = r.row; y < r.row + r.rows; y++) canvas.text(r.col + r.cols - 1, y, fg(C.blue) + "│" + RESET, 1);
  const marks = (s.marks ?? []).slice(0, Math.max(0, r.rows - 1));
  marks.forEach((m, i) => canvas.text(r.col, r.row + i, m, 1));
  const top = r.row + marks.length, room = r.rows - marks.length;
  if (room < 1) return null;
  if (v.graphics) {
    // Rotated VGA text: 16px wide per glyph row, 9px per character down the spine.
    const t = v.t;
    const maxChars = Math.max(1, Math.floor(((room - 1) * t.cellH * 16) / (2 * t.cellW * 9)));
    const text = s.title.length > maxChars ? s.title.slice(0, maxChars - 1) + "…" : s.title;
    const img = spineImage(text, s.colour);
    const rowsNeeded = Math.max(1, Math.ceil((img.height * (2 * t.cellW / img.width)) / t.cellH));
    return { key: s.key, image: img, col: r.col, row: top, cols: 2, rows: Math.min(rowsNeeded, room), z: -1 };
  }
  const style = s.cellStyle ?? fg(s.colour);
  [...s.title].slice(0, room).forEach((ch, i) => canvas.text(r.col, top + i, style + ch + RESET, 1));
  return null;
}
