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

test("inline code that wraps onto the next row is code on both rows, with no stray backtick", () => {
  const body = "Run `bun scripts/try-it.sh --showcase --reset` from the door's folder, then wait.";
  const doc = renderDoc(body, { width: 30, cellW: 9, cellH: 16, graphics: false, maxImageRows: 0, unfold: false });
  const rows = doc.lines.map(l => l.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "")).filter(l => l.trim());
  expect(rows.join("\n")).not.toContain("`");
  expect(rows.join(" ").replace(/\s+/g, " ")).toContain("bun scripts/try-it.sh --showcase --reset from the door's folder");
  // Both halves are drawn in the code colour (the row's colour switches before the code's first word).
  const coded = doc.lines.filter(l => /\x1b\[[\d;]*m(bun|--showcase|--reset)/.test(l.replace(/[\u{100000}-\u{10FFFD}]/gu, "")));
  expect(coded.length).toBeGreaterThanOrEqual(2);
  // A lone backtick, with no closer, is text and stays.
  expect(wrap("a ` alone in a long line of words here", 12).join(" ")).toContain("`");
});
