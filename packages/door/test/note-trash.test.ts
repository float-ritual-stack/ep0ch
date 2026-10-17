// PIE-878: a person trashes a note from wherever they see it. `d` shows what would go, `d` again (Delete, ⏎, a click on
// the first row) trashes it; ctrl+z brings it back; an agent says it twice (confirm=). Reader, a links list and the tree.
// Scratch outline, fictional notes.
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
import { prop } from "../src/props";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");

describe.skipIf(!outliner)("note.trash: d d from a reader, a list and the tree; ctrl+z brings it back", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let lamp: Msg, bulb: Msg, porch: Msg, hall: Msg, inbox: Msg;
  const D = () => desk as any;
  const key = (k: Key) => D().key(k, D().ctx);
  const ch = (c: string) => key({ kind: "char", ch: c });
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, as: string | null = null) =>
    as ? app.act({ action, args, ...(tile ? { tile } : {}), as }) as Promise<any> : D().dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const screen = () => desk.render(D().ctx).lines.map(plain).join("\n");
  const reader = () => desk.pane("reader") as ReaderPane;
  const links = () => desk.pane("links") as BacklinksPane;
  const deleted = async (m: Msg) => !!(await board.get(m.id))?.deleted;
  const message = () => String((app as any).message);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 150, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    lamp = await board.createBlock(null, "The lamp\nIt flickers.");
    bulb = await board.createBlock(lamp.id, "A spare bulb\nIn the drawer.");
    porch = await board.createBlock(null, `Porch\nThe ((${lamp.id}|lamp)) by the door.`);
    hall = await board.createBlock(null, `Hall\nAnother ((${lamp.id}|lamp)).`);
    inbox = (await board.roots()).find(r => prop(r, "system-view") === "inbox")!;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const setup = async () => {
    desk = new Desk({
      name: "test", title: "test",
      layout: { root: { t: "split", dir: "col", ratio: 0.5,
        a: { t: "split", dir: "row", ratio: 0.4, a: { t: "leaf", kind: "tree", name: "tree" }, b: { t: "leaf", kind: "detail", name: "reader" } },
        b: { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", groups: "open" } } },
    });
    app.push(desk);
    reader().hold(lamp, desk as any);
    await until(() => links().target?.id === lamp.id && links().data !== null && links().rows().some(r => r.kind === "backlink"), "the lamp's backlinks");
    await act("tile.focus", {}, "reader");
  };
  const restoreAll = async () => { for (const m of [lamp, porch, hall, bulb]) if (await deleted(m)) await board.restore(m.id).catch(() => {}); };

  test("a reader: d says what would go, d again trashes it with the note under it; ctrl+z brings both back", async () => {
    await setup();
    ch("d");
    await until(() => screen().includes("trash “The lamp”?"), "the choice drawn");
    expect(screen()).toContain("trash it and the 1 note under it");
    expect(await deleted(lamp)).toBe(false);
    ch("d");
    await until(() => message().includes("trashed “The lamp” and the 1 note under it"), "trashed, said");
    expect(await deleted(lamp)).toBe(true);
    expect(await deleted(bulb)).toBe(true);
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => message().includes("brought back “The lamp”"), "brought back, said");
    expect(await deleted(lamp)).toBe(false);
    expect(await deleted(bulb)).toBe(false);
  }, 20_000);

  test("any other key keeps it; the mouse does the same two steps: the tile menu's row, a click on the first row", async () => {
    await setup();
    await act("tile.focus", {}, "reader");
    ch("d");
    await until(() => screen().includes("trash “The lamp”?"), "the choice drawn");
    key({ kind: "esc" });
    expect(screen()).not.toContain("trash “The lamp”?");
    expect(await deleted(lamp)).toBe(false);
    // The tile menu lists the row; running it asks the same way.
    const menu = await act("tile.menu", {}, "reader", "test-agent");
    expect(menu.rows.find((r: any) => r.action === "note.trash")).toMatchObject({ label: "trash this note", key: "d" });
    await act("note.trash", {}, "reader");
    await until(() => screen().includes("trash “The lamp”?"), "the choice drawn again");
    const lines = desk.render(D().ctx).lines.map(plain), y = lines.findIndex(l => l.includes("trash it and the 1 note under it")), x = lines[y]!.indexOf("trash it") + 2;
    key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => message().includes("trashed “The lamp”"), "trashed by the click");
    expect(await deleted(lamp)).toBe(true);
    await act("note.untrash");
    expect(await deleted(lamp)).toBe(false);
    await restoreAll();
  }, 20_000);

  test("a links list: d d on the selected backlink trashes that note, not the one the reader holds", async () => {
    await setup();
    await act("tile.focus", {}, "links");
    const hallRow = links().rows().findIndex(r => r.kind === "backlink" && r.source.blockId === hall.id);
    await act("backlinks.pick", { n: hallRow + 1 });
    ch("d");
    await until(() => screen().includes("trash “Hall”?"), "the choice names the row's note");
    key({ kind: "delete" });
    await until(() => message().includes("trashed “Hall”"), "trashed");
    expect(await deleted(hall)).toBe(true);
    expect(await deleted(lamp)).toBe(false);
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => message().includes("brought back “Hall”"), "brought back");
    expect(await deleted(hall)).toBe(false);
  }, 20_000);

  test("the tree: d d on the selected note", async () => {
    await setup();
    await act("tile.focus", {}, "tree");
    await until(() => (desk.pane("tree") as any).subject?.(), "the tree has a selected note");
    await act("tree.pick", { id: porch.id }, "tree");
    const title = (await board.get((desk.pane("tree") as any).subject()))!.text.split("\n")[0];
    ch("d"); ch("d");
    await until(() => message().includes(`trashed “${title}”`), `the tree's note ${title} trashed (${message()})`);
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => message().includes(`brought back “${title}”`), "brought back");
    await restoreAll();
  }, 20_000);

  test("an agent says it twice (confirm=); the Inbox, a note in the Trash and a note with a draft open are refused with why", async () => {
    await setup();
    await expect(act("note.trash", { ref: porch.id }, "reader", "test-agent")).rejects.toThrow("confirm=<the note's id>");
    await expect(act("note.trash", { ref: porch.id, confirm: hall.id }, "reader", "test-agent")).rejects.toThrow("doesn't name");
    const done = await act("note.trash", { ref: porch.id, confirm: porch.id.slice(0, 8) }, "reader", "test-agent");
    expect(done).toMatchObject({ trashed: porch.id, title: "Porch", recordedAs: "agent test-agent" });
    expect(await deleted(porch)).toBe(true);
    await expect(act("note.trash", { ref: porch.id }, "reader")).rejects.toThrow("in the Trash already");
    expect(await act("note.untrash", {}, undefined, "test-agent")).toMatchObject({ restored: porch.id });
    await expect(act("note.trash", { ref: inbox.id }, "reader")).rejects.toThrow("one of the outline's own");
    const root = (await board.roots()).find(r => prop(r, "type") === "workspace")!;
    await expect(act("note.trash", { ref: root.id }, "reader")).rejects.toThrow("the outline's own root");
    // A draft open on it (the person's edit): refused, the words stay.
    await act("tile.focus", {}, "reader");
    ch("e");
    await until(() => reader().editing, "an edit open on the lamp");
    await expect(act("note.trash", { ref: lamp.id }, "links")).rejects.toThrow("has a draft open");
    key({ kind: "esc" });
    // …and so is a draft open under it: the trash would take the child with it.
    reader().hold(bulb, desk as any);
    await until(() => reader().msg?.id === bulb.id, "the bulb in the reader");
    ch("e");
    await until(() => reader().editing, "an edit open on the bulb");
    await expect(act("note.trash", { ref: lamp.id }, "links")).rejects.toThrow("a note under “The lamp” has a draft open");
    key({ kind: "esc" });
    key({ kind: "esc" });
    await restoreAll();
  }, 30_000);

  test("a note saved while the choice was open is refused, not trashed unseen; ctrl+z passes over a note brought back elsewhere", async () => {
    await setup();
    const seen = (await board.get(hall.id))!;
    await board.update(hall.id, `${seen.text}\nA new line.`, seen.revision!);
    await expect(act("note.trash", { ref: hall.id, confirm: hall.id, revision: seen.revision }, "reader", "test-agent")).rejects.toThrow("changed while you were deciding");
    expect(await deleted(hall)).toBe(false);
    // Two trashed by an agent; the newer brought back by someone else: its undo restores the older.
    await act("note.trash", { ref: porch.id, confirm: porch.id }, "reader", "test-agent");
    await act("note.trash", { ref: hall.id, confirm: hall.id }, "reader", "test-agent");
    await board.restore(hall.id);
    expect(await act("note.untrash", {}, undefined, "test-agent")).toMatchObject({ restored: porch.id });
    expect(await deleted(porch)).toBe(false);
  }, 20_000);
});
