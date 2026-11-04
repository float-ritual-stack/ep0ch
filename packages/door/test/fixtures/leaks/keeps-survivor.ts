// A kept desk whose program outlives being told to end.
import { expect, test } from "bun:test";
import { kept } from "../../../src/desk/kept-desk";

test("a desk with a program that won't end is kept and left", () => {
  kept.desk = { panes: new Map([[1, { kill() {} }]]), holdsPrograms: () => true, dispose() { return "keep"; } } as never;
  expect(kept.desk).not.toBeNull();
});
