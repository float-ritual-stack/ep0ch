// PIE-513: the screen-layout module, through its interface. Every layout change is one operation applied for one
// actor as one transaction: the new state, or a refusal with its reason and nothing changed. The rules the round-2
// review found broken one caller at a time (B7–B11, C3, C4) are the module's own, checked here with no App, no
// Scratch, no desk: plain states, plain operations. Fictional tiles.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import {
  apply, describe as describeLayout, dockOf, hostDock, hostLayer, HOST_SCREEN, init, placement, leaf, leaves, place, placeHost, policyAt, refusal, reviveTree, serialize, splitOf, tabsOf, visible,
  type Ctx, type LayoutState, type LNode, type Op, type Person, type TileFacts,
} from "../src/desk/screen-layout";

const AREA: Rect = { col: 0, row: 0, cols: 160, rows: 46 };
const PERSON: Actor = { kind: "user" };
const AGENT: Actor = { kind: "agent", id: "ferry-agent-513" };

/** The desk's own layout, by number: tree | reader | thread over activity (one row of three, as the module keeps it plain). */
const NAMES = new Map([[1, "tree"], [2, "reader"], [3, "thread"], [4, "activity"]]);
const deskTree = (): LNode => splitOf("row", [leaf(1), splitOf("row", [leaf(2), splitOf("col", [leaf(3), leaf(4)], [0.58, 0.42])], [0.66, 0.34])], [0.24, 0.76]);
const fresh = (tree: LNode = deskTree(), names = NAMES) => init({ tree, names });

/** What each tile is: a kind by name (tree, thread, activity; else reader), readers take notes. */
let extra: Record<number, Partial<TileFacts>> = {};
const facts = (id: number): TileFacts => {
  const n = NAMES.get(id) ?? "reader";
  const kind = ["tree", "thread", "activity", "query", "pty"].includes(n) ? n : n.startsWith("q") ? "query" : "reader";
  return { kind, notes: kind === "reader", ...extra[id] };
};
const ctxOf = (actor: Actor, person: Partial<Person> = {}, area = AREA): Ctx => ({
  actor, standing: actor.kind === "user" || !!person.yolo, protectTyping: actor.kind === "agent" && !person.yolo, area, tile: facts, person: { focus: 2, typingIn: null, busy: false, ...person },
  kinds: { all: ["reader", "tree", "thread", "activity", "query", "pty", "preview"], notes: ["reader"] },
});

/** Apply `op`, expecting it done: its state and where the keys went. */
function ok(s: LayoutState, op: Op, actor: Actor = PERSON, person: Partial<Person> = {}) {
  const r = apply(s, op, ctxOf(actor, person));
  if (!r.ok) throw new Error(`refused: ${r.refused}`);
  return r;
}
/** Apply `op`, expecting a refusal matching `re`; the state the caller holds is exactly as it was. */
function no(s: LayoutState, op: Op, re: RegExp, actor: Actor = PERSON, person: Partial<Person> = {}) {
  const before = JSON.stringify(serialize(s, id => ({ t: "leaf", id })));
  const r = apply(s, op, ctxOf(actor, person));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.refused).toMatch(re);
  expect(JSON.stringify(serialize(s, id => ({ t: "leaf", id })))).toBe(before);
}
const names = (s: LayoutState, ids: number[]) => ids.map(id => s.names.get(id));
const treeNames = (s: LayoutState) => names(s, leaves(s.tree));
const floated = (s: LayoutState) => names(s, s.floats.map(f => f.id));
/** The state with tile `id` popped out as a float, by the person. */
const withFloat = (s: LayoutState, id: number) => ok(s, { op: "float", tile: id }).state;

test("a lift keeps the layout and keys, and an agent cannot replace the person's lift", () => {
  const before = fresh();
  let s = before;
  for (let i = 0; i < 10; i++) {
    s = ok(s, { op: "zoom", tile: 3, reach: "column" }).state;
    expect(s.lift).toEqual({ tile: 3, reach: "column", by: PERSON });
    expect(s.tree).toEqual(before.tree);
    expect(s.rev).toBe(before.rev);
    no(s, { op: "zoom", tile: 4, reach: "full" }, /person.*lift/, AGENT);
    s = ok(s, { op: "zoom", tile: 3, reach: "column", on: false }).state;
  }
  expect(s).toEqual(before);
  const lifted = ok(s, { op: "zoom", tile: 4, reach: "full" }, AGENT);
  expect(lifted.focus).toBe(2);
  expect(lifted.state.lift?.by).toEqual(AGENT);
  no(s, { op: "zoom", tile: 2, reach: "column" }, /person.*keys/, AGENT);
});

// PIE-1342: a tab behind another is drawn lifted only from the front of its tabs, so a lift brings it there; an agent's
// never switches away the tab the person is in (Codex review), only where their keys aren't (a drawer put away).
test("a lift brings a tab behind another to the front; an agent's never hides the person's tab", () => {
  const tabbed = fresh(splitOf("col", [leaf(1), { t: "tabs", ids: [2, 3], active: 0 }]));
  for (const reach of ["column", "full"] as const) {
    const up = ok(tabbed, { op: "zoom", tile: 3, reach }), lifted = up.state;
    expect([visible(lifted.tree).includes(3), lifted.lift?.tile, up.focus]).toEqual([true, 3, 3]);   // the keys move with the tab
    no(tabbed, { op: "zoom", tile: 3, reach }, /person.*keys/, AGENT);
    no(tabbed, { op: "zoom", tile: 3, reach }, /person.*keys/, AGENT, { focus: 1, typingIn: 2 });
    const off = ok(tabbed, { op: "zoom", tile: 3, reach }, AGENT, { here: false }), away = off.state;
    expect([visible(away.tree).includes(3), away.lift?.tile, off.focus]).toEqual([true, 3, 3]);
  }
});
test("a spine lifted or zoomed opens first, and stays open when dropped", () => {
  const folded = ok(fresh(), { op: "collapse", tile: 1, on: true }).state;
  for (const [op, actor] of [[{ op: "zoom", tile: 1, reach: "column" }, PERSON], [{ op: "zoom", tile: 1, reach: "full" }, AGENT], [{ op: "zoom", tile: 1 }, PERSON]] as [Op, Actor][]) {
    const s = ok(folded, op, actor).state;
    expect(s.collapsed.has(1)).toBe(false);
    expect(place(s, AREA).rects.get(1)!.cols).toBeGreaterThan(3);
    expect(ok(s, { ...op, on: false } as Op, actor).state.collapsed.has(1)).toBe(false);
  }
  expect(ok(folded, { op: "zoom", tile: 1, reach: "column", on: false }).state.collapsed.has(1)).toBe(true);
});

test("focus leaving a lifted tile drops it through apply", () => {
  const s = ok(fresh(), { op: "zoom", tile: 2, reach: "full" }).state;
  expect(ok(s, { op: "focus", tile: 2 }).state.lift).toEqual(s.lift);
  const moved = ok(s, { op: "focus", tile: 3 });
  expect(moved.focus).toBe(3);
  expect(moved.state.lift).toBeNull();
});

describe("one operation, one transaction", () => {
  test("the last tile closes to an empty home and another tile can open there (PIE-1119)", () => {
    extra = {};
    const closed = ok(fresh(leaf(2)), { op: "close", tile: 2 }).state;
    expect(leaves(closed.tree)).toEqual([]);
    expect(closed.names.has(2)).toBe(false);
    const reopened = ok(closed, { op: "open", tile: 9, kind: "reader", name: "new", at: { kind: "edge", dir: "right" } }).state;
    expect(leaves(reopened.tree)).toEqual([9]);
  });

  test("the replacement select target survives open and alt changes, and closing a target removes only its wires", () => {
    extra = { 3: { notes: true }, 4: { notes: true } };
    let s = ok(fresh(), { op: "link", tile: 1, to: 3, verb: "select" }).state;
    s = ok(s, { op: "link", tile: 1, to: 4, verb: "select" }).state;
    s = ok(s, { op: "link", tile: 1, to: 2, verb: "open" }).state;
    s = ok(s, { op: "link", tile: 1, to: 3, verb: "alt" }).state;
    expect(placement(s, { from: 1, fresh: false, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 2 });
    expect(placement(s, { from: 1, fresh: true, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 3 });
    expect(s.wires.filter(w => w.verb === "select").map(w => w.to)).toEqual([4]);
    s = ok(s, { op: "close", tile: 3 }).state;
    expect(s.wires).toEqual([{ from: 1, verb: "select", to: 4 }, { from: 1, verb: "open", to: 2 }]);
    extra = {};
  });
  test("alt rules resolve through landing, with a screen default and a first unheld reader", () => {
    let s = ok(fresh(), { op: "link", tile: 1, to: 2 }).state;
    expect(placement(s, { from: 1, fresh: true, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ beside: 2 });
    for (const rule of ["tab", "beside", "tile"] as const) {
      s = ok(s, { op: "link", tile: 1, to: 2, verb: "alt", rule }).state;
      expect(placement(s, { from: 1, fresh: true, note: "arrival" }, ctxOf(PERSON)).route).toEqual(rule === "tile" ? { to: 2 } : rule === "tab" ? { tab: 2 } : { beside: 2 });
    }
    s = ok(s, { op: "link", tile: 1, verb: "alt" }).state;
    s = ok(s, { op: "policy", set: { altOpens: "first-unheld" }, clear: [] }).state;
    extra = { 2: { held: true }, 3: { notes: true } };
    try { expect(placement(s, { from: 1, fresh: true, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 3 }); }
    finally { extra = {}; }
  });
  test("a refused operation changes nothing and says why; a done one answers a new state, the old one left as it was", () => {
    extra = {};
    const s = fresh();
    no(s, { op: "move", tile: 2, to: { kind: "split", target: 2, dir: "left" } }, /reader can't go there: that's where it is/);
    const r = ok(s, { op: "move", tile: 4, to: { kind: "edge", dir: "left" } });
    expect(treeNames(r.state)[0]).toBe("activity");
    expect(treeNames(s)).toEqual(["tree", "reader", "thread", "activity"]);
    expect(r.focus).toBe(4);
  });

  test("the state can't be changed past the module: it's frozen, so a caller writing to it throws", () => {
    const s = fresh();
    expect(() => { (s.tree as any).weights = [1, 1]; }).toThrow();
    expect(() => { (s.floats as any).push({ id: 9, rect: AREA }); }).toThrow();
    expect(() => { (s.policy as any).locked = true; }).toThrow();
  });

  test("the revision moves with the shape only; expected= refuses when the shape changed since", () => {
    const s = fresh();
    const sized = ok(s, { op: "resize", path: "", border: 0, share: 0.3 }).state;
    expect(sized.rev).toBe(s.rev);                                    // shares aren't the shape
    const moved = ok(s, { op: "move", tile: 4, to: { kind: "edge", dir: "left" } }).state;
    expect(moved.rev).toBe(s.rev + 1);
    const r = apply(moved, { op: "close", tile: 3 }, { ...ctxOf(AGENT), expected: s.rev });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toMatch(/the layout changed since revision/);
    expect(apply(moved, { op: "close", tile: 3 }, { ...ctxOf(AGENT), expected: moved.rev }).ok).toBe(true);
  });

  test("ids: every container gets one, kept through changes that keep it, never handed out twice", () => {
    const s = fresh();
    const v = describeLayout(s, id => s.names.get(id)!) as any;
    expect(v.id).toMatch(/^s\d+$/);
    const t = ok(s, { op: "move", tile: 3, to: { kind: "tabs", target: 4 } }).state;
    const tabs = tabsOf(t.tree, 3)!;
    expect(tabs.id).toMatch(/^g\d+$/);
    const back = ok(t, { op: "move", tile: 3, to: { kind: "split", target: 4, dir: "up" } }).state;
    const again = ok(back, { op: "move", tile: 3, to: { kind: "tabs", target: 4 } }).state;
    expect(tabsOf(again.tree, 3)!.id).not.toBe(tabs.id);
  });
});

describe("floats have no place in the tree (B7, B8, B9)", () => {
  test("B7: a swap with a float is refused both ways: no tile lost, none shown twice", () => {
    const s = withFloat(fresh(), 2);
    no(s, { op: "swap", tile: 1, with: 2 }, /reader is a float: a swap needs a tile in the layout/);
    no(s, { op: "swap", tile: 2, with: 1 }, /reader is a float/);
    expect(floated(s)).toEqual(["reader"]);
    const swapped = ok(s, { op: "swap", tile: 1, with: 3 }).state;
    expect(treeNames(swapped)).toEqual(["thread", "tree", "activity"]);
  });

  test("B8: nothing opens beside a float or into its tabs, nor folds; along an outer edge is fine", () => {
    const s = withFloat(fresh(), 2);
    no(s, { op: "open", tile: 9, kind: "pty", name: "ghost", at: { kind: "split", target: 2, dir: "right" } }, /reader is a float: putting ghost beside it needs a tile in the layout/);
    no(s, { op: "open", tile: 9, kind: "pty", name: "ghost", at: { kind: "tabs", target: 2 } }, /into its tabs/);
    no(s, { op: "move", tile: 3, to: { kind: "split", target: 2, dir: "left" } }, /reader is a float/);
    no(s, { op: "collapse", tile: 2, on: true }, /reader is a float: a spine/);
    const r = ok(s, { op: "open", tile: 9, kind: "reader", name: "edgy", at: { kind: "edge", dir: "right" } }).state;
    expect(treeNames(r)).toContain("edgy");
    expect(r.names.get(9)).toBe("edgy");
  });

  test("a new float reads: half the screen, never narrower than a note at 40 columns (PIE-1392)", () => {
    const narrow: Rect = { col: 0, row: 0, cols: 40, rows: 46 };
    const r = apply(fresh(), { op: "float", tile: 2 }, ctxOf(PERSON, {}, narrow));
    if (!r.ok) throw new Error(r.refused);
    const f = r.state.floats[0]!.rect;
    expect(f.cols).toBe(38);
    expect(f.col + f.cols).toBeLessThanOrEqual(40);
    // A wide screen keeps half of it.
    expect(withFloat(fresh(), 2).floats[0]!.rect.cols).toBe(80);
  });

  test("B9: a float goes back only where the containers take it: another place if the first refuses, else refused with why", () => {
    // The keys on activity, in a split that takes only query tiles: the reader float can't drawer beside it.
    let s = withFloat(fresh(), 2);
    const col = leaves(s.tree).includes(3) ? (describeLayout(s, id => String(id)) as any) : null;
    expect(col).not.toBeNull();
    s = ok(s, { op: "policy", tile: 4, set: { accepts: ["query"] }, clear: [] }).state;
    const back = ok(s, { op: "float", tile: 2 }, PERSON, { focus: 4 }).state;
    expect(floated(back)).toEqual([]);
    expect(policyAt(back, 2, facts(2)).accepts).toBeNull();          // beside a tile whose containers take it
    // The whole screen takes only query tiles: nowhere, and it stays a float.
    const screen = ok(s, { op: "policy", node: "screen", set: { accepts: ["query"] }, clear: [] }).state;
    no(screen, { op: "float", tile: 2 }, /takes only query: not reader \(reader\)/, PERSON, { focus: 4 });
    // A shut dock is never where a float drawers: it wouldn't be shown.
    let d = ok(fresh(), { op: "pin", tile: 1, on: false, edge: "left" }).state;
    d = ok(d, { op: "slide", tile: 1, open: false }, PERSON, { focus: 1 }).state;
    d = withFloat(d, 2);
    d = ok(d, { op: "policy", tile: 4, set: { accepts: ["query"] }, clear: [] }).state;
    const out = ok(d, { op: "float", tile: 2 }, PERSON, { focus: 4 }).state;
    expect(names(out, visible(out.tree))).toContain("reader");
  });
});

describe("containers keep their tiles and their rules (B10, B11)", () => {
  test("B10: a container's policy stays when a move leaves it one tile; a tile moved back is under it again", () => {
    let s = ok(fresh(), { op: "policy", tile: 3, set: { accepts: ["thread", "activity"] }, clear: [] }).state;
    const id = (describeLayout(s, id => s.names.get(id)!) as any).kids[2].id as string;
    s = ok(s, { op: "move", tile: 4, to: { kind: "edge", dir: "down" } }).state;
    expect(policyAt(s, 3, facts(3)).accepts).toEqual(["thread", "activity"]);
    expect(policyAt(s, 3, facts(3)).by.accepts).toBe(id);
    no(s, { op: "move", tile: 2, to: { kind: "split", target: 3, dir: "down" } }, new RegExp(`${id} takes only thread, activity: not reader`));
    s = ok(s, { op: "move", tile: 4, to: { kind: "split", target: 3, dir: "down" } }).state;
    expect(policyAt(s, 4, facts(4)).by.accepts).toBe(id);
  });

  test("B11: the last laid-out tile isn't put in a dock; the last dock showing anything doesn't shut", () => {
    let s = fresh();
    for (const id of [1, 2, 3]) s = ok(s, { op: "pin", tile: id, on: false }, PERSON, { focus: id }).state;
    no(s, { op: "pin", tile: 4, on: false }, /activity is the last tile not docked/, PERSON, { focus: 4 });
    no(s, { op: "pin", tile: 4, on: false, edge: "right" }, /last tile not docked/, PERSON, { focus: 4 });
    for (const id of [1, 2, 3]) s = ok(s, { op: "slide", tile: id, open: false }, PERSON, { focus: 4 }).state;
    expect(names(s, visible(s.tree))).toEqual(["activity"]);
    // The one laid-out tile closes: the screen opens a dock, and the keys go to what it shows.
    s = ok(s, { op: "slide", tile: 1, open: false }, PERSON, { focus: 1 }).state;
    const r = ok(s, { op: "close", tile: 4 }, PERSON, { focus: 1 });
    expect(visible(r.state.tree).length).toBeGreaterThan(0);
    expect(visible(r.state.tree)).toContain(r.focus);
    no(r.state, { op: "slide", tile: r.focus, open: false }, /all the screen shows/, PERSON, { focus: r.focus });
  });

  test("a whole layout put back from a save where every tile is in a shut dock opens one", () => {
    const tree: LNode = splitOf("row", [{ t: "dock", kid: leaf(1), edge: "left", open: false }, { t: "dock", kid: leaf(2), edge: "right", open: false }]);
    const s = init({ tree, names: NAMES });
    expect(visible(s.tree).length).toBe(1);
  });

  test("the nearest policy wins, and a lock above locks everything below", () => {
    // The screen says tiles stay where they are; the column of thread and activity says they move, and is locked.
    let s = ok(fresh(), { op: "policy", node: "screen", set: { draggable: false }, clear: [] }).state;
    no(s, { op: "move", tile: 2, to: { kind: "edge", dir: "left" } }, /reader stays where it is: the screen keeps its tiles in place · \^W P there turns draggable on/);
    s = ok(s, { op: "policy", tile: 3, set: { draggable: true }, clear: [] }).state;
    expect(policyAt(s, 3, facts(3)).draggable).toBe(true);           // the nearest says it
    expect(policyAt(s, 2, facts(2)).draggable).toBe(false);
    s = ok(s, { op: "policy", tile: 3, set: { locked: true }, clear: [] }).state;
    const e = policyAt(s, 3, facts(3));
    expect(e.locked).toBe(true);
    no(s, { op: "move", tile: 4, to: { kind: "edge", dir: "left" } }, /is locked: moving activity is refused/);
    no(s, { op: "resize", path: "2", border: 0, share: 0.5 }, /is locked: resizing is refused/);
    no(s, { op: "close", tile: 3 }, /is locked: closing thread is refused/);
    // The tree beside it isn't under that lock (only the screen's draggable off, which a tile's own policy can't lift).
    expect(ok(fresh(), { op: "policy", tile: 3, set: { locked: true }, clear: [] }).state).toBeTruthy();
    expect(ok(ok(fresh(), { op: "policy", tile: 3, set: { locked: true }, clear: [] }).state, { op: "move", tile: 1, to: { kind: "edge", dir: "right" } }).state).toBeTruthy();
    // The screen's lock: evening out is refused; a tile that doesn't move still focuses.
    const locked = ok(fresh(), { op: "lock", on: true }).state;
    no(locked, { op: "even" }, /the screen is locked: evening it out is refused/);
    no(locked, { op: "load", name: "desk" }, /the screen is locked: loading desk would change its shape/);
    expect(ok(locked, { op: "focus", tile: 4 }).focus).toBe(4);
  });

  test("a refusal names a container by its key when it has one, never by its id (round 3)", () => {
    extra = {};
    const keyed = splitOf("col", [leaf(3), leaf(4)], [0.5, 0.5]);
    (keyed as { key?: string }).key = "lanes";
    const s = ok(fresh(splitOf("row", [leaf(1), leaf(2), keyed])), { op: "policy", tile: 3, set: { draggable: false }, clear: [] }).state;
    no(s, { op: "move", tile: 3, to: { kind: "edge", dir: "left" } }, /thread stays where it is: the lanes container keeps its tiles in place · \^W P there turns draggable on/);
  });

  test("a policy that keeps tiles: closable off folds instead; accepts and droppable refuse with who said so", () => {
    extra = {};
    let s = ok(fresh(), { op: "policy", tile: 3, set: { closable: false, droppable: false }, clear: [] }).state;
    no(s, { op: "close", tile: 4 }, /activity stays: s\d+ keeps its tiles · tile.collapse folds it to a spine · \^W P there turns closable on/);
    no(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "down" } }, /takes no drops: .* · \^W P there turns droppable on/);
    extra = { 2: { keeps: "hub:fern supplies it, and it goes when its data does" } };
    no(fresh(), { op: "close", tile: 2 }, /reader stays: hub:fern supplies it/);
    extra = { 2: { editing: "an edit" } };
    no(fresh(), { op: "close", tile: 2 }, /not closed: it holds an edit/);
    extra = {};

  });

  test("tab rules: a tile's kind may take only some kinds as tabs", () => {
    extra = { 3: { tabs: ["thread"] } };
    no(fresh(), { op: "move", tile: 2, to: { kind: "tabs", target: 3 } }, /thread \(thread\) takes only thread as tabs: not reader/);
    extra = {};
  });
});

describe("agents never take the person's place (C3, C4)", () => {
  const typing: Partial<Person> = { focus: 2, typingIn: 2, busy: true };

  test("C3: an agent never pins, moves, floats or places the tile the person is typing in; the person can", () => {
    const s = fresh();
    no(s, { op: "pin", tile: 2, on: false }, /the person is typing in reader; an agent doesn't move it/, AGENT, typing);
    no(s, { op: "pin", tile: 2, on: false, edge: "left" }, /the person is typing in /, AGENT, typing);
    no(s, { op: "move", tile: 2, to: { kind: "edge", dir: "left" } }, /the person is typing in /, AGENT, typing);
    no(s, { op: "float", tile: 2 }, /an agent doesn't float it/, AGENT, typing);
    no(s, { op: "swap", tile: 3, with: 2 }, /the person is typing in /, AGENT, typing);
    const f = withFloat(s, 2);
    no(f, { op: "place", tile: 2, dx: 4 }, /the person is typing in /, AGENT, typing);
    expect(ok(s, { op: "pin", tile: 2, on: false }, PERSON, typing).state).toBeTruthy();
    // Another tile, the agent may move where it leaves their tile's size alone: the person's keys stay where they are.
    const r = ok(s, { op: "move", tile: 3, to: { kind: "split", target: 4, dir: "down" } }, AGENT, typing);
    expect(r.focus).toBe(2);
    // A move that would narrow their tile (a tile put along the left edge) is refused, as a resize is (PIE-1294).
    no(s, { op: "move", tile: 4, to: { kind: "edge", dir: "left" } }, /^the person is typing in reader; an agent doesn't resize it/, AGENT, typing);
  });

  test("an agent never resizes the tile the person is typing in: a border, a split's shares, a grow, evening out (round 3, C4)", () => {
    const s = fresh();
    no(s, { op: "resize", path: "", border: 0, share: 0.4 }, /the person is typing in reader; an agent doesn't resize it/, AGENT, typing);
    no(s, { op: "resize", path: "", border: 1, share: 0.4 }, /the person is typing in reader; an agent doesn't resize it/, AGENT, typing);
    no(s, { op: "shares", split: "s1", shares: [1, 1, 1] }, /the person is typing in /, AGENT, typing);
    no(s, { op: "grow", tile: 1, axis: "row", by: 2 }, /the person is typing in /, AGENT, typing);
    no(s, { op: "even" }, /the person is typing in /, AGENT, typing);
    // Yolo hands agents the keys too (Evan, Oct 22): the typing guard lifts.
    expect(ok(s, { op: "even" }, AGENT, { ...typing, yolo: true }).state).toBeTruthy();
    // A border that leaves their tile's size alone (thread over activity), the agent may move; the person may move any.
    expect(ok(s, { op: "resize", path: "2", border: 0, share: 0.3 }, AGENT, typing).state).toBeTruthy();
    expect(ok(s, { op: "resize", path: "", border: 0, share: 0.4 }, PERSON, typing).state).toBeTruthy();
    expect(ok(s, { op: "even" }, AGENT, { focus: 2, typingIn: null, busy: false }).state).toBeTruthy();
    // A border between two other tiles in a line over theirs (tree | reader, the person in thread): never refused,
    // at any share, though thread's cells may round by one as the screen re-lays out.
    const inThread: Partial<Person> = { focus: 3, typingIn: 3, busy: true };
    for (let x = 10; x <= 90; x++) expect({ x, ok: apply(s, { op: "resize", path: "", border: 0, share: x / 100 }, ctxOf(AGENT, inThread)).ok }).toEqual({ x, ok: true });
    no(s, { op: "resize", path: "", border: 1, share: 0.4 }, /the person is typing in thread; an agent doesn't resize it/, AGENT, inThread);
  });

  // PIE-1294, seen in use Oct 29: an agent's tile.open (a split beside the focused tile) and its open naming no tile
  // took Evan's 44-column edit tile to about 21. At his four-reader desk (177 columns) his tile keeps its rect.
  test("an agent's open never resizes the tile the person is typing in: a new tile, a note's landing (PIE-1294)", () => {
    const desk = new Map([[1, "r1"], [2, "r2"], [3, "r3"], [4, "r4"]]);
    const four = () => init({ tree: splitOf("row", [leaf(1), leaf(2), leaf(3), leaf(4)]), names: desk });
    const area: Rect = { col: 0, row: 0, cols: 177, rows: 60 };
    const inR1: Partial<Person> = { focus: 1, typingIn: 1, busy: true };
    const run = (s: LayoutState, op: Op, actor: Actor = AGENT) => apply(s, op, ctxOf(actor, inR1, area));
    // Where it is on screen, in cells: never narrowed, and never shifted along by a spine kept left of it.
    const r1 = (s: LayoutState) => place(s, area).rects.get(1);
    const s = four();
    const before = r1(s);
    // tile.open beside the tile with the keys: refused in the owner's words, nothing changed.
    const split = run(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 1, dir: "right" } });
    expect(split.ok ? "opened" : split.refused).toMatch(/^the person is typing in r1; an agent doesn't resize it/);
    // Naming no place (PIE-1444) changes nothing here: a float would cover their edit, so the typing guard answers.
    const unnamed = run(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 1, dir: "right" }, unnamed: true });
    expect(unnamed.ok ? "opened" : unnamed.refused).toMatch(/^the person is typing in r1; an agent doesn't resize it/);
    // Beside another tile it opens, and r1 is as it was.
    const beside = run(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "right" } });
    expect(beside.ok && r1(beside.state)).toEqual(before);
    // An open naming no tile while r1 holds the edit and every other reader holds a note: it lands beside another, never r1.
    const reader = { kind: "reader", notes: true };
    extra = { 1: { ...reader, editing: "an edit", showing: "a" }, 2: { ...reader, held: true, showing: "b" }, 3: { ...reader, held: true, showing: "c" }, 4: { ...reader, held: true, showing: "d" } };
    for (const placement of [{ from: 1, note: "n", default: true }, { from: 1, note: "n" }]) {
      const r = run(s, { op: "open", tile: 9, placement });
      if (!r.ok) throw new Error(`refused: ${r.refused}`);
      expect(r1(r.state)).toEqual(before);
      expect(leaves(r.state.tree)).toContain(9);
    }
    // The person's own open from the tile they type in still opens beside it, as before.
    const own = run(s, { op: "open", tile: 9, placement: { from: 1, note: "n" } }, PERSON);
    expect(own.ok && place(own.state, area).rects.get(9)).toBeTruthy();
    // Neat's folds (seen on the walk): folding the readers beside it would widen it from 44 to 81; refused, said once.
    const fold = run(s, { op: "collapse", tile: 2, on: true, dir: "v" });
    expect(fold.ok ? "folded" : fold.refused).toMatch(/^the person is typing in r1; an agent doesn't resize it/);
    // With no other tile to go beside, an agent's open is refused in the same words.
    extra = { 1: { ...reader, editing: "an edit", showing: "a" } };
    const alone = init({ tree: leaf(1), names: new Map([[1, "r1"]]) });
    const none = run(alone, { op: "open", tile: 9, placement: { from: 1, note: "n", default: true } });
    expect(none.ok ? "opened" : none.refused).toMatch(/^the person is typing in r1; an agent doesn't /);
    extra = {};
  });

  test("C4: an agent undoes only a lock it set; the person's are theirs, by lock, by policy, by loading a layout", () => {
    let s = ok(fresh(), { op: "lock", on: true }).state;
    no(s, { op: "lock", on: false }, /the screen was locked by the person; an agent doesn't unlock it/, AGENT);
    // In yolo the person's lock doesn't hold an agent: it evens the screen out as it is, or unlocks it.
    no(s, { op: "even" }, /the screen is locked/, AGENT);
    expect(ok(s, { op: "even" }, AGENT, { yolo: true }).state).toBeTruthy();
    expect(ok(s, { op: "lock", on: false }, AGENT, { yolo: true }).state.policy.locked).toBeFalsy();
    no(s, { op: "policy", node: "screen", set: { locked: false }, clear: [] }, /locked by the person/, AGENT);
    no(s, { op: "policy", node: "screen", set: {}, clear: ["locked"] }, /locked by the person/, AGENT);
    s = ok(s, { op: "lock", on: false }).state;
    const own = ok(s, { op: "lock", on: true }, AGENT).state;
    expect(ok(own, { op: "lock", on: false }, AGENT).state.policy.locked).toBeUndefined();
    const c = ok(s, { op: "policy", tile: 3, set: { locked: true }, clear: [] }).state;
    no(c, { op: "policy", tile: 3, set: {}, clear: ["locked"] }, /was locked by the person/, AGENT);
    no(c, { op: "load", name: "desk" }, /was locked by the person; loading desk would undo it/, AGENT);
    expect(ok(c, { op: "load", name: "desk" }).changed).toBe(false);
  });

  test("an agent never moves the person's keys while they type, hides their tab, zooms another tile, folds or closes theirs", () => {
    const s = fresh();
    no(s, { op: "focus", tile: 4 }, /the person is typing; an agent doesn't move their keys/, AGENT, { busy: true });
    expect(ok(s, { op: "focus", tile: 4 }, AGENT, { busy: false }).focus).toBe(4);
    const tabs = ok(s, { op: "move", tile: 3, to: { kind: "tabs", target: 4 } }, PERSON, { focus: 4 }).state;   // thread shown, the person on it
    no(tabs, { op: "tab", tile: 4 }, /thread is the tab the person has; an agent doesn't hide it/, AGENT, { focus: 3 });
    const added = ok(tabs, { op: "open", tile: 9, kind: "reader", at: { kind: "tabs", target: 3 } }, AGENT, { focus: 3 }).state;
    expect(tabsOf(added.tree, 3)!.ids[tabsOf(added.tree, 3)!.active]).toBe(3);   // the agent's new tab isn't shown over theirs
    no(s, { op: "zoom", tile: 4 }, /zooming tile activity would hide tile reader/, AGENT);
    no(s, { op: "float", tile: 2 }, /reader has the person's keys; an agent doesn't float it/, AGENT);
    // A columns container's tiles are its source's: the screen fills them, an agent changes the data instead.
    no(s, { op: "fill", container: "c1", order: [] }, /filled from its source by the screen/, AGENT);
    no(s, { op: "close", tile: 2 }, /reader has the person's keys; an agent doesn't close it/, AGENT);
    no(s, { op: "collapse", tile: 2, on: true }, /reader has the person's keys; an agent doesn't fold it/, AGENT);
    extra = { 4: { running: "vim" } };
    no(s, { op: "close", tile: 4 }, /activity is running vim; an agent doesn't end it/, AGENT);
    extra = {};
    // An agent's open never takes the keys; an agent's move of the person's tile into a shut dock opens it for them.
    expect(ok(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "down" } }, AGENT).focus).toBe(2);
    let d = ok(s, { op: "pin", tile: 1, on: false }, PERSON, { focus: 1 }).state;
    d = ok(d, { op: "slide", tile: 1, open: false }, PERSON, { focus: 2 }).state;
    const moved = ok(d, { op: "move", tile: 2, to: { kind: "tabs", target: 1 } }, AGENT).state;
    expect(dockOf(moved.tree, 2)!.open).toBe(true);
    // An agent's folded tile says who folded it.
    expect(ok(s, { op: "collapse", tile: 1, on: true }, AGENT).state.collapsed.get(1)).toEqual({ by: AGENT.kind === "agent" ? AGENT.id : "" });
  });
});

describe("the rest of the layout's operations", () => {
  test("docks: wrap where it is or at an edge, slide shut and open, drawer back keeping its policy", () => {
    let s = ok(fresh(), { op: "pin", tile: 1, on: false, edge: "left" }, PERSON, { focus: 1 }).state;
    const d = dockOf(s.tree, 1)!;
    expect(d.edge).toBe("left");
    s = ok(s, { op: "policy", node: d.id!, set: { stays: true }, clear: [] }).state;
    const shut = ok(s, { op: "slide", tile: 1, open: false }, PERSON, { focus: 1 });
    expect(shut.focus).not.toBe(1);                                      // the keys leave a dock that shuts
    no(shut.state, { op: "slide", tile: 1, open: false, container: "d999" }, /no dock d999/);
    const back = ok(shut.state, { op: "pin", tile: 1, on: true }).state;
    expect(dockOf(back.tree, 1)).toBeNull();
    const again = ok(back, { op: "pin", tile: 1, on: false }, PERSON, { focus: 1 }).state;
    expect(dockOf(again.tree, 1)!.policy).toEqual({ stays: true });   // remembered while it was undocked
  });

  test("floats: popped out at a fresh rect, kept on the screen when moved, put back; locked, they don't move", () => {
    const f = withFloat(fresh(), 4);
    const r = f.floats[0]!.rect;
    expect(r.col + r.cols).toBeLessThanOrEqual(AREA.cols);
    const far = ok(f, { op: "place", tile: 4, col: 500, row: 500 }).state.floats[0]!.rect;
    expect(far.col + far.cols).toBe(AREA.cols);
    expect(far.row + far.rows).toBe(AREA.rows);
    const locked = ok(f, { op: "lock", on: true }).state;
    no(locked, { op: "place", tile: 4, dx: 4 }, /the screen is locked: moving activity is refused/);
    no(locked, { op: "float", tile: 4 }, /the screen is locked: putting activity back is refused/);
    const back = ok(f, { op: "float", tile: 4 }, PERSON, { focus: 2 }).state;
    expect(floated(back)).toEqual([]);
    expect(leaves(back.tree)).toContain(4);
    no(init({ tree: leaf(2), names: NAMES }), { op: "float", tile: 2 }, /only tile in the layout/);
  });

  test("spines: only side by side; a spine moved into a column opens; the person's open of a spine opens it", () => {
    no(fresh(), { op: "collapse", tile: 3, on: true, dir: "v" }, /thread isn't side by side with other tiles/);
    const s = ok(fresh(), { op: "collapse", tile: 1, on: true }).state;
    expect(place(s, AREA).rects.get(1)!.cols).toBe(3);
    const moved = ok(s, { op: "move", tile: 1, to: { kind: "split", target: 3, dir: "up" } }).state;
    expect(moved.collapsed.has(1)).toBe(false);
  });

  test("horizontal spines (PIE-642): a stacked tile folds to one row, its neighbour takes the height, opening gives it back its size", () => {
    const before = place(fresh(), AREA).rects;
    no(fresh(), { op: "collapse", tile: 1, on: true, dir: "h" }, /tree isn't stacked with other tiles/);
    const r = ok(fresh(), { op: "collapse", tile: 3, on: true });
    expect(r.answer).toMatchObject({ collapsed: true, dir: "h" });
    expect(r.state.collapsed.get(3)).toEqual({ dir: "h" });
    const folded = place(r.state, AREA).rects;
    expect(folded.get(3)!.rows).toBe(1);
    expect(folded.get(4)!.rows).toBe(before.get(3)!.rows + before.get(4)!.rows - 1);
    expect(folded.get(3)!.cols).toBe(before.get(3)!.cols);
    const back = ok(r.state, { op: "collapse", tile: 3, on: false }).state;
    expect(place(back, AREA).rects).toEqual(before);
    // The other way refolds, the same way asked again does nothing; a vertical one for a tile in a row stays 3 wide.
    expect(ok(r.state, { op: "collapse", tile: 3, on: true, dir: "h" }).changed).toBe(false);
    expect(place(ok(fresh(), { op: "collapse", tile: 1, on: true, dir: "v" }).state, AREA).rects.get(1)!.cols).toBe(3);
    // Moved into a row it doesn't fit: opens.
    const moved = ok(r.state, { op: "move", tile: 3, to: { kind: "split", target: 1, dir: "right" } }).state;
    expect(moved.collapsed.has(3)).toBe(false);
    // An agent doesn't fold the tile the person has.
    no(fresh(), { op: "collapse", tile: 2, on: true }, /reader has the person's keys; an agent doesn't fold it/, AGENT);
  });

  test("a tab set folds as one, and opening any of its tabs opens it", () => {
    const tree = splitOf("col", [leaf(1), { t: "tabs", ids: [2, 3], active: 0 }]);
    const s = ok(init({ tree, names: NAMES }), { op: "collapse", tile: 2, on: true }).state;
    expect([...s.collapsed.keys()].sort()).toEqual([2, 3]);
    expect(place(s, AREA).rects.get(2)!.rows).toBe(1);
    expect(ok(s, { op: "reveal", tile: 3 }).state.collapsed.size).toBe(0);
  });

  test("folds are reconciled after every operation: a swapped tab set folds as one, a split that dissolves frees its fold, a refused drop keeps the spine", () => {
    // [2,3] folded, [1] and [4] open in the same column: swapping 2 and 4 leaves each set whole (open or folded as one).
    const tree = splitOf("col", [{ t: "tabs", ids: [1, 2], active: 0 }, { t: "tabs", ids: [3, 4], active: 0 }]);
    let s = ok(init({ tree, names: NAMES }), { op: "collapse", tile: 1, on: true }).state;
    s = ok(s, { op: "swap", tile: 1, with: 3 }).state;
    const sets = [...s.collapsed.keys()].sort();
    expect(sets.length === 0 || sets.length === 2).toBe(true);
    // A horizontally folded tile whose column dissolves (its sibling leaves) is open in the row it's left in.
    const t2 = splitOf("row", [splitOf("col", [leaf(1), leaf(2)]), leaf(3)]);
    let d = ok(init({ tree: t2, names: NAMES }), { op: "collapse", tile: 1, on: true }).state;
    expect(d.collapsed.get(1)).toEqual({ dir: "h" });
    d = ok(d, { op: "move", tile: 2, to: { kind: "split", target: 3, dir: "right" } }).state;
    expect(d.collapsed.has(1)).toBe(false);
    // A drop that is refused (a locked screen) leaves the target folded, and who folded it.
    const f = ok(fresh(), { op: "collapse", tile: 1, on: true }, AGENT, { focus: 2 }).state;
    const locked = ok(f, { op: "lock", on: true }).state;
    no(locked, { op: "move", tile: 2, to: { kind: "tabs", target: 1 } }, /locked/);
    expect(locked.collapsed.get(1)).toEqual(f.collapsed.get(1));
    // Allowed, the spine opens in the same step.
    expect(ok(f, { op: "move", tile: 2, to: { kind: "tabs", target: 1 } }).state.collapsed.has(1)).toBe(false);
  });

  test("links and opens-into: where a tile's opens land, checked against what takes notes", () => {
    no(fresh(), { op: "link", tile: 1, to: 3 }, /thread is a thread tile: opens land in a tile that takes notes \(reader\)/);
    no(fresh(), { op: "link", tile: 2, to: 2 }, /reader can't open into itself/);
    const s = ok(fresh(), { op: "link", tile: 1, to: 2 }).state;
    expect(placement(s, { from: 1, fresh: false, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 2 });
    const into = ok(fresh(), { op: "policy", tile: 3, set: { opensInto: "reader" }, clear: [] }).state;
    expect(placement(into, { from: 4, fresh: false, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 2 });
    no(fresh(), { op: "policy", tile: 3, set: { opensInto: "thread" }, clear: [] }, /thread is a thread tile: opens land in a tile that takes notes/);
    // Closing the tile a link names takes the link away.
    expect(ok(s, { op: "close", tile: 2 }, PERSON, { focus: 1 }).state.wires.length).toBe(0);
  });

  test("an open with link= (tile.preview) is opened and linked in one step, by link's rules; reveal shows a tile without the keys", () => {
    // A reader opened below the tree, its opens linked to it: one step, the keys left where they were.
    const r = ok(fresh(), { op: "open", tile: 7, kind: "reader", name: "tree-preview", at: { kind: "split", target: 1, dir: "down" }, keys: false, link: 1 });
    expect(r.state.wires.find(w => w.from === 1 && w.verb === "open")?.to).toBe(7);
    expect(r.answer).toMatchObject({ tile: "tree-preview", link: "tree" });
    expect(r.focus).toBe(2);
    expect(placement(r.state, { from: 1, fresh: false, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ to: 7 });
    // A kind that takes no notes isn't linked, and isn't opened either; on a locked screen neither happens.
    no(fresh(), { op: "open", tile: 7, kind: "thread", at: { kind: "split", target: 1, dir: "down" }, link: 1 }, /a thread tile: opens land in a tile that takes notes/);
    no(ok(fresh(), { op: "lock", on: true }).state, { op: "open", tile: 7, kind: "reader", at: { kind: "split", target: 1, dir: "down" }, link: 1 }, /the screen is locked/);
    // reveal: a folded tile opens, a tile in a shut dock slides it open, a hidden tab is shown; the keys stay.
    let s = ok(fresh(), { op: "collapse", tile: 1, on: true }).state;
    s = ok(s, { op: "reveal", tile: 1 }).state;
    expect(s.collapsed.has(1)).toBe(false);
    const dock = ok(ok(fresh(), { op: "pin", tile: 1, on: false }).state, { op: "slide", tile: 1, open: false }, PERSON, { focus: 2 }).state;
    expect(dockOf(dock.tree, 1)!.open).toBe(false);
    const shown = ok(dock, { op: "reveal", tile: 1 }, AGENT);
    expect(dockOf(shown.state.tree, 1)!.open).toBe(true);
    expect(shown.focus).toBe(2);
    const tabs = ok(fresh(), { op: "move", tile: 4, to: { kind: "tabs", target: 3 } }).state;
    const t = ok(tabs, { op: "reveal", tile: 3 }, PERSON, { focus: 4 });
    expect(visible(t.state.tree)).toContain(3);
    // An agent never hides the tab the person has: the tile stays behind it.
    const a = ok(tabs, { op: "reveal", tile: 3 }, AGENT, { focus: 4 });
    expect(visible(a.state.tree)).not.toContain(3);
  });

  test("borders: resize names its split, a dock's border sizes only it, a fixed kid keeps its size", () => {
    no(fresh(), { op: "resize", split: "s999", border: 0, share: 0.5 }, /no split s999/);
    no(fresh(), { op: "resize", path: "", border: 3, share: 0.5 }, /has borders 0-1/);
    let s = fresh();
    const root = describeLayout(s, id => s.names.get(id)!) as any;
    s = ok(s, { op: "policy", node: root.kids[2].id, set: { fixed: 40 }, clear: [] }).state;
    no(s, { op: "resize", path: "", border: 1, share: 0.5 }, /is fixed at 40 cells/);
    expect(place(s, AREA).rects.get(3)!.cols).toBe(40);
    expect(ok(fresh(), { op: "grow", tile: 2, axis: "row", by: 2 }).state).toBeTruthy();
    no(fresh(), { op: "grow", tile: 1, axis: "col", by: 2 }, /tile tree has no border above or below it to move/);
  });

  test("columns from data: filled in the source's order, a tile moved out stays out, dropped ones go", () => {
    const names = new Map([[1, "tree"], [2, "preview"], [10, "q-now"], [11, "q-next"]]);
    const tree: LNode = splitOf("col", [{ t: "columns", dir: "row", kids: [], weights: [], key: "lanes", source: "hub:fern" }, splitOf("row", [leaf(1), leaf(2)])]);
    let s = init({ tree, names: new Map([[1, "tree"], [2, "preview"]]) });
    const cid = (describeLayout(s, id => String(id)) as any).kids[0].id as string;
    s = ok(s, { op: "fill", container: cid, order: [10, 11], fresh: [{ id: 10, kind: "query", name: "q-now" }, { id: 11, kind: "query", name: "q-next" }] }).state;
    expect([...s.names.values()]).toEqual(expect.arrayContaining(["q-now", "q-next"]));
    expect(leaves(s.tree).slice(0, 2)).toEqual([10, 11]);
    s = ok(s, { op: "fill", container: cid, order: [11, 10], weights: [[10, 3]] }).state;
    expect(leaves(s.tree).slice(0, 2)).toEqual([11, 10]);
    s = ok(s, { op: "fill", container: cid, order: [11], drop: [10] }).state;
    expect(s.names.has(10)).toBe(false);
    expect(leaves(s.tree)).not.toContain(10);
    void names;
  });

  test("another hub's lane takes the name of the one it replaces; a kept lane named by its kind gets its source's name back (round 3, W1)", () => {
    const tree: LNode = splitOf("col", [{ t: "columns", dir: "row", kids: [], weights: [], key: "lanes", source: "hub:fern" }, splitOf("row", [leaf(1), leaf(2)])]);
    let s = init({ tree, names: new Map([[1, "tree"], [2, "preview"]]) });
    const cid = (describeLayout(s, id => String(id)) as any).kids[0].id as string;
    s = ok(s, { op: "fill", container: cid, order: [10, 11], fresh: [{ id: 10, kind: "query", name: "Sowing" }, { id: 11, kind: "query", name: "Done" }] }).state;
    // The hub switched (g): both its lanes go, and the new hub's "Done" is named Done, not by its kind.
    s = ok(s, { op: "fill", container: cid, order: [12, 13], fresh: [{ id: 12, kind: "query", name: "To-do" }, { id: 13, kind: "query", name: "Done" }], drop: [10, 11] }).state;
    expect(names(s, [12, 13])).toEqual(["To-do", "Done"]);
    // A save that already holds a lane named by its kind ("query"): the refill gives it the source's name back.
    s = init({ tree: s.tree, names: new Map([[1, "tree"], [2, "preview"], [12, "To-do"], [13, "query"]]) });
    s = ok(s, { op: "fill", container: cid, order: [12, 13], names: [[12, "To-do"], [13, "Done"]] }).state;
    expect(names(s, [12, 13])).toEqual(["To-do", "Done"]);
    // A name another tile has stays that tile's.
    s = ok(s, { op: "fill", container: cid, order: [12, 13], names: [[12, "Done"]] }).state;
    expect(names(s, [12, 13])).toEqual(["To-do", "Done"]);
    // Two views that swapped titles: both lanes get theirs back.
    s = ok(s, { op: "fill", container: cid, order: [12, 13], names: [[12, "Done"], [13, "To-do"]] }).state;
    expect(names(s, [12, 13])).toEqual(["Done", "To-do"]);
  });

  test("a spine swapped into a column split opens, as a move there does (round 3, B-L2)", () => {
    const tree = splitOf("row", [leaf(1), leaf(2), splitOf("col", [leaf(3), leaf(4)])]);
    let s = init({ tree, names: NAMES });
    s = ok(s, { op: "collapse", tile: 2, on: true }).state;
    expect(s.collapsed.has(2)).toBe(true);
    s = ok(s, { op: "swap", tile: 2, with: 3 }).state;
    expect(s.collapsed.has(2)).toBe(false);
  });

  test("a place by a tile that isn't in the layout is refused: nothing opened unplaced, no float lost (round 3, B-L3)", () => {
    extra = {};
    no(fresh(), { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 99, dir: "right" } }, /no tile 99 in the layout/);
    no(fresh(), { op: "open", tile: 9, kind: "reader", at: { kind: "tabs", target: 99 } }, /no tile 99 in the layout/);
    const s = withFloat(fresh(), 1);
    no(s, { op: "move", tile: 1, to: { kind: "split", target: 99, dir: "left" } }, /no tile 99 in the layout/);
    no(s, { op: "move", tile: 1, to: { kind: "tabs", target: 99 } }, /no tile 99 in the layout/);
    expect(floated(s)).toEqual(["tree"]);
  });

  test("saved and put back: the tree, the policy, the floats; a stray field in a hand-edited policy is dropped", () => {
    let s = ok(fresh(), { op: "policy", tile: 3, set: { draggable: false }, clear: [] }).state;
    s = withFloat(s, 1);
    const saved = serialize(s, id => ({ t: "leaf" as const, n: NAMES.get(id)! }));
    const back = reviveTree({ ...(saved.root as object), policy: { draggable: false, bogus: 1 } } as any, (l: { n: string }) => [...NAMES].find(([, v]) => v === l.n)![0]);
    expect(leaves(back)).toEqual(leaves(s.tree));
    expect(saved.floats?.map(f => (f.tile as { n: string }).n)).toEqual(["tree"]);
    expect((back as any).policy).toEqual({ draggable: false });
  });

  test("refusal asks without changing anything (a drag's ghost asks before the release)", () => {
    const s = ok(fresh(), { op: "lock", on: true }).state;
    expect(refusal(s, { op: "move", tile: 3, to: { kind: "edge", dir: "left" } }, ctxOf(PERSON))).toMatch(/the screen is locked: moving thread is refused/);
    expect(refusal(fresh(), { op: "move", tile: 3, to: { kind: "edge", dir: "left" } }, ctxOf(PERSON))).toBeNull();
  });
});

describe("two layers: the host layer above every screen (Evan, Oct 1)", () => {
  const HOST_AREA: Rect = { col: 0, row: 0, cols: 120, rows: 40 };
  /** The host layer's tiles: the screen slot (it never closes or moves), the agent terminal, an admin outline. */
  const hostFacts = (id: string): TileFacts => (id === HOST_SCREEN ? { kind: "screen", policy: { closable: false, draggable: false } } : id === "agent" ? { kind: "pty" } : { kind: "tree" });
  const hctx = (actor: Actor, person: Partial<Person<string>> = {}, screenHost?: "beside" | "over" | "none"): Ctx<string> => ({
    actor, standing: actor.kind === "user" || !!person.yolo, protectTyping: actor.kind === "agent" && !person.yolo, area: HOST_AREA, tile: hostFacts, person: { focus: HOST_SCREEN, typingIn: null, busy: false, ...person }, ...(screenHost ? { screenHost } : {}),
  });
  const hok = (s: LayoutState<string>, op: Op<string>, actor: Actor = PERSON, person: Partial<Person<string>> = {}, mode?: "beside" | "over" | "none") => {
    const r = apply(s, op, hctx(actor, person, mode));
    if (!r.ok) throw new Error(`refused: ${r.refused}`);
    return r;
  };
  const host = () => hostLayer({ tabs: ["agent"], names: new Map([["agent", "claude"]]), share: 0.5 });

  test("put away, the screen has the whole room; pulled up over it, the screen keeps it all and the dock covers its lower half", () => {
    const s = host();
    expect(placeHost(s, HOST_AREA, "over")).toEqual({ screen: HOST_AREA, dock: null, tiles: new Map() });
    const up = hok(s, { op: "slide", tile: "agent", open: true });
    const over = placeHost(up.state, HOST_AREA, "over");
    expect(over.screen).toEqual(HOST_AREA);
    expect(over.dock).toEqual({ col: 0, row: 20, cols: 120, rows: 20 });
    expect(over.tiles.get("agent")).toEqual(over.dock!);
  });

  test("beside it, the screen is drawn shorter; on a screen that keeps the whole screen (none), it isn't drawn, nor pulled up", () => {
    const up = hok(host(), { op: "slide", tile: "agent", open: true }).state;
    const beside = placeHost(up, HOST_AREA, "beside");
    expect(beside.screen.rows + beside.dock!.rows).toBe(40);
    expect(beside.screen.rows).toBeLessThan(40);
    expect(placeHost(up, HOST_AREA, "none")).toEqual({ screen: HOST_AREA, dock: null, tiles: new Map() });
    const r = apply(host(), { op: "slide", tile: "agent", open: true }, hctx(PERSON, {}, "none"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toMatch(/keeps the whole screen \(its host policy is none\)/);
  });

  test("the person's keys go through the layer's own transitions: pulled up, to its tab; put away, back to the screen as they left it", () => {
    const up = hok(host(), { op: "slide", tile: "agent", open: true });
    expect(up.focus).toBe("agent");
    const away = hok(up.state, { op: "slide", tile: "agent", open: false }, PERSON, { focus: "agent" });
    expect(away.focus).toBe(HOST_SCREEN);
    // An agent pulls it up without the keys; it can't put it away while the person types in it.
    const agentUp = hok(host(), { op: "slide", tile: "agent", open: true }, AGENT);
    expect(agentUp.focus).toBe(HOST_SCREEN);
    const r = apply(up.state, { op: "slide", tile: "agent", open: false }, hctx(AGENT, { focus: "agent", typingIn: "agent", busy: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toMatch(/the person is typing; an agent doesn't shut the dock they have/);
  });

  test("the dock is a real dock of tabs: the admin outline opens as a tab beside the agent, and the layer saves and comes back", () => {
    let s = hok(host(), { op: "slide", tile: "agent", open: true }).state;
    s = hok(s, { op: "open", tile: "outline", kind: "tree", name: "outline", at: { kind: "tabs", target: "agent" } }, PERSON, { focus: "agent" }).state;
    expect(tabsOf(s.tree, "agent")!.ids).toEqual(["agent", "outline"]);
    expect(hostDock(s)!.kid.t).toBe("tabs");
    s = hok(s, { op: "tab", tile: "agent" }, PERSON, { focus: "outline" }).state;
    const saved = serialize(s, id => ({ t: "leaf" as const, id }));
    const back = init({ tree: reviveTree(saved.root as any, (l: { id: string }) => l.id), names: s.names });
    expect(tabsOf(back.tree, "outline")!.ids).toEqual(["agent", "outline"]);
    expect(hostDock(back)!.open).toBe(true);
    // The screen slot stays where it is: it's the screen's, not a tile to close or move.
    const no2 = apply(s, { op: "close", tile: HOST_SCREEN }, hctx(PERSON));
    expect(no2.ok).toBe(false);
    if (!no2.ok) expect(no2.refused).toMatch(/screen stays: .* keeps its tiles|turns closable on/);
  });
});

describe("a float and a dock, one step each way (Evan, Oct 3)", () => {
  test("a float goes straight into a dock (tile.dock), and floats out of it again: float → dock → float", () => {
    extra = {};
    // The person's float, then ^W p on it: into a dock of its own, in one step, back in the tree.
    const f = withFloat(fresh(), 2);
    expect(floated(f)).toEqual(["reader"]);
    const inDock = ok(f, { op: "pin", tile: 2, on: false }, PERSON, { focus: 2 }).state;
    expect(floated(inDock)).toEqual([]);
    expect(dockOf(inDock.tree, 2)).not.toBeNull();
    // And ^W f on it in its dock: a float again, the dock gone with it.
    const again = ok(inDock, { op: "float", tile: 2 }, PERSON, { focus: 2 }).state;
    expect(floated(again)).toEqual(["reader"]);
    expect(dockOf(again.tree, 2)).toBeNull();
    // pin on=true on a float puts it back pinned in the layout; an agent never moves the float the person has.
    expect(floated(ok(f, { op: "pin", tile: 2, on: true }).state)).toEqual([]);
    no(f, { op: "pin", tile: 2, on: false }, /has the person's keys; an agent doesn't move it/, AGENT, { focus: 2 });
    // A locked screen keeps it a float, and says why (nothing done).
    const locked = ok(f, { op: "lock", on: true }).state;
    no(locked, { op: "pin", tile: 2, on: false }, /locked/, PERSON, { focus: 2 });
  });

  test("take: a tile leaves the layout whole (to the drawer), by the move rules, never the last one", () => {
    extra = {};
    const s = fresh();
    const r = ok(s, { op: "take", tile: 3 }, PERSON, { focus: 3 });
    expect(treeNames(r.state)).not.toContain("thread");
    expect(r.state.names.has(3)).toBe(false);
    expect(r.answer).toMatchObject({ tile: "thread", taken: true });
    // The keys go to a tile still there.
    expect(leaves(r.state.tree)).toContain(r.focus);
    // A float leaves too.
    expect(floated(ok(withFloat(s, 2), { op: "take", tile: 2 }).state)).toEqual([]);
    // Never the tile the person types in (an agent), the one with their keys (an agent), the last, or a locked shape.
    no(s, { op: "take", tile: 3 }, /the person is typing in /, AGENT, { focus: 2, typingIn: 3 });
    no(s, { op: "take", tile: 2 }, /has the person's keys/, AGENT, { focus: 2 });
    no(init({ tree: leaf(2), names: NAMES }), { op: "take", tile: 2 }, /last tile/);
    no(ok(s, { op: "lock", on: true }).state, { op: "take", tile: 3 }, /locked/);
  });
});

describe("replace: a new tile in another's place (PIE-565, the blank tile's rows)", () => {
  test("it takes the place whole (its weight, its tab), the keys with it; the old one's name and links go", () => {
    extra = {};
    const s = fresh();
    const linked = ok(s, { op: "link", tile: 1, to: 2 }).state;
    const r = ok(linked, { op: "replace", tile: 2, with: 9, kind: "pty" });
    expect(treeNames(r.state)).toEqual(["tree", "pty", "thread", "activity"]);
    expect(r.focus).toBe(9);
    expect(r.state.wires.some(w => w.from === 1)).toBe(false);
    expect(r.answer).toEqual({ tile: "pty", replaced: "reader" });
  });

  test("never one holding work, a locked shape, or (for an agent) the tile with the person's keys, unless it only holds a place", () => {
    extra = { 2: { editing: "an edit" } };
    no(fresh(), { op: "replace", tile: 2, with: 9, kind: "tree" }, /reader holds an edit/);
    extra = { 3: { running: "nvim" } };
    no(fresh(), { op: "replace", tile: 3, with: 9, kind: "tree" }, /thread is running nvim: \^W x ends it first/);
    extra = {};
    const locked = ok(fresh(), { op: "lock", on: true }).state;
    no(locked, { op: "replace", tile: 3, with: 9, kind: "tree" }, /locked/);
    no(fresh(), { op: "replace", tile: 2, with: 9, kind: "tree" }, /reader has the person's keys; an agent doesn't replace it/, AGENT);
    extra = { 2: { placeholder: true } };
    const r = ok(fresh(), { op: "replace", tile: 2, with: 9, kind: "tree" }, AGENT);
    expect(r.focus).toBe(9);
    no(fresh(), { op: "replace", tile: 2, with: 9, kind: "tree" }, /the person is typing in /, AGENT, { typingIn: 2 });
    extra = {};
  });
});

test("room never folds ordinary readers to make another reader fit", () => {
  extra = { 2: { held: true }, 5: { held: true }, 6: { held: true } };
  try {
    let s = fresh(splitOf("row", [leaf(2), leaf(5)], [80, 80]), new Map([[2, "first"], [5, "earlier"]]));
    s = ok(s, { op: "open", tile: 6, kind: "reader", name: "newest", at: { kind: "split", target: 5, dir: "right" } }).state;
    const before = place(s, AREA).rects;
    s = ok(s, { op: "room", tile: 6 }).state;
    expect([...s.collapsed]).toEqual([]);
    expect(place(s, AREA).rects).toEqual(before);
  } finally { extra = {}; }
});

test("alt opens use the nearest container policy before the screen default (wave 9)", () => {
  extra = {};
  const group = splitOf("row", [leaf(1), leaf(2)]);
  group.policy = { altOpens: "tab" };
  const s = init({ tree: group, names: NAMES, policy: { altOpens: "beside" }, wires: [{ from: 1, verb: "open", to: 2 }] });
  expect(placement(s, { from: 1, fresh: true, note: "arrival" }, ctxOf(PERSON)).route).toEqual({ tab: 2 });
});

for (const cols of [160, 250]) for (const target of [1, 2]) test(`placement keeps the working pair at ${cols} columns, destination ${target}`, () => {
  const area = { ...AREA, cols };
  let s = fresh(splitOf("row", [leaf(1), leaf(2)], [1, 1]), new Map([[1, "left"], [2, "right"]]));
  const other = target === 1 ? 2 : 1;
  extra = { 1: { notes: true }, 2: { notes: true } };
  const fixed = place(s, area).rects.get(other)!;
  try {
    for (let i = 0; i < 10; i++) {
      extra[target] = { notes: true, held: true, showing: `old-${i}` };
      const r = apply(s, { op: "open", tile: 10 + i, placement: { from: target, to: target, note: `new-${i}` } }, ctxOf(PERSON, { focus: target }, area));
      if (!r.ok) throw new Error(r.refused);
      s = r.state;
      const kept = Array.from({ length: i + 1 }, (_, n) => 10 + n);
      expect(leaves(s.tree)).toEqual(target === 1 ? [...kept, 1, 2] : [1, 2, ...kept.reverse()]);
      expect([...s.collapsed.keys()]).toEqual(Array.from({ length: i + 1 }, (_, n) => 10 + n));
      expect(place(s, area).rects.get(other)).toEqual(fixed);
      expect(s.names.get(target)).toBe(target === 1 ? "left" : "right");
      expect(r.focus).toBe(target);
    }
  } finally { extra = {}; }
});

describe("renaming a tile (PIE-1283)", () => {
  test("the name changes where a name is looked up, a taken name is refused, and the open rules that name it follow", () => {
    const into = ok(fresh(), { op: "policy", tile: 3, set: { opensInto: "reader" }, clear: [] }).state;
    const r = ok(into, { op: "rename", tile: 2, name: "yo" });
    expect(r.state.names.get(2)).toBe("yo");
    expect(policyAt(r.state, 3).opensInto).toBe("yo");
    no(fresh(), { op: "rename", tile: 2, name: "tree" }, /already a tile named tree here/);
    // Unchanged is no change.
    expect(ok(fresh(), { op: "rename", tile: 2, name: "reader" }).changed).toBe(false);
  });

  test("a locked layer's open rule isn't rewritten, and an agent doesn't rename a tile it may only edit", () => {
    const locked = ok(ok(fresh(), { op: "policy", tile: 3, set: { opensInto: "reader" }, clear: [] }).state, { op: "lock", on: true }).state;
    no(locked, { op: "rename", tile: 2, name: "yo" }, /locked/);
    const edit = ok(fresh(), { op: "agents", tile: 2, level: "edit" }).state;
    no(edit, { op: "rename", tile: 2, name: "yo" }, /renaming it/, AGENT);
    ok(fresh(), { op: "rename", tile: 2, name: "yo" }, AGENT);
  });
});

// PIE-1306: an open naming no tile, on a screen with no reader of its own whose readers are all inside mounts (a group,
// a board or the welcome screen in a tile), lands inside one: the mount says where its own such open starts
// (`Ctx.inside`), and placement hops in there, as it hops out of a mount with no reader (`outward`).
describe("an open naming no tile reaches the readers inside mounts (PIE-1306)", () => {
  const MOUNTS = new Map([[1, "tree"], [4, "activity"], [5, "welcome"], [6, "group"]]);
  const mounted = () => init({ tree: splitOf("row", [leaf(1), leaf(4), leaf(5), leaf(6)], [0.25, 0.25, 0.25, 0.25]), names: MOUNTS });
  const SCREEN: Partial<TileFacts> = { kind: "screen", notes: false };
  /** The default open from tile `focus`, with these mounts answering where their own opens start. */
  const open = (s: LayoutState, inside: Record<number, string>, focus = 4, actor: Actor = AGENT) =>
    placement(s, { from: focus, note: "arrival", default: true }, { ...ctxOf(actor, { focus }), inside: id => inside[id] });
  const hop = (target: string) => ({ kind: "across" as const, target, rule: "tile" as const, source: true as const });
  const none = { kind: "none" as const, reason: "no reader takes this open" };

  test("the first mount with a reader in it takes it, the one with the person's keys first; the keys stay", () => {
    extra = { 5: SCREEN, 6: SCREEN };
    try {
      const both = { 5: "welcome/welcome", 6: "group/notes" };
      for (const actor of [AGENT, PERSON]) {
        const p = open(mounted(), both, 4, actor);
        expect(p.destination).toEqual(hop("welcome/welcome"));
        expect(p.keys).toBeUndefined();
      }
      expect(open(mounted(), both, 6).destination).toEqual(hop("group/notes"));
    } finally { extra = {}; }
  });

  test("a folded mount, one kept from the actor or one with no reader inside doesn't take it; a reader of the screen's own, even a busy one, keeps it on the screen", () => {
    extra = { 5: SCREEN, 6: SCREEN };
    try {
      const s = mounted(), one = { 6: "group/notes" };
      expect(open(s, one).destination).toEqual(hop("group/notes"));
      expect(open(ok(s, { op: "collapse", tile: 6, on: true }, PERSON, { focus: 4 }).state, one).destination).toEqual(none);
      extra[6] = { ...SCREEN, available: false };
      expect(open(s, one).destination).toEqual(none);
      extra[6] = { kind: "reader", notes: true };
      expect(open(s, { 5: "welcome/welcome" }).destination).toMatchObject({ kind: "swap", tile: 6 });
      extra[6] = { kind: "reader", notes: true, editing: "draft" };
      expect(open(s, { 5: "welcome/welcome" }).destination.kind).not.toBe("across");
    } finally { extra = {}; }
  });
});
