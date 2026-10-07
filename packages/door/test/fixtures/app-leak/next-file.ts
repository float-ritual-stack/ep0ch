// The file after one that left its App running: a few ticks pass while it runs.
import { expect, test } from "bun:test";

test("the next file runs while time passes", async () => {
  await Bun.sleep(300);
  expect(true).toBe(true);
});
