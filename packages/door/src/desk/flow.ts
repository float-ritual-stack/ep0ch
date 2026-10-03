// The flow container (PIE-513): the river's columns as a container type of the screen-layout module. Columns sit
// side by side and compress full → peek → spine as they recede from the wide column (the anchor). Opening from a
// column puts the new one right after it ("opens into the next column", the flow's open rule). A peek is drawn at
// reading width and covered by its right-hand neighbour like a drawer; only the far ones become spines.
//
// Focus and the layout are two things: moving the person's keys between columns never moves a column. The anchor
// moves only on an explicit shift (widen), an open that would not otherwise show the new column full, or a key move
// to a column the strip doesn't show at all. Ported from the River screen's own model (its held columns, from and
// ahead, squeeze, place, widen, close, back and forward), so the river became a screen on the one engine (PIE-515:
// `src/river/column.ts`, a flow of river columns).
//
// Internal to the module: `screen-layout.ts` is its interface. Columns are named by a tile in them (tile ids are
// never reused), so the bookkeeping survives every tree change that keeps the tile.
import type { Rect } from "../canvas";
import { SPINE } from "../spine";
import { leaves, type Flow, type LNode, type Placed, type PlaceOpts } from "./layout";

export type Cover = "full" | "peek" | "spine";
/** A peek's width before the leftover room is shared out. */
export const PEEK = 24;
/** A full column's width in a flow `w` cells wide: about four tenths of it, between 40 and 76. */
export const fullWidth = (w: number) => Math.max(40, Math.min(76, Math.round(w * 0.42)));

/** The column (kid index) of the flow holding tile `id`, or -1. */
export const columnOf = <I>(f: Flow<I>, id: I | undefined): number => (id === undefined ? -1 : f.kids.findIndex(k => leaves(k).includes(id)));
/** A tile naming column `i` (its first). */
export const tileOfColumn = <I>(f: Flow<I>, i: number): I | undefined => (f.kids[i] ? leaves(f.kids[i]!)[0] : undefined);

/** One column as placed: its cover, what shows of it, and where it's drawn (a peek's box runs on under its neighbour). */
export interface PlacedColumn { i: number; cover: Cover; rect: Rect; box: Rect }

/**
 * Where each column of the flow goes in `width` cells, built around the anchor (never around focus). The anchor
 * first, then the column the person was reading (`keep`), then held columns and those holding work, then by
 * distance; with too many even as spines, the ones nearest the anchor. Leftover room shows more of the peeks first,
 * then goes to the anchor, so the strip fills its room. River.layout(), as a pure function of the flow.
 */
export function squeeze<I>(f: Flow<I>, width: number, holds?: (id: I) => boolean): { i: number; cover: Cover; width: number; natural: number }[] {
  const n = f.kids.length;
  if (!n) return [];
  const FULL = fullWidth(width);
  const anchor = Math.max(0, columnOf(f, f.anchor));
  const keepAt = columnOf(f, f.keep);
  const keep = keepAt === anchor ? -1 : keepAt;
  const held = new Set((f.held ?? []).map(id => columnOf(f, id)).filter(i => i >= 0));
  const busy = (i: number) => !!holds && leaves(f.kids[i]!).some(id => holds(id));
  const shown = [...f.kids.keys()].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || b - a)
    .slice(0, Math.max(1, Math.floor(width / SPINE))).sort((a, b) => a - b);
  const cover = new Map<number, Cover>(shown.map(i => [i, "spine"]));
  let spare = width - shown.length * SPINE;
  const rank = (i: number) => (i === anchor ? -1 : i === keep ? 0.25 : held.has(i) || busy(i) ? 0.5 : Math.abs(i - anchor));
  for (const i of [...shown].sort((a, b) => rank(a) - rank(b) || b - a)) {
    if (spare >= FULL - SPINE) { cover.set(i, "full"); spare -= FULL - SPINE; }
    else if (spare >= PEEK - SPINE) { cover.set(i, "peek"); spare -= PEEK - SPINE; }
  }
  const w = new Map<number, number>(shown.map(i => [i, cover.get(i) === "full" ? FULL : cover.get(i) === "peek" ? PEEK : SPINE]));
  const peeks = shown.filter(i => cover.get(i) === "peek");
  for (let left = peeks.length; left > 0 && spare > 0; left--) {
    const i = peeks[peeks.length - left]!, add = Math.min(FULL - PEEK, Math.floor(spare / left));
    w.set(i, w.get(i)! + add); spare -= add;
  }
  if (shown.includes(anchor)) w.set(anchor, w.get(anchor)! + Math.max(0, spare));
  // Narrower than one spine per column shown (a tiny terminal): the anchor gives way, so nothing lands off the room.
  const over = [...w.values()].reduce((a, x) => a + x, 0) - width;
  if (over > 0 && shown.includes(anchor)) w.set(anchor, Math.max(1, w.get(anchor)! - over));
  return shown.map(i => ({ i, cover: cover.get(i)!, width: w.get(i)!, natural: cover.get(i) === "peek" ? Math.max(w.get(i)!, FULL) : w.get(i)! }));
}

/**
 * Place a flow in `r`: each column shown gets its rect (what shows) and its box (where it's drawn). A full column's
 * tiles are placed in it; a peek's in its box, each rect cut to what shows; a spine's in its strip. A column off
 * the strip places nothing (like a shut drawer). `place` is the tree's own placer, for what a column holds.
 */
export function placeFlow<I>(f: Flow<I>, r: Rect, opts: PlaceOpts<I>, out: Placed<I>, place: (n: LNode<I>, r: Rect, o: PlaceOpts<I>, out: Placed<I>) => Placed<I>): Placed<I> {
  if (f.key) out.nodes.set(f.key, r);
  const cols: PlacedColumn[] = [];
  let x = r.col;
  for (const c of squeeze(f, r.cols, opts.holds)) {
    const rect: Rect = { ...r, col: x, cols: c.width }, box: Rect = { ...rect, cols: c.natural };
    const inner = place(f.kids[c.i]!, box, opts, { rects: new Map(), nodes: new Map(), dividers: [] });
    for (const [id, t] of inner.rects) {
      const cut = Math.max(0, Math.min(t.col + t.cols, rect.col + rect.cols) - t.col);
      out.rects.set(id, c.cover === "peek" ? { ...t, cols: cut } : t);
      (out.covers ??= new Map()).set(id, c.cover);
      if (c.cover === "peek") (out.boxes ??= new Map()).set(id, t);
    }
    for (const [k, v] of inner.nodes) out.nodes.set(k, v);
    if (inner.tabsets) (out.tabsets ??= []).push(...inner.tabsets);
    if (inner.drawers) (out.drawers ??= []).push(...inner.drawers);
    // A full column's own borders (tiles stacked in it) drag; a covered one's are under its neighbour.
    if (c.cover === "full") out.dividers.push(...inner.dividers);
    cols.push({ i: c.i, cover: c.cover, rect, box });
    x += c.width;
  }
  (out.flows ??= []).push({ node: f, rect: r, cols });
  return out;
}

// ── the flow's bookkeeping: what the river's columns remember ────────────────

/** The trail entry of column `i` (where it was opened from, where back last left it), made when missing. */
function trailOf<I>(f: Flow<I>, i: number): { tile: I; from?: I; ahead?: I } | undefined {
  const ids = f.kids[i] ? leaves(f.kids[i]!) : [];
  return (f.trail ?? []).find(t => ids.includes(t.tile));
}
/** Column `i` was opened from the column holding `from`: back from it goes there. */
export function setFrom<I>(f: Flow<I>, i: number, from: I | undefined) {
  const tile = tileOfColumn(f, i);
  if (tile === undefined) return;
  const t = trailOf(f, i);
  if (t) { if (from === undefined) delete t.from; else t.from = from; }
  else if (from !== undefined) (f.trail ??= []).push({ tile, from });
}
/** The column back (-1) or forward (1) goes to from column `i`, or -1. */
export function travelTarget<I>(f: Flow<I>, i: number, dir: -1 | 1): number {
  const t = trailOf(f, i);
  const to = dir < 0 ? t?.from : t?.ahead;
  return to === undefined ? -1 : columnOf(f, to);
}
/** Back from column `i` to column `to`: forward from there returns to `i`. */
export function setAhead<I>(f: Flow<I>, to: number, from: number) {
  const tile = tileOfColumn(f, to), back = tileOfColumn(f, from);
  if (tile === undefined || back === undefined) return;
  const t = trailOf(f, to);
  if (t) t.ahead = back; else (f.trail ??= []).push({ tile, ahead: back });
}
/** Hold column `i` or let it go (held, it resists compression). Holding lets go of the column kept full: the hold is the newer choice. */
export function setHeld<I>(f: Flow<I>, i: number, on: boolean) {
  const ids = f.kids[i] ? leaves(f.kids[i]!) : [];
  f.held = (f.held ?? []).filter(id => !ids.includes(id));
  if (on && ids.length) { f.held.push(ids[0]!); delete f.keep; }
  if (!f.held.length) delete f.held;
}

/**
 * The explicit shift: column `ci` takes the wide place. The column the person was reading (`read`, else the old
 * wide one) stays full after it. Already the wide one: nothing moves. River.widen().
 */
export function widen<I>(f: Flow<I>, ci: number) {
  const anchor = Math.max(0, columnOf(f, f.anchor));
  if (!f.kids[ci] || ci === anchor) return;
  const readAt = columnOf(f, f.read);
  const read = readAt >= 0 && readAt !== ci ? readAt : anchor;
  if (read !== ci) f.keep = tileOfColumn(f, read);
  f.anchor = tileOfColumn(f, ci);
  if (columnOf(f, f.keep) === ci) delete f.keep;
}

/**
 * The person opened (or reached) column `ci` from column `from`: the layout moves only if it must. When the new
 * column already shows full and `from` stays full, nothing shifts; otherwise it takes the wide place and `from`
 * stays full beside it. `covers`: each column's cover now. River.place().
 */
export function arrive<I>(f: Flow<I>, ci: number, from: number, covers: Map<number, Cover>) {
  const full = (i: number) => covers.get(i) === "full";
  if (full(ci) && (from < 0 || full(from))) return;
  f.anchor = tileOfColumn(f, ci);
  if (from >= 0 && from !== ci) f.keep = tileOfColumn(f, from); else delete f.keep;
}

/**
 * Before column `ci` is taken out: the wide place passes to the column that slides into the gap from the left (the
 * right one, for the first); a full column's kept place goes to the one sliding in from the right, unless the
 * column the person was reading still holds a place of its own. River.close().
 */
export function leaving<I>(f: Flow<I>, ci: number, covers: Map<number, Cover>) {
  const gone = tileOfColumn(f, ci);
  if (gone === undefined || f.kids.length < 2) return;
  const anchor = Math.max(0, columnOf(f, f.anchor)), keep = columnOf(f, f.keep);
  const wasFull = covers.get(ci) === "full";
  if (ci === anchor) f.anchor = tileOfColumn(f, ci > 0 ? ci - 1 : ci + 1);
  const newAnchor = columnOf(f, f.anchor);
  const kept = keep >= 0 && keep !== ci && keep !== newAnchor;
  if ((wasFull || keep === ci) && !kept) {
    const next = [ci + 1, ci - 1].find(j => j >= 0 && j < f.kids.length && j !== newAnchor && j !== ci);
    if (next !== undefined) f.keep = tileOfColumn(f, next); else delete f.keep;
  }
  if (columnOf(f, f.keep) === ci) delete f.keep;
}

/**
 * The flow's memory kept to tiles still in it: a gone tile's pin, trail and places are dropped. It always has a wide
 * column while it has any (the first, when none was said), so a widen of the one shown wide is never a shift.
 */
export function tidyFlow<I>(f: Flow<I>): Flow<I> {
  const here = new Set(f.kids.flatMap(k => leaves(k)));
  const out: Flow<I> = { ...f };
  for (const k of ["anchor", "keep", "read"] as const) if (out[k] !== undefined && !here.has(out[k]!)) delete out[k];
  if (out.anchor === undefined && out.kids.length) out.anchor = tileOfColumn(out, 0);
  if (out.held) { out.held = out.held.filter(id => here.has(id)); if (!out.held.length) delete out.held; }
  if (out.trail) {
    out.trail = out.trail.filter(t => here.has(t.tile)).map(t => ({ tile: t.tile, ...(t.from !== undefined && here.has(t.from) ? { from: t.from } : {}), ...(t.ahead !== undefined && here.has(t.ahead) ? { ahead: t.ahead } : {}) })).filter(t => t.from !== undefined || t.ahead !== undefined);
    if (!out.trail.length) delete out.trail;
  }
  return out;
}
