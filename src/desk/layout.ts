// The layout tree (PIE-412): tiles in containers, shared by the desk and the board. A split lays its kids
// side by side (row) or one over another (col), each by its weight. A tab set (PIE-413) stacks tiles in one
// place, one of them shown. A drawer (PIE-505) holds any tiles and slides out over the others from an edge:
// it's placed as if it were docked, and nothing else moves for it; shut, it takes no room. Every container
// carries a policy (what it allows: drags, drops, which kinds, resizing, locked), saved with the screen.
// Pure functions; the view owns its tree. Around the tree a screen has floats, tiles with their own
// rectangle above everything (the board's), and the board's own drawers by tile id (`ScreenLayout.over`).
//
// The tile operations (move beside, into tabs, to an outer edge, normalise) are floatty's binary-tree
// model (`moveLeafToTarget`, `moveLeafToRoot`, `removeNode`'s collapse, `clampRatio`) ported to n-ary
// splits by weight: a move beside a tile inside a split along the same axis joins that split instead of
// nesting a new pair.
import type { Rect } from "../canvas";

export type Dir = "left" | "right" | "up" | "down";
/** row: kids side by side; col: one over another. */
export type Axis = "row" | "col";
/**
 * What a container allows (PIE-505), saved with the screen. Left out, a field is what the container around it
 * says (the screen's policy is the outermost); `locked` anywhere above locks everything under it.
 */
export interface Policy {
  /** Its tiles can be dragged out (layout.move, layout.swap). */
  draggable?: boolean;
  /** It takes tiles moved or opened into it. */
  droppable?: boolean;
  /** The tile kinds it takes (any when left out): a locked board's columns take only query tiles. */
  accepts?: string[];
  /** Its borders move (a drag, layout.resize, pane.resize, layout.even). */
  resizable?: boolean;
  /** Its size along its parent's axis, in cells: at least `min`, at most `max`, or exactly `fixed`. */
  min?: number; max?: number; fixed?: number;
  /** A drawer can slide shut (to its handle on the hint row). */
  collapsible?: boolean;
  /** A drawer slides over the others (true, the default) or takes its room while open (false). */
  overlay?: boolean;
  /** Task mode: the shape is fixed, the contents stay live. Unlocking is one key (alt+k), a click or `layout.lock`. */
  locked?: boolean;
  /** Where opens from its tiles land when a tile has no link of its own: a tile's name. */
  opensInto?: string;
}
export const POLICY_KEYS = ["draggable", "droppable", "accepts", "resizable", "min", "max", "fixed", "collapsible", "overlay", "locked", "opensInto"] as const;

export type Split<I = number> = {
  t: "split"; dir: Axis; kids: LNode<I>[]; weights: number[]; policy?: Policy;
  /** A name the view finds it by ("readers"); a named split stays when one kid is left. */
  key?: string;
  /**
   * Its stable id (PIE-491), given by the view that owns the tree (the desk's `s<n>`): it stays with the split
   * through every change that keeps the split, where its path doesn't. It changes nothing about the layout.
   */
  id?: string;
};
/** Tiles stacked in one place (PIE-413): `active` is the one shown; the others keep their state. `id` as a split's. */
export type Tabs<I = number> = { t: "tabs"; ids: I[]; active: number; id?: string; policy?: Policy };
/**
 * A drawer (PIE-505): a container holding any tiles (a tile, a tab set, a split of them) that slides out from
 * its `edge` over the others, or shuts to a handle. It sits in its parent split where it docks (its weight is
 * its size when open); `overlay: false` in its policy makes it take that room while open instead.
 */
export type Drawer<I = number> = { t: "drawer"; kid: LNode<I>; edge: Dir; open: boolean; id?: string; policy?: Policy };
const idOf = (n: { id?: string; policy?: Policy }) => ({ ...(n.id ? { id: n.id } : {}), ...(n.policy && Object.keys(n.policy).length ? { policy: { ...n.policy } } : {}) });
export type LNode<I = number> = { t: "leaf"; id: I } | Split<I> | Tabs<I> | Drawer<I>;
/** What holds tiles: a split, a tab set, a drawer. */
export type Container<I = number> = Split<I> | Tabs<I> | Drawer<I>;

/** How a view sizes its panes as they're placed. */
export interface PlaceOpts<I> {
  /** A pane squeezed to this many cells along the split's axis (a spine): its share goes to the others. */
  fixed?(id: I, dir: Axis): number | undefined;
  /** The fewest cells a kid may have along its parent's axis (default 6 across a row, 3 down a col). */
  min?(n: LNode<I>, dir: Axis, parent: Split<I>): number | undefined;
  /** A pane that keeps the size its weight gives it (a drawer): a neighbour takes what rounding leaves. */
  sized?(id: I): boolean;
  /** Every drawer placed as if docked, open or shut (where an open one slides out to). */
  docked?: boolean;
}

export interface Placed<I = number> {
  rects: Map<I, Rect>;
  /** Each tab set shown, where it landed: its active tile's rect (the header draws the tabs). */
  tabsets?: { node: Tabs<I>; rect: Rect }[];
  /** Where each named split landed. */
  nodes: Map<string, Rect>;
  dividers: Divider<I>[];
  /** Each drawer met, and the room it had (none when it slides over, or is shut). */
  drawers?: { node: Drawer<I>; rect: Rect }[];
}
/** The border between `node.kids[i]` and `kids[i + 1]`: `at` is the first cell of the second. */
export interface Divider<I = number> { node: Split<I>; i: number; area: Rect; at: number; sizes: [number, number] }

/** The fewest cells a kid gets when a view names no minimum: across a row, down a col. */
export const MIN_COLS = 6, MIN_ROWS = 3;

export const leaf = <I>(id: I): LNode<I> => ({ t: "leaf", id });
/** A split of `kids` by `weights` (default equal). */
export const splitOf = <I>(dir: Axis, kids: LNode<I>[], weights?: number[], key?: string): Split<I> =>
  ({ t: "split", dir, kids, weights: weights ?? kids.map(() => 1), ...(key ? { key } : {}) });
/** Two panes, the first taking `ratio` of the room: the desk's split. */
export const pair = <I>(dir: Axis, ratio: number, a: LNode<I>, b: LNode<I>): Split<I> => splitOf(dir, [a, b], [ratio, 1 - ratio]);

/** Every tile in the tree, a tab set's hidden ones included, in order. */
export function leaves<I>(n: LNode<I>): I[] {
  return n.t === "leaf" ? [n.id] : n.t === "tabs" ? [...n.ids] : n.t === "drawer" ? leaves(n.kid) : n.kids.flatMap(k => leaves(k));
}
/** A container's kids: a split's, a drawer's one; a tab set's tiles aren't nodes. */
export const kidsOf = <I>(n: LNode<I>): LNode<I>[] => (n.t === "split" ? n.kids : n.t === "drawer" ? [n.kid] : []);
/** The tiles on screen: a tab set shows its active one. */
export function shown<I>(n: LNode<I>): I[] {
  return n.t === "leaf" ? [n.id] : n.t === "tabs" ? (n.ids[n.active] === undefined ? [] : [n.ids[n.active]!]) : kidsOf(n).flatMap(k => shown(k));
}
/** The tiles on screen with the shut drawers' left out: what has a rectangle now. */
export function visible<I>(n: LNode<I>): I[] {
  return n.t === "drawer" && !n.open ? [] : n.t === "leaf" || n.t === "tabs" ? shown(n) : kidsOf(n).flatMap(k => visible(k));
}
export const has = <I>(n: LNode<I> | null, id: I): boolean => !!n && leaves(n).includes(id);
const holds = <I>(n: LNode<I>, id: I): boolean => (n.t === "leaf" ? n.id === id : n.t === "tabs" ? n.ids.includes(id) : kidsOf(n).some(k => holds(k, id)));

/** The named split, if it's in the tree. */
export function node<I>(n: LNode<I>, key: string): Split<I> | null {
  if (n.t === "drawer") return node(n.kid, key);
  if (n.t !== "split") return null;
  if (n.key === key) return n;
  for (const k of n.kids) { const f = node(k, key); if (f) return f; }
  return null;
}

/** The split holding the leaf `id` (or the named split `key`) directly, and where. A tile in a tab set is where its tab set is. */
export function parentOf<I>(n: LNode<I>, target: I | { key: string }): { parent: Split<I>; i: number } | null {
  if (n.t === "drawer") return parentOf(n.kid, target);
  if (n.t !== "split") return null;
  const i = n.kids.findIndex(k => (typeof target === "object" && target !== null && "key" in target ? k.t === "split" && k.key === target.key : (k.t === "leaf" && k.id === target) || (k.t === "tabs" && k.ids.includes(target as I))));
  if (i >= 0) return { parent: n, i };
  for (const k of n.kids) { const f = parentOf(k, target); if (f) return f; }
  return null;
}

/** The share of its split the leaf `id` (or named split) has, 0–1; null at the root or when absent. */
export function share<I>(root: LNode<I>, target: I | { key: string }): number | null {
  const p = parentOf(root, target);
  if (!p) return null;
  const sum = p.parent.weights.reduce((a, w) => a + w, 0) || 1;
  return p.parent.weights[p.i]! / sum;
}

// ── placing ──────────────────────────────────────────────────────────────────

/** A size in cells from a policy, or undefined when it isn't one. */
const cells = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : undefined);

/**
 * Lay the tree out in `r`. Along each split's axis a fixed kid (a spine) takes its cells; the others share
 * the rest by weight, each at least its minimum and at most what leaves the kids after it theirs. One kid
 * takes what rounding leaves over: the last one that isn't `sized`.
 */
export function place<I>(n: LNode<I>, r: Rect, opts: PlaceOpts<I> = {}, out: Placed<I> = { rects: new Map(), nodes: new Map(), dividers: [] }): Placed<I> {
  if (n.t === "leaf") { out.rects.set(n.id, r); return out; }
  if (n.t === "drawer") {
    (out.drawers ??= []).push({ node: n, rect: r });
    // A drawer given no room (sliding over, or shut) places nothing here: its tiles are placed where it slides out.
    if (r.cols > 0 && r.rows > 0) place(n.kid, r, opts, out);
    return out;
  }
  if (n.t === "tabs") {
    const id = n.ids[n.active];
    if (id !== undefined) { out.rects.set(id, r); (out.tabsets ??= []).push({ node: n, rect: r }); }
    return out;
  }
  if (n.key) out.nodes.set(n.key, r);
  const row = n.dir === "row", S = row ? r.cols : r.rows;
  // A tab set is sized as the tab it shows (a drawer's tab set slides over like a drawer). A drawer sliding
  // over, or shut, takes no room (unless placed as docked); a container's policy can fix its size.
  const fixed = n.kids.map(k => (k.t === "leaf" ? opts.fixed?.(k.id, n.dir) : k.t === "tabs" && k.ids[k.active] !== undefined ? opts.fixed?.(k.ids[k.active]!, n.dir) ?? cells(k.policy?.fixed)
    : k.t === "drawer" && !opts.docked && (!k.open || k.policy?.overlay !== false) ? 0 : cells(k.policy?.fixed)));
  const mins = n.kids.map(k => cells(k.t !== "leaf" ? k.policy?.min : undefined) ?? opts.min?.(k, n.dir, n) ?? (row ? MIN_COLS : MIN_ROWS));
  const maxs = n.kids.map(k => cells(k.t !== "leaf" ? k.policy?.max : undefined));
  const open = n.kids.map((_, i) => i).filter(i => fixed[i] === undefined);
  const flex = [...open].reverse().find(i => { const k = n.kids[i]!; return !(k.t === "leaf" && opts.sized?.(k.id)); }) ?? open.at(-1);
  const room = S - fixed.reduce<number>((a, f) => a + (f ?? 0), 0);
  const wsum = open.reduce((a, i) => a + n.weights[i]!, 0) || 1;
  const need = (i: number) => fixed[i] ?? mins[i]!;
  const sizes: (number | null)[] = n.kids.map((_, i) => fixed[i] ?? null);
  let used = fixed.reduce<number>((a, f) => a + (f ?? 0), 0);
  for (const i of open) {
    if (i === flex) continue;
    const later = open.filter(j => j !== i && sizes[j] === null).reduce((a, j) => a + need(j), 0);
    const hi = S - used - later;
    const size = Math.max(mins[i]!, Math.min(hi, maxs[i] ?? Infinity, Math.round((room * n.weights[i]!) / wsum)));
    sizes[i] = size; used += size;
  }
  if (flex !== undefined) sizes[flex] = Math.max(0, S - used);
  // This split's borders before its kids' (where two cross, the outer one is grabbed), then the kids.
  const size = sizes as number[];
  const starts = size.map((_, i) => (row ? r.col : r.row) + size.slice(0, i).reduce((a, x) => a + x, 0));
  n.kids.forEach((_, i) => {
    if (i > 0 && fixed[i] === undefined && fixed[i - 1] === undefined)
      out.dividers.push({ node: n, i: i - 1, area: r, at: starts[i]!, sizes: [size[i - 1]!, size[i]!] });
  });
  n.kids.forEach((k, i) => place(k, row ? { ...r, col: starts[i]!, cols: size[i]! } : { ...r, row: starts[i]!, rows: size[i]! }, opts, out));
  return out;
}

// ── changing the tree ─────────────────────────────────────────────────────────

/**
 * Put `add` beside the leaf `id` (or the named split): a new split of the two, `add` after it (or before),
 * taking `weight` of it. Along the target's longer axis unless told. The desk's split.
 */
export function beside<I>(root: LNode<I>, target: I | { key: string }, add: LNode<I>, o: { dir: Axis; before?: boolean; weight?: number; key?: string }): LNode<I> {
  const w = o.weight ?? 0.5;
  const wrap = (n: LNode<I>): Split<I> => splitOf(o.dir, o.before ? [add, n] : [n, add], o.before ? [w, 1 - w] : [1 - w, w], o.key);
  const isTarget = (n: LNode<I>) => (typeof target === "object" && target !== null && "key" in target ? n.t === "split" && n.key === target.key : (n.t === "leaf" && n.id === target) || (n.t === "tabs" && n.ids.includes(target as I)));
  const go = (n: LNode<I>): LNode<I> => {
    if (isTarget(n)) return wrap(n);
    if (n.t === "drawer") return { ...n, kid: go(n.kid) };
    if (n.t !== "split") return n;
    return { ...n, kids: n.kids.map(go) };
  };
  return go(root);
}

/** Split leaf `id` so `add` appears beside it, half each; along its longer axis unless told (the desk's `^W o`). */
export function split<I>(n: LNode<I>, id: I, add: I, r: Rect, dir?: Axis): LNode<I> {
  return beside(n, id, leaf(add), { dir: dir ?? (r.cols >= r.rows * 2.2 ? "row" : "col") });
}

/** Add a leaf to the named split at `index` (default the end) with `weight`. */
export function insert<I>(root: LNode<I>, key: string, add: LNode<I>, weight: number, index?: number): LNode<I> {
  const go = (n: LNode<I>): LNode<I> => {
    if (n.t === "drawer") return { ...n, kid: go(n.kid) };
    if (n.t !== "split") return n;
    if (n.key === key) {
      const at = index ?? n.kids.length;
      return { ...n, kids: [...n.kids.slice(0, at), add, ...n.kids.slice(at)], weights: [...n.weights.slice(0, at), weight, ...n.weights.slice(at)] };
    }
    return { ...n, kids: n.kids.map(go) };
  };
  return go(root);
}

/** Take leaf `id` out. A split left with one kid gives way to it, unless it's named. Null when nothing's left. */
export function remove<I>(n: LNode<I>, id: I): LNode<I> | null {
  if (n.t === "leaf") return n.id === id ? null : n;
  // A drawer left with nothing in it is gone too.
  if (n.t === "drawer") { const k = remove(n.kid, id); return k ? { ...n, kid: k } : null; }
  if (n.t === "tabs") {
    const at = n.ids.indexOf(id);
    if (at < 0) return n;
    const ids = n.ids.filter(x => x !== id);
    if (!ids.length) return null;
    if (ids.length === 1 && !n.policy) return leaf(ids[0]!);
    // The tab after the one taken out is shown, as closing a browser tab does; the one shown stays shown.
    const active = at < n.active ? n.active - 1 : at === n.active ? Math.min(at, ids.length - 1) : n.active;
    return { t: "tabs", ids, active, ...idOf(n) };
  }
  const kids: LNode<I>[] = [], weights: number[] = [];
  n.kids.forEach((k, i) => { const r = remove(k, id); if (r) { kids.push(r); weights.push(n.weights[i]!); } });
  if (!kids.length) return null;
  if (kids.length === 1 && !n.key) return kids[0]!;
  return { ...n, kids, weights };
}

/** Dock: pull a pane out and put it along one whole edge of the screen. */
export function dock<I>(root: LNode<I>, id: I, edge: Dir): LNode<I> {
  const rest = remove(root, id);
  const l = leaf(id);
  if (!rest) return l;
  if (edge === "left") return pair("row", 0.26, l, rest);
  if (edge === "right") return pair("row", 0.72, rest, l);
  if (edge === "up") return pair("col", 0.3, l, rest);
  return pair("col", 0.7, rest, l);
}

/**
 * Move the border of the pane along an axis: the nearest split along `dir` that holds it gives its kid
 * `delta` more of the room, taken from the kid after it (before it, for the last). The kid's share stays
 * within `bounds`. False when no split along that axis holds it. Changes the tree in place.
 */
export function resize<I>(n: LNode<I>, id: I, dir: Axis, delta: number, bounds: [number, number] = [0.1, 0.9]): boolean {
  // Inside a drawer first; with no border there, the drawer's own (in its parent) moves.
  if (n.t === "drawer") return resize(n.kid, id, dir, delta, bounds);
  if (n.t !== "split") return false;
  const i = n.kids.findIndex(k => holds(k, id));
  if (i < 0) return false;
  if (resize(n.kids[i]!, id, dir, delta, bounds)) return true;
  if (n.dir !== dir || n.kids.length < 2) return false;
  const j = i < n.kids.length - 1 ? i + 1 : i - 1;
  const sum = n.weights[i]! + n.weights[j]!, total = n.weights.reduce((a, w) => a + w, 0) || 1;
  const want = Math.max(bounds[0], Math.min(bounds[1], n.weights[i]! / total + delta)) * total;
  n.weights[i] = Math.max(0, Math.min(sum, want));
  n.weights[j] = sum - n.weights[i]!;
  return true;
}

/** Give the leaf `id` more (or less) weight in its split, within `lo`–`hi`: it takes its share from all the others. */
export function grow<I>(root: LNode<I>, id: I, delta: number, lo: number, hi: number, fallback = 1): boolean {
  const p = parentOf(root, id);
  if (!p) return false;
  p.parent.weights[p.i] = Math.max(lo, Math.min(hi, (p.parent.weights[p.i] ?? fallback) + delta));
  return true;
}

/** Every split shares its room equally (the desk's `^W =`). */
export function even<I>(n: LNode<I>, skip?: (n: Split<I>) => boolean): void {
  if (n.t === "drawer") return even(n.kid, skip);
  if (n.t !== "split") return;
  n.kids.forEach(k => even(k, skip));
  if (skip?.(n)) return;
  n.weights = n.kids.map(() => 1);
}

/** The pane whose rect lies in `dir` from `from`, nearest by edge gap then by centre offset. */
export function neighbour<I>(rects: Map<I, Rect>, from: I, dir: Dir): I | null {
  const a = rects.get(from);
  if (!a) return null;
  const cx = a.col + a.cols / 2, cy = a.row + a.rows / 2;
  let best: I | null = null, score = Infinity;
  for (const [id, b] of rects) {
    if (id === from) continue;
    const bx = b.col + b.cols / 2, by = b.row + b.rows / 2;
    const gap = dir === "left" ? a.col - (b.col + b.cols) : dir === "right" ? b.col - (a.col + a.cols)
      : dir === "up" ? a.row - (b.row + b.rows) : b.row - (a.row + a.rows);
    if (gap < -1) continue;
    const off = dir === "left" || dir === "right" ? Math.abs(by - cy) : Math.abs(bx - cx);
    const s = gap * 10 + off;
    if (s < score) { score = s; best = id; }
  }
  return best;
}

// ── dragging a border ────────────────────────────────────────────────────────

/** Where a dragged border would put the pair's share (the first kid's part, within bounds), without changing the tree. */
export function dragShare<I>(g: Grab<I>, x: number, y: number, o: { mins?: [number, number]; bounds?: [number, number] } = {}): number | null {
  const { d, side } = g, n = d.node;
  const [sa, sb] = d.sizes, total = sa + sb;
  if (total <= 0) return null;
  const start = d.at - sa;
  const p = n.dir === "row" ? x : y;
  const [ma, mb] = o.mins ?? (n.dir === "row" ? [MIN_COLS, MIN_COLS] : [MIN_ROWS, MIN_ROWS]);
  const a = Math.max(ma, Math.min(total - mb, side === 0 ? p - start + 1 : p - start));
  const [lo, hi] = o.bounds ?? [0.08, 0.92];
  return Math.max(lo, Math.min(hi, a / total));
}

/** A divider being dragged, and which of its two border cells was grabbed (0: the first kid's, 1: the second's). */
export interface Grab<I = number> { d: Divider<I>; side: 0 | 1 }

/** Divider under a cell, for mouse drags. The borders of both neighbours count as the divider. */
export function dividerAt<I>(dividers: Divider<I>[], x: number, y: number): Grab<I> | null {
  for (const d of dividers) {
    const r = d.area;
    if (d.node.dir === "row" && (x === d.at || x === d.at - 1) && y >= r.row && y < r.row + r.rows) return { d, side: x === d.at ? 1 : 0 };
    if (d.node.dir === "col" && (y === d.at || y === d.at - 1) && x >= r.col && x < r.col + r.cols) return { d, side: y === d.at ? 1 : 0 };
  }
  return null;
}

/**
 * The grabbed border follows the pointer: the two kids beside the divider share their cells anew, each at
 * least `mins`, the first's share of the pair within `bounds`. The pair's total weight stays the same.
 */
export function dragTo<I>(g: Grab<I>, x: number, y: number, o: { mins?: [number, number]; bounds?: [number, number] } = {}): void {
  const n = g.d.node, d = g.d;
  const f = dragShare(g, x, y, o);
  if (f === null) return;
  const sum = n.weights[d.i]! + n.weights[d.i + 1]!;
  n.weights[d.i] = sum * f;
  n.weights[d.i + 1] = sum - n.weights[d.i]!;
}

// ── a screen: the tree, the drawers sliding over it, the floats ─────────────

/** A pane with its own rectangle: whatever the view floats (a reader), and where. */
export interface Float { rect: Rect }
export interface ScreenLayout<I = number, F extends Float = Float & { id: I }> {
  root: LNode<I>;
  /** Drawers that slide over the layout (not pinned): placed as if docked, and nothing else moves for them. */
  over: Set<I>;
  /** Panes with their own rectangle, drawn above everything, last on top. */
  floats: F[];
}

export interface PlacedScreen<I = number> extends Placed<I> {
  /** Where each sliding drawer is, and its own border's divider. */
  over: Map<I, { rect: Rect; divider: Divider<I> | null }>;
  /**
   * Each open drawer container sliding over (PIE-505), bottom first: where it slid out to, the border it
   * shares with its neighbour there (a drag sizes it), and its tiles placed inside it.
   */
  slid: PlacedDrawer<I>[];
}
export interface PlacedDrawer<I = number> { node: Drawer<I>; rect: Rect; divider: Divider<I> | null; placed: Placed<I> }

/** The drawers in a layer of the tree: those in it, not inside another drawer. */
function drawersIn<I>(n: LNode<I>): Drawer<I>[] { return n.t === "drawer" ? [n] : n.t === "split" ? n.kids.flatMap(drawersIn) : []; }

/**
 * Place a screen: the docked panes as if the sliding drawers took no room (each is a fixed size of 0, so
 * the tree itself is placed and its borders are the real splits a drag changes), then each drawer where
 * docking would put it. A drawer container (PIE-505) slides out the same way, and its own tiles (and any
 * drawer inside it) are placed in the room it slid out to.
 */
export function placeScreen<I>(s: ScreenLayout<I, Float>, r: Rect, opts: PlaceOpts<I> = {}): PlacedScreen<I> {
  const sliding = shown(s.root).filter(id => s.over.has(id));
  const base = place(s.root, r, { ...opts, fixed: (id, dir) => (s.over.has(id) ? 0 : opts.fixed?.(id, dir)) });
  for (const id of sliding) base.rects.delete(id);
  const out: PlacedScreen<I> = { ...base, over: new Map(), slid: [] };
  const slide = (layer: LNode<I>, area: Rect) => {
    const open = drawersIn(layer).filter(d => d.open && d.policy?.overlay !== false);
    if (!open.length) return;
    const full = place(layer, area, { ...opts, docked: true });
    for (const d of open) {
      const rect = full.drawers?.find(x => x.node === d)?.rect ?? area;
      const divider = full.dividers.find(x => x.node.kids[x.i] === d || x.node.kids[x.i + 1] === d) ?? null;
      const placed = place(d.kid, rect, opts);
      out.slid.push({ node: d, rect, divider, placed });
      slide(d.kid, rect);
    }
  };
  slide(s.root, r);
  // An open drawer that takes its room (overlay: false) is placed where it is; one inside it slides over that.
  for (const d of base.drawers ?? []) if (d.rect.cols > 0 && d.rect.rows > 0) slide(d.node.kid, d.rect);
  if (sliding.length) {
    const full = place(s.root, r, opts);
    for (const id of sliding) {
      const rect = full.rects.get(id);
      if (!rect) continue;
      const is = (k: LNode<I>) => (k.t === "leaf" && k.id === id) || (k.t === "tabs" && k.ids.includes(id));
      const divider = full.dividers.find(d => is(d.node.kids[d.i]!) || is(d.node.kids[d.i + 1]!)) ?? null;
      out.over.set(id, { rect, divider });
    }
  }
  return out;
}

// ── tiles: move, tab, edge, normalise (PIE-413) ──────────────────────────────

/** Where a moved tile goes: beside a tile (a split in that direction), into its tabs, or along an outer edge. */
export type Place<I> = { kind: "split"; target: I; dir: Dir } | { kind: "tabs"; target: I; index?: number } | { kind: "edge"; dir: Dir };

const axisOf = (d: Dir): Axis => (d === "left" || d === "right" ? "row" : "col");
const before = (d: Dir) => d === "left" || d === "up";

/** The tab set holding `id`, if it is in one. */
export function tabsOf<I>(n: LNode<I>, id: I): Tabs<I> | null {
  if (n.t === "leaf") return null;
  if (n.t === "tabs") return n.ids.includes(id) ? n : null;
  for (const k of kidsOf(n)) { const f = tabsOf(k, id); if (f) return f; }
  return null;
}

/** Replace the slot holding `id` (the leaf, or its whole tab set) with `f(slot)`. */
function mapSlot<I>(n: LNode<I>, id: I, f: (slot: LNode<I>) => LNode<I>): LNode<I> {
  if (n.t === "leaf") return n.id === id ? f(n) : n;
  if (n.t === "tabs") return n.ids.includes(id) ? f(n) : n;
  if (n.t === "drawer") return { ...n, kid: mapSlot(n.kid, id, f) };
  return { ...n, kids: n.kids.map(k => mapSlot(k, id, f)) };
}

/**
 * Put `add` beside the slot holding `target` (its tab set, when it's in one), on the `dir` side, taking half
 * of the slot's room. Inside a split along the same axis it joins that split (n-ary) instead of nesting a pair.
 */
export function besideSlot<I>(root: LNode<I>, target: I, add: LNode<I>, dir: Dir, weight = 0.5): LNode<I> {
  const axis = axisOf(dir);
  const p = parentOf(root, target);
  if (p && p.parent.dir === axis && !p.parent.key) {
    const w = p.parent.weights[p.i]!;
    const at = before(dir) ? p.i : p.i + 1;
    p.parent.kids.splice(at, 0, add);
    p.parent.weights[p.i] = w * (1 - weight);
    p.parent.weights.splice(at, 0, w * weight);
    return root;
  }
  return mapSlot(root, target, slot => splitOf(axis, before(dir) ? [add, slot] : [slot, add], before(dir) ? [weight, 1 - weight] : [1 - weight, weight]));
}

/** Put `add` into `target`'s tabs at `index` (default after the tab shown), and show it. A lone tile becomes a tab set. */
export function tabInto<I>(root: LNode<I>, target: I, add: I, index?: number): LNode<I> {
  return mapSlot(root, target, slot => {
    const ids = slot.t === "tabs" ? slot.ids.filter(x => x !== add) : [target];
    const at = Math.max(0, Math.min(ids.length, index ?? (slot.t === "tabs" ? Math.min(slot.active, ids.length - 1) + 1 : 1)));
    ids.splice(at, 0, add);
    return { t: "tabs", ids, active: at, ...(slot.t === "tabs" ? idOf(slot) : {}) } as Tabs<I>;
  });
}

/**
 * Move tile `src` (floatty's `moveLeafToTarget` and `moveLeafToRoot`): take it out (its split or tab set
 * gives way), then put it beside `target`, into its tabs, or along an outer edge of the whole layout.
 * Null when the move means nothing: the only tile, onto itself, or a target that isn't there.
 * Dropped onto its own tab set, it leaves the set and lands beside the tabs left.
 */
export function move<I>(root: LNode<I>, src: I, to: Place<I>): LNode<I> | null {
  if (!has(root, src)) return null;
  if (to.kind === "tabs") {
    if (to.target === src) return null;
    const same = tabsOf(root, to.target);
    if (same && same.ids.includes(src)) return reorder(root, src, to.index ?? same.ids.length - 1);
  }
  let target = to.kind === "edge" ? null : to.target;
  if (target === src) {
    const set = tabsOf(root, src);
    if (!set || set.ids.length < 2) return null;
    target = set.ids.find(x => x !== src)!;
  }
  const rest = remove(clone(root), src);
  if (!rest) return null;
  if (to.kind === "edge") return normalise(edge(rest, src, to.dir));
  if (target === null || !has(rest, target)) return null;
  const out = to.kind === "tabs" ? tabInto(rest, target, src, to.index) : besideSlot(rest, target, leaf(src), to.dir);
  return normalise(out);
}

/** The whole layout beside one tile along an outer edge: a full-height column (left, right) or full-width row (up, down). */
export function edge<I>(rest: LNode<I>, src: I, dir: Dir, weight = 0.3): LNode<I> {
  const l = leaf(src);
  return before(dir) ? splitOf(axisOf(dir), [l, rest], [weight, 1 - weight]) : splitOf(axisOf(dir), [rest, l], [1 - weight, weight]);
}

/** Show tile `id` in its tab set. False when it isn't in one. Changes the tree in place. */
export function activate<I>(root: LNode<I>, id: I): boolean {
  const t = tabsOf(root, id);
  if (!t) return false;
  t.active = t.ids.indexOf(id);
  return true;
}

/** The next (1) or previous (-1) tab of `id`'s tab set shown; the tile now shown, or null outside a tab set. */
export function cycle<I>(root: LNode<I>, id: I, dir: 1 | -1): I | null {
  const t = tabsOf(root, id);
  if (!t) return null;
  t.active = (t.active + dir + t.ids.length) % t.ids.length;
  return t.ids[t.active]!;
}

/** Move tab `id` to `index` in its own tab set, still shown. */
export function reorder<I>(root: LNode<I>, id: I, index: number): LNode<I> | null {
  if (!tabsOf(root, id)) return null;
  const out = clone(root);
  const t = tabsOf(out, id)!;
  const ids = t.ids.filter(x => x !== id);
  const at = Math.max(0, Math.min(ids.length, index));
  ids.splice(at, 0, id);
  t.ids = ids; t.active = at;
  return out;
}

// ── containers: drawers and policy (PIE-505) ────────────────────────────────

/** The containers from the root down to tile `id`, outermost first (its tab set last, when it's in one). Empty when absent. */
export function chainOf<I>(n: LNode<I>, id: I): Container<I>[] {
  if (n.t === "leaf") return [];
  if (n.t === "tabs") return n.ids.includes(id) ? [n] : [];
  for (const k of kidsOf(n)) { if (!holds(k, id)) continue; return [n, ...chainOf(k, id)]; }
  return [];
}
/** The innermost drawer holding tile `id`, if any. */
export function drawerOf<I>(root: LNode<I>, id: I): Drawer<I> | null {
  return (chainOf(root, id).filter(n => n.t === "drawer") as Drawer<I>[]).at(-1) ?? null;
}
/** Every drawer in the tree, outermost first. */
export function drawers<I>(n: LNode<I>): Drawer<I>[] { return [...(n.t === "drawer" ? [n] : []), ...kidsOf(n).flatMap(k => drawers(k))]; }
/** The container with this id (`s3`, `g2`, `d1`). */
export function nodeById<I>(n: LNode<I>, id: string): Container<I> | null {
  if (n.t === "leaf") return null;
  if (n.id === id) return n;
  for (const k of kidsOf(n)) { const f = nodeById(k, id); if (f) return f; }
  return null;
}
/** The split holding container `c` as a kid, and where. */
export function parentNode<I>(root: LNode<I>, c: LNode<I>): { parent: Split<I>; i: number } | null {
  if (root.t === "drawer") return parentNode(root.kid, c);
  if (root.t !== "split") return null;
  const i = root.kids.indexOf(c);
  if (i >= 0) return { parent: root, i };
  for (const k of root.kids) { const f = parentNode(k, c); if (f) return f; }
  return null;
}

/** The edge a slot at kid `i` of a split slides from: the first kid of a row from the left, the last from the right. */
const edgeAt = (dir: Axis, i: number, n: number): Dir => (dir === "row" ? (i === 0 || i < n - 1 ? "left" : "right") : (i === 0 || i < n - 1 ? "up" : "down"));

/**
 * Put the slot holding tile `id` (its tab set, or the tile) in a drawer, where it is, sliding from the edge it
 * sits at; with `to`, the drawer goes along that outer edge of the whole layout instead (a full-height drawer on
 * the left). Null when there's nothing for it to slide over, or it's in a drawer already.
 */
export function wrapDrawer<I>(root: LNode<I>, id: I, to?: Dir, open = true, weight = 0.26): LNode<I> | null {
  if (!has(root, id) || drawerOf(root, id) || leaves(root).length < 2) return null;
  const set = tabsOf(root, id);
  if (set && leaves(root).every(x => set.ids.includes(x))) return null;
  if (to) {
    const rest = remove(clone(root), id);
    if (!rest) return null;
    // A tab set goes as one: the others in it come out with it.
    let r: LNode<I> | null = rest;
    const kid: LNode<I> = set ? { t: "tabs", ids: [...set.ids], active: set.active, ...idOf(set) } : leaf(id);
    if (set) for (const x of set.ids) if (x !== id) r = r && remove(r, x);
    if (!r) return null;
    return toEdge(r, { t: "drawer", kid, edge: to, open }, weight);
  }
  const p = parentOf(root, id);
  const edge = p ? edgeAt(p.parent.dir, p.i, p.parent.kids.length) : "left";
  return mapSlot(root, id, slot => ({ t: "drawer", kid: slot, edge, open }));
}
/** The drawer goes along outer edge `to` of `rest` (the whole layout), taking `weight` of it when it slides out. */
function toEdge<I>(rest: LNode<I>, d: Drawer<I>, weight: number): LNode<I> {
  const dr = { ...d, edge: d.edge } as Drawer<I>;
  const ax = axisOf(dr.edge);
  // Inside a split along the same axis, it joins it at that end.
  if (rest.t === "split" && rest.dir === ax && !rest.key) {
    const sum = rest.weights.reduce((a, w) => a + w, 0) || 1;
    const w = (weight / (1 - weight)) * sum;
    return before(dr.edge) ? { ...rest, kids: [dr, ...rest.kids], weights: [w, ...rest.weights] } : { ...rest, kids: [...rest.kids, dr], weights: [...rest.weights, w] };
  }
  return before(dr.edge) ? splitOf(ax, [dr, rest], [weight, 1 - weight]) : splitOf(ax, [rest, dr], [1 - weight, weight]);
}
/** Move drawer `d` to outer edge `to` of the whole layout, keeping what it holds, its id and policy. */
export function drawerToEdge<I>(root: LNode<I>, d: Drawer<I>, to: Dir, weight = 0.26): LNode<I> | null {
  const rest = without(root, d);
  if (!rest) return null;
  return toEdge(rest, { ...d, edge: to }, weight);
}
/** The tree with node `c` taken out (its split gives way as a tile's does). */
function without<I>(n: LNode<I>, c: LNode<I>): LNode<I> | null {
  if (n === c) return null;
  if (n.t === "drawer") { const k = without(n.kid, c); return k ? { ...n, kid: k } : null; }
  if (n.t !== "split") return n;
  const kids: LNode<I>[] = [], weights: number[] = [];
  n.kids.forEach((k, i) => { const r = without(k, c); if (r) { kids.push(r); weights.push(n.weights[i]!); } });
  if (!kids.length) return null;
  if (kids.length === 1 && !n.key) return kids[0]!;
  return { ...n, kids, weights };
}
/** Drawer `d` gives way to what it holds, docked where it was. */
export function unwrapDrawer<I>(root: LNode<I>, d: Drawer<I>): LNode<I> {
  const go = (n: LNode<I>): LNode<I> => (n === d ? d.kid : n.t === "drawer" ? { ...n, kid: go(n.kid) } : n.t === "split" ? { ...n, kids: n.kids.map(go) } : n);
  return go(root);
}

/** What applies to a tile, from the screen's policy down through its containers to its kind's default. */
export interface Effective {
  locked: boolean; draggable: boolean; droppable: boolean; resizable: boolean; collapsible: boolean;
  accepts: string[] | null; opensInto: string | null;
  /** Which layer said each: "screen", a container's id, or "kind". */
  by: Partial<Record<keyof Policy, string>>;
}
/**
 * The policy in effect under `layers` (outermost first, each with who it is): the nearest that says a field
 * wins, and `locked` anywhere locks everything under it.
 */
export function effective(layers: { by: string; policy?: Policy }[]): Effective {
  const out: Effective = { locked: false, draggable: true, droppable: true, resizable: true, collapsible: true, accepts: null, opensInto: null, by: {} };
  for (const { by, policy: p } of layers) {
    if (!p) continue;
    if (p.locked) { out.locked = true; out.by.locked ??= by; }
    for (const k of ["draggable", "droppable", "resizable", "collapsible"] as const) if (p[k] !== undefined) { out[k] = p[k]!; out.by[k] = by; }
    if (p.accepts) { out.accepts = p.accepts; out.by.accepts = by; }
    if (p.opensInto) { out.opensInto = p.opensInto; out.by.opensInto = by; }
  }
  return out;
}

/** Drop the ids (`s<n>`, `g<n>`, `d<n>`) of the splits, tab sets and drawers whose number `gone` says was given out already. */
export function forgetIds<I>(n: LNode<I>, gone: (num: number) => boolean): void {
  if (n.t === "leaf") return;
  const m = n.id ? /^[sgd](\d+)$/.exec(n.id) : null;
  if (n.id && (!m || gone(Number(m[1])))) delete n.id;
  for (const k of kidsOf(n)) forgetIds(k, gone);
}

/** A copy of the tree's shape (the ids themselves are kept). */
export function clone<I>(n: LNode<I>): LNode<I> {
  if (n.t === "leaf") return { t: "leaf", id: n.id };
  if (n.t === "tabs") return { t: "tabs", ids: [...n.ids], active: n.active, ...idOf(n) };
  if (n.t === "drawer") return { ...n, kid: clone(n.kid), ...idOf(n) };
  return { ...n, kids: n.kids.map(clone), weights: [...n.weights], ...idOf(n) };
}

/**
 * The tree in its plain shape: weights positive and summing to 1 in each split (floatty's `clampRatio`,
 * for n kids: each at least `min` of its split), a split left with one kid gives way to it and a split
 * inside one along the same axis joins it (unless either is named: the board finds those by name), a tab
 * set of one is that tile, and a tab set shows a tab it has.
 */
export function normalise<I>(n: LNode<I>, min = 0.05, top = true): LNode<I> {
  if (n.t === "leaf") return n;
  if (n.t === "drawer") {
    const k = normalise(n.kid, min, false);
    // A drawer with nothing over which to slide (the whole layout) is just what it holds.
    if (top) return k;
    // A drawer straight inside a drawer is one drawer (the outer's edge and state; a policy from either).
    return k.t === "drawer" ? { ...n, kid: k.kid, ...(n.policy || k.policy ? { policy: n.policy ?? k.policy } : {}) } : { ...n, kid: k };
  }
  if (n.t === "tabs") {
    const ids = [...new Set(n.ids)];
    if (!ids.length) return { t: "tabs", ids: [], active: 0, ...idOf(n) };
    if (ids.length === 1 && !n.policy) return leaf(ids[0]!);
    return { t: "tabs", ids, active: Math.max(0, Math.min(ids.length - 1, Number.isInteger(n.active) ? n.active : 0)), ...idOf(n) };
  }
  let kids: LNode<I>[] = [], weights: number[] = [];
  n.kids.forEach((k0, i) => {
    const k = normalise(k0, min, false);
    // A tab set with no tabs left, a split with no kids, or a drawer holding neither takes no room: it's gone.
    if (empty(k)) return;
    const w = good(n.weights[i]) ? n.weights[i]! : 1;
    if (k.t === "split" && k.dir === n.dir && !k.key && !n.key && !k.policy) {
      const sum = k.weights.reduce((a, x) => a + x, 0) || 1;
      k.kids.forEach((kk, j) => { kids.push(kk); weights.push((w * k.weights[j]!) / sum); });
    } else { kids.push(k); weights.push(w); }
  });
  // A split left with one kid gives way to it; its policy goes with it when the kid is a container without one.
  if (kids.length === 1 && !n.key) {
    let only = kids[0]!;
    // At the top a lone drawer has nothing to slide over: it's what it holds (which keeps a policy given it).
    if (top && only.t === "drawer") only = only.kid;
    return n.policy && only.t !== "leaf" && !only.policy ? { ...only, policy: n.policy } : only;
  }
  if (!kids.length) return { ...n, kids, weights };
  const sum = weights.reduce((a, x) => a + x, 0) || 1;
  weights = weights.map(w => Math.max(min, w / sum));
  const again = weights.reduce((a, x) => a + x, 0);
  weights = weights.map(w => w / again);
  return { ...n, kids, weights };
}

// ── saved forms ──────────────────────────────────────────────────────────────

/** The desk.json form before PIE-412: binary splits by ratio. The desk still writes it (it only makes pairs). */
export type BinaryForm<L> = L | { t: "split"; dir: Axis; ratio: number; a: BinaryForm<L>; b: BinaryForm<L>; id?: string; policy?: Policy } | DrawerForm<L>;
export type NaryForm<L> = L | { t: "split"; dir: Axis; kids: NaryForm<L>[]; weights: number[]; key?: string; id?: string; policy?: Policy } | TabsForm<L> | DrawerForm<L>;
/** A tab set as saved: its tiles and which one is shown. `id` (a split's too): absent in a form saved before PIE-491. */
export type TabsForm<L> = { t: "tabs"; tabs: L[]; active: number; id?: string; policy?: Policy };
/** A drawer as saved (PIE-505): what it holds, its edge, open or shut. */
export type DrawerForm<L> = { t: "drawer"; kid: NaryForm<L>; edge: Dir; open: boolean; id?: string; policy?: Policy };
const savedId = (x: any) => ({ ...(typeof x?.id === "string" && x.id ? { id: x.id as string } : {}), ...savedPolicy(x?.policy) });
const DIRS: readonly Dir[] = ["left", "right", "up", "down"];
/** The glyph a drawer's header, its handle and a drop into it show for the edge it slides from. */
export const EDGE_GLYPH: Record<Dir, string> = { left: "⇤", right: "⇥", up: "⤒", down: "⤓" };
export const isDir = (x: unknown): x is Dir => typeof x === "string" && (DIRS as readonly string[]).includes(x);

/**
 * A policy as saved or as an agent gave it, kept to the fields and types it has (a hand-edited save's
 * strays dropped). Empty: none.
 */
export function policyOf(x: unknown): Policy {
  const out: Policy = {};
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  for (const k of ["draggable", "droppable", "resizable", "collapsible", "overlay", "locked"] as const) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  for (const k of ["min", "max", "fixed"] as const) { const n = cells(o[k]); if (n !== undefined) out[k] = n; }
  if (Array.isArray(o.accepts)) out.accepts = [...new Set(o.accepts.filter((a): a is string => typeof a === "string" && /^[\w.-]{1,40}$/.test(a)))];
  if (typeof o.opensInto === "string" && o.opensInto) out.opensInto = o.opensInto;
  return out;
}
const savedPolicy = (x: unknown) => { const p = policyOf(x); return Object.keys(p).length ? { policy: p } : {}; };

/** Read either saved form (binary `ratio a b` or `kids weights`), making each leaf with `leafOf`. */
export function revive<L extends { t: "leaf" }, I>(s: BinaryForm<L> | NaryForm<L>, leafOf: (l: L) => I): LNode<I> {
  if (s.t === "leaf") return leaf(leafOf(s as L));
  const x = s as any;
  if (x.t === "drawer") return { t: "drawer", kid: x.kid ? revive(x.kid, leafOf) : { t: "tabs", ids: [], active: 0 }, edge: isDir(x.edge) ? x.edge : "left", open: x.open === true, ...savedId(x) };
  if (x.t === "tabs") {
    const ids = (Array.isArray(x.tabs) ? x.tabs : []).filter((l: any) => l?.t === "leaf").map((l: L) => leafOf(l));
    // A tab set of one is that tile, unless it keeps a policy of its own.
    if (ids.length === 1 && !savedId(x).policy) return leaf(ids[0]);
    return { t: "tabs", ids, active: Number.isInteger(x.active) && x.active >= 0 && x.active < ids.length ? x.active : 0, ...savedId(x) };
  }
  const dir: Axis = x.dir === "col" ? "col" : "row";
  if (Array.isArray(x.kids)) {
    const kids = x.kids.map((k: any) => revive(k, leafOf));
    // Weights that aren't positive, finite numbers (or don't match the kids) fall back to equal shares.
    const ok = Array.isArray(x.weights) && x.weights.length === kids.length && x.weights.every(good);
    return { ...splitOf(dir, kids, ok ? [...x.weights] : undefined, typeof x.key === "string" ? x.key : undefined), ...savedId(x) };
  }
  const ratio = good(x.ratio) && x.ratio < 1 ? x.ratio : 0.5;
  return { ...pair(dir, ratio, revive(x.a, leafOf), revive(x.b, leafOf)), ...savedId(x) };
}

const good = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w > 0;
const empty = <I>(k: LNode<I>): boolean => (k.t === "tabs" && !k.ids.length) || (k.t === "split" && !k.kids.length && !k.key) || (k.t === "drawer" && empty(k.kid));

/** Write a tree, pairs in the binary form (so an older door still reads it), anything wider as kids and weights. */
export function serialize<I, L>(n: LNode<I>, leafOf: (id: I) => L): BinaryForm<L> | NaryForm<L> {
  if (n.t === "leaf") return leafOf(n.id);
  if (n.t === "tabs") return { t: "tabs", tabs: n.ids.map(leafOf), active: n.active, ...idOf(n) };
  if (n.t === "drawer") return { t: "drawer", edge: n.edge, open: n.open, kid: serialize(n.kid, leafOf) as NaryForm<L>, ...idOf(n) };
  if (n.kids.length === 2 && !n.key) {
    const sum = n.weights[0]! + n.weights[1]! || 1;
    return { t: "split", dir: n.dir, ratio: n.weights[0]! / sum, a: serialize(n.kids[0]!, leafOf) as BinaryForm<L>, b: serialize(n.kids[1]!, leafOf) as BinaryForm<L>, ...idOf(n) };
  }
  return { t: "split", dir: n.dir, kids: n.kids.map(k => serialize(k, leafOf) as NaryForm<L>), weights: [...n.weights], ...(n.key ? { key: n.key } : {}), ...idOf(n) };
}

/**
 * The tree as `peek` and `layout.get` show it: each pane by name with its share of its split. Each split
 * says its `path` (kid indexes from the root, "1.0"); a split or tab set that has an id says it, and so does
 * each pane when `leafId` is given.
 */
export type LayoutView = { pane: string; id?: string; share: number; fixed?: number } | { split: Axis; key?: string; id?: string; policy?: Policy; path: string; share: number; kids: LayoutView[] }
  | { tabs: string[]; id?: string; policy?: Policy; active: string; share: number } | { drawer: Dir; open: boolean; id?: string; policy?: Policy; path: string; share: number; kid: LayoutView };
export function describeTree<I>(n: LNode<I>, name: (id: I) => string, opts: PlaceOpts<I> = {}, leafId?: (id: I) => string, sh = 1, parent: Axis = "row", path = ""): LayoutView {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (n.t === "leaf") { const f = opts.fixed?.(n.id, parent); return { pane: name(n.id), ...(leafId ? { id: leafId(n.id) } : {}), share: round(sh), ...(f !== undefined ? { fixed: f } : {}) }; }
  if (n.t === "tabs") return { tabs: n.ids.map(name), ...idOf(n), active: name(n.ids[n.active]!), share: round(sh) };
  // A drawer's kid is at path `<drawer's>.0`, as a split's first kid would be.
  if (n.t === "drawer") return { drawer: n.edge, open: n.open, ...idOf(n), path, share: round(sh), kid: describeTree(n.kid, name, opts, leafId, 1, parent, path ? `${path}.0` : "0") };
  const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
  return { split: n.dir, ...(n.key ? { key: n.key } : {}), ...idOf(n), path, share: round(sh), kids: n.kids.map((k, i) => describeTree(k, name, opts, leafId, n.weights[i]! / sum, n.dir, path ? `${path}.${i}` : String(i))) };
}
