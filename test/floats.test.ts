// PIE-510: floats and containers keep their tiles and their rules. A float has no place in the tree, so a swap,
// an open beside it, a split of it, a preview of it are refused with the reason (one rule, `floatRefusal`); a
// float docks only where the containers take it; the last docked tile isn't put in a drawer and the last drawer
// showing anything doesn't shut; a tiny terminal moves the keys off a tile left no room and keeps a float on the
// screen; an agent never pins or moves the tile the person is typing in, and never undoes the person's lock.
// Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { leaves, visible } from "../src/desk/layout";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("floats and containers keep their tiles and their rules", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const info = { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false };
  const AS = "float-agent-510";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().act({ action, args, reader }, { kind: "user" });
  const message = () => (app as any).message as string;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; floats: any[]; locked: boolean };
  const treeNames = () => (leaves(D().root) as number[]).map((id: number) => D().nameOf(id)) as string[];
  const floats = () => D().floats.map((f: any) => D().nameOf(f.id)) as string[];
  const tileNames = () => [...D().panes.keys()].map((id: number) => D().nameOf(id)).sort() as string[];
  const refused = async (p: Promise<unknown> | unknown, re: RegExp) => { let err: unknown; try { await p; } catch (e) { err = e; } expect(String((err as Error)?.message)).toMatch(re); };
  const fresh = (layout = "desk") => {
    if ((app as any).stack.at(-1) instanceof Desk) { D().dispose(); app.pop(); }
    info.cols = 160; info.rows = 48;
    desk = new Desk(undefined, { layout });
    app.push(desk);
    render();
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a swap with a float is refused, by act and by ^W s on it: no tile lost, none shown twice", async () => {
    fresh();
    await mine("pane.float", {}, "reader");
    const tree = treeNames(), all = tileNames();
    await refused(act("layout.swap", { to: "reader" }, "tree"), /reader is a float: a swap needs a tile in the layout/);
    await refused(act("layout.swap", { to: "tree" }, "reader"), /reader is a float/);
    // ^W s with the keys on the float: the swap says why, and nothing moves.
    expect(get().focus).toBe("reader");
    key(ctrl("w")); key(char("s"));
    await until(() => /reader is a float/.test(message()), "the refusal said");
    expect(treeNames()).toEqual(tree);
    expect(floats()).toEqual(["reader"]);
    expect(tileNames()).toEqual(all);
    // Two tiles in the tree still swap.
    await mine("layout.swap", { to: "thread" }, "tree");
    expect(treeNames().indexOf("thread")).toBeLessThan(treeNames().indexOf("tree"));
  });

  test("nothing opens beside a float or in its tabs: tile.open, pane.split and tile.preview are refused, no tile made", async () => {
    fresh();
    await mine("pane.float", {}, "reader");
    const all = tileNames();
    await refused(act("tile.open", { kind: "reader", name: "ghost", to: "reader", where: "right" }), /reader is a float: putting ghost beside it needs a tile in the layout/);
    await refused(act("tile.open", { kind: "reader", name: "ghost", to: "reader", where: "tabs" }), /into its tabs/);
    await refused(act("pane.split", {}, "reader"), /reader is a float/);
    await refused(act("tile.preview", {}, "reader"), /reader is a float/);
    expect(tileNames()).toEqual(all);
    // Along an outer edge, a float as the base is fine: the edge is the whole layout's.
    const r = await mine("tile.open", { kind: "reader", name: "edgy", to: "reader", where: "edge-right" }) as any;
    expect(treeNames()).toContain("edgy");
    expect(r.n).toBeGreaterThan(0);
  });

  test("a float docks only where the containers take it: another place if the first refuses, else refused with why", async () => {
    fresh();
    await mine("pane.float", {}, "thread");
    // The keys on activity: a float docks beside it, in the container that takes only query tiles.
    await mine("layout.policy", { accepts: "query" }, "activity");
    await mine("tile.focus", {}, "activity");
    // Docked by the mouse: a click on the ⧉ before its title.
    render();
    const f = D().floats[0].rect;
    key({ kind: "mouse", action: "down", button: 0, x: f.col + 3, y: f.row }); key({ kind: "mouse", action: "up", button: 0, x: f.col + 3, y: f.row });
    expect(floats()).toEqual([]);
    const policyOver = (name: string) => (D().policyAt([...D().names].find(([, v]: any) => v === name)![0]) as any).accepts;
    expect(policyOver("thread")).toBeNull();                       // docked where reader tiles go
    // The screen takes only query tiles: there's nowhere, and it stays a float.
    await mine("pane.float", {}, "thread");
    await mine("layout.policy", { node: "screen", accepts: "query" });
    await refused(act("pane.float", {}, "thread"), /takes only query: not thread \(thread\)/);
    expect(floats()).toEqual(["thread"]);
    await mine("layout.policy", { node: "screen", clear: "accepts" });
  });

  test("the last docked tile isn't put in a drawer; the last drawer showing anything doesn't shut; a blank screen opens one", async () => {
    fresh();
    const all = treeNames();
    for (const n of all.slice(0, -1)) await mine("tile.pin", { on: false }, n);
    await refused(mine("tile.pin", { on: false }, all.at(-1)), /last tile docked/);
    await refused(mine("tile.pin", { on: false, edge: "right" }, all.at(-1)), /last tile docked/);
    for (const n of all.slice(0, -1)) await mine("tile.drawer", { open: false }, n);
    expect((visible(D().root) as number[]).map((id: number) => D().nameOf(id))).toEqual([all.at(-1)]);
    // Close the one docked tile: the drawers are all that's left, and the screen opens one with the keys on it.
    await mine("tile.focus", {}, all[0]);
    await mine("tile.drawer", { open: false }, all[0]);
    await mine("tile.close", {}, all.at(-1));
    render();
    expect(visible(D().root).length).toBeGreaterThan(0);
    expect(visible(D().root)).toContain(D().focus);
    const shown = drawerName();
    await refused(mine("tile.drawer", { open: false }, shown), /all the screen shows/);
  });
  const drawerName = () => D().nameOf(visible(D().root)[0]) as string;

  test("a tiny terminal: the keys leave a tile with no room, and a float stays on the screen", async () => {
    fresh();
    await mine("pane.float", {}, "activity");
    await mine("float.place", { col: 120, row: 30, cols: 60, rows: 20 }, "activity");
    info.cols = 14; info.rows = 9;
    render();
    for (const t of get().tiles) {
      const r = t.rect;
      if (!r || !t.shown) continue;
      expect(r.col).toBeGreaterThanOrEqual(0);
      expect(r.col + r.cols).toBeLessThanOrEqual(14);
    }
    const f = D().floats[0].rect;
    expect(f.col + f.cols).toBeLessThanOrEqual(14);
    await mine("tile.focus", {}, "thread");
    render();
    const fr = D().rectsNow().get(D().focus);
    expect(fr === undefined || (fr.cols > 0 && fr.rows > 0)).toBe(true);
    info.cols = 160; info.rows = 48;
  });

  test("locked: a tile doesn't fold and a float doesn't move (the shape is fixed); a spine still opens", async () => {
    fresh();
    await mine("tile.collapse", { on: true }, "reader");
    await mine("pane.float", {}, "activity");
    await mine("layout.lock", { on: true });
    await refused(mine("tile.collapse", { on: true }, "tree"), /the screen is locked: folding tree is refused/);
    await refused(mine("float.place", { dx: 4 }, "activity"), /the screen is locked: moving activity is refused/);
    await mine("tile.focus", {}, "activity");
    key({ kind: "char", ch: "L" });
    await until(() => /moving activity is refused/.test(message()), "H J K L on a float say why");
    await mine("tile.collapse", { on: false }, "reader");
    expect(get().tiles.find(t => t.name === "reader").collapsed).toBeUndefined();
    await mine("layout.lock", { on: false });
  });

  test("an agent never pins or moves the tile the person is typing in, and never undoes the person's lock", async () => {
    fresh();
    const note = await board.request<any>("create", { parentId: null, text: "Rake the gravel path\nBefore the frost.", author: "user" });
    await act("open", { id: note.id }, "reader");
    await until(() => get().tiles.find(t => t.name === "reader")?.showing?.id === note.id, "the note open");
    await mine("tile.focus", {}, "reader");
    key(char("e"));
    await until(() => !!D().personIn()?.editing, "the person editing");
    await refused(act("tile.pin", { on: false }, "reader"), /where the person is typing; an agent doesn't move it/);
    await refused(act("tile.pin", { on: false, edge: "left" }, "reader"), /where the person is typing/);
    expect(D().layoutGet().tiles.find((t: any) => t.name === "reader").drawer).toBeUndefined();
    key({ kind: "esc" });
    // A float the person is typing in: an agent doesn't move or size it.
    await mine("pane.float", {}, "reader");
    key(char("e"));
    await until(() => !!D().personIn()?.editing, "the person editing the float");
    await refused(act("float.place", { dx: 4 }, "reader"), /where the person is typing/);
    key({ kind: "esc" });
    // The person's lock is theirs: an agent can't undo it by layout.lock or layout.policy.
    await mine("layout.lock", { on: true });
    await refused(act("layout.lock", { on: false }), /locked by the person; an agent doesn't unlock it/);
    await refused(act("layout.policy", { node: "screen", locked: false }), /locked by the person/);
    await refused(act("layout.policy", { node: "screen", clear: "locked" }), /locked by the person/);
    expect(get().locked).toBe(true);
    await mine("layout.lock", { on: false });
    // An agent's own lock it may undo; a container the person locked it may not.
    await act("layout.lock", { on: true });
    await act("layout.lock", { on: false });
    expect(get().locked).toBe(false);
    await mine("layout.policy", { locked: true }, "thread");
    await refused(act("layout.policy", { clear: "locked" }, "thread"), /was locked by the person/);
    await mine("layout.policy", { clear: "locked" }, "thread");
  });
});
