// The attachment stays owned by its reader, so moving it into a tile never creates a second session or inspector.
import { fg, C, pad, RESET, width } from "../style";
import { USER } from "../socket";
import type { Key } from "../term";
import type { TileKind } from "./tile-kinds";
import type { SurfaceHost } from "../surface/note";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "./panes";

export const COMMENT_TILE_KIND = "comment";

type Side = "left" | "right" | "up" | "down";
/** Its side chips: where the tile goes round its note. */
const SIDES: [Side, string][] = [["left", "◄ left"], ["right", "right ►"], ["up", "▲ above"], ["down", "below ▼"]];

export class AttachedTilePane implements Pane {
  get kind() { return this.attachment; }
  /** Closing it was asked for once (its comment ended): the desk closes it after this frame. */
  private closing = false;
  private lastRow = -1;
  /** `source`: the reader whose comment it draws, by name. */
  constructor(public source: string, readonly attachment: "comment" | "sources" | "list-preview" | "edit-preview" = "comment") {}

  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  title() { if (this.attachment === "edit-preview") return `edit preview · ${this.source}`; if (this.attachment === "list-preview") return `list children · ${this.source}`; if (this.attachment === "sources") return `sources · ${this.source}`; return `${this.listing ? "comments" : "comment"} · ${this.source}`; }
  /** It shows the reader's thread list (m), not a comment being written. */
  private listing = false;
  private owner: ReaderPane | null = null;
  hint() { return this.attachment === "list-preview" ? "list children · click placement chip to move · click text to edit" : this.owner?.surface.attachmentHint(this.attachment) ?? ""; }
  /** The last row's side chips as drawn: a click puts the tile on that side of its note. */
  private sides: { from: number; to: number; side: Side }[] = [];
  spec() { return { source: `tile:${this.source}` }; }

  /** The comment (or thread list) above its last row, the side chips on it. */
  private drawn(w: number, h: number, desk: DeskApi): PaneView | null {
    const r = this.reader(desk);
    this.owner = r;
    const v = !r ? null : this.attachment === "edit-preview" ? r.surface.editPreviewTile(w, Math.max(1, h - 1), r.host(desk)) : this.attachment === "list-preview" ? r.surface.listPreviewTile(w, Math.max(1, h - 1), r.host(desk)) : this.attachment === "sources" ? r.surface.sourcesTile(w, Math.max(1, h - 1)) : r.surface.composerTile(w, Math.max(1, h - 1), r.host(desk));
    if (!v) return null;
    this.sides = [];
    if (h < 2) return v;
    // Narrow, the arrows alone.
    const short = w < 48;
    let row = short ? " " : fg(C.dark) + " the note's ", x = short ? 1 : width(" the note's ");
    for (const [side, label] of SIDES) {
      const chip = `[${short ? label.replace(/[a-z ]/g, "") : label}]`;
      this.sides.push({ from: x, to: x + chip.length, side });
      row += fg(C.lcyan) + chip + fg(C.dark) + " ";
      x += chip.length + 1;
    }
    return { ...v, lines: [...v.lines.slice(0, Math.max(1, h - 1)), pad(row, w) + RESET] };
  }

  private reader(desk: DeskApi): ReaderPane | null {
    const p = desk.paneNamed?.(this.source);
    return p instanceof ReaderPane ? p : null;
  }

  private listHost(r: ReaderPane, desk: DeskApi): SurfaceHost {
    const host = r.host(desk);
    return { ...host, attachment: "list-preview", enterMode: () => {
      // The source owns the edit session, so its reader must also own the keys.
      desk.focusPane?.(r, USER);
      host.enterMode?.();
    } };
  }

  render(w: number, h: number, _focused: boolean, desk: DeskApi): PaneView {
    this.lastRow = h - 1;
    const drawn = this.drawn(w, h, desk);
    this.listing = this.reader(desk)?.surface.session?.mode === "threads";
    if (drawn) { this.closing = false; return drawn; }
    // Its comment was sent, put aside or placed back in the reader (or its reader went): it closes, unless the comment
    // is back in it by the time the close comes round.
    if (!this.closing) { this.closing = true; queueMicrotask(() => { if (this.closing && !this.drawn(w, h, desk)) desk.dismiss?.(this); }); }
    return { lines: [fg(C.dark) + pad(` no comment is being written in ${this.source}`, w) + RESET] };
  }

  key(k: Key, desk: DeskApi): boolean {
    const r = this.reader(desk);
    if (this.attachment === "edit-preview") {
      if (!r) return false;
      const handled = r.surface.editPreviewKey(k, { ...r.host(desk), attachment: "edit-preview" });
      if (!handled) void desk.perform?.("tile.focus", {}, USER, this.source);
      return true;
    }
    if (this.attachment === "list-preview") return !!r && r.surface.key(k, this.listHost(r, desk));
    if (r?.surface.sourcesMode) r.surface.attachedKeys(this.attachment);
    const handled = !!r && (this.attachment === "sources" ? !!r.surface.sourcesMode : !!r.surface.session) && r.surface.key(k, r.host(desk));
    return handled;
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    const r = this.reader(desk);
    if (!r) return false;
    // Its last row: a click on a side puts it there (comment.place side=, as ctrl+g and an arrow do).
    const chip = this.sides.find(c => x >= c.from && x < c.to);
    if (chip && y === this.lastRow) { if (k.action === "up") void r.surface.runKey(this.attachment === "edit-preview" ? "edit.preview.place" : this.attachment === "list-preview" ? "list.preview.place" : this.attachment === "sources" ? "sources.place" : "comment.place", { side: chip.side }, r.host(desk), true); return true; }
    if (this.attachment === "list-preview") {
      const host = this.listHost(r, desk);
      if (k.action === "wheel-up" || k.action === "wheel-down") r.surface.wheel(k.action === "wheel-down" ? 1 : -1, host, { x, y });
      if (k.action === "down") r.surface.press(x, y, host);
      if (k.action === "drag") r.surface.drag(x, y, host);
      if (k.action === "up") r.surface.release(x, y, host);
      return true;
    }
    if (this.attachment === "sources" || this.attachment === "edit-preview") {
      const host = { ...r.host(desk), attachment: this.attachment };
      if (k.action === "wheel-up" || k.action === "wheel-down") { r.surface.wheel(k.action === "wheel-down" ? 1 : -1, host, { x, y }); return true; }
      if (k.action === "down") r.surface.press(x, y, host);
      if (k.action === "drag") r.surface.drag(x, y, host);
      if (k.action === "up") r.surface.release(x, y, host);
      return true;
    }
    return r.surface.composerPointer(k, x, y, r.host(desk));
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

export const EDIT_PREVIEW_TILE: TileKind = {
  kind: "edit-preview", noun: "an edit preview tile",
  about: "the unsaved draft's live preview, owned by its reader",
  make: s => new AttachedTilePane(s.source?.slice(5) ?? "reader", "edit-preview"),
  openArgs: ["source"],
  check: COMMENT_TILE.check,
  takesKeys: () => true, windowKeys: true,
  describe: COMMENT_TILE.describe,
};
