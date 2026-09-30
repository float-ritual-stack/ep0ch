// EPD-004: comments from a reader. Passage picking and request identity run anywhere; the write tests
// start a throwaway outliner service (never a real outline) and skip without one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { App } from "../src/app";
import { CommentSession, Outgoing, Passage } from "../src/comment";
import { Desk } from "../src/desk/desk";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { renderDoc } from "../src/doc";
import { MainMenu } from "../src/screens";
import { ACTOR_ID, Refused, SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { HERDR_VARS } from "../src/desk/pty";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const keys = (t: { key(k: Key, d?: any): unknown }, s: string, d?: unknown) => { for (const c of s) t.key(char(c), d); };
const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

const NOTE = "Launch checklist [stage::queued]\nShip the release notes before Friday.\n\nThe release notes need a review.\n- [ ] ask for a second reader";

describe("picking a passage", () => {
  test("starts on the first body line, whole, without its blanks", () => {
    const p = new Passage("Title\n  indented line  \nnext");
    expect(p.quote).toBe("indented line");
    expect(p.passage.start).toBe("Title\n  ".length);
  });
  test("j/k move by lines with text, J/K extend and shrink, and the quote is always the exact source", () => {
    const p = new Passage(NOTE);
    expect(p.quote).toBe("Ship the release notes before Friday.");
    p.key(char("j"));                                   // skips the blank line
    expect(p.quote).toBe("The release notes need a review.");
    p.key(char("K"));                                   // nothing above within the selection: unchanged
    expect(p.quote).toBe("The release notes need a review.");
    p.key(char("k")); p.key(char("J"));
    expect(p.quote).toBe("Ship the release notes before Friday.\n\nThe release notes need a review.");
    p.key(char("K"));
    expect(p.quote).toBe("Ship the release notes before Friday.");
    expect(NOTE.slice(p.passage.start, p.passage.start + p.quote.length)).toBe(p.quote);
  });
  test("h/l move the start and H/L the end by words; the second of two equal phrases keeps its own offset", () => {
    const p = new Passage(NOTE);
    p.key(char("j")); p.key(char("l"));                 // "release notes need a review."
    for (let i = 0; i < 3; i++) p.key(char("H"));       // back to the end of "notes"
    expect(p.quote).toBe("release notes");
    expect(p.passage.start).toBe(NOTE.lastIndexOf("release notes"));
    p.key(char("L"));
    expect(p.quote).toBe("release notes need");
    for (let i = 0; i < 9; i++) p.key(char("H"));       // never collapses to nothing
    expect(p.quote).toBe("release");
    p.key(char("h"));
    expect(p.quote).toBe("The release");
  });
  test("draws the selection highlighted and marks lines that carry comments", () => {
    const p = new Passage(NOTE);
    const at = NOTE.indexOf("Ship");
    const lines = p.render(60, 10, [{ id: "a", author: "user", body: "x", quote: "Ship", at: 0, open: true, start: at, end: at + 4, replies: [] }]);
    expect(plain(lines[1]!)).toBe("▐ Ship the release notes before Friday.");
    expect(lines[1]).toContain("\x1b[48;2;");         // highlighted
    expect(plain(lines[0]!).startsWith("  Launch")).toBe(true);
  });
  test("Enter on nothing doesn't open the composer", () => {
    const p = new Passage("Title only\n\n");
    expect(p.quote).toBe("Title only");
    expect(p.key({ kind: "enter" })).toBe("compose");
    expect(new Passage("").key({ kind: "enter" })).toBe("keep");
  });
});

describe("request identity", () => {
  test("the same text keeps its request id; changed text gets a new one, and says when the last one is unknown", () => {
    const o = new Outgoing();
    const a = o.begin("one");
    expect(o.begin("one")).toBe(a);
    o.unsure();
    expect(o.peek("one")).toEqual({ requestId: a, replacesUnsure: false });
    expect(o.peek("two").replacesUnsure).toBe(true);
    const b = o.begin("two");
    expect(b).not.toBe(a);
    o.refused();
    expect(o.peek("three").replacesUnsure).toBe(false);
  });
});

describe("the reader hides checklist ids", () => {
  test("a step's ^task id isn't shown", () => {
    const doc = renderDoc("- [ ] ask for a second reader ^task-c1a0d412-fa9f-461c-80c4-eb95ddf68a2a", { width: 60, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false });
    expect(plain(doc.lines.join("\n"))).not.toContain("task-");
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../pi-herdr-outliner")]
  .find(p => p && existsSync(join(p, "src/server-main.ts")));

describe.skipIf(!outliner)("commenting against a scratch outline", () => {
  let root = "", proc: Subprocess | null = null, board: SocketBoard, other: SocketBoard;
  const flashes: string[] = [];
  // Every redraw really renders the pane, so a state the screen can't draw fails the test.
  const desk = (pane?: ReaderPane) => {
    const d = {
      ctx: { board, flash: (m: string) => { flashes.push(m); d.redraw(); }, redraw: () => d.redraw(), suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
      current: null, setCurrent() {}, focusKind() {}, redraw: () => { pane?.render(80, 30, true, d as unknown as DeskApi); },
    };
    return d as unknown as DeskApi;
  };
  const create = (text: string) => board.request("create", { parentId: null, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const threads = (id: string) => other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: id }, includeResolved: true } });
  const open = async (id: string, key: "C" | "m" = "C") => {
    const pane = new ReaderPane(), d = desk(pane);
    pane.show(await board.get(id), d);
    pane.key(char(key), d);
    await until(() => !!pane.session, "the comment session");
    return { pane, d };
  };
  const idle = (pane: ReaderPane) => until(() => !pane.session?.busy, "the send to finish");

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "ep0ch-comment-test-"));
    for (const d of ["ws", "state", "config", "door"]) mkdirSync(join(root, d));
    process.env.EP0CH_STATE = join(root, "door");       // unsent comments are copied here, not into real state
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

  test("C, pick, write, ctrl+s: a block comment anchored on the exact passage, shown in the reader", async () => {
    const b = await create(NOTE);
    const { pane, d } = await open(b.id);
    expect(pane.session!.mode).toBe("select");
    pane.key(char("j"), d); pane.key(char("l"), d);
    for (let i = 0; i < 3; i++) pane.key(char("H"), d);
    expect(pane.session!.passage!.quote).toBe("release notes");
    pane.key({ kind: "enter" }, d);
    expect(pane.session!.mode).toBe("compose");
    keys(pane, "Who reviews these?", d);
    pane.key(ctrl("s"), d);
    await until(() => pane.session?.mode === "threads", "the comment to land");

    const list = await threads(b.id);
    expect(list).toHaveLength(1);
    const anchor = list[0].originalTarget.anchor;
    expect(anchor).toMatchObject({ kind: "text-quote", exact: "release notes", start: NOTE.lastIndexOf("release notes") });
    expect(list[0].body).toBe("Who reviews these?");
    expect(list[0].block.author).toBe("user");
    expect(flashes.at(-1)).toBe("comment added");
    expect((await current(b.id)).text).toBe(NOTE);      // commenting didn't touch the note's text

    // The thread list shows it; Esc back to the reader shows the count.
    expect(plain(pane.render(80, 30, true, d).lines.join("\n"))).toContain('"release notes"');
    pane.key({ kind: "esc" }, d);
    expect(pane.session).toBeNull();
    expect(plain(pane.render(80, 30, true, d).lines[1]!)).toContain("1 open comment (m)");
  });

  test("m, r: a reply lands on the thread; x resolves and x again reopens", async () => {
    const b = await create(NOTE);
    await board.comment(`seed-${b.id}`, b.id, b.revision, "Seeded comment", { quote: "Ship", start: NOTE.indexOf("Ship") });
    const { pane, d } = await open(b.id, "m");
    expect(pane.session!.threads).toHaveLength(1);
    pane.key(char("r"), d);
    expect(pane.session!.mode).toBe("compose");
    keys(pane, "Me, on Thursday.", d);
    pane.key(ctrl("s"), d);
    await until(() => pane.session?.mode === "threads", "the reply to land");
    let list = await threads(b.id);
    expect(list[0].replies.map((r: any) => r.body)).toEqual(["Me, on Thursday."]);

    pane.key(char("x"), d);
    await idle(pane);
    await until(() => pane.session!.threads[0]?.open === false, "the thread to show resolved");
    list = await threads(b.id);
    expect(list[0].lifecycle).toBe("resolved");
    const log = await other.request("activity.recent", { author: "user", limit: 20 });
    expect(log.entries.find((e: any) => e.block.id === list[0].block.id)?.actorId).toBe(ACTOR_ID);

    pane.key(char("x"), d);
    await idle(pane);
    await until(() => pane.session!.threads[0]?.open === true, "the thread to show open");
    expect((await threads(b.id))[0].lifecycle).toBe("open");
  });

  test("a send whose answer is lost is retried with the same request id and lands once", async () => {
    const b = await create(NOTE);
    const ids: string[] = [];
    const real = board.request.bind(board);
    let lose = 1;
    (board as any).request = async (action: string, params: any) => {
      if (action === "annotations.batch") ids.push(params.requestId);
      const r = await real(action, params);
      if (action === "annotations.batch" && lose-- > 0) throw new Error("annotations.batch timed out");   // it landed; the answer didn't
      return r;
    };
    try {
      const { pane, d } = await open(b.id);
      pane.key({ kind: "enter" }, d);
      keys(pane, "Once only.", d);
      pane.key(ctrl("s"), d);
      await idle(pane);
      expect(pane.session!.mode).toBe("compose");                    // kept: we don't know it landed
      expect(pane.session!.error).toContain("same request id");
      expect(await threads(b.id)).toHaveLength(1);                   // it did land

      pane.key(ctrl("s"), d);
      await until(() => pane.session?.mode === "threads", "the retry");
      expect(ids).toHaveLength(2);
      expect(ids[1]).toBe(ids[0]!);
      expect(await threads(b.id)).toHaveLength(1);                   // not twice
      expect(flashes.at(-1)).toContain("already saved");
      expect(pane.session!.threads).toHaveLength(1);
    } finally {
      (board as any).request = real;
    }
  });

  test("after a lost answer, changing the text asks before sending what would be a second comment", async () => {
    const b = await create(NOTE);
    const real = board.request.bind(board);
    let lose = 1, sent = 0;
    (board as any).request = async (action: string, params: any) => {
      if (action === "annotations.batch") sent++;
      const r = await real(action, params);
      if (action === "annotations.batch" && lose-- > 0) throw new Error("outline socket closed");
      return r;
    };
    try {
      const { pane, d } = await open(b.id);
      pane.key({ kind: "enter" }, d);
      keys(pane, "First words", d);
      pane.key(ctrl("s"), d);
      await idle(pane);
      keys(pane, ", changed", d);
      pane.key(ctrl("s"), d);
      expect(sent).toBe(1);                                          // held back
      expect(pane.session!.error).toContain("second comment");
      pane.key(ctrl("s"), d);
      await until(() => pane.session?.mode === "threads", "the confirmed send");
      expect(sent).toBe(2);
      expect((await threads(b.id)).map((t: any) => t.body).sort()).toEqual(["First words", "First words, changed"]);
    } finally {
      (board as any).request = real;
    }
  });

  test("a stale revision is refused with a clear message and no write; ctrl+r finds the quote and sends", async () => {
    const b = await create(NOTE);
    const { pane, d } = await open(b.id);
    pane.key({ kind: "enter" }, d);                                   // "Ship the release notes before Friday."
    keys(pane, "Friday is tight.", d);
    // Someone else edits the note first, moving the passage.
    await other.request("update", { blockId: b.id, text: NOTE.replace("\nShip", "\nNew first line.\nShip"), expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
    pane.key(ctrl("s"), d);
    await idle(pane);
    expect(pane.session!.mode).toBe("compose");
    expect(pane.session!.error).toBe("the note changed since you picked the passage · not sent · ctrl+r finds the quote in the current text");
    expect(pane.session!.composer!.text).toBe("Friday is tight.");
    expect(await threads(b.id)).toHaveLength(0);

    pane.key(ctrl("r"), d);
    await until(() => pane.session?.error === null && pane.session.note.startsWith("found the quote again"), "the quote to be found again");
    pane.key(ctrl("s"), d);
    await until(() => pane.session?.mode === "threads", "the send");
    const list = await threads(b.id);
    const now = (await current(b.id)).text as string;
    expect(list[0].originalTarget.anchor.start).toBe(now.indexOf("Ship the release notes"));
    expect(list[0].originalTarget.anchor.exact).toBe("Ship the release notes before Friday.");
  });

  test("when the quoted words are gone, ctrl+r goes back to picking and the comment text comes along", async () => {
    const b = await create(NOTE);
    const { pane, d } = await open(b.id);
    pane.key({ kind: "enter" }, d);
    keys(pane, "Keep me.", d);
    await other.request("update", { blockId: b.id, text: NOTE.replace("Ship the release notes before Friday.", "Ship it Monday."), expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
    pane.key(ctrl("s"), d);
    await idle(pane);
    pane.key(ctrl("r"), d);
    await until(() => pane.session?.mode === "select", "picking again");
    expect(pane.session!.passage!.note).toContain("the quote is gone");
    expect(pane.session!.passage!.quote).toBe("Ship it Monday.");
    pane.key({ kind: "enter" }, d);
    expect(pane.session!.composer!.text).toBe("Keep me.");
    pane.key(ctrl("s"), d);
    await until(() => pane.session?.mode === "threads", "the send");
    expect((await threads(b.id))[0].originalTarget.anchor.exact).toBe("Ship it Monday.");
  });

  test("a quote that isn't in the note is refused by the service, and nothing is written", async () => {
    const b = await create(NOTE);
    const err = await board.comment("nomatch-" + b.id, b.id, b.revision, "x", { quote: "not in this note", start: 0 }).catch(e => e);
    expect(err).toBeInstanceOf(Refused);
    expect(err.message).toContain("was not found");
    const wrongPlace = await board.comment("wrongplace-" + b.id, b.id, b.revision, "x", { quote: "release notes", start: 3 }).catch(e => e);
    expect(wrongPlace).toBeInstanceOf(Refused);
    expect(await threads(b.id)).toHaveLength(0);
    expect((await current(b.id)).revision).toBe(b.revision);
  });

  test("the composer keeps its text: esc asks twice, keys stay in it, the reader stays on its note", async () => {
    const b = await create(NOTE);
    const elsewhere = await board.get((await create("Elsewhere\n")).id);
    const { pane, d } = await open(b.id);
    pane.key({ kind: "enter" }, d);
    keys(pane, "Draft", d);
    for (const c of "xtq") pane.key(char(c), d);                     // board and window shortcuts type instead
    expect(pane.session!.composer!.text).toBe("Draftxtq");
    expect(pane.unsaved()).toBe(true);
    pane.key({ kind: "esc" }, d);
    expect(pane.session!.mode).toBe("compose");
    expect(pane.session!.composer!.note).toContain("esc again puts it aside");
    pane.show(elsewhere, d);
    expect(pane.msg?.id).toBe(b.id);
    const [copy] = pane.keepDrafts();
    expect(readFileSync(copy!, "utf8")).toBe("Draftxtq\n");
    pane.key({ kind: "esc" }, d);                                     // second esc discards, back to picking
    expect(pane.session!.mode).toBe("select");
    expect(pane.unsaved()).toBe(false);
    expect(await threads(b.id)).toHaveLength(0);
  });

  test("in the app: ctrl+c with an unsent comment asks twice", async () => {
    const b = await create(NOTE);
    let key: (k: Key) => void = () => {};
    let quit = 0;
    const term = { info: { cols: 160, rows: 45, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => { quit++; });
    const desk = new Desk();
    app.push(new MainMenu()); app.push(desk);
    desk.openBlock((await board.get(b.id))!);
    desk.focusOn("reader");                                             // `open` (an agent's) never moves the person's keys
    const reader = () => (desk as any).panes.get((desk as any).focus) as ReaderPane;
    await until(() => reader()?.msg?.id === b.id, "the desk reader to show the note");
    key(char("C"));
    await until(() => !!reader().session, "the comment session");
    key({ kind: "enter" });
    for (const c of "unsent") key(char(c));
    key(ctrl("c"));
    expect(quit).toBe(0);
    expect((app.describe() as any).screen).toBe(desk.title);
    expect(reader().session!.composer!.text).toBe("unsent");
    app.quit();
  });
});

describe("long comments in the thread list", () => {
  const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of a long ramble about the garden shed`).join("\n");
  const thread = (id: string, body: string) => ({ id, author: "user", body, quote: "", at: Date.now(), open: true, start: null, end: null, replies: [] });
  const msg = { id: "note-1", title: "Garden", text: "Garden\nbeans", revision: 1 } as any;

  test("the selected thread shows whole, another says how much more it has, and the wheel scrolls to the end", () => {
    const s = new CommentSession(msg, [thread("a", "short one"), thread("b", long)], "threads");
    let out = s.render(80, 20, "Garden").map(plain);
    expect(out.some(l => l.includes("line 4 of"))).toBe(true);
    expect(out.some(l => l.includes("line 5 of"))).toBe(false);
    expect(out.some(l => l.includes("… 26 more lines"))).toBe(true);
    s.key({ kind: "down" }, {} as any);
    out = s.render(80, 20, "Garden").map(plain);
    expect(out.some(l => l.includes("more lines"))).toBe(false);
    for (let i = 0; i < 12; i++) s.wheel(1);
    out = s.render(80, 20, "Garden").map(plain);
    expect(out.some(l => l.includes("line 30 of"))).toBe(true);
    s.key({ kind: "pgup" }, {} as any);
    expect(s.render(80, 20, "Garden").map(plain).some(l => l.includes("line 30 of"))).toBe(false);
  });
});
