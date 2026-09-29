// PIE-413: tiles on the layout tree. The pure tree operations (move beside, into tabs, to an outer edge,
// remove, collapse, normalise) and the drop zones in cells. floatty's layoutTypes cases are ported where
// they apply (moveLeafToTarget, moveLeafToRoot, removeNode, clampRatio); the tab set cases are new.
import { describe, expect, test } from "bun:test";
import { dropAt, type DropTile } from "../src/desk/drop";
import { activate, clone, cycle, leaf, leaves, move, normalise, pair, place, remove, reorder, revive, serialize, shown, splitOf, tabInto, tabsOf, type LNode } from "../src/desk/layout";

type N = LNode<string>;
const L = (id: string): N => leaf(id);
/** The tree as a short string: row(a,b) col(a,b) tabs(a,*b) — the shown tab starred. */
const s = (n: N | null): string => !n ? "∅" : n.t === "leaf" ? n.id : n.t === "tabs" ? `tabs(${n.ids.map((x, i) => (i === n.active ? "*" + x : x)).join(",")})` : `${n.dir}(${n.kids.map(s).join(",")})`;
const weights = (n: N) => (n.t === "split" ? n.weights.map(w => Math.round(w * 1000) / 1000) : []);

describe("moving a tile beside another (floatty's moveLeafToTarget)", () => {
  test("left, right, up and down of the target", () => {
    const t = pair("row", 0.5, L("a"), L("b"));
    expect(s(move(t, "a", { kind: "split", target: "b", dir: "right" }))).toBe("row(b,a)");
    expect(s(move(t, "b", { kind: "split", target: "a", dir: "left" }))).toBe("row(b,a)");
    expect(s(move(t, "a", { kind: "split", target: "b", dir: "down" }))).toBe("col(b,a)");
    expect(s(move(t, "a", { kind: "split", target: "b", dir: "up" }))).toBe("col(a,b)");
  });
  test("null onto itself, for a missing source or a missing target", () => {
    const t = pair("row", 0.5, L("a"), L("b"));
    expect(move(t, "a", { kind: "split", target: "a", dir: "left" })).toBeNull();
    expect(move(t, "x", { kind: "split", target: "a", dir: "left" })).toBeNull();
    expect(move(t, "a", { kind: "split", target: "x", dir: "left" })).toBeNull();
  });
  test("the tree it was given is left as it was (floatty cloned leaves; here the whole shape)", () => {
    const t = splitOf("row", [L("a"), L("b"), L("c")]);
    const before = JSON.stringify(t);
    move(t, "a", { kind: "split", target: "c", dir: "down" });
    expect(JSON.stringify(t)).toBe(before);
  });
  test("beside a tile in a split along the same axis, it joins that split and halves the target's share", () => {
    const t = splitOf("row", [L("a"), L("b"), L("c")], [0.5, 0.25, 0.25]);
    const out = move(t, "a", { kind: "split", target: "c", dir: "right" })!;
    expect(s(out)).toBe("row(b,c,a)");
    expect(weights(out)).toEqual([0.5, 0.25, 0.25]);
  });
  test("across the axis, a new split takes the target's place: the tile under the tree (the journey's nvim)", () => {
    const t = splitOf("row", [L("tree"), L("reader"), L("nvim")]);
    expect(s(move(t, "nvim", { kind: "split", target: "tree", dir: "down" }))).toBe("row(col(tree,nvim),reader)");
  });
  test("the split it leaves collapses: one kid left gives way to it", () => {
    const t = pair("row", 0.5, pair("col", 0.5, L("a"), L("b")), L("c"));
    expect(s(move(t, "b", { kind: "split", target: "c", dir: "down" }))).toBe("row(a,col(c,b))");
  });
});

describe("outer edges (floatty's moveLeafToRoot)", () => {
  test("left and right: a full-height column beside everything else", () => {
    const t = pair("col", 0.5, L("a"), pair("row", 0.5, L("b"), L("c")));
    expect(s(move(t, "c", { kind: "edge", dir: "right" }))).toBe("row(col(a,b),c)");
    expect(s(move(t, "c", { kind: "edge", dir: "left" }))).toBe("row(c,col(a,b))");
  });
  test("down: a full-width row under everything else", () => {
    const t = pair("row", 0.5, L("a"), L("b"));
    expect(s(move(t, "a", { kind: "edge", dir: "down" }))).toBe("col(b,a)");
  });
  test("a lone tile has nowhere to go", () => {
    expect(move(L("a"), "a", { kind: "edge", dir: "left" })).toBeNull();
  });
  test("an edge column already along that axis joins the root split", () => {
    const t = splitOf("row", [L("a"), L("b"), L("c")]);
    const out = move(t, "a", { kind: "edge", dir: "right" })!;
    expect(s(out)).toBe("row(b,c,a)");
    expect(weights(out).reduce((a, w) => a + w, 0)).toBeCloseTo(1);
  });
});

describe("tab sets (the part floatty didn't have)", () => {
  test("dropping onto a tile's centre or header makes a tab set, the dropped tile shown", () => {
    const t = splitOf("row", [L("tree"), L("detail"), L("nvim")]);
    const out = move(t, "detail", { kind: "tabs", target: "tree" })!;
    expect(s(out)).toBe("row(tabs(tree,*detail),nvim)");
    expect(shown(out)).toEqual(["detail", "nvim"]);
    expect(leaves(out)).toEqual(["tree", "detail", "nvim"]);
  });
  test("a tab set takes more tabs at an index; a tab set can be split beside like any tile", () => {
    let t: N = splitOf("row", [L("a"), L("b"), L("c"), L("d")]);
    t = move(t, "b", { kind: "tabs", target: "a" })!;
    t = move(t, "c", { kind: "tabs", target: "a", index: 0 })!;
    expect(s(t)).toBe("row(tabs(*c,a,b),d)");
    t = move(t, "d", { kind: "split", target: "a", dir: "down" })!;
    expect(s(t)).toBe("col(tabs(*c,a,b),d)");
  });
  test("a tab dragged out to the outer right edge: a full-height column, and the set it left keeps its tabs", () => {
    let t: N = splitOf("row", [tabInto(L("tree"), "tree", "detail"), L("reader")]);
    expect(s(t)).toBe("row(tabs(tree,*detail),reader)");
    t = move(t, "detail", { kind: "edge", dir: "right" })!;
    expect(s(t)).toBe("row(tree,reader,detail)");
  });
  test("dragging a tab onto its own set's edge takes it out beside the tabs left", () => {
    const t: N = splitOf("row", [{ t: "tabs", ids: ["a", "b", "c"], active: 1 }, L("d")]);
    expect(s(move(t, "b", { kind: "split", target: "b", dir: "down" }))).toBe("row(col(tabs(a,*c),b),d)");
    expect(move(L("a"), "a", { kind: "split", target: "a", dir: "down" })).toBeNull();
  });
  test("onto its own header: the tab moves to that place (reorder)", () => {
    const t: N = { t: "tabs", ids: ["a", "b", "c"], active: 0 };
    expect(s(move(t, "a", { kind: "tabs", target: "c", index: 2 }))).toBe("tabs(b,c,*a)");
    expect(s(reorder(t, "c", 0))).toBe("tabs(*c,a,b)");
  });
  test("clicking a tab shows it; cycling goes round; tabsOf finds the set", () => {
    const t: N = splitOf("row", [{ t: "tabs", ids: ["a", "b", "c"], active: 0 }, L("d")]);
    expect(activate(t, "c")).toBe(true);
    expect(shown(t)).toEqual(["c", "d"]);
    expect(cycle(t, "c", 1)).toBe("a");
    expect(cycle(t, "a", -1)).toBe("c");
    expect(activate(t, "d")).toBe(false);
    expect(tabsOf(t, "b")?.ids).toEqual(["a", "b", "c"]);
  });
  test("closing a tab shows the next; a set of one is that tile; the last one gone takes the set", () => {
    const t: N = { t: "tabs", ids: ["a", "b", "c"], active: 1 };
    expect(s(remove(t, "b"))).toBe("tabs(a,*c)");
    expect(s(remove(t, "a"))).toBe("tabs(*b,c)");
    expect(s(remove(remove(t, "a")!, "b"))).toBe("c");
    expect(remove({ t: "tabs", ids: ["a"], active: 0 }, "a")).toBeNull();
  });
  test("placing a tab set gives only the shown tab a rect, and says where the set is", () => {
    const t: N = splitOf("row", [{ t: "tabs", ids: ["a", "b"], active: 1 }, L("c")]);
    const p = place(t, { col: 0, row: 0, cols: 80, rows: 20 });
    expect([...p.rects.keys()]).toEqual(["b", "c"]);
    expect(p.tabsets?.[0]?.rect).toEqual({ col: 0, row: 0, cols: 40, rows: 20 });
    expect(p.dividers.length).toBe(1);
  });
});

describe("removing and normalising (floatty's removeNode and clampRatio)", () => {
  test("removing collapses a two-pane split to the sibling; a nested leaf keeps the structure around it", () => {
    expect(s(remove(pair("row", 0.5, L("a"), L("b")), "a"))).toBe("b");
    const t = pair("row", 0.5, L("a"), pair("col", 0.5, L("b"), L("c")));
    expect(s(remove(t, "c"))).toBe("row(a,b)");
    expect(s(remove(t, "x"))).toBe(s(t));
  });
  test("normalise: weights sum to 1, none below the floor, one-kid splits and same-axis nests flattened", () => {
    const t: N = { t: "split", dir: "row", kids: [L("a"), { t: "split", dir: "row", kids: [L("b"), L("c")], weights: [1, 3] }], weights: [2, 2] };
    const n = normalise(t);
    expect(s(n)).toBe("row(a,b,c)");
    expect(weights(n)).toEqual([0.5, 0.125, 0.375]);
    const tiny = normalise(splitOf("col", [L("a"), L("b")], [0.001, 10]));
    expect(weights(tiny)[0]).toBeGreaterThanOrEqual(0.047);
    expect(weights(tiny).reduce((a, w) => a + w, 0)).toBeCloseTo(1);
    expect(s(normalise(splitOf("row", [L("a")])))).toBe("a");
    expect(s(normalise({ t: "tabs", ids: ["a"], active: 3 }))).toBe("a");
    expect(s(normalise({ t: "tabs", ids: ["a", "b"], active: 9 }))).toBe("tabs(a,*b)");
    expect(weights(normalise(splitOf("row", [L("a"), L("b")], [NaN, -1])))).toEqual([0.5, 0.5]);
  });
  test("a named split (the board's readers row) is never flattened or collapsed", () => {
    const t = splitOf("col", [L("lanes"), splitOf("row", [L("preview")], [1], "readers")], [1, 1], "board");
    expect(s(normalise(t))).toBe("col(lanes,row(preview))");
  });
  test("clone copies the shape: changing the copy's weights leaves the original", () => {
    const t = pair("row", 0.5, L("a"), L("b"));
    const c = clone(t);
    (c as any).weights[0] = 9;
    expect((t as any).weights[0]).toBe(0.5);
  });
});

describe("saved forms with tab sets", () => {
  type Saved = { t: "leaf"; name: string };
  test("a tab set round-trips with the tab shown; pairs still write the binary form", () => {
    const t: N = splitOf("row", [{ t: "tabs", ids: ["a", "b"], active: 1 }, pair("col", 0.3, L("c"), L("d")), L("e")], [0.2, 0.5, 0.3]);
    const saved = serialize(t, (id): Saved => ({ t: "leaf", name: id }));
    expect(JSON.stringify(saved)).toContain(`"t":"tabs"`);
    expect(JSON.stringify(saved)).toContain(`"ratio":0.3`);
    const back = revive(JSON.parse(JSON.stringify(saved)), (l: Saved) => l.name);
    expect(s(back)).toBe(s(t));
    expect(weights(back)).toEqual(weights(t));
  });
  test("a saved tab set that's empty of good tabs or points past its end still reads", () => {
    const back = revive({ t: "tabs", tabs: [{ t: "leaf", name: "a" }, { t: "leaf", name: "b" }], active: 7 } as any, (l: Saved) => l.name);
    expect(s(back)).toBe("tabs(*a,b)");
    expect(s(revive({ t: "tabs", tabs: [{ t: "leaf", name: "a" }, { bad: 1 }], active: 0 } as any, (l: Saved) => l.name))).toBe("a");
  });
});

describe("drop zones in cells (Replit's hit model, floatty's outer edges)", () => {
  const area = { col: 0, row: 0, cols: 120, rows: 40 };
  const tiles: DropTile<string>[] = [
    { id: "a", rect: { col: 0, row: 0, cols: 60, rows: 40 } },
    { id: "b", rect: { col: 60, row: 0, cols: 60, rows: 20 }, tabs: [{ id: "b", from: 62, to: 70 }, { id: "x", from: 71, to: 80 }] },
    { id: "c", rect: { col: 60, row: 20, cols: 60, rows: 20 } },
  ];
  const at = (x: number, y: number, src = "c") => { const d = dropAt(tiles, area, x, y, src); return d && { kind: d.kind, target: (d as any).target, dir: (d as any).dir, index: (d as any).index }; };
  test("the centre and the header make tabs; over a tab's label it goes before that tab", () => {
    expect(at(30, 20)).toMatchObject({ kind: "tabs", target: "a" });
    expect(at(30, 0)).toMatchObject({ kind: "tabs", target: "a", index: 1 });
    expect(at(65, 0)).toMatchObject({ kind: "tabs", target: "b", index: 0 });
    expect(at(75, 0)).toMatchObject({ kind: "tabs", target: "b", index: 1 });
    expect(at(100, 0)).toMatchObject({ kind: "tabs", target: "b", index: 2 });
  });
  test("the four triangles between the diagonals split in their direction", () => {
    expect(at(5, 20)).toMatchObject({ kind: "split", target: "a", dir: "left" });
    expect(at(55, 20)).toMatchObject({ kind: "split", target: "a", dir: "right" });
    expect(at(30, 3)).toMatchObject({ kind: "split", target: "a", dir: "up" });
    expect(at(30, 37)).toMatchObject({ kind: "split", target: "a", dir: "down" });
    // Near a corner, whichever diagonal side it's on wins.
    expect(at(8, 2)).toMatchObject({ dir: "up" });
    expect(at(4, 6)).toMatchObject({ dir: "left" });
  });
  test("the outer strips win over a tile: left and right columns, the bottom row", () => {
    expect(at(0, 20)).toMatchObject({ kind: "edge", dir: "left" });
    expect(at(1, 20)).toMatchObject({ kind: "edge", dir: "left" });
    expect(at(119, 5)).toMatchObject({ kind: "edge", dir: "right" });
    expect(at(30, 39)).toMatchObject({ kind: "edge", dir: "down" });
    expect(dropAt([tiles[0]!], area, 0, 20, "a")).toBeNull();
  });
  test("onto itself: nothing, unless it's a tab in a set (its centre means nothing; its sides take it out)", () => {
    expect(at(90, 30, "c")).toBeNull();
    expect(at(90, 20, "c")).toBeNull();
    expect(at(90, 10, "x")).toBeNull();
    expect(at(64, 10, "x")).toMatchObject({ kind: "split", target: "b", dir: "left" });
    expect(at(65, 0, "x")).toMatchObject({ kind: "tabs", target: "b", index: 0 });
  });
  test("the ghost is the half a split would give, the whole tile for tabs, 30% of the layout for an edge", () => {
    expect(dropAt(tiles, area, 5, 20, "c")!.ghost).toEqual({ col: 0, row: 0, cols: 30, rows: 40 });
    expect(dropAt(tiles, area, 30, 20, "c")!.ghost).toEqual(tiles[0]!.rect);
    expect(dropAt(tiles, area, 119, 20, "c")!.ghost).toEqual({ col: 84, row: 0, cols: 36, rows: 40 });
  });
});
