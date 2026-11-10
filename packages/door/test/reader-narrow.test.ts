// A note read in a 44- or 60-column tile and on the full screen (PIE-1685, PIE-1686, PIE-1687, PIE-1701), driven as a
// person works: a desk in the door's App on a scratch outline, the person's keys and mouse, painted frames. The byline
// reads whole (its pieces move to the next row whole, none cut while a row has room), a click on its property count
// opens the panel as `i` does, a saved passage comment leaves the reader where it was, the comment's hint row stays in
// its frame, and comment.close with nothing open refuses. Made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { openScreen } from "../src/desk/screen-specs";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard, USER } from "../src/socket";
import { width } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const TITLE = "Seed swap stall";
const NOTE = `${TITLE} [type::plan] [work-stage::queued] [priority::medium] [track::garden] [owner::ana] [due::2026-11-02]\nBring the labels for the bean seed.\n\nThe kettle is in the shed by the gate.`;

describe.skipIf(!outliner)("a note read at 44, 60 and full width", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [], note!: Msg;
  let cols = 200, rows = 40;
  let key: (k: Key) => void = () => {};
  const frame = () => { (app as any).paint(); return painted.map(plain); };
  const desk = () => (app as any).stack.at(-1) as any;
  const reader = () => desk().panes.get(desk().focus) as ReaderPane;
  const ch = (c: string) => key({ kind: "char", ch: c });
  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  /** The byline as painted: the rows under the title down to the first blank one, each its frame's inside. */
  const byline = () => {
    const f = frame(), t = f.findIndex(l => l.replace(/[│║]/g, "").trim() === TITLE);
    if (t < 0) throw new Error(`no title in:\n${f.join("\n")}`);
    const out: string[] = [];
    for (let y = t + 1; y < f.length && f[y]!.replace(/[│║█]/g, "").trim(); y++) out.push(f[y]!);
    return { f, at: t + 1, rows: out };
  };
  const at = async (w: number) => {
    cols = w + 2;
    await until(() => byline().rows.length > 0, `the byline at ${w}`);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    note = await board.createBlock(null, NOTE);
    // Three comments on one passage: their marks widen the gutter (PIE-1686), so the byline has fewer cells.
    for (const [n, body] of ["Who brings the trestles?", "Labels are in the shed.", "Ask Ana about the bean seed."].entries())
      await board.comment(`narrow-${n}`, note.id, note.revision!, body, { quote: "Bring the labels", start: NOTE.indexOf("Bring the labels") });
    const term = { info: { get cols() { return cols; }, get rows() { return rows; }, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(openScreen("desk"));
    await app.dispatch.act({ action: "open", args: { id: note.id } }, USER);
    await until(() => reader() instanceof ReaderPane && reader().msg?.id === note.id && !!reader().surface.comments?.length, "the note and its comments", 10_000);
    // The reader alone fills the screen, so its frame is `cols` wide and its inside the width the test names.
    await app.dispatch.act({ action: "tile.zoom", args: { on: true } }, USER);
  }, 30_000);
  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("the byline reads whole at 44, 60 and 90 columns, in every margin mode: whole pieces, never a cut word or a run of spaces (PIE-1686)", async () => {
    for (const w of [90, 60, 44]) {
      await at(w);
      for (let mode = 0; mode < 4; mode++) {
        const { rows: drawn } = byline(), all = drawn.join("\n");
        const where = `${w} columns, margin ${reader().surface.marginMode}:\n${all}`;
        for (const r of drawn) expect(width(r), where).toBeLessThanOrEqual(cols);
        expect(all, where).not.toContain("…");
        expect(all, where).not.toMatch(/\S {2,}·/);
        for (const piece of [/\d\d-\d\d-\d\d \(\d\d:\d\d\)/, /i 6 properties/, /stage queued/, /priority medium/, /track garden/, /■ 3 comments/])
          expect(drawn.some(r => piece.test(r)), `${piece} whole at ${where}`).toBe(true);
        expect(all, where).toContain("(M)");
        ch("M");
      }
    }
  });

  test("a comment's hint stays in its frame at 44 columns, the thread list's keeps its esc at 60, and comment.close with none open refuses (PIE-1701)", async () => {
    const bottom = () => frame().find(l => l.startsWith("╚")) ?? "";
    // At 44 the status bar holds "reader 2 · writing" here; at 38 it cuts it, as a fuller bar does at 44 (the showcase's).
    for (const w of [44, 38]) {
      await at(w);
      ch("C");                                                   // nothing selected: a comment on the whole note
      await until(() => reader().surface.session?.mode === "compose", "writing a comment");
      // The tile's own hint row is its frame's bottom, never covered by the status bar's "… · writing" said whole.
      // Right away, while the flash is up (it goes after 4 s).
      expect(bottom(), `the comment's hint in its frame at ${w}:\n${frame().slice(-5).join("\n")}`).toStartWith("╚═ esc");
      key({ kind: "esc" });
      await until(() => !reader().surface.session, "the comment closed");
    }
    await at(60);
    ch("m");
    await until(() => reader().surface.session?.mode === "threads", "the thread list");
    await until(() => /^╚═ esc done/.test(bottom()), `the list's esc, first in its hint: ${bottom()}`);
    key({ kind: "esc" });
    await until(() => !reader().surface.session, "the list closed");
    await expect(app.dispatch.act({ action: "comment.close", args: {}, tile: desk().nameOf(desk().focus) }, { kind: "agent", id: "narrow-test" })).rejects.toThrow("no comment is open");
  });

  test("a click on the byline's property count opens the property panel, as i does, at 90 and 44 columns (PIE-1685)", async () => {
    for (const w of [90, 44]) {
      await at(w);
      const { rows: drawn, at: top } = byline();
      const y = drawn.findIndex(r => r.includes("i 6 properties"));
      expect(y, drawn.join("\n")).toBeGreaterThanOrEqual(0);
      click(drawn[y]!.indexOf("i 6 properties") + 2, top + y);
      await until(() => !!reader().surface.panel, `the property panel at ${w}`);
      expect(frame().join("\n")).toContain("properties · 6");
      key({ kind: "esc" });
      await until(() => !reader().surface.panel, "the panel closed");
    }
  });
});

describe.skipIf(!outliner)("a passage comment saved with ctrl+s leaves the reader where it was (PIE-1687)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [], note!: Msg;
  let key: (k: Key) => void = () => {};
  const frame = () => { (app as any).paint(); return painted.map(plain); };
  const desk = () => (app as any).stack.at(-1) as any;
  const reader = () => desk().panes.get(desk().focus) as ReaderPane;
  const type = (s: string) => { for (const c of s) key({ kind: "char", ch: c }); };
  const save = () => key({ kind: "char", ch: "s", ctrl: true });
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const threads = async () => (await board.comments(note.id)).length;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    note = await board.createBlock(null, NOTE);
    const term = { info: { cols: 100, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(openScreen("desk"));
    await app.dispatch.act({ action: "open", args: { id: note.id } }, USER);
    await until(() => reader() instanceof ReaderPane && reader().msg?.id === note.id && !!reader().surface.comments, "the note", 10_000);
    await app.dispatch.act({ action: "tile.zoom", args: { on: true } }, USER);
  }, 30_000);
  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  const backReading = async (before: number, what: string) => {
    await until(() => !reader().surface.session, `${what}: back to reading`);
    expect(await threads()).toBe(before + 1);
    // The thread sits where the composer was, open, and the note is still what the reader shows.
    await until(() => reader().surface.expanded.size > 0 && frame().some(l => l.includes("┌─ comment")), `${what}: the thread in place`);
    expect(frame().join("\n")).not.toContain("» comments ·");
    expect(reader().surface.describe().showing?.id).toBe(note.id);
  };

  test("on a passage picked for them (an agent's passage.select, as the showcase opens its four), ⏎ to write, ctrl+s", async () => {
    const before = await threads();
    await app.dispatch.act({ action: "passage.select", args: { quote: "The kettle" }, tile: desk().nameOf(desk().focus) }, { kind: "agent", id: "narrow-test" });
    await until(() => reader().surface.session?.mode === "select", "the passage picked");
    key({ kind: "enter" });                                  // in it
    key({ kind: "enter" });                                  // write on the passage
    await until(() => reader().surface.session?.mode === "compose", "writing");
    type("Which shed?");
    save();
    await backReading(before, "a picked passage");
  });

  test("on words selected with the mouse, then C, ctrl+s", async () => {
    if (reader().surface.session) await app.dispatch.act({ action: "comment.close", args: { discard: true } }, USER);
    const before = await threads();
    const f = frame(), y = f.findIndex(l => l.includes("Bring the labels")), x = f[y]!.indexOf("Bring");
    mouse("down", x, y); mouse("drag", x + 10, y); mouse("up", x + 10, y);
    await until(() => !!reader().surface.selection, "the words selected");
    type("C");
    await until(() => reader().surface.session?.mode === "compose", "writing on the words");
    type("How many?");
    save();
    await backReading(before, "selected words");
  });
});
