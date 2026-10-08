// PIE-642: collapse any tile to a spine with one click. A dim glyph on the frame (◂ for a tile side by side with
// others, ▾ for a stacked one) folds it; alt+click folds it to a horizontal spine (one row), a click on a spine
// opens it at the size it had; alt+h and alt+H are the keys; tile.collapse dir=v|h and tile.expand are the actions
// an agent calls, which never fold the tile the person has. The fold is layout state: it saves and comes back.
// Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const alt = (ch: string): Key => ({ kind: "alt", ch });

describe.skipIf(!outliner)("tile spines: one click folds a tile, a click on the spine opens it", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "spine-agent-642";
  const D = () => desk as any;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { focus: string; tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const rect = (name: string) => { render(); return tile(name).rect as { col: number; row: number; cols: number; rows: number }; };
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const click = (x: number, y: number, mods?: number) => { key({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); key({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); render(); };
  /** The fold glyph drawn on tile `name`'s frame. */
  const glyph = (name: string) => { render(); const id = [...D().names].find(([, n]: [number, string]) => n === name)![0]; return D().foldButtons.find((b: any) => b.id === id) as { from: number; row: number } | undefined; };
  const clickGlyph = (name: string, mods?: number) => { const g = glyph(name)!; click(g.from, g.row, mods); };
  const names = () => get().tiles.map((t: any) => t.name);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EDITOR = "true";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    render();
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EDITOR"]) delete process.env[k];
  });

  test("every tile that can fold wears a glyph: ◂ side by side, ▾ stacked; a click folds it to the spine its split allows, a click on the spine opens it at its size", () => {
    const [a, b] = names().filter(n => glyph(n));
    expect(a).toBeDefined();
    expect(names().filter(n => glyph(n)).length).toBeGreaterThan(2);
    const side = names().find(n => glyph(n) && D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "v")!;
    const before = rect(side);
    clickGlyph(side);
    expect(tile(side).collapsed).toBe(true);
    expect(tile(side).collapsedDir).toBeUndefined();
    expect(rect(side).cols).toBe(3);
    // Its neighbours took the room; a click on the spine opens it where it was, at the size it had.
    click(rect(side).col + 1, rect(side).row + 3);
    expect(tile(side).collapsed).toBeUndefined();
    expect(rect(side)).toEqual(before);
    expect(b).toBeDefined();
  });

  test("alt+click folds to a horizontal spine: one row with the title, its height to its neighbour; where nothing is stacked it says why", () => {
    const stacked = names().find(n => glyph(n) && D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "h")!;
    const before = rect(stacked);
    clickGlyph(stacked, 8);
    expect(tile(stacked)).toMatchObject({ collapsed: true, collapsedDir: "h" });
    expect(rect(stacked).rows).toBe(1);
    expect(rect(stacked).cols).toBe(before.cols);
    click(rect(stacked).col + 2, rect(stacked).row);
    expect(tile(stacked).collapsed).toBeUndefined();
    expect(rect(stacked)).toEqual(before);
    const side = names().find(n => glyph(n) && D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "v")!;
    clickGlyph(side, 8);
    expect(tile(side).collapsed).toBeUndefined();
    expect((app as any).message).toMatch(/isn't stacked with other tiles/);
  });

  test("keys: alt+h folds the focused tile and opens it again, alt+H folds it to a horizontal spine", () => {
    const side = names().find(n => D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "v")!;
    void mine("tile.focus", {}, side);
    key(alt("h"));
    expect(tile(side).collapsed).toBe(true);
    key(alt("h"));
    expect(tile(side).collapsed).toBeUndefined();
    const stacked = names().find(n => D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "h")!;
    void mine("tile.focus", {}, stacked);
    key(alt("H"));
    expect(tile(stacked)).toMatchObject({ collapsed: true, collapsedDir: "h" });
    key(alt("H"));
    expect(tile(stacked).collapsed).toBeUndefined();
  });

  test("act: tile.collapse dir=h|v and tile.expand; an agent's never folds the tile the person has, and never moves their keys", async () => {
    await mine("tile.focus", {}, names().find(n => D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "v")!);
    const stacked = names().find(n => D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "h")!;
    const other = names().find(n => n !== stacked && n !== get().focus)!;
    const focus = get().focus;
    await expect(act("tile.collapse", { dir: "x" }, other)).rejects.toThrow(/dir is v/);
    await expect(act("tile.collapse", { dir: "v" }, stacked)).rejects.toThrow(/isn't side by side/);
    await expect(act("tile.collapse", { on: true }, focus)).rejects.toThrow(/has the person's keys/);
    expect(stacked).not.toBe(focus);
    expect(await act("tile.collapse", { dir: "h" }, stacked)).toMatchObject({ tile: stacked, collapsed: true, dir: "h" });
    expect(tile(stacked)).toMatchObject({ collapsed: true, collapsedBy: AS, collapsedDir: "h" });
    expect(get().focus).toBe(focus);
    expect(await act("tile.expand", {}, stacked)).toMatchObject({ tile: stacked, collapsed: false });
    expect(tile(stacked).collapsed).toBeUndefined();
  });

  test("the fold is layout state: it saves with desk.json, comes back after a restart, and a tile dropped onto a spine opens it", async () => {
    const stacked = names().find(n => n !== get().focus && D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "h")!;
    await mine("tile.collapse", { dir: "h" }, stacked);
    const saved = JSON.parse(readFileSync(join(scratch.root, "door", "desk.json"), "utf8"));
    expect(JSON.stringify(saved)).toContain(`"collapsed":"h"`);
    const again = new Desk() as any;
    again.render(D().ctx);
    const was = again.layoutGet().tiles.find((t: any) => t.name === stacked);
    expect(was).toMatchObject({ collapsed: true, collapsedDir: "h" });
    again.dispose();
    // Dropped onto: the spine opens, then the tile lands beside it.
    const mover = names().find(n => n !== stacked && n !== get().focus)!;
    await mine("layout.move", { to: stacked, where: "tabs" }, mover);
    expect(tile(stacked).collapsed).toBeUndefined();
  });
});
