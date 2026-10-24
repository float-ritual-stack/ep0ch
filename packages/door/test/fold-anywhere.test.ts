// PIE-1254: `-` folds the thing you're on to a spine, everywhere. In the drawer a tile with a neighbour folds in the
// drawer's own layout; a lone tile folds the drawer itself to a strip (+ = ⏎ space or a click open it as it was); Esc
// still steps out and puts the drawer away. Every input reaches the tile that has the keys and moves nothing else.
// A scratch outline host, made-up notes, `cat` programs.
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
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });
const alt = (ch: string): Key => ({ kind: "alt", ch });
const esc: Key = { kind: "esc" };
const mouse = (action: "down" | "up", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });
const USER = { kind: "user" } as const;

/** Each way to fold a tile, by the keys it is typed with. */
const KEYS: Record<string, Key[]> = { "-": [char("-")], "alt+h": [alt("h")], "ctrl+w c": [ctrl("w"), char("c")] };
const KINDS = ["reader", "kettle", "replies", "activity"] as const;
type Kind = (typeof KINDS)[number];
const PLACES = ["screen, drawer put away", "screen, drawer up", "drawer, lone tab", "drawer, a tile beside it"] as const;
type Place = (typeof PLACES)[number];

describe.skipIf(!outliner)("fold anywhere: the fold keys reach the tile that has the keys", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => { state = mkdtempSync(join(tmpdir(), "ep0ch-fold-")); process.env.EP0CH_STATE = state; process.env.EP0CH_DAILY_AGENT = "cat"; });
  afterEach(() => { delete process.env.EP0CH_STATE; delete process.env.EP0CH_DAILY_AGENT; rmSync(state, { recursive: true, force: true }); });

  /** A door on the desk (tree, reader, a `cat` terminal named kettle, replies, activity) on a fake 250x40 terminal (wide enough that opening a spine folds no other). */
  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 250, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    paint();
    await until(() => (desk.pane("kettle") as PtyPane | undefined)?.running === true, "kettle runs");
    const press = (keys: Key[]) => { for (const k of keys) key(k); paint(); };
    const click = (x: number, y: number) => { key(mouse("down", x, y)); key(mouse("up", x, y)); paint(); };
    const foldedIn = (d: Desk) => d.layoutGet().tiles.filter((t: any) => t.collapsed).map((t: any) => t.name).sort();
    /** Everything a fold could move: the screen's spines, the drawer's, the drawer itself, and where the keys are. */
    const snap = () => ({
      screen: foldedIn(desk), drawerTiles: app.drawer.made ? foldedIn(app.drawer.made) : [], strip: app.drawer.folded, up: app.drawer.open,
      keys: app.drawer.entered ? "drawer" : "screen", focus: (app.drawer.entered ? app.drawer.made! : desk).focusName(),
    });
    return { app, desk, press, click, paint, snap, drawer: () => app.drawer.made! };
  }
  type Door = Awaited<ReturnType<typeof door>>;

  /**
   * The person's keys on tile `kind` in `place`. A terminal's program takes the keys while they type in it, so the
   * escape prefix first steps out of it (the tile keeps the keys); the others take the fold keys as they are.
   */
  async function arrive(d: Door, place: Place, kind: Kind): Promise<{ on: Desk; prefix: Key[] }> {
    const prefix = kind === "kettle" ? [ctrl("]")] : [];
    if (place.startsWith("screen")) {
      if (place === "screen, drawer up") {
        // An agent puts a tile in the drawer and pulls it up: the person's keys stay on the screen.
        await d.app.act({ action: "tile.drawer", tile: kind === "reader" ? "activity" : "reader", as: "fold-agent" });
        await d.app.act({ action: "host.toggle", args: { open: true }, as: "fold-agent" });
        d.app.drawer.height(0.25);                                       // the screen's tile frames stay above it, to click
        d.paint();
        expect(d.app.drawer.open).toBe(true);
        expect(d.app.drawer.entered).toBe(false);
      }
      await d.desk.dispatch.act({ action: "tile.focus", tile: kind }, USER);
      if (kind === "kettle") await d.desk.dispatch.act({ action: "tile.enter", tile: kind }, USER);
      return { on: d.desk, prefix };
    }
    await d.desk.dispatch.act({ action: "tile.drawer", tile: kind }, USER);
    d.paint();
    if (place === "drawer, a tile beside it") await d.drawer().dispatch.act({ action: "tile.open", args: { kind: "who", name: "beside", where: "right" }, tile: kind }, USER);
    d.paint();
    d.click(20, d.app.drawer.rect!.row + 3);
    expect(d.app.drawer.entered).toBe(true);
    await d.drawer().dispatch.act({ action: "tile.focus", tile: kind }, USER);
    if (kind === "kettle") await d.drawer().dispatch.act({ action: "tile.enter", tile: kind }, USER);
    return { on: d.drawer(), prefix };
  }

  /** What folding `kind` in `place` leaves, from the state `was`: the fold on the tile with the keys, nothing else. */
  const afterFold = (was: ReturnType<Door["snap"]>, place: Place, kind: Kind) => place.startsWith("screen") ? { ...was, screen: [...was.screen, kind].sort() }
    : place === "drawer, lone tab" ? { ...was, strip: true }
      : { ...was, drawerTiles: [...new Set([...was.drawerTiles, kind, "drawer.agent"])].sort() };

  describe("every input folds the tile that has the keys, + opens it again as it was", () => {
    for (const place of PLACES) {
      for (const kind of KINDS) {
        test(`${kind}, ${place}`, async () => {
          const d = await door();
          try {
            const { on, prefix } = await arrive(d, place, kind);
            const was = d.snap();
            const inputs: [string, () => Promise<void> | void][] = [
              ...Object.entries(KEYS).map(([how, keys]) => [how, () => d.press([...prefix, ...keys])] as [string, () => void]),
              ["act", async () => { await on.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: kind }, USER); }],
              ["menu row", async () => {
                const row = on.dispatch.menu(kind, USER).find(r => r.action === "tile.collapse")!;
                expect(row.label).toBe("fold to a spine");
                expect(row.refused).toBeUndefined();
                await on.dispatch.act({ action: row.action, args: row.args, tile: kind }, USER);
              }],
            ];
            // The glyph on the tile's frame (a lone drawer tab has none: the strip is what a click opens).
            if (place !== "drawer, lone tab") inputs.push(["title-bar fold click", () => {
              const b = (on as any).foldButtons.find((x: any) => x.id === (on as any).idNamed(kind));
              if (!b) throw new Error(`no fold glyph on ${kind}'s frame`);
              d.press(prefix);
              d.click(b.from, b.row + (on === d.desk ? 0 : d.app.drawer.rect!.row + 1));
            }]);
            for (const [how, run] of inputs) {
              await run();
              expect({ how, ...d.snap() }).toEqual({ how, ...afterFold(was, place, kind) });
              d.press([char("+")]);
              expect({ how: `${how}, then +`, ...d.snap() }).toEqual({ how: `${how}, then +`, ...was });
              // The keys are on the tile again for the next input (a terminal's program has them back).
              if (kind === "kettle") await on.dispatch.act({ action: "tile.enter", tile: kind }, USER);
            }
          } finally { d.app.quit(); }
        });
      }
    }
  });

  describe("a tile in a group folds in the group, on the screen and in the drawer", () => {
    for (const place of ["screen", "drawer"] as const) {
      for (const kind of ["reader", "kettle"] as const) {
        test(`${kind}, ${place}`, async () => {
          const d = await door();
          try {
            await d.desk.dispatch.act({ action: "tile.group", args: { with: "replies", name: "bundle" }, tile: kind }, USER);
            d.paint();
            if (place === "drawer") {
              await d.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
              d.paint();
              await d.app.dispatch.act({ action: "host.enter" }, USER);
              expect(d.app.drawer.entered).toBe(true);
            }
            const home = place === "drawer" ? d.drawer() : d.desk;
            const inner = (home.pane("bundle") as any).inner as Desk;
            await home.dispatch.act({ action: "tile.focus", tile: `bundle/${kind}` }, USER);
            const was = d.snap();
            d.press([char("-")]);
            expect(inner.layoutGet().tiles.filter((t: any) => t.collapsed).map((t: any) => t.name)).toEqual([kind]);
            expect(d.snap()).toEqual(was);
            d.press([char("+")]);
            expect(inner.layoutGet().tiles.filter((t: any) => t.collapsed).map((t: any) => t.name)).not.toContain(kind);
          } finally { d.app.quit(); }
        });
      }
    }
  });

  describe("the drawer", () => {
    test("Esc steps out and then puts it away, as before; folded, Esc steps out of the strip and then puts it away", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "reader" }, USER);
        d.paint();
        d.click(20, d.app.drawer.rect!.row + 3);
        d.press([esc]);
        expect([d.app.drawer.entered, d.app.drawer.open]).toEqual([false, true]);
        d.press([esc]);
        expect(d.app.drawer.open).toBe(false);
        // Folded: the keys are on the strip; Esc steps out of it (it stays a strip), and Esc again puts the drawer away.
        d.press([alt("a")]);
        expect([d.app.drawer.entered, d.app.drawer.open, d.app.drawer.folded]).toEqual([true, true, false]);
        d.press([char("-")]);
        expect(d.app.drawer.folded).toBe(true);
        d.press([esc]);
        expect([d.app.drawer.entered, d.app.drawer.open, d.app.drawer.folded]).toEqual([false, true, true]);
        d.press([esc]);
        expect([d.app.drawer.open, d.app.drawer.folded]).toEqual([false, false]);
        // Pulled up again it is open, not a strip.
        d.press([alt("a")]);
        expect([d.app.drawer.open, d.app.drawer.folded]).toEqual([true, false]);
      } finally { d.app.quit(); }
    });

    test("a click on the strip opens it as it was; ⏎ and space do too; other keys do nothing to the tile out of sight", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "reader" }, USER);
        d.paint();
        d.click(20, d.app.drawer.rect!.row + 3);
        const share = d.app.drawer.share;
        d.press([char("-")]);
        expect(d.app.drawer.rect!.rows).toBe(1);
        d.press([char("x"), char("d"), ctrl("w"), char("x")]);
        expect([d.app.drawer.folded, d.drawer().tileOutline().map(t => t.name)]).toEqual([true, ["drawer.agent", "reader"]]);
        d.press([{ kind: "enter" }]);
        expect(d.app.drawer.folded).toBe(false);
        d.press([char("-"), esc]);                                       // folded, the keys on the screen
        expect([d.app.drawer.folded, d.app.drawer.entered]).toEqual([true, false]);
        d.click(10, d.app.drawer.rect!.row);
        expect([d.app.drawer.folded, d.app.drawer.entered, d.app.drawer.share]).toEqual([false, true, share]);
        d.press([char("-"), char(" ")]);
        expect(d.app.drawer.folded).toBe(false);
      } finally { d.app.quit(); }
    });

    test("an agent folds the drawer when the person isn't in it, and doesn't when they are; the strip is saved", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "reader" }, USER);
        d.paint();
        d.click(20, d.app.drawer.rect!.row + 3);
        await expect(d.app.act({ action: "tile.collapse", args: { on: true }, tile: "reader", as: "fold-agent" })).rejects.toThrow(/person is in the drawer/);
        d.press([esc]);
        const out: any = await d.app.act({ action: "tile.collapse", args: { on: true }, tile: "reader", as: "fold-agent" });
        expect(out).toMatchObject({ collapsed: true });
        expect([d.app.drawer.folded, d.app.drawer.entered]).toEqual([true, false]);
        // Saved: the next door on this state comes up with the strip.
        const next = await door();
        try { expect([next.app.drawer.open, next.app.drawer.folded]).toEqual([true, true]); } finally { next.app.quit(); }
        await d.app.act({ action: "tile.collapse", args: { on: false }, tile: "reader", as: "fold-agent" });
        expect(d.app.drawer.folded).toBe(false);
      } finally { d.app.quit(); }
    });

    test("a drawer tile's menu folds it to a spine and, as its own row, puts the drawer away", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "reader" }, USER);
        d.paint();
        const rows = d.drawer().dispatch.menu("reader", USER);
        expect(rows.find(r => r.action === "tile.collapse")).toMatchObject({ label: "fold to a spine" });
        const away = rows.find(r => r.action === "drawer.away")!;
        expect(away).toMatchObject({ label: "put away the drawer", key: "esc" });
        expect(away.refused).toBeUndefined();
        expect(d.desk.dispatch.menu("activity", USER).some(r => r.action === "drawer.away")).toBe(false);
        await d.drawer().dispatch.act({ action: away.action, args: away.args, tile: "reader" }, USER);
        expect([d.app.drawer.open, d.app.drawer.folded, d.drawer().tileOutline().map(t => t.name)]).toEqual([false, false, ["drawer.agent", "reader"]]);
      } finally { d.app.quit(); }
    });

    test("ctrl+] inside a group there comes out of the group first, as on a screen; the next leaves the drawer", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.group", args: { with: "replies", name: "bundle" }, tile: "reader" }, USER);
        d.paint();
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
        d.paint();
        await d.app.dispatch.act({ action: "host.enter" }, USER);
        const group = d.drawer().pane("bundle") as any;
        await d.drawer().dispatch.act({ action: "mount.enter", args: { on: true }, tile: "bundle" }, USER);
        expect([group.inside, d.app.drawer.entered]).toEqual([true, true]);
        d.press([ctrl("]")]);
        expect([group.inside, d.app.drawer.entered]).toEqual([false, true]);
        d.press([ctrl("]")]);
        expect(d.app.drawer.entered).toBe(false);
      } finally { d.app.quit(); }
    });

    test("ctrl+] in a terminal there steps out of the program, a second soon after sends it; with no program taking keys it leaves the drawer", async () => {
      const d = await door();
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
        d.paint();
        d.click(20, d.app.drawer.rect!.row + 3);
        const kettle = d.drawer().pane("kettle") as PtyPane;
        expect(d.drawer().rawKeys()).toBe(true);
        d.press([ctrl("]")]);
        expect([d.app.drawer.entered, d.drawer().rawKeys()]).toEqual([true, false]);
        d.press([ctrl("]")]);
        expect([d.app.drawer.entered, d.drawer().rawKeys()]).toEqual([true, true]);
        await until(() => kettle.text().some(l => l.includes("^]")), "the second ctrl+] reached the program");
        d.press([ctrl("]")]);                                            // out of the program again; not soon after, the next leaves
        (d.drawer() as any).chord.at -= 5000;
        d.press([ctrl("]")]);
        expect(d.app.drawer.entered).toBe(false);
      } finally { d.app.quit(); }
    });
  });
});
