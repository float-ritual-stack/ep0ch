// Oct 25: a moved checkout said "RUN AGAIN" on a ✓ line that read as all good. A person's install now runs itself
// again on the new code; scripted callers rerun it themselves (src/link.ts), and a rerun never reruns.
import { expect, test } from "bun:test";
import { rerunAfterMove } from "../src/setup/apply";

test("a person's install reruns once when the checkout moved, and only then", () => {
  const apply = ["install", "--apply"];
  expect(rerunAfterMove(0, true, apply, {})).toBe(true);
  expect(rerunAfterMove(0, false, apply, {})).toBe(false);
  expect(rerunAfterMove(1, true, apply, {})).toBe(false);
  expect(rerunAfterMove(0, true, ["install"], {})).toBe(false);
  expect(rerunAfterMove(0, true, [...apply, "--json"], {})).toBe(false);
  expect(rerunAfterMove(0, true, [...apply, "--as-client"], {})).toBe(false);
  expect(rerunAfterMove(0, true, apply, { EP0CH_INSTALL_RERUN: "1" })).toBe(false);
});
