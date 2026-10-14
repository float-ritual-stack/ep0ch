// The comment's own tile (PIE-846): the comment being written in a reader, drawn in a tile beside it so the whole note
// stays in view, as Evan asked ("dock it in a tile to the side"). It's the reader's comment, not a second editor: the
// reader's comment session holds the draft, its keys run the reader's comment keys, its mouse the reader's draft, and the
// edit control (renderEditor) draws it. Being a tile, it moves, sizes, folds and docks to an edge (tile.dock, ^W p) as
// any tile does. It opens when the comment's place is `tile` (comment.place, ctrl+o) and closes when the comment is sent,
// put aside or placed back in the reader. Never saved in a layout: a handover opens it again through the comment's own
// reopen steps (src/session/restore.ts).
import { fg, C, pad, RESET } from "../style";
import type { Key } from "../term";
import type { TileKind } from "./tile-kinds";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "./panes";

export const COMMENT_TILE_KIND = "comment";

export class CommentTilePane implements Pane {
  readonly kind = COMMENT_TILE_KIND;
  /** Closing it was asked for once (its comment ended): the desk closes it after this frame. */
  private closing = false;
  /** `source`: the reader whose comment it draws, by name. */
  constructor(public source: string) {}

  title() { return `comment · ${this.source}`; }
  hint() { return "ctrl+s send · esc twice puts it aside · ctrl+o back in the reader · ^W p docks it to an edge"; }
  spec() { return { source: `tile:${this.source}` }; }

  private reader(desk: DeskApi): ReaderPane | null {
    const p = desk.paneNamed?.(this.source);
    return p instanceof ReaderPane ? p : null;
  }

  render(w: number, h: number, _focused: boolean, desk: DeskApi): PaneView {
    const r = this.reader(desk);
    const drawn = r?.surface.composerTile(w, h, r.host(desk));
    if (drawn) return drawn;
    // Its comment was sent, put aside or placed back in the reader (or its reader went): it closes.
    if (!this.closing) { this.closing = true; queueMicrotask(() => desk.dismiss?.(this)); }
    return { lines: [fg(C.dark) + pad(` no comment is being written in ${this.source}`, w) + RESET] };
  }

  key(k: Key, desk: DeskApi): boolean {
    const r = this.reader(desk);
    return !!r?.surface.session && r.surface.key(k, r.host(desk));
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    const r = this.reader(desk);
    return !!r && r.surface.composerPointer(k, x, y, r.host(desk));
  }
}

/** The comment tile's kind: opened by the desk when a reader's comment goes into a tile (Desk.composerTile). */
export const COMMENT_TILE: TileKind = {
  kind: COMMENT_TILE_KIND, noun: "a comment tile",
  about: "the comment being written in a reader (source=tile:<name>), in a tile of its own beside it (PIE-846): the note stays whole in its reader; the tile moves, sizes and docks as any tile does. Opened by comment.place place=tile (ctrl+o while writing), closed when the comment is sent or put back",
  make: s => new CommentTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader"),
  check: s => (s.source && !/^tile:./.test(s.source) ? "a comment tile's source is tile:<name>, the reader writing it" : null),
  // Typing in it is typing in the reader's comment: the desk's keys don't take it, but ^W and a window key do (the way out).
  takesKeys: () => true, windowKeys: true,
  describe: p => ({ source: `tile:${(p as CommentTilePane).source}` }),
};
