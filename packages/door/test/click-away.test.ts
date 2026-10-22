// Going elsewhere from an edit or a comment (PIE-785, PIE-812): a click on another tile, or a window key, leaves it open
// where it is, as it was, never saved or sent behind the person's back, and the keys coming back put them straight into
// it at the same cursor. Saving is explicit (ctrl+s); leaving (session.leave) saves a changed edit, and keeps one the
// service refuses as unsent.
// An agent never leaves, saves or moves the person's draft for them. Runs a desk in the App against a scratch outliner
// service (never a real outline), with fictional notes.
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

describe.skipIf(!outliner)("going elsewhere from an edit, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, desk: Desk, key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;
  const current = async (id: string) => (await board.get(id))!;
  const reader = () => D().panes.get(D().focus) as ReaderPane;
  const message = () => ((app as any).message ?? "") as string;
  const type = (s: string) => { for (const c of s) key(char(c)); };

  /** Open through the shared action: parallel arming fixtures may make a single e only arm the edit. */
  async function editing(text: string) {
    const id = await create(text);
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader to show the note");
    const rd = reader();
    await D().dispatch.press("edit", {}, D().nameOf(D().focus));
    await until(() => !!rd.draft, "the draft");
    await D().dispatch.press("draft.place", { line: 1 }, D().nameOf(D().focus));
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

  test("PIE-920: a folded reader opens the same source line in the same screen row, with an edit scroll bar", async () => {
    const text = "The orchard\n[topic::fruit]\n## Hidden\nSecret seedlings\n## Rows\n" + Array.from({ length: 80 }, (_, n) => `Orchard row ${n}`).join("\n");
    const id = await create(text);
    desk.openBlock((await current(id)));
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the orchard");
    const rd = reader(), name = D().nameOf(D().focus);
    await D().dispatch.press("fold", { text: "Hidden" }, name);
    desk.render(app);
    await D().dispatch.press("scroll", { by: 30 }, name);
    const screen = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    const before = screen();
    const y = before.findIndex(l => /Orchard row \d+/.test(l));
    const label = before[y]!.match(/Orchard row \d+/)![0];
    key({ kind: "mouse", action: "down", button: 0, x: before[y]!.indexOf(label) + 2, y });
    key({ kind: "mouse", action: "up", button: 0, x: before[y]!.indexOf(label) + 2, y });
    key(char("e"));
    await until(() => !!rd.draft, "the edit");
    const after = screen();
    expect(after.findIndex(l => l.includes(label))).toBe(y);
    expect(rd.draft!.row).toBe(text.split("\n").indexOf(label));
    expect(rd.draft!.col).toBe(0);
    expect(rd.render(70, 35, false, D()).scroll).toBeDefined();
    key({ kind: "esc" });
  });

  test.each([false, true])("PIE-920: a reader table opens raw edit on the visible data row (callout=%s)", async (callout) => {
    const table = "| Crop | Count |\n| --- | --- |\n" + Array.from({ length: 50 }, (_, i) => `| Crop ${i} | ${i} |`).join("\n");
    const text = "Harvest inventory\n" + (callout ? "> [!note]\n" + table.split("\n").map(l => "> " + l).join("\n") : table);
    const id = await create(text);
    desk.openBlock(await current(id)); desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the table");
    const rd = reader(), name = D().nameOf(D().focus);
    const rows = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    rows();
    let previous = -1;
    for (let step = 0; step < 30; step++) {
      await D().dispatch.press("scroll", { by: 1 }, name);
      const visible = rows().join("\n").match(/Crop (\d+)/);
      const next = Number(visible![1]);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    const before = rows(), y = before.findIndex(l => /Crop \d+/.test(l));
    const label = before[y]!.match(/Crop \d+/)![0];
    key({ kind: "mouse", action: "down", button: 0, x: before[y]!.indexOf(label) + 2, y });
    key({ kind: "mouse", action: "up", button: 0, x: before[y]!.indexOf(label) + 2, y });
    key(char("e")); await until(() => !!rd.draft, "the raw table");
    expect(rows().findIndex(l => l.includes(label))).toBe(y);
    expect(rd.draft!.row).toBe(text.split("\n").findIndex(l => l.includes(label)));
    key({kind: "esc"});
  });

  test("PIE-920: reopening the same note preserves a held edit viewport", async () => {
    const {id, rd} = await editing("Long inventory\n" + Array.from({length: 80}, (_, i) => `Shelf ${i}`).join("\n"));
    const rows = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    rows(); rd.draft!.scrollBy(20); clickElsewhere();
    const before = rows(), y = before.findIndex(l => /Shelf \d+/.test(l));
    const label = before[y]!.match(/Shelf \d+/)![0];
    desk.openBlock(await current(id));
    expect(rows().findIndex(l => l.includes(label))).toBe(y);
    await D().dispatch.press("edit.close", {discard: true}, "reader");
  });

  test("PIE-920: scrolling a held edit survives focus; the next click places the cursor and typing follows it", async () => {
    const { rd } = await editing("Cane inventory\n" + Array.from({ length: 90 }, (_, i) => `Cane number ${i}`).join("\n"));
    const d = rd.draft!;
    const screen = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    const at = (label: string) => { const lines = screen(), y = lines.findIndex(l => l.includes(label)); return { x: lines[y]!.indexOf(label) + 3, y }; };
    clickElsewhere();
    const first = at("Cane number 0");
    for (let i = 0; i < 12; i++) key({ kind: "mouse", action: "wheel-down", button: 65, ...first });
    const before = screen();
    const y = before.findIndex(l => /Cane number \d+/.test(l));
    const label = before[y]!.match(/Cane number \d+/)![0];
    expect(label).not.toBe("Cane number 0");
    const here = at(label), cursor = { row: d.row, col: d.col };
    const click = () => { key({ kind: "mouse", action: "down", button: 0, ...here }); key({ kind: "mouse", action: "up", button: 0, ...here }); };
    click();
    expect(screen().findIndex(l => l.includes(label))).toBe(y);
    expect({ row: d.row, col: d.col }).toEqual(cursor);
    click();
    expect(d.row).toBe(d.lines.indexOf(label));
    expect(d.anchor).toBeNull();
    const placed = d.row;
    for (let i = 0; i < 12; i++) key({ kind: "mouse", action: "wheel-down", button: 65, ...here });
    type("!");
    expect(d.row).toBe(placed);
    expect(screen().join("\n")).toContain(d.lines[placed]!);
    key({ kind: "esc" }); key({ kind: "esc" });
  });

  test("a click on another tile leaves the edit open as it was; the keys coming back are in it at the same cursor (PIE-812)", async () => {
    const { id, rd, name } = await editing("Plant the leeks\nin the far bed");
    const d = rd.draft!, before = (await current(id)).revision;
    await until(() => !!board.heldDraft(id)?.holdId, "the service's hold on the draft");
    type(" today");
    const to = clickElsewhere();
    expect(D().nameOf(D().focus)).toBe(to);                            // the click did what it does: focus
    // Still open, the same draft session, nothing saved, held, and the person isn't in it while away.
    await Bun.sleep(150);
    expect(rd.draft).toBe(d);
    expect(d.text).toBe("Plant the leeks today\nin the far bed");
    expect((await current(id)).revision).toBe(before);
    expect(board.heldDraft(id)?.holdId).toBeTruthy();
    expect(D().isIn(rd)).toBe(false);
    // The other tile has the keys: j there doesn't type into the edit.
    key(char("j"));
    expect(d.text).toBe("Plant the leeks today\nin the far bed");
    // A click back in the edit's text (on its second line, away from the cursor): in it again, typing where the cursor
    // was, with no e.
    const screen = () => (app as any).stack.at(-1).render(app).lines.map((l: string) => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "")) as string[];
    const at = (text: string) => { const rows = screen(), y = rows.findIndex(l => l.includes(text)); return { x: rows[y]!.indexOf(text) + 2, y }; };
    const far = at("in the far bed");
    key({ kind: "mouse", action: "down", button: 0, ...far });
    key({ kind: "mouse", action: "up", button: 0, ...far });
    await Bun.sleep(50);
    expect(D().nameOf(D().focus)).toBe(name);
    expect(D().isIn(rd)).toBe(true);
    type(" now");
    expect(d.text).toBe("Plant the leeks today now\nin the far bed");
    // Give the frame room for its preview control after the earlier busy-reader open.
    await D().dispatch.press("tile.resize", { by: 2 }, name);
    // Away again, then back by a click on the frame's [preview]: the control runs, and the cursor is still kept.
    clickElsewhere();
    const pv = at("[preview]");
    key({ kind: "mouse", action: "down", button: 0, ...pv });
    key({ kind: "mouse", action: "up", button: 0, ...pv });
    await until(() => !!d.preview, "the preview on");
    type("!");
    expect(d.text).toBe("Plant the leeks today now!\nin the far bed");
    // Saving is the person's own step.
    key(ctrl("s"));
    await until(() => !rd.draft, "the save");
    expect((await current(id)).text).toBe("Plant the leeks today now!\nin the far bed");
    expect(unsent(`edit:${id}`)).toBeNull();
    expect(board.heldDraft(id)).toBeNull();              // the hold (drafts.hold) went with the draft
  }, 30_000);

  test("moving away by keys (^W then a tile) keeps the edit too, and focusing back is in it", async () => {
    const { id, rd, name } = await editing("Oil the gate\nhinges squeak");
    const before = (await current(id)).revision;
    type(" and the latch");
    for (const c of "hjkl") { if (D().nameOf(D().focus) !== name) break; key(ctrl("w")); key(char(c)); }
    expect(D().nameOf(D().focus)).not.toBe(name);
    expect(rd.draft?.text).toBe("Oil the gate and the latch\nhinges squeak");
    desk.focusOn(name);
    expect(D().isIn(rd)).toBe(true);
    type(" too");
    expect(rd.draft?.text).toBe("Oil the gate and the latch too\nhinges squeak");
    // esc twice: closed, put aside as unsent (the draft session's rule), nothing written.
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(rd.draft).toBeNull();
    expect((await current(id)).revision).toBe(before);
    expect(unsent(`edit:${id}`)?.text).toBe("Oil the gate and the latch too\nhinges squeak");
  }, 30_000);

  test("a save the service refuses (a conflict) keeps the draft as unsent, says so, and e brings its copy's place back", async () => {
    const { id, rd, name } = await editing("Net the brassicas\nbefore the pigeons");
    type(" soon");
    const m = await current(id);
    await other.update(id, "Net the brassicas\nbefore the pigeons land", m.revision!, { kind: "agent", id: "gardener" });
    await D().dispatch.press("session.leave", {}, name);
    await until(() => !rd.draft, "the edit put aside");
    expect(message()).toMatch(/^not saved: it changed elsewhere since you started · the edit to “Net the brassicas” is kept here · a copy is at /);
    expect((await current(id)).text).toBe("Net the brassicas\nbefore the pigeons land");   // theirs stands: nothing overwritten
    expect(unsent(`edit:${id}`)?.text).toBe("Net the brassicas soon\nbefore the pigeons");  // and ours is kept
    expect(board.heldDraft(id)).toBeNull();
    // Back in the reader, e says where it is (the note moved on since it was written).
    desk.focusOn(name);
    key(char("e"));
    await until(() => !!rd.draft, "the draft again");
    expect(rd.draft!.note).toContain("the note has changed since · your edit is kept");
    key({ kind: "esc" });
  }, 30_000);

  test("offline, the edit is kept as unsent with the reason", async () => {
    const { id, rd, name } = await editing("Sharpen the shears\nbefore spring");
    type("!");
    const was = board.update.bind(board);
    (board as any).update = async () => { throw new Error("offline · the outline isn't answering"); };
    try {
      await D().dispatch.press("session.leave", {}, name);
      await until(() => !rd.draft, "the edit put aside");
    } finally { (board as any).update = was; }
    expect(message()).toContain("not saved: offline · the outline isn't answering · the edit to “Sharpen the shears” is kept here · e brings it back");
    expect(unsent(`edit:${id}`)?.text).toBe("Sharpen the shears!\nbefore spring");
    // e brings it back, as typed.
    desk.focusOn(name);
    key(char("e"));
    await until(() => !!rd.draft, "the draft again");
    expect(rd.draft!.text).toBe("Sharpen the shears!\nbefore spring");
    key({ kind: "esc" }); key({ kind: "esc" });
  }, 30_000);

  test("a comment being written stays open when the keys go elsewhere, and is the person's again when they come back (PIE-785)", async () => {
    const id = await create("Mulch the roses\nwith bark from the heap");
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader");
    const rd = reader(), name = D().nameOf(D().focus) as string;
    key(char("C"));
    await until(() => !!rd.surface.session?.composer, "the comment composer");
    type("How much bark?");
    const went = clickElsewhere();
    // The other tile has the keys; the comment is still open, on screen, as it was, and nothing was sent or put aside.
    expect(D().nameOf(D().focus)).toBe(went);
    expect([rd.surface.session?.mode, rd.surface.session?.composer?.text]).toEqual(["compose", "How much bark?"]);
    expect(D().isIn(rd)).toBe(false);
    expect(unsent(`comment:${id}`)).toBeNull();
    // The keys back on the reader: the person is in the comment again, no reopening.
    desk.focusOn(name);
    expect(D().isIn(rd)).toBe(true);
    type(" Two sacks");
    expect(rd.surface.session?.composer?.text).toBe("How much bark? Two sacks");
    await Bun.sleep(150);
    expect(await board.comments(id)).toEqual([]);
    // Leaving it on purpose: esc twice puts it aside as unsent and closes it (a comment on the whole note: C with
    // nothing selected, PIE-846).
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(unsent(`comment:${id}`)?.text).toBe("How much bark? Two sacks");
    expect(rd.surface.session).toBeNull();
  }, 30_000);

  test("following a link with a comment unsent asks: save and continue keeps it unsent and goes; keep writing stays; an agent never asks (PIE-785)", async () => {
    const shed = await create("The potting shed");
    const id = await create(`Repot the figs\nin the ((${shed}))`);
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader");
    const rd = reader(), name = D().nameOf(D().focus) as string;
    key(char("C"));
    await until(() => !!rd.surface.session?.composer, "the comment composer");
    type("Which pots?");
    // An agent's follow never asks the person (and doesn't move their reader).
    await expect(app.act({ action: "link.follow", tile: name, args: { n: 1 }, as: "tidy" })).rejects.toThrow();
    expect(rd.surface.state()).toBe("writing · unsent");
    // The person's: asked in the power bar. "keep writing" (typed to find it, ⏎) goes back to it; esc there would too.
    expect(await D().dispatch.press("link.follow", { n: 1 }, name)).toMatchObject({ asking: "choice", action: "about to leave an unsent comment" });
    await until(() => !!app.bar, "the power bar asking");
    type("keep"); key({ kind: "enter" });
    await until(() => rd.msg?.id === id && D().nameOf(D().focus) === name, "back to writing");
    expect(rd.surface.session?.mode).toBe("compose");
    type(" Clay");
    expect(rd.surface.session?.composer?.text).toBe("Which pots? Clay");
    // Asked again, s: kept as unsent, and the reader goes where the link goes.
    await D().dispatch.press("link.follow", { n: 1 }, name);
    await until(() => !!app.bar, "asked again");
    key({ kind: "enter" });                                             // the first row: save and continue
    await until(() => rd.msg?.id === shed, "the reader on the linked note");
    expect(rd.surface.session).toBeNull();
    expect(unsent(`comment:${id}`)?.text).toBe("Which pots? Clay");
    expect(await board.comments(id)).toEqual([]);
    // On the shed, another comment, then back: d discards it (nothing kept to come back) and the reader goes.
    key(char("C"));
    await until(() => !!rd.surface.session?.composer, "a second composer");
    type("Never mind");
    await D().dispatch.press("back", {}, name);
    await until(() => !!app.bar, "asked on the shed");
    type("discard"); key({ kind: "enter" });
    await until(() => rd.msg?.id === id, "back on the figs");
    expect(unsent(`comment:${shed}`)).toBeNull();
    expect(await board.comments(shed)).toEqual([]);
    // The figs' comment put aside before is still there to come back.
    expect(unsent(`comment:${id}`)?.text).toBe("Which pots? Clay");
  }, 30_000);

  test("an agent can't leave, save or move off the person's draft; ^W then a window key runs and the edit stays open", async () => {
    const { id, rd, name } = await editing("Prune the apple\nin winter");
    type(" tree");
    await expect(app.act({ action: "session.leave", tile: name, as: "tidy" })).rejects.toThrow("an agent doesn't save or close it");
    await expect(app.act({ action: "tile.focus", tile: "1", as: "tidy" })).rejects.toThrow();
    expect(rd.draft?.text).toBe("Prune the apple tree\nin winter");
    expect(D().nameOf(D().focus)).toBe(name);
    type("s");                                                          // still the person's keys
    expect(rd.draft?.text).toBe("Prune the apple trees\nin winter");
    // ^W arms the window keys; the next one runs (^W w: save a layout, asking its name), and the edit stays open, unsaved.
    key(ctrl("w"));
    key(char("w"));
    await Bun.sleep(100);
    expect(rd.draft?.text).toBe("Prune the apple trees\nin winter");
    expect((await current(id)).text).toBe("Prune the apple\nin winter");
    key({ kind: "esc" });                                               // the layout's name put away: back in the edit
    expect(D().isIn(rd)).toBe(true);
    key(ctrl("s"));
    await until(() => !rd.draft, "the save");
    expect((await current(id)).text).toBe("Prune the apple trees\nin winter");
  }, 30_000);
});
