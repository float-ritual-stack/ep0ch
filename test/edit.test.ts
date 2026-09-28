// EPD-001: editing from a reader. The draft model and key decoding run anywhere; the save and
// conflict tests start a throwaway outliner service (never a real outline) and skip without one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { Draft } from "../src/edit";
import { MainMenu } from "../src/screens";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import { Term, type Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const type = (t: { key(k: Key, d?: any): unknown }, s: string, d?: unknown) => { for (const c of s) t.key(char(c), d); };
const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};

describe("draft", () => {
  test("keeps the whole text, subject and properties included", () => {
    const d = new Draft("b1", 4, "Title [stage::queued]\nbody");
    expect(d.text).toBe("Title [stage::queued]\nbody");
    expect(d.dirty).toBe(false);
    type(d, " more");                                   // the cursor starts at the end of the subject line
    expect(d.text).toBe("Title [stage::queued] more\nbody");
    expect(d.dirty).toBe(true);
  });
  test("splits and joins lines, deletes forward, keeps surrogate pairs whole", () => {
    const d = new Draft("b1", 1, "ab");
    d.key({ kind: "left" }); d.key({ kind: "enter" });
    expect(d.lines).toEqual(["a", "b"]);
    d.key({ kind: "backspace" });
    expect(d.lines).toEqual(["ab"]);
    d.key({ kind: "home" }); d.key({ kind: "delete" });
    expect(d.text).toBe("b");
    d.key({ kind: "end" }); type(d, "🙂"); d.key({ kind: "backspace" });
    expect(d.text).toBe("b");
  });
  test("esc closes a clean draft at once and asks twice for a dirty one", () => {
    expect(new Draft("b1", 1, "x").key({ kind: "esc" })).toBe("close");
    const d = new Draft("b1", 1, "x");
    type(d, "y");
    expect(d.key({ kind: "esc" })).toBe("keep");
    expect(d.note).toContain("esc again discards");
    expect(d.key({ kind: "esc" })).toBe("close");
  });
  test("ctrl keys name the actions and never insert text", () => {
    const d = new Draft("b1", 1, "x");
    expect([d.key(ctrl("s")), d.key(ctrl("e")), d.key(ctrl("r"))]).toEqual(["save", "editor", "reload"]);
    expect(d.text).toBe("x");
  });
});

describe("key decoding", () => {
  const feed = (chunks: Uint8Array[]) => {
    const t = new Term(), keys: Key[] = [];
    t.onKey(k => keys.push(k));
    const dec = new TextDecoder("utf-8");
    for (const c of chunks) (t as any).feed(dec.decode(c, { stream: true }));
    return keys;
  };
  test("UTF-8 typed text arrives as characters, even split across reads", () => {
    const bytes = new TextEncoder().encode("é🙂");
    const keys = feed([bytes.slice(0, 1), bytes.slice(1, 4), bytes.slice(4)]);
    expect(keys).toEqual([char("é"), char("🙂")]);
  });
  test("Delete is its own key", () => {
    expect(feed([new TextEncoder().encode("\x1b[3~")])).toEqual([{ kind: "delete" }]);
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../pi-herdr-outliner")]
  .find(p => p && existsSync(join(p, "src/server-main.ts")));

describe.skipIf(!outliner)("editing against a scratch outline", () => {
  let root = "", proc: Subprocess | null = null, board: SocketBoard, other: SocketBoard;
  const flashes: string[] = [];
  const desk = () => ({
    ctx: { board, flash: (m: string) => flashes.push(m), redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    current: null, setCurrent() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi;
  const create = (text: string) => board.request("create", { parentId: null, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const openReader = async (id: string) => {
    const pane = new ReaderPane(), d = desk();
    pane.show(await board.get(id), d);
    pane.key(char("e"), d);
    await until(() => pane.editing, "the draft to open");
    return { pane, d };
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "ep0ch-edit-test-"));
    for (const d of ["ws", "state", "config", "door"]) mkdirSync(join(root, d));
    process.env.EP0CH_STATE = join(root, "door");       // refused drafts are copied here, not into real state
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      OUTLINER_STATE_DIR: join(root, "state"), OUTLINER_WORKSPACE_ROOT: join(root, "ws"), XDG_CONFIG_HOME: join(root, "config"),
      OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0",
    };
    for (const k of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID"]) delete env[k];
    proc = Bun.spawn(["bun", "src/server-main.ts"], { cwd: outliner, env, stdout: "ignore", stderr: "ignore" });
    let sock = "";
    await until(() => {
      const dirs = existsSync(join(root, "state")) ? readdirSync(join(root, "state")) : [];
      sock = dirs.map(d => join(root, "state", d, "outliner.sock")).find(existsSync) ?? "";
      return !!sock;
    }, "the scratch service socket", 15_000);
    board = new SocketBoard(sock);
    other = new SocketBoard(sock);
    const info = await board.info();
    expect(info.workspace).toBe(join(root, "ws"));      // it really is the scratch outline
  }, 20_000);

  afterAll(() => {
    board?.close(); other?.close(); proc?.kill();
    delete process.env.EP0CH_STATE;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("e, type, ctrl+s: the service has the new text at the next revision, attributed to the door", async () => {
    const b = await create("Card [stage::queued]\nold body");
    const { pane, d } = await openReader(b.id);
    pane.key({ kind: "down" }, d); pane.key({ kind: "end" }, d); type(pane, ", then more", d);
    pane.key(ctrl("s"), d);
    await until(() => !pane.editing, "the save");
    const now = await current(b.id);
    expect(now.text).toBe("Card [stage::queued]\nold body, then more");
    expect(now.properties).toEqual([{ key: "stage", value: "queued" }]);
    expect(now.revision).toBe(b.revision + 1);
    expect(pane.msg?.revision).toBe(now.revision);
    expect(flashes.at(-1)).toBe(`saved · revision ${now.revision}`);
    const log = await other.request("activity.recent", { author: "user", limit: 20 });
    expect(log.entries.find((e: any) => e.block.id === b.id)?.actorId).toBe("ep0ch-door");
  });

  test("a save that turns a property into plain text says so", async () => {
    // Found in a real terminal: typing after `[stage::queued]` on the subject line makes the service
    // read it as text, and the card silently left its lane.
    const b = await create("Card [stage::queued]\nbody");
    const { pane, d } = await openReader(b.id);
    type(pane, " (retry)", d);
    pane.key(ctrl("s"), d);
    await until(() => !pane.editing, "the save");
    expect((await current(b.id)).properties).toEqual([]);
    expect(flashes.at(-1)).toBe(`saved · revision ${b.revision + 1} · properties changed: -stage=queued`);
    expect(pane.render(80, 20).lines.some(l => l.includes("properties changed: -stage=queued"))).toBe(true);
  });

  test("a conflicting write is refused: the other writer's text stays, the draft stays and is copied out", async () => {
    const b = await create("Race [stage::queued]\nbody");
    const { pane, d } = await openReader(b.id);
    type(pane, " mine", d);
    // Someone else saves first.
    await other.request("update", { blockId: b.id, text: "Race [stage::queued]\ntheirs", expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
    // The content event makes readers refresh; an open draft must not be replaced.
    pane.refresh((await board.get(b.id))!);
    expect(pane.draft!.changedElsewhere).toBe(true);
    expect(pane.draft!.text).toBe("Race [stage::queued] mine\nbody");

    pane.key(ctrl("s"), d);
    await until(() => pane.draft?.conflict !== null, "the refusal");
    expect(pane.editing).toBe(true);
    expect(pane.draft!.text).toBe("Race [stage::queued] mine\nbody");
    expect((await current(b.id)).text).toBe("Race [stage::queued]\ntheirs");
    expect(readFileSync(pane.draft!.savedCopy!, "utf8")).toBe("Race [stage::queued] mine\nbody\n");

    // Saving again from the same stale base is refused again, never forced through.
    pane.key(ctrl("s"), d);
    await Bun.sleep(300);
    expect((await current(b.id)).text).toBe("Race [stage::queued]\ntheirs");

    // ctrl+r starts over from the current text and revision; a save then goes through.
    pane.key(ctrl("r"), d);
    await until(() => pane.draft?.text === "Race [stage::queued]\ntheirs", "the reload");
    pane.key({ kind: "down" }, d); pane.key({ kind: "end" }, d); type(pane, " + mine", d);
    pane.key(ctrl("s"), d);
    await until(() => !pane.editing, "the second save");
    expect((await current(b.id)).text).toBe("Race [stage::queued]\ntheirs + mine");
  });

  test("a reader showing another note does not jump while its draft is open", async () => {
    const a = await create("Stay [stage::queued]\nhere");
    const elsewhere = await board.get((await create("Elsewhere\n")).id);
    const { pane, d } = await openReader(a.id);
    pane.show(elsewhere, d);
    expect(pane.msg?.id).toBe(a.id);
    pane.key({ kind: "esc" }, d);                       // clean draft: closes at once
    pane.show(elsewhere, d);
    expect(pane.msg?.id).toBe(elsewhere!.id);
  });

  test("in the app: clicks can't pull focus off an edit, and leaving asks twice and keeps the draft", async () => {
    const b = await create("Guarded [stage::queued]\nbody");
    let key: (k: Key) => void = () => {};
    const term = { info: { cols: 160, rows: 45, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    const desk = new Desk();
    app.push(new MainMenu()); app.push(desk);
    desk.openBlock((await board.get(b.id))!);
    const reader = () => (desk as any).panes.get((desk as any).focus) as ReaderPane;
    await until(() => reader()?.msg?.id === b.id, "the desk reader to show the note");
    key(char("e"));
    await until(() => reader().editing, "the draft");
    const draft = reader().draft!;
    for (const c of " typed") key(char(c));
    const focusBefore = (desk as any).focus;
    key({ kind: "mouse", action: "down", button: 0, x: 1, y: 1 });      // a click on another pane
    expect((desk as any).focus).toBe(focusBefore);
    for (const k of [ctrl("w"), char("q"), char("1")]) key(k);          // window, menu and focus keys type instead
    expect(draft.text).toBe("Guarded [stage::queued] typedq1\nbody");

    app.pop();                                                          // e.g. Esc/q reaching the desk
    expect((app.describe() as any).screen).toBe(desk.title);
    expect(draft.savedCopy).toBeNull();
    app.pop();                                                          // again within 3s: leave, draft copied out
    expect((app.describe() as any).screen).not.toBe(desk.title);
    expect(readFileSync(draft.savedCopy!, "utf8")).toBe("Guarded [stage::queued] typedq1\nbody\n");
    expect((await current(b.id)).text).toBe("Guarded [stage::queued]\nbody");   // nothing was saved behind our back
    app.quit();
  });

  test("ctrl+e hands the draft to $EDITOR and saves what comes back", async () => {
    const b = await create("Via editor [stage::queued]\nbody text");
    const was = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
    delete process.env.VISUAL;
    process.env.EDITOR = "perl -pi -e 's/body text/written in the editor/'";
    try {
      const { pane, d } = await openReader(b.id);
      pane.key(ctrl("e"), d);
      expect(pane.draft!.text).toBe("Via editor [stage::queued]\nwritten in the editor");
      pane.key(ctrl("s"), d);
      await until(() => !pane.editing, "the save");
      expect((await current(b.id)).text).toBe("Via editor [stage::queued]\nwritten in the editor");
    } finally {
      if (was.VISUAL !== undefined) process.env.VISUAL = was.VISUAL;
      if (was.EDITOR !== undefined) process.env.EDITOR = was.EDITOR; else delete process.env.EDITOR;
    }
  });
});
