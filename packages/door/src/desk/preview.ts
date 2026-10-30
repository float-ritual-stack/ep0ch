import type { SurfaceHost } from "../surface/note";
// Preview tiles (PIE-473): a reader that follows a source: what its select wire sends it. The source is
// a tile (its selection: the tree's row, a reader's note, the board's card) or a file on disk (a draft
// being written in nvim beside it). Either way it is the shared note surface (a ReaderPane): the same
// body, embeds resolved through the outline, links that open where this tile's opens go. There is no
// second renderer. A file is shown read-only: it is edited in its editor, and re-read when it changes.
import { statSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { subject, type Msg } from "../board";
import { C, fg, RESET } from "../style";
import { wrap } from "../text";
import type { Key } from "../term";
import { ReaderPane, type DeskApi, type PaneView, type SessionKind } from "./panes";
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
  return { id: `file:${path}`, text, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "file", properties: [] };
}

/** Keys that would edit, comment on or open a panel for the note: a file preview only reads. */
const WRITES = new Set(["e", "C", "m", "i", "I"]);

export class PreviewPane extends ReaderPane {
  override readonly kind: TileKindName = "preview";
  private childrenOf: ReaderPane | null = null;
  override get surface() { return this.childrenOf?.surface ?? this.ownSurface; }
  override host(desk: DeskApi): SurfaceHost {
    const local = super.host(desk);
    return this.childrenOf ? { ...this.childrenOf.host(desk), attachment: "list-preview", focused: local.focused, entered: local.entered, enterMode: local.enterMode } : local;
  }
  override show(m: Msg | null, desk: DeskApi) { this.childrenOf = null; return super.show(m, desk); }
  private watching: string | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** How many times the file was read again after it changed (tests and `peek`). */
  reads = 0;
  constructor(public source: PreviewSource) { super(false); }

  renamedTile(from: string, to: string) { if ("tile" in this.source && this.source.tile === from) this.source = { tile: to }; }

  /** What its title calls it in place of its source (the board's: "follows the board"). */
  override label: string | null = null;
  /** What the list it follows quotes of its selection (the backlinks: the mention), said in place of its label. */
  quote = "";
  headName() { return this.quote ? `"${this.quote}"` : undefined; }
  override title() {
    const f = this.fileNow();
    const tile = "tile" in this.source ? this.on?.pane?.(this.source.tile) : undefined;
    const name = tile ? this.on?.pathTo?.(tile) || this.on?.nameOfPane?.(tile) : undefined;
    const what = this.quote ? `"${this.quote}"` : this.label ?? ("tile" in this.source && !this.source.tile && !f ? "preview" : `preview · ${"tile" in this.source ? (name || this.source.tile) + (f ? ` · ${basename(f)}` : "") : basename(this.source.file)}`);
    return [what, this.surface.state()].filter(Boolean).join(" · ");
  }
  override hint() { return this.fileNow() ? "follows the file as it's saved · links open where this tile's go" : super.hint(); }

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
  protected override fileSource(): boolean { return !!this.fileNow(); }
  override refuses(kind: SessionKind) { return this.fileNow() && this.msg ? `${subject(this.msg)} is shown here to read · it isn't a note in the outline` : super.refuses(kind); }

  /** A file source is read now and again each time it changes on disk (an editor's save, even by rename). */
  watch(desk: DeskApi) {
    const path = this.fileNow();
    if (!path) return this.unwatch();
    if (this.watching === path) return;
    this.unwatch();
    this.watching = path;
    this.show(fileNote(path), desk);
    // Polling, not fs.watch: an editor that saves by writing a new file and renaming it over the old one
    // (vim's backupcopy) would leave an inotify watch on the old inode. Its own poll, not fs.watchFile: Bun's takes its
    // first look a moment after it's called, so a save in between became its starting point and was never read (a save
    // 0 ms after: 31% missed, 2 ms after: 0.5%; test/preview-file.test.ts). Here the baseline is the read just shown.
    const stamp = () => { try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return ""; } };
    let seen = stamp();
    this.poll = setInterval(() => {
      const now = stamp();
      if (this.watching !== path || now === seen) return;
      seen = now;
      this.reads++;
      this.refresh(fileNote(path));
      (this.on ?? desk).redraw();
    }, 250);
    this.poll.unref?.();
  }
  private unwatch() { if (this.poll) clearInterval(this.poll); this.poll = null; this.watching = null; }
  override dispose() { this.childrenOf = null; this.unwatch(); super.dispose(); }

  private listReader(desk: DeskApi): ReaderPane | null {
    const source = desk.selectionSource?.(this);
    return source instanceof ReaderPane && source.surface.previewPoint() ? source : null;
  }

  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const source = desk && this.listReader(desk);
    this.childrenOf = source ?? null;
    if (source) {
      const v = source.surface.listPreviewView(w, h, this.host(desk!), 0, 0);
      if (v) return v;
    }
    if (!this.msg) {
      if (!("tile" in this.source)) return { lines: [fg(C.dark) + "reading…" + RESET] };
      // Where its notes come from: the tile it follows (gone from this screen: it says so) and any whose opens land here.
      if (!this.source.tile) return { lines: wrap("Selections sent here show in this preview · tile.link verb=select sets a source", Math.max(10, w - 1)).map(l => fg(C.dark) + l + RESET) };
      const id = this.source.tile, tile = desk?.pane?.(id), there = !desk?.pane || !!tile;
      const src = tile ? desk?.pathTo?.(tile) || desk?.nameOfPane?.(tile) || id : id;
      const say = there ? `follows ${src}: what's picked there shows here${this.landsFrom.length ? `, and what you open in ${this.landsFrom.join(" or ")} lands here` : ""}` : `follows tile ${src}, which isn't on this screen any more · ^W x closes it, or ^W v on another tile opens a preview of that one`;
      return { lines: wrap(say, Math.max(10, w - 1)).map(l => fg(C.dark) + l + RESET) };
    }
    return super.render(w, h, focused, desk);
  }

  override key(k: Key, desk: DeskApi): boolean {
    const source = this.listReader(desk);
    if (source) return this.surface.key(k, this.host(desk));
    const f = this.fileNow();
    if (f && ((k.kind === "char" && !k.ctrl && WRITES.has(k.ch)) || (k.kind === "char" && k.ctrl && k.ch === "e"))) {
      desk.ctx.flash(`a file preview only reads · edit ${basename(f)} in its editor`);
      return true;
    }
    return super.key(k, desk);
  }

  spec() { return { ...("file" in this.source ? { source: sourceName(this.source) } : {}), ...this.marginSpec() }; }
}
