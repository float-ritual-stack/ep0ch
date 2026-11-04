// A kept desk whose running terminal sits in a group's inner desk, not among its own tiles.
import { expect, test } from "bun:test";
import { kept } from "../../../src/desk/kept-desk";

test("a desk with a terminal in a group is kept and left", () => {
  const ended = { terminal: false };
  (globalThis as { groupProbe?: typeof ended }).groupProbe = ended;
  const inner = { panes: new Map([[1, { kill() { ended.terminal = true; } }]]), holdsPrograms: () => !ended.terminal };
  kept.desk = { panes: new Map([[1, { inner }]]), holdsPrograms: () => false, dispose() {} } as never;
  expect(kept.desk).not.toBeNull();
});
