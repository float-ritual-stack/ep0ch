// A test file that sets an environment variable and never puts it back: the check names it, and the next file has
// the environment the run started with.
import { expect, test } from "bun:test";

test("an env var set and left", () => {
  process.env.EP0CH_LEAK_PROBE = "left";
  expect(process.env.EP0CH_LEAK_PROBE).toBe("left");
});
