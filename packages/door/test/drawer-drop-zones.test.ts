// PIE-1263: a tile dragged from the screen onto the drawer lands where the drawer desk's own drop zones say (the
// edges of a drawer tile, its tab strip), as a tile dragged onto a group does, not always as a tab. By the mouse and
// by `tile.drawer to= where=` (one action). Scratch outline host, made-up notes, `cat` programs.
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
const mouse = (action: "down" | "up" | "drag", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });
const USER = { kind: "user" } as const;
const ZONES = ["left", "right", "up", "down", "tabs"] as const;
type Zone = (typeof ZONES)[number];

describe.skipIf(!outliner)("a tile dragged onto the drawer lands where its drop zones say", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-drop-")); process.env.EP0CH_STATE = state; process.env.EP0CH_DAILY_AGENT = "cat"; });
  afterEach(() => { delete process.env.EP0CH_STATE; delete process.env.EP0CH_DAILY_AGENT; rmSync(state, { recursive: true, force: true }); });

  /** A door on the desk (tree, reader, a `cat` terminal named kettle, replies, activity), `activity` already in the drawer as the drop target. */
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
    await desk.dispatch.act({ action: "tile.drawer", tile: "activity" }, USER);
    paint();
    return { app, desk, key, paint, drawer: () => app.drawer.made! };
  }
  type Door = Awaited<ReturnType<typeof door>>;

  /** Where the moving tile is, relative to the target `activity`, in the drawer's layout. */
  const landed = (d: Door, moving: string): string => {
    const tiles = d.drawer().layoutGet().tiles as any[];
    const m = tiles.find(t => t.name === moving), a = tiles.find(t => t.name === "activity");
    if (!m) return "not in the drawer";
    if ((m.tabs ?? []).includes("activity")) return "tabs";
    if (m.rect.col >= a.rect.col + a.rect.cols) return "right";
    if (m.rect.col + m.rect.cols <= a.rect.col) return "left";
    if (m.rect.row >= a.rect.row + a.rect.rows) return "down";
    if (m.rect.row + m.rect.rows <= a.rect.row) return "up";
    return "?";
  };
  /** A point in the target's zone, in the drawer desk's cells. */
  const at = (d: Door, zone: Zone): [number, number] => {
    const t = (d.drawer().layoutGet().tiles as any[]).find(x => x.name === "activity").rect;
    const mid = (n: number, size: number) => n + Math.floor(size / 2);
    return ({ left: [t.col + 1, mid(t.row, t.rows)], right: [t.col + t.cols - 2, mid(t.row, t.rows)], up: [mid(t.col, t.cols), t.row + 1], down: [mid(t.col, t.cols), t.row + t.rows - 2], tabs: [t.col + 4, t.row] } as const)[zone] as [number, number];
  };
  /** The tile to move: `kind`, alone or gathered with a neighbour into a group. */
  async function prepare(d: Door, kind: "reader" | "kettle", grouped: boolean) {
    if (!grouped) return { moving: kind, kindName: kind === "kettle" ? "pty" : "reader" };
    await d.desk.dispatch.act({ action: "tile.group", args: { with: kind === "reader" ? "replies" : "reader", name: "bundle" }, tile: kind }, USER);
    d.paint();
    return { moving: "bundle", kindName: "screen" };
  }

  for (const grouped of [false, true]) {
    for (const kind of ["reader", "kettle"] as const) {
      for (const zone of ZONES) {
        const what = `${grouped ? "a group with " : ""}${kind} on the ${zone} of a drawer tile`;
        test(`mouse: ${what}`, async () => {
          const d = await door();
          try {
            const { moving, kindName } = await prepare(d, kind, grouped);
            const [x, y] = at(d, zone);
            const preview = d.drawer().foreignAt(x, y, { name: moving, kind: kindName });
            d.drawer().cancelDrag();
            expect(preview?.refused).toBeUndefined();
            const head = (d.desk.describe().panes as any[]).find(p => p.name === moving).rect;
            d.key(mouse("down", head.col + 4, head.row)); d.key(mouse("drag", head.col + 9, head.row + 2)); d.key(mouse("drag", x, y));
            // Over a zone the drag shows where it lands, in words, before it is let go.
            expect(d.paint().at(-1)).toContain(preview!.label);
            d.key(mouse("up", x, y));
            await until(() => landed(d, moving) !== "not in the drawer", "in the drawer");
            expect(landed(d, moving)).toBe(zone);
          } finally { d.app.quit(); }
        });
        test(`act: ${what}`, async () => {
          const d = await door();
          try {
            const { moving } = await prepare(d, kind, grouped);
            await d.desk.dispatch.act({ action: "tile.drawer", args: { on: true, to: "activity", where: zone }, tile: moving }, USER);
            expect(landed(d, moving)).toBe(zone);
          } finally { d.app.quit(); }
        });
      }
    }
  }

  test("onto the drawer's bar or its chip, a tile still goes in as a tab", async () => {
    const d = await door();
    try {
      const chip = d.app.drawer.chipAt!, head = (d.desk.describe().panes as any[]).find(p => p.name === "reader").rect;
      d.key(mouse("down", head.col + 4, head.row)); d.key(mouse("drag", head.col + 9, head.row + 2)); d.key(mouse("drag", chip.from + 1, chip.row)); d.key(mouse("up", chip.from + 1, chip.row));
      await until(() => landed(d, "reader") !== "not in the drawer", "in the drawer");
      expect(landed(d, "reader")).toBe("tabs");
    } finally { d.app.quit(); }
  });

  test("a drag ended by a key leaves no ghost in the drawer", async () => {
    const d = await door();
    try {
      const [x, y] = at(d, "right"), head = (d.desk.describe().panes as any[]).find(p => p.name === "reader").rect;
      d.key(mouse("down", head.col + 4, head.row)); d.key(mouse("drag", head.col + 9, head.row + 2)); d.key(mouse("drag", x, y));
      expect((d.drawer() as any).foreign).not.toBeNull();
      d.key({ kind: "char", ch: "f" });                              // f floats the dragged tile: the drag ends there
      d.paint();
      expect((d.drawer() as any).foreign).toBeNull();
    } finally { d.app.quit(); }
  });

  test("an agent tab out on the screen goes back where it is dropped, like any tile (PIE-1331)", async () => {
    const d = await door();
    try {
      const out: any = await d.drawer().dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER);
      await d.desk.dispatch.act({ action: "tile.drawer", args: { on: true, to: "activity", where: "right" }, tile: out.name }, USER);
      const tiles = d.drawer().layoutGet().tiles as any[], agent = tiles.find(t => t.name === out.name), activity = tiles.find(t => t.name === "activity");
      expect(agent.rect.col).toBeGreaterThanOrEqual(activity.rect.col + activity.rect.cols);
    } finally { d.app.quit(); }
  });

  test("a drawer holding only its agent tab takes the tile beside it, by the same zones", async () => {
    const d = await door();
    try {
      await d.drawer().dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "activity" }, USER);
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      d.paint();
      const name = d.app.drawer.agentName();
      expect(d.drawer().tileOutline().map(t => t.name)).toEqual([name]);
      const own = (d.drawer().layoutGet().tiles as any[])[0].rect, x = own.col + own.cols - 2, y = own.row + Math.floor(own.rows / 2);
      const head = (d.desk.describe().panes as any[]).find(p => p.name === "reader").rect;
      d.key(mouse("down", head.col + 4, head.row)); d.key(mouse("drag", head.col + 9, head.row + 2)); d.key(mouse("drag", x, y)); d.key(mouse("up", x, y));
      await until(() => d.drawer().tileOutline().some(t => t.name === "reader"), "in the drawer");
      const tiles = d.drawer().layoutGet().tiles as any[], reader = tiles.find(t => t.name === "reader"), mine = tiles.find(t => t.name === name);
      expect(reader.rect.col).toBeGreaterThanOrEqual(mine.rect.col + mine.rect.cols);
    } finally { d.app.quit(); }
  });
});

describe.skipIf(!outliner)("a drop the screen won't give up", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-drop-")); process.env.EP0CH_STATE = state; process.env.EP0CH_DAILY_AGENT = "cat"; });
  afterEach(() => { delete process.env.EP0CH_STATE; delete process.env.EP0CH_DAILY_AGENT; rmSync(state, { recursive: true, force: true }); });

  test("the last tile of a screen dragged onto the drawer says it stays, in the chip before the release and on the status line after; nothing moves", async () => {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 250, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const only = new Desk({ name: "one", title: "one", layout: { focus: "only", root: { t: "leaf", kind: "reader", name: "only", mode: "held" } } as any });
    app.push(only);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    try {
      paint();
      await app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      paint();
      const why = only.takeRefusal("only", USER);
      expect(why).not.toBeNull();
      const head = (only.describe().panes as any[]).find(p => p.name === "only").rect, r = app.drawer.rect!;
      key(mouse("down", head.col + 4, head.row)); key(mouse("drag", head.col + 9, head.row + 2)); key(mouse("drag", 30, r.row + 1));
      // The tab strip: the chip says what the release will do, and it is the refusal.
      expect(paint().at(-1)).toContain(`✕ ${why}`);
      key(mouse("up", 30, r.row + 1));
      paint();
      expect(only.pane("only")).toBeDefined();
      expect(app.drawer.tabs().map(t => t.name)).not.toContain("only");
      expect(((app as any).message as string)).toContain(why!);
    } finally { app.quit(); }
  });
});
