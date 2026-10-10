// Where a comment is written (PIE-770): the composer for a comment, a question, an explain or a reply sits where the
// person is reading, never a screen of its own. Four placements, one editor:
//   inline    a box under the passage, as rows of the note's body: the text around it still reads and scrolls;
//   floating  a box over the note, beside the passage (under it when it fits, else over it);
//   split     the reader's own rect shared: the note on the left (on top when narrow), the composer beside it;
//   popup     a box in the middle of the reader, the passage quoted in it.
// The default is the person's setting (`composer.place`, kept in the state dir like reader.overscroll); ctrl+o, a
// click on the box's place chip or `comment.place` switches the one being written. Whatever the placement, the text
// is a Draft drawn by renderEditor (the one edit control): mouse select, undo, paste, `((` completion, the preview.
import type { Draft } from "../edit";
import { scrollOff } from "../scroll";
import { C, fg, headOf, pad, RESET, tailFrom, width } from "../style";
import { COMPLETION_ROWS, completerOf, completionOf } from "./completer";
import { renderEditor, type EditFrame } from "./editor";

export const COMPOSER_PLACES = ["inline", "floating", "split", "popup"] as const;
export type ComposerPlace = (typeof COMPOSER_PLACES)[number];

let setting: ComposerPlace = "inline";
/** A placement's name, or null when `v` isn't one. */
export const composerPlaceOf = (v: unknown): ComposerPlace | null => (typeof v === "string" && (COMPOSER_PLACES as readonly string[]).includes(v) ? (v as ComposerPlace) : null);
/** Use the placement kept from last time (the door's start) or just chosen (composer.place); anything else: inline. */
export function useComposerPlace(v: unknown) { setting = composerPlaceOf(v) ?? "inline"; }
/** Where a new composer opens. */
export const composerPlace = (): ComposerPlace => setting;
/** The placement after `p`, round again (ctrl+o). */
export const nextPlace = (p: ComposerPlace): ComposerPlace => COMPOSER_PLACES[(COMPOSER_PLACES.indexOf(p) + 1) % COMPOSER_PLACES.length]!;

/** The most rows of text a box grows to before its text scrolls (the cursor's row kept in view). */
export const COMPOSER_TEXT_ROWS = 10;
/** A reader at least this wide splits side by side; a narrower one puts the composer under the note. */
export const SPLIT_SIDE_MIN = 110;

/** A composer drawn in a box: its rows, and where its text, controls and completion popup are in the box's cells. */
export interface ComposerBox {
  lines: string[];
  frame: NonNullable<Draft["frame"]> | null;
  popup: { row: number; items: (number | null)[] } | null;
  width: number;
}

/**
 * The composer in a box `W` cells wide: a frame line, renderEditor's rows (title with the keys and controls, status,
 * the context the placement wants, the text) and the closing line. Its height follows the text, from two rows up to
 * COMPOSER_TEXT_ROWS (and the completion popup's, the preview's), within `rows`; `fill` takes all of `rows` (split).
 */
export function composerBox(d: Draft, f: EditFrame, W: number, rows: number, fill = false): ComposerBox {
  const iw = Math.max(8, W - 2);
  const top = 1 + f.status.length + (f.by ? 1 : 0) + (f.context?.length ?? 0) + 1;
  const textRows = Math.max(1, d.layout(Math.max(4, iw - 2)).length);
  // Room for every row of text with the cursor's scroll-off below the last, so the view never scrolls while it fits.
  let room = Math.max(2, textRows + 1);
  while (room < COMPOSER_TEXT_ROWS && textRows - 1 + scrollOff(room) >= room) room++;
  room = Math.min(room, COMPOSER_TEXT_ROWS);
  if (completionOf(d)) room += COMPLETION_ROWS;
  const want = top + (d.preview && f.preview ? Math.max(3, room) * 2 : room);
  const h = Math.max(top + 1, fill ? rows - 2 : Math.min(want, rows - 2));
  const body = renderEditor(d, f, iw, h);
  // The rows under the text stay the box's, a place to keep writing.
  while (body.length < h) body.push("");
  const frame = d.frame;
  const c = completerOf(d);
  const edge = fg(C.yellow);
  const lines = [
    edge + "┌" + "─".repeat(iw) + "┐" + RESET,
    ...body.map(l => edge + "│" + RESET + pad(l, iw) + RESET + edge + "│" + RESET),
    edge + "└" + "─".repeat(iw) + "┘" + RESET,
  ];
  return {
    lines,
    frame: frame && { ...frame, row: frame.row + 1, col: frame.col + 1, controls: frame.controls.map(x => ({ ...x, row: x.row + 1, from: x.from + 1, to: x.to + 1 })) },
    popup: c?.drawn ? { ...c.drawn, row: c.drawn.row + 1 } : null,
    width: iw + 2,
  };
}

/**
 * The box's text and controls placed at `row`, `col` of the reader's cells, so a click, a press or a drag there
 * reaches the draft (editorClick) and a click on a candidate its completion (Completer.click).
 */
export function placeBox(d: Draft, box: ComposerBox, row: number, col: number) {
  const f = box.frame;
  d.frame = f && { ...f, row: f.row + row, col: f.col + col, controls: f.controls.map(x => ({ ...x, row: x.row + row, from: x.from + col, to: x.to + col })) };
  const c = completerOf(d);
  if (c) c.drawn = box.popup && { ...box.popup, row: box.popup.row + row };
}

/** `box`'s rows laid over `lines` (each `w` cells) from `row`, `col`: what was under it is hidden, the rest stays. */
export function overlayBox(lines: string[], box: readonly string[], row: number, col: number, w: number) {
  box.forEach((b, i) => {
    const r = row + i;
    if (r < 0) return;
    while (lines.length <= r) lines.push("");
    const base = pad(lines[r]!, w);
    lines[r] = headOf(base, col) + RESET + b + RESET + tailFrom(base, col + width(b));
  });
}

/**
 * Where a floating box `h` rows tall goes in a view of rows [`from`, `to`): under the passage's rows [`a`, `b`)
 * when it fits there, else over them, else as low as it fits (a passage scrolled away: the view's bottom).
 */
export function floatRow(passage: [number, number] | null, h: number, from: number, to: number): number {
  const low = Math.max(from, to - h);
  if (!passage) return low;
  const [a, b] = passage;
  if (b >= from && b + h <= to) return b;
  if (a - h >= from && a <= to) return a - h;
  return Math.max(from, Math.min(low, b));
}
