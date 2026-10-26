// PIE-1357: a part dropped into a note is a block of its own, a blank line around it, never doubled.
import { expect, test } from "bun:test";
import { blockAfter } from "../src/block-insert";

test("a blank line before and after the block, unless one is there or the note ends", () => {
  expect(blockAfter(["Pad", "First.", "Second."], 1, "!((n^a))")).toBe("First.\n\n!((n^a))\n");
  expect(blockAfter(["Pad", "First.", "", "Second."], 1, "!((n^a))")).toBe("First.\n\n!((n^a))");
  expect(blockAfter(["Pad", "", "Second."], 1, "!((n^a))")).toBe("\n!((n^a))\n");
  expect(blockAfter(["Pad", "Last."], 1, "((n^b))")).toBe("Last.\n\n((n^b))");
});

test("a drop lands after the block it's on, never inside a code fence or a component, blank lines in them or not", async () => {
  const { landingLine } = await import("../src/block-insert");
  const note = ["Pad", "Intro line", "more intro", "", "```js", "first()", "", "second()", "```", "", "::graph-stat", "- a: 1", "", "::", "", "Last."];
  expect(landingLine(note, 1)).toBe(2);
  expect(landingLine(note, 5)).toBe(8);
  expect(landingLine(note, 11)).toBe(13);
  expect(landingLine(note, 15)).toBe(15);
});
