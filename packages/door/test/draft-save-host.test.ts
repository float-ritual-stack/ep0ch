// A save with the host stopped (PIE-1613): a real SIGSTOP, what a fake can't be. ctrl+s, keep typing, the host answers late.
// The rule is the session's (draft-save-hold.test.ts); this says it holds through a reader's whole key path against a host
// that hangs mid-write. A scratch service, never a real outline; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unsent } from "../src/draft-session";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("ctrl+s against a stopped host", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard;
  const flashes: string[] = [];
  const host = (): SurfaceHost => ({ ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    other = new SocketBoard(scratch.sock);
    await other.info();
  });
  afterAll(async () => { process.kill(scratch.pid!, "SIGCONT"); board?.close(); other?.close(); await scratch.dispose(); });

  async function editing(title: string) {
    const id = (await board.request("create", { parentId: null, text: `${title}\nThe plot by the shed.`, author: "user" })).id as string;
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    await s.runKey("edit", {}, h);
    await until(() => !!s.draft, "the edit");
    const d = s.draft!;
    d.place(1, 8);
    s.key(char("!"), h);
    return { id, s, h, d };
  }
  /** ctrl+s with the host stopped: the write is out and nothing answers. */
  async function saveStopped(s: NoteSurface, h: SurfaceHost) {
    process.kill(scratch.pid!, "SIGSTOP");
    s.key(ctrl("s"), h);
    await until(() => !!s.draft?.busy, "the save");
    await Bun.sleep(100);
  }

  test("a stale refusal keeps the word typed after ctrl+s where it was typed; a command waits to be pressed again", async () => {
    const { id, s, h, d } = await editing("Stale under a stop");
    const m = (await other.get(id))!;
    await other.update(id, `${m.text}\nA line from elsewhere.`, m.revision!);
    await saveStopped(s, h);
    const typed = d.text;
    for (const c of "deep") s.key(char(c), h);
    s.key({ kind: "esc" }, h);
    s.key(char("!"), h);
    expect(d.text).toBe(typed);
    expect(d.note).toContain("press esc again once it has saved");
    process.kill(scratch.pid!, "SIGCONT");
    await until(() => !d.busy && d.status.conflict !== null, "the stale refusal", 15_000);
    expect(s.draft).toBe(d);
    expect(d.text).toBe("Stale under a stop\nThe plot!deep! by the shed.");
    expect(d.note).toStartWith("esc didn't run: press it again · your draft is kept and copied to");
    expect(await Bun.file(d.status.savedCopy!).text()).toBe(`${d.text}\n`);
  }, 40_000);

  test("a save that lands: the edit closes, the note has what was saved, the extra text is kept and said", async () => {
    const { id, s, h } = await editing("Written under a stop");
    await saveStopped(s, h);
    for (const c of " soon") s.key(char(c), h);
    process.kill(scratch.pid!, "SIGCONT");
    await until(() => !s.draft, "the save's answer", 15_000);
    const now = (await board.get(id))!;
    expect(now.text).toBe("Written under a stop\nThe plot! by the shed.");
    const kept = unsent(`edit:${id}`)!;
    expect(kept.text).toBe("Written under a stop\nThe plot! soon by the shed.");
    expect(kept.base).toBe(now.revision!);
    expect(flashes.at(-1)).toContain("what you typed while it saved is kept · e brings it back");
    // e brings it back, on the revision it was saved at, unsaved.
    await s.runKey("edit", {}, h);
    await until(() => !!s.draft, "the edit again");
    expect(s.draft!.text).toBe(kept.text);
    expect(s.draft!.dirty).toBe(true);
  }, 40_000);
});
