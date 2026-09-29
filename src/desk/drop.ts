// Where a dragged tile lands (PIE-413): Replit's split hit model in terminal cells, with floatty's outer
// edges. Over a tile, its header (the frame's top row) or its centre makes a tab set; the four triangles
// between its diagonals split it in that direction. A strip along the layout's outer left, right and
// bottom edge puts the tile beside everything, as a full-height column or a full-width row. The outer
// strips are checked first, as floatty prepends its outer zones, so they win where they overlap a tile.
//
// Zones are worked out from the rectangles just placed, on every pointer event, never kept from the start
// of the drag: floatty's ghost divider (a resize handle left where a split used to be after a drop) came
// from geometry measured once. Pure; the desk draws the ghost and applies the drop.
import type { Rect } from "../canvas";
import type { Dir, Place } from "./layout";

/** A tile as the drag sees it: where it is, and when it's a tab set, which cells each tab's label takes. */
export interface DropTile<I> { id: I; rect: Rect; tabs?: { id: I; from: number; to: number }[]; alone?: boolean }

/** A drop: where the tile goes, the outline drawn while it's held there, and what the ghost says. */
export type Drop<I> = Place<I> & { ghost: Rect; label: string };

/** The outer strips: two cells in from the left and right, the last row at the bottom. */
export const EDGE_COLS = 2;
/** The centre of a tile that makes tabs, as a share of its width and height from the middle (each way). */
export const CENTRE = 0.28;

const inside = (r: Rect, x: number, y: number) => x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows;

/**
 * The drop under (x, y) while `src` is dragged, or null (nowhere, or onto itself where that means nothing).
 * `area` is the whole layout. `many`: there's more than one tile, so an outer edge means something.
 */
export function dropAt<I>(tiles: DropTile<I>[], area: Rect, x: number, y: number, src: I, many = tiles.length > 1): Drop<I> | null {
  if (!inside(area, x, y)) return null;
  const w = Math.max(3, Math.round(area.cols * 0.3)), h = Math.max(3, Math.round(area.rows * 0.3));
  if (many) {
    if (x < area.col + EDGE_COLS) return { kind: "edge", dir: "left", ghost: { ...area, cols: w }, label: "⇐ full-height column" };
    if (x >= area.col + area.cols - EDGE_COLS) return { kind: "edge", dir: "right", ghost: { ...area, col: area.col + area.cols - w, cols: w }, label: "⇒ full-height column" };
    if (y === area.row + area.rows - 1) return { kind: "edge", dir: "down", ghost: { ...area, row: area.row + area.rows - h, rows: h }, label: "⇓ full-width row" };
  }
  const t = tiles.find(t => inside(t.rect, x, y));
  if (!t) return null;
  const r = t.rect;
  // Onto itself: only a tab leaving its own tab set means something (it lands beside the tabs left).
  const self = t.id === src || !!t.tabs?.some(x => x.id === src);
  const setOfOne = t.id === src && (!t.tabs || t.tabs.length < 2);
  if (y === r.row) {
    if (setOfOne) return null;
    // Over a tab's label: before it; past the last one: at the end.
    const labels = t.tabs ?? [];
    const at = labels.findIndex(l => x < l.to);
    const index = at < 0 ? labels.length || 1 : at;
    return { kind: "tabs", target: t.id, index, ghost: r, label: self ? "↔ reorder tab" : "▭ tabs" };
  }
  if (setOfOne) return null;
  const dx = (x + 0.5 - (r.col + r.cols / 2)) / (r.cols / 2), dy = (y + 0.5 - (r.row + r.rows / 2)) / (r.rows / 2);
  if (!self && Math.abs(dx) <= CENTRE && Math.abs(dy) <= CENTRE) return { kind: "tabs", target: t.id, ghost: r, label: "▭ tabs" };
  // Self (a tab set's own tab): the centre means nothing, so the triangles fill the tile.
  if (self && Math.abs(dx) <= CENTRE && Math.abs(dy) <= CENTRE) return null;
  const dir: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
  return { kind: "split", target: t.id, dir, ghost: half(r, dir), label: ARROW[dir] };
}

const ARROW: Record<Dir, string> = { left: "← split left", right: "→ split right", up: "↑ split above", down: "↓ split below" };

/** The half of `r` a split in `dir` would give the dropped tile. */
export function half(r: Rect, dir: Dir): Rect {
  const cw = Math.max(1, Math.floor(r.cols / 2)), rh = Math.max(1, Math.floor(r.rows / 2));
  if (dir === "left") return { ...r, cols: cw };
  if (dir === "right") return { ...r, col: r.col + r.cols - cw, cols: cw };
  if (dir === "up") return { ...r, rows: rh };
  return { ...r, row: r.row + r.rows - rh, rows: rh };
}
