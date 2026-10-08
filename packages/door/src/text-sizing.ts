// Kitty's text sizing protocol (OSC 66): text the terminal draws at a multiple of the cell size. A reader's title uses
// scale 2 where the terminal has it: the title row and the row under it, twice as wide. Everything else stays cells:
// the canvas holds the title as bold text on its row and a blank row under it (what `peek`, copy and the layout
// read), and a sized placement is painted over those two rows after the rows go out, and again whenever either row
// was rewritten (a rewrite of a cell takes the whole sized character with it).
import type { Rgba } from "./vga";
import { visible } from "./style";
import type { Placement } from "./kitty";

/** What a sized placement draws: `text` at `scale`, in the style `sgr`. */
export interface SizedText { text: string; sgr: string; scale: number }

/** A placement that carries text has no picture: this stands in for the field every placement has. */
export const NO_PICTURE: Rgba = { width: 1, height: 1, data: new Uint8Array(4) };

/** Whether `p` is text drawn at a size, not an image. */
export const isSized = (p: Placement): p is Placement & { sized: SizedText } => p.sized !== undefined;

/**
 * Asked at start (after the cursor goes home): print two cells of sized-text width and ask where the cursor is. A
 * terminal with the protocol has moved two cells (column 3); one without ignores the sequence (column 1).
 */
export const SIZED_QUERY = "\x1b[1;1H\x1b]66;w=2; \x1b\\\x1b[6n\x1b[1;1H";
/** The cursor report that answers SIZED_QUERY: the protocol is there when it moved two cells. */
export const sizedAnswer = (col: number) => col === 3;

/** EP0CH_SIZED=1 or 0 says outright; otherwise null: ask the terminal. */
export const sizedHint = (env = process.env): boolean | null => (env.EP0CH_SIZED === "1" ? true : env.EP0CH_SIZED === "0" ? false : null);

/** `s`'s text with no escape or control in it: OSC 66 carries plain text only. */
const plain = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, "");

/** The bytes that paint a sized placement: put the cursor at its cell, draw, and give the cursor back. */
export function sizedBytes(p: Placement & { sized: SizedText }): string {
  return `\x1b7\x1b[${p.row + 1};${p.col + 1}H${p.sized.sgr}\x1b]66;s=${p.sized.scale};${plain(p.sized.text)}\x1b\\\x1b[0m\x1b8`;
}

/** A sized placement of `text` on `row` from `col`: `scale` rows tall and `scale` times as wide as the text. */
export function sizedPlacement(key: string, text: string, sgr: string, col: number, row: number, cells: number, scale = 2): Placement {
  return { key, image: NO_PICTURE, col, row, cols: cells * scale, rows: scale, sized: { text, sgr, scale } };
}

/**
 * What a terminal shows of the sized placements: which it has drawn, so each is painted when it is new, changed, or
 * its rows were rewritten, and only while the cells under it are still the text it stands for (a float or a toast
 * over the title covers it).
 */
export class SizedLayer {
  private drawn = new Map<string, string>();
  constructor(private readonly write: (s: string) => void) {}

  /**
   * Paint `wanted` (placements with `sized`) over `lines` as they were just painted; `rewrote(row)`: that row went out
   * this frame. Returns the rows of placements no longer wanted, which the caller writes again to clear them.
   */
  sync(wanted: Placement[], lines: readonly string[], rewrote: (row: number) => boolean): number[] {
    const next = new Map<string, string>();
    let out = "";
    for (const p of wanted) {
      if (!isSized(p)) continue;
      const here = visible(lines[p.row] ?? ""), under = visible(lines[p.row + 1] ?? "");
      // The cells must still hold the title (as the fallback text) and a blank row: otherwise something is over them.
      if (!here.includes(p.sized.text) || under.trim() !== "") continue;
      const sig = `${p.col},${p.row},${p.sized.scale},${p.sized.sgr}|${p.sized.text}`;
      next.set(p.key, sig);
      if (this.drawn.get(p.key) !== sig || rewrote(p.row) || rewrote(p.row + 1)) out += sizedBytes(p as Placement & { sized: SizedText });
    }
    const gone: number[] = [];
    for (const [key, sig] of this.drawn) if (!next.has(key)) { const row = Number(sig.split(",")[1]); gone.push(row, row + 1); }
    this.drawn = next;
    if (out) this.write(out);
    return gone;
  }

  /** Forget what was drawn (the screen switched or the terminal was handed to a program): the next sync paints all. */
  forget(): void { this.drawn.clear(); }
}
