// Preview tiles (PIE-473): a reader that follows a source instead of the desk's current note. The source is
// a tile (its selection: the tree's row, a reader's note, the board's card) or a file on disk (a draft
// being written in nvim beside it). Either way it is the shared note surface (a ReaderPane): the same
// body, embeds resolved through the outline, links that open where this tile's opens go. There is no
// second renderer. A file is shown read-only: it is edited in its editor, and re-read when it changes.
import { statSync, unwatchFile, watchFile, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Msg } from "../board";
import { C, fg, RESET } from "../style";
import { wrap } from "../text";
import type { Key } from "../term";
import { ReaderPane, type DeskApi, type PaneView } from "./panes";
import type { TileKindName } from "./tile-kinds";

export type PreviewSource = { tile: string } | { file: string };

/** "tile:tree", "file:/path/draft.md" (or a bare path) as a source. */
export function sourceOf(s: string): PreviewSource | null {
  if (s.startsWith("tile:") && s.length > 5) return { tile: s.slice(5) };
  if (s.startsWith("file:") && s.length > 5) return { file: resolve(s.slice(5)) };
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("~")) return { file: resolve(s.replace(/^~/, process.env.HOME ?? "~")) };
  return null;
}
export const sourceName = (s: PreviewSource) => ("tile" in s ? `tile:${s.tile}` : `file:${s.file}`);

/** A file as a note the surface can draw: its text, named by its path (never an outline id). */
export function fileNote(path: string): Msg {
  let text = "", at = Date.now();
  try { text = readFileSync(path, "utf8"); at = statSync(path).mtimeMs; } catch (e) { text = `${basename(path)}\n\ncan't read ${path}: ${(e as Error).message}`; }
  return { id: `file:${path}`, text, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "file", props: {} };
}

/** Keys that would edit, comment on or open a panel for the note: a file preview only reads. */
const WRITES = new Set(["e", "C", "m", "i", "I"]);

export class PreviewPane extends ReaderPane {
  override readonly kind: TileKindName = "preview";
  private watching: string | null = null;
  /** How many times the file was read again after it changed (tests and `peek`). */
  reads = 0;
  constructor(public source: PreviewSource) { super(false); }

  /** What its title calls it in place of its source (the board's: "follows the board"). */
  label: string | null = null;
  /** What the list it follows quotes of its selection (the backlinks: the mention), said in place of its label. */
  quote = "";
  override title() {
    const f = this.fileNow();
    const what = this.quote ? `"${this.quote}"` : this.label ?? `preview · ${"tile" in this.source ? this.source.tile + (f ? ` · ${basename(f)}` : "") : basename(this.source.file)}`;
    return [what, this.surface.state()].filter(Boolean).join(" · ");
  }
  override hint() { return this.fileNow() ? "follows the file as it's saved · links open where this tile's go" : super.hint(); }

  /** The desk's current note moved: a preview follows its source, not that. */
  override select() {}
  /** Its source tile selected `m`. */
  follow(m: Msg | null, desk: DeskApi) { if (m && m.id !== this.msg?.id) this.show(m, desk); }
  /** A terminal tile it follows is editing `path` now (nvim changed buffer): show that file, re-read as it's saved. */
  private tileFile: string | null = null;
  followFile(path: string | null | undefined, desk: DeskApi) {
    if (!path || path === this.tileFile) return;
    this.tileFile = path;
    this.watch(desk);
  }
  private fileNow(): string | null { return "file" in this.source ? this.source.file : this.tileFile; }

  /** The desk it's on now: a tile moved to another screen or the drawer (PIE-498) repaints that one. */
  private on: DeskApi | null = null;
  init(desk: DeskApi) { this.on = desk; this.watch(desk); }
  /** A file source (or a terminal tile's file): e, C, m, i, I and ctrl+e are refused here, not started as sessions. */
  override get readOnly() { return !!this.fileNow() || super.readOnly; }

  /** A file source is read now and again each time it changes on disk (an editor's save, even by rename). */
  watch(desk: DeskApi) {
    const path = this.fileNow();
    if (!path) return this.unwatch();
    if (this.watching === path) return;
    this.unwatch();
    this.watching = path;
    this.show(fileNote(path), desk);
    // Polling, not fs.watch: an editor that saves by writing a new file and renaming it over the old one
    // (vim's backupcopy) would leave an inotify watch on the old inode.
    watchFile(path, { interval: 250 }, (cur, prev) => {
      if (this.watching !== path || (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size)) return;
      this.reads++;
      this.refresh(fileNote(path));
      (this.on ?? desk).redraw();
    });
  }
  private unwatch() { if (this.watching) unwatchFile(this.watching); this.watching = null; }
  override dispose() { this.unwatch(); super.dispose(); }

  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    if (!this.msg) {
      if (!("tile" in this.source)) return { lines: [fg(C.dark) + "reading…" + RESET] };
      // Where its notes come from: the tile it follows (gone from this screen: it says so) and any whose opens land here.
      const src = this.source.tile, there = !desk?.pane || !!desk.pane(src);
      const say = there ? `follows ${src}: what's picked there shows here${this.landsFrom.length ? `, and what you open in ${this.landsFrom.join(" or ")} lands here` : ""}` : `follows tile ${src}, which isn't on this screen any more · ^W x closes it, or ^W v on another tile opens a preview of that one`;
      return { lines: wrap(say, Math.max(10, w - 1)).map(l => fg(C.dark) + l + RESET) };
    }
    return super.render(w, h, focused, desk);
  }

  override key(k: Key, desk: DeskApi): boolean {
    const f = this.fileNow();
    if (f && ((k.kind === "char" && !k.ctrl && WRITES.has(k.ch)) || (k.kind === "char" && k.ctrl && k.ch === "e"))) {
      desk.ctx.flash(`a file preview only reads · edit ${basename(f)} in its editor`);
      return true;
    }
    return super.key(k, desk);
  }

  spec() { return { source: sourceName(this.source) }; }
}
