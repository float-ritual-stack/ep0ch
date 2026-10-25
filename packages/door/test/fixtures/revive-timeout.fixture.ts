// Run by test/scratch.test.ts through `bun test` (never by the suite: no `.test.` in the name). Two tests over one scratch
// host: the first writes a note and then times out, so Bun ends the file's processes, the host among them; the second reads
// the note back and says so in the file REVIVE_MARK. It's the second's passing that the outer test checks.
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { SocketBoard } from "../../src/socket";
import { Scratch } from "../scratch";

const scratch = new Scratch();
let board: SocketBoard, noteId = "";
beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); });
afterAll(async () => { board.close(); await scratch.dispose(); });

test("writes a note, then runs past its timeout", async () => {
  noteId = (await board.request<{ id: string }>("create", { text: "A note the host keeps" })).id;
  await Bun.sleep(2000);
}, 300);

test("the next test reads the note from a host that is up again", async () => {
  expect((await board.get(noteId))?.text).toContain("A note the host keeps");
  writeFileSync(process.env.REVIVE_MARK!, "read");
});
