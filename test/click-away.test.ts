// Leaving an edit by a click elsewhere, as in any editor (session.leave): a changed edit is saved, an
// unchanged one closes, one the service refuses is kept as unsent, a comment is kept as unsent (never
// sent), an agent never leaves the person's draft for them, and the draft's hold goes with it. Runs a desk
// in the App against a scratch outliner service (never a real outline), with fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { unsent } from "../src/draft-session";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("a click away from an edit, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, desk: Desk, key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;
  const current = async (id: string) => (await board.get(id))!;
  const reader = () => D().panes.get(D().focus) as ReaderPane;
  const message = () => ((app as any).message ?? "") as string;
  const type = (s: string) => { for (const c of s) key(char(c)); };

  /** The note open in the desk's reader, the person in its edit (their own `e`). */
  async function editing(text: string) {
    const id = await create(text);
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader to show the note");
    const rd = reader();
    key(char("e"));
    await until(() => !!rd.draft, "the draft");
    return { id, rd, name: D().nameOf(D().focus) as string };
  }

  /** Press and release on another tile than the focused one (its middle). */
  function clickElsewhere(): string {
    D().render(D().ctx);
    const [id, r] = (D().hits as [number, { col: number; row: number; cols: number; rows: number }][]).find(([t]) => t !== D().focus)!;
    const x = r.col + Math.floor(r.cols / 2), y = r.row + Math.floor(r.rows / 2);
    key({ kind: "mouse", action: "down", button: 0, x, y });
    key({ kind: "mouse", action: "up", button: 0, x, y });
    return D().nameOf(id);
  }

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});                                          // drafts are held only on a subscribed connection
    other = new SocketBoard(scratch.sock);
    await other.info();
    const term = { info: { cols: 160, rows: 45, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    desk = new Desk();
    app.push(new MainMenu()); app.push(desk);
  }, 30_000);
  afterAll(async () => { app?.quit(); board?.close(); other?.close(); await scratch.dispose(); });

  test("a click on another tile saves the edit, lets go of its hold, and gives that tile the keys", async () => {
    const { id, rd } = await editing("Plant the leeks\nin the far bed");
    const d = rd.draft!;
    await until(() => !!board.heldDraft(id)?.holdId, "the service's hold on the draft");
    type(" today");
    const to = clickElsewhere();
    expect(D().nameOf(D().focus)).toBe(to);                            // the click did what it does: focus
    await until(() => !rd.draft, "the save");
    expect((await current(id)).text).toBe("Plant the leeks today\nin the far bed");
    expect(message()).toContain("saved · revision");
    expect(unsent(`edit:${id}`)).toBeNull();
    expect(board.heldDraft(id)).toBeNull();              // the hold (drafts.hold) went with the draft
    expect(d.text).toBe("Plant the leeks today\nin the far bed");
  }, 30_000);

  test("an unchanged edit just closes: nothing is written", async () => {
    const { id, rd } = await editing("Oil the gate\nhinges squeak");
    const before = (await current(id)).revision;
    clickElsewhere();
    expect(rd.draft).toBeNull();                                        // at once: nothing to save
    await Bun.sleep(100);
    expect((await current(id)).revision).toBe(before);
    expect(unsent(`edit:${id}`)).toBeNull();
    expect(board.heldDraft(id)).toBeNull();
  }, 30_000);

  test("a save the service refuses (a conflict) keeps the draft as unsent, says so, and e brings its copy's place back", async () => {
    const { id, rd, name } = await editing("Net the brassicas\nbefore the pigeons");
    type(" soon");
    const m = await current(id);
    await other.update(id, "Net the brassicas\nbefore the pigeons land", m.revision!, { kind: "agent", id: "gardener" });
    clickElsewhere();
    await until(() => !rd.draft, "the edit put aside");
    expect(message()).toMatch(/^not saved: it changed elsewhere since you started · the edit to “Net the brassicas” was kept as unsent · a copy is at /);
    expect((await current(id)).text).toBe("Net the brassicas\nbefore the pigeons land");   // theirs stands: nothing overwritten
    expect(unsent(`edit:${id}`)?.text).toBe("Net the brassicas soon\nbefore the pigeons");  // and ours is kept
    expect(board.heldDraft(id)).toBeNull();
    // Back in the reader, e says where it is (the note moved on since it was written).
    desk.focusOn(name);
    key(char("e"));
    await until(() => !!rd.draft, "the draft again");
    expect(rd.draft!.note).toContain("the note changed since · it's at");
    key({ kind: "esc" });
  }, 30_000);

  test("offline, the edit is kept as unsent with the reason", async () => {
    const { id, rd, name } = await editing("Sharpen the shears\nbefore spring");
    type("!");
    const was = board.update.bind(board);
    (board as any).update = async () => { throw new Error("offline · the outline isn't answering"); };
    try {
      clickElsewhere();
      await until(() => !rd.draft, "the edit put aside");
    } finally { (board as any).update = was; }
    expect(message()).toContain("not saved: offline · the outline isn't answering · the edit to “Sharpen the shears” was kept as unsent · e brings it back");
    expect(unsent(`edit:${id}`)?.text).toBe("Sharpen the shears!\nbefore spring");
    // e brings it back, as typed.
    desk.focusOn(name);
    key(char("e"));
    await until(() => !!rd.draft, "the draft again");
    expect(rd.draft!.text).toBe("Sharpen the shears!\nbefore spring");
    key({ kind: "esc" }); key({ kind: "esc" });
  }, 30_000);

  test("a comment being written is kept as unsent, never sent", async () => {
    const id = await create("Mulch the roses\nwith bark from the heap");
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader");
    const rd = reader();
    key(char("C"));
    await until(() => !!rd.surface.session, "the passage picker");
    key({ kind: "enter" });
    await until(() => !!rd.surface.session?.composer, "the comment composer");
    type("How much bark?");
    clickElsewhere();
    expect(rd.surface.session).toBeNull();
    await Bun.sleep(0);                                                 // said after the click's own flash, so it stays on screen
    expect(message()).toBe("the comment on “Mulch the roses” was kept as unsent, not sent · C and a passage bring it back");
    expect(unsent(`comment:${id}`)?.text).toBe("How much bark?");
    await Bun.sleep(150);
    expect(await board.comments(id)).toEqual([]);
  }, 30_000);

  test("an agent can't leave, save or move off the person's draft; ^W then a window key leaves it", async () => {
    const { id, rd, name } = await editing("Prune the apple\nin winter");
    type(" tree");
    await expect(app.act({ action: "session.leave", tile: name, as: "tidy" })).rejects.toThrow("an agent doesn't save or close it");
    await expect(app.act({ action: "tile.focus", tile: "1", as: "tidy" })).rejects.toThrow();
    expect(rd.draft?.text).toBe("Prune the apple tree\nin winter");
    expect(D().nameOf(D().focus)).toBe(name);
    type("s");                                                          // still the person's keys
    expect(rd.draft?.text).toBe("Prune the apple trees\nin winter");
    // ^W arms the window keys (the edit is still open); the next one leaves it, saving, and runs.
    key(ctrl("w"));
    expect(rd.draft).not.toBeNull();
    key(char("w"));                                                     // ^W w: save a layout (asks its name)
    await until(() => !rd.draft, "the save");
    expect((await current(id)).text).toBe("Prune the apple trees\nin winter");
    key({ kind: "esc" });
  }, 30_000);
});
