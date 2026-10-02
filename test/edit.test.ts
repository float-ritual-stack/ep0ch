// EPD-001: editing from a reader. The draft model and key decoding run anywhere; the save and
// conflict tests start a throwaway outliner service (never a real outline) and skip without one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { Draft, DRAFT_DAYS, DRAFT_KEEP, pruneDrafts } from "../src/edit";
import { MainMenu } from "../src/screens";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { ACTOR_ID, EditConflict, Refused, SocketBoard } from "../src/socket";
import { Term, type Key } from "../src/term";
import { HERDR_VARS } from "../src/desk/pty";

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
    expect(d.note).toContain("esc again puts it aside");
    expect(d.key({ kind: "esc" })).toBe("discard");
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

// ── review follow-ups (PR #2): conflicts by revision, pruned copies, per-machine actor ──

describe("attribution", () => {
  test("door edits carry a per-machine actor id, so activity tells machines apart", () => expect(ACTOR_ID).toMatch(/^ep0ch-door:.+/));
});

describe("draft copies are pruned", () => {
  test(`keeps the newest ${DRAFT_KEEP} and anything younger than ${DRAFT_DAYS} days, and always the new one`, () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-drafts-"));
    const now = Date.now(), day = 86_400_000;
    const make = (name: string, age: number) => { const p = join(dir, name); writeFileSync(p, "x"); utimesSync(p, (now - age) / 1000, (now - age) / 1000); return p; };
    for (let i = 0; i < DRAFT_KEEP + 5; i++) make(`young-${i}.md`, i * 60_000);            // 55 recent: all kept (under 30 days)
    for (let i = 0; i < 5; i++) make(`old-${i}.md`, (DRAFT_DAYS + 1 + i) * day);          // old and past the newest 50: pruned
    const fresh = make("fresh.md", (DRAFT_DAYS + 9) * day);                                // the copy just written, even if its clock is off
    const removed = pruneDrafts(dir, fresh, now);
    expect(removed.map(p => p.split("/").pop()).sort()).toEqual(["old-0.md", "old-1.md", "old-2.md", "old-3.md", "old-4.md"]);
    expect(readdirSync(dir).length).toBe(DRAFT_KEEP + 5 + 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("conflicts are read, not just worded", () => {
  // A board whose service answers `update` with whatever the test says, and reports the block at a set revision.
  const stub = (answer: () => unknown, current: { revision: number; text: string }) => {
    const b = new SocketBoard("/nonexistent");
    (b as any).request = async (action: string) => {
      if (action === "update" || action === "properties.patch") { const a = answer(); if (a instanceof Error) throw a; return a; }
      if (action === "blocks.context") return { selected: { id: "n1", parentId: null, text: current.text, revision: current.revision, author: "user", createdAt: "", updatedAt: "", properties: [] }, children: [] };
      throw new Error(`unexpected ${action}`);
    };
    return b;
  };
  test("a refusal in other words is still a conflict when the revision moved", async () => {
    const b = stub(() => new Refused("Revision mismatch for n1"), { revision: 5, text: "theirs" });
    expect(await b.update("n1", "mine", 4).catch(e => e)).toBeInstanceOf(EditConflict);
    expect(await b.patchProperties("n1", 4, []).catch(e => e)).toBeInstanceOf(EditConflict);
  });
  test("a refusal with the revision unchanged is not a conflict, and says why", async () => {
    const e = await stub(() => new Refused("text too long"), { revision: 4, text: "old" }).update("n1", "mine", 4).catch(x => x);
    expect(e).toBeInstanceOf(Refused);
    expect(e.message).toBe("text too long");
  });
  test("a lost answer after the save landed is a save, not a conflict", async () => {
    const m = await stub(() => new Error("update timed out"), { revision: 5, text: "mine" }).update("n1", "mine", 4);
    expect([m.revision, m.text]).toEqual([5, "mine"]);
    // A lost answer on a property patch can't be told from someone else's write: not called a conflict.
    const e = await stub(() => new Error("properties.patch timed out"), { revision: 5, text: "mine" }).patchProperties("n1", 4, []).catch(x => x);
    expect(e).not.toBeInstanceOf(EditConflict);
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
    for (const k of HERDR_VARS) delete env[k];
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
    expect(log.entries.find((e: any) => e.block.id === b.id)?.actorId).toBe(ACTOR_ID);
  });

  test("a save that turns a property into plain text says so", async () => {
    // Found in a real terminal: typing after `[stage::queued]` on the subject line makes the service
    // read it as text, and the card silently left its lane.
    const b = await create("Card [stage::queued]\nbody");
    const { pane, d } = await openReader(b.id);
    type(pane, " (retry)", d);
    pane.key(ctrl("s"), d);
    if (await board.previewProperties("probe [a::b]") !== null) {
      // A service with properties.preview (PIE-401) lets the door warn before writing anything.
      await until(() => pane.draft?.propertyWarned !== null, "the warning");
      expect(pane.editing).toBe(true);
      expect(pane.draft!.note).toBe("this save changes properties: -stage=queued · ctrl+s again saves");
      expect((await current(b.id)).revision).toBe(b.revision);
      pane.key(ctrl("s"), d);                                // same text again: go ahead
    }
    await until(() => !pane.editing, "the save");
    expect((await current(b.id)).properties).toEqual([]);
    expect(flashes.at(-1)).toBe(`saved · revision ${b.revision + 1} · properties changed: -stage=queued`);
    expect(pane.render(80, 20).lines.some(l => l.includes("properties changed: -stage=queued"))).toBe(true);
  });

  test("a conflicting write is refused: the other writer's text stays, the draft stays and is copied out", async () => {
    const b = await create("Race [stage::queued]\nbody");
    const { pane, d } = await openReader(b.id);
    pane.key({ kind: "down" }, d); pane.key({ kind: "end" }, d); type(pane, " mine", d);
    // Someone else saves first.
    await other.request("update", { blockId: b.id, text: "Race [stage::queued]\ntheirs", expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
    // The content event makes readers refresh; an open draft must not be replaced.
    pane.refresh((await board.get(b.id))!);
    expect(pane.draft!.changedElsewhere).toBe(true);
    expect(pane.draft!.text).toBe("Race [stage::queued]\nbody mine");

    pane.key(ctrl("s"), d);
    await until(() => pane.draft?.conflict !== null, "the refusal");
    expect(pane.editing).toBe(true);
    expect(pane.draft!.text).toBe("Race [stage::queued]\nbody mine");
    expect((await current(b.id)).text).toBe("Race [stage::queued]\ntheirs");
    expect(readFileSync(pane.draft!.savedCopy!, "utf8")).toBe("Race [stage::queued]\nbody mine\n");

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

  test("in the app: keys stay in an edit (^W esc too), and leaving the desk asks twice and keeps the draft", async () => {
    const b = await create("Guarded [stage::queued]\nbody");
    let key: (k: Key) => void = () => {};
    const term = { info: { cols: 160, rows: 45, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    const desk = new Desk();
    app.push(new MainMenu()); app.push(desk);
    desk.openBlock((await board.get(b.id))!);
    desk.focusOn("reader");                                             // `open` (an agent's) never moves the person's keys
    const reader = () => (desk as any).panes.get((desk as any).focus) as ReaderPane;
    await until(() => reader()?.msg?.id === b.id, "the desk reader to show the note");
    key(char("e"));
    await until(() => reader().editing, "the draft");
    const draft = reader().draft!;
    for (const c of " typed") key(char(c));
    for (const k of [char("q"), char("1")]) key(k);                     // menu and focus keys type
    expect(draft.text).toBe("Guarded [stage::queued] typedq1\nbody");
    const focusBefore = (desk as any).focus;
    key({ kind: "tab" });                                               // tab indents (PIE-496), focus stays
    expect([(desk as any).focus, draft.text]).toEqual([focusBefore, "  Guarded [stage::queued] typedq1\nbody"]);
    key({ kind: "backtab" });
    expect(draft.text).toBe("Guarded [stage::queued] typedq1\nbody");
    key(ctrl("w")); key({ kind: "esc" });                               // ^W then esc: still in the edit
    expect(reader().draft).toBe(draft);
    key(char("!"));
    expect(draft.text).toBe("Guarded [stage::queued] typedq1!\nbody");

    app.pop();                                                          // e.g. Esc/q reaching the desk
    expect((app.describe() as any).screen).toBe(desk.title);
    expect(draft.savedCopy).toBeNull();
    app.pop();                                                          // again within 3s: leave, draft copied out
    expect((app.describe() as any).screen).not.toBe(desk.title);
    expect(readFileSync(draft.savedCopy!, "utf8")).toBe("Guarded [stage::queued] typedq1!\nbody\n");
    expect((await current(b.id)).text).toBe("Guarded [stage::queued]\nbody");   // nothing was saved behind our back
    app.quit();
  });

  test("SIGTERM/SIGHUP (app.terminate): every screen's unsaved draft is copied out, without asking, then the door quits", async () => {
    const b = await create("Signalled [stage::queued]\nbody");
    let quit = 0;
    const term = { info: { cols: 160, rows: 45, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => { quit++; });
    const desk = new Desk();
    app.push(new MainMenu()); app.push(desk);
    desk.openBlock((await board.get(b.id))!);
    desk.focusOn("reader");                                             // `open` (an agent's) never moves the person's keys
    const reader = () => (desk as any).panes.get((desk as any).focus) as ReaderPane;
    await until(() => reader()?.msg?.id === b.id, "the desk reader to show the note");
    const d = desk as unknown as DeskApi;
    reader().key(char("e"), d);
    await until(() => reader().editing, "the draft");
    const draft = reader().draft!;
    for (const c of " typed") reader().key(char(c), d);
    app.push(new MainMenu());                                           // the desk is no longer on top
    const kept = app.terminate();
    expect(quit).toBe(1);
    expect(kept).toEqual([draft.savedCopy!]);
    expect(readFileSync(draft.savedCopy!, "utf8")).toBe("Signalled [stage::queued] typed\nbody\n");
    expect((await current(b.id)).text).toBe("Signalled [stage::queued]\nbody");   // copied, not saved
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
