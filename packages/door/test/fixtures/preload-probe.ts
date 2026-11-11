// Run by test/root-preload.test.ts as `bun test` from the repository's root: says whether the door's preload ran, and
// that what it made is still there for this test (a run of several files, or --rerun-each, PIE-1742).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

test("the door's preload ran", () => {
  expect(process.env.EP0CH_EDIT_ARM).toBe("off");
  expect(process.env.EP0CH_LANDING).toBeUndefined();
  expect(process.env.XDG_STATE_HOME).toContain("ep0ch-test-state-");
  expect({ state: existsSync(process.env.XDG_STATE_HOME!), owner: existsSync(process.env.FAKE_SSH_OWNER_FILE!) }).toEqual({ state: true, owner: true });
});
