// PIE-700: a chain of linked readers. The what-changed list (in the drawer) opens into reader9 (which follows the
// current note), reader9's links open into reader10 (held), and opening into reader9 never moves reader10, whichever
// tile the person's keys were last in. A scratch service; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard, type Actor } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const AGENT: Actor = { kind: "agent", id: "fern-agent" };

describe.skipIf(!outliner)("a chain of linked readers", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const notes: Record<string, Msg> = {};
  const heard: string[] = [];
  const saved: Record<string, string | undefined> = {};
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { focus: string; tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const reader = (name: string) => desk.pane(name) as ReaderPane;
  const showing = (name: string) => reader(name).msg?.id;
  const edit = async (name: string, text: string) => {
    const m = await board.get(notes[name]!.id);
    notes[name] = await board.update(m!.id, text, m!.revision!, AGENT);
  };
  /** The what-changed list's tab in the drawer, and its row for a note. */
  const list = () => app.drawer.tabs().find(t => t.kind === "what-changed")!;
  const listPane = () => (app.drawer as any).d.pane(list().name);
  const rowFor = (name: string) => listPane().rows().findIndex((r: any) => r.blockId === notes[name]!.id) + 1;
  const goInList = (name: string, fresh = false) => app.dispatch.press("changes.go", { n: rowFor(name), ...(fresh ? { fresh: true } : {}) }, list().name);

  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    const cat = join(scratch.root, "claude");
    writeFileSync(cat, "#!/bin/sh\nexec cat \"$@\"\n"); chmodSync(cat, 0o755);
    process.env.EP0CH_DAILY_AGENT = cat;
    board = new SocketBoard(await scratch.start());
    await board.info();
    notes.hens = await board.createBlock(null, "Hens\nfirst text");
    notes.beans = await board.createBlock(null, "Beans\nfirst text");
    notes.gate = await board.createBlock(null, "Gate\nfirst text");
    notes.shed = await board.createBlock(null, "Shed\nfirst text");
    notes.plan = await board.createBlock(null, `Plan\nFirst ((${notes.beans.id}|beans)), then ((${notes.shed.id}|shed)).`);
    notes.start = await board.createBlock(null, "Start\nthe first note");
    const term: any = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term, board, Date.now(), () => {});
    app.whatChanged.outline = "scratch";
    board.subscribe(e => { heard.push(`${e.action}:${(e as any).change?.actor?.author}:${(e as any).change?.sequence}`); app.event(e); });
    await app.whatChanged.seed(board);
    // The subscription is live once an event of the person's own (news to nobody) comes back.
    const probe = await board.get(notes.start!.id);
    await board.update(probe!.id, "Start\nthe first note", probe!.revision!, { kind: "user" });
    await until(() => heard.length > 0, "the feed's first event", 15_000);
  }, 40_000);
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  /** Reader9 follows the current note and links to reader10, which is held on the plan; the owner's layout. */
  const setup = async () => {
    desk = new Desk({
      name: "chain", title: "chain",
      layout: { root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "reader", name: "reader9" }, b: { t: "leaf", kind: "reader", name: "reader10" } } },
    });
    app.push(desk);
    render();
    desk.setCurrent(notes.start!);
    await until(() => showing("reader9") === notes.start!.id, "reader9 on the start note");
    await act("tile.link", { to: "reader10" }, "reader9");
    reader("reader10").hold(notes.plan!, desk as any);
    expect(tile("reader9")).toMatchObject({ link: "reader10" });
  };
  /** What a tile's frame says of its chain (layout.get's `chain`). */
  const chain = (d: any, name: string): string => (d.layoutGet().tiles.find((x: any) => x.name === name)?.chain as string | undefined) ?? "";
  const shows = () => ({ r9: showing("reader9"), r10: showing("reader10") });
  const id = (n: string) => notes[n]!.id;
  const drawerDesk = () => (app.drawer as any).d as Desk;
  const dact = (action: string, args: Record<string, unknown> = {}, tileName?: string) => (drawerDesk() as any).dispatch.act({ action, args, tile: tileName }, { kind: "user" }) as Promise<any>;
  const paint = () => { (app as any).paint(); };
  /** The cell in the middle of a tile of the screen (after a paint). */
  const centre = (name: string) => { paint(); const r = tile(name).rect as { col: number; row: number; cols: number; rows: number }; return { x: r.col + Math.floor(r.cols / 2), y: r.row + Math.floor(r.rows / 2) }; };

  test("setup: three notes changed, the chain is reader9 (follows) → reader10 (held on the plan)", async () => {
    // One at a time, each heard before the next: the feed's events arrive as they come.
    let n = 0;
    for (const name of ["hens", "beans", "gate"]) { await edit(name, `${notes[name]!.text.split("\n")[0]}\nchanged`); n++; await until(() => app.whatChanged.count() >= n, `change ${n} heard (heard ${heard.join(" ")})`, 8_000); }
    expect(app.whatChanged.count()).toBe(3);
    await app.act({ action: "changes.open", args: {}, as: "test-agent" });
    await setup();
    expect(list()).toBeDefined();
    expect(shows()).toEqual({ r9: id("start"), r10: id("plan") });
    expect(reader("reader10").holding).toBe(true);
    expect(reader("reader9").holding).toBe(false);
  }, 30_000);

  describe("without a link from what-changed: the documented rule, from wherever the keys were last", () => {
    test("1. focus 9, follow a link in it: it opens in 10, 9 stays", async () => {
      await act("tile.focus", {}, "reader9");
      desk.setCurrent(notes.beans!, { from: reader("reader9"), link: true });
      await until(() => showing("reader10") === id("beans"), "the link opened in reader10");
      expect(shows()).toEqual({ r9: id("start"), r10: id("beans") });
    });

    test("2. focus last on 10 (held), what-changed ⏎: opens in 9, 10 stays", async () => {
      await act("tile.focus", {}, "reader10");
      await goInList("hens");
      await until(() => showing("reader9") === id("hens"), "reader9 on hens");
      expect(shows()).toEqual({ r9: id("hens"), r10: id("beans") });
    });

    test("3. focus 9 (no navigating), what-changed ⏎: opens in 9 only, 10 never moves", async () => {
      await act("tile.focus", {}, "reader9");
      await goInList("gate");
      await until(() => showing("reader9") === id("gate"), "reader9 on gate");
      expect(shows()).toEqual({ r9: id("gate"), r10: id("beans") });
    });

    test("4. focus 10, what-changed ⏎: only 9 changes", async () => {
      await act("tile.focus", {}, "reader10");
      await goInList("beans");
      await until(() => showing("reader9") === id("beans"), "reader9 on beans");
      expect(shows()).toEqual({ r9: id("beans"), r10: id("beans") });
      await goInList("hens");
      await until(() => showing("reader9") === id("hens"), "reader9 on hens");
      expect(showing("reader10")).toBe(id("beans"));
    });

    test("the frames say the chain: reader9 → reader10, reader10 ← reader9, which reader the list's ⏎ lands in", () => {
      paint();
      const lines = (app as any).lastLines as string[] | undefined;
      void lines;
      expect(chain(D(), "reader10")).toContain("← reader9");
      expect(chain(D(), "reader9")).toContain("opens land here");
      expect(chain(drawerDesk(), "what-changed")).toContain("⏎ → reader9");
    });
  });

  describe("with a link from what-changed (the drawer split: agent and what-changed side by side)", () => {
    test("the owner's drawer: the agent and what-changed side by side, linked to reader9 (act), reader9 linked to reader10", async () => {
      await dact("layout.move", { to: "drawer.agent", where: "right" }, "what-changed");
      const g = (drawerDesk() as any).layoutGet();
      expect(JSON.stringify(g.tree)).toContain("what-changed");
      expect(g.tree.split ?? g.tree.kids).toBeDefined();
      const done = await dact("tile.link", { to: "@chain/reader9" }, "what-changed");
      expect(done).toMatchObject({ tile: "what-changed", link: "@chain/reader9" });
      const t = (drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed");
      expect(t).toMatchObject({ link: "@chain/reader9", linkAcross: "true" });
      expect(tile("reader9")).toMatchObject({ link: "reader10" });
      // The frames, both ends of the link.
      expect(chain(drawerDesk(), "what-changed")).toBe("");
      expect(chain(D(), "reader9")).toContain("← what-changed");
      expect(chain(D(), "reader10")).toContain("← reader9");
      // A tile that takes no notes is no end of a link.
      await expect(dact("tile.link", { to: "@chain/nowhere" }, "what-changed")).rejects.toThrow(/no tile/);
    });

    for (const [focus, note] of [["reader10", "gate"], ["reader9", "hens"], ["reader10", "beans"], ["reader9", "gate"]] as const) {
      test(`⏎ lands in reader9 and never moves reader10, with the screen's keys last in ${focus} (${note})`, async () => {
        await act("tile.focus", {}, focus);
        const ten = showing("reader10");
        await goInList(note);
        await until(() => showing("reader9") === id(note), `reader9 on ${note}`);
        expect(showing("reader10")).toBe(ten);
        expect(get().focus).toBe(focus);
      });
    }

    test("following a link in reader9 still opens reader10; opening into reader9 again leaves it", async () => {
      await act("tile.focus", {}, "reader9");
      desk.setCurrent(notes.shed!, { from: reader("reader9"), link: true });
      await until(() => showing("reader10") === id("shed"), "reader10 on the shed");
      expect(showing("reader9")).toBe(id("gate"));
      await goInList("hens");
      await until(() => showing("reader9") === id("hens"), "reader9 on hens");
      expect(showing("reader10")).toBe(id("shed"));
    });

    test("an agent's ⏎ through act opens there too, and the person's keys stay", async () => {
      await act("tile.focus", {}, "reader10");
      await app.dispatch.press("changes.go", { n: rowFor("beans") }, list().name);
      await until(() => showing("reader9") === id("beans"), "reader9 on beans");
      expect(get().focus).toBe("reader10");
    });

    test("the link, not the rule, decides: linked to reader10 the list's ⏎ lands there whatever has the keys, then back to reader9", async () => {
      await dact("tile.link", { to: "@chain/reader10" }, "what-changed");
      await act("tile.focus", {}, "reader9");
      const nine = showing("reader9");
      await goInList("hens");
      await until(() => showing("reader10") === id("hens"), "reader10 on hens");
      expect(showing("reader9")).toBe(nine);
      await dact("tile.link", { to: "@chain/reader9" }, "what-changed");
      await goInList("beans");
      await until(() => showing("reader9") === id("beans"), "reader9 on beans");
      expect(showing("reader10")).toBe(id("hens"));
    });

    test("the link survives the drawer shut and pulled up again", async () => {
      app.drawer.set(false, { kind: "user" });
      app.drawer.set(true, { kind: "user" });
      expect((drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed")).toMatchObject({ link: "@chain/reader9" });
      await act("tile.focus", {}, "reader9");
      await goInList("gate");
      await until(() => showing("reader9") === id("gate"), "reader9 on gate");
      expect(showing("reader10")).toBe(id("hens"));
    });

    test("the link waits while another screen is shown, and is back with the screen", async () => {
      const other = new Desk({ name: "elsewhere", title: "elsewhere", layout: { root: { t: "leaf", kind: "reader", name: "reader9" } } });
      app.push(other);
      other.render((other as any).ctx ?? (desk as any).ctx);
      expect(chain(drawerDesk(), "what-changed")).not.toContain("reader9 (elsewhere)");
      // The other screen has a reader9 of its own: the link is by the screen's name, so it is not that one.
      await goInList("beans");
      await until(() => showing("reader9") === id("beans") || (other.pane("reader9") as ReaderPane).msg?.id === id("beans"), "an open somewhere");
      expect((other.pane("reader9") as ReaderPane).msg?.id).toBe(id("beans"));
      expect(showing("reader9")).toBe(id("gate"));
      app.pop();
      expect(chain(drawerDesk(), "what-changed")).toBe("");
    });

    test("saved and restored: the drawer's link and the screen's chain come back in the next door", async () => {
      const saved = JSON.stringify((drawerDesk() as any).saved());
      expect(saved).toContain(`"link":"@chain/reader9"`);
      const two = new App({ info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} } as any, board, Date.now(), () => {});
      try {
        const again = new Desk({
          name: "chain", title: "chain",
          layout: { root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "reader", name: "reader9", link: "reader10" }, b: { t: "leaf", kind: "reader", name: "reader10" } } },
        });
        two.push(again);
        two.drawer.set(true, { kind: "user" });
        const back = two.drawer.desk!;
        expect((back as any).layoutGet().tiles.find((x: any) => x.name === "what-changed")).toMatchObject({ link: "@chain/reader9" });
        expect((again as any).layoutGet().tiles.find((x: any) => x.name === "reader9")).toMatchObject({ link: "reader10" });
      } finally { two.quit(); }
    });

    test("alt+l in the drawer, then a click on a reader above, links the list to it; esc cancels; the keys stay in the drawer", async () => {
      await dact("tile.link", {}, "what-changed");                              // unlinked
      expect((drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed").link).toBeUndefined();
      app.drawer.enter();
      await dact("tile.focus", {}, "what-changed");
      key({ kind: "alt", ch: "l" });
      expect(drawerDesk().linkingFrom()).toBeTruthy();
      const at = centre("reader10");
      key({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
      await until(() => !drawerDesk().linkingFrom() && !!(drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed").link, "linked");
      expect((drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed")).toMatchObject({ link: "@chain/reader10" });
      expect(app.drawer.entered).toBe(true);
      // Cancel with esc.
      await dact("tile.focus", {}, "what-changed");
      key({ kind: "alt", ch: "l" });
      expect(drawerDesk().linkingFrom()).toBeTruthy();
      key({ kind: "esc" });
      expect(drawerDesk().linkingFrom()).toBeNull();
      // Relink to reader9 by its number (the screen's second... first tile).
      await dact("tile.focus", {}, "what-changed");
      key({ kind: "alt", ch: "l" });
      expect(drawerDesk().linkingFrom()).toBeTruthy();
      key({ kind: "char", ch: "1" });
      expect(drawerDesk().linkingFrom()).toBeNull();
      expect((drawerDesk() as any).layoutGet().tiles.find((x: any) => x.name === "what-changed")).toMatchObject({ link: "@chain/reader9" });
    });

    test("alt+l on a screen tile, then a click on a note-taking tile in the drawer (the reverse), links across the edge", async () => {
      app.drawer.leave(desk as any, false);
      const moved = await act("tile.drawer", { on: true }, "reader10");
      expect(moved).not.toBeNull();
      expect(drawerDesk().pane("reader10")).toBeDefined();
      const p = await act("tile.link", { to: "@drawer/reader10" }, "reader9");
      expect(p).toMatchObject({ link: "@drawer/reader10" });
    });
  });
});
