// PIE-1574, PIE-1571: after an undo or a group key, the keys, the drawer, a program and the words land where a person
// expects. Every step a real key or click, at the sizes a person has. A scratch outline, made-up notes.
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

const USER = { kind: "user" } as const;
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("after an undo, by real keys (PIE-1574, PIE-1571)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-deskafter-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols: number, rows: number) {
    let key: (k: Key) => void = () => {};
    const term: any = { info: { cols, rows, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const paint = () => (app as any).paint();
    paint();
    const settle = async () => { await Bun.sleep(40); paint(); };
    const press = async (...ks: Key[]) => { for (const k of ks) { key(k); paint(); } await settle(); };
    const click = async (x: number, y: number) => { for (const action of ["down", "up"]) key({ kind: "mouse", action, button: 0, x, y } as Key); await settle(); };
    const rect = (name: string) => desk.layoutGet().tiles.find((t: any) => t.name === name)!.rect as { col: number; row: number; cols: number; rows: number };
    const inTile = (name: string) => { const r = rect(name); return click(r.col + 3, r.row + 2); };
    const names = () => desk.layoutGet().tiles.map((t: any) => t.name as string).sort();
    const focus = () => desk.layoutGet().focus as string;
    const said = () => (app as any).message as string;
    const drawer = () => app.drawer.desk as Desk;
    /** Where its shut dock's edge segment is drawn: the press the desk recorded there. */
    const edgeOf = (name: string) => { const id = (desk as any).idNamed(name); const h = (desk as any).presses.kind("dock").find((x: any) => x.id === id); return h ? { x: h.from, y: h.row } : null; };
    return { app, desk, press, click, inTile, rect, names, focus, said, paint, drawer, edgeOf, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  for (const [cols, rows] of [[177, 60], [80, 24]] as const) describe(`at ${cols}×${rows}`, () => {
    test("^W a from a shut drawer, ctrl+z: the same tile back with the keys on it, the drawer shut again", async () => {
      const d = await door(cols, rows);
      try {
        await d.inTile("replies");
        const replies = d.desk.pane("replies"), names = d.names();
        await d.press(ctrl("w"), char("a"));
        expect(d.app.drawer.open).toBe(true);
        expect(d.app.drawer.entered).toBe(true);
        await d.press(ctrl("z"));
        expect(d.names()).toEqual(names);
        expect(d.desk.pane("replies")).toBe(replies);
        expect(d.focus()).toBe("replies");
        expect(d.app.drawer.entered).toBe(false);
        expect(d.app.drawer.open).toBe(false);
      } finally { d.quit(); }
    });

    test("^W a with the drawer already up, ctrl+z: the drawer stays up, the keys come back with the tile", async () => {
      const d = await door(cols, rows);
      try {
        await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
        await d.app.dispatch.act({ action: "host.leave", args: {} }, USER).catch(() => {});
        d.paint();
        await d.inTile("replies");
        expect(d.app.drawer.entered).toBe(false);
        await d.press(ctrl("w"), char("a"));
        await d.press(ctrl("z"));
        expect(d.app.drawer.open).toBe(true);
        expect(d.app.drawer.entered).toBe(false);
        expect(d.focus()).toBe("replies");
      } finally { d.quit(); }
    });

    test("a carry undone with the keys on another tile: they stay on it", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "activity" }, USER);
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
        await d.app.dispatch.act({ action: "host.leave", args: {} }, USER).catch(() => {});
        d.paint();
        expect(d.focus()).toBe("tree");
        await d.press(ctrl("z"));
        expect(d.names()).toContain("replies");
        expect(d.focus()).toBe("tree");
        expect(d.app.drawer.entered).toBe(false);
      } finally { d.quit(); }
    });

    test("a carry undone with ^W B with the keys on the drawer's other tab: they stay there and the program runs on", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
        await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
        await until(() => d.app.drawer.tile?.running === true, "the drawer's program runs");
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        await d.drawer().dispatch.act({ action: "tile.focus", tile: "drawer.agent" }, USER);
        d.drawer().stopTyping();
        d.paint();
        expect(d.app.drawer.entered).toBe(true);
        await d.press(ctrl("w"), char("B"));
        expect(d.names()).toContain("replies");
        expect(d.app.drawer.entered).toBe(true);
        expect(d.app.drawer.open).toBe(true);
        expect(d.app.drawer.tile?.running).toBe(true);
      } finally { d.quit(); }
    });

    test("^W U, then ctrl+z: the tile is back, the keys where they were, nothing left on the glass or in the drawer", async () => {
      const d = await door(cols, rows);
      try {
        await d.inTile("replies");
        const replies = d.desk.pane("replies");
        await d.press(ctrl("w"), char("U"));
        expect(d.desk.pane("replies")).toBeUndefined();
        expect(d.app.drawer.entered).toBe(false);                            // the glass doesn't take the keys: they fell to another tile
        const keys = d.focus();
        await d.press(ctrl("z"));
        expect(d.desk.pane("replies")).toBe(replies);
        expect(d.focus()).toBe(keys);
        expect(d.app.drawer.entered).toBe(false);
        expect(d.app.drawer.open).toBe(false);
        await d.press(char("j"));                                            // the keys work: a plain key lands on the screen, not the drawer
        expect(d.app.drawer.entered).toBe(false);
      } finally { d.quit(); }
    });

    test("^W i into a group, then ctrl+z: the tile is back out, the same one, and the group stands", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.group", tile: "reader", args: { name: "hob" } }, USER);
        await d.desk.dispatch.act({ action: "tile.focus", tile: "activity" }, USER);
        d.paint();
        const activity = d.desk.pane("activity");
        await d.press(ctrl("w"), char("i"));
        expect(d.desk.pane("activity")).toBeUndefined();
        await d.press(ctrl("z"));
        expect(d.desk.pane("activity")).toBe(activity);
        expect(d.names()).toContain("hob");
        expect(d.desk.outOfStep()).toEqual([]);
      } finally { d.quit(); }
    });

    test("an agent's carry undone by the agent: the person's keys and drawer don't move", async () => {
      const d = await door(cols, rows);
      try {
        const AGENT = { kind: "agent", id: "wren" } as const;
        await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
        d.paint();
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, AGENT);
        expect(d.app.drawer.open).toBe(false);
        await d.desk.dispatch.act({ action: "layout.undo", args: {} }, AGENT);
        d.paint();
        expect(d.names()).toContain("replies");
        expect(d.focus()).toBe("tree");
        expect(d.app.drawer.open).toBe(false);
        expect(d.app.drawer.entered).toBe(false);
      } finally { d.quit(); }
    });

    test("into a group, ^W a carries its tile out, ctrl+z: the tile is back in the group with the keys on it, the drawer shut", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.group", tile: "reader", args: { with: "replies", name: "hob" } }, USER);
        await d.desk.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        d.paint();
        await d.press(ctrl("w"), char("e"));
        const hob = d.desk.pane("hob") as any, moved = hob.inner.layoutGet().focus as string, pane = hob.inner.pane(moved);
        await d.press(ctrl("w"), char("a"));
        expect(hob.inner.pane(moved)).toBeUndefined();
        expect(d.app.drawer.entered).toBe(true);
        await d.press(ctrl("z"));
        expect(hob.inner.pane(moved)).toBe(pane);
        expect(d.app.drawer.entered).toBe(false);
        expect(d.app.drawer.open).toBe(false);
        expect(d.focus()).toBe("hob");
        expect(hob.inner.layoutGet().focus).toBe(moved);
      } finally { d.quit(); }
    });

    test("^W i into a group, ctrl+z: the keys come back out with the tile", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.group", tile: "reader", args: { name: "hob" } }, USER);
        await d.desk.dispatch.act({ action: "tile.focus", tile: "activity" }, USER);
        d.paint();
        await d.press(ctrl("w"), char("i"));
        expect(d.focus()).toBe("hob");
        await d.press(ctrl("z"));
        expect(d.focus()).toBe("activity");
      } finally { d.quit(); }
    });

    test("keys on a group's tile, a carry from elsewhere undone: they stay on the group", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.group", tile: "reader", args: { with: "replies", name: "hob" } }, USER);
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "activity", args: { on: true } }, USER);
        await d.desk.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        await d.app.dispatch.act({ action: "host.leave", args: {} }, USER).catch(() => {});
        d.paint();
        await d.press(ctrl("w"), char("B"));
        expect(d.names()).toContain("activity");
        expect(d.focus()).toBe("hob");
      } finally { d.quit(); }
    });

    test("a drawer the person put away and pulled up again stays up when the carry is undone", async () => {
      const d = await door(cols, rows);
      try {
        await d.inTile("replies");
        await d.press(ctrl("w"), char("a"));
        await d.press({ kind: "alt", ch: "a" } as Key);                      // put away
        expect(d.app.drawer.open).toBe(false);
        await d.press({ kind: "alt", ch: "a" } as Key);                      // pulled up by hand
        expect(d.app.drawer.open).toBe(true);
        await d.inTile("activity");
        expect(d.app.drawer.entered).toBe(false);
        await d.press(ctrl("z"));
        expect(d.names()).toContain("replies");
        expect(d.app.drawer.open).toBe(true);
      } finally { d.quit(); }
    });

    test("a dock of two opened on one tile, shut as the keys leave: no step by design, and it remembers the tile", async () => {
      const d = await door(cols, rows);
      try {
        const act = (action: string, tile: string, args: Record<string, unknown> = {}) => d.desk.dispatch.act({ action, tile, args }, USER);
        await act("tile.dock", "activity", { edge: "right" });
        await act("layout.move", "replies", { to: "activity", where: "tabs" });
        await act("tile.focus", "tree");
        d.paint();
        const shown = (n: string) => d.desk.layoutGet().tiles.find((t: any) => t.name === n)!;
        const dock = (shown("activity") as { container?: string }).container!;
        const what = d.desk.history.newest()?.what, steps = d.desk.history.size;
        await d.desk.dispatch.press("tile.slide", { open: true, container: dock }, "replies");
        d.paint();
        expect(shown("replies").shown).toBe(true);
        await d.inTile("tree");                                               // the keys leave: the dock shuts, as it looked before
        expect(shown("replies").shown).toBe(false);
        expect(d.desk.history.size).toBe(steps);
        expect(d.desk.history.newest()?.what).toBe(what);
        await d.desk.dispatch.press("tile.slide", { open: true, container: dock });   // its memory is kept: it opens on replies
        d.paint();
        expect(shown("replies").shown).toBe(true);
      } finally { d.quit(); }
    });

    test("a click doesn't use up a ctrl+z: a float raised, a tab shown and a dock shut by the keys leaving are no steps", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
        const act = (action: string, tile: string, args: Record<string, unknown> = {}) => d.desk.dispatch.act({ action, tile, args }, USER);
        await act("tile.float", "activity", { on: true });
        await act("tile.float", "replies", { on: true });
        await act("layout.move", "reader", { to: "tree", where: "tabs" });
        await act("tile.close", "reader");
        d.paint();
        const steps = d.desk.history.size;
        await act("tile.focus", "activity");                                 // under replies: focusing raises it
        expect(d.desk.layoutGet().tiles.find((t: any) => t.name === "activity")!.focused).toBe(true);
        await d.desk.dispatch.press("tile.focus", {}, "tree");
        d.paint();
        expect(d.desk.history.size).toBe(steps);
        expect(d.desk.history.newest()?.what).toBe("close");
      } finally { d.quit(); }
    });

    test("a tab clicked is no step, and the next ctrl+z takes back the real change", async () => {
      const d = await door(cols, rows);
      try {
        const act = (action: string, tile: string, args: Record<string, unknown> = {}) => d.desk.dispatch.act({ action, tile, args }, USER);
        await act("layout.move", "activity", { to: "replies", where: "tabs" });
        await act("tile.focus", "replies");
        d.paint();
        const names = d.names();
        await act("tile.close", "tree");
        d.paint();
        const steps = d.desk.history.size;
        await d.desk.dispatch.press("tab.select", { by: 1 }, "replies");
        d.paint();
        expect(d.desk.history.size).toBe(steps);
        await d.press(ctrl("z"));
        expect(d.said()).toContain("close");
        expect(d.names()).toEqual(names);
      } finally { d.quit(); }
    });

    test("a dock opened and shut again leaves no step: ctrl+z goes to the change before it", async () => {
      const d = await door(cols, rows);
      try {
        const act = (action: string, tile: string, args: Record<string, unknown> = {}) => d.desk.dispatch.act({ action, tile, args }, USER);
        await act("tile.dock", "activity", { edge: "right" });
        await act("tile.focus", "tree");
        d.paint();
        const dock = () => d.desk.layoutGet().tiles.find((t: any) => t.name === "activity")!.shown as boolean;
        expect(dock()).toBe(false);
        const steps = d.desk.history.size, what = d.desk.history.newest()?.what;
        await d.desk.dispatch.press("tile.slide", { open: true }, "activity");
        d.paint();
        expect(dock()).toBe(true);
        expect(d.desk.history.size).toBe(steps + 1);
        await d.desk.dispatch.press("tile.focus", {}, "tree");                // the keys leave: the sliding dock shuts
        d.paint();
        expect(dock()).toBe(false);
        expect(d.desk.history.size).toBe(steps);
        expect(d.desk.history.newest()?.what).toBe(what);
        await d.desk.dispatch.press("tile.focus", {}, "activity");            // a focus opens it, the keys leaving shuts it: neither is a step
        d.paint();
        expect(dock()).toBe(true);
        await d.desk.dispatch.press("tile.focus", {}, "tree");
        d.paint();
        expect(dock()).toBe(false);
        expect(d.desk.history.size).toBe(steps);
      } finally { d.quit(); }
    });

    test("^W G with the keys on a group spills it, the tiles back; stepped in, ^W G is the inner tile's", async () => {
      const d = await door(cols, rows);
      try {
        const reader = d.desk.pane("reader");
        await d.desk.dispatch.act({ action: "tile.group", tile: "reader", args: { with: "replies", name: "hob" } }, USER);
        await d.desk.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        d.paint();
        await d.press(ctrl("w"), char("e"));
        expect((d.desk.pane("hob") as any).inside).toBe(true);
        await d.press(ctrl("w"), char("G"));
        expect(d.said()).toContain("this tile or the whole split");
        expect(d.names()).toContain("hob");
        await d.press({ kind: "esc" } as Key);
        await d.press(ctrl("w"), char("e"));
        expect((d.desk.pane("hob") as any).inside).toBe(false);
        expect(d.said()).not.toContain("is a reader tile");
        await d.press(ctrl("w"), char("G"));
        expect(d.names()).not.toContain("hob");
        expect(d.names()).toContain("replies");
        expect(d.said()).toContain("spilled hob");
        expect(d.desk.pane("reader")).toBe(reader);
      } finally { d.quit(); }
    });

    test("a group in the drawer: ^W e goes in and comes out, ^W G spills it there", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        const dr = d.drawer();
        await dr.dispatch.act({ action: "tile.group", tile: "replies", args: { name: "hob" } }, USER);
        await dr.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        dr.stopTyping();
        d.paint();
        expect(d.app.drawer.entered).toBe(true);
        await d.press(ctrl("w"), char("e"));
        expect((dr.pane("hob") as any).inside).toBe(true);
        await d.press(ctrl("w"), char("e"));
        expect((dr.pane("hob") as any).inside).toBe(false);
        await d.press(ctrl("w"), char("G"));
        expect(dr.pane("hob")).toBeUndefined();
        expect(dr.pane("replies")).toBeDefined();
      } finally { d.quit(); }
    });

    test("^W o s, then an undo: the program keeps a tile the person can reach by one click, and the screen says so", async () => {
      const d = await door(cols, rows);
      try {
        await d.inTile("tree");
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (d.desk.pane("pty") as PtyPane | undefined)?.running === true, "the shell runs");
        const shell = d.desk.pane("pty") as PtyPane;
        await d.press(ctrl("]"));                                            // out of its keys: the shell has ctrl+z while typing
        await d.press(ctrl("w"), char("B"));
        expect(d.said()).toContain("pty");
        expect(d.said()).toContain("running");
        expect(shell.running).toBe(true);
        expect(d.desk.pane("pty")).toBe(shell);
        expect(d.desk.outOfStep()).toEqual([]);
        expect(d.focus()).toBe("tree");
        // Its dock's edge is on screen, and one click there shows it.
        const cell = d.desk.layoutGet().tiles.find((t: any) => t.name === "pty")!;
        expect(cell.shown).toBe(false);
        const spot = d.edgeOf("pty");
        expect(spot).not.toBeNull();
        await d.click(spot!.x, spot!.y);
        const after = d.desk.layoutGet().tiles.find((t: any) => t.name === "pty")!;
        expect(after.shown).toBe(true);
        expect(after.rect!.cols).toBeGreaterThan(0);
      } finally { d.quit(); }
    });
  });
});

describe.skipIf(!outliner)("tile.slide naming only a dock (PIE-1566)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); state = mkdtempSync(join(tmpdir(), "ep0ch-slide-")); process.env.EP0CH_STATE = state; }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); rmSync(state, { recursive: true, force: true }); });
  const AGENT = { kind: "agent", id: "wren" } as const;

  test("slides that dock's own tile open with the person's keys where they are; a tile from outside is refused with the command", async () => {
    const term: any = { info: { cols: 177, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    try {
      (app as any).paint();
      await desk.dispatch.act({ action: "tile.dock", tile: "activity", args: { edge: "left" } }, USER);
      await desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
      const shown = (n: string) => desk.layoutGet().tiles.find((t: any) => t.name === n)!;
      const dock = (shown("activity") as { container?: string }).container!;
      expect(dock).toMatch(/^d\d+/);
      await desk.dispatch.act({ action: "tile.slide", args: { container: dock, open: true } }, AGENT);
      expect(shown("activity").shown).toBe(true);
      expect(shown("reader").rect!.cols).toBeGreaterThan(0);
      expect(desk.layoutGet().focus).toBe("reader");
      await expect(desk.dispatch.act({ action: "tile.slide", tile: "reader", args: { container: dock, open: true } }, AGENT))
        .rejects.toThrow(new RegExp(`reader isn't in dock ${dock}.*tile\\.slide container=${dock}`));
    } finally { app.quit(); app.drawer.tile?.kill(); }
  });
});
