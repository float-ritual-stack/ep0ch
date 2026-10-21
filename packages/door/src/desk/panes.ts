import { outlineBoards, type NoteAddress } from "./outline-boards";
// The panes a desk can hold. Each renders into its own inner rectangle; the desk draws borders.
import { headedTitle } from "../board";
import { completerOf, type Completer } from "../surface/completer";
import type { Look, TileLooks } from "../look";
import { MARGIN_MODES, type MarginMode } from "../surface/margin";
import type { StyleLayer } from "@ep0ch/outline-core/style-cascade";
import { RowView, type RowPress } from "../scroll";
import type { Art } from "../ansi";
import { whole } from "../art-view";
import type { Ctx } from "../app";
import { isOutlineNote } from "../authored";
import { subject, type Caller, type Msg } from "../board";
import type { Rect, Scroll } from "../canvas";
import type { Placement } from "../kitty";
import { find, loadArt } from "../packs";
import { authorName, USER, type Activity, type Actor } from "../socket";
import { ActionRefused, ActionSet, actionSet, def } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { ART_ACTIONS, type ArtAbout } from "../art-actions";
import { NOTE_ACTIONS, NoteSurface, navNote, propertyChange, sessionStart, type OpenHow, type SessionKind, type SurfaceHost, type TagList } from "../surface/note";
import { artLines, C, dim, fg, pad, RESET, selectedRow, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { rowLines, ago, wrap } from "../text";
import type { TileKindName } from "./tile-kinds";
import type { ListPicker } from "../surface/picker";
import { newNoteOffer, type KeySpot } from "../new-note";
import { prop } from "../props";

/** `spots`: parts of its rows a click presses a key on (an empty place's `+ New note`: ctrl+n, newNoteOffer). */
export interface PaneView { frame?: Rect; headerBand?: { row: number; rows: number; bg: string }; completion?: Completer; gutter?: { row: number; text: string }[]; lines: string[]; placements?: Placement[]; scroll?: Scroll; spots?: KeySpot[] }

export interface DeskApi {
  ctx: Ctx;
  /** The look (PIE-673) the desk resolved for tile `p` as it drew it last: its spacing, list density and where each comes from. */
  lookOf?(p: Pane): Look | undefined;
  /** What the tune inspector sees of tile `name`: its look, kind, title, content width, and in a reader the `::box` its `[ ]` is in. */
  tileLook?(name: string): { look: Look; kind: string; title: string; cols: number; box: { attrs: string; line: number } | null; pictures?: string[]; list?: { target: string | null; layers: StyleLayer[]; first: number; revision?: number } | null } | null;
  /** The tiles' own looks by tile id (PIE-675, "this tile"): what the tune inspector saves into and reads. */
  tileLooks?: TileLooks;
  /** The screens held one inside the next down to this desk (a mount is checked against it). */
  mountChain?(): string[];
  current: Msg | null;
  /** `link`, `fresh`, `agent`: how a reader opened it (OpenHow, PIE-441), for where it goes. */
  setCurrent(m: Msg | null, opts?: { reveal?: boolean; from?: Pane } & OpenHow): void;
  focusKind(kind: TileKindName): void;
  redraw(): void;
  /** Save the screen's layout now (a reader's history changed, PIE-643). */
  keepLayout?(): void;
  holdReader?(pane: ReaderPane, actor: Actor): void;
  /** The place in the door's undo order of this screen's newest layout change, or undefined: a reader's ctrl+z yields to it when it is newer. */
  layoutUndoSeq?(): number | undefined;
  /** The summary keys of the view a note is shown from (a board lane's `[summary-properties::…]`). */
  summaryKeys?(m: Msg): readonly string[] | null;
  /** Start a session in `pane` as the person's key does, so they're in it (a comment mark's ⏎ or click). */
  startSession?(pane: ReaderPane, kind: SessionKind, opener?: Key): void;
  /** The tile named `name` on this screen. */
  paneNamed?(name: string): Pane | undefined;
  /** Close tile `p` as nothing was lost by it (the comment tile once its comment ended). */
  dismiss?(p: Pane): void;
  /** Reader `r`'s comment into a tile of its own beside it (`on`), or that tile closed (PIE-846). */
  answerTile?(r: ReaderPane, ask: string, actor: Actor, fold?: string): Promise<unknown>;
  selectionSource?(p: ReaderPane): Pane | null;
  hasWiredPreview?(p: ReaderPane): boolean;
  hasListPreviewTile?(r: ReaderPane): boolean;
  listPreviewTile?(r: ReaderPane, on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  hasEditPreviewTile?(r: ReaderPane): boolean;
  editPreviewTile?(r: ReaderPane, on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  hasSourcesTile?(r: ReaderPane): boolean;
  sourcesTile?(r: ReaderPane, on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  composerTile?(r: ReaderPane, on: boolean, keys?: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  /** Reader `r`'s comment tile is open. */
  hasComposerTile?(r: ReaderPane): boolean;
  /**
   * A tile's own key or click, as the person, through the screen's dispatcher (PIE-514): the action of `set` (its kind's,
   * a reader's note actions), in tile `p`. `quiet`: the action says its own refusal.
   */
  press?(p: Pane, set: ActionSet<any, any>, name: string, args?: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), given?: unknown): Promise<unknown>;
  /** Tile `p` has the person's focus here (a whole screen in a tile sees the person through it). */
  hasFocus?(p: Pane): boolean;
  /** The person is in tile `p`'s edit, comment or panel (they opened it, or the keys came back to it). */
  isIn?(p: Pane): boolean;
  enterSession?(p: ReaderPane): void;
  /** Esc found nothing left to close in a tile's own screen (a screen tile's): the desk's next step out, or nothing to close. */
  escaped?(): void;
  /**
   * q found nothing left to leave in a tile's own screen (a mount's, a group's): the screen holding it goes back, as q does
   * on any desk (PIE-727: a desk holding only a group took seven presses, each refused on the status bar).
   */
  leave?(): void;
  /** A `#tag` opened in reader `r` (PIE-800): the notes carrying it, in a query tile whose home is `r`. */
  openTag?(r: Pane, tag: string, actor: Actor): Promise<TagList>;
  openQuery?(r: Pane, query: string, actor: Actor): Promise<TagList>;
  /** Reader `p`'s note in the outline: its cursor moves there (its dock opening); nothing else moves (PIE-794). */
  revealInOutline?(p: Pane): Promise<{ revealed: string; outline: string }>;
  /** Opens from `pane` land in another tile (its link, PIE-473, or the view's open rule): the tree's ⏎ doesn't take the keys to a reader then. */
  routes?(pane: Pane): boolean;
  /** What tile `name` shows or has selected (a backlinks tile lists the backlinks of its source's note). */
  tileShowing?(name: string): Msg | null;
  /** A selection moved in `from`: the previews following it and its link show `m`; the current note stays. */
  showFrom?(from: Pane, m: Msg, by?: Actor): void;
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
  /** The tile reader `p` follows by a link (PIE-814), and whether it's out of sight now; null when none. */
  followSource?(p: ReaderPane): { name: string; hidden: boolean } | null;
  /** The tile that moved the current note last, and whether it's out of sight now (a tree in a shut dock). */
  steering?(): { name: string; hidden: boolean } | null;
  /** Why reader `p` can't follow tile `source` (no such tile, itself, nothing to follow), or null. */
  followRefusal?(p: ReaderPane, source: string, actor?: Actor): string | null;
  /** Reader `p` follows tile `source` (a link with the preview role, saved with the layout); null: no tile. */
  followFrom?(p: ReaderPane, source: string | null, actor: Actor): void;
  /** The person picks what reader `p` follows: a picker of sources over the screen. */
  askFollow?(p: ReaderPane): void;
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
  /** Whether its host currently draws the tile (also reaches nested screens). */
  shownAs?(on: boolean): void;
  unsaved?(): boolean;
  keepDrafts?(): string[];
  /**
   * Its content is a note's text: the look's `measure` holds it to that many columns, centred (PIE-673). A list, a
   * terminal or a whole screen fills its tile.
   */
  readonly measured?: boolean;
  /** Columns its content keeps beside the measured text (a reader's margin cards): the measure grows by them. */
  beside?(): number;
  /** Its kind in the tile-kind registry; "exhibit" (unregistered): a pane a host gives a screen of its own (the showcase's exhibits), never saved to desk.json. */
  readonly kind: TileKindName;
  title(): string;
  /** The note a written tile title reads values from, when it differs from the selection. */
  readonly titleNote?: Msg | null;
  hint(): string;
  /** The note the tile points at (a reader's note, a list's or the tree's selected row): what `note.trash` takes by default. Null: none. */
  subject?(): string | null;
  /** `typing`: the person is typing in it (a terminal shows its cursor then). */
  render(w: number, h: number, focused: boolean, desk: DeskApi, typing?: boolean): PaneView;
  /** Return true when the pane used the key. */
  key(k: Key, desk: DeskApi): boolean;
  /**
   * A key the tile takes ahead of the desk's own (tab cycles tiles) and its kind's (a river column's ← →): a reader's
   * while its current element is a live figure's (its tabs, its density).
   */
  claims?(k: Key): boolean;
  /**
   * A screen of its own is drawn in it (a mount, a group): a refusal of the person's key is said on the focused tile in
   * there (PIE-727), so this tile's frame doesn't say it again.
   */
  nestsTiles?(): boolean;
  click?(x: number, y: number, desk: DeskApi): void;
  /** The wheel; `at`: where the pointer is, in the pane's cells. */
  wheel?(dir: 1 | -1, desk: DeskApi, at?: { x: number; y: number }): void;
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
  /** This tile's own look (PIE-675, the tune inspector's "this tile"): field key → value, saved in its tile spec as `look`. */
  instanceLook?: Record<string, string>;
  writtenTitle?: string;
  systemTitle?: boolean;
  /** Closing clears its content but keeps this slot in the layout. */
  clearsOnClose?(): boolean;
  clearContent?(): void;
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
  headControls?(room: number, desk: DeskApi): { text: string; sgr: string; press?: () => void; chip?: true }[] | null;
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


export { propertyChange };

/** How a reader shows notes (PIE-705): it follows the current note, is held on the one it shows, or is pinned to a page. */
export type FollowMode = "follows" | "held" | "pinned";
export const FOLLOW_MODES: readonly FollowMode[] = ["follows", "held", "pinned"];

/**
 * A reader is a note surface (src/surface/note.ts) hosted in a pane: the surface shows, edits and
 * comments on the note; the reader adds pinning and tells the desk or board when a link is followed.
 */
export class ReaderPane implements Pane {
  readonly kind: TileKindName = "reader";
  readonly measured = true;
  protected readonly ownSurface = new NoteSurface();
  get surface() { return this.ownSurface; }
  gutterCols = 0;
  innerFrame?: Rect;
  heroBounds?: { col: number; row: number; cols: number };
  /** The margin's side column, when the note has cards (ADR 0004 contract 6): the measure keeps room for it. */
  beside() { return this.surface.marginBeside() + (this.surface.previewPoint() ? 72 : 0); }
  private held = false;
  /**
   * `follows`: this reader has a mode (PIE-705): it follows the view's current note, is held on the note it shows, or is
   * pinned to a page, and `p` switches it. Readers a host owns (the board's preview strip, a river column, docks and
   * floats) have one fixed way of showing, so they don't offer it. ("Pin" is kept for a dock joining the layout.)
   */
  constructor(readonly follows = false) {}
  get msg() { return this.surface.msg; }
  /** The title follows the text being written, before its first save. */
  get titleNote() { const m = this.msg; return m && this.surface.draft ? { ...m, text: this.surface.draft.text } : m; }
  subject() { const m = this.surface.msg; return m && isOutlineNote(m) ? m.id : null; }
  claims(k: Key): boolean { return !this.holdsKeys && this.surface.claims(k); }
  /** Held on its note (p, alt+⏎, or pinned to a page): it doesn't follow the current note. */
  get holding() { return this.held || !!this.pinPage; }
  /** How it shows notes: following the current one, held on one, or pinned to a page. */
  get followMode(): FollowMode { return this.pinPage ? "pinned" : this.held ? "held" : "follows"; }
  /** The page it's pinned to, if any (`[[page]]`): it shows that page each time it starts, not the last note it held. */
  pinPage: string | null = null;
  /** Counts the mode changes: a pin that was looked up for a page is dropped when the mode changed again meanwhile. */
  private modeGen = 0;
  /** The block its page named when it last resolved: a different note opened into it lets the page go (it is held). */
  private pageNote: string | null = null;
  /** The note it should show once the desk can read it (a restored layout). */
  want: string | null = null;
  /** The note it was laid out with, when the outline has no such note (gone, or a screen saved on another outline). */
  missing: string | null = null;
  /** Opened into a container (the board's readers row): what it's called there ("detail 1"); null otherwise. */
  label: string | null = null;
  /** Set by the desk as it draws: an open there lands here (shown when there are two or more), and it floats. */
  opensHere = false;
  floating = false;
  /** Made for a new note (PIE-591, `note.new`): its id and the note it was made from; it closes with its edit, and goes when the note is trashed unwritten. */
  newNote: { id: string; context: string | null } | null = null;
  get draft() { return this.surface.draft; }
  get session() { return this.surface.session; }
  get comments() { return this.surface.comments; }
  get unread() { return this.surface.unread; }
  get editing() { return this.surface.editing; }
  /** Every key goes to the surface first (an edit, or the property panel); hosts route to it before their own. */
  get holdsKeys() { return this.surface.holdsKeys; }
  /** The person is typing a filter into an inline `::links` list: the desk's own keys (e, p, i, C) wait (Pane.typing). */
  typing() { return this.surface.typingFilter; }
  /** Hold `m` (alt+⏎ on a link, a note opened into it): it keeps its note as the current one changes. A pinned reader shown another note is held, no longer pinned. */
  hold(m: Msg, desk: DeskApi) {
    this.modeGen++;
    this.held = this.follows;
    if (this.pinPage && m.id !== this.pageNote) { this.pinPage = null; this.pageNote = null; }
    this.show(m, desk);
  }
  /**
   * Switch its mode (`p`, a click on the mode chip, `reader.mode`): `follows` shows the current note as it changes, `held`
   * keeps the note it shows, `pinned` keeps a page's note (`page`, else the page the shown note has) and shows it again
   * each time it starts. Left out, `p`'s toggle: follows to held, anything else back to following.
   */
  async setMode(mode: FollowMode | undefined, desk: DeskApi, page?: string): Promise<{ mode: FollowMode; page?: string; held: boolean }> {
    if (!this.follows) throw new ActionRefused("this reader keeps its own way of showing a note; it has no mode to switch");
    if (this.editing) throw new ActionRefused("the reader holds an edit; it stays on its note until that closes");
    const next = mode ?? (this.followMode === "follows" && !desk.followSource?.(this) ? "held" : "follows");
    const gen = ++this.modeGen;
    // A mode chosen is the reader's own way again: a tile it followed (reader.follow source=<tile>) lets go of it, once
    // the mode is sure to be set.
    const letGo = () => { if (desk.followSource?.(this)) desk.followFrom?.(this, null, USER); };
    if (next === "pinned") {
      const name = page ?? prop(this.msg, "page");
      if (!name) throw new ActionRefused(`${this.msg ? "that note has no page to pin to" : "nothing to pin yet"} · name one: act reader.mode mode=pinned page=<name>`);
      const r = await this.context(desk).board.resolvePage(name);
      if (r.status !== "resolved" || !r.block) throw new ActionRefused(`no page ${name} in this outline to pin to`);
      if (this.editing) throw new ActionRefused("the reader holds an edit; it stays on its note until that closes");
      if (gen !== this.modeGen) throw new ActionRefused("the reader's mode changed again while the page was looked up; nothing was pinned");
      letGo();
      this.held = this.follows; this.pinPage = name; this.pageNote = r.block.id;
      if (this.msg?.id !== r.block.id) this.show({ ...r.block, address: this.noteAddress }, desk);
    } else {
      letGo();
      this.pinPage = null; this.pageNote = null;
      this.held = next === "held";
      // Held to follows keeps the note on screen: it becomes the current note (the others follow it), never a jump to
      // the current note the hold left behind. Follows to held keeps it too.
      if (!this.held) { if (this.msg && this.msg.id !== desk.current?.id) desk.setCurrent(this.msg, { from: this }); else if (!this.msg) this.show(desk.current, desk); }
    }
    desk.redraw();
    return { mode: this.followMode, ...(this.pinPage ? { page: this.pinPage } : {}), held: this.holding };
  }
  /** Start held before it has a note (a detail tile waiting for its first open): the current note doesn't move it. */
  holdOn() { this.held = this.follows; }
  /** Start pinned to `page`: it is shown once the page resolves (`pinStart`). */
  pinTo(page: string) { this.held = this.follows; this.pinPage = page; }
  /** The page it's pinned to resolved to `block` (the tile joined a desk): show it, unless a note is open there already. */
  pinned(block: Msg, desk: DeskApi) { if (this.pinPage && !this.msg) { this.pageNote = block.id; this.show({ ...block, address: this.noteAddress }, desk); } else if (this.pinPage && this.msg?.id === block.id) this.pageNote = block.id; }
  unsaved() { return this.surface.unsaved(); }
  keepDrafts(): string[] { return this.surface.keepDrafts(); }
  dispose() { this.offOutlineEvents?.(); this.surface.dispose(); }
  /**
   * A reader that follows is "reader"; one that keeps its note is a "detail" (the glossary's word for a held reader), which
   * a host may label ("detail 1" in the board's readers row). The mode chip on the frame says which mode it is in.
   */
  title(): string {
    const st = this.surface.state();
    if (this.label !== null) {
      // A float says what it holds; in the row, which detail it is and whether ⏎ opens here.
      if (this.floating) return this.msg ? subject(this.titleNote!) || this.label : "float";
      return [this.label, this.msg ? "" : "empty", this.opensHere ? "⏎ opens here" : "", st].filter(Boolean).join(" · ");
    }
    if (!this.holding) return ["reader", st].filter(Boolean).join(" · ");
    return this.msg ? ["detail", st].filter(Boolean).join(" · ") : "detail · empty";
  }
  hint() { return this.surface.hint(this.follows ? (this.holding ? "p follow · " : "p hold · ") : ""); }
  /**
   * The frame and policy panel share the words for the reader's state.
   */
  stateLabel(): string {
    return this.followMode === "pinned" ? `▣ stays put · [[${this.pinPage}]]` : this.holding ? "stays put" : "shows the current note";
  }

  headControls(room: number, desk: DeskApi) {
    if (!this.follows) return null;
    const press = () => this.pickSource(desk);
    const ways = this.followMode === "pinned" ? [this.stateLabel(), "▣ stays put", "▣"]
      : this.holding ? [this.stateLabel(), "■"] : [this.stateLabel(), "current note", "→"];
    const text = ways.find(w => width(w) <= room);
    return text ? [{ text, sgr: fg(this.holding ? C.yellow : C.grey), press, chip: true as const }] : null;
  }
  /** P and the state chip open the same policy controls. */
  private pickSource(desk: DeskApi) {
    runOwn(READER_ACTIONS, "reader.follow", {}, { pane: this, desk });
  }

  /** The surface's host: this pane's desk or board, and where a followed link opens. */
  noteAddress?: NoteAddress;
  private outlineCtx?: Ctx;
  private offOutlineEvents?: () => void;
  private outlineWatching?: Ctx["board"];
  private listen(desk: DeskApi) {
    const ctx = this.context(desk);
    if (this.outlineWatching === ctx.board) return;
    this.offOutlineEvents?.(); this.outlineWatching = ctx.board;
    if (ctx.board !== desk.ctx.board) this.offOutlineEvents = outlineBoards(desk.ctx).watch(ctx.board, e => {
      this.surface.onEvent(this.host(desk));
      if (this.surface.staleOn(e)) this.reread(desk);
      desk.redraw();
    });
  }
  async connect(desk: DeskApi) {
    this.outlineCtx = this.noteAddress ? await outlineBoards(desk.ctx).on(this.noteAddress) : desk.ctx;
    this.listen(desk);
  }
  context(desk: DeskApi): Ctx { return this.outlineCtx ?? desk.ctx; }

  host(desk: DeskApi): SurfaceHost {
    const pane = this;
    const h: SurfaceHost = {
      externalGutter: this.gutterCols,
      heroBounds: this.heroBounds,
      innerFrame: this.innerFrame,
      ctx: this.context(desk),
      contextFor: m => {
        this.noteAddress = m?.address;
        this.outlineCtx = m?.address ? outlineBoards(desk.ctx).peek(m.address) : undefined;
        this.listen(desk);
        return this.context(desk);
      },
      // Whether the person's keys are here: an agent's fragment link is revealed only in a reader they aren't in.
      get focused() { return desk.hasFocus ? desk.hasFocus(pane) : undefined; },
      // Whether the person types in it: an edit left open while they're elsewhere (a preview they read through) is drawn away.
      get entered() { return desk.isIn ? desk.isIn(pane) : undefined; },
      enterMode: () => desk.enterSession?.(pane),
      redraw: () => desk.redraw(),
      ...(desk.keepLayout ? { keptChanged: () => desk.keepLayout!() } : {}),
      ...(desk.layoutUndoSeq ? { layoutUndoSeq: () => desk.layoutUndoSeq!() } : {}),
      // A link followed in it lands where its opens land (PIE-794, the desk's one landing path): a held reader with no
      // link replaces its own note and moves nothing else; a following one moves the current note; alt+⏎ opens beside.
      navigate: (m, how) => { m.address ??= this.noteAddress; desk.setCurrent(m, { reveal: true, from: this, ...how }); },
      summaryKeys: m => desk.summaryKeys?.(m),
      // A #tag opened in it: the notes carrying it, in a list beside it (PIE-800).
      ...(desk.openQuery ? { query: (q: string, how?: OpenHow) => desk.openQuery!(this, q, how?.by ?? USER) } : {}),
      ...(desk.openTag ? { tag: (t: string, how?: OpenHow) => desk.openTag!(this, t, how?.by ?? USER) } : {}),
      // A click on the crumbs shows the note in the outline (reader.reveal, PIE-794): readers of a screen with one.
      ...(desk.revealInOutline ? { revealInOutline: () => runOwn(READER_ACTIONS, "reader.reveal", {}, { pane: this, desk }) } : {}),
      // A row picked in a list drawn in the note shows where this reader's selection goes (PIE-794).
      ...(desk.showFrom ? { preview: (m: Msg) => desk.showFrom!(this, m) } : {}),
      // Its look (PIE-673), as the desk resolved it for this tile: margin, list density, heading spacing.
      get look() { return desk.lookOf?.(pane); },
      startSession: desk.startSession ? (kind, opener) => desk.startSession!(this, kind, opener) : undefined,
      // Its comment in a tile of its own beside it (PIE-846), where the screen has tiles.
      ...(desk.answerTile ? { answerTile: (ask: string, actor: Actor, fold?: string) => desk.answerTile!(this, ask, actor, fold) } : {}),
      hasWiredPreview: () => !!desk.hasWiredPreview?.(this),
      ...(desk.listPreviewTile ? { hasListPreviewTile: () => !!desk.hasListPreviewTile?.(this), listPreviewTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.listPreviewTile!(this, on, side) } : {}),
      ...(desk.editPreviewTile ? { hasEditPreviewTile: () => !!desk.hasEditPreviewTile?.(this), editPreviewTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.editPreviewTile!(this, on, side) } : {}),
      ...(desk.sourcesTile ? { hasSourcesTile: () => !!desk.hasSourcesTile?.(this), sourcesTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.sourcesTile!(this, on, side) } : {}),
      ...(desk.composerTile ? { composerTile: (on: boolean, keys?: boolean, side?: "left" | "right" | "up" | "down") => desk.composerTile!(this, on, keys, side), hasComposerTile: () => !!desk.hasComposerTile?.(this) } : {}),
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

  /**
   * The current note changed: a reader that follows shows it, unless it holds an edit or a comment (PIE-761): then it
   * stays on its note, and the status line says so once for each note it didn't move to.
   */
  select(m: Msg | null, desk: DeskApi) {
    if (this.holding) return;
    if (this.show(m, desk) || !m || !this.msg || m.id === this.msg.id || !this.editing || this.heldAgainst === m.id) return;
    this.heldAgainst = m.id;
    desk.ctx.flash(`${this.detailLabel() ?? "the reader"} keeps ${sessionName(this)} on “${subject(this.msg)}” · “${subject(m)}” is the current note; it follows once that's sent or closed`, 8000);
  }
  /** The last current note it stayed off for its open session, said once. */
  private heldAgainst: string | null = null;
  refresh(m: Msg) { this.surface.refresh(m); }
  /** Read its note again (NoteSurface.reread: one read at a time, a draft only marked). */
  reread(desk: DeskApi) { this.surface.reread(this.host(desk)); }
  show(m: Msg | null, desk: DeskApi) {
    if (this.editing && m?.id !== this.msg?.id) return false;
    const host = this.host(desk);
    const shown = this.surface.show(m, { ...host, ctx: host.contextFor!(m) });
    // The history a saved layout brought (PIE-643) is taken up with the note it was saved on (`wantNote`).
    if (shown && m && this.wantNav !== undefined && this.wantNote() === m.id) { const nav = this.wantNav; this.wantNav = undefined; this.surface.restoreNav(nav); }
    return shown;
  }
  /** The history a saved layout brought, until the reader shows the note it was saved on (NoteSurface.restoreNav). */
  wantNav: unknown;
  /** The note the saved layout had this reader on, until it shows it (or `dropWant`: it couldn't). */
  wantNote(): string | null { return this.wantNav === undefined ? null : navNote(this.wantNav); }
  dropWant() { this.wantNav = undefined; }
  /**
   * What a layout saves of a reader: its mode (held on its note, or pinned to a page), its place and its back and forward
   * stacks (PIE-643). A reader that follows saves only its place.
   */
  spec(): Record<string, unknown> {
    const nav = this.wantNav ? this.wantNav : this.surface.saveNav();
    const note = this.msg && !this.msg.id.startsWith("file:") ? this.msg.id : this.want;
    // A pinned reader comes back on its page, not on the last note it held: no history to keep.
    if (this.pinPage) return { mode: "pinned", page: this.pinPage, ...this.noteAddress, ...this.marginSpec() };
    if (this.follows && this.held) return { mode: "held", ...(note ? { note } : {}), ...(nav ? { nav } : {}), ...this.noteAddress, ...this.marginSpec() };
    return { ...(nav ? { nav } : {}), ...this.noteAddress, ...this.marginSpec() };
  }
  /** Its margin (PIE-873: marks only, or cards whole) when it isn't the default, kept with the layout as `margin`. */
  marginSpec(): { margin?: MarginMode } { return this.surface.marginMode === "trim" ? {} : { margin: this.surface.marginMode }; }
  /** A saved or inherited margin: one of the modes, else left as it is. */
  takeMargin(mode: unknown) { if ((MARGIN_MODES as readonly unknown[]).includes(mode)) this.surface.marginMode = mode as MarginMode; }
  retry(desk: DeskApi) { this.surface.retry(this.host(desk)); }
  /** The label a host gave it for the row it is in ("detail 1" in the board's readers row), or null. */
  detailLabel(): string | null { return this.kind === "reader" ? this.label : null; }
  /** The tiles whose opens land here (their link, or their container's opens-into): set by the desk as it draws. */
  landsFrom: string[] = [];
  /** What an empty one says it's for: where its notes come from, and how to get one there. */
  protected emptyFor(): string {
    if (this.missing) return `the note it held (${this.missing}) isn't in this outline (gone, or the screen was made on another outline) · open one here, or ^W x closes it`;
    if (this.landsFrom.length) return `what you open in ${this.landsFrom.join(" or ")} lands here`;
    return this.follows && !this.holding ? "shows the current note: pick one in the outline, or / searches" : "keeps the note opened into it · alt+l in another tile, then a click here, sends that tile's opens here";
  }
  render(w: number, h: number, _focused = false, desk?: DeskApi): PaneView {
    const draft = this.surface.writingDraft;
    const completion = draft && completerOf(draft);
    if (completion) completion.screenLayer = true;
    const v = this.surface.render(w, h, desk && this.host(desk));
    if (completion?.shown) v.completion = completion;
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
  describe() { return { title: this.title(), held: this.holding, mode: this.followMode, ...(this.pinPage ? { page: this.pinPage } : {}), ...this.surface.describe() }; }

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
    // The same title as its border (PIE-809): the Work ID first.
    return { title: this.msg ? headedTitle(this.titleNote!) : this.title(), marks };
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
    if ((kind === "comment" || kind === "select" || kind === "note" || kind === "threads") && m.resource && !this.fileSource()) {
      return kind !== "threads" && m.resource.uncommentable ? `${subject(m)}: ${m.resource.uncommentable}` : null;
    }
    return `${subject(m)} is shown here to read · it isn't a note in the outline`;
  }
  /** A tile following a file on disk (a preview of a path): never a Resource's text. */
  protected fileSource(): boolean { return false; }

  key(k: Key, desk: DeskApi): boolean {
    const start = this.readOnly && !this.holdsKeys ? sessionStart(k) : null;
    if (start) { const why = this.refuses(start); if (why) { desk.ctx.flash(why); return true; } }
    if (this.follows && !this.editing && ch(k) === "p") { runOwn(READER_ACTIONS, "reader.mode", {}, { pane: this, desk }); return true; }
    if (this.follows && !this.editing && ch(k) === "P") { this.pickSource(desk); return true; }
    // O: a reader beside this one where its links open (the desk's tile.preview), so this one never navigates away.
    if (!this.holdsKeys && ch(k) === "O" && desk.perform) { void desk.perform("tile.preview", {}, undefined, this); return true; }
    return this.surface.key(k, this.host(desk));
  }

  wheel(dir: 1 | -1, desk: DeskApi, at?: { x: number; y: number }) { this.surface.wheel(dir, this.host(desk), at); }
  /**
   * A click at `x`, `y` in the pane: a completion candidate is inserted, a link opens (where ⏎ on it
   * would, or through `open` when the host says otherwise), a property row is picked, a heading or a
   * list item's mark folds or unfolds.
   */
  click(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void): boolean {
    const h = this.host(desk);
    return this.surface.click(x, y, open ? { ...h, navigate: open, freshClick: true } : h);
  }
  /**
   * The mouse in the pane (PIE-419): press, drag, release. A release on the pressed cell is the click
   * above (with `open` as there); a drag selects text instead, and never copies it.
   */
  ownsRightClick(x: number, y: number): boolean { return this.surface.ownsRightClick(x, y); }
  press(x: number, y: number, desk: DeskApi, shift = false, keepCursor = false) { this.surface.press(x, y, this.host(desk), shift, keepCursor); }
  drag(x: number, y: number, desk: DeskApi) { this.surface.drag(x, y, this.host(desk)); }
  release(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void, focusing = false): boolean {
    const h = this.host(desk);
    return this.surface.release(x, y, { ...h, ...(open ? { navigate: open, freshClick: true } : {}), ...(focusing ? { focusing } : {}) });
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

// ── activity (last callers, live) and who's online ───────────────────────────

export class ActivityPane implements Pane {
  readonly kind = "activity";
  private rows: Activity[] | null = null;
  private drawnItems: number[] = [];
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
    const drawn = this.rows.flatMap((r, i) => {
      const text = `${ago(r.at).padStart(4)} ${authorName(r.actor)} ${subject(r.block)}`;
      return rowLines(text, w, undefined, { hang: 5 }).map(text => ({ text: i === this.sel ? selectedRow(text, w, focused) : fg(C.grey) + text + RESET, i }));
    });
    const first = drawn.findIndex(r => r.i === this.sel), last = drawn.findLastIndex(r => r.i === this.sel);
    this.view.place(this.sel, drawn.length, h, [first, last]);
    const shown = drawn.slice(this.view.top, this.view.top + h);
    this.drawnItems = shown.map(r => r.i);
    return { lines: shown.map(r => r.text) };
  }
  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows?.length ?? 0, on = { pane: this, desk };
    if (isUp(k)) { if (this.sel > 0) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: this.sel }, on); return true; }
    if (isDown(k)) { if (this.sel + 1 < n) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: this.sel + 2 }, on); return true; }
    if (k.kind === "enter" && this.rows?.[this.sel]) { runOwn(ACTIVITY_ACTIONS, "activity.pick", { open: true }, on); return true; }
    if (ch(k) === "r") { runOwn(ACTIVITY_ACTIONS, "activity.reload", {}, on); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) { const i = this.drawnItems[y] ?? -1; if (i >= 0 && i < (this.rows?.length ?? 0) && i !== this.sel) runOwn(ACTIVITY_ACTIONS, "activity.pick", { n: i + 1 }, { pane: this, desk }); }
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
      lines: [...this.callers.flatMap((c, i) => {
        const you = c.id === desk.ctx.board.clientId;
        const act = c.target ? this.names.get(c.target) ?? (this.asking.has(c.target) ? "…" : c.activity || c.target.slice(0, 8)) : c.activity;
        return rowLines(`${fg(C.lcyan)}${String(i + 1).padStart(2)} ${fg(you ? C.yellow : C.white)}${you ? "you" : c.name}  ${fg(C.grey)}${act}${RESET}`, w, undefined, { hang: 3 });
      }), ...(desk.ctx.agentPointers?.list() ?? []).map(p => dim(`@${p.agent} · ${p.screen} / ${p.name}${p.line ? ` · line ${p.line}` : ""}`))],
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
    run(_, { pane, desk }) { pane.load(desk); return { callers: pane.rows(), pointers: desk.ctx.agentPointers?.list() ?? [] }; },
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


export const ACTIVITY_ACTIONS = actionSet<{ pane: ActivityPane; desk: DeskApi }>()("activity", {
  "activity.pick": def({
    summary: "pick a row of the activity tile (last callers, live): n from 1, else the selected one; open=true makes its note the current one, as ⏎ does. An agent's pick answers the row and moves nothing of the person's",
    keys: "j k ↑ ↓ click wheel, ⏎ (open)",
    touches: "nothing", replay: "safe", says: r => (r.opened ? `opened ${String(r.title)}` : null),
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, open: { type: "boolean", optional: true, about: "make its note the current one, as ⏎ does" } },
    examples: [
      { act: "activity.pick tile=activity n=1", does: "answers the newest caller's row: who, which note, when" },
      { act: "activity.pick tile=activity n=2 open=true", does: "makes the note on row 2 the current one, as enter does" },
    ],
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
  "reader.reveal": def({
    summary: "show a reader's note in the outline (tile=<a reader>, default the focused one): the outline's cursor moves to its row, unfolding what's over it, and its dock slides open if it's shut, as the outliner's Tree's r does. Nothing else moves: the current note, the reader, its mode and the keys stay. A held reader's own navigation never moves the outline (PIE-794); this finds where it is. The person's: the outline's cursor is theirs",
    keys: "alt+r in a reader, a click on its crumbs (the path above the title)",
    touches: "tile", replay: "safe", person: "the outline's cursor is the person's; an agent reads where a note sits with outline_read or peek",
    menu: { label: "show in the outline", group: "Reader", key: "alt+r", now: ({ pane }) => (!pane.msg ? { refused: "nothing in that reader to find in the outline" } : null) },
    args: {},
    run(_, { pane, desk }) {
      if (!desk.revealInOutline) throw new ActionRefused("this screen has no outline to show it in");
      return desk.revealInOutline(pane);
    },
  }),
  "reader.follow": def({
    summary: "what a reader (tile=<its name>) follows: source=current (the current note, as it changes), source=<tile> (a tile with a selection: the tree, a links tile, another reader; a link with the preview role, alt+l's, saved with the layout) or source=none (held on its note). Left out, opens the policy panel: Shows changes between shows the current note and stays put; a lock pins it to a page",
    keys: "P or a click on the state chip opens the policy panel",
    touches: "tile", replay: "safe", way: "an agent sets what a reader follows when the person isn't in it", says: r => (r.asked ? null : r.source === "current" ? "set the reader: shows the current note" : r.source === "none" ? "set the reader: stays put" : `set the reader to show ${r.source}'s selection`),
    menu: { label: "shows…", group: "Reader", key: "P", now: ({ pane }) => (!pane.follows ? { hide: true } : pane.editing ? { refused: "the reader holds an edit; it stays on its note until that closes" } : null) },
    args: { source: { type: "string", optional: true, about: "current, none, or a tile's name (a tree, a links tile, a reader); left out, the policy panel (the person's)" } },
    examples: [
      { act: "reader.follow tile=reader source=tree", does: "the reader shows whatever the tree's selection is on" },
      { act: "reader.follow tile=reader source=none", does: "holds the reader on the note it shows now" },
    ],
    async run({ source }, { pane, desk }, actor) {
      if (!pane.follows) throw new ActionRefused("this reader keeps its own way of showing a note; it follows nothing");
      if (source === undefined) {
        if (actor.kind === "agent" || !desk.askFollow) throw new ActionRefused("name it: source=current, source=none or source=<tile>");
        desk.askFollow(pane);
        return { tile: desk.nameOfPane?.(pane), asked: true };
      }
      if (source === "current" || source === "none") {
        await pane.setMode(source === "current" ? "follows" : "held", desk);
        return { tile: desk.nameOfPane?.(pane), source };
      }
      if (!desk.followFrom) throw new ActionRefused("this screen has no tiles to follow");
      if (pane.editing) throw new ActionRefused("the reader holds an edit; it stays on its note until that closes");
      // Checked before anything changes: a refused source leaves the reader as it was.
      const why = desk.followRefusal?.(pane, source, actor);
      if (why) throw new ActionRefused(why);
      if (pane.followMode !== "held") await pane.setMode("held", desk);
      desk.followFrom(pane, source, actor);
      return { tile: desk.nameOfPane?.(pane), source };
    },
  }),
  "reader.mode": def({
    summary: "set how a reader (tile=<its name>, any reader, a detail too) shows notes: mode=follows (the current note, as it changes), held (the note it shows; the current note doesn't move it) or pinned (a page's note, shown again each time it starts; page=<name>, left out the page the shown note has); left out, p's toggle: follows to held, anything else back to following. Said on screen when an agent does it",
    keys: "p; P then enter or space on Shows changes the state, or click its row; the page lock pins it",
    touches: "tile", replay: "safe", way: "an agent sets a reader's mode when the person isn't in it", says: r => `${r.mode === "follows" ? "set the reader: shows the current note" : r.mode === "pinned" ? `locked the reader: stays put on [[${r.page}]]` : "set the reader: stays put"}`,
    menu: { label: "stays put on this note", group: "Reader", key: "p", now: ({ pane }) => (!pane.follows ? { hide: true } : pane.editing ? { refused: "the reader holds an edit; it stays on its note until that closes" } : pane.followMode !== "follows" ? { label: "shows the current note" } : null) },
    args: {
      mode: { type: "string", optional: true, choices: ["follows", "held", "pinned"], about: "follows, held or pinned; left out, the other of follows and held" },
      page: { type: "string", optional: true, about: "mode=pinned: the page's name (`[[name]]`); left out, the shown note's own page" },
    },
    examples: [
      { act: "reader.mode tile=replies mode=held", does: "keeps the replies tile on its note when the current note moves" },
      { act: "reader.mode tile=reader mode=pinned page=garden", does: "pins the reader to [[garden]], shown again each time it starts" },
    ],
    async run({ mode, page }, { pane, desk }, actor) {
      if (mode !== undefined && !(FOLLOW_MODES as readonly string[]).includes(mode)) throw new ActionRefused(`reader.mode: mode is follows, held or pinned, not ${mode}`);
      const result = await pane.setMode(mode as FollowMode | undefined, desk, page);
      if (result.mode !== "follows") desk.holdReader?.(pane, actor);
      return result;
    },
  }),
});
