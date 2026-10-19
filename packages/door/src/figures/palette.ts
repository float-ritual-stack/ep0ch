// What every `::graph-*` figure draws with (src/graphs.ts and the kinds in this folder): the one accent, the dim frame
// and muted text, the ink of a row, the bright of a chosen one. Nothing outside these four.
import { C, fg, RESET } from "../style";
import { colourInline, rowLines, wrap } from "../text";

export const ACCENT = C.lcyan, DIM = C.dark, INK = C.grey, HI = C.white;
/** The shades a figure counts in, none to most (an activity grid's days, a matrix's cells, a banner's band). */
export const SHADES = ["·", "░", "▒", "▓", "█"] as const;

export type { Props } from "@ep0ch/outline-core/figure-props";
import type { Props } from "@ep0ch/outline-core/figure-props";
export { ordered, records } from "@ep0ch/outline-core/figure-props";

/**
 * Tags a row as a link to its note (PIE-441): the reader's `DocEnv.link`, or nothing (text stays text). `figure`: the
 * key of the figure the row is in, so the figure's keys (tabs, density) work while the row is the current element.
 * `query` opens a list instead of a block, for a day representing more than one note.
 */
export type RowLink = (block: string, text: string, figure?: string, query?: string) => string;
export const rowLink = (link: RowLink | undefined, block: unknown, text: string, figure?: string) => (link && typeof block === "string" ? link(block, text, figure) : text);

/** A kind's drawing: its rows at `w` columns inside the frame; `ui.rows`, what the reader lends its rows (RowInline). */
export type Draw = (p: Props, w: number, link?: RowLink, ui?: { rows?: RowInline }) => string[];

/**
 * How much room a figure has (PIE-581): `narrow` under 48 columns (a river column, a drawer), `cozy` under 90 (a
 * detail beside another tile), `wide` past it. Each kind says once what it does per tier; the tier is the
 * reader's width, never the terminal's.
 */
export type Tier = "narrow" | "cozy" | "wide";
/**
 * The frame cuts any line a kind overruns (`pad` ends it with …), so nothing drawn is ever wider than the figure; a
 * kind's job under the tier rule is to make the cut unnecessary.
 */
export const tier = (w: number): Tier => (w < 48 ? "narrow" : w < 90 ? "cozy" : "wide");

/**
 * What a reader lends a figure's rows (PIE-864), so a row's words read and act as the same words in the note do. Without
 * it (an export, a draft's preview) a row is drawn as written.
 */
export interface RowInline {
  /**
   * A row's words as the reader presents a note's line (src/refs.ts presentLinks): its links, `[[pages]]`, `((refs))`
   * and `#tags` tagged so `[ ]` stops on them and a click follows; emphasis as marks. `linked`: the row is a link to its
   * own note, so the links in it read as links but aren't elements of their own.
   */
  present(text: string, linked: boolean): string;
  /**
   * A row's box (`[ ]`), tagged as the step it is (PIE-864: a written row by its line, a live row by its note), so
   * its status choice opens on it and `x o + - w !` mark it; null leaves it text.
   */
  box?(item: Props, box: string): string | null;
}

/**
 * A row's words `w` wide in `ink`, through the reader's inline pipeline (`inline`): code spans magenta (a click copies
 * one), links in the link colour and followable, emphasis drawn. Without it, wrapped as written. `linked`: the row is a
 * link to its note (see RowInline.present).
 */
export function inlineRows(text: string, w: number, ink: number, inline?: RowInline, linked = false): string[] {
  if (!inline) return rowLines(text, w).map(l => fg(ink) + l + RESET);
  return rowLines(colourInline(inline.present(text, linked), ink), w);
}
