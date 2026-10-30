// Pinning a reader (PIE-1207): only the readers a person owns offer `p pin`; pinned, it says where opens land instead,
// and p lets it go. A reader its screen owns (the board's) has no pin. ("Pin" in the layout is for docks.)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Msg } from "../src/board";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("pinning a reader", () => {
  const scratch = new Scratch();
  let board: SocketBoard, one: Msg;
  const desk = () => ({
    ctx: { board, flash() {}, redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    openFromTile() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi;

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    const create = async (text: string) => (await board.get((await board.request<any>("create", { parentId: null, text, author: "agent" })).id))!;
    one = await create("Seed packets");
  });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("p pins a reader on its note and says where opens land; p again lets it go", async () => {
    const d = desk(), pane = new ReaderPane(true);
    pane.show(one, d);
    expect(pane.title()).toBe("detail");                // a reader the person owns is the glossary's detail
    expect(pane.hint()).toContain("p pin");
    expect(pane.key(char("p"), d)).toBe(true);
    await until(() => pane.pinned, "pinned");
    pane.opensGo = "detail2";                           // the desk sets it as it draws (opensOf)
    expect(pane.hint()).toContain("pinned · opens → detail2");
    expect(pane.hint()).toContain("p unpin");
    expect(pane.spec()).toMatchObject({ mode: "pinned", note: one.id });
    pane.key(char("p"), d);
    await until(() => !pane.pinned, "unpinned");
    expect(pane.msg?.id).toBe(one.id);                  // letting go keeps its note: nothing jumps
    expect(pane.spec().mode).toBeUndefined();
  });

  test("an empty reader has nothing to pin: refused with the command", async () => {
    await expect(new ReaderPane(true).setPin(true, desk())).rejects.toThrow(/nothing to pin yet.*act reader\.pin page=<name>/);
  });

  test("a reader its screen owns (the board's) has no pin, and p doesn't change what it shows", () => {
    const d = desk(), pane = new ReaderPane();
    pane.show(one, d);
    expect(pane.hint()).not.toContain("p pin");
    pane.key(char("p"), d);
    expect(pane.pinned).toBe(false);
    expect(pane.msg?.id).toBe(one.id);
    expect(pane.describe().pinned).toBe(false);
  });
});
