// PIE-656: the power bar. One palette over every screen (ctrl+k, the status bar's ^K, `act bar.open`): with nothing
// typed the tiles open on every screen and in the drawer, indented as the layout tree, then what changed; typed, every
// source under its heading; a prefix or tab scopes it to one (% tiles, / notes, > actions, + recent, @ screens, an
// extension's). A pick goes through the shared paths (the drawer's goTo, `open`, the dispatcher), and an agent's bar.*
// never touches the person's bar, keys or screen. A scratch service, fictional notes, the glyphs example extension.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard, type Actor } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

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
    await app.whatChanged.seed(board);
    await app.loadExtensions(true);
    desk = openScreen("desk") as Desk;
    app.push(desk);
    desk.setCurrent(notes.garden!);
    await Bun.sleep(100);
  }, 30_000);
  // Each test starts with the bar put away, whatever the one before left.
  beforeEach(() => { if ((app as any)?.bar) key({ kind: "esc" }); });
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  test("ctrl+k opens it over the screen with the person's keys; with nothing typed it lists the tiles as the tree, then what changed", async () => {
    // Something others changed, so the recent rows have one.
    const m = await board.get(notes.shed!.id);
    await board.update(m!.id, "Bike shed\nthe spare inner tubes, patched", m!.revision!, AGENT);
    await until(() => app.whatChanged.count() === 1, "the change counted");
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
    expect(tiles.map((r: any) => r.label.split(" · ")[0])).toEqual(desk.tileOutline().map(t => t.name).filter((_, i) => i < tiles.length));
    expect(tiles.some((r: any) => (r.depth ?? 0) > 0)).toBe(true);
    await until(() => peek().bar.rows.find((r: any) => r.source === "recent")?.label === "Bike shed", "the change's title read");
    // Drawn: its frame, its scopes, and the person is busy (agents wait).
    const f = frame().join("\n");
    expect(f).toContain("power bar");
    expect(f).toContain("%tiles");
    expect(f).toContain("/notes");
    expect(app.person().busy).toBe(true as boolean);
    // Looking here doesn't mark what changed seen (alt+o does).
    expect(app.whatChanged.count()).toBe(1);
  });

  test("typed, every source answers under its heading; a prefix, tab and backspace move between scopes; esc puts it away", async () => {
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
    key({ kind: "tab" });
    expect(peek().bar.scope).toBe("recent");
    key({ kind: "backtab" });
    key({ kind: "backtab" });
    expect(peek().bar.scope).toBe("notes");
    key({ kind: "backspace" });
    expect(peek().bar.scope).toBe("all");
    key({ kind: "esc" });
    expect(peek().bar).toBeUndefined();
    expect(app.person().busy).toBe(false as boolean);
  });

  test("a note picked opens where opens land; alt+⏎ opens it in a new detail", async () => {
    key(ctrlK); type("/runner");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    // Its preview is the note as a reader draws it.
    await until(() => frame().join("\n").includes("stake them in May"), "the preview drawn by the note surface", 5000);
    key({ kind: "enter" });
    await until(() => (desk.describe() as any).current?.id === notes.beans!.id, "the note opened", 5000);
    expect(peek().bar).toBeUndefined();
    const before = desk.tileOutline().length;
    key(ctrlK); type("/bike");
    await until(() => peek().bar?.rows.length > 0, "the hit", 5000);
    key({ kind: "alt-enter" });
    await until(() => desk.tileOutline().length === before + 1, "a new detail", 5000);
    expect(desk.tileOutline().some(t => t.showing?.id === notes.shed!.id)).toBe(true);
  });

  test("a tile picked gets the keys, its spine opened; alt+⏎ zooms it; one on a screen under this comes up first", async () => {
    const outline = desk.tileOutline(), target = outline.find(t => !t.focused && t.shown && !t.float)!;
    await app.dispatch.press("tile.collapse", { on: true }, target.name);
    expect(desk.tileOutline().find(t => t.name === target.name)!.collapsed).toBe(true);
    key(ctrlK); type(`%${target.name}`);
    const n = peek().bar.rows.findIndex((r: any) => r.label.startsWith(`${target.name} ·`)) + 1;
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
    const row = peek().bar.rows.find((r: any) => r.label.startsWith(`${target.name} ·`));
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
    const rows = peek().bar.rows, at = rows.findIndex((r: any) => r.label.startsWith(`dayview/${name} ·`));
    expect(at).toBeGreaterThanOrEqual(0);
    const parent = rows.find((r: any) => r.label.startsWith("dayview ·"));
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
    expect(r.rows.some((x: any) => x.label.startsWith(`dayview/${name}`))).toBe(true);
  });

  test("an action picked runs as its key would", async () => {
    key(ctrlK); type(">theme.cycle");
    expect(peek().bar.rows[0]).toMatchObject({ label: "theme.cycle", keycap: "alt+t" });
    const was = (await import("../src/theme")).theme().name;
    key({ kind: "enter" });
    const { theme } = await import("../src/theme");
    await until(() => theme().name !== was, "the theme turned", 3000);
  });

  test("an agent's bar.open answers the rows and opens nothing; its bar.pick runs as the agent; it never closes the person's bar", async () => {
    (app as any).lastInput = 0;
    const r = await app.act({ action: "bar.open", args: { query: "bike", scope: "notes" }, as: "wren-agent" }) as any;
    expect(r.rows[0]).toMatchObject({ n: 1, source: "notes", label: "Bike shed" });
    expect(r.scopes.map((s: any) => s.prefix)).toEqual(expect.arrayContaining(["%", "/", ">", "+", "@", "~"]));
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
    key({ kind: "esc" });
  });

  test("an extension's source (glyphs): its prefix scopes the bar to it; a row copies, another runs its action as the extension", async () => {
    key(ctrlK); type("~shade");
    await until(() => peek().bar?.rows.length > 0, "the glyphs answered", 8000);
    expect(peek().bar.scope).toBe("ext.glyphs.glyphs");
    expect(peek().bar.rows.map((r: any) => r.label)).toContain("▒  medium shade");
    key({ kind: "esc" });
    // With a note in front of the person, the source offers to rule it; picked, the extension writes under it.
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
    expect(ruled?.parentId).toBe(desk.current!.id);
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
    key({ kind: "esc" });
  });

  test("an agent-made work item is in +recent, read as `HUB-707 title`, and found by its work id, its page name or its words (PIE-664)", async () => {
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
    // The label reads as /notes does, and the work id, the page name and the title's words each find it.
    for (const q of ["HUB-707", "hub-707", "hutch wrap-up", "end-of-day"]) expect(await ask(q, "recent")).toEqual(["HUB-707 End-of-day update for the hutch"]);
    expect((await ask("hinges", "recent"))[0]).toStartWith(item.workId);
    expect(await ask(item.workId, "recent")).toEqual([expect.stringMatching(new RegExp(`^${item.workId}.*hinges`))]);
    // The notes scope's service search gives the same label for it; a work id nobody has finds nothing.
    expect((await ask("HUB-707", "notes"))[0]).toBe("HUB-707 End-of-day update for the hutch");
    expect(await ask("HUB-999", "recent")).toEqual([]);
  });

  test("a tile showing a work item is listed with its work id, and found by it, by its page name or by its words (PIE-664)", async () => {
    const note = await board.createBlock(null, "Fence the allotment [work-id::HUB-808] [page::Fence plan]\nposts and wire");
    await app.act({ action: "open", args: { id: note.id, fresh: true }, as: "test-agent" });
    await until(() => desk.tileOutline().some(t => t.showing?.id === note.id), "a tile showing it");
    const ask = async (query: string) => ((await app.act({ action: "bar.open", args: { scope: "tiles", query }, as: "test-agent" }) as any).rows.map((x: any) => x.label) as string[]);
    for (const q of ["HUB-808", "fence plan", "allotment"]) expect(await ask(q)).toEqual([expect.stringMatching(/ · HUB-808 Fence the allotment$/)]);
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
    // Typing runs the one search, not the recents.
    type("shed");
    await until(() => peek().bar.query === "shed" && peek().bar.rows[0]?.label === "Bike shed", "the search", 5000);
    key({ kind: "esc" });
  });

  test("the desk's / opens the bar in its notes scope (the one search)", async () => {
    desk.focusPane(desk.pane(desk.tileOutline().find(t => t.kind === "tree")?.name ?? desk.tileOutline()[0]!.name)!, { kind: "user" });
    key(ch("/"));
    await until(() => peek().bar?.scope === "notes", "the notes scope", 3000);
    key({ kind: "esc" });
  });
});
