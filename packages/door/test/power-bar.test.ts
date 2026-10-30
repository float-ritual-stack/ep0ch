// PIE-656: the power bar. One palette over every screen (ctrl+k, the status bar's ^K, `act bar.open`): with nothing
// typed the tiles open on every screen and in the drawer, indented as the layout tree, then what changed; typed, every
// source under its heading; a prefix or tab scopes it to one (% tiles, / notes, > actions, + recent, : screens, an
// extension's). A pick goes through the shared paths (the drawer's goTo, `open`, the dispatcher), and an agent's bar.*
// never touches the person's bar, keys or screen. A scratch service, fictional notes, the glyphs example extension.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { shellWord } from "../src/machine";
import { lineWords } from "../src/surface/actions";
import { traceRequests } from "../src/surface/dispatch";
import { ReaderPane } from "../src/desk/panes";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { Offline, SocketBoard, USER, type Actor } from "../src/socket";
import { askInBar } from "../src/bar/ask";
import { notePageUrl } from "../src/open";
import { KeyDecoder, type Key } from "../src/term";
import { outliner, Scratch, showIn, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const AGENT: Actor = { kind: "agent", id: "wren-agent" };
const ch = (c: string): Key => ({ kind: "char", ch: c });
const ctrlK: Key = { kind: "char", ch: "k", ctrl: true };
setDefaultTimeout(30_000);

describe.skipIf(!outliner)("the power bar", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [];
  let key: (k: Key) => void = () => {};
  const notes: Record<string, Msg> = {};
  const saved: Record<string, string | undefined> = {};
  const screen = () => (app as any).stack.at(-1);
  const frame = () => { (app as any).paint(); return painted.map(plain); };
  const peek = () => app.describe() as any;
  const type = (s: string) => { for (const c of s) key(ch(c)); };
  let desk: Desk;

  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    // The glyphs example in the outline's own extensions folder (a test run reads no user folder).
    cpSync(join(outliner!, "extensions", "glyphs"), join(scratch.outlines, scratch.name, "extensions", "glyphs"), { recursive: true });
    board = new SocketBoard(await scratch.start());
    await board.info();
    const garden = await board.createBlock(null, "Garden plan\nbeds and paths");
    notes.garden = garden;
    notes.beans = await board.createBlock(garden.id, "Runner beans\nstake them in May");
    notes.shed = await board.createBlock(null, "Bike shed\nthe spare inner tubes");
    const term: any = {
      info: { cols: 140, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; },
      invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
    };
    app = new App(term, board, Date.now(), () => {});
    app.whatChanged.outline = "scratch";
    board.subscribe(e => app.event(e));
    await app.loadExtensions(true);
    await app.whatChanged.seed(board);
    desk = openScreen("desk") as Desk;
    app.push(desk);
    showIn(desk, notes.garden!);
    await Bun.sleep(100);
  }, 30_000);
  /** Some tile on the desk shows note `id` (where an open landed). */
  const shows = (id: string) => (desk.layoutGet().tiles as any[]).some(t => t.showing?.id === id);
  // Each test starts with the bar put away, whatever the one before left.
  const closeBar = () => { if (peek().bar?.query) key({ kind: "esc" }); if (peek().bar) key({ kind: "esc" }); };
  beforeEach(closeBar);
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  test("ctrl+k opens it over the screen with the person's keys; with nothing typed it lists the tiles as the tree, then what changed", async () => {
    // Something others changed, so the recent rows have one.
    const m = await board.get(notes.shed!.id);
    await board.update(m!.id, "Bike shed\nthe spare inner tubes, patched", m!.revision!, AGENT);
    await until(() => app.whatChanged.unseenIds().includes(notes.shed!.id), "the shed's change counted");
    expect(frame().at(-1)).toContain("^K");
    key(ctrlK);
    const bar = peek().bar;
    expect(bar).toMatchObject({ scope: "all", query: "" });
    const sources = bar.rows.map((r: any) => r.source);
    expect(sources[0]).toBe("tiles");
    expect(sources.at(-1)).toBe("recent");
    expect(sources.indexOf("recent")).toBeGreaterThan(sources.lastIndexOf("tiles"));
    // The tiles are this screen's, in the layout tree's order, with how deep each sits.
    const tiles = bar.rows.filter((r: any) => r.source === "tiles");
    expect(tiles.map((r: any) => r.detail.split(" · ")[0])).toEqual(desk.tileOutline().map(t => t.name).filter((_, i) => i < tiles.length));
    expect(tiles.find((r: any) => r.detail.startsWith("reader ·"))?.label).toBe("Garden plan");
    expect(tiles.some((r: any) => (r.depth ?? 0) > 0)).toBe(true);
    await until(() => peek().bar.rows.some((r: any) => r.source === "recent" && r.label === "Bike shed"), "the change's title read");
    // Drawn: its frame, its scopes, and the person is busy (agents wait).
    const f = frame().join("\n");
    expect(f).toContain("power bar");
    expect(f).toContain("%tiles");
    expect(f).toContain("/notes");
    expect(app.person().busy).toBe(true as boolean);
    // Looking here doesn't mark what changed seen (alt+o does).
    expect(app.whatChanged.unseenIds()).toContain(notes.shed!.id);
  });

  test("a search with no hits says so on its line once the notes have answered, never notes… (PIE-1403)", async () => {
    key(ctrlK); type("zqxvbnw");
    await (app as any).bar.settled();
    await Bun.sleep(60);                                   // past a frame: what the person sees is the last paint, not a fresh one
    const line = painted.map(plain).find(l => l.includes("› zqxvbnw"))!;
    expect(line).toContain("no matches");
    expect(line).not.toContain("notes…");
  });

  test("at 40 columns a long query reads whole, or scrolled with a « where its start is off the line (PIE-1418)", async () => {
    const info = (app as any).term.info, was = info.cols;
    info.cols = 40;
    try {
      key(ctrlK); type("Gutter swap for the shed");
      await (app as any).bar.settled();
      expect(frame().find(l => l.includes("› Gutter"))).toContain("› Gutter swap for the shed");
      type(" and the porch roof, before the frost");
      await (app as any).bar.settled();
      const line = frame().find(l => /› «/.test(l));
      expect(line).toBeDefined();
      expect(line).toContain("before the frost");
      key({ kind: "home" });
      expect(frame().find(l => l.includes("› Gutter"))).toMatch(/› Gutter swap for the shed.*»/);
    } finally { key({ kind: "esc" }); key({ kind: "esc" }); info.cols = was; }
  });

  test("typed, every source answers under its heading; a prefix and alt+← alt+→ move between scopes; esc puts it away", async () => {
    key(ctrlK); type("garden");
    await until(() => peek().bar.rows.some((r: any) => r.source === "notes"), "the notes search answered", 5000);
    const rows = peek().bar.rows;
    expect(rows.find((r: any) => r.source === "notes").label).toBe("Garden plan");
    for (let i = 0; i < 6; i++) key({ kind: "backspace" });
    key(ch(">"));
    expect(peek().bar.scope).toBe("actions");
    expect(peek().bar.rows.every((r: any) => r.source === "actions")).toBe(true);
    // The focused tile's menu rows come first, each with its key.
    expect(peek().bar.rows.some((r: any) => r.keycap === "ctrl+w x" || r.keycap === "ctrl+w z")).toBe(true);
    key({ kind: "alt-right" });
    expect(peek().bar.scope).toBe("recent");
    key({ kind: "alt-left" });
    key({ kind: "alt-left" });
    expect(peek().bar.scope).toBe("notes");
    // Option+→ / Option+← in terminals that send them as ESC f / ESC b (word jumps) reach the scopes too.
    key({ kind: "alt", ch: "f" });
    expect(peek().bar.scope).toBe("actions");
    key({ kind: "alt", ch: "b" });
    expect(peek().bar.scope).toBe("notes");
    key({ kind: "backspace" });
    expect(peek().bar.scope).toBe("notes");
    key({ kind: "esc" });
    expect(peek().bar).toBeUndefined();
    expect(app.person().busy).toBe(false as boolean);
  });

  test("a scope key, a prefix and a click on a scope run bar.open, keeping what's typed (PIE-1288)", () => {
    const runs: { action: string; args: Record<string, unknown> }[] = [];
    const stop = traceRequests(r => runs.push({ action: r.action, args: r.args }));
    try {
      key(ctrlK); key(ch("/"));
      key({ kind: "alt-right" }); key({ kind: "alt", ch: "b" });
      type("beans");
      const y = frame().findIndex(l => l.includes("%tiles"));
      const x = frame()[y]!.indexOf("%tiles") + 1;
      key({ kind: "mouse", action: "down", x, y, button: 0 } as Key);
      key({ kind: "mouse", action: "up", x, y, button: 0 } as Key);
      expect(peek().bar).toMatchObject({ scope: "tiles", query: "beans" });
    } finally { stop(); }
    expect(runs.filter(r => r.action === "bar.open").map(r => r.args)).toEqual([{}, { scope: "notes", keep: true }, { by: 1 }, { by: -1 }, { scope: "tiles", keep: true }]);
  });

  test("backspacing past an empty action query keeps its scope until an explicit exit", () => {
    key(ctrlK); type(">so");
    for (let i = 0; i < 4; i++) key({ kind: "backspace" });
    expect(peek().bar).toMatchObject({ scope: "actions", query: "" });
    key({ kind: "alt-left" });
    expect(peek().bar.scope).toBe("notes");
    key({ kind: "esc" });
    expect(peek().bar).toBeUndefined();
  });

  test.each(["\x1b\x7f", "\x1b[127;3u"])("Alt+Backspace (%j) deletes a word through terminal input without leaving the scope", bytes => {
    const decoder = new KeyDecoder({ cols: 140, rows: 44, cellW: 9, cellH: 16, kitty: false });
    decoder.keyHandler = k => key(k);
    key(ctrlK); type(">garden path");
    decoder.feed(bytes);
    expect(peek().bar).toMatchObject({ scope: "actions", query: "garden " });
    decoder.feed(bytes);
    expect(peek().bar).toMatchObject({ scope: "actions", query: "" });
    decoder.feed(bytes);
    expect(peek().bar).toMatchObject({ scope: "actions", query: "" });
  });

  test("the line selects and deletes text, and esc clears before closing its scope", () => {
    key(ctrlK); type("/garden path");
    key({ kind: "left", shift: true });
    key({ kind: "left", shift: true });
    key({ kind: "backspace" });
    expect(peek().bar.query).toBe("garden pa");
    key({ kind: "char", ch: "z", ctrl: true });
    expect(peek().bar.query).toBe("garden path");
    key({ kind: "char", ch: "w", ctrl: true });
    expect(peek().bar.query).toBe("garden ");
    key({ kind: "paste", text: "bean row\n" });
    key({ kind: "home", shift: true });
    key({ kind: "char", ch: "x", ctrl: true });
    expect(peek().bar.query).toBe("");
    key({ kind: "char", ch: "z", ctrl: true });
    expect(peek().bar.query).toBe("garden bean row");
    key({ kind: "char", ch: "u", ctrl: true });
    expect(peek().bar.query).toBe("");
    type("again");
    key({ kind: "esc" });
    expect(peek().bar).toMatchObject({ query: "", scope: "notes" });
    key({ kind: "esc" });
    expect(peek().bar).toBeUndefined();
  });

  test("tab extends the common prefix and selects only the fill", async () => {
    await board.createBlock(null, "Zinnia planting calendar");
    await board.createBlock(null, "Zinnia planting guide");
    key(ctrlK); type("/Zinn");
    await until(() => peek().bar?.rows.length >= 2, "zinnia candidates", 5000);
    key({ kind: "tab" });
    expect(peek().bar.query).toBe("Zinnia planting ");
    key({ kind: "backspace" });
    expect(peek().bar.query).toBe("Zinn");
  });

  test("completion advances by words and act edits an agent's own line", async () => {
    await board.createBlock(null, "Marigold watering schedule");
    await app.dispatch.press("bar.open", { scope: "notes", query: "Marigold w" });
    await until(() => peek().bar?.rows.some((r: any) => r.label === "Marigold watering schedule"), "the guide", 5000);
    key({ kind: "tab" });
    expect(peek().bar.query).toBe("Marigold watering ");
    await until(() => peek().bar?.rows.some((r: any) => r.label === "Marigold watering schedule"), "the narrowed guide", 5000);
    key({ kind: "tab" });
    expect(peek().bar.query).toBe("Marigold watering schedule");
    key({ kind: "char", ch: "z", ctrl: true });
    expect(peek().bar.query).toBe("Marigold watering ");
    key({ kind: "char", ch: "z", ctrl: true });
    expect(peek().bar.query).toBe("Marigold w");
    const own = await app.dispatch.act({ action: "bar.edit", args: { op: "cut", query: "private query", from: 0, to: 7 } }, AGENT);
    expect(own).toMatchObject({ query: " query" });
    expect(peek().bar.query).toBe("Marigold w");
  });

  test("the line supports mouse drag and double-click selection", () => {
    key(ctrlK); type("/garden path"); frame();
    const bar = (app as any).bar;
    const x = bar.rect.col + 3, y = bar.rect.row + 2;
    const mouse = (action: "down" | "drag" | "up", col: number) => key({ kind: "mouse", action, button: 0, x: x + col, y });
    mouse("down", 0); mouse("drag", 6); mouse("up", 6);
    key({ kind: "delete" });
    expect(peek().bar.query).toBe(" path");
    key({ kind: "char", ch: "z", ctrl: true }); frame();
    mouse("down", 9); mouse("up", 9); mouse("down", 9); mouse("up", 9);
    key({ kind: "backspace" });
    expect(peek().bar.query).toBe("garden ");
  });

  test("tab fills the line with the lit row's words and keeps the bar open; it no longer changes scope", async () => {
    key(ctrlK); type("/runner");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    const label = peek().bar.rows[0].label as string;
    key({ kind: "tab" });
    expect(peek().bar.scope).toBe("notes");
    expect(peek().bar.query).toBe(label);
    key({ kind: "char", ch: "z", ctrl: true });
    expect(peek().bar.query).toBe("runner");
    key({ kind: "backtab" });
    expect(peek().bar.scope).toBe("notes");
    closeBar();
    // A typed action line keeps its command: tab never fills `run `.
    key(ctrlK); type("tile.focus dir=right");
    await until(() => peek().bar?.rows[0]?.label?.startsWith("run "), "the action line's row", 5000);
    key({ kind: "tab" });
    expect(peek().bar.query).toBe("tile.focus dir=right");
    closeBar();
  });

  test("a note picked opens where opens land; alt+⏎ opens it in a new detail", async () => {
    key(ctrlK); type("/runner");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    // Its preview is the note as a reader draws it.
    await until(() => frame().join("\n").includes("stake them in May"), "the preview drawn by the note surface", 5000);
    key({ kind: "enter" });
    await until(() => shows(notes.beans!.id), "the note opened", 5000);
    expect(peek().bar).toBeUndefined();
    const before = desk.tileOutline().length;
    key(ctrlK); type("/bike");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    key({ kind: "alt-enter" });
    await until(() => desk.tileOutline().length === before + 1, "a new detail", 5000);
    expect(desk.tileOutline().some(t => t.showing?.id === notes.shed!.id)).toBe(true);
  });

  test("the preview reads the note again when the outline changes, and says a failed read as that, not as gone", async () => {
    key(ctrlK); type("/runner");
    await until(() => frame().join("\n").includes("stake them in May"), "the preview", 5000);
    const m = (await board.get(notes.beans!.id))!;
    await board.update(m.id, `${m.text}\nwatered every dawn`, m.revision!, AGENT);
    await until(() => frame().join("\n").includes("watered every dawn"), "the preview shows the change", 5000);
    closeBar();
    // A read that fails: offline is said as offline.
    const get = board.get.bind(board);
    (board as any).get = async () => { throw new Offline("the outline isn't answering (test)"); };
    try {
      key(ctrlK); type("/bike");
      await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
      await until(() => frame().join("\n").includes("offline"), "the preview says offline", 5000);
      expect(frame().join("\n")).not.toContain("that note is gone");
    } finally { (board as any).get = get; closeBar(); }
  });

  test("a tile picked gets the keys, its spine opened; alt+⏎ zooms it; one on a screen under this comes up first", async () => {
    const outline = desk.tileOutline(), target = outline.find(t => !t.focused && t.shown && !t.float)!;
    await app.dispatch.press("tile.collapse", { on: true }, target.name);
    expect(desk.tileOutline().find(t => t.name === target.name)!.collapsed).toBe(true);
    key(ctrlK); type(`%${target.name}`);
    const n = peek().bar.rows.findIndex((r: any) => r.detail.startsWith(`${target.name} ·`)) + 1;
    expect(n).toBeGreaterThan(0);
    await app.dispatch.press("bar.pick", { n });
    const now = desk.tileOutline().find(t => t.name === target.name)!;
    expect(now.collapsed).toBe(false);
    expect(now.focused).toBe(true);
    // alt: zoomed.
    key(ctrlK); type(`%${target.name}`);
    key({ kind: "alt-enter" });
    await until(() => (desk.describe() as any).zoom !== null, "zoomed", 3000);
    await app.dispatch.press("tile.zoom", { on: false });
    // A screen opened over the desk: the desk's tiles are listed under it, and picking one brings the desk back up.
    await app.dispatch.press("screen.open", { name: "who" });
    expect(screen()).not.toBe(desk);
    key(ctrlK); type(`%${target.name}`);
    const row = peek().bar.rows.find((r: any) => r.detail.startsWith(`${target.name} ·`));
    expect(row.group).toContain("under this one");
    key({ kind: "enter" });
    await until(() => screen() === desk, "the desk brought up", 3000);
    expect(desk.tileOutline().find(t => t.name === target.name)!.focused).toBe(true);
  });

  test("a screen mounted on the desk: its tiles are listed under the mount by their mount/tile path; picking one opens the mount from its spine, goes in and gives that tile the keys", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "tile.open", args: { kind: "screen", screen: "brief", name: "dayview" }, tile: desk.keys().focus ?? undefined, as: "wren-agent" });
    const mount = () => desk.tileOutline().find(t => t.name === "dayview")!;
    await until(() => !!mount() && (desk.pane("dayview") as any).inner?.tileOutline().length > 0, "the brief mounted, its tiles made", 8000);
    const inner = (desk.pane("dayview") as any).inner as Desk;
    const name = inner.tileOutline()[0]!.name;
    await app.dispatch.press("tile.collapse", { on: true }, "dayview");
    expect(mount().collapsed).toBe(true);
    key(ctrlK); type(`%dayview/${name}`);
    const rows = peek().bar.rows, at = rows.findIndex((r: any) => r.detail.startsWith(`dayview/${name} ·`));
    expect(at).toBeGreaterThanOrEqual(0);
    const parent = rows.find((r: any) => r.detail.startsWith("dayview ·"));
    expect(rows[at].depth).toBeGreaterThan(parent?.depth ?? mount().depth);
    expect(rows[at].detail).toContain("in a mount");
    await app.dispatch.press("bar.pick", { n: at + 1 });
    expect(mount().collapsed).toBe(false);
    expect(mount().focused).toBe(true);
    expect((desk.pane("dayview") as any).inside).toBe(true);
    expect(inner.tileOutline().find(t => t.name === name)!.focused).toBe(true);
    (desk.pane("dayview") as any).goIn(false);
    // An agent names it by its path, as tile= takes it; it never goes into the mount for the person.
    const r = await app.act({ action: "bar.open", args: { scope: "tiles", query: "dayview" }, as: "wren-agent" }) as any;
    expect(r.rows.some((x: any) => x.detail.startsWith(`dayview/${name} ·`))).toBe(true);
  });

  test("an action picked runs as its key would", async () => {
    key(ctrlK); type(">theme.cycle");
    expect(peek().bar.rows[0]).toMatchObject({ label: "theme.cycle", keycap: "alt+t" });
    const was = (await import("../src/theme")).theme().name;
    key({ kind: "enter" });
    const { theme } = await import("../src/theme");
    await until(() => theme().name !== was, "the theme turned", 3000);
  });

  test("an action's preview is its page: keys as keycaps, its arguments' table, its examples as act lines (PIE-1032)", async () => {
    key(ctrlK); type(">layout.move");
    expect(peek().bar.rows[0]).toMatchObject({ label: "layout.move" });
    await until(() => frame().join("\n").includes("[^W] [m]"), "layout.move's keys as keycaps", 3000);
    const drawn = frame().join("\n");
    // Its examples next, before its arguments: what a short preview shows first.
    expect(drawn).toContain("ep0ch act layout.move tile=activity to=reader where=tabs");
    expect(drawn).toContain("→ puts the activity tile");
  });

  test("an action that takes arguments opens its form: a field each, the tiles to pick from, the act line under them; ⏎ on it runs (PIE-1031)", async () => {
    const outline = desk.tileOutline().filter(t => t.shown && !t.float && !t.docked);
    const [mover, beside] = [outline.find(t => !t.focused)!, outline.find(t => t.focused)!];
    expect(mover && beside).toBeTruthy();
    key(ctrlK); type(">layout.move");
    expect(peek().bar.rows[0]).toMatchObject({ label: "layout.move" });
    key({ kind: "enter" });
    await until(() => peek().bar?.scope === "ask", "layout.move's form", 3000);
    const form = () => peek().bar.form;
    // A field per argument: tile= first (nothing is needed), the rest as layout.move declares them.
    expect(form().fields.map((f: any) => f.name)).toEqual(["tile", "to", "where", "index", "into", "out", "beside"]);
    expect(form()).toMatchObject({ action: "layout.move", focus: "tile", line: "layout.move" });
    await (app as any).bar.settled();
    let drawn = frame().join("\n");
    expect(drawn).toContain("ep0ch act layout.move");
    expect(drawn).toMatch(/▸ tile\s+\(focused\)/);
    // The tile field lists the screen's tiles, leaving it out first; typed words filter them.
    expect(peek().bar.rows[0]).toMatchObject({ label: "leave it out" });
    type(mover.name);
    await until(() => peek().bar.rows.some((r: any) => r.key === `answer:${mover.name}`), "the tile listed", 3000);
    expect(peek().bar.rows[0].key).toBe(`answer:${mover.name}`);
    key({ kind: "enter" });
    await until(() => form()?.focus === "to", "on to to=", 3000);
    expect(form().line).toBe(`layout.move tile=${mover.name}`);
    type(beside.name);
    await until(() => peek().bar.rows[0]?.key === `answer:${beside.name}`, "the other tile", 3000);
    key({ kind: "enter" });
    await until(() => form()?.focus === "where", "on to where=", 3000);
    // where= takes its declared choices only: typing filters them, nothing typed is offered as an answer.
    type("tab");
    await until(() => peek().bar.rows[0]?.key === "answer:tabs", "tabs offered", 3000);
    expect(peek().bar.rows.some((r: any) => r.detail === "as typed")).toBe(false);
    key({ kind: "enter" });
    await until(() => form()?.focus === "index", "on to index=", 3000);
    // shift+tab goes back a field, the answer kept; a click on the act line goes there, and ⏎ runs it.
    key({ kind: "backtab" });
    await until(() => form()?.focus === "where", "back to where=", 3000);
    expect(form().line).toBe(`layout.move tile=${mover.name} to=${beside.name} where=tabs`);
    drawn = frame().join("\n");
    const y = painted.findIndex(l => plain(l).includes("ep0ch act layout.move tile="));
    const x = plain(painted[y]!).indexOf("ep0ch act") + 2;
    key({ kind: "mouse", action: "down", x, y, button: 0 } as Key);
    key({ kind: "mouse", action: "up", x, y, button: 0 } as Key);
    await until(() => form()?.focus === "run", "the act line in focus", 3000);
    expect(peek().bar.rows[0]).toMatchObject({ key: "run", label: `run layout.move tile=${mover.name} to=${beside.name} where=tabs` });
    key({ kind: "enter" });
    // Run as the person: the tile is a tab beside the other now.
    const tabbed = () => { const t = desk.tileOutline(); return !!t.find(x => x.name === mover.name)?.tab && !!t.find(x => x.name === beside.name)?.tab; };
    await until(tabbed, "moved into the other tile's tabs", 3000);
    expect(peek().bar).toBeUndefined();
    await app.dispatch.press("layout.move", { to: beside.name, where: "right" }, mover.name);
  });

  test("a form's example fills it, a typed line starts it, alt+⏎ runs at once, and an agent reads its fields (PIE-1031)", async () => {
    // tile.open alone: its form on kind=, the one it needs, listing the tile kinds.
    key(ctrlK); type("tile.open");
    key({ kind: "enter" });
    await until(() => peek().bar?.form?.focus === "kind", "tile.open's form on kind=", 3000);
    await (app as any).bar.settled();
    expect(peek().bar.rows.some((r: any) => r.key === "answer:tree")).toBe(true);
    expect(frame().join("\n")).toMatch(/kind\s+needed/);
    // Its act line can't run yet: said on the line and on its run row.
    expect(peek().bar.form.refused).toContain("kind");
    // An example picked fills the form, the act line in focus.
    const ex = peek().bar.rows.findIndex((r: any) => r.key === "example:0");
    expect(ex).toBeGreaterThanOrEqual(0);
    await app.dispatch.press("bar.pick", { n: ex + 1 });
    await until(() => peek().bar?.form?.focus === "run", "the example filled", 3000);
    expect(peek().bar.form.refused).toBeUndefined();
    closeBar();
    // A line typed with some of its arguments starts the form with them answered; alt+⏎ answers and runs.
    const tiles = (desk as any).all().length;
    key(ctrlK); type("tile.open where=right");
    key({ kind: "enter" });
    await until(() => peek().bar?.form?.focus === "kind", "the form, where= answered", 3000);
    expect(peek().bar.form.fields.find((f: any) => f.name === "where").value).toBe("right");
    type("tree");
    await until(() => peek().bar.rows[0]?.key === "answer:tree", "tree first", 3000);
    key({ kind: "alt-enter" });
    await until(() => (desk as any).all().length === tiles + 1, "a tree tile opened", 5000);
    expect(peek().bar).toBeUndefined();
    // An agent reads the same fields, with their kinds and choices, and nothing opens.
    const r = await app.act({ action: "bar.form", args: { op: "open", line: "layout.move to=notes" }, as: "wren-agent" }) as any;
    expect(r.fields.find((f: any) => f.name === "to")).toMatchObject({ kind: "tile", value: "notes" });
    expect(r.fields.find((f: any) => f.name === "where").choices).toContain("edge-left");
    expect(r.fields.find((f: any) => f.name === "tile")).toMatchObject({ selector: true, kind: "tile", default: "focused" });
    expect(peek().bar).toBeUndefined();
    await expect(app.act({ action: "bar.form", args: { op: "run" }, as: "wren-agent" })).rejects.toThrow("the person's");
    // Nor through a pick in the ask scope while the person's form is open.
    key(ctrlK); type("tile.open"); key({ kind: "enter" });
    await until(() => peek().bar?.form?.focus === "kind", "the person's form", 3000);
    await expect(app.act({ action: "bar.pick", args: { scope: "ask", n: 1 }, as: "wren-agent" })).rejects.toThrow("the person's");
    expect(peek().bar.form.fields.find((f: any) => f.name === "kind").value).toBeUndefined();
  });

  test("boolean action arguments in the power bar set yolo rather than toggle it (PIE-1004)", async () => {
    try {
      for (const on of [true, true, false, false]) {
        closeBar(); key(ctrlK); type(`> agents.yolo on=${on}`);
        expect(peek().bar.rows[0].refused).toBeUndefined();
        key({ kind: "enter" });
        await until(() => peek().bar?.runs.at(-1)?.line === `agents.yolo on=${on}`, "the action answered in the bar", 3000);
        expect(app.agentsYolo).toBe(on);
        expect((await board.mcpAccessStatus()).yolo === true).toBe(on);
      }
    } finally {
      await app.dispatch.press("agents.yolo", { on: false });
    }
  });

  test("a paste lands whole in the bar's line, and an action line pasted with its arguments is the lit row that ⏎ runs (PIE-856)", async () => {
    key(ctrlK);
    // As a terminal sends it (bracketed paste), copied from a chat with its line break.
    key({ kind: "paste", text: 'tile.open kind=query query="#build-report"\n' });
    expect(peek().bar.query).toBe('tile.open kind=query query="#build-report"');
    expect(peek().bar.rows[0]).toMatchObject({ source: "actions", label: "run tile.open kind=query query=#build-report" });
    const tiles = (desk as any).all().length;
    key({ kind: "enter" });
    await until(() => peek().bar?.runs.at(-1)?.line === "tile.open kind=query query=#build-report", "the command answer", 5000);
    await until(() => (desk as any).all().length === tiles + 1, "the query tile opened", 5000);
    // Right after the run, one Esc puts the bar away; the run waits under "this session" (Evan, Oct 21: "I need to escape a few times").
    key({ kind: "esc" });
    await until(() => !peek().bar, "one Esc closed the bar after the run", 3000);
    // An argument the action doesn't take is said on the row, typed key by key as well as pasted.
    key(ctrlK); type("tile.open kind=query colour=red");
    expect(peek().bar.rows[0]).toMatchObject({ source: "actions", label: "run tile.open kind=query colour=red" });
    expect(peek().bar.rows[0].refused).toContain("colour");
    closeBar();
    // The name alone of one that needs arguments says what it needs, and ⏎ opens its form there (PIE-1031).
    key(ctrlK); type("tile.open");
    expect(peek().bar.rows[0]).toMatchObject({ source: "actions", label: "run tile.open" });
    expect(peek().bar.rows[0].refused).toBeUndefined();
    expect(peek().bar.rows[0].detail).toContain("needs kind=");
    closeBar();
    // An argument the bar asks for takes a paste the same way.
    let answered: Record<string, string> | null = null;
    await askInBar(app as any, "Name the bed", [{ name: "name", type: "text" }], {}, USER, async a => { answered = a; });
    key({ kind: "paste", text: "the bean row\n" });
    expect(peek().bar).toMatchObject({ scope: "ask", query: "the bean row" });
    key({ kind: "enter" });
    await until(() => answered !== null, "the answer given", 3000);
    expect(answered!).toEqual({ name: "the bean row" });
  });

  test("an action line is offered first in any scope, and ⏎ there runs it; never in an argument's answer (PIE-856)", async () => {
    // In the notes scope: the line's row first, under the actions heading, then the notes found.
    key(ctrlK); type('/tile.open kind=query query="#seed-list"');
    await (app as any).bar.settled();
    expect(peek().bar).toMatchObject({ scope: "notes" });
    expect(peek().bar.rows[0]).toMatchObject({ source: "actions", label: "run tile.open kind=query query=#seed-list" });
    const tiles = (desk as any).all().length;
    key({ kind: "enter" });
    await until(() => (desk as any).all().length === tiles + 1, "the query tile opened from the notes scope", 5000);
    await until(() => peek().bar.rows.some((r: any) => r.source === "runs" && r.label.includes("#seed-list")), "the run answer stays visible in the notes scope");
    closeBar();
    // A row the person moved to stays lit as the rows come again, below the line's row.
    key(ctrlK); type('/tile.open kind=query query="#seed-list"');
    await (app as any).bar.settled();
    key({ kind: "down" });
    const lit = peek().bar.rows[peek().bar.selected - 1];
    expect(lit.source).toBe("notes");
    (app as any).bar.refresh(true);
    expect(peek().bar.rows[peek().bar.selected - 1]).toMatchObject({ source: "notes", key: lit.key });
    closeBar();
    // Only the line: words in the tiles scope list no actions.
    key(ctrlK); type("%theme.cycle");
    expect(peek().bar.rows.some((r: any) => r.source === "actions")).toBe(false);
    closeBar();
    // What's typed in an argument's question is its answer, never an action to run.
    let answered: Record<string, string> | null = null;
    await askInBar(app as any, "Name the bed", [{ name: "name", type: "text" }], {}, USER, async a => { answered = a; });
    key({ kind: "paste", text: "tile.open kind=query" });
    expect(peek().bar.rows.every((r: any) => r.source === "ask")).toBe(true);
    key({ kind: "enter" });
    await until(() => answered !== null, "the answer given", 3000);
    expect(answered!).toEqual({ name: "tile.open kind=query" });
  });

  test("an agent's bar.open answers the rows and opens nothing; its bar.pick runs as the agent; it never closes the person's bar", async () => {
    (app as any).lastInput = 0;
    const r = await app.act({ action: "bar.open", args: { query: "bike", scope: "notes" }, as: "wren-agent" }) as any;
    expect(r.rows[0]).toMatchObject({ n: 1, source: "notes", label: "Bike shed" });
    expect(r.scopes.map((s: any) => s.prefix)).toEqual(expect.arrayContaining(["%", "/", ">", "+", ":", "@", "~"]));
    expect(peek().bar).toBeUndefined();
    const focus = desk.keys().focus;
    const picked = await app.act({ action: "bar.pick", args: { query: "runner", scope: "notes", n: 1 }, as: "wren-agent" }) as any;
    expect(picked.picked.label).toBe("Runner beans");
    expect(desk.keys().focus).toBe(focus);
    key(ctrlK);
    await expect(app.act({ action: "bar.close", args: {}, as: "wren-agent" })).rejects.toThrow();
    expect(peek().bar).toBeDefined();
    // While the person has it open, an agent's move of their screen waits (they're busy).
    await expect(app.act({ action: "screen.open", args: { name: "who" }, as: "wren-agent" })).rejects.toThrow();
    closeBar();
  });

  test("an extension's source (glyphs): its prefix scopes the bar to it; a row copies, another runs its action as the extension", async () => {
    key(ctrlK); type("~shade");
    await until(() => peek().bar?.rows.length > 0, "the glyphs answered", 8000);
    expect(peek().bar.scope).toBe("ext.glyphs.glyphs");
    expect(peek().bar.rows.map((r: any) => r.label)).toContain("▒  medium shade");
    closeBar();
    // With a note in front of the person (the reader they're in), the source offers to rule it; picked, the extension writes under it.
    await app.dispatch.act({ action: "tile.focus", tile: "reader" }, { kind: "user" });
    (app as any).lastInput = 0;
    const r = await app.act({ action: "bar.open", args: { scope: "~", query: "double box line" }, as: "wren-agent" }) as any;
    const n = r.rows.find((x: any) => x.label.startsWith("rule"))?.n;
    expect(n).toBeGreaterThan(0);
    // Picked by its source and key, whatever its number now: its action runs through the dispatcher, as the agent.
    const row = r.rows[n - 1];
    const picked = await app.act({ action: "bar.pick", args: { scope: "~", query: "double box line", source: row.source, key: row.key }, as: "wren-agent" }) as any;
    expect(picked.result.written).toHaveLength(1);
    const ruled = await board.get(picked.result.written[0]);
    expect(ruled?.text).toBe("═".repeat(32));
    expect(ruled?.parentId).toBe((desk.paneNamed("reader") as any).msg.id);
  });

  test("what changed while the bar is open keeps the lit row lit and the notes found", async () => {
    key(ctrlK); type("/bike");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    key(ctrlK); // ctrl+k inside the bar types nothing and changes nothing
    expect(peek().bar.query).toBe("bike");
    key(ch("%")); // a prefix only scopes from an empty line: here it's typed
    expect(peek().bar).toMatchObject({ scope: "notes", query: "bike%" });
    key({ kind: "backspace" });
    await until(() => peek().bar?.rows.length > 0, "the hit again", 5000);
    const lit = peek().bar.rows[peek().bar.selected - 1].key;
    const m = await board.get(notes.beans!.id);
    await board.update(m!.id, `${m!.text}\nwatered`, m!.revision!, AGENT);
    await until(() => app.whatChanged.list().some(r => r.blockId === notes.beans!.id && !r.seen), "the change heard");
    expect(peek().bar.rows.length).toBeGreaterThan(0);
    expect(peek().bar.rows[peek().bar.selected - 1].key).toBe(lit);
    closeBar();
  });

  test("an agent-made work item is in +recent, read as `HUB-707 · title`, and found by its work id, its page name or its words (PIE-664)", async () => {
    // Made by an agent: the work id is a property, not part of the title, so the row has to carry it. Then a property-only write.
    const note = await board.createBlock(null, "End-of-day update for the hutch [work-id::HUB-707]\nplanted out, watered", AGENT);
    const m = await board.get(note.id);
    await board.update(note.id, m!.text.replace("\n", " [page::Hutch wrap-up]\n"), m!.revision!, AGENT);
    // And one the workboard's allocator made for an agent: its title already says its id.
    await board.request("work-ids.configure", { prefix: "HUB" });
    await board.createBlock(null, "Hutch work queue [type::work-queue] [project::garden]");
    const item = await board.createRoadmapItem({ title: "Oil the hutch hinges", priority: "medium", project: "garden", arc: "home", tracks: ["doors"] }, AGENT);
    await until(() => app.whatChanged.list().some(r => r.blockId === note.id && r.revision === 2) && app.whatChanged.list().some(r => r.blockId === item.block.id), "both agent-made notes in the change feed");
    await app.whatChanged.titles(board);
    expect(app.whatChanged.list().find(r => r.blockId === note.id)).toMatchObject({ agent: true, workId: "HUB-707", page: "Hutch wrap-up" });
    const ask = async (query: string, scope: string) => {
      const r = await app.act({ action: "bar.open", args: { scope, query }, as: "test-agent" }) as any;
      return r.rows.map((x: any) => x.label) as string[];
    };
    // The label reads as every list does (PIE-1356: the ID, then the title), and the work id, the page name and the title's words each find it.
    for (const q of ["HUB-707", "hub-707", "hutch wrap-up", "end-of-day"]) expect(await ask(q, "recent")).toEqual(["HUB-707 · End-of-day update for the hutch"]);
    expect((await ask("hinges", "recent"))[0]).toStartWith(item.workId);
    expect(await ask(item.workId, "recent")).toEqual([expect.stringMatching(new RegExp(`^${item.workId}.*hinges`))]);
    // The notes scope's service search gives the same label for it; a work id nobody has finds nothing.
    expect((await ask("HUB-707", "notes"))[0]).toBe("HUB-707 · End-of-day update for the hutch");
    expect(await ask("HUB-999", "recent")).toEqual([]);
  });

  test("a tile showing a work item is listed with its work id, and found by it, by its page name or by its words (PIE-664)", async () => {
    const note = await board.createBlock(null, "Fence the allotment [work-id::HUB-808] [page::Fence plan]\nposts and wire");
    await app.act({ action: "open", args: { id: note.id, fresh: true }, as: "test-agent" });
    await until(() => desk.tileOutline().some(t => t.showing?.id === note.id), "a tile showing it");
    const ask = async (query: string) => ((await app.act({ action: "bar.open", args: { scope: "tiles", query }, as: "test-agent" }) as any).rows.map((x: any) => x.label) as string[]);
    for (const q of ["HUB-808", "fence plan", "allotment"]) expect(await ask(q)).toEqual(["HUB-808 · Fence the allotment"]);
  });

  test("/ with nothing typed lists the notes changed most recently first, and ⏎ lands on the latest; typing still runs the search (PIE-664)", async () => {
    const m = await board.get(notes.beans!.id);
    await board.update(m!.id, `${m!.text}\nthinned`, m!.revision!, AGENT);
    key(ctrlK); key(ch("/"));
    await until(() => peek().bar?.scope === "notes" && peek().bar.rows.length > 1, "the recent notes", 5000);
    const rows = peek().bar.rows as { label: string; key: string }[];
    expect(rows[0]!.key).toBe(notes.beans!.id);
    expect(rows.map(r => r.key)).toContain(notes.shed!.id);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
    // The agent's own bar, scope and no query: the same rows.
    const r = await app.act({ action: "bar.open", args: { scope: "notes" }, as: "test-agent" }) as any;
    expect(r.rows[0].key).toBe(notes.beans!.id);
    // ⏎ lands on the latest.
    key({ kind: "enter" });
    await until(() => shows(notes.beans!.id), "the latest opened", 5000);
    key(ctrlK); key(ch("/"));
    await until(() => peek().bar?.scope === "notes" && peek().bar.rows.length > 1, "the recent notes again", 5000);
    // Typing runs the one search, not the recents.
    type("shed");
    await until(() => peek().bar.query === "shed" && peek().bar.rows[0]?.label === "Bike shed", "the search", 5000);
    closeBar();
  });

  // PIE-1297: a hit is a note, and its row menu copies the note's address as every list's menu does.
  test("a notes hit's row menu (alt+m, a right-click on it) copies its id, reference or web link", async () => {
    const copied: string[] = [], copy = (app as any).copy;
    (app as any).copy = function (this: App, text: unknown, ...rest: unknown[]) { if (typeof text === "string") copied.push(text); return copy.call(this, text, ...rest); };
    try {
      key(ctrlK); type("/bike shed");
      await until(() => peek().bar.rows[0]?.label === "Bike shed", "the shed found");
      key({ kind: "alt", ch: "m" } as Key);
      await until(() => frame().some(l => l.includes("2 copy note reference")), "the hit's menu");
      const f = frame();
      expect(f.join("\n")).not.toContain("copy command");
      const y = f.findIndex(l => l.includes("copy note reference")), x = f[y]!.indexOf("copy note reference");
      key({ kind: "mouse", action: "down", x, y, button: 0 } as Key);
      key({ kind: "mouse", action: "up", x, y, button: 0 } as Key);
      await until(() => copied.includes(`((${notes.shed!.id}|Bike shed))`), "the reference copied");
      // A pick puts the menu away; the same row, by a right-click on it: its web link names the outline.
      await until(() => !frame().some(l => l.includes("copy note reference")), "the menu put away");
      const r = frame(), ry = r.findIndex(l => l.includes("Bike shed")), rx = r[ry]!.indexOf("Bike shed") + 1;
      key({ kind: "mouse", action: "down", x: rx, y: ry, button: 2 } as Key);
      await until(() => frame().some(l => l.includes("copy note web link")), "the menu by a right-click");
      const w = frame(), wy = w.findIndex(l => l.includes("copy note web link")), wx = w[wy]!.indexOf("copy note web link");
      key({ kind: "mouse", action: "down", x: wx, y: wy, button: 0 } as Key);
      key({ kind: "mouse", action: "up", x: wx, y: wy, button: 0 } as Key);
      await until(() => copied.some(t => t.endsWith(`/p/${notes.shed!.id}`)), "the web link copied");
      // By keys: the chips read 1 2 3, and 1 is the first entry (copy note id), never a digit typed into the query; alt+1 too.
      key({ kind: "alt", ch: "m" } as Key);
      await until(() => frame().some(l => l.includes("1 copy note id")), "the menu again");
      key(ch("1"));
      await until(() => copied.includes(notes.shed!.id), "the id copied by 1");
      expect(peek().bar.query).toBe("bike shed");
      key({ kind: "alt", ch: "m" } as Key);
      key({ kind: "alt", ch: "2" } as Key);
      await until(() => copied.filter(t => t === `((${notes.shed!.id}|Bike shed))`).length === 2, "the reference copied by alt+2");
      // Menu closed, a digit types again; and typing with it open puts it away, the digits the query's.
      key(ch("9"));
      expect(peek().bar.query).toBe("bike shed9");
      key({ kind: "alt", ch: "m" } as Key);
      key(ch("x")); key(ch("1"));
      expect(peek().bar.query).toBe("bike shed9x1");
      expect(frame().some(l => l.includes("copy note id"))).toBe(false);
      // An agent names the hit by ref=.
      expect(await app.act({ action: "note.copy-ref", args: { kind: "id", ref: notes.shed!.id }, as: "wren-agent" })).toMatchObject({ text: notes.shed!.id, clipboard: false });
    } finally { (app as any).copy = copy; }
  }, 20_000);

  // PIE-1398: whatever note.copy-ref copies, pasted back into the bar, is that note's row, lit, and ⏎ opens it; never a
  // search for its words, never "no action".
  test("a pasted id, reference, line reference, ep0ch:// address or web link is its note's row, and ⏎ opens it (PIE-1398)", async () => {
    const own = (await board.info()).outline!, machine = (await board.info()).machine!;
    const shed = notes.shed!.id;
    const pasted = [
      shed, `((${shed}|zzz))`, `((${shed.slice(0, 8)}|Bike shed))`, `((${shed}^tubes|the spare inner tubes))`,
      `ep0ch://${own}@${machine}/b/${shed}`, notePageUrl(shed, own, {}), notePageUrl(shed, undefined, {}),
    ];
    for (const text of pasted) {
      for (const scope of [null, "notes"] as const) {
        key(ctrlK);
        if (scope) type("/");
        key({ kind: "paste", text });
        await until(() => peek().bar.rows[0]?.source === "notes" && !peek().bar.asking, `${text} named its note`, 3000);
        const bar = peek().bar;
        expect({ text, row: bar.rows[0] }).toMatchObject({ text, row: { source: "notes", label: "Bike shed", key: shed } });
        expect(bar.selected).toBe(1);
        expect(bar.rows.some((r: any) => r.source === "actions" && r.refused)).toBe(false);
        closeBar();
      }
    }
    // ⏎ at once after the paste, over the recent notes / listed before it: the pasted note opens, never a row kept from before.
    showIn(desk, notes.garden!);
    key(ctrlK); type("/");
    await until(() => peek().bar.rows.length > 0 && !peek().bar.asking, "the recent notes");
    key({ kind: "paste", text: `((${shed}|zzz))` });
    key({ kind: "enter" });
    await until(() => !peek().bar && [...(desk as any).panes.values()].some((p: any) => p.msg?.id === shed), "the shed opened", 5000);
    // A reference to a note that isn't there says so on its row, instead of waiting on a search.
    key(ctrlK); key({ kind: "paste", text: "((0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a|gone))" });
    await until(() => peek().bar.rows[0]?.refused !== undefined, "the missing note said");
    expect(peek().bar.rows[0].refused).toContain("no note 0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a");
    closeBar();
  }, 30_000);

  test("while typing, the rows the search gave stay until its answer to what's typed now replaces them (PIE-1398)", async () => {
    key(ctrlK); type("/bike");
    await until(() => peek().bar.rows.some((r: any) => r.label === "Bike shed") && !peek().bar.asking, "the shed found");
    type(" s");
    // Asked again after the pause: the shed's row is still listed while notes… is out.
    expect(peek().bar.asking).toEqual(["notes"]);
    expect(peek().bar.rows.some((r: any) => r.label === "Bike shed")).toBe(true);
    await until(() => !peek().bar.asking, "the new answer");
    expect(peek().bar.rows.some((r: any) => r.label === "Bike shed")).toBe(true);
    closeBar();
  });

  test("the desk's / opens the bar in its notes scope (the one search)", async () => {
    desk.focusPane(desk.pane(desk.tileOutline().find(t => t.kind === "tree")?.name ?? desk.tileOutline()[0]!.name)!, { kind: "user" });
    key(ch("/"));
    await until(() => peek().bar?.scope === "notes", "the notes scope", 3000);
    closeBar();
  });
  test("a mistyped command shows its corrected run, completes arguments and keeps its answer for recall", async () => {
    await app.dispatch.press("tile.expand", {}, "reader");
    const query = "tile.colapse tile=reader on=true direction=v";
    const answer = await app.act({ action: "bar.open", args: { query }, as: "wren-agent" }) as any;
    expect(answer.rows[0]?.label).toBe("run tile.collapse tile=reader on=true dir=v");
    expect(answer.rows[0]?.detail).toContain("tile.colapse -> tile.collapse");
    expect(answer.rows[0]?.detail).toContain("direction -> dir");
    await app.dispatch.press("bar.open", { query });
    const clickRow = frame().findIndex(l => l.includes("run tile.collapse"));
    const clickCol = (app as any).bar.rect.col + 5;
    key({ kind: "mouse", action: "down", x: clickCol, y: clickRow, button: 0 });
    key({ kind: "mouse", action: "up", x: clickCol, y: clickRow, button: 0 });
    expect(desk.tileOutline().find(t => t.name === "reader")?.collapsed).toBe(false);
    await app.dispatch.press("bar.pick");
    expect(peek().bar.runs.at(-1).line).toBe("tile.collapse tile=reader on=true dir=v");
    expect(peek().bar.runs.at(-1)).toMatchObject({ refused: false });
    expect(desk.tileOutline().find(t => t.name === "reader")?.collapsed).toBe(true);
    await app.dispatch.press("bar.edit", { op: "clear" });
    key({ kind: "up" });
    expect(peek().bar.query).toBe("tile.collapse tile=reader on=true dir=v");
    await app.dispatch.press("bar.edit", { op: "clear" });
    key({ kind: "paste", text: "tile.collapse di" });
    await app.dispatch.press("bar.edit", { op: "complete" });
    expect(peek().bar.query).toBe("tile.collapse dir=");
    await app.dispatch.press("bar.edit", { op: "complete" });
    expect(peek().bar.query).toMatch(/^tile.collapse dir=[hv]$/);
    const tile = await app.act({ action: "bar.edit", args: { op: "complete", query: "tile.collapse tile=read" }, as: "wren-agent" }) as any;
    expect(tile.query).toBe("tile.collapse tile=reader");
    const layout = await app.act({ action: "bar.edit", args: { op: "complete", query: "layout.load name=da" }, as: "wren-agent" }) as any;
    expect(layout.query).toBe("layout.load name=daily");
    await app.dispatch.press("tile.open", { kind: "reader", name: "tile-sample" }, "reader");
    const named = await app.act({ action: "bar.edit", args: { op: "complete", query: 'tile.collapse tile="tile-s"' }, as: "wren-agent" }) as any;
    expect(named.query).toBe("tile.collapse tile=tile-sample");
    await app.dispatch.press("tile.close", {}, "tile-sample");
    await app.dispatch.press("tile.collapse", { on: false }, "reader");
  });


  test("docs scroll, select and load examples; a command copies and inserts as one unsaved button step", async () => {
    await app.dispatch.press("tile.focus", {}, "reader");
    showIn(desk, notes.garden!);
    await app.dispatch.press("bar.open", { query: "tile.collapse tile=reader on=true dir=v" });
    frame();
    const docs = () => peek().bar.docs;
    expect(docs().examples).toHaveLength(2);
    const first = docs().examples[0];
    await app.dispatch.press("bar.docs", { op: "select", row: first.row, col: 0, clicks: 3 });
    const copied = await app.dispatch.press("bar.docs", { op: "copy" }) as { text: string };
    expect(copied.text).toContain("tile.collapse");
    const b = (app as any).bar, r = docs().rect;
    key({ kind: "mouse", action: "wheel-down", x: b.rect.col + r.col + 3, y: b.rect.row + r.row + 2, button: 0 });
    frame();
    expect(docs().top).toBeGreaterThan(0);
    await app.dispatch.press("bar.docs", { op: "scroll", by: -100 });
    frame();
    const x = b.rect.col + r.col + 3, y = b.rect.row + r.row + first.row;
    key({ kind: "mouse", action: "down", x, y, button: 0 });
    key({ kind: "mouse", action: "up", x, y, button: 0 });
    expect(peek().bar.query).toBe(first.line);
    await app.dispatch.press("bar.edit", { op: "clear" });
    key({ kind: "paste", text: 'tile.title text="A \\"quoted\\" title" tile=reader' });
    const command = await app.dispatch.press("bar.command", { op: "copy" }) as { text: string };
    const button = await app.dispatch.press("bar.command", { op: "button" }) as { text: string };
    expect(command.text).toStartWith("ep0ch act tile.title");
    // alt+o says it copied, on the status line and in its log, not only in the toast that's gone in a moment (PIE-1428).
    expect((app as any).message).toContain("copied as a note button");
    // The CLI copy is the same words, each shell-quoted, so pasting it into a shell runs what the button runs.
    expect(command.text).toBe(["ep0ch", "act", ...lineWords(buttonCallsOf(button.text)[0]!.act!)].map(shellWord).join(" "));
    await app.dispatch.press("bar.edit", { op: "clear" });
    key({ kind: "paste", text: 'tile.title text="$HOME and `date`" tile=reader' });
    const quoted = await app.dispatch.press("bar.command", { op: "copy" }) as { text: string };
    expect(quoted.text).toContain("'text=$HOME and `date`'");
    await app.dispatch.press("bar.edit", { op: "clear" });
    key({ kind: "paste", text: 'tile.title text="A \\"quoted\\" title" tile=reader' });
    const before = (await board.get(notes.garden!.id))!.text;
    await app.dispatch.press("bar.insert");
    const reader = desk.pane("reader") as ReaderPane;
    expect(reader.draft!.text).toContain(button.text);
    expect(reader.draft!.text.split("\n")[0]).toBe(before.split("\n")[0]);
    expect((await board.get(notes.garden!.id))!.text).toBe(before);
    closeBar();
    await app.dispatch.press("draft.undo", {}, "reader");
    expect(reader.draft!.text).toBe(before);
    await app.dispatch.press("edit.close", {}, "reader");
    const invalid = await app.act({ action: "bar.open", args: { query: "tile.collapse dir=diagonal" }, as: "wren-agent" }) as any;
    expect(invalid.rows[0].refused).toContain("allowed values: v, h");
    const typoValue = await app.act({ action: "bar.open", args: { query: "tile.collapse on=treu" }, as: "wren-agent" }) as any;
    expect(typoValue.rows[0].label).toBe("run tile.collapse on=true");
    expect(typoValue.rows[0].detail).toContain("on=treu -> on=true");
    (app as any).lastInput = 0;
    await app.act({ action: "edit", tile: "reader", as: "wren-agent" });
    await app.dispatch.press("bar.open", { query: "tile.collapse on=true" });
    await expect(app.dispatch.act({ action: "bar.insert" }, USER)).rejects.toThrow("draft belongs to an agent");
    closeBar();
    await app.dispatch.press("edit.close", {}, "reader");
  });

  test("command helpers leave form navigation and private answers alone", async () => {
    await app.dispatch.press("bar.open", { query: "tile.collapse tile=reader on=false" });
    await app.dispatch.press("bar.pick");
    closeBar();
    await app.dispatch.press("bar.form", { op: "open", action: "layout.move" });
    await (app as any).bar.settled();
    key({ kind: "up" });
    expect(peek().bar.query).toBe("");
    await app.dispatch.press("bar.form", { op: "set", field: "tile", value: "reader" });
    const button = await app.dispatch.press("bar.command", { op: "button" }) as { text: string };
    expect(buttonCallsOf(button.text)[0]?.act).toBe("layout.move tile=reader");
    closeBar();
    await askInBar(app as any, "A private answer", [{ name: "token", type: "text", masked: true }], {}, USER, async () => {});
    key({ kind: "paste", text: "tile.collapse dir=" });
    const completed = await app.dispatch.press("bar.edit", { op: "complete" }) as { query: string };
    expect(completed.query).toBe("tile.collapse dir=");
    await expect(app.dispatch.act({ action: "bar.command", args: { op: "button" } }, USER)).rejects.toThrow("answer");
    closeBar();
  });

  test("typing the next command survives a run's answer", async () => {
    await app.dispatch.press("bar.open", { query: "tile.collapse tile=reader on=false" });
    const running = app.dispatch.press("bar.pick");
    key({ kind: "char", ch: "u", ctrl: true });
    key({ kind: "paste", text: "tile.zoom on=true" });
    await running;
    expect(peek().bar.query).toBe("tile.zoom on=true");
    expect(peek().bar.runs.at(-1).line).toBe("tile.collapse tile=reader on=false");
  });

  test("a row's copy command is the line its pick runs: a tile's, a screen's; a note's row has none to copy (PIE-1405)", async () => {
    key(ctrlK); type("%reader");
    const n = peek().bar.rows.findIndex((r: any) => r.source === "tiles" && r.detail.startsWith("reader ·")) + 1;
    expect(n).toBeGreaterThan(0);
    const copied = await app.dispatch.press("bar.command", { op: "copy", n }) as { text: string };
    expect(copied.text).toBe("ep0ch act tile.focus tile=reader");
    // The copy runs: the line is one the door's own act takes.
    key({ kind: "esc" }); key({ kind: "esc" });
    desk.focusTile("tree", USER);
    await app.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    expect(desk.focusedPane()).toBe(desk.pane("reader"));
    key(ctrlK); type(":kanban");
    await until(() => peek().bar.rows.some((r: any) => r.source === "screens"), "the screens answered");
    expect((await app.dispatch.press("bar.command", { op: "copy" }) as { text: string }).text).toBe("ep0ch act screen.open name=K");
    key({ kind: "esc" }); key({ kind: "esc" });
    key(ctrlK); type("/garden");
    await until(() => peek().bar.rows.some((r: any) => r.source === "notes"), "the notes search answered", 5000);
    const hit = peek().bar.rows.findIndex((r: any) => r.source === "notes") + 1;
    await expect(app.dispatch.act({ action: "bar.command", args: { op: "copy", n: hit } }, USER)).rejects.toThrow("its menu copies its reference");
  });

  test("a click lights a row and shows its preview; the next click on it runs it, as enter does (PIE-1405)", async () => {
    key(ctrlK); type("%");
    // The row lit when the bar opened is a first click's: one click on it previews, never runs.
    const top = frame().findIndex(l => l.includes(peek().bar.rows[0].label));
    const tx = frame()[top]!.indexOf(peek().bar.rows[0].label) + 1;
    key({ kind: "mouse", action: "down", x: tx, y: top, button: 0 } as Key); key({ kind: "mouse", action: "up", x: tx, y: top, button: 0 } as Key);
    expect(peek().bar).toBeDefined();
    await Bun.sleep(450);
    // A tile row other than the lit first one, and another tile in focus.
    const rows = peek().bar.rows, n = rows.findIndex((r: any, i: number) => i > 0 && r.source === "tiles" && r.detail.split(" · ")[0] !== "reader");
    expect(n).toBeGreaterThan(0);
    const name = rows[n].detail.split(" · ")[0];
    desk.focusTile("reader", USER);
    const y = frame().findIndex(l => l.includes(rows[n].label) && l.includes(`${name} ·`)), x = frame()[y]!.indexOf(rows[n].label) + 1;
    const click = () => { key({ kind: "mouse", action: "down", x, y, button: 0 } as Key); key({ kind: "mouse", action: "up", x, y, button: 0 } as Key); };
    click();
    expect(peek().bar?.selected).toBe(n + 1);
    expect(desk.focusedPane()).toBe(desk.pane("reader"));
    // Seconds later, not a double click: the second click on the lit row is the pick.
    await Bun.sleep(450);
    click();
    expect(peek().bar).toBeUndefined();
    expect(desk.focusedPane()).toBe(desk.pane(name));
  });

  test("at 40 columns what's pasted reads on the line, and a note that isn't here is named once (PIE-1405)", async () => {
    const link = "https://my.ep0ch.sh/pub/o/garden/p/0b5c2d11-7e4f-4a3b-9c8d-1e2f3a4b5c6d";
    key(ctrlK); key({ kind: "paste", text: link });
    await (app as any).bar.settled(3000).catch(() => {});
    const line = ((app as any).bar.draw(40, 30) as { lines: string[] }).lines.map(plain).find(l => l.includes("›"))!;
    // The line shows the link's last cells, the whole field's worth, not ten of them.
    expect(line).toContain(link.slice(-30));
    key({ kind: "esc" }); key({ kind: "esc" });
    const id = "0b5c2d11-7e4f-4a3b-9c8d-1e2f3a4b5c6d";
    key(ctrlK); key({ kind: "paste", text: id });
    await until(() => peek().bar.rows.some((r: any) => r.refused), "the address answered", 5000);
    const row = peek().bar.rows.find((r: any) => r.refused);
    expect(row.label).toBe(id);
    expect(row.refused).not.toContain("0b5c2d11");
    expect(row.refused).toContain("this outline");
    // Its refusal reads whole at 40 columns, the how-to included, wrapped under the id rather than cut (PIE-1428).
    const drawn = ((app as any).bar.draw(40, 30) as { lines: string[] }).lines.map(plain).map(l => l.replace(/^[^│]*│|│[^│]*$/g, "").trim()).join(" ").replace(/\s+/g, " ");
    expect(drawn).toContain("opens by its ep0ch:// or web link");
  });

});
