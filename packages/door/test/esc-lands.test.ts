// PIE-1431: Esc reaches only what it was meant for. Bytes go through the door's real key decoder, as a terminal sends
// them, to a door on the desk with a terminal tile (`kettle`, running `cat -v`: the tty echoes an Esc it gets as ^[) and
// the drawer's agent (`cat` too). Esc meant for the power bar, a status-bar menu, a tile menu or the drawer never reaches
// a terminal tile, and a second Esc right after the first closed something goes nowhere.
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
/** A left click at a cell, as a terminal reports it (SGR, one-based). */
const click = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

describe.skipIf(!outliner)("Esc lands where it was meant (PIE-1431)", () => {
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
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_HERDR_BIN"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-esc-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols = 140, rows = 40) {
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
    await until(() => kettle()?.running === true, "kettle runs");
    /** Bytes as the terminal sends them; a lone Esc the decoder reads after its 30ms wait, as it does for real. */
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const echoed = async (pane: () => PtyPane | undefined) => { await sleep(150); return (pane()?.text() ?? []).join("\n").includes("^["); };
    const chip = (id: string) => { paint(); const h = A.statusBoxes.find((b: any) => b.item.id === id); if (!h) throw new Error(`no ${id} chip on the status bar`); return h.from as number; };
    const typeIn = async () => { await desk.dispatch.press("tile.enter", {}, "kettle"); expect(desk.rawKeys()).toBe(true); };
    return { app, desk, A, feed, kettle, echoed, chip, typeIn, rows, quit: () => { app.quit(); kettle()?.kill(); app.drawer.tile?.kill(); } };
  }

  test("typing in a terminal tile: Esc closes the power bar opened from the status bar, and the next Esc right after goes nowhere", async () => {
    const d = await door();
    try {
      await d.typeIn();
      await d.feed(click(d.chip("power"), d.rows - 1));
      await until(() => !!d.A.bar, "the power bar opens");
      await d.feed("\x1b");
      expect(!!d.A.bar).toBe(false);
      await d.feed("\x1b");                                  // a second Esc, at once: the bar was what it was for
      expect(await d.echoed(d.kettle)).toBe(false);
      expect(d.desk.rawKeys()).toBe(true);                   // the keys stay in kettle
      await sleep(700);
      await d.feed("\x1b");                                  // a moment later, Esc is kettle's again
      expect(await d.echoed(d.kettle)).toBe(true);
    } finally { d.quit(); }
  });

  test("typing in a terminal tile: Esc closes the message log opened from the status bar's brand, and the next Esc right after goes nowhere", async () => {
    const d = await door();
    try {
      await d.typeIn();
      const desk = d.A.stack.at(-1);
      await d.feed(click(d.chip("brand"), d.rows - 1));
      await until(() => d.A.stack.at(-1) !== desk, "the message log opens");
      await d.feed("\x1b");
      expect(d.A.stack.at(-1)).toBe(desk);
      await d.feed("\x1b");                                  // a second Esc, at once: the log was what it was for
      expect(await d.echoed(d.kettle)).toBe(false);
      expect(d.desk.rawKeys()).toBe(true);
    } finally { d.quit(); }
  });

  test("typing in the drawer's agent: the message log from the status bar takes Esc, and the next Esc right after never reaches the agent", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      const desk = d.A.stack.at(-1);
      await d.feed(click(d.chip("brand"), d.rows - 1));
      await until(() => d.A.stack.at(-1) !== desk, "the message log opens");
      await d.feed("\x1b");
      expect(d.A.stack.at(-1)).toBe(desk);
      await d.feed("\x1b");
      expect(await d.echoed(() => d.app.drawer.tile as PtyPane | undefined)).toBe(false);
    } finally { d.quit(); }
  });

  test("under the Kitty keyboard protocol (Esc as CSI 27u) it's the same: the bar's Esc, then nothing, never the program's", async () => {
    const d = await door();
    try {
      await d.typeIn();
      await d.feed(click(d.chip("power"), d.rows - 1));
      await until(() => !!d.A.bar, "the power bar opens");
      await d.feed("\x1b[27u");
      expect(!!d.A.bar).toBe(false);
      await d.feed("\x1b[27u");
      expect(await d.echoed(d.kettle)).toBe(false);
    } finally { d.quit(); }
  });

  test("two Esc presses that arrive in one read right after the bar closed are held back together", async () => {
    const d = await door();
    try {
      await d.typeIn();
      await d.feed(click(d.chip("power"), d.rows - 1));
      await until(() => !!d.A.bar, "the power bar opens");
      await d.feed("\x1b");
      await d.feed("\x1b\x1b");
      expect(await d.echoed(d.kettle)).toBe(false);
    } finally { d.quit(); }
  });

  test("a terminal inside a group: the bar's Esc, then a second Esc right after, never reach it", async () => {
    const d = await door();
    try {
      const g = await d.desk.dispatch.press("tile.group", { with: "reader", where: "left" }, "kettle") as { tile: string };
      const group = d.desk.pane(g.tile) as any;
      await d.desk.dispatch.press("tile.focus", {}, g.tile);
      await group.inner.dispatch.press("tile.focus", {}, "kettle");
      await group.inner.dispatch.press("tile.enter", {}, "kettle");
      await until(() => d.desk.programKeys().typing, "typing in kettle inside its group");
      await d.app.dispatch.press("bar.open");
      await until(() => !!d.A.bar, "the power bar opens");
      await d.feed("\x1b");
      expect(!!d.A.bar).toBe(false);
      await d.feed("\x1b");
      expect(await d.echoed(() => group.inner.pane("kettle"))).toBe(false);
    } finally { d.quit(); }
  });

  test("typing in a terminal tile: Esc on its own tile menu closes the menu, and a second Esc right after goes nowhere", async () => {
    const d = await door();
    try {
      await d.typeIn();
      await d.desk.dispatch.press("tile.menu", {}, "kettle");
      expect([...(d.desk as any).overlays.all()].length).toBe(1);
      await d.feed("\x1b");
      expect([...(d.desk as any).overlays.all()].length).toBe(0);
      await d.feed("\x1b");
      expect(await d.echoed(d.kettle)).toBe(false);
    } finally { d.quit(); }
  });

  test("typing in the drawer's agent: the power bar from the status bar takes Esc, never the agent", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      expect(d.app.drawer.entered).toBe(true);
      await d.feed(click(d.chip("power"), d.rows - 1));
      await until(() => !!d.A.bar, "the power bar opens");
      await d.feed("\x1b");
      expect(!!d.A.bar).toBe(false);
      expect(await d.echoed(() => d.app.drawer.tile as PtyPane | undefined)).toBe(false);
      await d.feed("\x1b");
      expect(await d.echoed(() => d.app.drawer.tile as PtyPane | undefined)).toBe(false);
    } finally { d.quit(); }
  });

  test("a menu left open on the screen before going into the drawer keeps no hold on the person's keys there", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.press("tile.menu", {}, "kettle");
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      await d.feed("seed trays");
      await until(() => ((d.app.drawer.tile as PtyPane).text() ?? []).join("\n").includes("seed trays"), "typed into the agent");
    } finally { d.quit(); }
  });

  test("typing in the drawer's agent at 40 columns: the status bar's +N menu takes Esc, never the agent", async () => {
    const d = await door(40, 30);
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      await d.feed(click(d.chip("overflow"), d.rows - 1));
      await until(() => [...(d.desk as any).overlays.all()].length === 1, "the +N menu opens");
      await d.feed("\x1b");
      expect([...(d.desk as any).overlays.all()].length).toBe(0);
      expect(await d.echoed(() => d.app.drawer.tile as PtyPane | undefined)).toBe(false);
    } finally { d.quit(); }
  });

  test("a click on another tile and Esc in the same read: Esc is that tile's, never the terminal's", async () => {
    const d = await door();
    try {
      await d.typeIn();
      const notes = (d.desk as any).hits.find(([id]: [number]) => (d.desk as any).nameOf(id) !== "kettle");
      const [, r] = notes;
      await d.feed(click(r.col + 2, r.row + 2) + "\x1b");
      expect(await d.echoed(d.kettle)).toBe(false);
      expect(d.desk.rawKeys()).toBe(false);
    } finally { d.quit(); }
  });

  test("typing in the drawer's agent: a click on the screen above and Esc in the same read never reach the agent", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      await d.feed(click(5, 2) + "\x1b");
      expect(d.app.drawer.entered).toBe(false);
      expect(await d.echoed(() => d.app.drawer.tile as PtyPane | undefined)).toBe(false);
    } finally { d.quit(); }
  });
});
