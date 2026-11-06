// PIE-1606: a storm of outline changes over a heavy screen (a board of many lanes) held the door's loop in paints: each
// change asked for a frame, a frame was 16 ms from the end of the last, so at 40 ms a frame the loop painted 70% of the
// time and answers from the host waited behind it. One paint scheduler, `App.redraw`: a frame an outline change asked for
// rests the loop three times the last frame's length first; after a key or an agent's action it's as soon as it can be. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { App, type Screen } from "../src/app";
import { Desk } from "../src/desk/desk";
import { softLinkIgnoreOf } from "../src/refs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

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
    const storm = setInterval(() => app.redraw(true), 5);
    await Bun.sleep(1000);
    clearInterval(storm);
    const wall = performance.now() - started, painted = heavy.frames - before;
    expect(painted).toBeGreaterThan(0);
    // A frame's work at most a third of the loop (a quarter, and room for a loaded machine).
    expect(painted * FRAME_COST_MS / wall).toBeLessThan(0.34);
  });

  test("the last change of a storm still gets its frame", async () => {
    await nobodyPressing();
    app.redraw(true);
    const asked = heavy.frames;
    app.redraw(true);
    await Bun.sleep(400);
    expect(heavy.frames).toBeGreaterThan(asked);
  });

  test("a redraw after the person's key doesn't wait out the rest", async () => {
    await nobodyPressing();
    app.redraw(true);                            // the rest's first frame
    app.redraw(true);                            // waits out the rest
    expect(A().pace.waiting).toBe(true);
    const before = heavy.frames, pressed = performance.now();
    A().lastInput = Date.now();
    app.redraw(true);
    await Bun.sleep(20);
    expect(heavy.frames).toBeGreaterThan(before);
    expect(heavy.drawnAt.at(-1)! - pressed).toBeLessThan(FRAME_COST_MS * 3);
  });

  test("nor does what an agent's action shows", async () => {
    await nobodyPressing();
    app.redraw(true);
    app.redraw(true);
    const before = heavy.frames;
    await app.act({ action: "no.such.action", args: {}, as: "tester" }).catch(() => {});
    app.redraw(true);
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

// Evan watches agents stream in terminal tiles all day with nobody pressing: a program's output keeps a frame's pace, on a
// heavy screen and in a storm. Only frames an outline change asked for rest.
describe.skipIf(!outliner)("a terminal tile streaming on a heavy screen keeps its frames (PIE-1606)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  const A = () => app as any;
  const FRAME = 25;
  const framesPerSecond = async () => {
    const before = A().speed.frames, at = performance.now();
    await Bun.sleep(1500);
    return (A().speed.frames - before) / ((performance.now() - at) / 1000);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    app.flush();
    await until(() => (desk as any).panes.size > 0, "the desk's tiles");
    const stream = join(scratch.root, "stream.sh");
    writeFileSync(stream, "while :; do echo a line of output; sleep 0.02; done\n");
    await app.act({ action: "tile.open", args: { kind: "pty", cmd: `sh ${stream}` }, as: "tester" });
    app.flush();   // a terminal tile starts its program when it's first drawn
    await until(() => [...(desk as any).panes.values()].some((p: any) => p.kind === "pty" && p.running && p.text().some((l: string) => l.includes("a line of output"))), "the program's output");
    const render = desk.render.bind(desk);
    desk.render = ((...args: Parameters<Desk["render"]>) => {
      for (const until = performance.now() + FRAME; performance.now() < until;) { /* what a many-laned board's frame costs */ }
      return render(...args);
    }) as Desk["render"];
    await Bun.sleep(500);
    A().lastInput = 0; A().pace.actedAt = 0;
  }, 30_000);
  afterAll(async () => {
    try { (desk as any).dispose(); } catch { /* going anyway */ }
    app.retire();
    board.close();
    await scratch.dispose();
  });

  test("about 20 frames a second with nobody pressing", async () => {
    expect(await framesPerSecond()).toBeGreaterThan(18);
  }, 20_000);

  test("and in a storm of outline changes too", async () => {
    let n = 0;
    const storm = setInterval(() => app.event({ domain: "content", action: "edit", blockId: `storm-${n}`, change: { kind: "edit", blockId: `storm-${n++}`, sequence: 1e6 + n, recordedAt: new Date().toISOString(), actor: { author: "agent", actorId: "storm" } } } as any), 50);
    try { expect(await framesPerSecond()).toBeGreaterThan(18); } finally { clearInterval(storm); }
  }, 20_000);
});
