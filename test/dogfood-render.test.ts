// PIE-509: what the door drew wrong in a real pane on a realistically shaped (fictional) outline. A sparkline and
// a typed line's cursor use glyphs the kitty+crt font (CP437) has; a board lane's header names its view as written
// and its cards show the view's [summary-properties::]; a reader showing a note that goes to the Trash (a
// proposal dismissed elsewhere) says so and drops its [apply] [dismiss]; search puts the note titled with the
// words first and its preview reads links by their labels; the river says "1 reply". Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CP437_HIGH } from "../src/ansi";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { primitiveLines } from "../src/components";
import { boardScreen } from "../src/desk/screen-specs";
import * as BV from "./board-view";
import { Desk, searchPreviewLines } from "../src/desk/desk";
import { renderGraph } from "../src/graphs";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { vgaCode } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

/** Every glyph the VGA font (CP437) draws; anything else is a ? on kitty+crt. */
const CP437 = new Set([...CP437_HIGH, ..."☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼"]);
const notCp437 = (s: string) => [...visible(s)].filter(c => c.charCodeAt(0) >= 128 && !CP437.has(c));
const msg = (id: string, text: string): Msg => ({ id, text, props: {}, author: "user", parentId: null, childIds: [], createdAt: 0, updatedAt: 0 } as unknown as Msg);

test("a component's sparkline and a ::graph-spark figure draw only CP437 glyphs, still low to high", () => {
  const spark = primitiveLines({ type: "sparkline", label: "Dread", values: [2, 3, 9, 1, 6, 7, 5] }, 40).join("\n");
  expect(notCp437(spark)).toEqual([]);
  const strip = visible(spark).trim().split(/\s+/).at(-1)!;
  expect(strip).toHaveLength(7);
  expect(strip[3]).toBe("_");                                   // the lowest
  expect(strip[2]).toBe("█");                                   // the highest
  const fig = renderGraph("spark", "title: Rain\ndata: [2, 0, 5, 11, 3, 0, 7]", 60).join("\n");
  expect(notCp437(fig).filter(c => c !== "┊")).toEqual([]);      // the figure's frame is the mirror's to map
  expect(visible(fig)).toContain("_");
});

test("a search hit's preview reads a ((id|label)) by its label and **bold** as bold, never the id or the stars", () => {
  const m = msg("x", "Night now\n- **Shed inventory:** counted in ((f7904621-2e6c-42c2-abd6-7abb1d05cb73|the bike shed)).");
  const text = searchPreviewLines(m, 60).map(visible).join("\n");
  expect(text).toContain("Shed inventory: counted in the bike shed.");
  expect(text).not.toContain("f7904621");
  expect(text).not.toContain("**");
});

describe.skipIf(!outliner)("on a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, agent: SocketBoard, app: App, hub: any;
  let key: (k: Key) => void = () => {};
  const make = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "user" });
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => (screen().render((screen() as any).ctx ?? app).lines as string[]).map(visible);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    agent = new SocketBoard(scratch.sock);
    await agent.info();
    for (const [t, a, s] of [["The Hedge Layer's Year", "M. Thorn", "todo"], ["Small Engines", "R. Pike", "now"]]) await make(null, `${t} [type::reading] [author::${a}] [state::${s}]`);
    await make(null, "Two Hands [type::reading] [author::A. Oak] [author::B. Ash] [state::todo]");
    hub = await make(null, "Reading hub");
    await make(hub.id, "To read [type::virtual-branch] [query::type=reading state=todo] [summary-properties::author]");
    await make(hub.id, "Reading now [type::virtual-branch] [query::type=reading state=now] [summary-properties::author]");
    const lone = await make(null, "Pantry");
    await make(lone.id, "Jars on the top shelf");
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close(); agent?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  }, 20_000);

  test("search puts the note titled with the words first (the service's goto order), not the newest mention", async () => {
    const titled = await make(null, "Seed catalogue\n- beans\n- peas");
    for (const n of ["Night now\nSee [[Seed catalogue]].", "Order list\nFrom the Seed catalogue, page 4.", "Seed catalogue extras\nPostage."]) await make(null, n);
    const hits = await board.search("Seed catalogue", 30);
    expect(hits[0]!.id).toBe(titled.id);
    expect(hits[0]!.text).toContain("- peas");                         // read whole, for the preview
    expect(hits.map(m => m.text.split("\n")[0])).toContain("Night now");
  });

  test("a lane's header names its view as written, and its cards show the view's summary properties", async () => {
    const b = boardScreen(hub.id, false);
    app.push(b);
    await until(() => BV.view(b).lanes.length === 2 && BV.view(b).lanes.every((l: any) => l.items?.length) && BV.view(b).lanes[0].items.length === 2, "the lanes", 10_000);
    const top = lines()[0]!;
    expect(top).toContain("To read 2");
    expect(top).toContain("Reading now 1");
    expect(top).not.toContain("To-read");
    const all = lines().join("\n");
    expect(all).toContain("M. Thorn");
    expect(all).toContain("R. Pike");
    expect(all).toContain("A. Oak, B. Ash");                           // repeated values joined, as the reader does
    // The tile keeps its name for reader=.
    expect(b.layoutGet().tiles.map((t: any) => t.name)).toContain("Reading-now");
    app.pop();
  });

  test("a reader showing a proposal that's dismissed elsewhere says it's in the Trash, with no [apply] [dismiss]", async () => {
    const note = await make(null, "Compost notes\nThe bin  is   full.\nTurn it twice.");
    await board.update(note.id, "Compost notes\nThe bin  is   full.\nTurn it twice a week.", note.revision);
    const observed = "The bin  is   full.", start = note.text.indexOf(observed);
    const r = await agent.request<any>("draft.patch", { blockId: note.id, revision: note.revision, mutation: { author: "agent", actorId: "tidy" }, patches: [{ observed, replacement: "The bin is full.", range: { start, end: start + observed.length }, unit: "utf16" }] });
    expect(r.outcome).toBe("proposed");
    const desk = new Desk();
    app.push(desk);
    await app.act({ action: "open", args: { id: r.proposalId }, as: "walker-509" });
    await until(() => lines().join("\n").includes("[apply] [dismiss]"), "the proposal's controls", 10_000);
    await agent.trash(r.proposalId, { kind: "agent", id: "tidy" });
    await until(() => lines().join("\n").includes("in the Trash"), "the reader saying the proposal is in the Trash", 10_000);
    expect(lines().join("\n")).not.toContain("[apply] [dismiss]");
    app.pop();
  });

  test("everything the daily desk draws has a glyph in the VGA font a snapshot draws with (none comes out ?)", async () => {
    process.env.EP0CH_DAILY_AGENT = "sh";
    const desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    await app.act({ action: "open", args: { id: hub.id }, as: "walker-509" });
    await until(() => lines().join("\n").includes("Reading hub"), "a note in a reader", 10_000);
    (desk as any).focus = [...(desk as any).names].find(([, v]: any) => v === "side")[0];
    key({ kind: "char", ch: "w", ctrl: true }); key({ kind: "char", ch: "f" });             // a float, with its ⧉ and ◢
    const missing = new Set([...lines().join("")].filter(c => c !== "?" && vgaCode(c) === 63));
    expect([...missing]).toEqual([]);
    key({ kind: "char", ch: "w", ctrl: true }); key({ kind: "char", ch: "f" });
    app.pop();
    delete process.env.EP0CH_DAILY_AGENT;
  });

  test("the river says 1 reply, not 1 replies", async () => {
    const river = openScreen("river") as Desk;
    app.push(river);
    await until(() => (riverView(river).column(1)?.items?.length ?? 0) >= 3, "the Library", 10_000);
    await until(() => lines().join("\n").includes("» 1 reply"), "the Pantry's one reply", 10_000);
    expect(lines().join("\n")).not.toContain("1 replies");
    app.pop();
  });
});
