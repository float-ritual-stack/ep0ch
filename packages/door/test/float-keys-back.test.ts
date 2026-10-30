// PIE-1445: a float the person opens while typing in a terminal (a tile on the desk, or the drawer's agent) gives their keys
// back to that terminal when it closes, as the person's whereabouts had them: never tile 1, never the drawer put away.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import { KeyDecoder } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const click = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

describe.skipIf(!outliner)("closing a float gives the keys back to the terminal that had them (PIE-1445)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request<any>("create", { parentId: null, text: "Kettle descaling: vinegar, then rinse twice", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_NEW_NOTE"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-float-back-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
    delete process.env.EP0CH_NEW_NOTE;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols = 177, rows = 60) {
    const info = { cols, rows, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "kettle" }, tile: "reader" }, USER);
    const A = app as any;
    const paint = () => A.paint();
    paint();
    const kettle = () => desk.pane("kettle") as PtyPane;
    const agent = () => app.drawer.tile as PtyPane | undefined;
    await until(() => kettle()?.running === true, "kettle runs");
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const shown = (p: () => PtyPane | undefined) => (p()?.text() ?? []).join("\n");
    const floats = (on: Desk = desk): string[] => (on as any).floats.map((f: any) => (on as any).nameOf(f.id));
    const chip = (id: string) => { paint(); const h = A.statusBoxes.find((b: any) => b.item.id === id); if (!h) throw new Error(`no ${id} chip`); return h.from as number; };
    /** A new note from the power bar, opened by a click on its chip, as Evan does while typing: its float has his keys. */
    const floatFromBar = async (on: Desk = desk) => {
      // Its chip when the status bar has room for it; at 44 columns it is in the +N menu, and its click runs bar.open.
      paint();
      if (A.statusBoxes.some((b: any) => b.item.id === "power")) await feed(click(chip("power"), rows - 1));
      else await app.dispatch.press("bar.open");
      await until(() => !!A.bar, "the power bar opens");
      await feed(">note.new");
      await A.bar.settled();
      paint();
      const row = A.bar.describe().rows.find((r: any) => r.source === "actions" && r.key === "note.new");
      expect(row).toBeDefined();
      await app.dispatch.press("bar.pick", { n: row.n });     // what ⏎ on its row runs: note.new's form in the bar
      // Every argument of note.new is optional: ⏎ through its fields runs it (a few presses, however many it asks).
      for (let i = 0; i < 6 && !floats(on).length; i++) { await feed("\r"); await sleep(150); }
      await until(() => !A.bar && floats(on).length > 0, "the new note's float opens");
      return floats(on).at(-1)!;
    };
    return { app, desk, A, floats, feed, paint, kettle, agent, shown, floatFromBar, quit: () => { app.quit(); kettle()?.kill(); agent()?.kill(); } };
  }

  for (const [cols, rows] of [[177, 60], [44, 30]] as const) test(`typing in a terminal tile on the desk at ${cols}x${rows}: the float closes and the keys are kettle's again`, async () => {
    const d = await door(cols, rows);
    try {
      await d.desk.dispatch.press("tile.enter", {}, "kettle");
      expect(d.desk.rawKeys()).toBe(true);
      const f = await d.floatFromBar();
      expect(d.desk.focusedName()).toBe(f);
      await d.desk.dispatch.press("tile.close", {}, f);
      await until(() => !d.floats().length, "the float closes");
      expect(d.desk.focusedName()).toBe("kettle");
      expect(d.desk.rawKeys()).toBe(true);
      await d.feed("rinse");
      await until(() => d.shown(d.kettle).includes("rinse"), "typed into kettle");
    } finally { d.quit(); }
  });

  test("the walk at 177x60, the drawer open beside: closing the float, a later Esc is kettle's and the drawer stays", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.agent()?.running === true, "the drawer's agent runs");
      d.paint();
      const [, kr] = (d.desk as any).hits.find(([id]: [number]) => (d.desk as any).nameOf(id) === "kettle");
      await d.feed(click(kr.col + 2, kr.row + 2));            // into kettle with the mouse, the drawer still open beside it
      await d.desk.dispatch.press("tile.enter", {}, "kettle");
      expect(d.app.drawer.entered).toBe(false);
      await d.floatFromBar();
      await d.feed("\x1b");                                  // Esc on the still-empty new note puts it away, as he does
      await until(() => !d.floats().length, "the float closes");
      expect(d.desk.focusedName()).toBe("kettle");
      expect(d.app.person().program).toBeDefined();
      await sleep(700);
      await d.feed("\x1b");
      await sleep(150);
      expect(d.app.drawer.shown).toBe(true);
      expect(d.shown(d.kettle)).toContain("^[");
    } finally { d.quit(); }
  });

  test("typing in the drawer's agent: the float closes and the keys are the agent's again; Esc never puts the drawer away", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.agent()?.running === true, "the drawer's agent runs");
      expect(d.app.drawer.entered).toBe(true);
      const drawer = d.app.drawer.desk!;
      const f = await d.floatFromBar(drawer);
      await drawer.dispatch.press("tile.close", {}, f);
      await until(() => !d.floats(drawer).length, "the float closes");
      expect(d.app.drawer.entered).toBe(true);
      expect(d.app.drawer.shown).toBe(true);
      await sleep(700);
      await d.feed("\x1b");
      await sleep(150);
      expect(d.app.drawer.shown).toBe(true);
      expect(d.shown(d.agent)).toContain("^[");
    } finally { d.quit(); }
  });
});
