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
import { prop } from "../src/props";

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
  const tile = (name: string) => get().tiles.find((t: any) => (t.name === name || t.tile === name));
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
    const r = await act("tile.open", { kind: "screen", screen: "board", target: seeded.notes.hub.id, name: "kanban" }, get().focus);
    expect(r).toMatchObject({ name: "kanban", kind: "screen" });
    render();
    await until(() => { render(); return (tile("kanban")?.mount?.layout?.tiles ?? []).filter((t: any) => t.kind === "query").length === 4; }, "the mounted board's lanes", 8000);
    expect(tile("kanban")).toMatchObject({ tile: r.tile, mount: { screen: "board", args: { hub: seeded.notes.hub.id }, group: false } });
    // The title names the hub once the hub is read, which can come after its lanes are laid out.
    await until(() => { render(); return /^board · /.test(tile("kanban")?.title ?? ""); }, "the mount's title naming its hub", 8000);
    expect(get().focus).not.toBe("kanban");                    // an agent's mount never takes the person's keys
    expect(existsSync(join(state(), "delivery.json"))).toBe(false);
    // Refusals say what to do: no such screen, no such part, the desk in itself.
    await expect(act("tile.open", { kind: "screen", screen: "nope" }, get().focus)).rejects.toThrow(/no screen nope; screens:/);
    await expect(act("tile.open", { kind: "screen", screen: "board", part: "nope" }, get().focus)).rejects.toThrow(/has no part nope; its parts:/);
    await expect(act("tile.open", { kind: "screen", screen: "desk" }, get().focus)).rejects.toThrow(/isn't mounted in itself/);
  }, 20_000);

  test("a mounted reader is reached by name and path", async () => {
    await act("tile.open", { kind: "reader", name: "inside-898" }, get().focus);
    await act("tile.open", { kind: "reader", name: "beside-898" }, get().focus);
    const g = await act("tile.group", { with: "beside-898" }, "inside-898");
    render();
    const focus = get().focus;
    for (const selector of ["beside-898", `${g.tile}/beside-898`]) {
      await act("open", { id: seeded.cards[0]!.id }, selector);
      const view = await act("view.get", {}, selector);
      expect(JSON.stringify(view)).toContain(seeded.cards[0]!.id);
    }
    expect(get().focus).toBe(focus);
    const lane = tile("kanban").mount.layout.tiles.find((t: any) => t.kind === "query").name;
    expect(await act("card.select", { id: seeded.cards[0]!.id }, lane)).toBeDefined();
    // Two mounted boards expose the same name: the refusal gives paths instead of choosing one.
    await act("tile.open", { kind: "screen", screen: "board", target: seeded.notes.hub.id, name: "second-898" }, focus);
    render();
    await expect(act("view.get", {}, "preview")).rejects.toThrow(/several tiles named preview: .*\//);
    expect(await act("view.get", {}, "kanban/preview")).toBeDefined();
    await act("tile.close", {}, "second-898");
    const local = await act("tile.open", { kind: "reader", name: "preview" }, focus);
    await expect(act("view.get", {}, "preview")).rejects.toThrow(/several tiles named preview/);
    expect(await act("view.get", {}, local.tile)).toBeDefined();
    await act("tile.close", {}, local.tile);
    await act("tile.group", { on: false }, g.tile);
  });

  test("a proposal id needs no reader, without changing the layout", async () => {
    const previous = desk;
    desk = new Desk({ name: "empty-898", title: "empty", layout: { root: { t: "leaf", kind: "tree", name: "outline" } } });
    app.push(desk);
    render();
    const focus = get().focus;
    const before = get().tiles.map(t => t.id);
    for (const op of ["dismiss", "apply"]) {
      const note = await board.request<any>("create", { parentId: null, text: "Seed plan\nPlant beans." });
      const proposal = await board.request<any>("draft.patch", { blockId: note.id, revision: note.revision,
        patches: [{ observed: "Plant beans.", replacement: "Plant peas." }], propose: true,
        mutation: { author: "agent", actorId: AS } });
      await expect(act(`proposal.${op}`, { id: proposal.proposalId }, "missing-898")).rejects.toThrow("no tile missing-898");
      expect(prop((await board.get(proposal.proposalId))!, "proposal-status")).toBe("open");
      expect(await act(`proposal.${op}`, { id: proposal.proposalId })).toMatchObject({ outcome: op === "apply" ? "applied" : "dismissed" });
      expect(prop((await board.get(proposal.proposalId))!, "proposal-status")).toBe(op === "apply" ? "applied" : "dismissed");
      expect(get().focus).toBe(focus);
    }
    expect(get().tiles.map(t => t.id)).toEqual(before);
    app.pop();
    desk = previous;
  });

  test("its saved arrangement restores a fold inside a second mount, with a distinct tile id", async () => {
    expect(await act("tile.collapse", { on: true }, "kanban/preview")).toMatchObject({ name: "preview", collapsed: true });
    const id = tile("kanban").tile;
    D().save();
    const saved = JSON.parse(readFileSync(join(state(), "desk.json"), "utf8"));
    expect(JSON.stringify(saved)).toContain('"screen":"board"');
    // The session's restart, as a new daemon does it: the desk again from desk.json.
    const again = new Desk() as any;
    app.push(again);
    again.render(again.ctx);
    const t = () => again.layoutGet().tiles.find((x: any) => x.name === "kanban");
    expect(t()).toMatchObject({ kind: "screen", mount: { screen: "board" } });
    expect(t().tile).not.toBe(id);
    expect(t().mount.layout.tiles.find((x: any) => x.name === "preview").collapsed).toBe(true);
    app.pop();
    await act("tile.expand", {}, "kanban/preview");
  }, 20_000);

  test("a part (the lanes alone): filled from the hub, the place holder gone; its opens land where the mount's do, on the desk", async () => {
    const r = await act("tile.open", { kind: "screen", screen: "board", target: seeded.notes.hub.id, part: "lanes", name: "rows" }, "kanban", );
    expect(r.name).toBe("rows");
    await until(() => { render(); const ts = tile("rows")?.mount?.layout?.tiles ?? []; return ts.length === 4 && ts.every((t: any) => t.kind === "query"); }, "the lanes alone, filled", 8000);
    expect(tile("rows").mount).toMatchObject({ part: "lanes" });
    const lane = tile("rows").mount.layout.tiles[0].id;
    const card = seeded.cards[0]!;
    const out = await act("open", { id: card.id, from: lane }, "rows/");
    expect(out.name).toBeTruthy();
    expect(get().tiles.find((t: any) => t.name === out.name)?.showing?.id).toBe(card.id);
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
    // A locked desk refuses it before the full screen goes: the person stays on the board.
    await D().dispatch.act({ action: "layout.lock", tile: r.tile, args: { on: true } }, { kind: "user" });
    const locked = openScreen("board", { hub: seeded.notes.hub.id }) as any;
    app.push(locked);
    locked.render(locked.ctx);
    expect(await locked.dispatch.press("screen.mount", {})).toBeUndefined();
    expect((app as any).stack.at(-1)).toBe(locked);
    app.pop();
    await D().dispatch.act({ action: "layout.lock", tile: r.tile, args: { on: false } }, { kind: "user" });
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
    await expect(D().dispatch.act({ action: "screen.mount", tile: p.tile, args: {} }, { kind: "user" })).rejects.toThrow(/this is the desk/);
  }, 30_000);

  test("a group: a terminal and a reader gathered into one tile come back out whole, the program still running; an agent never gathers the person's tile", async () => {
    const t = await act("tile.open", { kind: "pty", cmd: "sh", name: "shell" }, get().focus);
    await until(() => { render(); return !!tile("shell")?.terminal?.running; }, "the shell");
    const pty = D().pane("shell");
    const focus = get().focus;
    await expect(act("tile.group", { with: "shell" }, focus)).rejects.toThrow(/has the person's keys/);
    // The group needs a reader to take the open below: its own, not the focused one (the person's keys) and not the
    // desk's side tiles (the replies are a backlinks tile since the links model).
    await act("tile.open", { kind: "reader", name: "grouped-reader" }, focus);
    const others = ["grouped-reader"];
    const g = await act("tile.group", { with: "shell", where: "down" }, others[0]);
    expect(g.grouped).toEqual([others[0], "shell"]);
    render();
    expect(tile(g.tile)).toMatchObject({ kind: "screen", mount: { group: true, layout: { tree: { split: "col" } } } });
    expect(tile("shell")).toBeUndefined();
    expect(await act("tile.type", { text: "true" }, `${g.tile}/shell`)).toMatchObject({ name: "shell" });
    // The person's open naming no tile, their keys on the group (/ and the power bar there): its reader takes it, never
    // "the screen has no reader tile" for the desk around it.
    await mine("tile.focus", {}, g.tile);
    const o = await mine("open", { id: seeded.cards[1]!.id });
    expect(o.tile).toMatch(/^t-/);
    expect((await act("tile.info", {}, o.tile)).showing.id).toBe(seeded.cards[1]!.id);
    await mine("tile.focus", {}, focus);                         // the keys back where they were: an agent never spills the person's tile
    // What its layout says of a tile in it comes back out with it (an agent's limit, tightened by an agent).
    await act("tile.agent", { policy: "edit" }, `${g.tile}/${others[0]}`);
    const s = await act("tile.group", { on: false }, g.tile);
    expect(s.spilled.sort()).toEqual([others[0], "shell"].sort());
    render();
    expect(D().pane("shell")).toBe(pty);
    expect(tile("shell").terminal.running).toBe(true);
    expect(tile(others[0]!).agents).toBe("edit");
    void t;
  }, 20_000);
});

// PIE-1283 and PIE-1305: a mounted screen acts and looks like one screen with the one around it. The person's click
// addresses the tile it landed on by its id (a name two layers share is only an agent's refusal), a mount is named for the
// screen it mounts, a rename changes the name and the title together, and a mount draws a header with no second box,
// no hint row of its own and no status line.
describe.skipIf(!outliner)("a mounted screen is one screen with the one around it", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  const AS = "mount-agent-1305";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, tile, as: AS }) as Promise<any>;
  const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  const frame = () => desk.render(D().ctx).lines.map(plain);
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { frame(); await new Promise(r => setTimeout(r, 80)); } };
  const focusId = () => D().layoutGet().tiles.find((x: any) => x.name === D().layoutGet().focus).tile as string;
  const mountPane = (name: string) => { const id = [...D().names].find(([, n]: [number, string]) => n === name)?.[0]; return { id: id as number, pane: D().panes.get(id) }; };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await scratch.seedShowcase();
    const term = { info: { cols: 242, rows: 68, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    frame();
  }, 30_000);
  afterAll(async () => { D().dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a mount of a screen is named for it, and a second one is numbered", async () => {
    const a = await act("tile.open", { kind: "screen", screen: "who" }, focusId());
    expect(a.name).toBe("who");
    const b = await act("tile.open", { kind: "screen", screen: "who" }, focusId());
    expect(b.name).toBe("who2");
    const c = await act("tile.open", { kind: "screen", screen: "lastcall", part: undefined }, focusId());
    expect(c.name).toBe("lastcall");
    await act("tile.close", {}, b.tile);
    await act("tile.close", {}, a.tile);
    await act("tile.close", {}, c.tile);
  }, 20_000);

  test("the person's click on a tile whose name another layer shares opens that tile's menu", async () => {
    // The desk has a reader; the last callers' screen has one too.
    expect(D().layoutGet().tiles.some((t: any) => t.name === "reader")).toBe(true);
    const m = await act("tile.open", { kind: "screen", screen: "lastcall" }, focusId());
    await D().dispatch.press("tile.focus", {}, m.tile);
    await act("tile.zoom", { on: true }, m.tile);             // wide enough to draw the tile's ⋯
    await settle();
    const { id, pane } = mountPane(m.name);
    const inner = pane.inner as any, box = D().contents.get(id);
    expect([...inner.names.values()]).toContain("reader");
    const b = inner.menuButtons.find((x: any) => inner.names.get(x.id) === "reader");
    expect(b).toBeDefined();
    D().key({ kind: "mouse", action: "down", button: 0, x: box.col + b.from, y: box.row + b.row }, D().ctx);
    await settle();
    expect(D().ctx.refusal?.() ?? null).toBeNull();
    expect(inner.overlays.top()).toBeTruthy();
    inner.overlays.top()?.key?.({ kind: "esc" }, inner);
    await D().dispatch.press("tile.zoom", { on: false }, m.tile);
    await D().dispatch.press("tile.close", {}, m.tile);
  }, 20_000);

  test("renaming a tile inside a mount is one rename: its name, its path and the title it shows; a taken name is refused", async () => {
    const m = await act("tile.open", { kind: "screen", screen: "lastcall" }, focusId());
    await D().dispatch.press("tile.focus", {}, m.tile);
    await act("tile.zoom", { on: true }, m.tile);
    await settle();
    const inner = mountPane(m.name).pane.inner as any;
    // The tile by its path through the mount's id: the desk around it has a reader too.
    const r = await act("tile.title", { text: "yo" }, `${m.tile}/reader`);
    expect(r).toMatchObject({ name: "yo", title: "yo" });
    await settle();
    expect(D().pathTo(inner.paneNamed("yo"))).toBe("lastcall/yo");
    expect(inner.paneNamed("reader")).toBeUndefined();
    expect(await act("tile.info", {}, "lastcall/yo")).toMatchObject({ name: "yo" });
    expect(frame().some(l => /\byo\b/.test(l))).toBe(true);
    await expect(act("tile.title", { text: "yo" }, "lastcall/activity")).rejects.toThrow(/already a tile named yo/);
    // The screen's own name for a tile stays that tile's: reader is the role of the tile now called yo.
    await expect(act("tile.title", { text: "reader" }, "lastcall/activity")).rejects.toThrow(/already a tile named reader here/);
    // A title with spaces is written on the tile and leaves the name alone.
    expect(await act("tile.title", { text: "Who called" }, "lastcall/activity")).toMatchObject({ name: "activity", writtenTitle: "Who called" });
    await D().dispatch.press("tile.zoom", { on: false }, m.tile);
    await D().dispatch.press("tile.close", {}, m.tile);
  }, 20_000);

  /** The rectangle of tile `id` of `d` on the screen: its desk's own origin (the mount holding it) added. */
  const onScreen = (d: any, id: number, origin = { col: 0, row: 0 }) => { const r = d.placed.rects.get(id); return { col: r.col + origin.col, row: r.row + origin.row, cols: r.cols, rows: r.rows }; };
  const VERTICAL = /[│║┃|]/;

  test("two levels of nested mounts draw one hint row and no mount draws a second box", async () => {
    const a = await act("tile.open", { kind: "screen", screen: "lastcall" }, focusId());
    await settle();
    const outer = mountPane(a.name);
    const inner = outer.pane.inner as any;
    const b = await act("tile.open", { kind: "screen", screen: "who" }, `${a.tile}/activity`);
    await settle(6);
    const nested = [...inner.panes].find(([, p]: [number, any]) => p.kind === "screen");
    expect(nested).toBeDefined();
    const lines = frame();
    if (process.env.DUMP_FRAME) console.log(lines.join("\n"));
    // One hint row for the whole door: the outermost screen's.
    expect(lines.filter(l => l.includes("Tab/1-9 focus"))).toHaveLength(1);
    expect(lines.at(-1)).toContain("Tab/1-9 focus");
    // A mount's frame is its header: where it meets the tiles inside it there are never two vertical borders side by side.
    const rects = [onScreen(D(), outer.id), onScreen(inner, nested![0], D().contents.get(outer.id))];
    for (const r of rects) {
      for (let y = r.row + 1; y < r.row + r.rows - 1; y++) {
        const row = [...lines[y]!];
        expect(VERTICAL.test(row[r.col]!) && VERTICAL.test(row[r.col + 1]!), `row ${y} left edge of the mount at ${r.col}: ${lines[y]!.slice(r.col, r.col + 4)}`).toBe(false);
        const right = r.col + r.cols - 1;
        expect(VERTICAL.test(row[right]!) && VERTICAL.test(row[right - 1]!), `row ${y} right edge of the mount at ${right}`).toBe(false);
      }
    }
    await act("tile.close", {}, b.tile);
    await act("tile.close", {}, a.tile);
  }, 30_000);
});
