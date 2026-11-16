// What a press on a list's row asks for: the one gesture rule every door's lists, trees, tables and lanes answer a
// press with, so the mouse's steps match the keyboard's in each client. The terminal door's `RowPresses`
// (`scroll.ts`) asks `rowGesture`; the native window ports it once (`press.rs`), held row for row by
// `fixtures/core-contract.json` (`presses`).

/** Two presses on the same row within this long are a double click: Enter. */
export const DOUBLE_MS = 400;
/**
 * A press's modifier bits, as the terminal door's SGR mouse report carries them (`ESC [ < b ; x ; y M`): shift 4,
 * alt (meta, Option) 8, ctrl 16. A window says its own modifiers in these bits: Option as alt, and the platform's
 * shortcut modifier (Cmd on a Mac, Ctrl elsewhere) as ctrl.
 */
export const MOUSE_SHIFT = 4, MOUSE_ALT = 8, MOUSE_CTRL = 16;
/** The middle button (`button` in a press: 0 left, 1 middle, 2 right). */
export const MOUSE_MIDDLE = 1;
/** The right button: a tile's menu, where the tile doesn't take it itself. */
export const MOUSE_RIGHT = 2;

/**
 * What a press on a list's row asks for, the mouse's steps matching the keyboard's: `focus` (the press gave the
 * list the keys: the row is selected, nothing else), `select` (as j k: selected and previewed), `open` (a double
 * click: Enter), `fresh` (an alt- or ctrl-click, or the middle button: alt+Enter). Every list's rows answer a press
 * with these.
 */
export type RowGesture = "focus" | "select" | "open" | "fresh";

/** A press as the list is told it: its modifier bits, and whether it gave the list's tile the keys. */
export interface RowPress {
  mods?: number; button?: number; focusing?: boolean; now?: number;
  /** The row pressed is the selected one, the person's own pick: kept as row context; being selected never turns a single click into an open. */
  selected?: boolean;
  /**
   * A second press on the row the last press selected opens it however long after (the power bar, PIE-1405: a click
   * lights a row and shows its preview, the next click on it runs it). Still never the first press on a row.
   */
  untimed?: boolean;
}

/** The last press a list remembers: its row and when, so a second one soon after is a double click. */
export type LastPress<R> = { row: R; at: number } | null;

/** A press that opens fresh whatever came before it: alt or ctrl held, or the middle button. */
export const pressFresh = (p: { mods?: number; button?: number }): boolean => !!((p.mods ?? 0) & (MOUSE_ALT | MOUSE_CTRL)) || p.button === MOUSE_MIDDLE;

/**
 * A press on row `row` at `now`, after `last`: what it asks for, and what the list remembers for the next. A double
 * click opens even when its first press gave the list the keys; any other unmodified press selects, including a
 * press on the selected row. A third press starts afresh: a triple click is a double click and a single one, never
 * two opens.
 */
export function rowGesture<R>(last: LastPress<R>, row: R, p: RowPress & { now: number }): { gesture: RowGesture; last: LastPress<R> } {
  if (pressFresh(p)) return { gesture: "fresh", last: null };
  // An untimed second press counts only on a list that already has the keys: the click that brings them back is a first.
  const twice = !!last && last.row === row && ((!!p.untimed && !p.focusing) || p.now - last.at < DOUBLE_MS);
  if (twice) return { gesture: "open", last: null };
  return { gesture: p.focusing ? "focus" : "select", last: { row, at: p.now } };
}
