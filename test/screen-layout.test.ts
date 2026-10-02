// PIE-513: the screen-layout module, through its interface. Every layout change is one operation applied for one
// actor as one transaction: the new state, or a refusal with its reason and nothing changed. The rules the round-2
// review found broken one caller at a time (B7–B11, C3, C4) are the module's own, checked here with no App, no
// Scratch, no desk: plain states, plain operations. Fictional tiles.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import {
  apply, describe as describeLayout, drawerOf, hostDrawer, hostLayer, HOST_SCREEN, init, landing, leaf, leaves, place, placeHost, policyAt, refusal, reviveTree, serialize, splitOf, tabsOf, visible,
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
  actor, area, tile: facts, person: { focus: 2, typingIn: null, busy: false, ...person },
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

describe("one operation, one transaction", () => {
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

  test("B8: nothing opens beside a float or into its tabs, nor folds or goes in a drawer; along an outer edge is fine", () => {
    const s = withFloat(fresh(), 2);
    no(s, { op: "open", tile: 9, kind: "pty", name: "ghost", at: { kind: "split", target: 2, dir: "right" } }, /reader is a float: putting ghost beside it needs a tile in the layout/);
    no(s, { op: "open", tile: 9, kind: "pty", name: "ghost", at: { kind: "tabs", target: 2 } }, /into its tabs/);
    no(s, { op: "move", tile: 3, to: { kind: "split", target: 2, dir: "left" } }, /reader is a float/);
    no(s, { op: "collapse", tile: 2, on: true }, /reader is a float: a spine/);
    no(s, { op: "pin", tile: 2, on: false }, /reader is a float: a drawer/);
    const r = ok(s, { op: "open", tile: 9, kind: "reader", name: "edgy", at: { kind: "edge", dir: "right" } }).state;
    expect(treeNames(r)).toContain("edgy");
    expect(r.names.get(9)).toBe("edgy");
  });

  test("B9: a float docks only where the containers take it: another place if the first refuses, else refused with why", () => {
    // The keys on activity, in a split that takes only query tiles: the reader float can't dock beside it.
    let s = withFloat(fresh(), 2);
    const col = leaves(s.tree).includes(3) ? (describeLayout(s, id => String(id)) as any) : null;
    expect(col).not.toBeNull();
    s = ok(s, { op: "policy", tile: 4, set: { accepts: ["query"] }, clear: [] }).state;
    const docked = ok(s, { op: "float", tile: 2 }, PERSON, { focus: 4 }).state;
    expect(floated(docked)).toEqual([]);
    expect(policyAt(docked, 2, facts(2)).accepts).toBeNull();          // beside a tile whose containers take it
    // The whole screen takes only query tiles: nowhere, and it stays a float.
    const screen = ok(s, { op: "policy", node: "screen", set: { accepts: ["query"] }, clear: [] }).state;
    no(screen, { op: "float", tile: 2 }, /takes only query: not reader \(reader\)/, PERSON, { focus: 4 });
    // A shut drawer is never where a float docks: it wouldn't be shown.
    let d = ok(fresh(), { op: "pin", tile: 1, on: false, edge: "left" }).state;
    d = ok(d, { op: "drawer", tile: 1, open: false }, PERSON, { focus: 1 }).state;
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

  test("B11: the last docked tile isn't put in a drawer; the last drawer showing anything doesn't shut", () => {
    let s = fresh();
    for (const id of [1, 2, 3]) s = ok(s, { op: "pin", tile: id, on: false }, PERSON, { focus: id }).state;
    no(s, { op: "pin", tile: 4, on: false }, /activity is the last tile docked/, PERSON, { focus: 4 });
    no(s, { op: "pin", tile: 4, on: false, edge: "right" }, /last tile docked/, PERSON, { focus: 4 });
    for (const id of [1, 2, 3]) s = ok(s, { op: "drawer", tile: id, open: false }, PERSON, { focus: 4 }).state;
    expect(names(s, visible(s.tree))).toEqual(["activity"]);
    // The one docked tile closes: the screen opens a drawer, and the keys go to what it shows.
    s = ok(s, { op: "drawer", tile: 1, open: false }, PERSON, { focus: 1 }).state;
    const r = ok(s, { op: "close", tile: 4 }, PERSON, { focus: 1 });
    expect(visible(r.state.tree).length).toBeGreaterThan(0);
    expect(visible(r.state.tree)).toContain(r.focus);
    no(r.state, { op: "drawer", tile: r.focus, open: false }, /all the screen shows/, PERSON, { focus: r.focus });
  });

  test("a whole layout put back from a save where every tile is in a shut drawer opens one", () => {
    const tree: LNode = splitOf("row", [{ t: "drawer", kid: leaf(1), edge: "left", open: false }, { t: "drawer", kid: leaf(2), edge: "right", open: false }]);
    const s = init({ tree, names: NAMES });
    expect(visible(s.tree).length).toBe(1);
  });

  test("the nearest policy wins, and a lock above locks everything below", () => {
    // The screen says tiles stay where they are; the column of thread and activity says they move, and is locked.
    let s = ok(fresh(), { op: "policy", node: "screen", set: { draggable: false }, clear: [] }).state;
    no(s, { op: "move", tile: 2, to: { kind: "edge", dir: "left" } }, /reader stays where it is: the screen keeps its tiles \(draggable off\)/);
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

  test("a policy that keeps tiles: closable off folds instead; accepts and droppable refuse with who said so", () => {
    extra = {};
    let s = ok(fresh(), { op: "policy", tile: 3, set: { closable: false, droppable: false }, clear: [] }).state;
    no(s, { op: "close", tile: 4 }, /activity stays: s\d+ keeps its tiles \(closable off\) · tile.collapse folds it to a spine/);
    no(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "down" } }, /takes no drops \(droppable off\)/);
    extra = { 2: { keeps: "hub:fern supplies it, and it goes when its data does" } };
    no(fresh(), { op: "close", tile: 2 }, /reader stays: hub:fern supplies it/);
    extra = { 2: { editing: "an edit" } };
    no(fresh(), { op: "close", tile: 2 }, /not closed: it holds an edit/);
    extra = {};
    no(init({ tree: leaf(2), names: NAMES }), { op: "close", tile: 2 }, /the screen's last tile stays/);
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
    no(s, { op: "pin", tile: 2, on: false }, /reader is where the person is typing; an agent doesn't move it/, AGENT, typing);
    no(s, { op: "pin", tile: 2, on: false, edge: "left" }, /where the person is typing/, AGENT, typing);
    no(s, { op: "move", tile: 2, to: { kind: "edge", dir: "left" } }, /where the person is typing/, AGENT, typing);
    no(s, { op: "float", tile: 2 }, /an agent doesn't float it/, AGENT, typing);
    no(s, { op: "swap", tile: 3, with: 2 }, /where the person is typing/, AGENT, typing);
    const f = withFloat(s, 2);
    no(f, { op: "place", tile: 2, dx: 4 }, /where the person is typing/, AGENT, typing);
    expect(ok(s, { op: "pin", tile: 2, on: false }, PERSON, typing).state).toBeTruthy();
    // Another tile, the agent may move: the person's keys stay where they are.
    const r = ok(s, { op: "move", tile: 4, to: { kind: "edge", dir: "left" } }, AGENT, typing);
    expect(r.focus).toBe(2);
  });

  test("C4: an agent undoes only a lock it set; the person's are theirs, by lock, by policy, by loading a layout", () => {
    let s = ok(fresh(), { op: "lock", on: true }).state;
    no(s, { op: "lock", on: false }, /the screen was locked by the person; an agent doesn't unlock it/, AGENT);
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
    // An agent's open never takes the keys; an agent's move of the person's tile into a shut drawer opens it for them.
    expect(ok(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "down" } }, AGENT).focus).toBe(2);
    let d = ok(s, { op: "pin", tile: 1, on: false }, PERSON, { focus: 1 }).state;
    d = ok(d, { op: "drawer", tile: 1, open: false }, PERSON, { focus: 2 }).state;
    const moved = ok(d, { op: "move", tile: 2, to: { kind: "tabs", target: 1 } }, AGENT).state;
    expect(drawerOf(moved.tree, 2)!.open).toBe(true);
    // An agent's folded tile says who folded it.
    expect(ok(s, { op: "collapse", tile: 1, on: true }, AGENT).state.collapsed.get(1)).toEqual({ by: AGENT.kind === "agent" ? AGENT.id : "" });
  });
});

describe("the rest of the layout's operations", () => {
  test("drawers: wrap where it is or at an edge, slide shut and open, dock back keeping its policy", () => {
    let s = ok(fresh(), { op: "pin", tile: 1, on: false, edge: "left" }, PERSON, { focus: 1 }).state;
    const d = drawerOf(s.tree, 1)!;
    expect(d.edge).toBe("left");
    s = ok(s, { op: "policy", node: d.id!, set: { stays: true }, clear: [] }).state;
    const shut = ok(s, { op: "drawer", tile: 1, open: false }, PERSON, { focus: 1 });
    expect(shut.focus).not.toBe(1);                                      // the keys leave a drawer that shuts
    no(shut.state, { op: "drawer", tile: 1, open: false, container: "d999" }, /no drawer d999/);
    const docked = ok(shut.state, { op: "pin", tile: 1, on: true }).state;
    expect(drawerOf(docked.tree, 1)).toBeNull();
    const again = ok(docked, { op: "pin", tile: 1, on: false }, PERSON, { focus: 1 }).state;
    expect(drawerOf(again.tree, 1)!.policy).toEqual({ stays: true });   // remembered while it was docked
  });

  test("floats: popped out at a fresh rect, kept on the screen when moved, docked back; locked, they don't move", () => {
    const f = withFloat(fresh(), 4);
    const r = f.floats[0]!.rect;
    expect(r.col + r.cols).toBeLessThanOrEqual(AREA.cols);
    const far = ok(f, { op: "place", tile: 4, col: 500, row: 500 }).state.floats[0]!.rect;
    expect(far.col + far.cols).toBe(AREA.cols);
    expect(far.row + far.rows).toBe(AREA.rows);
    const locked = ok(f, { op: "lock", on: true }).state;
    no(locked, { op: "place", tile: 4, dx: 4 }, /the screen is locked: moving activity is refused/);
    no(locked, { op: "float", tile: 4 }, /the screen is locked: docking activity is refused/);
    const back = ok(f, { op: "float", tile: 4 }, PERSON, { focus: 2 }).state;
    expect(floated(back)).toEqual([]);
    expect(leaves(back.tree)).toContain(4);
    no(init({ tree: leaf(2), names: NAMES }), { op: "float", tile: 2 }, /only tile in the layout/);
  });

  test("spines: only side by side; a spine moved into a column opens; the person's open of a spine opens it", () => {
    no(fresh(), { op: "collapse", tile: 3, on: true }, /thread isn't side by side with other tiles/);
    const s = ok(fresh(), { op: "collapse", tile: 1, on: true }).state;
    expect(place(s, AREA).rects.get(1)!.cols).toBe(3);
    const moved = ok(s, { op: "move", tile: 1, to: { kind: "split", target: 3, dir: "up" } }).state;
    expect(moved.collapsed.has(1)).toBe(false);
  });

  test("links and opens-into: where a tile's opens land, checked against what takes notes", () => {
    no(fresh(), { op: "link", tile: 1, to: 3 }, /thread is a thread tile: opens land in a tile that takes notes \(reader\)/);
    no(fresh(), { op: "link", tile: 2, to: 2 }, /reader can't open into itself/);
    const s = ok(fresh(), { op: "link", tile: 1, to: 2 }).state;
    expect(landing(s, 1, facts(1))).toEqual({ to: 2 });
    const into = ok(fresh(), { op: "policy", tile: 3, set: { opensInto: "reader" }, clear: [] }).state;
    expect(landing(into, 4, facts(4))).toEqual({ to: 2 });
    no(fresh(), { op: "policy", tile: 3, set: { opensInto: "thread" }, clear: [] }, /thread is a thread tile: opens land in a tile that takes notes/);
    // Closing the tile a link names takes the link away.
    expect(ok(s, { op: "close", tile: 2 }, PERSON, { focus: 1 }).state.links.size).toBe(0);
  });

  test("borders: resize names its split, a drawer's border sizes only it, a fixed kid keeps its size", () => {
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
    actor, area: HOST_AREA, tile: hostFacts, person: { focus: HOST_SCREEN, typingIn: null, busy: false, ...person }, ...(screenHost ? { screenHost } : {}),
  });
  const hok = (s: LayoutState<string>, op: Op<string>, actor: Actor = PERSON, person: Partial<Person<string>> = {}, mode?: "beside" | "over" | "none") => {
    const r = apply(s, op, hctx(actor, person, mode));
    if (!r.ok) throw new Error(`refused: ${r.refused}`);
    return r;
  };
  const host = () => hostLayer({ tabs: ["agent"], names: new Map([["agent", "claude"]]), share: 0.5 });

  test("put away, the screen has the whole room; pulled up over it, the screen keeps it all and the drawer covers its lower half", () => {
    const s = host();
    expect(placeHost(s, HOST_AREA, "over")).toEqual({ screen: HOST_AREA, drawer: null, tiles: new Map() });
    const up = hok(s, { op: "drawer", tile: "agent", open: true });
    const over = placeHost(up.state, HOST_AREA, "over");
    expect(over.screen).toEqual(HOST_AREA);
    expect(over.drawer).toEqual({ col: 0, row: 20, cols: 120, rows: 20 });
    expect(over.tiles.get("agent")).toEqual(over.drawer!);
  });

  test("beside it, the screen is drawn shorter; on a screen that keeps the whole screen (none), it isn't drawn, nor pulled up", () => {
    const up = hok(host(), { op: "drawer", tile: "agent", open: true }).state;
    const beside = placeHost(up, HOST_AREA, "beside");
    expect(beside.screen.rows + beside.drawer!.rows).toBe(40);
    expect(beside.screen.rows).toBeLessThan(40);
    expect(placeHost(up, HOST_AREA, "none")).toEqual({ screen: HOST_AREA, drawer: null, tiles: new Map() });
    const r = apply(host(), { op: "drawer", tile: "agent", open: true }, hctx(PERSON, {}, "none"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toMatch(/keeps the whole screen \(its host policy is none\)/);
  });

  test("the person's keys go through the layer's own transitions: pulled up, to its tab; put away, back to the screen as they left it", () => {
    const up = hok(host(), { op: "drawer", tile: "agent", open: true });
    expect(up.focus).toBe("agent");
    const away = hok(up.state, { op: "drawer", tile: "agent", open: false }, PERSON, { focus: "agent" });
    expect(away.focus).toBe(HOST_SCREEN);
    // An agent pulls it up without the keys; it can't put it away while the person types in it.
    const agentUp = hok(host(), { op: "drawer", tile: "agent", open: true }, AGENT);
    expect(agentUp.focus).toBe(HOST_SCREEN);
    const r = apply(up.state, { op: "drawer", tile: "agent", open: false }, hctx(AGENT, { focus: "agent", typingIn: "agent", busy: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toMatch(/the person is typing; an agent doesn't shut the drawer they have/);
  });

  test("the drawer is a real drawer of tabs: the admin outline opens as a tab beside the agent, and the layer saves and comes back", () => {
    let s = hok(host(), { op: "drawer", tile: "agent", open: true }).state;
    s = hok(s, { op: "open", tile: "outline", kind: "tree", name: "outline", at: { kind: "tabs", target: "agent" } }, PERSON, { focus: "agent" }).state;
    expect(tabsOf(s.tree, "agent")!.ids).toEqual(["agent", "outline"]);
    expect(hostDrawer(s)!.kid.t).toBe("tabs");
    s = hok(s, { op: "tab", tile: "agent" }, PERSON, { focus: "outline" }).state;
    const saved = serialize(s, id => ({ t: "leaf" as const, id }));
    const back = init({ tree: reviveTree(saved.root as any, (l: { id: string }) => l.id), names: s.names });
    expect(tabsOf(back.tree, "outline")!.ids).toEqual(["agent", "outline"]);
    expect(hostDrawer(back)!.open).toBe(true);
    // The screen slot stays where it is: it's the screen's, not a tile to close or move.
    const no2 = apply(s, { op: "close", tile: HOST_SCREEN }, hctx(PERSON));
    expect(no2.ok).toBe(false);
    if (!no2.ok) expect(no2.refused).toMatch(/screen stays: .* keeps its tiles|closable off/);
  });
});
