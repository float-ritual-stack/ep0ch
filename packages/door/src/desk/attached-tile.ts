// An attachment in a tile of its own (a reader's comment, Sources, list or edit preview; a facets tile's Matches): the
// attachment stays owned by the tile it belongs to, so moving it into a tile never creates a second session, inspector
// or list. One owner path (PIE-1448): every owner answers `AttachedOwner`, and this tile only lends it its room, its
// side chips and its keys. It never asks what kind of tile its owner is (test/attached-owner.test.ts holds it to that).
import { fg, C, pad, RESET, width } from "../style";
import type { Key } from "../term";
import type { TileKind } from "./tile-kinds";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { RowPress } from "../scroll";

/** What an attached tile draws: a reader's comment, Sources, list or edit preview, a facets tile's Matches. */
export type Attachment = "comment" | "sources" | "list-preview" | "edit-preview" | "matches";
export type AttachedSide = "left" | "right" | "up" | "down";

/** A tile that owns attachments: it draws each, takes its keys and clicks, names it, and moves its tile round itself. */
export interface AttachedOwner {
  /** The attachment drawn `w` × `h`; null when there is none to draw any more (a comment sent): its tile closes. */
  attachedView(a: Attachment, w: number, h: number, focused: boolean, desk: DeskApi): PaneView | null;
  attachedKey(a: Attachment, k: Key, desk: DeskApi): boolean;
  attachedMouse(a: Attachment, k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean;
  attachedTitle(a: Attachment, source: string): string;
  attachedHint(a: Attachment): string;
  /** Its tile to that side of its owner (a side chip's click). */
  attachedSide(a: Attachment, side: AttachedSide, desk: DeskApi): void;
  /** The words before the side chips (`the note's`). */
  attachedSideWords(a: Attachment): string;
  /** The tile drawing it now (an owner whose selection follows its tile's wires keeps it); null when it goes. */
  attachedTileIs?(a: Attachment, tile: Pane | null): void;
}
export const isAttachedOwner = (p: Pane | undefined): p is Pane & AttachedOwner => typeof (p as Partial<AttachedOwner> | undefined)?.attachedView === "function";

export const COMMENT_TILE_KIND = "comment";

/** Its side chips: where the tile goes round its owner. */
const SIDES: [AttachedSide, string][] = [["left", "◄ left"], ["right", "right ►"], ["up", "▲ above"], ["down", "below ▼"]];

export class AttachedTilePane implements Pane {
  get kind() { return this.attachment; }
  /** Closing it was asked for once (its attachment ended): the desk closes it after this frame. */
  private closing = false;
  private lastRow = -1;
  /** The owner as of the last frame: its title and hint are its. */
  private owner: (Pane & AttachedOwner) | null = null;
  /** `source`: the tile whose attachment it draws, by name. */
  constructor(public source: string, readonly attachment: Attachment = "comment") {}

  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  title() { return this.owner?.attachedTitle(this.attachment, this.source) ?? `${this.attachment} · ${this.source}`; }
  hint() { return this.owner?.attachedHint(this.attachment) ?? ""; }
  /** The last row's side chips as drawn: a click puts the tile on that side of its owner. */
  private sides: { from: number; to: number; side: AttachedSide }[] = [];
  spec() { return { source: `tile:${this.source}` }; }

  private owned(desk: DeskApi): (Pane & AttachedOwner) | null {
    const p = desk.paneNamed?.(this.source);
    return isAttachedOwner(p) ? p : null;
  }

  /** The attachment above its last row, the side chips on it. */
  private drawn(w: number, h: number, focused: boolean, desk: DeskApi): PaneView | null {
    const o = this.owned(desk);
    if (o !== this.owner) { this.owner?.attachedTileIs?.(this.attachment, null); this.owner = o; }
    o?.attachedTileIs?.(this.attachment, this);
    const v = o?.attachedView(this.attachment, w, Math.max(1, h - 1), focused, desk) ?? null;
    if (!v || h < 2) return v;
    return { ...v, lines: [...v.lines.slice(0, Math.max(1, h - 1)), this.sideRow(w, o!)] };
  }

  /** The side chips under it: narrow, the arrows alone. */
  private sideRow(w: number, o: AttachedOwner): string {
    this.sides = [];
    const short = w < 48, words = ` ${o.attachedSideWords(this.attachment)} `;
    let row = short ? " " : fg(C.dark) + words, x = short ? 1 : width(words);
    for (const [side, label] of SIDES) {
      const chip = `[${short ? label.replace(/[a-z ]/g, "") : label}]`;
      this.sides.push({ from: x, to: x + chip.length, side });
      row += fg(C.lcyan) + chip + fg(C.dark) + " ";
      x += chip.length + 1;
    }
    return pad(row, w) + RESET;
  }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.lastRow = h - 1;
    const drawn = this.drawn(w, h, focused, desk);
    if (drawn) { this.closing = false; return drawn; }
    // Its attachment ended (a comment sent, put aside or placed back), or its owner went: it closes, unless the
    // attachment is back by the time the close comes round.
    if (!this.closing) { this.closing = true; queueMicrotask(() => { if (this.closing && !this.drawn(w, h, focused, desk)) desk.dismiss?.(this); }); }
    return { lines: [fg(C.dark) + pad(` nothing of ${this.source}'s is attached here`, w) + RESET] };
  }

  key(k: Key, desk: DeskApi): boolean { return !!this.owned(desk)?.attachedKey(this.attachment, k, desk); }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    const o = this.owned(desk);
    if (!o) return false;
    // Its last row: a click on a side puts it there.
    const chip = this.sides.find(c => x >= c.from && x < c.to);
    if (chip && y === this.lastRow) { if (k.action === "up") o.attachedSide(this.attachment, chip.side, desk); return true; }
    return o.attachedMouse(this.attachment, k, x, y, desk, press);
  }
}

/** The comment tile's kind: opened by the desk when a reader's comment goes into a tile (Desk.composerTile). */
export const COMMENT_TILE: TileKind = {
  kind: COMMENT_TILE_KIND, noun: "a comment tile",
  about: "the comment being written in a reader (source=tile:<name>), or its thread list, in a tile of its own in the reader's place beside it (PIE-846): left, right, above or below (comment.place side=), sized by its border; the tiles round them never move, and closing it gives the reader its room back. Opened by comment.place place=tile (ctrl+o), closed when the comment is sent or put back",
  make: s => new AttachedTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader"),
  openArgs: ["source"],
  check: s => (s.source && !/^tile:./.test(s.source) ? "a comment tile's source is tile:<name>, the reader writing it" : null),
  // Typing in it is typing in the reader's comment: the desk's keys don't take it, but ^W and a window key do (the way out).
  takesKeys: () => true, windowKeys: true,
  describe: p => ({ source: `tile:${(p as AttachedTilePane).source}` }),
};

export const SOURCES_TILE: TileKind = {
  kind: "sources", noun: "a sources tile",
  about: "a reader's Sources inspector in its own resizable tile beside the note",
  make: s => new AttachedTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader", "sources"),
  openArgs: ["source"],
  check: COMMENT_TILE.check,
  takesKeys: () => true, windowKeys: true,
  describe: COMMENT_TILE.describe,
};

export const LIST_PREVIEW_TILE: TileKind = {
  kind: "list-preview", noun: "a list children preview",
  about: "the selected list item's children, owned by its reader",
  make: s => new AttachedTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader", "list-preview"),
  openArgs: ["source"],
  check: COMMENT_TILE.check,
  describe: COMMENT_TILE.describe,
};

export const MATCHES_TILE: TileKind = {
  kind: "matches", noun: "a Matches tile", previews: true,
  about: "a facets tile's Matches (PIE-1443: the notes its selection leaves, grouped Pinned, Today, Yesterday, Previous 7 days, then months) in a tile of its own beside it (source=tile:<the facets tile>); its select and open wires say where a pick previews and ⏎ opens. Opened by facets.place place=tile (ctrl+o), closed when Matches goes back",
  make: s => new AttachedTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "facets", "matches"),
  openArgs: ["source"],
  check: s => (s.source && !/^tile:./.test(s.source) ? "a Matches tile's source is tile:<name>, the facets tile it belongs to" : null),
  describe: COMMENT_TILE.describe,
};

export const EDIT_PREVIEW_TILE: TileKind = {
  kind: "edit-preview", noun: "an edit preview tile",
  about: "the unsaved draft's live preview, owned by its reader",
  make: s => new AttachedTilePane(s.source?.slice(5) ?? "reader", "edit-preview"),
  openArgs: ["source"],
  check: COMMENT_TILE.check,
  takesKeys: () => true, windowKeys: true,
  describe: COMMENT_TILE.describe,
};
