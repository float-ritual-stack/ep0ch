// The file after one that left its App running: a few ticks pass while it runs.
import { beforeAll, expect, test } from "bun:test";

// Time passes before any test of this file starts, too (the earlier file's App must already be still).
beforeAll(async () => { await Bun.sleep(200); });

test("the next file runs while time passes", async () => {
  await Bun.sleep(300);
  expect(true).toBe(true);
});
