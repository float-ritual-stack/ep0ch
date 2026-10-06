// PIE-513: the flow container, the river's columns on the one layout engine: its squeeze, its calm focus, its explicit
// shift, opens into the next column, back and forward, held columns, held at layout level through the screen-layout
// module's interface: no App, no Scratch. Since PIE-515 the river is a flow of river columns (src/river/column.ts).
// Fictional tiles.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import {
  apply, copyTree, describe as describeLayout, flowOf, init, landing, leaf, leaves, place, reviveTree, serialize, splitOf,
  type Ctx, type Flow, type LayoutState, type LNode, type Op, type Person, type TileFacts,
} from "../src/desk/screen-layout";

const PERSON: Actor = { kind: "user" };
const AGENT: Actor = { kind: "agent", id: "tide-agent-513" };
const wide = (cols: number): Rect => ({ col: 0, row: 0, cols, rows: 40 });
let AREA = wide(220);
let holding = new Set<number>();
const facts = (id: number): TileFacts => ({ kind: "reader", notes: true, ...(holding.has(id) ? { holds: true } : {}) });
const ctxOf = (actor: Actor, person: Partial<Person>): Ctx => ({ actor, area: AREA, tile: facts, person: { focus: 1, typingIn: null, busy: false, ...person } });

/** A flow of `n` reader columns (tiles 1..n, "c1".."cn"), the wide one `anchor`. */
function river(n: number, anchor = n): LayoutState {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return init({ tree: flowOf(ids.map(id => leaf(id)), { anchor }), names: new Map(ids.map(id => [id, `c${id}`])) });
}
function ok(s: LayoutState, op: Op, actor: Actor = PERSON, person: Partial<Person> = {}) {
  const r = apply(s, op, ctxOf(actor, person));
  if (!r.ok) throw new Error(`refused: ${r.refused}`);
  return r;
}
function no(s: LayoutState, op: Op, re: RegExp, actor: Actor = PERSON, person: Partial<Person> = {}) {
  const r = apply(s, op, ctxOf(actor, person));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.refused).toMatch(re);
}
const flowIn = (s: LayoutState): Flow<number> => { const f = (function find(n: LNode): Flow<number> | null { return n.t === "flow" ? n : n.t === "leaf" || n.t === "tabs" ? null : n.t === "dock" ? find(n.kid) : n.kids.map(find).find(Boolean) ?? null; })(s.tree); return f!; };
/** Each column's cover, by its first tile: what the strip shows now. */
function covers(s: LayoutState): Record<number, string> {
  const p = place(s, AREA, id => holding.has(id));
  return Object.fromEntries([...p.covers!].map(([id, c]) => [id, c]));
}
/** Every tile's rect, cell for cell: the geometry a calm focus never changes. */
const geometry = (s: LayoutState) => JSON.stringify([...place(s, AREA).rects]);
const wideTile = (s: LayoutState) => flowIn(s).anchor;

describe("the squeeze: full → peek → spine around the wide column", () => {
  test("the wide column and its nearest are full, then peeks, then spines; the strip fills its room exactly", () => {
    AREA = wide(220); holding = new Set();
    const s = river(5);
    expect(covers(s)).toEqual({ 1: "spine", 2: "peek", 3: "peek", 4: "full", 5: "full" });
    const p = place(s, AREA);
    const widths = [1, 2, 3, 4, 5].map(id => p.rects.get(id)!.cols);
    expect(widths.reduce((a, w) => a + w, 0)).toBe(220);
    expect(widths).toEqual([3, 32, 33, 76, 76]);
  });

  test("a peek is drawn whole at reading width, its right side under its neighbour like a dock", () => {
    AREA = wide(220);
    const p = place(river(5), AREA);
    expect(p.boxes!.get(2)!.cols).toBe(76);
    expect(p.rects.get(2)!.cols).toBe(32);
    expect(p.boxes!.get(2)!.col + p.boxes!.get(2)!.cols).toBeGreaterThan(p.rects.get(3)!.col);
    expect(p.boxes!.has(4)).toBe(false);                         // a full column is all shown
  });

  test("too many columns even as spines: the ones nearest the wide one are shown, the rest place nothing", () => {
    AREA = wide(60);
    const s = river(25, 1);
    const p = place(s, AREA);
    expect(p.rects.has(1)).toBe(true);
    expect(p.rects.has(20)).toBe(true);
    expect(p.rects.has(21)).toBe(false);
    expect([...p.rects.values()].reduce((a, r) => a + r.cols, 0)).toBe(60);
  });

  test("a held column, and one holding work (a draft), resist compression; holding lets go of the kept column", () => {
    AREA = wide(220); holding = new Set();
    let s = river(5);
    expect(covers(s)[1]).toBe("spine");
    s = ok(s, { op: "flow.hold", tile: 1, on: true }).state;
    expect(covers(s)[1]).not.toBe("spine");
    expect(flowIn(s).keep).toBeUndefined();
    s = ok(s, { op: "flow.hold", tile: 1, on: false }).state;
    holding = new Set([1]);
    expect(covers(s)[1]).not.toBe("spine");
    holding = new Set();
  });
});

describe("focus never moves the layout", () => {
  test("the keys moving between columns change no column, no rect: the wide one stays", () => {
    AREA = wide(220);
    const s = river(5);
    const before = geometry(s);
    let at = s, focus = 5;
    for (const to of [4, 2, 1, 3]) { const r = ok(at, { op: "focus", tile: to }, PERSON, { focus }); at = r.state; focus = r.focus; }
    expect(focus).toBe(3);
    expect(geometry(at)).toBe(before);
    expect(wideTile(at)).toBe(5);
  });

  test("a key to a column off the strip altogether brings it on by stepping the wide place toward it, no further", () => {
    AREA = wide(60);
    const s = river(25, 1);
    const r = ok(s, { op: "focus", tile: 24 }, PERSON, { focus: 1 });
    expect(place(r.state, AREA).rects.has(24)).toBe(true);
    // Stepped just far enough: one column back would leave it off.
    const back = ok(r.state, { op: "flow.widen", tile: (wideTile(r.state) as number) - 1 }).state;
    expect(place(back, AREA).rects.has(24)).toBe(false);
  });
});

describe("opens into the next column (the flow's open rule)", () => {
  test("the rule is the flow's policy: a column's opens land next, unless a link, opens-into or its policy says otherwise", () => {
    AREA = wide(220);
    const s = river(3);
    expect(landing(s, 2, facts(2))).toEqual({ next: true });
    const current = ok(s, { op: "policy", node: flowIn(s).id!, set: { opens: "current" }, clear: [] }).state;
    expect(landing(current, 2, facts(2))).toBeNull();
    const linked = ok(s, { op: "link", tile: 2, to: 3 }).state;
    expect(landing(linked, 2, facts(2))).toEqual({ to: 3 });
    // Outside a flow, a screen that says `next` has no next column to open into: the current note.
    const plain = init({ tree: splitOf("row", [leaf(1), leaf(2)]), names: new Map([[1, "a"], [2, "b"]]), policy: { opens: "next" } });
    expect(landing(plain, 1, facts(1))).toBeNull();
  });

  test("the person's open lands right after its column, keeps their place to go back to, and shifts only if it must", () => {
    AREA = wide(220);
    // From the wide column: the new one shows full beside it, and nothing shifts.
    const s = river(5);
    const r = ok(s, { op: "open", tile: 6, kind: "reader", name: "c6", at: { kind: "next", from: 5 } }, PERSON, { focus: 5 });
    expect(leaves(r.state.tree)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.focus).toBe(6);
    expect(covers(r.state)[6]).toBe("full");
    // From a squeezed column: the new one takes the wide place, the one it came from stays full beside it.
    const r2 = ok(s, { op: "open", tile: 6, kind: "reader", name: "c6", at: { kind: "next", from: 1 } }, PERSON, { focus: 1 });
    expect(leaves(r2.state.tree)).toEqual([1, 6, 2, 3, 4, 5]);
    expect(wideTile(r2.state)).toBe(6);
    expect(flowIn(r2.state).keep).toBe(1);
    expect(covers(r2.state)[1]).toBe("full");
    expect(covers(r2.state)[6]).toBe("full");
    // Back from it goes to where it was opened from.
    const back = ok(r2.state, { op: "flow.travel", tile: 6, dir: -1 }, PERSON, { focus: 6 });
    expect(back.focus).toBe(1);
  });

  test("an agent's open never takes the keys, nor shifts the layout under the person", () => {
    AREA = wide(220);
    const s = river(5);
    const before = wideTile(s);
    const r = ok(s, { op: "open", tile: 6, kind: "reader", name: "c6", at: { kind: "next", from: 1 } }, AGENT, { focus: 4 });
    expect(r.focus).toBe(4);
    expect(wideTile(r.state)).toBe(before);
    expect(leaves(r.state.tree)).toContain(6);
  });

  test("opening into a column that's already open goes there (back returns to where the open came from)", () => {
    AREA = wide(220);
    const s = river(5);
    const r = ok(s, { op: "open", tile: 2, kind: "reader", at: { kind: "next", from: 5 } }, PERSON, { focus: 5 });
    expect(leaves(r.state.tree)).toEqual([1, 2, 3, 4, 5]);
    expect(r.focus).toBe(2);
    expect(ok(r.state, { op: "flow.travel", tile: 2, dir: -1 }, PERSON, { focus: 2 }).focus).toBe(5);
  });
});

describe("the explicit shift, holding, closing, back and forward", () => {
  test("widen: the column takes the wide place, the one the person was reading stays full; widening the wide one moves nothing", () => {
    AREA = wide(220);
    let s = river(5), focus = 5;
    for (const to of [4, 2]) { const r = ok(s, { op: "focus", tile: to }, PERSON, { focus }); s = r.state; focus = r.focus; }
    const r = ok(s, { op: "flow.widen", tile: 2 }, PERSON, { focus });
    expect(wideTile(r.state)).toBe(2);
    expect(r.focus).toBe(2);                                     // the keys didn't move
    expect(covers(r.state)[2]).toBe("full");
    expect(covers(r.state)[4]).toBe("full");                      // what the person read before stays
    const again = ok(r.state, { op: "flow.widen", tile: 2 });
    expect(again.changed).toBe(false);
    expect(geometry(again.state)).toBe(geometry(r.state));
    // An agent's widen shifts the layout too (said on screen by the caller); the person's keys stay.
    expect(ok(r.state, { op: "flow.widen", tile: 1 }, AGENT, { focus: 2 }).focus).toBe(2);
  });

  test("closing the wide column passes the wide place to the one before it; the keys in it go there too", () => {
    AREA = wide(220);
    const s = river(5);
    const r = ok(s, { op: "close", tile: 5 }, PERSON, { focus: 3 });
    expect(wideTile(r.state)).toBe(4);
    expect(r.focus).toBe(3);                                       // the keys weren't there: they stay
    // The keys in the column closed go to the column before it (the one after, for the first), never out of the flow.
    const beside = init({ tree: splitOf("row", [leaf(10), flowOf([leaf(1), leaf(2), leaf(3)], { anchor: 2 })]), names: new Map([[10, "tree"], [1, "c1"], [2, "c2"], [3, "c3"]]) });
    expect(ok(beside, { op: "close", tile: 3 }, PERSON, { focus: 3 }).focus).toBe(2);
    expect(ok(beside, { op: "close", tile: 1 }, PERSON, { focus: 1 }).focus).toBe(2);
    const first = ok(river(3, 1), { op: "close", tile: 1 }, PERSON, { focus: 2 });
    expect(wideTile(first.state)).toBe(2);
    // A flow stays with one column (it still opens into the next).
    let one = river(2);
    one = ok(one, { op: "close", tile: 1 }, PERSON, { focus: 2 }).state;
    expect(one.tree.t).toBe("flow");
  });

  test("back and forward go between the columns opens made; back to a full column moves only the keys; never an agent's", () => {
    AREA = wide(220);
    let s = river(3);
    s = ok(s, { op: "open", tile: 4, kind: "reader", name: "c4", at: { kind: "next", from: 3 } }, PERSON, { focus: 3 }).state;
    const before = geometry(s);
    const back = ok(s, { op: "flow.travel", tile: 4, dir: -1 }, PERSON, { focus: 4 });
    expect(back.focus).toBe(3);
    expect(geometry(back.state)).toBe(before);                    // it was full: only the keys moved
    const fwd = ok(back.state, { op: "flow.travel", tile: 3, dir: 1 }, PERSON, { focus: 3 });
    expect(fwd.focus).toBe(4);
    no(s, { op: "flow.travel", tile: 4, dir: -1 }, /an agent opens beside/, AGENT, { focus: 4 });
    no(river(3), { op: "flow.travel", tile: 2, dir: -1 }, /nothing to go back to/);
    no(river(3), { op: "flow.travel", tile: 2, dir: 1 }, /nothing ahead: go back first/);
  });

  test("a column holds tiles stacked in it; beside a column is a new one; a flow sizes its columns itself", () => {
    AREA = wide(220);
    const s = river(3);
    const stacked = ok(s, { op: "open", tile: 9, kind: "reader", name: "under", at: { kind: "split", target: 2, dir: "down" } }).state;
    expect(flowIn(stacked).kids.length).toBe(3);
    expect(leaves(flowIn(stacked).kids[1]!)).toEqual([2, 9]);
    const beside = ok(s, { op: "open", tile: 9, kind: "reader", name: "beside", at: { kind: "split", target: 2, dir: "right" } }).state;
    expect(flowIn(beside).kids.length).toBe(4);
    no(s, { op: "collapse", tile: 2, on: true }, /c2 is a column of a flow: it squeezes to a spine by itself/);
    no(s, { op: "grow", tile: 2, axis: "row", by: 1 }, /sizes its columns itself/);
    no(s, { op: "flow.widen", tile: 9 }, /no tile/);
    const locked = ok(s, { op: "policy", node: flowIn(s).id!, set: { locked: true }, clear: [] }).state;
    no(locked, { op: "flow.widen", tile: 1 }, /is locked: widening is refused/);
    no(locked, { op: "flow.hold", tile: 1, on: true }, /is locked: holding a column is refused/);
    // An agent's widen never squeezes the column the person types in; elsewhere it shifts, the keys staying put.
    no(s, { op: "flow.widen", tile: 1 }, /the person is typing in c3, a column of this flow; an agent's widen would squeeze it/, AGENT, { focus: 3, typingIn: 3, busy: true });
    // reveal (tile.preview's) brings a column off the strip on; an agent's never shifts the strip the person types in.
    AREA = wide(60); const long = river(25, 1);
    expect(place(long, AREA).rects.has(24)).toBe(false);
    expect(place(ok(long, { op: "reveal", tile: 24 }, AGENT, { focus: 1 }).state, AREA).rects.has(24)).toBe(true);
    expect(wideTile(ok(long, { op: "reveal", tile: 24 }, AGENT, { focus: 1, typingIn: 1, busy: true }).state)).toBe(1);
    AREA = wide(220);
    no(init({ tree: splitOf("row", [leaf(1), leaf(2)]), names: new Map([[1, "a"], [2, "b"]]) }), { op: "flow.widen", tile: 1 }, /a isn't in a flow/);
  });

  test("a column taken out whole (a stack put in a dock at an edge) leaves the flow a flow, its memory tidied", () => {
    AREA = wide(220);
    const tree: LNode = splitOf("row", [leaf(10), flowOf([leaf(1), splitOf("col", [leaf(2), leaf(3)])], { anchor: 2 })]);
    const s = init({ tree, names: new Map([[10, "tree"], [1, "c1"], [2, "c2"], [3, "c3"]]) });
    const stack = (describeLayout(s, id => s.names.get(id)!) as any).kids[1].kids[1].id as string;
    const r = ok(s, { op: "pin", tile: 2, on: false, edge: "left", container: stack }, PERSON, { focus: 2 }).state;
    const f = flowIn(r);
    expect(f.kids.length).toBe(1);
    expect(f.anchor).toBe(1);                                      // the wide column was in the stack: the one left is wide
    expect(landing(r, 1, facts(1))).toEqual({ next: true });
  });

  test("a flow inside a screen: beside other tiles, in a dock; its memory saved and put back by column", () => {
    AREA = wide(220);
    const tree: LNode = splitOf("row", [leaf(10), flowOf([leaf(1), leaf(2), leaf(3)], { anchor: 2 })], [0.2, 0.8]);
    let s = init({ tree, names: new Map([[10, "tree"], [1, "c1"], [2, "c2"], [3, "c3"]]) });
    s = ok(s, { op: "flow.hold", tile: 1, on: true }).state;
    s = ok(s, { op: "open", tile: 4, kind: "reader", name: "c4", at: { kind: "next", from: 3 } }, PERSON, { focus: 3 }).state;
    const saved = serialize(s, id => ({ t: "leaf" as const, n: s.names.get(id)! }));
    const ids = new Map([...s.names].map(([id, n]) => [n, id]));
    const back = init({ tree: reviveTree(saved.root as any, (l: { n: string }) => ids.get(l.n)!), names: s.names });
    const f0 = flowIn(s), f1 = flowIn(back);
    expect(f1.anchor).toBe(f0.anchor);
    expect(f1.held).toEqual(f0.held);
    expect(f1.trail).toEqual(f0.trail);
    const v = describeLayout(back, id => back.names.get(id)!) as any;
    expect(v.kids[1].flow).toBe(true);
    expect(v.kids[1].held).toEqual(["c1"]);
    // The tree tile beside it keeps its share; the flow squeezes in what's left.
    expect(place(back, AREA).rects.get(10)!.cols).toBe(44);
    void copyTree;
  });
});
