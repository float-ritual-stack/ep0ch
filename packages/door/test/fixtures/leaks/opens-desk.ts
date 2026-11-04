// The file after it: the desk it opens is its own, not the one the file before kept.
import { expect, test } from "bun:test";
import { Desk } from "../../../src/desk/desk";

test("the next open of the desk is a new one", () => {
  const kept = (globalThis as { keptProbe?: Desk }).keptProbe;
  expect(kept).toBeDefined();
  expect(Desk.resume()).not.toBe(kept!);
});
