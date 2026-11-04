// PIE-957 (Codex, landing B): undoing a layout change on the board keeps the readers opened into its container; the history's
// snapshot is the live shape, not only what a save would keep. Scratch service, fictional note.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardSpec } from "../src/desk/delivery";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER, type OutlineEvent } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("layout.undo on the board", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 200, rows: 56, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk(boardSpec());
    app.push(desk);
    desk.render(desk.ctx);
    await until(() => desk.panes.size > 0, "the board's tiles");
  }, 30_000);

  afterAll(async () => {
    desk.dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k];
  });

  test("a note opened into the board's readers is still there after a resize is undone", async () => {
    const note = await board.request("create", { author: "user", text: "A note opened on the board" });
    (app as any).lastInput = 0;
    await app.act({ action: "open", args: { id: note.id }, as: "history-agent" });
    const tilesOf = () => (desk.layoutGet() as { tiles: { name: string }[] }).tiles.map(t => t.name);
    await until(() => JSON.stringify(desk.layoutGet()).includes(note.id.slice(0, 8)), "the note opened in a reader");
    const before = tilesOf();
    const target = before.find(n => n !== desk.layoutGet().focus)!;
    const resize = (axis: string) => app.dispatch.act({ action: "tile.resize", args: { axis, by: 2 }, tile: target }, USER).then(() => true, () => false);
    expect((await resize("col")) || (await resize("row"))).toBe(true);
    await app.dispatch.act({ action: "layout.undo", args: {} }, USER);
    expect(tilesOf().sort()).toEqual(before.sort());
    expect(JSON.stringify(desk.layoutGet())).toContain(note.id.slice(0, 8));
  }, 30_000);
});

// PIE-1574: a board's lanes come from its hub, not from the person: ctrl+z on a fresh board has none of their steps to take back.
describe.skipIf(!outliner)("ctrl+z on a fresh board, by real keys", () => {
  const scratch = new Scratch();
  let board: SocketBoard, hub: string, heard: ((e: OutlineEvent) => void) | null = null;
  const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door-fresh");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(e => heard?.(e));   // a board has one subscription: each door here hears it while it's up
    hub = (await scratch.seedShowcase()).notes.hub.id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k]; });

  async function door(state: string, cols: number, rows: number, on = hub) {
    process.env.EP0CH_STATE = join(scratch.root, `door-fresh-${state}-${cols}`);   // no saved layout: the board fills from its hub
    let key: (k: Key) => void = () => {};
    const term: any = { info: { cols, rows, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    heard = e => app.event(e);
    const desk: any = new Desk(boardSpec({ hub: on }));
    app.push(desk);
    const paint = () => (app as any).paint();
    const lanes = () => desk.layoutGet().tiles.filter((t: any) => t.kind === "query").map((t: any) => t.name as string);
    const press = async (...ks: Key[]) => { for (const k of ks) { key(k); paint(); } await Bun.sleep(100); paint(); };
    paint();
    await until(() => { paint(); return lanes().length >= 2; }, "the board's lanes", 8000);
    await Bun.sleep(100); paint();
    return { app, desk, paint, lanes, press, said: () => (app as any).message as string, quit: () => { heard = null; app.quit(); app.drawer.tile?.kill(); } };
  }
  const newHub = async (title: string, lanes: string[]) => {
    const id = (await board.createBlock(null, title, USER)).id;
    for (const lane of lanes) await board.createBlock(id, `${lane} [type::virtual-branch] [query::stage=${lane.toLowerCase()}]`, USER);
    return id;
  };
  const W_PLUS = [ctrl("w"), { kind: "char", ch: "+" }] as Key[];

  for (const [cols, rows] of [[177, 60], [80, 24]] as const) describe(`at ${cols}×${rows}`, () => {
    test("the lanes stay four, whatever ctrl+z says", async () => {
      const d = await door("four", cols, rows);
      try {
        const before = d.lanes();
        expect(before.length).toBe(4);
        for (const _ of [1, 2]) {
          await d.press(ctrl("z"));
          expect(d.lanes()).toEqual(before);
          expect(d.said()).toContain("nothing to undo");
          expect(d.desk.outOfStep()).toEqual([]);
        }
        // A real step is what ctrl+z takes back, and only it: the same lanes after, and nothing left.
        await d.press(...W_PLUS);
        expect(d.desk.history.size).toBe(1);
        await d.press(ctrl("z"));
        expect(d.said()).toContain("put the layout back");
        expect(d.lanes()).toEqual(before);
        await d.press(ctrl("z"));
        expect(d.lanes()).toEqual(before);
        expect(d.said()).toContain("nothing to undo");
      } finally { d.quit(); }
    }, 30_000);

    test("another board: no step, and the steps made before it are gone with its lanes", async () => {
      const other = await newHub(`Second hub ${cols}`, ["Soon", "Later"]);
      const d = await door("switch", cols, rows);
      try {
        await d.press(...W_PLUS);
        await d.app.dispatch.act({ action: "board.hub", args: { id: other } }, USER);
        await until(() => { d.paint(); return d.lanes().join() === "Soon,Later"; }, "the second board's lanes", 8000);
        await d.press(ctrl("z"));
        expect(d.lanes()).toEqual(["Soon", "Later"]);
        expect(d.said()).toContain("to undo");   // the keys may be on the reader it left them in: its own words for the same
        expect(d.desk.outOfStep()).toEqual([]);
      } finally { d.quit(); }
    }, 30_000);

    test("a reader carried to the drawer, then another board: the carry stays carried, on both sides, and the tile is never lost", async () => {
      const other = await newHub(`Third hub ${cols}`, ["Soon", "Later"]);
      const note = await board.createBlock(null, "A note carried away", USER);
      const d = await door("carry", cols, rows);
      try {
        const name = "kept";
        await d.desk.dispatch.act({ action: "tile.open", tile: "preview", args: { kind: "reader", name, mode: "held", note: note.id } }, USER);
        d.paint();
        const reader = d.desk.pane(name);
        expect(reader).toBeDefined();
        await d.desk.dispatch.act({ action: "tile.focus", tile: name }, USER);
        await d.press(ctrl("w"), { kind: "char", ch: "a" });
        const drawer = d.app.drawer.desk as any;
        const inDrawer = () => [...drawer.panes.values()].includes(reader);
        expect(inDrawer()).toBe(true);
        await d.app.dispatch.act({ action: "board.hub", args: { id: other } }, USER);
        await until(() => { d.paint(); return d.lanes().join() === "Soon,Later"; }, "the second board's lanes", 8000);
        await d.press(ctrl("w"), { kind: "char", ch: "B" });
        expect(inDrawer()).toBe(true);
        expect(d.said()).toContain("nothing to undo");
        expect(d.desk.outOfStep()).toEqual([]);
        expect(drawer.outOfStep()).toEqual([]);
      } finally { d.quit(); }
    }, 30_000);

    test("a lane added since a resize: undoing the resize keeps it, the lanes follow the hub", async () => {
      const mine = await newHub(`Fifth lane hub ${cols}`, ["Doing", "Queued", "Review", "Done"]);
      const d = await door("fifth", cols, rows, mine);
      try {
        const before = d.lanes();
        await d.press(...W_PLUS);
        await board.createBlock(mine, "Parked [type::virtual-branch] [query::stage=parked]", USER);
        await until(() => { d.paint(); return d.lanes().length === 5; }, "the fifth lane", 8000);
        const fifth = d.desk.pane("Parked");
        await d.press(ctrl("z"));
        expect(d.said()).toContain("put the layout back");
        await until(() => { d.paint(); return d.lanes().length === 5; }, "the fifth lane after the undo", 8000);
        expect(d.lanes()).toEqual([...before, "Parked"]);
        expect(d.desk.outOfStep()).toEqual([]);
        expect(fifth).toBeDefined();
      } finally { d.quit(); }
    }, 30_000);
  });
});
