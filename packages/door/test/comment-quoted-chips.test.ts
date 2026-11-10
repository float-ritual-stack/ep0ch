// PIE-1596: a comment whose words quote chips (`see [page::seeds] and [orient::all]`) is titled by those words whole,
// and its header counts only its own properties (its metadata line's), in `ep0ch show` and in the door's reader alike:
// both read outline-core's one rule (noteTitleLine, ownPropertyRecords). A scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Ctx } from "../src/app";
import { drawNote } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => visible(s).trimEnd();
const WORDS = "see [page::seeds] and [orient::all]";

describe.skipIf(!outliner)("a comment quoting chips (PIE-1596)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, comment = "";

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const note = await board.createBlock(null, "Seed order\nTomatoes, basil and the early peas.");
    comment = (await board.comment("quoted-chips-1", note.id, note.revision!, WORDS, null)).id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("ep0ch show: the title is its words whole, and the header counts its three own properties", async () => {
    for (const w of [44, 120]) {
      const out = (await drawNote(board, comment, w, { quiet: 150, max: 4000 }))!.map(plain);
      expect(out[0]).toBe(WORDS);
      expect(out[1]).toContain("i 3 properties");
    }
  });

  test("the door's reader: the same title and count, and its property panel lists only its own", async () => {
    const m = (await board.get(comment))!;
    const ctx = { board, t: { cols: 60, rows: 30, cellW: 9, cellH: 18, kitty: false }, graphics: false, flash() {}, redraw() {} } as unknown as Ctx;
    const host: SurfaceHost = { ctx, redraw() {}, navigate() {} };
    const s = new NoteSurface();
    s.show(m, host);
    const draw = () => s.render(60, 30, host).lines.map(plain);
    await until(() => draw().some(l => l.includes("i 3 properties")), "the reader's count", 5000);
    expect(draw().some(l => l.trim() === WORDS)).toBe(true);
    expect(draw().some(l => l.includes("i 5 properties"))).toBe(false);
    expect(s.rows(m).map(r => r.key)).toEqual(["type", "annotation-source", "annotation-status"]);
    s.dispose();
  });
});
