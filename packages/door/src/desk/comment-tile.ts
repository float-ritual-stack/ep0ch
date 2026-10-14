// The comment's own tile (PIE-846): the comment being written in a reader, drawn in a tile beside it so the whole note
// stays in view, as Evan asked ("dock it in a tile to the side"). It's the reader's comment, not a second editor: the
// reader's comment session holds the draft, its keys run the reader's comment keys, its mouse the reader's draft, and the
// edit control (renderEditor) draws it, or the thread list (m) when it's reading the comments. Being a tile, it sizes
// and folds as any tile; it sits in its note's place beside it (a pair, Split.pair), on the side its last row's arrows (or ctrl+g
// and the arrows, or comment.place side=) put it, and closing it gives the note its room back. It opens when the comment's place is `tile` (comment.place, ctrl+o) and closes when the comment is sent,
// put aside or placed back in the reader. Never saved in a layout: a handover opens it again through the comment's own
// reopen steps (src/session/restore.ts).
import { fg, C, pad, RESET, width } from "../style";
import type { Key } from "../term";
import type { TileKind } from "./tile-kinds";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "./panes";

export const COMMENT_TILE_KIND = "comment";

type Side = "left" | "right" | "up" | "down";
/** Its side chips: where the tile goes round its note. */
const SIDES: [Side, string][] = [["left", "◀ left"], ["right", "right ▶"], ["up", "▲ above"], ["down", "below ▼"]];

export class CommentTilePane implements Pane {
  readonly kind = COMMENT_TILE_KIND;
  /** Closing it was asked for once (its comment ended): the desk closes it after this frame. */
  private closing = false;
  private lastRow = -1;
  /** `source`: the reader whose comment it draws, by name. */
  constructor(public source: string) {}

  title() { return `${this.listing ? "comments" : "comment"} · ${this.source}`; }
  /** It shows the reader's thread list (m), not a comment being written. */
  private listing = false;
  hint() { return "ctrl+s send · esc twice puts it aside · ctrl+o back in the reader · ctrl+g then ← → ↑ ↓: another side of the note · drag its border to size it"; }
  /** The last row's side chips as drawn: a click puts the tile on that side of its note. */
  private sides: { from: number; to: number; side: Side }[] = [];
  spec() { return { source: `tile:${this.source}` }; }

  /** The comment (or thread list) above its last row, the side chips on it. */
  private drawn(w: number, h: number, desk: DeskApi): PaneView | null {
    const r = this.reader(desk);
    const v = r?.surface.composerTile(w, Math.max(1, h - 1), r.host(desk)) ?? null;
    if (!v) return null;
    this.sides = [];
    let row = fg(C.dark) + " the note's ", x = width(" the note's ");
    for (const [side, label] of SIDES) {
      const chip = `[${label}]`;
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
    return !!r?.surface.session && r.surface.key(k, r.host(desk));
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    const r = this.reader(desk);
    if (!r) return false;
    // Its last row: a click on a side puts it there (comment.place side=, as ctrl+g and an arrow do).
    const chip = this.sides.find(c => x >= c.from && x < c.to);
    if (chip && y === this.lastRow) { if (k.action === "up") void r.surface.runKey("comment.place", { side: chip.side }, r.host(desk), true); return true; }
    return r.surface.composerPointer(k, x, y, r.host(desk));
  }
}

/** The comment tile's kind: opened by the desk when a reader's comment goes into a tile (Desk.composerTile). */
export const COMMENT_TILE: TileKind = {
  kind: COMMENT_TILE_KIND, noun: "a comment tile",
  about: "the comment being written in a reader (source=tile:<name>), or its thread list, in a tile of its own in the reader's place beside it (PIE-846): left, right, above or below (comment.place side=), sized by its border; the tiles round them never move, and closing it gives the reader its room back. Opened by comment.place place=tile (ctrl+o), closed when the comment is sent or put back",
  make: s => new CommentTilePane(s.source?.startsWith("tile:") ? s.source.slice(5) : "reader"),
  check: s => (s.source && !/^tile:./.test(s.source) ? "a comment tile's source is tile:<name>, the reader writing it" : null),
  // Typing in it is typing in the reader's comment: the desk's keys don't take it, but ^W and a window key do (the way out).
  takesKeys: () => true, windowKeys: true,
  describe: p => ({ source: `tile:${(p as CommentTilePane).source}` }),
};
