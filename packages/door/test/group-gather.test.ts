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
  const tile = (name: string) => get().tiles.find((t: any) => (t.name === name || t.tile === name));
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
  const inner = (g: string, name: string) => tile(g).mount.layout.tiles.find((t: any) => (t.name === name || t.tile === name));

  test("a tile goes into a group and back out whole: the program keeps running, its policy and spine travel with it", async () => {
    await act("tile.open", { kind: "pty", cmd: "sh", name: "shell" }, "activity");
    await until(() => { render(); return !!tile("shell")?.terminal?.running; }, "the shell");
    const pty = D().pane("shell");
    await act("tile.agent", { policy: "edit" }, "shell");
    const g = await act("tile.group", { with: "replies", where: "down" }, "activity");
    expect(g.grouped).toEqual(["activity", "replies"]);
    render();
    // Into the group: beside its activity tile, to the right.
    const r = await me("layout.move", { into: g.tile, beside: "activity", where: "right" }, "shell");
    expect(r).toMatchObject({ name: "shell", into: g.name });
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
    await expect(me("layout.move", { into: g.tile, out: true }, "shell")).rejects.toThrow(/conflicts/);
    // The last tile out spills the group.
    await me("layout.move", { into: g.tile, beside: "activity" }, "shell");
    await me("layout.move", { out: true }, `${g.tile}/shell`);
    await act("tile.group", { on: false }, g.tile);
    render();
    expect(names()).toEqual(expect.arrayContaining(["tree", "reader", "replies", "activity", "shell"]));
    expect(D().pane("shell")).toBe(pty);
    await me("tile.close", {}, "shell").catch(() => {});
    await me("tile.close", {}, "shell");
  }, 30_000);

  const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods = 0) => { key({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) } as Key); render(); };
  const drag = (from: [number, number], to: [number, number]) => { mouse("down", ...from); mouse("drag", from[0] + 1, from[1]); mouse("drag", ...to); mouse("up", ...to); };
  /** A tile of the group's screen on the whole screen: its content starts a cell in from the group's frame. */
  const innerAt = (g: string, name: string) => { const o = tile(g).rect, r = inner(g, name).rect; return { col: o.col + 1 + r.col, row: o.row + 1 + r.row, cols: r.cols, rows: r.rows }; };

  test("by mouse: a tile's title dragged onto a group goes in where the drop zone says, one dragged out of it onto the screen goes back out; esc cancels", async () => {
    const g = (await act("tile.group", { with: "replies", where: "down" }, "activity")).name;
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

  test("b reuses the grouped links and preview beside a detail (PIE-1120)", async () => {
    D().build({ root: { t: "leaf", kind: "reader", mode: "held", name: "detail", note: seeded.notes.hub.id }, focus: "detail" }, false);
    render();
    await until(() => showing("detail") === seeded.notes.hub.id, "detail loaded");
    await mine("tile.focus", {}, "detail");
    press({ kind: "char", ch: "b" });
    await until(() => { render(); return get().tiles.some(t => t.kind === "preview"); }, "links and preview opened by b");
    const links = get().tiles.find(t => t.kind === "backlinks")!.name;
    const preview = get().tiles.find(t => t.kind === "preview")!.name;
    await me("tile.select", {}, links);
    await me("tile.select", {}, preview);
    const g = (await me("tile.group", { selected: true }, links)).name;
    render();
    await mine("tile.focus", {}, "detail");
    press({ kind: "char", ch: "b" });
    await until(() => { render(); return get().focus !== "detail"; }, "b has aimed the links");
    expect(get().tiles.some(t => t.kind === "backlinks" || t.kind === "preview")).toBe(false);
    expect(inner(g, links).backlinks.target.id).toBe(seeded.notes.hub.id);
    expect(inner(g, links).wires).toContainEqual({ verb: "select", to: inner(g, preview).tile });
    await until(() => { render(); return inner(g, links).backlinks.rows?.some((r: any) => r.id); }, "the grouped links loaded");
    const row = inner(g, links).backlinks.rows.find((r: any) => r.id);
    await me("list.pick", { n: row.n }, `${g}/${links}`);
    await until(() => { render(); return inner(g, preview).showing?.id === row.id; }, "the selected link's preview loaded");
    expect(row.id).not.toBe(seeded.notes.hub.id);
    await me("backlinks", {}, `${g}/${links}`);
    expect(inner(g, links).backlinks.target.id).toBe(seeded.notes.hub.id);
    await me("list.pick", { n: row.n }, `${g}/${links}`);
    press({ kind: "enter" });
    await until(() => showing("detail") === row.id, "the grouped links open in their home detail");
    await spill(g);
  });

  test("a preview from a drawer group gives the screen target the next keys (PIE-1120)", async () => {
    await fresh();
    await me("open", { id: seeded.notes.hub.id }, "reader");
    await me("tile.open", { kind: "detail", name: "outside", note: seeded.notes.root.id }, "tree");
    await until(() => showing("outside") === seeded.notes.root.id, "the screen detail loaded");
    const g = (await me("tile.group", { with: "activity" }, "reader")).name;
    render();
    await me("tile.link", { to: tile("outside").tile }, `${g}/reader`);
    await me("tile.drawer", {}, g);
    (app as any).paint();
    const drawer = app.drawer.desk!;
    expect(await drawer.dispatch.act({ action: "tile.preview", tile: `${g}/reader` }, { kind: "user" })).toMatchObject({ existing: true });
    render();
    expect(get().focus).toBe("outside");
    const target = showing("outside");
    expect(target).toBeTruthy();
    press({ kind: "char", ch: "b" });
    await until(() => { render(); return get().tiles.some(t => t.backlinks?.target?.id === target); }, "the next b reaches the screen detail");
    expect(app.drawer.entered).toBe(false);
    await app.act({ action: "tile.drawer", args: { on: false }, tile: g, as: AS });
    await spill(g);
  });

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
    expect(await act("tile.select", {}, "replies")).toMatchObject({ selected: ["replies"], by: `agent:${AS}` });
    expect(tile("replies")).toMatchObject({ pickedBy: [AS] });
    expect(tile("replies").picked).toBeUndefined();
    expect(tile("tree").pickedBy).toBeUndefined();
    await act("tile.select", { clear: true });
    expect(tile("replies").pickedBy).toBeUndefined();
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
    await act("tile.select", {}, "replies");
    await mine("tile.focus", {}, "tree");
    chord(" ");                                                // ^W space picks the focused tile too
    expect(tile("tree").picked).toBe(true);
    press({ kind: "esc" } as Key);
    expect(tile("tree").picked).toBeUndefined();
    expect(tile("replies").pickedBy).toEqual([AS]);
    // An agent gathers its own picks: thread and activity, stacked as they were; the person's focus stays.
    await act("tile.select", {}, "activity");
    const ag = await act("tile.group", { selected: true }, "replies");
    expect(ag.grouped.sort()).toEqual(["activity", "replies"]);
    render();
    expect(tile(ag.tile).mount.layout.tree).toMatchObject({ split: "col" });
    expect(get().focus).toBe("tree");
    await spill(ag.tile);
    await expect(act("tile.group", { selected: true }, "replies")).rejects.toThrow(/no tiles selected/);
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
    expect(overlay()!.items.map((i: any) => i.label)).toEqual([expect.stringMatching(/^this tile · activity/), expect.stringMatching(/^the whole split · (activity, replies|replies, activity)/)]);
    press({ kind: "down" } as Key, { kind: "enter" } as Key);
    const g = groupName()!;
    expect(tile(g).mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["activity", "replies"]);
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
    const g = (await act("tile.group", { with: "replies", where: "down" }, "activity")).name;
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
    const g2 = (await me("tile.group", {}, "reader")).name;
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
    const one = (await act("tile.group", {}, "activity")).name;
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

  test("locked screens refuse cross-group link creation, replacement, wire changes and removal without changing saved links", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "replies" }, "reader")).name;
    await me("tile.open", { kind: "detail", name: "peer" }, `${g}/reader`);
    await me("tile.link", {}, "tree");
    for (const linked of [false, true]) {
      if (linked) await me("tile.link", { to: `${g}/reader` }, "tree");
      await me("layout.lock", { on: true });
      const before = get();
      try {
        for (const run of [me, act]) {
          for (const args of [{ to: `${g}/reader` }, { to: `${g}/peer` }, ...(linked ? [{ verb: "open" }] : []), {}]) {
            await expect(run("tile.link", args, "tree")).rejects.toThrow(/locked/);
            expect(get()).toEqual(before);
          }
        }
      } finally {
        await me("layout.lock", { on: false });
      }
    }
    expect(await me("tile.link", { verb: "open" }, "tree")).toMatchObject({ verb: "open" });
    expect(await me("tile.link", {}, "tree")).toMatchObject({ wire: null });
    await spill(g);
  }, 30_000);

  test("a refused spill keeps the group's picked tiles and pending wire", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "replies" }, "reader")).name;
    await me("tile.select", { on: true }, `${g}/reader`);
    await me("tile.focus", {}, `${g}/reader`);
    press({ kind: "alt", ch: "l" });
    const before = inner(g, "reader");
    expect(before.picked).toBe(true);
    expect(desk.linkingFrom()).toBeDefined();
    await me("layout.lock", { on: true }, "tree");
    try {
      await expect(spill(g)).rejects.toThrow(/locked/);
      expect(inner(g, "reader").picked).toBe(true);
      expect(desk.linkingFrom()).toBeDefined();
    } finally {
      press({ kind: "esc" });
      await me("layout.lock", { on: false }, "tree");
      await spill(g);
    }
  }, 30_000);

  test("spilling a locked group keeps its policy on the tiles that come out", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "replies" }, "reader")).name;
    await me("layout.lock", { on: true }, `${g}/reader`);
    await spill(g);
    await expect(me("tile.close", {}, "replies")).rejects.toThrow(/locked/);
    // The group's policy must not lock unrelated tiles on the containing screen.
    await me("tile.open", { kind: "reader", name: "outside-lock" }, "tree");
    await me("tile.close", {}, "outside-lock");
    const policy = await me("layout.policy", {}, "replies");
    await me("layout.policy", { node: policy.effective.by.locked, locked: false }, "replies");
  }, 30_000);

  test("a locked group refuses links to its outside and preserves their verb and target", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "replies" }, "reader")).name;
    await me("tile.open", { kind: "detail", name: "outside" }, "tree");
    await me("tile.link", { to: tile("outside").tile }, `${g}/replies`);
    await me("layout.lock", { on: true }, `${g}/replies`);
    const before = get();
    try {
      for (const args of [{ to: tile("outside").tile }, { verb: "open" }, {}]) {
        await expect(me("tile.link", args, `${g}/replies`)).rejects.toThrow(/locked/);
        expect(get()).toEqual(before);
      }
    } finally {
      await me("layout.lock", { on: false }, `${g}/replies`);
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
    expect(move({ tile: "reader", to: "tree" }, { to: "tree", where: "left" })).toBe("moved reader left of tree");
  });

  test("links cross a group's edge: grouping, spilling and moving never break them; the tree outside opens into the reader inside, a preview across the edge keeps following, and they survive a restart", async () => {
    await fresh();
    const [a, b] = [seeded.notes.hub.id, seeded.notes.root.id];
    await act("tile.link", { to: "reader" }, "tree");
    expect(tile("tree")).toMatchObject({ link: "reader" });
    await act("tile.open", { kind: "preview", source: "tile:tree", name: "pv" }, "replies");
    // Gather the reader (with the activity: a tile whose opens have no origin of their own, unlike the replies list): the tree's link goes through the path.
    const g = (await act("tile.group", { with: "activity", where: "down" }, "reader")).name;
    render();
    expect(tile("tree")).toMatchObject({ link: `${g}/reader`, linkAcross: "true" });
    expect(inner(g, "reader")).toBeDefined();
    await act("open", { id: a, from: "tree" });
    expect(showing(g) ?? inner(g, "reader").showing?.id).toBe(a);
    expect(inner(g, "reader").showing?.id).toBe(a);
    // The preview moves into the group too: it still follows the tree, outside.
    await me("layout.move", { into: g, beside: "activity" }, "pv");
    render();
    expect(inner(g, "pv")).toBeDefined();
    // The tree's selection moves to b: the preview in the group follows it, the open target stays on its note.
    D().showFrom(D().pane("tree"), await board.get(b));
    render();
    expect(inner(g, "pv").showing?.id).toBe(b);
    expect(inner(g, "reader").showing?.id).toBe(a);
    // A tile of the group opening into one outside: reader -> a detail beside the tree, by `../` path.
    await act("tile.open", { kind: "detail", name: "det" }, "tree");
    render();
    await act("tile.link", { to: "../det" }, `${g}/activity`);
    expect(inner(g, "activity")).toMatchObject({ link: "../det", linkAcross: "true" });
    // A second copy restores the arrangement with fresh identities and local references.
    D().save();
    const again = new Desk() as any;
    app.push(again);
    again.render(again.ctx);
    await Bun.sleep(0);
    const there = (n: string) => again.layoutGet().tiles.find((x: any) => x.name === n);
    expect(there("tree")).toMatchObject({ link: `${g}/reader`, linkAcross: "true" });
    expect(there(g).mount.layout.tiles.find((x: any) => x.name === "activity")).toMatchObject({ link: "../det" });
    expect(there("tree").wires).toContainEqual({ verb: "select", to: there(g).mount.layout.tiles.find((t: any) => t.name === "pv").tile });
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
    expect(tile("activity")).toMatchObject({ link: "det" });
    await act("open", { id: b, from: "tree" });
    expect(tile("reader").showing?.id).toBe(b);
    await mine("tile.focus", {}, "tree"); await act("tile.close", {}, "pv"); await act("tile.close", {}, "det");
  }, 30_000);

  test("link mode crosses sibling groups (PIE-1073): a click wires the source and its open lands there", async () => {
    await fresh();
    const a = (await me("tile.group", { with: "activity", where: "down" }, "tree")).name;
    const b = (await me("tile.group", { with: "replies", where: "down" }, "reader")).name;
    render();
    await me("mount.enter", { on: true }, a);
    await me("tile.focus", {}, `${a}/tree`);
    key({ kind: "alt", ch: "l" });
    // One linking card on the whole screen, on the source tile, never one per tile or per group (Evan, Oct 19 10:55 AM).
    expect(render().lines.filter(l => l.includes(" lands in ")).length).toBe(1);
    const r = innerAt(b, "reader");
    mouse("down", r.col + 3, r.row + 3);
    expect(inner(a, "tree").wires).toContainEqual({ verb: "open", to: inner(b, "reader").tile });
    await D().pane(a).inner.dispatch.act({ action: "open", args: { id: seeded.notes.hub.id, from: "tree" } }, { kind: "agent", id: AS });
    expect(inner(b, "reader").showing?.id).toBe(seeded.notes.hub.id);
    await me("tile.link", {}, `${a}/tree`);
    await me("tile.link", { ask: true }, `${a}/tree`);
    render();
    key({ kind: "char", ch: "3" });
    expect(inner(a, "tree").wires).toContainEqual({ verb: "open", to: inner(b, "reader").tile });
    await me("tile.link", {}, `${a}/tree`);
    await me("tile.link", { ask: true }, `${a}/tree`);
    render();
    key({ kind: "char", ch: "l" });
    expect(inner(a, "tree").wires).toContainEqual({ verb: "open", to: inner(b, "reader").tile });
    await me("tile.link", { ask: true }, `${a}/tree`);
    key({ kind: "esc" });
    expect(render().lines.join("\n")).not.toContain("click to link here");
    await me("mount.enter", { on: false }, a);
    await spill(a);
    await spill(b);
  }, 30_000);

  test("alt+l targets across a group both ways also take preview requests without another tile (PIE-1120)", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "activity" }, "reader")).name;
    render();
    await mine("tile.focus", {}, "tree");
    press({ kind: "alt", ch: "l" }, { kind: "char", ch: "s" });
    const inside = innerAt(g, "reader");
    mouse("down", inside.col + 3, inside.row + 3);
    D().showFrom(D().pane("tree"), await board.get(seeded.notes.hub.id));
    render();
    expect(inner(g, "reader").showing.id).toBe(seeded.notes.hub.id);
    expect(await me("tile.preview", {}, "tree")).toMatchObject({ existing: true, tile: inner(g, "reader").tile, verb: "select" });
    expect(names()).not.toContain("tree-preview");

    await me("mount.enter", { on: true }, g);
    await me("tile.focus", {}, `${g}/reader`);
    press({ kind: "alt", ch: "l" });
    // A reader target outside the group, chosen with the same link-mode click.
    await me("tile.open", { kind: "detail", name: "outside" }, "replies");
    render();
    const target = tile("outside").rect;
    mouse("down", target.col + 3, target.row + 3);
    expect(inner(g, "reader").wires).toContainEqual({ verb: "open", to: tile("outside").tile });
    await D().pane(g).inner.dispatch.act({ action: "open", args: { id: seeded.notes.root.id, from: "reader" } }, { kind: "user" });
    expect(showing("outside")).toBe(seeded.notes.root.id);
    expect(await D().pane(g).inner.dispatch.act({ action: "tile.preview", tile: "reader" }, { kind: "user" })).toMatchObject({ existing: true, tile: tile("outside").tile, verb: "open" });
    expect(inner(g, "reader-preview")).toBeUndefined();
    await me("mount.enter", { on: false }, g);
    await spill(g);
  });

  test("gathering is a history entry the person can undo (PIE-957): layout.undo ungathers it, and the group's tiles are back where they were", async () => {
    render();
    const before = names().slice().sort();
    const seq = D().history.newest()?.seq ?? 0;
    const g = await act("tile.group", { with: "replies", where: "down" }, "activity");
    render();
    expect(D().history.newest().seq).toBeGreaterThan(seq);
    expect(names()).toContain(g.name);
    await me("layout.undo", {}, g.tile);
    render();
    expect(names().slice().sort()).toEqual(before);
  });
  test("alt rules survive gathering and moving either end across a group edge (wave 3)", async () => {
    for (const rule of ["tab", "beside", "first-unheld"]) {
      await fresh();
      await me("tile.link", { verb: "alt", to: "reader", rule }, "tree");
      const g = (await me("tile.group", { with: "activity" }, "reader")).name;
      expect(tile("tree").wires).toContainEqual({ verb: "alt", to: inner(g, "reader").tile, rule });
      await spill(g);
      const h = (await me("tile.group", { with: "activity" }, "tree")).name;
      expect(inner(h, "tree").wires).toContainEqual({ verb: "alt", to: tile("reader").tile, rule });
      await spill(h);
      const k = (await me("tile.group", { with: "activity" }, "replies")).name;
      await me("layout.move", { into: k, beside: "activity" }, "tree");
      expect(inner(k, "tree").wires).toContainEqual({ verb: "alt", to: tile("reader").tile, rule });
      await me("layout.move", { out: true }, `${k}/tree`);
      await me("layout.move", { into: k, beside: "activity" }, "reader");
      expect(tile("tree").wires).toContainEqual({ verb: "alt", to: inner(k, "reader").tile, rule });
      await spill(k);
    }
  });

  test("opening and replacing a preview accepts container and cross-group sources (wave 7)", async () => {
    await fresh();
    const g = (await me("tile.group", { with: "activity" }, "reader")).name;
    render();
    await me("tile.open", { kind: "preview", source: "tile:../tree", name: "far" }, `${g}/reader`);
    D().showFrom(D().pane("tree"), await board.get(seeded.notes.hub.id));
    render();
    expect(inner(g, "far").showing?.id).toBe(seeded.notes.hub.id);
    await D().pane(g).inner.replaceTile("far", { kind: "preview", source: "tile:../tree", name: "replaced" }, { kind: "user" });
    D().showFrom(D().pane("tree"), await board.get(seeded.notes.root.id));
    render();
    expect(inner(g, "replaced").showing?.id).toBe(seeded.notes.root.id);
    await spill(g);
    const saved = D().layoutSpec();
    saved.root.key = "sources";
    D().build(saved, false); render();
    await me("tile.open", { kind: "preview", source: "tile:sources", name: "all" }, "reader");
    D().showFrom(D().pane("tree"), await board.get(seeded.notes.hub.id));
    render();
    expect(showing("all")).toBe(seeded.notes.hub.id);
    await D().replaceTile("all", { kind: "preview", source: "tile:sources", name: "all-new" }, { kind: "user" });
    D().showFrom(D().pane("tree"), await board.get(seeded.notes.root.id));
    render();
    expect(showing("all-new")).toBe(seeded.notes.root.id);
  });

});
