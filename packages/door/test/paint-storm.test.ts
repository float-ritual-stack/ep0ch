// PIE-1606: a storm of outline changes over a heavy screen (a board of many lanes) held the door's loop in paints: each
// change asked for a frame, a frame was 16 ms from the end of the last, so at 40 ms a frame the loop painted 70% of the
// time and answers from the host waited behind it. One paint scheduler, `App.redraw`: a heavy frame with nobody pressing
// anything rests the loop three times as long after it; a key or an agent's action is as soon as it can be. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App, type Screen } from "../src/app";
import { softLinkIgnoreOf } from "../src/refs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const FRAME_COST_MS = 30;
/** A screen whose frames cost what a many-laned board's do. */
class Heavy {
  title = "heavy";
  frames = 0;
  drawnAt: number[] = [];
  render() {
    this.frames += 1;
    for (const until = performance.now() + FRAME_COST_MS; performance.now() < until;) { /* a frame's work */ }
    this.drawnAt.push(performance.now());
    return { lines: ["heavy"] };
  }
  key() {}
}

describe.skipIf(!outliner)("a heavy frame rests the door's loop (PIE-1606)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, heavy: Heavy;
  const A = () => app as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    heavy = new Heavy();
    app.push(heavy as unknown as Screen);
  }, 30_000);
  afterAll(async () => {
    app.retire();
    board.close();
    await scratch.dispose();
  });

  /** Nobody has pressed anything for a while, and the last frame was a heavy one: nothing is waiting on a frame. */
  async function nobodyPressing() {
    A().lastInput = 0; A().pace.actedAt = 0;
    app.flush();
    await Bun.sleep(150);
  }

  test("a change every 5 ms for a second leaves the loop mostly free", async () => {
    await nobodyPressing();
    const before = heavy.frames, started = performance.now();
    const storm = setInterval(() => app.redraw(), 5);
    await Bun.sleep(1000);
    clearInterval(storm);
    const wall = performance.now() - started, painted = heavy.frames - before;
    expect(painted).toBeGreaterThan(0);
    // A frame's work at most a third of the loop (a quarter, and room for a loaded machine).
    expect(painted * FRAME_COST_MS / wall).toBeLessThan(0.34);
  });

  test("the last change of a storm still gets its frame", async () => {
    await nobodyPressing();
    app.redraw();
    const asked = heavy.frames;
    app.redraw();
    await Bun.sleep(400);
    expect(heavy.frames).toBeGreaterThan(asked);
  });

  test("a redraw after the person's key doesn't wait out the rest", async () => {
    await nobodyPressing();
    app.redraw();                            // the rest's first frame
    app.redraw();                            // waits out the rest
    expect(A().pace.waiting).toBe(true);
    const before = heavy.frames, pressed = performance.now();
    A().lastInput = Date.now();
    app.redraw();
    await Bun.sleep(20);
    expect(heavy.frames).toBeGreaterThan(before);
    expect(heavy.drawnAt.at(-1)! - pressed).toBeLessThan(FRAME_COST_MS * 3);
  });

  test("nor does what an agent's action shows", async () => {
    await nobodyPressing();
    app.redraw();
    app.redraw();
    const before = heavy.frames;
    await app.act({ action: "no.such.action", args: {}, as: "tester" }).catch(() => {});
    app.redraw();
    await Bun.sleep(40);
    expect(heavy.frames).toBeGreaterThan(before);
  });

  test("a storm of changes asks nothing of what soft links are drawn with; the answer moving shows", async () => {
    const redraws: number[] = [], src = { board, redraw: () => { redraws.push(1); } };
    const asked: string[] = [], send = board.send.bind(board);
    (board as any).send = (action: string, ...rest: unknown[]) => { asked.push(action); return (send as any)(action, ...rest); };
    try {
      const scopes = () => asked.filter(a => a === "references.soft-scope").length;
      expect(softLinkIgnoreOf(src)).toEqual(expect.any(Array));
      await Bun.sleep(300);
      expect(scopes()).toBe(1);
      for (let i = 0; i < 10; i++) { await board.createBlock(null, `A storm's note ${i}`); softLinkIgnoreOf(src); }
      await Bun.sleep(500);
      softLinkIgnoreOf(src);
      expect(scopes()).toBe(1);
      await board.createBlock(null, "Rota isn't a link [soft-link-ignore::rota]");
      const until = Date.now() + 5000;
      while (!softLinkIgnoreOf(src).includes("rota") && Date.now() < until) await Bun.sleep(50);
      expect(softLinkIgnoreOf(src)).toContain("rota");
      expect(redraws.length).toBeGreaterThan(0);
    } finally { (board as any).send = send; }
  }, 30_000);
});
