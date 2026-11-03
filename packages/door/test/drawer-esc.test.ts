// PIE-1554: Esc reaches the program in a drawer terminal tile. Bytes go through the door's real key decoder, as a terminal
// sends them, to the drawer's agent (`cat -v`: an Esc it gets shows as ^[).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import { KeyDecoder } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!outliner)("Esc reaches the program in a drawer tile (PIE-1554)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-drawer-esc-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat -v";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  /** `kitty`: the terminal answered the Kitty keyboard query (flags 15, key events), as Ghostty does, before the drawer opens. */
  async function door(cols = 140, rows = 40, kitty = false) {
    const info = { cols, rows, cellW: 9, cellH: 16, kitty };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    app.push(new Desk(undefined, { layout: "desk" }));
    const A = app as any;
    const paint = () => A.paint();
    paint();
    const agent = () => app.drawer.tile as PtyPane | undefined;
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const shown = () => (agent()?.text() ?? []).join("\n");
    if (kitty) await feed("\x1b[?15u");
    await app.dispatch.press("host.toggle", { open: true });
    await until(() => agent()?.running === true, "the drawer's agent runs");
    expect(app.drawer.entered).toBe(true);
    await sleep(700);
    return { app, A, paint, feed, shown, agent, quit: () => { app.quit(); agent()?.kill(); const d = app.drawer.desk as any; for (const id of d?.all?.() ?? []) d.pane(d.nameOf(id))?.kill?.(); } };
  }

  test("typing in the drawer's agent, Esc is the program's and the keys stay in the drawer", async () => {
    const d = await door();
    try {
      await d.feed("ab");
      await until(() => d.shown().includes("ab"), "typed into the agent");
      await d.feed("\x1b");
      await until(() => d.shown().includes("ab^["), "Esc reaches the agent").catch(() => {});
      expect(d.shown()).toContain("ab^[");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.quit(); }
  });

  const click = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

  for (const kitty of [false, true]) test(`a second terminal tile in the drawer, gone into by a click: Esc is its program's${kitty ? " (Kitty keys)" : ""}`, async () => {
    const d = await door(140, 40, kitty);
    try {
      const desk = d.app.drawer.desk!;
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "vi" } }, { kind: "user" });
      const vi = () => desk.pane("vi") as PtyPane;
      await until(() => vi()?.running === true, "vi runs");
      d.paint();
      const hit = (desk as any).hits.find(([id]: [number]) => (desk as any).nameOf(id) === "vi");
      expect(hit).toBeTruthy();
      const [, r] = hit;
      await d.feed(click(r.col + 2, r.row + 2));
      await sleep(700);
      await d.feed("xy");
      await until(() => (vi().text() ?? []).join("\n").includes("xy"), "typed into vi");
      await d.feed(kitty ? "\x1b[27u" : "\x1b");
      await sleep(200);
      const text = (vi().text() ?? []).join("\n");
      expect(text).toContain("xy^[");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.quit(); }
  });

  test("under the Kitty protocol with key events (flags 15, as Ghostty sends): Esc and ctrl+o reach the agent as legacy bytes", async () => {
    const d = await door(140, 40, true);
    try {
      const rep = (code: number, mods = 1) => `\x1b[${code}${mods > 1 ? `;${mods}` : ""}u\x1b[${code};${mods}:3u`;
      await d.feed(rep(97) + rep(98));
      await until(() => d.shown().includes("ab"), "typed into the agent");
      await d.feed(rep(27));
      await d.feed("\x1b[57442;5u" + rep(111, 5) + "\x1b[57442;5:3u");
      await sleep(200);
      expect(d.shown()).toContain("ab^[^O");
    } finally { d.quit(); }
  });

  for (const kitty of [false, true]) test(`a terminal inside a group in the drawer, gone into: Esc is its program's${kitty ? " (Kitty keys)" : ""}`, async () => {
    const d = await door(140, 40, kitty);
    try {
      const desk = d.app.drawer.desk!;
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "vi" } }, { kind: "user" });
      await until(() => (desk.pane("vi") as PtyPane)?.running === true, "vi runs");
      const other = (desk as any).nameOf((desk as any).all().find((id: number) => (desk as any).nameOf(id) !== "vi"));
      const g = await desk.dispatch.press("tile.group", { with: other, where: "left" }, "vi") as { tile: string };
      const group = desk.pane(g.tile) as any;
      const vi = () => group.inner.pane("vi") as PtyPane;
      d.paint();
      const gd = group.inner;
      await desk.dispatch.press("tile.focus", {}, g.tile);
      await gd.dispatch.press("tile.focus", {}, "vi");
      await gd.dispatch.press("tile.enter", {}, "vi");
      await sleep(700);
      await d.feed("xy");
      await until(() => (vi().text() ?? []).join("\n").includes("xy"), "typed into vi").catch(() => {});
      await d.feed(kitty ? "\x1b[27u" : "\x1b");
      await sleep(200);
      const text = (vi().text() ?? []).join("\n");
      expect(text).toContain("xy^[");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.quit(); }
  });

  for (const how of ["up", "down", "folded"] as const) test(`the agent lifted with the drawer ${how}: Esc is its program's`, async () => {
    const d = await door(140, 40);
    try {
      if (how === "down") { await d.app.dispatch.press("host.toggle", { open: false }); }
      await d.app.dispatch.press("agent.lift", { on: true });
      await sleep(700);
      d.paint();
      await d.feed("xy");
      await until(() => d.shown().includes("xy"), "typed into the agent").catch(() => {});
      await d.feed("\x1b");
      await sleep(200);
      expect(d.shown()).toContain("xy^[");
    } finally { d.quit(); }
  });

  test("a Kitty report cut in two by the reads (a slow link) still reaches the agent as one key", async () => {
    const d = await door(140, 40, true);
    try {
      await d.feed("ab");
      await until(() => d.shown().includes("ab"), "typed into the agent");
      for (const [head, tail] of [["\x1b[", "27u"], ["\x1b[99", ";5u"], ["\x1b[111;", "5u"]]) { (d.A.term.decoder as KeyDecoder).feed(head!); await sleep(50); await d.feed(tail!); }
      await sleep(200);
      expect(d.shown()).toContain("ab^[^C");
    } finally { d.quit(); }
  });

  test("an ESC alone at the end of a read from a reporting terminal waits for the rest of its report; ctrl+[ is Esc too", async () => {
    const d = await door(140, 40, true);
    try {
      await d.feed("ab");
      await until(() => d.shown().includes("ab"), "typed into the agent");
      (d.A.term.decoder as KeyDecoder).feed("\x1b"); await sleep(80); await d.feed("[27u");
      await d.feed("\x1b[91;5u");                                  // ctrl+[ as a report
      await sleep(200);
      expect(d.shown()).toContain("ab^[^[");
      expect(d.shown()).not.toContain("[27u");
    } finally { d.quit(); }
  });

  test("the drawer's foot, typing in its program, names ctrl+] to step out and leaves Esc to the program", async () => {
    const d = await door();
    try {
      const foot = () => { d.paint(); return (d.app.drawer.render(140, 40, "desk").lines as string[]).map(l => l.replace(/\x1b\[[\d;:]*m|\x1b\]8;[^\x07]*\x07/g, "")).find(l => l.includes("drawer ·")) ?? ""; };
      expect(foot()).toContain("^] steps out");
      expect(foot()).not.toContain("esc steps out");
      await d.feed("\x1d");                                          // ctrl+]: out of the program, the drawer tile keeps the keys
      await until(() => !d.app.drawer.desk!.programKeys().typing, "stepped out of the program");
      expect(foot()).toContain("esc steps out");
    } finally { d.quit(); }
  });
});

// The same cut report to a terminal tile on the screen (a grid tile), outside the drawer.
describe.skipIf(!outliner)("a cut Kitty report reaches a grid terminal tile whole (PIE-1554)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => { saved.EP0CH_STATE = process.env.EP0CH_STATE; state = mkdtempSync(join(tmpdir(), "ep0ch-grid-esc-")); process.env.EP0CH_STATE = state; });
  afterEach(() => { if (saved.EP0CH_STATE === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved.EP0CH_STATE; rmSync(state, { recursive: true, force: true }); });

  test("Esc and ctrl+o cut in two reach cat -v in a desk tile as ^[ and ^O", async () => {
    const info = { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: true };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const A = app as any, paint = () => A.paint();
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const kettle = () => desk.pane("kettle") as PtyPane;
    try {
      await feed("\x1b[?15u");
      await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "kettle" }, tile: "reader" }, { kind: "user" });
      await until(() => kettle()?.running === true, "kettle runs");
      await desk.dispatch.press("tile.enter", {}, "kettle");
      expect(desk.rawKeys()).toBe(true);
      await sleep(700);
      await feed("ab");
      for (const [head, tail] of [["\x1b[2", "7u"], ["\x1b", "[111;5u"]]) { decoder.feed(head!); await sleep(80); await feed(tail!); }
      await sleep(200);
      expect((kettle().text() ?? []).join("\n")).toContain("ab^[^O");
    } finally { app.quit(); kettle()?.kill(); app.drawer.tile?.kill(); }
  });
});
