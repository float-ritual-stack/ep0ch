// Pinning a reader: only readers that follow the view's current note (the desk's) offer `p`, and a
// pinned reader says so in its title even while it holds an edit or a comment.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Msg } from "../src/board";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("reader pinning", () => {
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

  test("a following reader pins to its note and follows again when unpinned", () => {
    const d = desk(one), pane = new ReaderPane(true);
    pane.select(one, d);
    expect(pane.hint()).toContain("p pin");
    expect(pane.key(char("p"), d)).toBe(true);
    expect(pane.title()).toBe("reader · pinned");
    expect(pane.hint()).toContain("p unpin");

    d.current = two;
    pane.select(two, d);
    expect(pane.msg?.id).toBe(one.id);          // pinned: stays on its note

    pane.key(char("p"), d);
    expect(pane.title()).toBe("reader");
    expect(pane.msg?.id).toBe(two.id);          // unpinned: catches up with the current note
  });

  test("a reader that never follows (the board's) doesn't offer pin, and p doesn't change what it shows", () => {
    const d = desk(two), pane = new ReaderPane();
    pane.show(one, d);
    expect(pane.hint()).not.toContain("pin");
    pane.key(char("p"), d);
    expect(pane.title()).not.toContain("pinned");
    expect(pane.msg?.id).toBe(one.id);          // unpinning used to jump it to the selected card
    expect(pane.describe().pinned).toBe(false);
  });
});
