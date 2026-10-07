// Autocomplete everywhere you write (PIE-626): the one completer, on every door text input that takes outline text.
// A Draft (a comment, the board's composer, a new note's float) and a LineInput (a property's value, a river column's
// filter) complete by default; a line that holds a name or plain words opts out. Fictional notes, a scratch service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mergeComponentSchemas } from "@ep0ch/outline-core/component-schema";
import { App } from "../src/app";
import { CommentSession } from "../src/comment";
import { filterTargetAtCursor } from "../src/completion";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { Draft } from "../src/edit";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import { completerOf, completionOf, lookupCompletion, stopCompletion, useCompletion, type CompletionBoard } from "../src/surface/completer";
import { LineInput } from "../src/surface/line";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import { view as riverView } from "./river-view";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const K = (kind: "up" | "down" | "enter" | "esc" | "tab" | "left" | "right" | "end"): Key => ({ kind } as Key);
const click = (key: (k: Key) => void, x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };

describe("a filter's word at the cursor", () => {
  test("a key being typed, a key's value after its colon, a leading - left out, a bare word a key still", () => {
    expect(filterTargetAtCursor("sta", 3)).toEqual({ kind: "filter-key", start: 0, end: 3, query: "sta" });
    expect(filterTargetAtCursor("type:hub sta", 12)).toEqual({ kind: "filter-key", start: 9, end: 12, query: "sta" });
    expect(filterTargetAtCursor("type:hub -status:do", 19)).toEqual({ kind: "filter-value", start: 17, end: 19, query: "do", key: "status" });
    expect(filterTargetAtCursor("type:", 5)).toEqual({ kind: "filter-value", start: 5, end: 5, query: "", key: "type" });
    // The word's end is where a choice replaces up to, whatever follows the cursor.
    expect(filterTargetAtCursor("ty hub", 2)).toEqual({ kind: "filter-key", start: 0, end: 2, query: "ty" });
    // Nothing is offered for an empty word (a space just typed), or for what can't be a key.
    expect(filterTargetAtCursor("type:hub ", 9)).toBeNull();
    expect(filterTargetAtCursor("9", 1)).toBeNull();
  });
});

describe("every line completes by default, with an opt-out (a fake service)", () => {
  const tick = () => new Promise(r => setTimeout(r, 25));
  const asked: string[] = [];
  const board = {
    completePages: async () => ({ addresses: [{ address: "gardening", blockId: "b1", kind: "page", title: "Gardening" }], completeness: { kind: "complete" } }),
    completeFiles: async () => [],
    searchBlocks: async (q: string) => { asked.push(q); return { matches: [{ block: { id: "b2", revision: 1 }, title: "Xylophone lessons", path: "", snippet: "Xylophone lessons", exact: false }], completeness: { kind: "complete" }, semantic: { status: "lexical" } }; },
    blockContext: async (id: string) => ({ selected: { id, text: "Xylophone lessons" }, ancestors: [] }),
    workIdPrefix: async () => null,
    componentSchemas: async () => mergeComponentSchemas({ headingStyles: [] }),
    propertyCatalog: async (key: string | undefined, prefix: string) => (key
      ? [{ key, value: "queued", count: 4 }, { key, value: "done", count: 2 }].filter(c => c.value.startsWith(prefix))
      : [{ key: "stage", value: "queued", count: 4 }, { key: "stage", value: "done", count: 2 }, { key: "status", value: "open", count: 1 }, { key: "type", value: "note", count: 9 }].filter(c => c.key.startsWith(prefix))),
  };
  const type = (i: LineInput, s: string) => { for (const c of s) i.key(char(c)); };

  test("a line made while the door runs completes `((` and a `[key` as a draft does; opted out, or with no door, it never does", async () => {
    useCompletion(board as unknown as SocketBoard);
    try {
      const line = new LineInput("");
      type(line, "see ((xylo");
      await until(() => !!completionOf(line) && !completionOf(line)!.loading, "the popup");
      expect(completionOf(line)!.items.map(i => i.insertion)).toEqual(["((b2))"]);
      // ↓ and ⏎ are the popup's while it has candidates; the line's text is spliced in.
      expect(line.key(K("enter"))).toBe(true);
      await until(() => line.text === "see ((b2))", "the insertion");
      expect(completionOf(line)).toBeNull();
      // With nothing to choose, ⏎ and esc are the caller's again.
      expect(line.key(K("enter"))).toBe(false);
      expect(line.key(K("esc"))).toBe(false);
      // A property key, from the component schemas' one list.
      const key = new LineInput("");
      type(key, "[heading-p");
      await until(() => !!completionOf(key) && !completionOf(key)!.loading && completionOf(key)!.items.length > 0, "the keys");
      expect(completionOf(key)!.items.map(i => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
      // Opted out: a name, a path, plain words.
      const name = new LineInput("", false, { complete: false });
      type(name, "((xylo");
      await tick();
      expect(completerOf(name)).toBeNull();
      expect(name.text).toBe("((xylo");
    } finally { stopCompletion(board as unknown as SocketBoard); }
    const none = new LineInput("");
    type(none, "((xylo");
    await tick();
    expect(completerOf(none)).toBeNull();
    expect(none.completionHost).toBeNull();
  });

  test("a filter's line offers the outline's property keys, then the values of the key before its colon", async () => {
    useCompletion(board as unknown as SocketBoard);
    try {
      const f = new LineInput("", false, { complete: { grammar: "filter" } });
      type(f, "type:note st");
      await until(() => !!completionOf(f) && !completionOf(f)!.loading, "the keys");
      expect(completionOf(f)!.target).toMatchObject({ kind: "filter-key", query: "st" });
      expect(completionOf(f)!.items.map(i => i.insertion).slice(0, 2)).toEqual(["stage:", "status:"]);
      expect(completionOf(f)!.items[0]!.label).toBe("stage (6)");
      f.key(K("down")); f.key(K("up"));
      expect(f.key(K("enter"))).toBe(true);
      await until(() => f.text === "type:note stage:" && !!completionOf(f) && !completionOf(f)!.loading && completionOf(f)!.target.kind === "filter-value", "the values");
      expect(completionOf(f)!.items.map(i => i.insertion)).toEqual(["queued", "done"]);
      type(f, "do");
      await until(() => completionOf(f)?.target.query === "do" && !completionOf(f)!.loading, "the narrowed values");
      f.key(K("tab"));
      await until(() => f.text === "type:note stage:done", "the choice");
      expect(completionOf(f)).toBeNull();                                  // a chosen value ends it: ⏎ is the caller's again
      await tick();
      expect(completionOf(f)).toBeNull();
      expect(f.key(K("enter"))).toBe(false);
      expect(f.cursor).toBe("type:note stage:done".length);
      // The same candidates an agent gets, without typing.
      const r = await lookupCompletion(board as unknown as CompletionBoard, { kind: "filter-value", start: 0, end: 0, query: "", key: "stage", words: true }, null);
      expect(r.items.map(i => i.insertion)).toEqual(["queued", "done"]);
    } finally { stopCompletion(board as unknown as SocketBoard); }
  });
});

describe.skipIf(!outliner)("on every surface that takes outline text, on a scratch service", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, key: (k: Key) => void = () => {}, hub: any, beans: any, seeds: any;
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const top = () => (app as any).stack.at(-1);
  const screen = () => (top().render(app).lines as string[]).map(visible);
  const type = (s: string) => { for (const c of s) key(char(c)); };
  const host = (): SurfaceHost => ({ ctx: { board, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  const ready = (d: Draft | LineInput) => until(() => !!completionOf(d) && !completionOf(d)!.loading && completionOf(d)!.items.length > 0, "the popup");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Done [type::virtual-branch] [query::stage=done]");
    beans = await create(null, "Stake the beans [stage::queued] [priority::high]\nCanes along the fence.");
    await create(null, "Water the squash [stage::done]\nMornings.");
    seeds = await create(null, "Seed list [page::seeds]\nWhat to sow this spring.");
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("a comment's composer offers a property key and notes, with no completer of its host's: the session's own default", async () => {
    const msg = (await board.get(seeds.id))!;
    const s = new CommentSession(msg, [], "select");
    s.passage!.selectText("sow this spring");
    s.write();
    const d = s.composer!;
    // The env hands no completer (`complete`): the draft session attaches its own from its connection.
    const env: any = { board, external() {}, flash() {}, redraw() {} };
    for (const c of "needs [heading-p") s.key(char(c), env);
    await ready(d);
    expect(completionOf(d)!.target).toMatchObject({ kind: "key", query: "heading-p" });
    expect(completionOf(d)!.items.map(i => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
    s.key(K("esc"), env);
    expect(completionOf(d)).toBeNull();
    for (const c of " ((bean") s.key(char(c), env);
    await until(() => completionOf(d)?.target.kind === "block" && !completionOf(d)!.loading && completionOf(d)!.items.length > 0, "the notes");
    s.key(K("enter"), env);
    await until(() => d.text.endsWith(`((${beans.id}))`), "the block inserted");
    s.key(K("esc"), env); s.key(K("esc"), env);
  });

  test("the board's composer: a property key, and ((, then a click on a candidate", async () => {
    const b = boardScreen(hub.id), B: any = BV.view(b);
    app.push(b);
    try {
      await until(() => B.lanes[0]?.items?.length, "the lanes", 10_000);
      key(char("n"));
      await until(() => !!B.model.composer, "the composer");
      const d: Draft = B.model.composer.session.draft;
      type("Thin the carrots [heading-p");
      await ready(d);
      expect(completionOf(d)!.target).toMatchObject({ kind: "key" });
      key(K("esc")); type(" ((stake");
      await until(() => completionOf(d)?.target.kind === "block" && !completionOf(d)!.loading && completionOf(d)!.items.length > 0, "the notes");
      const lines = screen();
      const y = lines.findIndex(l => l.includes("Stake the beans") && l.includes("»"));
      expect(y).toBeGreaterThan(0);
      click(key, lines[y]!.indexOf("Stake the beans"), y);
      await until(() => d.text.endsWith(`((${beans.id}))`), "the clicked candidate");
      key(K("esc")); key(K("esc"));
    } finally { app.pop(); }
  });

  test("a new note's float completes as an edit does", async () => {
    const desk = new Desk() as any;
    app.push(desk);
    try {
      desk.render(desk.ctx);
      await until(() => desk.panes.size > 0, "the desk's tiles", 10_000);
      await app.act({ action: "tile.open", args: { kind: "detail", note: beans.id, name: "beansd" } });
      await until(() => (desk.panes.get(desk.idNamed("beansd")) as any)?.msg?.id === beans.id, "the detail");
      desk.focusOn("beansd");
      key(ctrl("n"));
      const floats = () => (desk.describe().floats as any[]).filter(f => f.newNote);
      await until(() => floats().length === 1 && floats()[0].writing, "the floating draft", 8000);
      const f = floats()[0], pane = desk.panes.get(desk.idNamed(f.tile)) as any;
      desk.focusOn(f.tile);
      const d: Draft = pane.surface.draft;
      type("[heading-p");
      await ready(d);
      expect(completionOf(d)!.target).toMatchObject({ kind: "key", query: "heading-p" });
      key(K("esc")); type(" [[se");
      await until(() => completionOf(d)?.target.kind === "page" && !completionOf(d)!.loading && completionOf(d)!.items.length > 0, "the pages");
      key(K("enter"));
      await until(() => d.text.includes("[[seeds]]"), "the page");
      await desk.dispatch.press("tile.close", {}, f.tile);
    } finally { desk.dispose?.(); app.pop(); }
  });

  test("the property panel's value: [[ offers pages (a click chooses), and the key's own values come from the outline and the schemas", async () => {
    const s = new NoteSurface(), h = host();
    s.show((await board.get(beans.id))!, h);
    key = key;                                                             // the App's input stays; this surface is keyed directly
    const press = (k: Key) => s.key(k, h);
    press(char("i"));
    const rows = () => s.panel!.at;
    await until(() => s.panel && rows().length > 0 || (s.render(100, 30, h), rows().length > 0), "the panel");
    s.render(100, 30, h);
    // The row for stage::queued.
    const stage = (s as any).rows(s.msg!).find((r: any) => r.key === "stage");
    s.panel!.sel = stage.n - 1;
    press(K("enter"));
    const f = s.panel!.field!;
    expect(f.input.complete).toEqual({ valueKey: "stage" });
    // The outline's values of it first, most used first, then what the schemas know.
    press(ctrl("u")); for (const c of "d") press(char(c));
    await ready(f.input);
    expect(completionOf(f.input)!.items.map(i => i.insertion)).toEqual(["done"]);
    const drawn = s.render(100, 30, h).lines.map(visible).join("\n");
    expect(drawn).toContain("values 1/1");
    // A click on the candidate chooses it (the popup's rows are on the surface's).
    const lines = s.render(100, 30, h).lines.map(visible);
    const y = lines.findIndex(l => /» done/.test(l));
    expect(y).toBeGreaterThan(0);
    s.click(lines[y]!.indexOf("done"), y, h);
    await until(() => f.input.text === "done", "the clicked value");
    // ⏎ with no popup saves, as it always did; and [[ in a value offers pages.
    press(ctrl("u")); for (const c of "[[se") press(char(c));
    await until(() => completionOf(f.input)?.target.kind === "page" && !completionOf(f.input)!.loading && completionOf(f.input)!.items.length > 0, "the pages");
    expect(completionOf(f.input)!.items.map(i => i.insertion)).toContain("[[seeds]]");
    press(K("esc"));                                                       // the popup only
    expect(s.panel!.field).toBe(f);
    press(K("esc"));                                                       // then the field
    expect(s.panel!.field).toBeNull();
  });

  test("the river column's filter: keys and values from the property index, ⏎ and a click choose, esc closes the popup first", async () => {
    const river = openScreen("river") as Desk, V = () => riverView(river);
    app.push(river);
    try {
      await until(() => !!V().column(1)?.items?.length, "the Library", 10_000);
      const col = V().column(1);
      key(char("/"));
      expect(col.mode).toBe("filter");
      type("sta");
      await ready(col.input);
      expect(completionOf(col.input)!.target).toMatchObject({ kind: "filter-key", query: "sta" });
      expect(completionOf(col.input)!.items.map(i => i.insertion)).toContain("stage:");
      // Drawn above the line being typed, in the column's foot.
      expect(screen().join("\n")).toContain("properties 1/");
      key(K("esc"));
      expect(completionOf(col.input)).toBeNull();
      expect(col.mode).toBe("filter");                                      // the popup's esc, not the filter's
      type("ge:");
      await until(() => completionOf(col.input)?.target.kind === "filter-value" && !completionOf(col.input)!.loading && completionOf(col.input)!.items.length > 0, "the values");
      expect(col.input.text).toBe("stage:");
      const lines = screen();
      const y = lines.findIndex(l => /» (queued|done)/.test(l));
      expect(y).toBeGreaterThan(0);
      click(key, lines[y]!.indexOf("»") + 3, y);
      await until(() => /^stage:(queued|done)$/.test(col.input.text), "the clicked value");
      key(K("enter"));                                                       // no popup now: ⏎ applies the filter
      expect(col.mode).toBe("");
      await until(() => col.filter.length === 1 && col.filter[0]!.key === "stage", "the filter applied");
      // tab chooses a candidate while the popup is open (it is the desk's next-tile key otherwise).
      const focus = V().focusedTitle();
      key(char("/")); key(ctrl("u")); type("typ");
      await ready(col.input);
      key(K("tab"));
      await until(() => col.input.text === "type:", "tab's choice");
      expect(V().focusedTitle()).toBe(focus);
      key(K("esc")); key(K("esc"));
    } finally { app.pop(); }
  });

  test("agents get the candidates through the actions: column.complete for a filter, complete with key= for a property's value", async () => {
    const river = openScreen("river") as Desk;
    app.push(river);
    try {
      await until(() => !!riverView(river).column(1)?.items?.length, "the Library", 10_000);
      const tile = riverView(river).name(riverView(river).column(1));
      const r: any = await app.act({ action: "column.complete", args: { text: "type:note sta" }, tile });
      expect(r.kind).toBe("filter-key");
      expect(r.items.map((i: any) => i.insertion)).toContain("stage:");
      const v: any = await app.act({ action: "column.complete", args: { text: "stage:" }, tile });
      expect(v.items.map((i: any) => i.insertion)).toEqual(expect.arrayContaining(["queued", "done"]));
      await expect(app.act({ action: "column.complete", args: { text: "type:hub " }, tile })).rejects.toThrow("nothing to complete");
      // The panel's value, as an agent asks it: the same list the field's popup shows.
      const s = new NoteSurface(), h = host();
      s.show((await board.get(beans.id))!, h);
      const p: any = await s.act("complete", { text: "do", key: "stage" }, h, { kind: "agent", id: "claude-7" });
      expect(p.items.map((i: any) => i.insertion)).toEqual(["done"]);
    } finally { app.pop(); }
  });
});
