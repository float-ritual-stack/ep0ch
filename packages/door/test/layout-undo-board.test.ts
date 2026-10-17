// PIE-957 (Codex, landing B): undoing a layout change on the board keeps the readers opened into its container; the history's
// snapshot is the live shape, not only what a save would keep. Scratch service, fictional note.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardSpec } from "../src/desk/delivery";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
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
    const note = await board.request<{ id: string }>("create", { author: "user", text: "A note opened on the board" });
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
