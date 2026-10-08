// The panes a desk can hold. Each renders into its own inner rectangle; the desk draws borders.
import { RowView, wheelRows, type RowPress } from "../scroll";
import type { Art } from "../ansi";
import { whole } from "../art-view";
import type { Ctx } from "../app";
import { isOutlineNote } from "../authored";
import { subject, type Caller, type Msg } from "../board";
import type { Scroll } from "../canvas";
import type { Placement } from "../kitty";
import { find, loadArt } from "../packs";
import type { Activity, Actor, Comment } from "../socket";
import { shortId } from "../refs";
import { ActionRefused, ActionSet, actionSet, def } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { ART_ACTIONS, type ArtAbout } from "../art-actions";
import { NOTE_ACTIONS, NoteSurface, navNote, propertyChange, sessionStart, type OpenHow, type SessionKind, type SurfaceHost } from "../surface/note";
import { artLines, C, dim, fg, pad, RESET, selected } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago, wrap } from "../text";
import type { TileKindName } from "./tile-kinds";
import type { ListPicker } from "../surface/picker";
import { newNoteOffer, type KeySpot } from "../new-note";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";

/** `spots`: parts of its rows a click presses a key on (an empty place's `+ New note`: ctrl+n, newNoteOffer). */
export interface PaneView { lines: string[]; placements?: Placement[]; scroll?: Scroll; spots?: KeySpot[] }

export interface DeskApi {
  ctx: Ctx;
  current: Msg | null;
  /** `link`, `fresh`, `agent`: how a reader opened it (OpenHow, PIE-441), for where it goes. */
  setCurrent(m: Msg | null, opts?: { reveal?: boolean; from?: Pane } & OpenHow): void;
  focusKind(kind: TileKindName): void;
  redraw(): void;
  /** Save the screen's layout now (a reader's history changed, PIE-643). */
  keepLayout?(): void;
  /** The summary keys of the view a note is shown from (a board lane's `[summary-properties::…]`). */
  summaryKeys?(m: Msg): readonly string[] | null;
  /** Start a session in `pane` as the person's key does, so they're in it (a comment mark's ⏎ or click). */
  startSession?(pane: ReaderPane, kind: SessionKind): void;
  /**
   * A tile's own key or click, as the person, through the screen's dispatcher (PIE-514): the action of `set` (its kind's,
   * a reader's note actions), in tile `p`. `quiet`: the action says its own refusal.
   */
  press?(p: Pane, set: ActionSet<any, any>, name: string, args?: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), given?: unknown): Promise<unknown>;
  /** Tile `p` has the person's focus here (a whole screen in a tile sees the person through it). */
  hasFocus?(p: Pane): boolean;
  /** Esc found nothing left to close in a tile's own screen (a screen tile's): the desk's next step out, or nothing to close. */
  escaped?(): void;
  /** Opens from `pane` land in another tile (its link, PIE-473, or the view's open rule): it doesn't follow them in place. */
  routes?(pane: Pane): boolean;
  /** What tile `name` shows or has selected (a backlinks tile lists the backlinks of its source's note). */
  tileShowing?(name: string): Msg | null;
  /** A selection moved in `from`: the previews following it and its link show `m`; the current note stays. */
  showFrom?(from: Pane, m: Msg): void;
  /**
   * Run an action as `by`, in tile `tile` (or the action's own default): the person's as their key does, an agent's as
   * its `act` does, a refusal said either way. A tile kind's code reaches another action (the brief steps to a day) by it.
   */
  perform?(action: string, args: Record<string, unknown>, by?: Actor, tile?: Pane | string): Promise<unknown>;
  /**
   * A list picker over the screen, from a tile (the home base's choices: a name to type, a machine to add): the desk's
   * overlay, which holds the person's keys until it's put away. A choice runs the tile's action as the person.
   */
  overlay?(p: ListPicker<any, any>): void;
  /** The tile `p`'s opens land in (its link, or its container's opens-into), if any. */
  linked?(p: Pane): Pane | undefined;
  /** The actor rule for a step that moves the person's screen on the way (an open that steps the brief): why not, or null. */
  ruleFor?(touches: "tile" | "screen", actor: Actor): string | null;
  /** The keys to tile `p`, as `tile.focus` gives them; an agent's never moves them. */
  focusPane?(p: Pane, actor: Actor): void;
  /** The person's keys are held here right now (typing, a picker, a ^W chord): a screen's own key waits. */
  holdsKeys?(): boolean;
  /** Tile `p` is on screen now (not in a shut dock, not a hidden tab). */
  shownNow?(p: Pane): boolean;
  /** Where back (-1) or forward (1) from tile `p`'s column of a flow goes: that column's tile's title, or null. */
  travelPeek?(p: Pane, dir: -1 | 1): string | null;
  /** Run an action as `by` in tile `p` through the screen's dispatcher, its refusal thrown (what an agent's `act` does). */
  within?(action: string, args: Record<string, unknown>, by: Actor, p?: Pane): Promise<unknown>;
  /** The person's key running a screen action in tile `p` (a refusal said, as any key's). */
  perform?(action: string, args: Record<string, unknown>, by?: Actor, p?: Pane | string): Promise<unknown>;
  /** How tile `p` shows in its flow: full, peek or spine (undefined outside one). */
  coverOf?(p: Pane): "full" | "peek" | "spine" | undefined;
  /** The tile named `name` on this screen. */
  pane?(name: string): Pane | undefined;
  /** Reader `p`'s note went to the trash empty (a new note closed unwritten): a tile made for it alone goes (PIE-591). */
  noteGone?(p: Pane, id: string): void;
  /** Tile `p`'s name (what `tile=` and `open from=` take). */
  nameOfPane?(p: Pane): string;
  /** Tile `p` is in a dock (not pinned in the layout). */
  inDock?(p: Pane): boolean;
  /** The side of the screen tile `p` is on (its dock's edge, else where it's placed). */
  sideOf?(p: Pane): "left" | "right";
  /**
   * The person's backlinks (`b`): tile `p` lists the backlinks of `m` (else of the note the reader they read through
   * shows), following the reader that shows it; its dock slides open and their keys go to it.
   */
  aimBacklinks?(p: Pane & { source: string; show(m: Msg, desk: DeskApi): Promise<void> }, m: Msg | null): Promise<void>;
  /**
   * The links of reader `r`'s note (`b`, the note action `links`): the screen's links tile aims at it, or, on a
   * screen without one, a links tile opens below the reader with a preview following it. The person's keys go to
   * the list; an agent's leaves them where they are.
   */
  openLinks?(r: Pane, actor: Actor): Promise<Record<string, unknown>>;
  /** A new tile of `t.kind` in tile `tile`'s place, which goes (the blank tile's rows, PIE-565). */
  replaceTile?(tile: string | undefined, t: { kind: string; view?: string; cmd?: string; name?: string }, actor: Actor): Promise<Record<string, unknown>>;
  /** The person picks what a new tile of `kind` lacks from its kind's `choices` (a query lane's view); `then` opens it. */
  askChoices?(kind: string, then: (spec: Record<string, unknown>) => void): Promise<boolean>;
  /** The screens to open from here, in a picker over the screen (the person's). */
  screenPicker?(): void;
  /** The screens to open from here: the ones people made, then the built-ins that open on nothing in particular. */
  screensToOpen?(): { name: string; made: boolean }[];
}

export interface Pane {
  /** Its kind in the tile-kind registry; "exhibit" (unregistered): a pane a host gives a screen of its own (the showcase's exhibits), never saved to desk.json. */
  readonly kind: TileKindName;
  title(): string;
  hint(): string;
  /** `typing`: the person is typing in it (a terminal shows its cursor then). */
  render(w: number, h: number, focused: boolean, desk: DeskApi, typing?: boolean): PaneView;
  /** Return true when the pane used the key. */
  key(k: Key, desk: DeskApi): boolean;
  /**
   * A key the tile takes ahead of the desk's own (tab cycles tiles) and its kind's (a river column's ← →): a reader's
   * while its current element is a live figure's (its tabs, its density).
   */
  claims?(k: Key): boolean;
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
   * took it. Without it the desk sends clicks and the wheel as above. `press`, with a press: its modifiers and
   * button, and whether it gave the tile the keys (a list's `RowView.press` reads it: that press only selects).
   */
  mouse?(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean;
  /** A right-click at x, y is its own (a program that asked for the mouse, a reader's step box): the tile's menu doesn't open there. */
  ownsRightClick?(x: number, y: number): boolean;
  /** The tile it follows selected `m` (a preview): it shows it. */
  follow?(m: Msg | null, desk: DeskApi): void;
  /** The terminal tile it follows is on file `path` now (nvim changed buffer). */
  followFile?(path: string | null | undefined, desk: DeskApi): void;
  /** What the tile needs to be built again (a layout saved by name): its note, command, source. */
  spec?(): Record<string, unknown>;
  /** The tile is going away for good (closed, or its layout replaced): a program is ended. */
  dispose?(): void;
  /** What its header says after its name, already coloured (a lane: its count), instead of its title. */
  headLabel?(): string;
  /**
   * A mark before its name on its header and its tab: what its program says it's doing (a terminal tile's program
   * status, OSC 7501: working, needs you, done, failed), or null.
   */
  headStatus?(now?: number): { glyph: string; sgr: string } | null;
  /**
   * The name its header shows, when that isn't its tile name: a lane is named for its view ("Reading now"),
   * while the tile is `Reading-now` for `tile=`.
   */
  headName?(): string | undefined;
  /** How its frame looks now, when it's its own to say (a lane a card is dragged over): its colour, its hint. */
  frameLook?(focused: boolean): { colour?: number; hint?: string } | null;
  /** Folded to a spine: the title it shows, and marks above it (a draft, new comments). */
  spine?(): { title: string; marks?: string[] };
  /** The person is typing in it (a filter): it holds their keys, as an edit does. */
  typing?(): boolean;
  /** A completion popup is open in what it types: tab chooses a candidate there (PIE-626), never the desk's next tile. */
  completing?(): boolean;
  /** The keys went elsewhere while it was typing: it keeps what was typed (a filter) and stops. */
  blur?(): void;
  /** Folded to a spine (true) or opened again: what it holds stays exactly as it was. */
  folded?(on: boolean): void;
  /**
   * Controls for its header after its title, when they fit in `room` columns (the backlinks' status: sort, kind,
   * stage), each its text, colour and what a click on it does; null when they don't fit (it draws them itself).
   */
  headControls?(room: number, desk: DeskApi): { text: string; sgr: string; press?: () => void }[] | null;
}


/**
 * A tile's own key or click as the person: the action its kind registers (PIE-506), the same one `act` runs on that
 * tile, through the screen's dispatcher (the desk's `press`); a host with none runs it through one of its own.
 * A refusal is said, not thrown.
 */
export function runOwn(set: ActionSet<any, any>, name: string, args: Record<string, unknown>, on: { pane: Pane; desk: DeskApi }) {
  void (on.desk.press ? on.desk.press(on.pane, set, name, args) : Dispatcher.of(set, on, () => on.desk.ctx).press(name, args));
}

/** Row `n` (from 1) of `count`, or why not. */
function rowN(n: number | undefined, sel: number, count: number, what: string): number {
  const i = n === undefined ? sel : n - 1;
  if (!count) throw new ActionRefused(`the ${what} is empty`);
  if (!Number.isInteger(i) || i < 0 || i >= count) throw new ActionRefused(`the ${what} has ${count} row${count === 1 ? "" : "s"}; n is 1-${count}`);
  return i;
}

// ── outline tree: src/desk/tree.ts ─────────────────────────────────────────────

export { TreePane } from "./tree";

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
  readonly kind: TileKindName = "reader";
  readonly surface = new NoteSurface();
  private held = false;
  /**
   * `follows`: this reader shows the view's current note as it changes (the desk's readers), so `p` holds
   * it on the note it shows. Readers that never follow (the board's preview, details, docks and floats)
   * have nothing to hold, so they don't offer it. ("Pin" is kept for a dock joining the layout.)
   */
  constructor(readonly follows = false) {}
  get msg() { return this.surface.msg; }
  claims(k: Key): boolean { return !this.holdsKeys && this.surface.claims(k); }
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
  /** Hold it on its note (on=true), or let it follow the current note again (false); left out, the other way. */
  setHold(on: boolean | undefined, desk: DeskApi): { held: boolean } {
    if (!this.follows) throw new ActionRefused("this reader keeps its own note; it doesn't follow the current one");
    if (this.editing) throw new ActionRefused("the reader holds an edit; it stays on its note until that closes");
    this.held = on ?? !this.held;
    if (!this.held) this.show(desk.current, desk);
    desk.redraw();
    return { held: this.held };
  }
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
    const pane = this;
    const h: SurfaceHost = {
      ctx: desk.ctx,
      // Whether the person's keys are here: an agent's fragment link is revealed only in a reader they aren't in.
      get focused() { return desk.hasFocus ? desk.hasFocus(pane) : undefined; },
      redraw: () => desk.redraw(),
      ...(desk.keepLayout ? { navChanged: () => desk.keepLayout!() } : {}),
      // A held reader follows its own links in place; a new reader (alt+⏎) leaves it on its note.
      navigate: (m, how) => { if (this.held && !how?.fresh && !desk.routes?.(this)) this.surface.show(m, h); desk.setCurrent(m, { reveal: true, from: this, ...how }); },
      summaryKeys: m => desk.summaryKeys?.(m),
      startSession: desk.startSession ? kind => desk.startSession!(this, kind) : undefined,
      // Its own keys and clicks run its note actions through the screen's dispatcher, where it's a tile.
      ...(desk.press ? { press: (name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), given?: SurfaceHost) => desk.press!(this, NOTE_ACTIONS, name, args, quiet, given) } : {}),
      // `b`: this note's links in the screen's links tile (one opened beside it where there's none).
      ...(desk.openLinks ? { links: (actor: Actor) => desk.openLinks!(this, actor) } : {}),
      ...(desk.noteGone ? { gone: (id: string) => desk.noteGone!(this, id) } : {}),
      // A reader that follows another tile takes `p` (hold) before the surface does.
      ...(this.follows ? { ownKeys: "p" } : {}),
    };
    return h;
  }

  select(m: Msg | null, desk: DeskApi) { if (!this.held) this.show(m, desk); }
  refresh(m: Msg) { this.surface.refresh(m); }
  /** Read its note again (NoteSurface.reread: one read at a time, a draft only marked). */
  reread(desk: DeskApi) { this.surface.reread(this.host(desk)); }
  show(m: Msg | null, desk: DeskApi) {
    const shown = this.surface.show(m, this.host(desk));
    // The history a saved layout brought (PIE-643) is taken up with the note it was saved on (`wantNote`).
    if (shown && m && this.wantNav !== undefined && this.wantNote() === m.id) { const nav = this.wantNav; this.wantNav = undefined; this.surface.restoreNav(nav); }
    return shown;
  }
  /** The history a saved layout brought, until the reader shows the note it was saved on (NoteSurface.restoreNav). */
  wantNav: unknown;
  /** The note the saved layout had this reader on, until it shows it (or `dropWant`: it couldn't). */
  wantNote(): string | null { return this.wantNav === undefined ? null : navNote(this.wantNav); }
  dropWant() { this.wantNav = undefined; }
  /** What a layout saves of a reader: its place and its back and forward stacks (PIE-643). */
  spec(): Record<string, unknown> { const nav = this.wantNav ? this.wantNav : this.surface.saveNav(); return nav ? { nav } : {}; }
  retry(desk: DeskApi) { this.surface.retry(this.host(desk)); }
  /** The tiles whose opens land here (their link, or their container's opens-into): set by the desk as it draws. */
  landsFrom: string[] = [];
  /** What an empty one says it's for: where its notes come from, and how to get one there. */
  protected emptyFor(): string {
    if (this.landsFrom.length) return `what you open in ${this.landsFrom.join(" or ")} lands here`;
    return this.follows && !this.holding ? "shows the current note: pick one in the outline, or / searches" : "keeps the note opened into it · alt+l in another tile, then a click here, sends that tile's opens here";
  }
  render(w: number, h: number, _focused = false, desk?: DeskApi): PaneView {
    const v = this.surface.render(w, h, desk && this.host(desk));
    if (this.msg || this.surface.draft || h < 3) return v;
    // An empty reader (^W o d) says what it's for, and offers a note to write in it: ctrl+n here makes one and opens it in this tile.
    // What it says, cut to leave room for the offer under it (its click inside the tile).
    const said = wrap(this.emptyFor(), Math.max(10, w - 1)).slice(0, Math.max(1, h - 2)).map(l => fg(C.dark) + l + RESET);
    const { line, spot } = newNoteOffer(said.length + 1);
    return { ...v, lines: [...said, "", line], spots: [spot] };
  }
  save(desk: DeskApi) { return this.surface.save(this.host(desk)); }
  loadComments(desk: DeskApi) { return this.surface.loadComments(this.host(desk)); }
  onEvent(desk: DeskApi) { this.surface.onEvent(this.host(desk)); }
  /** The draft, comment session or property panel holding the reader's keys, or null while reading. */
  sessionOf() { return this.surface.sessionOf(); }
  /** j k, arrows, PgUp PgDn, space, Home End scroll the note while it is shown (not under a draft or a comment; see NoteSurface.scrollKey). */
  scrollKey(k: Key, desk: DeskApi) { return this.surface.scrollKey(k, this.host(desk)); }
  /** Run a note action (NOTE_ACTIONS) in this reader as `actor`: what the keys do, callable by an agent. */
  act(name: string, args: Record<string, unknown>, desk: DeskApi, actor: Actor) { return desk.within ? desk.within(name, args, actor, this) : this.surface.act(name, args, this.host(desk), actor); }
  describe() { return { title: this.title(), held: this.held, ...this.surface.describe() }; }

  // ── folded to a spine (tile.collapse): what it holds is kept; comments arriving meanwhile mark the spine ──

  /** The note's comment and reply ids when it was folded (null until they're read); undefined while open. */
  private foldSeen: Set<string> | null | undefined = undefined;
  private commentIds(): Set<string> | null { return this.comments ? new Set(this.comments.flatMap(t => [t.id, ...t.replies.map(r => r.id)])) : null; }
  folded(on: boolean) { this.foldSeen = on ? this.commentIds() : undefined; }
  /** Comments or replies that arrived since it was folded. */
  newComments(): number {
    if (this.foldSeen === undefined) return 0;
    const now = this.commentIds();
    if (!now) return 0;
    if (!this.foldSeen) { this.foldSeen = now; return 0; }       // read for the first time while folded: the baseline
    return [...now].filter(id => !this.foldSeen!.has(id)).length;
  }
  /** Its spine: the note's title; what it holds (✎ an edit, ¶ a comment, ≡ properties) and new comments (■) above it. */
  spine() {
    const s = this.surface, hold = s.draft ? "✎" : s.session ? "¶" : s.panel ? "≡" : "";
    const marks = [hold ? fg(C.yellow) + hold + RESET : fg(C.dark) + "·" + RESET, ...(this.newComments() ? [fg(C.yellow) + "■" + RESET] : [])];
    return { title: this.msg ? subject(this.msg) : this.title(), marks };
  }

  /** Showing a note that isn't a block (a Resource, a file): it is read here, never edited. */
  get readOnly(): boolean { return !!this.msg && !isOutlineNote(this.msg); }
  /**
   * Why `kind` can't start here, or null. A note that isn't a block is read only, but a Resource's text takes
   * comments (PIE-650: C, m): the thread lives in the outline beside it, the Resource is never written.
   */
  refuses(kind: SessionKind): string | null {
    const m = this.msg;
    if (!m || !this.readOnly) return null;
    if ((kind === "select" || kind === "threads") && m.resource && !this.fileSource()) {
      return kind === "select" && m.resource.uncommentable ? `${subject(m)}: ${m.resource.uncommentable}` : null;
    }
    return `${subject(m)} is shown here to read · it isn't a note in the outline`;
  }
  /** A tile following a file on disk (a preview of a path): never a Resource's text. */
  protected fileSource(): boolean { return false; }

  key(k: Key, desk: DeskApi): boolean {
    const start = this.readOnly && !this.holdsKeys ? sessionStart(k) : null;
    if (start) { const why = this.refuses(start); if (why) { desk.ctx.flash(why); return true; } }
    if (this.follows && !this.editing && ch(k) === "p") { runOwn(READER_ACTIONS, "reader.hold", {}, { pane: this, desk }); return true; }
    // O: a reader beside this one where its links open (the desk's tile.preview), so this one never navigates away.
    if (!this.editing && ch(k) === "O" && desk.perform) { void desk.perform("tile.preview", {}, undefined, this); return true; }
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
  ownsRightClick(x: number, y: number): boolean { return this.surface.ownsRightClick(x, y); }
  press(x: number, y: number, desk: DeskApi, shift = false) { this.surface.press(x, y, this.host(desk), shift); }
  drag(x: number, y: number, desk: DeskApi) { this.surface.drag(x, y, this.host(desk)); }
  release(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void): boolean {
    const h = this.host(desk);
    return this.surface.release(x, y, open ? { ...h, navigate: open } : h);
  }
}

// ── which reader session the person is in (PIE-411) ──────────────────────────

export { sessionStart, type SessionKind };

/**
 * Start a session by the person's key, through its note action (PIE-510), as `act` does. An edit or a comment
 * reads the note first; `still` says, once it has, whether they still want it (they may have pressed esc or
 * moved to another area meanwhile), and if not nothing opens. The property panel opens at once, so the next
 * key is already its. True once the reader holds a session; a refusal rejects, unless they moved on.
 */
export function startSession(pane: ReaderPane, kind: SessionKind, desk: DeskApi, still: () => boolean): Promise<boolean> {
  return pane.surface.startAsPerson(kind, pane.host(desk), still).then(() => pane.sessionOf() !== null, e => {
    if (!still()) return false;
    throw e;
  });
}

/** "the edit", "an agent's (claude-7) edit", "the comment", "the property panel": for hints and flashes. */
export function sessionName(p: ReaderPane): string {
  const s = p.surface;
  const what = s.sessionWord() ?? "property panel";
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
  hint() { return "j k pick · ⏎ open reply · u up · comment from a reader: C, m"; }
  /** Its replies (the note's children that aren't comments), as `thread.pick` numbers them. */
  replies(): Msg[] { return this.kids ?? []; }
  get selected() { return this.sel; }
  /** Row `i` is the person's selection. */
  pickRow(i: number, desk: DeskApi) { this.sel = i; desk.redraw(); }
  /** The note this one is under, made the current note (`u`). */
  async up(desk: DeskApi, actor: Actor): Promise<{ id: string }> {
    const id = this.msg?.parentId;
    if (!id) throw new ActionRefused(this.msg ? "this note is at the top" : "no note shown");
    const p = await desk.ctx.board.get(id);
    if (!p) throw new ActionRefused(`nothing answers at ${shortId(id)}`);
    desk.setCurrent(p, { reveal: true, from: this, by: actor });
    return { id: p.id };
  }

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
      lines.push(i === this.sel ? selected(focused) + pad(head, w) + RESET : fg(C.blue) + head.slice(0, 1) + " " + fg(C.yellow) + pad(head.slice(2), w - 2) + RESET);
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
    const n = this.kids?.length ?? 0, on = { pane: this, desk };
    if (isUp(k)) { if (this.sel > 0) runOwn(THREAD_ACTIONS, "thread.pick", { n: this.sel }, on); return true; }
    if (isDown(k)) { if (this.sel + 1 < n) runOwn(THREAD_ACTIONS, "thread.pick", { n: this.sel + 2 }, on); return true; }
    if (k.kind === "enter" && this.kids?.[this.sel]) { runOwn(THREAD_ACTIONS, "thread.pick", { open: true }, on); return true; }
    if (ch(k) === "u" && this.msg?.parentId) { runOwn(THREAD_ACTIONS, "thread.up", {}, on); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const i = this.kidLine.indexOf(this.view.top + y);
    if (i >= 0) runOwn(THREAD_ACTIONS, "thread.pick", { n: i + 1 }, { pane: this, desk });
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.view.scroll(wheelRows(dir)); desk.redraw(); }
}

// ── activity (last callers, live) and who's online ───────────────────────────

export class ActivityPane implements Pane {
  readonly kind = "activity";
  private rows: Activity[] | null = null;
  private sel = 0;
  private view = new RowView();
  private timer: Timer | null = null;
  title() { return "last callers · live"; }
  hint() { return "j k pick · ⏎ open · r reload"; }
  list(): Activity[] { return this.rows ?? []; }
  get selected() { return this.sel; }
  pickRow(i: number, desk: DeskApi) { this.sel = i; desk.redraw(); }
  reload(desk: DeskApi) { this.load(desk); }
  init(desk: DeskApi) { this.load(desk); }
  private load(desk: DeskApi) { desk.ctx.board.activity(60).then(r => { this.rows = r; desk.redraw(); }, () => {}); }
  onEvent(desk: DeskApi) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.load(desk), 1500); }
  render(w: number, h: number, focused: boolean): PaneView {
    if (!this.rows) return { lines: [dim("listening…")] };
    this.view.place(this.sel, this.rows.length, h);
    return {
      lines: this.rows.slice(this.view.top, this.view.top + h).map((r, i) => {
        const aw = Math.max(6, Math.min(16, Math.floor(w / 4), Math.max(...this.rows!.map(x => x.actor.length))));
        const when = ago(r.at).padStart(4), actor = pad(r.actor, aw), subj = subject(r.block);
        if (this.view.top + i === this.sel) return selected(focused) + pad(`${when} ${actor} ${subj}`, w) + RESET;
        const who = r.author === "agent" ? C.lmagenta : r.author === "user" ? C.yellow : C.cyan;
        return fg(C.dark) + when + " " + fg(who) + actor + " " + fg(C.grey) + pad(subj, Math.max(1, w - aw - 6)) + RESET;
      }),
    };
  }
  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows?.length ?? 0, on = { pane: this, desk };
    if (isUp(k)) { if (this.sel > 0) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: this.sel }, on); return true; }
    if (isDown(k)) { if (this.sel + 1 < n) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: this.sel + 2 }, on); return true; }
    if (k.kind === "enter" && this.rows?.[this.sel]) { runOwn(ACTIVITY_ACTIONS, "activity.pick", { open: true }, on); return true; }
    if (ch(k) === "r") { runOwn(ACTIVITY_ACTIONS, "activity.reload", {}, on); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) { const i = this.view.top + y; if (i < (this.rows?.length ?? 0) && i !== this.sel) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: i + 1 }, { pane: this, desk }); }
  headControls(_w: number, desk: DeskApi) { return [{ text: "r reload", sgr: fg(C.grey), press: () => runOwn(ACTIVITY_ACTIONS, "activity.reload", {}, { pane: this, desk }) }]; }
  wheel(dir: 1 | -1, desk: DeskApi) { const i = this.sel + dir; if (i >= 0 && i < (this.rows?.length ?? 0)) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: i + 1 }, { pane: this, desk }); }
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
  /** The callers as last read, as who.refresh answers them. */
  rows() { return (this.callers ?? []).map((c, i) => ({ n: i + 1, name: c.name, host: c.host, activity: c.activity, target: c.target ?? null, reading: c.target ? this.names.get(c.target) ?? null : null })); }
  load(desk: DeskApi) {
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
  key(k: Key, desk: DeskApi): boolean { if (ch(k) === "r") { runOwn(WHO_ACTIONS, "who.refresh", {}, { pane: this, desk }); return true; } return false; }
  headControls(_w: number, desk: DeskApi) { return [{ text: "r refresh", sgr: fg(C.grey), press: () => runOwn(WHO_ACTIONS, "who.refresh", {}, { pane: this, desk }) }]; }
}

export const WHO_ACTIONS = actionSet<{ pane: WhoPane; desk: DeskApi }>()("who", {
  "who.refresh": def({
    summary: "ask the outline again who is attached (every Tree, Detail, door and agent); answers the callers as they were before the new answer lands", keys: "r, a click on r refresh",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { pane, desk }) { pane.load(desk); return { callers: pane.rows() }; },
  }),
});

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
    if (!img) return { lines: [dim("piece too tall for a tile")] };
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
  /** Step `by` pieces (wrapping); the piece starts at its top. */
  step(by: number): ArtAbout { this.i = (((this.i + by) % PIECES.length) + PIECES.length) % PIECES.length; this.scroll = 0; return this.about(); }
  /** Scroll `by` rows (two a step), never above the top. */
  scrollBy(by: number): ArtAbout { this.scroll = Math.max(0, this.scroll + by); return this.about(); }
  /** Where the art is, as art.step and art.scroll answer (src/art-actions.ts: the art viewer's too). */
  about(): ArtAbout { return { piece: PIECES[this.i]!, n: this.i + 1, of: PIECES.length, ice: false, scroll: this.scroll, height: this.art?.height ?? null }; }
  key(k: Key, desk: DeskApi): boolean {
    const c = ch(k), on = { pane: this, desk };
    if (c === "." || c === ",") { runOwn(ART_ACTIONS, "art.step", { by: c === "." ? 1 : -1 }, on); return true; }
    if (isDown(k)) { runOwn(ART_ACTIONS, "art.scroll", { by: 2 }, on); return true; }
    if (isUp(k)) { if (this.scroll > 0) runOwn(ART_ACTIONS, "art.scroll", { by: -2 }, on); return true; }
    return false;
  }
  wheel(dir: 1 | -1, desk: DeskApi) { if (dir > 0 || this.scroll > 0) runOwn(ART_ACTIONS, "art.scroll", { by: dir * 2 }, { pane: this, desk }); }
}


// ── the list tiles' own actions (PIE-506): what their keys and clicks do, by name, for `act` too ──


export const THREAD_ACTIONS = actionSet<{ pane: ThreadPane; desk: DeskApi }>()("thread", {
  "thread.pick": def({
    summary: "pick a reply in a thread tile (tile=<its name>): n from 1, else the selected one; open=true makes it the current note, as ⏎ does. An agent's pick answers the reply and moves nothing of the person's; its open never moves their keys",
    keys: "j k ↑ ↓ click, ⏎ (open)",
    touches: "nothing", replay: "safe", says: r => (r.opened ? `opened reply ${r.row}` : null),
    args: { n: { type: "number", optional: true, about: "the reply, from 1" }, open: { type: "boolean", optional: true, about: "make it the current note, as ⏎ does" } },
    run({ n, open }, { pane, desk }, actor) {
      const all = pane.replies(), i = rowN(n, pane.selected, all.length, "thread");
      const m = all[i]!;
      // An agent's pick is its own (the answer); the person's moves their selection.
      if (actor.kind !== "agent") pane.pickRow(i, desk);
      if (open) desk.setCurrent(m, { reveal: true, from: pane, by: actor });
      return { row: i + 1, id: m.id, title: subject(m), opened: !!open };
    },
  }),
  "thread.up": def({
    summary: "make the note above the thread's (its parent) the current note, as u does; an agent's never moves the person's keys",
    keys: "u",
    touches: "nothing", replay: "safe", says: () => "went up a level",
    args: {},
    run(_, { pane, desk }, actor) { return pane.up(desk, actor); },
  }),
});

export const ACTIVITY_ACTIONS = actionSet<{ pane: ActivityPane; desk: DeskApi }>()("activity", {
  "activity.pick": def({
    summary: "pick a row of the activity tile (last callers, live): n from 1, else the selected one; open=true makes its note the current one, as ⏎ does. An agent's pick answers the row and moves nothing of the person's",
    keys: "j k ↑ ↓ click wheel, ⏎ (open)",
    touches: "nothing", replay: "safe", says: r => (r.opened ? `opened ${String(r.title).slice(0, 40)}` : null),
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, open: { type: "boolean", optional: true, about: "make its note the current one, as ⏎ does" } },
    run({ n, open }, { pane, desk }, actor) {
      const rows = pane.list(), i = rowN(n, pane.selected, rows.length, "activity");
      const r = rows[i]!;
      // An agent's pick is its own (the answer); the person's moves their selection.
      if (actor.kind !== "agent") pane.pickRow(i, desk);
      if (open) desk.setCurrent(r.block, { reveal: true, from: pane, by: actor });
      return { row: i + 1, id: r.block.id, title: subject(r.block), actor: r.actor, at: r.at, opened: !!open };
    },
  }),
  "activity.reload": def({
    summary: "read recent activity again", keys: "r, a click on r reload",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { pane, desk }) { pane.reload(desk); return { reloading: true }; },
  }),
});


export const READER_ACTIONS = actionSet<{ pane: ReaderPane; desk: DeskApi }>()("reader", {
  "reader.hold": def({
    summary: "hold a desk reader (tile=<its name>) on the note it shows, so the current note doesn't move it (on=true), or let it follow the current note again (on=false); left out, the other way. Said on screen when an agent does it",
    keys: "p",
    touches: "tile", replay: "safe", way: "an agent holds a reader the person isn't in", says: r => (r.held ? "held the reader on its note" : "let the reader follow the current note"),
    menu: { label: "hold on this note", group: "Reader", key: "p", now: ({ pane }) => (!pane.follows ? { hide: true } : pane.editing ? { refused: "the reader holds an edit; it stays on its note until that closes" } : pane.holding ? { label: "follow the current note" } : null) },
    args: { on: { type: "boolean", optional: true, about: "true holds, false follows; left out, the other way" } },
    run({ on }, { pane, desk }) { return pane.setHold(on, desk); },
  }),
});
