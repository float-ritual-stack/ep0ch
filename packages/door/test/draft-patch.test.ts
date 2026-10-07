// draft.patch (pi-herdr-outliner PIE-501): an agent's compare-and-swap on a span lands in the draft the person
// is typing in. The test line: the mark is the queue, you keep typing, the block keeps its id. The draft half
// runs anywhere; the rest starts a scratch outliner service (never a real outline) with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Draft } from "../src/edit";
import { recordAs } from "../src/draft-session";
import { ACTOR_ID, actorIdOf, mutationFor, SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, NOTE_ACTIONS, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import { outliner, Scratch, until } from "./scratch";

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

  test("a proposal's embed line goes under the mark; typing at the very end carries on before it", () => {
    const d = new Draft("note-1", 3, "Plan\nstill typing");
    d.row = 1; d.col = d.lines[1]!.length;
    d.insertLine("!((prop-1))", "@tidy nowhere", TIDY);
    for (const c of " here") d.key(char(c));
    expect(d.text).toBe("Plan\nstill typing here\n!((prop-1))");
    const m = new Draft("note-2", 3, "Plan\n@tidy go\nbelow");
    m.row = 2; m.col = 5;
    m.insertLine("!((prop-2))", "@tidy go", TIDY);
    expect(m.text).toBe("Plan\n@tidy go\n!((prop-2))\nbelow");
    expect([m.row, m.col]).toEqual([3, 5]);
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

  /** tidy's patch of the sentence in a draft Evan has open, sent while his cursor is in it: it becomes a proposal embedded in the draft. */
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
    expect(r).toMatchObject({ outcome: "proposed", embedded: "draft" });
    expect(e.d.text).toContain(`${tidyMark}\n!((${r.proposalId}))`);
    e.d.place(e.d.lines.length - 1, 0);
    return r.proposalId as string;
  }

  test("an edit at the cursor fails cleanly into an embed in the draft, and A applies it anyway", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const id = await proposedInDraft(e);
    expect(e.d.text).toContain("The peas   climb  the net.");
    const proposal = (await board.get(id))!;
    expect(proposal).toMatchObject({ parentId: e.id, props: { type: "draft-proposal", "proposal-status": "open" } });

    // Apply anyway: A on the proposal, in another reader. It lands in the draft being typed, as the person's.
    const reader = new NoteSurface(), h = host();
    reader.show(proposal, h);
    expect(reader.hint()).toContain("A apply anyway");
    reader.key(char("A"), h);
    await until(() => e.d.text.includes("The peas climb the net."), "the proposal applied in the draft");
    expect((await board.get(id))!.props["proposal-status"]).toBe("applied");
  }, 30_000);

  test("one whose passage was reworded before it came offers only dismiss: A says why, X takes its line out of the draft", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const id = await proposedInDraft(e, true);
    const proposal = (await board.get(id))!;
    expect(proposal.props["proposal-applies"]).toBe("no");
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
    await until(() => !e.d.text.includes(`!((${id}))`), "its embed line out of the draft");
    expect(flashes.at(-1)).toContain("its embed line is out of the draft being written");
    expect(e.d.text).toBe(`Allotment\nThe peas sugar   climb  the net.\n\n${tidyMark}\n`);
    expect((await board.get(id))!).toMatchObject({ deleted: true, props: { "proposal-status": "dismissed" } });
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
    e.type("@tidy tidy the line above");
    const saved = (await board.get(e.id))!.text;
    await until(() => e.d.text.includes("the vice and the clamps"), "@tidy's answer in the draft", 20_000);
    expect(e.d.writers.map(actorIdOf)).toContain("ext:tidy");
    expect((await board.get(e.id))!.text).toBe(saved);                    // nothing saved yet: it waits for the person
    await NOTE_ACTIONS.run("edit.save", {}, { surface: e.s, host: e.h }, { kind: "user" });
    expect((await board.get(e.id))!.text).toContain("the vice and the clamps\n@tidy tidy the line above");
  }, 40_000);

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
