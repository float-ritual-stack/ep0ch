// PIE-957 (Codex, landing B): undoing a layout change on the board keeps the readers opened into its container; the history's
// snapshot is the live shape, not only what a save would keep. Scratch service, fictional note.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardSpec } from "../src/desk/delivery";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("layout.undo on the board", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 200, rows: 56, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk(boardSpec());
    app.push(desk);
    desk.render(desk.ctx);
    await until(() => desk.panes.size > 0, "the board's tiles");
  }, 30_000);

  afterAll(async () => {
    desk.dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k];
  });

  test("a note opened into the board's readers is still there after a resize is undone", async () => {
    const note = await board.request("create", { author: "user", text: "A note opened on the board" });
    (app as any).lastInput = 0;
    await app.act({ action: "open", args: { id: note.id }, as: "history-agent" });
    const tilesOf = () => (desk.layoutGet() as { tiles: { name: string }[] }).tiles.map(t => t.name);
    await until(() => JSON.stringify(desk.layoutGet()).includes(note.id.slice(0, 8)), "the note opened in a reader");
    const before = tilesOf();
    const target = before.find(n => n !== desk.layoutGet().focus)!;
    const resize = (axis: string) => app.dispatch.act({ action: "tile.resize", args: { axis, by: 2 }, tile: target }, USER).then(() => true, () => false);
    expect((await resize("col")) || (await resize("row"))).toBe(true);
    await app.dispatch.act({ action: "layout.undo", args: {} }, USER);
    expect(tilesOf().sort()).toEqual(before.sort());
    expect(JSON.stringify(desk.layoutGet())).toContain(note.id.slice(0, 8));
  }, 30_000);
});

// PIE-1574: a board's lanes come from its hub, not from the person: ctrl+z on a fresh board has none of their steps to take back.
describe.skipIf(!outliner)("ctrl+z on a fresh board, by real keys", () => {
  const scratch = new Scratch();
  let board: SocketBoard, hub: string;
  const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door-fresh");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = (await scratch.seedShowcase()).notes.hub.id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k]; });

  for (const [cols, rows] of [[177, 60], [80, 24]] as const) test(`at ${cols}×${rows}: the lanes stay four, whatever ctrl+z says`, async () => {
    process.env.EP0CH_STATE = join(scratch.root, `door-fresh-${cols}`);   // no saved layout: the board fills from its hub
    let key: (k: Key) => void = () => {};
    const term: any = { info: { cols, rows, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk: any = new Desk(boardSpec({ hub }));
    app.push(desk);
    const paint = () => (app as any).paint();
    const lanes = () => desk.layoutGet().tiles.filter((t: any) => t.kind === "query").map((t: any) => t.name as string);
    try {
      paint();
      await until(() => { paint(); return lanes().length === 4; }, "the board's four lanes", 8000);
      await Bun.sleep(100); paint();
      const before = lanes();
      const press = async (...ks: Key[]) => { for (const k of ks) { key(k); paint(); } await Bun.sleep(100); paint(); };
      const saidNow = () => (app as any).message as string;
      for (const _ of [1, 2]) {
        await press(ctrl("z"));
        expect(lanes()).toEqual(before);
        expect(saidNow()).toContain("nothing to undo");
        expect(desk.outOfStep()).toEqual([]);
      }
      // A real step is what ctrl+z takes back, and only it: the same lanes after, and nothing left.
      await press(ctrl("w"), { kind: "char", ch: "+" });
      expect(desk.history.size).toBe(1);
      await press(ctrl("z"));
      expect(saidNow()).toContain("put the layout back");
      expect(lanes()).toEqual(before);
      await press(ctrl("z"));
      expect(lanes()).toEqual(before);
      expect(saidNow()).toContain("nothing to undo");
      // Another board by `g`: no step, and the steps made on the board before it are gone with its lanes.
      const other = (await board.createBlock(null, "Second hub", USER)).id;
      for (const lane of ["Soon", "Later"]) await board.createBlock(other, `${lane} [type::virtual-branch] [query::stage=${lane.toLowerCase()}]`, USER);
      await press(ctrl("w"), { kind: "char", ch: "+" });
      await app.dispatch.act({ action: "board.hub", args: { id: other } }, USER);
      await until(() => { paint(); return lanes().join() === "Soon,Later"; }, "the second board's lanes", 8000);
      await press(ctrl("z"));
      expect(lanes()).toEqual(["Soon", "Later"]);
      expect(saidNow()).toContain("to undo");   // the keys may be on the reader it left them in: its own words for the same
      expect(desk.outOfStep()).toEqual([]);
    } finally { app.quit(); app.drawer.tile?.kill(); }
  }, 30_000);
});
