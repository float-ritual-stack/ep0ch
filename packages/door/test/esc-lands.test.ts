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

  test("the key probe takes keys, not clicks: the power bar a click opens over it is in front, its Esc first, then the probe's (PIE-1438)", async () => {
    const d = await door();
    try {
      d.app.probeKeys(true);
      await d.app.dispatch.press("bar.open");                // what a click on its chip runs (the probe's flash covers the bar's left)
      await until(() => !!d.A.bar, "the power bar opens over the probe");
      expect(d.app.person().over).toBe("bar");
      d.A.paint();
      await d.feed(click(2, 2));                             // a click outside it puts it away, as without the probe
      expect(!!d.A.bar).toBe(false);
      expect(d.app.person().over).toBe("probe");
      await d.feed("\x1b");                                  // then Esc ends the probe
      expect(d.app.person().over).toBeUndefined();
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

// PIE-1438: the walk, as Evan has it: 177x60, the drawer open beside the desk, typing in a `cat -v` terminal tile. Each thing
// that opens over it (the power bar, a status-bar group's menu, the message log, a tile menu) and a float he clicks into
// takes Esc, a second Esc right after goes nowhere, and nothing ever reaches cat; a moment later, Esc is cat's again.
describe.skipIf(!outliner)("one owner decides where a key goes: the walk at 177x60 with the drawer (PIE-1438)", () => {
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
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-esc-walk-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  test("the bar, a status menu, the message log, a tile menu and a float each take Esc; nothing reaches cat", async () => {
    const cols = 177, rows = 60;
    const info = { cols, rows, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const A = app as any;
    const paint = () => A.paint();
    const kettle = () => desk.pane("kettle") as PtyPane;
    const agent = () => app.drawer.tile as PtyPane | undefined;
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const shown = (p: () => PtyPane | undefined) => (p()?.text() ?? []).join("\n");
    const escs = (p: () => PtyPane | undefined) => (shown(p).match(/\^\[/g) ?? []).length;
    const chip = (id: (item: any) => boolean) => { paint(); const h = A.statusBoxes.find((b: any) => id(b.item)); if (!h) throw new Error("no such chip on the status bar"); return h.from as number; };
    const overlays = () => [...(desk as any).overlays.all()].length;
    try {
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "kettle" }, tile: "reader" }, USER);
      paint();
      await until(() => kettle()?.running === true, "kettle runs");
      await app.dispatch.press("host.toggle", { open: true });
      await until(() => agent()?.running === true, "the drawer's agent runs");
      // His status bar has a group (a nested list): its chip opens a menu over the screen.
      await board.request<any>("create", { parentId: null, text: "Walk status [status-bar::true]\n- brand\n- power\n- Tools\n  - theme\n  - video\n- drawer\n- clock", author: "agent" });
      await app.statusNote.refresh(A.statusItems());
      await until(() => A.statusBoxes.some((b: any) => b.item.id?.startsWith("group:")), "the Tools group on the status bar");
      // Into kettle with the mouse, the drawer still open beside it.
      const [, kr] = (desk as any).hits.find(([id]: [number]) => (desk as any).nameOf(id) === "kettle");
      await feed(click(kr.col + 2, kr.row + 2));
      await desk.dispatch.press("tile.enter", {}, "kettle");
      expect(app.drawer.entered).toBe(false);
      expect(desk.rawKeys()).toBe(true);
      const before = escs(kettle), agentBefore = escs(agent);
      const closes = async (what: string, open: () => Promise<unknown>, isOpen: () => boolean) => {
        await sleep(700);
        await open();
        await until(isOpen, `${what} opens`);
        await feed("\x1b");
        expect({ what, open: isOpen() }).toEqual({ what, open: false });
        await feed("\x1b");                                  // a second Esc at once: it was for what just closed
        await sleep(150);
        expect({ what, kettle: escs(kettle), agent: escs(agent) }).toEqual({ what, kettle: before, agent: agentBefore });
      };
      await closes("the power bar", () => feed(click(chip(i => i.id === "power"), rows - 1)), () => !!A.bar);
      await closes("the Tools menu", () => feed(click(chip(i => i.id?.startsWith("group:")), rows - 1)), () => overlays() > 0);
      const log = desk as unknown;
      await closes("the message log", () => feed(click(chip(i => i.id === "brand"), rows - 1)), () => A.stack.at(-1) !== log);
      await closes("kettle's tile menu", () => desk.dispatch.press("tile.menu", {}, "kettle"), () => overlays() > 0);
      expect(desk.rawKeys()).toBe(true);
      expect(app.drawer.shown).toBe(true);                   // the drawer stayed open beside it through all four
      // A float he clicks into has his keys: Esc there is the float's (a reader there doesn't use it, so the drawer puts
      // itself away, as from any tile), never cat's.
      const other = (desk as any).nameOf((desk as any).hits.find(([id]: [number]) => (desk as any).nameOf(id) !== "kettle")[0]) as string;
      await desk.dispatch.press("tile.float", { on: true }, other);
      paint();
      const [, fr] = (desk as any).hits.find(([id]: [number]) => (desk as any).nameOf(id) === other);
      await feed(click(fr.col + 2, fr.row + 2));
      expect(desk.rawKeys()).toBe(false);
      await feed("\x1b");
      await feed("\x1b");
      await sleep(150);
      expect({ kettle: escs(kettle), agent: escs(agent) }).toEqual({ kettle: before, agent: agentBefore });
      // Back in kettle, a moment later, Esc is cat's.
      await feed(click(kr.col + 2, kr.row + 2));
      await desk.dispatch.press("tile.enter", {}, "kettle");
      await sleep(700);
      await feed("\x1b");
      await sleep(150);
      expect(escs(kettle)).toBe(before + 1);
      expect(escs(agent)).toBe(agentBefore);
    } finally { app.quit(); kettle()?.kill(); agent()?.kill(); }
  }, 30_000);
});
