// The panes a desk can hold. Each renders into its own inner rectangle; the desk draws borders.
import { follow, RowView, wheelRows } from "../scroll";
import type { Art } from "../ansi";
import { whole } from "../art-view";
import type { Ctx } from "../app";
import { isOutlineNote } from "../authored";
import { subject, type Caller, type Msg } from "../board";
import type { Scroll } from "../canvas";
import type { Placement } from "../kitty";
import { find, loadArt } from "../packs";
import type { Activity, Actor, Comment } from "../socket";
import { NoteSurface, propertyChange, type OpenHow, type SurfaceHost } from "../surface/note";
import { artLines, bg, C, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { ago, wrap } from "../text";
import { withoutPropertyTokens } from "../vendor/property-grammar";

export type PaneKind = "tree" | "reader" | "thread" | "activity" | "who" | "art"
  /** Tiles (PIE-413): a reader that keeps its note, one that follows a tile or a file, a program, a whole screen. */
  | "detail" | "preview" | "pty" | "board" | "river" | "brief"
  /** The backlinks of what another tile shows (PIE-432). */
  | "backlinks";
export interface PaneView { lines: string[]; placements?: Placement[]; scroll?: Scroll }

export interface DeskApi {
  ctx: Ctx;
  current: Msg | null;
  /** `link`, `fresh`, `agent`: how a reader opened it (OpenHow, PIE-441), for where it goes. */
  setCurrent(m: Msg | null, opts?: { reveal?: boolean; from?: Pane } & OpenHow): void;
  focusKind(kind: PaneKind): void;
  redraw(): void;
  /** The summary keys of the view a note is shown from (a board lane's `[summary-properties::…]`). */
  summaryKeys?(m: Msg): readonly string[] | null;
  /** Start a session in `pane` as the person's key does, so they're in it (a comment mark's ⏎ or click). */
  startSession?(pane: ReaderPane, kind: SessionKind): void;
  /** `pane` is the reader the person has focused: an agent's back and forward are refused there (PIE-453). */
  holdsFocus?(pane: ReaderPane): boolean;
  /** Opens from `pane` land in another tile (its link, PIE-473, or the view's open rule): it doesn't follow them in place. */
  routes?(pane: Pane): boolean;
  /** What tile `name` shows or has selected (a backlinks tile lists the backlinks of its source's note). */
  tileShowing?(name: string): Msg | null;
  /** A selection moved in `from`: the previews following it and its link show `m`; the current note stays. */
  showFrom?(from: Pane, m: Msg, agent?: boolean): void;
}

export interface Pane {
  /** "exhibit": a pane a view brings to a preset desk (the showcase's); it's never saved to desk.json. */
  readonly kind: PaneKind | "exhibit";
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
  /** The tile was just given the keys (a Tab, a click, `tile.focus`), by `actor`. */
  focused?(desk: DeskApi, actor: Actor): void;
  /**
   * Every mouse event inside the tile, at x, y in it (a terminal tile, a whole screen): true when the tile
   * took it. Without it the desk sends clicks and the wheel as above.
   */
  mouse?(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean;
  /** What the tile needs to be built again (a layout saved by name): its note, command, source. */
  spec?(): Record<string, unknown>;
  /** The tile is going away for good (closed, or its layout replaced): a program is ended. */
  dispose?(): void;
}

const SEL_ON = bg(C.blue) + fg(C.white);
const SEL_OFF = "\x1b[48;2;22;30;58m" + fg(C.white);
const dim = (s: string) => fg(C.dark) + s + RESET;
const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");
const isUp = (k: Key) => k.kind === "up" || ch(k) === "k";
const isDown = (k: Key) => k.kind === "down" || ch(k) === "j";

// ── outline tree: src/desk/tree.ts ─────────────────────────────────────────────

export { TreePane } from "./tree";
import { TreePane } from "./tree";

// ── reader ───────────────────────────────────────────────────────────────────

/** Comment and reply blocks: stored as children of the note they're about. */
const isAnnotation = (m: Msg) => m.props.type === "annotation" || m.props.type === "annotation-reply";

export { propertyChange };

/**
 * A reader is a note surface (src/surface/note.ts) hosted in a pane: the surface shows, edits and
 * comments on the note; the reader adds pinning and tells the desk or board when a link is followed.
 */
export class ReaderPane implements Pane {
  /** "detail": a tile that keeps its note (held from the start); "preview": one that follows a tile or a file. */
  readonly kind: "reader" | "detail" | "preview" = "reader";
  readonly surface = new NoteSurface();
  private held = false;
  /**
   * `follows`: this reader shows the view's current note as it changes (the desk's readers), so `p` holds
   * it on the note it shows. Readers that never follow (the board's preview, details, drawers and floats)
   * have nothing to hold, so they don't offer it. ("Pin" is kept for a drawer joining the layout.)
   */
  constructor(readonly follows = false) {}
  get msg() { return this.surface.msg; }
  /** Held on its note (p, or alt+⏎): it doesn't follow the current note. */
  get holding() { return this.held; }
  get draft() { return this.surface.draft; }
  get session() { return this.surface.session; }
  get comments() { return this.surface.comments; }
  get unread() { return this.surface.unread; }
  get editing() { return this.surface.editing; }
  /** Every key goes to the surface first (an edit, or the property panel); hosts route to it before their own. */
  get holdsKeys() { return this.surface.holdsKeys; }
  /** Hold `m` (a desk reader opened by alt+⏎ on a link): it keeps its note as the current one changes. */
  hold(m: Msg, desk: DeskApi) { this.held = this.follows; this.show(m, desk); }
  /** Held before it has a note (a detail tile waiting for its first open): the current note doesn't move it. */
  holdOn() { this.held = this.follows; }
  unsaved() { return this.surface.unsaved(); }
  keepDrafts(): string[] { return this.surface.keepDrafts(); }
  dispose() { this.surface.dispose(); }
  title() {
    const st = this.surface.state();
    return ["reader", this.held ? "held" : "", st].filter(Boolean).join(" · ");
  }
  hint() { return this.surface.hint(this.follows ? (this.held ? "p follow · " : "p hold · ") : ""); }

  /** The surface's host: this pane's desk or board, and where a followed link opens. */
  host(desk: DeskApi): SurfaceHost {
    const h: SurfaceHost = {
      ctx: desk.ctx,
      redraw: () => desk.redraw(),
      // A held reader follows its own links in place; a new reader (alt+⏎) leaves it on its note.
      navigate: (m, how) => { if (this.held && !how?.fresh && !desk.routes?.(this)) this.surface.show(m, h); desk.setCurrent(m, { reveal: true, from: this, ...how }); },
      summaryKeys: m => desk.summaryKeys?.(m),
      startSession: desk.startSession ? kind => desk.startSession!(this, kind) : undefined,
      focused: desk.holdsFocus?.(this) ?? false,
    };
    return h;
  }

  select(m: Msg | null, desk: DeskApi) { if (!this.held) this.show(m, desk); }
  refresh(m: Msg) { this.surface.refresh(m); }
  show(m: Msg | null, desk: DeskApi) { return this.surface.show(m, this.host(desk)); }
  retry(desk: DeskApi) { this.surface.retry(this.host(desk)); }
  render(w: number, h: number, _focused = false, desk?: DeskApi): PaneView { return this.surface.render(w, h, desk && this.host(desk)); }
  edit(desk: DeskApi, external = false, still?: () => boolean) { return this.surface.edit(this.host(desk), external, still); }
  save(desk: DeskApi) { return this.surface.save(this.host(desk)); }
  loadComments(desk: DeskApi) { return this.surface.loadComments(this.host(desk)); }
  onEvent(desk: DeskApi) { this.surface.onEvent(this.host(desk)); }
  comment(desk: DeskApi, mode: "select" | "threads", still?: () => boolean) { return this.surface.comment(this.host(desk), mode, still); }
  /** The draft, comment session or property panel holding the reader's keys, or null while reading. */
  sessionOf() { return this.surface.sessionOf(); }
  /** j k, arrows, PgUp PgDn, space, Home End scroll the note while it is shown (not under a draft or a comment; see NoteSurface.scrollKey). */
  scrollKey(k: Key, desk: DeskApi) { return this.surface.scrollKey(k, this.host(desk)); }
  /** Run a note action (NOTE_ACTIONS) in this reader as `actor`: what the keys do, callable by an agent. */
  act(name: string, args: Record<string, unknown>, desk: DeskApi, actor: Actor) { return this.surface.act(name, args, this.host(desk), actor); }
  describe() { return { title: this.title(), held: this.held, ...this.surface.describe() }; }

  /** Showing a note that isn't a block (a Resource, a file): it is read here, never edited or commented on. */
  get readOnly(): boolean { return !!this.msg && !isOutlineNote(this.msg); }

  key(k: Key, desk: DeskApi): boolean {
    if (this.readOnly && !this.holdsKeys && sessionStart(k)) { desk.ctx.flash(`${subject(this.msg!)} is shown here to read · it isn't a note in the outline`); return true; }
    if (this.follows && !this.editing && ch(k) === "p") { this.held = !this.held; if (!this.held) this.show(desk.current, desk); desk.redraw(); return true; }
    return this.surface.key(k, this.host(desk));
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.surface.wheel(dir, this.host(desk)); }
  /**
   * A click at `x`, `y` in the pane: a completion candidate is inserted, a link opens (where ⏎ on it
   * would, or through `open` when the host says otherwise), a property row is picked, a heading or a
   * list item's mark folds or unfolds.
   */
  click(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void): boolean {
    const h = this.host(desk);
    return this.surface.click(x, y, open ? { ...h, navigate: open } : h);
  }
  /**
   * The mouse in the pane (PIE-419): press, drag, release. A release on the pressed cell is the click
   * above (with `open` as there); a drag selects text instead, and never copies it.
   */
  press(x: number, y: number, desk: DeskApi) { this.surface.press(x, y, this.host(desk)); }
  drag(x: number, y: number, desk: DeskApi) { this.surface.drag(x, y, this.host(desk)); }
  release(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void): boolean {
    const h = this.host(desk);
    return this.surface.release(x, y, open ? { ...h, navigate: open } : h);
  }
}

// ── which reader session the person is in (PIE-411) ──────────────────────────

/** A key that starts a session in a reader: e edit, ctrl+e $EDITOR, C quote (c collapses), m threads, i / I properties. */
export type SessionKind = "edit" | "external" | "select" | "threads" | "props" | "props-full";
export function sessionStart(k: Key): SessionKind | null {
  if (k.kind !== "char") return null;
  if (k.ctrl) return k.ch === "e" ? "external" : null;
  return k.ch === "e" ? "edit" : k.ch === "C" ? "select" : k.ch === "m" ? "threads" : k.ch === "i" ? "props" : k.ch === "I" ? "props-full" : null;
}

/**
 * Start a session by the person's key. An edit or a comment reads the note first; `still` says, once it
 * has, whether they still want it (they may have pressed esc or moved to another area meanwhile), and if
 * not nothing opens. True (at once for the panel, or once read) when the reader holds a session.
 */
export function startSession(pane: ReaderPane, kind: SessionKind, desk: DeskApi, still: () => boolean): true | Promise<boolean> {
  // The property panel opens at once, so the next key is already its.
  if (kind === "props" || kind === "props-full") { pane.surface.openPanel(kind === "props-full"); desk.redraw(); return true; }
  const opening = kind === "edit" || kind === "external" ? pane.edit(desk, kind === "external", still) : pane.comment(desk, kind, still);
  return opening.then(() => pane.sessionOf() !== null);
}

/** "the edit", "an agent's (claude-7) edit", "the comment", "the property panel": for hints and flashes. */
export function sessionName(p: ReaderPane): string {
  const s = p.surface;
  const what = s.draft ? "edit" : s.session ? "comment" : "property panel";
  const typed = s.draft?.writers ?? s.session?.composer?.writers ?? [];
  const agents = [...new Set(typed.filter(w => w.kind === "agent").map(w => (w as { id: string }).id))];
  return agents.length ? `an agent's (${agents.join(", ")}) ${what}` : `the ${what}`;
}

/**
 * The reader session (edit, comment, property panel) the person is in. Only that one takes their keys: one
 * they opened by key is entered as it opens; one an agent opened, or theirs after they moved to another
 * area, is entered with e or ⏎. Until then the host's keys keep working and j k PgDn scroll the reader,
 * so an agent's session never takes the person's keys (the river does the same, PIE-407).
 */
export class Entered {
  private at: { pane: ReaderPane; of: object } | null = null;
  /** The person is in `p`'s current session. */
  in(p: ReaderPane | null | undefined): boolean { const e = this.at; return !!p && !!e && e.pane === p && e.of === p.sessionOf(); }
  enter(p: ReaderPane) { const of = p.sessionOf(); this.at = of ? { pane: p, of } : null; }
  clear() { this.at = null; }
  /** Focus is on `p` now: a session anywhere else is left (entering it again takes e or ⏎). */
  follow(p: ReaderPane | null | undefined) { if (this.at && this.at.pane !== p) this.at = null; }
}

// ── thread: replies (children) and comment threads ───────────────────────────

export class ThreadPane implements Pane {
  readonly kind = "thread";
  private msg: Msg | null = null;
  private kids: Msg[] | null = null;
  private comments: Comment[] | null = null;
  private sel = 0;
  private view = new RowView();
  private kidLine: number[] = [];
  title() { return this.kids ? `thread · ${this.kids.length} repl${this.kids.length === 1 ? "y" : "ies"} · ${this.comments?.length ?? "…"} comment${this.comments?.length === 1 ? "" : "s"}` : "thread"; }
  hint() { return "⏎ open reply · u up · comment from a reader: c, m"; }

  select(m: Msg | null, desk: DeskApi) {
    this.msg = m; this.kids = null; this.comments = null; this.sel = 0; this.view.reset();
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
      const snippet = k.text.split("\n").slice(1).map(l => withoutPropertyTokens(l).trim()).find(Boolean) ?? "";
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
    const top = this.view.place(selLine, lines.length, h);
    return { lines: lines.slice(top, top + h) };
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
    const i = this.kidLine.indexOf(this.view.top + y);
    if (i >= 0) { this.sel = i; desk.redraw(); }
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.view.scroll(wheelRows(dir)); desk.redraw(); }
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
  wheel(dir: 1 | -1, desk: DeskApi) { this.sel = Math.max(0, Math.min((this.rows?.length ?? 1) - 1, this.sel + dir)); desk.redraw(); }
}

export class WhoPane implements Pane {
  readonly kind = "who";
  private callers: Caller[] | null = null;
  private names = new Map<string, string>();
  private asking = new Set<string>();
  title() { return `who's online${this.callers ? ` · ${this.callers.length}` : ""}`; }
  hint() { return "r refresh"; }
  init(desk: DeskApi) { this.load(desk); }
  onEvent(desk: DeskApi) { this.load(desk); }
  private load(desk: DeskApi) {
    desk.ctx.board.callers().then(c => {
      this.callers = c; desk.redraw();
      // Titles only, in one read where the service can (blocks.read).
      // Only names that were read are kept; a failed or missing one is asked again on the next load.
      const ids = [...new Set(c.map(x => x.target).filter((t): t is string => !!t && !this.names.has(t) && !this.asking.has(t)))];
      if (!ids.length) return;
      for (const id of ids) this.asking.add(id);
      const done = () => { for (const id of ids) this.asking.delete(id); desk.redraw(); };
      desk.ctx.board.readMany(ids, ["title"]).then(ms => { for (const m of ms) this.names.set(m.id, subject(m)); done(); }, done);
    }, () => {});
  }
  render(w: number, _h: number, _f: boolean, desk: DeskApi): PaneView {
    if (!this.callers) return { lines: [dim("polling nodes…")] };
    return {
      lines: this.callers.map((c, i) => {
        const you = c.id === desk.ctx.board.clientId;
        const act = c.target ? this.names.get(c.target) ?? (this.asking.has(c.target) ? "…" : c.activity || c.target.slice(0, 8)) : c.activity;
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

export function makePane(kind: "tree" | "reader" | "thread" | "activity" | "who" | "art"): Pane {
  switch (kind) {
    case "tree": return new TreePane();
    case "reader": return new ReaderPane(true);
    case "thread": return new ThreadPane();
    case "activity": return new ActivityPane();
    case "who": return new WhoPane();
    case "art": return new ArtPane();
  }
}
