// The panes a desk can hold. Each renders into its own inner rectangle; the desk draws borders.
import type { Art } from "../ansi";
import { whole } from "../art-view";
import type { Ctx } from "../app";
import { subject, type Caller, type Msg } from "../board";
import type { Placement } from "../kitty";
import { find, loadArt } from "../packs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommentSession, type CommentEnv } from "../comment";
import { Draft } from "../edit";
import { EditConflict, type Activity, type Comment } from "../socket";
import { artLines, bg, C, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { ago, bbsDate, colourBody, rule, wrap } from "../text";
import { renderDoc } from "../doc";

export type PaneKind = "tree" | "reader" | "thread" | "activity" | "who" | "art";
export interface PaneView { lines: string[]; placements?: Placement[] }

export interface DeskApi {
  ctx: Ctx;
  current: Msg | null;
  setCurrent(m: Msg | null, opts?: { reveal?: boolean; from?: Pane }): void;
  focusKind(kind: PaneKind): void;
  redraw(): void;
}

export interface Pane {
  readonly kind: PaneKind;
  title(): string;
  hint(): string;
  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView;
  /** Return true when the pane used the key. */
  key(k: Key, desk: DeskApi): boolean;
  click?(x: number, y: number, desk: DeskApi): void;
  wheel?(dir: 1 | -1, desk: DeskApi): void;
  select?(m: Msg | null, desk: DeskApi): void;
  reveal?(m: Msg, desk: DeskApi): void;
  onEvent?(desk: DeskApi): void;
  init?(desk: DeskApi): void;
}

const SEL_ON = bg(C.blue) + fg(C.white);
const SEL_OFF = "\x1b[48;2;22;30;58m" + fg(C.white);
const dim = (s: string) => fg(C.dark) + s + RESET;
const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");
const isUp = (k: Key) => k.kind === "up" || ch(k) === "k";
const isDown = (k: Key) => k.kind === "down" || ch(k) === "j";

function follow(sel: number, top: number, h: number): number {
  if (sel < top) return sel;
  if (sel >= top + h) return sel - h + 1;
  return top;
}

// ── outline tree ─────────────────────────────────────────────────────────────

interface Row { m: Msg; depth: number }

export class TreePane implements Pane {
  readonly kind = "tree";
  private roots: Msg[] | null = null;
  private kids = new Map<string, Msg[] | "loading">();
  private open = new Set<string>();
  private rows: Row[] = [];
  private sel = 0;
  private top = 0;
  private timer: Timer | null = null;
  title() { return "outline"; }
  hint() { return "←→ fold · ⏎ read"; }

  init(desk: DeskApi) {
    desk.ctx.board.roots().then(r => {
      this.roots = r; this.rebuild();
      if (!desk.current && r[0]) desk.setCurrent(r[0], { from: this });
      desk.redraw();
    }, () => {});
  }

  private rebuild() {
    const out: Row[] = [];
    const walk = (list: Msg[], depth: number) => {
      for (const m of list) {
        out.push({ m, depth });
        const k = this.kids.get(m.id);
        if (this.open.has(m.id) && Array.isArray(k)) walk(k, depth + 1);
      }
    };
    walk(this.roots ?? [], 0);
    this.rows = out;
    this.sel = Math.min(this.sel, Math.max(0, out.length - 1));
  }

  private async expand(m: Msg, desk: DeskApi): Promise<void> {
    this.open.add(m.id);
    if (!this.kids.has(m.id)) {
      this.kids.set(m.id, "loading"); desk.redraw();
      try { this.kids.set(m.id, await desk.ctx.board.children(m.id)); } catch { this.kids.set(m.id, []); }
    }
    this.rebuild(); desk.redraw();
  }

  private pick(desk: DeskApi) {
    if (this.timer) clearTimeout(this.timer);
    const m = this.rows[this.sel]?.m;
    if (m) this.timer = setTimeout(() => desk.setCurrent(m, { from: this }), 90);
    desk.redraw();
  }

  async reveal(m: Msg, desk: DeskApi) {
    try {
      const chain = await desk.ctx.board.ancestors(m.id);
      for (const a of chain) await this.expand(a, desk);
    } catch { /* reveal is best effort */ }
    const i = this.rows.findIndex(r => r.m.id === m.id);
    if (i >= 0) { this.sel = i; desk.redraw(); }
  }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    if (!this.roots) return { lines: [dim("dialing the outline…")] };
    this.top = follow(this.sel, this.top, h);
    const lines = this.rows.slice(this.top, this.top + h).map((r, i) => {
      const k = this.kids.get(r.m.id);
      const leaf = Array.isArray(k) && k.length === 0;
      const mark = k === "loading" ? "…" : leaf ? "·" : this.open.has(r.m.id) ? "▾" : "▸";
      const tag = (r.m.props["work-id"] ?? r.m.props.status ?? r.m.props.type ?? "").slice(0, 14);
      const indent = "  ".repeat(r.depth);
      const room = Math.max(4, w - (tag ? tag.length + 1 : 0));
      if (this.top + i === this.sel) return (focused ? SEL_ON : SEL_OFF) + pad(`${indent}${mark} ${subject(r.m)}`, room) + (tag ? " " + tag : "") + RESET;
      const here = desk.current?.id === r.m.id;
      return pad(`${indent}${fg(C.lcyan)}${mark} ${fg(here ? C.yellow : C.grey)}${subject(r.m)}`, room) + (tag ? " " + fg(C.brown) + tag : "") + RESET;
    });
    return { lines };
  }

  key(k: Key, desk: DeskApi): boolean {
    const row = this.rows[this.sel];
    if (isUp(k)) { this.sel = Math.max(0, this.sel - 1); this.pick(desk); return true; }
    if (isDown(k)) { this.sel = Math.min(this.rows.length - 1, this.sel + 1); this.pick(desk); return true; }
    if (k.kind === "pgup") { this.sel = Math.max(0, this.sel - 15); this.pick(desk); return true; }
    if (k.kind === "pgdn") { this.sel = Math.min(this.rows.length - 1, this.sel + 15); this.pick(desk); return true; }
    if (k.kind === "home") { this.sel = 0; this.pick(desk); return true; }
    if (k.kind === "end") { this.sel = Math.max(0, this.rows.length - 1); this.pick(desk); return true; }
    if (!row) return false;
    if (k.kind === "right" || ch(k) === "l" || ch(k) === " ") {
      if (this.open.has(row.m.id) && ch(k) === " ") { this.open.delete(row.m.id); this.rebuild(); desk.redraw(); }
      else void this.expand(row.m, desk);
      return true;
    }
    if (k.kind === "left" || ch(k) === "h") {
      if (this.open.has(row.m.id)) { this.open.delete(row.m.id); this.rebuild(); }
      else { const p = this.rows.findLastIndex((r, i) => i < this.sel && r.depth < row.depth); if (p >= 0) { this.sel = p; this.pick(desk); } }
      desk.redraw();
      return true;
    }
    if (k.kind === "enter") { desk.setCurrent(row.m, { from: this }); desk.focusKind("reader"); return true; }
    return false;
  }

  click(x: number, y: number, desk: DeskApi) {
    const i = this.top + y, row = this.rows[i];
    if (!row) return;
    this.sel = i;
    if (x <= row.depth * 2 + 1) {
      if (this.open.has(row.m.id)) { this.open.delete(row.m.id); this.rebuild(); } else void this.expand(row.m, desk);
    }
    this.pick(desk);
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.sel = Math.max(0, Math.min(this.rows.length - 1, this.sel + dir * 3)); this.pick(desk); }
}

// ── reader ───────────────────────────────────────────────────────────────────

/** Comment and reply blocks: stored as children of the note they're about. */
const isAnnotation = (m: Msg) => m.props.type === "annotation" || m.props.type === "annotation-reply";

const LINK = /\(\(([0-9a-f]{8}-[0-9a-f-]{27})\)\)|\[\[([^\]]+)\]\]/g;
/** `-stage=queued +stage=doing`, or "" when the property set is the same. */
export function propertyChange(before: Record<string, string>, after: Record<string, string>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(before)) if (after[k] !== v) out.push(`-${k}=${v}`);
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) out.push(`+${k}=${v}`);
  return out.join(" ");
}
const linksOf = (m: Msg): { block?: string; page?: string; media?: string }[] =>
  [...m.text.matchAll(LINK)].map(x => (x[1] ? { block: x[1] } : { page: x[2]! }));

export class ReaderPane implements Pane {
  readonly kind = "reader";
  msg: Msg | null = null;
  private pinned = false;
  private scroll = 0;
  private crumbs = "";
  /** Shown under the header after a save that changed the note's properties, until the reader moves on. */
  private notice = "";
  private links: { block?: string; page?: string; media?: string }[] = [];
  private unfold = false;
  private link = -1;
  /** An open edit of `msg`. While it exists every key goes to it and the reader stays on its note. */
  draft: Draft | null = null;
  /** Commenting on `msg` (picking a passage, writing, the thread list). Holds keys and the note like a draft. */
  session: CommentSession | null = null;
  /** The note's comment threads, for the count in the header and the marks while picking a passage. */
  comments: Comment[] | null = null;
  private commentsFor = "";
  private commentTimer: Timer | null = null;
  get editing() { return this.draft !== null || this.session !== null; }
  /** Typed text that isn't saved or sent: an edit, or a comment being written. */
  unsaved() { return !!this.draft?.dirty || !!this.session?.dirty; }
  /** Copy unsaved text to disk (the screen is closing anyway). */
  keepDrafts(): string[] {
    const out: string[] = [];
    if (this.draft?.dirty) out.push(this.draft.copyOut());
    if (this.session?.composer?.dirty) out.push(this.session.composer.copyOut(`${this.session.blockId.slice(0, 8)}-comment`));
    return out;
  }
  title() {
    if (this.session) return `reader · ${this.session.mode === "compose" ? `writing${this.session.dirty ? " · unsent" : ""}` : this.session.mode === "select" ? "quoting" : "comments"}`;
    return this.draft ? `reader · editing${this.draft.dirty ? " · unsaved" : ""}` : this.pinned ? "reader · pinned" : "reader";
  }
  hint() {
    if (this.session) return this.session.hint();
    if (this.draft) return "ctrl+s save · ctrl+e $EDITOR · ctrl+r reload · esc done";
    const l = this.links[this.link];
    return l ? `link ${this.link + 1}/${this.links.length} ${l.media ? `▣ ${l.media.split("/").pop()}` : l.block ? `((${l.block.slice(0, 8)}…))` : `[[${l.page}]]`} · ⏎ ${l.media ? "open" : "follow"}` : "p pin · [ ] links · z folds · u up · c comment · m comments";
  }

  select(m: Msg | null, desk: DeskApi) { if (!this.pinned) this.show(m, desk); }

  /**
   * Same note, new text: keep the scroll position and link selection. An open draft is never replaced;
   * it is marked "changed elsewhere" and the save's revision check decides.
   */
  refresh(m: Msg) {
    if (this.msg?.id !== m.id) return;
    const d = this.draft;
    if (d && !d.saving && m.revision !== undefined && m.revision !== d.base) d.changedElsewhere = true;
    this.msg = m;
    if (!d) this.links = linksOf(m);
  }

  show(m: Msg | null, desk: DeskApi) {
    if (this.draft && m?.id !== this.draft.blockId) return;   // an edit keeps the reader on its note
    if (this.session && m?.id !== this.session.blockId) return;   // so does commenting
    if (m?.id !== this.msg?.id) this.notice = "";
    this.msg = m; this.scroll = 0; this.link = -1; this.crumbs = "…";
    this.links = m ? linksOf(m) : [];
    if (m?.id !== this.commentsFor) { this.comments = null; this.commentsFor = ""; }
    if (!m) return;
    void this.loadComments(desk);
    desk.ctx.board.ancestors(m.id).then(a => {
      if (this.msg?.id !== m.id) return;
      this.crumbs = a.map(subject).join(" › ") || "top level"; desk.redraw();
    }, () => {});
  }

  render(w: number, h: number, _focused = false, desk?: DeskApi): PaneView {
    const m = this.msg;
    if (!m) return { lines: [dim("pick something in the outline")] };
    if (this.draft) return this.renderDraft(this.draft, m, w, h);
    if (this.session) return { lines: this.session.render(w, h, subject(m)) };
    const meta = [m.author ?? "?", bbsDate(m.updatedAt), m.props.status ?? m.props.type, m.props["work-id"]].filter(Boolean).join(" · ");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    const said = this.comments?.length ? `${fg(open ? C.yellow : C.dark)} · ■ ${open ? `${open} open comment${open === 1 ? "" : "s"}` : `${this.comments.length} resolved`} (m)` : "";
    const head = [
      fg(C.white) + pad(subject(m), w) + RESET,
      pad(fg(C.brown) + meta + said, w) + RESET,
      fg(C.cyan) + pad(this.crumbs, w) + RESET,
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
      rule(w),
    ];
    const t = desk?.ctx.t;
    const doc = renderDoc(m.text.split("\n").slice(1).join("\n").replace(/^\n+/, ""), {
      width: w - 1, cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics: !!desk?.ctx.graphics,
      maxImageRows: Math.max(4, Math.round((h - head.length) * 0.8)), unfold: this.unfold,
    });
    // Media become followable links too: [ ] selects, ⏎ opens with the system viewer.
    const mediaLinks = doc.media.map(x => ({ media: x.path }));
    if (this.links.filter(l => l.media).length !== mediaLinks.length) this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
    const body = doc.lines.map(l => " " + l);
    const room = Math.max(1, h - head.length);
    this.scroll = Math.max(0, Math.min(this.scroll, body.length - room));
    const placements: Placement[] = [];
    for (const im of doc.images) {
      const top = im.line - this.scroll, bottom = top + im.rows;
      if (bottom <= 0 || top >= room) continue;
      const cutTop = Math.max(0, -top), cutBottom = Math.max(0, bottom - room);
      const visible = im.rows - cutTop - cutBottom;
      const img = im.media.image;
      const crop = cutTop || cutBottom ? { x: 0, y: Math.round((cutTop / im.rows) * img.height), w: img.width, h: Math.max(1, Math.round((visible / im.rows) * img.height)) } : undefined;
      placements.push({ key: `img:${img.key}:${im.line}`, image: img, col: 1, row: head.length + Math.max(0, top), cols: im.cols, rows: visible, z: -1, crop });
    }
    return { lines: [...head, ...body.slice(this.scroll, this.scroll + room)], placements };
  }

  private renderDraft(d: Draft, m: Msg, w: number, h: number): PaneView {
    const state = d.conflict ? fg(C.lred) + `! ${d.conflict}`
      : d.saving ? fg(C.grey) + "saving…"
      : d.changedElsewhere ? fg(C.yellow) + "!! changed elsewhere · saving checks it first"
      : d.dirty ? fg(C.yellow) + "unsaved" : fg(C.dark) + "no changes";
    const head = [
      fg(C.yellow) + pad(`» editing · ${subject(m)}`, w) + RESET,
      fg(C.brown) + `rev ${d.base} · ` + pad(state, Math.max(1, w - `rev ${d.base} · `.length)) + RESET,
      fg(C.cyan) + pad(d.note || "whole text: subject, body and [key::value] properties", w) + RESET,
      rule(w),
    ];
    return { lines: [...head, ...d.render(w - 2, Math.max(1, h - head.length)).map(l => " " + l)] };
  }

  /** Open a draft on the block as the service has it now, not as this reader last drew it. */
  async edit(desk: DeskApi, external = false): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    const fresh = await desk.ctx.board.get(m.id);
    if (!fresh || fresh.revision === undefined) { desk.ctx.flash("can't edit: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    this.draft = new Draft(fresh.id, fresh.revision, fresh.text, fresh.props);
    desk.redraw();
    if (external) this.external(desk);
  }

  private draftKey(k: Key, desk: DeskApi): boolean {
    const d = this.draft!;
    if (d.saving) return true;
    const a = d.key(k);
    if (a === "save") void this.save(desk);
    else if (a === "editor") this.external(desk);
    else if (a === "reload") void this.reload(desk);
    else if (a === "close") { this.draft = null; if (this.msg) this.links = linksOf(this.msg); }
    desk.redraw();
    return true;
  }

  /** Whole-text update from the draft's base revision. A refusal keeps the draft and copies it to disk. */
  async save(desk: DeskApi): Promise<void> {
    const d = this.draft;
    if (!d) return;
    if (!d.dirty) { this.draft = null; desk.ctx.flash("nothing changed"); desk.redraw(); return; }
    // Ask the service how it will read the draft's [key::value] tokens before writing, when it can say.
    if (d.propertyWarned !== d.text) {
      const next = await desk.ctx.board.previewProperties(d.text).catch(() => null);
      const change = next ? propertyChange(d.baseProps, next) : "";
      if (change && this.draft === d) {
        d.propertyWarned = d.text;
        d.note = `this save changes properties: ${change} · ctrl+s again saves`;
        desk.redraw();
        return;
      }
    }
    d.saving = true; d.note = "saving…"; desk.redraw();
    try {
      const m = await desk.ctx.board.update(d.blockId, d.text, d.base);
      if (this.draft === d) this.draft = null;
      this.msg = { ...m, childIds: this.msg?.id === m.id ? this.msg.childIds : m.childIds };
      this.links = linksOf(this.msg);
      // The service decides which [key::value] tokens are properties (a token followed by more text on
      // its line is plain text), so say plainly when a save changed them: a card can leave its lane.
      const change = propertyChange(d.baseProps, m.props);
      this.notice = change ? `properties changed: ${change}` : "";
      desk.ctx.flash(change ? `saved · revision ${m.revision} · properties changed: ${change}` : `saved · revision ${m.revision}`);
    } catch (e) {
      d.saving = false;
      if (e instanceof EditConflict) {
        d.conflict = "changed elsewhere since you started · not saved";
        d.note = `your draft is kept and copied to ${d.copyOut()} · ctrl+r loads the current text`;
      } else {
        d.note = `not saved: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    desk.redraw();
  }

  /** Drop the draft for the block's current text. Typed work is copied to disk first. */
  private async reload(desk: DeskApi) {
    const d = this.draft!;
    if (!d.conflict && !d.changedElsewhere) { d.note = "nothing newer to load"; return; }
    const copy = d.dirty ? d.copyOut() : d.savedCopy;
    const m = await desk.ctx.board.get(d.blockId);
    if (this.draft !== d) return;
    if (!m) { d.note = "the note is gone from the outline"; desk.redraw(); return; }
    this.msg = m;
    d.rebase(m);
    if (copy) d.note = `loaded revision ${d.base} · your earlier draft is at ${copy}`;
    desk.redraw();
  }

  /** Ctrl+E: the draft (or a comment being written) goes to $VISUAL/$EDITOR in a temp file and comes back. */
  private external(desk: DeskApi, d: Draft | null = this.draft) {
    if (!d) return;
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-edit-"));
    const path = join(dir, `${d.blockId.slice(0, 8)}.md`);
    writeFileSync(path, d.text + "\n");
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    let code: number | null = null;
    try {
      desk.ctx.suspend(() => {
        code = Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", path], { stdio: ["inherit", "inherit", "inherit"] }).exitCode;
      });
      if (code !== 0) d.note = `${editor} exited ${code}; the draft is unchanged`;
      else {
        const before = d.text;
        d.replace(readFileSync(path, "utf8"));
        d.note = d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    desk.redraw();
  }

  // ── comments ────────────────────────────────────────────────────────────────

  async loadComments(desk: DeskApi): Promise<void> {
    const id = this.msg?.id;
    if (!id) return;
    try {
      const c = await desk.ctx.board.comments(id);
      if (this.msg?.id !== id) return;
      this.comments = c; this.commentsFor = id;
      if (this.session?.mode === "threads" && !this.session.busy) this.session.threads = c;
      desk.redraw();
    } catch { /* comments are extra; the note still reads */ }
  }

  /** Outline changed: a comment on this note may have been added, answered or resolved anywhere. */
  onEvent(desk: DeskApi) {
    if (!this.msg) return;
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = setTimeout(() => void this.loadComments(desk), 700);
  }

  private commentEnv(desk: DeskApi): CommentEnv {
    return {
      board: desk.ctx.board,
      fetch: id => desk.ctx.board.get(id),
      setMsg: m => { if (this.msg?.id === m.id) { this.msg = { ...m, childIds: m.childIds.length ? m.childIds : this.msg.childIds }; this.links = linksOf(this.msg); } },
      reloadComments: async () => { await this.loadComments(desk); return this.comments ?? []; },
      external: d => this.external(desk, d),
      flash: m => desk.ctx.flash(m),
      redraw: () => desk.redraw(),
    };
  }

  /** `c`: pick a passage of the note as the service has it now; `m`: the thread list. */
  async comment(desk: DeskApi, mode: "select" | "threads"): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    const fresh = mode === "select" ? await desk.ctx.board.get(m.id) : m;
    if (!fresh || fresh.revision === undefined) { desk.ctx.flash("can't comment: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    if (this.commentsFor !== m.id) await this.loadComments(desk);
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    desk.redraw();
  }

  key(k: Key, desk: DeskApi): boolean {
    if (this.draft) return this.draftKey(k, desk);
    if (this.session) {
      if (this.session.key(k, this.commentEnv(desk)) === "close") this.session = null;
      desk.redraw();
      return true;
    }
    const c = ch(k);
    if (c === "c" && this.msg) { void this.comment(desk, "select"); return true; }
    if (c === "m" && this.msg) { void this.comment(desk, "threads"); return true; }
    if (c === "e" && this.msg) { void this.edit(desk); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "e" && this.msg) { void this.edit(desk, true); return true; }
    if (isUp(k)) { this.scroll = Math.max(0, this.scroll - 1); desk.redraw(); return true; }
    if (isDown(k)) { this.scroll++; desk.redraw(); return true; }
    if (k.kind === "pgdn" || c === " ") { this.scroll += 15; desk.redraw(); return true; }
    if (k.kind === "pgup") { this.scroll = Math.max(0, this.scroll - 15); desk.redraw(); return true; }
    if (c === "p") { this.pinned = !this.pinned; if (!this.pinned) this.show(desk.current, desk); desk.redraw(); return true; }
    if (c === "]" || c === "[") {
      const n = this.links.length;
      if (n) this.link = c === "]" ? (this.link + 1) % n : this.link <= 0 ? n - 1 : this.link - 1;
      desk.redraw(); return true;
    }
    if (c === "z") { this.unfold = !this.unfold; desk.redraw(); return true; }
    if (k.kind === "enter" && this.links[this.link]?.media) { Bun.spawn(["open", this.links[this.link]!.media!], { stdout: "ignore", stderr: "ignore" }); desk.ctx.flash("opened in the system viewer"); return true; }
    if (k.kind === "enter" && this.links[this.link]) { void this.go(this.links[this.link]!, desk); return true; }
    if (c === "u" && this.msg?.parentId) {
      desk.ctx.board.get(this.msg.parentId).then(p => { if (p) { if (this.pinned) this.show(p, desk); desk.setCurrent(p, { reveal: true, from: this }); } }, () => {});
      return true;
    }
    return false;
  }

  private async go(l: { block?: string; page?: string; media?: string }, desk: DeskApi) {
    let target: Msg | null = null;
    if (l.block) target = await desk.ctx.board.get(l.block);
    else if (l.page) {
      const hits = await desk.ctx.board.search(l.page, 25).catch(() => [] as Msg[]);
      const p = l.page.toLowerCase();
      target = hits.find(m => m.props["work-id"]?.toLowerCase() === p || m.props.page?.toLowerCase() === p)
        ?? hits.find(m => subject(m).toLowerCase().startsWith(p)) ?? null;
    }
    if (!target) { desk.ctx.flash(`nothing answers at ${l.block ?? `[[${l.page}]]`}`); return; }
    if (this.pinned) this.show(target, desk);
    desk.setCurrent(target, { reveal: true, from: this });
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.scroll = Math.max(0, this.scroll + dir * 3); desk.redraw(); }
}

// ── thread: replies (children) and comment threads ───────────────────────────

export class ThreadPane implements Pane {
  readonly kind = "thread";
  private msg: Msg | null = null;
  private kids: Msg[] | null = null;
  private comments: Comment[] | null = null;
  private sel = 0;
  private top = 0;
  private kidLine: number[] = [];
  title() { return this.kids ? `thread · ${this.kids.length} repl${this.kids.length === 1 ? "y" : "ies"} · ${this.comments?.length ?? "…"} comment${this.comments?.length === 1 ? "" : "s"}` : "thread"; }
  hint() { return "⏎ open reply · u up · comment from a reader: c, m"; }

  select(m: Msg | null, desk: DeskApi) {
    this.msg = m; this.kids = null; this.comments = null; this.sel = 0; this.top = 0;
    if (!m) return;
    // Comment and reply blocks live under the note too; they show below as comments, not as replies.
    desk.ctx.board.children(m.id).then(k => { if (this.msg?.id === m.id) { this.kids = k.filter(x => !isAnnotation(x)); desk.redraw(); } }, () => { this.kids = []; });
    this.loadComments(desk);
  }

  private loadComments(desk: DeskApi) {
    const m = this.msg;
    if (m) desk.ctx.board.comments(m.id).then(c => { if (this.msg?.id === m.id) { this.comments = c; desk.redraw(); } }, () => { this.comments ??= []; });
  }

  private timer: Timer | null = null;
  onEvent(desk: DeskApi) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.loadComments(desk), 700); }

  render(w: number, h: number, focused: boolean): PaneView {
    if (!this.msg) return { lines: [dim("no message selected")] };
    const lines: string[] = [];
    this.kidLine = [];
    lines.push(fg(C.lcyan) + `REPLIES ${this.kids ? this.kids.length : "…"}` + RESET);
    (this.kids ?? []).forEach((k, i) => {
      const last = i === this.kids!.length - 1;
      this.kidLine.push(lines.length);
      const head = `${last ? "└" : "├"} ${k.author ?? "?"} · ${ago(k.updatedAt)} · ${subject(k)}`;
      lines.push(i === this.sel ? (focused ? SEL_ON : SEL_OFF) + pad(head, w) + RESET : fg(C.blue) + head.slice(0, 1) + " " + fg(C.yellow) + pad(head.slice(2), w - 2) + RESET);
      const snippet = k.text.split("\n").slice(1).map(l => l.replace(/\[[\w-]+::[^\]]*\]/g, "").trim()).find(Boolean) ?? "";
      if (snippet) lines.push(fg(C.blue) + (last ? " " : "│") + "   " + fg(C.dark) + pad(snippet, w - 4) + RESET);
    });
    lines.push("");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    lines.push(fg(C.lcyan) + `COMMENTS ${this.comments ? `${open} open · ${this.comments.length - open} resolved` : "…"}` + RESET);
    for (const c of this.comments ?? []) {
      lines.push(`${fg(c.open ? C.yellow : C.dark)}${c.open ? "■" : "·"} ${fg(C.white)}${c.author}${fg(C.dark)} · ${ago(c.at)}${c.open ? "" : " · resolved"}${RESET}`);
      if (c.quote) lines.push(fg(C.green) + pad(`  ▐ "${c.quote}"`, w) + RESET);
      for (const l of wrap(c.body, w - 2).slice(0, 4)) lines.push("  " + fg(C.grey) + l + RESET);
      for (const r of c.replies) lines.push(fg(C.cyan) + pad(`  └ ${r.author} · ${ago(r.at)}: ${r.body.split("\n")[0]}`, w) + RESET);
    }
    const selLine = this.kidLine[this.sel] ?? 0;
    this.top = follow(selLine, this.top, h - 1);
    return { lines: lines.slice(this.top, this.top + h) };
  }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.kids?.length ?? 0;
    if (isUp(k)) { this.sel = Math.max(0, this.sel - 1); desk.redraw(); return true; }
    if (isDown(k)) { this.sel = Math.min(Math.max(0, n - 1), this.sel + 1); desk.redraw(); return true; }
    if (k.kind === "enter" && this.kids?.[this.sel]) { desk.setCurrent(this.kids[this.sel]!, { reveal: true, from: this }); return true; }
    if (ch(k) === "u" && this.msg?.parentId) {
      desk.ctx.board.get(this.msg.parentId).then(p => { if (p) desk.setCurrent(p, { reveal: true, from: this }); }, () => {});
      return true;
    }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const i = this.kidLine.indexOf(this.top + y);
    if (i >= 0) { this.sel = i; desk.redraw(); }
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.top = Math.max(0, this.top + dir * 3); desk.redraw(); }
}

// ── activity (last callers, live) and who's online ───────────────────────────

export class ActivityPane implements Pane {
  readonly kind = "activity";
  private rows: Activity[] | null = null;
  private sel = 0;
  private top = 0;
  private timer: Timer | null = null;
  title() { return "last callers · live"; }
  hint() { return "⏎ open"; }
  init(desk: DeskApi) { this.load(desk); }
  private load(desk: DeskApi) { desk.ctx.board.activity(60).then(r => { this.rows = r; desk.redraw(); }, () => {}); }
  onEvent(desk: DeskApi) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.load(desk), 1500); }
  render(w: number, h: number, focused: boolean): PaneView {
    if (!this.rows) return { lines: [dim("listening…")] };
    this.top = follow(this.sel, this.top, h);
    return {
      lines: this.rows.slice(this.top, this.top + h).map((r, i) => {
        const aw = Math.max(6, Math.min(16, Math.floor(w / 4), Math.max(...this.rows!.map(x => x.actor.length))));
        const when = ago(r.at).padStart(4), actor = pad(r.actor, aw), subj = subject(r.block);
        if (this.top + i === this.sel) return (focused ? SEL_ON : SEL_OFF) + pad(`${when} ${actor} ${subj}`, w) + RESET;
        const who = r.author === "agent" ? C.lmagenta : r.author === "user" ? C.yellow : C.cyan;
        return fg(C.dark) + when + " " + fg(who) + actor + " " + fg(C.grey) + pad(subj, Math.max(1, w - aw - 6)) + RESET;
      }),
    };
  }
  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows?.length ?? 0;
    if (isUp(k)) { this.sel = Math.max(0, this.sel - 1); desk.redraw(); return true; }
    if (isDown(k)) { this.sel = Math.min(Math.max(0, n - 1), this.sel + 1); desk.redraw(); return true; }
    if (k.kind === "enter" && this.rows?.[this.sel]) { desk.setCurrent(this.rows[this.sel]!.block, { reveal: true, from: this }); return true; }
    if (ch(k) === "r") { this.load(desk); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) { this.sel = this.top + y; desk.redraw(); }
  wheel(dir: 1 | -1, desk: DeskApi) { this.sel = Math.max(0, this.sel + dir * 3); desk.redraw(); }
}

export class WhoPane implements Pane {
  readonly kind = "who";
  private callers: Caller[] | null = null;
  private names = new Map<string, string>();
  title() { return `who's online${this.callers ? ` · ${this.callers.length}` : ""}`; }
  hint() { return "r refresh"; }
  init(desk: DeskApi) { this.load(desk); }
  onEvent(desk: DeskApi) { this.load(desk); }
  private load(desk: DeskApi) {
    desk.ctx.board.callers().then(c => {
      this.callers = c; desk.redraw();
      for (const x of c) if (x.target && !this.names.has(x.target)) {
        this.names.set(x.target, "…");
        desk.ctx.board.get(x.target).then(m => { if (m) { this.names.set(x.target!, subject(m)); desk.redraw(); } }, () => {});
      }
    }, () => {});
  }
  render(w: number, _h: number, _f: boolean, desk: DeskApi): PaneView {
    if (!this.callers) return { lines: [dim("polling nodes…")] };
    return {
      lines: this.callers.map((c, i) => {
        const you = c.id === desk.ctx.board.clientId;
        const act = c.target ? this.names.get(c.target) ?? "…" : c.activity;
        return `${fg(C.lcyan)}${String(i + 1).padStart(2)} ${fg(you ? C.yellow : C.white)}${pad(you ? "you" : c.name, 9)}${fg(C.grey)}${pad(act, w - 12)}${RESET}`;
      }),
    };
  }
  key(k: Key, desk: DeskApi): boolean { if (ch(k) === "r") { this.load(desk); return true; } return false; }
}

// ── the ep0ch art as a pane ──────────────────────────────────────────────────

const PIECES = ["SHY-EPO!.ANS", "SHY-EMNU.ANS", "SHY-LOGI.ANS", "SHY-BBS.ANS", "SHY-NUA.ANS", "MR-EPOCH.ANS", "X!-EPOCH.ANS", "SHY-EP0C.ANS", "SHY-DASH.ANS"];
const pieceCache = new Map<string, Art | null>();

export class ArtPane implements Pane {
  readonly kind = "art";
  private i = 0;
  private scroll = 0;
  private get art(): Art | null {
    const f = PIECES[this.i]!;
    if (!pieceCache.has(f)) { try { const m = find(f); pieceCache.set(f, m ? loadArt(m) : null); } catch { pieceCache.set(f, null); } }
    return pieceCache.get(f)!;
  }
  title() { const s = this.art?.sauce; return s ? `bulletin · ${s.title} · ${s.author}` : "bulletin"; }
  hint() { return ", . piece · j k scroll"; }
  render(w: number, h: number, _f: boolean, desk: DeskApi): PaneView {
    const art = this.art;
    if (!art) return { lines: [dim("art packs not found")] };
    const t = desk.ctx.t;
    if (!desk.ctx.graphics) return { lines: artLines(art.rows, 0, this.scroll, Math.min(w, art.width), h) };
    const img = whole(art.rows, art.width);
    if (!img) return { lines: [dim("piece too tall for a pane")] };
    // Fit the width; if the piece is taller than the pane, show a window of it.
    let cols = w;
    let fullRows = (cols * t.cellW * img.height) / img.width / t.cellH;
    if (fullRows < 1) return { lines: [] };
    const rows = Math.min(h, Math.max(1, Math.round(fullRows)));
    const visible = rows / fullRows;
    const maxScroll = Math.max(0, img.height - Math.round(img.height * visible));
    const y = Math.min(maxScroll, this.scroll * 16);
    const crop = visible < 1 ? { x: 0, y, w: img.width, h: Math.round(img.height * visible) } : undefined;
    if (visible >= 1 && rows < h) cols = w;
    return { lines: [], placements: [{ key: "art", image: img, col: 0, row: 0, cols, rows, z: -1, crop }] };
  }
  key(k: Key, desk: DeskApi): boolean {
    const c = ch(k);
    if (c === "." || c === ",") { this.i = (this.i + (c === "." ? 1 : PIECES.length - 1)) % PIECES.length; this.scroll = 0; desk.redraw(); return true; }
    if (isDown(k)) { this.scroll += 2; desk.redraw(); return true; }
    if (isUp(k)) { this.scroll = Math.max(0, this.scroll - 2); desk.redraw(); return true; }
    return false;
  }
  wheel(dir: 1 | -1, desk: DeskApi) { this.scroll = Math.max(0, this.scroll + dir * 2); desk.redraw(); }
}

export function makePane(kind: PaneKind): Pane {
  switch (kind) {
    case "tree": return new TreePane();
    case "reader": return new ReaderPane();
    case "thread": return new ThreadPane();
    case "activity": return new ActivityPane();
    case "who": return new WhoPane();
    case "art": return new ArtPane();
  }
}
