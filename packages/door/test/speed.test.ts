// How the door measures its own speed (src/speed.ts, PIE-1309): the settle is the time from the last input of a burst to
// the frame that shows it, over a ring of bursts, on a clock the test holds.
import { describe, expect, test } from "bun:test";
import { BURST_GAP_MS, SETTLE_MIN_BURSTS, SETTLE_RING, SpeedMeter, settleOf } from "../src/speed";

function meter() {
  const clock = { t: 5_000_000 };
  const m = new SpeedMeter(() => clock.t);
  /** An input, the redraw it asks for, and the frame `after` ms later. */
  const press = (after: number) => { m.input(); m.asked(); clock.t += after; m.frame(); };
  return { m, clock, press };
}

describe("the settle", () => {
  test("a burst is one measure, from its last input: the frames before it don't count", () => {
    const { m, clock } = meter();
    for (let i = 0; i < 20; i++) { m.input(); m.asked(); clock.t += 10; m.frame(); }     // frames at 10 ms, one for each report
    m.input(); m.asked();                                                              // the last report of the burst
    clock.t += 40;
    m.frame();
    clock.t += BURST_GAP_MS + 1;
    expect(m.settle()).toEqual({ p50: 40, p95: 40, worst: 40, n: 1 });
    expect(m.describe()).toMatchObject({ frames: 21, reports: 21 });
  });

  test("an input nothing was drawn for has no frame to wait for, and a tick's later frame isn't its settle", () => {
    const { m, clock } = meter();
    m.input();
    clock.t += 3000;
    m.frame();                                                                          // the clock ticked over, minutes later
    expect(m.settle().n).toBe(0);
    expect(m.settle()).toEqual({ p50: null, p95: null, worst: null, n: 0 });
  });

  test("a redraw asked long after an input nothing was drawn for isn't that input's frame", () => {
    const { m, clock } = meter();
    m.input();
    clock.t += 5 * 60_000;                                                              // a timer, minutes on
    m.asked();
    m.frame();
    expect(m.settle().n).toBe(0);
  });

  test("reading the meter while a slow frame draws doesn't end the burst it is measuring", () => {
    const { m, clock } = meter();
    m.input(); m.asked();
    clock.t += 250;                                                                     // the paint, longer than a burst's gap
    m.slow();                                                                           // the status bar asks while it draws
    m.frame();
    expect(m.settle()).toEqual({ p50: 250, p95: 250, worst: 250, n: 1 });
  });

  test("p50, p95 and the worst over the bursts kept, the ring holding the latest", () => {
    const { m, clock, press } = meter();
    for (let i = 1; i <= 100; i++) { press(i); clock.t += 500; }
    expect(m.settle()).toEqual({ p50: 50, p95: 95, worst: 100, n: 100 });
    for (let i = 0; i < SETTLE_RING; i++) { press(7); clock.t += 500; }
    expect(m.settle()).toEqual({ p50: 7, p95: 7, worst: 7, n: SETTLE_RING });
    expect(settleOf([3, 1, 2])).toEqual({ p50: 2, p95: 3, worst: 3, n: 3 });
  });

  test("`since` says what the counts cover", () => {
    const { m } = meter();
    expect(m.describe().since).toBe(new Date(5_000_000).toISOString());
  });
});

describe("slow", () => {
  /** `run(n, ms)`: a burst every 5 s, `n` of them, each taking `ms`, the meter asked as a tick would. */
  const bursts = (every = 5000) => {
    const k = meter();
    const run = (count: number, took: number) => { for (let i = 0; i < count; i++) { k.press(took); k.clock.t += every; k.m.slow(); } };
    return { ...k, run };
  };

  test("a minute of slow bursts, not a few: the bar says the number once the last minute's p95 has stayed over", () => {
    const { m, run } = bursts();
    run(SETTLE_MIN_BURSTS - 1, 300);
    expect(m.slow()).toBeNull();                                     // too few to say
    run(8, 300);
    expect(m.slow()).toBeNull();                                     // over the budget for less than a minute
    run(8, 300);
    expect(m.slow()).toBe("slow: 300 ms to settle");
  });

  test("a slowdown that ends within the minute says nothing, and a quiet minute takes the word away", () => {
    const { m, clock, run } = bursts();
    run(8, 300);
    run(30, 20);                                                     // fast again
    expect(m.slow()).toBeNull();
    run(30, 300);
    expect(m.slow()).toBe("slow: 300 ms to settle");
    clock.t += 61_000;                                               // nothing at all for a minute
    expect(m.slow()).toBeNull();
  });

  test("a budget the bursts stay under says nothing", () => {
    const { m, run } = bursts();
    run(40, 40);
    expect(m.slow()).toBeNull();
  });
});
