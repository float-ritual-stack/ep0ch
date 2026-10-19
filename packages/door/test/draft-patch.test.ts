// draft.patch (pi-herdr-outliner PIE-501): an agent's compare-and-swap on a span lands in the draft the person
// is typing in. The test line: the mark is the queue, you keep typing, the block keeps its id. The draft half
// runs anywhere; the rest starts a scratch outliner service (never a real outline) with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Draft } from "../src/edit";
import { recordAs } from "../src/draft-session";
import { ACTOR_ID, actorIdOf, mutationFor, USER, SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, NOTE_ACTIONS, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import { outliner, Scratch, until } from "./scratch";
import { prop } from "../src/props";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const TIDY: Actor = { kind: "agent", id: "tidy" };
/** The tidy extension's `@tidy` agent, as the service's draft.patch names it. */
const EXT_TIDY: Actor = { kind: "agent", id: "ext:tidy" };
const span = (text: string, observed: string, replacement: string) => {
  const start = text.indexOf(observed);
  return { observed, replacement, range: { start, end: start + observed.length }, unit: "utf16" as const };
};

describe("a patch in a draft being typed in", () => {
  const TEXT = "Morning plan\nThe beans   go along  the fence.\nwater  them ^beds\n\n@tidy tidy this\n";

  function typing() {
    const d = new Draft("note-1", 3, TEXT);
    d.row = d.lines.length - 1; d.col = 0;
    d.render(40, 6);                                                     // laid out, as on screen
    return d;
  }

  test("keeps typing below while a tidy lands above: nothing jumps, and the typed text is all there", () => {
    const d = typing();
    const typed = "and then I sow the peas";
    const screenRow = () => { d.render(40, 6); return d.cursorRow; };
    for (const c of typed.slice(0, 8)) d.key(char(c));
    const before = screenRow();
    const p = span(d.text, "The beans   go along  the fence.\nwater  them ^beds", "The beans go along the fence.\nwater them ^beds");
    expect(d.applyPatch({ patchId: "p1", patches: [p], revision: 3, mark: "@tidy tidy this" }, TIDY)).toEqual({ applied: true });
    expect(screenRow()).toBe(before);
    for (const c of typed.slice(8)) { d.key(char(c)); expect(screenRow()).toBe(before); }
    expect(d.text).toBe("Morning plan\nThe beans go along the fence.\nwater them ^beds\n\n@tidy tidy this\nand then I sow the peas");
    expect(d.lines[d.row]).toBe(typed);
    expect(d.col).toBe(typed.length);
    // Who made it is lit where it landed, and the save names both of them.
    expect(d.render(60, 8).map(visible).join("\n")).toContain("@tidy · just now");
    expect(recordAs(d, { kind: "user" })).toEqual({ kind: "user", with: ["tidy"] });
  });

  test("a draft only an extension's @agent changed saves as the saver's, naming it: never as ext:<id> (PIE-510)", () => {
    const d = typing();
    const p = span(d.text, "The beans   go along  the fence.", "The beans go along the fence.");
    expect(d.applyPatch({ patchId: "e1", patches: [p], revision: 3, mark: "@tidy tidy this" }, EXT_TIDY)).toEqual({ applied: true });
    expect(d.writers).toEqual([EXT_TIDY]);
    expect(recordAs(d, { kind: "user" })).toEqual({ kind: "user", with: ["ext:tidy"] });
    expect(mutationFor(recordAs(d, { kind: "user" }))).toEqual({ author: "user", actorId: `${ACTOR_ID}+ext:tidy` });
    expect(recordAs(d, { kind: "agent", id: "helper-7" })).toEqual({ kind: "agent", id: "helper-7", with: ["ext:tidy"] });
    // An agent that alone wrote is still the one a save is recorded as.
    const a = typing();
    a.applyPatch({ patchId: "a1", patches: [span(a.text, "The beans   go along  the fence.", "The beans go along the fence.")], revision: 3, mark: "@tidy tidy this" }, TIDY);
    expect(recordAs(a, { kind: "user" })).toEqual(TIDY);
  });

  test("a line the patch adds above moves the cursor's line down in the text, but not on screen", () => {
    const d = typing();
    for (const c of "peas") d.key(char(c));
    d.render(40, 6);
    const row = d.cursorRow, line = d.row;
    const p = span(d.text, "Morning plan", "Morning plan\n\nToday");
    expect(d.applyPatch({ patchId: "p2", patches: [p], revision: 3, mark: "@tidy tidy this" }, TIDY).applied).toBe(true);
    expect(d.row).toBe(line + 2);
    d.render(40, 6);
    expect(d.cursorRow).toBe(row);
  });

  test("refuses what would reach the mark, the cursor's passage or text the person changed, and says why", () => {
    const d = typing();
    for (const c of "peas") d.key(char(c));
    const below = span(d.text, "peas", "beans");
    expect(d.applyPatch({ patchId: "x", patches: [below], revision: 3, mark: "@tidy tidy this" }, TIDY)).toMatchObject({ applied: false, reason: expect.stringContaining("the mark or below") });
    // Without a mark (an agent's ordinary edit) the only limit is the block being typed in: above or below it lands.
    const besideCursor = new Draft("note-5", 3, "Status\n\n- Next: label  trays\n- Mood: steady");
    besideCursor.place(2, 5);
    expect(besideCursor.applyPatch({ patchId: "x", patches: [span(besideCursor.text, "Mood: steady", "Mood: busy")], revision: 3 }, TIDY)).toEqual({ applied: true });
    expect(besideCursor.applyPatch({ patchId: "w", patches: [span(besideCursor.text, "Status", "Status today")], revision: 3 }, TIDY)).toEqual({ applied: true });
    expect(besideCursor.applyPatch({ patchId: "y", patches: [span(besideCursor.text, "label  trays", "label trays")], revision: 3 }, TIDY))
      .toMatchObject({ applied: false, reason: "it changes the block being typed in" });
    expect(d.applyPatch({ patchId: "x", patches: [span(d.text, "Morning", "Evening")], revision: 2 }, TIDY)).toMatchObject({ applied: false, reason: expect.stringContaining("revision 3") });
    expect(d.applyPatch({ patchId: "x", patches: [span(d.text, "Morning", "Evening")], revision: 3, mark: "@nobody" }, TIDY)).toMatchObject({ applied: false, reason: "the mark isn't in the draft" });
    // The person changed the passage: the compare fails.
    const stale = span(d.text, "The beans   go", "The beans go");
    d.place(1, 4); for (const c of "runner ") d.key(char(c));
    d.place(d.lines.length - 1, 4);
    expect(d.applyPatch({ patchId: "x", patches: [stale], revision: 3, mark: "@tidy tidy this" }, TIDY)).toMatchObject({ applied: false, reason: "the observed text isn't there any more" });
    d.place(1, 12);
    expect(d.applyPatch({ patchId: "x", patches: [span(d.text, "runner beans", "beans")], revision: 3, mark: "@tidy tidy this" }, TIDY)).toMatchObject({ applied: false, reason: "the cursor is in that passage" });
  });

  test("apply anyway (forced) skips the revision and cursor checks, but never reaches the mark", () => {
    const d = typing();
    d.place(1, 6);                                                        // the cursor in the passage
    const above = span(d.text, "The beans   go along  the fence.", "The beans go along the fence.");
    expect(d.applyPatch({ patchId: "f1", patches: [above], revision: 1, mark: "@tidy tidy this", force: true }, { kind: "user" })).toEqual({ applied: true });
    const below = span(d.text, "@tidy tidy this", "@tidy tidied");
    expect(d.applyPatch({ patchId: "f2", patches: [below], revision: 1, mark: "@tidy tidy this", force: true }, { kind: "user" })).toEqual({ applied: false, reason: "it reaches the mark or below it; a patch changes only text above the mark" });
    // A mark line the person took out holds nothing back.
    const gone = new Draft("note-2", 3, "Morning plan\nwater  them");
    expect(gone.applyPatch({ patchId: "f3", patches: [span(gone.text, "water  them", "water them")], revision: 1, mark: "@tidy tidy this", force: true }, { kind: "user" })).toEqual({ applied: true });
  });

  test("ctrl+z takes back the newest change, typing then the patch as one unit; an agent may only undo its own", async () => {
    const d = typing();
    const p = span(d.text, "The beans   go along  the fence.", "The beans go along the fence.");
    d.applyPatch({ patchId: "p1", patches: [p], revision: 3, mark: "@tidy tidy this" }, TIDY);
    for (const c of "more") d.key(char(c));
    const { DRAFT_ACTIONS } = await import("../src/edit");
    await expect(DRAFT_ACTIONS.run("draft.undo", {}, d, { kind: "agent", id: "someone-else" })).rejects.toThrow("this agent has no edit to undo");
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.text).toBe(TEXT.replace("The beans   go along  the fence.", "The beans go along the fence."));
    expect(d.note).toContain("undid typing");
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.text).toBe(TEXT);
    expect(d.note).toContain("undid tidy's edit");
    expect(d.patches).toEqual([]);
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.note).toBe("nothing to undo in this draft");
    // ctrl+y puts them back in order, the patch a patch again.
    d.key(ctrl("y"));
    await Bun.sleep(0);
    expect(d.note).toBe("redid tidy's edit");
    expect(d.patches.map(u => u.patchId)).toEqual(["p1"]);
    d.key({ kind: "char", ch: "z", ctrl: true, shift: true });
    await Bun.sleep(0);
    expect(d.text).toBe(TEXT.replace("The beans   go along  the fence.", "The beans go along the fence.") + "more");
  });

  test("an agent's undo takes back its own newest step, else its own patch where it is now", async () => {
    const d = typing();
    const { DRAFT_ACTIONS } = await import("../src/edit");
    d.applyPatch({ patchId: "p1", patches: [span(d.text, "The beans   go along  the fence.", "The beans go along the fence.")], revision: 3, mark: "@tidy tidy this" }, TIDY);
    for (const c of "more") d.key(char(c));
    // Not tidy's newest step (the person typed since): its patch, taken back where it is now; the typing stays.
    await DRAFT_ACTIONS.run("draft.undo", {}, d, TIDY);
    expect(d.text).toBe(TEXT + "more");
    // The person's ctrl+z: the taking back was the newest change.
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.text).toBe(TEXT.replace("The beans   go along  the fence.", "The beans go along the fence.") + "more");
    // Putting back its own taking back is tidy's; the person's typing isn't.
    await DRAFT_ACTIONS.run("draft.redo", {}, d, TIDY);
    expect(d.text).toBe(TEXT + "more");
    for (const c of "!") d.key(char(c));
    d.key(ctrl("z"));
    await Bun.sleep(0);
    await expect(DRAFT_ACTIONS.run("draft.redo", {}, d, TIDY)).rejects.toThrow("an agent redoes only its own");
  });

  test("undo finds its patch after the person typed far above it, and after a later patch moved it", () => {
    const d = typing();
    const p = span(d.text, "water  them ^beds", "water them ^beds");
    d.applyPatch({ patchId: "p1", patches: [p], revision: 3, mark: "@tidy tidy this" }, TIDY);
    d.applyPatch({ patchId: "p2", patches: [span(d.text, "Morning plan", "Morning plan for the long bed")], revision: 3, mark: "@tidy tidy this" }, TIDY);
    // The person goes up and writes a long paragraph above both.
    d.place(0, 0);
    for (const c of "x".repeat(300) + " ") d.key(char(c));
    d.key({ kind: "enter" } as Key);
    d.place(d.lines.length - 1, 0);
    expect(d.revertPatch("p1", { kind: "user" })).toBe(true);
    expect(d.text).toContain("water  them ^beds");
    expect(d.text).toContain("Morning plan for the long bed");
  });

  test("with the cursor gone back above the mark, a patch stops at the block being typed in", () => {
    const d = new Draft("note-3", 3, "Intro\n\nfirst  para\n\nsecond  para\n\n@tidy go\nbelow");
    d.place(2, 3);                                                      // typing in "first  para"
    expect(d.applyPatch({ patchId: "x", patches: [span(d.text, "second  para", "second para")], revision: 3, mark: "@tidy go" }, TIDY))
      .toMatchObject({ applied: false, reason: expect.stringContaining("the block being typed in") });
    // Below the mark, the mark is the limit, even with no blank line between the text and the mark.
    const m = new Draft("note-4", 3, "Plan\nbeans   here\n@tidy go\nand I keep");
    m.place(3, 10);
    expect(m.applyPatch({ patchId: "y", patches: [span(m.text, "beans   here", "beans here")], revision: 3, mark: "@tidy go" }, TIDY)).toEqual({ applied: true });
  });

  test("the compare the door runs is the service's: the same spans apply the same way", () => {
    const text = "Crème brûlée ^dessert\nnext";
    const located = locateSpans(text, [{ observed: "brûlée", replacement: "brulee", range: { start: 7, end: 15 }, unit: "utf8" }]);
    expect(located.ok && applyLocated(text, located.spans)).toBe("Crème brulee ^dessert\nnext");
  });
});

describe.skipIf(!outliner)("draft.patch between a scratch service and the door", () => {
  const scratch = new Scratch();
  let board: SocketBoard, agent: SocketBoard;
  const flashes: string[] = [];
  const host = (): SurfaceHost => ({
    ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate() {},
  });
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "user" })).id as string;
  const tidyMark = "@tidy can you tidy this so far";
  /** The proof agent: `outliner patch-demo`, as its own process, as the agent would run it. */
  const patchDemo = async (id: string) => {
    const p = Bun.spawn(["bun", "src/cli.ts", "patch-demo", "--block", id, "--tidy-above", tidyMark], {
      cwd: outliner!, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock },
    });
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    if ((await p.exited) !== 0) throw new Error(err || out);
    return JSON.parse(out);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});
    agent = new SocketBoard(scratch.sock);
    await agent.info();
  });
  afterAll(async () => { board?.close(); agent?.close(); await scratch.dispose(); });

  async function editing(text: string) {
    const id = await create(text);
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    await s.edit(h);
    const d = s.draft!;
    d.row = d.lines.length - 1; d.col = d.lines[d.row]!.length;
    await until(() => s.describe().editing!.held && d !== null, "the draft held");
    await until(() => !!board.heldDraft(id)?.holdId, "the service's hold");
    const type = (str: string) => { for (const c of str) s.key(char(c), h); };
    return { id, s, h, d, type };
  }

  test("anchored append through the agent CLI lands in a held draft even at its cursor", async () => {
    const e = await editing("Garden\n\nLog entry. ^log\n\nTyping here.");
    const saved = (await board.get(e.id))!;
    e.type(" More words.");
    const append = async (at = "^log") => {
      const p = Bun.spawn(["bun", "src/cli.ts", "agent", "edit", "--actor", "gardener", "--json", JSON.stringify({ ref: e.id, expectedRevision: saved.revision, append: "Another entry\nSecond line", at })], {
        cwd: outliner!, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock },
      });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(err).toBe("");
      expect(code).toBe(0);
      return JSON.parse(out);
    };
    const first = await append();
    expect(first).toMatchObject({ outcome: "applied" });
    expect(e.d.text).toContain("Another entry");
    expect(e.d.text).toContain("Typing here. More words.");
    expect((await board.get(e.id))!.text).toBe(saved.text);
    await NOTE_ACTIONS.run("draft.place", { line: e.d.lines.findIndex(l => l.includes("Another entry")) + 1, col: 5 }, { surface: e.s, host: e.h }, USER);
    expect(await append(`^${first.anchor}`)).toMatchObject({ outcome: "applied" });
    e.s.dispose();
  });

  test("Evan keeps typing; the tidy above lands in his draft, nothing jumps, the saved note waits for his save", async () => {
    const e = await editing(`Morning plan [page::morning plan]\nThe beans   go along  the fence. ^deep-link\nwater  them\n\n${tidyMark}\n`);
    const saved = (await board.get(e.id))!;
    e.type("and I keep");
    e.s.render(50, 12, e.h);
    const row = e.d.cursorRow;
    // Where the typing line is in the reader's frame: the frame never grows a row when the agent writes.
    const frameRow = () => e.s.render(50, 12, e.h).lines.findIndex(l => visible(l).includes("and I keep"));
    const was = frameRow();
    const typing = (async () => { for (const c of " typing below") { e.type(c); await Bun.sleep(3); } })();
    const r = await patchDemo(e.id);
    await typing;
    expect(r).toMatchObject({ read: "draft", outcome: "applied", edits: [{ blockId: e.id, route: "draft" }] });
    expect(e.d.text).toBe(`Morning plan [page::morning plan]\nThe beans go along the fence. ^deep-link\nwater them\n\n${tidyMark}\nand I keep typing below`);
    e.s.render(50, 12, e.h);
    expect(e.d.cursorRow).toBe(row);
    expect(frameRow()).toBe(was);
    // The demo's actor: `patch-demo` (pi-herdr-outliner PIE-510), `tidy` before it.
    expect(e.s.render(50, 12, e.h).lines.map(visible).join("\n")).toMatch(/an agent \((patch-demo|tidy)\) typed this/);
    expect((await board.get(e.id))!.text).toBe(saved.text);
    // His save carries both: one write, the block keeps its id, and note A's deep links still resolve.
    const a = await create(`Note A\nsee [[morning plan]] and ((${e.id}^deep-link))`);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, { kind: "user" });
    const after = (await board.get(e.id))!;
    expect(after.id).toBe(e.id);
    expect(after.text).toContain("The beans go along the fence. ^deep-link");
    expect((await board.request("pages.resolve", { address: "morning plan" })).block.id).toBe(e.id);
    expect((await board.request("fragments.read", { blockId: e.id, fragmentId: "deep-link" })).status).toBe("resolved");
    expect((await board.get(a))!.text).toContain(`((${e.id}^deep-link))`);
  }, 30_000);

  test("rich tables: streamed rows remain editable while the current cell stays put", async () => {
    const e = await editing("Seed plan\n| Crop | Count |\n| --- | --- |\n| Beans | 2 |\n\n@tidy add a table\n");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    await NOTE_ACTIONS.run("rich.move", { direction: "down" }, { surface: e.s, host: e.h }, USER);
    const position = { row: e.d.row, col: e.d.col };
    const read = await agent.readDraft(e.id);
    const graph = `::graph-table\n---\nheaders: [Crop, Count]\nrows:\n  - ["Peas", 'O''Brien']\n---\n::`;
    const r = await agent.request("draft.patch", {
      blockId: e.id, revision: read.revision, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed: "@tidy add a table", replacement: "@tidy add a table\n\n" + graph }],
    });
    expect(r).toMatchObject({ outcome: "applied" });
    expect({ row: e.d.row, col: e.d.col }).toEqual(position);
    expect(e.s.render(80, 30, e.h).lines.map(visible).join("\n")).toContain("an agent (tidy) typed this");
    const { elementEdit } = await import("../src/surface/element-editor");
    expect(elementEdit(e.d).elements()).toHaveLength(2);
    e.s.key({ kind: "paste", text: "Green | yellow" }, e.h);
    expect(e.d.text).toContain("| Green \\| yellowBeans |");
    const g = elementEdit(e.d).elements()[1]!;
    await NOTE_ACTIONS.run("draft.place", { line: g.fields[1]![1]!.line + 1, col: g.fields[1]![1]!.end + 1 }, { surface: e.s, host: e.h }, USER);
    e.type("x");
    expect(elementEdit(e.d).current()?.field.value).toBe("O'Brienx");
    await NOTE_ACTIONS.run("draft.place", { line: g.fields[1]![0]!.line + 1, col: g.fields[1]![0]!.start + 1 }, { surface: e.s, host: e.h }, USER);
    e.type('"');
    e.s.key({ kind: "backspace" }, e.h);
    expect(elementEdit(e.d).elements()).toHaveLength(2);
    await NOTE_ACTIONS.run("rich.set", { value: "Radish" }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "home" }, e.h);
    e.s.key({ kind: "end", shift: true }, e.h);
    e.s.key({ kind: "delete" }, e.h);
    expect(elementEdit(e.d).current()?.field.value).toBe("");
    await NOTE_ACTIONS.run("rich.set", { value: "Radish\nSpring" }, { surface: e.s, host: e.h }, USER);
    await NOTE_ACTIONS.run("rich.change", { op: "column.add" }, { surface: e.s, host: e.h }, USER);
    expect(elementEdit(e.d).elements()[1]!.fields[1]![0]!.value).toBe("Radish\nSpring");
    await NOTE_ACTIONS.run("rich.set", { value: "one two three four five six" }, { surface: e.s, host: e.h }, USER);
    const view = elementEdit(e.d);
    const drawn = view.render(26, 30, (text, width) => e.s.snippetDoc(text, width)).map(visible);
    const y = drawn.findIndex(line => line.includes("six"));
    expect(y).toBeGreaterThan(1);
    view.click(drawn[y]!.indexOf("six"), y, (action, args = {}) => {
      void NOTE_ACTIONS.run(action as any, args as any, { surface: e.s, host: e.h }, USER);
    });
    e.type("X");
    expect(view.current()?.field.value).toBe("one two three four five Xsix");

    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain("Radish");
  });

  test("rich tables: reordered YAML keeps headers and the selected row aligned", async () => {
    const e = await editing('Inventory\n::graph-table\n---\nrows:\n  - ["Beans", "2"]\n  - ["Peas", "3"]\nheaders: ["Crop", "Count"]\n---\n::\n');
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    expect(elementEdit(e.d).current()?.field.value).toBe("Crop");
    e.s.key({ kind: "down" }, e.h);
    e.s.key({ kind: "alt", ch: "d" }, e.h);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    const saved = (await board.get(e.id))!.text;
    expect(saved).toContain('Peas');
    expect(saved).not.toContain("Beans");
  });

  test("rich tables: typing words at a cell's end stays in rich edit and saves", async () => {
    const e = await editing("Inventory\n| Crop | Count |\n| --- | --- |\n| Beans | 2 |\n");
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "down" }, e.h);
    e.s.key({ kind: "end" }, e.h);
    e.type(" green beans");
    expect(elementEdit(e.d).on).toBe(true);
    expect(elementEdit(e.d).current()?.field.value).toBe("Beans green beans");
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain("| Beans green beans | 2 |");
  });

  test("rich tables: backspace removes one literal apostrophe", async () => {
    const e = await editing("Inventory\n| Crop | Count |\n| --- | --- |\n| O''Brien | 2 |\n");
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "down" }, e.h);
    const field = elementEdit(e.d).current()!.field;
    await NOTE_ACTIONS.run("draft.place", { line: field.line + 1, col: field.start + 4 }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "backspace" }, e.h);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain("| O'Brien | 2 |");
  });

  test("rich tables: replacing an unquoted graph cell keeps it editable", async () => {
    const e = await editing('Inventory\n::graph-table\n---\nheaders: [Crop, Count]\nrows:\n  - [Beans, 2]\n---\n::\n');
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "down" }, e.h);
    e.s.key({ kind: "home" }, e.h);
    e.s.key(ctrl("k"), e.h);
    e.type("Beans");
    e.s.key({ kind: "home" }, e.h);
    e.s.key({ kind: "end", shift: true }, e.h);
    e.s.key({ kind: "delete" }, e.h);
    e.type("Peas");
    expect(elementEdit(e.d).on).toBe(true);
    expect(elementEdit(e.d).current()?.field.value).toBe("Peas");
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain('["Peas", 2]');
  });

  test.each([false, true])("PIE-920: a patch above a rich table keeps its row still (raw first=%s)", async raw => {
    const e = await editing("Inventory\nBefore the table.\n\n| Crop | Count |\n| --- | --- |\n" + Array.from({length: 20}, (_, i) => `| Crop ${i} | ${i} |`).join("\n"));
    if (raw) e.s.render(60, 12, e.h);
    await NOTE_ACTIONS.run("rich.toggle", {on: true}, {surface:e.s, host:e.h}, USER);
    await NOTE_ACTIONS.run("draft.place", {line: e.d.lines.findIndex(l => l.includes("Crop 10")) + 1, col: 3}, {surface:e.s, host:e.h}, USER);
    const rows = () => e.s.render(60, 12, e.h).lines.map(visible);
    const y = rows().findIndex(l => l.includes("Crop 10"));
    expect(y).toBeGreaterThan(1);
    const result = await agent.request("draft.patch", {blockId:e.id, revision:e.d.base,
      patches:[{observed:"Before the table.", replacement:"Before the table.\nAdded above.\nAnother line."}], mutation:{author:"agent", actorId:"tidy"}});
    expect(result).toMatchObject({outcome:"applied"});
    expect(rows().findIndex(l => l.includes("Crop 10"))).toBe(y);
  });

  test("rich tables scroll beyond separators without returning to the first row (PIE-920)", async () => {
    const e = await editing("Inventory\n| Crop | Count |\n| --- | --- |\n" + Array.from({ length: 20 }, (_, i) => `| Crop ${i} | ${i} |`).join("\n"));
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    const view = elementEdit(e.d);
    const draw = () => view.render(40, 8, (text, width) => e.s.snippetDoc(text, width)).map(visible).join("\n");
    draw();
    for (let i = 0; i < 20; i++) { view.scroll(1); draw(); }
    expect(draw()).toContain("Crop 10");
  });

  test("rich tables: clicking an escaped pipe keeps the column whole while typing", async () => {
    const e = await editing("Inventory\n| Crop | Count |\n| --- | --- |\n| A\\|B | 2 |\n");
    const { elementEdit } = await import("../src/surface/element-editor");
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "down" }, e.h);
    const view = elementEdit(e.d);
    const lines = view.render(70, 20, (text, width) => e.s.snippetDoc(text, width)).map(visible);
    const y = lines.findIndex(line => line.includes("A\\|B"));
    expect(y).toBeGreaterThan(1);
    view.click(lines[y]!.indexOf("A\\|B") + 2, y, (action, args = {}) => {
      void NOTE_ACTIONS.run(action as any, args as any, { surface: e.s, host: e.h }, USER);
    });
    e.type("x");
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain("| Ax\\|B | 2 |");
  });

  test("rich tables: structural edits preserve all source outside the changed rows", async () => {
    const prefix = 'Inventory\nBefore  the figure.\n::graph-table\n\n---\ntitle: Keep  this title\nheaders: [Crop, Count] # header comment\n# before rows\nrows:\n';
    const rows = '  - [Beans, 2] # first row\n# between rows\n  - [Peas, 3] # second row\n';
    const suffix = '# after rows\n\ncaption: |\n  Keep this caption.\n---\nrows: keep this sentence  \nheaders: [This, is, prose]\n\n::\nAfter  the figure.\n';
    const cases = [
      { op: "row.add", changed: rows.replace(' # first row\n', ' # first row\n  - ["",""]\n') },
      { op: "row.remove", changed: rows.replace('  - [Beans, 2] # first row\n', '') },
      { op: "row.move", to: 2, changed: '  - [Peas, 3] # second row\n# between rows\n  - [Beans, 2] # first row\n' },
      { op: "column.add", changed: rows.replace('[Beans, 2]', '["Beans","","2"]').replace('[Peas, 3]', '["Peas","","3"]'), header: '["Crop","","Count"]' },
      { op: "column.remove", changed: rows.replace('[Beans, 2]', '["2"]').replace('[Peas, 3]', '["3"]'), header: '["Count"]' },
      { op: "column.move", to: 1, changed: rows.replace('[Beans, 2]', '["2","Beans"]').replace('[Peas, 3]', '["3","Peas"]'), header: '["Count","Crop"]' },
    ];
    for (const c of cases) {
      const e = await editing(prefix + rows + suffix);
      await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
      e.s.key({ kind: "down" }, e.h);
      await NOTE_ACTIONS.run("rich.change", { op: c.op, to: c.to }, { surface: e.s, host: e.h }, USER);
      await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
      expect((await board.get(e.id))!.text).toBe((c.header ? prefix.replace('[Crop, Count]', c.header) : prefix) + c.changed + suffix);
    }
  });

  test("rich tables: removing the last graph row and adding one keeps surrounding source", async () => {
    const source = 'Inventory\n::graph-table\n---\nheaders: [Crop, Count]\nrows: [] # keep list comment\n# keep this too\n---\nrows: prose\n::\n';
    for (const empty of ["[]", "[ ]"]) {
      const e = await editing(source.replace("rows: []", `rows: ${empty}`));
      await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
      await NOTE_ACTIONS.run("rich.change", { op: "row.add" }, { surface: e.s, host: e.h }, USER);
      expect(e.d.text).toBe(source.replace("rows: [] # keep list comment\n", 'rows: # keep list comment\n  - ["",""]\n'));
      await NOTE_ACTIONS.run("rich.change", { op: "row.remove" }, { surface: e.s, host: e.h }, USER);
      await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
      expect((await board.get(e.id))!.text).toBe(source);
    }
  });

  test("rich tables: entering rich edit releases a raw selection outside the cell", async () => {
    const source = 'Inventory\nKeep this prose.\n| Crop | Count |\n| --- | --- |\n| Beans | 2 |\nAfter the table.\n';
    const e = await editing(source);
    await NOTE_ACTIONS.run("draft.place", { line: 2, col: 1 }, { surface: e.s, host: e.h }, USER);
    await NOTE_ACTIONS.run("draft.place", { line: 5, col: 3, extend: true }, { surface: e.s, host: e.h }, USER);
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "paste", text: "Green " }, e.h);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toBe(source.replace('Beans', 'Green Beans'));
  });

  test("rich tables: cell edits preserve YAML comments and prose byte for byte", async () => {
    const source = 'Inventory\nBefore  the figure.\n::graph-table\n---\nheaders: [Crop, Count]\nrows:\n  - [Beans, 2] # keep this comment\n---\nrows: keep this sentence  \nheaders: [This, is, prose]\n::\nAfter  the figure.\n';
    const e = await editing(source);
    await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    e.s.key({ kind: "down" }, e.h);
    await NOTE_ACTIONS.run("rich.set", { value: "Peas" }, { surface: e.s, host: e.h }, USER);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toBe(source.replace('[Beans, 2]', '["Peas", 2]'));
  });

  test("a component adapter edits and saves through the reader's draft", async () => {
    const { registerElementEditor } = await import("../src/surface/element-editor");
    const { componentBlocks } = await import("@ep0ch/outline-core/component-block");
    const unregister = registerElementEditor({
      id: "seed-label",
      read(lines) {
        return componentBlocks(lines).filter(b => b.name === "seed-label").map(b => ({
          start: b.start, end: b.end + 1,
          fields: [[{ line: b.start + 1, start: 0, end: lines[b.start + 1]!.length, value: lines[b.start + 1]! }]],
          encode: value => value.replace(/\n/g, " "),
          change: () => null,
          draw(values, width) {
            const text = values[0]![0]!;
            return { lines: [text], cells: [{ row: 0, col: 0, x: 0, y: 0, width, offset: 0, inset: 0, text }] };
          },
        }));
      },
    });
    try {
      const e = await editing("Garden label\n::seed-label\nBeans\n::");
      await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
      e.type("Runner ");
      await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
      expect((await board.get(e.id))!.text).toContain("::seed-label\nRunner Beans\n::");
    } finally { unregister(); }
  });

  /** tidy's patch of the sentence in a draft Evan has open, sent while his cursor is in it: it becomes a proposal beside the note, and his draft is as he typed it (PIE-725). */
  async function proposedInDraft(e: Awaited<ReturnType<typeof editing>>, typeInIt = false) {
    const read = await agent.readDraft(e.id);
    expect(read.route).toBe("draft");
    const start = read.text.indexOf("The peas");
    const observed = "The peas   climb  the net.";
    // Evan is in that very sentence when it comes (with `typeInIt`, he rewords it after the agent read it).
    e.d.place(1, 9);
    if (typeInIt) e.type("sugar ");
    const r = await agent.request("draft.patch", {
      blockId: e.id, revision: read.revision, mark: { text: tidyMark }, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed, replacement: "The peas climb the net.", range: { start, end: start + observed.length }, unit: "utf16", before: read.text.slice(0, start), after: read.text.slice(start + observed.length, start + observed.length + 48) }],
    });
    expect(r).toMatchObject({ outcome: "proposed", beside: e.id });
    expect(e.d.text).not.toContain(r.proposalId);
    e.d.place(e.d.lines.length - 1, 0);
    return r.proposalId as string;
  }

  test("PIE-1065: an append proposal offers apply and lands at the end of the draft", async () => {
    const e = await editing("Garden\nMy words.");
    const result = await agent.request("draft.patch", { blockId: e.id, revision: e.d.base,
      patches: [{ observed: "", replacement: "\nA proposed addition." }], propose: "always",
      mutation: { author: "agent", actorId: "tidy" } });
    const proposal = (await board.get(result.proposalId))!;
    const reader = new NoteSurface(), h = host();
    reader.show(proposal, h);
    expect(reader.render(100, 40, h).lines.map(visible).join("\n")).toContain("[apply]");
    expect(proposal.text).toContain("at the end of the block");
    reader.key(char("A"), h);
    await until(() => e.d.text.endsWith("\nA proposed addition."), "the append applied");
    expect(e.d.text).toBe("Garden\nMy words.\nA proposed addition.");
    e.s.dispose();
  });

  test("an edit at the cursor fails cleanly into a proposal beside the note, and A applies it anyway in the draft", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const id = await proposedInDraft(e);
    expect(e.d.text).toContain("The peas   climb  the net.");
    const proposal = (await board.get(id))!;
    expect([proposal.parentId, prop(proposal, "type"), prop(proposal, "proposal-status")]).toEqual([e.id, "draft-proposal", "open"]);

    // Apply anyway: A on the proposal, in another reader. It lands in the draft being typed, as the person's.
    const reader = new NoteSurface(), h = host();
    reader.show(proposal, h);
    expect(reader.hint()).toContain("A apply anyway");
    reader.key(char("A"), h);
    await until(() => e.d.text.includes("The peas climb the net."), "the proposal applied in the draft");
    expect(prop((await board.get(id))!, "proposal-status")).toBe("applied");
  }, 30_000);

  test("one whose passage was reworded before it came offers only dismiss: A says why, X dismisses it and the draft is as typed", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const id = await proposedInDraft(e, true);
    const proposal = (await board.get(id))!;
    expect(prop(proposal, "proposal-applies")).toBe("no");
    const reader = new NoteSurface(), h = host();
    reader.show(proposal, h);
    const header = reader.render(90, 30, h).lines.map(visible).slice(0, 8).join("\n");
    expect(header).toContain("proposal · [dismiss]");
    expect(header).not.toContain("[apply]");
    expect(reader.hint()).toContain("X dismiss");
    expect(reader.hint()).not.toContain("A apply");
    flashes.length = 0;
    expect(reader.key(char("A"), h)).toBe(true);
    await until(() => flashes.length > 0, "A's refusal");
    expect(flashes.at(-1)).toContain("can't be applied");
    expect(e.d.text).toContain("The peas sugar   climb  the net.");
    reader.key(char("X"), h);
    await until(() => !!flashes.at(-1)?.startsWith("dismissed the proposal"), "the dismissal");
    expect(flashes.at(-1)).not.toContain("embed line");
    expect(e.d.text).toBe(`Allotment\nThe peas sugar   climb  the net.\n\n${tidyMark}\n`);
    { const gone = (await board.get(id))!; expect([gone.deleted, prop(gone, "proposal-status")]).toEqual([true, "dismissed"]); }
  }, 30_000);

  test("what an agent did to a draft is noted while it's open, gone once saved, and in the past once put aside", async () => {
    // Saved: the words go with the draft.
    const a = await editing(`Seeds\nsow   them\n\n${tidyMark}\n`);
    await patchDemo(a.id);
    const said = (s: NoteSurface, h: SurfaceHost) => s.render(80, 20, h).lines.map(visible).join("\n");
    expect(a.s.agent?.did).toBe("edited text above your cursor");
    await NOTE_ACTIONS.run("edit.save", {}, { surface: a.s, host: a.h }, { kind: "user" });
    expect(a.s.draft).toBeNull();
    expect(said(a.s, a.h)).not.toMatch(/an agent \((patch-demo|tidy)\)/);
    // Put aside (closed with its changes kept as unsent): said in the past, with no cursor in it.
    const b = await editing(`Bulbs\nplant   deep\n\n${tidyMark}\n`);
    await patchDemo(b.id);
    expect(b.s.agent?.did).toBe("edited text above your cursor");
    NOTE_ACTIONS.run("edit.close", { discard: true }, { surface: b.s, host: b.h }, { kind: "user" });
    const now = said(b.s, b.h);
    expect(now).toMatch(/an agent \((patch-demo|tidy)\) edited the draft you put aside/);   // patch-demo since pi-herdr-outliner PIE-510
    expect(now).not.toContain("your cursor");
  }, 30_000);

  test("an agent dismissing its own proposal from a draft is said as that, not as applying it", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const id = await proposedInDraft(e, true);
    // As a proposal from before PIE-725 left it: its embed line under the mark, in the draft being typed.
    e.d.replace(e.d.text.replace(tidyMark, `${tidyMark}\n!((${id}))`));
    const r = await agent.request("draft.proposal.dismiss", { proposalId: id, mutation: { author: "agent", actorId: "tidy" } });
    expect(r).toMatchObject({ outcome: "dismissed", embedRemoved: "draft" });
    expect(e.d.text).not.toContain(`!((${id}))`);
    expect(e.s.agent?.did).toBe("took a dismissed proposal's line out of your draft");
  }, 30_000);

  test("the person saves a draft only @tidy's extension changed: the service takes it as theirs, naming ext:tidy (PIE-510)", async () => {
    const e = await editing(`Shed list\nthe  rake   and the hoe\n\n${tidyMark}\n`);
    // What the service's extension runtime sends as the tidy extension's patch (a client can't name ext:tidy).
    e.d.replace(e.d.text.replace("the  rake   and the hoe", "the rake and the hoe"), EXT_TIDY);
    const since = board.lastSequence ?? 0;
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, { kind: "user" });
    expect((await board.get(e.id))!.text).toContain("the rake and the hoe");
    const changes = (await board.request<any>("changes.since", { sequence: since, limit: 50 })).changes as any[];
    expect(changes.find(c => c.blockId === e.id && c.kind === "edit")?.actor).toMatchObject({ author: "user", actorId: `${ACTOR_ID}+ext:tidy` });
  }, 30_000);

  test("an extension's action updates the note while the person types: it lands in the draft as ext:<id>, and their save is theirs, naming it", async () => {
    // A fixture extension whose action tidies the note's double spaces (an `update`, applied through draft.patch).
    const dir = join(scratch.workspace, "extensions", "spacer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "spacer", version: 1, name: "Spacer", run: ["bun", "spacer.ts"],
      actions: [{ id: "tidy", label: "Tidy spaces", on: "block", effects: "write" }],
    }));
    writeFileSync(join(dir, "spacer.ts"), `const r = await Bun.stdin.json();
const t = r.input.target, text = r.input.context.block.text;
process.stdout.write(JSON.stringify({ ok: true, value: { message: "tidied", writes: [{ op: "update", blockId: t.blockId, expectedRevision: t.revision, text: text.replace(/ {2,}/g, " ") }] } }));`);
    const end = Date.now() + 15_000;
    while (!(await board.listExtensions(true))?.extensions.some(e => e.id === "spacer" && e.state === "active") && Date.now() < end) await Bun.sleep(100);
    const e = await editing("Bike shed\nthe  pump   and the tubes\n\nstill to list:\n");
    e.type("lights");
    const since = board.lastSequence ?? 0;
    // An agent runs it, as itself: who asked goes with it; the edit is the extension's.
    await agent.actExtension("spacer", "tidy", { blockId: e.id }, { kind: "agent", id: "helper-510" });
    await until(() => e.d.text.includes("the pump and the tubes"), "the tidy in the draft");
    expect(e.d.text).toBe("Bike shed\nthe pump and the tubes\n\nstill to list:\nlights");
    expect(e.d.writers).toEqual([{ kind: "user" }, { kind: "agent", id: "ext:spacer" }]);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, { kind: "user" });
    expect((await board.get(e.id))!.text).toBe("Bike shed\nthe pump and the tubes\n\nstill to list:\nlights");
    const changes = (await board.request<any>("changes.since", { sequence: since, limit: 50 })).changes as any[];
    expect(changes.filter(c => c.blockId === e.id && c.kind === "edit").at(-1)?.actor).toMatchObject({ author: "user", actorId: `${ACTOR_ID}+ext:spacer` });
    // Only the extension wrote it this time: still saved as the person's, naming the extension.
    const only = await editing("Tool wall\nthe  saw  and the plane\n");
    await agent.actExtension("spacer", "tidy", { blockId: only.id }, { kind: "user" });
    await until(() => only.d.text.includes("the saw and the plane"), "the tidy in the second draft");
    expect(only.d.writers).toEqual([{ kind: "agent", id: "ext:spacer" }]);
    await NOTE_ACTIONS.run("edit.save", {}, { surface: only.s, host: only.h }, { kind: "user" });
    expect((await board.get(only.id))!.text).toContain("Tool wall\nthe saw and the plane");
  }, 30_000);

  test("an @tidy line the person writes in a held draft runs before any save (drafts.touch), and lands in the draft (F1)", async () => {
    const d = new Draft("note-x", 1, "Plan");
    let touched = 0;
    d.onPersonTyped = () => touched++;
    d.replace("Plan\nmore", TIDY);
    expect(touched).toBe(0);                                              // an agent's patch never touches
    d.replace("Plan\nmore\nmine");
    expect(touched).toBe(1);
    cpSync(join(outliner!, "extensions", "tidy"), join(scratch.workspace, "extensions", "tidy"), { recursive: true });
    const end = Date.now() + 15_000;
    while (!(await board.listExtensions(true))?.extensions.some(e => e.id === "tidy" && e.state === "active") && Date.now() < end) await Bun.sleep(100);
    const e = await editing("Bench list\n");
    e.type("the  vice   and the clamps");
    e.d.newline(false); e.s.render(50, 12, e.h);
    e.type("@tidy");
    const saved = (await board.get(e.id))!.text;
    await until(() => e.d.text.includes("the vice and the clamps"), "@tidy's answer in the draft", 20_000);
    expect(e.d.writers.map(actorIdOf)).toContain("ext:tidy");
    expect((await board.get(e.id))!.text).toBe(saved);                    // nothing saved yet: it waits for the person
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, { kind: "user" });
    expect((await board.get(e.id))!.text).toContain("the vice and the clamps\n@tidy");
  }, 40_000);

  async function gardener() {
    const dir = join(scratch.workspace, "extensions", "gardener");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "gardener", version: 1, name: "Gardener", run: ["bun", "run.ts"],
      agents: [{ name: "gardener", effects: "write" }],
    }));
    writeFileSync(join(dir, "run.ts"), 'await Bun.stdin.text(); console.log(JSON.stringify({ok: true, value: {reply: "Sow the peas.\\nWater the beds."}}));');
    const loaded = Date.now() + 15_000;
    while (!(await board.listExtensions(true))?.extensions.some(e => e.id === "gardener" && e.state === "active") && Date.now() < loaded) await Bun.sleep(100);
    expect((await board.listExtensions(true))?.extensions.find(e => e.id === "gardener")?.state).toBe("active");
  }

  async function streamingGardener(chunks = ["Sow the peas.", "\n\nWater the beds."]) {
    await gardener();
    const gate = join(scratch.root, `answer-finish-${crypto.randomUUID()}`);
    writeFileSync(join(scratch.workspace, "extensions", "gardener", "run.ts"), `
      import { existsSync } from "node:fs";
      await Bun.stdin.text();
      console.log(JSON.stringify({ reply: ${JSON.stringify(chunks[0])} }));
      while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(20);
      console.log(JSON.stringify({ reply: ${JSON.stringify(chunks[1])} }));
      console.log(JSON.stringify({ ok: true, value: {} }));
    `);
    await board.listExtensions(true);
    return gate;
  }

  test.each([" My addition.", "\n> My addition."])("streaming stops when the person extends the answer (%j)", async addition => {
    const gate = await streamingGardener();
    const e = await editing("Changed answer\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("Keep writing");
    try {
      await until(() => e.d.text.includes("Sow the peas."), "the first chunk", 8000);
      const at = e.d.lines.findIndex(line => line.includes("Sow the peas."));
      e.d.place(at, e.d.lines[at]!.length); e.s.key({ kind: "paste", text: addition }, e.h);
      e.d.place(e.d.lines.length - 1, e.d.lines.at(-1)!.length);
      writeFileSync(gate, "finish");
      await until(() => ["replied", "failed"].includes(e.d.asks.get("@gardener plan the beds")?.state ?? ""), "the stream to settle");
      expect(e.d.text).toContain("Sow the peas." + addition);
      expect(e.d.text).not.toContain("Water the beds.");
    } finally { writeFileSync(gate, "finish"); }
  }, 20000);

  test("an existing quotation below an ask survives every streamed chunk", async () => {
    const gate = await streamingGardener();
    const e = await editing("Quoted garden\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("> My existing quotation");
    try {
      await until(() => e.d.text.includes("Sow the peas."), "the first chunk", 8000);
      const at = e.d.lines.findIndex(line => line === "> My existing quotation");
      e.d.place(at, e.d.lines[at]!.length); e.type(" keeps growing");
      writeFileSync(gate, "finish");
      await until(() => ["replied", "failed"].includes(e.d.asks.get("@gardener plan the beds")?.state ?? ""), "the stream to settle");
      expect(e.d.text).toContain("Water the beds.");
      expect(e.d.text).toContain("> My existing quotation keeps growing");
      e.d.undo({ kind: "agent", id: "ext:gardener" });
      expect(e.d.text).not.toContain("Sow the peas.");
      expect(e.d.text).not.toContain("Water the beds.");
      expect(e.d.text).toContain("> My existing quotation keeps growing");
    } finally { writeFileSync(gate, "finish"); }
  }, 20000);

  test("streamed credentials stay redacted across reply chunks", async () => {
    const gate = await streamingGardener(["First paragraph.\n\nfictional-garden-", "credential Done."]);
    const folder = join(scratch.workspace, "extensions", "gardener");
    const secret = join(scratch.root, "fictional-key");
    writeFileSync(secret, "fictional-garden-credential", { mode: 0o600 });
    const manifest = JSON.parse(readFileSync(join(folder, "extension.json"), "utf8"));
    writeFileSync(join(folder, "extension.json"), JSON.stringify({ ...manifest, secrets: { example: "Fictional test key" } }));
    writeFileSync(join(folder, "config.json"), JSON.stringify({ secrets: { example: { file: secret } } }));
    await board.listExtensions(true);
    const e = await editing("Redacted answer\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("Keep writing");
    try {
      await until(() => e.d.text.includes("First paragraph."), "the safe first paragraph", 8000);
      writeFileSync(gate, "finish");
      await until(() => e.d.text.includes("Done."), "the completed answer");
      expect(e.d.text).not.toContain("fictional-garden-credential");
      expect(e.d.text).toContain("[redacted] Done.");
    } finally { writeFileSync(gate, "finish"); writeFileSync(join(folder, "config.json"), "{}"); }
  }, 20000);

  test.each(["agent", "person"])("an answer streams through the held draft before the agent exits, with one undo step (%s)", async who => {
    const gate = await streamingGardener();
    const e = await editing("Streaming garden\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("Keep writing");
    const row = () => { e.s.render(70, 18, e.h); return e.d.cursorRow; };
    const anchor = row();
    try {
      await until(() => e.d.text.includes("Sow the peas."), "the first chunk before the process exits", 6000);
      expect(e.d.text).not.toContain("Water the beds.");
      expect(row()).toBe(anchor);
      e.type(" while it answers");
      writeFileSync(gate, "finish");
      await until(() => e.d.text.includes("Water the beds."), "the second chunk");
      expect(row()).toBe(anchor);
      expect(e.d.writers.map(actorIdOf)).toContain("ext:gardener");
      if (who === "agent") e.d.undo({ kind: "agent", id: "ext:gardener" });
      else {
        while (e.d.undoable === "typing") e.d.undo(USER);
        e.d.undo(USER);
      }
      expect(e.d.text).not.toContain("Sow the peas.");
      expect(e.d.text).not.toContain("Water the beds.");
      expect(e.d.text).toContain(who === "agent" ? "Keep writing while it answers" : "Keep writing");
      if (who === "person") {
        e.d.redo(USER);
        expect(e.d.text).toContain("Sow the peas.");
        expect(e.d.text).toContain("Water the beds.");
        while (e.d.redos.length) e.d.redo(USER);
        expect(e.d.text).toContain("Keep writing while it answers");
      }
    } finally { writeFileSync(gate, "finish"); }
  }, 20_000);

  test("a copied answer stops streaming rather than leaving stale undo snapshots", async () => {
    const gate = await streamingGardener();
    const e = await editing("Copied answer\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("Keep writing");
    try {
      await until(() => e.d.text.includes("Sow the peas."), "the first chunk", 8000);
      const answer = e.d.text.slice(e.d.text.indexOf("@gardener"), e.d.text.indexOf("\nKeep writing"));
      e.s.key({ kind: "paste", text: "\n" + answer + "\nAfter the copy" }, e.h);
      writeFileSync(gate, "finish");
      await until(() => ["replied", "failed"].includes(e.d.asks.get("@gardener plan the beds")?.state ?? ""), "the stream to settle");
      expect(e.d.text).not.toContain("Water the beds.");
      e.d.undo(USER);
      expect(e.d.text).not.toContain("After the copy");
      expect(e.d.text).toContain("Sow the peas.");
    } finally { writeFileSync(gate, "finish"); }
  }, 20000);

  test("undoing a paste above a streaming ask keeps the whole answer", async () => {
    const gate = await streamingGardener();
    const e = await editing("Moved ask\n\n");
    e.type("@gardener plan the beds"); e.d.newline(false); e.type("Keep writing");
    e.s.key({ kind: "paste", text: "\n" + "A later thought. ".repeat(100) }, e.h);
    try {
      await until(() => e.d.text.includes("Sow the peas."), "the first chunk", 8000);
      e.d.place(0, 0);
      e.s.key({ kind: "paste", text: "A long earlier thought. ".repeat(30) + "\n" }, e.h);
      e.d.place(e.d.lines.length - 1, e.d.lines.at(-1)!.length);
      writeFileSync(gate, "finish");
      await until(() => e.d.text.includes("Water the beds."), "the moved answer's second chunk");
      e.d.undo(USER);
      expect(e.d.text).not.toContain("A long earlier thought.");
      expect(e.d.text).toContain("Water the beds.");
      e.d.undo(USER);
      expect(e.d.text).not.toContain("Sow the peas.");
    } finally { writeFileSync(gate, "finish"); }
  }, 20000);

  test("the installed margin agent streams its answer command into an inline ask", async () => {
    const folder = join(scratch.workspace, "extensions", "marginalia");
    cpSync(join(outliner!, "extensions", "marginalia"), folder, { recursive: true });
    const gate = join(scratch.root, "margin-finish");
    const command = join(scratch.root, "margin-answer.ts");
    writeFileSync(command, `import { existsSync } from "node:fs";
      await Bun.stdin.text(); process.stdout.write("Plant peas.");
      while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(20);
      process.stdout.write(" Then water.");`);
    writeFileSync(join(folder, "config.json"), JSON.stringify({ config: { answer: ["bun", command] } }));
    await board.listExtensions(true);
    const e = await editing("Margin garden\n\n");
    e.type("@margin plan the beds"); e.d.newline(false); e.type("My next thought");
    try {
      await until(() => e.d.text.includes("Plant peas."), "the answer command's first bytes", 8000);
      expect(e.d.text).not.toContain("Then water.");
      e.type(" stays here");
      writeFileSync(gate, "finish");
      await until(() => e.d.text.includes("Then water."), "the answer command's remaining bytes");
      expect(e.d.text).toContain("My next thought stays here");
      expect(e.d.writers.map(actorIdOf)).toContain("ext:marginalia");
    } finally { writeFileSync(gate, "finish"); }
  }, 20000);

  test.each([false, true])("an ask's reply lands under its line while typing continues (rich=%s)", async rich => {
    await gardener();
    const e = await editing("Garden\n\n");
    e.type("@gardener plan the beds");
    e.d.newline(false);
    if (rich) {
      e.s.key({ kind: "paste", text: "\n| Work |\n| --- |\n| Still writing |" }, e.h);
      e.d.place(e.d.lines.length - 1, 15);
      await NOTE_ACTIONS.run("rich.toggle", { on: true }, { surface: e.s, host: e.h }, USER);
    } else e.type("Still writing");
    const frameRow = () => e.s.render(70, 18, e.h).lines.findIndex(l => visible(l).includes("Still writing"));
    const row = frameRow();
    const untilReply = Date.now() + 8_000;
    while (!e.d.text.includes("Sow the peas.") && Date.now() < untilReply) {
      e.type(".");
      expect(frameRow()).toBe(row);
      e.s.key({ kind: "backspace" }, e.h);
      await Bun.sleep(100);
    }
    expect(e.d.text).toContain("Sow the peas.");
    expect(e.d.text.indexOf("Sow the peas.")).toBeGreaterThan(e.d.text.indexOf("@gardener plan the beds"));
    expect(frameRow()).toBe(row);
    expect(e.s.render(70, 18, e.h).lines.map(visible).join("\n")).not.toContain("Sow the peas.");
    const answerLine = e.d.answerFolds()[0]!.line + 1;
    await NOTE_ACTIONS.run("fold.toggle", { line: answerLine }, { surface: e.s, host: e.h }, USER);
    expect(e.s.render(70, 18, e.h).lines.map(visible).join("\n")).toContain("Sow the peas.");
    await NOTE_ACTIONS.run("fold.toggle", { line: answerLine }, { surface: e.s, host: e.h }, USER);
    expect(e.s.render(70, 18, e.h).lines.map(visible).join("\n")).not.toContain("Sow the peas.");
    if (!rich) {
      await NOTE_ACTIONS.run("draft.place", { line: answerLine - 1, col: 1 }, { surface: e.s, host: e.h }, USER);
      expect(e.s.render(70, 18, e.h).lines.map(visible).join("\n")).toContain("Sow the peas.");
      await NOTE_ACTIONS.run("fold.toggle", { line: answerLine }, { surface: e.s, host: e.h }, USER);
      expect(e.s.render(70, 18, e.h).lines.map(visible).join("\n")).not.toContain("Sow the peas.");
    }
    expect(e.d.writers.map(actorIdOf)).toContain("ext:gardener");
    expect((await board.get(e.id))!.text).toBe("Garden\n\n");
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, USER);
    expect((await board.get(e.id))!.text).toContain("Sow the peas.");
  }, 20_000);

  test.skipIf(!Bun.which("tmux"))("a real pane keeps its typing row while the answer streams beside it", async () => {
    const gate = await streamingGardener();
    const id = await create("Pane garden");
    const socket = join(scratch.root, "tmux.sock");
    const env = { ...process.env, ...scratch.env, EP0CH_STATE: join(scratch.root, "pane-state"),
      EP0CH_CONTROL: join(scratch.root, "pane.sock"), EP0CH_DAEMON: "0", EP0CH_DAILY_AGENT: "sh" };
    mkdirSync(env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    const tmux = (...args: string[]) => {
      const r = Bun.spawnSync(["tmux", "-S", socket, ...args], { env, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString();
    };
    tmux("new-session", "-d", "-s", "asks", "-x", "120", "-y", "40", "bun", join(import.meta.dir, "../src/main.ts"), "--ws", "scratch", "--screen", "detail", id);
    const capture = () => tmux("capture-pane", "-p", "-t", "asks");
    try {
      await until(() => capture().includes("Pane garden"), "the pane's reader", 15_000);
      tmux("send-keys", "-t", "asks", "e");
      await until(() => capture().includes("editing"), "the pane's editor");
      tmux("send-keys", "-t", "asks", "C-e", "Enter");
      tmux("send-keys", "-t", "asks", "-l", "@gardener plan the beds");
      tmux("send-keys", "-t", "asks", "Enter");
      tmux("send-keys", "-t", "asks", "-l", "Keep typing here");
      await until(() => capture().includes("Keep typing here"), "the typed line");
      const row = capture().split("\n").findIndex(l => l.includes("Keep typing here"));
      let arrived = false;
      for (let i = 0; i < 70; i++) {
        tmux("send-keys", "-t", "asks", "-l", ".");
        await Bun.sleep(80);
        const frame = capture();
        expect(frame.split("\n").findIndex(l => l.includes("Keep typing here"))).toBe(row);
        tmux("send-keys", "-t", "asks", "BSpace");
        if (frame.includes("Sow the peas.")) { arrived = true; break; }
      }
      expect(arrived).toBe(true);
      expect(capture()).not.toContain("Water the beds.");
      await until(() => capture().includes("working · 1 block"), "the working status");
      tmux("send-keys", "-t", "asks", "-l", " and more");
      await until(() => capture().includes("and more"), "typing between chunks");
      writeFileSync(gate, "finish");
      await until(() => capture().includes("Water the beds."), "the second chunk beside the draft");
      expect(capture().split("\n").findIndex(l => l.includes("Keep typing here"))).toBe(row);
      await until(() => capture().includes("2 blocks"), "the final paragraph count");
      console.log("PIE-903 real pane:\n" + capture());
      tmux("send-keys", "-t", "asks", "C-s");
      const end = Date.now() + 5_000;
      while (!(await board.get(id))!.text.includes("Keep typing here") && Date.now() < end) await Bun.sleep(50);
      expect((await board.get(id))!.text).toContain("Sow the peas.");
      expect((await board.get(id))!.text).toContain("Keep typing here");
    } finally { writeFileSync(gate, "finish"); tmux("kill-session", "-t", "asks"); }
  }, 30_000);

  test("a closed draft lets go of its hold: the next patch goes to the saved note", async () => {
    const e = await editing("Compost\nturn  it   weekly");
    NOTE_ACTIONS.run("edit.close", { discard: true }, { surface: e.s, host: e.h }, { kind: "user" });
    await Bun.sleep(100);
    const m = (await board.get(e.id))!;
    const r = await agent.request("draft.patch", { blockId: e.id, revision: m.revision, patches: [span(m.text, "turn  it   weekly", "turn it weekly")], mutation: { author: "agent", actorId: "tidy" } });
    expect(r).toMatchObject({ outcome: "applied", edits: [{ route: "saved" }] });
    expect((await board.get(e.id))!.text).toBe("Compost\nturn it weekly");
  }, 30_000);

  test("a reader closed with its draft lets go of the hold: no patch lands in a draft no one can see", async () => {
    const e = await editing("Beds\nrake  them   flat");
    e.s.dispose();
    await Bun.sleep(100);
    expect(board.heldDraft(e.id)).toBeNull();
    const m = (await board.get(e.id))!;
    const r = await agent.request("draft.patch", { blockId: e.id, revision: m.revision, patches: [span(m.text, "rake  them   flat", "rake them flat")], mutation: { author: "agent", actorId: "tidy" } });
    expect(r).toMatchObject({ outcome: "applied", edits: [{ route: "saved" }] });
    expect(e.d.text).toBe("Beds\nrake  them   flat");
  }, 30_000);

  test("A is apply anyway only on a proposal; elsewhere the key isn't taken", async () => {
    const id = await create("Plain note\nnothing proposed here");
    const reader = new NoteSurface(), h = host();
    reader.show((await board.get(id))!, h);
    expect(reader.key(char("A"), h)).toBe(false);
    expect(reader.hint()).not.toContain("apply anyway");
  }, 30_000);

  test("peek says the draft is held, where the cursor is, and which patches it can undo", async () => {
    const e = await editing(`Seeds\nsow   them\n\n${tidyMark}\n`);
    await patchDemo(e.id);
    const by = e.s.describe().editing!.patches[0]?.by ?? "";
    expect(["patch-demo", "tidy"]).toContain(by);                        // `patch-demo` since pi-herdr-outliner PIE-510
    expect(e.s.describe().editing).toMatchObject({ held: true, patches: [{ by }], lit: [`${by} · just now`] });
    expect(e.s.hint()).toContain(`ctrl+z undo ${by}'s edit`);
  }, 30_000);
});
