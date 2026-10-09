// PIE-696: gathering tiles into a group by mouse and keys, against a scratch outline. A tile goes into a group and out of
// it whole (layout.move into= / out=true, a drag by its title), tiles are picked (tile.select, shift+click) and gathered
// together, ^W G in a split offers this tile or the whole split, and a link between a tile and one in a group survives
// the gathering, the spill, the moves and a restart. Scratch services and the showcase's fictional seed only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { TILE_ACTIONS } from "../src/desk/tile-actions";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import type { Seeded } from "../src/showcase/seed";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("gathering tiles into a group, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, seeded: Seeded;
  let key: (k: Key) => void = () => {};
  const AS = "gather-agent-696";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, as = AS) => app.act({ action, args, tile, as }) as Promise<any>;
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.press(action, args, tile) as Promise<any>;
  const me = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; rev: number };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const names = () => get().tiles.map((t: any) => t.name);

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
    await mine("tile.focus", {}, "tree");                    // the person's keys stay here: an agent's moves leave them
  }, 30_000);
  afterAll(async () => { D().dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const showing = (name: string) => tile(name)?.showing?.id ?? null;
  const inner = (g: string, name: string) => tile(g).mount.layout.tiles.find((t: any) => t.name === name);

  test("a tile goes into a group and back out whole: the program keeps running, its policy and spine travel with it", async () => {
    await act("tile.open", { kind: "pty", cmd: "sh", name: "shell" }, "activity");
    await until(() => { render(); return !!tile("shell")?.terminal?.running; }, "the shell");
    const pty = D().pane("shell");
    await act("tile.agent", { policy: "edit" }, "shell");
    const g = await act("tile.group", { with: "thread", where: "down" }, "activity");
    expect(g.grouped).toEqual(["activity", "thread"]);
    render();
    // Into the group: beside its activity tile, to the right.
    const r = await me("layout.move", { into: g.tile, beside: "activity", where: "right" }, "shell");
    expect(r).toMatchObject({ tile: "shell", into: g.tile });
    render();
    expect(tile("shell")).toBeUndefined();
    expect(inner(g.tile, "shell")).toMatchObject({ kind: "pty", agents: "edit" });
    expect(D().pane(g.tile).inner.pane("shell")).toBe(pty);
    expect(inner(g.tile, "shell").terminal.running).toBe(true);
    expect(get().focus).toBe("tree");
    // Out again, beside the group.
    const o = await me("layout.move", { out: true, where: "down" }, `${g.tile}/shell`);
    expect(o).toMatchObject({ out: true });
    render();
    expect(tile("shell")).toMatchObject({ agents: "edit" });
    expect(D().pane("shell")).toBe(pty);
    expect(inner(g.tile, "shell")).toBeUndefined();
    // Refusals say what to do.
    await expect(me("layout.move", { into: "tree" }, "shell")).rejects.toThrow(/isn't a group/);
    await expect(me("layout.move", { out: true }, "shell")).rejects.toThrow(/isn't inside a group/);
    await expect(me("layout.move", { into: g.tile, out: true }, "shell")).rejects.toThrow(/not both/);
    // The last tile out spills the group.
    await me("layout.move", { into: g.tile, beside: "activity" }, "shell");
    await me("layout.move", { out: true }, `${g.tile}/shell`);
    await act("tile.group", { on: false }, g.tile);
    render();
    expect(names()).toEqual(expect.arrayContaining(["tree", "reader", "thread", "activity", "shell"]));
    expect(D().pane("shell")).toBe(pty);
    await me("tile.close", {}, "shell").catch(() => {});
    await me("tile.close", {}, "shell");
  }, 30_000);

  const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods = 0) => { key({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) } as Key); render(); };
  const drag = (from: [number, number], to: [number, number]) => { mouse("down", ...from); mouse("drag", from[0] + 1, from[1]); mouse("drag", ...to); mouse("up", ...to); };
  /** A tile of the group's screen on the whole screen: its content starts a cell in from the group's frame. */
  const innerAt = (g: string, name: string) => { const o = tile(g).rect, r = inner(g, name).rect; return { col: o.col + 1 + r.col, row: o.row + 1 + r.row, cols: r.cols, rows: r.rows }; };

  test("by mouse: a tile's title dragged onto a group goes in where the drop zone says, one dragged out of it onto the screen goes back out; esc cancels", async () => {
    const g = (await act("tile.group", { with: "thread", where: "down" }, "activity")).tile;
    render();
    const reader = tile("reader").rect, grp = tile(g).rect;
    // Esc mid-drag: nothing moves.
    mouse("down", reader.col + 3, reader.row); mouse("drag", reader.col + 4, reader.row); mouse("drag", grp.col + grp.cols - 3, grp.row + 10);
    expect(D().dragging?.into).toMatchObject({ group: expect.any(Number), where: expect.any(String) });
    key({ kind: "esc" } as Key); render();
    mouse("up", grp.col + grp.cols - 3, grp.row + 10);
    expect(tile("reader")).toBeDefined();
    // Dropped on its right side: beside the lower tile, to its right.
    drag([reader.col + 3, reader.row], [grp.col + grp.cols - 3, grp.row + grp.rows - 6]);
    expect(tile("reader")).toBeUndefined();
    expect(inner(g, "reader")).toBeDefined();
    // Out: its title dragged past the group's content, onto the tree's right edge.
    const at = innerAt(g, "reader"), tr = tile("tree").rect;
    drag([at.col + 3, at.row], [tr.col + tr.cols - 2, tr.row + 20]);
    expect(tile("reader")).toBeDefined();
    expect(inner(g, "reader")).toBeUndefined();
    // The frame of a group takes a tile in too, beside its focused tile.
    const r2 = tile("reader").rect, g2 = tile(g).rect;
    drag([r2.col + 3, r2.row], [g2.col + 5, g2.row]);
    expect(tile("reader")).toBeUndefined();
    expect(inner(g, "reader")).toBeDefined();
    await me("tile.group", { on: false }, g);
    render();
  }, 30_000);

  const press = (...ks: Key[]) => { for (const k of ks) key(k); render(); };
  const chord = (c: string) => press({ kind: "char", ch: "w", ctrl: true } as Key, { kind: "char", ch: c } as Key);
  const overlay = () => D().overlays.top() as { name: string; items: any[]; sel: number } | null;
  const groupName = () => get().tiles.find((t: any) => t.mount?.group)?.name as string | undefined;
  /** The desk's layout again: tree | reader | (thread over activity), the keys in the tree. */
  const fresh = async () => { await mine("layout.load", { name: "desk" }); render(); await mine("tile.focus", {}, "tree"); };
  const spill = async (g: string) => { await me("tile.group", { on: false }, g); render(); };

  test("picking tiles: shift+click on titles and ^W space pick, esc lets go; an agent's picks are its own; ^W G gathers the picked, in the arrangement they had", async () => {
    await fresh();
    const tr = tile("tree").rect, rd = tile("reader").rect;
    mouse("down", tr.col + 3, tr.row, 4); mouse("up", tr.col + 3, tr.row, 4);
    expect(tile("tree").picked).toBe(true);
    expect(get().focus).toBe("tree");
    mouse("down", rd.col + 3, rd.row, 4); mouse("up", rd.col + 3, rd.row, 4);
    expect(tile("reader").picked).toBe(true);
    expect(get().focus).toBe("tree");                         // picking moves no focus
    // The pick shows on the frame and in the title.
    expect(render().lines.join("\n")).toContain("◆ picked");
    // An agent's picks are its own: it picks thread, and clearing its picks leaves the person's.
    expect(await act("tile.select", {}, "thread")).toMatchObject({ selected: ["thread"], by: `agent:${AS}` });
    expect(tile("thread")).toMatchObject({ pickedBy: [AS] });
    expect(tile("thread").picked).toBeUndefined();
    expect(tile("tree").pickedBy).toBeUndefined();
    await act("tile.select", { clear: true });
    expect(tile("thread").pickedBy).toBeUndefined();
    expect(tile("tree").picked).toBe(true);
    expect(tile("reader").picked).toBe(true);
    // ^W G: the picked two, side by side as they were.
    chord("G");
    const g = groupName()!;
    expect(g).toBeDefined();
    expect(tile(g).mount.layout.tree).toMatchObject({ split: "row" });
    expect(tile(g).mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["reader", "tree"]);
    expect(names()).not.toContain("tree");
    expect(tile(g).picked).toBeUndefined();                   // gathered, they are no longer picked
    await spill(g);
    expect(tile("tree").picked).toBeUndefined();
    // esc lets go of the person's picks, and only the person's.
    await act("tile.select", {}, "thread");
    await mine("tile.focus", {}, "tree");
    chord(" ");                                                // ^W space picks the focused tile too
    expect(tile("tree").picked).toBe(true);
    press({ kind: "esc" } as Key);
    expect(tile("tree").picked).toBeUndefined();
    expect(tile("thread").pickedBy).toEqual([AS]);
    // An agent gathers its own picks: thread and activity, stacked as they were; the person's focus stays.
    await act("tile.select", {}, "activity");
    const ag = await act("tile.group", { selected: true }, "thread");
    expect(ag.grouped.sort()).toEqual(["activity", "thread"]);
    render();
    expect(tile(ag.tile).mount.layout.tree).toMatchObject({ split: "col" });
    expect(get().focus).toBe("tree");
    await spill(ag.tile);
    await expect(act("tile.group", { selected: true }, "thread")).rejects.toThrow(/no tiles selected/);
    // Tiles not next to each other gather side by side, as far as a split allows: tree and activity.
    await me("tile.select", {}, "tree"); await me("tile.select", {}, "activity");
    const far = await me("tile.group", { selected: true }, "tree");
    render();
    expect(far.grouped.sort()).toEqual(["activity", "tree"]);
    expect(tile(far.tile).mount.layout.tree).toMatchObject({ split: "row" });
    await spill(far.tile);
  }, 30_000);

  test("^W G in a split offers this tile or the whole split; the tile menu's row offers the same", async () => {
    await fresh();
    await mine("tile.focus", {}, "activity");
    chord("G");
    expect(overlay()).toMatchObject({ name: "gather" });
    expect(overlay()!.items.map((i: any) => i.label)).toEqual([expect.stringMatching(/^this tile · activity/), expect.stringMatching(/^the whole split · (activity, thread|thread, activity)/)]);
    press({ kind: "down" } as Key, { kind: "enter" } as Key);
    const g = groupName()!;
    expect(tile(g).mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["activity", "thread"]);
    expect(tile(g).mount.layout.tree).toMatchObject({ split: "col" });
    await spill(g);
    // This tile alone.
    await mine("tile.focus", {}, "activity");
    chord("G");
    press({ kind: "enter" } as Key);
    const one = groupName()!;
    expect(tile(one).mount.layout.tiles.map((t: any) => t.name)).toEqual(["activity"]);
    await spill(one);
    // The menu's row asks the same; an agent is never asked: it gathers the tile.
    await mine("tile.focus", {}, "tree");
    const rows = (await act("tile.menu", {}, "activity")).rows as any[];
    expect(rows.find(r => r.action === "tile.group")).toMatchObject({ label: "gather into a group", args: { ask: true } });
    const done = await act("tile.group", { ask: true }, "activity");
    expect(done.grouped).toEqual(["activity"]);
    render();
    await spill(done.tile);
    await mine("tile.focus", {}, "tree");
  }, 30_000);

  test("^W i moves the tile into the only group, or asks which; in a group it takes the tile back out; a group's last tile spills it", async () => {
    await fresh();
    const g = (await act("tile.group", { with: "thread", where: "down" }, "activity")).tile;
    render();
    await mine("tile.focus", {}, "tree");
    chord("i");
    expect(inner(g, "tree")).toBeDefined();
    expect(tile("tree")).toBeUndefined();
    // Inside the group, the same key (on its screen) takes it out.
    expect(await me("tile.into", {}, `${g}/tree`)).toMatchObject({ out: true });
    render();
    expect(tile("tree")).toBeDefined();
    // Two groups: the person picks, an agent names one.
    const g2 = (await me("tile.group", {}, "reader")).tile;
    render();
    expect(g2).not.toBe(g);
    await mine("tile.focus", {}, "tree");
    await expect(act("tile.into", {}, "tree")).rejects.toThrow(/group=</);
    chord("i");
    expect(overlay()).toMatchObject({ name: "into a group" });
    expect(overlay()!.items).toEqual([g, g2]);
    press({ kind: "down" } as Key, { kind: "enter" } as Key);
    expect(inner(g2, "tree")).toBeDefined();
    await me("tile.into", {}, `${g2}/tree`);
    render();
    await spill(g2);
    await spill(g);
    // The last tile of a group out: the group is gone.
    const one = (await act("tile.group", {}, "activity")).tile;
    render();
    // A place that isn't there is refused before anything is spilled.
    await expect(me("layout.move", { out: true, beside: "nope" }, `${one}/activity`)).rejects.toThrow(/no tile nope/);
    expect(names()).toContain(one);
    expect(await me("layout.move", { out: true }, `${one}/activity`)).toMatchObject({ out: true });
    render();
    expect(names()).not.toContain(one);
    expect(names()).toContain("activity");
  }, 30_000);

  test("one picked tile is gathered even when another tile has focus", async () => {
    await fresh();
    await mine("tile.select", {}, "tree");
    await mine("tile.focus", {}, "activity");
    const rows = (await me("tile.menu", {}, "activity")).rows;
    expect(rows.find((r: any) => r.action === "tile.group").label).toContain("1 picked tile");
    chord("G");
    const g = groupName()!;
    expect(inner(g, "tree")).toBeDefined();
    expect(tile("activity")).toBeDefined();
    await spill(g);
  }, 30_000);

  test("locked screens refuse cross-group link creation, replacement, role changes and removal without changing saved links", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "thread" }, "reader")).tile;
    await me("tile.open", { kind: "detail", name: "peer" }, `${g}/reader`);
    await me("tile.link", {}, "tree");
    for (const linked of [false, true]) {
      if (linked) await me("tile.link", { to: `${g}/reader` }, "tree");
      await me("layout.lock", { on: true });
      const before = get();
      try {
        for (const run of [me, act]) {
          for (const args of [{ to: `${g}/reader` }, { to: `${g}/peer` }, ...(linked ? [{ role: "target" }] : []), {}]) {
            await expect(run("tile.link", args, "tree")).rejects.toThrow(/locked/);
            expect(get()).toEqual(before);
          }
        }
      } finally {
        await me("layout.lock", { on: false });
      }
    }
    expect(await me("tile.link", { role: "target" }, "tree")).toMatchObject({ role: "target" });
    expect(await me("tile.link", {}, "tree")).toMatchObject({ link: null });
    await spill(g);
  }, 30_000);

  test("a locked group refuses links to its outside and preserves their role and target", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "thread" }, "reader")).tile;
    await me("tile.open", { kind: "detail", name: "outside" }, "tree");
    await me("tile.link", { to: "../outside" }, `${g}/thread`);
    await me("layout.lock", { on: true }, `${g}/thread`);
    const before = get();
    try {
      for (const args of [{ to: "../outside" }, { role: "target" }, {}]) {
        await expect(me("tile.link", args, `${g}/thread`)).rejects.toThrow(/locked/);
        expect(get()).toEqual(before);
      }
    } finally {
      await me("layout.lock", { on: false }, `${g}/thread`);
    }
    await spill(g);
    await me("tile.close", {}, "outside");
  }, 30_000);

  test("group move confirmations name their destinations, including the last tile spilling out", () => {
    const move = TILE_ACTIONS.def("layout.move")!.says!;
    expect(move({ tile: "reader", into: "group" }, { into: "group" })).toBe("moved reader into group");
    expect(move({ tile: "reader", out: true, from: "group" }, { out: true })).toBe("moved reader out of group");
    expect(move({ tile: "reader", out: true }, { out: true })).toBe("moved reader out of its group");
    expect(TILE_ACTIONS.def("tile.into")!.says!({ tile: "reader", out: true }, {})).toBe("moved reader out of its group");
    expect(move({ tile: "reader" }, { to: "tree", where: "left" })).toBe("moved reader left of tree");
  });

  test("links cross a group's edge: grouping, spilling and moving never break them; the tree outside opens into the reader inside, a preview across the edge keeps following, and they survive a restart", async () => {
    await fresh();
    const [a, b] = [seeded.notes.hub.id, seeded.notes.root.id];
    await act("tile.link", { to: "reader" }, "tree");
    expect(tile("tree")).toMatchObject({ link: "reader" });
    await act("tile.open", { kind: "preview", source: "tile:tree", name: "pv" }, "activity");
    // Gather the reader (with the thread): the tree's link goes through the path.
    const g = (await act("tile.group", { with: "thread", where: "down" }, "reader")).tile;
    render();
    expect(tile("tree")).toMatchObject({ link: `${g}/reader`, linkAcross: "true" });
    expect(inner(g, "reader")).toBeDefined();
    await act("open", { id: a, from: "tree" });
    expect(showing(g) ?? inner(g, "reader").showing?.id).toBe(a);
    expect(inner(g, "reader").showing?.id).toBe(a);
    // The preview moves into the group too: it still follows the tree, outside.
    await me("layout.move", { into: g, beside: "thread" }, "pv");
    render();
    expect(inner(g, "pv")).toBeDefined();
    // The tree's selection moves to b: the preview in the group follows it, and so does the reader the link previews in.
    D().showFrom(D().pane("tree"), await board.get(b));
    render();
    expect(inner(g, "pv").showing?.id).toBe(b);
    expect(inner(g, "reader").showing?.id).toBe(b);
    // A tile of the group opening into one outside: reader -> a detail beside the tree, by `../` path.
    await act("tile.open", { kind: "detail", name: "det" }, "tree");
    render();
    await act("tile.link", { to: "../det" }, `${g}/thread`);
    expect(inner(g, "thread")).toMatchObject({ link: "../det", linkAcross: "true" });
    // Saved by path, and back after a restart.
    D().save();
    const again = new Desk() as any;
    app.push(again);
    again.render(again.ctx);
    const there = (n: string) => again.layoutGet().tiles.find((x: any) => x.name === n);
    expect(there("tree")).toMatchObject({ link: `${g}/reader`, linkAcross: "true" });
    expect(there(g).mount.layout.tiles.find((x: any) => x.name === "thread")).toMatchObject({ link: "../det" });
    expect(there(g).mount.layout.tiles.find((x: any) => x.name === "pv").source).toBe("tile:../tree");
    app.pop();
    // Moved out again: the preview and the tree are on one desk, the link is the layout's own.
    await me("layout.move", { out: true, beside: "tree", where: "down" }, `${g}/pv`);
    render();
    expect(tile("pv")).toBeDefined();
    D().showFrom(D().pane("tree"), await board.get(a));
    render();
    expect(tile("pv").showing?.id).toBe(a);
    // Spilled: the tree's link is to the reader by name, as it was.
    await spill(g);
    expect(tile("tree")).toMatchObject({ link: "reader" });
    expect(tile("tree").linkAcross).toBeUndefined();
    expect(tile("thread")).toMatchObject({ link: "det" });
    await act("open", { id: b, from: "tree" });
    expect(tile("reader").showing?.id).toBe(b);
    await mine("tile.focus", {}, "tree"); await act("tile.close", {}, "pv"); await act("tile.close", {}, "det");
  }, 30_000);
});
