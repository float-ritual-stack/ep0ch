import { Canvas, LINE_BOX } from "../canvas";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
export const ATTACHED_PLACES = ["inline", "floating", "split", "popup", "tile"] as const;
export type AttachedPlace = (typeof ATTACHED_PLACES)[number];

/** A placement's name, or null when `v` isn't one. */
export const attachedPlaceOf = (v: unknown): AttachedPlace | null => (typeof v === "string" && (ATTACHED_PLACES as readonly string[]).includes(v) ? (v as AttachedPlace) : null);

/** The placement after `p`, round again (ctrl+o). */
export const nextPlace = (p: AttachedPlace, tiles = true): AttachedPlace => {
  const next = ATTACHED_PLACES[(ATTACHED_PLACES.indexOf(p) + 1) % ATTACHED_PLACES.length]!;
  // A reader with no tiles round it has no tile to put it in: round to the next.
  return next === "tile" && !tiles ? nextPlace(next, tiles) : next;
};

/** A reader at least this wide splits side by side; a narrower one puts the composer under the note. */
export const SPLIT_SIDE_MIN = 110;
/** A reader smaller than this has no room to share: its split composer is drawn as a popup until it grows. */
export const SPLIT_MIN_W = 30, SPLIT_MIN_H = 12;

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

/** Where a floating composer sits, in the reader's cells: its top row, left column, width and height (PIE-785). */
export interface FloatRect { row: number; col: number; cols: number; rows: number }
/** The smallest a floating composer is sized to: its frame, title, status and two rows of text. */
export const FLOAT_MIN_COLS = 24, FLOAT_MIN_ROWS = 6;

/**
 * What a press at `x`, `y` on a floating composer's frame starts (PIE-785): `move` on its top edge (the grip), `size` on
 * its ◢ corner, its right edge or its bottom edge (`cols`, `rows`: which of them it sizes), or null inside it and off it.
 */
export function frameZone(r: FloatRect, x: number, y: number): { kind: "move" } | { kind: "size"; cols: boolean; rows: boolean } | null {
  const right = r.col + r.cols - 1, bottom = r.row + r.rows - 1;
  if (x < r.col || x > right || y < r.row || y > bottom) return null;
  if (y === r.row) return { kind: "move" };
  const cols = x === right, rows = y === bottom;
  return cols || rows ? { kind: "size", cols, rows } : null;
}

/** `r` kept in a reader `w` × `h` cells: never smaller than FLOAT_MIN_*, never larger than the reader, never off it. */
export function clampFloat(r: FloatRect, w: number, h: number): FloatRect {
  const cols = Math.max(Math.min(FLOAT_MIN_COLS, w), Math.min(Math.round(r.cols), w));
  const rows = Math.max(Math.min(FLOAT_MIN_ROWS, h), Math.min(Math.round(r.rows), h));
  return { cols, rows, col: Math.max(0, Math.min(Math.round(r.col), w - cols)), row: Math.max(0, Math.min(Math.round(r.row), h - rows)) };
}

/** One floating frame for reader attachments; the caller supplies its content. */
export function drawAttachedFloat(lines: string[], w: number, h: number, rect: FloatRect, title: string, focused: boolean, look: StyleValues | undefined, body: (canvas: Canvas) => void, sizable = true) {
  const canvas = new Canvas(w, h);
  lines.forEach((line, y) => canvas.text(0, y, line, w));
  canvas.float(rect, title, "", () => body(canvas), focused, look, sizable ? { ...LINE_BOX, br: "◢" } : LINE_BOX);
  return canvas.lines();
}

/** Both popup and floating placements stay within the reader that owns them. */
export function attachedRect(place: "floating" | "popup", w: number, h: number, cols: number, rows: number, passage: [number, number] | null, from: number, to: number, col: number, moved?: FloatRect | null): FloatRect {
  if (place === "floating" && moved) return clampFloat(moved, w, h);
  return clampFloat({ cols, rows, col: place === "popup" ? Math.floor((w - cols) / 2) : col,
    row: place === "popup" ? Math.floor((h - rows) / 2) : floatRow(passage, rows, from, to) }, w, h);
}

export type FloatMove = { dx?: number; dy?: number; col?: number; row?: number; dcols?: number; drows?: number; cols?: number; rows?: number; reset?: boolean };
export function moveFloat(was: FloatRect, a: FloatMove, room: { w: number; h: number }): FloatRect {
  const row = a.row ?? was.row + (a.dy ?? 0), col = a.col ?? was.col + (a.dx ?? 0);
  const cols = a.cols ?? was.cols + (a.dcols ?? 0), rows = a.rows ?? was.rows + (a.drows ?? 0);
  return clampFloat({ row, col,
    cols: cols !== was.cols ? Math.min(cols, Math.max(0, room.w - col)) : cols,
    rows: rows !== was.rows ? Math.min(rows, Math.max(0, room.h - row)) : rows,
  }, room.w, room.h);
}

export interface AttachedSplit { direction?: "right" | "down"; share?: number }
export function splitSize(w: number, h: number, split: AttachedSplit) {
  const beside = (split.direction ? split.direction === "right" : w >= SPLIT_SIDE_MIN);
  return beside ? { beside, size: Math.max(12, Math.min(w - 12, split.share === undefined ? Math.max(40, Math.min(72, Math.floor(w * .4))) : Math.floor(w * split.share))) }
    : { beside, size: Math.max(1, Math.min(h - 1, Math.max(8, Math.floor(h * (split.share ?? .45))))) };
}
