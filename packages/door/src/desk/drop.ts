// Hit rectangles and drawn bands share one owner, so a visible zone is exactly where its drop lands.
import type { Rect } from "../canvas";
import { EDGE_GLYPH, type Dir, type Place, type Op } from "./screen-layout";

/** A tile as the drag sees it: where it is, and when it's a tab set, which cells each tab's label takes. */
export interface DropReceive { label: string; action: string; args?: Record<string, unknown> }
export interface DropTile<I> { id: I; rect: Rect; tabs?: { id: I; from: number; to: number }[]; alone?: boolean; receive?: DropReceive; floating?: boolean }

/** A drop: where the tile goes, the outline drawn while it's held there, what the ghost says, and why policy refuses it. */
export type DropPlace<I> = Place<I> | { kind: "swap"; target: I };
export type Drop<I> = DropPlace<I> & { ghost: Rect; label: string; refused?: string; handle?: true; receive?: DropReceive };
/** Why the view's policy refuses the dragged tile at a place, or null (PIE-505). */
export type Refuse<I> = (to: DropPlace<I>) => string | null;
/** With the reason policy gives, when it gives one. */
const judged = <I>(d: Drop<I> | null, refuse?: Refuse<I>): Drop<I> | null => { const why = d && !d.receive && refuse?.(d); return d && why ? { ...d, refused: why } : d; };

/** What a drop into a dock says while dragging: the tile docks to that edge of this screen, and stays here. */
export const DOCK_DROP = "docked here: stays on this screen";

/** The outer strips: two cells in from the left and right, the last row at the bottom. */
export const EDGE_COLS = 2;
/** The middle share of a tile, between the four split bands. */
export const CENTRE = 0.56;

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
    if (t.floating) return null;
    if (setOfOne) return null;
    // Over a tab's label: before it; past the last one: at the end.
    const labels = t.tabs ?? [];
    const at = labels.findIndex(l => x < l.to);
    const index = at < 0 ? labels.length || 1 : at;
    return { kind: "tabs", target: t.id, index, ghost: r, label: self ? "↔ reorder tab" : "▭ tabs" };
  }
  if (setOfOne) return null;
  const source = tiles.some(t => t.id === src || t.tabs?.some(t => t.id === src)) ? src : undefined;
  return zonesOf(t, source).find(z => inside(z.ghost, x, y)) ?? null;
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
  return judged({ kind: "tabs", target: h.shows, handle: true, ghost: { col: Math.max(area.col, Math.min(h.from, area.col + area.cols - cols)), row: Math.max(area.row, h.row - 3), cols, rows: 3 }, label }, refuse);
}

/** The existing move and swap operations own policy and the eventual release. */
export const dropOp = <I>(tile: I, to: DropPlace<I>): Op<I> => to.kind === "swap" ? { op: "swap", tile, with: to.target } : { op: "move", tile, to };

/** A float's grip still moves it freely over bodies; headers, edges and content receivers are landings. */
export const floatLanding = <I>(drop: Drop<I>, tiles: DropTile<I>[], y: number): boolean => !!drop.receive || drop.kind === "edge" || drop.kind === "tabs" && tiles.some(t => t.id === drop.target && t.rect.row === y);

/** With no source on this layout, an incoming tile joins tabs: it has no place here to trade. */
export function zonesOf<I>(tile: DropTile<I>, src?: I, refuse?: Refuse<I>): Drop<I>[] {
  const { id, rect: r } = tile;
  const self = id === src || !!tile.tabs?.some(t => t.id === src);
  if (id === src && (!tile.tabs || tile.tabs.length < 2)) return [];
  const body = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
  const side = Math.max(1, Math.floor(body.cols * (1 - CENTRE) / 2));
  const end = Math.max(1, Math.floor(body.rows * (1 - CENTRE) / 2));
  const middle = { ...body, row: body.row + end, rows: body.rows - 2 * end };
  const centre = { ...middle, col: body.col + side, cols: body.cols - 2 * side };
  const top = Math.ceil(centre.rows / 2);
  const receive: Drop<I>[] = tile.receive && !self ? [{ kind: "tabs", target: id, ghost: tile.floating ? body : centre, label: tile.receive.label, receive: tile.receive }] : [];
  if (tile.floating) return receive;
  const zones: Drop<I>[] = [
    { kind: "split", target: id, dir: "up", ghost: { ...body, rows: end }, label: "^ drop here to split above" },
    { kind: "split", target: id, dir: "left", ghost: { ...middle, cols: side }, label: "< split left" },
    ...receive.length ? receive : self ? [] : src === undefined ? [
      { kind: "tabs" as const, target: id, ghost: centre, label: "drop here: a tab" },
    ] : [
      { kind: "tabs" as const, target: id, ghost: { ...centre, rows: top }, label: "drop here: a tab" },
      { kind: "swap" as const, target: id, ghost: { ...centre, row: centre.row + top, rows: centre.rows - top }, label: "drop here: swap" },
    ],
    { kind: "split", target: id, dir: "right", ghost: { ...middle, col: body.col + body.cols - side, cols: side }, label: "split >" },
    { kind: "split", target: id, dir: "down", ghost: { ...body, row: body.row + body.rows - end, rows: end }, label: "v drop here to split below" },
  ];
  return zones.filter(z => z.ghost.cols > 0 && z.ghost.rows > 0).map(z => judged(z, refuse)!);
}

/** The same action arguments for a title drag and a float landing. */
export function dropArgs<I>(drop: Drop<I>, name: (id: I) => string): Record<string, unknown> {
  if (drop.kind === "swap") return { to: name(drop.target) };
  return drop.kind === "edge" ? { where: `edge-${drop.dir}` } : drop.kind === "tabs" ? { to: name(drop.target), where: "tabs", ...(drop.index !== undefined ? { index: drop.index } : {}) } : { to: name(drop.target), where: drop.dir };
}
