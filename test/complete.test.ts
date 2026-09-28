// Reference completion in the door's editor (PIE-416): [[, (( and [file:: offer what the service's
// lookups find, the way Tree, Detail and Quick Capture do, and insert the same syntax. The popup never
// keeps a key it doesn't use. Everything here runs on a scratch service with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommentSession } from "../src/comment";
import { completionTargetAtCursor, fragmentCandidates, pageAddressCompletion } from "../src/completion";
import { Draft } from "../src/edit";
import { Refused, SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { COMPLETION_HINT, completerFor, completionKey, completionOf } from "../src/surface/completer";
import { editHint } from "../src/surface/editor";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const K = (kind: "up" | "down" | "enter" | "esc" | "tab" | "left" | "right" | "end"): Key => ({ kind } as Key);
const AGENT: Actor = { kind: "agent", id: "claude-7" };

describe("the pure half, as the outliner has it", () => {
  test("the token at the cursor: innermost unclosed [[, (( or [file::, and what a choice replaces", () => {
    expect(completionTargetAtCursor("see [[PIE-4", 11)).toEqual({ kind: "page", start: 4, end: 11, query: "PIE-4" });
    expect(completionTargetAtCursor("see [[done]] and ((bea", 22)).toEqual({ kind: "block", start: 17, end: 22, query: "bea" });
    expect(completionTargetAtCursor("open [file::notes/p", 19)).toEqual({ kind: "file", start: 5, end: 19, query: "notes/p" });
    // A closing delimiter already after the cursor is part of what's replaced.
    expect(completionTargetAtCursor("x [[see]] y", 7)).toEqual({ kind: "page", start: 2, end: 9, query: "see" });
    expect(completionTargetAtCursor("[[closed]] after", 16)).toBeNull();
  });

  test("a Work ID inserts [[WORK-ID|title]], a page [[address]]; a title with link delimiters drops the label", () => {
    const w = { address: "HOME-001", blockId: "b", kind: "work-id", title: "Oil the hinges" };
    expect(pageAddressCompletion(w, "HOME-0", "HOME").insertion).toBe("[[HOME-001|Oil the hinges]]");
    expect(pageAddressCompletion(w, "HOME-001|the squeak", "HOME").insertion).toBe("[[HOME-001|the squeak]]");
    expect(pageAddressCompletion({ ...w, title: "Oil [[the]] hinges" }, "HOME", "HOME").insertion).toBe("[[HOME-001]]");
    expect(pageAddressCompletion({ address: "seeds", blockId: "b", kind: "page", title: "Seed list" }, "se", "HOME")).toEqual({ label: "seeds · Seed list", insertion: "[[seeds]]" });
  });

  test("fragments: headings (anchored or not) and anchors, never inside fenced code", () => {
    const text = "Plan\n## Beds ^beds\n## Paths\n- [ ] edge the lawn ^edge\n```\n## not a heading ^code\n```";
    expect(fragmentCandidates(text, "", "heading")).toEqual([
      { kind: "heading", label: "Beds", lineIndex: 1, fragmentId: "beds" },
      { kind: "heading", label: "Paths", lineIndex: 2 },
      { kind: "list-item", label: "[ ] edge the lawn", lineIndex: 3, fragmentId: "edge" },
    ]);
    expect(fragmentCandidates(text, "ed", "id").map(c => c.fragmentId)).toEqual(["beds", "edge"]);
  });
});

describe.skipIf(!outliner)("completion in the editor, on a scratch service", () => {
  const scratch = new Scratch();
  let board: SocketBoard, workId = "", ids: Record<string, string> = {};
  const flashes: string[] = [];
  let redraws = 0;
  const host = (): SurfaceHost => ({
    ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() { redraws++; }, navigate() {},
  });
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "HOME" });
    await create("Door work queue [type::work-queue] [project::garden]");
    workId = (await board.createRoadmapItem({ title: "Oil the hinges", priority: "medium", project: "garden", arc: "home", tracks: ["doors"] }))!.workId;
    ids.seeds = await create("Seed list [page::seeds]\nWhat to sow this spring.\n## Beans ^beans\nrunner beans");
    ids.compost = await create("Turn the compost\nEvery two weeks, bucket by the shed.");
    ids.plan = await create("Allotment plan\n## Beds\nfour of them\n## Paths ^paths");
    mkdirSync(join(scratch.workspace, "notes/beds"), { recursive: true });
    writeFileSync(join(scratch.workspace, "notes/plan.md"), "the plan\n");
  });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  /** A surface editing `id`, keys typed through the surface as the person types them. */
  async function editing(id: string) {
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    await s.edit(h);
    const d = s.draft!;
    d.row = d.lines.length - 1; d.col = d.lines[d.row]!.length;
    const type = (str: string) => { for (const c of str) s.key(char(c), h); };
    const press = (k: Key) => s.key(k, h);
    const pop = () => completionOf(d);
    const settled = async () => { await until(() => !!pop() && !pop()!.loading, "the completion lookup"); return pop()!; };
    const screen = () => s.render(60, 24, h).lines.map(visible).join("\n");
    return { s, h, d, type, press, pop, settled, screen };
  }

  test("the mouse: the wheel moves through the candidates, a click on one inserts it, a click elsewhere on the popup does nothing", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("see [[");
    const p = await e.settled();
    expect(p.items.length).toBeGreaterThan(1);
    e.s.wheel(1, e.h);
    expect(e.pop()!.index).toBe(1);
    e.s.wheel(-1, e.h);
    expect(e.pop()!.index).toBe(0);
    expect(e.d.row).toBe(2);                                              // the wheel didn't move the cursor
    const lines = e.screen().split("\n");
    const header = lines.findIndex(l => l.includes("references 1/"));
    expect(e.s.click(3, header, e.h)).toBe(true);                         // the header: the popup's, nothing chosen
    expect(e.pop()).not.toBeNull();
    expect(e.s.click(3, 0, e.h)).toBe(false);                             // above the popup: not the popup's
    // The scratch service's own documentation pages come first; click the third candidate shown.
    const target = p.items.findIndex(i => i.address === "outliner-tour");
    const row = lines.findIndex(l => l.includes("outliner-tour · Explore the Outliner"));
    expect(row).toBeGreaterThan(header);
    expect(e.s.click(10, row, e.h)).toBe(true);
    expect(e.pop()!.index).toBe(target);
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe("see [[outliner-tour]]");
  });

  test("[[ offers pages and Work IDs; typing filters; down and enter insert Detail's [[WORK-ID|title]]", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("see [[");
    let p = await e.settled();
    expect(p.items.map(i => i.address)).toEqual(expect.arrayContaining(["seeds", workId]));
    expect(e.screen()).toContain("references 1/");
    expect(editHint(e.d, { save: "save" })).toBe(`${COMPLETION_HINT} · ctrl+s save`);
    e.type("HOME");
    await until(() => !e.pop()!.loading && e.pop()!.items.every(i => i.kind === "work-id"), "filtered to Work IDs");
    p = e.pop()!;
    expect(p.items.map(i => i.address)).toEqual([workId]);
    expect(p.items[0]!.insertion).toBe(`[[${workId}|${workId} — Oil the hinges]]`);
    e.press(K("down")); e.press(K("up"));                                 // choosing stays in the list
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`see [[${workId}|${workId} — Oil the hinges]]`);
    expect(e.d.col).toBe(e.d.lines.at(-1)!.length);
    expect(e.d.lines.length).toBe(3);                                     // enter inserted; it didn't split the line
    expect(e.d.dirty).toBe(true);
  });

  test("a page inserts [[address]] with Tab; a closing ]] already typed is replaced, not doubled", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("sow from [[se]]");
    e.press(K("left")); e.press(K("left"));
    const p = await e.settled();
    expect(p.items[0]).toMatchObject({ address: "seeds", insertion: "[[seeds]]", kind: "page" });
    e.press(K("tab"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe("sow from [[seeds]]");
  });

  test("(( searches blocks and inserts ((id)); ((note^ and ((# offer fragments, own headings getting an anchor", async () => {
    const e = await editing(ids.plan!);
    e.press(K("enter")); e.type("((compost");
    let p = await e.settled();
    expect(p.items[0]).toMatchObject({ blockId: ids.compost, kind: "block", insertion: `((${ids.compost}))`, label: "Turn the compost" });
    await until(() => !!e.pop()?.items[0]?.context, "the selected candidate's context");
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${ids.compost}))`);
    // Another note's anchor.
    e.type(" ((seed^be");
    p = await e.settled();
    expect(p.items.map(i => i.insertion)).toEqual([`((${ids.seeds}^beans))`]);
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${ids.compost})) ((${ids.seeds}^beans))`);
    // A heading of the note being written, without an anchor yet: choosing it adds the anchor in the draft.
    e.type(" ((#bed");
    p = await e.settled();
    expect(p.items[0]).toMatchObject({ blockId: ids.plan, insertion: `((${ids.plan}^beds))` });
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines[1]).toBe("## Beds ^beds");
    expect(e.d.lines.at(-1)).toEndWith(` ((${ids.plan}^beds))`);
    // Nothing was written anywhere yet: the anchor is in the draft until ctrl+s.
    expect((await board.get(ids.plan!))!.text).toBe("Allotment plan\n## Beds\nfour of them\n## Paths ^paths");
  });

  test("[file:: completes workspace paths: a folder keeps the token open, a file closes it", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[file::no");
    let p = await e.settled();
    expect(p.items.map(i => [i.label, i.insertion])).toEqual([["notes/", "[file::notes/"]]);
    e.press(K("enter"));
    await until(() => e.d.lines.at(-1) === "[file::notes/" && !!e.pop() && !e.pop()!.loading && e.pop()!.items.length === 2, "the folder's entries");
    p = e.pop()!;
    expect(p.items.map(i => i.insertion)).toEqual(["[file::notes/beds/", "[file::notes/plan.md]"]);
    e.press(K("down")); e.press(K("tab"));
    await until(() => e.d.lines.at(-1) === "[file::notes/plan.md]", "the file");
    await until(() => !e.pop(), "the popup to close once the token is closed");
  });

  test("Esc dismisses the popup first and only; the next Esc is the draft's own (arms discard, then closes)", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[[se");
    await e.settled();
    e.press(K("esc"));
    expect(e.pop()).toBeNull();
    expect(e.s.draft).toBe(e.d);                                          // not closed
    expect(e.d.note).toBe("");                                            // not "esc again discards"
    e.press(K("esc"));
    expect(e.d.note).toContain("esc again discards");
    e.press(K("esc"));
    expect(e.s.draft).toBeNull();
  });

  test("the popup never traps keys: with no candidates enter, arrows and esc do what a draft does; Tab indents outside a token", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[[zzzz-nothing");
    const p = await e.settled();
    expect(p.items).toEqual([]);
    expect(p.message).toContain("no matching named addresses");
    expect(e.screen()).toContain("no matching named addresses");
    e.press(K("enter"));                                                  // splits the line, as always
    expect(e.d.lines.at(-2)).toBe("[[zzzz-nothing");
    expect(e.d.lines.at(-1)).toBe("");
    e.press(K("up"));
    expect(e.d.row).toBe(e.d.lines.length - 2);                           // the cursor moved
    e.press(K("end")); e.press(K("down"));
    e.press(K("tab"));                                                    // not in a token: indents
    expect(e.d.lines.at(-1)).toBe("  ");
    expect(e.pop()).toBeNull();
    e.press(ctrl("`"));                                                   // ctrl+space with nothing to complete
    expect(e.d.note).toContain("[[, (( or [file::");
  });

  test("Tab and Ctrl+Space ask again after Esc; Ctrl+S saves with the popup open", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[[seeds]] and [[se");
    await e.settled();
    e.press(K("esc"));
    expect(e.pop()).toBeNull();
    e.press(ctrl("`"));
    await e.settled();
    e.press(K("esc")); e.press(K("tab"));
    const p = await e.settled();
    expect(p.items[0]!.insertion).toBe("[[seeds]]");
    e.press(ctrl("s"));
    await until(() => e.s.draft === null, "the save");
    expect((await board.get(ids.compost!))!.text).toEndWith("\n[[seeds]] and [[se");
  });

  test("a comment composer completes the same way (without a note of its own for ((#)", async () => {
    const e = await editing(ids.seeds!);
    e.press(K("esc"));
    const msg = (await board.get(ids.seeds!))!;
    const s = new CommentSession(msg, [], "select");
    s.passage!.selectText("runner beans");
    s.write();
    const d = s.composer!;
    const env: any = { complete: (x: Draft) => completerFor(x, board, () => {}), external() {}, flash() {}, redraw() {} };
    for (const c of "ask ((compost") s.key(char(c), env);
    await until(() => !!completionOf(d) && !completionOf(d)!.loading, "the lookup");
    s.key(K("enter"), env);
    await until(() => d.text === `ask ((${ids.compost}))`, "the insertion");
    expect(completionOf(d)).toBeNull();
    s.key(K("esc"), env);                                                 // no popup: the composer's own esc
    expect(d.note).toContain("esc again discards");
    s.key(K("esc"), env);
    expect(s.mode).not.toBe("compose");
  });

  test("an older service without the lookups: the popup says so and typing carries on", async () => {
    const refusing = { completePages: async () => null, completeFiles: async () => null, findBlocks: async () => { throw new Refused("Unsupported action: blocks.query"); }, blockContext: async () => null, workIdPrefix: async () => null };
    const d = new Draft("x", 1, "note");
    const c = completerFor(d, refusing, () => {})!;
    for (const ch of " [[se") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the lookup");
    expect(c.state!.message).toBe("this service doesn't complete pages (pages.complete)");
    completionKey(d, char("e"), c);
    expect(d.text).toBe("note [[see");
    completionKey(d, K("enter"), c);
    expect(d.lines).toEqual(["note [[see", ""]);
    for (const ch of "((x") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the lookup");
    expect(c.state!.message).toContain("lookup failed");
    // The socket remembers an Unsupported action and doesn't ask again this session.
    const sent = board.sent.length;
    (board as any).unsupported.add("pages.complete");
    expect(await board.completePages("se", 5)).toBeNull();
    expect(board.sent.length).toBe(sent);
    (board as any).unsupported.delete("pages.complete");
  });

  test("agents get the same candidates through the complete action, and can insert at the draft's cursor", async () => {
    const e = await editing(ids.compost!);
    await expect(e.s.act("complete", { text: "no token here" }, e.h, AGENT)).rejects.toThrow("nothing to complete");
    const r: any = await e.s.act("complete", { text: "see [[HOME" }, e.h, AGENT);
    expect(r.kind).toBe("page");
    expect(r.items).toEqual([expect.objectContaining({ n: 1, insertion: `[[${workId}|${workId} — Oil the hinges]]`, kind: "work-id" })]);
    // The same list the popup shows for the same typing.
    e.press(K("enter")); e.type("see [[HOME");
    const p = await e.settled();
    expect(p.items.map(i => i.insertion)).toEqual(r.items.map((i: any) => i.insertion));
    e.press(K("esc"));
    const f: any = await e.s.act("complete", { text: "[file::notes/" }, e.h, AGENT);
    expect(f.items.map((i: any) => i.insertion)).toEqual(["[file::notes/beds/", "[file::notes/plan.md]"]);
    const ins: any = await e.s.act("complete", { insert: 1 }, e.h, AGENT);
    expect(ins.inserted).toBe(`[[${workId}|${workId} — Oil the hinges]]`);
    expect(e.d.lines.at(-1)).toBe(`see ${ins.inserted}`);
    expect(e.d.writers.map(w => w.kind)).toEqual(["user", "agent"]);
    expect(e.s.agent?.did).toStartWith("inserted [[");
    await expect(e.s.act("complete", { insert: 1 }, e.h, AGENT)).rejects.toThrow("isn't inside [[, (( or [file::");
  });
});
