// PIE-1592: who has the keys, read from the one fact, in a door with the desk and the drawer. A scratch outline, made-up notes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { SocketBoard } from "../src/socket";
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
    return { app, desk, quit: () => { app.quit(); app.drawer.tile?.kill(); } };
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
});
