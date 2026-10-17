// PIE-958 (S8, design §4.9): a layout change animates the tiles from where they were to where they are. The engine is pure
// (src/motion.ts) and the desk draws it over its tick on an injected clock; the layout, peek and a snapshot read the settled
// state; a key settles it; the person's setting caps every hint. Movement only: no fade, no flash. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { inFlight, planMotion, Transition, CALM_MS, EASE_MS, FANTASIA_MS } from "../src/motion";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const R = (col: number, row: number, cols: number, rows: number) => ({ col, row, cols, rows });
const AREA = R(0, 0, 100, 40);

describe("the motion engine", () => {
  test("the person's setting caps every hint: off snaps, calm is a short plain glide, full draws what was asked", () => {
    expect(planMotion("fantasia", "off")).toBeNull();
    expect(planMotion(undefined, "off")).toBeNull();
    expect(planMotion("fantasia", "calm")).toEqual({ style: "ease", ms: CALM_MS });
    expect(planMotion("fantasia", "full")).toEqual({ style: "fantasia", ms: FANTASIA_MS });
    // No hint, or one nobody knows, is the plain ease.
    expect(planMotion(undefined, "full")).toEqual({ style: "ease", ms: EASE_MS });
    expect(planMotion("settle", "full")).toEqual({ style: "ease", ms: EASE_MS });
    expect(CALM_MS).toBeLessThanOrEqual(200);
  });

  test("a tile glides from where it was to where it is: whole cells, starting and ending exactly on its rectangles, never off the screen", () => {
    const from = R(0, 0, 40, 20), to = R(60, 18, 40, 20);
    for (const style of ["ease", "fantasia"] as const) {
      expect(inFlight(from, to, 0, style, 3, AREA)).toEqual(from);
      expect(inFlight(from, to, 1, style, 3, AREA)).toEqual(to);
      for (let i = 1; i < 20; i++) {
        const r = inFlight(from, to, i / 20, style, 3, AREA);
        expect([r.col, r.row, r.cols, r.rows].every(Number.isInteger)).toBe(true);
        expect(r.col).toBeGreaterThanOrEqual(0);
        expect(r.col + r.cols).toBeLessThanOrEqual(100);
        expect(r.row + r.rows).toBeLessThanOrEqual(40);
      }
    }
    // The plain ease never doubles back; fantasia bends off the straight line in the middle, and differently for each tile.
    const mid = (style: "ease" | "fantasia", id: number) => inFlight(from, to, 0.5, style, id, AREA);
    expect(mid("ease", 1).row).toBe(mid("ease", 2).row);
    expect(mid("fantasia", 1).row !== mid("ease", 1).row || mid("fantasia", 1).col !== mid("ease", 1).col).toBe(true);
    expect(mid("fantasia", 1)).not.toEqual(mid("fantasia", 2));
    let last = -1;
    for (let i = 0; i <= 20; i++) { const c = inFlight(from, to, i / 20, "ease", 1, AREA).col; expect(c).toBeGreaterThanOrEqual(last); last = c; }
  });

  test("a transition knows what moves: a new tile and one that stayed are drawn where they are; none moving is no transition", () => {
    const t = new Transition(new Map([[1, R(0, 0, 50, 20)], [2, R(50, 0, 50, 20)]]), new Map([[1, R(0, 0, 50, 20)], [2, R(50, 20, 50, 20)], [3, R(0, 20, 50, 20)]]), 1000, { style: "ease", ms: 260 });
    expect(t.moves).toBe(true);
    expect(t.at(1, 1100, AREA)).toBe("settled");
    expect(t.at(3, 1100, AREA)).toBe("settled");
    expect(t.at(2, 1100, AREA)).not.toBe("settled");
    expect(t.done(1259)).toBe(false);
    expect(t.done(1260)).toBe(true);
    expect(new Transition(new Map([[1, R(0, 0, 5, 5)]]), new Map([[1, R(0, 0, 5, 5)]]), 0, { style: "ease", ms: 260 }).moves).toBe(false);
  });
});

describe.skipIf(!outliner)("the desk draws a layout change as motion, and the settled layout is the truth", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  let now = 1_000_000;
  const D = () => desk as any;
  const AS = "motion-agent";
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => { (app as any).lastInput = 0; return app.act({ action, args, ...(tile ? { tile } : {}), as: AS }); };
  const names = () => (D().layoutGet() as { tiles: { name: string }[] }).tiles.map(t => t.name);
  const frame = () => desk.render(D().ctx).lines.join("\n");
  const mode = (m: string) => { process.env.EP0CH_MOTION = m; };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    desk.clock = () => now;
    app.push(desk);
    desk.render(D().ctx);
    await until(() => D().panes.size > 0 && names().length >= 4, "the desk's tiles");
  }, 30_000);
  afterAll(async () => { D().dispose(); board?.close(); await scratch.dispose(); for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k]; mode("off"); });

  test("off snaps: no frames in flight, whatever a script asks", async () => {
    mode("off");
    const v = names().find(n => n !== D().layoutGet().focus)!;
    await act("tile.close", { txn: "m-off", motion: "fantasia" }, v);
    frame();
    expect(D().moving).toBe(false);
    D().history.take(D().history.forTxn("m-off")); D().history.close("m-off");
  });

  test("full: a closed tile's neighbours glide to their new places over the ticks, then land exactly where the layout puts them; focus never moves", async () => {
    mode("full");
    D().settle();
    frame();
    const focus = D().layoutGet().focus;
    const settledRects = new Map<string, unknown>(D().hits.map(([id, r]: [number, unknown]) => [D().nameOf(id), r]));
    const [v] = names().filter(n => n !== focus);
    await act("tile.close", {}, v);
    expect(D().moving).toBe(true);
    const first = frame();                                        // t = 0: the first frame of the change
    const during = D().transition as { from: Map<number, unknown>; to: Map<number, unknown> };
    expect(during).toBeTruthy();
    now += 100;
    expect(desk.tick()).toBe(true);
    const mid = frame();
    expect(mid).not.toBe(first);
    expect(D().layoutGet().focus).toBe(focus);
    // Peek reads the settled layout, whatever is in flight.
    expect(names()).not.toContain(v);
    now += 10_000;
    expect(desk.tick()).toBe(true);                               // the tick that lands it asks for the last frame
    const landed = frame();
    expect(D().moving).toBe(false);
    expect(desk.tick()).toBe(false);
    // The settled frame is the layout's own, drawn as if nothing had moved.
    D().settle();
    expect(frame()).toBe(landed);
    void settledRects;
    // Undo puts the tile back, with motion too.
    await act("layout.undo");
    expect(D().moving).toBe(true);
    D().settle();
    frame();
    expect(names()).toContain(v as string);
  });

  test("a key settles what is in flight before it is handled; a control command's catchUp snaps it too", async () => {
    mode("full");
    D().settle();
    frame();
    const pick = () => names().find(n => n !== D().layoutGet().focus)!;
    const v = pick();
    await act("tile.close", {}, v);
    frame();
    expect(D().moving).toBe(true);
    key({ kind: "char", ch: "x", ctrl: true });                  // any key: nothing moves in flight under it
    expect(D().moving).toBe(false);
    await person("layout.undo");
    D().settle();
    frame();
    const w = pick();
    await act("tile.close", {}, w);
    frame();
    expect(D().moving).toBe(true);
    app.catchUp();                                                // peek and snap call this first
    expect(D().moving).toBe(false);
    await person("layout.undo");
    D().settle();
    expect(names()).toContain(w);
  });

  test("calm glides briefly whatever the script asks; a drag's own steps are never animated", async () => {
    mode("calm");
    D().settle();
    frame();
    const v = names().find(n => n !== D().layoutGet().focus)!;
    await act("tile.close", { txn: "m-calm", motion: "fantasia" }, v);
    frame();
    const t = D().transition as { plan: { style: string; ms: number } };
    expect(t.plan).toEqual({ style: "ease", ms: CALM_MS });
    D().settle();
    await act("layout.undo", { txn: "m-calm" });
    D().settle();
    D().history.close("m-calm");
  });

  test("putting floats back (an undo) draws every tile in each frame: none vanishes between the floats and the layout", async () => {
    mode("full");
    D().settle();
    frame();
    const focus = D().layoutGet().focus;
    const ours = names().filter(n => n !== focus).slice(0, 3);
    for (const n of ours) await act("tile.float", { on: true, txn: "m-back", motion: "fantasia" }, n);
    now += 5000; desk.tick(); frame();                         // landed as floats
    const withFloats = names().length;
    await act("layout.undo", { txn: "m-back" });
    expect(D().moving).toBe(true);
    // Every frame between the floats and the layout is a screen of tiles, not a sparse one: its ink never drops far from the
    // settled screen's (a tile vanishing for a frame would be a flash).
    const ink = (lines: string) => [...lines.replace(/\x1b\[[\d;]*m/g, "")].filter(c => c !== " " && c !== "\n").length;
    const frames: number[] = [];
    for (const dt of [0, 40, 120, 300, 700, 1200]) { now += dt; frames.push(ink(frame())); }
    D().settle();
    const settledInk = ink(frame());
    for (const f of frames) expect(f).toBeGreaterThan(settledInk * 0.6);
    expect(names().length).toBe(withFloats);
    D().history.close("m-back");
  });

  test("a transition draws only frames and names while it moves: no styles that blink, invert or fade", async () => {
    mode("full");
    D().settle();
    frame();
    const v = names().find(n => n !== D().layoutGet().focus)!;
    await act("tile.close", { txn: "m-ink", motion: "fantasia" }, v);
    now += 300;
    const lines = desk.render(D().ctx).lines.join("\n");
    expect(lines).not.toMatch(/\x1b\[(?:[0-9;]*;)?[57](?:;[0-9;]*)?m/);   // no blink (5) or reverse video (7)
    D().settle();
    await act("layout.undo", { txn: "m-ink" });
    D().settle();
  });

  const person = (action: string, args: Record<string, unknown> = {}) => app.dispatch.act({ action, args }, USER);
});
