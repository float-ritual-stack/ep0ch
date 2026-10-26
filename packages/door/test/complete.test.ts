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
import { Completer, enterKeeps, popupHint, completerFor, completionKey, completionOf, renderCompletion, type CompletionState } from "../src/surface/completer";
import { editHint } from "../src/surface/editor";
import { declaredKeys, keyName, traceActions, type ActionRun } from "../src/surface/actions";
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
    // A [[ quoted in a code span earlier on the line is text: typing after it opens nothing (PIE-592).
    expect(completionTargetAtCursor("type `[[` for a page, then more", 31)).toBeNull();
    expect(completionTargetAtCursor("type `[[` then [[Sh", 19)).toEqual({ kind: "page", start: 15, end: 19, query: "Sh" });
  });

  test("a Work ID inserts [[WORK-ID|title]], a page [[address]]; a title with link delimiters drops the label", () => {
    const w = { address: "HOME-001", blockId: "b", kind: "work-id", title: "Oil the hinges" };
    expect(pageAddressCompletion(w, "HOME-0", "HOME").insertion).toBe("[[HOME-001|Oil the hinges]]");
    expect(pageAddressCompletion(w, "HOME-001|the squeak", "HOME").insertion).toBe("[[HOME-001|the squeak]]");
    expect(pageAddressCompletion({ ...w, title: "Oil [[the]] hinges" }, "HOME", "HOME").insertion).toBe("[[HOME-001]]");
    expect(pageAddressCompletion({ address: "seeds", blockId: "b", kind: "page", title: "Seed list" }, "se", "HOME")).toEqual({ label: "seeds · Seed list", insertion: "[[seeds]]" });
  });
});

describe("the popup's look (PIE-1339, PIE-1245): kind and detail on each row, the docs wrapped beside the list or under it", () => {
  const DOCS = "Watering notes for the greenhouse: the seedlings want water every morning before the glass warms, and the tomatoes only every other day once they flower.";
  const state = (line = "see ((gree", over: Partial<CompletionState> = {}): CompletionState => ({
    target: { kind: "block", start: 4, end: line.length, query: line.slice(6) }, index: 0, loading: false, truncated: null, message: "",
    at: { row: 0, col: line.length, line },
    items: [
      { label: "Greenhouse meeting", detail: "Garden club", kind: "block", insertion: "((m1))", docs: DOCS },
      { label: "^a10  We agreed to water", kind: "anchor", insertion: "((m1^a10))", docs: "paragraph in Greenhouse meeting" },
      { label: "Green beds", detail: "Oct 14", kind: "page", insertion: "[[green-beds]]" },
    ], ...over,
  });
  const draw = (s: CompletionState, w: number) => renderCompletion(s, w, 14, [], 4).map(visible);

  test("at 120 columns the docs wrap beside the list, the first word drawn and none cut; each row has its kind at the right", () => {
    const s = state(), lines = draw(s, 120);
    const row = lines.find(l => l.includes("Greenhouse meeting"))!;
    expect(row).toMatch(/» Greenhouse meeting {2}Garden club +block +│ Watering notes/);
    expect(lines.find(l => l.includes("^a10"))).toMatch(/anchor +│/);
    expect(lines.find(l => l.includes("Green beds"))).toMatch(/Green beds {2}Oct 14 +page +│/);
    expect(s.previewRect!.col).toBeGreaterThan(s.listWidth! - 1);
    // Wrapped over the rows it has, at the width it's drawn: the whole description, word by word.
    const docs = lines.map(l => l.slice(s.previewRect!.col, s.previewRect!.col + s.previewRect!.cols).trim()).filter(Boolean);
    expect(docs.join(" ")).toContain(DOCS.slice(0, 60));
    expect(docs.join(" ").replace(/\s+/g, " ")).toContain("once they flower.");
    expect(docs.every(l => l.length <= s.previewRect!.cols)).toBe(true);
    expect(lines.some(l => l.includes("↑↓ move · ⏎/tab inserts"))).toBe(true);
  });

  test("at 80 columns the docs go under the list, sized to what they hold; a short list keeps them beside", () => {
    const short = state();
    draw(short, 80);
    expect(short.previewRect!.col).toBeGreaterThan(30);
    const s = state(), long = "^decision  We agreed to move the seedlings to the south bench once the heater is fixed";
    s.items.push({ label: long, kind: "anchor", insertion: "((m1^decision))" });
    const lines = draw(s, 80);
    expect(s.previewRect!.row).toBeGreaterThan(3);
    expect(s.previewRect!.col).toBeLessThanOrEqual(1);
    expect(lines.find(l => l.includes("Greenhouse meeting"))).not.toContain("│ Watering");
    const text = lines.slice(s.previewRect!.row).map(l => l.replace(/│/g, "")).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Watering notes for the greenhouse");
    expect(text).toContain("once they flower.");
  });

  test("docs under the list scroll to their last line (Codex review)", () => {
    const s = state();
    s.items[0]!.docs = Array.from({ length: 20 }, (_, i) => `line ${i + 1} of the watering notes.`).join(" ");
    const c = new Completer(new Draft("made-up", 0, s.at.line), {} as never, () => {});
    c.state = s;
    for (let i = 0; i < 40; i++) { draw(s, 60); c.previewBy(1, USER); }
    expect(draw(s, 60).join(" ")).toContain("line 20 of the watering notes.");
  });

  test("the wheel over a list still finding its rows does nothing, and throws nothing (code review)", () => {
    const d = new Draft("made-up", 0, "((gar");
    d.place(0, 5);
    const c = new Completer(d, {} as never, () => {});
    c.state = { target: { kind: "block", start: 0, end: 5, query: "gar" }, at: { row: 0, col: 5, line: d.text }, index: 0, loading: true, truncated: null, message: "finding references...", items: [] };
    expect(() => c.move(1)).not.toThrow();
  });

  test("an insert the service refuses is said in the footer and never escapes as a rejection (Codex review)", async () => {
    const d = new Draft("made-up", 0, "((garden");
    d.place(0, 8);
    const c = new Completer(d, { blockContext: async () => ({ selected: null, ancestors: [] }) } as never, () => {});
    c.state = { target: { kind: "block", start: 0, end: 8, query: "garden" }, at: { row: 0, col: 8, line: d.text }, index: 0, loading: false, truncated: null, message: "", items: [{ label: "Garden", kind: "block", blockId: "gone", insertion: "((gone))" }] };
    let escaped: unknown = null;
    const on = (e: unknown) => { escaped = e; };
    process.on("unhandledRejection", on);
    completionKey(d, K("enter"), c);
    await Bun.sleep(30);
    process.off("unhandledRejection", on);
    expect(escaped).toBeNull();
    expect(d.text).toBe("((garden");
    expect(c.state!.message).toContain("no longer there");
  });

  test("Enter inserts as Tab does; the footer says when it's a new line instead (nothing typed yet, or the row changes nothing)", () => {
    expect(enterKeeps(state())).toBeNull();
    const bare = state("## Calls ::", { target: { kind: "value", start: 9, end: 11, query: "", headingShort: true } as any });
    expect(enterKeeps(bare)).toBe("new line");
    expect(popupHint(bare)).toContain("tab inserts · ⏎ new line");
    expect(enterKeeps({ ...bare, picked: true })).toBeNull();
    const done = state("[[green-beds]]", { target: { kind: "page", start: 0, end: 14, query: "green-beds" }, index: 2 });
    expect(enterKeeps(done)).toBe("new line");
    const yaml = state("title: Fo", { target: { kind: "yaml-value", start: 7, end: 9, query: "Fo", component: "graph-meter" } as any });
    expect(enterKeeps(yaml)).toBe("new line");
    const filter = state("stage:do", { target: { kind: "filter-value", start: 6, end: 8, query: "do", key: "stage" } as any, line: true });
    expect(enterKeeps(filter)).toBe("applies");
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
    expect(c.state!.items[0]).toMatchObject({ label: "♨ recipe (dish)", kind: "callout", detail: "this outline's" });
    for (let i = 0; i < 2; i++) completionKey(d, { kind: "backspace" } as Key, c);
    for (const ch of "wa") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.target.query === "wa", "warning");
    expect(c.state!.items[0]!.insertion).toBe("[!warning]");
    completionKey(d, K("down"), c); completionKey(d, K("up"), c);
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
    expect(drawn).toContain("Heading styles");
    completionKey(d, K("down"), c); completionKey(d, K("up"), c);
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "## Calls [heading-pattern::" && !!c.state && !c.state.loading && c.state.target.kind === "value", "the values");
    // Each value with a preview: the glyph track it draws, small.
    expect(c.state!.items.map(i => i.insertion)).toEqual(["stack]", "waffle]", "uptime]", "dots]", "rule]"]);
    expect(c.state!.items[1]!.label).toMatch(/^waffle {2}[▓▒░ ]{6,}/);
    expect(renderCompletion(c.state!, 70, 8).map(visible).join("\n")).toContain("values 1/5");
    for (const ch of "wa") completionKey(d, char(ch), c);
    await until(() => !!c.state && !c.state.loading && c.state.target.query === "wa", "waffle");
    completionKey(d, K("down"), c); completionKey(d, K("up"), c);
    completionKey(d, K("enter"), c);
    await until(() => d.lines[1] === "## Calls [heading-pattern::waffle]", "the value");
    expect(completionOf(d)).toBeNull();
  });

  test("every key the open list takes runs one of its actions, which names that key (PIE-1339): the parity walk's rule, from an open popup", async () => {
    const keys: Key[] = [K("down"), K("up"), { kind: "down", shift: true } as Key, { kind: "pgdn" } as Key, K("tab"), K("enter"), K("esc")];
    for (const k of keys) {
      const { d, c } = typing("## Calls [heading-p");
      await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the keys");
      // Docs longer than they're shown, so shift+↓ and PgDn scroll them.
      c.state!.items[0]!.docs = "Where a heading's glyph track repeats: ".repeat(20);
      renderCompletion(c.state!, 40, 12);
      const runs: ActionRun[] = [];
      const stop = traceActions(r => runs.push(r));
      completionKey(d, k, c);
      stop();
      const name = ("shift" in k && k.shift ? "shift+" : "") + keyName(k)!;
      expect(runs.map(r => r.name), name).toHaveLength(1);
      expect([...declaredKeys(runs[0]!.keys)], `${runs[0]!.name} names ${name}`).toContain(name);
      c.dismiss();
    }
  });

  test("[heading:: offers the built-in styles and the outline's own; a value typed inside a closed property replaces through its ]", async () => {
    const { d, c } = typing("## Calls [heading::pl");
    await until(() => !!c.state && !c.state.loading && c.state.items.length > 0, "the styles");
    expect(c.state!.items.map(i => i.insertion)).toEqual(["plot]"]);
    expect(c.state!.items[0]!.docs).toContain("this outline's");
    completionKey(d, K("down"), c); completionKey(d, K("up"), c);
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
    completionKey(d, K("down"), c); completionKey(d, K("up"), c);
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
    expect(renderCompletion(c.state!, 60, 8).map(visible).join("\n")).toContain("jev ranked");
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
    // The three pages, then the offer of a page named "party" (PIE-592).
    await until(() => !!c.state && !c.state.loading && c.state.items.length === 4, "the pages");
    completionKey(d, K("down"), c);                                       // party-lights
    await until(() => c.state?.jev === "ranked", "Jev's order");
    expect(c.state!.items.map(i => i.blockId ?? i.newPage)).toEqual(["p3", "p1", "p2", "party"]);
    expect(c.state!.items[c.state!.index]!.blockId).toBe("p2");
    expect(asked.every(a => a.near === "note-7")).toBe(true);
    expect(asked.filter(a => a.semantic).map(a => a.query)).toEqual(["party"]);
  });

  test("a draft session that ends drops its popup, and the Jev ask waiting for its pause is never sent", async () => {
    const { board, asked } = fake();
    const { DraftSession, blockTarget } = await import("../src/draft-session");
    const m = { id: "note-1", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] } as any;
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
    const extension = join(scratch.workspace, "extensions", "garden");
    mkdirSync(extension, { recursive: true });
    writeFileSync(join(extension, "extension.json"), JSON.stringify({ contract: 2, id: "garden", version: 1, name: "Garden", components: [{
      id: "garden-card", group: "site", title: "Garden card", intro: "A planting card.", where: "a component block",
      props: [{ key: "title", where: "yaml", type: "text", meaning: "the card title", samples: ["Beans"] }],
      source: { use: "::garden-card\n---\n{{props.yaml}}\n---\n::" }, example: { title: "Beans" }, sweep: [], grids: [], space: [],
    }] }));
    await board.request("extensions.list", { reload: true });
    await create("Orchard style [heading-style::orchard] [heading-pattern::dots]");
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

  test("Enter inserts the top page match but leaves an unchosen heading style as a newline", async () => {
    const e = await editing(await create("Completion practice\n"));
    e.type("[[");
    e.type("see");
    await e.settled();
    e.press(K("enter"));
    await until(() => e.d.text.endsWith("[[seeds]]"), "Enter inserts the top page");
    e.press(K("enter"));
    e.type("## Title ::");
    await e.settled();
    e.press(K("enter"));
    expect(e.d.text).toBe("Completion practice\n[[seeds]]\n## Title ::\n");
  });

  test("component attributes follow their schema and offer the note's own property first (PIE-1127)", async () => {
    const e = await editing(await create("Field practice [trellis::north]\n"));
    e.type("::fields{");
    const attrs = await e.settled();
    expect(attrs.items.some(i => i.insertion.startsWith("key="))).toBe(true);
    e.type('key="');
    const keys = await e.settled();
    expect(keys.items[0]!.label).toBe("trellis");
    e.press(K("tab"));
    await until(() => e.d.text.endsWith('key="trellis"'), "the quoted property inserted");
    e.type(" ");
    const remaining = await e.settled();
    expect(remaining.items.some(i => i.insertion.startsWith("key="))).toBe(false);
    e.press(K("esc"));
    expect(e.d.text).toContain('key="trellis" ');
    const query: any = await e.s.act("complete", { text: '::if{where="trellis=' }, e.h, AGENT);
    expect(query.items.some((i: any) => i.insertion === 'trellis=north"')).toBe(true);
    const density: any = await e.s.act("complete", { text: '::graph-table{density="' }, e.h, AGENT);
    expect(density.items.some((i: any) => i.insertion === 'compact"')).toBe(true);
    const ref: any = await e.s.act("complete", { text: '::fields{of="Seed list' }, e.h, AGENT);
    expect(ref.items.some((i: any) => i.insertion === `((${ids.seeds}))"`)).toBe(true);
    const template = await create("Picker template [page::picker-template] [form-field::which property]");
    const custom: any = await e.s.act("complete", { text: '::use{of=[[picker-template]] which="' }, e.h, AGENT);
    expect(custom.items[0].label).toBe("trellis");
    await board.request("delete", { blockId: template, author: "agent" });
  });

  test("component attributes keep existing values and see words after the cursor (PIE-1127 round 2)", async () => {
    const e = await editing(await create('Attribute editing [trellis::north]\n::fields{key="trellis" of="other"}'));
    e.d.col = '::fields{ke'.length;
    e.press(K("tab"));
    await e.settled();
    e.press(K("tab"));
    await until(() => !e.pop(), "the existing key replaced");
    expect(e.d.lines.at(-1)).toBe('::fields{key="trellis" of="other"}');
    e.d.col = '::fields{'.length;
    e.press(K("tab"));
    expect((await e.settled()).items.some(i => i.label === "of")).toBe(false);
    const template = await create("Later producer [page::later-producer] [form-field::which property]");
    const later = await editing(await create('Later props\n::use{wh of=[[later-producer]]}'));
    later.d.col = '::use{wh'.length;
    const result: any = await later.s.act("complete", {}, later.h, AGENT);
    expect(result.items.some((i: any) => i.label === "which")).toBe(true);
    await board.request("delete", { blockId: template, author: "agent" });
  });

  test("component value replacement finds a quote escaped before the cursor (PIE-1127 round 2)", async () => {
    const e = await editing(await create('Escaped value [trellis::north]\n::fields{key="tre\\"llis"}'));
    e.d.col = '::fields{key="tre\\'.length;
    e.press(K("tab"));
    const p = await e.settled();
    e.press(K("tab"));
    await until(() => !e.pop(), "the escaped value replaced");
    expect(e.d.lines.at(-1)).toBe('::fields{key="trellis"}');
  });

  test("references inside known and unknown component values use reference completion (PIE-1127 round 2)", async () => {
    const e = await editing(await create("Reference practice\n"));
    for (const component of ["fields", "unknown-widget"]) for (const quote of ['"', ""]) for (const [opening, kind, insertion] of [["[[se", "page", "[[seeds]]"], ["((Seed list", "block", `((${ids.seeds}))`]]) {
      const result: any = await e.s.act("complete", { text: `::${component}{of=${quote}${opening}` }, e.h, AGENT);
      expect(result.kind).toBe(kind);
      expect(result.items.some((i: any) => i.insertion === insertion)).toBe(true);
    }
  });

  test.each([
    ['::button{of=fold}\n\n', "block"],
    ['::button{label="Fold"}\n\n', "block"],
    ['::button{label="Fold"}\n', "button-step"],
  ] as const)("(( completes notes outside a button body and scripts inside it: %s", async (prefix, kind) => {
    const note = await create("Ordinary note\nA note to link in prose.");
    await create('Ordinary script [script::ordinary-script]\n```js\nreturn "folded";\n```');
    await board.listExtensions(true);
    const e = await editing(await create(`Button body practice\n${prefix}`));
    e.type("((ordinary");
    const popup = await e.settled();
    expect(popup.target.kind).toBe(kind);
    expect(popup.items.some(i => i.insertion === (kind === "block" ? `((${note}))` : "((ordinary-script))"))).toBe(true);
  });

  test("button of completes runnable script names (PIE-1127 round 2)", async () => {
    await create('Water script [script::water-plants]\n```js\nreturn "watered";\n```');
    await board.listExtensions(true);
    const e = await editing(await create("Button practice\n"));
    e.type('::button{of=water');
    expect((await e.settled()).items.some(i => i.insertion === '"water-plants"')).toBe(true);
    e.press(K("tab"));
    await until(() => e.d.text.endsWith('of="water-plants"'), "the script name inserted");
  });

  test("a script fence offers its settings and its button completes local names first", async () => {
    await create('Far script [script::water-far]\n```js\nreturn "far";\n```');
    const id = await create('Local practice\n');
    await board.listExtensions(true);
    const e = await editing(id);
    e.s.key({ kind: 'paste', text: '```js script=water-near\nreturn "near";\n```\n' }, e.h);
    e.type('::button{of=water');
    expect((await e.settled()).items[0]!.insertion).toBe('"water-near"');
    e.press(K("tab"));
    await until(() => e.d.text.endsWith('of="water-near"'), "the local name inserted");
    const fence = await editing(await create("Fence practice\n"));
    fence.type("```js ");
    const settings = await fence.settled();
    expect(settings.items.some(i => i.insertion === "script=")).toBe(true);
    fence.press(K("tab"));
    await until(() => fence.d.text.endsWith("```js script="), "the fence name setting inserted");
  });

  test("template property-value kinds offer that key's facet values (PIE-1127 round 2)", async () => {
    const template = await create("Facet producer [page::facet-producer] [form-field::side property:trellis]");
    const e = await editing(await create("Facet practice [trellis::north]\n"));
    const result: any = await e.s.act("complete", { text: '::use{of=[[facet-producer]] side="' }, e.h, AGENT);
    expect(result.items.some((i: any) => i.insertion === 'north"')).toBe(true);
    expect(result.items.some((i: any) => i.label === "trellis")).toBe(false);
    await board.request("delete", { blockId: template, author: "agent" });
  });

  test("component ranking includes standalone uses and stays fixed while typing (PIE-1127 round 2)", async () => {
    await create('Standalone field\n::fields{key=trellis}');
    const e = await editing(await create("Ranking practice\n"));
    e.type("::");
    const first = (await e.settled()).items;
    expect(first[0]!.label).toBe("Fields");
    await create('A newly used button\n::button{of=water-plants}');
    e.type("b"); await e.settled(); e.press({ kind: "backspace" });
    expect((await e.settled()).items.map(i => i.label)).toEqual(first.map(i => i.label));
  });

  test("file script completion shows the registered path and code (PIE-1164 round 2)", async () => {
    const folder = join(scratch.workspace, ".ep0ch", "scripts");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "count-pots.ts");
    writeFileSync(file, '// ep0ch-script\nreturn "Seven pots";\n');
    await board.listExtensions(true);
    const e = await editing(await create("Script practice\n"));
    e.type("@count-pots");
    const p = await e.settled();
    renderCompletion(p, 180, 30);
    const preview = p.previewLines!.map(visible).join("\n");
    expect(preview).toContain(file);
    expect(preview).toContain('return "Seven pots";');
  });

  test("YAML field keys use the draft or the named target (PIE-1164 round 2)", async () => {
    const target = await create("Target plant [habitat::shade]\n");
    for (const ofLine of ["", `of: '((${target}))'\n`, `after`]) {
      const after = ofLine === "after";
      const e = await editing(await create(`YAML practice\n::fields\n---\n${after ? "" : ofLine}key: \n${after ? `of: '((${target}))'\n` : ""}---\n::`));
      e.d.row = 0; e.d.col = e.d.lines[0]!.length; e.type(" [trellis::north]"); e.press(K("esc"));
      e.d.row = e.d.lines.findIndex(l => l === "key: "); e.d.col = 5;
      e.press(K("tab"));
      const p = await e.settled();
      const key = ofLine ? "habitat" : "trellis";
      expect(p.items.some(i => i.insertion === key)).toBe(true);
      e.press(K("tab"));
      await until(() => !e.pop(), "YAML key inserted");
      expect(e.d.lines[e.d.row]).toBe(`key: ${key}`);
    }
  });

  test("YAML value completion keeps its rendered variation (PIE-1164 round 2)", async () => {
    const e = await editing(await create("Meter practice\n::graph-meter\n---\nlimit: "));
    e.press(K("tab"));
    const p = await e.settled();
    expect(renderCompletion(p, 140, 24).map(visible).join("\n")).toContain("DISK");
  });

  test("component cards teach syntax with draft keys and copy the source (PIE-1164)", async () => {
    const e = await editing(await create("Card practice\n"));
    e.type("[status::ready] [owner::Ada]");
    e.press(K("esc")); e.press(K("enter")); e.type("::fie");
    const p = await e.settled();
    const card = () => { renderCompletion(e.pop()!, 140, 24); return e.pop()!.previewLines!.map(visible).join("\n"); };
    expect(card()).toContain("Fields: Every place a note writes a key");
    expect(card()).toContain("::fields{key=status}");
    expect(card()).toContain("[copy]");
    expect(card()).toContain("Seed list");
    expect(card()).toContain("the property to list");
    e.press(K("right"));
    expect(e.pop()!.items.some(i => i.label === "::fields{key=owner}")).toBe(true);
    expect(e.pop()!.items.some(i => i.insertion.includes("storyTime"))).toBe(false);
    const copied = await e.s.act("complete.copy", {}, e.h, AGENT);
    expect(copied).toBe("::fields{key=status}");
    expect(e.d.text).toEndWith("::fie");
    const target = await create("Target keys [habitat::shade]\n");
    const result: any = await e.s.act("complete", { text: `::fields{of="((${target}))" key="` }, e.h, AGENT);
    expect(result.items.some((i: any) => i.label === "habitat")).toBe(true);
    expect(result.items.some((i: any) => i.label === "status")).toBe(false);
    const typing = await editing(await create("Typing a component name\n"));
    typing.type("::graph-activit"); await typing.settled();
    typing.type("y");
    expect(typing.d.text).toEndWith("::graph-activity");
  });

  test("component rows stay on the left in one line and preview their selected demo (PIE-1127 round 2)", async () => {
    const e = await editing(await create("Component layout\n"));
    e.type("::");
    const p = await e.settled();
    for (const label of ["Fields", "Button", "Properties"]) {
      p.index = p.items.findIndex(i => i.label === label);
      const hits: (number | null)[] = [];
      const lines = renderCompletion(p, 140, 20, hits).map(visible);
      const row = hits.indexOf(p.index);
      expect(hits.filter(i => i === p.index)).toHaveLength(1);
      expect(lines[row]!.indexOf(label)).toBeLessThan(6);
      expect(lines[row]!.slice(0, p.listWidth).trimEnd()).toEndWith("›");
      expect(p.previewLines!.map(visible).join("\n")).toContain(label === "Fields" ? "Seed list" : label === "Button" ? "Fold the bottom" : "Properties");
      expect(p.previewLines!.map(visible)[0]).toContain(label);
    }
  });

  test("component completion inserts an editable example with one undo (PIE-1013)", async () => {
    await create("A meter in use\n::graph-meter\n---\nvalue: 0.5\n---\n::");
    await create("Fields in use\n::fields{key=trellis}\n::");
    const e = await editing(await create("Component practice\n"));
    e.type("::");
    const all = await e.settled();
    for (const used of ["Fields", "Meter"]) expect(all.items.findIndex(i => i.label === used)).toBeLessThan(all.items.findIndex(i => i.label === "Stat"));
    expect(all.items.some(i => i.insertion.startsWith("::box"))).toBe(true);
    expect(all.items.some(i => i.insertion.startsWith("::garden-card"))).toBe(true);
    e.type("graph-meter");
    const p = await e.settled();
    expect(p.items[0]!.insertion).toContain("\n---\ntitle: Disk\nvalue: 0.6\n---\n::");
    expect(p.items.filter(i => i.insertion.startsWith("::graph-meter")).length).toBe(1);
    e.screen();
    await e.s.act("complete.preview", { by: 7 }, e.h, USER);
    expect(e.screen()).toContain("DISK");
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => !e.pop(), "the component inserted");
    expect(e.d.selectedText()).toBe("Disk");
    expect(e.d.lines.at(-1)).toBe("::");
    e.press(ctrl("z"));
    expect(e.d.text).toBe("Component practice\n::graph-meter");
    e.press(K("tab")); await e.settled();
    const shown = e.screen().split("\n");
    const row = shown.findIndex(l => l.includes("Meter"));
    const col = shown[row]!.indexOf("Meter");
    e.s.click(shown[row]!.indexOf("›"), row, e.h);
    expect(e.pop()?.heading).toContain("variations and arguments");
    e.press(K("left"));
    e.screen();
    e.s.click(col, row, e.h);
    expect(e.d.text).toBe("Component practice\n::graph-meter");
    e.s.click(col, row, e.h);
    await until(() => !e.pop(), "double click inserts");
    e.type("Photos");
    expect(e.d.lines[3]).toBe("title: Photos");
    e.press(ctrl("s"));
    await until(() => e.s.draft === null, "the save");
    expect((await board.get(e.d.blockId))!.text).toContain("title: Photos\nvalue: 0.6");
    const result: any = await e.s.act("complete", { text: "::graph-met" }, e.h, AGENT);
    expect(result.items[0].insertion).toContain("title: Disk");
  });

  test("heading shorthand uses the outline's styles and writes a bracket property (PIE-1012)", async () => {
    for (const token of ["::", "[heading::"]) {
      const e = await editing(await create("Heading practice\n## Calls "));
      e.type(token + "orch");
      await e.settled();
      e.press(K("tab"));
      await until(() => e.d.lines[1]!.includes("[heading::orchard]"), "the style inserted");
      expect(e.d.lines[1]).toBe("## Calls [heading::orchard]");
      expect(e.pop()).toBeNull();
      e.press(ctrl("z"));
      expect(e.d.lines[1]).toBe("## Calls " + token + "orch");
    }
  });

  test("ordinary headings keep Enter, and style suggestions need a deliberate choice", async () => {
    for (const text of ["## Plans for the heading:", "## Calls heading::", "## Calls :: mid-thought", "## Calls [heading::orchard]"]) {
      const e = await editing(await create("Heading practice\n"));
      e.type(text);
      expect(e.pop()).toBeNull();
      e.press(K("enter"));
      expect(e.d.lines).toEqual(["Heading practice", text, ""]);
      expect(e.pop()).toBeNull();
    }
    const middle = await editing(await create("Heading practice\n## Calls  later"));
    middle.d.col = "## Calls ".length;
    middle.type("::");
    expect(middle.pop()).toBeNull();
    middle.press(K("enter"));
    expect(middle.d.lines).toEqual(["Heading practice", "## Calls ::", " later"]);
    for (const ask of [null, K("down"), ctrl(" "), K("tab")]) {
      const e = await editing(await create("Heading practice\n"));
      e.type("## Calls ::");
      await e.settled();
      expect(e.pop()!.items.some(i => i.insertion === "[heading::orchard]")).toBe(true);
      if (ask) {
        if (ask.kind !== "down") e.press(K("esc"));
        e.press(ask);
        await e.settled();
      }
      e.press(K("enter"));
      if (ask) await until(() => e.d.lines[1]!.includes("[heading::"), "chosen style");
      else expect(e.d.lines).toEqual(["Heading practice", "## Calls ::", ""]);
    }
  });

  test("the mouse: the wheel moves through the candidates, a click previews and a double click inserts, a click elsewhere on the popup does nothing", async () => {
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
    e.type("seeds");
    const choices = await e.settled();
    const target = choices.items.findIndex(i => i.address === "seeds");
    const shown = e.screen().split("\n");
    const row = shown.findIndex(l => l.includes("seeds · Seed list"));
    const col = shown[row]!.indexOf("seeds · Seed list");
    expect(row).toBeGreaterThan(header);
    expect(e.s.click(col, row, e.h)).toBe(true);
    expect(e.pop()!.index).toBe(target);
    expect(e.d.lines.at(-1)).toBe("see [[seeds");
    expect(e.s.click(col, row, e.h)).toBe(true);
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe("see [[seeds]]");
  });

  test("[[ offers pages and Work IDs; typing filters; down and enter insert Detail's [[WORK-ID|title]]", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("see [[");
    let p = await e.settled();
    expect(p.items.some(i => i.kind === "page")).toBe(true);
    expect(e.screen()).toContain("references 1/");
    expect(editHint(e.d, { save: "save" })).toBe(`${popupHint(p)} · ctrl+s save`);
    expect(popupHint(p)).toStartWith("↑↓ move · ⏎/tab inserts");
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

  test("[[ a name no page has is offered new (PIE-592): choosing it makes the page where new notes go and links it, nothing lost from the draft", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("leaves go in [[Leaf mould");
    await until(() => !!e.pop() && !e.pop()!.loading && e.pop()!.items.some(i => i.newPage), "the new page offered");
    const p = e.pop()!, i = p.items.findIndex(x => x.newPage === "Leaf mould");
    expect(p.items[i]).toMatchObject({ label: "new page · Leaf mould", insertion: "[[Leaf mould]]" });
    expect((await board.resolvePage("Leaf mould")).status).toBe("missing");     // offered, not made
    // Alone on the list it's taken only on purpose: ↓ to it, then ⏎.
    do e.press(K("down")); while (e.pop()!.index < i);
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe("leaves go in [[Leaf mould]]");
    const made = await board.resolvePage("Leaf mould");
    expect(made.status).toBe("resolved");
    expect(made.block!.text).toBe("Leaf mould [page::Leaf mould]");
    expect(e.d.note).toContain("made page Leaf mould");
    // A page that has the name isn't offered again; neither is the outline's Work ID prefix.
    e.press(K("enter")); e.type("[[Leaf mould");
    await until(() => !!e.pop() && !e.pop()!.loading, "the lookup");
    expect(e.pop()!.items.some(x => x.newPage)).toBe(false);
  });

  test("embedding a part without visiting it (PIE-592): !((words lists the top note's headings, quotes and callouts; choosing one anchors it there and embeds the whole callout", async () => {
    const id = await create("Potting bench rules\nKeep it tidy.\n\n> Sweep the bench\n> before you leave.\n\n> [!warning] Glass\n> The cold frame lid is glass.\n> Lift it with two hands.\n\n## Tools");
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("!((Potting bench rul");
    await until(() => !!e.pop() && !e.pop()!.loading && e.pop()!.items.some(i => i.blockId === id && i.fragmentId), "the bench's parts");
    const rows = e.pop()!.items.filter(i => i.blockId === id).map(i => i.label.trim());
    expect(rows).toEqual(["Potting bench rules", "> Sweep the bench before you leave. · adds ^sweep-the-bench", "[!] Glass · adds ^glass", "# Tools · adds ^tools"]);
    const i = e.pop()!.items.findIndex(x => x.fragmentId === "glass");
    while (e.pop()!.index < i) e.press(K("down"));
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`!((${id}^glass))`);
    expect((await board.get(id))!.text).toContain("> Lift it with two hands. ^glass");
    expect((await board.readFragment(id, "glass")).status).toBe("resolved");
    // The embed carries the whole callout, as the reader draws it.
    expect(JSON.stringify(await board.readTransclusions([{ blockId: id, fragmentId: "glass" }]))).toContain("> [!warning] Glass\\n> The cold frame lid is glass.\\n> Lift it with two hands.");
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
    await until(() => !!e.pop()?.items[0]?.docs, "the selected candidate's context");
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${ids.compost}))`);
    // Another note's anchor: inside the notes ((seed lists (PIE-762), its anchor first, then a passage that would get one.
    e.type(" ((seed^be");
    p = await e.settled();
    expect(p.items[0]).toMatchObject({ insertion: `((${ids.seeds}^beans))`, label: "^beans  Seed list » # Beans" });
    expect(p.items[1]).toMatchObject({ insertion: `((${ids.seeds}^runner-beans))`, label: "Seed list » runner beans · adds ^runner-beans" });
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${ids.compost})) ((${ids.seeds}^beans))`);
    // A heading of the note being written, without an anchor yet: choosing it adds the anchor in the draft.
    e.type(" ((#bed");
    p = await e.settled();
    expect(p.items[0]).toMatchObject({ blockId: ids.plan, insertion: `((${ids.plan}^beds))` });
    e.press(K("down")); e.press(K("up"));
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
    expect(p.items).toEqual([expect.objectContaining({ blockId: old, fragmentId: "winter-squash", label: "Seed catalogue » # Winter squash · adds ^winter-squash" })]);
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => !e.pop(), "the insertion");
    expect(e.d.lines.at(-1)).toBe(`((${old}^winter-squash))`);
    const now = (await board.get(old))!;
    expect(now.text).toBe("Seed catalogue\n## Winter squash ^winter-squash\nKeep the seed dry.");
    expect(board.sent).toContain("fragments.ensure");
  }, 60_000);

  test("deep links (PIE-762): ((words lists a note's anchors under it, ((id typed whole names an anchor first; ^ in a finished ((id)) searches inside, anchors first; a passage gets its anchor from the service as the person's", async () => {
    const pond = await create("Pond diary\n\nThe frogs came back\nin March.\n\nWe agreed to net it. ^a10\n\n## Decision\nNo fish this year.");
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("((pond diary");
    let p = await e.settled();
    // The note, then its anchor right under it, shown at the front of the row.
    const at = p.items.findIndex(i => i.insertion === `((${pond}))`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(p.items[at + 1]).toMatchObject({ insertion: `((${pond}^a10))`, label: "  ^a10  We agreed to net it." });
    // An anchor's own id, typed: it comes first.
    for (let i = 0; i < "pond diary".length; i++) e.press({ kind: "backspace" });
    e.type("a10");
    await until(() => e.pop()?.target.query === "a10" && !e.pop()!.loading, "the a10 lookup");
    expect(e.pop()!.items[0]).toMatchObject({ insertion: `((${pond}^a10))`, label: `^a10  Pond diary » We agreed to net it.` });
    // Back to the note itself, inserted whole; then ^ just after its )) opens it again inside that note.
    for (let i = 0; i < 3; i++) e.press({ kind: "backspace" });
    e.type("pond diary");
    p = await e.settled();
    for (let i = 0; i < p.items.findIndex(i => i.insertion === `((${pond}))`); i++) e.press(K("down"));
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => e.d.lines.at(-1) === `((${pond}))`, "the note inserted");
    e.type("^");
    expect(e.d.lines.at(-1)).toBe(`((${pond}^))`);
    p = await e.settled();
    expect(p.heading).toBe("in Pond diary");
    expect(p.items.map(i => i.label)).toEqual([
      "^a10  We agreed to net it.",
      "The frogs came back in March. · adds ^the-frogs-came",
      "# Decision · adds ^decision",
      "No fish this year. · adds ^no-fish-this",
    ]);
    // Words narrow it; the passage with no anchor is chosen: the service adds the anchor, then the reference lands.
    e.type("frogs");
    await until(() => !!e.pop()?.target.query.endsWith("frogs") && !e.pop()!.loading, "the frogs lookup");
    expect(e.pop()!.items.map(i => i.insertion)).toEqual([`((${pond}^the-frogs-came))`]);
    e.press(K("down")); e.press(K("up"));
    e.press(K("enter"));
    await until(() => e.d.lines.at(-1) === `((${pond}^the-frogs-came))`, "the refined reference");
    expect((await board.get(pond))!.text).toContain("in March. ^the-frogs-came");
    const history = await board.request("block.revisions", { blockId: pond }) as { revisions: { author?: string }[] };
    expect(history.revisions[0]!.author).toBe("user");
    // The cursor back inside the id (a click, or arrows) and # searches the same note's headings.
    e.d.col = e.d.lines.at(-1)!.indexOf(pond) + 6;
    e.type("#");
    expect(e.d.lines.at(-1)).toBe(`((${pond}#))`);
    p = await e.settled();
    expect(p.items.map(i => i.label)).toEqual(["^the-frogs-came  The frogs came back in March.", "^a10  We agreed to net it.", "# Decision · adds ^decision"]);
    e.press(K("esc"));
    // ctrl+z gives back the reference as it was.
    e.press({ kind: "char", ch: "z", ctrl: true });
    expect(e.d.lines.at(-1)).toBe(`((${pond}^the-frogs-came))`);
  }, 30_000);

  test("deep links: ^ and # are text outside a finished reference, in a labelled one, and in code (PIE-762, PIE-764)", async () => {
    const e = await editing(ids.compost!);
    const line = `x ((${ids.seeds}|seed list)) \`((${ids.seeds}))\` 2^3`;
    e.press(K("enter")); e.type(line);
    for (const [col, ch] of [[line.indexOf("|") - 2, "^"], [line.indexOf("`((") + 6, "#"], [line.length - 1, "^"]] as const) {
      e.d.col = col;
      const before = e.d.lines.at(-1)!;
      e.type(ch);
      expect(e.d.lines.at(-1)).toBe(before.slice(0, col) + ch + before.slice(col));
    }
  });

  test("[file:: completes workspace paths: a folder keeps the token open, a file closes it", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[file::no");
    let p = await e.settled();
    expect(p.items.map(i => [i.label, i.insertion])).toEqual([["notes/", "[file::notes/"]]);
    e.press(K("down")); e.press(K("up"));
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
    expect(e.d.note).toBe("");                                            // not "esc again keeps it here"
    e.press(K("esc"));
    expect(e.d.note).toContain("esc again keeps it here");
    e.press(K("esc"));
    expect(e.s.draft).toBeNull();
  });

  test("the popup never traps keys: with no candidates enter, arrows and esc do what a draft does; Tab indents outside a token", async () => {
    const e = await editing(ids.compost!);
    e.press(K("enter")); e.type("[[zzzz-nothing");
    const p = await e.settled();
    // Only the offer of a new page (PIE-592), which Enter never takes unless the person went to it.
    expect(p.items.map(i => i.kind)).toEqual(["new"]);
    expect(p.message).toContain("no page is named zzzz-nothing yet");
    expect(e.screen()).toContain("no page is named zzzz-nothing yet");
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
    expect(e.d.note).toContain("completion works inside");
  });

  test("inside backticks or a fence no popup opens, by keys or the complete action; after a closed span it does (PIE-764)", async () => {
    const e = await editing(ids.compost!);
    const quiet = async () => { await new Promise(r => setTimeout(r, 60)); return e.pop(); };
    // The span being typed: its closing backtick isn't there yet.
    e.press(K("enter")); e.type("Write `((compost");
    expect(await quiet()).toBeNull();
    e.press(ctrl("`"));                                                   // asking outright offers nothing either
    expect(await quiet()).toBeNull();
    e.type("))` to link it, `[[se");
    expect(await quiet()).toBeNull();
    // A fence.
    e.press(K("enter")); e.type("```"); e.press(K("enter")); e.type("[[se and ((comp");
    expect(await quiet()).toBeNull();
    e.press(K("enter")); e.type("```"); e.press(K("enter"));
    // After a closed span the same typing opens it.
    e.type("`code` and ((compost");
    const p = await e.settled();
    expect(p.items[0]).toMatchObject({ blockId: ids.compost, kind: "block" });
    e.press(K("esc"));
    // An agent asking about the same text gets the same answer.
    await expect(e.s.act("complete", { text: "see `[[se" }, e.h, AGENT)).rejects.toThrow("nothing to complete");
    // What was written lands as written.
    e.press(ctrl("s"));
    await until(() => e.s.draft === null, "the save");
    expect((await board.get(ids.compost!))!.text).toEndWith("\nWrite `((compost))` to link it, `[[se\n```\n[[se and ((comp\n```\n`code` and ((compost");
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
    s.key(K("down"), env); s.key(K("up"), env);
    s.key(K("enter"), env);
    await until(() => d.text === `ask ((${ids.compost}))`, "the insertion");
    expect(completionOf(d)).toBeNull();
    s.key(K("esc"), env);                                                 // no popup: the composer's own esc
    expect(d.note).toContain("esc again keeps it here");
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
  const size = { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false };
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
    expect(draft.lines.at(-1)).toBe("sow [[se");
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
    const term = { info: size, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("reference completion keeps the typing line clear and reveals a body match (PIE-1104)", async () => {
    const journal = await create(null, "Winter ledger\n" + Array.from({ length: 40 }, (_, i) => `Ledger entry ${i}.`).join("\n") + "\nInsurance return passage.\nKeep the receipt.");
    for (const height of [24, 36, 60]) for (const line of [2, Math.floor(height / 2), height - 8]) {
      size.rows = height;
      const note = await create(null, "Picker practice\n" + Array.from({ length: height }, () => "Typing here").join("\n"));
      const desk = openScreen("detail", { note: note.id, persist: false }) as Desk;
      app.push(desk);
      try {
        await until(() => screen().some(l => l.includes("Picker practice")), "reader");
        key(char("e")); key(K("enter"));
        const rd = [...(desk as any).panes.values()].find((p: any) => "surface" in p) as ReaderPane;
        await until(() => !!rd.draft, "edit");
        for (let i = 0; i < line; i++) key(K("down"));
        key(K("end")); type(" ((Insurance ret");
        await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "matches");
        expect(screen().some(l => l.includes("Typing here ((Insurance ret"))).toBe(true);
        expect(screen().some(l => l.includes("((Insurance ret▌"))).toBe(true);
        await until(() => screen().some(l => l.includes("Insurance return passage.")), "body match revealed", 3000);
        expect(completionOf(rd.draft!)!.items[0]!.blockId).toBe(journal.id);
        const picked = completionOf(rd.draft!)!.index, beforeScroll = screen().join("\n");
        key({ kind: "up", shift: true });
        expect(completionOf(rd.draft!)!.index).toBe(picked);
        expect(screen().join("\n")).not.toBe(beforeScroll);
        if (height === 60 && line === height - 8) {
          type(' in:"Items" type:');
          await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "scoped query");
          expect(screen().join("\n")).toContain('((Insurance ret in:"Items" type:▌');
          expect(screen().join("\n")).toContain("in: Items");
        }
      } finally { app.pop(); size.rows = 48; }
    }
  });

  test("scrolling reference results loads beyond the first page (PIE-1104)", async () => {
    for (let i = 0; i < 45; i++) await create(null, `Marigold register ${String(i).padStart(2, "0")}\nA register entry.`);
    const note = await create(null, "Paging practice\n");
    const desk = openScreen("detail", { note: note.id, persist: false }) as Desk;
    app.push(desk);
    try {
      await until(() => screen().some(l => l.includes("Paging practice")), "reader");
      key(char("e")); key(K("enter"));
      const rd = [...(desk as any).panes.values()].find((p: any) => "surface" in p) as ReaderPane;
      await until(() => !!rd.draft, "edit");
      key(K("down")); key(K("end")); type("((Marigold register");
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "first page");
      await until(() => {
        key(K("down")); screen();
        return completionOf(rd.draft!)!.items[completionOf(rd.draft!)!.index]?.label === "Marigold register 03";
      }, "later results", 3000);
      key(K("enter"));
      await until(() => !completionOf(rd.draft!), "insert");
      const id = rd.draft!.text.match(/\(\(([a-f0-9-]+)\)\)/)![1]!;
      expect((await board.get(id))!.text).toContain("Marigold register 03");
    } finally { app.pop(); }
  });

  test("reference float previews passages, scrolls, and starts the next completion with notes", async () => {
    const note = await create(null, "Reference practice\n");
    const journal = await create(null, "Orchard journal\n## Orchard passage ^harvest\n" + Array.from({ length: 125 }, (_, i) => `Harvest detail ${i}: baskets beside the gate.`).join("\n\n"));
    await create(null, "Orchard weather\nClouds over the orchard. ^clouds");
    const desk = openScreen("detail", { note: note.id, persist: false }) as Desk;
    app.push(desk);
    try {
      await until(() => screen().some(l => l.includes("Reference practice")), "the reader");
      key(char("e")); key(K("enter"));
      const rd = [...(desk as any).panes.values()].find((p: any) => "surface" in p) as ReaderPane;
      await until(() => !!rd.draft, "the edit");
      key(K("down")); key(K("end")); type("((Orchard");
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "notes");
      const picked = completionOf(rd.draft!)!.items.findIndex(i => i.blockId === journal.id && !i.fragmentId);
      for (let n = 0; n < picked; n++) key(K("down"));
      type("^");
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "passages");
      expect(completionOf(rd.draft!)!.items.every(i => i.blockId === journal.id)).toBe(true);
      await until(() => screen().some(l => l.slice(l.indexOf(" │ ") + 3).includes("Harvest detail 0")), "the passage in its note", 2000);
      const before = screen();
      const y = before.findIndex(l => l.slice(l.indexOf(" │ ") + 3).includes("Harvest detail 0"));
      const x = before[y]!.lastIndexOf("Harvest detail 0");
      key({ kind: "mouse", action: "wheel-down", button: 0, x, y });
      expect(screen().map(l => l.slice(l.indexOf(" │ ") + 3)).join("\n")).not.toContain("Harvest detail 0:");
      key(K("enter"));
      await until(() => rd.draft!.text.includes("^harvest))"), "inserted anchor");
      type(" ((Orchard");
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "fresh notes");
      expect(completionOf(rd.draft!)!.items[0]!.kind).toStartWith("block");
      key(K("esc")); type(` ((${journal.id}^Harvest detail`);
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "passage results");
      await until(() => {
        key(K("down")); screen();
        return completionOf(rd.draft!)!.items[completionOf(rd.draft!)!.index]?.label.includes("Harvest detail 110:") ?? false;
      }, "later passages", 20_000);
      expect(screen().join("\n")).toContain("Harvest detail 110:");
    } finally { app.pop(); }
  }, 30_000);

  test("completion fills a wide tile beyond its narrow text measure (PIE-1026)", async () => {
    const note = await create(null, "Completion practice [style.measure::40] [style.pad::2]\n");
    await create(null, "Greenhouse planting calendar [page::greenhouse-calendar]\nSow beans after the frost.");
    const desk = openScreen("detail", { note: note.id, persist: false }) as Desk;
    app.push(desk);
    try {
      await until(() => screen().some(l => l.includes("Completion practice")), "the measured reader");
      key(char("e")); key(K("enter"));
      const rd = [...(desk as any).panes.values()].find((p: any) => "surface" in p) as ReaderPane;
      await until(() => !!rd.draft, "the edit");
      key(K("down")); key(K("end")); type("[[greenhouse");
      await until(() => !!completionOf(rd.draft!) && !completionOf(rd.draft!)!.loading, "the popup");
      const lines = screen();
      const label = "greenhouse-calendar · Greenhouse planting calendar";
      const y = lines.findIndex(l => l.includes(label));
      expect(y).toBeGreaterThan(0);
      expect(lines[y]).toContain(" │ ");
      expect(lines.some(l => l.includes("↑↓ move · ⏎/tab inserts"))).toBe(true);
      const previewX = lines[y]!.indexOf(" │ ") + 4;
      for (let n = 0; n < 2; n++) {
        key({ kind: "mouse", action: "down", button: 0, x: previewX, y });
        key({ kind: "mouse", action: "up", button: 0, x: previewX, y });
      }
      expect(rd.draft!.text).not.toContain("[[greenhouse-calendar]]");
      size.cols = 80;
      expect(screen().some(l => l.includes("↑↓ move · ⏎/tab inserts"))).toBe(true);
      size.cols = 160;
      screen();
      const x = lines[y]!.indexOf(label);
      for (let n = 0; n < 2; n++) {
        key({ kind: "mouse", action: "down", button: 0, x, y });
        key({ kind: "mouse", action: "up", button: 0, x, y });
      }
      await until(() => rd.draft!.text.includes("[[greenhouse-calendar]]"), "the candidate outside the measure inserts");
      key(K("esc")); key(K("esc"));
    } finally { size.cols = 160; app.pop(); }
  });

  test("the board's preview", async () => {
    const b = boardScreen(hub.id), B: any = BV.view(b);
    app.push(b);
    try {
      await until(() => B.lanes[0]?.items?.length && B.preview.msg && !B.preview.msg.partial, "the lane and preview", 10_000);
      key(char("e"));
      await clickSeeds(() => B.preview.draft);
    } finally { app.pop(); }
  });

  test("the board's preview under a float: a click on the float's cells doesn't reach the popup (the edit stays open, PIE-812)", async () => {
    const b = boardScreen(hub.id), B: any = BV.view(b);
    const was = (await board.get(beans.id))!;
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
      // The float is elsewhere: the click goes to it, the hidden candidate wasn't inserted, and the edit stays open
      // in the preview as typed, nothing saved.
      await Bun.sleep(100);
      expect(B.preview.draft).toBe(draft);
      expect(draft.lines.at(-1)).toBe("sow [[se");
      expect((await board.get(beans.id))!.revision).toBe(was.revision);
      await b.dispatch.act({ action: "tile.close", tile: "over" }, USER);
      // Back in the preview's edit, esc closes it (put aside as unsent): the note as it was, for the next hosts.
      await b.dispatch.act({ action: "tile.focus", tile: "preview" }, USER);
      for (let i = 0; i < 3 && B.preview.draft; i++) key(K("esc"));
      expect(B.preview.draft).toBeFalsy();
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
