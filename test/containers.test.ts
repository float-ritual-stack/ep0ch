// PIE-505: containers with policy on the desk, against a scratch outline. The tree goes in a left-edge drawer,
// claude and a detail are dropped into the same drawer (a drag onto its handle, and layout.move), the screen is
// locked (alt+k, the chip, act) and a locked drag or border drag is refused with the reason; a container's policy
// (accepts, draggable, opens-into) is set by act and by the ^W P panel; the drawer and the lock come back after a
// restart; an old layout's drawer flags are read as drawer containers; and a tile kind registered from outside
// (one the service draws) opens, saves and comes back like a built-in. Scratch services, fictional notes, `sh` only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { migrateDrawers } from "../src/desk/tiles";
import { registerTileKind, serviceKind, unregisterTileKind, kindForKey, kindsChanged } from "../src/desk/tile-kinds";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { terminalDay } from "./terminal-day";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const alt = (ch: string): Key => ({ kind: "alt", ch });

describe("an old layout's drawer flags", () => {
  test("a tile marked over or shut is read as a drawer container where it was, open or shut", () => {
    const spec = migrateDrawers({ root: { t: "split", dir: "row", ratio: 0.3, a: { t: "leaf", kind: "tree", name: "tree", drawer: "shut" }, b: { t: "split", dir: "col", kids: [{ t: "leaf", kind: "reader", name: "r" }, { t: "tabs", tabs: [{ t: "leaf", kind: "detail", name: "d", drawer: "over" }, { t: "leaf", kind: "detail", name: "e", drawer: "over" }], active: 0 }], weights: [1, 1] } } as any });
    const root = spec.root as any;
    expect(root.a).toEqual({ t: "drawer", edge: "left", open: false, kid: { t: "leaf", kind: "tree", name: "tree" } });
    expect(root.b.kids[1].t).toBe("drawer");
    expect(root.b.kids[1].edge).toBe("down");
    expect(root.b.kids[1].open).toBe(true);
    expect(root.b.kids[1].kid.tabs.map((l: any) => l.drawer)).toEqual([undefined, undefined]);
    const same = { root: { t: "leaf", kind: "tree" } } as any;
    expect(migrateDrawers(same)).toBe(same);
  });
});

describe.skipIf(!outliner)("containers with policy on the desk", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "container-agent-505";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, reader }, { kind: "user" });
  const message = () => (app as any).message as string;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; locked: boolean; rev: number };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const rect = (name: string) => { render(); return tile(name).rect as { col: number; row: number; cols: number; rows: number }; };
  const idOf = (name: string) => [...D().names].find(([, v]: any) => v === name)![0] as number;
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const drag = (x0: number, y0: number, x1: number, y1: number) => { render(); mouse("down", x0, y0); mouse("drag", x0 + 1, y0); render(); mouse("drag", x1, y1); render(); mouse("up", x1, y1); render(); };
  /** The tree as a short string: drawers as drawer<edge>(…). */
  const s = (n: any): string => n.pane ?? (n.tabs ? `tabs(${n.tabs.join(",")})` : n.drawer ? `drawer<${n.drawer}>(${s(n.kid)})` : `${n.split}(${n.kids.map(s).join(",")})`);
  const shape = () => s(get().tree);
  const HINT = 58;
  const state = () => join(scratch.root, "door");

  beforeAll(async () => {
    process.env.EP0CH_STATE = state();
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    process.env.EP0CH_NOW_PAGE = "plot-now";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request<any>("create", { parentId: null, text: "Turn the compost\nTwice this week.", author: "agent" });
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: terminalDay() });
    app.push(desk);
    render();
    await until(() => tile("claude")?.terminal?.running, "the daily agent tile");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR", "EP0CH_NOW_PAGE"]) delete process.env[k];
  });

  test("^W p puts a tile in a drawer where it is, sliding from its edge; ^W p again docks it", () => {
    D().focus = idOf("preview");
    const before = shape();
    key(ctrl("w")); key(char("p"));
    expect(tile("preview").drawer).toBe("open");
    expect(tile("preview").edge).toBe("up");                       // the middle of a column: from its top
    expect(shape()).toContain("drawer<up>(preview)");
    expect(D().render(D().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "")).toContain("⤒ drawer");
    key(ctrl("w")); key(char("p"));
    expect(tile("preview").drawer).toBeUndefined();
    expect(shape()).toBe(before);
  });

  test("the tree in a left-edge drawer; claude dropped on its handle and a detail moved beside it live in the same drawer", async () => {
    const r = await act("tile.pin", { edge: "left" }, "tree") as any;
    expect(r).toMatchObject({ pinned: false, edge: "left" });
    expect(shape()).toMatch(/^row\(drawer<left>\(tree\),/);
    expect(tile("tree").drawer).toBe("shut");                       // an agent's drawer starts shut: the person's keys stay put
    expect(message()).toContain("an agent (container-agent-505) put tree in a drawer on the left");
    // The person drags claude's header onto the drawer's handle on the hint row: it goes in, with the tree.
    render();
    const h = D().handles.find((x: any) => x.id === idOf("tree"));
    expect(h).toBeTruthy();
    const c = rect("claude");
    render(); mouse("down", c.col + 4, c.row); mouse("drag", c.col + 6, c.row); render(); mouse("drag", h.from + 1, HINT); render();
    expect(D().describe().dragging.drop).toMatchObject({ kind: "tabs", target: "tree" });
    mouse("up", h.from + 1, HINT); render();
    expect(shape()).toMatch(/^row\(drawer<left>\(tabs\(tree,claude\)\),/);
    expect(tile("claude").drawer).toBe("open");                     // the person's drop opens it on what they dropped
    // A detail moved beside claude lives in the drawer too.
    await mine("layout.move", { to: "claude", where: "down" }, "now");
    expect(shape()).toMatch(/^row\(drawer<left>\(col\(tabs\(tree,claude\),now\)\),/);
    expect(tile("now").drawer).toBe("open");
    // The keys leave the drawer: it slides shut, one handle for all three; Tab never lands in it while shut.
    await mine("tile.focus", {}, "middle");
    key({ kind: "tab" });
    expect(tile("now").drawer).toBe("shut");
    render();
    expect(D().render(D().ctx).lines[HINT]!.replace(/\x1b\[[\d;]*m/g, "")).toContain("⇤ claude+now");                // what it shows: claude's tab, and now
    for (let i = 0; i < 6; i++) { key({ kind: "tab" }); expect(["tree", "claude", "now"]).not.toContain(get().focus); }
  });

  test("a board-like arrangement locked by alt+k: a drag, a border drag and an agent's move are refused, with the reason", async () => {
    // A board-like shape: middle and side as two columns beside each other.
    await mine("layout.move", { to: "middle", where: "right" }, "side");
    key(alt("k"));
    expect(get().locked).toBe(true);
    render();
    expect(D().render(D().ctx).lines[HINT]!.replace(/\x1b\[[\d;]*m/g, "")).toContain("▣ locked");
    const before = shape();
    // A header dragged onto another tile: the ghost says why, and the release does nothing.
    const sd = rect("side"), md = rect("middle");
    mouse("down", sd.col + 4, sd.row); mouse("drag", sd.col + 6, sd.row); render(); mouse("drag", md.col + 3, md.row + Math.floor(md.rows / 2)); render();
    expect(D().render(D().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "")).toContain("✕ the screen is locked");
    mouse("up", md.col + 3, md.row + Math.floor(md.rows / 2)); render();
    expect(shape()).toBe(before);
    expect(message()).toContain("the screen is locked: moving side is refused · alt+k or a click on ▣ locked unlocks it");
    // The border between middle and side: pressed, it doesn't follow the pointer, and says why.
    const at = md.col + md.cols;
    const share = JSON.stringify(get().tree);
    mouse("down", at, md.row + 5); mouse("drag", at - 10, md.row + 5); mouse("up", at - 10, md.row + 5);
    expect(JSON.stringify(get().tree)).toBe(share);
    expect(message()).toContain("the screen is locked: resizing is refused");
    // Agents are refused the same way, by the same rule; reading and the drawer still work (the contents are live).
    await expect(act("layout.move", { to: "middle", where: "tabs" }, "side")).rejects.toThrow(/the screen is locked: moving side is refused/);
    await expect(act("pane.resize", { by: 2 }, "side")).rejects.toThrow(/locked/);
    await expect(act("tile.close", {}, "middle")).rejects.toThrow(/closing middle is refused/);
    await expect(mine("layout.load", { name: "river" })).rejects.toThrow(/the screen is locked: loading river/);
    await expect(mine("tile.open", { kind: "reader" }, "middle")).rejects.toThrow(/locked/);
    await mine("tile.drawer", { open: true }, "tree");
    expect(tile("tree").drawer).toBe("open");
    await mine("tile.drawer", { open: false }, "tree");
  });

  test("the lock and the drawer come back after a restart; a click on the chip unlocks", async () => {
    const saved = JSON.parse(readFileSync(join(state(), "desk.json"), "utf8"));
    expect(saved.policy).toEqual({ locked: true });
    expect(JSON.stringify(saved.root)).toContain(`"t":"drawer","edge":"left"`);
    const before = shape();
    // A second desk from desk.json, as a restarted door builds it (its programs are its own; the first one's stay).
    const again = new Desk() as any;
    again.ctx = D().ctx;
    const g = again.layoutGet();
    expect(g.locked).toBe(true);
    expect(s(g.tree)).toBe(before);
    expect(g.tiles.find((t: any) => t.name === "now").drawer).toBe("shut");
    for (const p of again.panes.values()) p?.dispose?.();
    // The chip: a click unlocks (layout.lock, as the person).
    render();
    const chip = D().lockChip;
    mouse("down", chip.from + 1, HINT);
    expect(get().locked).toBe(false);
    expect(message()).toBe("unlocked the screen");
  });

  test("a container's policy: accepts and draggable refuse with the reason; opens-into routes its tiles' opens", async () => {
    const drawerId = get().tiles.find((t: any) => t.name === "tree").container;
    expect(drawerId).toMatch(/^d\d+$/);
    await act("layout.policy", { node: drawerId, accepts: "tree,pty" });
    await expect(mine("layout.move", { to: "now", where: "down" }, "side")).rejects.toThrow(new RegExp(`${drawerId} takes only tree, pty: not side \\(detail\\)`));
    await expect(act("layout.policy", { node: drawerId, accepts: "compost" })).rejects.toThrow(/accepts names tile kinds/);
    await act("layout.policy", { node: drawerId, draggable: false });
    await expect(mine("layout.move", { where: "edge-right" }, "now")).rejects.toThrow(new RegExp(`now stays where it is: ${drawerId} keeps its tiles \\(draggable off\\)`));
    await act("layout.policy", { node: drawerId, clear: "accepts,draggable" });
    // The tree's own link taken away, the drawer's opens-into says where its opens land.
    await mine("tile.link", {}, "tree");
    expect(tile("tree").link).toBeUndefined();
    await act("layout.policy", { node: drawerId, opensInto: "middle" });
    expect(tile("tree").link).toBe("middle");
    expect(tile("tree").linkFrom).toBe("opensInto");
    await expect(act("layout.policy", { node: drawerId, opensInto: "claude" })).rejects.toThrow(/opens land in a tile that takes notes/);
    // Read back: each layer, and what applies.
    const r = await act("layout.policy", {}, "tree") as any;
    expect(r.effective.opensInto).toBe("middle");
    expect(r.containers[0]).toBe("screen");
  });

  test("^W P: the policy panel's rows change the policy by keys and by a click; esc closes it", () => {
    D().focus = idOf("middle");
    key(ctrl("w")); key(char("P"));
    render();
    let drawn = D().render(D().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    expect(drawn).toContain("policy");
    expect(drawn).toContain("locked · the shape is fixed");
    for (let i = 0; i < 6; i++) key({ kind: "left" });              // out to the screen
    key({ kind: "enter" });                                         // the locked row: locks the screen
    expect(get().locked).toBe(true);
    // A click on the same row unlocks it.
    render();
    const row = D().policyPanel.hits.rows[0];
    mouse("down", D().policyPanel.hits.rect.col + 3, row.y);
    expect(get().locked).toBe(false);
    key({ kind: "esc" });
    expect(D().policyPanel).toBeNull();
  });

  test("a tile kind registered from outside (drawn by the service) opens by key and act, saves and comes back", async () => {
    const asked: any[] = [];
    registerTileKind(serviceKind({
      kind: "plot.beds", about: "the beds on the allotment, drawn by the service",
      keys: [{ key: "g", label: "beds" }],
      policy: { draggable: false },
      render: async req => { asked.push(req); return { lines: [`beds: ${String(req.state.plot ?? "all")} · ${req.cols}x${req.rows}`], title: "beds" }; },
    }));
    try {
      expect(() => registerTileKind(serviceKind({ kind: "tree", about: "a second tree", render: async () => ({ lines: [] }) }))).toThrow(/registered already/);
      expect(kindForKey("g")!.kind.kind).toBe("plot.beds");
      D().focus = idOf("middle");
      key(ctrl("w")); key(char("o")); key(char("g"));
      expect(tile("plot.beds")).toMatchObject({ kind: "plot.beds" });
      render();
      await until(() => asked.length > 0, "the service asked to draw");
      render();
      expect(D().render(D().ctx).lines.join("\n")).toContain("beds: all");
      // Its kind's default policy applies under its containers': it stays where it is.
      await expect(mine("layout.move", { where: "edge-left" }, "plot.beds")).rejects.toThrow(/plot.beds stays where it is: plot.beds tiles keep/);
      await mine("layout.save", { name: "plot" });
      const saved = JSON.stringify(JSON.parse(readFileSync(join(state(), "layouts.json"), "utf8")).plot);
      expect(saved).toContain(`"kind":"plot.beds"`);
      // tile.open by an agent, with state the service gets back.
      await act("tile.open", { kind: "reader", name: "spare" }, "middle");
      expect(tile("spare").kind).toBe("reader");
      await expect(act("tile.open", { kind: "compost.heap" }, "middle")).rejects.toThrow(/kind is tree, reader, .*plot\.beds, not compost\.heap/);
    } finally {
      await mine("tile.close", {}, "plot.beds").catch(() => {});
      unregisterTileKind("plot.beds");
    }
    // Unregistered, a saved tile of that kind comes back saying its kind isn't here (PIE-512), not as something else.
    const spec = JSON.parse(readFileSync(join(state(), "layouts.json"), "utf8")).plot;
    writeFileSync(join(state(), "layouts.json"), JSON.stringify({ plot: spec }));
    await mine("layout.load", { name: "plot" });
    expect(tile("plot.beds")).toMatchObject({ kind: "plot.beds", unregistered: "plot.beds", title: "plot.beds · unavailable" });
    const says = () => (D() as any).panes.get(idOf("plot.beds")).render(200, 10, false, D()).lines.join("\n");
    expect(says()).toContain("plot.beds isn't available here: it was taken out");
    // Saved again, its spec is as it was: it comes back as itself once its kind registers.
    await mine("layout.save", { name: "plot" });
    expect(JSON.stringify(JSON.parse(readFileSync(join(state(), "layouts.json"), "utf8")).plot)).toContain(`"kind":"plot.beds"`);
    registerTileKind(serviceKind({ kind: "plot.beds", about: "the beds again", render: async () => ({ lines: ["beds are back"], title: "beds" }) }));
    try {
      kindsChanged();
      expect(tile("plot.beds").unregistered).toBeUndefined();
      expect(tile("plot.beds").title).not.toContain("unavailable");
    } finally { unregisterTileKind("plot.beds", "the test took it out"); kindsChanged(); }
    // Gone while shown: the tile says why, in its place.
    expect(tile("plot.beds")).toMatchObject({ kind: "plot.beds", unregistered: "plot.beds" });
    expect(says()).toContain("the test took it out");
  });

  test("review: a drawer's border sizes only it; an agent's drawer or move never hides the person's tile; a drawer's own resizable", async () => {
    await mine("layout.load", { name: "desk" });                    // row(tree, row(reader, col(thread, activity)))
    await mine("tile.pin", { edge: "left" }, "thread");
    const g = get(); const root = g.tree;
    expect(root.kids[0].drawer).toBe("left");
    const shares = () => get().tree.kids.slice(1).map((k: any) => k.share);
    const before = shares(), ratio = before[0] / before[1];
    const r = await mine("layout.resize", { split: root.id, border: 0, share: 0.5 }) as any;
    expect(r.split).toBe(root.id);
    const after = shares();
    expect(after[0]).not.toBe(before[0]);   // the docked tiles grew together (the drawer took less)
    expect(after[0] / after[1]).toBeCloseTo(ratio, 1);            // the docked tiles keep their shares
    // A drawer whose own policy keeps its size: its border is refused.
    await act("layout.policy", { node: root.kids[0].id, resizable: false });
    await expect(mine("layout.resize", { split: root.id, border: 0, share: 0.3 })).rejects.toThrow(/keeps its size \(resizable off\)/);
    await act("layout.policy", { node: root.kids[0].id, clear: "resizable" });
    // The person's focused tile, moved by an agent beside a tile in a shut drawer: the drawer opens, it stays in view.
    await mine("tile.focus", {}, "reader");
    await mine("tile.drawer", { open: false }, "thread");
    await act("layout.move", { to: "thread", where: "down" }, "reader");
    expect(tile("reader").drawer).toBe("open");
    expect(tile("reader").shown).toBe(true);
    // An agent pinning a tab beside the person's tab: the drawer it makes starts open, holding their tile.
    await mine("layout.load", { name: "desk" });
    await mine("layout.move", { to: "activity", where: "tabs" }, "thread");
    await mine("tile.focus", {}, "activity");
    await act("tile.pin", { on: false }, "thread");
    expect(tile("activity").drawer).toBe("open");
    // A tile dropped beside a tab set isn't refused by the tab set's own policy (it doesn't join it).
    const set = get().tiles.find((t: any) => t.name === "activity");
    const gid = JSON.stringify(get().tree).match(/"tabs":\["(?:thread|activity)","(?:thread|activity)"\],"id":"(g\d+)"/)![1];
    await act("tile.pin", { on: true }, "thread");
    await act("layout.policy", { node: gid, droppable: false });
    await mine("layout.move", { to: "activity", where: "left" }, "tree");
    await expect(mine("layout.move", { to: "activity", where: "tabs" }, "reader")).rejects.toThrow(/takes no drops/);
    void set;
  });
});
