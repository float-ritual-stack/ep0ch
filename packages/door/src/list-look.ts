// A list's look (PIE-673, PIE-675): the blank rows, dividers and zebra stripe a list draws between and under its items,
// from the look's `list.gap`, `list.divider` (its style, `list.divider.glyph` and `list.divider.align`) and `list.zebra`
// (its `list.zebra.bg` surface and strength). One painter every list uses (the links tile and a reader's lists now; the
// tree, the lanes and the what-changed list next), never a list's own spacing. The rows it adds are drawing: they aren't
// items, a press on one selects nothing, and nothing in them is the list's text.
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { BUILTIN_HEADING_STYLE_REGISTRY, type HeadingStyle } from "@ep0ch/outline-core/heading-styles";
import { drawTrack } from "./figures/banner";
import { C, fg, glyphWidth, graphemes, pad, RESET } from "./style";
import { paintRange, zebraBg } from "./surface/selection";

/** One drawn row of a spaced list: an item's, or a row of spacing (a gap or a divider). */
export type ListSlot = { item: number } | { gap: true } | { divider: true };

type Spacing = Pick<StyleValues, "list.gap" | "list.divider" | "list.divider.align">;

/**
 * The rows between one item and the next: `list.gap` blank rows, and the divider (when there is one) at the top, centre
 * or bottom of them (`list.divider.align`; centre puts it in the middle, the odd row below).
 */
export function gapSlots(v: Spacing, divided: boolean): ({ gap: true } | { divider: true })[] {
  const gap = Math.max(0, v["list.gap"]);
  const out: ({ gap: true } | { divider: true })[] = Array.from({ length: gap }, () => ({ gap: true }));
  if (!divided || v["list.divider"] === "none") return out;
  const align = v["list.divider.align"] ?? "centre";
  const at = align === "top" ? 0 : align === "bottom" ? gap : Math.floor(gap / 2);
  out.splice(at, 0, { divider: true });
  return out;
}

/**
 * Where `count` items go with the look's spacing: the drawn rows in order, and the row each item is on. `divideBefore`:
 * whether a divider goes above item `i` (every item but the first, or a list's choice: the links tile divides its groups).
 */
export function listSlots(count: number, v: Spacing, divideBefore: (i: number) => boolean = i => i > 0): { slots: ListSlot[]; at: number[] } {
  const slots: ListSlot[] = [], at: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) slots.push(...gapSlots(v, divideBefore(i)));
    at.push(slots.length);
    slots.push({ item: i });
  }
  return { slots, at };
}

/** `unit` repeated to fill exactly `w` cells (a wide glyph that would cross the end gives way to a space). */
function repeat(unit: string, w: number): string {
  let out = "", x = 0;
  const gs = graphemes(unit);
  for (let i = 0; x < w; i++) {
    const g = gs[i % gs.length]!, gw = Math.max(1, glyphWidth(g));
    if (x + gw > w) { out += " ".repeat(w - x); break; }
    out += g; x += gw;
  }
  return out;
}

/**
 * A divider row `w` wide, in the dim ink: a line, dots, dashes, a double line, the `fade` rule's track (PIE-599: the
 * outline's own `fade` style when it restyles it; a plain line where the tile is too narrow for a track), or the
 * look's glyph repeated.
 */
export function dividerLine(v: Pick<StyleValues, "list.divider"> & Partial<Pick<StyleValues, "list.divider.glyph">>, w: number, fade: HeadingStyle | null = BUILTIN_HEADING_STYLE_REGISTRY.style("fade")): string {
  const kind = v["list.divider"];
  if (kind === "none" || w <= 0) return "";
  if (kind === "fade") { const track = fade && drawTrack(fade, w); if (track?.length) return track[Math.floor((track.length - 1) / 2)]!; }
  // A glyph of one's own: one narrow glyph that isn't a line's is spaced out (`✦ ✦ ✦`); a line's, or several, run on.
  const own = v["list.divider.glyph"] || "·", spaced = graphemes(own).length === 1 && glyphWidth(own) === 1 && !/^[\u2500-\u259f]$/u.test(own);
  const unit = kind === "dots" ? "· " : kind === "dashed" ? "╌" : kind === "double" ? "═" : kind === "glyph" ? own + (spaced ? " " : "") : "─";
  return fg(C.dark) + repeat(unit, w) + RESET;
}

/** Item `i`'s row on the zebra stripe when the look has it on and `i` is an odd one (never the selected row: it has its own). */
export function zebraRow(line: string, i: number, w: number, v: Pick<StyleValues, "list.zebra"> & Partial<Pick<StyleValues, "list.zebra.bg" | "list.zebra.strength">>, selected = false): string {
  if (!v["list.zebra"] || i % 2 !== 1 || selected) return line;
  const bg = zebraBg(v["list.zebra.bg"] !== undefined && v["list.zebra.strength"] !== undefined ? v as Pick<StyleValues, "list.zebra.bg" | "list.zebra.strength"> : undefined);
  return bg ? paintRange(pad(line, w), 0, w, bg) : line;
}
