// PIE-1641: an open on a screen with no reader puts a new reader there showing the note, the person's keys in it,
// instead of "the screen has no reader tile; add one". One owner decides it: placement() (screen-layout.ts), its
// default place for a new tile, applied as one layout step; a locked screen still refuses, saying how to unlock it.
// Scratch services and made-up notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Msg } from "../src/board";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("an open on a screen with no reader makes one (PIE-1641)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const notes: Msg[] = [];
  const AS = "open-makes-reader-agent";
  const term = { info: { cols: 200, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
  const EMPTY = { t: "split" as const, dir: "row" as const, kids: [], weights: [] };
  /** A fresh screen on top, built from `root`. */
  const screen = (name: string, root: unknown, policy?: Record<string, unknown>) => {
    const d = new Desk({ name, title: name, layout: { root: root as any, ...(policy ? { policy } : {}) } });
    app.push(d);
    d.render((d as any).ctx);
    return d;
  };
  const mine = (d: Desk, action: string, args: Record<string, unknown> = {}) => d.dispatch.act({ action, args }, USER) as Promise<any>;
  const agents = (action: string, args: Record<string, unknown> = {}) => app.act({ action, args, as: AS }) as Promise<any>;
  const tiles = (d: Desk) => (d as any).layoutGet().tiles as { name: string; kind: string; showing?: { id: string } }[];
  const showing = async (d: Desk, tile: string) => (await d.dispatch.act({ action: "tile.info", tile, args: {} }, USER) as any).showing?.id;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const t of ["Seed swap ledger", "Mend the cold frame", "Bean trellis notes"]) notes.push(await board.createBlock(null, `${t}\nMade up for the test.`));
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 60_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the person's open on an empty desk: a new reader shows it, with their keys", async () => {
    const d = screen("empty-desk", EMPTY);
    expect(tiles(d)).toEqual([]);
    const r = await mine(d, "open", { id: notes[0]!.id });
    expect(r.tile).toMatch(/^t-/);
    const made = tiles(d);
    expect(made.map(t => t.kind)).toEqual(["reader"]);
    expect(await showing(d, made[0]!.name)).toBe(notes[0]!.id);
    expect((d as any).layoutGet().focus).toBe(made[0]!.name);
    // The next open lands in that reader, as in any reader: the note it had is kept beside it as a spine (a step back).
    const next = await mine(d, "open", { id: notes[1]!.id });
    expect(next.name).toBe(made[0]!.name);
    expect(await showing(d, made[0]!.name)).toBe(notes[1]!.id);
    const spine = tiles(d).find(t => t.name !== made[0]!.name) as any;
    expect(spine === undefined || await showing(d, spine.name) === notes[0]!.id).toBe(true);
    app.pop();
  });

  test("the power bar's pick on an empty desk opens it in a new reader", async () => {
    const d = screen("empty-bar", EMPTY);
    // The person's: the bar open on the line they typed, ⏎ on its lit row.
    await app.dispatch.act({ action: "bar.open", args: { query: "Mend the cold frame", scope: "notes" } }, USER);
    await until(() => { d.render((d as any).ctx); return true; }, "the bar drawn");
    await app.dispatch.act({ action: "bar.pick", args: { n: 1 } }, USER);
    const made = tiles(d);
    expect(made.map(t => t.kind)).toEqual(["reader"]);
    expect(await showing(d, made[0]!.name)).toBe(notes[1]!.id);
    expect((d as any).layoutGet().focus).toBe(made[0]!.name);
    app.pop();
    // An agent's pick on another empty desk: a reader too, as the agent's open lands.
    const e = screen("empty-bar-agent", EMPTY);
    await agents("bar.pick", { query: "Bean trellis notes", scope: "notes", n: 1 });
    const theirs = tiles(e);
    expect(theirs.map(t => t.kind)).toEqual(["reader"]);
    expect(await showing(e, theirs[0]!.name)).toBe(notes[2]!.id);
    app.pop();
  });

  test("an agent's open on a screen with tiles but no reader: a new reader beside them, the person's keys stay put", async () => {
    const d = screen("no-reader", { t: "split", dir: "row", weights: [1], kids: [{ t: "leaf", kind: "activity", name: "activity" }] });
    const r = await agents("open", { id: notes[2]!.id });
    const reader = tiles(d).find(t => t.kind === "reader");
    expect(reader).toBeDefined();
    expect(r.name).toBe(reader!.name);
    expect(await showing(d, reader!.name)).toBe(notes[2]!.id);
    expect((d as any).layoutGet().focus).toBe("activity");
    app.pop();
  });

  test("the person's keys in a group with no reader: the desk around it makes the reader, not the group", async () => {
    const d = screen("grouped", { t: "split", dir: "row", weights: [1, 1], kids: [{ t: "leaf", kind: "activity", name: "left" }, { t: "leaf", kind: "activity", name: "right" }] });
    const g = await d.dispatch.act({ action: "tile.group", tile: "left", args: { with: "right" } }, USER) as { tile: string; name: string };
    await d.dispatch.act({ action: "tile.focus", tile: g.tile, args: {} }, USER);
    expect((d as any).focusedMount()).toBeTruthy();
    const r = await mine(d, "open", { id: notes[0]!.id });
    const reader = tiles(d).find(t => t.kind === "reader");
    expect(reader).toBeDefined();
    expect(r.name).toBe(reader!.name);
    expect(await showing(d, reader!.name)).toBe(notes[0]!.id);
    app.pop();
  });

  test("with the drawer up and the keys in it, the bar's pick opens a reader on the empty screen shown", async () => {
    const d = screen("empty-drawer", EMPTY);
    await app.dispatch.press("host.toggle", { open: true });
    await app.dispatch.press("host.enter");
    try {
      expect(app.dispatch.where().keys).toBe("host");
      await app.dispatch.act({ action: "bar.open", args: { query: "Seed swap ledger", scope: "notes" } }, USER);
      await app.dispatch.act({ action: "bar.pick", args: { n: 1 } }, USER);
      const made = tiles(d);
      expect(made.map(t => t.kind)).toEqual(["reader"]);
      expect(await showing(d, made[0]!.name)).toBe(notes[0]!.id);
    } finally {
      await app.dispatch.press("host.toggle", { open: false });
      app.pop();
    }
  });

  test("a locked screen with no reader still refuses, saying how to unlock it", async () => {
    const d = screen("locked-empty", { t: "split", dir: "row", weights: [1], kids: [{ t: "leaf", kind: "activity", name: "activity" }] }, { locked: true });
    await expect(mine(d, "open", { id: notes[0]!.id })).rejects.toThrow(/locked.*unlocks it/);
    expect(tiles(d).map(t => t.kind)).toEqual(["activity"]);
    app.pop();
  });
});
