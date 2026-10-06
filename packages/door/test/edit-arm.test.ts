// e arms the edit instead of opening it (edit.arm, src/arm.ts): the status bar asks and the reader's frame turns the
// edit's colour; ⏎ or e again opens it, any other key lets it go and does what it does (no key swallowed), the window
// running out lets it go quietly. A click on the tile menu's edit row and an agent's `edit` open at once, and
// EP0CH_EDIT_ARM=off turns arming off. The focused tile's frame is double-lined. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu, MessageReader } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { traceActions, type ActionRun } from "../src/surface/actions";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ENTER: Key = { kind: "enter" };

describe.skipIf(!outliner)("e arms the edit; ⏎ or e again opens it (edit.arm)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const notes: Record<string, any> = {};
  const A = () => app as any;
  const message = () => A().message as string;
  const AS = "arm-agent";

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    // Long enough to scroll, so j after e shows it moved.
    notes.hedge = await mk(null, `Trim the hedge [type::job] [area::yard] [stage::todo]\n${Array.from({ length: 80 }, (_, i) => `Row ${i + 1} of the hedge, clipped low.`).join("\n")}`);
    notes.yard = await mk(null, "Yard jobs");
    await mk(notes.yard.id, "To do [type::virtual-branch] [query::type=job area=yard stage=todo]");
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => {
    for (const s of [...A().stack]) (s as any).dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE; delete process.env.EP0CH_EDIT_ARM;
  });
  // A long window by default, so a slow machine never lets an arm go between two keys; the expiry test sets a short one.
  const window = (v: string) => { process.env.EP0CH_EDIT_ARM = v; };

  /** A desk on the note, the reader focused; its reader and a render of its rows. */
  async function deskOnHedge() {
    while (A().stack.length > 1) { (A().stack.at(-1) as any).dispose?.(); A().stack.pop(); }
    const desk = new Desk() as any;
    app.push(desk);
    desk.render(desk.ctx);
    await until(() => desk.panes.size > 0, "the desk's tiles", 10_000);
    await app.act({ action: "open", args: { id: notes.hedge.id }, as: AS });
    const rd = [...desk.panes.values()].find((p: any) => p.kind === "reader" && p.msg?.id === notes.hedge.id) as any;
    await until(() => !!rd?.surface.msg, "a reader on the note");
    desk.focus = [...desk.panes].find(([, p]: any) => p === rd)![0];
    const rows = () => desk.render(desk.ctx).lines.map(visible) as string[];
    return { desk, rd, rows };
  }
  const traced = (f: () => void) => { const runs: ActionRun[] = []; const stop = traceActions(r => runs.push(r)); try { f(); } finally { stop(); } return runs; };

  test("on the desk: e arms (asked, the frame in the edit's colour, nothing opened); ⏎ opens the edit and the person is in it", async () => {
    window("60000");
    const { desk, rd, rows } = await deskOnHedge();
    const runs = traced(() => key(char("e")));
    expect(runs.map(r => r.name)).toEqual(["edit.arm"]);
    expect(app.armed()?.of).toBe(rd.surface);
    expect(message()).toBe("edit Trim the hedge? ⏎ · any other key cancels");
    expect(rows().join("\n")).toContain("✎ edit? ");
    expect(rows().join("\n")).toContain("⏎ opens it · any other key cancels");
    expect(app.person().busy).toBe(true);
    await Bun.sleep(50);
    expect(rd.surface.draft).toBeNull();
    // ⏎ opens it: the note's edit action, as the person.
    const opened = traced(() => key(ENTER));
    expect(opened.map(r => r.name)).toContain("edit");
    await until(() => !!rd.surface.draft && desk.entered.in(rd), "the edit opened and the person is in it");
    expect(app.armed()).toBeNull();
    expect(message()).not.toContain("any other key cancels");
    rd.surface.closeDraftAction(true);
    desk.entered.clear();
  }, 30_000);

  test("e then e opens it too; e then j lets it go and scrolls (the key isn't swallowed)", async () => {
    window("60000");
    const { desk, rd, rows } = await deskOnHedge();
    key(char("e")); key(char("e"));
    await until(() => !!rd.surface.draft, "e e opened the edit");
    rd.surface.closeDraftAction(true);
    desk.entered.clear();
    const before = rows().join("\n");
    key(char("e"));
    expect(app.armed()).not.toBeNull();
    const runs = traced(() => key(char("j")));
    expect(app.armed()).toBeNull();
    expect(runs.map(r => r.name)).toContain("scroll");
    expect(runs.map(r => r.name)).not.toContain("edit");
    await Bun.sleep(100);
    expect(rd.surface.draft).toBeNull();
    expect(rows().join("\n")).not.toContain("✎ edit? ");
    expect(rows().join("\n")).not.toBe(before);
  }, 30_000);

  test("the window running out lets it go quietly: no question, no colour, nothing opened", async () => {
    window("150");
    const { rd, rows } = await deskOnHedge();
    key(char("e"));
    expect(app.armed()).not.toBeNull();
    await until(() => app.armed() === null, "the arm ran out", 3000);
    expect(message()).toBe("");
    expect(rows().join("\n")).not.toContain("✎ edit? ");
    expect(rd.surface.draft).toBeNull();
    window("60000");
  }, 30_000);

  test("the mouse and agents open at once: the tile menu's edit row, an agent's edit; an agent's edit.arm is refused", async () => {
    window("60000");
    const { desk, rd } = await deskOnHedge();
    const r = (desk.layoutGet() as any).tiles.find((t: any) => t.name === desk.nameOf(desk.focus)).rect;
    const press = (x: number, y: number, button = 0) => { key({ kind: "mouse", action: "down", button, x, y }); key({ kind: "mouse", action: "up", button, x, y }); };
    press(r.col + 5, r.row + 6, 2);
    await until(() => desk.overlays.top()?.name === "tile menu", "a right-click opens the tile menu");
    const lines = desk.render(desk.ctx).lines.map(visible) as string[];
    const at = lines.findIndex((l: string, i: number) => i > r.row + 6 && /│ ?edit\b/.test(l));
    expect(at).toBeGreaterThan(0);
    press(lines[at]!.indexOf("edit"), at);
    await until(() => !!rd.surface.draft, "the menu's edit row opened the edit at once");
    expect(app.armed()).toBeNull();
    rd.surface.closeDraftAction(true);
    desk.entered.clear();
    // An agent's edit opens at once (and takes no keys); its edit.arm is refused, saying what it does instead.
    await app.act({ action: "edit", args: {}, tile: desk.nameOf(desk.focus), as: AS });
    expect(rd.surface.draft).not.toBeNull();
    expect(app.armed()).toBeNull();
    await app.act({ action: "edit.close", args: { discard: true }, tile: desk.nameOf(desk.focus), as: AS });
    await expect(app.act({ action: "edit.arm", args: {}, tile: desk.nameOf(desk.focus), as: AS })).rejects.toThrow(/an agent opens one with edit/);
  }, 30_000);

  test("EP0CH_EDIT_ARM=off: e opens the edit at once", async () => {
    window("off");
    const { desk, rd } = await deskOnHedge();
    key(char("e"));
    expect(app.armed()).toBeNull();
    await until(() => !!rd.surface.draft, "e opened the edit at once");
    rd.surface.closeDraftAction(true);
    desk.entered.clear();
    window("60000");
  }, 30_000);

  test("on the board: e on a lane arms the preview (the keys stay on the lane); ⏎ moves them there and opens the edit", async () => {
    window("60000");
    while (A().stack.length > 1) { (A().stack.at(-1) as any).dispose?.(); A().stack.pop(); }
    const b = boardScreen(notes.yard.id, false), V = BV.view(b);
    app.push(b);
    try {
      await until(() => V.lanes.length === 1 && V.lanes.every((l: any) => l.items), "the lane", 10_000);
      BV.at(b, "lanes");
      await until(() => V.preview.msg?.id === notes.hedge.id, "the preview shows the card");
      key(char("e"));
      expect(app.armed()?.of).toBe(V.preview.surface);
      expect(BV.where(b)).toBe("lanes");
      expect(b.render(b.ctx).lines.map(visible).join("\n")).toContain("✎ edit? ");
      key(ENTER);
      await until(() => !!V.preview.surface.draft, "⏎ opened the edit in the preview");
      expect(BV.where(b)).toBe("preview");
      V.preview.surface.closeDraftAction(true);
    } finally { b.dispose(); }
  }, 30_000);

  test("in the BBS message reader: e arms (the subject asks), ⏎ opens the edit rather than going to the next message", async () => {
    window("60000");
    while (A().stack.length > 1) { (A().stack.at(-1) as any).dispose?.(); A().stack.pop(); }
    const hedge = await board.get(notes.hedge.id);
    const reader = new MessageReader([hedge!, hedge!], 0);
    app.push(reader);
    await until(() => !!reader.surface.msg, "the reader shows the note");
    key(char("e"));
    expect(app.armed()?.of).toBe(reader.surface);
    expect(reader.render(app).lines.map(visible).join("\n")).toContain("Subj: ✎ edit? Trim the hedge");
    const runs = traced(() => key(ENTER));
    expect(runs.map(r => r.name)).not.toContain("message.next");
    await until(() => !!reader.surface.draft, "⏎ opened the edit");
    reader.surface.closeDraftAction(true);
  }, 30_000);

  test("the focused tile's frame is double-lined; the others' single", async () => {
    window("60000");
    const { desk } = await deskOnHedge();
    const tiles = (desk.layoutGet() as any).tiles as { name: string; rect: { col: number; row: number; cols: number } }[];
    const lines = desk.render(desk.ctx).lines.map(visible) as string[];
    const focused = desk.nameOf(desk.focus);
    for (const t of tiles) {
      const corner = lines[t.rect.row]![t.rect.col];
      expect(corner, t.name).toBe(t.name === focused ? "╔" : "┌");
    }
  }, 30_000);
});
