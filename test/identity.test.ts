// PIE-491, layout identity (the October 2026 review's F17 and F18): agents address splits, tab sets and tiles
// by stable ids, and positional paths and numbers can be checked against the layout's revision.
// - F17: after the person moved a tile, an agent's `layout.resize path=2` resized a different split, and
//   `layout.get` gave no paths.
// - F18: a tile could be named `1`, so `reader=1` meant it and not the tile numbered 1; the Herdr agent tile
//   was known by its terminal title; the Claude mod assumed a tile called `middle`.
// Scratch services, fictional notes, `sh` and `tail` only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { startControl } from "../src/control";
import { Desk } from "../src/desk/desk";
import { attachTitle } from "../src/desk/herdr-agent";
import { builtin, withDailyAgent } from "../src/desk/tiles";
import { leaf, splitOf, revive, serialize, type LNode } from "../src/desk/layout";
import { Mirror } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

/** A split in layout.get's tree whose kids are these tiles, by name. */
const splitOfTiles = (n: any, names: string[]): any =>
  n.split && n.kids.every((k: any, i: number) => k.pane === names[i]) && n.kids.length === names.length ? n : n.kids?.map((k: any) => splitOfTiles(k, names)).find(Boolean);
const shares = (n: any) => n.kids.map((k: any) => k.share);

describe("ids in the saved form", () => {
  test("a split's and a tab set's id survive a save and a load; a tree saved before ids has none, and gets them from the desk", () => {
    const tree: LNode<string> = { ...splitOf("row", [leaf("a"), { t: "tabs", ids: ["b", "c"], active: 1, id: "g4" }]), id: "s3" };
    const saved = serialize(tree, id => ({ t: "leaf" as const, name: id }));
    const back = revive(saved as any, (l: any) => l.name as string) as any;
    expect(back.id).toBe("s3");
    expect(back.kids[1]).toMatchObject({ t: "tabs", ids: ["b", "c"], id: "g4" });
    const old = revive({ t: "split", dir: "row", ratio: 0.4, a: { t: "leaf", name: "a" }, b: { t: "leaf", name: "b" } } as any, (l: any) => l.name) as any;
    expect(old.id).toBeUndefined();
  });
});

describe("the daily agent tile in a saved layout", () => {
  const spec = (l: Record<string, unknown>) => ({ root: { t: "split", dir: "row", kids: [{ t: "leaf", kind: "pty", name: "claude", ...l }, { t: "leaf", kind: "detail", name: "middle" }], weights: [1, 1] } }) as any;
  const claude = (s: any) => s.root.kids[0];
  test("a flagged tile, or the plain claude default in a daily desk, runs what EP0CH_DAILY_AGENT and EP0CH_DAILY_CWD say now", () => {
    const was = { agent: process.env.EP0CH_DAILY_AGENT, cwd: process.env.EP0CH_DAILY_CWD };
    process.env.EP0CH_DAILY_AGENT = "garden-agent --attach";
    delete process.env.EP0CH_DAILY_CWD;
    try {
      expect(claude(withDailyAgent(spec({ cmd: ["claude"] }), "daily"))).toMatchObject({ agent: true, cmd: ["garden-agent", "--attach"] });
      expect(claude(withDailyAgent(spec({ cmd: ["old-agent"], cwd: "/plot", agent: true }), "garden"))).toEqual({ t: "leaf", kind: "pty", name: "claude", agent: true, cmd: ["garden-agent", "--attach"] });
      // Not the agent tile: another layout, another name, or a command the person changed.
      for (const [l, from] of [[{ cmd: ["claude"] }, "garden"], [{ cmd: ["claude"] }, undefined], [{ cmd: ["claude", "--resume"] }, "daily"], [{ cmd: ["claude"], name: "helper" }, "daily"]] as const) {
        const s = spec(l);
        expect(withDailyAgent(s, from)).toBe(s);
      }
      const leaves = (n: any): any[] => (n.kids ? n.kids.flatMap(leaves) : n.tabs ? n.tabs.flatMap(leaves) : [n]);
      expect(leaves(builtin("daily")!.root).find(l => l.name === "claude")).toMatchObject({ agent: true, cmd: ["garden-agent", "--attach"] });
    } finally {
      if (was.agent === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = was.agent;
      if (was.cwd !== undefined) process.env.EP0CH_DAILY_CWD = was.cwd;
    }
  });
});

describe.skipIf(!outliner)("layout identity, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, control: { path: string; close(): void };
  let key: (k: Key) => void = () => {};
  const AS = "layout-agent-491";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().act({ action, args, reader }, { kind: "user" });
  const get = async () => await act("layout.get") as any;
  const notes: Record<string, any> = {};
  const state = () => join(scratch.root, "door");

  const daily = async () => {
    if (desk) { app.pop(); D().dispose(); }
    desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    app.redraw();
    desk.render(D().ctx);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = state();
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(state(), "draft.md");
    process.env.EDITOR = "tail -f";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    notes.shed = await board.request<any>("create", { parentId: null, text: "Mend the shed roof\nBuy tacks and felt.", author: "agent" });
    writeFileSync(join(state(), "draft.md"), "# Plot draft\n");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    control = await startControl({ app, mirror: new Mirror(200, 60), info: () => term.info }, join(state(), "ctl.sock"));
    app.push(new MainMenu());
    await daily();
  }, 30_000);

  afterAll(async () => {
    control?.close();
    D()?.dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("F17: layout.get gives each split, tab set and tile an id, each split its path, and the layout's revision", async () => {
    const g = await get();
    expect(typeof g.rev).toBe("number");
    expect(g.tree.split).toBe("row");
    expect(g.tree.path).toBe("");
    expect(g.tree.id).toMatch(/^s\d+$/);
    const right = splitOfTiles(g.tree, ["draft", "side"]);
    expect(right.path).toBe("2");
    expect(right.id).toMatch(/^s\d+$/);
    expect(right.kids[0].id).toMatch(/^t\d+$/);
    for (const t of g.tiles) expect(t.id).toMatch(/^t\d+$/);
    expect(new Set(g.tiles.map((t: any) => t.id)).size).toBe(g.tiles.length);
    // The live feed's shape names them the same way.
    expect(D().layoutShape().tree.id).toBe(g.tree.id);
    expect(D().layoutShape().rev).toBe(g.rev);
  });

  test("F17: after the person moves a tile, a stale path with expected= is refused, and the split's id still finds it", async () => {
    const g0 = await get();
    const meant = splitOfTiles(g0.tree, ["draft", "side"]);
    expect(meant.path).toBe("2");
    const others = JSON.stringify(g0.tree);
    // The person moves middle to the left edge: the splits shift under the agent.
    await mine("layout.move", { where: "edge-left" }, "middle");
    const g1 = await get();
    expect(g1.rev).toBeGreaterThan(g0.rev);
    expect(JSON.stringify(g1.tree)).not.toBe(others);
    // The agent's stale path, checked against the revision it read: refused, nothing resized.
    await expect(act("layout.resize", { path: "2", border: 0, share: 0.2, expected: g0.rev })).rejects.toThrow(/layout changed.*revision/);
    expect((await get()).tree).toEqual(g1.tree);
    // By the split's id: the split it meant, wherever it is now.
    const r = await act("layout.resize", { split: meant.id, border: 0, share: 0.2 }) as any;
    expect(r).toMatchObject({ split: meant.id, border: 0, share: 0.2 });
    const after = splitOfTiles((await get()).tree, ["draft", "side"]);
    expect(after.id).toBe(meant.id);
    expect(shares(after)).toEqual([0.2, 0.8]);
    // A resize doesn't change the tree's shape: the revision stays, so the agent's next check still passes.
    expect((await get()).rev).toBe(g1.rev);
    await act("layout.resize", { path: after.path, border: 0, share: 0.3, expected: g1.rev });
    // Without expected=, a path is wherever it points now (the review's evidence: path 2 is another split). The
    // answer names the split it resized and its tiles, so the agent can tell.
    const at2 = (n: any): any => (n.path === "2" ? n : n.kids?.map(at2).find(Boolean));
    expect(at2(g1.tree).id).not.toBe(meant.id);
    const stale = await act("layout.resize", { path: "2", border: 0, share: 0.5 }) as any;
    expect(stale).toMatchObject({ split: at2(g1.tree).id, path: "2" });
    expect(stale.tiles).not.toEqual(["draft", "side"]);
    // A split that's gone is said so.
    await expect(act("layout.resize", { split: "s999", border: 0, share: 0.5 })).rejects.toThrow(/no split s999/);
  });

  test("F17: expected= checks any desk action that names a tile by number", async () => {
    const g = await get();
    await mine("layout.move", { to: "tree", where: "tabs" }, "preview");
    await expect(act("tile.info", { expected: g.rev }, "#1")).rejects.toThrow(/layout changed/);
    await expect(act("tile.info", { expected: "soon" }, "#1")).rejects.toThrow(/expected is the revision/);
    const now = await get();
    expect((await act("tile.info", { expected: now.rev }, "#1") as any).name).toBe(now.tiles[0].name);
    await daily();
  });

  test("F18: a tile can't be named with digits (or like an id); #n is the tile numbered n, t<n> the tile's id", async () => {
    await expect(act("tile.open", { kind: "reader", name: "1" })).rejects.toThrow(/name/);
    await expect(act("tile.open", { kind: "reader", name: "#2" })).rejects.toThrow(/name/);
    await expect(act("tile.open", { kind: "reader", name: "s2" })).rejects.toThrow(/shaped like an id/);
    await expect(act("tile.open", { kind: "reader", name: "t3" })).rejects.toThrow(/name/);
    const g = await get();
    const first = g.tiles[0];
    expect((await act("tile.info", {}, "#1") as any).name).toBe(first.name);
    expect((await act("tile.info", {}, "1") as any).name).toBe(first.name);   // a bare number still works: no name is one
    expect((await act("tile.info", {}, first.id) as any).name).toBe(first.name);
    // An open answers with the tile's name, not its place.
    const o = await act("open", { id: notes.shed.id }, "middle") as any;
    expect(o.reader).toBe("middle");
  });

  test("F18: a tile id stays with its tile through a move; a closed tile's id isn't given to the next one", async () => {
    const g = await get();
    const side = g.tiles.find((t: any) => t.name === "side");
    await mine("layout.move", { to: "tree", where: "left" }, "side");
    expect((await get()).tiles.find((t: any) => t.name === "side").id).toBe(side.id);
    await mine("tile.close", {}, "side");
    const added = await act("tile.open", { kind: "reader", name: "extra" }, "middle") as any;
    expect(added.id).not.toBe(side.id);
    await expect(act("tile.info", {}, side.id)).rejects.toThrow(new RegExp(`no tile ${side.id}`));
    await daily();
  });

  test("F18: the Herdr agent tile is flagged by tile.herdr, not by what its program puts in its title", async () => {
    // The program says the attach title itself: that no longer makes the door think the agent outlives it.
    await act("tile.type", { text: `printf '\\033]2;${attachTitle("door-claude")}\\007'\n` }, "claude");
    await Bun.sleep(300);
    const pane = D().panes.get([...D().names].find(([, n]: any) => n === "claude")![0]);
    expect(pane.herdr).toBeNull();
    expect(D().leaveWarning()).toContain(pane.title());
    // The wrapper says so over the control socket, as the tile it runs in.
    const r = await act("tile.herdr", { pane: "door-claude" }, "claude") as any;
    expect(r).toMatchObject({ tile: "claude", herdr: { pane: "door-claude" } });
    expect((await act("tile.info", {}, "claude") as any).herdr).toEqual({ pane: "door-claude" });
    expect(D().leaveWarning() ?? "").not.toContain(pane.title());
    await expect(act("tile.herdr", { pane: "door-claude" }, "tree")).rejects.toThrow(/terminal tile/);
    await act("tile.herdr", { on: false }, "claude");
    expect(pane.herdr).toBeNull();
  });

  test("F18: an agent's open from a tile lands where that tile's opens go (the daily claude tile links to middle)", async () => {
    const g = await get();
    expect(g.tiles.find((t: any) => t.name === "claude").link).toBe("middle");
    const o = await act("open", { id: notes.shed.id, from: "claude" }) as any;
    expect(o).toMatchObject({ reader: "middle", id: notes.shed.id });
    // Linked elsewhere, the open follows the link: the caller never named middle.
    await act("tile.link", { to: "side" }, "claude");
    expect((await act("open", { id: notes.shed.id, from: "claude" }) as any).reader).toBe("side");
    await expect(act("open", { id: notes.shed.id, from: "nowhere" })).rejects.toThrow(/no tile nowhere/);
    await daily();
  });

  test("a desk.json written before ids, with a tile named by digits, loads: ids given, the name made a name, its links kept", async () => {
    app.pop(); D().dispose();
    mkdirSync(state(), { recursive: true });
    writeFileSync(join(state(), "desk.json"), JSON.stringify({
      focus: 0, rule: "current",
      root: { t: "split", dir: "row", ratio: 0.3, a: { t: "leaf", kind: "tree", name: "tree", link: "2" }, b: { t: "split", dir: "col", ratio: 0.5, a: { t: "leaf", kind: "detail", name: "2" }, b: { t: "leaf", kind: "preview", name: "peek", source: "tile:2" } } },
    }));
    desk = new Desk();
    app.push(desk); app.redraw(); desk.render(D().ctx);
    const g = await get();
    const names = g.tiles.map((t: any) => t.name);
    expect(names).not.toContain("2");
    const renamed = g.tiles.find((t: any) => t.kind === "detail").name;
    expect(renamed).toMatch(/^[A-Za-z]/);
    expect(g.tiles.find((t: any) => t.name === "tree").link).toBe(renamed);
    expect(g.tiles.find((t: any) => t.name === "peek").source).toBe(`tile:${renamed}`);
    expect(g.tree.id).toMatch(/^s\d+$/);
    // Saved again, the ids are written with it, and read back the same.
    await mine("layout.even");
    const again = new Desk();
    expect((await (again as any).layoutGet()).tree.id).toBe(g.tree.id);
    expect((again as any).layoutGet().tiles.map((t: any) => t.id)).toEqual(g.tiles.map((t: any) => t.id));
    again.dispose();
    await daily();
  });

  // Review of #61: a desk.json saved from the daily layout before the claude tile had a link.
  const oldDaily = (withIds: boolean) => ({
    focus: 0, rule: "current", layout: "daily",
    root: {
      t: "split", dir: "row", kids: [
        { t: "leaf", kind: "pty", name: "claude", cmd: ["sh"], ...(withIds ? { id: "t1" } : {}) },
        { t: "split", dir: "col", ratio: 0.5, a: { t: "leaf", kind: "tree", name: "tree", link: "middle", ...(withIds ? { id: "t2" } : {}) }, b: { t: "leaf", kind: "detail", name: "now", link: "middle", ...(withIds ? { id: "t3" } : {}) } },
        { t: "leaf", kind: "detail", name: "middle", ...(withIds ? { id: "t4" } : {}) },
      ], weights: [1, 1, 1],
    },
  });
  const fromSaved = (saved: unknown) => {
    app.pop(); D().dispose();
    writeFileSync(join(state(), "desk.json"), JSON.stringify(saved));
    desk = new Desk();
    app.push(desk); app.redraw(); desk.render(D().ctx);
  };

  test("a daily desk.json saved before ids gets the claude tile's link, so open from=claude lands in middle, not the first reader", async () => {
    fromSaved(oldDaily(false));
    const g = await get();
    expect(g.tiles.find((t: any) => t.name === "claude").link).toBe("middle");
    expect(g.tiles.find((t: any) => t.name === "now").link).toBe("middle");
    expect((await act("open", { id: notes.shed.id, from: "claude" }) as any).reader).toBe("middle");
    // Saved with ids, a desk whose claude tile has no link keeps none: the person's own choice.
    fromSaved(oldDaily(true));
    expect((await get()).tiles.find((t: any) => t.name === "claude").link).toBeUndefined();
    // Review: a "daily" saved in layouts.json before ids is loaded by name, and gets the link the same way.
    const layouts = join(state(), "layouts.json");
    const had = await Bun.file(layouts).exists() ? await Bun.file(layouts).text() : null;
    try {
      writeFileSync(layouts, JSON.stringify({ ...(had ? JSON.parse(had) : {}), daily: { ...oldDaily(false), name: "daily" } }));
      await mine("layout.load", { name: "daily" });
      const g = await get();
      expect(g.tiles.map((t: any) => t.name)).toEqual(["claude", "tree", "now", "middle"]);
      expect(g.tiles.find((t: any) => t.name === "claude").link).toBe("middle");
      expect((await act("open", { id: notes.shed.id, from: "claude" }) as any).reader).toBe("middle");
    } finally { if (had === null) rmSync(layouts, { force: true }); else writeFileSync(layouts, had); }
    await daily();
  });

  // A desk.json shaped like one saved from the daily layout before the agent tile was flagged: the claude tile's
  // command is the plain default, so EP0CH_DAILY_AGENT (the Herdr launcher, say) never took effect on restore.
  const plainDaily = (cmd: string[]) => ({
    focus: 0, rule: "current", layout: "daily", rev: 1, next: { tile: 5, node: 3 },
    root: {
      t: "split", dir: "row", id: "s1", kids: [
        { t: "leaf", kind: "pty", name: "claude", id: "t1", cmd, link: "middle" },
        { t: "split", dir: "col", id: "s2", kids: [{ t: "leaf", kind: "tree", name: "tree", id: "t2", link: "middle" }, { t: "leaf", kind: "pty", name: "draft", id: "t3", cmd: ["tail", "-f", join(state(), "draft.md")] }], weights: [0.6, 0.4] },
        { t: "leaf", kind: "detail", name: "middle", id: "t4" },
      ], weights: [0.34, 0.33, 0.33],
    },
  });
  const cmdOf = async (name: string) => [...D().panes.values()].find((p: any) => p.kind === "pty" && p.run.label === name).run as { cmd: string[]; cwd?: string };
  const withAgent = async (agent: string, cwd: string | undefined, f: () => Promise<void>) => {
    const was = { agent: process.env.EP0CH_DAILY_AGENT, cwd: process.env.EP0CH_DAILY_CWD };
    process.env.EP0CH_DAILY_AGENT = agent;
    if (cwd) process.env.EP0CH_DAILY_CWD = cwd; else delete process.env.EP0CH_DAILY_CWD;
    try { await f(); } finally {
      process.env.EP0CH_DAILY_AGENT = was.agent;
      if (was.cwd === undefined) delete process.env.EP0CH_DAILY_CWD; else process.env.EP0CH_DAILY_CWD = was.cwd;
    }
  };

  test("the daily agent tile runs EP0CH_DAILY_AGENT when restored, not the command it was saved with; a changed command stays", async () => {
    await withAgent("sh -s", state(), async () => {
      // Saved before the flag, with the plain default: it's the agent tile (the migration rule in withDailyAgent).
      fromSaved(plainDaily(["claude"]));
      expect(await cmdOf("claude")).toMatchObject({ cmd: ["sh", "-s"], cwd: state() });
      expect((await cmdOf("draft")).cmd).toEqual(["tail", "-f", join(state(), "draft.md")]);
      // Saved again, it carries the flag; restored under another agent, it runs that one.
      await mine("layout.even");
      const saved = JSON.parse(await Bun.file(join(state(), "desk.json")).text());
      expect(JSON.stringify(saved)).toContain(`"agent":true`);
    });
    await withAgent("sh -e", undefined, async () => {
      fromSaved(JSON.parse(await Bun.file(join(state(), "desk.json")).text()));
      const t = await cmdOf("claude");
      expect(t.cmd).toEqual(["sh", "-e"]);
      expect(t.cwd).toBeUndefined();
      // layout.load of a daily saved in layouts.json the same way.
      const layouts = join(state(), "layouts.json");
      const had = await Bun.file(layouts).exists() ? await Bun.file(layouts).text() : null;
      try {
        writeFileSync(layouts, JSON.stringify({ ...(had ? JSON.parse(had) : {}), daily: { ...plainDaily(["claude"]), name: "daily" } }));
        await mine("layout.load", { name: "daily" });
        expect((await cmdOf("claude")).cmd).toEqual(["sh", "-e"]);
      } finally { if (had === null) rmSync(layouts, { force: true }); else writeFileSync(layouts, had); }
      // A command the person changed isn't the default: it stays theirs.
      fromSaved(plainDaily(["sh", "-u"]));
      expect((await cmdOf("claude")).cmd).toEqual(["sh", "-u"]);
    });
    await daily();
  });

  test("the revision never repeats across a restart, saved or not", async () => {
    const r0 = (await get()).rev;
    await Bun.sleep(2);
    // A door started again without having saved (a named layout it didn't change).
    const again = new Desk(undefined, { layout: "daily" });
    expect((again as any).layoutGet().rev).toBeGreaterThan(r0);
    again.dispose();
    // One that saved: the saved revision is where it goes on from, even with the clock behind it.
    await mine("layout.even");
    writeFileSync(join(state(), "desk.json"), JSON.stringify({ ...JSON.parse(await Bun.file(join(state(), "desk.json")).text()), rev: Date.now() + 60_000 }));
    const later = new Desk();
    expect((later as any).layoutGet().rev).toBeGreaterThan(Date.now() + 59_000);
    later.dispose();
    await daily();
  });

  test("a closed tile's id isn't given to a tile from a saved layout, nor after a restart", async () => {
    await act("layout.save", { name: "keep491" });
    const side = (await get()).tiles.find((t: any) => t.name === "side");
    await mine("tile.close", {}, "side");
    // Saved with side's id in it; loaded after side closed, the side it makes is another tile.
    await mine("layout.load", { name: "keep491" });
    const back = (await get()).tiles.find((t: any) => t.name === "side");
    expect(back.id).not.toBe(side.id);
    // Restarted: the ids go on from the saved ones.
    await mine("tile.close", {}, "side");
    const gone = back.id;
    const again = new Desk();
    const ids = (again as any).layoutGet().tiles.map((t: any) => t.id);
    expect(ids).not.toContain(gone);
    // The next tile made gets a number past every one given before.
    expect((again as any).nextId).toBeGreaterThan(Math.max(Number(gone.slice(1)), Number(side.id.slice(1))));
    again.dispose();
    await daily();
  });

  test("an open by #number is resolved against the layout expected= checked, not one moved while the note was fetched", async () => {
    const g = await get();
    const n = g.tiles.find((t: any) => t.name === "middle").n;
    const slow = board.get.bind(board);
    (board as any).get = async (id: string) => { await Bun.sleep(150); return slow(id); };
    try {
      const opening = act("open", { id: notes.shed.id, expected: g.rev }, `#${n}`);
      await Bun.sleep(30);
      // The person moves middle while the agent's open waits for the service: #n is another tile now.
      await mine("layout.move", { where: "edge-left" }, "middle");
      expect((await get()).tiles.find((t: any) => t.n === n).name).not.toBe("middle");
      expect((await opening as any).reader).toBe("middle");
    } finally { (board as any).get = slow; }
    await daily();
  });
});
