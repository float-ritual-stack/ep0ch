// PIE-544: new notes from anywhere. `note.new` (ctrl+n on every screen, + on the main menu, `act`) asks the service
// for a note where its placement rule puts it (under the note in the reader the person is in, else the top of the
// Inbox) and opens it in edit mode through the reader's own edit; a missing [[page]] followed is offered, then made;
// `[page::x]` alone on the first line titles itself on ⏎ and on save. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu, MessageReader } from "../src/screens";
import { Refused, SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { Draft } from "../src/edit";
import { personOpens, putAway } from "../src/new-note";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const term = (onKey: (f: (k: Key) => void) => void) => ({ info: { cols: 160, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey, onResize() {}, stop() {}, resume() {} });

describe("⏎ on a lone [page::x] (PIE-544): titled only at the line's end", () => {
  const at = (text: string, col: number) => { const d = new Draft("n", 1, text); d.titlesPages = true; d.col = col; d.newline(); return d.text; };
  test("at the end it titles, and the break follows", () => {
    expect(at("[page::garden]", 14)).toBe("garden [page::garden]\n");
    expect(at("[page::garden]  ", 16)).toBe("garden [page::garden]  \n");
  });
  test("before it or inside the token it's a plain break: nothing pushed apart, the token whole", () => {
    expect(at("[page::garden]", 0)).toBe("\n[page::garden]");
    expect(at("[page::garden]", 7)).toBe("[page::\ngarden]");
  });
  test("a comment's draft never titles", () => {
    const d = new Draft("c", 0, "[page::garden]"); d.col = 14; d.newline();
    expect(d.text).toBe("[page::garden]\n");
  });
});

describe("a new note the edit never opened on (putAway)", () => {
  const note = { id: "n1", text: "", revision: 1 } as any;
  const ctxWith = (now: any, trash: (id: string, actor?: unknown, at?: { revision?: number; ifEmpty?: boolean }) => Promise<void>) =>
    ({ board: { get: async () => { if (now instanceof Error) throw now; return now; }, trash, isTrashed: async () => null } }) as any;
  test("still empty at the revision it was made: trashed only at that revision and only if still empty, and said so", async () => {
    const trashed: unknown[] = [];
    expect(await putAway(ctxWith({ ...note }, async (id, _actor, at) => { trashed.push([id, at]); }), note)).toBe("it went to the trash");
    expect(trashed).toEqual([["n1", { revision: 1, ifEmpty: true }]]);
  });
  test("written meanwhile (another client, an agent): kept, never trashed, named by its id", async () => {
    let trashed = false;
    const said = await putAway(ctxWith({ ...note, text: "Beans up", revision: 2 }, async () => { trashed = true; }), note);
    expect(trashed).toBe(false);
    expect(said).toBe("it was written meanwhile, so it stays (n1)");
    expect(await putAway(ctxWith({ ...note, revision: 2 }, async () => { trashed = true; }), note)).toBe("it was written meanwhile, so it stays (n1)");
    expect(trashed).toBe(false);
  });
  test("a child added under it (its revision unchanged): kept, never trashed with the child", async () => {
    let trashed = false;
    expect(await putAway(ctxWith({ ...note, childIds: ["c1"] }, async () => { trashed = true; }), note)).toBe("it was written meanwhile, so it stays (n1)");
    expect(trashed).toBe(false);
  });
  test("written between the read and the trash: the service refuses the trash, and it's said as kept", async () => {
    const said = await putAway(ctxWith({ ...note }, async () => { throw new Refused("Block changed since it was read: n1"); }), note);
    expect(said).toBe("it was written meanwhile, so it stays (n1)");
  });
  test("a child added between the read and the trash: the service refuses it as not empty, and it's said as kept", async () => {
    const said = await putAway(ctxWith({ ...note }, async () => { throw new Refused("Block is not empty: it has 1 child now: n1"); }), note);
    expect(said).toBe("it was written meanwhile, so it stays (n1)");
  });
  test("the trash failed: what's known, the id and the command to check it, never \"still there, empty\"", async () => {
    const said = await putAway(ctxWith({ ...note }, async () => { throw new Error("no carrier"); }), note);
    expect(said).toBe("the trash didn't answer (no carrier), so it may still be there: check it with ep0ch show n1");
  });
  test("the read again failed: nothing trashed, and said as unknown", async () => {
    let trashed = false;
    const said = await putAway(ctxWith(new Error("the outline isn't answering"), async () => { trashed = true; }), note);
    expect(trashed).toBe(false);
    expect(said).toBe("it couldn't be read again (the outline isn't answering), so it was left as it is: check it with ep0ch show n1");
  });
});

describe.skipIf(!outliner)("new notes from anywhere (PIE-544)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, inbox: string;
  const notes: Record<string, any> = {};
  const childrenOf = async (id: string) => (await board.children(id)).map(m => m.text);
  /** Wait for what the service says to hold. */
  const reads = async (ok: () => Promise<boolean>, what: string, ms = 5000) => { const end = Date.now() + ms; while (!await ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); } };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    notes.plot = await mk(null, "Plot notes\nSee [[Bean diary]] for the runner beans.");
    inbox = (await board.roots()).find(r => r.props["system-view"] === "inbox")!.id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("+ on the main menu: a note at the top of the Inbox, opened to be written; ⏎ titles a lone [page::x], ctrl+s saves it", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    key(char("+"));
    await until(() => app.screens().at(-1) instanceof MessageReader && !!(app.screens().at(-1) as any).surface.draft, "a reader with the new note's edit", 8000);
    const s = (app.screens().at(-1) as any).surface;
    const id = s.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(inbox);
    expect((await board.children(inbox))[0]!.id).toBe(id);
    for (const c of "[page::2026-09-30]") key(char(c));
    key({ kind: "enter" });
    expect(s.draft.text).toBe("2026-09-30 [page::2026-09-30]\n");
    for (const c of "Watered the leeks.") key(char(c));
    key(ctrl("s"));
    await reads(async () => (await board.get(id))!.text === "2026-09-30 [page::2026-09-30]\nWatered the leeks.", "saved at once: a new note has no properties to lose", 5000);
    expect((await board.resolvePage("2026-09-30")).block?.id).toBe(id);
    // Again from the menu, left empty: esc puts it in the trash, and the reader goes back.
    app.pop();
    key(char("+"));
    await until(() => !!(app.screens().at(-1) as any).surface?.draft, "a second new note's edit", 8000);
    const second = (app.screens().at(-1) as any).surface.draft.blockId;
    key({ kind: "esc" });
    await reads(async () => (await board.get(second))?.props === undefined || !(await board.children(inbox)).some(m => m.id === second), "the empty note trashed", 5000);
  }, 30_000);

  test("ctrl+n in a desk reader: under the note it shows, floating with the keys; esc on it empty puts it in the trash and the float goes", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const desk = new Desk() as any;
    app.push(desk);
    try {
      desk.render(desk.ctx);
      await until(() => desk.panes.size > 0, "the desk's tiles", 10_000);
      await app.act({ action: "open", args: { id: notes.plot.id }, as: "new-note-test" });
      const reader = () => [...desk.panes.values()].find((p: any) => p.kind === "reader" && p.msg?.id === notes.plot.id) as any;
      await until(() => !!reader(), "a reader on the plot notes");
      // An agent following its missing [[Bean diary]] in a reader the person isn't in: refused, naming page.create; nothing made.
      const rname = desk.describe().tiles?.find?.((t: any) => t.kind === "reader")?.name ?? "reader";
      await expect(app.act({ action: "link.follow", args: { n: 1 }, tile: rname, as: "new-note-test" })).rejects.toThrow("page.create");
      expect((await board.resolvePage("Bean diary")).status).toBe("missing");
      // A detail keeps the note it was given (a following reader shows whatever is current): the person's reading place.
      await app.act({ action: "tile.open", args: { kind: "detail", note: notes.plot.id, name: "plotd" } });
      const plot = desk.panes.get(desk.idNamed("plotd")) as any;
      await until(() => plot?.msg?.id === notes.plot.id, "the detail on the plot notes");
      desk.focusOn("plotd");
      expect(desk.noteContext()).toBe(notes.plot.id);
      key(ctrl("n"));
      const editing = () => [...desk.panes.values()].find((p: any) => p.surface?.draft) as any;
      await until(() => !!editing(), "the new note's edit open", 8000);
      const r = editing(), id = r.surface.draft.blockId;
      expect((await board.get(id))!.parentId).toBe(notes.plot.id);
      // The note being read stays read: the new one floats over the screen in a tile of its own (PIE-591), never over it.
      expect(r).not.toBe(plot);
      expect(desk.isFloat(desk.idOf(r))).toBe(true);
      expect(plot.msg?.id).toBe(notes.plot.id);
      expect(desk.panes.get(desk.focus)).toBe(r);
      await until(() => desk.entered.in(r), "the person is in the new note's edit", 5000);
      // Nothing typed: esc closes it, and the empty note goes to the trash; the plot notes are where they were.
      key({ kind: "esc" });
      await reads(async () => !(await childrenOf(notes.plot.id)).includes(""), "the empty note trashed", 5000);
      await until(() => desk.idOf(r) === undefined, "its float gone with it", 5000);
      expect(plot.msg?.id).toBe(notes.plot.id);
      // ctrl+n while the person types in an edit (PIE-591): that edit is left as a click away leaves it (what was
      // typed saved), and a new note floats over the screen with the keys.
      const plotName = desk.nameOf([...desk.panes].find(([, p]: any) => p === plot)![0]);
      desk.focusOn(plotName);
      key(char("e"));
      await until(() => !!plot.surface.draft && desk.entered.in(plot), "the plot notes' edit", 5000);
      key({ kind: "end" });
      for (const c of " Sown 3 May.") key(char(c));
      key(ctrl("n"));
      await until(() => !!editing() && editing() !== plot && editing().surface.draft.blockId !== notes.plot.id, "a new note's edit from the edit", 8000);
      await reads(async () => (await board.get(notes.plot.id))!.text.includes("Sown 3 May."), "the left edit saved");
      expect(plot.surface.draft).toBeFalsy();
      const fromEdit = editing();
      expect(desk.isFloat(desk.idOf(fromEdit))).toBe(true);
      expect((await board.get(fromEdit.surface.draft.blockId))!.parentId).toBe(notes.plot.id);
      // Written and saved, its float names it by what was written, never the "(empty)" it opened as; the current note
      // (what following readers show) stays the person's reading place.
      for (const c of "Beans up") key(char(c));
      key(ctrl("s"));
      await until(() => !fromEdit.surface.draft && fromEdit.title() === "Beans up", "the float naming the saved note", 5000);
      expect((desk.describe().floats as any[]).some(f => f.title === "Beans up")).toBe(true);
      // An empty reader (^W o d) offers a new note, and ctrl+n there writes it in that reader.
      const opened = await app.act({ action: "tile.open", args: { kind: "detail", name: "blank" } }) as any;
      const blank = desk.panes.get(desk.idNamed("blank")) as any;
      expect(blank?.msg).toBeFalsy();
      expect(blank.render(60, 10, true, desk.api ?? desk).lines.join("\n")).toContain("New note");
      desk.focusOn("blank");
      key(ctrl("n"));
      await until(() => !!blank.surface.draft, "the new note's edit in the empty reader", 8000);
      expect(opened).toBeTruthy();
    } finally { desk.dispose?.(); }
  }, 30_000);

  test("floating new notes (PIE-591): a click away keeps an empty one open; × saves a written one; opens=tab and drawer; note.opens remembered", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const desk = new Desk() as any;
    app.push(desk);
    try {
      desk.render(desk.ctx);
      await until(() => desk.panes.size > 0, "the desk's tiles", 10_000);
      await app.act({ action: "tile.open", args: { kind: "detail", note: notes.plot.id, name: "plotf" } });
      const plot = desk.panes.get(desk.idNamed("plotf")) as any;
      await until(() => plot?.msg?.id === notes.plot.id, "the detail on the plot notes");
      desk.focusOn("plotf");
      const floats = () => (desk.describe().floats as any[]).filter(f => f.newNote);
      // Two, the keys on the second: the first, not typed in, stays open where it is (a burst never trashes them).
      key(ctrl("n")); key(ctrl("n"));
      await until(() => floats().length === 2 && floats().every(f => f.writing), "two floating drafts", 8000);
      const [a, b] = floats();
      // From a new note's float, the next goes beside it (its context), not under it; only while it shows that note.
      expect(desk.noteContext()).toBe(notes.plot.id);
      expect((await board.get(b.id))!.parentId).toBe(notes.plot.id);
      // A click away from the second (on the plot detail): nothing typed, so it stays open and empty, never trashed.
      desk.render(desk.ctx);
      const pr = desk.rectsNow().get(desk.idNamed("plotf"));
      key({ kind: "mouse", action: "down", button: 0, x: pr.col + 2, y: pr.row + pr.rows - 2 }); key({ kind: "mouse", action: "up", button: 0, x: pr.col + 2, y: pr.row + pr.rows - 2 });
      await Bun.sleep(200);
      expect(floats().map(f => f.id)).toEqual([a.id, b.id]);
      expect(floats().every(f => f.writing)).toBe(true);
      expect(await board.get(b.id)).toBeTruthy();
      // Written, its × (tile.close) saves it and closes it; the empty one's trashes it.
      desk.focusOn(b.tile); key(char("e"));
      await until(() => desk.newNoteWhileTyping(), "in b's edit", 5000);
      for (const c of "Netting up") key(char(c));
      await desk.dispatch.press("tile.close", {}, b.tile);
      await reads(async () => (await board.get(b.id))?.text === "Netting up", "the written one saved on close");
      await until(() => !floats().some(f => f.id === b.id), "its float closed");
      await desk.dispatch.press("tile.close", {}, a.tile);
      await reads(async () => await board.isTrashed(a.id) === true, "the empty one trashed on close");
      await until(() => floats().length === 0, "both closed");
      // opens=tab: a new tab on the tile the person is in, its edit open there.
      desk.focusOn("plotf");
      const you = (action: string, args: Record<string, unknown> = {}) => (app as any).dispatch.press(action, args);
      const t = await you("note.new", { opens: "tab" });
      expect(t.opens).toBe("tab");
      const tree = JSON.stringify((await desk.dispatch.press("layout.get") as any).tree);
      expect(tree).toContain(`"tabs":["plotf","${t.reader}"]`);
      expect(desk.describe().focusName).toBe(t.reader);
      await desk.dispatch.press("tile.close", {}, t.reader);
      // note.opens: the person's choice, remembered; EP0CH_NEW_NOTE wins in a door that sets it.
      expect(await you("note.opens", { opens: "drawer" })).toMatchObject({ opens: "drawer", changed: true });
      expect(personOpens({})).toBe("drawer");
      expect(personOpens({ EP0CH_NEW_NOTE: "tab" })).toBe("tab");
      await expect(app.act({ action: "note.opens", args: { opens: "drawer" }, as: "gardener" })).rejects.toThrow("the person's own setting");
      // An agent's opens=drawer is refused before anything is made.
      const inboxNow = (await childrenOf(inbox)).length;
      await expect(app.act({ action: "note.new", args: { text: "Rake leaves", opens: "drawer" }, as: "gardener" })).rejects.toThrow("person's drawer");
      expect((await childrenOf(inbox)).length).toBe(inboxNow);
      // The drawer: the new note's tile goes into it, the drawer up on it with the keys and its edit open.
      desk.focusOn("plotf");
      const d = await you("note.new");
      expect(d.opens).toBe("drawer");
      const drawer = (app as any).drawer.desk;
      await until(() => !!drawer?.pane(d.reader)?.surface?.draft, "the new note's edit in the drawer", 8000);
      expect(floats().length).toBe(0);
      expect(await you("note.opens", { opens: "float" })).toMatchObject({ opens: "float" });
      // Put away as it came: the drawer's note closed (still empty: to the trash), the drawer down (it's saved state).
      await drawer.dispatch.press("tile.close", {}, d.reader);
      await reads(async () => await board.isTrashed(d.id) === true, "the drawer's empty note trashed on close");
      await you("host.toggle", { open: false });
    } finally { desk.dispose?.(); }
  }, 30_000);

  test("ctrl+n in a BBS message reader: under the note it reads, in a reader over it; esc on it empty trashes it and that reader goes", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const reader = new MessageReader([(await board.get(notes.plot.id))!], 0);
    app.push(reader);
    const before = (await childrenOf(notes.plot.id)).length;
    key(ctrl("n"));
    await until(() => app.screens().at(-1) !== reader && !!(app.screens().at(-1) as any).surface?.draft, "the new note's edit in a reader over it", 8000);
    const over = app.screens().at(-1) as any, id = over.surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(notes.plot.id);
    key({ kind: "esc" });
    await until(() => app.screens().at(-1) === reader, "back on the plot notes' reader", 5000);
    await reads(async () => (await childrenOf(notes.plot.id)).length === before, "the empty note trashed", 5000);
  }, 30_000);

  test("esc while the new note's edit is still being read in a reader over the one read: nothing opens later, and the empty note goes", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const reader = new MessageReader([(await board.get(notes.plot.id))!], 0);
    app.push(reader);
    const before = (await childrenOf(notes.plot.id)).length;
    // The edit reads the note before it opens: slow that read, so the person's esc comes first.
    const get = board.get.bind(board);
    let started = 0, settled = 0;
    board.get = (async (...a: Parameters<typeof get>) => { started++; try { await Bun.sleep(500); return await get(...a); } finally { settled++; } }) as typeof board.get;
    try {
      key(ctrl("n"));
      await until(() => app.screens().at(-1) !== reader, "a reader over the plot notes", 5000);
      const over = app.screens().at(-1) as any;
      key({ kind: "esc" });
      await until(() => app.screens().at(-1) === reader, "back on the plot notes", 5000);
      // The edit's read resolves after the esc; only once it has (and the empty note it then gave up on is trashed)
      // does "nothing opened" mean anything.
      await until(() => started > 0 && settled === started, "the edit's read of the note answered", 5000);
      await reads(async () => (await childrenOf(notes.plot.id)).length === before, "the empty note trashed", 5000);
      expect(over.surface.draft).toBeFalsy();
      expect(app.screens().at(-1)).toBe(reader);
    } finally { board.get = get; }
  }, 30_000);

  test("written by another client between the put-away's read and its trash: the service refuses the trash, and the note stays", async () => {
    const { note } = await board.newNote("", notes.plot.id);
    const get = board.get.bind(board);
    // Another client saves the note just after this read answers: the trash that follows names the stale revision.
    board.get = (async (...a: Parameters<typeof get>) => {
      const now = await get(...a);
      await board.update(note.id, "Beans up on the north bed", note.revision!, { kind: "agent", id: "gardener" });
      return now;
    }) as typeof board.get;
    let said: string;
    try { said = await putAway({ board } as any, note); } finally { board.get = get; }
    expect(said).toBe(`it was written meanwhile, so it stays (${note.id})`);
    expect(await board.get(note.id)).toMatchObject({ text: "Beans up on the north bed" });
  }, 30_000);

  test("a child added by another client between the put-away's read and its trash: the trash is refused, and the note and the child stay", async () => {
    const { note } = await board.newNote("", notes.plot.id);
    const get = board.get.bind(board);
    let child = "";
    // Another client adds a child just after this read answers: the note's revision stays as it was read.
    board.get = (async (...a: Parameters<typeof get>) => {
      const now = await get(...a);
      if (!child) child = (await board.createBlock(note.id, "Thin the carrots", { kind: "agent", id: "gardener" })).id;
      return now;
    }) as typeof board.get;
    let said: string;
    try { said = await putAway({ board } as any, note); } finally { board.get = get; }
    expect(said).toBe(`it was written meanwhile, so it stays (${note.id})`);
    expect(await board.get(note.id)).toMatchObject({ revision: note.revision, childIds: [child] });
    expect(await board.get(child)).toMatchObject({ text: "Thin the carrots" });
    expect(await board.isTrashed(note.id)).toBe(false);
  }, 30_000);

  test("an agent's note.new: made where it says (the Inbox by default), attributed, said; the person's screen and keys stay", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    const menu = new MainMenu();
    app.push(menu);
    const r = await app.act({ action: "note.new", args: { text: "Ask about the seed swap" }, as: "gardener" }) as any;
    expect(r).toMatchObject({ rule: "inbox", parentId: inbox, said: "in the Inbox", title: "Ask about the seed swap" });
    expect(await board.get(r.id)).toMatchObject({ author: "gardener", parentId: inbox });
    expect(app.screens().at(-1)).toBe(menu);
    const under = await app.act({ action: "note.new", args: { text: "Beans up", near: notes.plot.id }, as: "gardener" }) as any;
    expect(under).toMatchObject({ rule: "near", parentId: notes.plot.id });
    await expect(app.act({ action: "note.new", args: { near: notes.plot.id, inbox: true }, as: "gardener" })).rejects.toThrow("two places");
    // A near it names that's gone is refused with the runnable fix, never quietly put in the Inbox.
    const gone = await board.request<any>("create", { parentId: null, text: "Old bed plan", author: "agent" });
    await board.trash(gone.id);
    const inboxBefore = (await childrenOf(inbox)).length;
    const refused = app.act({ action: "note.new", args: { text: "Beans up", near: gone.id }, as: "gardener" });
    await expect(refused).rejects.toThrow(`No live note ${gone.id}`);
    await expect(refused).rejects.toThrow(`note.new inbox=true text='Beans up' --as gardener`);
    expect((await childrenOf(inbox)).length).toBe(inboxBefore);
    void key;
  }, 30_000);

  test("a missing [[page]]: the first ⏎ offers it, the next makes it in the Inbox and opens it; never silent; an agent's page.create", async () => {
    let key: (k: Key) => void = () => {};
    const app = new App(term(f => { key = f; }) as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const reader = new MessageReader([(await board.get(notes.plot.id))!], 0);
    app.push(reader);
    await until(() => reader.surface.describe().links.some((l: any) => /Bean diary/.test(l.label ?? l.text ?? JSON.stringify(l))), "the link drawn", 5000);
    reader.surface.selectLink(0);
    key({ kind: "enter" });
    await until(() => /no page \[\[Bean diary\]\]/.test(reader.surface.notice), "the offer", 5000);
    expect((await board.resolvePage("Bean diary")).status).toBe("missing");
    key({ kind: "enter" });
    await reads(async () => (await board.resolvePage("Bean diary")).status === "resolved", "the page made", 5000);
    const page = (await board.resolvePage("Bean diary")).block!;
    expect(page.text).toBe("Bean diary [page::Bean diary]");
    expect((await board.get(page.id))!.parentId).toBe(inbox);
    await until(() => (app.screens().at(-1) as any).surface?.msg?.id === page.id, "the page opened", 5000);

    await expect(app.act({ action: "link.follow", args: { n: 1 }, tile: "message", as: "gardener" })).rejects.toThrow();
    await expect(app.act({ action: "page.create", as: "gardener" })).rejects.toThrow("name the page");
    const made = await app.act({ action: "page.create", args: { address: "Pea trellis" }, as: "gardener" }) as any;
    expect(made).toMatchObject({ created: true });
    expect(await board.get(made.id)).toMatchObject({ text: "Pea trellis [page::Pea trellis]", author: "gardener", parentId: inbox });
  }, 30_000);
});
