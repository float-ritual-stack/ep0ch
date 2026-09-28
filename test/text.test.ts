// wrap() at widths a narrow pane or deep indentation can hand it: it always ends, and its callers keep
// their rows inside the width. Fictional text only.
import { expect, test } from "bun:test";
import { renderDoc } from "../src/doc";
import { width } from "../src/style";
import { wrap } from "../src/text";

test("wrap ends at a width of zero, less, or not a number: one character a row", () => {
  for (const w of [0, -3, -0.5, NaN]) expect(wrap("rake the leaves", w)).toEqual(wrap("rake the leaves", 1));
  expect(wrap("ab cd", 0)).toEqual(["a", "b", "c", "d"]);
  expect(wrap("abc", 2.7)).toEqual(["ab", "c"]);
});

test("a deeply indented list item in a narrow reader keeps its text inside the width", () => {
  const body = `${" ".repeat(24)}- tie up the sweet peas before the wind`;
  const doc = renderDoc(body, { width: 12, cellW: 9, cellH: 16, graphics: false, maxImageRows: 0, unfold: false });
  for (const l of doc.lines) expect(width(l)).toBeLessThanOrEqual(12);
  expect(doc.lines.join(" ").replace(/\x1b\[[\d;]*m/g, "")).toContain("sweet");
  expect(doc.lines.length).toBeLessThan(10);
});
