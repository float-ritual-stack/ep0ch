// PIE-1357: a part dropped into a note is a block of its own, a blank line around it, never doubled.
import { expect, test } from "bun:test";
import { blockAfter } from "../src/block-insert";

test("a blank line before and after the block, unless one is there or the note ends", () => {
  expect(blockAfter(["Pad", "First.", "Second."], 1, "!((n^a))")).toBe("First.\n\n!((n^a))\n");
  expect(blockAfter(["Pad", "First.", "", "Second."], 1, "!((n^a))")).toBe("First.\n\n!((n^a))");
  expect(blockAfter(["Pad", "", "Second."], 1, "!((n^a))")).toBe("\n!((n^a))\n");
  expect(blockAfter(["Pad", "Last."], 1, "((n^b))")).toBe("Last.\n\n((n^b))");
});
