// A draft's reload has one owner (PIE-1591): ctrl+r holds, replays, lands and clears the conflict the same way for every
// draft. The session's rule runs on a fake target whose read waits on a gate; each host's key path and what it draws run
// on a fake outline. Made-up notes; no service (with the host stopped: comment-reload-host.test.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Msg } from "../src/board";
import { CommentSession } from "../src/comment";
import { blockTarget, cardTarget, DraftSession, noteReplyTarget, type DraftTarget, type ReloadRead } from "../src/draft-session";
import { EditConflict, Refused, USER } from "../src/socket";
import { visible } from "../src/style";
import { composerBox } from "../src/surface/composer";
import { elementEdit } from "../src/surface/element-editor";
import { Inspector } from "../src/surface/inspector";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const until = async (ok: () => boolean, what: string) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(2); } };
const msg = (id: string, text: string, revision: number): Msg => ({ id, text, revision, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", properties: [] }) as Msg;

/** A read that answers when it's let go: what a slow or stopped host looks like to whoever asked. */
function gated<T>() {
  let open!: (v: T) => void, shut!: (e: Error) => void;
  const answer = new Promise<T>((res, rej) => { open = res; shut = rej; });
  return { answer, open, shut };
}

const stateWas = process.env.EP0CH_STATE;
let state = "";
beforeAll(() => { state = mkdtempSync(join(tmpdir(), "draft-reload-")); process.env.EP0CH_STATE = state; });
afterAll(() => { if (stateWas === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = stateWas; rmSync(state, { recursive: true, force: true }); });

let places = 0;

describe("the session owns the reload (a fake target)", () => {
  /** A draft on `text` whose target says it changed elsewhere; ctrl+r's read waits on `read`. */
  function changed(text = "Sowing\nbeans", over: Partial<DraftTarget> = {}) {
    const read = gated<ReloadRead>();
    let reads = 0;
    const target: DraftTarget = {
      place: `edit:reload-${++places}`, back: "e", label: "sowing", what: "the edit", verb: "save", leaveWrites: true,
      async submit() { return { ok: true }; },
      reload: () => { reads++; return read.answer; },
      ...over,
    };
    const s = DraftSession.open(target, { text, base: 1 });
    s.changedTo(2);
    const run: string[] = [];
    const host = { completer: null, run: (cmd: string) => { run.push(cmd); if (cmd === "reload") void s.reload(); } };
    return { s, d: s.draft, read, run, host, press: (k: Key) => s.key(k, host), reads: () => reads };
  }
  const settled = async (d: { status: { phase: unknown } }) => { await until(() => d.status.phase === null, "the read's answer"); await Bun.sleep(0); };

  test("keys and a paste during the read land, in order, after the words it loaded; the conflict clears once and the line names the copy", async () => {
    const { d, s, read, press } = changed();
    press(char("!"));
    press(ctrl("r"));
    expect(d.status.phase).toBe("reloading");
    press(char("x")); press({ kind: "paste", text: "yz" }); press(char("w"));
    const typed = "Sowing!\nbeans";
    expect(d.text).toBe(typed);
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    expect(d.text).toBe("Sowing\npeasxyzw");
    expect([d.status.conflict, d.status.changedElsewhere, d.base]).toEqual([null, false, 2]);
    expect(d.note).toContain("loaded revision 2 · your earlier draft is at");
    expect(await Bun.file(d.status.savedCopy!).text()).toBe(`${typed}\n`);
    // Nothing is out of date now: a second ctrl+r reads nothing.
    await s.reload();
    expect(d.note).toBe("nothing newer to load");
  });

  test("a key before the read answers and one after land in the same place", async () => {
    for (const before of [true, false]) {
      const { d, read, press } = changed("Sowing\nbeans\nby the fence");
      d.place(0, 2);
      press(ctrl("r"));
      if (before) press(char("x"));
      read.open({ loaded: msg("n", "Sowing\npeas\nby the gate", 2) });
      await settled(d);
      if (!before) press(char("x"));
      expect({ before, text: d.text }).toEqual({ before, text: "Sowing\npeas\nby the gatex" });
    }
  });

  test("a command during the read doesn't run: the line says to press it again, and the text after it lands", async () => {
    const { d, read, press, run } = changed();
    press(ctrl("r"));
    press(char("a"));
    press(ctrl("s"));
    expect(d.note).toBe("reloading · press ctrl+s again once it has loaded");
    press(char("b"));
    press({ kind: "esc" });
    expect(d.note).toBe("reloading · press ctrl+s, esc again once it has loaded");
    press(char("c"));
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    expect(d.text).toBe("Sowing\npeasabc");
    expect(run).toEqual(["reload"]);
    expect(d.note).toStartWith("ctrl+s, esc didn't run: press them again · ");
  });

  test("a paste of image files held through the read stays text: a replayed key runs no command, whichever path it comes back by", async () => {
    const { s, d, read, run } = changed();
    const file = join(state, "bed.png");
    await Bun.write(file, "made up");
    const host = { completer: null, run: (cmd: string) => { run.push(cmd); if (cmd === "reload") void s.reload(); }, replay: (k: Key) => s.key(k, host) };
    s.key(ctrl("r"), host);
    s.key({ kind: "paste", text: file }, host);
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    await Bun.sleep(0);
    expect(d.text).toBe(`Sowing\npeas${file}`);
    expect(run).toEqual(["reload"]);
  });

  test("a read that fails isn't a reload: the conflict stands, the text is kept, and what was typed lands on it", async () => {
    const { d, read, press } = changed();
    press(ctrl("r"));
    press(char("!"));
    read.shut(new Error("socket closed"));
    await settled(d);
    expect(d.text).toBe("Sowing!\nbeans");
    expect(d.status.changedElsewhere).toBe(true);
    expect(d.note).toBe("couldn't read it now · your text is kept · ctrl+r tries again (socket closed)");
  });

  test("nothing loaded: the conflict stands and the line says why; the text stays and its place found: it clears", async () => {
    const gone = changed();
    gone.press(ctrl("r"));
    gone.read.open({ none: "the note is gone from the outline" });
    await settled(gone.d);
    expect([gone.d.status.changedElsewhere, gone.d.note]).toEqual([true, "the note is gone from the outline"]);
    const found = changed();
    found.press(ctrl("r"));
    found.press(char("!"));
    found.read.open({ stays: "found the quote again at revision 3", revision: 3 });
    await settled(found.d);
    expect([found.d.status.changedElsewhere, found.d.text, found.d.base]).toEqual([false, "Sowing!\nbeans", 3]);
    // It stands on revision 3 now: word of it again is no news.
    found.s.changedTo(3);
    expect(found.d.status.changedElsewhere).toBe(false);
    expect(found.d.note).toBe("found the quote again at revision 3");
    expect(found.d.status.savedCopy).toBeNull();
  });

  test("nothing out of date: no read; the same line whichever draft it is", async () => {
    const { s, press, reads } = changed();
    s.status.settled();
    press(ctrl("r"));
    await Bun.sleep(0);
    expect([reads(), s.draft.note]).toEqual([0, "nothing newer to load"]);
  });

  test("a card and a note reply have nothing behind them: ctrl+r says so on the line, whoever hosts them, and no command reaches the host", async () => {
    const parent = msg("note-parent", "Beds", 1);
    const targets: DraftTarget[] = [
      cardTarget({ kind: "card", lane: "Doing", view: `view-${++places}`, create: async () => ({}) }),
      noteReplyTarget({ ...parent, id: `note-parent-${++places}` }, { newNote: async () => ({ note: parent }) } as never),
    ];
    for (const target of targets) {
      const s = DraftSession.open(target, {}), run: string[] = [];
      s.key(char("a"), { completer: null, run: c => run.push(c) });
      s.key(ctrl("r"), { completer: null, run: c => run.push(c) });
      await Bun.sleep(0);
      expect({ place: target.place, note: s.draft.note, run, text: s.draft.text }).toEqual({ place: target.place, note: "nothing to reload", run: [], text: "a" });
      s.dispose();
    }
  });

  test("a new change elsewhere retires the last reload's line: it no longer says what's true", async () => {
    const { s, d, read, press } = changed();
    press(ctrl("r"));
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    expect(d.note).toContain("loaded revision 2");
    s.changedTo(3);
    expect(d.status.changedElsewhere).toBe(true);
    expect(d.note).toBe("");
    expect(d.status.savedCopy).toBeNull();
  });

  test("it retires that line with what a held command added to it too", async () => {
    const { s, d, read, press } = changed();
    press(ctrl("r"));
    press(ctrl("s"));
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    expect(d.note).toStartWith("ctrl+s didn't run");
    s.changedTo(3);
    expect(d.note).toBe("");
  });

  test("what a replayed key said is its own: a newer change doesn't take it for the reload's line", async () => {
    const { s, d, read, press } = changed();
    press(ctrl("r"));
    press({ kind: "paste", text: Array.from({ length: 1000 }, (_, i) => `row ${i}`).join("\n") });
    read.open({ loaded: msg("n", "Sowing\npeas", 2) });
    await settled(d);
    expect(d.note).toContain("ctrl+z undoes");
    const said = d.note;
    s.changedTo(3);
    expect(d.note).toBe(said);
  });

  test("a new change elsewhere leaves anything else on the line alone", () => {
    const { s, d } = changed();
    d.status.say("esc again keeps it here");
    s.changedTo(3);
    expect(d.note).toBe("esc again keeps it here");
  });

  test("changed elsewhere is the session's: a newer revision says so; an older read arriving late, a save and a reload under way don't", async () => {
    const target: DraftTarget = { place: `edit:reload-${++places}`, back: "e", label: "x", what: "x", verb: "save", leaveWrites: true, async submit() { return { ok: true }; } };
    const s = DraftSession.open(target, { text: "x", base: 5 }), st = s.status;
    s.changedTo(4); s.changedTo(5);
    expect(st.changedElsewhere).toBe(false);
    st.phase = "saving"; s.changedTo(6);
    st.phase = "reloading"; s.changedTo(6);
    expect(st.changedElsewhere).toBe(false);
    st.phase = null; s.changedTo(6);
    expect(st.changedElsewhere).toBe(true);
    s.dispose();
  });

  describe("in a rich cell", () => {
    const TABLE = "Crops\n\n| crop | bed |\n| --- | --- |\n| one | leeks |";
    function inCell(title = "Crops") {
      const x = changed(TABLE.replace("Crops", title));
      const d = x.d;
      d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks") + 5);
      elementEdit(d).open(USER);
      return x;
    }
    const rich = (d: { views: { rich: { on: boolean } | null } }) => d.views.rich?.on;

    test("what's typed lands in the same cell, held or not", async () => {
      for (const held of [true, false]) {
        const { d, read, press } = inCell();
        press(ctrl("r"));
        if (held) for (const c of "ab") press(char(c));
        read.open({ loaded: msg("n", TABLE.replace("Crops", "Crops today"), 2) });
        await settled(d);
        if (!held) for (const c of "ab") press(char(c));
        expect({ held, line: d.lines.at(-1), rich: rich(d) }).toEqual({ held, line: "| one | leeksab |", rich: true });
      }
    });

    test("the same cell with shorter words: what's typed follows them, with no padding taken for content", async () => {
      const { d, read, press } = inCell();
      press(ctrl("r"));
      for (const c of "ab") press(char(c));
      read.open({ loaded: msg("n", TABLE.replace("leeks", "kale"), 2) });
      await settled(d);
      expect(d.lines.at(-1)).toBe("| one | kaleab |");
    });

    test("the table gone: rich edit closes and says so, what's typed gets its own line, a held delete or move touches nothing", async () => {
      const { d, read, press } = inCell();
      press(ctrl("r"));
      press({ kind: "backspace" }); press({ kind: "left" }); press(char("a")); press({ kind: "paste", text: "bc" });
      read.open({ loaded: msg("n", "Crops\n\nNo table now.", 2) });
      await settled(d);
      expect(rich(d)).toBe(false);
      expect(d.text).toBe("Crops\n\nNo table now.\nabc");
      expect(d.note).toContain("backspace, left didn't apply: the table they were for is gone");
      expect(d.note).toContain("the table is gone, so rich edit closed");
    });

    test("another table at that number: rich edit closes, nothing goes into the other table", async () => {
      const { d, read, press } = inCell();
      press(ctrl("r"));
      for (const c of "ab") press(char(c));
      read.open({ loaded: msg("n", "Crops\n\n| tool | shed |\n| --- | --- |\n| rake | two |", 2) });
      await settled(d);
      expect(rich(d)).toBe(false);
      expect(d.text).toBe("Crops\n\n| tool | shed |\n| --- | --- |\n| rake | two |\nab");
      expect(d.note).toContain("the table changed");
      expect(d.note).not.toContain("gone");
    });

    // PIE-1578: the line a reload's landing adds is pending until something is typed on it.
    test("the landing line unused: an edit of the title saves only the title's change, no trailing line", async () => {
      const m = msg("n-land", TABLE, 1);
      const writes: string[] = [];
      const board = { update: async (_id: string, text: string) => { writes.push(text); return { ...m, text, revision: 3 }; }, previewPropertyList: async () => [], get: async () => msg("n-land", "Crops\n\nNo table now.", 2) };
      const s = DraftSession.open(blockTarget(m, { board: board as never }), { text: m.text, base: 1 });
      const d = s.draft, host = { completer: null, run: (cmd: string) => { if (cmd === "reload") void s.reload(); } };
      d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks") + 5);
      elementEdit(d).open(USER);
      s.changedTo(2);
      s.key(ctrl("r"), host);
      await settled(d);
      expect(d.note).toContain("the table is gone");
      expect(d.dirty).toBe(false);
      d.place(0, 5);
      s.key(char("!"), host);
      expect((await s.submit()).ok).toBe(true);
      expect(writes).toEqual(["Crops!\n\nNo table now."]);
    });

    test("the landing line used: what's typed on it is saved on its own line", async () => {
      const m = msg("n-land2", TABLE, 1);
      const writes: string[] = [];
      const board = { update: async (_id: string, text: string) => { writes.push(text); return { ...m, text, revision: 3 }; }, previewPropertyList: async () => [], get: async () => msg("n-land2", "Crops\n\nNo table now.", 2) };
      const s = DraftSession.open(blockTarget(m, { board: board as never }), { text: m.text, base: 1 });
      const d = s.draft, host = { completer: null, run: (cmd: string) => { if (cmd === "reload") void s.reload(); } };
      d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks") + 5);
      elementEdit(d).open(USER);
      s.changedTo(2);
      s.key(ctrl("r"), host);
      await settled(d);
      for (const c of "kale") s.key(char(c), host);
      s.key({ kind: "enter" }, host);
      // A line the person made after it is theirs: kept as typed.
      expect((await s.submit()).ok).toBe(true);
      expect(writes).toEqual(["Crops\n\nNo table now.\nkale\n"]);
    });

    test("the edited table removed while another stays: the line says the table changed, not gone", async () => {
      const TWO = "Crops\n\n| crop | bed |\n| --- | --- |\n| one | leeks |\n\n| tool | shed |\n| --- | --- |\n| rake | two |";
      const { d, read, press } = changed(TWO);
      d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("two") + 3);
      elementEdit(d).open(USER);
      press(ctrl("r"));
      read.open({ loaded: msg("n", "Crops\n\n| crop | bed |\n| --- | --- |\n| one | leeks |", 2) });
      await settled(d);
      expect(rich(d)).toBe(false);
      expect(d.note).toContain("the table changed");
      expect(d.note).not.toContain("gone");
    });

    test("a table lost with nothing held isn't remembered: the next reload's held keys all apply", async () => {
      const { d, s, read, press } = inCell();
      press(ctrl("r"));
      read.open({ loaded: msg("n", "Crops\n\nNo table now.", 2) });
      await settled(d);
      expect(d.views.rich?.on).toBe(false);
      // Changed again; this read loads nothing, so the keys held through it act on the text as it stands.
      s.changedTo(3);
      const reread = gated<ReloadRead>();
      (s.target as { reload?: DraftTarget["reload"] }).reload = () => reread.answer;
      press(char("a"));
      press(ctrl("r"));
      press({ kind: "backspace" }); press(char("b"));
      reread.open({ none: "the note is gone from the outline" });
      await settled(d);
      expect(d.lines.at(-1)).toBe("b");
      expect(d.note).not.toContain("didn't apply");
    });

    test("the table gone and nothing typed: the line it waits on isn't a change to save", async () => {
      const { d, read, press } = inCell();
      press(ctrl("r"));
      read.open({ loaded: msg("n", "Crops\n\nNo table now.", 2) });
      await settled(d);
      expect([rich(d), d.dirty, d.lines.at(-1), d.row]).toEqual([false, false, "", d.lines.length - 1]);
    });
  });
});

/** The outline a reader sees, in memory: notes and one thread each, revisions that move, and reads that can be held. */
function fakeOutline() {
  const notes = new Map<string, Msg>(), threads = new Map<string, any[]>();
  let gate: Promise<unknown> | null = null;
  const board = {
    ancestors: async () => [],
    get: async (id: string) => { await gate; return notes.get(id) ?? null; },
    comments: async (id: string) => { await gate; return threads.get(id) ?? []; },
    previewPropertyList: async () => null,
    update: async (id: string, text: string, base: number) => { const n = notes.get(id)!; if (n.revision !== base) throw new EditConflict(id, "revision is stale"); const now = msg(id, text, base + 1); notes.set(id, now); return now; },
    updateComment: async (id: string, revision: number, body: string) => {
      const t = [...threads.values()].flat().find(x => x.id === id);
      if (t.revision !== revision) throw new Refused("revision is stale", "stale-revision");
      Object.assign(t, { body, revision: revision + 1 });
      return { id, revision: revision + 1, body };
    },
    comment: async (_r: string, id: string, revision: number) => { if (notes.get(id)!.revision !== revision) throw new Refused("revision is stale", "stale-revision"); return { id: "c-new" }; },
  };
  const host = (): SurfaceHost => ({ ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  return {
    board, host,
    note(text: string, revision = 1) { const m = msg(`note-${++places}`, text, revision); notes.set(m.id, m); return m; },
    edit(id: string, text: string) { const was = notes.get(id)!, now = msg(id, text, was.revision! + 1); notes.set(id, now); return now; },
    thread(id: string, body: string) { const t = { id: `c-${++places}`, author: "user", body, quote: "", at: 0, open: true, lifecycle: "open", start: null, end: null, replies: [], revision: 3 }; threads.set(id, [t]); return t; },
    /** Reads wait until the answer is let go: the host, stopped, as whoever asked sees it. */
    hold() { const g = gated<void>(); gate = g.answer; return () => { gate = null; g.open(); }; },
  };
}

describe("each host's key path (a fake outline)", () => {
  /** A note with one posted comment, in its edit with a word typed; the comment then changed elsewhere and ctrl+s refused. */
  async function commentRefused(title: string, o = fakeOutline(), rows = 8) {
    const m = o.note(`${title}\nThe plot by the shed.`), t = o.thread(m.id, "How deep is the bed?");
    const s = new NoteSurface(), h = o.host();
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("e"), h);
    await until(() => !!s.session?.composer, "the comment's edit");
    const d = s.session!.composer!;
    for (const c of " now") s.key(char(c), h);
    Object.assign(t, { body: "How deep should the bed be?", revision: 4 });
    // Drawn as it's typed, in a small tile: what ctrl+s says comes after this, and must not push the text out of view.
    s.render(28, rows, h);
    s.key(ctrl("s"), h);
    s.render(28, rows, h);                  // the frame the key paints, before the answer
    await until(() => d.status.conflict !== null, "the stale refusal");
    return { s, h, d, o, t, m };
  }
  const flat = (s: NoteSurface, h: SurfaceHost, cols: number, rows: number) => s.render(cols, rows, h).lines.map(visible).join("").replace(/[\s│]+/g, "");
  const settled = (d: { status: { phase: unknown } }, loaded: () => boolean) => until(() => d.status.phase === null && loaded(), "the reload's answer");

  /** A note's edit, a key typed, the note changed elsewhere and the reader told. */
  function noteEdit(o: ReturnType<typeof fakeOutline>, text: string, next: string) {
    const m = o.note(text), s = new NoteSurface(), h = o.host();
    s.show(m, h);
    s.startDraft(m, h);
    const d = s.draft!;
    return { s, h, d, m, changed: () => s.drafting!.changedTo(o.edit(m.id, next).revision!) };
  }

  test("a note's edit: ctrl+r holds keys through the reader's own key path; the line says what a command didn't do", async () => {
    const o = fakeOutline(), { s, h, d, changed } = noteEdit(o, "Sowing\nbeans", "Sowing\npeas");
    s.key(char("!"), h);
    changed();
    const release = o.hold();
    s.key(ctrl("r"), h);
    await until(() => d.status.phase === "reloading", "the reload's read");
    s.key(char("x"), h); s.key(ctrl("s"), h); s.key({ kind: "paste", text: "yz" }, h); s.key({ kind: "esc" }, h); s.key(char("w"), h);
    release();
    await settled(d, () => d.text.includes("peas"));
    expect(d.text).toBe("Sowing\npeasxyzw");
    expect(s.draft).toBe(d);
    expect(d.note).toContain("ctrl+s, esc didn't run");
    expect(d.status.changedElsewhere).toBe(false);
  });

  test("a note's edit in a rich cell: the key that would reach the cell's own keys is held first, and lands in the cell", async () => {
    const o = fakeOutline(), table = "\n\n| crop | bed |\n| --- | --- |\n| leek | 3 |", { s, h, d, changed } = noteEdit(o, `Crops${table}`, `Crops [season::spring]${table}`);
    d.place(d.lines.length - 1, 3);
    await s.act("rich.toggle", { on: true }, h, USER);
    changed();
    const release = o.hold();
    s.key(ctrl("r"), h);
    await until(() => d.status.phase === "reloading", "the reload's read");
    for (const c of "ab") s.key(char(c), h);
    s.key({ kind: "paste", text: "cd" }, h);
    expect(d.lines.at(-1)).toBe("| leek | 3 |");
    release();
    await settled(d, () => d.text.includes("abcd"));
    expect(d.lines.at(-1)).toContain("abcd");
  });

  test("a comment's edit: ctrl+r takes the one route, its keys are held, and they land on the words it loaded", async () => {
    const { s, h, d, o } = await commentRefused("Held reload");
    const release = o.hold();
    s.key(ctrl("r"), h);
    await until(() => d.status.phase === "reloading", "the reload's read");
    for (const c of "ab") s.key(char(c), h);
    s.key({ kind: "paste", text: "pasted" }, h);
    s.key(ctrl("s"), h);
    expect(d.note).toContain("press ctrl+s again");
    s.key(char("c"), h);
    expect(d.text).toBe("How deep is the bed? now");
    release();
    await settled(d, () => d.text.includes("should"));
    expect(d.text).toBe("How deep should the bed be?abpastedc");
    expect(s.session?.composer).toBe(d);
    expect(d.status.conflict).toBeNull();
    expect((s.session!.target as any).mark.revision).toBe(4);
  });

  test("an act of edit.reload is the same route: an agent's paste while the read is out is refused, and nothing is lost", async () => {
    const { s, h, d, o } = await commentRefused("Late paste");
    const release = o.hold();
    const reload = s.act("edit.reload", {}, h, USER);
    await until(() => d.status.phase === "reloading", "the reload's read");
    await expect(s.act("draft.paste", { text: "?" }, h, USER)).rejects.toThrow("try again");
    release();
    await reload;
    expect(d.text).toBe("How deep should the bed be?");
  });

  test("a note reply's ctrl+r says so where it's drawn, in its own tile's rows", async () => {
    const o = fakeOutline(), m = o.note("Beds\nRake them."), s = new NoteSurface(), h = o.host();
    s.show(m, h);
    const r = s.startReply(h);
    s.key(ctrl("r"), h);
    await Bun.sleep(0);
    expect(r.draft.note).toBe("nothing to reload");
    for (const [cols, rows] of [[120, 40], [44, 30]] as const) expect({ cols, shown: flat(s, h, cols, rows).includes("nothingtoreload") }).toEqual({ cols, shown: true });
    r.dispose();
  });

  test("a short box keeps the typed text, the copy's file name and the reload key; reloaded, the revision and the copy", async () => {
    const { s, h, d } = await commentRefused("Short box");
    const file = d.status.savedCopy!.split("/").at(-1)!;
    const shown = flat(s, h, 28, 8);
    expect(shown).toContain("now");
    expect(shown).toContain("notsaved");
    // One row is what's left for the copy and its key: the name's two ends, which tell one copy from another.
    expect(shown).toContain(file.slice(0, 8));
    expect(shown).toContain(file.slice(-6));
    expect(shown).toContain("^R");
    await s.act("edit.reload", {}, h, USER);
    const after = flat(s, h, 28, 8), copy = d.status.savedCopy!.split("/").at(-1)!;
    expect(d.text).toBe("How deep should the bed be?");
    expect(after).toMatch(/revision\d/);
    expect(after).toContain(copy.slice(0, 8));
    expect(after).toContain(copy.slice(-6));
  });

  test("at the zoomed size what ctrl+s says never pushes the typed row out of view", async () => {
    for (const rows of [7, 8, 9, 10]) {
      const { s, h, d } = await commentRefused(`Zoomed ${rows}`, fakeOutline(), rows);
      const shown = flat(s, h, 28, rows);
      expect({ rows, saved: shown.includes("notsaved"), typed: shown.includes("now"), key: shown.includes("^R") }).toEqual({ rows, saved: true, typed: true, key: true });
      const file = d.status.savedCopy!.split("/").at(-1)!;
      expect(shown).toContain(file.slice(-6));
    }
  });

  test("wheeled away from an inline comment edit, a resize leaves the note where it was scrolled", async () => {
    const o = fakeOutline(), m = o.note(`Long plan\n${Array.from({ length: 120 }, (_, i) => `row ${i + 1} of the long plan`).join("\n")}`);
    o.thread(m.id, "Which rows first?");
    const s = new NoteSurface(), h = o.host();
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("e"), h);
    await until(() => !!s.session?.composer, "the comment's edit");
    s.key(char("!"), h);
    s.render(80, 24, h);
    // The wheel, away from the box; then the tile shrinks, and the box with it. No key was pressed.
    (s as any).scroll = 60;
    s.render(80, 24, h);
    const at = (s as any).scroll;
    s.render(80, 8, h);
    expect((s as any).scroll).toBeGreaterThan(at - 3);
  });

  test.each([[80, 24], [30, 12]])("rich edit at %d×%d says changed elsewhere, then not saved, on the draft's own status row, and reloading clears them", async (cols, rows) => {
    const o = fakeOutline(), title = `Rich why ${cols}`, table = "\n\n| crop | bed |\n| --- | --- |\n| one | leeks |", { s, h, d, m } = noteEdit(o, `${title}${table}`, "");
    d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks"));
    await s.act("rich.toggle", { on: true }, h, USER);
    const lit = () => s.render(cols, rows, h).lines.map(visible).join("").replace(/\s+/g, "");
    const before = s.render(cols, rows, h).lines.map(visible).findIndex(l => l.includes("leeks"));
    s.drafting!.changedTo(m.revision! + 1);
    expect(lit()).toContain("!!changedelsewhere");
    // The status takes the state row it already has: the note under it stays where it was.
    expect(s.render(cols, rows, h).lines.map(visible).findIndex(l => l.includes("leeks"))).toBe(before);
    for (const c of "ab") s.key(char(c), h);
    o.edit(m.id, `${title} today${table}`);
    s.key(ctrl("s"), h);
    await until(() => d.status.conflict !== null && !d.busy, "the stale refusal");
    expect(lit()).toContain("notsaved");
    await s.act("edit.reload", {}, h, USER);
    expect(lit()).not.toContain("notsaved");
    expect(lit()).not.toContain("changedelsewhere");
    expect(d.views.rich?.on).toBe(true);
  });

  test("rich edit says what a held command didn't do, whole, during the hold and after it", async () => {
    for (const cols of [80, 177]) {
      const o = fakeOutline(), title = `Rich line ${cols}`, table = "\n\n| crop | bed |\n| --- | --- |\n| one | leeks |", { s, h, d, m } = noteEdit(o, `${title}${table}`, "");
      d.place(d.lines.length - 1, d.lines.at(-1)!.indexOf("leeks") + 5);
      await s.act("rich.toggle", { on: true }, h, USER);
      for (const c of " and radishes too") s.key(char(c), h);
      o.edit(m.id, `${title} today${table}`);
      s.key(ctrl("s"), h);
      await until(() => d.status.conflict !== null && !d.busy, "the stale refusal");
      const lit = () => s.render(cols, 24, h).lines.map(visible).join("").replace(/\s+/g, "");
      const release = o.hold();
      s.key(ctrl("r"), h);
      await until(() => d.status.phase === "reloading", "the reload's read");
      s.key(ctrl("s"), h);
      s.key({ kind: "esc" }, h);
      expect(lit()).toContain("reloading·pressctrl+s,escagain");
      release();
      await settled(d, () => d.lines[0]!.includes("today") && d.status.conflict === null);
      const after = lit();
      expect(after).toContain("ctrl+s,escdidn'trun:pressthemagain");
      // The status grew by rows; the note under it didn't scroll for that.
      expect(after).toContain(`Richline${cols}today`);
      expect(after).toContain("revision");
      expect(after).toContain(d.status.savedCopy!.split("/").at(-1)!);
      expect(d.views.rich?.on).toBe(true);
    }
  });
});

describe("a comment on a passage", () => {
  const msgOf = (text: string, revision: number) => msg("note-gate", text, revision);
  /** A comment refused as stale; the read ctrl+r makes waits on the gate. */
  async function refused() {
    const read = gated<Msg>();
    const env: any = {
      board: { async comment() { throw new Refused("revision is stale", "stale-revision"); } },
      fetch: () => read.answer, setMsg() {}, reloadComments: async () => [], external() {}, flash() {}, redraw() {},
      // ctrl+r's one route: the host's edit.reload, which reloads the session's draft.
      reload() { void s.reload(env); },
    };
    const s = new CommentSession(msgOf("Gate\nHang it on Friday.", 1), [], "select");
    s.passage!.selectText("Hang it");
    expect(s.write()).toBeNull();
    for (const c of "soon") s.key(char(c), env);
    s.key(ctrl("s"), env);
    await until(() => s.writing!.status.conflict !== null, "the stale refusal");
    return { s, env, d: s.writing!.draft, read };
  }

  test("what's typed while it finds the quote again is held and lands, and the line says one thing", async () => {
    const { s, env, d, read } = await refused();
    expect(s.error).toBeNull();
    expect(d.status.conflict).toBe("the note changed since you picked the passage · not sent");
    expect(d.note).toContain("your draft is kept and copied to");
    s.key(ctrl("r"), env);
    expect(d.status.phase).toBe("reloading");
    s.key(char("!"), env);
    s.key({ kind: "paste", text: " please" }, env);
    expect(d.text).toBe("soon");
    read.open(msgOf("Gate\nFirst:\nHang it on Friday.", 2));
    await until(() => d.status.phase === null && d.text !== "soon", "the held keys");
    expect(d.text).toBe("soon! please");
    expect(d.status.conflict).toBeNull();
    expect(d.note).toContain("found the quote again at revision 2");
    expect((s.target as any).revision).toBe(2);
  });

  test("edit.reload answers the revision the quote was found at, never the new comment's draft base; a reply names none", async () => {
    const o = fakeOutline(), m = o.note("Gate\nHang it on Friday."), s = new NoteSurface(), h = o.host();
    s.show(m, h);
    s.session = new CommentSession(s.msg!, [], "select");
    s.session.passage!.selectText("Hang it");
    expect(s.session.write()).toBeNull();
    const d = s.session.composer!;
    for (const c of "soon") s.key(char(c), h);
    o.edit(m.id, "Gate\nFirst:\nHang it on Friday.");
    s.key(ctrl("s"), h);
    await until(() => d.status.conflict !== null, "the stale refusal");
    const r = await s.act("edit.reload", {}, h, USER) as { baseRevision?: number; note: string };
    expect(r.note).toContain("found the quote again at revision 2");
    expect(r.baseRevision).toBe(2);
    s.session.target = { kind: "reply", thread: { id: "c-1" } as never };
    expect("baseRevision" in (await s.act("edit.reload", {}, h, USER) as object)).toBe(false);
    s.session.writing!.dispose();
  });

  test("the quote gone: it goes back to picking, and what was typed meanwhile is the comment's, not the picker's", async () => {
    const { s, env, d, read } = await refused();
    s.key(ctrl("r"), env);
    for (const c of "jk") s.key(char(c), env);
    read.open(msgOf("Gate\nNothing about it now.", 2));
    await until(() => d.status.phase === null && s.mode === "select", "the picker");
    await Bun.sleep(0);
    expect(d.text).toBe("soonjk");
    expect(s.passage!.note).toContain("the quote is gone");
    expect(d.status.conflict).toBeNull();
  });

  test("a read that fails: the conflict stands and the same line says so as any draft's", async () => {
    const { s, env, d, read } = await refused();
    const r = s.reload(env);
    read.shut(new Error("socket closed"));
    await r;
    expect(d.status.conflict).not.toBeNull();
    expect(d.note).toContain("couldn't read it now");
    expect(s.error).toBeNull();
  });
});

describe("a draft put aside comes back the same way from any of them (PIE-1561)", () => {
  test("a comment: esc esc puts it aside, and C on the note brings it back", async () => {
    const o = fakeOutline(), m = o.note("Gate\nHang it."), h = o.host();
    const first = new NoteSurface();
    first.show(m, h);
    first.key(char("C"), h);
    await until(() => !!first.session?.composer, "the comment");
    for (const c of "onions by the gate") first.key(char(c), h);
    first.key({ kind: "esc" }, h);
    first.key({ kind: "esc" }, h);
    expect(first.session?.composer ?? null).toBeNull();
    const again = new NoteSurface();
    again.show(m, h);
    again.key(char("C"), h);
    await until(() => !!again.session?.composer, "the comment again");
    const d = again.session!.composer!;
    expect(d.text).toBe("onions by the gate");
    expect(d.note).toContain("brought back");
    again.session!.writing!.dispose();
  });

  test("a line field: esc esc on typed words puts them aside, and editing that field again brings them back", async () => {
    const place = `field:bed-${++places}`, field = new Inspector();
    await field.edit("bed", "", [], false, place, async () => ({}));
    for (const c of "three") field.key(char(c));
    expect(field.key({ kind: "esc" })).toBe(true);
    const op = field.key({ kind: "esc" });
    expect(op).toEqual({ op: "cancel" });
    await field.input("cancel");
    expect(field.field).toBeNull();
    const again = new Inspector();
    await again.edit("bed", "", [], false, place, async () => ({}));
    expect(again.field!.session.draft.text).toBe("three");
    expect(again.field!.session.draft.note).toContain("brought back");
    again.field!.session.dispose();
  });

  test("a narrow float brought back with the cursor on line 2 draws both lines, with no blank row for line 1", async () => {
    const o = fakeOutline(), m = o.note("Gate\nHang it."), h = o.host();
    const first = new NoteSurface();
    first.show(m, h);
    first.key(char("C"), h);
    await until(() => !!first.session?.composer, "the comment");
    for (const c of "onions by the gate") first.key(char(c), h);
    first.key({ kind: "enter" }, h);
    for (const c of "and a sign for the leeks") first.key(char(c), h);
    composerBox(first.session!.composer!, first.session!.composerFrame()!, 32, 8, true);   // drawn, so its place is kept
    first.session!.writing!.keep();
    first.session!.writing!.dispose();
    const again = new NoteSurface();
    again.show(m, h);
    again.key(char("C"), h);
    await until(() => !!again.session?.composer, "the comment again");
    const d = again.session!.composer!;
    expect(d.note).toContain("brought back");
    expect(d.row).toBe(1);
    const box = composerBox(d, again.session!.composerFrame()!, 32, 8, true).lines.map(visible).join("\n");
    expect(box).toContain("onions by the gate");
    expect(box).toContain("and a sign for the leeks");
  });
});

describe("a rebound key in the live hint (a keymap already there when the door starts)", () => {
  /** The door's modules load with the file in place, as they do for the person: a test that rebinds after import can't see this. */
  async function started(keymap: Record<string, string[]>) {
    const file = join(state, `keys-${++places}.json`);
    await Bun.write(file, JSON.stringify(keymap));
    const src = (f: string) => JSON.stringify(join(import.meta.dir, "../src", f));
    const code = `
      const { NoteSurface } = await import(${src("surface/note.ts")});
      const { CommentSession } = await import(${src("comment.ts")});
      const { COMMENT_KEYS } = await import(${src("surface/attached-keys.ts")});
      const { modeBinding } = await import(${src("surface/modes.ts")});
      await import(${src("app.ts")});   // every key table, as the door has them: they're registered as their modules load
      const h = { ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false }, redraw() {}, navigate() {} };
      const s = new NoteSurface();
      s.show({ id: "note-1", text: "Gate\\nHang it.", revision: 1, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", properties: [] }, h);
      s.session = new CommentSession(s.msg, [], "threads");
      s.session.writeNote();
      const press = key => modeBinding(COMMENT_KEYS, { kind: "alt", ch: key })?.action ?? null;
      console.log(JSON.stringify({ hint: s.modes.top().hint(), nine: press("9"), eight: press("8") }));
      process.exit(0);`;
    const p = Bun.spawn(["bun", "-e", code], { env: { ...process.env, EP0CH_KEYMAP: file, EP0CH_STATE: state }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (!out.trim()) throw new Error(err);
    const r = JSON.parse(out.trim().split("\n").at(-1)!) as { hint: string; nine: string | null; eight: string | null };
    return { ...r, hint: visible(r.hint) };
  }

  test("comment.place and comment.grip rebound: the hint says the key that works, and each key runs its action", async () => {
    const r = await started({ "comment.place": ["alt+9"], "comment.grip": ["alt+8"] });
    expect(r.hint).toContain("placement");
    expect(r.hint).toContain("move");
    expect(r.hint).not.toContain("^O");
    expect(r.hint).not.toContain("^G");
    expect([r.nine, r.eight]).toEqual(["comment.place", "comment.grip"]);
  });

  test("the keys an action declares are its built-in ones, whatever the file says when the door loads", async () => {
    const r = await started({ "comment.place": [] });
    expect(r.hint).not.toContain("placement");
    expect(r.hint).toContain("move");
  });
});

// PIE-1658: the lifecycle, host by host. Each draft is opened the way a person opens it, a second writer changes what it's
// written on, and the reader hears it the way the door does (a note read again through `refresh`, the comments through
// `loadComments`), never a `changedTo` by hand. Then: the warning shows, ctrl+r holds what's typed while it reads, the
// new text lands with what was typed on it, and the warning clears once (the same news heard again doesn't bring it back).
describe("one lifecycle, every host (PIE-1658)", () => {
  type Row = { s: NoteSurface; h: SurfaceHost; d: () => import("../src/edit").Draft; change(): Promise<void>; hear(): Promise<void>; after: string; said: string };
  const heard = (s: NoteSurface, h: SurfaceHost, o: ReturnType<typeof fakeOutline>, id: string) => async () => { const now = await o.board.get(id); if (now) s.refresh(now); await s.loadComments(h); };
  const type = (s: NoteSurface, h: SurfaceHost, text: string) => { for (const c of text) s.key(char(c), h); };

  const hosts: Record<string, () => Promise<Row>> = {
    "a note's edit": async () => {
      const o = fakeOutline(), m = o.note("Sowing\nbeans"), s = new NoteSurface(), h = o.host();
      s.show(m, h);
      s.startDraft(m, h);
      s.key({ kind: "end" }, h); type(s, h, " soon");
      const hear = heard(s, h, o, m.id);
      return { s, h, d: () => s.draft!, change: async () => { o.edit(m.id, "Sowing\npeas"); await hear(); }, hear, after: "Sowing\npeas!", said: "loaded revision 2" };
    },
    "a comment on a passage": async () => {
      const o = fakeOutline(), m = o.note("Gate\nHang it on Friday."), s = new NoteSurface(), h = o.host();
      s.show(m, h);
      s.session = new CommentSession(s.msg!, [], "select");
      s.session.passage!.selectText("Hang it");
      expect(s.session.write()).toBeNull();
      type(s, h, "soon");
      const hear = heard(s, h, o, m.id);
      return { s, h, d: () => s.session!.composer!, change: async () => { o.edit(m.id, "Gate\nFirst:\nHang it on Friday."); await hear(); }, hear, after: "soon!", said: "found the quote again at revision 2" };
    },
    "a comment on the whole note": async () => {
      const o = fakeOutline(), m = o.note("Gate\nHang it on Friday."), s = new NoteSurface(), h = o.host();
      s.show(m, h);
      s.session = new CommentSession(s.msg!, [], "threads");
      expect(s.session.writeNote()).toBeNull();
      type(s, h, "soon");
      const hear = heard(s, h, o, m.id);
      return { s, h, d: () => s.session!.composer!, change: async () => { o.edit(m.id, "Gate\nHang it on Saturday."); await hear(); }, hear, after: "soon!", said: "revision 2" };
    },
    "a comment's edit": async () => {
      const o = fakeOutline(), m = o.note("Bed\nThe plot by the shed."), t = o.thread(m.id, "How deep is the bed?"), s = new NoteSurface(), h = o.host();
      s.show(m, h);
      await s.loadComments(h);
      s.key(char("m"), h);
      await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
      s.key(char("e"), h);
      await until(() => !!s.session?.composer, "the comment's edit");
      type(s, h, " now");
      const hear = heard(s, h, o, m.id);
      return { s, h, d: () => s.session!.composer!, change: async () => { Object.assign(t, { body: "How deep should the bed be?", revision: 4 }); await hear(); }, hear, after: "How deep should the bed be?!", said: "loaded revision 4" };
    },
    "a property's value in the panel": async () => {
      const o = fakeOutline(), m = o.note("Leeks [bed::north]\nRaked.");
      Object.assign(m, { properties: [{ key: "bed", value: "north" }] });
      const s = new NoteSurface(), h = o.host();
      s.show(m, h);
      s.openPanel(false);
      s.editValue(s.rows(s.msg!)[0]!);
      type(s, h, " side");
      const hear = heard(s, h, o, m.id);
      return {
        s, h, d: () => s.panel!.field!.input.draft, hear, after: "south!", said: "loaded revision 2",
        change: async () => { Object.assign(o.edit(m.id, "Leeks [bed::south]\nRaked."), { properties: [{ key: "bed", value: "south" }] }); await hear(); },
      };
    },
  };

  for (const [name, open] of Object.entries(hosts)) test(`${name}: warned, held, read, replayed, cleared once`, async () => {
    const r = await open(), { s, h } = r;
    await r.change();
    const d = r.d();
    expect({ warned: d.status.changedElsewhere || !!d.status.conflict }).toEqual({ warned: true });
    // The hint names the reload while there's something to reload (a passage's comment finds its quote again).
    expect(visible(s.hint())).toMatch(/reload|find quote/);
    // The second writer's host is slow: ctrl+r's read waits until it's let go.
    const board = h.ctx.board as { get(id: string): Promise<Msg | null>; comments(id: string): Promise<unknown[]> }, get = board.get, comments = board.comments;
    let letGo!: () => void;
    const waiting = new Promise<void>(res => { letGo = res; });
    board.get = async id => { await waiting; return get(id); };
    board.comments = async id => { await waiting; return comments(id); };
    const before = d.text;
    s.key(ctrl("r"), h);
    await until(() => d.status.phase === "reloading", "the reload's read");
    s.key(char("!"), h);
    expect(d.text).toBe(before);
    letGo(); board.get = get; board.comments = comments;
    await until(() => d.status.phase === null && d.text !== before, "the read and the held key");
    await Bun.sleep(0);
    expect(r.d()).toBe(d);
    expect(d.text).toBe(r.after);
    expect({ changedElsewhere: d.status.changedElsewhere, conflict: d.status.conflict }).toEqual({ changedElsewhere: false, conflict: null });
    expect(d.note).toContain(r.said);
    // Cleared once: the same news heard again says nothing new.
    await r.hear();
    expect({ changedElsewhere: d.status.changedElsewhere, conflict: d.status.conflict }).toEqual({ changedElsewhere: false, conflict: null });
    s.draftSession()?.dispose();
  });

  // PIE-1664: the warning's key fits a 44-column footer, right after the save, in every host; and "nothing newer to
  // load" said before the change is no longer the news once the change is heard.
  for (const [name, open] of Object.entries(hosts)) test(`${name}: ^R reload in a 44-column footer; a stale "nothing newer" goes`, async () => {
    const r = await open(), { s, h } = r;
    s.key(ctrl("r"), h);
    await Bun.sleep(0);
    const d = r.d();
    expect(d.note).toBe("nothing newer to load");
    expect(visible(s.hint())).not.toContain("reload");
    await r.change();
    expect(d.status.changedElsewhere || !!d.status.conflict).toBe(true);
    expect(d.note).not.toContain("nothing newer");
    // The property panel says ctrl+r on its own last line; the rest name it in the footer.
    if (name.includes("panel")) expect(s.panel!.foot()).toContain("ctrl+r");
    else expect(visible(s.hint()).slice(0, 44)).toMatch(/\^R (reload|find quote)/);
    s.draftSession()?.dispose();
  });

  test("a reply names no revision: the note changing elsewhere doesn't warn it, and ctrl+r says there's nothing newer", async () => {
    const o = fakeOutline(), m = o.note("Bed\nThe plot by the shed."), s = new NoteSurface(), h = o.host();
    o.thread(m.id, "How deep is the bed?");
    s.show(m, h);
    await s.loadComments(h);
    s.key(char("m"), h);
    await until(() => s.session?.mode === "threads" && s.session.threads.length === 1, "the thread list");
    s.key(char("r"), h);
    await until(() => !!s.session?.composer, "the reply");
    const d = s.session!.composer!;
    type(s, h, "a spade deep");
    o.edit(m.id, "Bed\nThe plot by the gate.");
    await heard(s, h, o, m.id)();
    expect({ changedElsewhere: d.status.changedElsewhere, conflict: d.status.conflict }).toEqual({ changedElsewhere: false, conflict: null });
    s.key(ctrl("r"), h);
    await Bun.sleep(0);
    expect(d.note).toBe("nothing newer to load");
    expect(d.text).toBe("a spade deep");
    s.draftSession()?.dispose();
  });

  test("a comment on the whole note refused because the note moved on: ctrl+r takes the note as it is now, and ctrl+s sends", async () => {
    const o = fakeOutline(), m = o.note("Gate\nHang it on Friday."), s = new NoteSurface(), h = o.host();
    s.show(m, h);
    s.session = new CommentSession(s.msg!, [], "threads");
    expect(s.session.writeNote()).toBeNull();
    const d = s.session.composer!;
    type(s, h, "soon");
    o.edit(m.id, "Gate\nHang it on Saturday.");
    s.key(ctrl("s"), h);
    await until(() => d.status.conflict !== null || !!s.session!.error, "the refusal");
    expect({ conflict: d.status.conflict !== null, error: s.session!.error }).toEqual({ conflict: true, error: null });
    s.key(ctrl("r"), h);
    await until(() => d.status.phase === null && d.status.conflict === null, "the reload");
    expect(d.text).toBe("soon");
    s.key(ctrl("s"), h);
    await until(() => !s.session?.writing, "the send");
  });
});
