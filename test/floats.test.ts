// PIE-510, PIE-513: the desk's paths into the screen-layout module's rules. The rules themselves (a float has no
// place in the tree, it docks only where the containers take it, the last docked tile stays, the person's lock is
// theirs, an agent never moves the tile the person types in: B7–B11, C3, C4) are tested through the module's
// interface in screen-layout.test.ts, with no App. Here, what only the desk can show: the person's keys and clicks
// reach the same operations and say the refusal, a tiny terminal keeps the keys and the floats on the screen, and
// the desk tells the module where the person is really typing. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { leaves } from "../src/desk/screen-layout";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("the desk's keys, clicks and typing reach the layout's rules", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const info = { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false };
  const AS = "float-agent-510";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const message = () => (app as any).message as string;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; floats: any[]; locked: boolean };
  const treeNames = () => (leaves(D().root) as number[]).map((id: number) => D().nameOf(id)) as string[];
  const floats = () => D().floats.map((f: any) => D().nameOf(f.id)) as string[];
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

  test("^W s on a float says why, and nothing moves; pane.split and tile.preview of a float are refused the same way", async () => {
    fresh();
    await mine("tile.float", {}, "reader");
    const tree = treeNames();
    expect(get().focus).toBe("reader");
    key(ctrl("w")); key(char("s"));
    await until(() => /reader is a float: a swap needs a tile in the layout/.test(message()), "the refusal said");
    expect(treeNames()).toEqual(tree);
    expect(floats()).toEqual(["reader"]);
    await refused(act("pane.split", {}, "reader"), /reader is a float/);
    await refused(act("tile.preview", {}, "reader"), /reader is a float/);
  });

  test("a click on a float's ⧉ docks it where the containers take it", async () => {
    fresh();
    await mine("tile.float", {}, "thread");
    await mine("layout.policy", { accepts: "query" }, "activity");
    await mine("tile.focus", {}, "activity");
    render();
    const f = get().floats[0].rect;
    key({ kind: "mouse", action: "down", button: 0, x: f.col + 3, y: f.row }); key({ kind: "mouse", action: "up", button: 0, x: f.col + 3, y: f.row });
    expect(floats()).toEqual([]);
    expect(treeNames()).toContain("thread");
  });

  test("a tiny terminal: the keys leave a tile with no room, and a float is drawn on the screen", async () => {
    fresh();
    await mine("tile.float", {}, "activity");
    await mine("float.place", { col: 120, row: 30, cols: 60, rows: 20 }, "activity");
    info.cols = 14; info.rows = 9;
    render();
    for (const t of get().tiles) {
      const r = t.rect;
      if (!r || !t.shown) continue;
      expect(r.col).toBeGreaterThanOrEqual(0);
      expect(r.col + r.cols).toBeLessThanOrEqual(14);
    }
    // Drawn on the screen as it is (its own rectangle stays as it was put, for when the terminal grows again).
    const f = get().floats[0].rect;
    expect(f.col + f.cols).toBeLessThanOrEqual(14);
    await mine("tile.focus", {}, "thread");
    render();
    const fr = D().rectsNow().get(D().focus);
    expect(fr === undefined || (fr.cols > 0 && fr.rows > 0)).toBe(true);
    info.cols = 160; info.rows = 48;
    render();
    expect(get().floats[0].rect.col).toBe(100);
  });

  test("H J K L on a float of a locked screen say why it doesn't move", async () => {
    fresh();
    await mine("tile.float", {}, "activity");
    await mine("layout.lock", { on: true });
    await mine("tile.focus", {}, "activity");
    key({ kind: "char", ch: "L" });
    await until(() => /moving activity is refused/.test(message()), "H J K L on a float say why");
    await mine("layout.lock", { on: false });
  });

  test("the desk tells the layout where the person types: an agent's pin or move of that reader is refused, of another isn't", async () => {
    fresh();
    const note = await board.request<any>("create", { parentId: null, text: "Rake the gravel path\nBefore the frost.", author: "user" });
    await act("open", { id: note.id }, "reader");
    await until(() => get().tiles.find(t => t.name === "reader")?.showing?.id === note.id, "the note open");
    await mine("tile.focus", {}, "reader");
    key(char("e"));
    await until(() => !!D().personIn()?.editing, "the person editing");
    await refused(act("tile.pin", { on: false }, "reader"), /where the person is typing; an agent doesn't move it/);
    await refused(act("layout.move", { where: "edge-left" }, "reader"), /where the person is typing/);
    expect(D().layoutGet().tiles.find((t: any) => t.name === "reader").drawer).toBeUndefined();
    await act("layout.move", { where: "edge-left" }, "activity");
    expect(treeNames()[0]).toBe("activity");
    expect(get().focus).toBe("reader");
    key({ kind: "esc" });
    // The person's lock is theirs, through the socket too.
    await mine("layout.lock", { on: true });
    await refused(act("layout.lock", { on: false }), /locked by the person; an agent doesn't unlock it/);
    await mine("layout.lock", { on: false });
  });
});
