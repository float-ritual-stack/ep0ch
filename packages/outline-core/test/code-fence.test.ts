import { expect, test } from "bun:test";
import { closesCodeFence, codeFenceLines, codeFenceOpen } from "../src/code-fence";
import { fencedRanges, protectedCodeRanges, scanPropertyLiteralRanges } from "../src/code-ranges";
import { LIST_FENCE_LINES, LIST_FENCE_NOTE, LONG_FENCE_LINES, LONG_FENCE_NOTE, TILDE_FENCE_LINES, TILDE_FENCE_NOTE } from "./fixtures/code-notes";

test("a fence opens on three or more backticks or tildes, indented at most three columns", () => {
  expect(codeFenceOpen("```")).toEqual({ char: "`", length: 3, indent: 0, info: "" });
  expect(codeFenceOpen("   ~~~~ yaml title")).toEqual({ char: "~", length: 4, indent: 3, info: "yaml title" });
  expect(codeFenceOpen("``")).toBeNull();
  expect(codeFenceOpen("    ```")).toBeNull();
  expect(codeFenceOpen("\t```")).toBeNull();
  expect(codeFenceOpen("```\r")).toEqual({ char: "`", length: 3, indent: 0, info: "" });
});

test("a backtick fence's info string has no backtick (that line is a code span); a tilde fence's may", () => {
  expect(codeFenceOpen("```js `x`")).toBeNull();
  expect(codeFenceOpen("~~~ `x`")).toEqual({ char: "~", length: 3, indent: 0, info: "`x`" });
});

test("a list item's content column moves where a fence may start", () => {
  expect(codeFenceOpen("     ```", 2)).not.toBeNull();
  expect(codeFenceOpen("      ```", 2)).toBeNull();
  expect(codeFenceOpen(" ```", 2)).toBeNull();
});

test("only the same character, at least as many, then only blanks, closes a fence", () => {
  const fence = codeFenceOpen("~~~~")!;
  expect(closesCodeFence("~~~~", fence)).toBe(true);
  expect(closesCodeFence("~~~~~  ", fence)).toBe(true);
  expect(closesCodeFence("~~~", fence)).toBe(false);
  expect(closesCodeFence("````", fence)).toBe(false);
  expect(closesCodeFence("~~~~ more", fence)).toBe(false);
  // Only spaces and tabs are blanks: a no-break space after the run is text, so it doesn't close.
  expect(closesCodeFence("~~~~\u00a0", fence)).toBe(false);
});

test("the shared notes' fences are where the service and the door look for them", () => {
  const lines = (text: string) => codeFenceLines(text.split("\n")).flatMap((at, i) => (at >= 0 ? [i] : []));
  expect(lines(TILDE_FENCE_NOTE)).toEqual(TILDE_FENCE_LINES);
  expect(lines(LONG_FENCE_NOTE)).toEqual(LONG_FENCE_LINES);
  expect(lines(LIST_FENCE_NOTE)).toEqual(LIST_FENCE_LINES);
  expect(codeFenceLines(["```", "never closed", "**x**"])).toEqual([0, 0, 0]);
});

test("an unclosed fence in a list item protects only the item: a property after the list is read", () => {
  const text = "- a\n  ```\n  [k::1]\nafter [k::2]";
  expect(scanPropertyLiteralRanges(text)).toEqual([{ start: 4, end: text.indexOf("after") }]);
});

test("the literal and protected ranges cover a tilde fence as code", () => {
  const fenceStart = TILDE_FENCE_NOTE.indexOf("~~~text"), fenceEnd = TILDE_FENCE_NOTE.lastIndexOf("~~~") + 4;
  expect(fencedRanges(TILDE_FENCE_NOTE)).toEqual([{ start: fenceStart, end: fenceEnd }]);
  expect(scanPropertyLiteralRanges(TILDE_FENCE_NOTE)).toEqual([{ start: fenceStart, end: fenceEnd }]);
  const inside = TILDE_FENCE_NOTE.indexOf("[crate::7]");
  expect(protectedCodeRanges(TILDE_FENCE_NOTE).some(r => r.start <= inside && inside < r.end)).toBe(true);
});

test("a fence under a bullet counts from the item's content column; outside a list, four columns is not a fence", () => {
  expect(codeFenceLines(["- a", "     ```", "  x", "     ```", "after"])).toEqual([-1, 1, 1, 1, -1]);
  expect(codeFenceLines(["- ```", "  x", "  ```"])).toEqual([0, 0, 0]);
  expect(codeFenceLines(["text", "    ```", "x"])).toEqual([-1, -1, -1]);
  // Unclosed, it ends with its list item: a line left of the item's content column is read as what it is.
  expect(codeFenceLines(["- a", "  ```", "  code", "after the list", "```"])).toEqual([-1, 1, 1, -1, 4]);
});

test("the Claude mod's copy is outline-core's code-fence.ts, word for word", async () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
  const [own, copy] = await Promise.all([read("../src/code-fence.ts"), read("../../claude-mod/hooks/code-fence.ts")]);
  expect(copy.slice(copy.indexOf("\n") + 1)).toBe(own);
});
