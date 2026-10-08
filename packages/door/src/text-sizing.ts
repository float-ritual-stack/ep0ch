// Kitty's text sizing protocol (OSC 66): text the terminal draws at a multiple of the cell size. A reader's title uses
// scale 2 where the terminal has it: the title row and the row under it, twice as wide. Everything else stays cells:
// the canvas holds the title as bold text on its row and a blank row under it (what `peek`, copy and the layout
// read), and a sized placement is painted over those two rows after the rows go out, and again whenever either row
// was rewritten (a rewrite of a cell takes the whole sized character with it).
import type { Rgba } from "./vga";
import { headOf, tailFrom, visible, width } from "./style";
import type { Placement } from "./kitty";

/** What a sized placement draws: `text` at `scale`, in the style `sgr`. */
export interface SizedText { text: string; sgr: string; scale: number }

/** A placement that carries text has no picture: this stands in for the field every placement has. */
export const NO_PICTURE: Rgba = { width: 1, height: 1, data: new Uint8Array(4) };

/** Whether `p` is text drawn at a size, not an image. */
export const isSized = (p: Placement): p is Placement & { sized: SizedText } => p.sized !== undefined;

/**
 * Asked at start (after the cursor goes home): print one space at scale 2 and ask where the cursor is. A terminal that
 * scales text has moved two cells (column 3); one that doesn't know the sequence ignores it (column 1), and one that
 * knows only its width control moves less than two.
 */
export const SIZED_QUERY = "\x1b[1;1H\x1b]66;s=2; \x1b\\\x1b[6n\x1b[1;1H";
/** The cursor report that answers SIZED_QUERY: the protocol is there when it moved two cells. */
export const sizedAnswer = (col: number) => col === 3;

/** EP0CH_SIZED=1 or 0 says outright; otherwise null: ask the terminal. */
export const sizedHint = (env = process.env): boolean | null => (env.EP0CH_SIZED === "1" ? true : env.EP0CH_SIZED === "0" ? false : null);

/** `s`'s text with no escape or control in it: OSC 66 carries plain text only. */
const plain = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, "");

/** Whether the `cols` cells of `line` from `col` read `text`, then blanks. */
const holds = (line: string | undefined, col: number, cols: number, text: string) => visible(headOf(tailFrom(line ?? "", col), cols)).trimEnd() === text;

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
   * this frame. A placement drawn before and no longer wanted (or covered) leaves its cells until they are written
   * again: `restore` is called with those rows first, before anything is drawn (a row can hold another title too, which
   * is then drawn again).
   */
  sync(wanted: Placement[], lines: readonly string[], rewrote: (row: number) => boolean, restore: (rows: number[]) => void): void {
    const next = new Map<string, { sig: string; p: Placement & { sized: SizedText } }>();
    for (const p of wanted) {
      if (!isSized(p)) continue;
      // The cells must still hold the title (as the fallback text, then blanks) and a blank row under it: otherwise something is over them.
      if (!holds(lines[p.row], p.col, p.cols, p.sized.text) || !holds(lines[p.row + 1], p.col, p.cols, "")) continue;
      next.set(p.key, { sig: `${p.col},${p.row},${p.sized.scale},${p.sized.sgr}|${p.sized.text}`, p });
    }
    const gone = new Set<number>();
    for (const [key, sig] of this.drawn) if (!next.has(key)) { const row = Number(sig.split(",")[1]); gone.add(row); gone.add(row + 1); }
    if (gone.size) restore([...gone]);
    const again = (row: number) => gone.has(row) || rewrote(row);
    let out = "";
    for (const [key, { sig, p }] of next) if (this.drawn.get(key) !== sig || again(p.row) || again(p.row + 1)) out += sizedBytes(p);
    this.drawn = new Map([...next].map(([k, v]) => [k, v.sig]));
    if (out) this.write(out);
  }

  /** Forget what was drawn (the screen switched or the terminal was handed to a program): the next sync paints all. */
  forget(): void { this.drawn.clear(); }
}
