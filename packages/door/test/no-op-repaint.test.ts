// PIE-1301: an action that changed nothing doesn't repaint. The dispatcher's tail used to call ctx.redraw() after every
// action the person ran, on top of the action's own redraw: a hover that moved nothing painted a whole frame, and an
// action that redrew itself painted twice (the second 16 ms behind the first, over ssh). Now an action says whether it
// changed what's shown (`repaints`; touching `nothing` means no, anything else yes), and the tail adds a paint only when
// the action's own redraw didn't already ask for one. Frames are the door's own count (`speed.frames`, PIE-1300). Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { MainMenu, SHELL_ACTIONS } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { ActionRefused, ActionSet, def, type ActionDef } from "../src/surface/actions";
import { Dispatcher } from "../src/surface/dispatch";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("what repaints after the person's action (PIE-1301)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const A = () => app as any;
  /** The frames the door has painted (peek's `speed.frames`). */
  const frames = () => A().speed.frames as number;
  /** The frame floor is 16 ms; a press waits past it so two presses are never one paint. */
  const settle = () => Bun.sleep(40);
  /** `n` presses of an action, each answered and let go; the frames they painted. */
  async function painted(action: string, n = 1): Promise<number> {
    await settle();
    const before = frames();
    for (let i = 0; i < n; i++) { await app.dispatch.press(action); await settle(); }
    return frames() - before;
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
    // The reader's actions answer as promises that wait for nothing: its own redraw is the one frame there too.
    "probe.wrapped": def({ summary: "changes the screen, redraws itself and answers as a promise", touches: "screen", replay: "safe", args: {}, run: (_: unknown, { ctx }: { ctx: { redraw(): void } }) => { ctx.redraw(); return Promise.resolve("moved"); } }),
    // An action that presses another, as an authored press or a button does: the inner one's verdict is the press's.
    "probe.press.noop": def({ summary: "presses an action that changes nothing", touches: "nothing", replay: "safe", args: {}, run: (_: unknown, { ctx }: { ctx: { press?(n: string): Promise<unknown> } }) => ctx.press!("probe.noop") }),
    "probe.press.screen": def({ summary: "presses an action that changes the screen", touches: "nothing", replay: "safe", args: {}, run: (_: unknown, { ctx }: { ctx: { press?(n: string): Promise<unknown> } }) => ctx.press!("probe.screen") }),
    // Answers later: what it changed lands after the promise, which the tail waits for.
    "probe.later": def({ summary: "changes the screen when its answer comes", touches: "screen", replay: "safe", args: {}, run: async (_, { ctx }) => { ctx.redraw(); await Bun.sleep(5); return "moved"; } }),
    // An outer action that mutates after an inner press has painted: the inner press's frame doesn't cover the later change.
    "probe.press.then": def({ summary: "presses an action that changes the screen, then changes more", touches: "screen", replay: "safe", args: {}, run: async (_: unknown, { ctx }: { ctx: { press?(n: string): Promise<unknown> } }) => { await ctx.press!("probe.screen"); return "moved more"; } }),
    // Changes the screen a turn after it began, without redrawing.
    "probe.turn": def({ summary: "changes the screen after one turn and leaves the repaint to the dispatcher", touches: "screen", replay: "safe", args: {}, run: async () => { await Promise.resolve(); return "moved"; } }),
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
    expect(await painted("probe.wrapped")).toBe(1);
  });

  test("an action that touches nothing of the person's but changes what's shown says so; or its answer does", async () => {
    expect(await painted("probe.shows")).toBe(1);
    expect(await painted("probe.says")).toBe(0);
  });

  test("a press made from inside an action's run counts as that action's: no extra paint for a no-op, one for a change", async () => {
    expect(await painted("probe.press.noop")).toBe(0);
    expect(await painted("probe.press.screen")).toBe(1);
  });

  test("a frame an inner press painted doesn't stand for what its outer action changed after it", async () => {
    expect(await painted("probe.press.then")).toBe(2);
  });

  test("another press's own redraw is not this press's: each action that changed the screen is painted for", async () => {
    await settle();
    const before = frames();
    const slow = app.dispatch.press("probe.turn");   // changes the screen a turn later, leaving the repaint to the dispatcher
    const other = app.dispatch.press("probe.self");  // redraws at once, in the same turn
    await Promise.all([slow, other]); await settle();
    expect(frames() - before).toBe(2);
  });

  test("an action that answers later paints when it does, and a refusal is said and shown once", async () => {
    expect(await painted("probe.later")).toBe(2);
    expect(await painted("probe.refused")).toBe(1);
  });
});

describe("what a screen host's own pre-action change owes a repaint (PIE-1301)", () => {
  const set = new ActionSet<{ "probe.read": Record<string, never> }, object>("probe.hostchange", { "probe.read": def({ summary: "reads", touches: "nothing", replay: "safe", args: {}, run: () => "same" }) });
  const press = async (hookChanged: boolean) => {
    let painted = 0;
    const d = new Dispatcher({ title: "probe", ctx: () => ({ flash() {}, redraw: () => { painted++; } }), beforeAction: () => hookChanged }, [{ set, takes: "none", on: () => ({}) }]);
    await d.press("probe.read");
    return painted;
  };
  test("a hook that changed what's shown (the desk dropping a hint card) is painted for; one that didn't, isn't", async () => {
    expect(await press(true)).toBe(1);
    expect(await press(false)).toBe(0);
  });
});
