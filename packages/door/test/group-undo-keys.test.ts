// PIE-1559, PIE-1569: ctrl+z by the real keys, at the sizes a person has. Gathering leaves the keys on the group, and the
// next ctrl+z takes the gather back, from the group and from inside it; a refusal says where the change it names can be
// undone from, and doing what it says works. A scratch outline, made-up notes, every step a key or a click.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("ctrl+z by the real keys (PIE-1559, PIE-1569)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-groupundo-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols: number, rows: number) {
    let key: (k: Key) => void = () => {};
    const term: any = { info: { cols, rows, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const paint = () => (app as any).paint();
    paint();
    const settle = async () => { await Bun.sleep(30); paint(); };
    const press = async (...ks: Key[]) => { for (const k of ks) { key(k); paint(); } await settle(); };
    const click = async (x: number, y: number, mods = 0) => { for (const action of ["down", "up"]) key({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) } as Key); await settle(); };
    const rect = (name: string) => desk.layoutGet().tiles.find((t: any) => t.name === name)!.rect as { col: number; row: number; cols: number; rows: number };
    const title = (name: string, mods = 0) => { const r = rect(name); return click(r.col + 3, r.row, mods); };
    const names = () => desk.layoutGet().tiles.map((t: any) => t.name as string).sort();
    const said = () => (app as any).message as string;
    return { app, desk, press, click, title, rect, names, said, paint, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  for (const [cols, rows] of [[177, 60], [80, 24]] as const) describe(`at ${cols}×${rows}`, () => {
    test("shift+click two titles, ^W G, ctrl+z: the keys are on the group and the gather comes undone, the same tiles back", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
        const names = d.names(), reader = d.desk.pane("reader"), replies = d.desk.pane("replies");
        await d.title("reader", 4); await d.title("replies", 4);
        await d.press(ctrl("w"), char("G"));
        const group = d.names().find(n => !names.includes(n))!;
        expect(group).toBeDefined();
        expect(d.desk.layoutGet().focus).toBe(group);
        await d.press(ctrl("z"));
        expect(d.names()).toEqual(names);
        expect([d.desk.pane("reader"), d.desk.pane("replies")]).toEqual([reader, replies]);
      } finally { d.quit(); }
    });

    test("stepped into the group (⏎ in), ctrl+z takes the gather back too", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "activity" }, USER);
        const names = d.names(), activity = d.desk.pane("activity");
        await d.desk.dispatch.act({ action: "tile.group", tile: "activity", args: { with: "replies", name: "hob" } }, USER);
        await d.desk.dispatch.press("mount.enter", {}, "hob");
        d.paint();
        expect((d.desk.pane("hob") as any).inside).toBe(true);
        await d.press(ctrl("z"));
        expect(d.names()).toEqual(names);
        expect(d.desk.pane("activity")).toBe(activity);
      } finally { d.quit(); }
    });

    test("a change on the other layout is named, the newest one, and ^W B takes it back from here, then the carry", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
        const names = d.names(), replies = d.desk.pane("replies");
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        const drawer = () => d.app.drawer.desk as Desk;
        // Two later changes on the drawer's side: an open, then a rename of what it opened. Its undo takes the rename first.
        await drawer().dispatch.act({ action: "tile.open", tile: "replies", args: { kind: "reader", name: "late", where: "down" } }, USER);
        await drawer().dispatch.act({ action: "tile.title", tile: "late", args: { text: "later" } }, USER);
        d.paint();
        const tree = d.rect("tree");
        await d.click(tree.col + 3, tree.row + 2);                        // a click on the screen: the keys are there
        expect(d.app.drawer.entered).toBe(false);
        await d.press(ctrl("z"));
        expect(d.said()).toBe("your drawer changed since (you rename); ^W B undoes it");
        expect(drawer().pane("later")).toBeDefined();
        // What it names works from here, with the keys where they are: the rename, the open, then the carry.
        await d.press(ctrl("w"), char("B"));
        expect(drawer().pane("late")).toBeDefined();
        await d.press(ctrl("w"), char("B"));
        expect(drawer().pane("late")).toBeUndefined();
        await d.press(ctrl("w"), char("B"));
        expect(d.names()).toEqual(names);
        expect(d.desk.pane("replies")).toBe(replies);
      } finally { d.quit(); }
    });

    test("^W B undoes the layout with the keys where they are: the program in the drawer gets no key and keeps running", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
        await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
        await until(() => d.app.drawer.tile?.running === true, "the drawer's program runs");
        const names = d.names(), agent = d.app.drawer.tile!, typed = () => agent.text().join("\n");
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        const tree = d.rect("tree");
        await d.click(tree.col + 3, tree.row + 2);
        await d.press(ctrl("w"), char("B"));
        expect(d.names()).toEqual(names);
        expect(agent.running).toBe(true);
        expect(typed()).not.toContain("^Z");
        expect(d.said()).toContain("put the layout back");
      } finally { d.quit(); }
    });
  });
});
