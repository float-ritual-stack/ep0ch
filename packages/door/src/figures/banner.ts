// A styled heading's band and a styled rule's track (PIE-599): `## Your calls [heading::band]` drawn inside rows of the
// glyphs the figures already draw with (the shades of an activity grid, an uptime strip's bars, the dots and rules of
// a frame), in the figures' dim, so the band reads as one of them: calm, dark-first, no lit fill. The heading carries
// the colour. What the style says (pattern, rows, alignment, padding, margin, tone, lettering) is the outline's
// (outline-core's heading-styles.ts); this file only draws. Under the figures' narrow tier the caller draws the heading
// or rule as written.
//
//   centre, 3 rows                                      left, top row
//   ▓▓▓▓▓▓▓▓▒▒▒▒░░░░ ·  ·        ·  · ░░░░▒▒▒▒▓▓▓▓▓▓▓▓   YOUR CALLS  ▓▓▓▒▒▒▒▒░░░░░ ·  ·   ·
//   ▓▓▓▓▒▒▒░░        Y O U R   C A L L S      ░░▒▒▒▓▓▓▓   ▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░ ·  ·
//   ▓▓▒░                                          ░▒▓▓    ▓▓▓▓▓▒▒▒▒░░░░ ·   ·
import type { BandLetters, BandMargin, HeadingStyle } from "@ep0ch/outline-core/heading-styles";
import { fg, RESET, stripMarks, width as vwidth } from "../style";
import { DIM, INK, SHADES, tier } from "./palette";

/** A small stable hash: the same heading draws the same band every time (and in every snapshot). */
function hash(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) { h = Math.imul(h ^ x, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; }
  return h >>> 0;
}
const seedOf = (s: string) => [...s].reduce((h, ch) => hash(h, ch.codePointAt(0)!), 7);

/**
 * One cell of the band: its glyph and its ink. `fade`: how far into the row's run the cell is, 0 at the edge it fades
 * from to 1 at the run's end (past it, sparse dots). The heaviest shade is ▓ (▒ for a heading deeper than ###):
 * never a full block. Only the figures' dim, and their ink for a mark (an uptime's down day, a bright dot).
 */
function cell(style: HeadingStyle, r: number, c: number, fade: number, level: number, seed: number): [string, number] {
  const top = level <= 3 ? 3 : 2;
  const shade = (s: number): [string, number] => [SHADES[Math.max(0, Math.min(top, s))]!, DIM];
  switch (style.pattern) {
    case "stack": {
      if (fade < 1) return shade(top - Math.floor(fade * top));
      // Past the run: a dot every few columns, the gaps widening as it thins out.
      const gap = 3 + Math.floor((fade - 1) * 4);
      return fade < 1.8 && (c + r) % gap === 0 ? ["·", DIM] : [" ", DIM];
    }
    case "waffle": {
      if (c % 2) return [" ", DIM];
      const roll = hash(seed, r, c) % 10;
      return shade(roll < 5 ? 1 : roll < 8 ? 2 : 3);
    }
    case "uptime": {
      // A bar a column, every row of it the same day's: up, degraded or down, as the uptime strip has them.
      if (c % 2) return [" ", DIM];
      const roll = hash(seed, c) % 20;
      return roll < 16 ? shade(top - 1) : roll < 19 ? shade(1) : ["·", INK];
    }
    case "dots":
      return (c + r) % 2 ? [" ", DIM] : hash(seed, r, c) % 9 === 0 ? ["•", INK] : ["·", DIM];
    case "rule":
      return [style.rows > 1 && r !== Math.floor(style.rows / 2) ? "═" : "─", DIM];
  }
}

/** The band drawn, and the row (of the rows returned) its heading is on. */
export interface Band { rows: string[]; textRow: number }

/** How far each row's run goes, as a share of the room it fades across: the rows differ, as the sketches' do. */
const RUNS = [[0.75], [0.8, 0.55], [0.85, 0.6, 0.35]] as const;

/**
 * The band `W` wide, the heading `label` (drawn already: its colour, its disclosure) on its row; a rule has none.
 * Null when it doesn't fit (the narrow tier, or a heading that leaves the band under 8 columns of glyphs): the caller draws the
 * heading or rule as written. `seed`: what the pattern is drawn from (the heading's text), so it stays put.
 */
export function drawBand(style: HeadingStyle, W: number, level: number, label: string | null, seed: string): Band | null {
  if (tier(W) === "narrow") return null;
  const m = style.margin, bw = W - 2 * m.cols, rows = Math.max(1, Math.min(3, style.rows));
  const lw = label === null ? 0 : vwidth(label);
  const box = label === null ? 0 : lw + 2 * style.padding.cols;
  if (bw < 16 || box > bw - 8) return null;
  const textRow = style.row === "top" ? 0 : style.row === "bottom" ? rows - 1 : Math.floor((rows - 1) / 2);
  const x0 = label === null ? 0 : style.align === "center" ? Math.floor((bw - box) / 2) : style.align === "right" ? bw - box : 0;
  const s = seedOf(seed);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const clear = label !== null && Math.abs(r - textRow) <= style.padding.rows;
    const run = RUNS[rows - 1]![r]! * (style.align === "center" ? bw / 2 : bw);
    let line = " ".repeat(m.cols), ink = -1;
    for (let c = 0; c < bw; c++) {
      if (clear && c >= x0 && c < x0 + box) {
        if (r === textRow && c === x0) { line += " ".repeat(style.padding.cols) + label + RESET + " ".repeat(style.padding.cols); ink = -1; c = x0 + box - 1; }
        else line += " ";
        continue;
      }
      // The edge a row fades from: both for a centred band, the far side from the heading otherwise (a left heading's
      // band is heaviest at the left edge, as the tab sketch).
      const d = style.align === "center" ? Math.min(c, bw - 1 - c) : style.align === "right" ? bw - 1 - c : c;
      const [g, colour] = cell(style, r, c, d / Math.max(1, run), level, s);
      if (colour !== ink) { line += fg(colour); ink = colour; }
      line += g;
    }
    out.push(line + RESET);
  }
  return withMargin(m, out, textRow);
}

/** `rows` with the margin's blank rows above and below, and `textRow` moved down by those above: a band's, or a narrow tier's plain heading. */
export function withMargin(m: BandMargin, rows: string[], textRow: number): Band {
  return { rows: [...Array(m.top).fill(""), ...rows, ...Array(m.bottom).fill("")], textRow: m.top + textRow };
}

/** A rule's track (`--- [rule::fade]`): the style's band with no heading in it, or null when narrow. */
export function drawTrack(style: HeadingStyle, W: number, seed = "rule"): string[] | null {
  return drawBand(style, W, 2, null, seed)?.rows ?? null;
}

/** The heading's letters as the style draws them: as written, in capitals, or spaced capitals (a plain text only). */
export function bandLetters(text: string, letters: BandLetters): string {
  if (letters === "plain") return text;
  const upper = text.toUpperCase();
  // Spaced only when nothing in it is a mark or a link's tag: a space between those would split them.
  if (letters === "upper" || stripMarks(text) !== text || /[\u{100000}-\u{10FFFD}]/u.test(text)) return upper;
  return [...upper].join(" ");
}
