// PIE-1592: who has the keys, read from the one fact, in a door with the desk and the drawer. A scratch outline, made-up notes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const USER = { kind: "user" } as const;
const AGENT = { kind: "agent", id: "helper" } as const;

describe.skipIf(!outliner)("the keys fact in a door (PIE-1592)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-keysfact-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door() {
    const term: any = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    (app as any).paint();
    return { app, desk, key: (k: Key) => { (app as any).key(k); (app as any).paint(); }, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
  }

  test("under yolo an agent's goTo on a glass float enters the glass, as the person's does", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("reader")!;
      await d.desk.dispatch.act({ action: "tile.float", args: { to: "glass" }, tile: "reader" }, USER);
      (d.app as any).paint();
      d.app.agentsYolo = true;
      d.app.drawer.goTo(pane, AGENT);
      expect(d.app.drawer.glassHasKeys()).toBe(true);
    } finally { d.quit(); }
  });

  test("a shell in a group, the drawer up: ctrl+] steps out of the program, then the group, then into the drawer, one at a time, as the fact says", async () => {
    const d = await door();
    try {
      await d.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
      await d.app.dispatch.act({ action: "host.leave", args: {} }, USER).catch(() => {});
      await d.desk.dispatch.act({ action: "tile.group", args: {}, tile: "reader" }, USER);
      const group = d.desk.pane((d.desk.layoutGet() as any).focus) as any;
      group.goIn(true);
      const inner = group.inner as Desk;
      for (const k of [{ kind: "char", ch: "w", ctrl: true }, { kind: "char", ch: "o" }, { kind: "char", ch: "s" }] as Key[]) d.key(k);
      for (let i = 0; i < 500 && !(inner.pane("pty") as PtyPane | undefined)?.running; i++) await Bun.sleep(10);
      expect((inner.pane("pty") as PtyPane).running).toBe(true);
      d.key({ kind: "enter" } as Key);
      const ways = (): unknown[] => { const w = d.app.person(); return [w.layer, w.wayOut]; };
      expect(ways()).toEqual(["screen", "program"]);
      const chord: Key = { kind: "char", ch: "]", ctrl: true };
      d.key(chord);
      expect(inner.rawKeys()).toBe(false);
      expect(group.inside).toBe(true);
      expect(ways()).toEqual(["screen", "send"]);
      d.app.drawer.keysFact.chordSpent();
      expect(ways()).toEqual(["screen", "group"]);
      d.key(chord);
      expect(group.inside).toBe(false);
      expect(d.app.drawer.entered).toBe(false);
      expect(ways()).toEqual(["screen", "into-drawer"]);
      d.key(chord);
      expect(d.app.drawer.entered).toBe(true);
      expect(d.app.person().layer).toBe("drawer");
    } finally { d.quit(); }
  });

  test("the glass: its keys are the fact's, and ctrl+] puts them back where they were", async () => {
    const d = await door();
    try {
      const pane = d.desk.pane("reader")!;
      await d.desk.dispatch.act({ action: "tile.float", args: { to: "glass" }, tile: "reader" }, USER);
      (d.app as any).paint();
      d.app.drawer.goTo(pane, USER);
      expect(d.app.person().layer).toBe("glass");
      expect(d.app.person().wayOut).toBe("drawer");
      d.key({ kind: "char", ch: "]", ctrl: true });
      expect(d.app.drawer.glassHasKeys()).toBe(false);
      expect(d.app.person().layer).toBe("screen");
    } finally { d.quit(); }
  });
});
