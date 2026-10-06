// Holding a reader: only readers that follow the view's current note (the desk's) offer `p hold`, and a
// held reader says so in its title even while it holds an edit or a comment. ("Pin" is for docks.)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Msg } from "../src/board";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("holding a reader", () => {
  const scratch = new Scratch();
  let board: SocketBoard, one: Msg, two: Msg;
  const desk = (current: Msg | null) => ({
    ctx: { board, flash() {}, redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    current, setCurrent() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi & { current: Msg | null };

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    const create = async (text: string) => (await board.get((await board.request<any>("create", { parentId: null, text, author: "agent" })).id))!;
    one = await create("Seed packets");
    two = await create("Garden beds");
  });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("a following reader holds its note and follows again when let go", () => {
    const d = desk(one), pane = new ReaderPane(true);
    pane.select(one, d);
    expect(pane.hint()).toContain("p hold");
    expect(pane.key(char("p"), d)).toBe(true);
    expect(pane.title()).toBe("reader · held");
    expect(pane.hint()).toContain("p follow");

    d.current = two;
    pane.select(two, d);
    expect(pane.msg?.id).toBe(one.id);          // held: stays on its note

    pane.key(char("p"), d);
    expect(pane.title()).toBe("reader");
    expect(pane.msg?.id).toBe(two.id);          // let go: catches up with the current note
  });

  test("a reader that never follows (the board's) doesn't offer hold, and p doesn't change what it shows", () => {
    const d = desk(two), pane = new ReaderPane();
    pane.show(one, d);
    expect(pane.hint()).not.toContain("p hold");
    pane.key(char("p"), d);
    expect(pane.title()).not.toContain("held");
    expect(pane.msg?.id).toBe(one.id);          // letting go used to jump it to the selected card
    expect(pane.describe().held).toBe(false);
  });
});
