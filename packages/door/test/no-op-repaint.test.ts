// PIE-1301: an action that changed nothing doesn't repaint. The dispatcher's tail used to call ctx.redraw() after every
// action the person ran, on top of the action's own redraw: a hover that moved nothing painted a whole frame, and an
// action that redrew itself painted twice (the second 16 ms behind the first, over ssh). Now an action says whether it
// changed what's shown (`repaints`; touching `nothing` means no, anything else yes), and the tail adds a paint only when
// the action's own redraw didn't already ask for one. Frames are counted where they're drawn. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { MainMenu, SHELL_ACTIONS } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { ActionRefused, def, type ActionDef } from "../src/surface/actions";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("what repaints after the person's action (PIE-1301)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let frames = 0;
  const A = () => app as any;
  /** The frame floor is 16 ms; a press waits past it so two presses are never one paint. */
  const settle = () => Bun.sleep(40);
  /** `n` presses of an action, each answered and let go; the frames they painted. */
  async function painted(action: string, n = 1): Promise<number> {
    await settle();
    const before = frames;
    for (let i = 0; i < n; i++) { await app.dispatch.press(action); await settle(); }
    return frames - before;
  }

  const toys: Record<string, ActionDef<any, any>> = {
    // A read: touches nothing of the person's and shows nothing new (a hover over bare cells).
    "probe.noop": def({ summary: "changes nothing", touches: "nothing", replay: "safe", args: {}, run: () => "same" }),
    // The same, but it redraws itself, as a hundred actions do: its own redraw is the one frame.
    "probe.self": def({ summary: "changes what is shown and redraws itself", touches: "nothing", replay: "safe", args: {}, run: (_: unknown, { ctx }: { ctx: { redraw(): void } }) => { ctx.redraw(); } }),
    // Touches nothing of the person's, but changes what's shown (an agent's tint, a form field): says so.
    "probe.shows": def({ summary: "touches nothing of the person's and changes what's shown", touches: "nothing", replay: "safe", repaints: true, args: {}, run: () => "changed" }),
    "probe.says": def({ summary: "changes what is shown only when its answer says so", touches: "nothing", replay: "safe", repaints: out => out === "changed", args: {}, run: () => "same" }),
    // Touches the screen and never redraws: the dispatcher's repaint is the only one.
    "probe.screen": def({ summary: "changes the screen and leaves the repaint to the dispatcher", touches: "screen", replay: "safe", args: {}, run: () => "moved" }),
    // Touches the screen and redraws itself: still one frame.
    "probe.screen.self": def({ summary: "changes the screen and redraws itself", touches: "screen", replay: "safe", args: {}, run: (_: unknown, { ctx }: { ctx: { redraw(): void } }) => { ctx.redraw(); return "moved"; } }),
    // Answers later: what it changed lands after the promise, which the tail waits for.
    "probe.later": def({ summary: "changes the screen when its answer comes", touches: "screen", replay: "safe", args: {}, run: async (_, { ctx }) => { ctx.redraw(); await Bun.sleep(5); return "moved"; } }),
    "probe.refused": def({ summary: "is refused", touches: "screen", replay: "safe", args: {}, run: () => { throw new ActionRefused("not now"); } }),
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const draw = A().drawFrame.bind(app);
    A().drawFrame = () => { frames++; return draw(); };
    for (const [name, d] of Object.entries(toys)) (SHELL_ACTIONS as any).define(name, d);
    await settle();
  }, 30_000);
  afterAll(async () => {
    for (const name of Object.keys(toys)) (SHELL_ACTIONS as any).forget(name);
    try { app.quit(); } catch { /* gone */ }
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k];
  });

  test("a hundred presses of an action that changed nothing paint no frame", async () => {
    expect(await painted("probe.noop", 100)).toBe(0);
  }, 30_000);

  test("an action that changes the screen paints once, whether it redraws itself or leaves it to the dispatcher", async () => {
    expect(await painted("probe.screen")).toBe(1);
    expect(await painted("probe.screen.self")).toBe(1);
    expect(await painted("probe.self")).toBe(1);
  });

  test("an action that touches nothing of the person's but changes what's shown says so; or its answer does", async () => {
    expect(await painted("probe.shows")).toBe(1);
    expect(await painted("probe.says")).toBe(0);
  });

  test("an action that answers later paints when it does, and a refusal is said and shown once", async () => {
    expect(await painted("probe.later")).toBe(2);
    expect(await painted("probe.refused")).toBe(1);
  });
});
