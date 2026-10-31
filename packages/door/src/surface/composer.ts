import { attachedPlaceOf, type AttachedPlace } from "./attached";
// Where a comment is written (PIE-770): the composer for a comment, a question, an explain or a reply sits where the
// person is reading, never a screen of its own. Five placements, one editor:
//   inline    a box under the passage, as rows of the note's body: the text around it still reads and scrolls;
//   floating  a box over the note, beside the passage (under it when it fits, else over it);
//   split     the reader's own rect shared: the note on the left (on top when narrow), the composer beside it;
//   popup     a box in the middle of the reader, the passage quoted in it;
//   tile      a tile of its own in the reader's place, beside the note on any side (PIE-846: a pair, Split.pair, so
//             the tiles round them never move, and closing it gives the note its room back); sized by its border.
//             The thread list goes there too. A reader with no tiles round it (the BBS reader, a river column)
//             draws a comment split.
// The default is the person's setting (`composer.place`, kept in the state dir like reader.overscroll); ctrl+o, a
// click on the box's place chip or `comment.place` switches the one being written. Whatever the placement, the text
// is a Draft drawn by renderEditor (the one edit control): mouse select, undo, paste, `((` completion, the preview.
import type { Draft } from "../edit";
import { scrollOff } from "../scroll";
import { LINE_BOX, stringFrame } from "../canvas";
import { C, fg, headOf, pad, RESET, tailFrom, width } from "../style";
import { completerOf } from "./completer";
import { renderEditor, type EditFrame } from "./editor";

let setting: AttachedPlace = "inline";
/** Use the placement kept from last time (the door's start) or just chosen (composer.place); anything else: inline. */
export function useComposerPlace(v: unknown) { setting = attachedPlaceOf(v) ?? "inline"; }
/** Where a new composer opens. */
export const composerPlace = (): AttachedPlace => setting;
/** The most rows of text a box grows to before its text scrolls (the cursor's row kept in view). */
export const COMPOSER_TEXT_ROWS = 10;
/** A composer drawn in a box: its rows, and where its text, controls and completion popup are in the box's cells. */
export interface ComposerBox {
  lines: string[];
  frame: NonNullable<Draft["frame"]> | null;
  popup: { row: number; col?: number; anchor?: number; items: (number | null)[] } | null;
  width: number;
}

/**
 * The editor rows inside a composer `W` cells wide, reserving one cell around them for its frame.
 * Hit positions include that frame. Its height follows the text, from two rows up to
 * COMPOSER_TEXT_ROWS (and the completion popup's, the preview's), within `rows`; `fill` takes all of `rows` (split).
 */
export function composerBody(d: Draft, frame0: EditFrame, W: number, rows: number, fill = false): ComposerBox {
  const iw = Math.max(4, W - 2), avail = Math.max(2, rows - 2);
  const topOf = (x: EditFrame) => 1 + x.status.length + (x.by ? 1 : 0) + (x.context?.length ?? 0) + 1;
  // A short reader keeps the text's rows: the quote goes first, then the status line.
  let f = frame0;
  if (topOf(f) + 1 > avail) f = { ...f, context: [] };
  if (topOf(f) + 1 > avail) f = { ...f, status: [] };
  const top = topOf(f);
  const textRows = Math.max(1, d.layout(Math.max(4, iw - 2)).length);
  // Room for every row of text with the cursor's scroll-off below the last, so the view never scrolls while it fits.
  let room = Math.max(2, textRows + 1);
  while (room < COMPOSER_TEXT_ROWS && textRows - 1 + scrollOff(room) >= room) room++;
  room = Math.min(room, COMPOSER_TEXT_ROWS);
  const want = top + (d.preview && f.preview ? Math.max(3, room) * 2 : room);
  const h = Math.max(top + 1, fill ? avail : Math.min(want, avail));
  const body = renderEditor(d, f, iw, h);
  // The rows under the text stay the box's, a place to keep writing.
  while (body.length < h) body.push("");
  const frame = d.frame;
  const c = completerOf(d);
  return {
    lines: body,
    frame: frame && { ...frame, row: frame.row + 1, col: frame.col + 1, controls: frame.controls.map(x => ({ ...x, row: x.row + 1, from: x.from + 1, to: x.to + 1 })), ...(frame.links ? { links: frame.links.map(x => ({ ...x, row: x.row + 1, from: x.from + 1, to: x.to + 1 })) } : {}), ...(frame.preview ? { preview: { ...frame.preview, row: frame.preview.row + 1, placements: frame.preview.placements?.map(p => ({ ...p, row: p.row + 1, col: p.col + 1 })) } } : {}) },
    popup: c?.drawn ? { ...c.drawn, row: c.drawn.row + 1, anchor: (c.drawn.anchor ?? 0) + 1, col: (c.drawn.col ?? 0) + 1 } : null,
    width: iw + 2,
  };
}

/** Inline and split composers keep their frame; floating composers give their body to Canvas.float. */
export function composerBox(d: Draft, frame: EditFrame, W: number, rows: number, fill = false): ComposerBox {
  const box = composerBody(d, frame, W, rows, fill), f = stringFrame(box.width, { glyphs: LINE_BOX, ink: fg(C.yellow), pad: 0 });
  return { ...box, lines: [f.top(), ...box.lines.map(f.row), f.bottom()] };
}

/**
 * The box's text and controls placed at `row`, `col` of the reader's cells, so a click, a press or a drag there
 * reaches the draft (editorClick) and a click on a candidate its completion (Completer.click).
 */
export function placeBox(d: Draft, box: ComposerBox, row: number, col: number) {
  const f = box.frame;
  d.frame = f && { ...f, row: f.row + row, col: f.col + col, controls: f.controls.map(x => ({ ...x, row: x.row + row, from: x.from + col, to: x.to + col })), ...(f.links ? { links: f.links.map(x => ({ ...x, row: x.row + row, from: x.from + col, to: x.to + col })) } : {}), ...(f.preview ? { preview: { ...f.preview, row: f.preview.row + row, placements: f.preview.placements?.map(p => ({ ...p, row: p.row + row, col: p.col + col })) } } : {}) };
  const c = completerOf(d);
  if (c) c.drawn = box.popup && { ...box.popup, row: box.popup.row + row, anchor: (box.popup.anchor ?? 0) + col, col: (box.popup.col ?? 0) + col };
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
