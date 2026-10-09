// A terminal tile's text is selectable by the mouse, in the drawer as on the desk (PIE-716): a drag where the program
// hasn't asked for the mouse, shift+drag (or alt+drag) where it has, copies on release through the door's own copy
// (OSC 52, "copied from <tile>"), and a program that has the mouse still gets its own plain drags. Fictional text;
// the programs are `cat` and a small bash script.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { cttyPrefix } from "../src/desk/pty";
import type { Key } from "../src/term";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const mouse = (action: "down" | "up" | "drag", x: number, y: number, mods?: number): Key => ({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) });
const SHIFT = 4, ALT = 8;
const b64 = (t: string) => Buffer.from(t).toString("base64");

let dir = "";
const saved: Record<string, string | undefined> = {};
const ENV = ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_COPY_ON_SELECT"];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ep0ch-ptysel-"));
  for (const k of ENV) saved[k] = process.env[k];
  process.env.EP0CH_STATE = join(dir, "state");
  delete process.env.EP0CH_DAILY_CWD; delete process.env.EP0CH_COPY_ON_SELECT;
});
afterEach(() => { for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; rmSync(dir, { recursive: true, force: true }); });

/** A program that asks for the mouse (1002, SGR), prints a line, and says what it was sent as `got:<report>`. */
function mouseProgram(): string {
  const f = join(dir, "grabby");
  writeFileSync(f, `#!/bin/bash
printf '\\e[?1002h\\e[?1006h'; echo "Sow the beans in May"
stty raw -echo
while IFS= read -rn1 c; do printf '%s' "$c"; case "$c" in M|m) printf ' got-report\\r\\n';; esac; done
`);
  chmodSync(f, 0o755);
  return f;
}

function door(agent: string) {
  process.env.EP0CH_DAILY_AGENT = agent;
  let key: (k: Key) => void = () => {};
  const writes: string[] = []; let painted: string[] = [];
  const term: any = { info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false }, write(s: string) { writes.push(s); }, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
  const app = new App(term, { protocol: null } as any, Date.now(), () => {});
  const screen = { title: "menu", key() {}, render: (c: any) => ({ lines: Array.from({ length: c.t.rows - 1 }, () => "menu") }) };
  app.push(screen as any);
  const paint = () => { (app as any).paint(); return painted; };
  const clips = () => writes.filter(w => w.includes("\x1b]52;c;")).map(w => Buffer.from(w.match(/\x1b\]52;c;([^\x07]*)\x07/)![1]!, "base64").toString());
  return { app, key: (k: Key) => key(k), writes, clips, paint, A: app as any };
}

/** Where a line shows in a tile: its row in the tile. */
const rowOf = (p: PtyPane, text: string) => p.text().findIndex(l => l.includes(text));

describe.skipIf(!cttyPrefix())("selecting text in a terminal tile", () => {
  test("in the drawer, a drag over a program that hasn't the mouse selects and copies it, said as that program's", async () => {
    const d = door("cat");
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.running === true, "the drawer's program");
      const tile = d.app.drawer.tile!;
      d.A.term.rawSink()("Water the leeks daily\r");
      await until(() => rowOf(tile, "Water the leeks daily") >= 0, "the line");
      d.paint();
      const r = d.app.drawer.rect!, y = r.row + 2 + rowOf(tile, "Water the leeks daily");
      // The tile's frame is one cell in: its text starts at column 1 of the drawer's desk.
      d.key(mouse("down", 1 + 6, y)); d.key(mouse("drag", 1 + 10, y)); d.key(mouse("up", 1 + 10, y));
      expect(d.clips()).toEqual(["the l"]);
      expect(d.A.toast.text).toContain("copied from cat");
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); }
  }, 20_000);

  test("a program that has the mouse still gets plain drags; shift+drag and alt+drag select and copy instead, and it hears nothing", async () => {
    const d = door(mouseProgram());
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.wantsMouse() === true, "the program to ask for the mouse");
      const tile = d.app.drawer.tile!;
      await until(() => rowOf(tile, "Sow the beans") >= 0, "its line");
      d.paint();
      const r = d.app.drawer.rect!, y = r.row + 2 + rowOf(tile, "Sow the beans in May");
      d.key(mouse("down", 3, y)); d.key(mouse("drag", 9, y)); d.key(mouse("up", 9, y));
      await until(() => tile.text().filter(l => l.includes("got-report")).length >= 2, "its own reports");
      expect(d.clips()).toEqual([]);
      const heard = tile.text().filter(l => l.includes("got-report")).length;
      d.key(mouse("down", 1, y, SHIFT)); d.key(mouse("drag", 7, y, SHIFT)); d.key(mouse("up", 7, y, SHIFT));
      expect(d.clips()).toEqual(["Sow the"]);
      d.key(mouse("down", 5, y, ALT)); d.key(mouse("drag", 10, y, ALT)); d.key(mouse("up", 10, y, ALT));
      expect(d.clips()).toEqual(["Sow the", "the be"]);
      await Bun.sleep(300);
      expect(tile.text().filter(l => l.includes("got-report")).length).toBe(heard);
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); }
  }, 20_000);
});

describe.skipIf(!cttyPrefix() || !outliner)("selecting text in a terminal tile on the desk", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("the same tile on the desk selects and copies as in the drawer; terminal.copy copies again for the person, never an agent", async () => {
    process.env.EP0CH_DAILY_AGENT = "cat";
    let key: (k: Key) => void = () => {}, painted: string[] = [];
    const writes: string[] = [];
    const term: any = { info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false }, write(s: string) { writes.push(s); }, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    try {
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
      (app as any).paint();
      const tile = desk.pane("kettle") as PtyPane;
      await until(() => tile.running, "kettle");
      tile.inputRaw("Prune the roses in March\r");
      await until(() => rowOf(tile, "Prune the roses") >= 0, "the line");
      (app as any).paint();
      const at = painted.findIndex(l => l.replace(/\x1b\[[^m]*m/g, "").includes("Prune the roses"));
      const col = painted[at]!.replace(/\x1b\[[^m]*m/g, "").indexOf("Prune");
      key(mouse("down", col + 6, at)); key(mouse("drag", col + 10, at)); key(mouse("up", col + 10, at));
      const clips = () => writes.filter(w => w.includes("\x1b]52;c;")).map(w => Buffer.from(w.match(/\x1b\]52;c;([^\x07]*)\x07/)![1]!, "base64").toString());
      expect(clips()).toEqual(["the r"]);
      const again: any = await desk.dispatch.act({ action: "terminal.copy", args: {}, tile: "kettle" }, USER);
      expect(again.text).toBe("the r");
      expect(clips()).toEqual(["the r", "the r"]);
      await expect(desk.dispatch.act({ action: "terminal.copy", args: {}, tile: "kettle" }, { kind: "agent", id: "a1" } as any)).rejects.toThrow(/person/);
    } finally { app.quit(); }
  }, 20_000);
});
