// The cell grid `ep0ch show --cells` prints (src/cells.ts): a Raster takes one width-1 BMP glyph a cell, so a wide
// glyph is U+FFFD and a blank, columns kept; colours come from the SGR the door writes.
import { describe, expect, test } from "bun:test";
import { DEFAULT_COLOUR, linesToCells, REPLACEMENT, sgrColours } from "../src/cells";

const decode = (cells: string) => {
  const b = Buffer.from(cells, "base64");
  return Array.from({ length: b.length / 12 }, (_, i) => [0, 4, 8].map(o => b.readUInt32LE(i * 12 + o)) as [number, number, number]);
};

describe("cells", () => {
  test("a plain line: its glyphs, the terminal's own colours, padded to the width", () => {
    const g = linesToCells(["Hi"], 4);
    expect([g.columns, g.rows, g.replaced]).toEqual([4, 1, 0]);
    expect(decode(g.cells)).toEqual([[0x48, DEFAULT_COLOUR, DEFAULT_COLOUR], [0x69, DEFAULT_COLOUR, DEFAULT_COLOUR], [0x20, DEFAULT_COLOUR, DEFAULT_COLOUR], [0x20, DEFAULT_COLOUR, DEFAULT_COLOUR]]);
  });

  test("truecolour and the basic sixteen; a reset; inverse swaps", () => {
    expect(sgrColours("\x1b[38;2;255;136;0m\x1b[48;2;1;2;3m")).toEqual({ fg: 0xff8800, bg: 0x010203 });
    expect(sgrColours("\x1b[31m")).toEqual({ fg: 0xaa0000, bg: DEFAULT_COLOUR });
    expect(sgrColours("\x1b[38;2;9;9;9m\x1b[0m")).toEqual({ fg: DEFAULT_COLOUR, bg: DEFAULT_COLOUR });
    expect(sgrColours("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m\x1b[7m")).toEqual({ fg: 0x0000ff, bg: 0xff0000 });
    // The terminal's own colours stay its own under inverse: no bright guess.
    expect(sgrColours("\x1b[7m")).toEqual({ fg: DEFAULT_COLOUR, bg: DEFAULT_COLOUR });
    const [first] = decode(linesToCells(["\x1b[38;2;255;136;0mA\x1b[0mB"], 2).cells);
    expect(first).toEqual([0x41, 0xff8800, DEFAULT_COLOUR]);
  });

  test("a wide glyph is U+FFFD then a blank, so the columns after it stay where the reader put them", () => {
    const g = linesToCells(["a漢b"], 5);
    expect(decode(g.cells).map(c => c[0])).toEqual([0x61, REPLACEMENT, 0x20, 0x62, 0x20]);
    expect(g.replaced).toBe(1);
    // Outside the BMP (an emoji) likewise; box drawing and blocks are width 1 and kept.
    const e = linesToCells(["😀─█"], 4);
    expect(decode(e.cells).map(c => c[0])).toEqual([REPLACEMENT, 0x20, 0x2500, 0x2588]);
    // A combining mark is dropped from the glyph it joins, and counted.
    const c = linesToCells(["e\u0301x"], 2);
    expect([decode(c.cells).map(x => x[0]), c.replaced]).toEqual([[0x65, 0x78], 1]);
  });
});
