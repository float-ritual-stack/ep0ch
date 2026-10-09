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
    board.subscribe(e => app.event(e));
    await app.whatChanged.seed(board);
  }, 30_000);
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
    await act("reader.hold", { on: true }, "reader10");
    reader("reader10").hold(notes.plan!, desk as any);
    expect(tile("reader9")).toMatchObject({ link: "reader10" });
    await act("changes.open", {}).catch(() => {});
  };

  const shows = () => ({ r9: showing("reader9"), r10: showing("reader10") });
  const id = (n: string) => notes[n]!.id;

  test("setup: three notes changed, the chain is reader9 (follows) → reader10 (held on the plan)", async () => {
    for (const n of ["hens", "beans", "gate"]) await edit(n, `${notes[n]!.text.split("\n")[0]}\nchanged`);
    await until(() => app.whatChanged.count() === 3, "three changes");
    await app.act({ action: "changes.open", args: {}, as: "test-agent" });
    await setup();
    expect(list()).toBeDefined();
    expect(shows()).toEqual({ r9: id("start"), r10: id("plan") });
    expect(reader("reader10").holding).toBe(true);
    expect(reader("reader9").holding).toBe(false);
  });

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
  });
});
