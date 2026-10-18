import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("show and a render script's line", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("a cold show draws the render script through the note surface", async () => {
    // Hold the first result past show's quiet spell, as a cold runtime under CI load can.
    await board.createBlock(null, "Hello [script::hello] [mode::render]\n```js\nawait wait(1200);\nreturn 'DRAWN ' + this.title;\n```", { kind: "user" });
    await board.listExtensions(true);
    const note = await board.createBlock(null, "Host note\nhello::", { kind: "user" });
    const child = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "show", note.id, "--ws", "scratch"], {
      env: { ...process.env, EP0CH_SOCKET: scratch.sock }, stdout: "pipe", stderr: "pipe",
    });
    const [shown, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(shown).toContain("hello::");
    expect(shown).toContain("DRAWN Host note");
  }, 30_000);
});
