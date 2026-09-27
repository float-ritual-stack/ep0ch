// One helper that turns a cell grid into either coloured cells or a Kitty placement.
import type { Cell } from "./ansi";
import type { Placement } from "./kitty";
import { artLines } from "./style";
import type { TermInfo } from "./term";
import { GLYPH_H, GLYPH_W, rasterize, type Rgba } from "./vga";

export interface ArtBlock { lines: string[]; placements: Placement[]; rowsUsed: number }

export interface ArtViewOpts {
  key: string;
  at: { col: number; row: number };
  maxRows: number;
  scroll?: number;
  /** Only the first N art rows exist yet (modem-speed reveal). */
  reveal?: number;
  /** "grid": one art cell per terminal cell, so text can sit on exact art cells.
   *  "true": keep VGA 9×16 proportions (fewer terminal rows on most fonts). */
  fit: "grid" | "true";
  graphics: boolean;
}

export function artBlock(grid: Cell[][], artWidth: number, t: TermInfo, o: ArtViewOpts): ArtBlock {
  const cols = Math.min(artWidth, t.cols - o.at.col);
  const top = o.scroll ?? 0;
  const available = Math.max(0, grid.length - top);
  if (!o.graphics) {
    const rows = Math.min(available, o.maxRows);
    return { lines: artLines(grid, 0, top, cols, rows), placements: [], rowsUsed: rows };
  }
  // In "true" fit, one terminal row shows more than one art row.
  const artRowsPerTermRow = o.fit === "true" ? (GLYPH_W * t.cellH) / (GLYPH_H * t.cellW) : 1;
  const shown = Math.max(0, Math.min(available, o.reveal === undefined ? available : o.reveal - top));
  const artRows = Math.min(shown, Math.floor(o.maxRows * artRowsPerTermRow));
  if (artRows <= 0) return { lines: [], placements: [], rowsUsed: 0 };
  const termRows = Math.max(1, Math.round(artRows / artRowsPerTermRow));
  // Rasterize the whole piece once; scrolling and revealing only move the source rectangle.
  const full = whole(grid, cols);
  if (full) {
    return {
      lines: Array.from({ length: termRows }, () => ""),
      placements: [{ key: o.key, image: full, col: o.at.col, row: o.at.row, cols, rows: termRows, z: -1,
        crop: { x: 0, y: top * GLYPH_H, w: cols * GLYPH_W, h: artRows * GLYPH_H } }],
      rowsUsed: termRows,
    };
  }
  const image = rasterize(grid, 0, top, cols, artRows);
  return {
    lines: Array.from({ length: termRows }, () => ""),
    placements: [{ key: o.key, image, col: o.at.col, row: o.at.row, cols, rows: termRows, z: -1 }],
    rowsUsed: termRows,
  };
}

const WHOLE_MAX_ROWS = 400;
const wholeCache = new WeakMap<Cell[][], { cols: number; img: Rgba }>();
/** Whole-piece raster, cached per grid; null for very tall pieces (those raster per view). */
function whole(grid: Cell[][], cols: number): Rgba | null {
  if (grid.length > WHOLE_MAX_ROWS) return null;
  const hit = wholeCache.get(grid);
  if (hit?.cols === cols) return hit.img;
  const img = rasterize(grid, 0, 0, cols, grid.length);
  wholeCache.set(grid, { cols, img });
  return img;
}

/** Copy a grid so screens can write into it without touching the cached art. */
export const cloneGrid = (g: Cell[][]) => g.map(r => r.map(c => ({ ...c })));

/** Write ASCII text into grid cells with one colour; returns the cells it covered. */
export function stamp(g: Cell[][], row: number, col: number, text: string, fgc: number, bgc?: number): void {
  const line = g[row];
  if (!line) return;
  for (let i = 0; i < text.length && col + i < line.length; i++) {
    const cell = line[col + i]!;
    line[col + i] = { code: text.charCodeAt(i) & 0xff, fg: fgc, bg: bgc ?? cell.bg };
  }
}

/** Find every occurrence of `needle` in the grid's text, as {row, col}. */
export function locate(g: Cell[][], needle: string): { row: number; col: number }[] {
  const hits: { row: number; col: number }[] = [];
  g.forEach((line, row) => {
    const s = String.fromCharCode(...line.map(c => c.code));
    for (let at = s.indexOf(needle); at >= 0; at = s.indexOf(needle, at + 1)) hits.push({ row, col: at });
  });
  return hits;
}
