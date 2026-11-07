// PIE-1614: Esc closes the innermost thing, one thing a press, by one stated order; the hint row says first what it will
// close. Bytes go through the door's real key decoder to a whole door (App, desk, drawer) on a scratch host.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { SocketBoard } from "../src/socket";
import { KeyDecoder } from "../src/term";
import { completerOf } from "../src/surface/completer";
import { visible } from "../src/style";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ESC = "\x1b";

describe.skipIf(!outliner)("Esc's one order (PIE-1614)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let note = "";
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    const vents = (await board.request("create", { parentId: null, text: "Vents\nOpen them at dawn.", author: "agent" }) as { id: string }).id;
    note = (await board.request("create", { parentId: null, text: `Greenhouse rota\nWater the seedlings at dawn, then ((${vents}|the vents)) open.\n\nSecond line about the tomato bed and its frames.`, author: "agent" }) as { id: string }).id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_EDIT_ARM"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-esc-ladder-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols = 120, rows = 40) {
    const info = { cols, rows, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info as any);
    const screen: string[] = [];
    const term: any = {
      info, decoder, write() {}, paint(lines: string[]) { screen.splice(0, screen.length, ...lines); }, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    const desk: any = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const A = app as any;
    const paint = () => A.paint();
    paint();
    await desk.dispatch.act({ action: "open", args: { id: note }, tile: "reader" }, USER);
    const reader = () => desk.all().map((id: unknown) => desk.panes.get(id)).find((p: unknown) => p instanceof ReaderPane) as ReaderPane;
    await until(() => reader()?.surface.msg?.id === note, "the note is read");
    await desk.dispatch.act({ action: "tile.focus", args: {}, tile: "reader" }, USER);
    paint();
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    return { app, desk, A, feed, reader, paint, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  test("an armed edit: Esc lets go of the arm and nothing else, the lit element stays", async () => {
    process.env.EP0CH_EDIT_ARM = "2000";
    const d = await door();
    try {
      await d.feed("]");
      const lit = (d.reader().surface as any).cur;
      expect(lit).toBeTruthy();
      await d.feed("e");
      expect(d.A.armed()).toBeTruthy();
      await d.feed(ESC);
      expect(d.A.armed()).toBeFalsy();
      expect((d.reader().surface as any).cur).toBe(lit);
    } finally { d.quit(); }
  });

  test("a ^W chord under a hint card: the first Esc takes the card, the chord is still waiting", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "hint.show", args: {}, tile: d.desk.nameOf(d.desk.focusId() as never) }, USER);
      expect((d.desk as any).hintCard).toBeTruthy();
      await d.feed("\x17");
      expect((d.desk as any).prefix).toBe("wm");
      await d.feed(ESC);
      expect((d.desk as any).hintCard).toBeFalsy();
      expect((d.desk as any).prefix).toBe("wm");
      await d.feed(ESC);
      expect((d.desk as any).prefix).toBe("");
    } finally { d.quit(); }
  });

  test("the drawer up, the keys on the screen: what's lit in the tile goes first, then the drawer", async () => {
    const d = await door();
    try {
      await d.feed("]");
      await d.app.dispatch.press("host.toggle", { open: true });
      if (d.app.drawer.entered) await d.app.dispatch.press("host.leave", { quiet: true });
      expect((d.reader().surface as any).cur).toBeTruthy();
      await d.feed(ESC);
      expect((d.reader().surface as any).cur).toBeFalsy();
      expect(d.app.drawer.shown).toBe(true);
      await d.feed(ESC);
      expect(d.app.drawer.shown).toBe(false);
    } finally { d.quit(); }
  });

  test("a popup in an edit with text in it: each Esc closes one thing, and the hint row said which first", async () => {
    process.env.EP0CH_EDIT_ARM = "off";
    const d = await door();
    try {
      const said = () => d.app.esc.next();
      const row = () => (d.desk.render(d.app).lines as string[]).map(visible).find(l => l.includes("esc:")) ?? "";
      await d.feed("e");
      await until(() => !!d.reader().surface.draft, "the edit opens");
      await d.feed("xy [[Ven");
      await until(() => !!completerOf(d.reader().surface.draft!)?.shown, "the popup");
      expect(said()).toBe("the popup");
      expect(row()).toContain("esc: the popup");
      await d.feed(ESC);
      expect(completerOf(d.reader().surface.draft!)?.shown).toBeFalsy();
      expect(d.reader().surface.draft).toBeTruthy();
      expect(said()).toBe("the edit, twice puts it aside");
      await d.feed(ESC);
      expect(d.reader().surface.draft).toBeTruthy();         // said, kept
      expect(said()).toBe("the edit, put aside");
      await d.feed(ESC);
      expect(d.reader().surface.draft).toBeFalsy();
      expect(said() ?? "").not.toContain("edit");
    } finally { d.quit(); }
  });

  test("the comment closed under its leave ask: nothing of it lingers, the next key goes to the reader (PIE-1617)", async () => {
    const d = await door();
    try {
      await d.feed("C");
      await until(() => !!d.reader().surface.session, "the comment opens");
      const S: any = d.reader().surface;
      await until(() => !!S.session.composer, "the composer");
      await d.feed("a word");
      const host = d.reader().host(d.desk);
      void S.askLeave("link.follow", { n: 1 }, USER, host)?.catch(() => {});
      expect(S.leaving).toBeTruthy();
      S.closeSession();                                       // closed as an agent's close does, not by a key of the person's
      expect(S.leaving).toBeNull();
      expect(S.modes.all().map((m: any) => m.name)).toEqual([]);
      if (d.A.bar) await d.feed(ESC);
      await d.feed("]");
      expect(S.cur).toBeTruthy();
    } finally { d.quit(); }
  });

  test("`a` on a selection, then the selection goes: the menu goes with it and answers no key (PIE-1617)", async () => {
    const d = await door();
    try {
      const S: any = d.reader().surface;
      await d.feed("v");
      await d.feed("lll");
      await d.feed("a");
      expect(S.passageMenu).toBe(true);
      S.selection = null;
      expect(S.passageMenu).toBe(false);
      await d.feed("]");
      expect(S.cur).toBeTruthy();
    } finally { d.quit(); }
  });

  test("a reader in the drawer with something lit: Esc lets it go before stepping out", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.drawer", args: { on: true }, tile: d.desk.nameOf(d.desk.all().find((id: unknown) => d.desk.panes.get(id) instanceof ReaderPane)!) }, USER);
      await d.app.dispatch.press("host.toggle", { open: true });
      const dd: any = d.app.drawer.made!;
      const rd = () => dd.all().map((id: unknown) => dd.panes.get(id)).find((p: unknown) => p instanceof ReaderPane) as ReaderPane;
      await until(() => !!rd()?.surface.msg, "the reader is in the drawer");
      if (!d.app.drawer.entered) await d.app.dispatch.press("host.enter", {});
      await dd.dispatch.act({ action: "tile.focus", args: {}, tile: dd.nameOf(dd.all().find((id: unknown) => dd.panes.get(id) === rd())!) }, USER);
      d.paint();
      await d.feed("]");
      expect((rd().surface as any).cur).toBeTruthy();
      await d.feed(ESC);
      expect((rd().surface as any).cur).toBeFalsy();
      expect(d.app.drawer.entered).toBe(true);
      await d.feed(ESC);
      expect(d.app.drawer.entered).toBe(false);
      expect(d.app.drawer.shown).toBe(true);
    } finally { d.quit(); }
  });
});
