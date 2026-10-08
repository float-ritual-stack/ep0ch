// PIE-646: the links tile's workflow. A detail, `b`, a preview following the selection; ⏎ opens the picked note in the
// reader it came from (the tile linked to the list as a target, else the origin reader), alt+⏎ in a new detail beside
// it. A link between tiles has a role: preview (follows the selection) or target (takes only what is opened into it),
// said on the header and in layout.get. Scratch outline, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");

describe.skipIf(!outliner)("the links tile opens for real: ⏎ in the origin reader, alt+⏎ in a new detail", () => {
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
  const pickRow = async (id: string) => { await act("backlinks.pick", { n: rowOf(id) + 1 }); };
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
  const setup = async () => {
    desk = new Desk({
      name: "test", title: "test",
      layout: { root: { t: "split", dir: "col", ratio: 0.5,
        a: { t: "leaf", kind: "detail", name: "reader" },
        b: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", groups: "open" }, b: { t: "leaf", kind: "preview", name: "peek", source: "tile:links" } } } },
    });
    app.push(desk);
    reader("reader").hold(lamp, desk as any);
    await until(() => links().target?.id === lamp.id && links().data !== null && rowOf(porch.id) >= 0 && rowOf(hall.id) >= 0, "the lamp's backlinks");
    await act("tile.focus", {}, "links");
  };

  test("moving the selection previews; the origin detail stays; ⏎ opens the pick in the detail and the list follows the new note", async () => {
    await setup();
    expect(tile("links")).toMatchObject({ link: "reader", linkFrom: "origin" });
    await pickRow(porch.id);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "the preview following the pick");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    key({ kind: "enter" });
    await until(() => reader("reader").msg?.id === porch.id, "⏎: the origin detail holds the pick");
    await until(() => links().target?.id === porch.id, "the list now lists the opened note's links");
    expect(get().tiles.find((t: any) => t.name === "reader").showing.id).toBe(porch.id);
    // The person's keys stayed in the list.
    expect((desk as any).describe().focus ?? "links").toBe("links");
  }, 20_000);

  test("alt+⏎ opens it in a new detail beside the origin: the origin keeps its note, the list keeps the keys", async () => {
    await setup();
    const before = get().tiles.length;
    await pickRow(hall.id);
    key({ kind: "alt-enter" });
    await until(() => get().tiles.length === before + 1, "a new detail");
    const made = get().tiles.find((t: any) => t.kind === "detail" && t.name !== "reader");
    expect(made.showing.id).toBe(hall.id);
    expect(reader("reader").msg?.id).toBe(lamp.id);
    expect(D().layoutGet().focus).toBe("links");
    expect(links().target?.id).toBe(lamp.id);
  }, 20_000);

  test("a tile linked to the list is a target by default: the selection moves without it, ⏎ and open from= land in it", async () => {
    await setup();
    await act("tile.open", { kind: "detail", name: "side", where: "right" }, "reader");
    await act("tile.focus", {}, "links");
    await act("tile.link", { to: "side" }, "links");
    expect(tile("links")).toMatchObject({ link: "side", linkRole: "target" });
    await pickRow(porch.id);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "the preview follows");
    expect(reader("side").msg).toBeFalsy();
    key({ kind: "enter" });
    await until(() => reader("side").msg?.id === porch.id, "⏎ lands in the target");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    // The same open by the action an agent calls.
    const out = await act("open", { id: hall.id, from: "links" }, undefined, "walker-1");
    expect(out.reader).toBe("side");
    await until(() => reader("side").msg?.id === hall.id, "open from= lands in the target");
    expect(D().layoutGet().focus).toBe("links");
  }, 20_000);

  test("role=preview makes the linked tile follow the selection too; the role changes by action and by a click on the header", async () => {
    await setup();
    await act("tile.open", { kind: "detail", name: "side", where: "right" }, "reader");
    await act("tile.focus", {}, "links");
    await act("tile.link", { to: "side", role: "preview" }, "links");
    expect(tile("links").linkRole).toBe("preview");
    await pickRow(hall.id);
    await until(() => reader("side").msg?.id === hall.id, "the preview-role link follows the selection");
    await act("tile.link", { role: "target" }, "links");
    expect(tile("links").linkRole).toBe("target");
    await pickRow(porch.id);
    await Bun.sleep(150);
    expect(reader("side").msg?.id).toBe(hall.id);
    // The chip on the header says it, and a click flips it.
    const lines = render().lines.map(plain), y = lines.findIndex(l => l.includes("⏎ target")), x = lines[y]!.indexOf("⏎ target") + 2;
    expect(y).toBeGreaterThan(-1);
    mouse("down", x, y); mouse("up", x, y);
    expect(tile("links").linkRole).toBe("preview");
    expect(render().lines.map(plain).join("\n")).toContain("◌ preview");
    await expect(act("tile.link", { role: "sideways" }, "links")).rejects.toThrow(/role is preview or target/);
    await act("tile.link", {}, "links");
    await expect(act("tile.link", { role: "target" }, "links")).rejects.toThrow(/links nowhere/);
  }, 20_000);

  test("the role is saved with the screen and comes back; the default isn't written", async () => {
    await setup();
    await act("tile.open", { kind: "detail", name: "side", where: "right" }, "reader");
    await act("tile.focus", {}, "links");
    await act("tile.link", { to: "side" }, "links");
    expect(JSON.stringify(D().saved())).not.toContain("linkRole");
    await act("tile.link", { role: "preview" }, "links");
    expect(JSON.stringify(D().saved())).toContain(`"linkRole":"preview"`);
    const saved = D().saved();
    D().build(saved, true);
    expect(tile("links")).toMatchObject({ link: "side", linkRole: "preview" });
  }, 20_000);

  test("an agent's open from the list lands in the origin and never takes the person's keys; a group row opens or folds", async () => {
    await setup();
    const out = await act("backlinks.open", { id: hall.id }, "links", "walker-2");
    await until(() => reader("reader").msg?.id === hall.id, "the agent's open");
    expect(out.id).toBe(hall.id);
    expect(D().layoutGet().focus).toBe("links");
    await expect(act("backlinks.open", { where: "sideways" }, "links")).rejects.toThrow(/origin or new/);
  }, 20_000);

  test("by mouse: a click selects and previews, a double click opens in the origin, an alt+click in a new detail", async () => {
    await setup();
    render();
    const r = tile("links").rect as { col: number; row: number; cols: number; rows: number };
    // Row positions come from the list itself: where the pane drew its row i.
    const at = (id: string) => ({ x: r.col + 6, y: r.row + 1 + (links() as any).head + rowOf(id) - (links() as any).view.top });
    const p = at(porch.id);
    mouse("down", p.x, p.y); mouse("up", p.x, p.y);
    await until(() => (desk.pane("peek") as ReaderPane).msg?.id === porch.id, "a click previews");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    const before = get().tiles.length;
    const h = at(hall.id);
    mouse("down", h.x, h.y, 8); mouse("up", h.x, h.y, 8);     // alt
    await until(() => get().tiles.length === before + 1, "alt+click: a new detail");
    expect(reader("reader").msg?.id).toBe(lamp.id);
    const q = at(porch.id);
    mouse("down", q.x, q.y); mouse("up", q.x, q.y); mouse("down", q.x, q.y); mouse("up", q.x, q.y);
    await until(() => reader("reader").msg?.id === porch.id, "a double click opens in the origin");
  }, 20_000);
});
