// PIE-513: a flow on the desk. A screen saved with a flow container (the river's columns on the one engine) opens
// a followed link in a new column right after its own, the person's keys going there and an agent's staying put;
// the wide column moves only on `^W W` (tile.widen) or a click on a spine; the flow and its memory come back after
// a restart. The flow's own behaviours are tested through the module in flow.test.ts; here, the desk's paths into
// it. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("a flow on the desk, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const info = { cols: 220, rows: 50, cellW: 9, cellH: 16, kitty: false };
  const AS = "flow-agent-513";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[] };
  const flow = () => get().tree.kids.find((k: any) => k.flow);
  const columns = () => flow().kids.map((k: any) => k.pane ?? k.kids?.map((x: any) => x.pane).join("+")) as string[];
  const tile = (name: string) => { render(); return get().tiles.find((t: any) => t.name === name); };
  const pane = (name: string) => D().panes.get([...D().names].find(([, v]: any) => v === name)![0]);
  const follow = async (name: string, actor: { kind: string; id?: string } = { kind: "user" }) => {
    const p = pane(name);
    await p.surface.whole();
    render();
    await p.act("link.follow", { n: 1 }, D(), actor);
  };
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = async (text: string) => board.request<any>("create", { parentId: null, text, author: "agent" });
    notes.tide = await mk("Tide table\nLow water at noon.");
    notes.boat = await mk(`Boat check\nBefore launch, read ((${notes.tide.id})).`);
    notes.trip = await mk(`Ferry trip\nPack light; first ((${notes.boat.id})).`);
    // A screen saved as data: the outline tree beside a flow of readers (its rule: opens into the next column).
    mkdirSync(join(scratch.root, "door"), { recursive: true });
    writeFileSync(join(scratch.root, "door", "layouts.json"), JSON.stringify({
      quay: { name: "quay", focus: "c1", root: { t: "split", dir: "row", kids: [{ t: "leaf", kind: "tree", name: "tree", link: "c1" }, { t: "flow", kids: [{ t: "leaf", kind: "reader", name: "c1" }] }], weights: [0.2, 0.8] } },
    }));
    const term = { info, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: "quay" });
    app.push(desk);
    render();
  }, 30_000);
  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a followed link opens in the next column; the person's keys go there, an agent's follow leaves them", async () => {
    expect(flow()).toBeTruthy();
    await mine("open", { id: notes.trip.id }, "c1");
    await until(() => tile("c1")?.showing?.id === notes.trip.id, "the trip in c1");
    await follow("c1");
    await until(() => columns().length === 2, "a second column");
    const second = columns()[1]!;
    expect(tile(second).showing.id).toBe(notes.boat.id);
    expect(get().focus).toBe(second);
    expect(tile("c1").showing.id).toBe(notes.trip.id);             // the column it came from keeps its note
    // An agent's follow in the column the person has is refused (round 3, C3); it opens from there instead: a third
    // column, the person's keys where they were.
    await expect(follow(second, { kind: "agent", id: AS })).rejects.toThrow(/has the person's keys; following a link there/);
    expect(await act("open", { id: notes.tide.id, from: second })).toMatchObject({ id: notes.tide.id });
    await until(() => columns().length === 3, "a third column");
    expect(get().focus).toBe(second);
    expect(tile(columns()[2]!).showing.id).toBe(notes.tide.id);
  });

  test("the wide column moves only when asked: ^W W, or a click on a spine; moving the keys moves nothing", async () => {
    render();
    const wideBefore = flow().wide;
    const rects = () => { render(); return JSON.stringify(columns().map(c => tile(c).rect)); };
    const before = rects();
    await mine("tile.focus", {}, "c1");
    expect(rects()).toBe(before);
    expect(flow().wide).toBe(wideBefore);
    key({ kind: "char", ch: "w", ctrl: true }); key({ kind: "char", ch: "W" });
    await until(() => flow().wide === "c1", "c1 widened by ^W W");
    expect(get().focus).toBe("c1");
    // A narrow terminal squeezes the far columns to spines; a click on one widens it and gives it the keys.
    info.cols = 100;
    render();
    const spine = columns().find(c => tile(c).cover === "spine");
    expect(spine).toBeTruthy();
    const r = tile(spine!).rect;
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 1, y: r.row + 8 }); key({ kind: "mouse", action: "up", button: 0, x: r.col + 1, y: r.row + 8 });
    await until(() => flow().wide === spine, "the spine widened by a click");
    expect(get().focus).toBe(spine!);
    expect(tile(spine!).cover).toBe("full");
    info.cols = 220;
    render();
    // Outside a flow, ^W W says why.
    await expect(act("tile.widen", {}, "tree")).rejects.toThrow(/tree isn't in a flow/);
  });

  test("an agent's widen is said; a locked flow refuses it; the flow and its memory come back after a restart", async () => {
    await act("tile.widen", {}, columns()[1]!);
    expect(flow().wide).toBe(columns()[1]!);
    expect((app as any).message).toContain(`an agent (${AS}) widened`);
    const id = flow().id;
    await mine("layout.policy", { node: id, locked: true });
    await expect(act("tile.widen", {}, "c1")).rejects.toThrow(/is locked: widening is refused/);
    await mine("layout.policy", { node: id, locked: false });
    const shape = JSON.stringify({ cols: columns(), wide: flow().wide });
    D().dispose(); app.pop();
    desk = new Desk();
    app.push(desk);
    render();
    expect(JSON.stringify({ cols: columns(), wide: flow().wide })).toBe(shape);
    // The columns a followed link opened keep their notes (details, saved with the layout).
    await until(() => tile(columns()[1]!)?.showing?.id === notes.boat.id && tile(columns()[2]!)?.showing?.id === notes.tide.id, "the columns' notes back");
  });
});
