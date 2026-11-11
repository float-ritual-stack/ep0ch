// PIE-621: a draft's one history (undo and redo for every change), its keyboard selection and its copy keys.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BIG_PASTE_LINES, changeOf, Draft, DRAFT_ACTIONS, TYPING_PAUSE_MS, UNDO_ASK_PAUSE_MS, type Step } from "../src/edit";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { editHint } from "../src/surface/editor";
import { SocketBoard, USER } from "../src/socket";
import { visible } from "../src/style";
import { NOTE_ACTIONS } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string, shift?: true): Key => ({ kind: "char", ch, ctrl: true, ...(shift ? { shift } : {}) });
const type = (d: Draft, s: string) => { for (const c of s) d.key(c === "\n" ? { kind: "enter" } : char(c)); };
/** A paste as the App hands it on: one `paste` key carrying the whole text, the draft's step recorded once it's in. */
const paste = async (d: Draft, text: string) => { d.key({ kind: "paste", text }); await Bun.sleep(0); };
const undo = async (d: Draft) => { d.key(ctrl("z")); await Bun.sleep(0); };
const redo = async (d: Draft) => { d.key(ctrl("y")); await Bun.sleep(0); };

describe("a draft's history", () => {
  test("typing is a step a word at a time; ctrl+z goes back a word, ctrl+y forward", async () => {
    const d = new Draft("b1", 1, "Seed list");
    d.place(0, 9);
    type(d, " for the long bed");
    expect(d.undos.length).toBe(4);                                    // " for ", "the ", "long ", "bed"
    await undo(d);
    expect(d.text).toBe("Seed list for the long ");
    await undo(d); await undo(d);
    expect(d.text).toBe("Seed list for ");
    await redo(d);
    expect(d.text).toBe("Seed list for the ");
    expect(d.col).toBe("Seed list for the ".length);                   // the cursor where the change was
    await undo(d); await undo(d);
    expect(d.text).toBe("Seed list");
    expect(d.dirty).toBe(false);
    expect(d.note).toContain("the draft is as it started");
    await undo(d);
    expect(d.note).toBe("nothing to undo in this draft");
  });

  test("a pause, or a jump elsewhere, starts a new step; a new change drops what could be redone", async () => {
    const d = new Draft("b1", 1, "beans\npeas");
    d.place(0, 5);
    type(d, "ab");
    d.undos.at(-1)!.at -= TYPING_PAUSE_MS + 1;                          // a pause
    type(d, "cd");
    d.place(1, 4);
    type(d, "ef");                                                     // elsewhere
    expect(d.undos.map(s => s.after.split("\n").map(l => l.slice(-2)).join("|"))).toEqual(["ab|as", "cd|as", "cd|ef"]);
    await undo(d);
    type(d, "x");
    expect(d.redos).toEqual([]);
    await redo(d);
    expect(d.note).toBe("nothing to redo in this draft");
  });

  test("a paste is one step, however big, and a big one says so", async () => {
    const d = new Draft("b1", 1, "Notes");
    d.place(0, 5);
    const doc = Array.from({ length: 340 }, (_, i) => `- line ${i + 1} of a Markdown doc`).join("\n");
    await paste(d, "\n" + doc);
    expect(d.text).toBe("Notes\n" + doc);
    expect(d.undos.length).toBe(1);
    expect(d.undos[0]!.what).toBe("the paste (341 lines)");
    expect(d.note).toBe("pasted 341 lines · ctrl+z undoes");
    expect(BIG_PASTE_LINES).toBeLessThan(341);
    await undo(d);
    expect(d.text).toBe("Notes");
    expect(d.note).toContain("undid the paste (341 lines)");
    // A small paste says nothing, and the whole-text paste (a screen that takes it whole) is one step too.
    await paste(d, " today");
    expect(d.note).toBe("");
    d.key({ kind: "paste", text: "\nand\ntomorrow" });
    expect(d.undos.map(s => s.what)).toEqual(["the paste", "the paste (3 lines)"]);
  });

  test("a key straight after a paste: ctrl+z takes back the paste, not the word before it", async () => {
    const d = new Draft("b1", 1, "");
    type(d, "word ");
    d.key({ kind: "paste", text: "abc" });
    d.key(ctrl("z"));                                                  // no await between
    await Bun.sleep(0);
    expect(d.text).toBe("word ");
    expect(d.undos.map(s => s.what)).toEqual(["typing"]);
  });

  test("an empty paste over a selection takes it out, and that's a step", async () => {
    const d = new Draft("b1", 1, "abc");
    d.place(0, 1); d.place(0, 2, true);
    await DRAFT_ACTIONS.run("draft.paste", { text: "" }, d, USER);
    type(d, "x");
    expect(d.text).toBe("axc");
    await undo(d);
    expect(d.text).toBe("ac");
  });

  test("undoing an agent's own taking back puts its patch back among the draft's, so it can take it back again", async () => {
    const d = new Draft("b1", 1, "alpha\n\nbeta");
    const tidy = { kind: "agent" as const, id: "tidy" };
    const start = d.text.indexOf("alpha");
    d.place(2, 4);
    expect(d.applyPatch({ patchId: "p1", patches: [{ observed: "alpha", replacement: "ALPHA", range: { start, end: start + 5 }, unit: "utf16" }], revision: 1 }, tidy)).toEqual({ applied: true });
    type(d, "!");
    await DRAFT_ACTIONS.run("draft.undo", {}, d, tidy);               // its own patch, where it is now
    expect(d.text).toBe("alpha\n\nbeta!");
    expect(d.patches).toEqual([]);
    await undo(d);                                                     // the person: the taking back, undone
    expect(d.text).toBe("ALPHA\n\nbeta!");
    expect(d.patches.map(u => u.patchId)).toEqual(["p1"]);
    d.place(2, 5); type(d, "?");                                      // the undo put the cursor where it changed: back down
    await DRAFT_ACTIONS.run("draft.undo", {}, d, tidy);
    expect(d.text).toBe("alpha\n\nbeta!?");
  });

  test("a paste over a selection replaces it, and ctrl+z brings the selection's text back", async () => {
    const d = new Draft("b1", 1, "[heading::waffle] notes");
    d.place(0, 0); d.place(0, 17, true);
    await paste(d, "[heading::pancake]");
    expect(d.text).toBe("[heading::pancake] notes");
    await undo(d);
    expect(d.text).toBe("[heading::waffle] notes");
  });

  test("inserts, ctrl+k and $EDITOR's text are a step each", async () => {
    const d = new Draft("b1", 1, "go to [[gar");
    d.place(0, 11);
    d.splice(6, 11, "[[garden]]");
    d.key(ctrl("a")); d.key(ctrl("k"));
    d.replace("from the editor\n");
    expect(d.undos.map(s => s.what)).toEqual(["the insert", "the cut to the line's end", "the editor's text"]);
    await undo(d); await undo(d);
    expect(d.text).toBe("go to [[garden]]");
  });

  test("a reload is a step back: ctrl+z after it brings the typed text back", async () => {
    const d = new Draft("b1", 1, "old");
    d.place(0, 3);
    type(d, " typed");
    d.rebase({ id: "b1", text: "new from elsewhere", properties: [], revision: 2 } as never);
    await undo(d);
    expect(d.text).toBe("old typed");
  });

  test("an agent's draft.undo and draft.redo through act: its own steps only", async () => {
    const d = new Draft("b1", 1, "Plan");
    const agent = { kind: "agent" as const, id: "tidy" };
    d.place(0, 4);
    d.pasteText(" by tidy", agent);
    type(d, " and me");
    await expect(DRAFT_ACTIONS.run("draft.undo", {}, d, agent)).rejects.toThrow("this agent has no edit to undo");
    expect(await DRAFT_ACTIONS.run("draft.undo", {}, d, USER)).toMatchObject({ left: 2 });
    expect(await DRAFT_ACTIONS.run("draft.undo", {}, d, USER)).toMatchObject({ left: 1, redo: 2 });
    expect(await DRAFT_ACTIONS.run("draft.undo", {}, d, agent)).toMatchObject({ left: 0 });
    expect(d.text).toBe("Plan");
    expect(await DRAFT_ACTIONS.run("draft.redo", {}, d, agent)).toMatchObject({ redone: "redid the paste" });
    await expect(DRAFT_ACTIONS.run("draft.redo", {}, d, agent)).rejects.toThrow("an agent redoes only its own");
  });

  test("an agent's undo and redo of its own step leave the person's cursor and selection on their text (PIE-632)", async () => {
    const d = new Draft("b1", 1, "Seed list\n\nsow the peas");
    const tidy = { kind: "agent" as const, id: "tidy" };
    d.place(2, 4); d.place(2, 7, true);                                // the person has "the" selected, a block below
    d.applyPatch({ patchId: "p1", patches: [{ observed: "Seed", replacement: "Spring seed", range: { start: 0, end: 4 }, unit: "utf16" }], revision: 1 }, tidy);
    expect(d.selectedText()).toBe("the");
    await DRAFT_ACTIONS.run("draft.undo", {}, d, tidy);
    expect(d.text).toBe("Seed list\n\nsow the peas");
    expect(d.selectedText()).toBe("the");
    expect({ row: d.row, col: d.col }).toEqual({ row: 2, col: 7 });
    await DRAFT_ACTIONS.run("draft.redo", {}, d, tidy);
    expect(d.text).toBe("Spring seed list\n\nsow the peas");
    expect(d.selectedText()).toBe("the");
    type(d, "a");                                                      // typed over their own selection, nowhere else
    expect(d.text).toBe("Spring seed list\n\nsow a peas");
    // A patch above and below the person's block: undone and redone, their selection stays on the text between.
    const e = new Draft("b1", 1, "one\n\nkeep\n\nthree");
    e.place(2, 0); e.place(2, 4, true);
    const span = (observed: string, replacement: string) => ({ observed, replacement, range: { start: e.text.indexOf(observed), end: e.text.indexOf(observed) + observed.length }, unit: "utf16" as const });
    expect(e.applyPatch({ patchId: "p2", patches: [span("one", "ONE!"), span("three", "3")], revision: 1 }, tidy)).toEqual({ applied: true });
    await DRAFT_ACTIONS.run("draft.undo", {}, e, tidy);
    expect(e.text).toBe("one\n\nkeep\n\nthree");
    expect(e.selectedText()).toBe("keep");
    await DRAFT_ACTIONS.run("draft.redo", {}, e, tidy);
    expect(e.text).toBe("ONE!\n\nkeep\n\n3");
    expect(e.selectedText()).toBe("keep");
  });

  test("text replaced under a selection (an agent's text, $EDITOR's, a chosen completion): the next key types where the person is, never throws (PIE-632)", () => {
    const d = new Draft("b1", 1, "alpha\nbeta\ngamma delta");
    d.place(2, 11); d.place(2, 6, true);                               // "delta" selected, from its end
    d.replace("ab", { kind: "agent", id: "tidy" });
    expect(() => type(d, "x")).not.toThrow();
    expect(d.text).toBe("abx");
    const c = new Draft("b1", 1, "see [[gar");
    c.place(0, 0); c.place(0, 9, true);
    c.splice(4, 9, "[[garden]]");
    type(c, "!");
    expect(c.text).toBe("see [[garden]]!");                            // the old selection doesn't eat the insert
  });

  test("a history carried over (a save, then the note opened again unchanged) stops at the save and asks before going past it (PIE-1414)", async () => {
    const a = new Draft("b1", 1, "one");
    a.place(0, 3);
    type(a, " two");
    const b = new Draft("b1", 2, "one two");
    b.adopt(a.undos, 2);
    b.place(0, 7);
    type(b, " three");
    await undo(b);
    expect(b.text).toBe("one two");                                    // what was typed since the reopen goes first
    await undo(b);
    expect(b.text).toBe("one two");                                    // the saved text stays: ctrl+z says so and asks
    expect(b.note).toContain("saved");
    expect(b.note).toContain("ctrl+z again");
    // The ask first, whole on the draft's one row in a 40-column tile, with its window (PIE-1428, PIE-1738); what after it.
    expect(b.note).toMatch(/^saved · ctrl\+z again in [1-5]s undoes /);
    type(b, "!");                                                      // anything else lets the question go
    await undo(b);
    expect(b.text).toBe("one two");
    await undo(b);
    expect(b.text).toBe("one two");
    for (let i = 0; i < 5; i++) await undo(b);                         // a held ctrl+z's repeats keep asking
    expect(b.text).toBe("one two");
    await Bun.sleep(UNDO_ASK_PAUSE_MS);
    b.place(0, 0);                                                     // a click lets the question go too
    await undo(b);
    expect(b.text).toBe("one two");
    await Bun.sleep(UNDO_ASK_PAUSE_MS);
    await undo(b);                                                     // pressed again after a pause: it goes past the save
    expect(b.text).toBe("one");
    expect(b.dirty).toBe(true);                                        // against what's saved now
    expect(b.note).toContain("undid");
    // An agent never takes back saved text, and draft.undo past=true is the asked-for crossing.
    const c = new Draft("b1", 2, "one two");
    c.adopt(a.undos, 2);
    expect(visible(editHint(c, { save: "save" }))).toContain("^Z undo (asks: saved)");   // the keys line says it first
    await expect(DRAFT_ACTIONS.run("draft.undo", {}, c, { kind: "agent", id: "tidy" } as never)).rejects.toThrow();
    expect(DRAFT_ACTIONS.def("draft.undo")!.personWith!({ past: true })).toMatchObject({ always: expect.stringContaining("only the person") });
    expect(c.text).toBe("one two");
    expect(await DRAFT_ACTIONS.run("draft.undo", {}, c, USER)).toMatchObject({ asks: expect.stringContaining("revision 2 stays") });
    expect(c.text).toBe("one two");
    expect(await DRAFT_ACTIONS.run("draft.undo", { past: true }, c, USER)).toMatchObject({ undone: expect.stringContaining("undid"), redo: 1 });
    expect(c.text).toBe("one");
    // Only onto the text it ended on.
    const e = new Draft("b1", 2, "something else");
    e.adopt(a.undos, 2);
    expect(e.undos).toEqual([]);
  });
});

describe("a save and the agents' writes after it (PIE-1733)", () => {
  // CodeRabbit on #1435: the history's trim (UNDO_KEEP) never keeps an agent's write without the save it followed.
  test("trimmed from the bottom, a save goes with the agents' writes that followed it: undo never splits them", () => {
    const shedbot = { kind: "agent" as const, id: "shedbot/claude-code@box-a" };
    const steps: Step[] = [
      { before: "Bean rows", after: "Bean rows.", by: USER, what: "typing", at: 0, caret: 10, open: false, saved: 2 },
      { before: "Bean rows.", after: "Bean rows!", by: shedbot, what: "shedbot's edit", at: 0, caret: 10, open: false, follows: true },
    ];
    const d = new Draft("b1", 3, "Bean rows!");
    d.adopt(steps, 3);
    d.place(0, 10);
    for (let i = 0; i < 400 && d.undos.some(x => x.before === "Bean rows"); i++) type(d, " w");
    expect(d.undos.some(x => x.before === "Bean rows")).toBe(false);   // the save went past the history's end
    expect(d.undos.some(x => x.follows)).toBe(false);                   // and its agent's write with it
    for (let i = 0; i < 1000; i++) {
      try { d.undoStep(USER, true); }
      catch (e) { expect((e as Error).message).toContain("nothing to undo"); break; }
    }
  });
});

// PIE-1738: an undo or redo that puts back an ask with its answer lands at the ask's end, the answer folded; one that also
// puts back words after the answer (a paste's) lands after those, where typing goes on.
describe("where an undo or redo of an answered ask lands (PIE-1738)", () => {
  const answered = "@yo find the shed jobs\n> [!note]+ @yo answered\n> 1 note: Oil the hinges";
  test("a paste of an ask and its answer, redone: at the ask's end, its answer folded", async () => {
    const d = new Draft("n1", 1, "Shed\n");
    d.place(1, 0);
    await paste(d, answered);
    await undo(d);
    expect(d.text).toBe("Shed\n");
    await redo(d);
    expect([d.row, d.col]).toEqual([1, "@yo find the shed jobs".length]);
    expect(d.hiddenAnswerLines().size).toBeGreaterThan(0);
  });
  test("a paste with words after the answer, redone: after those words", async () => {
    const d = new Draft("n2", 1, "Shed\n");
    d.place(1, 0);
    await paste(d, `${answered}\nand then the gate`);
    await undo(d);
    await redo(d);
    expect([d.row, d.col]).toEqual([4, "and then the gate".length]);
  });
});

describe("selecting and copying by keys", () => {
  test("shift with an arrow, Home or End selects from the cursor; an arrow alone lets it go", () => {
    const d = new Draft("b1", 1, "[heading::waffle] for breakfast\nsecond");
    d.place(0, 0);
    for (let i = 0; i < 17; i++) d.key({ kind: "right", shift: true });
    expect(d.selectedText()).toBe("[heading::waffle]");
    d.key({ kind: "end", shift: true });
    expect(d.selectedText()).toBe("[heading::waffle] for breakfast");
    d.key({ kind: "down", shift: true });
    expect(d.selectedText()).toContain("\n");
    d.key({ kind: "left" });
    expect(d.selectedText()).toBeNull();
  });

  test("cmd+c and alt+c ask the host to copy; draft.copy returns the selection, never types", async () => {
    const d = new Draft("b1", 1, "copy me");
    d.place(0, 0); d.place(0, 4, true);
    expect(d.key({ kind: "super", ch: "c" })).toBe("copy");
    expect(d.key({ kind: "alt", ch: "c" })).toBe("copy");
    expect(d.text).toBe("copy me");
    expect(await DRAFT_ACTIONS.run("draft.copy", {}, d, USER)).toEqual({ text: "copy", chars: 4 });
  });

  test("changeOf finds the one changed span", () => {
    expect(changeOf("abcdef", "abXYef")).toEqual({ at: 2, removed: 2, added: 2 });
    expect(changeOf("aaa", "aaaa")).toEqual({ at: 3, removed: 0, added: 1 });
    expect(changeOf("x😀y", "x😃y").at).toBe(1);                         // never between a surrogate pair's halves
  });
});

describe.skipIf(!outliner)("against a scratch outline: past a save, and back to an earlier revision", () => {
  let scratch: Scratch, board: SocketBoard, sock = "";
  const flashes: string[] = [];
  const desk = () => ({
    ctx: { board, flash: (m: string) => flashes.push(m), redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    openFromTile() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi;
  const open = async (id: string) => {
    const pane = new ReaderPane(), d = desk();
    pane.show(await board.get(id), d);
    pane.key(char("e"), d);
    await until(() => pane.editing, "the draft to open");
    return { pane, d, draft: () => pane.surface.draft! };
  };
  const cli = async (args: string[]) => {
    const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", EP0CH_SOCKET: sock, EP0CH_WS: scratch.name } });
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    return { code: await p.exited, out, err };
  };

  beforeAll(async () => {
    scratch = new Scratch();
    sock = await scratch.start();
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(sock);
    await board.info();
  }, 20_000);
  afterAll(async () => { board?.close(); await scratch?.dispose(); delete process.env.EP0CH_STATE; });

  test("write, save, reopen, ctrl+z: the saved text stays; ctrl+z again goes past the save, said first (PIE-1414)", async () => {
    const b = await board.request("create", { parentId: null, text: "Jam labels", author: "user" });
    const a = await open(b.id);
    a.pane.key({ kind: "end" }, a.d);
    for (const c of " for the plums") a.pane.key(char(c), a.d);
    a.pane.key(ctrl("s"), a.d);
    await until(() => !a.pane.editing, "the save");
    const again = await open(b.id);
    again.pane.key(ctrl("z"), again.d);
    await until(() => again.draft().note.includes("saved"), "ctrl+z says the text is saved");
    expect(again.draft().text).toBe("Jam labels for the plums");
    expect(again.draft().dirty).toBe(false);
    await Bun.sleep(UNDO_ASK_PAUSE_MS);
    again.pane.key(ctrl("z"), again.d); again.pane.key(ctrl("z"), again.d); again.pane.key(ctrl("z"), again.d);
    await until(() => again.draft().text === "Jam labels", "asked, then back to where the first draft started");
    again.pane.key(ctrl("y"), again.d);
    await until(() => again.draft().text === "Jam labels for ", "redone a word");
    expect((await board.get(b.id))!.text).toBe("Jam labels for the plums");   // nothing saved changed
  }, 20_000);

  test("an agent's write after the save: one ctrl+z past it takes back both, said as both; ctrl+y puts both back (PIE-1733)", async () => {
    const b = await board.request("create", { parentId: null, text: "Bean rows\n@shedbot count them\n> [!note]+ @shedbot answered\n> 3 rows", author: "user" });
    const a = await open(b.id);
    a.pane.key({ kind: "end" }, a.d);
    for (const ch of " beds") a.pane.key(char(ch), a.d);               // a word typed, then
    a.draft().replace("Bean rows beds");                               // the ask taken out by mistake: a save of two steps
    a.pane.key(ctrl("s"), a.d);
    await until(() => !a.pane.editing, "the save");
    // The agent's write because of it (yo's drop is the service's, as ext:yo; any agent's write is carried the same).
    const saved = (await board.get(b.id))!;
    await board.request("update", { blockId: b.id, text: "Bean rows!", expectedRevision: saved.revision!, mutation: { author: "agent", actorId: "shedbot/claude-code@box-a" } });
    const again = await open(b.id);
    expect(again.draft().text).toBe("Bean rows!");
    expect(await DRAFT_ACTIONS.run("draft.undo", {}, again.draft(), USER)).toMatchObject({ asks: expect.stringContaining("your save and shedbot's edit") });
    const undone = await DRAFT_ACTIONS.run("draft.undo", { past: true }, again.draft(), USER) as { undone: string; redo: number };
    expect(undone.undone).toContain("undid your save and shedbot's edit");
    expect(undone.redo).toBe(3);
    expect(again.draft().text).toBe("Bean rows\n@shedbot count them\n> [!note]+ @shedbot answered\n> 3 rows");   // the save taken back whole
    const redone = await DRAFT_ACTIONS.run("draft.redo", {}, again.draft(), USER) as { redone: string; left: number };
    expect(redone).toMatchObject({ redone: "redid your save and shedbot's edit", left: 0 });
    expect(again.draft().text).toBe("Bean rows!");
    again.pane.key({ kind: "esc" }, again.d);
    await until(() => !again.pane.editing, "closed unchanged");
    // A person's write after the save (another door's) ends the history there: nothing of it is carried past.
    const c = await board.request("create", { parentId: null, text: "Pea sticks", author: "user" });
    const first = await open(c.id);
    first.pane.key({ kind: "end" }, first.d);
    for (const ch of " cut") first.pane.key(char(ch), first.d);
    first.pane.key(ctrl("s"), first.d);
    await until(() => !first.pane.editing, "the save");
    const mine = (await board.get(c.id))!;
    await board.request("update", { blockId: c.id, text: "Pea sticks cut short", expectedRevision: mine.revision!, mutation: { author: "user" } });
    const later = await open(c.id);
    expect(later.draft().undos).toEqual([]);
  }, 20_000);

  test("at 40 columns the undo ask reads whole, wrapped under the draft's status, never cut (PIE-1431)", async () => {
    const b = await board.request("create", { parentId: null, text: "Fig netting", author: "user" });
    const a = await open(b.id);
    a.pane.key({ kind: "end" }, a.d);
    for (const c of " before June") a.pane.key(char(c), a.d);
    a.pane.key(ctrl("s"), a.d);
    await until(() => !a.pane.editing, "the save");
    const again = await open(b.id);
    again.pane.key(ctrl("z"), again.d);
    await until(() => again.draft().note.includes("saved"), "ctrl+z asks");
    const said = again.draft().note;
    const rows = again.pane.render(40, 20, true, again.d).lines.map(l => visible(l).trimEnd());
    const at = rows.findIndex(r => r.startsWith("saved · ctrl+z again"));
    expect(at).toBeGreaterThan(-1);
    expect(rows.every(r => r.length <= 40)).toBe(true);
    // Its rows, joined, are the whole ask, its window counted down (PIE-1738).
    const joined = rows.slice(at, at + 4).join(" ").replace(/\s+/g, " ");
    expect(joined).toContain(said.replace(/\s+/g, " "));
    expect(joined).toMatch(/ctrl\+z again in [1-5]s undoes/);
  }, 20_000);

  test("a saved paste taken back: revision.restore puts the earlier text in the edit (one step), ctrl+s saves it; the CLI lists, prints and restores", async () => {
    const b = await board.request("create", { parentId: null, text: "Shed rota\nTuesdays: oil the hinges", author: "user" });
    const doc = Array.from({ length: 30 }, (_, i) => `- pantry line ${i}`).join("\n");
    const pasted = await board.update(b.id, `Shed rota\nTuesdays: oil the hinges\n${doc}`, b.revision) as { revision: number };
    // In the door: the edit, revision.restore (the tile menu's row), and the earlier text is in, as one step.
    const r = await open(b.id);
    const on = { surface: r.pane.surface, host: r.pane.host(r.d), standing: true };
    expect(await NOTE_ACTIONS.run("revision.restore", {}, on, USER)).toMatchObject({ revision: b.revision, current: pasted.revision });
    expect(r.draft().text).toBe("Shed rota\nTuesdays: oil the hinges");
    expect(r.draft().note).toContain(`revision ${b.revision} of ${pasted.revision}`);
    await expect(NOTE_ACTIONS.run("revision.restore", {}, on, USER)).rejects.toThrow("no revision before");
    r.pane.key(ctrl("z"), r.d);
    await until(() => r.draft().text.includes("pantry line 29"), "ctrl+z takes the earlier text back out");
    r.pane.key(ctrl("y"), r.d);
    await until(() => !r.draft().text.includes("pantry"), "and ctrl+y puts it in again");
    r.pane.key(ctrl("s"), r.d);
    await until(() => !r.pane.editing, "the save");
    expect((await board.get(b.id))!.text).toBe("Shed rota\nTuesdays: oil the hinges");
    // The CLI: the list, one revision's text, and --restore (itself a revision).
    const list = await cli(["revisions", b.id]);
    expect(list.code).toBe(0);
    expect(list.out.split("\n")[0]).toMatch(new RegExp(`^\\s+${pasted.revision + 1} now .* · 2 lines`));
    expect(list.out).toContain(`${pasted.revision}     `);
    const one = await cli(["revisions", b.id, String(pasted.revision)]);
    expect(one.out).toContain("pantry line 29");
    const back = await cli(["revisions", b.id, String(pasted.revision), "--restore"]);
    expect(back.out).toContain(`saved revision ${pasted.revision}'s text as revision ${pasted.revision + 2}`);
    expect((await board.get(b.id))!.text).toContain("pantry line 29");
    expect((await cli(["revisions", b.id, "--restore"])).code).toBe(2);
  }, 30_000);
});
