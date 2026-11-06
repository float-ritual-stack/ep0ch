// A reload with the host stopped, then gone (PIE-1560, PIE-1591): a real SIGSTOP and a real death, what a fake can't be.
// The reload's rule is the session's (draft-reload.test.ts); this says it holds against a host that hangs mid-read.
// A scratch service, never a real outline; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard, USER } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("a posted comment's edit against a real host", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard;
  const host = (): SurfaceHost => ({ ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    other = new SocketBoard(scratch.sock);
    await other.info();
  });
  afterAll(async () => { board?.close(); other?.close(); await scratch.dispose(); });

  /** A note with one posted comment, in its edit with a word typed; the comment then changed elsewhere and ctrl+s refused. */
  async function refused(title: string, rows = 8) {
    const id = (await board.request("create", { parentId: null, text: `${title}\nThe plot by the shed.`, author: "user" })).id as string;
    const m = (await board.get(id))!;
    const posted = await board.comment(`req-${id}`, id, m.revision!, "How deep is the bed?", null);
    const s = new NoteSurface(), h = host();
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("e"), h);
    await until(() => !!s.session?.composer, "the comment's edit");
    const d = s.session!.composer!;
    for (const c of " now") s.key(char(c), h);
    const now = (await other.comments(id))[0]!;
    await other.updateComment(posted.id, now.revision!, "How deep should the bed be?");
    // Drawn as it's typed, in a small tile: what ctrl+s says comes after this, and must not push the text out of view.
    s.render(28, rows, h);
    s.key(ctrl("s"), h);
    s.render(28, rows, h);                  // the frame the key paints, before the answer
    await until(() => d.status.conflict !== null, "the stale refusal");
    return { s, h, d };
  }

  test("with the host stopped ctrl+r says it couldn't read, keeps the text and the conflict", async () => {
    const { s, h, d } = await refused("Stopped host");
    const typed = d.text, conflict = d.status.conflict;
    // The host hangs mid-read, the person keeps typing, then it dies: what they typed lands on the kept text.
    process.kill(scratch.pid!, "SIGSTOP");
    const reload = s.act("edit.reload", {}, h, USER);
    await until(() => d.status.phase === "reloading", "the reload's read");
    s.key(char("!"), h);
    s.key({ kind: "paste", text: "kept" }, h);
    expect(d.text).toBe(typed);
    await scratch.stop(1);
    await reload;
    await until(() => !s.session?.busy, "the reload's answer", 15_000);
    expect(d.note).toContain("couldn't read");
    expect(d.note).not.toContain("loaded");
    expect(d.text).toBe(`${typed}!kept`);
    expect(d.status.conflict).toBe(conflict);
    // In the zoomed 30×12 reader too: why it wasn't saved, what to press, and that the read failed, over the typed row.
    const shown = s.render(28, 7, h).lines.map(visible).join("").replace(/[\s│]+/g, "");
    expect(shown).toContain("!notsaved");
    expect(shown).toContain("^R");
    expect(shown).toContain("couldn't");
    expect(shown).toContain("now");
  }, 40_000);
});
