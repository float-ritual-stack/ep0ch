// PIE-412: the layout tree is the one pane model. The desk's binary splits place exactly as they did,
// n-ary splits share by weight around spines, drawers slide over or join the layout, borders follow the
// pointer, and the desk's saved form reads both forms and writes kids and weights. Pure functions (and one desk
// started from a hand-broken save): the tree arithmetic inside the screen-layout module (its rules are tested
// through its interface, screen-layout.test.ts).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rect } from "../src/canvas";
import {
  columnsOf, dividerAt, dragShare, drawerOf, drawers, drawerToEdge, even, grow, leaf, leaves, move, node, normalise, pair, place, placeScreen, policyOf, remove, resize, revive, serialize, share, splitOf, unwrapDrawer, visible, wrapDrawer, wrapNodeDrawer,
  type Grab, type LNode,
} from "../src/desk/layout";

/**
 * A border dragged to (x, y) on a bare tree: the pair beside it shares its weight by dragShare, as the desk's drag
 * does through layout.resize (moved here from layout.ts: only these tests change weights directly, PIE-510 A8).
 */
function dragTo<I>(g: Grab<I>, x: number, y: number, o: { mins?: [number, number]; bounds?: [number, number] } = {}): void {
  const n = g.d.node, d = g.d;
  const f = dragShare(g, x, y, o);
  if (f === null) return;
  const sum = n.weights[d.i]! + n.weights[d.i + 1]!;
  n.weights[d.i] = sum * f;
  n.weights[d.i + 1] = sum - n.weights[d.i]!;
}

/** The desk's place() before PIE-412, kept here to hold the shared model to it exactly. */
type Old = { t: "leaf"; id: number } | { t: "split"; dir: "row" | "col"; ratio: number; a: Old; b: Old };
function placeBefore(n: Old, r: Rect, out = new Map<number, Rect>(), dividers: number[] = []): { rects: Map<number, Rect>; dividers: number[] } {
  if (n.t === "leaf") { out.set(n.id, r); return { rects: out, dividers }; }
  if (n.dir === "row") {
    const wa = Math.max(6, Math.min(r.cols - 6, Math.round(r.cols * n.ratio)));
    dividers.push(r.col + wa);
    placeBefore(n.a, { ...r, cols: wa }, out, dividers); placeBefore(n.b, { ...r, col: r.col + wa, cols: r.cols - wa }, out, dividers);
  } else {
    const ha = Math.max(3, Math.min(r.rows - 3, Math.round(r.rows * n.ratio)));
    dividers.push(r.row + ha);
    placeBefore(n.a, { ...r, rows: ha }, out, dividers); placeBefore(n.b, { ...r, row: r.row + ha, rows: r.rows - ha }, out, dividers);
  }
  return { rects: out, dividers };
}
const asNew = (n: Old): LNode => (n.t === "leaf" ? leaf(n.id) : pair(n.dir, n.ratio, asNew(n.a), asNew(n.b)));
const oldPair = (dir: "row" | "col", ratio: number, a: Old, b: Old): Old => ({ t: "split", dir, ratio, a, b });
const L = (id: number): Old => ({ t: "leaf", id });

describe("placing", () => {
  test("the desk's pairs land exactly where they did before, at every size", () => {
    const trees: Old[] = [
      oldPair("row", 0.24, L(1), oldPair("row", 0.66, L(2), oldPair("col", 0.58, L(3), L(4)))),     // the desk's default
      oldPair("row", 0.5, oldPair("col", 0.35, L(1), L(2)), oldPair("col", 0.35, L(3), L(4))),
      oldPair("col", 0.9, L(1), oldPair("row", 0.05, L(2), L(3))),                                     // clamped at both ends
      oldPair("row", 0.37, L(1), L(2)),
    ];
    for (const t of trees) for (const [cols, rows] of [[200, 58], [180, 48], [97, 29], [41, 13], [13, 7]] as const) {
      const r = { col: 0, row: 0, cols, rows };
      const want = placeBefore(t, r), got = place(asNew(t), r);
      // Too small for the minimums (PIE-510): the old place() gave a nested tile one cell or none; now the
      // minimums shrink together, so every tile keeps room, inside the screen.
      if (cols === 13 && t === trees[0]) { expect([...got.rects.values()].every(x => x.cols >= 3 && x.col + x.cols <= cols)).toBe(true); continue; }
      expect([...got.rects]).toEqual([...want.rects]);
      expect(got.dividers.map(d => d.at)).toEqual(want.dividers);
    }
  });

  test("a row shares its room by weight; a spine keeps its width and gives its share to the others", () => {
    const row = splitOf("row", [leaf("a"), leaf("b"), leaf("c")], [4, 3, 3]);
    const r = { col: 0, row: 0, cols: 180, rows: 20 };
    expect([...place(row, r).rects.values()].map(x => x.cols)).toEqual([72, 54, 54]);
    const spined = place(row, r, { fixed: id => (id === "b" ? 3 : undefined) });
    expect([...spined.rects.values()].map(x => x.cols)).toEqual([Math.round(177 * 4 / 7), 3, 177 - Math.round(177 * 4 / 7)]);
    expect(spined.dividers).toHaveLength(0);                     // no border beside a spine
    expect(place(row, r, { fixed: id => (id !== "a" ? 3 : undefined) }).rects.get("a")!.cols).toBe(174);
  });

  test("a sized pane (a drawer) keeps what its weight gives it; its neighbour takes the rounding", () => {
    const s = splitOf("col", [leaf("readers"), leaf("links")], [0.5, 0.5]);
    const r = { col: 0, row: 0, cols: 80, rows: 21 };
    expect(place(s, r).rects.get("links")!.rows).toBe(10);                          // round(10.5) went to the first
    expect(place(s, r, { sized: id => id === "links" }).rects.get("links")!.rows).toBe(11);
  });

  test("minimums hold against the weights, the first kid's and the rest's", () => {
    const s = splitOf("row", [leaf("tree"), leaf("rest")], [0.05, 0.95]);
    const r = { col: 0, row: 0, cols: 120, rows: 10 };
    const min = (n: LNode<string>) => (n.t === "leaf" && n.id === "tree" ? 28 : undefined);
    expect(place(s, r, { min }).rects.get("tree")!.cols).toBe(28);
    expect(place(splitOf("row", [leaf("tree"), leaf("rest")], [0.99, 0.01]), r, { min }).rects.get("rest")!.cols).toBe(6);
  });
});

describe("drawers over the board, and columns (PIE-511)", () => {
  const D = (kid: LNode<string>, edge: "left" | "down", open = true): LNode<string> => ({ t: "drawer", kid, edge, open });
  const board = (lanes: LNode<string>) => splitOf<string>("col", [lanes, splitOf("row", [leaf("preview"), leaf("d1")], [4, 3], "readers"), D(splitOf("row", [leaf("links"), leaf("lpv")]), "down")], [0.42, 0.58, 0.36], "board");
  const screen = (lanes: LNode<string>) => splitOf<string>("row", [D(splitOf("col", [leaf("tree"), leaf("tpv")], [0.6, 0.4], "outline"), "left"), board(lanes)], [0.3, 0.7]);
  const r = { col: 0, row: 0, cols: 180, rows: 48 };

  test("two drawers open at once: each lands where docking it alone would put it, and nothing under them moves", () => {
    const lanes = columnsOf([leaf("a"), leaf("b")], { key: "lanes", source: "hub:x" });
    const P = placeScreen({ root: screen(lanes), floats: [] }, r);
    const shut = screen(columnsOf([leaf("a"), leaf("b")], { key: "lanes" }));
    for (const d of drawers(shut)) d.open = false;
    const under = placeScreen({ root: shut, floats: [] }, r);
    for (const id of ["a", "b", "preview", "d1"]) expect(P.rects.get(id)).toEqual(under.rects.get(id)!);
    const links = P.slid.find(d => d.node.edge === "down")!, tree = P.slid.find(d => d.node.edge === "left")!;
    expect(tree.rect).toEqual({ col: 0, row: 0, cols: 54, rows: 48 });
    // The backlinks drawer spans the board's whole width (the outline drawer takes no room under it), at its bottom.
    expect(links.rect.col).toBe(0);
    expect(links.rect.cols).toBe(180);
    expect(links.rect.row + links.rect.rows).toBe(48);
    expect(tree.divider!.at).toBe(54);
  });

  test("columns place as a row, by weight; a folded column is a spine; their borders drag", () => {
    const c = columnsOf<string>([leaf("a"), leaf("b"), leaf("c")], { key: "lanes" });
    const P = place(c, { col: 0, row: 0, cols: 90, rows: 10 });
    expect([...P.rects.values()].map(x => x.cols)).toEqual([30, 30, 30]);
    expect(P.nodes.get("lanes")).toEqual({ col: 0, row: 0, cols: 90, rows: 10 });
    const spined = place(c, { col: 0, row: 0, cols: 90, rows: 10 }, { fixed: (id, dir) => (id === "b" && dir === "row" ? 3 : undefined) });
    expect(spined.rects.get("b")!.cols).toBe(3);
    const d = P.dividers[0]!;
    expect(d.node).toBe(c);
    dragTo({ d, side: 0 }, 44, 2);
    expect(c.weights[0]! / (c.weights[0]! + c.weights[1]!)).toBeCloseTo(45 / 60, 1);
    expect(resize(c, "c", "row", 0.05)).toBe(true);
  });

  test("columns stay with one tile or none, never merge, and save and come back with their source", () => {
    const c = columnsOf<string>([leaf("a")], { key: "lanes", source: "hub:h1", policy: { draggable: false, accepts: ["query"] } });
    const root = splitOf<string>("col", [c, leaf("p")]);
    expect(normalise(root)).toMatchObject({ t: "split", kids: [{ t: "columns", kids: [{ t: "leaf", id: "a" }] }, { t: "leaf", id: "p" }] });
    const none = remove(root, "a")!;
    expect(node(none, "lanes")!.kids).toEqual([]);
    expect(normalise(none)).toMatchObject({ kids: [{ t: "columns", kids: [] }, { t: "leaf", id: "p" }] });
    const saved = serialize(root, id => ({ t: "leaf" as const, kind: "query", name: id }));
    expect(saved).toMatchObject({ t: "split", kids: [{ t: "columns", source: "hub:h1", key: "lanes", policy: { draggable: false, accepts: ["query"] } }, { t: "leaf" }] });
    const back = revive(saved as any, (l: any) => l.name as string);
    expect(back).toMatchObject({ kids: [{ t: "columns", source: "hub:h1", kids: [{ t: "leaf", id: "a" }] }, { t: "leaf", id: "p" }] });
    // A tile moved beside a column joins the columns (n-ary), not a nested pair.
    const moved = move(splitOf<string>("col", [columnsOf<string>([leaf("a"), leaf("b")], { key: "lanes" }), leaf("q")]), "q", { kind: "split", target: "a", dir: "right" })!;
    expect(leaves(node(moved, "lanes")!)).toEqual(["a", "q", "b"]);
  });

  test("a whole container goes into a drawer and back (the board's outline: the tree over its preview)", () => {
    const outline = splitOf<string>("col", [leaf("tree"), leaf("tpv")], [0.6, 0.4], "outline");
    const t = splitOf<string>("row", [outline, leaf("board")], [0.3, 0.7]);
    const wrapped = normalise(wrapNodeDrawer(t, node(t, "outline")!, "right", false)!);
    expect(drawerOf(wrapped, "tree")).toBe(drawerOf(wrapped, "tpv"));
    expect(drawerOf(wrapped, "tree")!.edge).toBe("right");
    expect(visible(wrapped)).toEqual(["board"]);
    expect(normalise(unwrapDrawer(wrapped, drawerOf(wrapped, "tree")!))).toMatchObject({ t: "split", kids: [{ t: "leaf", id: "board" }, { key: "outline" }] });
    expect(wrapNodeDrawer(outline, outline)).toBeNull();
  });
});

describe("resizing", () => {
  test("resize moves the nearest border along the axis, within bounds, as ^W < > and { } did", () => {
    const t = pair("row", 0.5, leaf(1), pair("col", 0.5, leaf(2), leaf(3)));
    expect(resize(t, 2, "row", 0.05)).toBe(true);
    expect(share(t, 1)).toBeCloseTo(0.45);                        // leaf 2 is in the second half: it grew
    expect(resize(t, 2, "col", 0.1)).toBe(true);
    expect(share(t, 2)).toBeCloseTo(0.6);
    for (let i = 0; i < 20; i++) resize(t, 1, "row", 0.05, [0.15, 0.8]);
    expect(share(t, 1)).toBeCloseTo(0.8);
    expect(resize(leaf(1), 1, "row", 0.1)).toBe(false);
  });

  test("grow changes a pane's weight within its limits, the others keep theirs (the board's < > on a reader)", () => {
    const row = splitOf("row", [leaf("a"), leaf("b")], [4, 3], "readers");
    expect(grow(row, "b", 0.5, 0.5, 20)).toBe(true);
    expect(row.weights).toEqual([4, 3.5]);
    for (let i = 0; i < 50; i++) grow(row, "b", -0.5, 0.5, 20);
    expect(row.weights).toEqual([4, 0.5]);
  });

  test("the border grabbed follows the pointer: the first kid's edge, or the second's", () => {
    const r = { col: 0, row: 0, cols: 100, rows: 20 };
    for (const side of [0, 1] as const) {
      const t = pair("row", 0.5, leaf(1), leaf(2));
      const d = place(t, r).dividers[0]!;
      const g = dividerAt([d], d.at - 1 + side, 5)!;
      expect(g.side).toBe(side);
      dragTo(g, 70, 5);
      const after = place(t, r).rects;
      // Grabbed by the first pane's right edge, that edge is now at 70; by the second's left edge, that one is.
      expect(side === 0 ? after.get(1)!.cols - 1 : after.get(2)!.col).toBe(70);
    }
  });

  test("a drag keeps each side its minimum and the first side's share in bounds", () => {
    const t = pair("col", 0.5, leaf(1), leaf(2));
    const r = { col: 0, row: 0, cols: 50, rows: 40 };
    const g = dividerAt(place(t, r).dividers, 10, 20)!;
    dragTo(g, 10, 1, { mins: [5, 6] });
    expect(place(t, r).rects.get(1)!.rows).toBe(5);
    dragTo(g, 10, 39, { mins: [5, 6], bounds: [0.12, 0.85] });
    expect(place(t, r).rects.get(1)!.rows).toBe(34);
  });
});

describe("saved forms", () => {
  type Kind = { t: "leaf"; kind: string };
  test("the desk's old desk.json (binary ratio a b) reads into the tree", () => {
    const saved = { t: "split", dir: "row", ratio: 0.24, a: { t: "leaf", kind: "tree" }, b: { t: "split", dir: "col", ratio: 0.6, a: { t: "leaf", kind: "reader" }, b: { t: "leaf", kind: "thread" } } } as const;
    const kinds: string[] = [];
    const t = revive(saved as any, (l: Kind) => kinds.push(l.kind) - 1);
    expect(kinds).toEqual(["tree", "reader", "thread"]);
    expect(t).toEqual(pair("row", 0.24, leaf(0), pair("col", 0.6, leaf(1), leaf(2))));
  });

  test("review: saved weights that aren't positive, finite numbers fall back to equal shares", () => {
    const leafOf = () => 1;
    expect(revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, { t: "leaf" }], weights: [0, Number.NaN] } as any, leafOf)).toMatchObject({ weights: [1, 1] });
    expect(revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, { t: "leaf" }], weights: [2] } as any, leafOf)).toMatchObject({ weights: [1, 1] });
    expect(revive({ t: "split", dir: "sideways", ratio: 7, a: { t: "leaf" }, b: { t: "leaf" } } as any, leafOf)).toMatchObject({ dir: "row", weights: [0.5, 0.5] });
    expect(revive({ t: "split", dir: "col", ratio: -1, a: { t: "leaf" }, b: { t: "leaf" } } as any, leafOf)).toMatchObject({ weights: [0.5, 0.5] });
  });

  test("review: a saved tab set with no tiles is dropped, not given an empty pane", () => {
    const t = revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, { t: "tabs", tabs: [], active: 0 }], weights: [1, 1] } as any, () => 1);
    expect(normalise(t)).toEqual(leaf(1));
  });

  test("round 3 (B-L1): a saved kid that isn't a node (a hand-edited null) is dropped, never a throw", () => {
    let n = 0;
    const t = revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, null, 7, { t: "leaf" }], weights: [1, 1, 1, 1] } as any, () => ++n);
    expect(normalise(t)).toMatchObject({ t: "split", kids: [leaf(1), leaf(2)] });
    expect(normalise(revive({ t: "split", dir: "col", ratio: 0.5, a: null, b: { t: "leaf" } } as any, () => 9))).toEqual(leaf(9));
    expect(normalise(revive({ t: "flow", kids: [null, { t: "leaf" }], docked: [0] } as any, () => 4))).toMatchObject({ t: "flow", kids: [leaf(4)] });
  });

  test("round 3 (B-L1): a desk.json with a null kid starts the desk with the tiles it has", async () => {
    const { Desk } = await import("../src/desk/desk");
    const dir = mkdtempSync(join(tmpdir(), "r3-desk-"));
    const was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    try {
      writeFileSync(join(dir, "desk.json"), JSON.stringify({ root: { t: "split", dir: "row", kids: [{ t: "leaf", kind: "tree", name: "tree" }, null, { t: "leaf", kind: "reader", name: "reader" }], weights: [1, 1, 1] }, focus: 0 }));
      const d = new Desk() as any;
      expect([...d.layout.names.values()]).toEqual(["tree", "reader"]);
      d.dispose?.();
    } finally {
      if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("round 3 (B-L4): an unnamed flow with no columns takes no room; a named one stays, as remove leaves them", () => {
    const t = revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, { t: "flow", kids: [] }], weights: [1, 1] } as any, () => 1);
    expect(normalise(t)).toEqual(leaf(1));
    const named = revive({ t: "split", dir: "row", kids: [{ t: "leaf" }, { t: "flow", key: "river", kids: [] }], weights: [1, 1] } as any, () => 1);
    expect(normalise(named)).toMatchObject({ t: "split", kids: [leaf(1), { t: "flow", key: "river", kids: [] }] });
  });

  test("splits are written as kids and weights, pairs too; a binary save still reads", () => {
    const t = pair("row", 0.3, leaf(1), pair("col", 0.5, leaf(2), leaf(3)));
    const s = serialize(t, id => ({ t: "leaf" as const, kind: `k${id}` }));
    expect(s).toEqual({ t: "split", dir: "row", kids: [{ t: "leaf", kind: "k1" }, { t: "split", dir: "col", kids: [{ t: "leaf", kind: "k2" }, { t: "leaf", kind: "k3" }], weights: [0.5, 0.5] }], weights: [0.3, 0.7] } as any);
    let m = 0;
    expect(revive({ t: "split", dir: "row", ratio: 0.3, a: { t: "leaf" }, b: { t: "leaf" } } as any, () => ++m)).toEqual(pair("row", 0.3, leaf(1), leaf(2)));
    const wide = splitOf("row", [leaf(1), leaf(2), leaf(3)], [1, 2, 3], "readers");
    const w = serialize(wide, id => ({ t: "leaf" as const, kind: `k${id}` }));
    expect(w).toEqual({ t: "split", dir: "row", kids: [{ t: "leaf", kind: "k1" }, { t: "leaf", kind: "k2" }, { t: "leaf", kind: "k3" }], weights: [1, 2, 3], key: "readers" } as any);
    let n = 0;
    expect(revive(w as any, () => ++n)).toEqual(wide);
  });
});

// PIE-505: a drawer is a container in the tree, sliding over from an edge; every container carries a policy.
describe("drawer containers and policy (PIE-505)", () => {
  const r = { col: 0, row: 0, cols: 100, rows: 30 };
  const tree = () => splitOf("row", [{ t: "drawer", kid: splitOf("col", [leaf("tree"), leaf("claude")]), edge: "left", open: true } as LNode<string>, leaf("lanes")], [0.3, 0.7]);

  test("an open drawer slides over: the layout under it keeps all its room, the drawer's tiles share where it docks", () => {
    const s = placeScreen({ root: tree(), floats: [] }, r);
    expect(s.rects.get("lanes")).toEqual(r);                        // nothing moved for it
    expect(s.rects.has("tree")).toBe(false);
    expect(s.slid).toHaveLength(1);
    expect(s.slid[0]!.rect).toEqual({ ...r, cols: 30 });
    expect(s.slid[0]!.placed.rects.get("tree")).toEqual({ col: 0, row: 0, cols: 30, rows: 15 });
    expect(s.slid[0]!.placed.rects.get("claude")!.row).toBe(15);
    expect(s.slid[0]!.divider!.at).toBe(30);                        // its own border: a drag sizes it
  });

  test("shut, it takes no room and places nothing; overlay off, it takes its room while open", () => {
    const t = tree(); (t.kids[0] as any).open = false;
    const shut = placeScreen({ root: t, floats: [] }, r);
    expect(shut.slid).toHaveLength(0);
    expect(shut.rects.get("lanes")).toEqual(r);
    expect(visible(t)).toEqual(["lanes"]);
    const pushed = tree(); (pushed.kids[0] as any).policy = { overlay: false };
    const p = placeScreen({ root: pushed, floats: [] }, r);
    expect(p.slid).toHaveLength(0);
    expect(p.rects.get("lanes")!.cols).toBe(70);
    expect(p.rects.get("tree")!.cols).toBe(30);
  });

  test("tile moves reach into a drawer: beside a tile in it, into its tabs; the drawer goes when its last tile leaves", () => {
    const t = splitOf("row", [{ t: "drawer", kid: leaf("tree"), edge: "left", open: true } as LNode<string>, leaf("a"), leaf("b"), leaf("c")]);
    const one = move(t, "a", { kind: "split", target: "tree", dir: "down" })!;
    expect(drawerOf(one, "a")).toBe(drawerOf(one, "tree"));
    const two = move(one, "b", { kind: "tabs", target: "a" })!;
    expect(leaves(drawerOf(two, "b")!.kid)).toEqual(["tree", "a", "b"]);
    // Everything left the drawer but one tile: taking the tree out leaves a drawer of the rest; the last out removes it.
    expect(drawers(normalise(remove(t, "tree")!))).toHaveLength(0);
    // With nothing left outside it to slide over, a drawer is just what it holds.
    const all = move(two, "c", { kind: "tabs", target: "tree" })!;
    expect(drawers(all)).toHaveLength(0);
    expect(leaves(all)).toEqual(["tree", "c", "a", "b"]);
  });

  test("wrapDrawer puts a tile in a drawer where it is, or at an outer edge; unwrap docks it back; drawerToEdge moves it", () => {
    const t = splitOf("row", [leaf("a"), splitOf("col", [leaf("b"), leaf("c")])]);
    const inPlace = wrapDrawer(t, "c")!;
    expect(drawerOf(inPlace, "c")!.edge).toBe("down");             // the last of a column slides up from the bottom
    const left = normalise(wrapDrawer(t, "c", "left")!) as any;
    expect(left.kids[0].t).toBe("drawer");
    expect(left.kids[0].edge).toBe("left");
    expect(leaves(left)).toEqual(["c", "a", "b"]);
    expect(normalise(unwrapDrawer(inPlace, drawerOf(inPlace, "c")!))).toEqual(normalise(t));
    const moved = normalise(drawerToEdge(left, left.kids[0], "right")!) as any;
    expect(moved.kids.at(-1).edge).toBe("right");
    expect(wrapDrawer(leaf("a"), "a")).toBeNull();                 // nothing to slide over
  });

  test("a policy can fix a container's size, keep it at least or at most so many cells", () => {
    const t = splitOf("row", [{ ...splitOf("col", [leaf("a")], undefined, "x"), policy: { fixed: 20 } }, leaf("b")]);
    expect(place(t, r).rects.get("a")!.cols).toBe(20);
    const m = splitOf("row", [{ ...splitOf("col", [leaf("a")], undefined, "x"), policy: { max: 10 } }, leaf("b")], [0.8, 0.2]);
    expect(place(m, r).rects.get("a")!.cols).toBe(10);
  });

  test("the saved form keeps drawers and policies; a stray field in a hand-edited policy is dropped", () => {
    const t = { ...tree(), policy: { locked: true, accepts: ["tree", 3 as any] } } as LNode<string>;
    const back = revive(serialize(t, id => ({ t: "leaf" as const, id })) as any, (l: any) => l.id as string) as any;
    expect(back.policy).toEqual({ locked: true, accepts: ["tree"] });
    expect(back.kids[0].t).toBe("drawer");
    expect(back.kids[0].edge).toBe("left");
    expect(leaves(back)).toEqual(["tree", "claude", "lanes"]);
    expect(policyOf({ locked: "yes", min: -2, fixed: 7.4, opensInto: "" })).toEqual({ fixed: 7 });
  });

  test("review: a lone drawer at the top is what it holds, keeping a policy; a drawer inside a drawer is one", () => {
    const t = { ...splitOf("row", [{ t: "drawer", kid: splitOf("col", [leaf("a"), leaf("b")]), edge: "left", open: true } as LNode<string>]), policy: { locked: true } } as LNode<string>;
    const n = normalise(t) as any;
    expect(n.t).toBe("split");
    expect(n.policy).toEqual({ locked: true });
    const nested = splitOf("row", [{ t: "drawer", kid: { t: "drawer", kid: leaf("a"), edge: "up", open: false, policy: { overlay: false } }, edge: "left", open: true } as LNode<string>, leaf("b")]);
    const m = normalise(nested) as any;
    expect(m.kids[0]).toMatchObject({ t: "drawer", edge: "left", open: true, policy: { overlay: false }, kid: { t: "leaf", id: "a" } });
  });
});

describe("containers keep their rules and every tile its room (PIE-510)", () => {
  const sizes = (m: Map<number, Rect>) => [...m].map(([id, r]) => [id, r.col, r.cols, r.row, r.rows]);
  const within = (m: Map<number, Rect>, area: Rect) => [...m.values()].every(r => r.cols > 0 && r.rows > 0 && r.col >= area.col && r.col + r.cols <= area.col + area.cols && r.row >= area.row && r.row + r.rows <= area.row + area.rows);

  test("a terminal too small for the minimums: every tile keeps a cell and nothing lands off the screen", () => {
    const area = { col: 0, row: 0, cols: 10, rows: 4 };
    const row = place(splitOf("row", [leaf(1), leaf(2), leaf(3), leaf(4)]), area).rects;
    expect(within(row, area)).toBe(true);
    const col = place(splitOf("col", [leaf(1), leaf(2), leaf(3)]), area).rects;
    expect(within(col, area)).toBe(true);
  });

  test("a policy's min or fixed larger than the screen is clamped to it: the others keep a cell each", () => {
    const area = { col: 0, row: 0, cols: 80, rows: 24 };
    for (const policy of [{ min: 500 }, { fixed: 200 }]) {
      const t: LNode = splitOf("row", [leaf(1), { ...splitOf("col", [leaf(2), leaf(3)]), policy }, leaf(4)]);
      const r = place(t, area).rects;
      expect(within(r, area)).toBe(true);
      expect(r.get(2)!.cols).toBeGreaterThan(60);                   // the rule still says most of it
    }
    // Room for them all: the minimums aren't touched.
    expect(sizes(place(splitOf("row", [leaf(1), leaf(2)]), area).rects)).toEqual([[1, 0, 40, 0, 24], [2, 40, 40, 0, 24]]);
  });

  test("evening out leaves each drawer's size: the docked kids share the rest", () => {
    const t = splitOf("row", [{ t: "drawer", kid: leaf(1), edge: "left", open: true } as LNode, leaf(2), leaf(3)], [0.3, 0.5, 0.2]);
    even(t);
    expect(t.weights[0]).toBeCloseTo(0.3);
    expect(t.weights[1]).toBeCloseTo(0.35);
    expect(t.weights[2]).toBeCloseTo(0.35);
  });
});
