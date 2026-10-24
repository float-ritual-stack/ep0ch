// PIE-1254 (validation): a terminal folded to a spine, or in a folded drawer, keeps the size its program has: the
// program never sees the fold, and opening it again shows what it wrote whole. `layout.get` reads the drawer layer's
// rect from the same place as `peek` while the drawer is a strip. Scratch outline host, `cat` programs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[^m]*m/g, "");
const char = (ch: string): Key => ({ kind: "char", ch });
const USER = { kind: "user" } as const;

describe.skipIf(!outliner)("a folded terminal keeps the size its program has", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  // The layout glides (PIE-958): a tile folding or opening is drawn at every width between, and a terminal drawn at each
  // would be told each (its program re-wraps its line at 3 columns and keeps what it cut).
  beforeEach(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-ptysize-")); process.env.EP0CH_STATE = state; process.env.EP0CH_DAILY_AGENT = "cat"; process.env.EP0CH_MOTION = "full"; });
  afterEach(() => { delete process.env.EP0CH_STATE; delete process.env.EP0CH_DAILY_AGENT; process.env.EP0CH_MOTION = "off"; rmSync(state, { recursive: true, force: true }); });

  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 250, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    paint();
    await until(() => (desk.pane("kettle") as PtyPane | undefined)?.running === true, "kettle runs");
    return { app, desk, key, paint };
  }
  const size = (p: PtyPane) => [(p as any).cols, (p as any).rows];
  /** Every size the program was told while the layout glided for about a second after `change`. */
  async function seen(p: PtyPane, paint: () => unknown, change: () => unknown): Promise<string[]> {
    const sizes = new Set<string>([size(p).join("x")]);
    await change();
    for (let i = 0; i < 40; i++) { paint(); sizes.add(size(p).join("x")); await Bun.sleep(25); }
    return [...sizes];
  }

  test("on a screen: folded, then opened, the program is told no size in between; what it wrote is whole", async () => {
    const d = await door();
    try {
      const k = d.desk.pane("kettle") as PtyPane;
      const was = size(k).join("x");
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.desk.dispatch.act({ action: "tile.enter", tile: "kettle" }, USER);
      for (const c of "abc def\r") d.key(char(c));
      await until(() => k.text().some(l => l.includes("abc def")), "typed");
      d.key({ kind: "char", ch: "]", ctrl: true });
      expect(await seen(k, d.paint, () => d.key(char("-")))).toEqual([was]);
      const opened = await seen(k, d.paint, () => d.key(char("+")));
      expect(opened.length).toBeLessThanOrEqual(2);                       // the size it had, then the one it has now: nothing between
      expect(opened.every(s => Number(s.split("x")[0]) >= 20)).toBe(true);
      expect(k.text().filter(l => l.includes("abc def")).length).toBeGreaterThan(0);
    } finally { d.app.quit(); }
  });

  test("in the drawer, folded to a strip and a tile folded beside another: the same", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      d.paint();
      const dd = d.app.drawer.made!, k = dd.pane("kettle") as PtyPane;
      const was = size(k).join("x");
      expect(await seen(k, d.paint, () => dd.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "kettle" }, USER))).toEqual([was]);
      expect(d.app.drawer.folded).toBe(true);
      expect(await seen(k, d.paint, () => dd.dispatch.act({ action: "tile.collapse", args: { on: false }, tile: "kettle" }, USER))).toEqual([was]);
      await dd.dispatch.act({ action: "tile.open", args: { kind: "who", name: "beside", where: "right" }, tile: "kettle" }, USER);
      d.paint();
      const beside = size(k).join("x");
      expect(await seen(k, d.paint, () => dd.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "kettle" }, USER))).toEqual([beside]);
    } finally { d.app.quit(); }
  });

  test("in a group: the same", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.group", args: { with: "replies", name: "bundle" }, tile: "kettle" }, USER);
      d.paint();
      const inner = (d.desk.pane("bundle") as any).inner as Desk;
      const k = inner.pane("kettle") as PtyPane;
      const was = size(k).join("x");
      expect(await seen(k, d.paint, () => inner.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "kettle" }, USER))).toEqual([was]);
      // The group itself folded and opened: its inner desk is drawn at every width between too.
      await inner.dispatch.act({ action: "tile.collapse", args: { on: false }, tile: "kettle" }, USER);
      d.paint();
      const whole = size(k).join("x");
      // A neighbour folding makes the group glide wider: its inner desk is drawn at every width between too, and lands once.
      const got = await seen(k, d.paint, () => d.desk.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "tree" }, USER));
      expect(got.length).toBeLessThanOrEqual(2);
    } finally { d.app.quit(); }
  });

  test("layout.get reads the drawer layer's rect where peek does: the strip while it is folded, and no stale tile rects", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      d.paint();
      const layer = () => (d.desk.layoutAll() as any).layers.find((l: any) => l.drawer);
      expect(layer().rect).toEqual(d.app.drawer.describe().rect);
      await d.app.drawer.made!.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "kettle" }, USER);
      d.paint();
      expect(d.app.drawer.describe().rect!.rows).toBe(1);
      expect(layer().rect).toEqual(d.app.drawer.describe().rect);
      expect(layer().tiles.every((t: any) => t.rect === undefined)).toBe(true);
    } finally { d.app.quit(); }
  });
});
