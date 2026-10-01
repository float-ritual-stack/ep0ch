// Scrolling, the one way every view does it: a position moved by a number of rows, kept within the content,
// and nothing else moved. The wheel, the keys (j k, PgUp PgDn) and an agent's scroll all come here.
//
// A wheel report scrolls a fixed number of rows, whenever it comes. The terminal already turns a trackpad's
// travel into reports at its own rate (Ghostty: one per cell height of finger travel, and three per notch of
// a mouse wheel), so the door adds no timing of its own: a slow read moves one row per report, evenly, and a
// fast swipe stops when the reports stop.

/**
 * Rows one wheel report scrolls: `EP0CH_SCROLL_ROWS` (a whole number, 1 to 20), 1 by default. 1 moves the
 * text with the fingers on a trackpad and 3 rows a notch in Ghostty, whose mouse wheel sends three reports a
 * notch. A terminal that sends one report a notch (xterm, most Linux terminals) feels slow at 1: set it to 3.
 */
export const SCROLL_ROWS = scrollRows(process.env.EP0CH_SCROLL_ROWS);

/** `EP0CH_SCROLL_ROWS` read: a whole number from 1 to 20, else 1. */
export function scrollRows(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 1;
}

/** Rows a wheel report scrolls, down (1) or up (-1). */
export const wheelRows = (dir: 1 | -1): number => dir * SCROLL_ROWS;

/** `top` moved by `by` rows, kept within 0 to `max` (the last top that still fills the view). */
export function scrolled(top: number, by: number, max = Infinity): number {
  return Math.max(0, Math.min(Math.max(0, max), top + by));
}

/** `top` moved just far enough that row `sel` is in a view of `room` rows. */
export function follow(sel: number, top: number, room: number): number {
  if (sel < top) return sel;
  if (sel >= top + room) return sel - room + 1;
  return top;
}

/**
 * A view of rows with a selected row in it (a thread's replies and comments): the wheel scrolls it, and the
 * selection is brought into view only when it moved (a key, a click), so a repaint never snaps it back.
 */
export class RowView {
  top = 0;
  private max = Infinity;
  private shown: number | null = null;
  scroll(by: number) { this.top = scrolled(this.top, by, this.max); }
  /** The top to draw from, for `total` rows in `room`, with row `sel` selected. */
  place(sel: number | null, total: number, room: number): number {
    if (sel !== null && sel !== this.shown) this.top = follow(sel, this.top, room);
    this.shown = sel;
    this.max = Math.max(0, total - room);
    return (this.top = scrolled(this.top, 0, this.max));
  }
  reset() { this.top = 0; this.shown = null; this.max = Infinity; }
}

/**
 * Whether the frame being painted is one in which only scrolling happened: the door (App) says so while it
 * paints after input that was all wheel reports, with nothing else asking for a paint since the last one.
 * A view may then reuse what it laid out last time and only move it. False everywhere else (tests too).
 */
let scrollFrame = false;
export const onlyScrolled = () => scrollFrame;
/** The door, around a paint: `only` while it paints a frame in which only scrolling happened. */
export function paintingScroll(only: boolean) { scrollFrame = only; }
