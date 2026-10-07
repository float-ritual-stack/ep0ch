// PIE-621: a draft's one history (undo and redo for every change), its keyboard selection and its copy keys.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BIG_PASTE_LINES, changeOf, Draft, DRAFT_ACTIONS, TYPING_PAUSE_MS } from "../src/edit";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { SocketBoard, USER } from "../src/socket";
import { pasteKeys, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string, shift?: true): Key => ({ kind: "char", ch, ctrl: true, ...(shift ? { shift } : {}) });
const type = (d: Draft, s: string) => { for (const c of s) d.key(c === "\n" ? { kind: "enter" } : char(c)); };
/** A paste as the App types it out: every key at once, the draft's step recorded once they're all in. */
const paste = async (d: Draft, text: string) => { for (const k of pasteKeys(text)) d.key(k); await Bun.sleep(0); };
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

  test("a paste typed out key by key is one step, however big, and a big one says so", async () => {
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

  test("a key straight after a typed-out paste (before it's recorded) makes the paste its step first: ctrl+z takes back the paste, not the word before it", async () => {
    const d = new Draft("b1", 1, "");
    type(d, "word ");
    for (const k of pasteKeys("abc")) d.key(k);
    d.key(ctrl("z"));                                                  // no await between: the paste's microtask hasn't run
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
    d.rebase({ id: "b1", text: "new from elsewhere", props: {}, revision: 2 } as never);
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

  test("a history carried over (a save, then the note opened again unchanged) goes on back past it", async () => {
    const a = new Draft("b1", 1, "one");
    a.place(0, 3);
    type(a, " two");
    const b = new Draft("b1", 2, "one two");
    b.adopt(a.undos);
    await undo(b);
    expect(b.text).toBe("one");
    expect(b.dirty).toBe(true);                                        // against what's saved now
    // Only onto the text it ended on.
    const c = new Draft("b1", 2, "something else");
    c.adopt(a.undos);
    expect(c.undos).toEqual([]);
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

describe.skipIf(!outliner)("against a scratch outline: undo past a save", () => {
  let scratch: Scratch, board: SocketBoard, sock = "";
  const flashes: string[] = [];
  const desk = () => ({
    ctx: { board, flash: (m: string) => flashes.push(m), redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    current: null, setCurrent() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi;
  const open = async (id: string) => {
    const pane = new ReaderPane(), d = desk();
    pane.show(await board.get(id), d);
    pane.key(char("e"), d);
    await until(() => pane.editing, "the draft to open");
    return { pane, d, draft: () => pane.surface.draft! };
  };
  beforeAll(async () => {
    scratch = new Scratch();
    sock = await scratch.start();
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(sock);
    await board.info();
  }, 20_000);
  afterAll(async () => { board?.close(); await scratch?.dispose(); delete process.env.EP0CH_STATE; });

  test("undo survives a save: the note opened again unchanged, ctrl+z goes on back past it", async () => {
    const b = await board.request("create", { parentId: null, text: "Jam labels", author: "user" });
    const a = await open(b.id);
    a.pane.key({ kind: "end" }, a.d);
    for (const c of " for the plums") a.pane.key(char(c), a.d);
    a.pane.key(ctrl("s"), a.d);
    await until(() => !a.pane.editing, "the save");
    const again = await open(b.id);
    expect(again.draft().undos.length).toBeGreaterThan(0);
    again.pane.key(ctrl("z"), again.d); again.pane.key(ctrl("z"), again.d); again.pane.key(ctrl("z"), again.d);
    await until(() => again.draft().text === "Jam labels", "back to where the first draft started");
    again.pane.key(ctrl("y"), again.d);
    await until(() => again.draft().text === "Jam labels for ", "redone a word");
  }, 20_000);

});
