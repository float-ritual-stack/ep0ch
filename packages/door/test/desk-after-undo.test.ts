// PIE-1574, PIE-1571: after an undo or a group key, the keys, the drawer, a program and the words land where a person
// expects. Every step a real key or click, at the sizes a person has. A scratch outline, made-up notes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { docks, leaves } from "../src/desk/layout";
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

    test("a shell on the plain screen, undone twice: the door stays up", async () => {
      const d = await door(cols, rows);
      try {
        await d.inTile("tree");
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (d.desk.pane("pty") as PtyPane | undefined)?.running === true, "the shell runs");
        const shell = d.desk.pane("pty") as PtyPane;
        await d.press(ctrl("]"));
        await d.press(ctrl("z"));
        expect(d.said()).toContain("kept in a dock");
        await d.press(ctrl("z"));
        expect(d.said()).toContain("nothing to undo");
        expect(d.desk.outOfStep()).toEqual([]);
        expect(shell.running).toBe(true);
      } finally { d.quit(); }
    });

    // PIE-1575: each undone terminal open kept its program in a dock of its own; the second joins the first's.
    test("two shells opened and each undone by real keys: both kept in one dock at the right edge, one click shows them", async () => {
      const d = await door(cols, rows);
      try {
        const containerOf = (name: string) => (d.desk.layoutGet().tiles.find((t: any) => t.name === name) as { container?: string } | undefined)?.container;
        await d.inTile("tree");
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (d.desk.pane("pty") as PtyPane | undefined)?.running === true, "the first shell runs");
        await d.press(ctrl("]"), ctrl("z"));
        expect(d.said()).toContain("pty");
        expect(d.said()).toContain("kept in a dock");
        await d.inTile("tree");
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (d.desk.pane("pty2") as PtyPane | undefined)?.running === true, "the second shell runs");
        const first = d.desk.pane("pty") as PtyPane, second = d.desk.pane("pty2") as PtyPane;
        await d.press(ctrl("]"), ctrl("z"));
        expect(d.said()).toContain("pty2");
        expect(d.said()).toContain("kept in a dock");
        // Both programs run on, in the one dock: one edge on screen, not one per terminal.
        expect(first.running && second.running).toBe(true);
        expect(containerOf("pty")).toBeTruthy();
        expect(containerOf("pty2")).toBe(containerOf("pty"));
        expect(new Set(d.desk.layoutGet().tiles.map((t: any) => t.container).filter((c: unknown) => typeof c === "string" && /^d\d+$/.test(c))).size).toBe(1);
        expect(d.desk.outOfStep()).toEqual([]);
        const spot = d.edgeOf("pty2") ?? d.edgeOf("pty");
        expect(spot).not.toBeNull();
        await d.click(spot!.x, spot!.y);
        expect(d.desk.layoutGet().tiles.some((t: any) => (t.name === "pty" || t.name === "pty2") && t.shown)).toBe(true);
      } finally { d.quit(); }
    });

    // PIE-1663: carrying a group's last tile out left only its kept dock, which spilled its terminals as tiles.
    test("a group's last tile carried out by real keys: the terminals an undo kept stay in one shut dock", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.group", tile: "replies", args: { name: "hob" } }, USER);
        await d.inTile("hob");
        await d.press(ctrl("w"), char("e"));
        const tile = d.desk.pane("hob") as any;
        expect(tile.inside).toBe(true);
        for (const name of ["pty", "pty2"]) {
          await d.press(ctrl("w"), char("o"), char("s"));
          await until(() => tile.inner.pane(name)?.running === true, `${name} runs`);
          await d.press(ctrl("]"), ctrl("z"));
          expect(d.said()).toContain("kept in a dock");
        }
        const inner = () => tile.inner.layoutGet().tiles as { name: string; container?: string; shown?: boolean }[];
        const dockOf = (name: string) => inner().find(t => t.name === name)?.container;
        expect(dockOf("pty")).toMatch(/^d\d+$/);
        expect(dockOf("pty2")).toBe(dockOf("pty"));
        await tile.inner.dispatch.act({ action: "tile.focus", tile: "replies" }, USER);
        d.paint();
        await d.press(ctrl("w"), char("a"));
        expect(inner().map(t => t.name)).not.toContain("replies");
        // The group holds only the dock now: both terminals still in it, one dock, the one that keeps work.
        const kept = dockOf("pty");
        expect(kept).toMatch(/^d\d+$/);
        expect(dockOf("pty2")).toBe(kept);
        // All the group shows is that dock, so it stands open, its newest terminal in front (a dock that is all a
        // screen shows never shuts: tile.slide refuses it).
        expect(inner().find(t => t.name === "pty2")?.shown).toBe(true);
        expect(tile.inner.outOfStep()).toEqual([]);
        expect((tile.inner.pane("pty") as PtyPane).running && (tile.inner.pane("pty2") as PtyPane).running).toBe(true);
        // Still the dock that keeps work: the next terminal an undo keeps joins it, not a dock of its own (keptInDock).
        expect(docks(tile.inner.root).filter(x => x.keeps).map(x => leaves(x.kid).length)).toEqual([2]);
      } finally { d.quit(); }
    });

    test("a shell opened inside a group in the drawer, undone twice: the door stays up", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        const dr = d.drawer();
        await dr.dispatch.act({ action: "tile.group", tile: "replies", args: { name: "hob" } }, USER);
        await dr.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        dr.stopTyping();
        d.paint();
        await d.press(ctrl("w"), char("e"));
        const tile = dr.pane("hob") as any;
        expect(tile.inside).toBe(true);
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => tile.inner.pane("pty")?.running === true, "the shell runs");
        const shell = tile.inner.pane("pty") as PtyPane;
        await d.press(ctrl("]"));
        await d.press(ctrl("z"));
        expect(d.said()).toContain("kept in a dock");
        await d.press(ctrl("z"));
        expect(d.said()).toContain("put the layout back");
        await d.press(ctrl("z"));   // the carry into the drawer: the group's tile comes home, the shell stays in its group
        expect(d.said()).toContain("put the layout back");
        expect(d.names()).toContain("replies");
        expect(dr.outOfStep()).toEqual([]);
        expect(tile.inner.outOfStep()).toEqual([]);
        expect(shell.running).toBe(true);
      } finally { d.quit(); }
    });

    /** Typing in a shell in group `tile`: its input recorded, what ^] says about each layer the test's to check. */
    async function typingIn(d: Awaited<ReturnType<typeof door>>, tile: any) {
      await d.press(ctrl("w"), char("o"), char("s"));
      await until(() => tile.inner.pane("pty")?.running === true, "the shell runs");
      const shell = tile.inner.pane("pty") as PtyPane, got: string[] = [], real = shell.input.bind(shell);
      shell.input = (s: string) => { got.push(s); real(s); };
      await d.press({ kind: "enter" } as Key);
      await d.press(char("1"));
      expect(got.join("")).toContain("1");   // it has the keys
      got.length = 0;
      return { shell, got };
    }
    const walkOut = async (d: Awaited<ReturnType<typeof door>>, tile: any, on: { shell: PtyPane; got: string[] }) => {
      await d.press(ctrl("]"));
      expect(d.said()).toContain("back to the door");
      expect(d.said()).not.toContain("out of the group");
      expect(tile.inner.programKeys().typing).toBe(false);
      expect(tile.inside).toBe(true);
      // The keys are the door's: neither a digit nor ctrl+z reaches the program.
      await d.press(char("1"));
      await d.press(ctrl("z"));
      expect(on.got).toEqual([]);
    };

    test("typing in a shell in a group: one ^] takes the keys out of the program and says so; a second soon after is the program's; then out of the group", async () => {
      const d = await door(cols, rows);
      try {
        const names = d.names();
        await d.inTile("reader"); await d.press(ctrl("w"), char(" "));
        await d.inTile("replies"); await d.press(ctrl("w"), char(" "));
        await d.press(ctrl("w"), char("G"));
        const group = d.names().find(n => !names.includes(n))!;
        await d.press(ctrl("w"), char("e"));
        const tile = d.desk.pane(group) as any, on = await typingIn(d, tile);
        await d.press(ctrl("]"));
        expect(d.said()).toContain("back to the door");
        expect(tile.inner.programKeys().typing).toBe(false);
        expect(tile.inside).toBe(true);
        await d.press(ctrl("]"));   // twice: a literal one to the program, and it has the keys again, as on a screen
        expect(on.got).toEqual(["\x1d"]);
        expect(tile.inner.programKeys().typing).toBe(true);
        expect(tile.inside).toBe(true);
        await d.press(ctrl("]"));
        expect(d.said()).toContain("back to the door");
        await Bun.sleep(1600);   // the second's moment has passed: the next is the group's
        await d.press(ctrl("]"));
        expect(d.said()).toContain("out of the group");
        expect(tile.inside).toBe(false);
      } finally { d.quit(); }
    });

    test("the same keys with no second ^]: digits and ctrl+z stay out of the program", async () => {
      const d = await door(cols, rows);
      try {
        const names = d.names();
        await d.inTile("reader"); await d.press(ctrl("w"), char(" "));
        await d.inTile("replies"); await d.press(ctrl("w"), char(" "));
        await d.press(ctrl("w"), char("G"));
        const group = d.names().find(n => !names.includes(n))!;
        await d.press(ctrl("w"), char("e"));
        const tile = d.desk.pane(group) as any;
        await walkOut(d, tile, await typingIn(d, tile));
      } finally { d.quit(); }
    });

    test("a program that exited in a group: ^] steps out of it first, then out of the group", async () => {
      const d = await door(cols, rows);
      try {
        const names = d.names();
        await d.inTile("reader"); await d.press(ctrl("w"), char(" "));
        await d.inTile("replies"); await d.press(ctrl("w"), char(" "));
        await d.press(ctrl("w"), char("G"));
        const group = d.names().find(n => !names.includes(n))!;
        await d.press(ctrl("w"), char("e"));
        const tile = d.desk.pane(group) as any, on = await typingIn(d, tile);
        on.shell.input("\x15exit\r");
        await until(() => !on.shell.running, "the shell exits");
        await d.press(ctrl("]"));
        expect(tile.inner.programKeys().exited).toBeUndefined();
        expect(tile.inside).toBe(true);
        await d.press(ctrl("]"));
        expect(d.said()).toContain("out of the group");
        expect(tile.inside).toBe(false);
      } finally { d.quit(); }
    });

    test("typing in a shell in a group in the drawer: one ^] takes the keys out of the program and says so", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        const dr = d.drawer();
        await dr.dispatch.act({ action: "tile.group", tile: "replies", args: { name: "hob" } }, USER);
        await dr.dispatch.act({ action: "tile.focus", tile: "hob" }, USER);
        dr.stopTyping();
        d.paint();
        await d.press(ctrl("w"), char("e"));
        const tile = dr.pane("hob") as any;
        expect(tile.inside).toBe(true);
        await walkOut(d, tile, await typingIn(d, tile));
        expect(d.app.drawer.entered).toBe(true);
      } finally { d.quit(); }
    });

    for (const inDrawer of [false, true]) test(`a gather holding a live shell undone ${inDrawer ? "in the drawer" : "on the screen"}: the group and its shell are one click from the screen`, async () => {
      const d = await door(cols, rows);
      try {
        if (inDrawer) { for (const t of ["reader", "replies"]) await d.desk.dispatch.act({ action: "tile.drawer", tile: t, args: { on: true } }, USER); d.paint(); }
        const host = inDrawer ? d.drawer() : d.desk;
        await host.dispatch.act({ action: "tile.group", tile: "replies", args: { with: "reader", name: "dg" } }, USER);
        await host.dispatch.act({ action: "tile.focus", tile: "dg" }, USER);
        d.paint();
        await d.press(ctrl("w"), char("e"));
        const tile = host.pane("dg") as any, inner = tile.inner as Desk;
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (inner.pane("pty") as PtyPane | undefined)?.running === true, "the shell runs");
        const shell = inner.pane("pty") as PtyPane;
        await d.press(ctrl("]"));
        await Bun.sleep(1600);
        await d.press(ctrl("z"));   // the shell's open: it stays, in its dock in the group
        await d.press(ctrl("z"));   // the gather: the group stays for what it holds
        expect(d.said()).toContain("kept in a dock");
        expect(shell.running).toBe(true);
        d.paint();
        const cell = (host.layoutGet().tiles as any[]).find(t => t.name === "dg")!;
        expect(cell.shown).toBe(false);
        const edge = () => { const id = (host as any).idNamed("dg"); const h = (host as any).presses.kind("dock").find((x: any) => x.id === id); return h ? { x: h.from, y: h.row } : null; };
        const spot = edge();
        expect(spot).not.toBeNull();
        // Where the person looks for it: on the layout it was kept on, the drawer's within the drawer.
        const box = (d.app.drawer as any).rect;
        if (inDrawer) expect(spot!.y).toBeGreaterThanOrEqual(box.row);
        await d.click(spot!.x, spot!.y);
        expect((host.layoutGet().tiles as any[]).find(t => t.name === "dg")!.shown).toBe(true);
        d.paint();
        // Its shell comes with it, running, on screen.
        expect((inner.layoutGet().tiles as any[]).find(t => t.name === "pty")!.shown).toBe(true);
        expect(shell.running).toBe(true);
      } finally { d.quit(); }
    });

    test("a shell clicked in a group in the drawer, never stepped into: ^] leaves the program, not the drawer; a second soon after is the program's; left by the group's ^], the second goes back in to the program", async () => {
      const d = await door(cols, rows);
      try {
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "reader", args: { on: true } }, USER);
        await d.desk.dispatch.act({ action: "tile.drawer", tile: "replies", args: { on: true } }, USER);
        d.paint();
        const dr = d.drawer();
        await dr.dispatch.act({ action: "tile.group", tile: "replies", args: { with: "reader", name: "dg" } }, USER);
        await dr.dispatch.act({ action: "tile.focus", tile: "dg" }, USER);
        d.paint();
        const tile = dr.pane("dg") as any, inner = tile.inner as Desk;
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => (inner.pane("pty") as PtyPane | undefined)?.running === true, "the shell runs");
        const shell = inner.pane("pty") as PtyPane, got: string[] = [], real = shell.input.bind(shell);
        shell.input = (s: string) => { got.push(s); real(s); };
        // The click: the shell has the keys and the group was never gone into.
        await inner.dispatch.press("tile.focus", {}, "pty");
        await inner.dispatch.press("tile.enter", {}, "pty");
        d.paint();
        expect(tile.inside).toBe(false);
        expect(inner.rawKeys()).toBe(true);
        expect(d.app.person().wayOut).toBe("program");
        await d.press(ctrl("]"));
        expect(d.app.drawer.entered).toBe(true);
        expect(d.said()).toContain("back to the door");
        expect(inner.rawKeys()).toBe(false);
        expect(d.app.person().wayOut).toBe("send");
        await d.press(ctrl("]"));
        expect(got).toEqual(["\x1d"]);
        expect(inner.rawKeys()).toBe(true);
        // Out of the program, its second's moment gone: the drawer is next, and right after that the second goes back in, to the program.
        await d.press(ctrl("]"));
        d.app.drawer.keysFact.chordSpent();
        expect(d.app.person().wayOut).toBe("drawer");
        got.length = 0;
        await d.press(ctrl("]"));
        expect(d.app.drawer.entered).toBe(false);
        expect(d.app.person().wayOut).toBe("drawer-send");
        await d.press(ctrl("]"));
        expect(d.app.drawer.entered).toBe(true);
        expect(got).toEqual(["\x1d"]);
        expect(inner.rawKeys()).toBe(true);
      } finally { d.quit(); }
    });

    test("a shell opened inside a group, undone twice: the door stays up and the second undo takes the next change or says there's none", async () => {
      const d = await door(cols, rows);
      try {
        const names = d.names();
        await d.inTile("reader"); await d.press(ctrl("w"), char(" "));
        await d.inTile("replies"); await d.press(ctrl("w"), char(" "));
        await d.press(ctrl("w"), char("G"));
        const group = d.names().find(n => !names.includes(n))!;
        expect(group).toBeDefined();
        await d.press(ctrl("w"), char("e"));
        const tile = d.desk.pane(group) as any;
        expect(tile.inside).toBe(true);
        await d.press(ctrl("w"), char("o"), char("s"));
        await until(() => tile.inner.pane("pty")?.running === true, "the shell runs");
        const shell = tile.inner.pane("pty") as PtyPane;
        await d.press(ctrl("]"));
        expect(d.said()).toContain("^W e G on the group");   // never ^W u: it refuses a group
        await d.press(ctrl("z"));
        expect(d.said()).toContain("kept in a dock");
        expect(shell.running).toBe(true);
        await d.press(ctrl("z"));
        // It took the gather back, and said what stays: the two tiles are the screen's again, the shell runs on in its group.
        expect(d.said()).toContain("put the layout back");
        expect(d.names()).toContain("reader");
        expect(d.names()).toContain("replies");
        expect(d.desk.outOfStep()).toEqual([]);
        expect(tile.inner.outOfStep()).toEqual([]);
        expect(shell.running).toBe(true);
        expect(() => d.desk.layoutSpec()).not.toThrow();
        await d.press(ctrl("z"));
        expect(d.said()).toMatch(/nothing to undo|no step change to undo/);
        // One click on the edge shows the group, with the same shell in it.
        const spot = d.edgeOf(group);
        expect(spot).not.toBeNull();
        await d.click(spot!.x, spot!.y);
        expect(d.desk.layoutGet().tiles.find((t: any) => t.name === group)!.shown).toBe(true);
        expect(tile.inner.pane("pty")).toBe(shell);
        expect(shell.running).toBe(true);
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
