// PIE-642 and PIE-925: the tile menu folds a tile; a click on a spine
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
  const clickFold = async (name: string) => {
    await mine("tile.menu", {}, name);
    const lines = render().lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ""));
    const y = lines.findIndex(l => l.includes("fold to a spine"));
    expect(y).toBeGreaterThan(-1);
    click(lines[y]!.indexOf("fold to a spine"), y);
  };
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

  test("the tile menu folds a tile; clicking the spine opens a readable share", async () => {
    const side = names().find(n => D().foldDirOf([...D().names].find(([, x]: [number, string]) => x === n)![0]) === "v")!;
    const before = rect(side);
    await clickFold(side);
    expect(tile(side).collapsed).toBe(true);
    expect(rect(side).cols).toBe(3);
    click(rect(side).col + 1, rect(side).row + 3);
    expect(tile(side).collapsed).toBeUndefined();
    expect(rect(side).cols).toBeGreaterThanOrEqual(40);
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
    expect(await act("tile.collapse", { dir: "h" }, stacked)).toMatchObject({ name: stacked, collapsed: true, dir: "h" });
    expect(tile(stacked)).toMatchObject({ collapsed: true, collapsedBy: AS, collapsedDir: "h" });
    expect(get().focus).toBe(focus);
    expect(await act("tile.expand", {}, stacked)).toMatchObject({ name: stacked, collapsed: false });
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
