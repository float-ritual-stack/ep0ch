// PIE-943: moving a note from the door. `note.move` (the reader's `Z` and the menu's "move to…", the power bar's picker,
// `act`) and `tree.move` (the outline tree's alt+arrows, `Z`, ctrl+z and a drag onto a row) are one step over the
// service's move: revision checked, recorded as who asked, put back by ctrl+z. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { TreePane } from "../src/desk/tree";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));

describe.skipIf(!outliner)("moving a note (PIE-943)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, key: (k: Key) => void = () => {};
  let garden: Msg, shed: Msg, beans: Msg, peas: Msg, squash: Msg;
  const D = () => desk as any;
  const tree = () => [...D().panes.values()].find((p: any) => p.kind === "tree") as TreePane;
  const treeName = () => D().nameOf([...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0]);
  const rows = () => tree().describe().rows;
  const order = async (parent: string | null) => (parent === null ? await board.roots() : await board.children(parent)).map(m => m.text);
  const row = (id: string) => { const r = rows().find(x => x.id === id); if (!r) throw new Error(`no row for ${id}`); return r; };
  const select = (id: string) => tree().selectRow(row(id).n - 1, desk, false);
    /** Wait for an async check, polling (scratch's `until` takes a plain boolean). */
  const waitFor = async (ok: () => Promise<boolean>, what: string, ms = 15_000) => { const end = Date.now() + ms; while (!(await ok())) { if (Date.now() > end) throw new Error(`never: ${what}`); await Bun.sleep(50); } };
  const untilOrder = (parent: string | null, want: string) => waitFor(async () => (await order(parent)).join() === want, `${parent ?? "the top level"} in order ${want}`);
  const alt = (kind: "alt-up" | "alt-down" | "alt-left" | "alt-right") => key({ kind } as Key);
  const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods = 0) => key({ kind: "mouse", action, button: 0, x, y, mods });

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start(), 2000);
    await board.info();
    garden = await board.createBlock(null, "Garden");
    shed = await board.createBlock(null, "Shed");
    beans = await board.createBlock(garden.id, "Beans");
    peas = await board.createBlock(garden.id, "Peas");
    squash = await board.createBlock(garden.id, "Squash");
    const term = { info: { cols: 160, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: (k: Key) => void) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    D().render(D().ctx);
    await until(() => rows().some(r => r.text === "Garden"), "the tree's top level");
    await tree().reveal(beans, desk);
    await until(() => rows().some(r => r.text === "Squash"), "Garden's children");
    await D().dispatch.press("tile.focus", {}, treeName());
  }, 60_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("alt+↓ and alt+↑ reorder among siblings, alt+→ indents under the note above, alt+← outdents after the parent, ctrl+z puts back", async () => {
    select(beans.id);
    alt("alt-down");
    await untilOrder(garden.id, "Peas,Beans,Squash");
    expect(await order(garden.id)).toEqual(["Peas", "Beans", "Squash"]);
    expect(tree().describe().selected?.id).toBe(beans.id);
    alt("alt-up");
    await until(() => rows().filter(r => r.depth === 1).map(r => r.text).join() === "Beans,Peas,Squash", "Beans back first");
    // In: last under the note above it, which opens to show it.
    select(peas.id);
    alt("alt-right");
    await until(() => rows().some(r => r.text === "Peas" && r.depth === 2), "Peas under Beans");
    expect(await order(beans.id)).toEqual(["Peas"]);
    // Out: right after its parent.
    alt("alt-left");
    await until(() => rows().some(r => r.text === "Peas" && r.depth === 1), "Peas out again");
    expect(await order(garden.id)).toEqual(["Beans", "Peas", "Squash"]);
    // ctrl+z: Peas back where the last move took it from (under Beans), then once more (its first move).
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => rows().some(r => r.text === "Peas" && r.depth === 2), "the outdent put back");
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => rows().filter(r => r.depth === 1).map(r => r.text).join() === "Beans,Peas,Squash", "the indent put back");
    expect(await order(beans.id)).toEqual([]);
  }, 60_000);

  test("the first note can't go up, the first child can't go in, a top-level note can't go out: refused, saying why", async () => {
    const act = (args: Record<string, unknown>) => app.act({ action: "tree.move", tile: treeName(), args });
    await expect(act({ id: beans.id, step: "up" })).rejects.toThrow("already first");
    await expect(act({ id: beans.id, step: "in" })).rejects.toThrow("no note above it");
    const top = (await board.roots()).find(r => r.text.startsWith("Workspace"))!;
    await expect(act({ id: top.id, step: "out" })).rejects.toThrow("top level");
  }, 60_000);

  test("a drag onto a row moves the note under it; with alt held, beside it", async () => {
    D().render(D().ctx);
    const origin = (id: string) => { const r = D().rectsNow().get(D().idNamed(treeName())); return { x: r.col + 1 + 4, y: r.row + 1 + row(id).n - 1 }; };
    select(squash.id);
    const from = origin(squash.id), to = origin(shed.id);
    mouse("down", from.x, from.y); mouse("drag", to.x, to.y); mouse("up", to.x, to.y);
    await waitFor(async () => (await board.get(squash.id))!.parentId === shed.id, "Squash under Shed");
    // Alt held: beside it, below the row it's dropped on (it started above), which makes it a top-level note.
    await until(() => rows().some(r => r.id === squash.id), "its row");
    D().render(D().ctx);
    const a = origin(squash.id), b = origin(garden.id);
    mouse("down", a.x, a.y); mouse("drag", b.x, b.y, 8); mouse("up", b.x, b.y, 8);
    await waitFor(async () => (await board.get(squash.id))!.parentId === null, "Squash at the top level");
    const top = (await order(null)).filter(t => ["Garden", "Squash", "Shed"].includes(t));
    expect(top).toEqual(["Squash", "Garden", "Shed"]);
    // Dropped inside itself: nothing moves.
    D().render(D().ctx);
    const g = origin(garden.id), c = origin(beans.id);
    mouse("down", g.x, g.y); mouse("drag", c.x, c.y); mouse("up", c.x, c.y);
    await Bun.sleep(300);
    expect((await board.get(garden.id))!.parentId).toBe(null);
  }, 60_000);

  test("note.move by act: under a note, beside one, at a revision; an agent is recorded as itself and a stale revision is refused", async () => {
    const act = (args: Record<string, unknown>, as?: string) => app.act({ action: "tree.move", tile: treeName(), args, ...(as ? { as } : {}) });
    const fresh = (await board.get(beans.id))!;
    await expect(act({ id: beans.id, to: shed.id, revision: (fresh.revision ?? 0) + 7 }, "gardener")).rejects.toThrow("changed since");
    expect(await act({ id: beans.id, to: shed.id, position: 1 }, "gardener")).toMatchObject({ moved: beans.id, parent: shed.id });
    expect((await board.get(beans.id))!.parentId).toBe(shed.id);
    expect(await act({ id: beans.id, after: garden.id }, "gardener")).toMatchObject({ moved: beans.id, parent: null });
    expect(await act({ id: beans.id, after: garden.id }, "gardener")).toMatchObject({ unchanged: true });
    await expect(act({ id: beans.id }, "gardener")).rejects.toThrow("say where");
    await expect(act({ id: beans.id, to: beans.id })).rejects.toThrow(/itself/);
    await expect(act({ id: garden.id, to: peas.id })).rejects.toThrow(/inside itself|itself/);
    // The person's, by the same action (a key or a click is a press); undo puts it back.
    const you = (args: Record<string, unknown>) => D().dispatch.press("tree.move", args, treeName());
    expect(await you({ id: beans.id, to: garden.id })).toMatchObject({ parent: garden.id });
    expect(await you({ id: beans.id, undo: true })).toMatchObject({ moved: beans.id });
    expect((await board.get(beans.id))!.parentId).toBe(null);
  }, 60_000);
});
