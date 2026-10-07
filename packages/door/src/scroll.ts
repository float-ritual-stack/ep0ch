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

/** `v` kept within `a` to `b`. */
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** `top` moved by `by` rows, kept within 0 to `max` (the furthest top: `lastTop` where a view scrolls past its end). */
export function scrolled(top: number, by: number, max = Infinity): number {
  return clamp(top + by, 0, Math.max(0, max));
}

// ── past the end (PIE-622) ──────────────────────────────────────────────────────────────────────────

/**
 * How far a reader or a draft scrolls past its last line: `half` (the last line can come up to the view's middle),
 * `none` (it stops at the bottom edge, as before), or a number of rows. The person's setting (reader.overscroll,
 * kept in the state dir as `reader-overscroll.json`); unset: half.
 */
export type Overscroll = "half" | "none" | number;
let overscrollSetting: Overscroll = "half";
/** `half`, `none` or a whole number of rows (0 to 200, given as a number or its digits); else null. */
export function overscrollOf(v: unknown): Overscroll | null {
  if (v === "half" || v === "none") return v;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 200 ? n : null;
}
/** Use the setting kept from last time (the door's start) or just chosen (reader.overscroll); anything else: half. */
export function useOverscroll(v: unknown) { overscrollSetting = overscrollOf(v) ?? "half"; }
/** The setting in use. */
export const overscroll = (): Overscroll => overscrollSetting;
/** Blank rows a view of `room` rows may show under its last line: half the view, none, or the rows asked for (always leaving the last line in view). */
export function overscrollRows(room: number, o: Overscroll = overscrollSetting): number {
  const r = Math.max(0, room - 1);
  return Math.min(r, o === "none" ? 0 : o === "half" ? Math.floor(room / 2) : o);
}
/** The top at which the last of `total` rows sits on the bottom edge of a view of `room` rows (End's first stop). */
export const endTop = (total: number, room: number) => Math.max(0, total - Math.max(1, room));
/**
 * The furthest a view of `room` rows over `total` rows scrolls: until the last row is `overscrollRows` above the
 * bottom edge (the view's middle, at half). A short note whose last line is already that high doesn't scroll.
 */
export const lastTop = (total: number, room: number) => Math.max(0, Math.min(total - 1, total - Math.max(1, room) + overscrollRows(room)));
/** Rows a draft keeps between its cursor and the view's top or bottom edge (scrolloff): 3, less in a short view. */
export const scrollOff = (room: number) => Math.min(3, Math.floor(room / 4));

/** `top` moved just far enough that row `sel` is in a view of `room` rows. */
export function follow(sel: number, top: number, room: number): number {
  if (sel < top) return sel;
  if (sel >= top + room) return sel - room + 1;
  return top;
}

// ── the sideways wheel ──────────────────────────────────────────────────────────────────────────────

/** A sideways report this long after the last starts a new swipe. */
export const SWIPE_GAP_MS = 150;
/** Within one swipe, every this many reports after the first take another step. */
export const SWIPE_REPORTS = 8;

/**
 * Sideways wheel reports (`wheel-left`, `wheel-right`: a trackpad's swipe, a tilting wheel) as steps where the content
 * is horizontal (the river's columns, the board's lanes). A trackpad sends a burst of reports for one swipe: the first
 * report steps, then one more step every `SWIPE_REPORTS` reports in the same direction, so one swipe moves one column
 * or two, never past five. A pause or a turn starts a new swipe.
 */
export class SidewaysWheel {
  private last = -Infinity;
  private dir: 1 | -1 = 1;
  private run = 0;
  step(dir: 1 | -1, now = Date.now()): 1 | -1 | 0 {
    const fresh = now - this.last > SWIPE_GAP_MS || dir !== this.dir;
    this.last = now; this.dir = dir;
    if (fresh) { this.run = 0; return dir; }
    if (++this.run >= SWIPE_REPORTS) { this.run = 0; return dir; }
    return 0;
  }
}
/** A sideways wheel report's direction (left -1, right 1), or null for any other mouse event. */
export const sideways = (k: { kind: string; action?: string }): 1 | -1 | null => (k.kind !== "mouse" ? null : k.action === "wheel-left" ? -1 : k.action === "wheel-right" ? 1 : null);

// ── a press on a list's row: the keyboard's escalation, by mouse ──────────────────────────────────────

/** Two presses on the same row within this long are a double click: ⏎. */
export const DOUBLE_MS = 400;
/**
 * The SGR mouse report's modifier bits (`ESC [ < b ; x ; y M`): shift 4, alt (meta, Option) 8, ctrl 16. Which reach
 * the door is the terminal's choice, not the door's: the SGR report has no bit for Cmd, so Cmd-click never arrives;
 * terminals keep shift-click for their own selection while a program has the mouse; Option- and ctrl-click arrive
 * only where the terminal doesn't use them itself (a rectangle selection, a right click). The middle button is the
 * one that always arrives, so it opens fresh too, as a middle click opens a link in a new tab.
 */
export const MOUSE_SHIFT = 4, MOUSE_ALT = 8, MOUSE_CTRL = 16;
/** The SGR report's middle button (`button` in a mouse key: 0 left, 1 middle, 2 right). */
export const MOUSE_MIDDLE = 1;
/** The right button: a tile's menu (tile.menu), where the tile doesn't take it itself. */
export const MOUSE_RIGHT = 2;

/**
 * What a press on a list's row asks for, the mouse's steps matching the keyboard's: `focus` (the press gave the
 * list the keys: the row is selected, nothing else), `select` (as j k: selected and previewed), `open` (a double
 * click: ⏎), `fresh` (an alt- or ctrl-click: alt+⏎). Every list's rows answer a press with these.
 */
export type RowGesture = "focus" | "select" | "open" | "fresh";
/** A press as the list is told it: its modifier bits, and whether it gave the list's tile the keys. */
export interface RowPress { mods?: number; button?: number; focusing?: boolean; now?: number }

/** The presses on a list's rows, so a second one on the same row soon after is a double click. */
export class RowPresses {
  private last: { row: number; at: number } | null = null;
  /**
   * A press on row `row`: what it asks for. A double click opens even when its first press gave the list the keys;
   * a single press that did only selects, whatever modifier it carried (a first click never navigates).
   */
  press(row: number, p: RowPress = {}): RowGesture {
    const now = p.now ?? Date.now(), l = this.last;
    const twice = !!l && l.row === row && now - l.at < DOUBLE_MS;
    // A third press starts afresh: a triple click is a double click and a single one, never two opens.
    this.last = twice ? null : { row, at: now };
    if (twice) return "open";
    if (p.focusing) return "focus";
    return (p.mods ?? 0) & (MOUSE_ALT | MOUSE_CTRL) || p.button === MOUSE_MIDDLE ? "fresh" : "select";
  }
  /** The list changed under the pointer (another note's rows): the next press starts afresh. */
  forget() { this.last = null; }
}

/**
 * A list's cursor and scroll (a thread's replies, the welcome's notes, a lane's cards, a picker's choices): the wheel
 * scrolls it, and the selection is brought into view only when it moved (a key, a click, an agent's pick) or the
 * view's height changed, so a repaint never snaps it back. A selection several rows tall (a card, a thread) names
 * its rows as `[first, last]`: the last comes into view, then the first. `press` is what a press on one of its rows
 * asks for (`RowPresses`): every list's mouse escalates as its keys do.
 */
export class RowView {
  top = 0;
  private max = Infinity;
  private shown: number | null = null;
  private readonly presses = new RowPresses();
  /** The rows it was last placed in. */
  room = -1;
  /** A press on row `row` (an index into the list, not a screen row): select, open, open fresh, or only focus. */
  press(row: number, p: RowPress = {}): RowGesture { return this.presses.press(row, p); }
  scroll(by: number) { this.top = scrolled(this.top, by, this.max); }
  /** The selection comes into view at the next `place` even if it didn't move (j at the end of a list). */
  reveal() { this.shown = null; }
  /** The top to draw from, for `total` rows in `room`, with row `sel` selected (spanning `rows`). */
  place(sel: number | null, total: number, room: number, rows: readonly [number, number] | null = sel === null ? null : [sel, sel]): number {
    if (sel !== null && rows && (sel !== this.shown || room !== this.room)) this.top = follow(rows[0], follow(rows[1], this.top, room), room);
    this.shown = sel;
    this.room = room;
    this.max = Math.max(0, total - room);
    return (this.top = scrolled(this.top, 0, this.max));
  }
  /** The furthest it scrolls, as last placed. */
  get maxTop() { return this.max; }
  reset() { this.top = 0; this.shown = null; this.max = Infinity; this.room = -1; this.presses.forget(); }
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
