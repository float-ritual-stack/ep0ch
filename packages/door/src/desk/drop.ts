// Where a dragged tile lands (PIE-413): Replit's split hit model in terminal cells, with floatty's outer
// edges. Over a tile, its header (the frame's top row) or its centre makes a tab set; the four triangles
// between its diagonals split it in that direction. A strip along the layout's outer left, right and
// bottom edge puts the tile beside everything, as a full-height column or a full-width row. The outer
// strips are checked first, as floatty prepends its outer zones, so they win where they overlap a tile.
//
// Zones are worked out from the rectangles just placed, on every pointer event, never kept from the start
// of the drag: floatty's ghost divider (a resize handle left where a split used to be after a drop) came
// from geometry measured once. Pure; the desk draws the ghost and applies the drop.
//
// A drop also answers to policy (PIE-505): the view says why a place won't take the tile (`refuse`: a locked
// screen, a container that takes no drops or only other kinds), and the drop carries that reason, so the
// ghost and the hint row say it before the release, and the release's `layout.move` refuses with the same words.
// A shut dock's handle on the hint row is a drop zone too: the tile goes into the dock.
import type { Rect } from "../canvas";
import { EDGE_GLYPH, type Dir, type Place } from "./screen-layout";

/** A tile as the drag sees it: where it is, and when it's a tab set, which cells each tab's label takes. */
export interface DropTile<I> { id: I; rect: Rect; tabs?: { id: I; from: number; to: number }[]; alone?: boolean }

/** A drop: where the tile goes, the outline drawn while it's held there, what the ghost says, and why policy refuses it. */
export type Drop<I> = Place<I> & { ghost: Rect; label: string; refused?: string };
/** Why the view's policy refuses the dragged tile at a place, or null (PIE-505). */
export type Refuse<I> = (to: Place<I>) => string | null;
/** With the reason policy gives, when it gives one. */
const judged = <I>(d: Drop<I> | null, refuse?: Refuse<I>): Drop<I> | null => { const why = d && refuse?.(d); return d && why ? { ...d, refused: why } : d; };

/** What a drop into a dock says while dragging: the tile docks to that edge of this screen, and stays here. */
export const DOCK_DROP = "docked here: stays on this screen";

/** The outer strips: two cells in from the left and right, the last row at the bottom. */
export const EDGE_COLS = 2;
/** The centre of a tile that makes tabs, as a share of its width and height from the middle (each way). */
export const CENTRE = 0.28;

const inside = (r: Rect, x: number, y: number) => x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows;

/**
 * The drop under (x, y) while `src` is dragged, or null (nowhere, or onto itself where that means nothing).
 * `area` is the whole layout. `many`: there's more than one tile, so an outer edge means something.
 */
export function dropAt<I>(tiles: DropTile<I>[], area: Rect, x: number, y: number, src: I, many = tiles.length > 1, refuse?: Refuse<I>): Drop<I> | null {
  return judged(zoneAt(tiles, area, x, y, src, many), refuse);
}
function zoneAt<I>(tiles: DropTile<I>[], area: Rect, x: number, y: number, src: I, many: boolean): Drop<I> | null {
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

/** A shut dock's handle on the hint row (`row`), and the tile it shows: what a tile dropped on it joins as a tab. */
export interface DockHandle<I> { from: number; to: number; row: number; shows: I; edge: Dir }

/**
 * A drop on a shut dock's handle: the tile goes into that dock, into the tabs of what it shows
 * (`layout.move where=tabs`). The ghost is drawn over the handle, within `area`, wide enough for its words.
 */
export function handleDrop<I>(handles: DockHandle<I>[], area: Rect, x: number, y: number, src: I, refuse?: Refuse<I>): Drop<I> | null {
  const h = handles.find(h => y === h.row && x >= h.from && x < h.to);
  if (!h || h.shows === src) return null;
  const label = `${EDGE_GLYPH[h.edge]} ${DOCK_DROP}`;
  const cols = Math.min(area.cols, Math.max(h.to - h.from, label.length + 6));
  return judged({ kind: "tabs", target: h.shows, ghost: { col: Math.max(area.col, Math.min(h.from, area.col + area.cols - cols)), row: Math.max(area.row, h.row - 3), cols, rows: 3 }, label }, refuse);
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
