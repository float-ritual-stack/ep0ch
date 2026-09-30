// draft.patch (pi-herdr-outliner PIE-501): an agent's compare-and-swap on a span lands in the draft the person
// is typing in. The test line: the mark is the queue, you keep typing, the block keeps its id. The draft half
// runs anywhere; the rest starts a scratch outliner service (never a real outline) with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Draft } from "../src/edit";
import { SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, NOTE_ACTIONS, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { applyLocated, locateSpans } from "../src/vendor/draft-patch-compare";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const TIDY: Actor = { kind: "agent", id: "tidy" };
const span = (text: string, observed: string, replacement: string) => {
  const start = text.indexOf(observed);
  return { observed, replacement, range: { start, end: start + observed.length }, unit: "utf16" as const };
};

describe("the vendored compare", () => {
  const VENDORED = join(import.meta.dir, "../src/vendor/draft-patch-compare.ts");
  /** When pi-herdr-outliner changes src/draft-patch-compare.ts: copy it over the vendored file, and put its checksum here. */
  const PINNED_SHA256 = "4aaa4649bf63cd1a8a2d3ee2e6579e27aa8f053ac89d65f316bf09e1b5a3ba23";
  test("is the outliner's file, byte for byte", () => {
    expect(createHash("sha256").update(readFileSync(VENDORED)).digest("hex")).toBe(PINNED_SHA256);
    const theirs = outliner && join(outliner, "src/draft-patch-compare.ts");
    if (theirs && existsSync(theirs)) expect(readFileSync(VENDORED, "utf8")).toBe(readFileSync(theirs, "utf8"));
  });
});

describe("a patch in a draft being typed in", () => {
  const TEXT = "Morning plan\nThe beans   go along  the fence.\nwater  them ^beds\n\n@tidy tidy this\n";

  function typing() {
    const d = new Draft("note-1", 3, TEXT.replace(/\n$/, ""));
    d.lines.push("");
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
    expect(d.recordAs({ kind: "user" })).toEqual({ kind: "user", with: ["tidy"] });
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
    // Without a mark (an agent acting through `act`), the limit is the start of the cursor's block.
    expect(d.applyPatch({ patchId: "x", patches: [below], revision: 3 }, TIDY)).toMatchObject({ applied: false, reason: expect.stringContaining("the block being typed in") });
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

  test("ctrl+z takes the patch back as one unit, after more typing; an agent may only undo its own", async () => {
    const d = typing();
    const p = span(d.text, "The beans   go along  the fence.", "The beans go along the fence.");
    d.applyPatch({ patchId: "p1", patches: [p], revision: 3, mark: "@tidy tidy this" }, TIDY);
    for (const c of "more") d.key(char(c));
    const { DRAFT_ACTIONS } = await import("../src/edit");
    await expect(DRAFT_ACTIONS.run("draft.undo", {}, d, { kind: "agent", id: "someone-else" })).rejects.toThrow("this agent has no edit to undo");
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.text).toBe(TEXT + "more");
    expect(d.note).toBe("undid tidy's edit");
    expect(d.patches).toEqual([]);
    d.key(ctrl("z"));
    await Bun.sleep(0);
    expect(d.note).toBe("no agent edit to undo in this draft");
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
      env: { ...process.env, OUTLINER_STATE_DIR: join(scratch.root, "state"), OUTLINER_WORKSPACE_ROOT: scratch.workspace, XDG_CONFIG_HOME: join(scratch.root, "config"), OUTLINER_REMOTE: "1", OUTLINER_SOCKET_PATH: scratch.sock },
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
    await until(() => (board as any).drafts.get(id)?.holdId, "the service's hold");
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
    expect(e.s.render(50, 12, e.h).lines.map(visible).join("\n")).toContain("an agent (tidy) typed this");
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

  test("an overlapping edit fails cleanly into an embed in the draft, and A applies it anyway", async () => {
    const e = await editing(`Allotment\nThe peas   climb  the net.\n\n${tidyMark}\n`);
    const read = await agent.readDraft(e.id);
    expect(read.route).toBe("draft");
    const start = read.text.indexOf("The peas");
    const observed = "The peas   climb  the net.";
    // Evan edits that very sentence after the agent read it.
    e.d.place(1, 9); e.type("sugar ");
    e.d.place(e.d.lines.length - 1, 0);
    const r = await agent.request("draft.patch", {
      blockId: e.id, revision: read.revision, mark: { text: tidyMark }, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed, replacement: "The peas climb the net.", range: { start, end: start + observed.length }, unit: "utf16", before: read.text.slice(0, start), after: read.text.slice(start + observed.length, start + observed.length + 48) }],
    });
    expect(r).toMatchObject({ outcome: "proposed", reason: "the observed text isn't there any more", embedded: "draft" });
    expect(e.d.text).toContain(`${tidyMark}\n!((${r.proposalId}))`);
    expect(e.d.text).toContain("The peas sugar   climb  the net.");
    const proposal = (await board.get(r.proposalId))!;
    expect(proposal).toMatchObject({ parentId: e.id, props: { type: "draft-proposal", "proposal-status": "open" } });

    // Apply anyway: A on the proposal, in another reader. It lands in the draft being typed, as the person's.
    const reader = new NoteSurface(), h = host();
    reader.show(proposal, h);
    expect(reader.hint()).toContain("A apply anyway");
    reader.key(char("A"), h);
    await until(() => e.d.text.includes("The peas climb the net."), "the proposal applied in the draft");
    expect(e.d.text).not.toContain("sugar");
    expect((await board.get(r.proposalId))!.props["proposal-status"]).toBe("applied");
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
    expect((board as any).drafts.get(e.id)).toBeUndefined();
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
    expect(e.s.describe().editing).toMatchObject({ held: true, patches: [{ by: "tidy" }], lit: ["tidy · just now"] });
    expect(e.s.hint()).toContain("ctrl+z undo tidy's edit");
  }, 30_000);
});
