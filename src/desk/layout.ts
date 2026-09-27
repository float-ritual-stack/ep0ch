// Tiling layout: a binary tree of splits over pane ids. Pure functions; the desk owns the tree.
import type { Rect } from "../canvas";

export type Dir = "left" | "right" | "up" | "down";
export type LNode =
  | { t: "leaf"; id: number }
  | { t: "split"; dir: "row" | "col"; ratio: number; a: LNode; b: LNode };   // row = side by side

const MIN = 6;

export function leaves(n: LNode): number[] {
  return n.t === "leaf" ? [n.id] : [...leaves(n.a), ...leaves(n.b)];
}

export interface Placed { rects: Map<number, Rect>; dividers: Divider[] }
export interface Divider { node: Extract<LNode, { t: "split" }>; area: Rect; at: number }

export function place(n: LNode, r: Rect, out: Placed = { rects: new Map(), dividers: [] }): Placed {
  if (n.t === "leaf") { out.rects.set(n.id, r); return out; }
  if (n.dir === "row") {
    const wa = Math.max(MIN, Math.min(r.cols - MIN, Math.round(r.cols * n.ratio)));
    out.dividers.push({ node: n, area: r, at: r.col + wa });
    place(n.a, { ...r, cols: wa }, out);
    place(n.b, { ...r, col: r.col + wa, cols: r.cols - wa }, out);
  } else {
    const ha = Math.max(3, Math.min(r.rows - 3, Math.round(r.rows * n.ratio)));
    out.dividers.push({ node: n, area: r, at: r.row + ha });
    place(n.a, { ...r, rows: ha }, out);
    place(n.b, { ...r, row: r.row + ha, rows: r.rows - ha }, out);
  }
  return out;
}

/** Split leaf `id` so `add` appears beside it; along its longer axis unless told. */
export function split(n: LNode, id: number, add: number, r: Rect, dir?: "row" | "col"): LNode {
  if (n.t === "leaf") {
    if (n.id !== id) return n;
    return { t: "split", dir: dir ?? (r.cols >= r.rows * 2.2 ? "row" : "col"), ratio: 0.5, a: n, b: { t: "leaf", id: add } };
  }
  return { ...n, a: split(n.a, id, add, r, dir), b: split(n.b, id, add, r, dir) };
}

export function remove(n: LNode, id: number): LNode | null {
  if (n.t === "leaf") return n.id === id ? null : n;
  const a = remove(n.a, id), b = remove(n.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...n, a, b };
}

/** Dock: pull a pane out and put it along one whole edge of the screen. */
export function dock(root: LNode, id: number, edge: Dir): LNode {
  const rest = remove(root, id);
  const leaf: LNode = { t: "leaf", id };
  if (!rest) return leaf;
  if (edge === "left") return { t: "split", dir: "row", ratio: 0.26, a: leaf, b: rest };
  if (edge === "right") return { t: "split", dir: "row", ratio: 0.72, a: rest, b: leaf };
  if (edge === "up") return { t: "split", dir: "col", ratio: 0.3, a: leaf, b: rest };
  return { t: "split", dir: "col", ratio: 0.7, a: rest, b: leaf };
}

/** Grow or shrink the pane along an axis by moving the nearest enclosing divider. */
export function resize(n: LNode, id: number, dir: "row" | "col", delta: number): boolean {
  if (n.t === "leaf") return false;
  const inA = leaves(n.a).includes(id), inB = !inA && leaves(n.b).includes(id);
  if (!inA && !inB) return false;
  if (resize(inA ? n.a : n.b, id, dir, delta)) return true;
  if (n.dir !== dir) return false;
  n.ratio = Math.max(0.1, Math.min(0.9, n.ratio + (inA ? delta : -delta)));
  return true;
}

/** The pane whose rect lies in `dir` from `from`, nearest by edge gap then by centre offset. */
export function neighbour(rects: Map<number, Rect>, from: number, dir: Dir): number | null {
  const a = rects.get(from);
  if (!a) return null;
  const cx = a.col + a.cols / 2, cy = a.row + a.rows / 2;
  let best: number | null = null, score = Infinity;
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

/** Divider under a cell, for mouse drags. Borders of both neighbours count as the divider. */
export function dividerAt(dividers: Divider[], x: number, y: number): Divider | null {
  for (const d of dividers) {
    const r = d.area;
    if (d.node.dir === "row" && (x === d.at || x === d.at - 1) && y >= r.row && y < r.row + r.rows) return d;
    if (d.node.dir === "col" && (y === d.at || y === d.at - 1) && x >= r.col && x < r.col + r.cols) return d;
  }
  return null;
}

export function dragTo(d: Divider, x: number, y: number): void {
  const r = d.area;
  d.node.ratio = d.node.dir === "row"
    ? Math.max(0.08, Math.min(0.92, (x - r.col + 0.5) / r.cols))
    : Math.max(0.08, Math.min(0.92, (y - r.row + 0.5) / r.rows));
}
