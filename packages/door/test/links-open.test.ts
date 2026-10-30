// PIE-646, PIE-794: the links tile's workflow. A detail, `b`, a preview following the selection; ⏎ replaces the note
// of the list's home with the pick (the tile linked to the list as a target, else its home reader) and the list keeps
// its subject (only b aims it again), alt+⏎ opens a new detail beside the home. A link between tiles has a role: preview (follows the selection) or target (takes only what is opened into it),
// said on the header and in layout.get. Scratch outline, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { linkTargetOf, linkWords } from "../src/links";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");

describe.skipIf(!outliner)("the links tile opens for real: ⏎ in its home reader, alt+⏎ in a new detail", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let lamp: Msg, porch: Msg, hall: Msg;
  const D = () => desk as any;
  const key = (k: Key) => D().key(k, D().ctx);
  /** As the person (the desk's own dispatch), or as the agent named. */
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, as: string | null = null) =>
    as ? app.act({ action, args, ...(tile ? { tile } : {}), as }) as Promise<any> : D().dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const reader = (name: string) => desk.pane(name) as ReaderPane;
  const links = () => desk.pane("links") as BacklinksPane;
  const rowOf = (id: string) => links().rows().findIndex(r => r.kind === "backlink" && r.source.blockId === id);
  const pickRow = async (id: string) => { await act("list.pick", { n: rowOf(id) + 1 }, "links"); };
  const mouse = (action: "down" | "up", x: number, y: number, mods = 0) => key({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) });

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 150, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    lamp = await board.createBlock(null, "The lamp\nIt flickers.");
    porch = await board.createBlock(null, `Porch\nThe ((${lamp.id}|lamp)) by the door.`);
    hall = await board.createBlock(null, `Hall\nAnother ((${lamp.id}|lamp)).`);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  /** A detail holding the lamp, its links tile under it and a preview following the links: what `b` makes. */
  const setup = async (kind = "detail") => {
    desk = new Desk({
      name: "test", title: "test",
      layout: { root: { t: "split", dir: "col", ratio: 0.5,
        a: { t: "leaf", kind, name: "reader" },
        b: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", groups: "open" }, b: { t: "leaf", kind: "preview", name: "peek", source: "tile:links" } } } },
    });
    app.push(desk);
    reader("reader").hold(lamp, desk as any);
    await until(() => links().target?.id === lamp.id && links().data !== null && rowOf(porch.id) >= 0 && rowOf(hall.id) >= 0, "the lamp's backlinks");
    await act("tile.focus", {}, "links");
  };

  test("moving the selection previews; the home detail stays; ⏎ replaces the detail's note, the list keeps its subject until b", async () => {
    await setup();
    expect(tile("links")).toMatchObject({ link: "reader", linkFrom: "home" });
    await pickRow(porch.id);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "the preview following the pick");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    key({ kind: "enter" });
    await until(() => reader("reader").msg?.id === porch.id, "⏎: the home detail holds the pick");
    expect(get().tiles.find((t: any) => t.name === "reader").showing.id).toBe(porch.id);
    // The person moved the current note; the list keeps its own subject.
    render();
    expect(D().current?.id).toBe(porch.id);
    expect(links().target?.id).toBe(lamp.id);
    await pickRow(hall.id);
    key({ kind: "enter" });
    await until(() => reader("reader").msg?.id === hall.id, "⏎ again: the next row, from the same list");
    render();
    expect(links().target?.id).toBe(lamp.id);
    // The person's keys stayed in the list; b there aims it at its home's note now.
    expect((desk as any).describe().focus ?? "links").toBe("links");
    key({ kind: "char", ch: "b" } as Key);
    await until(() => links().target?.id === hall.id, "b: the list lists what its home shows now");
  }, 20_000);

  test("a reload of the links that lands after the person moved the selection leaves it where they put it", async () => {
    await setup();
    await pickRow(porch.id);
    // The service's answer is held, as a loaded runner holds it; an outline change makes the list ask again.
    const real = board.backlinks.bind(board);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let answer: Promise<unknown> | null = null;
    (board as any).backlinks = (id: string) => { answer = real(id).then(async d => { await gate; return d; }); return answer; };
    try {
      D().onEvent({ action: "changed" });
      await until(() => answer !== null, "the list asking again (500 ms after a change)");
      await pickRow(hall.id);
      const on = () => { const r = links().rows()[links().sel]; return r?.kind === "backlink" ? r.source.blockId : undefined; };
      expect(on()).toBe(hall.id);
      release();
      await answer;
      await Bun.sleep(0);
      expect(on()).toBe(hall.id);
    } finally { release(); (board as any).backlinks = real; }
  }, 20_000);

  test("a backlink row names the line that links and the anchor it targets; opening it lands on that line; an anchored outlink lands on the anchor (PIE-884)", async () => {
    const target = await board.createBlock(null, "Garden plan\nBeans in the north bed.\nThe water butt is by the shed. ^butt\nLeeks last.");
    const filler = Array.from({ length: 40 }, (_, i) => `Filler line ${i + 1}.`).join("\n");
    const log = await board.createBlock(null, `Plot log\n${filler}\nCheck ((${target.id}^butt)) before the frost.\nMore filler.`);
    desk = new Desk({
      name: "test", title: "test",
      layout: { root: { t: "split", dir: "col", ratio: 0.5,
        a: { t: "leaf", kind: "detail", name: "reader" },
        b: { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", groups: "open" } } },
    });
    app.push(desk);
    reader("reader").hold(target, desk as any);
    await until(() => links().target?.id === target.id && rowOf(log.id) >= 0, "the plan's backlinks");
    // The row says which line links and the anchor it names.
    const row = links().rows()[rowOf(log.id)] as any;
    const words = linkWords(row);
    expect(words.context).toContain("“Check ((Garden plan^butt))");
    expect(words.context).toContain("^butt");
    expect(render().lines.map(plain).join("\n")).toContain("^butt");
    // Opening it lands on that line of the linking note.
    await act("tile.focus", {}, "links");
    await act("list.open", { n: rowOf(log.id) + 1 }, "links");
    await until(() => reader("reader").msg?.id === log.id, "the log in the detail");
    const lineOf = (await board.get(log.id))!.text.split("\n").findIndex(l => l.startsWith("Check ((")) + 1;
    await until(() => (reader("reader").surface as any).focusMark?.line === true, "the line marked");
    expect((reader("reader").surface as any).focusMark.spec).toMatchObject({ line: lineOf });
    // Back on the plan, the list's outlinks: the log's anchored link lands on the anchor.
    await links().show(log, desk as any);
    await until(() => links().target?.id === log.id && links().rows().some(r => r.kind === "outlink"), "the log's outlinks");
    const out = links().rows().findIndex(r => r.kind === "outlink");
    await act("list.open", { n: out + 1 }, "links");
    const showing = (id: string) => reader(get().tiles.find(t => t.showing?.id === id && !t.collapsed)?.name);
    await until(() => showing(target.id).msg?.id === target.id, "the plan in the detail");
    await until(() => (showing(target.id).surface as any).focusMark?.fragment === true, "the anchor marked");
    expect((showing(target.id).surface as any).focusMark.label).toBe("^butt");
    expect(linkTargetOf(links().rows()[out]!)).toMatchObject({ block: target.id, fragment: "butt" });
    // A note edited since the list read it (lines added above the reference) still opens on the reference, not the old offset.
    await act("tile.focus", {}, "links");
    await links().show(target, desk as any);
    await until(() => links().target?.id === target.id && rowOf(log.id) >= 0, "the plan's backlinks again");
    const current = (await board.get(log.id))!;
    await board.update(log.id, current.text.replace("Plot log\n", "Plot log\nAdded one.\nAdded two.\nAdded three.\n"), current.revision!);
    await act("list.open", { n: rowOf(log.id) + 1 }, "links");
    await until(() => showing(log.id).msg?.id === log.id, "the edited log opens");
    const edited = (await board.get(log.id))!.text.split("\n").findIndex(l => l.startsWith("Check ((")) + 1;
    await until(() => (showing(log.id).surface as any).focusMark?.line === true && (showing(log.id).surface as any).focusMark.spec.line === edited, "the reference's line marked, not the old offset's");
    // The inline ::links / ::backlinks rows are links tagged with the same target: the line rides along (the reader's follow marks it).
    expect(linkTargetOf(row)).toMatchObject({ block: log.id, role: "row", at: expect.any(Number) });
  }, 30_000);

  test("alt+⏎ swaps the home and keeps its old note as a spine; the list keeps the keys", async () => {
    await setup();
    const before = get().tiles.length;
    await pickRow(hall.id);
    key({ kind: "alt-enter" });
    await until(() => get().tiles.length === before + 1, "a new detail");
    const made = get().tiles.find((t: any) => t.kind === "reader" && t.name !== "reader");
    expect(made.showing.id).toBe(lamp.id);
    expect(made.collapsed).toBe(true);
    expect(reader("reader").msg?.id).toBe(hall.id);
    expect(D().layoutGet().focus).toBe("links");
    expect(links().target?.id).toBe(lamp.id);
  }, 20_000);

  test("a tile linked to the list is a target by default: the selection moves without it, ⏎ and open from= land in it", async () => {
    await setup();
    await act("tile.open", { kind: "detail", name: "side", where: "right" }, "reader");
    await act("tile.focus", {}, "links");
    await act("tile.link", { to: "side" }, "links");
    expect(tile("links")).toMatchObject({ wires: expect.arrayContaining([{ verb: "open", to: tile("side").tile }]) });
    await pickRow(porch.id);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "the preview follows");
    expect(reader("side").msg).toBeFalsy();
    key({ kind: "enter" });
    await until(() => reader("side").msg?.id === porch.id, "⏎ lands in the target");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    // The same open by the action an agent calls.
    const out = await act("open", { id: hall.id, from: "links" }, undefined, "walker-1");
    expect(out.name).toBe("side");
    await until(() => reader("side").msg?.id === hall.id, "open from= lands in the target");
    expect(D().layoutGet().focus).toBe("links");
  }, 20_000);

  test("a replacement select destination survives saving and loading independently of open", async () => {
    await setup();
    await act("tile.open", { kind: "detail", name: "side", where: "right" }, "reader");
    const oldPreview = reader("peek").msg?.id;
    await act("tile.link", { to: "side", verb: "select" }, "links");
    await act("tile.link", { to: "reader", verb: "open" }, "links");
    await pickRow(hall.id);
    await until(() => reader("side").msg?.id === hall.id, "the replacement select target shows the row");
    expect(reader("peek").msg?.id).toBe(oldPreview);
    expect(reader("reader").msg?.id).toBe(lamp.id);
    const saved = D().saved();
    D().build(saved, true);
    await pickRow(porch.id);
    await until(() => reader("side").msg?.id === porch.id, "the replacement select wire survives reload");
    const unlinkedPreview = reader("peek").msg?.id;
    await act("tile.link", { to: "side", verb: "select", remove: true }, "links");
    await pickRow(hall.id);
    expect(reader("peek").msg?.id).toBe(unlinkedPreview);
    expect(reader("side").msg?.id).toBe(porch.id);
    await act("list.open", { id: hall.id }, "links");
    expect(reader("reader").msg?.id).toBe(hall.id);
  }, 20_000);

  test("a saved explicit select wire replaces an implicit preview source on load", async () => {
    await setup();
    const saved = D().saved();
    const walk = (n: any) => {
      if (n.t === "leaf" && n.name === "links") { delete n.wires; n.link = "reader"; n.linkRole = "preview"; }
      if (n.t === "leaf" && n.name === "peek") n.source = "tile:links";
      for (const c of n.kids ?? []) walk(c);
      if (n.a) walk(n.a); if (n.b) walk(n.b);
    };
    walk(saved.root);
    D().build(saved, true);
    await pickRow(porch.id);
    await until(() => reader("reader").msg?.id === porch.id, "the explicit select destination wins on load");
    expect(reader("peek").msg?.id).not.toBe(porch.id);
    expect(reader("reader").msg?.id).toBe(porch.id);
    await act("tile.focus", {}, "links");
    await act("list.open", { id: hall.id }, "links");
    await until(() => reader("reader").msg?.id === hall.id, "the saved preview-role link also takes opens");
    expect(tile("links").wires).toEqual(expect.arrayContaining([{ verb: "select", to: tile("reader").tile }, { verb: "open", to: tile("reader").tile }]));
  }, 20_000);

  test("an agent's open from the list lands in its home and never takes the person's keys; a group row opens or folds", async () => {
    await setup();
    const out = await act("list.open", { id: hall.id }, "links", "walker-2");
    await until(() => reader("reader").msg?.id === hall.id, "the agent's open");
    expect(out.id).toBe(hall.id);
    expect(D().layoutGet().focus).toBe("links");
    await expect(act("list.open", { where: "sideways" }, "links")).rejects.toThrow(/home or new/);
  }, 20_000);

  test("PIE-1206: a plain click after alt-click previews the same row", async () => {
    await setup();
    render();
    const r = tile("links").rect;
    const x = r.col + 6, y = r.row + 1 + (links() as any).head + rowOf(hall.id) - (links() as any).list.view.top;
    await pickRow(porch.id);
    mouse("down", x, y, 8); mouse("up", x, y, 8);
    await until(() => reader("reader").msg?.id === hall.id, "alt-click opens the hall");
    expect(reader("peek").msg?.id).toBe(porch.id);
    mouse("down", x, y); mouse("up", x, y);
    await until(() => reader("peek").msg?.id === hall.id, "the plain click previews the hall", 1000);
  });

  test("by mouse: a click selects and previews, a double click opens in its home, an alt+click in a new detail", async () => {
    await setup();
    render();
    const r = tile("links").rect as { col: number; row: number; cols: number; rows: number };
    // Row positions come from the list itself: where the pane drew its row i.
    const at = (id: string) => ({ x: r.col + 6, y: r.row + 1 + (links() as any).head + rowOf(id) - (links() as any).list.view.top });
    const p = at(porch.id);
    mouse("down", p.x, p.y); mouse("up", p.x, p.y);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "a click previews");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    const before = get().tiles.length;
    const h = at(hall.id);
    mouse("down", h.x, h.y, 8); mouse("up", h.x, h.y, 8);     // alt
    await until(() => get().tiles.length === before + 1, "alt+click: a kept spine");
    expect(reader("reader").msg?.id).toBe(hall.id);
    const q = at(porch.id);
    mouse("down", q.x, q.y); mouse("up", q.x, q.y); mouse("down", q.x, q.y); mouse("up", q.x, q.y);
    await until(() => reader("reader").msg?.id === porch.id, "a double click opens in its home");
  }, 20_000);
});
