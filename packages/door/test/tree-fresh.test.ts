// The outline tree keeps its rows current: a note edited (by the door's own save or another client: Detail, an agent,
// the CLI) reads with its new text in the tree, a note created shows up, and picking a row shows the note as it is now,
// never the copy the tree read when it opened. Also after the outline host restarts under the door. Against a fresh
// scratch outline (a new outline's notes are its top level), with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import type { TreePane } from "../src/desk/tree";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));

describe.skipIf(!outliner)("the outline tree stays current", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, desk: Desk;
  let rack: Msg, cable: Msg, patch: Msg;
  const D = () => desk as any;
  const tree = () => [...D().panes.values()].find((p: any) => p.kind === "tree") as TreePane;
  const reader = () => [...D().panes.values()].find((p: any) => p.kind === "reader") as ReaderPane;
  const rows = () => tree().describe().rows;
  const has = (text: string) => rows().some(r => r.text === text);
  /** Pick the row of note `id`, as j and k (or a click) would: its note goes to the reader. */
  const pick = (id: string) => { const r = rows().find(x => x.id === id); if (!r) throw new Error(`no row for ${id}`); tree().selectRow(r.n - 1, desk); };
  const reads = (id: string, text: string) => until(() => reader()?.msg?.id === id && reader().msg!.text === text, `the reader on ${id} reading ${JSON.stringify(text)}`);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start(), 2000);
    board.reconnectMs = 50;
    await board.info();
    rack = await board.createBlock(null, "Rack log");
    cable = await board.createBlock(null, "Cable log");
    patch = await board.createBlock(cable.id, "Patch panel");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    await until(() => has("Rack log") && has("Cable log"), "the tree's top level");
    await tree().reveal(patch, desk);
    await until(() => has("Patch panel"), "the child row");
    other = new SocketBoard(scratch.sock);
    await other.info();
  }, 60_000);

  afterAll(async () => { other?.close(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("the door's own save: back on the note from the tree, the reader shows what was saved", async () => {
    pick(rack.id);
    await reads(rack.id, "Rack log");
    rack = await board.update(rack.id, "Rack log\nSwapped the PSU in bay 2.", rack.revision!);
    pick(cable.id);
    await reads(cable.id, "Cable log");
    pick(rack.id);
    await reads(rack.id, "Rack log\nSwapped the PSU in bay 2.");
  }, 60_000);

  test("another client's edit and create: the tree reads the new title, the new note and the changed child", async () => {
    await other.update(cable.id, "Cable log, labelled\nEvery run tagged.", (await other.get(cable.id))!.revision!);
    await other.createBlock(null, "Fan log");
    await other.update(patch.id, "Patch panel, 24 ports", (await other.get(patch.id))!.revision!);
    await until(() => has("Cable log, labelled") && has("Fan log") && has("Patch panel, 24 ports"), "the edited and the new rows");
    pick(cable.id);
    await reads(cable.id, "Cable log, labelled\nEvery run tagged.");
  }, 60_000);

  test("after the outline host restarts under the door, the tree still hears and reads changes", async () => {
    await scratch.restart();
    await until(() => !app.offline && (board as any).sub && !(board as any).sub.lost, "the door back on the outline");
    other.close();
    other = new SocketBoard(scratch.sock);
    await other.info();
    await other.update(rack.id, "Rack log\nSwapped the PSU in bay 2.\nFans cleaned.", (await other.get(rack.id))!.revision!);
    await other.createBlock(null, "UPS log");
    await until(() => has("UPS log"), "the note made after the restart");
    pick(cable.id);
    pick(rack.id);
    await reads(rack.id, "Rack log\nSwapped the PSU in bay 2.\nFans cleaned.");
  }, 60_000);
});
