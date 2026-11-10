// The one line↔offset pair the door's readers, completer and kept-edit compare share (PIE-1376): the same answers the
// copies they replaced gave, at the edges too (an empty text, a line past the last, an offset on a line break).
import { describe, expect, test } from "bun:test";
import { lineAtOffset, lineStart } from "../src/code-ranges";

describe("line offsets", () => {
  const text = "Beds\n\n- mulch the beds\nlast";
  const was = (lines: string[], line: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);

  test("lineStart is where each line starts, from its text or its lines; past the last, the length and one", () => {
    const lines = text.split("\n");
    for (let line = 0; line <= lines.length + 1; line++) {
      expect(lineStart(text, line)).toBe(was(lines, line));
      expect(lineStart(lines, line)).toBe(was(lines, line));
    }
    expect(lineStart(text, 2)).toBe(6);
    expect(lineStart("", 0)).toBe(0);
    expect(lineStart("", 3)).toBe(1);
  });

  test("lineAtOffset finds the line of every offset, a line break counting as its line's", () => {
    const lineOf = lineAtOffset(text);
    for (let off = 0; off <= text.length + 1; off++) expect(lineOf(off)).toBe(text.slice(0, off).split("\n").length - 1);
    expect([0, 4, 5, 6, 21, 22, 23, 99].map(lineOf)).toEqual([0, 0, 1, 2, 2, 2, 3, 3]);
    expect(lineOf(-1)).toBe(0);
  });
});
