// PIE-498, PIE-513: the agent drawer, the host layer's. One terminal tile belongs to the App, the first tab of the
// host layer's drawer, pulled up from the status bar's chip (or alt+a) over any screen without the screen
// reflowing (or beside it, the screen drawn shorter, where the screen says so); its actions (`host.toggle`,
// `host.size`) are what the keys, the clicks and `act` run; it's
// saved in dock.json; and it has one home: no screen has a copy of it. The agent here is `cat` (a stand-in: no real
// Claude, no real Herdr), and Herdr is a fake.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { builtin, makeTile } from "../src/desk/tiles";
import { PtyPane } from "../src/desk/pty";
import { DOCK_TILE_ID, MAX_SHARE, MIN_SHARE, nextStep } from "../src/dock";
import { WATCH_TITLE } from "../src/desk/herdr-agent";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { where as whereIs } from "../src/where";
import { outliner, Scratch, until } from "./scratch";

const wait = (ok: () => boolean) => until(ok, "the agent drawer");
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/\x1b\[[^m]*m/g, "");
const ALT = (ch: string): Key => ({ kind: "alt", ch });
const ESC: Key = { kind: "esc" };
const CTRL_RB: Key = { kind: "char", ch: "]", ctrl: true };
const mouse = (action: "down" | "up" | "drag", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });

let dir = "";
const saved: Record<string, string | undefined> = {};
const ENV = ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_HERDR_BIN", "EP0CH_DAILY_CWD", "EP0CH_DAILY_DRAFT", "VISUAL"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ep0ch-dock-"));
  for (const k of ENV) saved[k] = process.env[k];
  process.env.EP0CH_STATE = join(dir, "state");
  process.env.EP0CH_DAILY_AGENT = "cat";
  delete process.env.EP0CH_DAILY_CWD;
  // The daily layout's editor tile: a stand-in too, on a scratch file.
  process.env.VISUAL = "true";
  process.env.EP0CH_DAILY_DRAFT = join(dir, "scratch.md");
  // A fake Herdr: `agent get` says the agent is blocked (waiting on the person). Nothing real is asked.
  const fake = join(dir, "herdr");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${JSON.stringify(join(dir, "calls"))}\n[ "$1 $2" = "agent get" ] && echo '{"result":{"agent":{"agent_status":"blocked"}}}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  process.env.EP0CH_HERDR_BIN = fake;
});
afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(dir, { recursive: true, force: true });
});

/** A door on a fake terminal: what it paints, its raw input, and screens that record how they were drawn. */
function door(rows = 30, cols = 100) {
  let key: (k: Key) => void = () => {};
  let painted: string[] = [];
  const term: any = {
    info: { cols, rows, cellW: 9, cellH: 16, kitty: false },
    write() {}, paint(lines: string[]) { painted = lines; }, paintRow(r: number, l: string) { painted[r] = l; },
    invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
  };
  const app = new App(term, { capabilities: null } as any, Date.now(), () => {});
  const renders: { rows: number }[] = [];
  const screen = (title: string, more: Record<string, unknown> = {}) => ({
    title, key() {}, ...more,
    render(ctx: any) { renders.push({ rows: ctx.t.rows }); return { lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => `${title} row ${i}`) }; },
  });
  const paint = () => { (app as any).paint(); return painted.map(plain); };
  /** Bytes as the terminal would send them, through the raw sink when there is one. */
  const type = (bytes: string) => { const sink = term.rawSink?.(); if (sink) sink(bytes); else throw new Error("no raw sink: the keys aren't the agent's"); };
  return { app, term, screen, renders, paint, type, key: (k: Key) => key(k), A: app as any };
}

describe("the agent drawer", () => {
  test("the chip is on the status bar on every screen but the logon; alt+a pulls the drawer up over the screen without reflowing it", async () => {
    const d = door();
    try {
      d.app.push(d.screen("logon", { noDock: true }) as any);
      expect(d.paint().at(-1)).not.toContain("▲ claude");
      d.key(ALT("a"));                                         // nothing to pull up on the logon
      expect(d.app.dock.open).toBe(false);
      d.A.stack.pop();
      d.app.push(d.screen("main menu") as any);
      let shown = d.paint();
      expect(shown.at(-1)).toContain("▲ claude");
      expect(shown[27]).toBe("main menu row 27");
      d.key(ALT("a"));
      expect(d.app.dock.open).toBe(true);
      expect(d.app.dock.entered).toBe(true);                   // the person's pull gives it their keys
      shown = d.paint();
      // The screen was drawn at its full height, and the drawer covers its lower half.
      expect(d.renders.at(-1)!.rows).toBe(30);
      const r = d.app.dock.rect!;
      expect(r).toEqual({ col: 0, row: 29 - 14, cols: 100, rows: 14 });
      expect(shown[r.row - 1]).toBe(`main menu row ${r.row - 1}`);
      expect(shown[r.row]).toContain("▼ claude");
      expect(shown.at(-1)).toContain("▼ claude");
      // What's typed goes to the agent (cat echoes it).
      await wait(() => d.app.dock.tile?.running === true);
      d.type("hello dock\r");
      await wait(() => (d.app.dock.tile?.text() ?? []).some(l => l.includes("hello dock")));
      // ctrl+] leaves it (it stays up), and Esc then puts it away.
      d.key(CTRL_RB);
      expect(d.app.dock.entered).toBe(false);
      expect(d.term.rawSink()).toBeNull();
      d.key(ESC);
      expect(d.app.dock.open).toBe(false);
      expect(d.app.dock.tile?.running).toBe(true);            // put away, not ended
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("it's the same session on every screen: a screen switch keeps the program, and alt+a from inside puts it away", async () => {
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await wait(() => d.app.dock.tile?.running === true);
      const pid = d.app.dock.tile!.pid;
      d.type("first\r");
      d.type("\x1ba");                                          // alt+a, as raw bytes while in it
      expect(d.app.dock.open).toBe(false);
      d.app.push(d.screen("kanban") as any);
      expect(d.paint().at(-1)).toContain("▲ claude");
      d.key(ALT("a")); const shown = d.paint();
      expect(d.app.dock.tile!.pid).toBe(pid);
      await wait(() => d.app.dock.tile!.text().some(l => l.includes("first")));
      expect(shown.some(l => l.includes("kanban row"))).toBe(true);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("the mouse: the chip toggles it, the top edge drags its height, a click in it enters, a click above leaves", () => {
    const d = door();
    try {
      d.app.push(d.screen("desk") as any);
      d.paint();
      const chip = d.app.dock.chipAt!;
      expect(chip.row).toBe(29);
      d.key(mouse("down", chip.from + 1, 29)); d.key(mouse("up", chip.from + 1, 29));
      expect(d.app.dock.open).toBe(true);
      d.paint();
      const top = d.app.dock.rect!.row;
      d.key(mouse("down", 50, top));                           // the top edge
      d.key(mouse("drag", 50, 8));
      d.key(mouse("up", 50, 8));
      expect(d.app.dock.share).toBeCloseTo(21 / 29, 2);
      d.paint();
      expect(d.app.dock.rect!.row).toBe(8);
      d.key(mouse("down", 10, 3)); d.key(mouse("up", 10, 3));  // above: the screen's again
      expect(d.app.dock.entered).toBe(false);
      d.key(mouse("down", 10, 20)); d.key(mouse("up", 10, 20));
      expect(d.app.dock.entered).toBe(true);
      d.paint();
      d.key(mouse("down", chip.from + 1, 29));
      expect(d.app.dock.open).toBe(false);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("dragged onto the status row (or past the top), the edge stops at the drawer's least (or most): no refusal is said", () => {
    const d = door();
    try {
      d.app.push(d.screen("desk") as any);
      d.key(ALT("a")); d.paint();
      const top = d.app.dock.rect!.row;
      d.key(mouse("down", 50, top));
      d.key(mouse("drag", 50, 29));                            // the status row
      expect(d.app.dock.share).toBe(MIN_SHARE);
      expect(d.A.message ?? "").not.toContain("fraction");
      d.key(mouse("drag", 50, 0));
      expect(d.app.dock.share).toBe(MAX_SHARE);
      d.key(mouse("up", 50, 0));
      expect(d.A.message ?? "").not.toContain("fraction");
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("ctrl+] by the keyboard: out, back in; twice at once sends the agent a ctrl+]; a terminal tile's own ctrl+] stays the screen's", async () => {
    const d = door();
    const got: Key[] = [];
    let raw = false;
    try {
      d.app.push(d.screen("desk", { key: (k: Key) => got.push(k), rawKeys: () => raw }) as any);
      d.key(ALT("a")); d.paint();
      await wait(() => d.app.dock.tile?.running === true);
      d.key(CTRL_RB);
      expect(d.app.dock.entered).toBe(false);
      expect(d.A.message).toContain("ctrl+] or a click goes back in");
      // Right away again: back in, and the agent gets the ctrl+] (the tty echoes it as ^]).
      d.key(CTRL_RB);
      expect(d.app.dock.entered).toBe(true);
      await wait(() => d.app.dock.tile!.text().some(l => l.includes("^]")));
      // Out, and later ctrl+] again: back in, nothing sent.
      d.key(CTRL_RB);
      (d.app.dock as any).leftAt = 0;
      d.key(CTRL_RB);
      expect(d.app.dock.entered).toBe(true);
      expect(d.term.rawSink()).not.toBeNull();                 // the keys are the agent's again
      // The person in the screen's terminal tile: ctrl+] leaves the tile (the screen's), and its second is the tile's too.
      d.key(CTRL_RB); (d.app.dock as any).leftAt = 0;
      raw = true;
      d.key(CTRL_RB);
      raw = false;
      d.key(CTRL_RB);
      expect(d.app.dock.entered).toBe(false);
      expect(got.filter(k => k.kind === "char" && k.ch === "]")).toHaveLength(2);
      expect(plain(d.paint()[d.app.dock.rect!.row + d.app.dock.rect!.rows - 1]!)).toContain("click in it or ctrl+] to type");
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("host.toggle and host.size by act: an agent's pull never takes the keys, waits for the person to be idle, and is said", async () => {
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      expect(d.app.actions().actions.map(a => a.name)).toEqual(expect.arrayContaining(["host.toggle", "host.size"]));
      d.A.lastInput = Date.now();
      await expect(d.app.act({ action: "host.toggle", args: { open: true }, as: "claude-7" })).rejects.toThrow(/at the keys/);
      d.A.lastInput = 0;
      const r: any = await d.app.act({ action: "host.toggle", args: { open: true }, as: "claude-7" });
      expect(r).toMatchObject({ open: true, entered: false });
      expect(d.A.message).toContain("an agent (claude-7)");
      expect(d.term.rawSink()).toBeNull();                     // the keys stay the screen's
      expect(plain(d.paint()[d.app.dock.rect!.row]!)).toContain("pulled up by an agent (claude-7)");
      expect(d.app.describe().dock).toMatchObject({ open: true, entered: false, openedBy: "claude-7" });
      await d.app.act({ action: "host.size", args: { share: "0.3" }, as: "claude-7" });
      expect(d.app.dock.share).toBeCloseTo(0.3);
      await expect(d.app.act({ action: "host.size", args: { share: 3 }, as: "claude-7" })).rejects.toThrow(/fraction/);
      // The person comes in: now an agent can't put it away or resize it under them.
      d.key(mouse("down", 10, 27)); d.key(mouse("up", 10, 27));
      expect(d.app.dock.entered).toBe(true);
      d.A.lastInput = 0;
      await expect(d.app.act({ action: "host.toggle", args: { open: false }, as: "claude-7" })).rejects.toThrow(/typing in the agent drawer/);
      await expect(d.app.act({ action: "host.size", args: { share: 0.6 }, as: "claude-7" })).rejects.toThrow(/typing in claude in the agent drawer/);
      // Nor move their screen.
      await expect(d.app.act({ action: "screen.open", args: { name: "S" }, as: "claude-7" })).rejects.toThrow(/typing in the agent drawer/);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("open and height are saved in dock.json and come back in the next door, put up but not entered", () => {
    let d = door();
    d.app.push(d.screen("main menu") as any);
    d.key(ALT("a"));
    d.key(ALT("A"));                                            // alt+A steps the height
    expect(d.app.dock.share).toBe(nextStep(0.5));
    d.app.quit();
    expect(JSON.parse(readFileSync(join(dir, "state", "dock.json"), "utf8"))).toEqual({ open: true, share: 0.6 });
    d = door();
    try {
      expect(d.app.dock.open).toBe(true);
      expect(d.app.dock.entered).toBe(false);
      expect(d.app.dock.share).toBe(0.6);
      d.app.push(d.screen("river") as any);
      expect(d.paint()[d.app.dock.rect!.row]).toContain("▼ claude");
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("the chip says what the agent is doing: off, working while it writes, Herdr's state while attached through Herdr, exited", async () => {
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      expect(d.app.dock.chipText()).toBe("▲ claude");
      d.key(ALT("a")); d.paint();
      await wait(() => d.app.dock.tile?.running === true);
      d.type("x\r");
      await wait(() => d.app.dock.state() === "working");
      expect(d.app.dock.state(Date.now() + 5000)).toBe("idle");
      // The launcher says it lives in Herdr: the door asks Herdr (read-only) for its state.
      const r: any = await d.app.act({ action: "tile.herdr", tile: DOCK_TILE_ID, args: { pane: "door-claude" }, as: "door" });
      expect(r).toEqual({ tile: DOCK_TILE_ID, herdr: { pane: "door-claude" } });
      d.app.dock.state();
      await wait(() => d.app.dock.state() === "blocked");
      expect(d.app.dock.chipText()).toBe("▼ claude · needs you");
      expect(readFileSync(join(dir, "calls"), "utf8")).toContain("agent get door");
      expect(d.app.describe().dock).toMatchObject({ herdr: { pane: "door-claude" } });
      d.type("\x04");                                            // ctrl+d: cat ends
      await wait(() => d.app.dock.state() === "exited");
      expect(d.app.dock.chipText()).toBe("▼ claude · exited 0");
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("a second door's drawer says it's only watching the Herdr pane, and that ⏎ would take it from the other door", async () => {
    // The launcher, refused the attach because another door has the pane, watches it and titles its terminal so.
    const watcher = join(dir, "watcher");
    writeFileSync(watcher, `#!/bin/sh\nprintf '\\033]2;%s\\007' ${JSON.stringify(WATCH_TITLE)}\nexec cat\n`);
    chmodSync(watcher, 0o755);
    process.env.EP0CH_DAILY_AGENT = watcher;
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await wait(() => d.app.dock.tile?.running === true);
      await d.app.act({ action: "tile.herdr", tile: DOCK_TILE_ID, args: { pane: "door-claude" }, as: "door" });
      await wait(() => d.app.dock.state() === "watching");
      expect(d.app.dock.chipText()).toBe("▼ claude · watching");
      const shown = d.paint().join("\n");
      expect(shown).toContain("another door has it");
      expect(shown).toContain("⏎ takes it over");
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("one home: the agent is the host layer's alone; the daily layout has no tile for it, and a terminal tile is always its own program", () => {
    const d = door();
    try {
      const leaves = (n: any): any[] => (n.kids ? n.kids.flatMap(leaves) : n.tabs ? n.tabs.flatMap(leaves) : [n]);
      expect(leaves(builtin("daily")!.root).some((l: any) => l.kind === "pty" && l.name === "claude")).toBe(false);
      expect(makeTile({ kind: "pty", cmd: ["cat"], name: "claude" })).not.toBe(d.app.dock.pane());
      expect(d.app.describe().dock).toMatchObject({ tile: { id: DOCK_TILE_ID, name: "claude" } });
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("beside on a short terminal: the rows the screen gives up are exactly the drawer's (one size, from the layout engine)", () => {
    const d = door(14, 80);
    try {
      d.app.push(d.screen("daily", { hostMode: () => "beside" }) as any);
      d.key(ALT("a"));
      d.app.dock.height(0.2);
      d.paint();
      const r = d.app.dock.rect!;
      expect(r.rows).toBeGreaterThanOrEqual(4);                  // a frame and a row of the program, at least
      expect(d.renders.at(-1)!.rows - 1 + r.rows).toBe(13);      // the screen's rows and the drawer's fill the room
      expect(r.row).toBe(d.renders.at(-1)!.rows - 1);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("where the screen says: beside it, the screen is drawn shorter; none, alt+a says why and the drawer comes back on another screen", () => {
    const d = door();
    try {
      d.app.push(d.screen("daily", { hostMode: () => "beside" }) as any);
      d.key(ALT("a"));
      const shown = d.paint();
      const r = d.app.dock.rect!;
      // The screen drew only the rows above the drawer, its last row just above the drawer's top edge.
      expect(d.renders.at(-1)!.rows).toBe(30 - r.rows);
      expect(shown[r.row - 1]).toBe(`daily row ${r.row - 1}`);
      expect(shown[r.row]).toContain("▼ claude");
      expect(d.app.t.rows).toBe(30 - r.rows);                   // the screen's keys and clicks see the same size
      d.key(ALT("a"));
      d.paint();
      expect(d.renders.at(-1)!.rows).toBe(30);
      // A screen that keeps the whole screen: the drawer isn't drawn there, and pulling it up says why.
      d.key(ALT("a")); d.key(CTRL_RB);
      d.app.push(d.screen("lord", { hostMode: () => "none" }) as any);
      const lord = d.paint();
      expect(d.app.dock.rect).toBeNull();
      expect(lord.some(l => l.includes("drag this edge"))).toBe(false);
      expect(d.renders.at(-1)!.rows).toBe(30);
      expect(d.app.dock.entered).toBe(false);                  // not drawn here, so the keys aren't in it
      d.key(ALT("a"));                                         // put away: allowed anywhere
      d.key(ALT("a"));                                         // pulled up: refused here
      expect(d.app.dock.open).toBe(false);
      expect(d.A.message).toContain("keeps the whole screen");
      d.A.stack.pop();
      d.key(ALT("a"));
      expect(d.app.dock.open).toBe(true);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });

  test("ep0ch where names the drawer as the tile a program in it runs in", async () => {
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      const peek = { screen: d.app.describe(), text: [] };
      const w = await whereIs({
        env: { EP0CH_NEST: `door:${process.pid}/dock/${DOCK_TILE_ID}:claude`, EP0CH_CONTROL: "/nowhere.sock", EP0CH_TILE_ID: DOCK_TILE_ID, EP0CH_TILE: "claude" },
        pid: 1, peek: async () => peek, herdr: null, alive: () => true, ttyExists: () => true, ancestors: () => [],
      });
      expect(w.door?.tile).toMatchObject({ id: DOCK_TILE_ID, found: true, dock: true, shown: true });
      expect(w.layers.find(l => l.kind === "tile")?.why).toContain("the agent drawer");
      expect(w.keys).toMatchObject({ mine: true, typing: true });
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  });
});

describe.skipIf(!outliner)("the drawer and the daily desk, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request<any>("create", { parentId: null, text: "Compost rota", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  /** A door on the daily desk (no agent tile on it: the agent is the host layer's). */
  async function dailyDoor() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 150, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    (app as any).paint();
    const ptys = () => [...(desk as any).panes.values()].filter((p: any) => p instanceof PtyPane);
    return { app, desk, key: (k: Key) => key(k), paint: () => { (app as any).paint(); return painted.map(plain); }, ptys };
  }

  test("the daily desk: no agent tile; alt+a pulls the agent up beside it (the desk shorter, every tile there), and put away the keys are on the tile they left", async () => {
    const d = await dailyDoor();
    try {
      expect(d.ptys().some((p: any) => p.run.cmd.join(" ") === "cat")).toBe(false);
      await d.desk.dispatch.act({ action: "tile.focus", tile: "middle" }, { kind: "user" } as any);
      const tall = (d.desk.describe().panes as any[]).find(p => p.name === "middle").rect.rows;
      d.key(ALT("a"));
      expect(d.app.dock.entered).toBe(true);
      await wait(() => d.app.dock.tile?.running === true);
      d.paint();
      const r = d.app.dock.rect!;
      const panes = d.desk.describe().panes as any[];
      expect(panes.every(p => !p.rect || p.rect.row + p.rect.rows <= r.row)).toBe(true);
      expect(panes.find(p => p.name === "middle").rect.rows).toBeLessThan(tall);
      // Put away: the desk has its rows back, and the keys are on the tile the person left.
      d.key(ALT("a"));
      expect(d.app.dock.entered).toBe(false);
      d.paint();
      expect((d.desk.describe().panes as any[]).find(p => p.name === "middle").rect.rows).toBe(tall);
      expect((d.desk.describe() as any).focusName).toBe("middle");
      // Leaving the desk never touches the agent.
      const pid = d.app.dock.tile!.pid;
      d.app.pop();
      expect(d.app.dock.tile!.running).toBe(true);
      expect(d.app.dock.tile!.pid).toBe(pid);
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  }, 30_000);

  test("an agent types to the agent by agent.type (never tile.type: it's no tile), and never while the person types in it", async () => {
    const d = await dailyDoor();
    try {
      await expect(d.app.act({ action: "agent.type", args: { text: "hello" }, as: "claude-7" })).rejects.toThrow(/isn't running/);
      d.key(ALT("a"));                                           // the person's pull: they're in it
      await wait(() => d.app.dock.tile?.running === true);
      expect(d.app.dock.entered).toBe(true);
      await expect(d.app.act({ action: "agent.type", args: { text: "rm notes\\n" }, as: "claude-7" })).rejects.toThrow(/typing in claude in the agent drawer/);
      await expect(d.app.act({ action: "tile.type", tile: "claude", args: { text: "seed list" }, as: "claude-7" })).rejects.toThrow(/no tile claude|claude/);
      d.key(CTRL_RB);                                            // out of it: an agent may type there again
      const r: any = await d.app.act({ action: "agent.type", args: { text: "seed list" }, as: "claude-7" });
      expect(r).toMatchObject({ tile: "claude" });
      await wait(() => d.app.dock.tile!.text().some(l => l.includes("seed list")));
    } finally { d.app.quit(); d.app.dock.tile?.kill(); }
  }, 30_000);
});
