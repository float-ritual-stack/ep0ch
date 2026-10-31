import { holdsEdit } from "../whereabouts";
import type { LineField } from "../surface/line";
import type { ModeKey } from "../surface/modes";
import { outlineBoards, type NoteAddress } from "./outline-boards";
// The panes a desk can hold. Each renders into its own inner rectangle; the desk draws borders.
import { headedTitle } from "../board";
import { completerOf, type Completer } from "../surface/completer";
import type { Look, TileLooks } from "../look";
import { MARGIN_MODES, type MarginMode } from "../surface/margin";
import type { StyleLayer } from "@ep0ch/outline-core/style-cascade";
import { RowView, type RowPress } from "../scroll";
import type { AttachedOwner, AttachedSide, Attachment } from "./attached-tile";
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
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { Dispatcher } from "../surface/dispatch";
import { ART_ACTIONS, type ArtAbout } from "../art-actions";
import { NOTE_ACTIONS, NoteSurface, navNote, propertyChange, sessionStart, type OpenHow, type SessionKind, type SurfaceHost, type TagList, type TileHeader, type Trail, type TrailStop } from "../surface/note";
import { artLines, C, dim, fg, pad, RESET, selectedRow, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { rowLines, ago, wrap } from "../text";
import type { TileKindName } from "./tile-kinds";
import type { ListPicker } from "../surface/picker";
import { newNoteOffer, type KeySpot } from "../new-note";
import { prop } from "../props";

/** `spots`: parts of its rows a click presses a key on (an empty place's `+ New note`: ctrl+n, newNoteOffer). */
export interface PaneView { wide?: { row: number; col: number; cols: number }[]; frame?: Rect; headerBand?: { row: number; rows: number; bg: string }; completion?: Completer; gutter?: { row: number; text: string }[]; lines: string[]; placements?: Placement[]; scroll?: Scroll; spots?: KeySpot[] }

export interface DeskApi {
  ctx: Ctx;
  /** The screen this desk is (the Desk itself): what a reader's edit lists its actions for (PIE-1439). */
  screen?(): import("../app").Screen;
  /** The title written on tile `p` (`tile.title`) as it reads now, when one is shown in place of the system's (PIE-1248: its reader's header says it). */
  writtenTitle?(p: Pane): string | undefined;
  /** The look (PIE-673) the desk resolved for tile `p` as it drew it last: its spacing, list density and where each comes from. */
  lookOf?(p: Pane): Look | undefined;
  /** What the tune inspector sees of tile `name`: its look, kind, title, content width, and in a reader the `::box` its `[ ]` is in. */
  tileLook?(name: string): { look: Look; kind: string; title: string; cols: number; box: { attrs: string; line: number } | null; hero?: import("./tune").TuneHero | null; list?: { target: string | null; layers: StyleLayer[]; first: number; revision?: number } | null } | null;
  /** The tiles' own looks by tile id (PIE-675, "this tile"): what the tune inspector saves into and reads. */
  tileLooks?: TileLooks;
  /** The screens held one inside the next down to this desk (a mount is checked against it). */
  mountChain?(): string[];
  /**
   * Tile `p` is drawn at a size that isn't its own now: folded to a spine, or in flight between two places (the layout
   * glides, PIE-958). A terminal keeps the size its program has then; it is told the one it ends at, once.
   */
  holdsSize?(p: Pane): boolean;
  /** Whether tile `p` is in the frame drawn lately; undefined while nothing has been drawn (a headless desk). */
  shows?(p: Pane): boolean | undefined;
  /**
   * Open `m` from tile `from` (PIE-1207: the one way a tile opens a note): it lands where `placement()` puts it (a wire,
   * `to`, the screen's rule, else the first reader not pinned), never in a hidden current note. `link`, `fresh`, `agent`:
   * how a reader opened it (OpenHow, PIE-441); `reveal`: the person's open shows it in the outline too.
   */
  openFromTile(m: Msg, opts: { reveal?: boolean; from?: Pane; to?: Pane; keys?: false; keep?: true } & OpenHow): void;
  focusKind(kind: TileKindName, actor?: Actor): void;
  redraw(): void;
  /** Save the screen's layout now (a reader's history changed, PIE-643). */
  keepLayout?(): void;
  retirePeeks?(p: Pane, by: Actor): void;
  historyLanded?(p: ReaderPane, by: Actor): void;
  /** The layout permits closing this tile, including the container that keeps it. */
  canClose?(p: Pane): boolean;
  holdReader?(pane: ReaderPane, actor: Actor): void;
  /** The place in the door's undo order of this screen's newest layout change, or undefined: a reader's ctrl+z yields to it when it has nothing of its own. */
  layoutUndoSeq?(): number | undefined;
  /** Bring back the note the person trashed last on `board` (note.untrash), for a reader's ctrl+z; false for another outline's board. */
  untrash?(board: object): boolean;
  /** The summary keys of the view a note is shown from (a board lane's `[summary-properties::…]`). */
  summaryKeys?(m: Msg): readonly string[] | null;
  /** Start a session in `pane` as the person's key does, so they're in it (a comment mark's ⏎ or click). */
  startSession?(pane: ReaderPane, kind: SessionKind, opener?: Key): void;
  /** The tile named `name` on this screen. */
  paneNamed?(name: string): Pane | undefined;
  /** The person's new note (a quote, PIE-1184) opened to write in where their new notes open, lit as arrived: its reader. */
  writeFrom?(from: ReaderPane, m: Msg): Promise<{ tile: string; pane: ReaderPane } | null>;
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
  /** Tile `p`'s attachment `attachment` (a facets tile's Matches, PIE-1443) in a tile of its own beside it (`on`), or that tile closed. */
  attachedTile?(p: Pane, attachment: "matches", on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  hasAttachedTile?(p: Pane, attachment: "matches"): boolean;
  hasSourcesTile?(r: ReaderPane): boolean;
  sourcesTile?(r: ReaderPane, on: boolean, side?: "left" | "right" | "up" | "down"): Promise<unknown>;
  /** Reader `r`'s trail in a tile beside it (PIE-1425), or the one already open with the keys back in it; null when the layout can't place one. */
  trailTile?(r: ReaderPane): Promise<unknown>;
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
  openTag?(r: Pane, tag: string, actor: Actor, standing?: boolean): Promise<TagList>;
  openQuery?(r: Pane, query: string, actor: Actor, standing?: boolean): Promise<TagList>;
  /** Reader `p`'s note in the outline: its cursor moves there (its dock opening); nothing else moves (PIE-794). */
  revealInOutline?(p: Pane): Promise<{ revealed: string; outline: string }>;
  /** Opens from `pane` land in another tile (its link, PIE-473, or the view's open rule): the tree's ⏎ doesn't take the keys to a reader then. */
  routes?(pane: Pane): boolean;
  /** What tile `name` shows or has selected (a backlinks tile lists the backlinks of its source's note). */
  tileShowing?(name: string): Msg | null;
  /** A selection moved in `from`: the tiles its select wires go to (its previews) show `m`; nothing else moves. */
  showFrom?(from: Pane, m: Msg, by?: Actor, where?: OpenHow["where"]): void;
  /** Whether the previews tile `from`'s selection goes to all show nothing yet (a list given the keys fills only those, PIE-1426). */
  previewsEmpty?(from: Pane): boolean;
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
  ruleFor?(touches: "tile" | "screen", actor: Actor, at?: { tile?: string; label?: string; way?: string; host?: true; action?: string }): string | null;
  /** The keys to tile `p`, as `tile.focus` gives them; an agent's never moves them. */
  focusPane?(p: Pane, actor: Actor): void;
  /** The person's keys are held here right now (typing, a picker, a ^W chord): a screen's own key waits. */
  holdsKeys?(): boolean;
  /** Tile `p` is on screen now (not in a shut dock, not a hidden tab). */
  shownNow?(p: Pane): boolean;
  /** The tile reader `p` follows by a link (PIE-814), and whether it's out of sight now; null when none. */
  followSource?(p: ReaderPane): { name: string; hidden: boolean } | null;
  /** The note shown where tile `from`'s opens land (the tree marks its row), or null. */
  opensShow?(from: Pane): string | null;
  /** Why reader `p` can't follow tile `source` (no such tile, itself, nothing to follow), or null. */
  followRefusal?(p: ReaderPane, source: string, actor?: Actor): string | null;
  /** Reader `p` follows tile `source` (a link with the preview role, saved with the layout); null: no tile. */
  followFrom?(p: ReaderPane, source: string | null, actor: Actor): void;
  /** The person picks what reader `p` follows: a picker of sources over the screen. */
  askFollow?(p: ReaderPane): void;
  /** Where back (-1) or forward (1) from tile `p`'s column of a flow goes: that column's tile's title, or null. */
  travelPeek?(p: Pane, dir: -1 | 1): string | null;
  /** Every column back and forward from tile `p`'s along its flow's trail, nearest first (PIE-208), or null outside a flow. */
  travelTrail?(p: Pane): { back: TrailStop[]; forward: TrailStop[] } | null;
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
  /** The display path to a tile, across mounts and the drawer. */
  pathTo?(p: Pane): string | undefined;
  /** The placement owner's description of a tile's destination. */
  wireDescription?(tile: string | undefined, verb: import("./screen-layout").WireVerb): string;
  /** Tile `p` is in a dock (not pinned in the layout). */
  inDock?(p: Pane): boolean;
  /** The side of the screen tile `p` is on (its dock's edge, else where it's placed). */
  sideOf?(p: Pane): "left" | "right";
  /**
   * The person's backlinks (`b`): tile `p` lists the backlinks of `m` (else of the note the reader they read through
   * shows), following the reader that shows it; its dock slides open and their keys go to it.
   */
  aimBacklinks?(p: Pane & { source: string; show(m: Msg, desk: DeskApi): Promise<void>; showSelected?(desk: DeskApi, actor: Actor): void }, m: Msg | null, given?: ReaderPane, actor?: Actor): Promise<void>;
  /**
   * The links of reader `r`'s note (`b`, the note action `links`): the screen's links tile aims at it, or, on a
   * screen without one, a links tile opens below the reader with a preview following it. The person's keys go to
   * the list; an agent's leaves them where they are.
   */
  openLinks?(r: Pane, actor: Actor, standing: boolean): Promise<Record<string, unknown>>;
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
  /** Made on purpose: retained with this instance across groups, spills and the drawer. */
  deliberate?: boolean;
  readonly bindings?: readonly ModeKey[];
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
  /**
   * The note it points at for copying its address (`note.copy-ref`), with its outline when that's another's (a links
   * tile on another outline's note, an EchoNet area's messages). Left out: `subject`, in this door's outline.
   */
  noteAt?(): { id: string; address?: import("./outline-boards").NoteAddress } | null;
  /**
   * Its back and forward (PIE-1426): what it showed before, whichever tile or key changed it. A reader's is its surface's
   * stacks (PIE-453); the links tile's, the notes it listed. `tile.travel` walks it, the trail lists it.
   */
  readonly trail?: TileTrail;
  /** The scope its keys run in now (`?` opens the keys window on `in:<it>`, PIE-1425); left out, its kind's action set's. */
  keysScope?(): string;
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
   * there (PIE-727), so this tile's frame doesn't say it again. Its tiles have frames of their own, so the desk draws
   * this one as its header row alone (PIE-1305), and the outermost screen's hint row speaks for the focused tile in it.
   */
  nestsTiles?(): boolean;
  /** A tile of its desk was renamed (`tile.title`): a tile that keeps another's name as its source (a preview's, a tune's) follows it. */
  renamedTile?(from: string, to: string): void;
  click?(x: number, y: number, desk: DeskApi): void;
  /** The wheel; `at`: where the pointer is, in the pane's cells. */
  wheel?(dir: 1 | -1, desk: DeskApi, at?: { x: number; y: number }): void;
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
  /** A right-click at x, y, before its menu opens: what's under it becomes the selection and nothing runs (a reader's button); null when nothing there is. */
  pointAt?(x: number, y: number, desk: DeskApi): Promise<unknown> | null;
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
  /** Its own header (PIE-1248, `tile.header`): a reader's rows above the note, over the note's `[header::…]`; absent, the note's. Saved with the layout. */
  tileHeader?: TileHeader;
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
  /** The one-line field that has the person's keys here, if any (PIE-1290): ctrl+w is its word, not the ^W chord. */
  lineField?(): LineField | null;
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
  void (on.desk.press ? on.desk.press(on.pane, set, name, args) : Dispatcher.of(set, { ...on, standing: true }, () => on.desk.ctx).press(name, args));
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

/** A reader's pin (PIE-1207): `p` keeps it on its note, or a page's, and every open goes elsewhere. */
export type ReaderPin = { pinned: boolean; page?: string };

/**
 * A reader is a note surface (src/surface/note.ts) hosted in a pane: the surface shows, edits and
 * comments on the note; the reader adds pinning and tells the desk or board when a link is followed.
 */
/**
 * A tile's own back and forward (Pane.trail): what it shows now and the stops each way, nearest first (the trail tile and
 * the trail list draw it, `trailRows`), and a walk of `steps` stops. Null when it went, else why not.
 */
export interface TileTrail {
  stops(): Trail;
  go(dir: -1 | 1, steps: number, desk: DeskApi, actor: Actor): Promise<string | null>;
}

export class ReaderPane implements Pane, AttachedOwner {
  readonly kind: TileKindName = "reader";
  readonly measured = true;
  protected readonly ownSurface = new NoteSurface();
  get surface() { return this.ownSurface; }
  /**
   * Its back and forward are its surface's (PIE-453), the same the trail lists; a walk is the reader's own `back` or
   * `forward` action (its unsent-comment ask, its agent rules and its say-so stay theirs).
   */
  readonly trail: TileTrail = {
    stops: () => this.surface.trailOf(),
    go: async (dir, steps, desk, actor) => {
      const run = desk.within ?? desk.perform;
      if (!run) return "this screen can't run the reader's back";
      await run.call(desk, dir < 0 ? "back" : "forward", { steps }, actor, this);
      return null;
    },
  };
  gutterCols = 0;
  innerFrame?: Rect;
  heroBounds?: { col: number; row: number; cols: number };
  /**
   * The margin's side column, when the note has cards (ADR 0004 contract 6): the measure keeps room for it; and the
   * split beside the note for a list's children or a revision compare (PIE-1433), so a wide tile puts it beside the text.
   */
  beside() { return this.surface.marginBeside() + (this.surface.previewPoint() || this.surface.revisionMode ? 72 : 0); }
  /**
   * `pinnable`: a reader the person owns (PIE-1207): it keeps the note opened into it, and `p` pins it, so every open
   * goes elsewhere and it comes back on that note (or a page's) after a restart. Readers a host owns (the board's preview
   * strip, a river column, docks and floats) have one fixed way of showing, so they don't offer it.
   */
  constructor(readonly pinnable = false) {}
  get msg() { return this.surface.msg; }
  /** The title follows the text being written, before its first save. */
  get titleNote() { const m = this.msg; return m && this.surface.draft ? { ...m, text: this.surface.draft.text } : m; }
  subject() { const m = this.surface.msg; return m && isOutlineNote(m) ? m.id : null; }
  claims(k: Key): boolean { return !this.holdsKeys && this.surface.claims(k); }
  /** Its own header (PIE-1248, `tile.header`), over the note's `[header::…]`. */
  tileHeader?: TileHeader;
  /** Pinned (`p`, `reader.pin`): it keeps its note, every open lands elsewhere, and a restart brings it back on it. */
  pinned = false;
  /** The page it's pinned to, if any (`[[page]]`): it shows that page each time it starts, not the last note it showed. */
  pinPage: string | null = null;
  /** Counts the pin changes: a pin that was looked up for a page is dropped when the pin changed again meanwhile. */
  private pinGen = 0;
  /** The block its page named when it last resolved: a different note opened into it lets the page go (it stays pinned). */
  private pageNote: string | null = null;
  /** A saved layout had it follow the hidden current note (gone, PIE-1207): the desk wires a list to it once, and says so. */
  wasFollowing = false;
  /** Set by the desk as it draws a pinned reader: where opens aimed at it land instead (its hint row says it). */
  opensGo: string | null = null;
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
  lineField() { return this.surface.lineField; }
  /** Show `m` as its own (a note opened into it, alt+⏎ on a link). A reader pinned to a page shown another note lets the page go; the pin stays. */
  hold(m: Msg, desk: DeskApi, by: Actor = USER) {
    this.pinGen++;
    if (this.pinPage && m.id !== this.pageNote) { this.pinPage = null; this.pageNote = null; }
    this.show(m, desk, by);
  }
  /**
   * Pin it or let it go (`p`, a click on the pin chip, `reader.pin`): pinned, it keeps the note it shows (or `page`'s note,
   * shown again each time it starts) and every open aimed at it lands beside it; left out, `p`'s toggle.
   */
  async setPin(on: boolean | undefined, desk: DeskApi, page?: string): Promise<ReaderPin> {
    if (!this.pinnable) throw new ActionRefused("this reader is its screen's own: it has no pin");
    if (this.editing) throw new ActionRefused(holdsEdit("the reader"));
    const next = on ?? (page !== undefined || !this.pinned);
    const gen = ++this.pinGen;
    if (next && page !== undefined) {
      const r = await this.context(desk).board.resolvePage(page);
      if (r.status !== "resolved" || !r.block) throw new ActionRefused(`no page ${page} in this outline to pin to`);
      if (this.editing) throw new ActionRefused(holdsEdit("the reader"));
      if (gen !== this.pinGen) throw new ActionRefused("the reader's pin changed again while the page was looked up; nothing was pinned");
      this.pinned = true; this.pinPage = page; this.pageNote = r.block.id;
      if (this.msg?.id !== r.block.id) this.show({ ...r.block, address: this.noteAddress }, desk);
    } else {
      if (next && !this.msg) throw new ActionRefused("nothing to pin yet: open a note in it first, or name a page: act reader.pin page=<name>");
      this.pinned = next;
      this.pinPage = null; this.pageNote = null;
    }
    desk.redraw();
    return { pinned: this.pinned, ...(this.pinPage ? { page: this.pinPage } : {}) };
  }
  /** Start pinned: to `page` (shown once the page resolves, `pinnedTo`), else on the note it was saved with. */
  pinTo(page?: string) { this.pinned = this.pinnable; if (page) this.pinPage = page; }
  /** The page it's pinned to resolved to `block` (the tile joined a desk): show it, unless a note is open there already. */
  pinnedTo(block: Msg, desk: DeskApi) { if (this.pinPage && !this.msg) { this.pageNote = block.id; this.show({ ...block, address: this.noteAddress }, desk); } else if (this.pinPage && this.msg?.id === block.id) this.pageNote = block.id; }
  unsaved() { return this.surface.unsaved(); }
  keepDrafts(): string[] { return this.surface.keepDrafts(); }
  dispose() { this.offOutlineEvents?.(); this.surface.dispose(); }
  /**
   * A reader the person owns is a "detail" (the glossary's word: it keeps the note opened into it), which a host may
   * label ("detail 1" in the board's readers row); one its screen owns is a "reader". The pin chip says whether it's pinned.
   */
  title(): string {
    const st = this.surface.state();
    if (this.label !== null) {
      // A float says what it holds; in the row, which detail it is and whether ⏎ opens here.
      if (this.floating) return this.msg ? headedTitle(this.titleNote!, this.surface.src) || this.label : "float";
      return [this.label, this.msg ? "" : "empty", this.opensHere ? "⏎ opens here" : "", st].filter(Boolean).join(" · ");
    }
    if (!this.pinnable) return ["reader", st].filter(Boolean).join(" · ");
    return this.msg ? ["detail", st].filter(Boolean).join(" · ") : "detail · empty";
  }
  hint() { return this.surface.hint(!this.pinnable ? "" : this.pinned ? `pinned · opens → ${this.opensGo ?? "beside it"} · p unpins · ` : "p pin · "); }
  /** A reader's keys are its note's (NOTE_ACTIONS). */
  keysScope(): string { return NOTE_ACTIONS.scope; }
  /** The frame and policy panel share the words for the reader's pin. */
  stateLabel(): string {
    return this.pinPage ? `▣ pinned · [[${this.pinPage}]]` : this.pinned ? "▣ pinned" : "□ not pinned";
  }

  headControls(room: number, desk: DeskApi) {
    if (!this.pinnable) return null;
    const press = () => void runOwn(READER_ACTIONS, "reader.pin", {}, { pane: this, desk });
    const ways = this.pinPage ? [this.stateLabel(), "▣ pinned", "▣"] : this.pinned ? [this.stateLabel(), "▣"] : ["□ pin", "□"];
    const text = ways.find(w => width(w) <= room);
    return text ? [{ text, sgr: fg(this.pinned ? C.yellow : C.grey), press, chip: true as const }] : null;
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

  // ── Its attachments in a tile of their own (AttachedOwner, PIE-846, PIE-1448): its comment, Sources, list and edit
  // previews. The tile lends its room; the session, the inspector and the preview stay this reader's.

  /** The host a list preview's tile works through: its edit session is this reader's, so the keys come back here. */
  private listPreviewHost(desk: DeskApi): SurfaceHost {
    const host = this.host(desk);
    return { ...host, attachment: "list-preview", enterMode: () => { desk.focusPane?.(this, USER); host.enterMode?.(); } };
  }
  attachedView(a: Attachment, w: number, h: number, _focused: boolean, desk: DeskApi): PaneView | null {
    if (a === "edit-preview") return this.surface.editPreviewTile(w, h, this.host(desk));
    if (a === "list-preview") return this.surface.listPreviewTile(w, h, this.host(desk));
    if (a === "sources") return this.surface.sourcesTile(w, h);
    if (a === "comment") return this.surface.composerTile(w, h, this.host(desk));
    return null;
  }
  attachedKey(a: Attachment, k: Key, desk: DeskApi): boolean {
    if (a === "matches") return false;
    if (a === "edit-preview") {
      if (!this.surface.editPreviewKey(k, { ...this.host(desk), attachment: "edit-preview" })) void desk.perform?.("tile.focus", {}, USER, this);
      return true;
    }
    if (a === "list-preview") return this.surface.key(k, this.listPreviewHost(desk));
    if (this.surface.sourcesMode) this.surface.attachedKeys(a);
    return (a === "sources" ? !!this.surface.sourcesMode : !!this.surface.session) && this.surface.key(k, this.host(desk));
  }
  attachedMouse(a: Attachment, k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    if (a === "matches") return false;
    if (a === "comment") return this.surface.composerPointer(k, x, y, this.host(desk));
    const host = a === "list-preview" ? this.listPreviewHost(desk) : { ...this.host(desk), attachment: a };
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.surface.wheel(k.action === "wheel-down" ? 1 : -1, host, { x, y }); return true; }
    if (k.action === "down") this.surface.press(x, y, host);
    if (k.action === "drag") this.surface.drag(x, y, host);
    if (k.action === "up") this.surface.release(x, y, host);
    return true;
  }
  attachedTitle(a: Attachment, source: string): string {
    if (a === "edit-preview") return `edit preview · ${source}`;
    if (a === "list-preview") return `list children · ${source}`;
    if (a === "sources") return `sources · ${source}`;
    return `${this.surface.session?.mode === "threads" ? "comments" : "comment"} · ${source}`;
  }
  attachedHint(a: Attachment): string { return a === "matches" ? "" : a === "list-preview" ? "list children · click placement chip to move · click text to edit" : this.surface.attachmentHint(a); }
  attachedSide(a: Attachment, side: AttachedSide, desk: DeskApi): void {
    void this.surface.runKey(a === "edit-preview" ? "edit.preview.place" : a === "list-preview" ? "list.preview.place" : a === "sources" ? "sources.place" : "comment.place", { side }, this.host(desk), true);
  }
  attachedSideWords(): string { return "the note's"; }

  host(desk: DeskApi): SurfaceHost {
    const pane = this;
    const h: SurfaceHost = {
      externalGutter: this.gutterCols,
      heroBounds: this.heroBounds,
      innerFrame: this.innerFrame,
      ctx: this.context(desk),
      screen: () => desk.screen?.(),
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
      ...(desk.historyLanded ? { historyLanded: (by: Actor) => desk.historyLanded!(this, by) } : {}),
      // The trail (PIE-208) opens as a list over the screen this reader is on.
      ...(desk.overlay ? { overlay: (p: ListPicker<any, any>) => desk.overlay!(p) } : {}),
      ...(desk.keepLayout ? { keptChanged: () => desk.keepLayout!() } : {}),
      ...(desk.retirePeeks ? { retirePeeks: (by: Actor) => desk.retirePeeks!(this, by) } : {}),
      ...(desk.layoutUndoSeq ? { layoutUndoSeq: () => desk.layoutUndoSeq!() } : {}),
      ...(desk.untrash ? { untrash: (board: object) => desk.untrash!(board) } : {}),
      // A link followed in it lands where its opens land (PIE-794, the desk's one landing path): with no wire it replaces
      // its own note (a pinned one opens beside it); alt+⏎ opens beside.
      navigate: (m, how) => { m.address ??= this.noteAddress; desk.openFromTile(m, { reveal: true, from: this, ...how }); },
      summaryKeys: m => desk.summaryKeys?.(m),
      // A #tag opened in it: the notes carrying it, in a list beside it (PIE-800).
      ...(desk.openQuery ? { query: (q: string, how?: OpenHow) => desk.openQuery!(this, q, how?.by ?? USER, how?.standing) } : {}),
      ...(desk.openTag ? { tag: (t: string, how?: OpenHow) => desk.openTag!(this, t, how?.by ?? USER, how?.standing) } : {}),
      // A click on the crumbs shows the note in the outline (reader.reveal, PIE-794): readers of a screen with one.
      ...(desk.revealInOutline ? { revealInOutline: () => runOwn(READER_ACTIONS, "reader.reveal", {}, { pane: this, desk }) } : {}),
      // alt+D (PIE-1247): the desk's element.detach on this reader, which places the new tile.
      detach: () => runOwn(READER_ACTIONS, "element.detach", {}, { pane: this, desk }),
      // A row picked in a list drawn in the note shows where this reader's selection goes (PIE-794).
      ...(desk.showFrom ? { preview: (m: Msg, where?: OpenHow["where"]) => desk.showFrom!(this, m, undefined, where) } : {}),
      // Its look (PIE-673), as the desk resolved it for this tile: margin, list density, heading spacing.
      get look() { return desk.lookOf?.(pane); },
      // Its own header and written title (PIE-1248): what the tile says over what the note says.
      get tileHeader() { return pane.tileHeader; },
      get tileTitle() { return desk.writtenTitle?.(pane); },
      startSession: desk.startSession ? (kind, opener) => desk.startSession!(this, kind, opener) : undefined,
      ...(desk.writeFrom ? { writeNew: async (m: Msg) => {
        const at = await desk.writeFrom!(this, m);
        return at ? { tile: at.tile, surface: at.pane.surface } : null;
      } } : {}),
      // Its comment in a tile of its own beside it (PIE-846), where the screen has tiles.
      ...(desk.answerTile ? { answerTile: (ask: string, actor: Actor, fold?: string) => desk.answerTile!(this, ask, actor, fold) } : {}),
      hasWiredPreview: () => !!desk.hasWiredPreview?.(this),
      ...(desk.listPreviewTile ? { hasListPreviewTile: () => !!desk.hasListPreviewTile?.(this), listPreviewTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.listPreviewTile!(this, on, side) } : {}),
      ...(desk.editPreviewTile ? { hasEditPreviewTile: () => !!desk.hasEditPreviewTile?.(this), editPreviewTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.editPreviewTile!(this, on, side) } : {}),
      ...(desk.trailTile ? { trailTile: () => desk.trailTile!(this) } : {}),
      ...(desk.sourcesTile ? { hasSourcesTile: () => !!desk.hasSourcesTile?.(this), sourcesTile: (on: boolean, side?: "left" | "right" | "up" | "down") => desk.sourcesTile!(this, on, side) } : {}),
      ...(desk.composerTile ? { composerTile: (on: boolean, keys?: boolean, side?: "left" | "right" | "up" | "down") => desk.composerTile!(this, on, keys, side), hasComposerTile: () => !!desk.hasComposerTile?.(this) } : {}),
      // Its own keys and clicks run its note actions through the screen's dispatcher, where it's a tile.
      ...(desk.press ? {
        press: (name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), given?: SurfaceHost) => desk.press!(this, NOTE_ACTIONS, name, args, quiet, given),
        pressSet: (set: ActionSet<any, any>, name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), given?: SurfaceHost) => desk.press!(this, set, name, args, quiet, given),
      } : {}),
      // `b`: this note's links in the screen's links tile (one opened beside it where there's none).
      ...(desk.openLinks ? { links: (actor: Actor, standing: boolean) => desk.openLinks!(this, actor, standing) } : {}),
      ...(desk.noteGone ? { gone: (id: string) => desk.noteGone!(this, id) } : {}),
      // A reader the person owns takes `p` (its pin) before the surface does.
      ...(this.pinnable ? { ownKeys: "p" } : {}),
    };
    return h;
  }

  refresh(m: Msg) { this.surface.refresh(m); }
  /** Read its note again (NoteSurface.reread: one read at a time, a draft only marked). */
  reread(desk: DeskApi) { this.surface.reread(this.host(desk)); }
  /**
   * Why it won't take note `m` now: it holds an edit or a comment on another (PIE-761). The one answer (PIE-1294): every
   * screen that shows a note in a reader asks this, or `showOr`, and says these words; null when it would.
   */
  keepsOff(m: Msg | null, label = this.detailLabel() ?? "the reader"): string | null {
    return this.editing && m?.id !== this.msg?.id ? holdsEdit(label) : null;
  }
  /** Show `m`, or say why not (`keepsOff`). */
  showOr(m: Msg | null, desk: DeskApi, label?: string): string | null {
    const no = this.keepsOff(m, label);
    if (no) return no;
    this.show(m, desk);
    return null;
  }
  show(m: Msg | null, desk: DeskApi, by: Actor = USER) {
    if (this.keepsOff(m)) return false;
    const host = this.host(desk);
    const shown = this.surface.show(m, { ...host, ctx: host.contextFor!(m) }, by);
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
   * What a layout saves of a reader: its note, its pin (on its note, or on a page), its place and its back and forward
   * stacks (PIE-643). A reader its screen owns saves only its place.
   */
  spec(): Record<string, unknown> {
    const nav = this.wantNav ? this.wantNav : this.surface.saveNav();
    const note = this.msg && !this.msg.id.startsWith("file:") ? this.msg.id : this.want;
    // A pinned reader comes back on its page, not on the last note it showed: no history to keep.
    if (this.pinPage) return { mode: "pinned", page: this.pinPage, ...this.noteAddress, ...this.marginSpec() };
    if (this.pinnable) return { ...(this.pinned ? { mode: "pinned" } : {}), ...(note ? { note } : {}), ...(nav ? { nav } : {}), ...this.noteAddress, ...this.marginSpec() };
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
    return "keeps the note opened into it · alt+l in another tile, then a click here, sends that tile's opens here";
  }
  render(w: number, h: number, _focused = false, desk?: DeskApi): PaneView {
    const field = this.surface.panel?.field?.input ?? this.surface.writingDraft;
    const completion = field && completerOf(field);
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
  describe() { return { title: this.title(), pinned: this.pinned, ...(this.pinPage ? { page: this.pinPage } : {}), ...this.surface.describe() }; }

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
    return { title: this.msg ? headedTitle(this.titleNote!, this.surface.src) : this.title(), marks };
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
    if (this.pinnable && !this.editing && !this.surface.typingFilter && ch(k) === "p") { runOwn(READER_ACTIONS, "reader.pin", {}, { pane: this, desk }); return true; }
    if (this.pinnable && !this.editing && ch(k) === "P") { this.pickSource(desk); return true; }
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
  pointAt(x: number, y: number, desk: DeskApi): Promise<unknown> | null { return this.surface.pointAt(x, y, this.host(desk)); }
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


export const ACTIVITY_ACTIONS = actionSet<{ pane: ActivityPane; desk: DeskApi; standing: boolean }>()("activity", {
  "activity.pick": def({
    summary: "pick a row of the activity tile (last callers, live): n from 1, else the selected one; open=true opens its note where the tile's opens land, as ⏎ does. An agent's pick answers the row and moves nothing of the person's",
    keys: [{ keys: "j k ↑ ↓", does: "a row" }, { keys: "click wheel", does: "a row" }, { keys: "⏎", does: "open", says: "open the picked row of the activity tile" }],
    touches: "nothing", replay: "safe", says: r => (r.opened ? `opened ${String(r.title)}` : null),
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, open: { type: "boolean", optional: true, about: "open its note where the tile's opens land, as ⏎ does" } },
    examples: [
      { act: "activity.pick tile=activity n=1", does: "answers the newest caller's row: who, which note, when" },
      { act: "activity.pick tile=activity n=2 open=true", does: "opens the note on row 2 where the tile's opens land, as enter does" },
    ],
    run({ n, open }, { pane, desk, standing }, actor) {
      const rows = pane.list(), i = rowN(n, pane.selected, rows.length, "activity");
      const r = rows[i]!;
      // An agent's pick is its own (the answer); the person's moves their selection.
      if (standing) pane.pickRow(i, desk);
      if (open) desk.openFromTile(r.block, { reveal: true, link: true, from: pane, by: actor });
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


/** Where a detached part opens, beside its reader: tile.open's places. */
const DETACH_WHERE = ["left", "right", "up", "down", "tabs", "edge-left", "edge-right", "edge-up", "edge-down"] as const;

export const READER_ACTIONS = actionSet<{ pane: ReaderPane; desk: DeskApi }>()("reader", {
  "element.detach": def({
    summary: "detach a part of the reader's note (PIE-1247): the figure, callout, list item or paragraph at line= (from 1; default the current element, else the top row read), or anchor=, becomes a block of its own under the .detached page that embeds it (!((note^anchor)), its anchor written if it had none) and opens in a tile of its own with no header, where= beside this reader (or to=<tile>). From then on it's an ordinary note: it outlives this tile, and the part's note lists it among its backlinks by the anchor",
    keys: [{ keys: "alt+D", does: "in a reader" }, { keys: "alt-drag", does: "a part out of the reader onto a tile's side, its header or the screen's edge" }],
    touches: "screen", replay: "ask",
    menu: { label: "detach this part", group: "Reader", key: "alt+D", now: ({ pane }) => (!pane.msg ? { refused: "nothing in that reader to detach" } : null) },
    args: {
      line: { type: "number", optional: true, about: "the part's line in the note, from 1 (default: the current element, else the top row read)" },
      anchor: { type: "string", optional: true, conflicts: ["line"], about: "the part's ^anchor, when it has one" },
      where: { type: "string", optional: true, choices: DETACH_WHERE, about: "where its tile opens: beside to= (default this reader), as a tab in it, or along the screen's edge (default right)" },
      to: { type: "string", optional: true, kind: "tile", about: "the tile it opens beside (default this reader)" },
    },
    examples: [
      { act: "element.detach tile=reader line=4", does: "detaches the figure on line 4 of the reader's note into a tile of its own, right of it" },
      { act: "element.detach tile=reader anchor=bed-jobs where=down", does: "detaches the part anchored ^bed-jobs into a tile below the reader" },
    ],
    async run({ line, anchor, where, to }, { pane, desk }, actor) {
      const r = await pane.surface.materialize({ kind: "detached" }, pane.host(desk), actor, { ...(anchor ? { anchor } : {}), ...(line !== undefined ? { line: line - 1 } : {}) });
      if (!("block" in r)) throw new ActionRefused("the service put it into a note, not a block of its own");
      let opened: unknown = null;
      // A tile that can't open there (a locked screen, a tile that isn't one) takes the detached block back: nothing is left behind.
      try { opened = desk.perform ? await desk.perform("tile.open", { kind: "reader", note: r.block.id, where: where ?? "right", ...(to ? { to } : {}) }, actor, to ?? pane) : null; } catch (err) {
        if (r.undo) await desk.ctx.board.undoExtension(r.undo, actor).catch(() => undefined);
        throw err;
      }
      return { detached: r.block.id, part: r.subjects[0]!.ref, ...(r.subjects[0]!.anchored ? { anchored: true } : {}), ...(r.undo ? { undo: r.undo } : {}), ...(opened && typeof opened === "object" ? { opened } : {}) };
    },
  }),
  "element.quote": def({
    summary: "put a part of the reader's note into another note (PIE-1247), as the alt+drag's drop does: the part at line= (from 1; default the current element) or anchor= goes into=<note> (an id, ((id)) or [[page]]) after its line at= (from 1; a part there, a figure or a callout, after the whole of it), as a reference (!((note^anchor)) for a figure or callout, ((note^anchor)) for a list item or paragraph; its anchor written if it had none) or, copy=true, its own lines (a figure with its query, which then answers for the note it's in). Through draft.patch: an edit open there takes it in place",
    keys: [{ keys: "alt-drag", does: "a part onto another reader's note, then choose reference or copy" }],
    touches: "draft", draft: "write", replay: "ask",
    args: {
      into: { type: "string", optional: false, kind: "note", about: "the note it goes into: an id or ((id))" },
      after: { type: "string", optional: true, about: "the text of line at= as you read it: moved since, the part goes after it where it is now (or is refused)" },
      at: { type: "number", optional: false, about: "the line of that note it goes after, from 1" },
      copy: { type: "boolean", optional: true, about: "copy its own lines instead of a reference (a figure comes with its query)" },
      line: { type: "number", optional: true, about: "the part's line in this reader's note, from 1 (default: the current element)" },
      anchor: { type: "string", optional: true, conflicts: ["line"], about: "the part's ^anchor, when it has one" },
    },
    examples: [
      { act: "element.quote tile=reader line=4 into=((5e2b8c14-7a3d-4f19-b6e2-0c9d8a1f3e57)) at=2", does: "embeds the figure on line 4 in the sticky pad, after its second line" },
      { act: "element.quote tile=reader anchor=bed-jobs into=5e2b8c14-7a3d-4f19-b6e2-0c9d8a1f3e57 at=1 copy=true", does: "copies the figure, query and all, into the pad after its first line" },
    ],
    async run({ into, at, copy, line, anchor, after }, { pane, desk }, actor) {
      // The note it goes into, as a reference names one: an id, ((id)), or a [[page]] the service resolves.
      const named = String(into).trim(), page = /^\[\[(.+)\]\]$/.exec(named)?.[1];
      const blockId = page ? (await desk.ctx.board.resolvePage(page)).block?.id : referencedBlock(named)?.blockId ?? named;
      if (!blockId) throw new ActionRefused(`no page is named ${page}: name the note by its id, ((id)) or [[page]]`);
      const part = { ...(anchor ? { anchor } : {}), ...(line !== undefined ? { line: line - 1 } : {}), ...(copy ? { as: "copy" as const } : {}) };
      const r = await pane.surface.materialize({ kind: "into", blockId, line: Math.max(0, Number(at) - 1), ...(after !== undefined ? { observed: String(after) } : {}) }, pane.host(desk), actor, part);
      if (!("into" in r)) throw new ActionRefused("the service made a block, not an edit of that note");
      return { into: r.into, part: r.subjects[0]!.ref, ...(r.subjects[0]!.anchored ? { anchored: true } : {}), said: r.said };
    },
  }),
  "reader.reveal": def({
    summary: "show a reader's note in the outline (tile=<a reader>, default the focused one): the outline's cursor moves to its row, unfolding what's over it, and its dock slides open if it's shut, as the outliner's Tree's r does. Nothing else moves: the reader, its pin and the keys stay. A held reader's own navigation never moves the outline (PIE-794); this finds where it is. The person's: the outline's cursor is theirs",
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
    summary: "which tile's selection a reader (tile=<its name>) shows: source=<tile> (a tile with a selection: the tree, a links tile, another reader; a select wire, alt+l's, saved with the layout) or source=none (no select wire: it keeps what it shows). Left out, opens the policy panel, where its wires are",
    keys: "P opens the policy panel",
    touches: "tile", replay: "safe", way: "an agent wires a reader to a list when the person isn't in it", says: r => (r.asked ? null : r.source === "none" ? "unwired the reader's selection" : `wired ${r.source}'s selection to the reader`),
    menu: { label: "shows…", group: "Reader", key: "P", now: ({ pane }) => (!pane.pinnable ? { hide: true } : pane.editing ? { refused: holdsEdit("the reader") } : null) },
    args: { source: { type: "string", optional: true, kind: "tile", choices: ["none"], about: "a tile's name (a tree, a links tile, a reader), or none; left out, the policy panel (the person's)" } },
    examples: [
      { act: "reader.follow tile=reader source=tree", does: "the reader shows whatever the tree's selection is on" },
      { act: "reader.follow tile=reader source=none", does: "takes the select wires into the reader away: it keeps the note it shows" },
    ],
    async run({ source }, { pane, desk }, actor) {
      if (!pane.pinnable) throw new ActionRefused("this reader is its screen's own: nothing is wired to it");
      if (source === undefined) {
        if (actor.kind === "agent" || !desk.askFollow) throw new ActionRefused("name it: source=<tile> or source=none");
        desk.askFollow(pane);
        return { asked: true };
      }
      if (!desk.followFrom) throw new ActionRefused("this screen has no tiles to wire");
      if (source === "none") { desk.followFrom(pane, null, actor); return { source }; }
      if (pane.editing) throw new ActionRefused(holdsEdit("the reader"));
      // Checked before anything changes: a refused source leaves the reader as it was.
      const why = desk.followRefusal?.(pane, source, actor);
      if (why) throw new ActionRefused(why);
      desk.followFrom(pane, source, actor);
      return { source };
    },
  }),
  "reader.pin": def({
    summary: "pin a reader (tile=<its name>, any reader the person owns) or let it go (PIE-1207): pinned, it keeps the note it shows (page=<name>: that page's note, shown again each time it starts), every open aimed at it lands in a reader beside it, and it comes back pinned after a restart; on=true|false, left out p's toggle. Said on screen when an agent does it",
    keys: [{ keys: "p", does: "pin or unpin" }, { keys: "P then ⏎ space", does: "on Pin pins or unpins it" }, { keys: "click", does: "the pin chip on its frame" }],
    touches: "tile", replay: "safe", way: "an agent pins a reader when the person isn't in it", says: r => (r.pinned ? `pinned the reader${r.page ? ` on [[${r.page}]]` : ""}` : "unpinned the reader: opens land in it again"),
    menu: { label: "pin it", group: "Reader", key: "p", now: ({ pane }) => (!pane.pinnable ? { hide: true } : pane.editing ? { refused: holdsEdit("the reader") } : pane.pinned ? { label: "unpin it" } : null) },
    args: {
      on: { type: "boolean", optional: true, about: "true pins, false lets go; left out, the other of the two" },
      page: { type: "string", optional: true, about: "pin it on a page's note (`[[name]]`), shown again each time it starts" },
    },
    examples: [
      { act: "reader.pin tile=reader", does: "pins the reader on its note: opens aimed at it land beside it" },
      { act: "reader.pin tile=reader page=garden", does: "pins the reader to [[garden]], shown again each time it starts" },
    ],
    async run({ on, page }, { pane, desk }, actor) {
      const result = await pane.setPin(on as boolean | undefined, desk, page as string | undefined);
      if (result.pinned) desk.holdReader?.(pane, actor);
      return result;
    },
  }),
});
