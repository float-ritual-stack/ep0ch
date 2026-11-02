// The script tests' shared `until` (script-harness.ts) scales its deadline by EP0CH_TEST_SLACK, as the door's does
// (PIE-1504): a run under load waits longer instead of going red. Lower bounds only.
import { expect, test } from "bun:test";
import { testSlack, until } from "./script-harness";

test("until waits EP0CH_TEST_SLACK times as long; unset or nonsense means 1", async () => {
  const was = process.env.EP0CH_TEST_SLACK;
  const timing = async (slack: string | undefined, ms: number) => {
    if (slack === undefined) delete process.env.EP0CH_TEST_SLACK; else process.env.EP0CH_TEST_SLACK = slack;
    const t0 = performance.now();
    await expect(until("never", () => false, ms)).rejects.toThrow("timed out waiting for never");
    return performance.now() - t0;
  };
  try {
    process.env.EP0CH_TEST_SLACK = "nope";
    expect(testSlack()).toBe(1);
    process.env.EP0CH_TEST_SLACK = "3";
    expect(testSlack()).toBe(3);
    expect(await timing(undefined, 60)).toBeGreaterThanOrEqual(55);
    expect(await timing("4", 60)).toBeGreaterThanOrEqual(235);
  } finally {
    if (was === undefined) delete process.env.EP0CH_TEST_SLACK; else process.env.EP0CH_TEST_SLACK = was;
  }
});
