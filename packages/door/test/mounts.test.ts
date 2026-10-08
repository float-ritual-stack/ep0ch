// PIE-651: a screen mounted in another, against a scratch outline. `tile.open kind=screen` mounts the board (its own
// spec, live) or a part of it on the desk; the mount's layout is its own, saved with the desk's and back after a
// restart, never written to the full board's file; a part's opens land where the mount's do; `screen.mount` on a full
// screen puts it on the desk; tiles gathered into a group come back out whole, a running program and all. Scratch
// services and the showcase's fictional seed only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { partSpec, screenParts } from "../src/desk/screen-spec";
import { boardSpec } from "../src/desk/delivery";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import type { Seeded } from "../src/showcase/seed";
import { outliner, Scratch, until } from "./scratch";

describe("a part of a screen (partSpec)", () => {
  test("the board's lanes alone: that container, a place holder until its source fills it, and nothing the spec names outside it", () => {
    const s = partSpec(boardSpec({ hub: "h1" }), "lanes");
    expect(s.layout.root).toMatchObject({ t: "columns", key: "lanes", source: "hub:h1", kids: [{ t: "leaf", kind: "filling" }] });
    expect(s.saves).toBeUndefined();
    expect(s.lands).toBeUndefined();
    expect(s.home).toBe("lanes");
    expect(s.layout.policy?.opensInto).toBeUndefined();
    // Its keys that name a tile outside the part are gone (t slides the outline); the lanes' own stay.
    expect(s.keys!.map(k => k.key)).not.toContain("t");
    expect(s.keys!.map(k => k.key)).toContain("{");
    expect(() => partSpec(boardSpec(), "nope")).toThrow(/no part nope; its parts: outline, board, lanes, readers, links/);
    expect(screenParts(boardSpec())).toEqual(expect.arrayContaining(["lanes", "readers", "preview", "tree"]));
  });
});

describe.skipIf(!outliner)("mounts on the desk, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, seeded: Seeded;
  let key: (k: Key) => void = () => {};
  const AS = "mount-agent-651";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, tile, as: AS }) as Promise<any>;
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.press(action, args, tile) as Promise<any>;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; rev: number };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const state = () => join(scratch.root, "door");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    seeded = await scratch.seedShowcase();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    render();
  }, 30_000);
  afterAll(async () => { D().dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("tile.open kind=screen mounts the board on its hub, live: its own tiles, its title, layout.get under the mount's id; nothing written to the full board's file", async () => {
    const r = await act("tile.open", { kind: "screen", screen: "board", target: seeded.notes.hub.id, name: "kanban" }, "reader");
    expect(r).toMatchObject({ tile: "kanban", kind: "screen" });
    render();
    await until(() => { render(); return (tile("kanban")?.mount?.layout?.tiles ?? []).filter((t: any) => t.kind === "query").length === 4; }, "the mounted board's lanes", 8000);
    expect(tile("kanban")).toMatchObject({ id: r.id, mount: { screen: "board", args: { hub: seeded.notes.hub.id }, group: false } });
    expect(tile("kanban").title).toMatch(/^board · /);
    expect(get().focus).not.toBe("kanban");                    // an agent's mount never takes the person's keys
    expect(existsSync(join(state(), "delivery.json"))).toBe(false);
    // Refusals say what to do: no such screen, no such part, the desk in itself.
    await expect(act("tile.open", { kind: "screen", screen: "nope" }, "reader")).rejects.toThrow(/no screen nope; screens:/);
    await expect(act("tile.open", { kind: "screen", screen: "board", part: "nope" }, "reader")).rejects.toThrow(/has no part nope; its parts:/);
    await expect(act("tile.open", { kind: "screen", screen: "desk" }, "reader")).rejects.toThrow(/isn't mounted in itself/);
  }, 20_000);

  test("its layout is its own, saved with the desk's: a fold inside it comes back after a restart, under the same mount id", async () => {
    expect(await act("tile.collapse", { on: true }, "kanban/preview")).toMatchObject({ tile: "kanban/preview", collapsed: true });
    const id = tile("kanban").id;
    D().save();
    const saved = JSON.parse(readFileSync(join(state(), "desk.json"), "utf8"));
    expect(JSON.stringify(saved)).toContain('"screen":"board"');
    // The session's restart, as a new daemon does it: the desk again from desk.json.
    const again = new Desk() as any;
    app.push(again);
    again.render(again.ctx);
    const t = () => again.layoutGet().tiles.find((x: any) => x.name === "kanban");
    expect(t()).toMatchObject({ id, kind: "screen", mount: { screen: "board" } });
    expect(t().mount.layout.tiles.find((x: any) => x.name === "preview").collapsed).toBe(true);
    app.pop();
    await act("tile.expand", {}, "kanban/preview");
  }, 20_000);

  test("a part (the lanes alone): filled from the hub, the place holder gone; its opens land where the mount's do, on the desk", async () => {
    const r = await act("tile.open", { kind: "screen", screen: "board", target: seeded.notes.hub.id, part: "lanes", name: "rows" }, "kanban", );
    expect(r.tile).toBe("rows");
    await until(() => { render(); const ts = tile("rows")?.mount?.layout?.tiles ?? []; return ts.length === 4 && ts.every((t: any) => t.kind === "query"); }, "the lanes alone, filled", 8000);
    expect(tile("rows").mount).toMatchObject({ part: "lanes" });
    const lane = tile("rows").mount.layout.tiles[0].name;
    const card = seeded.cards[0]!;
    const out = await act("open", { id: card.id, from: lane }, "rows/");
    expect(out.reader).toBeTruthy();
    expect(get().tiles.find((t: any) => t.name === out.reader)?.showing?.id).toBe(card.id);
  }, 20_000);

  test("screen.mount on the full board puts it on the desk with its arrangement; a part by the tile menu's container", async () => {
    app.pop();                                                   // off the desk, to the menu
    const full = openScreen("board", { hub: seeded.notes.hub.id }) as any;
    app.push(full);
    full.render(full.ctx);
    await until(() => { full.render(full.ctx); return full.layoutGet().tiles.some((t: any) => t.kind === "query"); }, "the full board", 8000);
    const r = await full.dispatch.press("screen.mount", {});
    expect(r).toMatchObject({ screen: "board", kind: "screen" });
    const top = (app as any).stack.at(-1);
    expect(top.spec.name).toBe("desk");
    desk = top;
    expect(tile(r.tile)).toMatchObject({ mount: { screen: "board", args: { hub: seeded.notes.hub.id } } });
    // The tile menu offers the part around a tile (the lanes around a lane): screen.part.
    const back = openScreen("board", { hub: seeded.notes.hub.id }) as any;
    app.push(back);
    back.render(back.ctx);
    await until(() => { back.render(back.ctx); return back.layoutGet().tiles.some((t: any) => t.kind === "query"); }, "the board again", 8000);
    const lane = back.layoutGet().tiles.find((t: any) => t.kind === "query").name;
    expect(back.partAround(lane)).toBe("lanes");
    const p = await back.dispatch.press("screen.part", {}, lane);
    expect(p).toMatchObject({ screen: "board", part: "lanes" });
    desk = (app as any).stack.at(-1);
    expect(tile(p.tile).mount).toMatchObject({ part: "lanes" });
    // On the desk itself it says how to mount one instead.
    await expect(D().dispatch.act({ action: "screen.mount", args: {} }, { kind: "user" })).rejects.toThrow(/this is the desk/);
  }, 30_000);

  test("a group: a terminal and a reader gathered into one tile come back out whole, the program still running; an agent never gathers the person's tile", async () => {
    const t = await act("tile.open", { kind: "pty", cmd: "sh", name: "shell" }, "reader");
    await until(() => { render(); return !!tile("shell")?.terminal?.running; }, "the shell");
    const pty = D().pane("shell");
    const focus = get().focus;
    await expect(act("tile.group", { with: "shell" }, focus)).rejects.toThrow(/has the person's keys/);
    const others = get().tiles.filter((x: any) => x.name !== focus && x.name !== "shell" && x.kind !== "screen" && !x.float).map((x: any) => x.name);
    const g = await act("tile.group", { with: "shell", where: "down" }, others[0]);
    expect(g.grouped).toEqual([others[0], "shell"]);
    render();
    expect(tile(g.tile)).toMatchObject({ kind: "screen", mount: { group: true, layout: { tree: { split: "col" } } } });
    expect(tile("shell")).toBeUndefined();
    expect(await act("tile.type", { text: "true" }, `${g.tile}/shell`)).toMatchObject({ tile: `${g.tile}/shell` });
    const s = await act("tile.group", { on: false }, g.tile);
    expect(s.spilled.sort()).toEqual([others[0], "shell"].sort());
    render();
    expect(D().pane("shell")).toBe(pty);
    expect(tile("shell").terminal.running).toBe(true);
    void t;
  }, 20_000);
});
