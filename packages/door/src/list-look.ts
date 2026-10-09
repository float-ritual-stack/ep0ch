// A list's look (PIE-673): the blank rows, dividers and zebra tint a tile's list draws between and under its items,
// from the look's `list.gap`, `list.divider` and `list.zebra`. One painter every list tile uses (the links tile now; the
// tree, the lanes and the what-changed list next), never a list's own spacing. The rows it adds are drawing: they
// aren't items, a press on one selects nothing, and nothing in them is the list's text.
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { C, fg, pad, RESET } from "./style";
import { paintRange, ZEBRA_BG } from "./surface/selection";

/** One drawn row of a spaced list: an item's, or a row of spacing (a gap or a divider). */
export type ListSlot = { item: number } | { gap: true } | { divider: true };

/**
 * Where `count` items go with the look's spacing: the drawn rows in order, and the row each item is on. `divideBefore`:
 * whether a divider goes above item `i` (every item but the first, or a list's choice: the links tile divides its groups).
 */
export function listSlots(count: number, v: Pick<StyleValues, "list.gap" | "list.divider">, divideBefore: (i: number) => boolean = i => i > 0): { slots: ListSlot[]; at: number[] } {
  const slots: ListSlot[] = [], at: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) for (let g = 0; g < v["list.gap"]; g++) slots.push({ gap: true });
    if (i > 0 && v["list.divider"] !== "none" && divideBefore(i)) slots.push({ divider: true });
    at.push(slots.length);
    slots.push({ item: i });
  }
  return { slots, at };
}

/** A divider row `w` wide: a dim line, or dots. */
export function dividerLine(kind: StyleValues["list.divider"], w: number): string {
  if (kind === "none" || w <= 0) return "";
  return fg(C.dark) + (kind === "dots" ? "· ".repeat(Math.ceil(w / 2)).slice(0, w) : "─".repeat(w)) + RESET;
}

/** Item `i`'s row on the zebra tint when the look has it on and `i` is an odd one (never the selected row: it has its own). */
export function zebraRow(line: string, i: number, w: number, v: Pick<StyleValues, "list.zebra">, selected = false): string {
  return v["list.zebra"] && i % 2 === 1 && !selected ? paintRange(pad(line, w), 0, w, ZEBRA_BG) : line;
}
