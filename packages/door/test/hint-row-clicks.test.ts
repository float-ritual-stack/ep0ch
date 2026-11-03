// Every hint row is a row of buttons (PIE-1293): a click on a segment does what its key does, through the dispatcher
// the key goes through. Driven on a real App as a person clicks: the desk, the board, detail, a reader tile's frame
// foot and the BBS reading screen. A segment whose click is refused, or changes nothing on screen, is a failure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { KeysPane } from "../src/desk/keys-window";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu, MessageReader } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const COLS = 160, ROWS = 40;

describe.skipIf(!outliner)("a click on a hint segment does what its key does (PIE-1293)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, notes: any[] = [];
  let key: (k: Key) => void = () => {};
  let painted: string[] = [];
  const said: string[] = [], ran: string[] = [];
  const frame = () => { app.redraw(); app.flush(); return painted.map(visible); };
  const stack = () => (app as any).stack as any[];
  const top = () => stack().at(-1);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const text of ["Plant the leeks\nAlong the south bed.\n\n## Rows\n- row one\n- row two\n\n## Tools\n- a dibber", "Net the brassicas\nBefore the pigeons find them.", "Lift the shallots\nWhen the tops fall."])
      notes.push(await board.request<any>("create", { parentId: null, text, author: "agent" }));
    const term = { info: { cols: COLS, rows: ROWS, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    // What the door says (a refusal on the status bar or a tile's frame): ctx.flash and ctx.refuse both come here.
    const flash = app.flash.bind(app), refuse = (app as any).refuse?.bind(app);
    (app as any).flash = (text: string, ...rest: any[]) => { said.push(visible(String(text))); return flash(text, ...rest); };
    if (refuse) (app as any).refuse = (text: string, ...rest: any[]) => { said.push(visible(String(text))); return refuse(text, ...rest); };
    // The actions a segment's click asked for (strip.pick hands the segment's own to act): a click that ran one is
    // proof it reached it, when the action has nothing to show (u up on a top-level note).
    const d = app.dispatch as any, act = d.act.bind(d);
    d.act = (req: any, actor: any) => { ran.push(req.action); return act(req, actor); };
    app.push(new MainMenu());
  }, 30_000);

  // A desk ends with its programs (the daily desk's tail -f): one left running is kept for D (Desk.resume), and the next
  // file's desk in this process would be it.
  const end = async (s: any) => {
    for (const p of s.panes?.values?.() ?? []) p.kill?.();
    if (s instanceof Desk) await until(() => !s.holdsPrograms(), "its programs ended");
    s.dispose?.();
  };
  const leave = async () => {
    while (stack().length > 1) await end(stack().pop());
    app.strips.close();
    (app as any).bar?.close?.(); (app as any).bar = null;
  };
  afterAll(async () => {
    await leave();
    await end(Desk.resume());
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  /** A row's segments (` · ` apart, as drawn), each with the column of its middle; a `…` cut end is none. */
  const segments = (row: string, from = 0, to = row.length) => {
    const out: { label: string; x: number }[] = [];
    let at = from;
    for (const part of row.slice(from, to).split(" · ")) {
      const label = part.replace(/[═╚╝║]+/g, "").replace(/…$/, "").trim();
      if (label && /\S \S/.test(label)) out.push({ label, x: at + part.indexOf(label) + Math.floor(label.length / 2) });
      at += part.length + 3;
    }
    return out;
  };
  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  const settle = () => Bun.sleep(120);

  /**
   * Open the screen `make` gives, find the row `rowOf` names, then for each of its segments open the screen again, click
   * the segment and look: refused, or nothing on the screen moved, is a failure. Answers the labels clicked.
   */
  async function clickEvery(make: () => any, rowOf: (lines: string[]) => { y: number; from?: number; to?: number }, skip?: RegExp) {
    const open = async () => { await leave(); app.push(make()); await settle(); frame(); await settle(); return frame(); };
    const first = await open(), at = rowOf(first);
    // Words that name no key (drag a title) and the lock chip (a toggle the next test would inherit) aren't clicked.
    const segs = segments(first[at.y]!, at.from, at.to).filter(s => !/^drag |lock$/.test(s.label) && !skip?.test(s.label));
    expect(segs.length).toBeGreaterThan(2);
    const failed: string[] = [];
    for (const seg of segs) {
      const before = (await open()).slice(0, ROWS - 1).join("\n"), screen = top();
      said.length = 0; ran.length = 0;
      click(seg.x, at.y);
      await settle();
      const after = frame().slice(0, ROWS - 1).join("\n"), words = said.join(" | ");
      if (/nothing here answers|needs |takes no|isn't|refused/.test(words)) failed.push(`${seg.label}: ${words}`);
      else if (after === before && top() === screen && !ran.some(a => !a.startsWith("strip."))) failed.push(`${seg.label}: the click ran nothing and changed nothing`);
    }
    expect(failed).toEqual([]);
    return segs.map(s => s.label);
  }
  const hintRow = () => ({ y: ROWS - 2 });

  // Tab with one focusable tile (detail's reader, an empty board) moves nothing, for the key too.
  test("detail's hint row: ^N new, q menu, ? keys and every other segment", async () => {
    const labels = await clickEvery(() => openScreen("detail", { target: notes[0].id, persist: false }), hintRow, /^Tab\//);
    expect(labels).toEqual(expect.arrayContaining(["^N new", "q menu", "? keys"]));
  }, 60_000);

  test("the board's hint row: every segment", async () => {
    const labels = await clickEvery(() => openScreen("board", { persist: false }), hintRow, /^Tab\//);
    expect(labels).toEqual(expect.arrayContaining(["q menu", "? keys"]));
  }, 60_000);

  test("the desk's hint row: every segment", async () => {
    const labels = await clickEvery(() => new Desk(undefined, { layout: "daily" }), hintRow, /^alt\+d /);
    expect(labels).toEqual(expect.arrayContaining(["^N new", "q menu", "? keys"]));
  }, 60_000);

  test("q menu and ? keys do what q and ? do", async () => {
    const at = async () => { await leave(); app.push(openScreen("detail", { target: notes[0].id, persist: false })); await settle(); frame(); await settle(); const l = frame(); return { l, y: ROWS - 2 }; };
    let { l, y } = await at();
    said.length = 0; click(l[y]!.indexOf("q menu") + 2, y); await settle();
    expect(top()).toBeInstanceOf(MainMenu);
    ({ l, y } = await at());
    click(l[y]!.indexOf("? keys") + 2, y); await settle();
    expect([...top().panes.values()].some((p: unknown) => p instanceof KeysPane)).toBe(true);
  }, 60_000);

  test("a reader tile's frame foot: W zoom, p pin and the reading keys", async () => {
    const make = () => openScreen("detail", { target: notes[0].id, persist: false });
    const foot = (l: string[]) => { const y = l.findIndex(r => r.startsWith("╚") && r.includes("zoom")); return { y, from: 0, to: l[y]!.length - 4 }; };
    const labels = await clickEvery(make, foot);
    expect(labels).toEqual(expect.arrayContaining(["p pin", "W zoom"]));
  }, 60_000);

  test("the BBS reading screen: n next, p prev, q back and the reading keys", async () => {
    // Wide enough for the whole row, q back at its end.
    (app as any).term.info.cols = 240;
    const list = () => [notes[1], notes[0], notes[2]];
    const make = () => new MessageReader(list(), 1);
    // f folds the section the reading line is in: at the top there is none, for the key too.
    const labels = await clickEvery(make, l => ({ y: l.findLastIndex(r => r.includes("n next")) }), /^f fold/);
    expect(labels).toEqual(expect.arrayContaining(["n next", "p prev", "q back"]));
    await leave(); const r = new MessageReader(list(), 1); app.push(r); await settle();
    const l = frame(), y = l.findLastIndex(row => row.includes("n next"));
    click(l[y]!.indexOf("n next") + 2, y); await until(() => (r as any).index === 2, "the next message");
    click(frame()[y]!.indexOf("p prev") + 2, y); await until(() => (r as any).index === 1, "the previous message");
    click(frame()[y]!.indexOf("q back") + 2, y); await until(() => top() instanceof MainMenu, "back to the menu");
    (app as any).term.info.cols = COLS;
  }, 60_000);

  test("inside a mounted board, a click on q menu does what q does there: the mount's, never the outer screen's", async () => {
    // The desk with the board mounted in a tile beside, its keys in the mount; then q by key, or by a click on the row.
    const mounted = async () => {
      await leave();
      const desk = new Desk(undefined, { layout: "daily" });
      app.push(desk); await settle(); frame();
      const r = await desk.dispatch.act({ action: "tile.open", args: { kind: "screen", screen: "board", name: "kanban" } }, { kind: "user" } as any) as any;
      await desk.dispatch.press("tile.focus", {}, r.tile ?? "kanban");
      await desk.dispatch.press("mount.enter", {}, r.tile ?? "kanban"); await settle(); frame(); await settle();
      return desk;
    };
    // The layout by tile names (each open makes new ids), and who has the keys.
    const after = (desk: Desk) => ({ top: top() === desk, layout: JSON.stringify((desk as any).layoutGet().tree).replace(/"(tile|id)":"[^"]*",/g, ""), focus: (desk as any).layoutGet().focus === (desk as any).layoutGet().tiles.find((t: any) => t.name === "kanban")?.tile, keys: JSON.stringify({ ...desk.keys?.(), address: undefined }) });
    let desk = await mounted();
    key({ kind: "char", ch: "q" }); await settle(); frame();
    const byKey = after(desk);
    desk = await mounted();
    const l = frame(), y = ROWS - 2;
    expect(l[y]).toContain("q menu");
    said.length = 0;
    click(l[y]!.indexOf("q menu") + 2, y); await settle(); frame();
    expect({ ...after(desk), said: said.filter(w => /nothing here|takes no|refused/.test(w)) }).toEqual({ ...byKey, said: [] });
    expect(byKey.top).toBe(true);
    await desk.dispatch.press("tile.close", {}, "kanban").catch(() => {});
  }, 60_000);
});
