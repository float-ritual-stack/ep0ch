// The board's tiles by the place names its tests use (PIE-511: the board is a preset on the desk's engine, so its
// areas are tiles): "lanes" (the lane the cursor is in), "preview", "detail<i>" and "float<i>" by place (from 0),
// "tree" and "backlinks" (the drawers' lists), "tree-preview" and "links-preview" (their previews), or any tile's
// name. Tests only: an agent names tiles by name (detail1, float1 are detail tiles' names, not places).
import type { Rect } from "../src/canvas";

type Board = any;
const tileOf = (b: Board, place: string): number | undefined => {
  if (place === "lanes") return b.laneIds()[b.lane];
  if (place === "links-preview") return b.idNamed("backlinks-preview");
  const li = b.lanes.findIndex((l: any) => l.name === place);
  if (li >= 0) return b.laneIds()[li];
  const d = /^detail(\d+)$/.exec(place);
  if (d) return b.detailTiles()[Number(d[1])]?.id;
  const f = /^float(\d+)$/.exec(place);
  if (f) return b.floats[Number(f[1])]?.id;
  return b.idNamed(place);
};

/** The place that has the keys. */
export function where(b: Board): string {
  if (b.onLanes) return "lanes";
  const id = b.focus;
  const di = b.detailTiles().findIndex((x: any) => x.id === id);
  if (di >= 0) return `detail${di}`;
  const fi = b.floats.findIndex((x: any) => x.id === id);
  if (fi >= 0) return `float${fi}`;
  const n = b.nameOf(id);
  return n === "backlinks-preview" ? "links-preview" : n;
}

/** Give the keys to a place (as a test sets the scene; the person's way is Tab, a click or `focus`). */
export function at(b: Board, place: string) {
  const id = tileOf(b, place);
  if (id === undefined) throw new Error(`no ${place} on the board`);
  b.focus = id;
  if (b.isLane(id)) b.laneAt = id;
  const di = b.detailTiles().findIndex((x: any) => x.id === id);
  if (di >= 0) b.active = di;
}

/** Where a place was drawn: its tile's frame (the columns' for "lanes:all"), as the board last placed it. */
export function rectOf(b: Board, place: string): Rect {
  if (place === "lanes:all") return b.placed.nodes.get("lanes");
  const id = tileOf(b, place);
  return (id === undefined ? undefined : b.hits.find(([x]: [number, Rect]) => x === id)?.[1]) as Rect;
}
