// A drawing as a grid of cells, for a program that paints cells rather than parsing escapes: `ep0ch show <id>
// --cells` (src/notes-cli.ts), which a Claude Code mod draws as one `Raster` (packages/claude-mod, BlockView).
//
// The lines are the note surface's own (the reader's renderer); this only lays them into the desk's `Canvas`, which
// already measures glyphs as the terminal does, and reads each cell back. The format is the Raster's: row-major,
// standard padded base64 of little-endian u32 triplets `[codePoint, foreground, background]`, a colour `0x00RRGGBB`
// or `DEFAULT_COLOUR` for the terminal's own. A Raster takes one width-1 BMP character a cell, so a wide glyph (CJK,
// most emoji) becomes U+FFFD in its first cell and a blank in its second (the columns stay where the reader put
// them), and a glyph outside the BMP or with a combining mark that can't stand alone becomes U+FFFD; `replaced`
// counts them. Bold, italic and underline have no place in a cell and are dropped; inverse swaps the colours.
import { SGR_TO_VGA, VGA_RGB } from "./ansi";
import { Canvas } from "./canvas";
import { glyphWidth } from "./style";

/** The terminal's own colour, foreground or background (bit 24 alone). */
export const DEFAULT_COLOUR = 0x01000000;
/** What stands in a cell for a glyph a cell grid can't hold. */
export const REPLACEMENT = 0xfffd;

export interface CellGrid {
  columns: number;
  rows: number;
  /** Every cell, row-major, as base64 of u32 LE `[codePoint, fg, bg]`. */
  cells: string;
  /** How many cells hold U+FFFD for a glyph the grid couldn't hold. */
  replaced: number;
}

const rgbOf = ([r, g, b]: readonly number[]) => ((r! & 255) << 16) | ((g! & 255) << 8) | (b! & 255);

/** The colours an accumulated SGR string leaves a cell in (truecolour as the door writes it, and the 16 basic). */
export function sgrColours(sgr: string): { fg: number; bg: number } {
  let fg = DEFAULT_COLOUR, bg = DEFAULT_COLOUR, inverse = false;
  for (const m of sgr.matchAll(/\x1b\[([\d;]*)m/g)) {
    const ps = m[1] ? m[1].split(";").map(Number) : [0];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      if (p === 0) { fg = bg = DEFAULT_COLOUR; inverse = false; }
      else if (p === 7) inverse = true;
      else if (p === 27) inverse = false;
      else if (p === 39) fg = DEFAULT_COLOUR;
      else if (p === 49) bg = DEFAULT_COLOUR;
      else if (p >= 30 && p <= 37) fg = rgbOf(VGA_RGB[SGR_TO_VGA[p - 30]!]!);
      else if (p >= 90 && p <= 97) fg = rgbOf(VGA_RGB[SGR_TO_VGA[p - 90]! + 8]!);
      else if (p >= 40 && p <= 47) bg = rgbOf(VGA_RGB[SGR_TO_VGA[p - 40]!]!);
      else if (p >= 100 && p <= 107) bg = rgbOf(VGA_RGB[SGR_TO_VGA[p - 100]! + 8]!);
      else if ((p === 38 || p === 48) && ps[i + 1] === 2) {
        const c = rgbOf(ps.slice(i + 2, i + 5));
        if (p === 38) fg = c; else bg = c;
        i += 4;
      } else if ((p === 38 || p === 48) && ps[i + 1] === 5) i += 2;   // 256 colours: the door doesn't write them; left as they were
    }
  }
  return inverse ? { fg: bg === DEFAULT_COLOUR ? 0 : bg, bg: fg === DEFAULT_COLOUR ? 0xcccccc : fg } : { fg, bg };
}

/** The code point a cell holds: its glyph when that is one width-1 BMP character (a combining mark after it dropped, and counted), else U+FFFD. */
function codeOf(ch: string): { code: number; replaced: boolean } {
  if (ch === "") return { code: 0x20, replaced: false };
  const first = ch.codePointAt(0)!;
  const lone = String.fromCodePoint(first);
  if (first > 0xffff || first < 0x20 || glyphWidth(lone) !== 1) return { code: REPLACEMENT, replaced: true };
  return { code: first, replaced: lone !== ch };
}

/** Styled lines (the note surface's) as a `columns`-wide cell grid, one row a line. */
export function linesToCells(lines: readonly string[], columns: number): CellGrid {
  const canvas = new Canvas(columns, lines.length);
  lines.forEach((l, row) => canvas.text(0, row, l));
  const bytes = new Uint8Array(columns * lines.length * 12), view = new DataView(bytes.buffer);
  let at = 0, replaced = 0;
  const put = (v: number) => { view.setUint32(at, v, true); at += 4; };
  for (const row of canvas.grid()) {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]!;
      const { fg, bg } = sgrColours(cell.sgr);
      // A wide glyph's spacer stays blank in the glyph's colours; the glyph's own cell is U+FFFD.
      const wide = cell.ch !== "" && row[x + 1]?.ch === "";
      const { code, replaced: lost } = wide ? { code: REPLACEMENT, replaced: true } : codeOf(cell.ch);
      if (lost) replaced++;
      put(code); put(fg); put(bg);
    }
  }
  return { columns, rows: lines.length, cells: Buffer.from(bytes).toString("base64"), replaced };
}
