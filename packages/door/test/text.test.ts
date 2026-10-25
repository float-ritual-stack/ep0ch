import { Canvas } from "../src/canvas";
import { Overflow } from "../src/overflow";
// wrap() at widths a narrow pane or deep indentation can hand it: it always ends, and its callers keep
// their rows inside the width. Fictional text only.
import { expect, test } from "bun:test";
import { renderDoc } from "../src/doc";
import { pad, visible, width } from "../src/style";
import { presentLinks } from "../src/refs";
import { colourBody, wrap } from "../src/text";

test("single tildes in paths and approximations stay literal; only double tildes strike (PIE-899)", () => {
  for (const text of ["copies of ~/.claude/~/projects/x at the same paths", "~178 orphaned … ~", "~single~", "inline ~~~triple~~~"]) {
    const doc = renderDoc(presentLinks(text, false, null), { width: 100, cellW: 9, cellH: 16, graphics: false, maxImageRows: 0, unfold: false });
    expect(doc.lines.join("").replace(/\x1b\[[\d;]*m/g, "").trim()).toBe(text);
    expect(doc.lines.join("")).not.toContain("\x1b[9m");
  }
  const struck = renderDoc(presentLinks("~~this~~", false, null), { width: 100, cellW: 9, cellH: 16, graphics: false, maxImageRows: 0, unfold: false });
  expect(struck.lines.join("")).toContain("\x1b[9m");
  expect(struck.lines.join("").replace(/\x1b\[[\d;]*m/g, "").trim()).toBe("this");
});

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

test("a plain wrap (not a body row) adds nothing: every row fits its width and holds only the text's backticks", () => {
  const text = "see `aaaa bbbb cccc dddd eeee` ok and more words after it";
  for (const w of [6, 10, 14, 20]) {
    const rows = wrap(text, w);
    for (const r of rows) expect(width(r)).toBeLessThanOrEqual(w);
    expect(rows.join("").split("`").length - 1).toBe(2);
  }
});


test("a large clipped value reveals a bounded prefix and the omitted count", () => {
  const text = "seed ".repeat(4000);
  const canvas = new Canvas(40, 3);
  canvas.text(0, 0, pad(text, 20));
  expect(canvas.lines().join("\n").length).toBeLessThan(1000);
  const overflow = new Overflow();
  overflow.draw(canvas.lines(), 40, 0);
  const reveal = overflow.reveal().text!;
  expect(reveal).toStartWith("seed seed");
  expect(reveal.length).toBeLessThan(4200);
  expect(reveal).toMatch(/… \(\d+ more characters\)$/);
  overflow.draw(canvas.lines(), 40, 1000);
  expect(overflow.reveal().text).toBe(reveal);
});


test("a shortened reference still reveals its full id after drawing", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  const canvas = new Canvas(80, 3);
  canvas.text(0, 0, colourBody(presentLinks(`((${id}))`, false, null)));
  const overflow = new Overflow();
  overflow.draw(canvas.lines(), 80, 0);
  expect(overflow.reveal().text).toBe(id);
});


test("a revealed cut-off value scrolls in its own cells and leaves the rest of the screen as it was (PIE-1140)", () => {
  const canvas = new Canvas(60, 4);
  canvas.text(0, 0, "above the value, a whole row of other text here");
  canvas.text(4, 1, pad("a long title that does not fit in twenty cells at all", 20));
  canvas.text(30, 1, "beside");
  canvas.text(0, 2, "below the value, another row that must stay put");
  const before = canvas.lines().map(l => visible(l));
  const overflow = new Overflow();
  overflow.draw(canvas.lines(), 60, 0);
  overflow.hover(8, 1);
  const shown = overflow.draw(canvas.lines(), 60, 0);
  const after = shown.lines.map(l => visible(l));
  expect(after[0]).toBe(before[0]);
  expect(after[2]).toBe(before[2]);
  expect(after[1]!.slice(0, 4)).toBe(before[1]!.slice(0, 4));
  expect(after[1]!.slice(24)).toBe(before[1]!.slice(24));
  expect(after[1]!.slice(4, 24)).toBe("a long title that do");
  expect(shown.overlay).toEqual({ col: 4, row: 1, cols: 20, rows: 1 });
  const later = overflow.draw(canvas.lines(), 60, 4000).lines.map(l => visible(l));
  expect(later[1]!.slice(4, 24)).not.toBe("a long title that do");
  expect(later[0]).toBe(before[0]);
});

test("hover says whether the pointer's move changed what is revealed, so a redraw happens only then (PIE-1300)", () => {
  const canvas = new Canvas(60, 4);
  canvas.text(4, 1, pad("a long title that does not fit in twenty cells at all", 20));
  canvas.text(4, 2, pad("another long title, also cut off before its end", 20));
  const overflow = new Overflow();
  overflow.draw(canvas.lines(), 60, 0);
  // Plain cells, then a value comes under the pointer.
  expect(overflow.hover(0, 0)).toBe(false);
  expect(overflow.hover(50, 3)).toBe(false);
  expect(overflow.hover(8, 1)).toBe(true);
  // Until the next draw shows it, the same value is still news; once drawn, moving about inside it is not.
  overflow.draw(canvas.lines(), 60, 0);
  expect(overflow.hover(9, 1)).toBe(false);
  expect(overflow.hover(23, 1)).toBe(false);
  // Another value is news, and so is leaving for plain cells.
  expect(overflow.hover(8, 2)).toBe(true);
  overflow.draw(canvas.lines(), 60, 0);
  expect(overflow.hover(40, 2)).toBe(true);
  overflow.draw(canvas.lines(), 60, 0);
  expect(overflow.hover(41, 2)).toBe(false);
  expect(overflow.describe()).toEqual({ pointer: { x: 41, y: 2 }, reading: null });
});
