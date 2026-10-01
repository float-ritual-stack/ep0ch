// PIE-412: the layout tree is the one pane model. The desk's binary splits place exactly as they did,
// n-ary splits share by weight around spines, drawers slide over or join the layout, borders follow the
// pointer, and the desk's saved form still reads and writes as older doors expect. Pure functions only.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import {
  beside, chainOf, dividerAt, dragTo, drawerOf, drawers, drawerToEdge, effective, grow, insert, leaf, leaves, move, node, normalise, pair, place, placeScreen, policyOf, remove, resize, revive, serialize, share, splitOf, unwrapDrawer, visible, wrapDrawer,
  type LNode,
} from "../src/desk/layout";

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

describe("drawers and floats", () => {
  const board = () => splitOf<string>("col", [leaf("lanes"), splitOf("row", [leaf("preview"), leaf("d1")], [4, 3], "readers")], [0.42, 0.58], "board");
  const r = { col: 0, row: 0, cols: 180, rows: 48 };

  test("a drawer sliding over lands where docking would put it, and nothing else moves", () => {
    const root = beside(beside(board(), { key: "readers" }, leaf("links"), { dir: "col", weight: 0.45 }), { key: "board" }, leaf("tree"), { dir: "row", before: true, weight: 0.3 });
    const docked = place(root, r, { sized: id => id === "tree" || id === "links" });
    const alone = place(board(), r);
    const sliding = placeScreen({ root, over: new Set(["tree", "links"]), floats: [] }, r, { sized: id => id === "tree" || id === "links" });
    expect(sliding.over.get("tree")!.rect).toEqual(docked.rects.get("tree")!);
    expect(sliding.over.get("links")!.rect).toEqual(docked.rects.get("links")!);
    for (const id of ["lanes", "preview", "d1"]) expect(sliding.rects.get(id)).toEqual(alone.rects.get(id)!);
    // Its own border comes with it: the outline's right edge, the backlinks' top.
    expect(sliding.over.get("tree")!.divider!.at).toBe(54);
    expect(sliding.over.get("links")!.divider!.at).toBe(docked.rects.get("links")!.row);
    // Pinned (not sliding), the others make room.
    const pinned = placeScreen({ root, over: new Set(), floats: [] }, r);
    expect(pinned.rects.get("lanes")!.col).toBe(54);
  });

  test("with drawers sliding over, dragging a border underneath moves the tree's own weights", () => {
    const root = beside(beside(board(), { key: "readers" }, leaf("links"), { dir: "col", weight: 0.45 }), { key: "board" }, leaf("tree"), { dir: "row", before: true, weight: 0.3 });
    const P = placeScreen({ root, over: new Set(["tree", "links"]), floats: [] }, r, { sized: id => id === "tree" || id === "links" });
    const readers = P.dividers.find(d => d.node.key === "readers")!;
    const lanes = P.dividers.find(d => d.node.key === "board")!;
    expect(readers.node).toBe(node(root, "readers")!);
    expect(lanes.node).toBe(node(root, "board")!);
    const before = [...node(root, "readers")!.weights], boardBefore = [...node(root, "board")!.weights];
    dragTo({ d: readers, side: 0 }, 60, 30);
    dragTo({ d: lanes, side: 0 }, 60, 30);
    expect(node(root, "readers")!.weights).not.toEqual(before);
    expect(node(root, "board")!.weights).not.toEqual(boardBefore);
    const again = placeScreen({ root, over: new Set(["tree", "links"]), floats: [] }, r, { sized: id => id === "tree" || id === "links" });
    expect(again.rects.get("preview")!.cols).toBe(61);
    expect(again.rects.get("lanes")!.rows).toBe(31);
  });

  test("a drawer shut gives its place back; a named split stays with one kid, an unnamed one gives way", () => {
    const root = beside(board(), { key: "readers" }, leaf("links"), { dir: "col", weight: 0.45 });
    expect(share(root, "links")).toBeCloseTo(0.45);
    const shut = remove(root, "links")!;
    expect(shut).toEqual(board());
    const one = remove(board(), "d1")!;
    expect(node(one, "readers")!.kids).toEqual([leaf("preview")]);
    expect(leaves(insert(one, "readers", leaf("d2"), 3))).toEqual(["lanes", "preview", "d2"]);
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

  test("review: a sliding drawer's neighbours' borders are the tree's own splits, so a drag changes the tree", () => {
    const root = beside(splitOf<string>("row", [leaf("a"), leaf("b")], [1, 1], "readers"), { key: "readers" }, leaf("links"), { dir: "col", weight: 0.4 });
    const s = placeScreen({ root, over: new Set(["links"]), floats: [] }, { col: 0, row: 0, cols: 100, rows: 30 });
    const d = s.dividers.find(x => x.node.key === "readers")!;
    expect(d.node).toBe(node(root, "readers")!);
    dragTo(dividerAt([d], d.at - 1, 5)!, 70, 5);
    expect(placeScreen({ root, over: new Set(["links"]), floats: [] }, { col: 0, row: 0, cols: 100, rows: 30 }).rects.get("a")!.cols).toBe(71);
    expect(s.rects.has("links")).toBe(false);
    expect(s.over.get("links")!.rect.rows).toBe(12);
  });

  test("pairs are written in the binary form (an older door reads them), wider splits as kids and weights", () => {
    const t = pair("row", 0.3, leaf(1), pair("col", 0.5, leaf(2), leaf(3)));
    const s = serialize(t, id => ({ t: "leaf" as const, kind: `k${id}` }));
    expect(s).toEqual({ t: "split", dir: "row", ratio: 0.3, a: { t: "leaf", kind: "k1" }, b: { t: "split", dir: "col", ratio: 0.5, a: { t: "leaf", kind: "k2" }, b: { t: "leaf", kind: "k3" } } } as any);
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
    const s = placeScreen({ root: tree(), over: new Set(), floats: [] }, r);
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
    const shut = placeScreen({ root: t, over: new Set(), floats: [] }, r);
    expect(shut.slid).toHaveLength(0);
    expect(shut.rects.get("lanes")).toEqual(r);
    expect(visible(t)).toEqual(["lanes"]);
    const pushed = tree(); (pushed.kids[0] as any).policy = { overlay: false };
    const p = placeScreen({ root: pushed, over: new Set(), floats: [] }, r);
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

  test("the policy in effect: the nearest that says a field wins; locked anywhere above locks", () => {
    const e = effective([{ by: "screen", policy: { locked: true, droppable: false } }, { by: "s2", policy: { droppable: true, accepts: ["tree"] } }, { by: "d1", policy: {} }]);
    expect(e.locked).toBe(true);
    expect(e.by.locked).toBe("screen");
    expect(e.droppable).toBe(true);
    expect(e.by.droppable).toBe("s2");
    expect(e.accepts).toEqual(["tree"]);
    expect(effective([]).draggable).toBe(true);
    const t = tree();
    expect(chainOf(t, "claude").map(c => c.t)).toEqual(["split", "drawer", "split"]);
  });
});
