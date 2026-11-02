// PIE-1516: a tile wired to itself opens in place. alt+l o and a click on the same tile (linkToPane, the click's own
// path) wires it; an open in a links tile then shows the note in that tile, ← back walks the reader's trail and past its
// first stop puts the list back. A pinned reader wired to itself replaces in place; the `self` open rule says it for a
// whole screen. The frame, the link card and ^W P say "in place". Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");

describe.skipIf(!outliner)("open in place: a tile wired to itself", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let lamp: Msg, porch: Msg, hall: Msg;
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const render = () => plain(desk.render(D().ctx).lines.join("\n"));
  const tiles = () => (D().layoutGet() as { tiles: any[] }).tiles;
  const reader = (name: string) => desk.pane(name) as ReaderPane;
  const links = () => desk.pane("links") as BacklinksPane;
  const rowOf = (id: string) => links().rows().findIndex(r => r.kind === "backlink" && r.source.blockId === id);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 150, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    lamp = await board.createBlock(null, "The lamp\nIt flickers.");
    porch = await board.createBlock(null, `Porch\nThe ((${lamp.id}|lamp)) by the door.`);
    hall = await board.createBlock(null, `Hall\nAnother ((${lamp.id}|lamp)), and the ((${porch.id}|porch)).`);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const setup = async () => {
    desk = new Desk({
      name: "test", title: "test",
      layout: { root: { t: "split", dir: "col", ratio: 0.5,
        a: { t: "leaf", kind: "detail", name: "reader" },
        b: { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", groups: "open" } } },
    });
    app.push(desk);
    reader("reader").hold(lamp, desk as any);
    await until(() => links().target?.id === lamp.id && rowOf(porch.id) >= 0 && rowOf(hall.id) >= 0, "the lamp's backlinks");
    await act("tile.focus", {}, "links");
  };

  test("alt+l o, then a click on the links tile itself: its opens land in place; back walks the reader, then the list returns", async () => {
    await setup();
    await act("tile.link", { ask: true, verb: "open" }, "links");
    // The card offers the tile itself, by number, as a click on it does.
    const card = render();
    expect(card).toContain("links itself: open in place");
    expect(card).toContain("2 ⌖ click to open in place");
    D().linkToPane(desk.pane("links"));
    expect(D().layout.wires).toContainEqual({ from: D().idNamed("links"), verb: "open", to: D().idNamed("links") });
    expect(D().wireDescription("links", "open")).toBe("in place");
    expect(D().tileInfo("links").opens).toContain("in place");
    expect(render()).toContain("open → in place");
    // ⏎ on a row: the note shows in the links tile, nothing new opens, the home reader keeps the lamp.
    const count = tiles().length;
    await act("list.open", { n: rowOf(porch.id) + 1 }, "links");
    await until(() => desk.pane("links") instanceof ReaderPane && reader("links").msg?.id === porch.id, "the porch in place");
    expect(tiles().length).toBe(count);
    expect(reader("reader").msg?.id).toBe(lamp.id);
    expect(reader("links").surface.describeHistory().back.map(s => (typeof s === "string" ? s : s?.title))).toEqual(["links · The lamp"]);
    // A link followed in it lands in place too, on the reader's trail; the list lies beneath it.
    reader("links").host(desk as any).navigate!(hall, {});
    await until(() => reader("links").msg?.id === hall.id, "the hall in place");
    expect(reader("links").surface.describeHistory().back.map(s => (typeof s === "string" ? s : s?.title))).toEqual(["Porch", "links · The lamp"]);
    // The layout saves the list: a restart brings back what the tile is.
    expect(D().specOf(D().idNamed("links")).kind).toBe("backlinks");
    await act("back", {}, "links");
    await until(() => reader("links").msg?.id === porch.id, "back: the porch");
    await act("back", {}, "links");
    await until(() => desk.pane("links") instanceof BacklinksPane, "back again: the list");
    expect(links().target?.id).toBe(lamp.id);
    // Still wired in place; a click on the tile itself while linking keeps it so, the card's row unlinks.
    expect(D().wireDescription("links", "open")).toBe("in place");
    await act("tile.link", { verb: "open" }, "links");
    expect(D().wireDescription("links", "open")).not.toBe("in place");
  }, 30_000);

  test("back steps past the reader's own stops goes straight to the list", async () => {
    await setup();
    await act("tile.link", { to: "links" }, "links");
    await act("list.open", { n: rowOf(porch.id) + 1 }, "links");
    await until(() => desk.pane("links") instanceof ReaderPane && reader("links").msg?.id === porch.id, "the porch in place");
    reader("links").host(desk as any).navigate!(hall, {});
    await until(() => reader("links").msg?.id === hall.id, "the hall in place");
    await act("back", { steps: 2 }, "links");
    await until(() => desk.pane("links") instanceof BacklinksPane, "two back: the list");
  }, 30_000);

  test("gathered into a group, the links tile stays wired to itself and opens in place there", async () => {
    await setup();
    await act("tile.link", { to: "links" }, "links");
    const g = await act("tile.group", { with: "reader" }, "links");
    const inner = D().pane(g.tile).inner;
    expect(inner.wireDescription("links", "open")).toBe("in place");
    const list = () => inner.pane("links");
    await until(() => list() instanceof BacklinksPane && list().rows().some((r: any) => r.kind === "backlink" && r.source.blockId === porch.id), "the group's links listed");
    const n = list().rows().findIndex((r: any) => r.kind === "backlink" && r.source.blockId === porch.id) + 1;
    await inner.dispatch.act({ action: "list.open", args: { n }, tile: "links" }, { kind: "user" });
    await until(() => list() instanceof ReaderPane && list().msg?.id === porch.id, "the porch in place, in the group");
    await inner.dispatch.act({ action: "back", tile: "links" }, { kind: "user" });
    await until(() => list() instanceof BacklinksPane, "back: the list, in the group");
    // Moved out of the group whole (the path a tile takes into the drawer too), it keeps its wire to itself; open in place
    // as it moves, it travels as its list, as the layout saves it.
    await inner.dispatch.act({ action: "list.open", args: { n }, tile: "links" }, { kind: "user" });
    await until(() => list() instanceof ReaderPane, "in place again");
    await inner.dispatch.act({ action: "layout.move", args: { out: true }, tile: "links" }, { kind: "user" });
    expect(D().wireDescription("links", "open")).toBe("in place");
    expect(desk.pane("links")).toBeInstanceOf(BacklinksPane);
  }, 30_000);

  test("a pinned reader wired to itself replaces in place; the self rule says it for every tile", async () => {
    await setup();
    await act("reader.pin", {}, "reader");
    await act("tile.link", { to: "reader" }, "reader");
    const count = tiles().length;
    reader("reader").host(desk as any).navigate!(porch, {});
    await until(() => reader("reader").msg?.id === porch.id, "the porch in the pinned reader");
    expect(tiles().length).toBe(count);
    await act("back", {}, "reader");
    await until(() => reader("reader").msg?.id === lamp.id, "back: the lamp");
    // The screen's open rule: the links tile with no wire opens in place too.
    await act("tile.link", { verb: "open" }, "reader");
    await act("layout.policy", { node: "screen", opens: "self" }, "links");
    expect(D().wireDescription("links", "open")).toBe("in place");
    await act("list.open", { n: rowOf(hall.id) + 1 }, "links");
    await until(() => desk.pane("links") instanceof ReaderPane && reader("links").msg?.id === hall.id, "the hall in place, by the rule");
    expect(tiles().length).toBe(count);
  }, 30_000);
});
