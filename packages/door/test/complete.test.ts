// Reference completion in the door's editor (PIE-416): [[, (( and [file:: offer what the service's
// lookups find, the way Tree, Detail and Quick Capture do, and insert the same syntax. The popup never
// keeps a key it doesn't use. Everything here runs on a scratch service with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { CommentSession } from "../src/comment";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { MainMenu } from "../src/screens";
import { completionTargetAtCursor, pageAddressCompletion } from "../src/completion";
import { mergeComponentSchemas } from "@ep0ch/outline-core/component-schema";
import { BUILTIN_HEADING_STYLES } from "@ep0ch/outline-core/heading-styles";
import { Draft } from "../src/edit";
import { Refused, SocketBoard, USER, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { COMPLETION_HINT, completerFor, completionKey, completionOf, renderCompletion } from "../src/surface/completer";
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
});

describe("the popup opens on typing, never on moving the cursor (a fake service)", () => {
  const tick = () => new Promise(r => setTimeout(r, 15));
  function fake(prefix: () => Promise<string | null> = async () => "HOME") {
    const calls = { prefix: 0 };
    const board = {
      completePages: async () => ({ addresses: [{ address: "gardening", blockId: "b1", kind: "page", title: "Gardening" }], completeness: { kind: "complete" } }),
      completeFiles: async () => [],
      searchBlocks: async () => ({ matches: [{ block: { id: "b2", revision: 1 }, title: "Xylophone lessons", path: "", snippet: "Xylophone lessons", exact: false }], completeness: { kind: "complete" }, semantic: { status: "lexical" } }),
      blockContext: async (id: string) => ({ selected: { id, text: "Gardening" }, ancestors: [] }),
      workIdPrefix: () => { calls.prefix++; return prefix(); },
    };
    return { board, calls };
  }

  test("arrows landing inside [[garden]] or after an unclosed (( don't open it; Down and Enter stay the draft's", async () => {
    const { board } = fake();
    const d = new Draft("x", 1, "see [[garden]] now\nand ((x more\nlast line");
    const c = completerFor(d, board, () => {})!;
    d.row = 2; d.col = 8;
    completionKey(d, K("up"), c);                                         // into "and ((x m|ore": after an unclosed ((
    completionKey(d, K("up"), c);                                         // into "see [[ga|rden]]"
    await tick();
    expect(c.state).toBeNull();
    expect(completionOf(d)).toBeNull();
    completionKey(d, K("down"), c);                                       // the cursor moves, nothing is chosen
    expect(d.row).toBe(1);
    completionKey(d, K("up"), c);
    await tick();
    completionKey(d, K("enter"), c);                                      // splits the line, as always
    expect(d.lines).toEqual(["see [[ga", "rden]] now", "and ((x more", "last line"]);
    await tick();
    expect(d.lines[0]).toBe("see [[ga");                                  // nothing inserted later either
  });

  test("an open popup follows the cursor inside its token and closes when the cursor leaves it", async () => {
    const { board } = fake();
    const d = new Draft("x", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "go [[gar") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the lookup");
    completionKey(d, K("left"), c);
    await until(() => !!completionOf(d) && !completionOf(d)!.loading, "the popup at the new cursor");
    expect(completionOf(d)!.target).toMatchObject({ start: 3, query: "ga" });
    for (let i = 0; i < 3; i++) completionKey(d, K("left"), c);         // go [|[gar: out of the token
    await tick();
    expect(c.state).toBeNull();
    completionKey(d, K("right"), c); completionKey(d, K("right"), c);    // back inside by moving: still closed
    await tick();
    expect(c.state).toBeNull();
    completionKey(d, K("tab"), c);                                        // Tab asks
    await until(() => !!completionOf(d) && !completionOf(d)!.loading, "the asked lookup");
    expect(completionOf(d)!.items[0]!.insertion).toBe("[[gardening]]");
  });

  test("a failed Work ID prefix lookup is asked again; an answer is kept for the draft", async () => {
    let fail = true;
    const { board, calls } = fake(async () => { if (fail) { fail = false; throw new Error("socket closed"); } return "HOME"; });
    const d = new Draft("x", 1, "");
    const c = completerFor(d, board, () => {})!;
    completionKey(d, char("["), c);
    for (const ch of "[g") { completionKey(d, char(ch), c); await until(() => !!c.state && !c.state.loading, "the lookup"); }
    // "[[" asks and fails, "[[g" asks again and gets it; nothing asks after that.
    expect(calls.prefix).toBe(2);
    completionKey(d, char("a"), c);
    await until(() => !!c.state && !c.state.loading, "the lookup");
    expect(calls.prefix).toBe(2);
  });
});

describe("callout types after > [! (PIE-538): the outline's one list, in the same popup", () => {
  const board = {
    completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
    completeFiles: async () => [],
    searchBlocks: async () => ({ matches: [], completeness: { kind: "complete" }, semantic: { status: "lexical" } }),
    blockContext: async () => ({ selected: null, ancestors: [] }),
    workIdPrefix: async () => null,
    calloutTypes: async () => ({ types: [{ name: "recipe", title: "Recipe", icon: "♨", tone: "green", aliases: ["dish"], block: "decl-1" }], problems: [] }),
  };

  test("typing > [! offers every type with its icon; what's typed narrows it, an alias too; Enter writes [!name]", async () => {
    const d = new Draft("b1", 1, "Pantry\n");
    d.row = 1; d.col = 0;
    const c = completerFor(d, board, () => {})!;
    for (const ch of "> [!") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the types");
    expect(c.state!.target).toMatchObject({ kind: "callout", query: "" });
    expect(c.state!.items.map(i => i.insertion)).toContain("[!warning]");
    const drawn = renderCompletion(c.state!, 60, 8).map(visible).join("\n");
    expect(drawn).toContain("callout types 1/");
    expect(drawn).toContain("✎ note");
    // An alias finds its type: this outline's own, with its icon.
    for (const ch of "di") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items[0]?.insertion === "[!recipe]", "the outline's own type");
    expect(c.state!.items[0]).toMatchObject({ label: "♨ recipe (dish)", kind: "callout · this outline's" });
    for (let i = 0; i < 2; i++) completionKey(d, { kind: "backspace" } as Key, c);
    for (const ch of "wa") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.target.query === "wa", "warning");
    expect(c.state!.items[0]!.insertion).toBe("[!warning]");
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "> [!warning]", "the insert");
    expect(completionOf(d)).toBeNull();
  });
});

describe("property keys and values from the component schemas (PIE-618): the same popup, no list of its own", () => {
  const plot = { value: "plot", meaning: "this outline's: dots, 3 rows, left, plain", declared: "decl-plot" };
  const board = {
    completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
    completeFiles: async () => [],
    searchBlocks: async () => ({ matches: [], completeness: { kind: "complete" }, semantic: { status: "lexical" } }),
    blockContext: async () => ({ selected: null, ancestors: [] }),
    workIdPrefix: async () => null,
    // The service's merged answer: the built-ins with the outline's own style among [heading::]'s values.
    componentSchemas: async () => mergeComponentSchemas({ headingStyles: [{ ...BUILTIN_HEADING_STYLES[4]!, name: "plot", block: "decl-plot" }] }),
  };
  const typing = (text: string) => {
    const d = new Draft("b1", 1, "Pantry\n");
    d.row = 1; d.col = 0;
    const c = completerFor(d, board, () => {})!;
    for (const ch of text) completionKey(d, char(ch), c);
    return { d, c };
  };

  test("[head offers the keys with where they go and what they mean; Enter writes [key:: and its values open at once", async () => {
    const { d, c } = typing("## Calls [heading-p");
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the keys");
    expect(c.state!.target).toMatchObject({ kind: "key", query: "heading-p" });
    expect(c.state!.items.map(i => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
    const drawn = renderCompletion(c.state!, 110, 8).map(visible).join("\n");
    expect(drawn).toContain("properties 1/2");
    expect(drawn).toContain("property · Heading styles · on the declaring note · the glyph track the band is drawn in");
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "## Calls [heading-pattern::" && !!c.state && !c.state.loading && c.state.target.kind === "value", "the values");
    // Each value with a preview: the glyph track it draws, small.
    expect(c.state!.items.map(i => i.insertion)).toEqual(["stack]", "waffle]", "uptime]", "dots]", "rule]"]);
    expect(c.state!.items[1]!.label).toMatch(/^waffle {2}[▓▒░ ]{6,}/);
    expect(renderCompletion(c.state!, 70, 8).map(visible).join("\n")).toContain("values 1/5");
    for (const ch of "wa") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.target.query === "wa", "waffle");
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "## Calls [heading-pattern::waffle]", "the value");
    expect(completionOf(d)).toBeNull();
  });

  test("[heading:: offers the built-in styles and the outline's own; a value typed inside a closed property replaces through its ]", async () => {
    const { d, c } = typing("## Calls [heading::pl");
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the styles");
    expect(c.state!.items.map(i => i.insertion)).toEqual(["plot]"]);
    expect(c.state!.items[0]!.context).toContain("this outline's");
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "## Calls [heading::plot]", "the outline's own style");
  });

  test("a figure's YAML: its keys after the ---, its values after key: ; a [ no schema knows opens nothing", async () => {
    const { d, c } = typing("::graph-meter");
    completionKey(d, K("enter"), c);
    for (const ch of "---") completionKey(d, char(ch), c);
    completionKey(d, K("enter"), c);
    for (const ch of "li") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the YAML keys");
    expect(c.state!.target).toMatchObject({ kind: "yaml-key", component: "graph-meter" });
    expect(c.state!.items.map(i => i.insertion)).toEqual(["limit: "]);
    completionKey(d, K("enter"), c);
    await until(() => d.lines[3] === "limit: " && !!c.state && !c.state.loading && c.state.target.kind === "yaml-value", "its values");
    expect(c.state!.items.map(i => i.insertion)).toEqual(["0.5", "1"]);
    c.dismiss();
    const link = typing("see [the shed");
    await Bun.sleep(30);
    expect(link.c.state).toBeNull();
  });
});

describe("Jev re-orders after a pause, never moving the selection (a fake service)", () => {
  const hit = (id: string, title: string) => ({ block: { id, revision: 1 }, title, path: "Garden", snippet: title, exact: false });
  const lexical = [hit("b1", "Party hats"), hit("b2", "Party lights"), hit("b3", "Fat cats in party hats")];
  function fake(answer: (semantic: boolean) => Promise<void> = async () => {}) {
    const asked: { query: string; semantic: boolean; near?: string }[] = [];
    const board = {
      completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
      completeFiles: async () => [],
      searchBlocks: async (query: string, opts: { semantic?: boolean; near?: string } = {}) => {
        asked.push({ query, semantic: !!opts.semantic, near: opts.near });
        await answer(!!opts.semantic);
        return opts.semantic
          ? { matches: [lexical[2], lexical[0], lexical[1]], completeness: { kind: "complete" }, semantic: { status: "ranked" } }
          : { matches: lexical, completeness: { kind: "complete" }, semantic: { status: "lexical" } };
      },
      blockContext: async (id: string) => ({ selected: { id, text: "x" }, ancestors: [] }),
      workIdPrefix: async () => "HOME",
    };
    return { board, asked };
  }

  test("the selected candidate stays selected as Jev re-orders the list, the draft's note is the context, and the footer says so", async () => {
    const { board, asked } = fake();
    const d = new Draft("note-1", 1, "");
    d.near = "note-1";                                                    // as DraftSession.open sets it from its target
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((party hats") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length === 3, "the lexical lookup");
    completionKey(d, K("down"), c);                                       // the person picks "Party lights"
    await until(() => c.state?.jev === "ranked", "Jev's order");
    expect(c.state!.items.map(i => i.blockId)).toEqual(["b3", "b1", "b2"]);
    expect(c.state!.items[c.state!.index]!.blockId).toBe("b2");          // still Party lights
    expect(asked.filter(a => a.semantic)).toEqual([{ query: "party hats", semantic: true, near: "note-1" }]);
    expect(asked.every(a => a.near === "note-1")).toBe(true);
    expect(renderCompletion(c.state!, 60, 8).map(visible).at(-1)).toContain("jev ranked");
  });

  test("typing more selects the best match again; a re-ask of the same query keeps the pick", async () => {
    const { board } = fake();
    const d = new Draft("note-1", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((party") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length === 3, "the lookup");
    completionKey(d, K("down"), c); completionKey(d, K("down"), c);      // a pick, then more typing
    completionKey(d, char(" "), c);
    await until(() => !!c.state && !c.state.loading, "the lookup after typing");
    expect(c.state!.index).toBe(0);
    completionKey(d, K("down"), c);
    completionKey(d, ctrl(" "), c);                                       // ctrl+space asks the same query again
    await until(() => !!c.state && !c.state.loading, "the re-ask");
    expect(c.state!.items[c.state!.index]!.blockId).toBe("b2");
  });

  test("an answer after the selection moved is dropped; typing before the pause never asks Jev", async () => {
    let release = () => {};
    const { board, asked } = fake(semantic => semantic ? new Promise<void>(r => { release = r; }) : Promise.resolve());
    const d = new Draft("note-1", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((party") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the lexical lookup");
    completionKey(d, char(" "), c); completionKey(d, char("h"), c);      // typing again within the pause
    await until(() => c.state?.jev === "asking", "Jev asked");
    expect(asked.filter(a => a.semantic).map(a => a.query)).toEqual(["party h"]);
    completionKey(d, K("down"), c);                                       // the person moves while Jev thinks
    release();
    await new Promise(r => setTimeout(r, 30));
    expect(c.state!.items.map(i => i.blockId)).toEqual(["b1", "b2", "b3"]);
    expect(c.state!.index).toBe(1);
    expect(c.state!.jev).toBeUndefined();                                 // the footer doesn't stay on "jev…"
  });

  test("a comment's draft searches from the note it's on; an insert under way drops Jev's answer", async () => {
    let release = () => {};
    const { board, asked } = fake(semantic => semantic ? new Promise<void>(r => { release = r; }) : Promise.resolve());
    const d = new Draft("comment:note-9", 1, "");
    d.near = "note-9";
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((party hats") completionKey(d, char(ch), c);
    await until(() => c.state?.jev === "asking", "Jev asked");
    expect(asked.every(a => a.near === "note-9")).toBe(true);
    const accepting = c.accept();                                         // Enter while Jev thinks
    release();
    expect(await accepting).toBe(true);
    expect(d.text).toBe("((b1))");
  });

  test("[[ asks pages.complete from the draft's note, then Jev after a pause; the pick stays picked", async () => {
    const asked: { query?: string; semantic: boolean; near?: string }[] = [];
    const page = (address: string, blockId: string) => ({ address, blockId, kind: "page", title: address });
    const pages = [page("party-hats", "p1"), page("party-lights", "p2"), page("fat-cats", "p3")];
    const board = {
      completePages: async (query: string | undefined, _limit: number, opts: { semantic?: boolean; near?: string } = {}) => {
        asked.push({ query, semantic: !!opts.semantic, near: opts.near });
        return opts.semantic
          ? { addresses: [pages[2], pages[0], pages[1]], completeness: { kind: "complete" }, semantic: { status: "ranked" } }
          : { addresses: pages, completeness: { kind: "complete" }, semantic: { status: "lexical" } };
      },
      completeFiles: async () => [],
      searchBlocks: async () => ({ matches: [], completeness: { kind: "complete" }, semantic: { status: "lexical" } }),
      blockContext: async (id: string) => ({ selected: { id, text: "x" }, ancestors: [] }),
      workIdPrefix: async () => "HOME",
    };
    const d = new Draft("comment:note-7", 1, "");
    d.near = "note-7";
    const c = completerFor(d, board, () => {})!;
    for (const ch of "[[party") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.items.length === 3, "the pages");
    completionKey(d, K("down"), c);                                       // party-lights
    await until(() => c.state?.jev === "ranked", "Jev's order");
    expect(c.state!.items.map(i => i.blockId)).toEqual(["p3", "p1", "p2"]);
    expect(c.state!.items[c.state!.index]!.blockId).toBe("p2");
    expect(asked.every(a => a.near === "note-7")).toBe(true);
    expect(asked.filter(a => a.semantic).map(a => a.query)).toEqual(["party"]);
  });

  test("a draft session that ends drops its popup, and the Jev ask waiting for its pause is never sent", async () => {
    const { board, asked } = fake();
    const { DraftSession, blockTarget } = await import("../src/draft-session");
    const m = { id: "note-1", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} } as any;
    const s = DraftSession.open(blockTarget(m, { board: board as any } as any), { by: { kind: "agent", id: "t-1" } as any }, { board: board as any });
    const c = completerFor(s.draft, board, () => {})!;
    for (const ch of "((party hats") completionKey(s.draft, char(ch), c);
    await until(() => !!c.state && !c.state.loading, "the lexical lookup");
    s.dispose();
    expect(c.state).toBeNull();
    await new Promise(r => setTimeout(r, 450));
    expect(asked.filter(a => a.semantic)).toEqual([]);
  });

  test("a service without Jev configured is not asked again", async () => {
    let semanticAsks = 0;
    const board = {
      completePages: async () => ({ addresses: [], completeness: { kind: "complete" } }),
      completeFiles: async () => [],
      searchBlocks: async (_q: string, opts: { semantic?: boolean } = {}) => {
        if (opts.semantic) semanticAsks++;
        return { matches: lexical, completeness: { kind: "complete" }, semantic: opts.semantic ? { status: "unavailable", message: "Jev is not configured; showing text matches" } : { status: "lexical" } };
      },
      blockContext: async (id: string) => ({ selected: { id, text: "x" }, ancestors: [] }),
      workIdPrefix: async () => "HOME",
    };
    const d = new Draft("note-1", 1, "");
    const c = completerFor(d, board, () => {})!;
    for (const ch of "((party") completionKey(d, char(ch), c);
    await until(() => semanticAsks === 1 && c.state?.jev === undefined, "the one ask");
    for (const ch of " hats") completionKey(d, char(ch), c);
    await new Promise(r => setTimeout(r, 450));
    expect(semanticAsks).toBe(1);
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
    expect(e.pop()).toBeNull();                                           // moving into a token doesn't open it
    e.press(K("tab"));                                                    // Tab asks
    const p = await e.settled();
    expect(p.items[0]).toMatchObject({ address: "seeds", insertion: "[[seeds]]", kind: "page" });
    e.press(K("tab"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe("sow from [[seeds]]");
  });

  test("(( is the one search: punctuation, word order and a typo don't hide a note, and the draft's note is near", async () => {
    const hats = await create("HOME-333 Fat cats in party hats");
    const now = await create("Claude - now\nWhat the agent is doing.");
    const e = await editing(ids.plan!);
    for (const [typed, want] of [["((HOME-333 hats", hats], ["((fat cat party", hats], ["((party hast", hats], ["((claude now", now], ["((cluade now", now]] as const) {
      e.press(K("enter")); e.type(typed);
      const p = await e.settled();
      expect({ typed, first: p.items[0]?.blockId }).toEqual({ typed, first: want });
      e.press(K("esc"));
    }
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

  test("fragments come from the service: another note's heading past the first 600 notes, its anchor added by the service as the person's", async () => {
    // The heading's note is the oldest of more than 600, where a 500-note search never reached (PIE-295).
    const old = await create("Seed catalogue\n## Winter squash\nKeep the seed dry.");
    for (let i = 0; i < 620; i++) await create(`Filler note ${i}\n## Section ${i}\nSome prose.`);
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("((#winter squ");
    const p = await e.settled();
    expect(p.message).not.toContain("searched only");
    expect(p.items).toEqual([expect.objectContaining({ blockId: old, fragmentId: "winter-squash", label: "Seed catalogue » # Winter squash · adds anchor" })]);
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${old}^winter-squash))`);
    const now = (await board.get(old))!;
    expect(now.text).toBe("Seed catalogue\n## Winter squash ^winter-squash\nKeep the seed dry.");
    expect(board.sent).toContain("fragments.ensure");
  }, 60_000);

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
    expect(e.d.note).toBe("");                                            // not "esc again puts it aside"
    e.press(K("esc"));
    expect(e.d.note).toContain("esc again puts it aside");
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
    expect(e.d.note).toContain("[[, ((, [file::, a callout's > [!, a [key:: property or a figure's YAML");
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
    expect(d.note).toContain("esc again puts it aside");
    s.key(K("esc"), env);
    expect(s.mode).not.toBe("compose");
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
    // The person's draft is theirs: a candidate isn't put in at their cursor (round 3, deferred), their text and cursor as they were.
    const before = [e.d.text, e.d.row, e.d.col];
    await expect(e.s.act("complete", { insert: 1 }, e.h, AGENT)).rejects.toThrow("this draft is the person's; an agent doesn't type in it");
    expect([e.d.text, e.d.row, e.d.col]).toEqual(before);
    expect(e.d.writers.map(w => w.kind)).toEqual(["user"]);
    // An invitation for another agent, or one made up, opens nothing.
    await expect(e.s.act("complete", { insert: 1, invitation: "inv-made-up" }, e.h, AGENT)).rejects.toThrow("no open invitation inv-made-up for claude-7");
    // Invited (their @claude-7 line): one insert at their cursor, then the invitation is used up.
    e.press({ kind: "home" }); e.type("@claude-7 the work item"); e.press(K("enter")); e.press(K("end"));
    const inv = e.s.draftSession()!.invite("claude-7")!;
    expect(inv).not.toBeNull();
    // expect= names what it listed: a list that changed since (Jev's order, more typing) refuses, nothing spent.
    await expect(e.s.act("complete", { insert: 1, invitation: inv.id, expect: "((not-what-was-listed))" }, e.h, AGENT)).rejects.toThrow("the list changed");
    const ins: any = await e.s.act("complete", { insert: 1, invitation: inv.id, expect: r.items[0].insertion }, e.h, AGENT);
    expect(ins.inserted).toBe(`[[${workId}|${workId} — Oil the hinges]]`);
    expect(e.d.lines.at(-1)).toBe(`see ${ins.inserted}`);
    expect(e.d.writers.map(w => w.kind)).toEqual(["user", "agent"]);
    expect(e.s.agent?.did).toStartWith("inserted [[");
    await expect(e.s.act("complete", { insert: 1, invitation: inv.id }, e.h, AGENT)).rejects.toThrow(`no open invitation ${inv.id}`);
    // An edit the agent opened is its own to complete in.
    const own = new NoteSurface(), oh = host();
    own.show((await board.get(await create("Sharpen the hoe\nBefore spring.")))!, oh);
    await own.act("edit.text", { text: "Sharpen the hoe\nsee [[HOME" }, oh, AGENT);
    await own.act("draft.place", { line: 2 }, oh, AGENT);
    const mine: any = await own.act("complete", { insert: 1 }, oh, AGENT);
    expect(own.draft!.lines.at(-1)).toBe(`see ${mine.inserted}`);
    own.drafting!.dispose();
  });

  test("the complete action refuses to insert when the person typed while it looked the references up", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("@claude-7"); e.press(K("enter")); e.type("see [file::notes/pl");
    await e.settled();
    e.press(K("esc"));
    const inv = e.s.draftSession()!.invite("claude-7")!;
    // The person types at the start of the line while the (invited) agent's lookup is in flight.
    const slow = new Proxy(board, {
      get(t, p) {
        if (p === "workIdPrefix") return async () => { e.press({ kind: "home" }); e.type("so "); e.press(K("end")); e.press(K("esc")); return t.workIdPrefix(); };
        const v = (t as any)[p];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const h = { ...e.h, ctx: { ...e.h.ctx, board: slow } } as SurfaceHost;
    await expect(e.s.act("complete", { insert: 1, invitation: inv.id }, h, AGENT)).rejects.toThrow("the draft changed");
    expect(e.d.lines.at(-1)).toBe("so see [file::notes/pl");                // untouched: nothing spliced at the old span
    expect(e.d.writers.map(w => w.kind)).not.toContain("agent");
    expect(e.s.draftSession()!.invitation(inv.id, "claude-7")).not.toBeNull(); // nothing put in: the invitation isn't used up

    // The same while the reference is checked with the service (inside the insert): nothing spliced, nothing spent.
    e.press(K("end")); e.type("x [[HOME");
    await e.settled();
    e.press(K("esc"));
    const checking = new Proxy(board, {
      get(t, p) {
        if (p === "blockContext") return async (id: string) => { e.press({ kind: "home" }); e.type("so "); e.press(K("end")); e.press(K("esc")); return t.blockContext(id); };
        const v = (t as any)[p];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const line = () => e.d.lines.at(-1);
    await expect(e.s.act("complete", { insert: 1, invitation: inv.id }, { ...e.h, ctx: { ...e.h.ctx, board: checking } } as SurfaceHost, AGENT)).rejects.toThrow("the draft changed while the reference was checked");
    expect(line()).toStartWith("so so see");
    expect(e.d.writers.map(w => w.kind)).not.toContain("agent");
    expect(e.s.draftSession()!.invitation(inv.id, "claude-7")).not.toBeNull();
  });
});

describe.skipIf(!outliner)("a click on a candidate, through each host (board, desk, river)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, key: (k: Key) => void = () => {}, hub: any, beans: any;
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const top = () => (app as any).stack.at(-1);
  const screen = () => (top().render(app).lines as string[]).map(visible);
  const type = (s: string) => { for (const c of s) key(char(c)); };
  /** Type `[[se` at the end of the draft, wait for the popup, and click the line naming the page `seeds`. */
  async function clickSeeds(d: () => Draft | null | undefined) {
    await until(() => !!d(), "the draft");
    const draft = d()!;
    key(K("down")); key(K("end")); key(K("enter"));
    type("sow [[se");
    await until(() => !!completionOf(draft) && !completionOf(draft)!.loading && completionOf(draft)!.items.length > 0, "the popup");
    const lines = screen();
    const y = lines.findIndex(l => l.includes("seeds · Seed list"));
    expect(y).toBeGreaterThan(0);
    const x = lines[y]!.indexOf("seeds · Seed list");
    key({ kind: "mouse", action: "down", button: 0, x, y });
    key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => draft.lines.at(-1) === "sow [[seeds]]", "the clicked candidate");
    expect(completionOf(draft)).toBeNull();
    expect((app as any).message ?? "").not.toContain("finish the edit first");
    key(K("esc")); key(K("esc"));
  }

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    beans = await create(null, "Stake the beans [stage::queued]\nCanes along the fence.");
    await create(null, "Seed list [page::seeds]\nWhat to sow this spring.");
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("the board's preview", async () => {
    const b = boardScreen(hub.id), B: any = BV.view(b);
    app.push(b);
    try {
      await until(() => B.lanes[0]?.items?.length && B.preview.msg && !B.preview.msg.partial, "the lane and preview", 10_000);
      key(char("e"));
      await clickSeeds(() => B.preview.draft);
    } finally { app.pop(); }
  });

  test("the board's preview under a float: a click on the float's cells doesn't reach the popup (it leaves the edit)", async () => {
    const b = boardScreen(hub.id), B: any = BV.view(b);
    const was = (await board.get(beans.id))!.text;
    app.push(b);
    try {
      await until(() => B.lanes[0]?.items?.length && B.preview.msg && !B.preview.msg.partial, "the lane and preview", 10_000);
      key(char("e"));
      await until(() => !!B.preview.draft, "the draft");
      const draft: Draft = B.preview.draft;
      key(K("down")); key(K("end")); key(K("enter"));
      type("sow [[se");
      await until(() => !!completionOf(draft) && !completionOf(draft)!.loading && completionOf(draft)!.items.length > 0, "the popup");
      const lines = screen();
      const y = lines.findIndex(l => l.includes("seeds · Seed list"));
      const x = lines[y]!.indexOf("seeds · Seed list");
      expect(y).toBeGreaterThan(0);
      // A float drawn over the popup's rows (a note popped out earlier and dragged there).
      const run = (action: string, args: Record<string, unknown>, tile: string) => b.dispatch.act({ action, args, tile }, { kind: "agent", id: "float-maker" });
      await run("tile.open", { kind: "reader", name: "over", where: "right" }, "preview");
      await run("tile.float", {}, "over");
      await run("float.place", { col: x - 5, row: y - 2, cols: 30, rows: 6 }, "over");
      screen();                                                            // drawn before the person clicks
      key({ kind: "mouse", action: "down", button: 0, x, y });
      key({ kind: "mouse", action: "up", button: 0, x, y });
      // The float is elsewhere: the click leaves the edit (saved as typed), and the hidden candidate wasn't inserted.
      await until(() => !B.preview.draft, "the edit left");
      expect(draft.lines.at(-1)).toBe("sow [[se");
      const saved = (await board.get(beans.id))!;
      expect(saved.text.split("\n").at(-1)).toBe("sow [[se");
      await b.dispatch.act({ action: "tile.close", tile: "over" }, USER);
      await board.update(beans.id, was, saved.revision!);                  // the note as it was, for the next hosts
    } finally { app.pop(); }
  });

  test("the desk's reader", async () => {
    const desk = new Desk(), D = desk as any;
    app.push(desk);
    try {
      await app.act({ action: "open", args: { id: beans.id } });
      desk.focusOn("reader");                                             // an agent's open doesn't move the person's keys
      const rd = D.panes.get(D.focus) as ReaderPane;
      await until(() => !!rd.msg && !rd.msg.partial, "the note");
      key(char("e"));
      await clickSeeds(() => rd.draft);
    } finally { app.pop(); }
  });

  test("the river's column", async () => {
    const river = openScreen("river") as Desk, V = () => riverView(river);
    app.push(river);
    try {
      await until(() => !!V().column(1)?.items?.length, "the Library", 10_000);
      await app.act({ action: "open", args: { id: beans.id } });
      key(char("l"));
      await until(() => !!V().column(2)?.root, "the column's note");
      key(char("e"));
      await clickSeeds(() => V().column(2).surface.draft);
    } finally { app.pop(); }
  });
});
