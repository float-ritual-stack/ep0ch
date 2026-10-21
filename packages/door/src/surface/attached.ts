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
export function drawAttachedFloat(lines: string[], w: number, h: number, rect: FloatRect, title: string, focused: boolean, look: StyleValues | undefined, body: (canvas: Canvas, dx: number, dy: number) => void, sizable = true, frame: FloatRect = { col: 0, row: 0, cols: w, rows: h }, base?: FloatRect) {
  const canvas = new Canvas(frame.cols, frame.rows);
  lines.forEach((line, y) => canvas.text((base?.col ?? 0) - frame.col, y + (base?.row ?? 0) - frame.row, line, base?.cols ?? w));
  canvas.float({ ...rect, col: rect.col - frame.col, row: rect.row - frame.row }, title, "", () => body(canvas, -frame.col, -frame.row), focused, look, sizable ? { ...LINE_BOX, br: "◢" } : LINE_BOX);
  return canvas.lines();
}

export interface AttachedLayout {
  frame?: FloatRect;
  min?: { cols: number; rows: number };
  moved?: FloatRect | null;
  passage?: [number, number] | null;
  from?: number;
  to?: number;
  col?: number;
  split?: AttachedSplit;
  rows?: number;
}

/** Every attachment's geometry, including the room offered to its content before an overlay is positioned. */
export function attachedRect(place: AttachedPlace, w: number, h: number, options: AttachedLayout = {}, content?: (cols: number, rows: number, fill: boolean) => { cols: number; rows: number }): FloatRect {
  if (options.frame && (place === "floating" || place === "popup")) {
    const { frame, ...rest } = options;
    const rect = attachedRect(place, frame.cols, frame.rows, { ...rest,
      moved: rest.moved && { ...rest.moved, col: rest.moved.col - frame.col, row: rest.moved.row - frame.row },
      col: rest.col === undefined ? undefined : rest.col - frame.col,
      from: (rest.from ?? 0) - frame.row, to: (rest.to ?? h) - frame.row,
      passage: rest.passage && [rest.passage[0] - frame.row, rest.passage[1] - frame.row],
    }, content);
    return { ...rect, col: rect.col + frame.col, row: rect.row + frame.row };
  }
  const { from = 0, to = h, col, moved, min = { cols: 24, rows: 6 } } = options;
  if (place === "tile") return { row: 0, col: 0, cols: w, rows: h };
  if (place === "inline") return { row: from, col: col ?? 0, cols: w, rows: Math.max(min.rows, h) };
  if (place === "split") {
    const { beside, size } = splitSize(w, h, options.split ?? {});
    const rows = options.rows === undefined ? size : Math.max(1, Math.min(h - 1, options.rows));
    return beside ? { row: 0, col: w - size, cols: size, rows: h } : { row: h - rows, col: 0, cols: w, rows };
  }
  const room = place === "floating" && moved ? clampFloat(moved, w, h) : clampFloat({
    cols: Math.max(min.cols, w - 2), rows: Math.max(min.rows, place === "popup" && content ? h - 2 : Math.floor(h * .6)), row: 0, col: 0,
  }, w, h);
  const size = content?.(room.cols, room.rows, place === "floating" && !!moved) ?? room;
  if (place === "floating" && moved) return room;
  return clampFloat({ ...size, col: place === "popup" ? Math.floor((w - size.cols) / 2) : col ?? w - size.cols - 2,
    row: place === "popup" ? Math.floor((h - size.rows) / 2) : floatRow(options.passage ?? null, size.rows, from, to) }, w, h);
}

export type AttachedSide = "left" | "right" | "up" | "down";
export interface AttachedTileHost {
  open(on: boolean, side?: AttachedSide): Promise<unknown>;
  exists?(): boolean;
  changed(why?: string): void;
}

/** A tile follows its attachment through opening, moving, closing and a close by hand. */
export class AttachedTile {
  private owner: { place: AttachedPlace } | null = null;
  private opened = false;
  private opening: Promise<void> | null = null;

  sync(owner: { place: AttachedPlace } | null, host?: AttachedTileHost) {
    if (owner?.place === "tile" && !host) owner.place = "split";
    if (owner === this.owner && this.opened && host?.exists && !host.exists()) {
      owner!.place = "split"; this.owner = null; this.opened = false;
      host.changed("the attachment is back in the reader (split) · ctrl+o moves it");
    }
    if (owner?.place !== "tile") {
      if (this.owner) void this.close(host);
      return;
    }
    if (this.owner === owner) return;
    this.owner = owner;
    queueMicrotask(() => { if (this.owner === owner) void this.open(owner, host!); });
  }

  private async open(owner: { place: AttachedPlace }, host: AttachedTileHost, side?: AttachedSide) {
    const opening = host.open(true, side).then(() => { if (this.owner === owner) this.opened = true; }, e => {
      if (this.owner === owner) { this.owner = null; this.opened = false; owner.place = "split"; }
      host.changed(`the attachment stays in the reader: ${e instanceof Error ? e.message : String(e)}`);
    });
    this.opening = opening;
    await opening;
    if (this.opening === opening) this.opening = null;
  }

  async close(host?: AttachedTileHost) {
    this.owner = null; this.opened = false;
    await this.opening;
    await host?.open(false);
  }

  async place(owner: { place: AttachedPlace }, place: AttachedPlace, host?: AttachedTileHost, side?: AttachedSide) {
    const was = owner.place;
    owner.place = place;
    if (place !== "tile") { if (was === "tile") await this.close(host); return; }
    // Set the owner before asking the host: rendering during that request must not open another tile.
    if (this.owner === owner && (this.opened || this.opening) && side === undefined) return;
    this.owner = owner;
    await this.open(owner, host!, side);
  }
}

export type FloatMove = { dx?: number; dy?: number; col?: number; row?: number; dcols?: number; drows?: number; cols?: number; rows?: number; reset?: boolean };
export function moveFloat(was: FloatRect, a: FloatMove, room: { w: number; h: number; col?: number; row?: number }): FloatRect {
  if (room.col || room.row) {
    const col = room.col ?? 0, row = room.row ?? 0;
    const next = moveFloat({ ...was, col: was.col - col, row: was.row - row }, { ...a,
      col: a.col === undefined ? undefined : a.col - col, row: a.row === undefined ? undefined : a.row - row,
    }, { w: room.w, h: room.h });
    return { ...next, col: next.col + col, row: next.row + row };
  }
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

/** Entries are in paint order: the last covering frame owns every pointer event, including its border. */
export function attachedAt<T>(layers: readonly { target: T; rect: FloatRect | null }[], x: number, y: number): T | null {
  return layers.findLast(({ rect: r }) => r && x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows)?.target ?? null;
}
