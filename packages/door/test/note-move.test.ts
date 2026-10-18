// PIE-943: moving a note from the door. `note.move` (the reader's `Z` and the menu's "move to…", the power bar's picker,
// `act`) and `tree.move` (the outline tree's alt+arrows, `Z`, ctrl+z and a drag onto a row) are one step over the
// service's move: revision checked, recorded as who asked, put back by ctrl+z. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import type { TreePane } from "../src/desk/tree";
import { MainMenu, MessageList } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));

test("the river column loads on its own (a static import cycle through the power bar broke the door's start)", async () => {
  const p = Bun.spawn([process.execPath, "-e", 'await import("./src/river/column.ts")'], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EP0CH_STATE: join(import.meta.dir, "..", ".nonexistent-state") }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let killed = false;
  const timer = setTimeout(() => { killed = true; p.kill(); }, 8000);
  const err = await new Response(p.stderr).text();
  await p.exited;
  clearTimeout(timer);
  expect(err).not.toContain("before initialization");
  expect(killed).toBe(false);
});

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
  const alt = (kind: "alt-up" | "alt-down") => key({ kind } as Key);
  const letter = (c: string) => key({ kind: "char", ch: c });
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

  test("alt+↓ and alt+↑ reorder among siblings, I indents under the note above, O outdents after the parent, K and J are the Mac fallback for up and down, ctrl+z puts back", async () => {
    select(beans.id);
    alt("alt-down");
    await untilOrder(garden.id, "Peas,Beans,Squash");
    expect(await order(garden.id)).toEqual(["Peas", "Beans", "Squash"]);
    expect(tree().describe().selected?.id).toBe(beans.id);
    letter("K");
    await until(() => rows().filter(r => r.depth === 1).map(r => r.text).join() === "Beans,Peas,Squash", "Beans back first (K, the Mac fallback for alt+↑)");
    alt("alt-down"); await untilOrder(garden.id, "Peas,Beans,Squash");
    alt("alt-up"); await untilOrder(garden.id, "Beans,Peas,Squash");
    // In: last under the note above it, which opens to show it.
    select(peas.id);
    letter("I");
    await until(() => rows().some(r => r.text === "Peas" && r.depth === 2), "Peas under Beans");
    expect(await order(beans.id)).toEqual(["Peas"]);
    // Out: right after its parent.
    letter("O");
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
    const origin = (id: string, x = 4) => { const r = D().rectsNow().get(D().idNamed(treeName())); return { x: r.col + 1 + x, y: r.row + 1 + row(id).n - 1 }; };
    select(squash.id);
    const from = origin(squash.id), to = origin(shed.id);
    mouse("down", from.x, from.y); mouse("drag", to.x, to.y); mouse("up", to.x, to.y);
    await waitFor(async () => (await board.get(squash.id))!.parentId === shed.id, "Squash under Shed");
    // Dropped on a row's mark (its left edge), no modifier: beside it, above it (it started below), a top-level note.
    await until(() => rows().some(r => r.id === squash.id), "its row");
    D().render(D().ctx);
    const a = origin(squash.id), b = origin(garden.id, 0);
    mouse("down", a.x, a.y); mouse("drag", b.x, b.y); mouse("up", b.x, b.y);
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

  test("in a reader, alt+↓ and alt+↑ move the note shown among its siblings (the outline's keys), and Z asks where; esc cancels", async () => {
    const readerId = [...D().panes.entries()].find(([, p]: any) => p.kind === "reader")![0];
    const reader = D().panes.get(readerId) as any, readerName = D().nameOf(readerId);
    await D().dispatch.press("tile.focus", {}, treeName());
    await waitFor(async () => (await board.get(peas.id))!.parentId === garden.id, "Peas under Garden");
    await until(() => rows().some(r => r.id === peas.id), "Peas' row");
    tree().selectRow(row(peas.id).n - 1, desk);
    await until(() => reader.msg?.id === peas.id, "the reader on Peas");
    await D().dispatch.press("tile.focus", {}, readerName);
    const before = (await order(garden.id)).join();
    letter("K");
    await waitFor(async () => (await order(garden.id)).join() !== before, "Peas moved by alt+↑ in the reader");
    letter("J");
    await waitFor(async () => (await order(garden.id)).join() === before, "Peas back by alt+↓");
    // Z asks in the power bar (the note's parent first); esc puts the bar away and nothing moves.
    key({ kind: "char", ch: "Z" });
    const asking = () => (app as any).bar?.describe() as { scope: string; rows: { label: string }[] } | undefined;
    await until(() => asking()?.scope === "ask" && (asking()?.rows.length ?? 0) > 0, "the power bar asking where");
    expect(asking()!.rows[0]!.label).toContain("Garden");
    key({ kind: "esc" });
    await until(() => asking()?.scope !== "ask", "the bar put away");
    expect((await order(garden.id)).join()).toBe(before);
    expect((await board.get(peas.id))!.parentId).toBe(garden.id);
  }, 60_000);

  test("a river column's selected card moves by column.move, as the outline's does (alt+↑ alt+↓ and Z are its keys)", async () => {
    const opened = await app.act({ action: "tile.open", args: { kind: "river.column", source: `block:${garden.id}`, name: "col" }, as: "gardener" }) as { tile?: string };
    const col = opened.tile ?? "col";
    await waitFor(async () => !!D().pane(col)?.flat?.().length, "the column's cards", 20_000);
    const start = (await order(garden.id)).join();
    const first = (await board.children(garden.id))[0]!;
    // The person's: the selection follows the card, and undo puts it back.
    const you = (args: Record<string, unknown>) => D().dispatch.press("column.move", args, col);
    const selected = () => D().pane(col).flat()[D().pane(col).sel]?.m.id;
    await D().pane(col).pick({ id: first.id }, desk);
    await D().dispatch.press("tile.focus", {}, col);
    letter("J");
    await waitFor(async () => (await order(garden.id)).join() !== start, "the person's move");
    await waitFor(async () => selected() === first.id && D().pane(col).flat()[1]?.m.id === first.id, "the selection on the moved card");
    await you({ undo: true });
    await waitFor(async () => (await order(garden.id)).join() === start, "undo");
    const second = (await board.children(garden.id))[1]!;
    await waitFor(async () => D().pane(col).flat().some((r: any) => r.m.id === second.id), "river rows restored");
    D().render(D().ctx);
    const pane = D().pane(col);
    const yOf = (id: string) => pane.headRows + pane.rows.findIndex((r: any) => r && pane.flat()[r.card]?.m.id === id);
    const fromY = yOf(first.id), toY = yOf(second.id);
    const dragInColumn = (action: "down" | "drag" | "up", x: number, y: number) => pane.mouse({ kind: "mouse", action, button: 0, x, y, mods: 0 }, x, y, desk);
    dragInColumn("down", 1, fromY); dragInColumn("drag", 20, toY); dragInColumn("up", 20, toY);
    await waitFor(async () => (await board.get(first.id))?.parentId === second.id, "river drag nests");
    await you({ id: first.id, undo: true });
    await waitFor(async () => (await order(garden.id)).join() === start, "undo river drag");
    // An agent's, by id: attributed, and the column's selection is left alone.
    expect(await app.act({ action: "column.move", tile: col, args: { id: first.id, step: "down" }, as: "gardener" })).toMatchObject({ moved: first.id, parent: garden.id });
    expect((await order(garden.id)).join()).not.toBe(start);
    expect(await app.act({ action: "column.move", tile: col, args: { id: first.id, step: "up" }, as: "gardener" })).toMatchObject({ moved: first.id });
    expect((await order(garden.id)).join()).toBe(start);
    await expect(app.act({ action: "column.move", tile: col, args: { id: first.id }, as: "gardener" })).rejects.toThrow("say where");
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
  test("BBS child rows move with J, I, O and a modifier-free drag", async () => {
    const parent = await board.createBlock(null, "Reply garden");
    const alpha = await board.createBlock(parent.id, "Alpha reply");
    const beta = await board.createBlock(parent.id, "Beta reply");
    const list = new MessageList("Replies", () => board.children(parent.id), "", false);
    app.push(list);
    await until(() => list.listRows()?.length === 2, "reply rows");
    letter("J");
    await untilOrder(parent.id, "Beta reply,Alpha reply");
    expect(list.listRows()?.map(r => r.id)).toEqual([beta.id, alpha.id]);
    letter("I");
    await waitFor(async () => (await board.get(alpha.id))?.parentId === beta.id, "indent reply");
    await app.act({ action: "note.move", args: { id: alpha.id, step: "out" }, as: "gardener" });
    await untilOrder(parent.id, "Beta reply,Alpha reply");
    list.render(list.ctx!);
    mouse("down", 30, 5); mouse("drag", 30, 6); mouse("up", 30, 6);
    await waitFor(async () => (await board.get(beta.id))?.parentId === alpha.id, "drag reply under row");
    key({ kind: "char", ch: "z", ctrl: true });
    await waitFor(async () => (await board.get(beta.id))?.parentId === parent.id, "undo reply drag");
    app.pop();
  }, 60_000);

  test("the reader thread's selected reply reorders, indents and drags through note.move", async () => {
    const parent = await board.createBlock(null, "Orchard replies");
    const alpha = await board.createBlock(parent.id, `Alpha [replyto::${parent.id}]`);
    const beta = await board.createBlock(parent.id, `Beta [replyto::${parent.id}]`);
    await D().dispatch.press("open", { id: parent.id });
    await until(() => [...D().panes.values()].some((p: any) => p.surface?.msg?.id === parent.id), "reader");
    const reader: ReaderPane = [...D().panes.values()].find((p: any) => p.surface?.msg?.id === parent.id);
    const readerName = D().nameOfPane(reader);
    await D().dispatch.press("tile.focus", {}, readerName);
    letter("t");
    await until(() => !!reader.surface.replyLinks, "thread panel");
    const draw = () => D().render(D().ctx);
    const pick = async (id: string) => {
      draw();
      const mode = reader.surface.replyLinks!;
      const at = mode.rowsAt.findIndex(r => r.kind === "child" && r.child.block.id === id);
      expect(at).toBeGreaterThanOrEqual(0);
      await D().dispatch.press("note.thread.pick", { n: at + 1 }, readerName);
    };
    await pick(alpha.id);
    letter("J");
    await waitFor(async () => (await board.children(parent.id))[1]?.id === alpha.id, "reply down");
    await until(() => reader.surface.replyLinks?.thread.replies[1]?.block.id === alpha.id, "visible reply order");
    letter("I");
    await waitFor(async () => (await board.get(alpha.id))?.parentId === beta.id, "reply in");
    letter("O");
    await waitFor(async () => (await board.get(alpha.id))?.parentId === parent.id, "reply out");
    await pick(beta.id);
    const mode = reader.surface.replyLinks!;
    const rowY = (id: string) => mode.rect.y + 1 + mode.rowsAt.findIndex(r => r.kind === "child" && r.child.block.id === id) - mode.top;
    const x = mode.rect.x + 12, y = rowY(beta.id), target = rowY(alpha.id);
    reader.surface.press(x, y, reader.host(desk));
    reader.surface.drag(x, target, reader.host(desk));
    reader.surface.release(x, target, reader.host(desk));
    await waitFor(async () => (await board.get(beta.id))?.parentId === alpha.id, "thread drag nests");
    letter("t");
  }, 60_000);

  test("undo refuses a changed note and keeps the receipt for another attempt", async () => {
    const note = await board.createBlock(garden.id, "Carrots");
    const act = (args: Record<string, unknown>) => app.act({ action: "tree.move", tile: treeName(), args, as: "undo-gardener" });
    await act({ id: note.id, to: shed.id, revision: note.revision });
    const moved = (await board.get(note.id))!;
    await board.request("update", { blockId: note.id, text: "Carrots, keep in shed", expectedRevision: moved.revision });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(act({ id: note.id, undo: true })).rejects.toThrow("changed since");
      expect((await board.get(note.id))!.parentId).toBe(shed.id);
    }
  }, 60_000);

  test("undo keeps its receipt when the original parent is in Trash", async () => {
    const parent = await board.createBlock(null, "Cold frame");
    const note = await board.createBlock(parent.id, "Radishes");
    const act = (args: Record<string, unknown>) => app.act({ action: "tree.move", tile: treeName(), args, as: "undo-gardener" });
    await act({ id: note.id, to: shed.id, revision: note.revision });
    const fresh = (await board.get(parent.id))!;
    await board.request("delete", { blockId: parent.id, expectedRevision: fresh.revision });
    await expect(act({ id: note.id, undo: true })).rejects.toThrow("Trash");
    await board.request("trash.restore", { blockId: parent.id });
    await act({ id: note.id, undo: true });
    expect((await board.get(note.id))!.parentId).toBe(parent.id);
    await expect(act({ id: note.id, undo: true })).rejects.toThrow("no move");
  }, 60_000);

});
