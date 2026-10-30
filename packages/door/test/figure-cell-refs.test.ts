// A reference written only in a figure's cell (PIE-1334): found, resolved and followed as one in prose is, and drawn
// again when its note changes, by its short id as by its whole one. A scratch host; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drawNote } from "../src/notes-cli";
import { outlineChanged } from "../src/refs";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("a reference only in a figure's cell", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => {
    await scratch.start(); board = new SocketBoard(scratch.sock); await board.info();
    // The service's change notices, as the door hears them (app.ts): each names the whole id of the note changed.
    board.subscribe(e => { if (e.change) outlineChanged(e.change.blockId ? [e.change.blockId] : null); });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  const drawn = async (id: string) => {
    let text = "";
    // The first draw asks the service; the answer draws on the next.
    for (let i = 0; i < 40; i++) { text = (await drawNote(board, id, 100))!.map(plain).join("\n"); if (!text.includes("((")) break; await Bun.sleep(50); }
    return text;
  };

  test("its short id and its whole id draw the note's title, and the title it has after a rename", async () => {
    const shed = await board.createBlock(null, "Potting shed", { kind: "user" });
    const frame = await board.createBlock(null, "Cold frame", { kind: "user" });
    const note = await board.createBlock(null, ["Where things are", "", "::graph-table", "---", "headers: [Thing, Where]", "rows:",
      `  - ["trays", "((${shed.id.slice(0, 8)}))"]`, `  - ["lids", "((${frame.id}))"]`, "---", "::"].join("\n"), { kind: "user" });
    const before = await drawn(note.id);
    expect(before).toContain("trays ┊ Potting shed");
    expect(before).toContain("lids  ┊ Cold frame");
    // Each renamed alone: one note's answer is asked again only for a change to a note it names.
    const renamed = async (to: string) => { let after = ""; for (let end = Date.now() + 5000; !after.includes(to) && Date.now() < end; await Bun.sleep(50)) after = await drawn(note.id); return after; };
    await board.update(shed.id, "Garden shed", (await board.get(shed.id))!.revision!);
    expect(await renamed("Garden shed")).toContain("trays ┊ Garden shed");
    await board.update(frame.id, "Glass frame", (await board.get(frame.id))!.revision!);
    expect(await renamed("Glass frame")).toContain("lids  ┊ Glass frame");
  }, 30_000);
});
