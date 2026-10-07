// Run by test/root-preload.test.ts as `bun test` from the repository's root: says whether the door's preload ran.
import { expect, test } from "bun:test";

test("the door's preload ran", () => {
  expect(process.env.EP0CH_EDIT_ARM).toBe("off");
  expect(process.env.EP0CH_LANDING).toBeUndefined();
  expect(process.env.XDG_STATE_HOME).toContain("ep0ch-test-state-");
});
