// The board screen owns delivery.json (its spec's `saves`); a board in a tile is the desk's tile, saved with the desk.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "./board-view";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("who saves the board's layout, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const saved = () => join(scratch.root, "door", "delivery.json");
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a board tile whose preview strip is folded (a preview tile follows it instead) leaves the board screen's saved layout alone", async () => {
    // The board screen, as the menu's K opens it: its layout saved, its preview open.
    const screen = boardScreen();
    app.push(screen);
    screen.render((screen as any).ctx);
    await Bun.sleep(300);
    (screen as any).save();
    const before = existsSync(saved()) ? readFileSync(saved(), "utf8") : null;
    app.pop();
    // The desk's board layout: the board as a tile, its own preview folded so the preview tile beside it follows it.
    const desk = new Desk(undefined, { layout: "board" });
    app.push(desk);
    desk.render((desk as any).ctx);
    const tile = [...(desk as any).panes.values()].find((p: any) => p.kind === "board");
    await until(() => !!tile?.screen, "the board in its tile");
    tile.render(120, 40);
    await Bun.sleep(300);
    const after = existsSync(saved()) ? readFileSync(saved(), "utf8") : null;
    expect(after).toBe(before);
    // The board screen comes back with its preview open.
    const again = boardScreen();
    app.push(again);
    again.render((again as any).ctx);
    expect((again as any).layoutGet().tiles.find((t: any) => t.name === "preview")?.collapsed ?? false).toBe(false);
  }, 20_000);
});
