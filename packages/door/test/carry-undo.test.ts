// PIE-1559: a tile carried between layouts (to the glass, into the drawer, into a group) comes back whole on one undo:
// the same instance in its place, the other layout as it was (its tabs' selection too), both saved, and never over a
// change made since. Checked on what is there after the undo, not on the undo's entry. A scratch outline, made-up notes,
// a 160x48 door with the desk and the drawer.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { SocketBoard } from "../src/socket";
import { TXN } from "../src/surface/txn";
import { outliner, Scratch } from "./scratch";

const USER = { kind: "user" } as const;

describe.skipIf(!outliner)("one undo brings a carried tile back whole (PIE-1559)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-carryundo-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door() {
    const term: any = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const paint = () => (app as any).paint();
    paint();
    await app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
    await app.dispatch.act({ action: "host.leave", args: {} }, USER).catch(() => {});   // the person's keys back on the screen
    paint();
    const drawer = () => app.drawer.desk as Desk;
    // The shape as the person sees it: a rebuilt container gets a new id, so ids are left out.
    const noIds = (n: unknown): unknown => (Array.isArray(n) ? n.map(noIds) : n && typeof n === "object" ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== "id" && k !== "path").map(([k, v]) => [k, noIds(v)])) : n);
    const shape = (d: Desk) => { const g = d.layoutGet(); return { tree: noIds(g.tree), floats: g.floats.map((f: any) => f.tile), tiles: g.tiles.map((t: any) => `${t.name}=${t.tile}`).sort() }; };
    const wiresOf = (d: Desk) => ((d as any).layout.wires as { from: number; verb: string; to: number }[]).map(w => `${(d as any).nameOf(w.from)} ${w.verb} ${(d as any).nameOf(w.to)}`).sort();
    const act = (d: Desk, action: string, args: Record<string, unknown> = {}, tile?: string) => d.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER) as Promise<any>;
    return { app, desk, drawer, shape, wiresOf, act, paint, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  test("^W U on a screen's only tile, then undo: the same tile back in its place, its name kept, the glass empty", async () => {
    const d = await door();
    try {
      for (const t of ["tree", "replies", "activity"]) await d.act(d.desk, "tile.close", {}, t);
      const pane = d.desk.pane("reader"), before = d.shape(d.desk), drawerBefore = d.shape(d.drawer());
      await d.act(d.desk, "tile.float", { to: "glass" }, "reader");
      expect(d.desk.pane("reader")).toBeUndefined();                    // the heir has a name of its own
      await d.act(d.desk, "layout.undo");
      expect(d.shape(d.desk)).toEqual(before);
      expect(d.desk.pane("reader")).toBe(pane);
      expect(d.shape(d.drawer())).toEqual(drawerBefore);
      expect([...d.desk.outOfStep(), ...d.drawer().outOfStep()]).toEqual([]);
    } finally { d.quit(); }
  });

  test("a wired tile carried into the drawer and renamed there comes back, by identity, with its wires", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("reader"), before = d.shape(d.desk), wires = d.wiresOf(d.desk), drawerBefore = d.shape(d.drawer());
      expect(wires.length).toBeGreaterThan(0);                            // the tree's opens land in the reader
      await d.act(d.desk, "tile.drawer", { on: true }, "reader");
      await d.act(d.drawer(), "tile.title", { text: "lantern" }, "reader");
      // Undone from the drawer's side, where the tile is now: the rename first, then the carry; the screen is saved too.
      d.drawer().undoLayout(USER);
      d.drawer().undoLayout(USER);
      expect(d.shape(d.desk)).toEqual(before);
      expect(d.desk.pane("reader")).toBe(pane);
      expect(d.wiresOf(d.desk)).toEqual(wires);
      expect(d.shape(d.drawer())).toEqual(drawerBefore);
      const file = JSON.parse(readFileSync(join(state, ...findDesk(state)), "utf8"));
      expect(JSON.stringify(file.root)).toContain(`"name":"reader"`);
    } finally { d.quit(); }
  });

  test("a change made since on the other side is undone first: refused, naming it, both sides as they are", async () => {
    const d = await door();
    try {
      await d.act(d.desk, "tile.drawer", { on: true }, "replies");
      await d.act(d.drawer(), "tile.open", { kind: "reader", name: "late", where: "right" }, "replies");
      const here = d.shape(d.desk), there = d.shape(d.drawer());
      await expect(d.act(d.desk, "layout.undo")).rejects.toThrow(/your drawer changed since \(you open\); click it, then ctrl\+z there/);
      expect(d.shape(d.desk)).toEqual(here);
      expect(d.shape(d.drawer())).toEqual(there);
    } finally { d.quit(); }
  });

  test("two carries in one transaction come back on one undo, each the same instance", async () => {
    const d = await door();
    try {
      const reader = d.desk.pane("reader"), replies = d.desk.pane("replies"), before = d.shape(d.desk), drawerBefore = d.shape(d.drawer());
      await d.act(d.desk, "tile.drawer", { on: true, txn: "pair-1559" }, "reader");
      await d.act(d.desk, "tile.drawer", { on: true, txn: "pair-1559" }, "replies");
      await d.act(d.desk, "layout.txn.end", { txn: "pair-1559" });
      await d.act(d.desk, "layout.undo");
      expect(d.shape(d.desk)).toEqual(before);
      expect([d.desk.pane("reader"), d.desk.pane("replies")]).toEqual([reader, replies]);
      expect(d.shape(d.drawer())).toEqual(drawerBefore);
    } finally { d.quit(); }
  });

  test("the receiving layout's tab selection is put back: the tab shown before the carry is shown again", async () => {
    const d = await door();
    try {
      await d.act(d.desk, "layout.move", { to: "tree", where: "tabs" }, "activity");
      await d.act(d.desk, "tile.focus", {}, "tree");
      const before = d.shape(d.desk), shell = d.drawer().layoutGet().tiles[0]!.name as string;
      d.drawer().carry(d.desk, shell, { to: "activity", where: "tabs" }, USER);   // out of the drawer into the tree's tabs
      expect(d.shape(d.desk)).not.toEqual(before);
      d.desk.undoLayout(USER);
      expect(d.shape(d.desk)).toEqual(before);
    } finally { d.quit(); }
  });

  test("tiles gathered into a group and taken back out by undo are the same instances", async () => {
    const d = await door();
    try {
      const reader = d.desk.pane("reader"), activity = d.desk.pane("activity"), before = d.shape(d.desk);
      await d.act(d.desk, "tile.group", { with: "activity", name: "hob" }, "reader");
      d.paint();                                                          // the group's own desk is made, its tiles in it
      d.desk.undoLayout(USER);                                            // the screen's undo (ctrl+z there)
      expect(d.shape(d.desk)).toEqual(before);
      expect([d.desk.pane("reader"), d.desk.pane("activity")]).toEqual([reader, activity]);
      expect(d.desk.outOfStep()).toEqual([]);
    } finally { d.quit(); }
  });

  test("a group spilled and put back by undo holds the same instances again", async () => {
    const d = await door();
    try {
      await d.act(d.desk, "tile.group", { with: "activity", name: "hob" }, "reader");
      d.paint();
      const inner = () => (d.desk.pane("hob") as any).inner as Desk;
      const reader = inner().pane("reader"), activity = inner().pane("activity");
      await d.act(d.desk, "tile.group", { on: false }, "hob");
      expect(d.desk.pane("reader")).toBe(reader);
      d.desk.undoLayout(USER);
      d.paint();
      expect(d.desk.pane("reader")).toBeUndefined();
      expect([inner().pane("reader"), inner().pane("activity")]).toEqual([reader, activity]);
      expect(d.desk.outOfStep()).toEqual([]);
    } finally { d.quit(); }
  });

  // Codex's second pass (PIE-1559).
  const AGENT = "undoer-1559";
  const asAgent = (d: Awaited<ReturnType<typeof door>>, action: string, args: Record<string, unknown> = {}, tile?: string) => d.app.act({ action, args, ...(tile ? { tile } : {}), as: AGENT }) as Promise<any>;

  test("an agent's carry is the agent's: it undoes its own carry, the same instance back", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("replies"), before = d.shape(d.desk), drawerBefore = d.shape(d.drawer());
      await asAgent(d, "tile.drawer", { on: true }, "replies");
      expect(d.desk.history.newest()?.party).toBe(`agent:${AGENT}`);
      await asAgent(d, "layout.undo");
      expect(d.shape(d.desk)).toEqual(before);
      expect(d.desk.pane("replies")).toBe(pane);
      expect(d.shape(d.drawer())).toEqual(drawerBefore);
    } finally { d.quit(); }
  });

  test("a run stopped after a carry puts the same tile back, once, on both sides", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("replies"), before = d.shape(d.desk), drawerBefore = d.shape(d.drawer());
      await d.act(d.desk, "tile.drawer", { on: true, txn: "run-1559" }, "replies");
      const r = d.desk.endTxn("run-1559", "stopped");
      expect(r.putBack).toBe(true);
      expect(d.shape(d.desk)).toEqual(before);
      expect(d.desk.pane("replies")).toBe(pane);
      expect(d.shape(d.drawer())).toEqual(drawerBefore);
    } finally { d.quit(); }
  });

  test("an agent's undo leaves the person's keys where they put them, and won't close the tile they're on", async () => {
    const d = await door();
    try {
      await asAgent(d, "tile.open", { kind: "reader", name: "lamp", where: "right" }, "replies");
      await d.act(d.desk, "tile.focus", {}, "reader");
      await asAgent(d, "layout.undo");
      expect(d.desk.layoutGet().focus).toBe("reader");
      await asAgent(d, "tile.open", { kind: "reader", name: "wick", where: "right" }, "replies");
      await d.act(d.desk, "tile.focus", {}, "wick");
      await expect(asAgent(d, "layout.undo")).rejects.toThrow(/wick/);
      expect(d.desk.pane("wick")).toBeDefined();
    } finally { d.quit(); }
  });

  test("a renamed tile and a new one with its old name: undo puts back the carried instance, never the namesake", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("replies"), before = d.shape(d.desk);
      await d.act(d.desk, "tile.drawer", { on: true, txn: "swap-1559" }, "replies");
      await d.act(d.drawer(), "tile.title", { text: "ember", txn: "swap-1559" }, "replies");
      await d.act(d.desk, "tile.open", { kind: "reader", name: "replies", where: "right", txn: "swap-1559" }, "reader");
      const namesake = d.desk.pane("replies");
      await d.act(d.desk, "layout.txn.end", { txn: "swap-1559" });
      d.desk.undoLayout(USER);
      expect(d.desk.pane("replies")).toBe(pane);
      expect(d.desk.pane("replies")).not.toBe(namesake);
      expect(d.shape(d.desk).tiles).toEqual(before.tiles);
    } finally { d.quit(); }
  });

  test("a two-way exchange between a group and the screen in one run comes back whole", async () => {
    const d = await door();
    try {
      await d.act(d.desk, "tile.group", { with: "activity", name: "hob" }, "reader");
      d.paint();
      const inner = () => (d.desk.pane("hob") as any).inner as Desk;
      const reader = inner().pane("reader"), replies = d.desk.pane("replies"), before = d.shape(d.desk), innerBefore = d.shape(inner());
      TXN.run({ txn: "trade-1559" }, () => {                             // a drop each way, as a drag between them does
        d.desk.carry(inner(), "replies", { to: "activity", where: "right" }, USER);
        inner().carry(d.desk, "reader", { to: "tree", where: "right" }, USER);
      });
      d.desk.endTxn("trade-1559", "done"); inner().endTxn("trade-1559", "done");
      d.desk.undoLayout(USER);
      d.paint();
      expect(d.shape(d.desk)).toEqual(before);
      expect(d.shape(inner())).toEqual(innerBefore);
      expect([inner().pane("reader"), d.desk.pane("replies")]).toEqual([reader, replies]);
      expect([...d.desk.outOfStep(), ...inner().outOfStep()]).toEqual([]);
    } finally { d.quit(); }
  });

  test("a group spilled and put back keeps its own identity: a wire to it still reaches it", async () => {
    const d = await door();
    try {
      await d.act(d.desk, "tile.group", { with: "activity", name: "hob" }, "reader");
      d.paint();
      const id = d.desk.layoutGet().tiles.find((t: any) => t.name === "hob")!.tile;
      await d.act(d.desk, "tile.group", { on: false }, "hob");
      d.desk.undoLayout(USER);
      expect(d.desk.layoutGet().tiles.find((t: any) => t.name === "hob")?.tile).toBe(id);
    } finally { d.quit(); }
  });
});

/** Where the desk's save is under the state folder: the one desk.json the door wrote. */
function findDesk(root: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const walk = (dir: string, at: string[]): string[] | null => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === "desk.json") return [...at, n];
      if (statSync(p).isDirectory()) { const hit = walk(p, [...at, n]); if (hit) return hit; }
    }
    return null;
  };
  return walk(root, []) ?? ["desk.json"];
}
