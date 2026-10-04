// PIE-498: the general dock. Any tile joins the host layer's drawer as a tab and leaves it again into the screen shown,
// whole: a terminal's program keeps running (the same pid), a reader keeps its note. By `act` (host.dock, attributed,
// never the person's keys), by ^W a, by a drag onto the dock's chip or out of the drawer, and by a key while dragging.
// It's saved (dock-tiles.json) and comes back in the next door. Scratch outline host, fictional notes, `cat` programs.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { outlineState } from "../src/state";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[^m]*m/g, "");
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });
const mouse = (action: "down" | "up" | "drag", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });
const USER = { kind: "user" } as const;
const AS = "dock-agent-498";

describe.skipIf(!outliner)("the dock: any tile, moved whole between screens", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request<any>("create", { parentId: null, text: "Seed potatoes: chit them by the window", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-docktiles-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
    return () => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); };
  });

  /** A door on the desk with a terminal tile running `cat` (named `kettle`), on a fake 140x40 terminal. */
  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    paint();
    const kettle = () => desk.pane("kettle") as PtyPane | undefined;
    await until(() => kettle()?.running === true, "kettle runs");
    const docked = (name: string) => app.dock.tabs().some(t => t.name === name);
    const pane = (name: string) => app.dock.desk!.pane(name);
    return { app, desk, key: (k: Key) => key(k), paint, kettle, docked, pane, A: app as any };
  }
  /** Another screen (last callers), on top: the screen switch. */
  const otherScreen = () => new Desk({ name: "lastcall", title: "last callers", layout: { focus: "activity", root: { t: "split", dir: "row", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "activity", name: "activity" }, { t: "leaf", kind: "reader", name: "notes" }] } as any } });

  test("an agent docks a terminal tile by act: moved, not started again; said; the drawer and the person's keys stay put", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      const out = await d.app.act({ action: "host.dock", args: {}, tile: "kettle", as: AS }) as any;
      expect(out).toMatchObject({ tile: "kettle", docked: true, from: "desk" });
      expect(d.desk.pane("kettle")).toBeUndefined();
      expect(d.docked("kettle")).toBe(true);
      const p = d.pane("kettle") as PtyPane;
      expect(p.pid).toBe(pid);                                   // the same program: moved, not respawned
      expect(p.running).toBe(true);
      expect(d.app.dock.open).toBe(false);                       // an agent's dock doesn't pull it up
      expect(d.desk.focusedName()).toBe("tree");                 // nor move the person's keys
      expect(d.A.message).toContain(`an agent (${AS})`);
      expect(d.paint().at(-1)).toContain("▲ cat +1");          // the chip: its own program, and one more tile
    } finally { d.app.quit(); }
  });

  test("it travels: switch screens, pull the dock up, it's the same tile; undock it into the other screen beside a tile", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "host.dock", args: {}, tile: "kettle", as: AS });
      const other = otherScreen();
      d.app.push(other);
      d.paint();
      // Shown on its tab in the dock, on the other screen.
      d.key({ kind: "alt", ch: "a" });
      expect(d.app.dock.open).toBe(true);
      await d.app.dock.desk!.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      const shown = d.paint();
      expect(shown.some(l => l.includes("kettle"))).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      // Out of the dock, into the other screen, right of its notes reader: the person's.
      const out = await d.app.dock.desk!.dispatch.act({ action: "host.dock", args: { on: false, to: "notes", where: "right" }, tile: "kettle" }, USER) as any;
      expect(out).toMatchObject({ tile: "kettle", docked: false, into: "last callers" });
      expect(d.docked("kettle")).toBe(false);
      const back = other.pane("kettle") as PtyPane;
      expect(back.pid).toBe(pid);
      expect(back.running).toBe(true);
      // And it types: the same program, its screen kept.
      back.input("still here\r");
      await until(() => back.text().some(l => l.includes("still here")), "cat echoes");
    } finally { d.app.quit(); }
  });

  test("keys: ^W a docks the focused tile (the drawer comes up on it); ^W a in the dock puts it back into the screen", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "thread" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.docked("thread"), "thread docked");
      expect(d.app.dock.open).toBe(true);
      expect(d.app.dock.tabs().find(t => t.name === "thread")?.shown).toBe(true);
      d.paint();
      // Into the dock (a click in it), then ^W a there: back beside the tile the person had.
      const r = d.app.dock.rect!;
      d.key(mouse("down", 20, r.row + 3)); d.key(mouse("up", 20, r.row + 3));
      expect(d.app.dock.entered).toBe(true);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => !d.docked("thread"), "thread undocked");
      expect(d.desk.pane("thread")).toBeDefined();
    } finally { d.app.quit(); }
  });

  test("keys for a docked terminal: in the dock its keys are its program's, so ^W A on the screen brings it back", async () => {
    const d = await door();
    try {
      const pid = d.kettle()!.pid;
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.docked("kettle"), "kettle docked");
      d.paint();
      // Into the dock: typing in the kettle (^W is the program's there); ctrl+] back to the desk.
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      expect(d.app.dock.entered).toBe(true);
      d.key({ kind: "char", ch: "]", ctrl: true });
      expect(d.app.dock.entered).toBe(false);
      d.key(ctrl("w")); d.key({ kind: "char", ch: "A" });
      await until(() => !d.docked("kettle") && !!d.desk.pane("kettle"), "^W A brings it back");
      expect((d.desk.pane("kettle") as PtyPane).pid).toBe(pid);
    } finally { d.app.quit(); }
  });

  test("the mouse: a tile's title dragged onto the dock's chip docks it (the chip lights up); a tab dragged out lands by the screen's drop zones", async () => {
    const d = await door();
    try {
      const lines = d.paint();
      const head = (d.desk.describe().panes as any[]).find(p => p.name === "activity").rect;
      const chip = d.app.dock.chipAt!;
      d.key(mouse("down", head.col + 4, head.row));
      d.key(mouse("drag", head.col + 8, head.row + 2));
      d.key(mouse("drag", chip.from + 1, chip.row));
      expect(d.paint().at(-1)).toContain("⤓ dock activity");     // the drop zone lights up
      d.key(mouse("up", chip.from + 1, chip.row));
      await until(() => d.docked("activity"), "activity docked");
      expect(lines.length).toBeGreaterThan(0);
      // Pulled up (the person's dock shows it); its tab's title dragged out over the screen's tree: lands there.
      expect(d.app.dock.open).toBe(true);
      d.paint();
      const r = d.app.dock.rect!;
      const tabRow = r.row + 1;
      const row = d.paint()[tabRow]!;
      const at = row.indexOf("activity");
      expect(at).toBeGreaterThan(0);
      d.key(mouse("down", at + 1, tabRow));
      d.key(mouse("drag", at + 4, tabRow));
      const tree = (d.desk.describe().panes as any[]).find(p => p.name === "tree").rect;
      d.key(mouse("drag", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      d.key(mouse("up", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      await until(() => !d.docked("activity") && !!d.desk.pane("activity"), "activity back on the desk");
    } finally { d.app.quit(); }
  });

  test("a key while dragging acts on the dragged tile: a docks it, f floats it, p puts it in a drawer", async () => {
    const d = await door();
    try {
      d.paint();
      const head = (n: string) => (d.desk.describe().panes as any[]).find(p => p.name === n).rect;
      const grab = (n: string) => { const h = head(n); d.key(mouse("down", h.col + 4, h.row)); d.key(mouse("drag", h.col + 9, h.row + 3)); };
      grab("activity"); d.key(char("a"));
      await until(() => d.docked("activity"), "a docks");
      d.paint();
      grab("thread"); d.key(char("f"));
      await until(() => (d.desk.layoutGet() as any).floats.some((f: any) => f.tile === "thread"), "f floats");
      d.paint();
      // p on the float: straight into a drawer (one step), and ^W f floats it again: float → drawer → float.
      await d.desk.dispatch.act({ action: "tile.pin", args: { on: false }, tile: "thread" }, USER);
      expect((d.desk.layoutGet() as any).floats).toEqual([]);
      expect((d.desk.layoutGet() as any).tiles.find((t: any) => t.name === "thread").drawer).toBeTruthy();
      await d.desk.dispatch.act({ action: "tile.float", args: {}, tile: "thread" }, USER);
      expect((d.desk.layoutGet() as any).floats.map((f: any) => f.tile)).toEqual(["thread"]);
    } finally { d.app.quit(); }
  });

  test("refused, with why: the dock's own tab stays; the screen's last tile stays; an agent never docks the tile the person types in", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await expect(d.app.dock.desk!.dispatch.act({ action: "host.dock", args: { on: false }, tile: "dock.agent" }, USER)).rejects.toThrow(/stays where it is/);
      // The person in kettle: an agent's dock of it is refused.
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.desk.dispatch.act({ action: "tile.enter", tile: "kettle" }, USER);
      await expect(d.app.act({ action: "host.dock", args: {}, tile: "kettle", as: AS })).rejects.toThrow(/typing|has the person's keys/);
      expect(d.docked("kettle")).toBe(false);
    } finally { d.app.quit(); }
  });

  test("never lost: a screen that goes for good hands a running tile it was given back to the dock; ids never collide; a kept tile stays", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "host.dock", args: {}, tile: "kettle", as: AS });
      expect(d.app.dock.tabs().find(t => t.name === "kettle")!.id).toMatch(/^k\d+$/);     // a dock id, never a screen's t<n>
      const other = otherScreen();
      d.app.push(other); d.paint();
      await d.app.dock.desk!.dispatch.act({ action: "host.dock", args: { on: false, to: "notes" }, tile: "kettle" }, USER);
      expect(other.pane("kettle")).toBeDefined();
      d.app.pop();                                               // last callers is left: gone for good
      expect(d.docked("kettle")).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      expect((d.pane("kettle") as PtyPane).running).toBe(true);
      // The river's Library (closable off: its save needs it) stays, said.
      const river: any = (await import("../src/desk/screen-specs")).openScreen("river");
      d.app.push(river); d.paint();
      await expect(d.app.act({ action: "host.dock", args: {}, tile: "library", as: AS })).rejects.toThrow(/library stays/);
    } finally { d.app.quit(); }
  });

  test("the dock's agent: listed for an agent, chosen by act (saved for this session), the picker by alt+g", async () => {
    const d = await door();
    try {
      const listed = await d.app.act({ action: "host.agent", args: {}, as: AS }) as any;
      expect(listed.agents.map((a: any) => a.name)).toContain("shell");
      await expect(d.app.act({ action: "host.agent", args: { name: "no-such-agent" }, as: AS })).rejects.toThrow(/no agent no-such-agent here; installed: shell/);
      const r = await d.app.act({ action: "host.agent", args: { name: "shell" }, as: AS }) as any;
      expect(r).toMatchObject({ agent: "shell", herdr: false });
      expect(JSON.parse(readFileSync(join(outlineState(), "dock-agent.json"), "utf8"))).toEqual({ agent: "shell" });
      // EP0CH_DAILY_AGENT (cat, here) still overrides it, and the door says so.
      expect((d.app.describe() as any).dock.runs.why.program).toContain("EP0CH_DAILY_AGENT");
      // The person's alt+g: the picker, over the dock.
      d.A.lastInput = 0;
      d.key({ kind: "alt", ch: "g" });
      expect(d.app.dock.open).toBe(true);
      expect(d.paint().some(l => l.includes("the dock's agent"))).toBe(true);
      d.key({ kind: "esc" });
    } finally { d.app.quit(); }
  });

  test("saved: the next door's dock has the tile back (dock-tiles.json), the drawer as it was", async () => {
    const d = await door();
    await d.app.act({ action: "host.dock", args: {}, tile: "thread", as: AS });
    d.app.quit();
    const file = join(outlineState(), "dock-tiles.json");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("thread");
    const e = await door();
    try {
      e.paint();
      expect(e.docked("thread")).toBe(true);
      expect(e.desk.pane("thread")).toBeDefined();               // the desk's own layout has a thread again (its spec): two tiles, one docked
    } finally { e.app.quit(); }
  });
});
