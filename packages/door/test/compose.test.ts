// `ep0ch compose` (src/compose.ts): the comment composer alone, the real CLI in a real pty on a scratch outline, as the
// web page's comment box runs it. What a person would notice: it opens on the quoted words, ctrl+s sends as them and
// exits 0, esc twice exits 3 with the text put aside for the same passage only, a closed tab keeps the text, a reply
// lands on its thread, and words that aren't in the note are said on screen.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { Scratch, outliner } from "./scratch";
import { parseCompose } from "../src/compose";
import { SocketBoard } from "../src/socket";

const MAIN = resolve(import.meta.dir, "../src/main.ts");
const NOTE = "Planting the leeks\nThe leeks go in the north bed after the frost lifts.\n\nWater every third day unless it rains.";
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

describe("compose's flags", () => {
  test("an outline and a note are needed; a quote or a reply, not both", () => {
    expect(parseCompose(["--on", "x"], {})).toEqual({ error: expect.stringContaining("--ws") });
    expect(parseCompose(["--ws", "garden"], {})).toEqual({ error: expect.stringContaining("--on") });
    expect(parseCompose(["--ws", "garden", "--on", "x", "--quote", "a", "--reply", "t"], {})).toEqual({ error: expect.stringContaining("one of them") });
    expect(parseCompose(["--on", "x", "--quote", "north bed", "--near", "12"], { EP0CH_WS: "garden" })).toEqual({ ws: "garden", on: "x", quote: "north bed", near: 12 });
  });
});

describe.skipIf(!outliner)("ep0ch compose on a scratch outline", () => {
  let scratch: Scratch, board: SocketBoard, state = "";
  beforeAll(async () => {
    scratch = new Scratch(undefined, "garden");
    await scratch.start();
    board = new SocketBoard(scratch.sock);
    state = join(scratch.root, "compose-state");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch?.dispose(); });

  /** The composer in a 70×10 pty: what it shows, keys to it, and its exit code. */
  function composer(...args: string[]) {
    let screen = "";
    const pty = new Bun.Terminal({ cols: 70, rows: 10, name: "xterm-256color", data: (_t, d) => { screen += new TextDecoder().decode(d); } });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...scratch.env, EP0CH_COMPOSE_STATE: state, TERM: "xterm-256color", EP0CH_KITTY: "0", EP0CH_SIZED: "0" };
    for (const k of ["EP0CH_SOCKET", "EP0CH_CONTROL", "EP0CH_STATE", "EP0CH_MACHINE"]) delete env[k];
    const proc = Bun.spawn([process.execPath, MAIN, "compose", "--ws", "garden", ...args], { terminal: pty, env });
    const sees = async (words: string, ms = 15_000) => {
      const end = Date.now() + ms;
      while (!plain(screen).includes(words)) { if (Date.now() > end) throw new Error(`never showed "${words}":\n${plain(screen).slice(-1500)}`); await Bun.sleep(30); }
      screen = "";
    };
    const type = async (s: string) => { pty.write(s); await Bun.sleep(150); };
    return { sees, type, proc, exited: proc.exited, close: () => pty.close() };
  }
  const threads = (id: string) => board.comments(id);

  test("it opens on the quoted words, ctrl+s sends as the person and exits 0", async () => {
    const note = await board.request<{ id: string }>("create", { parentId: null, text: NOTE, author: "agent" });
    const c = composer("--on", note.id, "--quote", "north bed");
    await c.sees("north bed");
    await c.type("Mulch them first");
    await c.sees("unsent");
    await c.type("\x13");
    expect(await c.exited).toBe(0);
    c.close();
    const [t] = await threads(note.id);
    expect(t!.body).toBe("Mulch them first");
    expect(t!.quote).toBe("north bed");
    expect(t!.author).toBe("user");
  }, 40_000);

  test("esc twice exits 3; the text comes back on the same passage only, and a closed tab keeps it too", async () => {
    const note = await board.request<{ id: string }>("create", { parentId: null, text: NOTE, author: "agent" });
    let c = composer("--on", note.id, "--quote", "frost lifts");
    await c.sees("frost lifts");
    await c.type("half a thought");
    await c.type("\x1b");
    await c.sees("esc again");
    await c.type("\x1b");
    expect(await c.exited).toBe(3);
    c.close();
    c = composer("--on", note.id, "--quote", "every third day");
    await c.sees("type the comment");
    await c.type("\x1b");
    expect(await c.exited).toBe(3);
    c.close();
    c = composer("--on", note.id, "--quote", "frost lifts");
    await c.sees("half a thought");
    await c.type(" and more");
    c.proc.kill("SIGHUP");
    await c.exited;
    c.close();
    c = composer("--on", note.id, "--quote", "frost lifts");
    await c.sees("half a thought and more");
    c.proc.kill("SIGHUP");
    await c.exited;
    c.close();
    expect(await threads(note.id)).toHaveLength(0);
  }, 60_000);

  test("a reply lands on its thread; words not in the note are said on screen, exit 2", async () => {
    const note = await board.request<{ id: string }>("create", { parentId: null, text: NOTE, author: "agent" });
    const b = await board.get(note.id);
    await board.comment("compose-test-1", note.id, b!.revision!, "Which bed?", { quote: "north bed", start: NOTE.indexOf("north bed") }, { kind: "agent", id: "gardener" } as any);
    const [root] = await threads(note.id);
    let c = composer("--on", note.id, "--reply", root!.id);
    await c.sees("reply to");
    await c.type("The one by the shed");
    await c.type("\x13");
    expect(await c.exited).toBe(0);
    c.close();
    expect((await threads(note.id))[0]!.replies.map(r => r.body)).toEqual(["The one by the shed"]);
    c = composer("--on", note.id, "--quote", "south bed");
    await c.sees("can't write this comment");
    await c.type("x");
    expect(await c.exited).toBe(2);
    c.close();
  }, 40_000);
});
