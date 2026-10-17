// PIE-982: `ep0ch show` prints a handler line as written and draws nothing under it (the door's open asks the service for
// the drawing; show doesn't), as the scripts reference says in its traps.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("show and a render script's line", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("the line prints as written, with none of what its script returns", async () => {
    await board.createBlock(null, "Hello [script::hello] [mode::render]\n```js\nreturn 'DRAWN ' + this.title;\n```", { kind: "user" });
    await Bun.sleep(300);
    const note = await board.createBlock(null, "Host note\nhello::", { kind: "user" });
    const shown = (await drawNote(board, note.id, 80))!.join("\n");
    expect(shown).toContain("hello::");
    expect(shown).not.toContain("DRAWN");
  }, 30_000);
});
