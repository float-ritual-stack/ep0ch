// PIE-1428 (from PIE-1294): an agent held back by the tile the person types in is told so in one wording, whichever
// guard refuses it (the layout's, the actor rule's, the drawer's): "the person is typing in <tile>; an agent doesn't
// <what> · <what to do>", never the drawer's container id. A door on the desk with a terminal tile (`kettle`) and the
// drawer's agent (`cat`); an agent's actions on each while the person types there.
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

const USER = { kind: "user" } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A left click at a cell, as a terminal reports it (SGR, one-based). */
const click = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;

describe.skipIf(!outliner)("one wording for the typing tile (PIE-1428)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request<any>("create", { parentId: null, text: "Kettle descaling: vinegar, then rinse twice", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_HERDR_BIN"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-esc-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(cols = 140, rows = 40) {
    const info = { cols, rows, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "kettle" }, tile: "reader" }, USER);
    const A = app as any;
    const paint = () => A.paint();
    paint();
    const kettle = () => desk.pane("kettle") as PtyPane;
    await until(() => kettle()?.running === true, "kettle runs");
    /** Bytes as the terminal sends them; a lone Esc the decoder reads after its 30ms wait, as it does for real. */
    const feed = async (bytes: string) => { decoder.feed(bytes); paint(); await sleep(60); paint(); };
    const echoed = async (pane: () => PtyPane | undefined) => { await sleep(150); return (pane()?.text() ?? []).join("\n").includes("^["); };
    const chip = (id: string) => { paint(); const h = A.statusBoxes.find((b: any) => b.item.id === id); if (!h) throw new Error(`no ${id} chip on the status bar`); return h.from as number; };
    const typeIn = async () => { await desk.dispatch.press("tile.enter", {}, "kettle"); expect(desk.rawKeys()).toBe(true); };
    return { app, desk, A, feed, kettle, echoed, chip, typeIn, rows, quit: () => { app.quit(); kettle()?.kill(); app.drawer.tile?.kill(); } };
  }

  const ONE = /^the person is typing in \S[^;]*; an agent doesn't [^·]+( · .+)?$/;
  test("every refusal about the tile the person types in reads the same, on the desk and in the drawer", async () => {
    const d = await door();
    const agent = { kind: "agent", id: "probe-7" } as const;
    const refusal = async (req: any) => { try { await d.app.dispatch.act(req, agent as any); return "ran"; } catch (e: any) { return String(e.message); } };
    try {
      d.A.lastInput = Date.now();
      await d.typeIn();
      const said: string[] = [];
      for (const [a, args] of [["tile.close", {}], ["tile.type", { text: "x" }], ["tile.float", {}], ["tile.drawer", { on: true }], ["tile.focus", {}], ["tile.collapse", { on: true }], ["tile.restart", {}]] as const)
        said.push(await refusal({ action: a, args, tile: "kettle" }));
      await d.desk.dispatch.press("tile.leave", {}, "kettle");
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true, "the drawer's agent runs");
      d.A.lastInput = Date.now();
      for (const [a, args, tile] of [["tile.close", {}, "drawer.agent"], ["tile.type", { text: "x" }, "drawer.agent"], ["agent.type", { text: "x" }, undefined], ["host.toggle", { open: false }, undefined], ["host.size", { share: 0.5 }, undefined], ["tile.drawer", { on: false }, "drawer.agent"]] as const)
        said.push(await refusal({ action: a, args, ...(tile ? { tile } : {}) }));
      for (const s of said) { expect(s).toMatch(ONE); expect(s).not.toContain("drawer.tiles"); expect(s).not.toContain("("); }
    } finally { d.quit(); }
  });
});
