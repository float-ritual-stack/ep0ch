// The pane model (PIE-412): a tree of splits over pane ids, shared by the desk and the board. A split lays
// its kids side by side (row) or one over another (col), each by its weight. Pure functions; the view owns
// its tree. Around the tree a screen has drawers that slide over it (an overlay is placed as if it were
// docked, and nothing else moves for it; pinning a drawer makes it part of the layout) and floats, panes
// with their own rectangle above everything.
import type { Rect } from "../canvas";

export type Dir = "left" | "right" | "up" | "down";
/** row: kids side by side; col: one over another. */
export type Axis = "row" | "col";
export type Split<I = number> = {
  t: "split"; dir: Axis; kids: LNode<I>[]; weights: number[];
  /** A name the view finds it by ("readers"); a named split stays when one kid is left. */
  key?: string;
};
export type LNode<I = number> = { t: "leaf"; id: I } | Split<I>;

/** How a view sizes its panes as they're placed. */
export interface PlaceOpts<I> {
  /** A pane squeezed to this many cells along the split's axis (a spine): its share goes to the others. */
  fixed?(id: I, dir: Axis): number | undefined;
  /** The fewest cells a kid may have along its parent's axis (default 6 across a row, 3 down a col). */
  min?(n: LNode<I>, dir: Axis, parent: Split<I>): number | undefined;
  /** A pane that keeps the size its weight gives it (a drawer): a neighbour takes what rounding leaves. */
  sized?(id: I): boolean;
}

export interface Placed<I = number> {
  rects: Map<I, Rect>;
  /** Where each named split landed. */
  nodes: Map<string, Rect>;
  dividers: Divider<I>[];
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

export function leaves<I>(n: LNode<I>): I[] {
  return n.t === "leaf" ? [n.id] : n.kids.flatMap(k => leaves(k));
}
export const has = <I>(n: LNode<I> | null, id: I): boolean => !!n && leaves(n).includes(id);
const holds = <I>(n: LNode<I>, id: I): boolean => (n.t === "leaf" ? n.id === id : n.kids.some(k => holds(k, id)));

/** The named split, if it's in the tree. */
export function node<I>(n: LNode<I>, key: string): Split<I> | null {
  if (n.t === "leaf") return null;
  if (n.key === key) return n;
  for (const k of n.kids) { const f = node(k, key); if (f) return f; }
  return null;
}

/** The split holding the leaf `id` (or the named split `key`) directly, and where. */
export function parentOf<I>(n: LNode<I>, target: I | { key: string }): { parent: Split<I>; i: number } | null {
  if (n.t === "leaf") return null;
  const i = n.kids.findIndex(k => (typeof target === "object" && target !== null && "key" in target ? k.t === "split" && k.key === target.key : k.t === "leaf" && k.id === target));
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

/**
 * Lay the tree out in `r`. Along each split's axis a fixed kid (a spine) takes its cells; the others share
 * the rest by weight, each at least its minimum and at most what leaves the kids after it theirs. One kid
 * takes what rounding leaves over: the last one that isn't `sized`.
 */
export function place<I>(n: LNode<I>, r: Rect, opts: PlaceOpts<I> = {}, out: Placed<I> = { rects: new Map(), nodes: new Map(), dividers: [] }): Placed<I> {
  if (n.t === "leaf") { out.rects.set(n.id, r); return out; }
  if (n.key) out.nodes.set(n.key, r);
  const row = n.dir === "row", S = row ? r.cols : r.rows;
  const fixed = n.kids.map(k => (k.t === "leaf" ? opts.fixed?.(k.id, n.dir) : undefined));
  const mins = n.kids.map(k => opts.min?.(k, n.dir, n) ?? (row ? MIN_COLS : MIN_ROWS));
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
    const size = Math.max(mins[i]!, Math.min(hi, Math.round((room * n.weights[i]!) / wsum)));
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
  const isTarget = (n: LNode<I>) => (typeof target === "object" && target !== null && "key" in target ? n.t === "split" && n.key === target.key : n.t === "leaf" && n.id === target);
  const go = (n: LNode<I>): LNode<I> => {
    if (isTarget(n)) return wrap(n);
    if (n.t === "leaf") return n;
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
    if (n.t === "leaf") return n;
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
  if (n.t === "leaf") return false;
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
export function even<I>(n: LNode<I>): void {
  if (n.t === "leaf") return;
  n.weights = n.kids.map(() => 1);
  n.kids.forEach(even);
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
  const { d, side } = g, n = d.node;
  const [sa, sb] = d.sizes, total = sa + sb;
  if (total <= 0) return;
  const start = d.at - sa;
  const p = n.dir === "row" ? x : y;
  const [ma, mb] = o.mins ?? (n.dir === "row" ? [MIN_COLS, MIN_COLS] : [MIN_ROWS, MIN_ROWS]);
  const a = Math.max(ma, Math.min(total - mb, side === 0 ? p - start + 1 : p - start));
  const [lo, hi] = o.bounds ?? [0.08, 0.92];
  const f = Math.max(lo, Math.min(hi, a / total));
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
}

/**
 * Place a screen: the docked panes as if the sliding drawers took no room (each is a fixed size of 0, so
 * the tree itself is placed and its borders are the real splits a drag changes), then each drawer where
 * docking would put it.
 */
export function placeScreen<I>(s: ScreenLayout<I, Float>, r: Rect, opts: PlaceOpts<I> = {}): PlacedScreen<I> {
  const sliding = leaves(s.root).filter(id => s.over.has(id));
  const base = place(s.root, r, { ...opts, fixed: (id, dir) => (s.over.has(id) ? 0 : opts.fixed?.(id, dir)) });
  for (const id of sliding) base.rects.delete(id);
  const out: PlacedScreen<I> = { ...base, over: new Map() };
  if (sliding.length) {
    const full = place(s.root, r, opts);
    for (const id of sliding) {
      const rect = full.rects.get(id);
      if (!rect) continue;
      const divider = full.dividers.find(d => { const a = d.node.kids[d.i]!, b = d.node.kids[d.i + 1]!; return (a.t === "leaf" && a.id === id) || (b.t === "leaf" && b.id === id); }) ?? null;
      out.over.set(id, { rect, divider });
    }
  }
  return out;
}

// ── saved forms ──────────────────────────────────────────────────────────────

/** The desk.json form before PIE-412: binary splits by ratio. The desk still writes it (it only makes pairs). */
export type BinaryForm<L> = L | { t: "split"; dir: Axis; ratio: number; a: BinaryForm<L>; b: BinaryForm<L> };
export type NaryForm<L> = L | { t: "split"; dir: Axis; kids: NaryForm<L>[]; weights: number[]; key?: string };

/** Read either saved form (binary `ratio a b` or `kids weights`), making each leaf with `leafOf`. */
export function revive<L extends { t: "leaf" }, I>(s: BinaryForm<L> | NaryForm<L>, leafOf: (l: L) => I): LNode<I> {
  if (s.t === "leaf") return leaf(leafOf(s as L));
  const x = s as any;
  const dir: Axis = x.dir === "col" ? "col" : "row";
  if (Array.isArray(x.kids)) {
    const kids = x.kids.map((k: any) => revive(k, leafOf));
    // Weights that aren't positive, finite numbers (or don't match the kids) fall back to equal shares.
    const ok = Array.isArray(x.weights) && x.weights.length === kids.length && x.weights.every(good);
    return splitOf(dir, kids, ok ? [...x.weights] : undefined, typeof x.key === "string" ? x.key : undefined);
  }
  const ratio = good(x.ratio) && x.ratio < 1 ? x.ratio : 0.5;
  return pair(dir, ratio, revive(x.a, leafOf), revive(x.b, leafOf));
}

const good = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w > 0;

/** Write a tree, pairs in the binary form (so an older door still reads it), anything wider as kids and weights. */
export function serialize<I, L>(n: LNode<I>, leafOf: (id: I) => L): BinaryForm<L> | NaryForm<L> {
  if (n.t === "leaf") return leafOf(n.id);
  if (n.kids.length === 2 && !n.key) {
    const sum = n.weights[0]! + n.weights[1]! || 1;
    return { t: "split", dir: n.dir, ratio: n.weights[0]! / sum, a: serialize(n.kids[0]!, leafOf) as BinaryForm<L>, b: serialize(n.kids[1]!, leafOf) as BinaryForm<L> };
  }
  return { t: "split", dir: n.dir, kids: n.kids.map(k => serialize(k, leafOf) as NaryForm<L>), weights: [...n.weights], ...(n.key ? { key: n.key } : {}) };
}

/** The tree as `peek` shows it: each pane by name with its share of its split. */
export type LayoutView = { pane: string; share: number; fixed?: number } | { split: Axis; key?: string; share: number; kids: LayoutView[] };
export function describeTree<I>(n: LNode<I>, name: (id: I) => string, opts: PlaceOpts<I> = {}, sh = 1, parent: Axis = "row"): LayoutView {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (n.t === "leaf") { const f = opts.fixed?.(n.id, parent); return { pane: name(n.id), share: round(sh), ...(f !== undefined ? { fixed: f } : {}) }; }
  const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
  return { split: n.dir, ...(n.key ? { key: n.key } : {}), share: round(sh), kids: n.kids.map((k, i) => describeTree(k, name, opts, n.weights[i]! / sum, n.dir)) };
}
