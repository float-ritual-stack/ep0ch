// The layout tree (PIE-412): tiles in containers, one engine for the desk and every screen built on it (the
// board is one, PIE-511). A split lays its kids side by side (row) or one over another (col), each by its
// weight. A tab set (PIE-413) stacks tiles in one place, one of them shown. A drawer (PIE-505) holds any tiles
// and slides out over the others from an edge: it's placed as if it were docked, and nothing else moves for
// it; shut, it takes no room. Columns (PIE-511) are tiles side by side in an order that comes from data (its
// `source`: the board's lanes are a hub's views), each resizable. A flow (PIE-513) is the river's columns: each
// opens into the next, and they squeeze full → peek → spine around the wide one (`flow.ts`). Every container
// carries a policy (what it allows: drags, drops, which kinds, resizing, locked), saved with the screen. Around
// the tree a screen has floats: tiles with their own rectangle, above everything.
//
// Internal to the screen-layout module (`screen-layout.ts`, PIE-513): pure tree arithmetic. Nothing outside the
// module changes a tree; it asks the module to apply an operation, and reads what these queries say.
//
// The tile operations (move beside, into tabs, to an outer edge, normalise) are floatty's binary-tree
// model (`moveLeafToTarget`, `moveLeafToRoot`, `removeNode`'s collapse, `clampRatio`) ported to n-ary
// splits by weight: a move beside a tile inside a split along the same axis joins that split instead of
// nesting a new pair.
import type { Rect } from "../canvas";
import { placeFlow, tidyFlow, type Cover, type PlacedColumn } from "./flow";

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
  /** Its tiles close (tile.close, ^W x); off, they stay (the board's preview and lanes: they fold to a spine instead). */
  closable?: boolean;
  /** The tile kinds it takes (any when left out): a locked board's columns take only query tiles. */
  accepts?: string[];
  /** Its borders move (a drag, layout.resize, tile.resize, layout.even). */
  resizable?: boolean;
  /** Its size along its parent's axis, in cells: at least `min`, at most `max`, or exactly `fixed`. */
  min?: number; max?: number; fixed?: number;
  /** A drawer can slide shut (to its handle on the hint row). */
  collapsible?: boolean;
  /** A drawer slides over the others (true, the default) or takes its room while open (false). */
  overlay?: boolean;
  /** An open drawer stays open when the keys leave it (the board's backlinks: read a source, the list stays); it shuts by its key. */
  stays?: boolean;
  /** Task mode: the shape is fixed, the contents stay live. Unlocking is one key (alt+k), a click or `layout.lock`. */
  locked?: boolean;
  /** Where opens from its tiles land when a tile has no link of its own: a tile's name. */
  opensInto?: string;
  /**
   * The open rule (PIE-513; was the layout's `rule`): where an open from one of its tiles lands when no link or
   * opens-into says: the current note (`current`), a new column right after the tile's own in its flow (`next`, a
   * flow's own rule when it says none), or a reader beside the tile, which stays on its own note (`beside`, PIE-515:
   * a pinned page, the brief).
   */
  opens?: OpenRule;
  /**
   * A screen's own (its outermost policy, PIE-513): where the host layer (the agent, the admin outline, terminals,
   * above every screen) may appear over it: `beside` it (the screen narrower), `over` it (a drawer, the default),
   * or `none` (a full-screen screen: the host layer stays put away while it's shown).
   */
  host?: HostMode;
}
/** Where the host layer may appear over a screen. */
export type HostMode = "beside" | "over" | "none";
/** Where an open with no link lands: the current note, the next column of the flow it's in, or a reader beside it. */
export type OpenRule = "current" | "next" | "beside";
export const POLICY_KEYS = ["draggable", "droppable", "closable", "accepts", "resizable", "min", "max", "fixed", "collapsible", "overlay", "stays", "locked", "opensInto", "opens", "host"] as const;

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
/**
 * Columns (PIE-511): tiles side by side, in the order their `source` gives (`hub:<id>`: a hub's views, one
 * query tile each), each with its own weight. It stays when it has one tile or none (its tiles come and go
 * with the data), and never merges into the split around it. Placed as a row split is.
 */
export type Columns<I = number> = { t: "columns"; dir: "row"; kids: LNode<I>[]; weights: number[]; source?: string; key?: string; id?: string; policy?: Policy };
/** Tiles stacked in one place (PIE-413): `active` is the one shown; the others keep their state. `id` as a split's. */
export type Tabs<I = number> = { t: "tabs"; ids: I[]; active: number; id?: string; policy?: Policy };
/**
 * A drawer (PIE-505): a container holding any tiles (a tile, a tab set, a split of them) that slides out from
 * its `edge` over the others, or shuts to a handle. It sits in its parent split where it docks (its weight is
 * its size when open); `overlay: false` in its policy makes it take that room while open instead.
 */
export type Drawer<I = number> = { t: "drawer"; kid: LNode<I>; edge: Dir; open: boolean; id?: string; policy?: Policy };
/**
 * A flow (PIE-513): the river's columns as a container. Its kids are columns side by side (a tile, or tiles
 * stacked in a col split), squeezed full, peek or spine around the `anchor` by `flow.ts`, never by weight. It stays
 * with one column. Its memory names columns by a tile in them: the wide one (`anchor`), the one kept full beside it
 * (`keep`), the one the person read before (`read`), the docked ones, and the trail back and forward.
 */
export type Flow<I = number> = {
  t: "flow"; dir: "row"; kids: LNode<I>[]; weights: number[];
  anchor?: I; keep?: I; read?: I; docked?: I[]; trail?: { tile: I; from?: I; ahead?: I }[];
  key?: string; id?: string; policy?: Policy;
};
const hasPolicy = (n: { policy?: Policy }) => !!n.policy && Object.keys(n.policy).length > 0;
const idOf = (n: { id?: string; policy?: Policy }) => ({ ...(n.id ? { id: n.id } : {}), ...(n.policy && Object.keys(n.policy).length ? { policy: { ...n.policy } } : {}) });
export type LNode<I = number> = { t: "leaf"; id: I } | Split<I> | Tabs<I> | Drawer<I> | Columns<I> | Flow<I>;
/** What holds tiles: a split, a tab set, a drawer, columns, a flow. */
export type Container<I = number> = Split<I> | Tabs<I> | Drawer<I> | Columns<I> | Flow<I>;
/** What lays its kids out along an axis: a split or columns (a row) by weight; a flow (a row) by its squeeze. */
export type Line<I = number> = Split<I> | Columns<I> | Flow<I>;
export const isLine = <I>(n: LNode<I> | null | undefined): n is Line<I> => !!n && (n.t === "split" || n.t === "columns" || n.t === "flow");
/** A flow of `kids`, built around the first column unless told (`anchor`). */
export const flowOf = <I>(kids: LNode<I>[], o: { key?: string; policy?: Policy; anchor?: I } = {}): Flow<I> =>
  ({ t: "flow", dir: "row", kids, weights: kids.map(() => 1), ...(o.anchor !== undefined ? { anchor: o.anchor } : {}), ...(o.key ? { key: o.key } : {}), ...(o.policy ? { policy: o.policy } : {}) });
/** Columns of `kids` from `source`, equal unless weighed. */
export const columnsOf = <I>(kids: LNode<I>[], o: { source?: string; key?: string; weights?: number[]; policy?: Policy } = {}): Columns<I> =>
  ({ t: "columns", dir: "row", kids, weights: o.weights ?? kids.map(() => 1), ...(o.source ? { source: o.source } : {}), ...(o.key ? { key: o.key } : {}), ...(o.policy ? { policy: o.policy } : {}) });

/** How a view sizes its panes as they're placed. */
export interface PlaceOpts<I> {
  /** A pane squeezed to this many cells along the split's axis (a spine): its share goes to the others. */
  fixed?(id: I, dir: Axis): number | undefined;
  /** The fewest cells a kid may have along its parent's axis (default 6 across a row, 3 down a col). */
  min?(n: LNode<I>, dir: Axis, parent: Line<I>): number | undefined;
  /** A pane that keeps the size its weight gives it (a drawer): a neighbour takes what rounding leaves. */
  sized?(id: I): boolean;
  /** The drawers placed as if docked, open or shut (where an open one slides out to): every one, or those it names. */
  docked?: boolean | ((d: Drawer<I>) => boolean);
  /** A tile holding work (a draft): its flow column resists compression. */
  holds?(id: I): boolean;
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
  /** Each tile in a flow: full, peek or spine (PIE-513). */
  covers?: Map<I, Cover>;
  /** A peek's whole box, its right side under its neighbour (its rect is what shows). */
  boxes?: Map<I, Rect>;
  /** Each flow met: where it is, and each column shown. */
  flows?: { node: Flow<I>; rect: Rect; cols: PlacedColumn[] }[];
}
/** The border between `node.kids[i]` and `kids[i + 1]`: `at` is the first cell of the second. */
export interface Divider<I = number> { node: Line<I>; i: number; area: Rect; at: number; sizes: [number, number] }

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
/** A container's kids: a split's or columns', a drawer's one; a tab set's tiles aren't nodes. */
export const kidsOf = <I>(n: LNode<I>): LNode<I>[] => (isLine(n) ? n.kids : n.t === "drawer" ? [n.kid] : []);
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

/** The named split (or columns), if it's in the tree. */
export function node<I>(n: LNode<I>, key: string): Line<I> | null {
  if (n.t === "drawer") return node(n.kid, key);
  if (!isLine(n)) return null;
  if (n.key === key) return n;
  for (const k of n.kids) { const f = node(k, key); if (f) return f; }
  return null;
}

/** The split (or columns) holding the leaf `id` (or the named split `key`) directly, and where. A tile in a tab set is where its tab set is. */
export function parentOf<I>(n: LNode<I>, target: I | { key: string }): { parent: Line<I>; i: number } | null {
  if (n.t === "drawer") return parentOf(n.kid, target);
  if (!isLine(n)) return null;
  const i = n.kids.findIndex(k => (typeof target === "object" && target !== null && "key" in target ? isLine(k) && k.key === target.key : (k.t === "leaf" && k.id === target) || (k.t === "tabs" && k.ids.includes(target as I))));
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
  // A flow squeezes its columns around its anchor (flow.ts); nothing there is by weight.
  if (n.t === "flow") return placeFlow(n, r, opts, out, place);
  if (n.key) out.nodes.set(n.key, r);
  // Columns are placed as a row split is.
  const row = n.dir === "row", S = row ? r.cols : r.rows;
  // A tab set is sized as the tab it shows (a drawer's tab set slides over like a drawer). A drawer sliding
  // over, or shut, takes no room (unless placed as docked); a container's policy can fix its size.
  const fixed = n.kids.map(k => (k.t === "leaf" ? opts.fixed?.(k.id, n.dir) : k.t === "tabs" && k.ids[k.active] !== undefined ? opts.fixed?.(k.ids[k.active]!, n.dir) ?? cells(k.policy?.fixed)
    : k.t === "drawer" && !(opts.docked === true || (typeof opts.docked === "function" && opts.docked(k))) && (!k.open || k.policy?.overlay !== false) ? 0 : cells(k.policy?.fixed)));
  const mins = n.kids.map(k => cells(k.t !== "leaf" ? k.policy?.min : undefined) ?? opts.min?.(k, n.dir, n) ?? (row ? MIN_COLS : MIN_ROWS));
  const maxs = n.kids.map(k => cells(k.t !== "leaf" ? k.policy?.max : undefined));
  const open = n.kids.map((_, i) => i).filter(i => fixed[i] === undefined);
  // Within the room there is (a small terminal, a policy's min or fixed larger than the screen): the fixed sizes
  // leave each other kid a cell, and the minimums shrink together to what's left, so no tile gets nothing or lands
  // off the screen while there's a cell for it.
  fit(fixed, Math.max(0, S - Math.min(open.length, S)));
  fit(mins, Math.max(0, S - fixed.reduce<number>((a, f) => a + (f ?? 0), 0)), open);
  let room = S - fixed.reduce<number>((a, f) => a + (f ?? 0), 0);
  // A kid held to its `max` gives the rest of its share back to the others by their weights (not all of it to the
  // last one): the welcome's list at its 30 columns leaves the detail and the preview their proportions. One kid is
  // left to take what rounding leaves (the flex), never one held to its max while another can.
  const capped = new Set<number>();
  for (let again = true; again;) {
    again = false;
    const free = open.filter(i => !capped.has(i));
    const w = free.reduce((a, i) => a + n.weights[i]!, 0) || 1;
    for (const i of free) if (free.length > 1 && maxs[i] !== undefined && (room * n.weights[i]!) / w > maxs[i]!) { capped.add(i); room -= maxs[i]!; again = true; break; }
  }
  const flexible = open.filter(i => !capped.has(i));
  const flex = [...flexible].reverse().find(i => { const k = n.kids[i]!; return !(k.t === "leaf" && opts.sized?.(k.id)); }) ?? flexible.at(-1) ?? open.at(-1);
  const wsum = open.filter(i => !capped.has(i)).reduce((a, i) => a + n.weights[i]!, 0) || 1;
  const need = (i: number) => fixed[i] ?? mins[i]!;
  const sizes: (number | null)[] = n.kids.map((_, i) => fixed[i] ?? null);
  let used = fixed.reduce<number>((a, f) => a + (f ?? 0), 0);
  for (const i of open) {
    if (i === flex) continue;
    const later = open.filter(j => j !== i && sizes[j] === null).reduce((a, j) => a + need(j), 0);
    const hi = S - used - later;
    const size = Math.max(mins[i]!, Math.min(hi, maxs[i] ?? Infinity, capped.has(i) ? maxs[i]! : Math.round((room * n.weights[i]!) / wsum)));
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

/**
 * Shrink the sizes at `which` (every one given, by default) together so they add up to at most `room`: each in
 * proportion, at least one cell while the room has one for each. Changes `xs` in place.
 */
function fit(xs: (number | undefined)[], room: number, which: number[] = xs.map((_, i) => i)): void {
  const at = which.filter(i => xs[i] !== undefined && xs[i]! > 0);
  const sum = at.reduce((a, i) => a + xs[i]!, 0);
  if (sum <= room) return;
  const floor = room >= at.length ? 1 : 0;
  for (const i of at) xs[i] = Math.max(floor, Math.floor((xs[i]! * room) / sum));
  // Still over (each kept its one cell): the largest give way first.
  let over = at.reduce((a, i) => a + xs[i]!, 0) - room;
  for (const i of [...at].sort((a, b) => xs[b]! - xs[a]!)) { if (over <= 0) break; const give = Math.min(over, xs[i]! - floor); xs[i] = xs[i]! - give; over -= give; }
}

// ── changing the tree ─────────────────────────────────────────────────────────

/**
 * Put `add` beside the leaf `id` (or the named split): a new split of the two, `add` after it (or before),
 * taking `weight` of it. Along the target's longer axis unless told. The desk's split.
 */
export function beside<I>(root: LNode<I>, target: I | { key: string }, add: LNode<I>, o: { dir: Axis; before?: boolean; weight?: number; key?: string }): LNode<I> {
  const w = o.weight ?? 0.5;
  const wrap = (n: LNode<I>): Split<I> => splitOf(o.dir, o.before ? [add, n] : [n, add], o.before ? [w, 1 - w] : [1 - w, w], o.key);
  const isTarget = (n: LNode<I>) => (typeof target === "object" && target !== null && "key" in target ? isLine(n) && n.key === target.key : (n.t === "leaf" && n.id === target) || (n.t === "tabs" && n.ids.includes(target as I)));
  const go = (n: LNode<I>): LNode<I> => {
    if (isTarget(n)) return wrap(n);
    if (n.t === "drawer") return { ...n, kid: go(n.kid) };
    if (!isLine(n)) return n;
    return { ...n, kids: n.kids.map(go) };
  };
  return go(root);
}

/** Split leaf `id` so `add` appears beside it, half each; along its longer axis unless told (the desk's `^W o`). */
export function split<I>(n: LNode<I>, id: I, add: I, r: Rect, dir?: Axis): LNode<I> {
  return beside(n, id, leaf(add), { dir: dir ?? (r.cols >= r.rows * 2.2 ? "row" : "col") });
}

/** Add a leaf to the named split (or columns) at `index` (default the end) with `weight`. */
export function insert<I>(root: LNode<I>, key: string, add: LNode<I>, weight: number, index?: number): LNode<I> {
  const go = (n: LNode<I>): LNode<I> => {
    if (n.t === "drawer") return { ...n, kid: go(n.kid) };
    if (!isLine(n)) return n;
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
  // Columns stay with one tile or none: their tiles come and go with the data.
  if (n.t === "columns") return { ...n, kids, weights };
  // A flow stays with one column (it still opens into the next); empty, it's gone unless named.
  if (n.t === "flow") return kids.length || n.key ? tidyFlow({ ...n, kids, weights }) : null;
  if (!kids.length) return null;
  // A split that carries a policy stays with one kid, as a named one does: its rule outlives the move.
  if (kids.length === 1 && !n.key && !hasPolicy(n)) return kids[0]!;
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
  if (!isLine(n)) return false;
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
export function even<I>(n: LNode<I>, skip?: (n: Line<I>) => boolean): void {
  if (n.t === "drawer") return even(n.kid, skip);
  if (!isLine(n)) return;
  n.kids.forEach(k => even(k, skip));
  // A flow's columns aren't sized by weight: its squeeze sizes them.
  if (skip?.(n) || n.t === "flow") return;
  // A drawer's weight is its size when it slides out: it keeps its share, and the docked kids share the rest.
  const total = n.weights.reduce((a, w) => a + w, 0) || 1;
  const kept = n.kids.reduce((a, k, i) => a + (k.t === "drawer" ? n.weights[i]! / total : 0), 0);
  const docked = n.kids.filter(k => k.t !== "drawer").length;
  n.weights = n.kids.map((k, i) => (k.t === "drawer" ? n.weights[i]! / total : (1 - kept) / docked));
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

// ── a screen: the tree, the drawers sliding over it, the floats ─────────────

/** A tile with its own rectangle, above everything (`tile.float`): which tile, and where. */
export interface Float<I = number> { id: I; rect: Rect }
export interface ScreenLayout<I = number> {
  root: LNode<I>;
  /** Tiles with their own rectangle, drawn above everything, last on top. */
  floats: Float<I>[];
}

export interface PlacedScreen<I = number> extends Placed<I> {
  /**
   * Each open drawer container sliding over (PIE-505), bottom first: where it slid out to, the border it
   * shares with its neighbour there (a drag sizes it), and its tiles placed inside it.
   */
  slid: PlacedDrawer<I>[];
}
export interface PlacedDrawer<I = number> { node: Drawer<I>; rect: Rect; divider: Divider<I> | null; placed: Placed<I> }

/** The drawers in a layer of the tree: those in it, not inside another drawer. */
function drawersIn<I>(n: LNode<I>): Drawer<I>[] { return n.t === "drawer" ? [n] : isLine(n) ? n.kids.flatMap(drawersIn) : []; }

/**
 * Place a screen: the docked tiles as if the sliding drawers took no room (the tree itself is placed and its
 * borders are the real splits a drag changes), then each open drawer container (PIE-505) where docking would
 * put it, its own tiles (and any drawer inside it) placed in the room it slid out to. Floats keep their own
 * rectangles; the view draws them last.
 */
export function placeScreen<I>(s: ScreenLayout<I>, r: Rect, opts: PlaceOpts<I> = {}): PlacedScreen<I> {
  const base = place(s.root, r, opts);
  const out: PlacedScreen<I> = { ...base, slid: [] };
  const slide = (layer: LNode<I>, area: Rect) => {
    const open = drawersIn(layer).filter(d => d.open && d.policy?.overlay !== false);
    if (!open.length) return;
    for (const d of open) {
      // Where it lands docked, the others in this layer as they are (another drawer here takes no room).
      const full = place(layer, area, { ...opts, docked: x => x === d });
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
  return { ...n, kids: n.kids.map(k => mapSlot(k, id, f)) } as LNode<I>;
}

/**
 * Put `add` beside the slot holding `target` (its tab set, when it's in one), on the `dir` side, taking half
 * of the slot's room. Inside a split along the same axis it joins that split (n-ary) instead of nesting a pair.
 */
export function besideSlot<I>(root: LNode<I>, target: I, add: LNode<I>, dir: Dir, weight = 0.5): LNode<I> {
  const axis = axisOf(dir);
  const p = parentOf(root, target);
  // Beside a tile in a split along the same axis (or in columns or a flow, across), it joins it: in a flow, a new column.
  if (p && p.parent.dir === axis && (!p.parent.key || p.parent.t === "columns" || p.parent.t === "flow")) {
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
/** The split (or columns) holding container `c` as a kid, and where. */
export function parentNode<I>(root: LNode<I>, c: LNode<I>): { parent: Line<I>; i: number } | null {
  if (root.t === "drawer") return parentNode(root.kid, c);
  if (!isLine(root)) return null;
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
    return keepsDocked(toEdge(r, { t: "drawer", kid, edge: to, open }, weight));
  }
  const p = parentOf(root, id);
  const edge = p ? edgeAt(p.parent.dir, p.i, p.parent.kids.length) : "left";
  return keepsDocked(mapSlot(root, id, slot => ({ t: "drawer", kid: slot, edge, open })));
}
/** The tiles docked: in no drawer. A screen keeps at least one, or a drawer has nothing to slide over. */
export function dockedTiles<I>(n: LNode<I>): I[] { return n.t === "drawer" ? [] : n.t === "leaf" || n.t === "tabs" ? leaves(n) : kidsOf(n).flatMap(k => dockedTiles(k)); }
/** The tree, when a tile is still docked in it; else null (every tile would be in a drawer: a blank screen). */
const keepsDocked = <I>(n: LNode<I> | null): LNode<I> | null => (n && dockedTiles(n).length ? n : null);
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
/**
 * Move drawer `d` to outer edge `to` of the whole layout, keeping what it holds, its id and policy. A drawer that is
 * the first or last of the whole layout along its own axis keeps the share of the screen it slides out to (the
 * board's outline is 0.3 of it, and `S` moving it across keeps that; moved to a top or bottom edge, 0.3 of the
 * height). Any other drawer takes `weight`, else 0.26.
 */
export function drawerToEdge<I>(root: LNode<I>, d: Drawer<I>, to: Dir, weight?: number): LNode<I> | null {
  const rest = without(root, d);
  if (!rest) return null;
  const p = parentNode(root, d);
  const atEnd = !!p && (p.i === 0 || p.i === p.parent.kids.length - 1);
  const outer = p && atEnd && p.parent === root && p.parent.dir === axisOf(d.edge) ? p.parent.weights[p.i]! / (p.parent.weights.reduce((a, w) => a + w, 0) || 1) : null;
  return toEdge(rest, { ...d, edge: to }, weight ?? (outer !== null && outer > 0 && outer < 1 ? outer : 0.26));
}
/**
 * Put container `c` (a split of tiles, say) in a drawer where it is, sliding from the edge it sits at; with `to`,
 * along that outer edge of the whole layout. Null when it's the whole layout, or in a drawer already.
 */
export function wrapNodeDrawer<I>(root: LNode<I>, c: Container<I>, to?: Dir, open = true, weight = 0.26): LNode<I> | null {
  if (root === c || chainOfNode(root, c).some(n => n.t === "drawer")) return null;
  if (to) {
    const rest = without(root, c);
    if (!rest) return null;
    return keepsDocked(toEdge(rest, { t: "drawer", kid: c, edge: to, open }, weight));
  }
  const p = parentNode(root, c);
  if (!p) return null;
  // Every other tile in a drawer already: this one is what's left docked.
  if (!dockedTiles(root).some(id => !leaves(c).includes(id))) return null;
  const edge = edgeAt(p.parent.dir, p.i, p.parent.kids.length);
  p.parent.kids[p.i] = { t: "drawer", kid: c, edge, open };
  return root;
}
/** The containers from the root down to container `c` (not `c` itself), outermost first. */
function chainOfNode<I>(n: LNode<I>, c: LNode<I>): Container<I>[] {
  if (n === c || n.t === "leaf" || n.t === "tabs") return [];
  for (const k of kidsOf(n)) { if (k === c || containsNode(k, c)) return [n, ...chainOfNode(k, c)]; }
  return [];
}
const containsNode = <I>(n: LNode<I>, c: LNode<I>): boolean => n === c || kidsOf(n).some(k => containsNode(k, c));

/** The tree with node `c` taken out (its split gives way as a tile's does). */
function without<I>(n: LNode<I>, c: LNode<I>): LNode<I> | null {
  if (n === c) return null;
  if (n.t === "drawer") { const k = without(n.kid, c); return k ? { ...n, kid: k } : null; }
  if (!isLine(n)) return n;
  const kids: LNode<I>[] = [], weights: number[] = [];
  n.kids.forEach((k, i) => { const r = without(k, c); if (r) { kids.push(r); weights.push(n.weights[i]!); } });
  if (n.t === "columns") return { ...n, kids, weights };
  // A flow stays with one column (it still opens into the next), as `remove` keeps it; empty, it's gone unless named.
  if (n.t === "flow") return kids.length || n.key ? tidyFlow({ ...n, kids, weights }) : null;
  if (!kids.length) return null;
  if (kids.length === 1 && !n.key && !hasPolicy(n)) return kids[0]!;
  return { ...n, kids, weights };
}
/** Drawer `d` gives way to what it holds, docked where it was. */
export function unwrapDrawer<I>(root: LNode<I>, d: Drawer<I>): LNode<I> {
  const go = (n: LNode<I>): LNode<I> => (n === d ? d.kid : n.t === "drawer" ? { ...n, kid: go(n.kid) } : isLine(n) ? { ...n, kids: n.kids.map(go) } : n);
  return go(root);
}

/** What applies to a tile, from the screen's policy down through its containers to its kind's default. */
export interface Effective {
  locked: boolean; draggable: boolean; droppable: boolean; closable: boolean; resizable: boolean; collapsible: boolean;
  accepts: string[] | null; opensInto: string | null;
  /** The open rule: an open with no link lands as the current note, or in a new column after its own (a flow's). */
  opens: OpenRule;
  /** Which layer said each: "screen", a container's id, or "kind". */
  by: Partial<Record<keyof Policy, string>>;
}
/**
 * The policy in effect under `layers` (outermost first, each with who it is): the nearest that says a field
 * wins, and `locked` anywhere locks everything under it.
 */
export function effective(layers: { by: string; policy?: Policy; flow?: boolean }[]): Effective {
  const out: Effective = { locked: false, draggable: true, droppable: true, closable: true, resizable: true, collapsible: true, accepts: null, opensInto: null, opens: "current", by: {} };
  for (const { by, policy: p, flow } of layers) {
    // A flow's own rule, when it says none: its tiles open into the next column.
    if (flow && !p?.opens) { out.opens = "next"; out.by.opens = by; }
    if (!p) continue;
    if (p.opens) { out.opens = p.opens; out.by.opens = by; }
    if (p.locked) { out.locked = true; out.by.locked ??= by; }
    for (const k of ["draggable", "droppable", "closable", "resizable", "collapsible"] as const) if (p[k] !== undefined) { out[k] = p[k]!; out.by[k] = by; }
    if (p.accepts) { out.accepts = p.accepts; out.by.accepts = by; }
    if (p.opensInto) { out.opensInto = p.opensInto; out.by.opensInto = by; }
  }
  return out;
}

/** Drop the ids (`s<n>`, `g<n>`, `d<n>`, `c<n>`, `f<n>`) of the splits, tab sets, drawers, columns and flows whose number `gone` says was given out already. */
export function forgetIds<I>(n: LNode<I>, gone: (num: number) => boolean): void {
  if (n.t === "leaf") return;
  const m = n.id ? /^[sgdcf](\d+)$/.exec(n.id) : null;
  if (n.id && (!m || gone(Number(m[1])))) delete n.id;
  for (const k of kidsOf(n)) forgetIds(k, gone);
}

/** A copy of the tree's shape (the ids themselves are kept). */
export function clone<I>(n: LNode<I>): LNode<I> {
  if (n.t === "leaf") return { t: "leaf", id: n.id };
  if (n.t === "tabs") return { t: "tabs", ids: [...n.ids], active: n.active, ...idOf(n) };
  if (n.t === "drawer") return { ...n, kid: clone(n.kid), ...idOf(n) };
  if (n.t === "flow") return { ...n, kids: n.kids.map(clone), weights: [...n.weights], ...(n.docked ? { docked: [...n.docked] } : {}), ...(n.trail ? { trail: n.trail.map(t => ({ ...t })) } : {}), ...idOf(n) };
  return { ...n, kids: n.kids.map(clone), weights: [...n.weights], ...idOf(n) } as LNode<I>;
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
  if (n.t === "flow") {
    // Its columns as they are, each a column (a split along its row joins it as columns); its memory kept to them.
    const kids: LNode<I>[] = [];
    n.kids.forEach(k0 => { const k = normalise(k0, min, false); if (empty(k)) return; if (k.t === "split" && k.dir === "row" && !k.key && !k.policy) kids.push(...k.kids); else kids.push(k); });
    return tidyFlow({ ...n, kids, weights: kids.map(() => 1) });
  }
  if (n.t === "columns") {
    // Its tiles as they are (none is fine), each weight positive; nothing merges into it or out of it.
    const kids: LNode<I>[] = [], weights: number[] = [];
    n.kids.forEach((k0, i) => { const k = normalise(k0, min, false); if (!empty(k)) { kids.push(k); weights.push(good(n.weights[i]) ? n.weights[i]! : 1); } });
    return { ...n, kids, weights };
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
  // A split left with one kid gives way to it, unless it's named or carries a policy (its rule stays with the
  // place: a tile moved back in is under it again).
  if (kids.length === 1 && !n.key && !hasPolicy(n)) {
    let only = kids[0]!;
    // At the top a lone drawer has nothing to slide over: it's what it holds.
    if (top && only.t === "drawer") only = only.kid;
    return only;
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
export type BinaryForm<L> = L | { t: "split"; dir: Axis; ratio: number; a: BinaryForm<L>; b: BinaryForm<L>; id?: string; policy?: Policy } | DrawerForm<L> | ColumnsForm<L> | FlowForm<L>;
export type NaryForm<L> = L | { t: "split"; dir: Axis; kids: NaryForm<L>[]; weights: number[]; key?: string; id?: string; policy?: Policy } | TabsForm<L> | DrawerForm<L> | ColumnsForm<L> | FlowForm<L>;
/**
 * A flow as saved (PIE-513): its columns, and its memory by column number (0 the first): the wide one, the one kept
 * full, the one read before, the docked ones, and each column's way back (`from`) and forward (`ahead`).
 */
export type FlowForm<L> = { t: "flow"; kids: NaryForm<L>[]; anchor?: number; keep?: number; read?: number; docked?: number[]; trail?: { col: number; from?: number; ahead?: number }[]; key?: string; id?: string; policy?: Policy };
/** Columns as saved (PIE-511): its tiles as they were last filled, its weights, and where its tiles come from. */
export type ColumnsForm<L> = { t: "columns"; kids: NaryForm<L>[]; weights: number[]; source?: string; key?: string; id?: string; policy?: Policy };
/** A tab set as saved: its tiles and which one is shown. `id` (a split's too): absent in a form saved before PIE-491. */
export type TabsForm<L> = { t: "tabs"; tabs: L[]; active: number; id?: string; policy?: Policy };
/** A drawer as saved (PIE-505): what it holds, its edge, open or shut. */
export type DrawerForm<L> = { t: "drawer"; kid: NaryForm<L>; edge: Dir; open: boolean; id?: string; policy?: Policy };
const savedId = (x: any) => ({ ...(typeof x?.id === "string" && x.id ? { id: x.id as string } : {}), ...savedPolicy(x?.policy) });
const DIRS: readonly Dir[] = ["left", "right", "up", "down"];
/** The glyph a drawer's header, its handle and a drop into it show for the edge it slides from. */
export const EDGE_GLYPH: Record<Dir, string> = { left: "⇤", right: "⇥", up: "⤒", down: "⤓" };
/** An edge in words, as the status bar says it: "a drawer on the top". */
export const EDGE_WORD: Record<Dir, string> = { left: "left", right: "right", up: "top", down: "bottom" };
export const isDir = (x: unknown): x is Dir => typeof x === "string" && (DIRS as readonly string[]).includes(x);

/**
 * A policy as saved or as an agent gave it, kept to the fields and types it has (a hand-edited save's
 * strays dropped). Empty: none.
 */
export function policyOf(x: unknown): Policy {
  const out: Policy = {};
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  for (const k of ["draggable", "droppable", "closable", "resizable", "collapsible", "overlay", "stays", "locked"] as const) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  for (const k of ["min", "max", "fixed"] as const) { const n = cells(o[k]); if (n !== undefined) out[k] = n; }
  if (Array.isArray(o.accepts)) out.accepts = [...new Set(o.accepts.filter((a): a is string => typeof a === "string" && /^[\w.-]{1,40}$/.test(a)))];
  if (typeof o.opensInto === "string" && o.opensInto) out.opensInto = o.opensInto;
  if (o.opens === "current" || o.opens === "next" || o.opens === "beside") out.opens = o.opens;
  if (o.host === "beside" || o.host === "over" || o.host === "none") out.host = o.host;
  return out;
}
const savedPolicy = (x: unknown) => { const p = policyOf(x); return Object.keys(p).length ? { policy: p } : {}; };

/** Read either saved form (binary `ratio a b` or `kids weights`), making each leaf with `leafOf`. */
export function revive<L extends { t: "leaf" }, I>(s: BinaryForm<L> | NaryForm<L>, leafOf: (l: L) => I): LNode<I> {
  if (s.t === "leaf") return leaf(leafOf(s as L));
  const x = s as any;
  if (x.t === "drawer") return { t: "drawer", kid: x.kid ? revive(x.kid, leafOf) : { t: "tabs", ids: [], active: 0 }, edge: isDir(x.edge) ? x.edge : "left", open: x.open === true, ...savedId(x) };
  if (x.t === "flow") {
    const kids: LNode<I>[] = (Array.isArray(x.kids) ? x.kids : []).map((k: any) => revive(k, leafOf));
    const col = (i: unknown): I | undefined => (Number.isInteger(i) && (i as number) >= 0 && kids[i as number] ? leaves(kids[i as number]!)[0] : undefined);
    const f: Flow<I> = flowOf(kids, { ...(typeof x.key === "string" ? { key: x.key } : {}) });
    for (const k of ["anchor", "keep", "read"] as const) { const t = col(x[k]); if (t !== undefined) f[k] = t; }
    const docked = (Array.isArray(x.docked) ? x.docked : []).map(col).filter((t: I | undefined): t is I => t !== undefined);
    if (docked.length) f.docked = docked;
    const trail = (Array.isArray(x.trail) ? x.trail : []).map((t: any) => ({ tile: col(t?.col), from: col(t?.from), ahead: col(t?.ahead) })).filter((t: any) => t.tile !== undefined)
      .map((t: any) => ({ tile: t.tile as I, ...(t.from !== undefined ? { from: t.from as I } : {}), ...(t.ahead !== undefined ? { ahead: t.ahead as I } : {}) }));
    if (trail.length) f.trail = trail;
    return { ...tidyFlow(f), ...savedId(x) };
  }
  if (x.t === "columns") {
    const kids = (Array.isArray(x.kids) ? x.kids : []).map((k: any) => revive(k, leafOf));
    const ok = Array.isArray(x.weights) && x.weights.length === kids.length && x.weights.every(good);
    return { ...columnsOf(kids, { ...(typeof x.source === "string" && x.source ? { source: x.source } : {}), ...(typeof x.key === "string" ? { key: x.key } : {}), ...(ok ? { weights: [...x.weights] } : {}) }), ...savedId(x) };
  }
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
  if (n.t === "columns") return { t: "columns", kids: n.kids.map(k => serialize(k, leafOf) as NaryForm<L>), weights: [...n.weights], ...(n.source ? { source: n.source } : {}), ...(n.key ? { key: n.key } : {}), ...idOf(n) };
  if (n.t === "flow") {
    const col = (id: I | undefined) => (id === undefined ? -1 : n.kids.findIndex(k => leaves(k).includes(id)));
    const at = (id: I | undefined) => { const i = col(id); return i >= 0 ? i : undefined; };
    const docked = (n.docked ?? []).map(col).filter(i => i >= 0);
    const trail = (n.trail ?? []).map(t => ({ col: col(t.tile), from: at(t.from), ahead: at(t.ahead) })).filter(t => t.col >= 0 && (t.from !== undefined || t.ahead !== undefined))
      .map(t => ({ col: t.col, ...(t.from !== undefined ? { from: t.from } : {}), ...(t.ahead !== undefined ? { ahead: t.ahead } : {}) }));
    const memory = { ...(at(n.anchor) !== undefined ? { anchor: at(n.anchor) } : {}), ...(at(n.keep) !== undefined ? { keep: at(n.keep) } : {}), ...(at(n.read) !== undefined ? { read: at(n.read) } : {}), ...(docked.length ? { docked } : {}), ...(trail.length ? { trail } : {}) };
    return { t: "flow", kids: n.kids.map(k => serialize(k, leafOf) as NaryForm<L>), ...memory, ...(n.key ? { key: n.key } : {}), ...idOf(n) };
  }
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
  | { tabs: string[]; id?: string; policy?: Policy; active: string; share: number } | { drawer: Dir; open: boolean; id?: string; policy?: Policy; path: string; share: number; kid: LayoutView }
  | { columns: string | null; key?: string; id?: string; policy?: Policy; path: string; share: number; kids: LayoutView[] }
  | { flow: true; key?: string; id?: string; policy?: Policy; path: string; share: number; wide?: string; docked?: string[]; kids: LayoutView[] };
export function describeTree<I>(n: LNode<I>, name: (id: I) => string, opts: PlaceOpts<I> = {}, leafId?: (id: I) => string, sh = 1, parent: Axis = "row", path = ""): LayoutView {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (n.t === "leaf") { const f = opts.fixed?.(n.id, parent); return { pane: name(n.id), ...(leafId ? { id: leafId(n.id) } : {}), share: round(sh), ...(f !== undefined ? { fixed: f } : {}) }; }
  if (n.t === "tabs") return { tabs: n.ids.map(name), ...idOf(n), active: name(n.ids[n.active]!), share: round(sh) };
  // A drawer's kid is at path `<drawer's>.0`, as a split's first kid would be.
  if (n.t === "drawer") return { drawer: n.edge, open: n.open, ...idOf(n), path, share: round(sh), kid: describeTree(n.kid, name, opts, leafId, 1, parent, path ? `${path}.0` : "0") };
  const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
  const kids = n.kids.map((k, i) => describeTree(k, name, opts, leafId, n.weights[i]! / sum, n.dir, path ? `${path}.${i}` : String(i)));
  if (n.t === "flow") return { flow: true, ...(n.key ? { key: n.key } : {}), ...idOf(n), path, share: round(sh), ...(n.anchor !== undefined ? { wide: name(n.anchor) } : {}), ...(n.docked?.length ? { docked: n.docked.map(name) } : {}), kids };
  if (n.t === "columns") return { columns: n.source ?? null, ...(n.key ? { key: n.key } : {}), ...idOf(n), path, share: round(sh), kids };
  return { split: n.dir, ...(n.key ? { key: n.key } : {}), ...idOf(n), path, share: round(sh), kids };
}
