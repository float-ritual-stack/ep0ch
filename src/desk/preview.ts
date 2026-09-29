// Preview tiles (PIE-473): a reader that follows a source instead of the desk's current note. The source is
// a tile (its selection: the tree's row, a reader's note, the board's card) or a file on disk (a draft
// being written in nvim beside it). Either way it is the shared note surface (a ReaderPane): the same
// body, embeds resolved through the outline, links that open where this tile's opens go. There is no
// second renderer. A file is shown read-only: it is edited in its editor, and re-read when it changes.
import { statSync, unwatchFile, watchFile, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Msg } from "../board";
import type { Key } from "../term";
import { ReaderPane, type DeskApi, type PaneView } from "./panes";

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
  override readonly kind = "preview" as const;
  private watching: string | null = null;
  /** How many times the file was read again after it changed (tests and `peek`). */
  reads = 0;
  constructor(public source: PreviewSource) { super(false); }

  override title() { return `preview · ${"tile" in this.source ? this.source.tile : basename(this.source.file)}`; }
  override hint() { return "file" in this.source ? "follows the file as it's saved · links open where this tile's go" : super.hint(); }

  /** The desk's current note moved: a preview follows its source, not that. */
  override select() {}
  /** Its source tile selected `m`. */
  follow(m: Msg | null, desk: DeskApi) { if (m && m.id !== this.msg?.id) this.show(m, desk); }

  init(desk: DeskApi) { this.watch(desk); }
  /** A file source: e, C, m, i, I and ctrl+e are refused here, not started as sessions. */
  get readOnly() { return "file" in this.source; }

  /** A file source is read now and again each time it changes on disk (an editor's save, even by rename). */
  watch(desk: DeskApi) {
    if (!("file" in this.source)) return this.unwatch();
    const path = this.source.file;
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
      desk.redraw();
    });
  }
  private unwatch() { if (this.watching) unwatchFile(this.watching); this.watching = null; }
  dispose() { this.unwatch(); }

  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    if (!this.msg) return { lines: ["\x1b[38;2;85;85;85m" + ("tile" in this.source ? `follows tile ${this.source.tile}: pick something there` : "reading…") + "\x1b[0m"] };
    return super.render(w, h, focused, desk);
  }

  override key(k: Key, desk: DeskApi): boolean {
    if ("file" in this.source && ((k.kind === "char" && !k.ctrl && WRITES.has(k.ch)) || (k.kind === "char" && k.ctrl && k.ch === "e"))) {
      desk.ctx.flash(`a file preview only reads · edit ${basename(this.source.file)} in its editor`);
      return true;
    }
    return super.key(k, desk);
  }

  spec() { return { source: sourceName(this.source) }; }
}
