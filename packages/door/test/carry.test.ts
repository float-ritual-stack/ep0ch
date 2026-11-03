// PIE-1547: one carry, and where the keys go when their tile goes, as pure assertions on two LayoutStates: no App, no
// Scratch, no desk. A tile carried between layouts lands whole (its fold, agent level and in-place wire) under a free
// name, both sides asked first; a tile closed or taken gives the person's keys back where its layout says. Made-up tiles.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import { carry, freeName, type CarrySide } from "../src/desk/carry";
import { apply, init, leaf, leaves, splitOf, type Ctx, type LayoutState, type LNode, type Op, type Person } from "../src/desk/screen-layout";

const AREA: Rect = { col: 0, row: 0, cols: 160, rows: 46 };
const PERSON: Actor = { kind: "user" };
const AGENT: Actor = { kind: "agent", id: "porter-1547" };
const KINDS = { all: ["reader", "pty", "query", "tree"], notes: ["reader", "query"] };

const ctxOf = (s: LayoutState, actor: Actor = PERSON, person: Partial<Person> = {}, more: Partial<Ctx> = {}): Ctx => ({
  actor, standing: actor.kind === "user", protectTyping: actor.kind === "agent", area: AREA, kinds: KINDS,
  tile: id => (s.names.get(id)?.replace(/\d+$/, "") === "shell" ? { kind: "pty" } : { kind: "reader", notes: true }),
  person: { focus: leaves(s.tree)[0]!, typingIn: null, busy: false, ...person }, ...more,
});
const side = (s: LayoutState, actor: Actor = PERSON, person: Partial<Person> = {}, more: Partial<Ctx> = {}): CarrySide<number> => ({ state: s, ctx: ctxOf(s, actor, person, more) });
const layout = (tree: LNode, names: [number, string][]) => init({ tree, names: new Map(names) });
function done(s: LayoutState, op: Op, actor: Actor = PERSON, person: Partial<Person> = {}, more: Partial<Ctx> = {}) {
  const r = apply(s, op, ctxOf(s, actor, person, more));
  if (!r.ok) throw new Error(`refused: ${r.refused}`);
  return r;
}

/** A screen of three side by side (outline | list | reader), the list folded to a spine and wired to open in itself. */
function screen() {
  let s = layout(splitOf("row", [leaf(1), leaf(2), leaf(3)], [1, 1, 1]), [[1, "outline"], [2, "list"], [3, "reader"]]);
  s = done(s, { op: "collapse", tile: 2, on: true }, PERSON, { focus: 1 }).state;
  s = done(s, { op: "link", tile: 2, to: 2, verb: "open" }, PERSON, { focus: 1 }).state;
  s = done(s, { op: "agents", tile: 2, level: "edit" }, PERSON, { focus: 1 }).state;
  return s;
}
/** The drawer: two tabs side by side (a shell and a reader), so a fold has a side to fold against. */
const drawer = () => layout(splitOf("row", [leaf(10), leaf(11)], [1, 1]), [[10, "shell"], [11, "notes"]]);

describe("one carry", () => {
  test("a folded tile with an in-place wire and an agent level lands whole: one take, one open, nothing re-applied after", () => {
    const from = screen(), to = drawer();
    const r = carry(side(from, PERSON, { focus: 2 }), side(to), { tile: 2, land: { id: 12, kind: "reader", at: { kind: "split", target: 11, dir: "right" } } });
    if (!r.ok) throw new Error(r.refused);
    expect(leaves(r.from.state.tree)).toEqual([1, 3]);
    expect(r.from.state.names.has(2)).toBe(false);
    expect(r.to.state.names.get(12)).toBe("list");
    expect(r.to.state.collapsed.get(12)).toBeDefined();
    expect(r.to.state.agents.get(12)).toBe("edit");
    expect(r.to.state.wires).toContainEqual({ from: 12, to: 12, verb: "open" });
    expect(r.dropped).toEqual([]);
    // Both answers are of the layouts as they were: nothing is committed until both may be.
    expect(r.from.base).toBe(from);
    expect(r.to.base).toBe(to);
    // The person's keys were in it: they follow it.
    expect(r.keys).toBe(true);
  });

  test("what can't land is named, never swallowed: a float takes no fold", () => {
    const r = carry(side(screen(), PERSON, { focus: 1 }), side(drawer()), { tile: 2, land: { id: 12, kind: "reader", at: { kind: "float", rect: { col: 4, row: 2, cols: 40, rows: 10 } } }, keys: false });
    if (!r.ok) throw new Error(r.refused);
    expect(r.to.state.collapsed.has(12)).toBe(false);
    expect(r.dropped).toEqual([expect.stringMatching(/fold/)]);
    expect(r.to.state.wires).toContainEqual({ from: 12, to: 12, verb: "open" });
    expect(r.keys).toBe(false);
  });

  test("the keys follow only when they were in it, for the person, and the destination takes them", () => {
    const at = { kind: "split" as const, target: 11, dir: "right" as const };
    const notIn = carry(side(screen(), PERSON, { focus: 1 }), side(drawer()), { tile: 3, land: { id: 12, kind: "reader", at } });
    const elsewhere = carry(side(screen(), PERSON, { focus: 3, here: false }), side(drawer()), { tile: 3, land: { id: 12, kind: "reader", at } });
    const glass = carry(side(screen(), PERSON, { focus: 3 }), side(drawer()), { tile: 3, land: { id: 12, kind: "reader", at: { kind: "float" } }, keys: false });
    expect([notIn, elsewhere, glass].map(r => r.ok && r.keys)).toEqual([false, false, false]);
  });

  test("it arrives under a free name: its own, else the next number, the layer beside it counted but not itself", () => {
    const to = layout(splitOf("row", [leaf(10), leaf(11)], [1, 1]), [[10, "reader"], [11, "reader2"]]);
    const r = carry(side(screen(), PERSON, { focus: 1 }), side(to, PERSON, {}, { otherNames: ["reader", "outline"] }), { tile: 3, land: { id: 12, kind: "reader", at: { kind: "split", target: 11, dir: "right" } } });
    if (!r.ok) throw new Error(r.refused);
    expect(r.name).toBe("reader3");
    expect(r.to.state.names.get(12)).toBe("reader3");
    expect(freeName(["shell", "shell2"], "shell")).toBe("shell3");
    expect(freeName(["notes"], "shell")).toBe("shell");
  });

  test("both sides are asked first: a refusal on either names its side and changes nothing", () => {
    const from = screen();
    const last = layout(leaf(1), [[1, "outline"]]);
    const out = carry(side(last), side(drawer()), { tile: 1, land: { id: 12, kind: "reader", at: { kind: "split", target: 11, dir: "right" } } });
    expect(out).toMatchObject({ ok: false, side: "from", refused: expect.stringMatching(/last tile/) });
    const locked = done(drawer(), { op: "lock", on: true }).state;
    const into = carry(side(from, PERSON, { focus: 1 }), side(locked), { tile: 3, land: { id: 12, kind: "reader", at: { kind: "split", target: 11, dir: "right" } } });
    expect(into).toMatchObject({ ok: false, side: "to" });
    expect(leaves(from.tree)).toEqual([1, 2, 3]);
  });

  test("a screen's last tile leaves an heir in its place, under its name", () => {
    const r = carry(side(layout(leaf(1), [[1, "outline"]])), side(drawer()), { tile: 1, heir: { id: 5 }, land: { id: 12, kind: "reader", at: { kind: "float" } }, keys: false });
    if (!r.ok) throw new Error(r.refused);
    expect(leaves(r.from.state.tree)).toEqual([5]);
    expect(r.from.state.names.get(5)).toBe("outline");
  });

  test("an agent carries a tile, never the person's keys", () => {
    const r = carry(side(screen(), AGENT, { focus: 1 }), side(drawer(), AGENT), { tile: 3, land: { id: 12, kind: "reader", at: { kind: "split", target: 11, dir: "right" } } });
    if (!r.ok) throw new Error(r.refused);
    expect(r.keys).toBe(false);
  });
});

describe("where the keys go when their tile goes", () => {
  /** A float opened from the reader (3), the person's keys in it. */
  function floatFrom(typing = false) {
    let s = screen();
    s = done(s, { op: "open", tile: 7, kind: "reader", name: "peek", at: { kind: "float" } }, PERSON, { focus: 3 }).state;
    s = done(s, { op: "opened", tile: 7, from: 3, ...(typing ? { typing } : {}) }, PERSON, { focus: 7 }).state;
    return s;
  }

  test("closing a tile opened from another gives the keys back to it, and the answer says so", () => {
    const r = done(floatFrom(), { op: "close", tile: 7 }, PERSON, { focus: 7 });
    expect(r.focus).toBe(3);
    expect(r.answer.keys).toEqual({ tile: "reader", by: "opener" });
    expect(r.state.openedFrom.size).toBe(0);
  });

  test("back into the program they were typing in: the answer says to type there again", () => {
    const r = done(floatFrom(true), { op: "close", tile: 7 }, PERSON, { focus: 7 });
    expect(r.answer.keys).toEqual({ tile: "reader", by: "opener", typing: true });
  });

  test("a take (to the drawer, a group) answers the same way: the record is the layout's, not the closer's", () => {
    const r = done(floatFrom(), { op: "take", tile: 7 }, PERSON, { focus: 7 });
    expect(r.focus).toBe(3);
    expect(r.answer.keys).toMatchObject({ by: "opener" });
  });

  test("keys elsewhere stay where they are; an agent's close never moves them back", () => {
    expect(done(floatFrom(), { op: "close", tile: 7 }, PERSON, { focus: 1 }).answer.keys).toBeUndefined();
    const s = floatFrom();
    expect(done(s, { op: "close", tile: 7 }, AGENT, { focus: 1 }).focus).toBe(1);
  });

  test("its opener gone first, the record goes with it and the heir takes the keys", () => {
    const s = done(floatFrom(), { op: "close", tile: 3 }, PERSON, { focus: 7 }).state;
    expect(s.openedFrom.size).toBe(0);
    const r = done(s, { op: "close", tile: 7 }, PERSON, { focus: 7 });
    expect(r.answer.keys).toBeUndefined();
  });

  test("a tile opened into a container (the board's detail) gives them to the tile opened there now, else home", () => {
    const s = layout(splitOf("row", [leaf(1), splitOf("col", [leaf(2), leaf(3)], [1, 1])], [1, 2]), [[1, "lanes"], [2, "detail"], [3, "detail2"]]);
    const key = (s.tree as { kids: LNode[] }).kids[1]!;
    const opened = (ids: number[], active: number | null) => new Map([[(key as { id: string }).id, { ids, active }]]);
    const r = done(s, { op: "close", tile: 3 }, PERSON, { focus: 3 }, { opened: opened([2, 3], null), home: 1 });
    expect(r.focus).toBe(2);
    expect(r.answer.keys).toEqual({ tile: "detail", by: "into" });
    const home = done(s, { op: "close", tile: 3 }, PERSON, { focus: 3 }, { opened: opened([3], null), home: 1 });
    expect(home.focus).toBe(1);
    expect(home.answer.keys).toEqual({ tile: "lanes", by: "home" });
  });
});
