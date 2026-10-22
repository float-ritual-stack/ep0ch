import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { declaredHints, hintSetting, setHint, resetHints, type HintSetting } from "../surface/hints";
import { Draft, keepCopy } from "../edit";
import { errorDetails } from "../status-log";
import { HomeSurface } from "../surface/home";
import { type Completer } from "../surface/completer";
import { floatTheme } from "../theme";
import { FRAME_GLYPHS, FRAME_LEGEND } from "./frame-controls";
import { HintCard, hintStatus, MOVE_HINT, RESIZE_HINT, GATHER_HINT, CONFIRM_HINT, type Hint } from "../surface/hint-card";
import { revealOn, type Reveal } from "../reveal";
import { rowLines, withRowLimit } from "../text";
import { readNote, outlineBoards } from "./outline-boards";
import { MIN_ROWS, type AltRule } from "./layout";
import { subtitleOf } from "@ep0ch/outline-core/block-record";
// The desk: the door owns the whole canvas, and the canvas is tiles (PIE-413). A tile is a view (the outline
// tree, a reader, a detail, a preview, a program in a terminal, a whole screen) in the layout tree: split,
// tabbed, dragged by its header and dropped on another tile's header or centre (tabs), a side (a split)
// or the layout's outer edge (a full-height column or full-width row). A tile can slide over the others as
// a dock instead, and pinning puts it back. Each tile's opens can land in a tile of its choosing (its
// link, PIE-473). The arrangement is a layout saved by name (PIE-474).
//
// Every change goes through a named action (TILE_ACTIONS, PANE_ACTIONS, DESK_ACTIONS): the keys, the mouse
// and the control socket are callers. The desk draws the borders, headers, tabs and the drag's ghost.
import { nothingToClose, refused, shellKeyOf } from "../shell-keys";
import type { Ctx, Frame, Refusal, Screen, ViewState } from "../app";
import { SURFACE_STEPS } from "@ep0ch/outline-core/style-cascade";
import { valuesOf } from "@ep0ch/outline-core/block-record";
import { interpolate } from "@ep0ch/outline-core/interpolation";
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { headedTitle, subject, type Msg } from "../board";
import { BORDER_BOXES, Canvas, DOTTED_BOX, LINE_BOX, NO_BOX, overflows, type BoxGlyphs, type Rect } from "../canvas";
import { TONE } from "../callouts";
import { MOUSE_RIGHT, RowPresses, sideways, SidewaysWheel, type RowPress } from "../scroll";
import { readLinks } from "../links";
import { AGENT_GLYPH, AGENT_WORDS, agentRefusal, isAgentLevel, nextAgentLevel, type AgentLevel } from "../surface/agent-level";
import { uncover, type Placement } from "../kitty";
import { inResize, resizeEnded, resizing } from "../resize";
import { authorName, whoOf, USER, type Actor, type OutlineEvent } from "../socket";
import { lastTrashed } from "../note-trash";
import { LayoutHistory, type LayoutEntry } from "./layout-history";
import { motionMode, planMotion, Transition, type MotionPlan } from "../motion";
import { TXN } from "../surface/txn";
import { INVITES } from "../surface/invite";
import { partyOf } from "../steps";
import { ActionRefused, ActionSet, actionSet, def, asActor, asBoundKey, hintSpots, keyCaption, keyName, lineWords, type ActRequest } from "../surface/actions";
import { newNoteOffer, type NewNoteHow } from "../new-note";
import { actorRule, Dispatcher, isTilePath, type Delegation, type MenuRow, type Registration, type RunHow, type TileRef } from "../surface/dispatch";
import type { ScreenKeys, Whereabouts } from "../whereabouts";
import { armsEdit, leaveSaid, NOTE_ACTIONS, PROPOSAL_ACTIONS, type OpenHow, type SurfaceHost, type TagList } from "../surface/note";
import { keepEditFile } from "../surface/editor";
import { Modes } from "../surface/modes";
import { centred, linePrompt, ListPicker, pickRows, pickRow } from "../surface/picker";
import { outlineState, readState, writeState } from "../state";
import { hyperOn } from "../hyper";
import { containerKeys, leafNames, slotNames, madeScreen, mountProblem, newNoteRule, resolveScreen, savedNodes, screenNames, screenParts, screenSlug, screenSpec, screenTargetArg, screenTitle, screenTitleProblem, specData, type NewNoteOpens, type NewNoteRule, type ScreenSpec } from "./screen-spec";
import { saveScreenNote, ScreenConflict, screenNotes, trashScreenNote } from "./screen-notes";
import { visible as visibleText, bg, bgRgb, BOLD, C, fgRgb, chip as chipStyle, fg, fitHint, headOf, tailFrom, pad, paint, RESET, selected, surfaceBg, UNBOLD, width } from "../style";
import { theme, themed } from "../theme";
import { ch, type Key, type TileProgram } from "../term";
import { DOCK_DROP, dropAt, handleDrop, type Drop, type DropTile } from "./drop";
import {
  agentLevel, allTiles, apply as applyOp, autoName, chainOf, wireTarget, selectTargets, describe as describeLayout, dividerAt, dragShare, dockOf, docks, EDGE_GLYPH, effective, init, isLine, keepOnScreen, kidsOf, landing, layers as policyLayers, leaf, leaves,
  neighbour, node, nodeById, parentNode, parentOf, place as placeLayout, serializeTree, policyAt as policyOver, policyOf, policyOfNode, rects as rectsOf, refusal, reviveTree, revisionRefusal, serialize as serializeLayout, splitAxis,
  shape as layoutShapeOf, shown, splitOf, tabsOf, tileOfColumn, travelTarget, visible, columnOf, UNLOCK, type At, type Axis, type Columns, type Container, type Ctx as LayoutCtx, type Dir, type Divider, type Dock, type Effective, type Float, type Flow,
  type Fold, type Grab, type HostMode, type LayoutState, type WireVerb, type Wire as TileWire, type LNode, type Op, type Place, type Placed, type PlacedDock, type Policy, type Result, type TileFacts,
} from "./screen-layout";
import { drawHSpine, drawSpine, SPINE } from "../spine";
import { PANE_ACTIONS, type PaneDone } from "./pane-actions";
import { lookFor, pageOf, type Look } from "../look";
import type { Step } from "../session/restore";
import { AnswerTile } from "./answer-tile";
import { AttachedTilePane } from "./attached-tile";
import { Entered, ReaderPane, sessionName, sessionStart, startSession, type DeskApi, type Pane, type PaneView, type SessionKind } from "./panes";
import { isEscapeChord, PtyPane, ESCAPE_CHORD } from "./pty";
import { ptyBackend } from "./pty-backend";
import { PreviewPane } from "./preview";
import { fileOpenNote } from "./file-open";
import { isOutlineNote, openResource, resourceRefTarget } from "../authored";
import { LocalMarks, markLabel, type Mark, type MarkStore } from "./marks";
import { TILE_ACTIONS, type NewTile, type TileDone, type TileNow, type Where } from "./tile-actions";
import { tileMenu } from "./tile-menu";
import { filtered } from "../bar/filter";
import { ScreenTile } from "./screen-tile";
import { QueryPane } from "./query";
import { DRAWER_NAME, DRAWER_TILE_ID } from "./agent-env";
import { builtin, canonSpec, type SavedFloat, isTileKind, layoutNamed, layoutNames, makeTile, tileKindNames, tileNameProblem, type LayoutSpec, type OpenRule, type SavedTree, type TileSpec } from "./tiles";
import { W_KEYS, wBoxLines, wKey, wRows, type WRow, type WSpecialKey } from "./wkeys";
import { allKindActions, kindActions, kindForKey, kindNoun, kindOf, lastKindOf, tileKinds, tileSource, unwatchTileKinds, watchTileKinds, wasTileKind, type ColumnsHost, type SourceModel, type TileEnv, type TileKind, type TileKindName } from "./tile-kinds";
import { prop } from "../props";

/**
 * desk.json: the layout tree of tile specs (pairs as `ratio a b`, what every door reads), the focus, the open
 * rule; and (PIE-491) the layout's revision and the next tile and split ids, so a restarted door never gives
 * out a revision or an id an agent may still hold from before (a Herdr agent outlives the door).
 */
/**
 * How a desk is made beyond its spec. `layout`: a named layout to lay it out as. `given`: tiles the host made, by name
 * (`adopt`: they are this desk's own from now on, moved here whole: a group's tiles, PIE-651). `writes: false`: it reads
 * its save but never writes it. `saved`: the state it comes back as, instead of its spec's file (a mounted screen's, kept in
 * its mount's tile spec), and `onSave`: what a save does instead of writing that file (the desk holding the mount saves).
 */
export interface DeskOpts {
  layout?: string; given?: ReadonlyMap<string, Pane>; adopt?: boolean; writes?: boolean; where?: () => Whereabouts; idPrefix?: string;
  openArgs?: Record<string, unknown>; saved?: unknown; onSave?: () => void;
  /** The screens this one is mounted in, outermost first (`mountChain`): what a mount here is checked against. */
  chain?: readonly string[];
  /**
   * Where an open goes that this screen has no reader for (a mounted part, the board's lanes alone, PIE-651): the screen
   * holding the mount opens it where the mount's opens land.
   */
  outward?: (m: Msg, by: Actor, fresh: boolean) => Promise<{ reader: string | null; id: string }>;
}
export interface SavedDesk { root: SavedTree; focus: number; rule?: OpenRule; layout?: string; rev?: number; next?: { tile?: number; node?: number }; policy?: Policy; floats?: SavedFloat[]; models?: Record<string, unknown>; zoom?: string }
/** The desk's own spec (PIE-515): the desk as it has always opened, kept in desk.json, and the screen that loads named layouts. */
export function deskSpec(): ScreenSpec {
  // A layout saved under the name "desk" is the desk's own.
  return { name: "desk", title: "desk", layout: layoutNamed("desk")?.spec ?? builtin("desk")!, saves: "desk.json", layouts: true, stays: true };
}
/** Frame glyphs by a spec's `frame`. */
const FRAMES: Record<NonNullable<ScreenSpec["frame"]>, BoxGlyphs> = { dotted: DOTTED_BOX };
/** The focused tile's frame: double lines, so the tile the keys go to shows by its shape whatever its colour. */
const FOCUS_BOX: BoxGlyphs = { top: "═", bottom: "═", side: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" };

const TO_EDGE: Record<string, Dir> = { H: "left", J: "down", K: "up", L: "right" };
const MOVE: Record<string, Dir> = { h: "left", j: "down", k: "up", l: "right" };
const ARROW: Record<string, string> = { left: "h", right: "l", up: "k", down: "j" };
// The keys after ^W are the table in ./wkeys (W_KEYS): command() reads each one's binding from it.
/**
 * Resize mode (sticky): after ^W and a resize key (a W_KEYS row marked `sticky`) the door stays in it, and those keys resize
 * the focused tile again with no ^W: the rows' own actions. h j k l and the arrows stand for < > - + by axis.
 */
const RESIZE_ALIAS: Record<string, string> = { h: "<", l: ">", k: "-", j: "+" };
/** How long resize mode waits for a key before it lets go, in milliseconds. */
const RESIZE_IDLE_MS = 4000;
/** Bare keys that fold and unfold the focused tile (PIE-699), when nothing takes them: `-` folds it; `+` and `=` (the same key unshifted) open it. */
const FOLD_KEYS = new Set(["-", "+", "="]);
const DAILY_LAYOUT_KEYS: readonly ModeKey[] = [{ key: "alt+d", action: "layout.load", args: { name: "daily" }, label: "daily" }];

type Prefix = "" | "wm" | "add" | "addtab" | "move" | "tab" | "resize";
/** How many ms of laying tiles out again a frame spends while a resize goes on (Desk.pickReflows). */
const REFLOW_MS = 4;
/** While a resize goes on, how old a tile's view gets before it's drawn again though its size didn't change. */
const REDRAW_MS = 100;

/** A key pressed while a tile is dragged by its header: the action its ^W chord runs, on the dragged tile. */
const DRAG_KEYS: Record<string, [string, Record<string, unknown>]> = { f: ["tile.float", {}], p: ["tile.dock", {}], a: ["tile.drawer", {}] };
/** A header pressed: the tile (a tab) it would drag, and where. A drag of a cell or more starts moving it. */
interface HeadPress { id: number; x: number; y: number }
/** A row of the policy panel (^W P): what it is, its value, what ⏎ or a click does, + and -; `wide` rows say it all in the label. */
interface PanelRow { label: string; value: string; clear?: () => void; run?: () => void; adjust?: (by: number) => void; wide?: boolean; wire?: "follows" | WireVerb }
/** One of a tile's links as its panel and header say it (PIE-855): plain words, and what changes or cuts it (an action each). */
export interface Wire { says: string; short?: string; /** The tile on this desk it follows (or opens into), when there is one: what a drawing decision reads (PIE-886). */ source?: number; change?: { label: string; short?: string; run: () => void }; unlink?: { label: string; run: () => void } }

/**
 * The only screen host (PIE-515), and final: every screen is a spec (src/desk/screen-spec.ts) on it, never a
 * subclass. What a screen does beyond its layout is its tiles' kinds' and their actions.
 */
export class Desk implements Screen, DeskApi, ColumnsHost {
  title: string;
  /** What the screen is: its spec's name (`desk`, `welcome`), or the name a blank screen was saved under (PIE-565). */
  get name(): string { return this.madeAs ?? this.spec.name; }
  ctx!: Ctx;
  current: Msg | null = null;
  private panes = new Map<number, Pane>();
  /**
   * The screen's layout (PIE-513): the tree, the floats, the spines, the zoom, the links, the tiles' names, the
   * screen's policy and lock, the revision. One value, changed only by the screen-layout module's `apply` (one
   * checked step per operation, `this.apply`). The desk keeps the tile instances, the gestures and the painting.
   */
  private state: LayoutState<number> = init({ tree: leaf(0), names: new Map() });
  /**
   * One history of the screen's shape for every actor (PIE-957, src/desk/layout-history.ts): each change recorded at the
   * state setter with who made it and its transaction. `layout.undo` rebuilds from the newest.
   */
  readonly history = new LayoutHistory();
  /** Who asked each answer the module gave, and what for: `commit` records the change as theirs. */
  private asked = new WeakMap<object, { actor: Actor; op: string }>();
  /** The layout is being put back (an undo, a transaction's end rule): that is no new entry. */
  private replaying = false;
  /**
   * Motion (PIE-958): a change of shape draws its tiles on the way from where they were to where they are. `pending` is a
   * change recorded and not yet laid out (the next paint knows where the tiles are now); `transition` is one running. They
   * are paint only: the layout, `peek`, `viewState` and a snapshot read the settled state, and the first key or click settles it.
   */
  private pendingMotion: { from: Map<number, Rect>; plan: MotionPlan; floated: Set<number> } | null = null;
  private transition: Transition | null = null;
  /** The clock motion runs on (a test injects its own). */
  clock: () => number = () => Date.now();
  /** The layout as the module last answered it: read it; it changes by `apply`. */
  private get layout(): LayoutState<number> { return this.state; }
  /** The layout tree as the module last answered it: read it, never change it (`apply` does). */
  private get root(): LNode { return this.layout.tree; }
  /** Tiles with their own rectangle, above everything, the last on top (one float model for every screen). */
  private get floats(): readonly Float<number>[] { return this.layout.floats; }
  /** Tiles folded to a spine (`tile.collapse`), and the agent that folded one, if an agent did. */
  private get collapsed(): ReadonlyMap<number, Fold> { return this.layout.collapsed; }
  private get zoom(): number | null { return this.layout.zoom; }
  /** Each tile's name: what links, previews, `act tile=` and `peek` call it. */
  private get names(): ReadonlyMap<number, string> { return this.layout.names; }
  /** The open rule of the screen (its policy's `opens`): where an open with no link lands. */
  private get rule(): OpenRule { return this.layout.policy.opens ?? "current"; }
  /** The person's keys: which tile has them. Where they go after a layout change is the module's answer. */
  private focus: number;
  private nextId = 1;
  private prefix: Prefix = "";
  private drag: Grab | null = null;
  /** The share the border being dragged was last put at. */
  private dragAt: number | null = null;
  /** A reader the mouse went down in (PIE-419): its drag selects text, its release is the click. */
  /** A press in a reader, until it comes up: where the reader's content was drawn (`col`, `row`, `cols`: PIE-673's rect). */
  private pressed: { frame?: Rect; gutter?: Rect; pane: ReaderPane; col: number; row: number; cols: number; fresh: boolean; focusing?: boolean } | null = null;
  /** Where a drag or a release lands in the pressed reader: padding held to the nearest content cell, the gutter kept separate, its row free (past an edge scrolls). */
  private pressedAt(p: { frame?: Rect; gutter?: Rect; col: number; row: number; cols: number }, k: { x: number; y: number }) {
    if (p.frame) return { x: k.x - p.col, y: k.y - p.row };
    if (p.gutter && k.x >= p.gutter.col && k.x < p.gutter.col + p.gutter.cols)
      return { x: k.x - p.gutter.col - p.gutter.cols, y: k.y - p.row };
    return { x: Math.max(0, Math.min(p.cols - 1, k.x - p.col)), y: k.y - p.row };
  }
  private gutters = new Map<number, Rect>();
  private placed: Placed = { rects: new Map(), nodes: new Map(), dividers: [] };
  /** `inTile`'s tiles, by id: the reader each opened beside, where the person's keys go back when they close it. */
  private openedFrom = new Map<number, number>();
  /** Its own overlays (the search, the layout picker, the policy panel): the first takes every key and click. */
  private readonly overlays = new Modes<Desk, ListPicker<any, Desk>>();
  /** The reader edit, comment or property panel the person is in: only that one takes their keys (PIE-411). */
  private entered = new Entered();
  private failedEdits = new Map<ReaderPane, { of: string; keys: Key[]; text: string; copy: string; why: string }>();
  /** A session the person started by key that is still opening (the note being read): Esc cancels it. */
  private pending: { pane: ReaderPane; kind: SessionKind; opener: Key; keys: Key[] } | null = null;

  // ── tiles (PIE-413) ──
  /**
   * Tiles saved with a kind nobody has registered: a tile that says so stands in, saves write their spec back
   * as it was, and the tile is made again when the kind comes (`kindsChanged`).
   */
  private unregistered = new Map<number, TileSpec>();
  /** The docks sliding over the layout as last drawn, each with its tiles (for the mouse). */
  private slid: PlacedDock<number>[] = [];
  /** The lock chip at the end of the hint row, as last drawn. */
  private lockChip: { from: number; to: number } | null = null;
  private hyperChip: { from: number; to: number } | null = null;
  /** The hint row as composed, when it was too long for the row and was cut ("? more"); where "? more" is on it. */
  private hintFull: string | null = null;
  private moreChip: { from: number; to: number } | null = null;
  /** The hint row's parts that start with a key, and the open keys box's: a click on one presses it (`hintSpots`). */
  private keySpots: { y: number; from: number; to: number; key: Key }[] = [];
  /** The tiles' own (PaneView.spots, an empty place's `+ New note`), on the screen; a tile laid over one takes it away. */
  private tileSpots: { y: number; from: number; to: number; key: Key; tile?: number }[] = [];
  /** The whole hint row shown above it (keys.more: ?, or a click on "? more"), until the next key or click elsewhere. */
  private hintMoreOpen = false;
  /** A ^W chord's keys box (PIE-704): the most-used keys, a line per group, drawn above the hint row (wkeys.ts). */
  private hintBox: string[] | null = null;
  /** ^W P: the policy panel over the focused tile's containers. */
  /** The spines drawn, for a click. */
  private spines: [number, Rect][] = [];
  /**
   * A float's title or ◢ corner being dragged: it follows the pointer by `float.place`. Its title over a tile's header,
   * a dock's handle or the screen's outer edge (PIE-591) is a place to dock it (`drop`): released there, it's a
   * `layout.move` into the layout, as a tile's drag is; anywhere else it only moves.
   */
  private floatDrag: { id: number; size: boolean; dx: number; dy: number; drop?: Drop<number> | null; x?: number; y?: number } | null = null;
  /** The layout last loaded or saved by name. */
  private layoutName: string | null = null;
  /** The terminal tile the person is typing in: every key but the escape chord is its program's. */
  private ptyIn: PtyPane | null = null;
  /** The tile under the pointer's press on a header, and the drag it became. */
  private headPress: HeadPress | null = null;
  /** `drawer`: it's over the drawer (the status bar's chip, or the dock), where a release puts it in: what that says. */
  private dragging: { src: number; drop: Drop<number> | null; x: number; y: number; drawer?: string | null; into?: GroupDrop } | null = null;
  /** The group whose own drop zones show a dragged tile's ghost now (PIE-696), until the drag leaves it. */
  private groupGhost: Desk | null = null;
  /** A tile of a group dragged by its title out past the group's content: where it would land on this screen. */
  private outDrag: { inner: Desk; name: string; target: { to?: string; where: Where; label: string; refused?: string } | null } | null = null;
  /** alt+l: the next click (or h j k l, a digit) picks where this tile's opens land. */
  private linkMode: { desk: Desk; from: number; verb: WireVerb } | null = null;
  private linkOwner(): Desk {
    const host = this.ctx?.hostLayer;
    const top = this.top();
    return host?.isDrawer(top) ? host.desks().find(d => !host.isDrawer(d))?.top() ?? top : top;
  }
  private get linking() { return this.linkOwner().linkMode; }
  private set linking(mode: { desk: Desk; from: number; verb: WireVerb } | null) { this.linkOwner().linkMode = mode; }
  /** The host supplies its drawer offset; mounted desks use their holder's content origin. */
  screenOrigin = { col: 0, row: 0 };
  /** A tile that takes every mouse event while the button is down (a terminal, a screen). */
  private mouseTile: { id: number; r: Rect } | null = null;
  /** What was drawn, for the mouse: tiles (docks first, they're on top), header labels, dock handles. */
  private hits: [number, Rect][] = [];
  /**
   * Each tile's look as last drawn (PIE-673), and the rectangle its content was drawn in: inside its frame, its padding
   * and, for a note, its measure (centred). The tile never sees the cells outside it: a press there is the nearest cell
   * in it, and nothing drawn there is the tile's text.
   */
  private looks = new Map<Pane, Look>();
  private contents = new Map<number, Rect>();
  private lookSrc: { board: unknown; redraw(): void } | null = null;
  /** Tile `p`'s look at `cols` columns: its kind, this screen and the note it shows. */
  private lookAt(p: Pane, cols: number): Look {
    const board = this.ctx?.board;
    if (!this.lookSrc || this.lookSrc.board !== board) this.lookSrc = board ? { board, redraw: () => this.redraw() } : null;
    const shows = (p as { msg?: Msg | null }).msg, id = this.idOf(p);
    return lookFor(this.lookSrc, {
      // A held or pinned reader keeps the look `detail` had (`[style-for::tile:detail]` notes, PIE-705).
      tile: p instanceof ReaderPane && p.kind === "reader" && p.holding ? "detail" : p.kind, screen: this.name, ...(shows ? { page: pageOf(shows) } : {}),
      ...(id !== undefined ? { instance: { id: this.tileId(id), fields: p.instanceLook ?? {} } } : {}),
    }, cols);
  }
  /** The tiles' own looks by tile id (`this tile`): read for the inspector, written by its save, kept in the layout. */
  readonly tileLooks = {
    get: (tid: string) => { const p = [...this.panes].find(([id]) => this.tileId(id) === tid)?.[1]; return p ? { ...(p.instanceLook ?? {}) } : null; },
    set: (tid: string, fields: Record<string, string>) => {
      const p = [...this.panes].find(([id]) => this.tileId(id) === tid)?.[1];
      if (!p) return;
      if (Object.keys(fields).length) p.instanceLook = { ...fields }; else delete p.instanceLook;
      this.redraw();
    },
  };
  lookOf(p: Pane): Look | undefined { return this.looks.get(p); }
  tileLook(name: string) {
    const id = this.idNamed(name), p = id !== undefined ? this.panes.get(id) : undefined, look = p && this.looks.get(p);
    if (id === undefined || !p || !look) return null;
    const reader = p instanceof ReaderPane ? p : null, shown = reader?.surface.msg;
    return { look, kind: p.kind, title: p.title(), cols: this.contents.get(id)?.cols ?? look.width, box: reader ? reader.surface.boxAt() : null, list: reader ? reader.surface.listAt() : null, ...(reader && shown ? { hero: reader.surface.imagesIn(shown).some(x => x.spec.kind === "img" && x.spec.layout === "hero"), pictures: reader.surface.imagesIn(shown).filter(x => x.spec.kind === "img").map(x => x.path) } : {}) };
  }
  paneNamed(name: string): Pane | undefined { const id = this.idNamed(name); return id === undefined ? undefined : this.panes.get(id); }
  dismiss(p: Pane) {
    const id = [...this.panes].find(([, q]) => q === p)?.[0];
    if (id === undefined) return;
    // An attached tile closing: the next of its kind opens the size this one was.
    if (p instanceof AttachedTilePane) this.attachedShare[p.attachment] = this.shareOf(id) ?? this.attachedShare[p.attachment] ?? 0.45;
    try { this.closeTile(this.nameOf(id), USER); } catch { /* the screen keeps it (a locked one): it says it has no comment */ }
  }
  /**
   * Reader `r`'s comment in a tile of its own beside it (PIE-846, comment.place place=tile): in the reader's own place, a
   * pair of the two (Split.pair), on the side last chosen, so the tiles around keep their room and the reader has its own
   * back whole when the comment ends (closing restores the layout as it was). `side` moves an open one to that side of
   * the reader, keeping its share. The person's keys go to it when `keys` (their comment); `on` false closes it, the keys
   * back to the reader.
   */
  composerTile(r: ReaderPane, on: boolean, keys = true, side?: Dir): Promise<unknown> {
    return this.attachedTile(r, "comment", on, keys, side);
  }
  listPreviewTile(r: ReaderPane, on: boolean, side?: Dir): Promise<unknown> { return this.attachedTile(r, "list-preview", on, false, side); }
  hasListPreviewTile(r: ReaderPane): boolean { return this.hasAttachedTile(r, "list-preview"); }
  editPreviewTile(r: ReaderPane, on: boolean, side?: Dir): Promise<unknown> { return this.attachedTile(r, "edit-preview", on, false, side); }
  hasEditPreviewTile(r: ReaderPane): boolean { return this.hasAttachedTile(r, "edit-preview"); }
  sourcesTile(r: ReaderPane, on: boolean, side?: Dir): Promise<unknown> {
    return this.attachedTile(r, "sources", on, true, side);
  }
  private async attachedTile(r: ReaderPane, attachment: "comment" | "sources" | "list-preview" | "edit-preview", on: boolean, keys: boolean, side?: Dir): Promise<unknown> {
    const at = [...this.panes].find(([, p]) => p === r)?.[0];
    if (at === undefined) return null;
    const reader = this.nameOf(at);
    const mine = [...this.panes].filter(([, p]) => p instanceof AttachedTilePane && p.attachment === attachment && p.source === reader).map(([id]) => id);
    if (!on) { for (const id of mine) { this.attachedShare[attachment] = this.shareOf(id) ?? this.attachedShare[attachment] ?? 0.45; try { this.closeTile(this.nameOf(id), USER); } catch { /* kept by the screen */ } } return { closed: mine.length }; }
    if (side) this.commentSide = side;
    let id = mine[0];
    if (id === undefined) {
      id = this.openPair(at, makeTile({ t: "leaf", kind: attachment, source: `tile:${reader}` }), attachment, keys, USER);
    } else if (side) {
      // To another side of the reader, its share kept (sized by its border, it stays that size).
      const share = this.shareOf(id) ?? this.attachedShare[attachment] ?? 0.45;
      const ok = this.ask({ op: "move", tile: id, to: { kind: "split", target: at, dir: side, pair: true, weight: share } }, USER);
      if (!ok.ok) throw new ActionRefused(ok.refused);
      this.commit(ok);
    }
    if (keys) this.keysTo(id);
    this.save(); this.redraw();
    return { tile: this.nameOf(id), side: this.commentSide };
  }
  private openPair(at: number, pane: Pane, name: string, keys: boolean, actor: Actor): number {
    const id = this.nextId;
    const ok = this.ask({ op: "open", tile: id, kind: pane.kind, name: this.autoName(name),
      at: { kind: "split", target: at, dir: this.commentSide, pair: true, weight: this.attachedShare[name] ?? 0.45 },
      ...(keys ? {} : { keys: false as const }) }, actor);
    if (!ok.ok) throw new ActionRefused(ok.refused);
    this.put(pane); this.commit(ok); this.startTile(id); this.openedFrom.set(id, at);
    return id;
  }

  async answerTile(reader: ReaderPane, ask: string, actor: Actor, fold?: string): Promise<unknown> {
    const at = [...this.panes].find(([, p]) => p === reader)?.[0];
    if (at === undefined) return null;
    const source = this.nameOf(at);
    const existing = [...this.panes].find(([, p]) => p instanceof AnswerTile && p.source === source);
    let id: number;
    if (existing) {
      id = existing[0];
      if (actor.kind === "agent" && this.hasFocus(existing[1])) return { tile: this.nameOf(id), held: true };
      (existing[1] as AnswerTile).ask = ask;
      (existing[1] as AnswerTile).fold = fold;
      (existing[1] as AnswerTile).top = 0;
    }
    else id = this.openPair(at, new AnswerTile(source, ask, fold), "answer", false, actor);
    this.save(); this.redraw();
    return { tile: this.nameOf(id) };
  }

  /** Reader `r`'s comment tile is open. */
  hasComposerTile(r: ReaderPane): boolean { return this.hasAttachedTile(r, "comment"); }
  hasSourcesTile(r: ReaderPane): boolean { return this.hasAttachedTile(r, "sources"); }
  private hasAttachedTile(r: ReaderPane, attachment: "comment" | "sources" | "list-preview" | "edit-preview"): boolean {
    const at = [...this.panes].find(([, p]) => p === r)?.[0];
    return at !== undefined && [...this.panes.values()].some(p => p instanceof AttachedTilePane && p.attachment === attachment && p.source === this.nameOf(at));
  }
  /** The side of reader `at` its comment's own tile is on now, from the pair they make; null with no tile. */
  private commentSideOf(at: number): Dir | null {
    const reader = this.nameOf(at);
    const id = [...this.panes].find(([, p]) => p instanceof AttachedTilePane && p.attachment === "comment" && p.source === reader)?.[0];
    const p = id === undefined ? null : parentOf(this.root, id);
    if (!p || p.parent.t !== "split" || !p.parent.pair) return null;
    const first = p.i === 0;
    return p.parent.dir === "row" ? (first ? "left" : "right") : (first ? "up" : "down");
  }
  /** The side of its reader a comment's own tile opens on (PIE-846): the one last chosen. */
  private commentSide: Dir = "right";
  /** Its share of the pair it opens in: the last one's, as it was sized when it closed. */
  /** Each attached tile kind's last share of its reader's place, so the next opens the size the last one was. */
  private attachedShare: Record<string, number> = {};
  /** The share comment tile `id` has of the pair it's in, when it's in one. */
  private shareOf(id: number): number | null {
    const p = parentOf(this.root, id);
    return p && p.parent.t === "split" && p.parent.pair ? p.parent.weights[p.i]! / p.parent.weights.reduce((a, w) => a + w, 0) : null;
  }
  /**
   * The tune inspector (PIE-673) on tile `tile` (default the focused one): the one on this screen turns to it, else one
   * opens under it, or beside it when there is too little height to split. The person's keys go to it; an agent's leaves them where they are.
   */
  async openTune(actor: Actor, tile?: string): Promise<Record<string, unknown>> {
    const focused = this.panes.get(this.focus);
    const tunes = [...this.panes.entries()].filter(([, p]) => p.kind === "tune") as [number, Pane & { source: string }][];
    const target = tile ?? (focused?.kind === "tune" ? (focused as Pane & { source: string }).source : this.nameOf(this.focus));
    if (this.idNamed(target) === undefined) throw new ActionRefused(`no tile ${target} on this screen`);
    let id = tunes[0]?.[0];
    if (id !== undefined) { (this.panes.get(id) as Pane & { source: string }).source = target; }
    else {
      const short = (placeLayout(this.layout, this.area, this.holds).rects.get(this.idNamed(target)!)?.rows ?? this.area.rows) < MIN_ROWS * 2;
      const made = await this.openTile({ kind: "tune", source: `tile:${target}` }, target, short ? "right" : "down", actor);
      id = this.idNamed(made.tile);
      if (id !== undefined) (this.panes.get(id) as Pane & { besideShort: boolean }).besideShort = short;
    }
    if (id !== undefined && actor.kind !== "agent") this.run("tile.focus", {}, this.nameOf(id));
    this.redraw();
    return { tile: id !== undefined ? this.nameOf(id) : null, tunes: target };
  }
  private heads: { id: number; from: number; to: number; row: number }[] = [];
  private markHits: { id: number; n: number; from: number; to: number; row: number }[] = [];
  /** Each header's "⇤ docked" as drawn: a click there undocks it (tile.dock on=false). */
  private dockLabels: { id: number; from: number; to: number; row: number }[] = [];
  /** Each header's agents chip as drawn (PIE-639): a click cycles the tile's level (tile.agent). */
  private agentChips: { id: number; from: number; to: number; row: number }[] = [];
  private pointerHits: { id: number; from: number; to: number; row: number; agent: string }[] = [];
  private floatButtons: { id: number; from: number; to: number; row: number }[] = [];
  private foldButtons: { id: number; from: number; to: number; row: number }[] = [];
  private holdButtons: { id: number; from: number; to: number; row: number }[] = [];
  private closeButtons: { id: number; from: number; to: number; row: number }[] = [];
  /** A header's ◄ (what the tile follows) and → or ⏎ (where its opens land) marks (PIE-855): a click opens that row of ^W P. */
  private wireChips: { id: number; from: number; to: number; row: number; wire: "follows" | WireVerb }[] = [];
  /** The controls chip stays at the right edge when a float moves. */
  private menuButtons: { id: number; from: number; to: number; row: number; right: number }[] = [];
  /** Each open dock's `[×]` as drawn: a click closes it, as Esc in it does. */
  private dockCloses: { id: number; from: number; to: number; row: number }[] = [];
  /** Controls a tile put on its header (the backlinks' status) as drawn: a click presses one. */
  private headPresses: { id: number; row: number; from: number; to: number; press: () => void }[] = [];
  /** The tiles whose header carries their controls this frame. */
  private headCtl = new Set<number>();
  private handles: { id: number; from: number; to: number; dock: Dock<number> }[] = [];
  private dividers: Divider<number>[] = [];
  private area: Rect = { col: 0, row: 0, cols: 80, rows: 22 };
  /** Attention marks (door-local until PIE-423's service store; only the desk's are saved). */
  private marksStore: MarkStore;
  private headOut = "";
  private titlePresses = new RowPresses();
  private titleClick: HeadPress | null = null;
  /** Tiles the host made itself (the showcase's exhibits), by the name the spec gives them: built as given, never saved. */
  private readonly given: ReadonlyMap<string, Pane>;

  /**
   * A screen from its spec: its tiles in its layout, its title, keys, hint and band. One that `saves` comes back as it
   * was left (the desk's desk.json); `opts.layout` lays it out as that named layout instead (the desk's alt+d, --layout).
   * `opts.given`: tiles the host made (the showcase's), by name, used for the spec's leaves of those names.
   * `opts.writes: false`: it reads its save but never writes it (the board in a tile: the board screen owns delivery.json).
   */
  constructor(readonly spec: ScreenSpec = deskSpec(), opts: DeskOpts = {}) {
    this.title = spec.title;
    this.idPrefix = opts.idPrefix ?? "t";
    this.whereNow = opts.where ?? null;
    this.writes = opts.writes ?? true;
    this.given = opts.given ?? new Map();
    this.adopts = !!opts.adopt;
    this.onSave = opts.onSave ?? null;
    this.outward = opts.outward ?? null;
    this.outerChain = opts.chain ?? [];
    this.screenOpenArgs = opts.openArgs ?? null;
    this.marksStore = new LocalMarks(!!spec.layouts);
    // An extension's kind that comes or goes while the door runs (PIE-512): its tiles are made again.
    watchTileKinds(this);
    const want = opts.layout && spec.layouts ? layoutNamed(opts.layout) : null;
    // A mounted screen (PIE-651) comes back as its mount saved it, never from its full screen's file.
    const last = opts.saved !== undefined ? savedScreen(opts.saved, spec) : spec.saves ? savedScreen(readState<unknown>(spec.saves, outlineState()), spec) : null;
    this.resume(last);
    this.focus = 0;
    if (last?.models && typeof last.models === "object") this.savedModels = { ...last.models };
    const saved = want ? null : last;
    if (want) { this.build(want.spec); this.layoutName = opts.layout!; }
    else if (saved?.root) { this.build({ root: saved.root, focus: spec.home !== undefined ? spec.layout.focus : saved.focus, rule: saved.rule, ...(saved.policy ? { policy: saved.policy } : {}), ...(saved.floats ? { floats: saved.floats } : {}) }, false, true); this.layoutName = saved.layout ?? null; }
    else this.build(spec.layout, false, false, true);
    // Tiles given to keep (a group made of tiles from another screen, PIE-651): moved here whole, they keep what they show.
    if (this.adopts) for (const [id, p] of this.panes) if ([...this.given.values()].includes(p)) this.movedIn.add(id);
    this.fromSpec(spec);
    // A zoomed tile comes back zoomed (PIE-643), when that tile is still here.
    const zoomed = !want && typeof saved?.zoom === "string" ? this.idNamed(saved.zoom) : undefined;
    if (zoomed !== undefined) try { this.apply({ op: "zoom", tile: zoomed, on: true }); } catch { /* the layout has no zoom for it now */ }
    // A screen a person made (a screen note) opened by its name: ^W w saves it again under it.
    if (madeScreen(spec.name)) { this.layoutName = spec.name; this.madeAs = spec.name; this.madeBase = { ...madeScreen(spec.name)! }; }
    // What leaving asks about: a screen of the person's own changed since it was saved (or since it opened, blank).
    if (this.madeHere()) this.savedAs = this.shapeNow();
  }

  /** Leaving (or quitting) a screen of the person's own with changes not saved asks first (App.leaving): what it says. */
  shapeWarning(): string | null {
    if (!this.madeHere() || this.savedAs === null || this.shapeNow() === this.savedAs) return null;
    return `the ${this.title} has changes not saved · ^W w saves it as a screen · again within 3s leaves without saving`;
  }

  private readonly screenOpenArgs: Record<string, unknown> | null;
  openArgs(): Record<string, unknown> | null {
    if (this.spec.name === "detail") {
      // Its target is the note it holds now (`--screen detail <id>`, screen.open target=).
      const p = this.pane("detail");
      if (p instanceof ReaderPane) { const { nav: _nav, mode: _mode, margin: _margin, ...a } = p.spec(); return typeof a.note === "string" ? { target: a.note } : a; }
    }
    return this.screenOpenArgs;
  }

  /**
   * What the spec says that a saved layout doesn't override: a columns container's source the spec names outright
   * (`--screen board <hub>`: `hub:<id>`, not `hub:`), and each dock's own policy, kept for when what it holds goes back
   * into it after being pinned (the board's outline: its width; its backlinks: they stay).
   */
  private fromSpec(spec: ScreenSpec) {
    for (const n of savedNodes(spec.layout.root)) {
      if (n.t === "columns" && typeof n.key === "string" && typeof n.source === "string" && /:./.test(n.source)) {
        const c = node(this.root, n.key);
        if (c?.t === "columns" && c.id && c.source !== n.source) this.apply({ op: "source", container: c.id, source: n.source });
      }
      if (n.t === "dock" && n.kid?.key && n.policy) { const k = node(this.root, n.kid.key); if (k?.id) this.apply({ op: "remember", key: k.id, policy: n.policy }); }
    }
  }

  /**
   * Go on from the last door's revision and ids (PIE-491). The revision starts at the clock (milliseconds), or
   * at the saved one if that's later, so it never repeats one an agent read before a restart, even when that
   * door saved nothing; the next tile and split ids go on from the saved ones, so a closed tile's id isn't reused.
   */
  private resume(last: SavedDesk | null) {
    const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : 0);
    this.nextId = Math.max(this.nextId, n(last?.next?.tile));
    this.state = init({ tree: leaf(0), names: new Map() }, { rev: Math.max(n(last?.rev), Date.now()), nextNode: Math.max(this.layout.nextNode, n(last?.next?.node)) });
  }

  /** A tile instance joins the desk: its id (the layout names and places it, by an operation). */
  private put(p: Pane): number {
    const id = this.nextId++;
    this.panes.set(id, p);
    return id;
  }
  /** A name for a new tile of `kind` here: the kind, else the kind and a number (reader2). */
  private autoName(kind: string): string { return autoName(this.layout, kind, this.otherNames()); }
  private otherNames(): string[] {
    const host = this.ctx?.hostLayer;
    return (host?.desks() ?? []).filter(d => host!.isDrawer(d.top()) !== host!.isDrawer(this.top())).flatMap(d => d.descend().flatMap(part => [...part.names.values()]));
  }
  private reconcileNames() {
    for (const id of this.all()) this.bindFollows(id, this.panes.get(id)!);
    const r = this.apply({ op: "names" });
    if (r.answer.renamed) this.save();
  }
  private specTiles = new Map<string, number>();
  private specTile(name: string): number | undefined {
    const id = this.specTiles.get(name);
    return id !== undefined && this.panes.has(id) ? id : this.idNamed(name);
  }
  private nameOf(id: number) { return this.names.get(id) ?? String(id); }
  /** Every tile: the tree's, a tab set's hidden ones included, then the floats. */
  private all(): number[] { return allTiles(this.layout); }
  private isFloat(id: number) { return this.floats.some(f => f.id === id); }
  private numberOf(id: number) { return this.all().indexOf(id) + 1; }
  /** A tile's stable id (PIE-491): `t<n>`, kept through moves, tabs and saves; never given to another tile. */
  private tileId(id: number) { return `${this.idPrefix}${id}`; }
  /** Its tiles' id letter: `t` on a screen, `k` in the drawer (PIE-498: a tile in the drawer's id is never a screen tile's). */
  private readonly idPrefix: string;

  // ── the layout's one way to change (PIE-513) ──

  /** What a tile is, as the layout's rules need it (its kind, its kind's policy, what keeps it, what it holds). */
  /**
   * A list's home (PIE-794): the reader it belongs to (the links tile's), where its opens land when nothing else says,
   * if that reader is reachable and isn't the list itself. Held or following, it is the home: ⏎ replaces its note
   * (`replace`), and the mode it is in says what else moves.
   */
  private homeName(id: number): string | undefined {
    const p = this.panes.get(id), name = p ? kindOf(p)?.home?.(p) : null;
    const bound = p && boundSource.get(p);
    const r = name ? bound && bound !== NO_SOURCE ? bound : this.paneAtPath(name) : undefined;
    return r !== p && r instanceof ReaderPane ? this.pathTo(r) : undefined;
  }

  private facts(id: number, actor?: Actor): TileFacts {
    const p = this.panes.get(id), k = kindOf(p), src = this.sourced.get(id);
    // A new note's tile (PIE-591) closes with its edit for the person: closeTile leaves the edit first (never lost).
    const closesWithEdit = !!actor && actor.kind !== "agent" && !!madeFor(p);
    const how = src ? tileSource(src.source)?.source.drop : undefined;
    const home = this.homeName(id);
    return {
      clearsOnClose: p?.clearsOnClose?.(),
      kind: this.unregistered.get(id)?.kind ?? p?.kind ?? "tile",
      ...(k?.policy ? { policy: k.policy } : {}), ...(k?.stays ? { stays: k.stays } : {}), ...(k?.accepts?.tiles ? { tabs: k.accepts.tiles } : {}), notes: !!k?.accepts?.notes, held: p instanceof ReaderPane && p.holding && !this.layout.altReaders.has(id),
      ...(src ? { keeps: `${src.source} supplies it, and it goes when its data does${how ? ` · to drop it, ${how}` : ""}` } : {}),
      ...(k?.placeholder ? { placeholder: true } : {}),
      ...(k?.follower ? { follower: true } : {}),
      ...(home !== undefined ? { home } : {}),
      ...(p instanceof ReaderPane && p.editing && !(closesWithEdit && p.surface.drafting) ? { editing: sessionName(p) } : {}),
      ...(p instanceof PtyPane && p.running ? { running: p.run.cmd[0] ?? "a program" } : {}),
      ...(p && this.holdsWork(p) ? { holds: true } : {}),
    };
  }
  /**
   * Who acts, where the person is, the room: what `apply` reads. Where the person is comes from the shell's one
   * answer (the whereabouts query, PIE-514): the tile they type in, and whether they're busy anywhere (here, in the
   * drawer, in a shell the door waits under). Their focus here is this screen's own state.
   */
  private layoutCtx(actor: Actor): LayoutCtx<number> {
    const w = this.dispatch.where();
    const typing = w.typingIn !== null ? this.idNamed(w.typingIn) ?? null : null;
    return {
      otherNames: this.otherNames(),
      actor, area: this.area, tile: id => this.facts(id, actor),
      person: { focus: this.focus, typingIn: typing, busy: w.busy, held: actorRule({ touches: "screen" }, actor, w, { action: "layout.change" }), here: w.focus !== null || w.typingIn !== null, ...(w.yolo ? { yolo: true } : {}), ...(actor.kind === "agent" && INVITES.covers(actor.invitation, "screen", actor.run) ? { invited: true } : {}) },
      kinds: { all: tileKindNames(), notes: tileKinds().filter(k => k.accepts?.notes).map(k => k.kind) },
    };
  }
  /** What `op` would do, asked (nothing changes): the new state, or the refusal. */
  private ask(op: Op<number>, actor: Actor = USER): Result<number> {
    const r = applyOp(this.layout, op, this.layoutCtx(actor));
    if (r.ok) this.asked.set(r, { actor, op: op.op });
    return r;
  }
  /** Take the module's answer: its state is the layout now, the keys go where it says; a refusal is thrown, nothing done. */
  private commit(r: Result<number>): Extract<Result<number>, { ok: true }> {
    if (!r.ok) throw new ActionRefused(r.refused);
    // An answer asked of an earlier state would undo what changed since: never taken (asks and commits are paired).
    if (r.base !== this.state) throw new Error("a layout answer was committed over a newer layout; ask again");
    const was = this.layout.collapsed;
    // The shape it leaves against the last settled one (kept after every commit and build, so an operation that has already
    // swapped a pane in can't leave us nothing to rebuild from): a change of shape is an entry, a focus move is none.
    const by = this.asked.get(r), prior = this.settled ?? this.snapshotShape();
    this.state = r.state;
    const now = this.snapshotShape();
    if (!this.replaying && prior && now && now.shape !== prior.shape) this.recordChange(prior.before, by?.actor ?? USER, by?.op ?? "change");
    this.settled = now;
    this.focus = r.focus;
    const arrival = this.arrivals.get(r.focus);
    if (by?.actor.kind === "user" && (by.op === "focus" || by.op === "tab") && arrival) arrival.remaining = 0;
    for (const n of (r.answer.renamed as { from: string; to: string }[] | undefined) ?? []) this.ctx?.flash(`renamed ${n.from} to ${n.to}: tile names are shared with the drawer`);
    this.noteFocus();
    // A tile folded or opened is told (it keeps what it holds exactly).
    for (const id of new Set([...was.keys(), ...r.state.collapsed.keys()])) if (was.has(id) !== r.state.collapsed.has(id)) this.panes.get(id)?.folded?.(r.state.collapsed.has(id));
    return r;
  }
  /** Apply one layout operation for `actor`: the layout changes as one checked step, or the refusal is thrown. */
  private apply(op: Op<number>, actor: Actor = USER): Extract<Result<number>, { ok: true }> { return this.commit(this.ask(op, actor)); }

  // ── the layout's one history, undo and transactions (PIE-957, design §4.9) ────────

  /** The shape as of the last commit or build: what the next change is recorded against. */
  private settled: { shape: string; before: LayoutSpec } | null = null;

  /** The screen's shape now, as text and as a spec to rebuild from; null when a pane the layout names is already gone (mid-operation). */
  private snapshotShape(): { shape: string; before: LayoutSpec } | null {
    try { return { shape: this.shapeNow(), before: this.layoutSpec() }; } catch { return null; }
  }

  /** A change of shape `by` made, recorded with the transaction its action named (src/surface/txn.ts), which it opens or joins. */
  private recordChange(before: LayoutSpec, by: Actor, what: string) {
    if (this.replaying) return;
    const scope = TXN.getStore(), now = Date.now();
    if (scope?.txn) this.history.join(scope.txn, by, before, now, scope.motion);
    if (scope?.txn && by.kind === "agent" && by.id.startsWith("script:") && !this.announced.has(scope.txn)) { this.announced.add(scope.txn); this.ctx?.flash(`${by.id.slice(7)} is rearranging the screen · esc stops it`, 8000); }
    this.history.record(before, by, what, now, scope?.txn);
    this.startMotion(scope?.motion ?? (scope?.txn ? this.history.openTxn(scope.txn)?.motion : undefined), what);
  }

  /**
   * A change of shape was just made: the next paint animates from where the tiles are drawn now, as the person's setting
   * allows the actor's hint (src/motion.ts). A drag's own steps (a resize, a float moved by the pointer) are not animated:
   * the pointer is the motion.
   */
  private startMotion(hint: string | undefined, what: string) {
    // The drawer's desk is ticked by no screen of its own: it snaps (nothing could settle its frames).
    if (this.ctx?.hostLayer?.isDrawer(this)) return;
    if (what === "resize" || this.dragging || this.floatDrag || inResize()) return;
    const plan = planMotion(hint, motionMode());
    if (!plan) return;
    const now = this.clock();
    const from = this.transition ? this.transition.rectsNow(now, this.area) : new Map(this.hits);
    if (!from.size) return;
    const floated = new Set<number>([...this.floats.map(f => f.id), ...(this.transition?.floated ?? [])]);
    this.transition = null;
    this.pendingMotion = { from, plan, floated };
  }

  /** The script runs whose layout changes are open on this screen (a dance in flight): their run ids. */
  runningScripts(): string[] {
    return this.history.openIds().filter(id => { const by = this.history.openTxn(id)?.by; return by?.kind === "agent" && by.id.startsWith("script:"); });
  }
  /** A script run is rearranging this screen: the status bar offers to stop it. */
  dancing(): boolean { return this.runningScripts().length > 0; }
  /** The runs already announced ("esc stops it"), once each. */
  private announced = new Set<string>();

  /**
   * `layout.stop` (Esc while a script run is rearranging the screen): stop the run (`scripts.stop`); the service says it ended
   * and the transaction's end rule puts the layout back, as far as nothing else changed. One obvious key, for whoever's screen
   * is moving.
   */
  async stopRuns(actor: Actor): Promise<{ stopped: string[] }> {
    const runs = this.runningScripts();
    if (!runs.length) throw new ActionRefused("no script run is rearranging this screen");
    // The service answers { stopped: false } for a run that has already ended (or was started elsewhere): its transaction is
    // closed here as stopped. A request that failed (the service unreachable, a refusal) stops nothing, and says so.
    const failed: string[] = [];
    const results = await Promise.all(runs.map(run => this.ctx.board.stopScript(run, actor).then(r => ({ run, ended: true as const, r }), (e: Error) => { failed.push(e.message); return { run, ended: false as const, r: null }; })));
    const stopped: string[] = [];
    for (const { run, ended, r } of results) if (ended) { try { this.endTxn(run, r?.sequence ? "done" : "stopped", actor); } catch { /* gone */ } stopped.push(run); }
    asActor(this.ctx, actor).flash(failed.length ? `could not stop the dance: ${failed[0]}` : stopped.length ? results.some(r => r.ended && r.r?.sequence) ? "stopped; completed sequence steps remain; ctrl+z undoes what is reversible" : "stopped the dance; the layout is put back" : "nothing to stop", failed.length ? 6000 : undefined);
    this.redraw();
    return { stopped };
  }

  /** Whether a change is drawing its way (a test and the status line ask). */
  get moving(): boolean { return !!this.transition || !!this.pendingMotion; }
  /** Snap to the settled layout: the first key or click, a peek, a snapshot. True when something was in flight. */
  settle(): boolean { const was = this.moving; this.transition = null; this.pendingMotion = null; return was; }
  /**
   * `layout.undo` (and ctrl+z with nothing of a reader's to undo, when this is newer than a trash): take back the newest
   * entry, for the person; an agent takes back its own (or what a script it asked for did) only. With a transaction, all of
   * its entries, newest first. Each is refused with who changed the layout since ("undo that first"); the shape is rebuilt from
   * the entry (tiles kept by name), checked through the module's `load` so a lock, the tile the person types in and a
   * container's policy hold.
   */
  undoLayout(actor: Actor, txn?: string): { undone: string; what: string; steps: number; screen: string; left?: string } {
    const party = partyOf(actor);
    let entries: LayoutEntry[];
    if (txn) {
      entries = this.history.entriesOf(txn).reverse();
      if (!entries.length) throw new ActionRefused(`no layout change in transaction ${txn} (it was undone, or this desk restarted)`);
      if (actor.kind === "agent" && !entries.every(e => e.party === party || e.owner === party)) throw new ActionRefused(`transaction ${txn} isn't yours: an agent undoes its own (or a script it asked for)`);
    } else {
      const mine = actor.kind === "agent" ? this.history.last(party) : this.history.newest();
      if (!mine) throw new ActionRefused(actor.kind === "agent" && this.history.newest()
        ? `the newest layout change is ${this.history.newest()!.party === "you" ? "the person's" : this.history.newest()!.party}'s; an agent undoes only its own`
        : "nothing to undo on this screen's layout");
      entries = [mine];
    }
    const r = this.undoEntries(entries, actor);
    if (!r.done.length) throw new ActionRefused(r.blocked!);
    this.save(); this.redraw();
    return { undone: this.title, screen: this.layoutName ?? this.spec.name, what: r.done[0]!.what, steps: r.done.reduce((n, e) => n + e.steps, 0), ...(r.blocked ? { left: r.blocked } : {}) };
  }

  /**
   * Take back `entries` (newest first), one at a time: each must be the end of the history as far as other actors go
   * (nobody undoes over someone else), and the module's `load` check must allow it (a lock, the tile the person types in).
   * Stops at the first that doesn't, with why; what was undone is done.
   */
  private undoEntries(entries: LayoutEntry[], actor: Actor, keepFocus = false): { done: LayoutEntry[]; blocked?: string } {
    const done: LayoutEntry[] = [];
    for (const entry of entries) {
      // Rebuilding clears what the person is in the middle of (an edit, a terminal): never under their typing.
      if (this.holdsKeys()) return { done, blocked: "you are typing; ctrl+z (layout.undo) puts it back when you are done" };
      // Another run can share this actor: undoing under its later transaction would erase its layout.
      const later = this.history.after(entry).find(e => entry.txn !== undefined ? e.txn !== entry.txn : e.party !== entry.party);
      if (later) return { done, blocked: `the layout changed since (${later.party === "you" ? "you" : later.party.replace("agent:", "")} ${later.what}); undo that first${later.party === "you" ? ": ctrl+z" : ""}` };
      this.replaying = true;
      try { this.apply({ op: "load", name: "the layout before" }, actor); }
      catch (e) { return { done, blocked: e instanceof ActionRefused ? e.message : String(e) }; }
      finally { this.replaying = false; }
      this.rebuildTo(entry.before, keepFocus);
      this.layoutName = entry.before.name ?? null;
      this.madeBase = this.layoutName ? madeScreen(this.layoutName) ?? null : null;
      this.settled = this.snapshotShape();
      this.history.take(entry);
      done.push(entry);
    }
    return { done };
  }

  /** Rebuild the shape `spec`, keeping the tiles it names (as `layout.load` does), and no new entry. */
  private rebuildTo(spec: LayoutSpec, keepFocus = false) {
    this.replaying = true;
    this.startMotion(TXN.getStore()?.motion, "put back");
    // A rollback nobody asked for (a run that ended early) leaves the keys where the person put them, when that tile is still there.
    const here = keepFocus ? this.nameOf(this.focus) : undefined;
    const names = here ? new Set(this.all().map(id => this.nameOf(id))) : null;
    try { this.entered.clear(); this.ptyIn = null; this.build(here && names!.has(here) ? { ...spec, focus: here } : spec, true); } finally { this.replaying = false; }
  }

  /**
   * A transaction ends (`layout.txn.end`, the run's end, a minute idle). Normally it is the settled state and says so once; one
   * that ended early (stopped, refused, error, the door lost it, the deadline) rebuilds its start and says that.
   */
  endTxn(txn: string, reason: "done" | "stopped" | "failed" | "idle", actor: Actor = USER): { txn: string; ended: string; steps: number; putBack: boolean; left?: string } {
    const t = this.history.close(txn);
    if (!t) throw new ActionRefused(`no open transaction ${txn} on this screen (it ended, or never opened here: layout changes carrying txn=${txn} open it)`);
    const entries = this.history.entriesOf(txn), steps = entries.reduce((n, e) => n + e.steps, 0);
    const early = reason === "stopped" || reason === "failed";
    if (early && entries.length) {
      // Put back what it changed, newest first, as far as nothing else changed since and the screen allows (it may be locked now).
      const r = this.undoEntries([...entries].reverse(), USER, true);
      this.save(); this.redraw();
      asActor(this.ctx, actor).flash(r.blocked ? `${txn} ${reason}; layout only partly put back: ${r.blocked}` : `${txn} ${reason}; layout put back`, r.blocked ? 8000 : undefined);
      return { txn, ended: reason, steps, putBack: !r.blocked, ...(r.blocked ? { left: r.blocked } : {}) };
    }
    if (steps) asActor(this.ctx, actor).flash(`${steps === 1 ? "one layout change" : `${steps} layout changes`} · ctrl+z puts ${steps === 1 ? "it" : "them"} back`);
    return { txn, ended: reason, steps, putBack: false };
  }

  scriptEnded(run: string, reason: "done" | "stopped" | "failed") {
    if (!this.history.isOpen(run)) return;
    try { this.endTxn(run, reason, USER); } catch { /* gone already */ }
    this.redraw();
  }
  scriptUndone(run: string) {
    if (!this.history.forTxn(run)) return;
    try { this.undoLayout(USER, run); this.ctx.flash("the run's layout changes put back"); } catch (e) { this.ctx.flash(`layout not undone: ${e instanceof Error ? e.message : String(e)}`, 6000, errorDetails(e)); }
  }
  scriptsLost() {
    // Only the runs that were waiting on the service: a transaction opened by hand (txn=) has no run to lose.
    for (const id of this.runningScripts()) try { this.endTxn(id, "failed", USER); } catch { /* gone already */ }
  }

  /** A transaction nothing has joined for a minute closes, and says so. */
  private sweepTxns() {
    for (const t of this.history.idle(Date.now())) { try { this.endTxn(t.id, "idle"); } catch { /* gone already */ } }
  }

  // ── building a layout (PIE-474) ──────────────────────────────────────────

  /**
   * Lay out `spec`. With `reuse`, a tile already here with the same name and kind (and program) is kept as
   * it is; the ones the layout has no place for that hold work (a running program, an unsaved edit) are kept
   * in a shut dock on the right, and the rest are closed.
   */
  private build(spec: LayoutSpec, reuse = false, restore = false, own = false): void {
    // A saved id is the tile's, split's or tab set's own only when this is desk.json coming back (`restore`) or
    // it was never given out here: a layout loaded from a screen note never hands a gone tile's id to another.
    const mine = (n: number, next: number) => n > 0 && (restore || n >= next);
    const old = new Map(this.panes);
    const oldNames = new Map(this.names);
    const byName = new Map([...this.names].map(([id, n]) => [n, id] as const));
    const altReaders = new Set<number>();
    const used = new Set<number>(), fresh: number[] = [], wantWires: { from: number; verb: WireVerb; to: string; rule?: AltRule }[] = [], wantSources: [number, string][] = [];
    const names = new Map<number, string>(), roles = new Map<string, number>();
    const folded = new Map<number, Fold>(), agentsOf = new Map<number, AgentLevel>();
    const auto = (kind: string) => autoName({ names }, kind);
    if (!reuse) this.panes.clear();
    const tileOf = (saved: TileSpec) => {
      // A saved `detail` is a reader that starts held (PIE-705); a kind nobody registers here is made as a tile that says so (src/desk/tiles.ts makeTile).
      const l = canonSpec(saved);
      const kind = l.kind;
      const o = reuse && l.name ? byName.get(l.name) : undefined;
      const p = o !== undefined ? old.get(o) : undefined;
      let id: number;
      if (o !== undefined && p && !used.has(o) && p.kind === kind && (!(p instanceof PtyPane) || !l.cmd || p.run.cmd.join(" ") === l.cmd.join(" "))) {
        id = o; names.set(id, l.name!);
      } else {
        // A tile the host made for its own spec (the showcase's exhibits), else one of its kind.
        const pane = ((own || restore) && l.name ? this.given.get(l.name) : undefined) ?? makeTile({ ...l, kind });
        {
          // The tile's saved id, when no tile here has it (a saved layout loaded twice gets new ones the second time).
          const saved = new RegExp(`^${this.idPrefix}(\\d+)$`).exec(l.id ?? "");
          const n = saved ? Number(saved[1]) : 0;
          id = mine(n, this.nextId) && !this.panes.has(n) ? n : this.nextId++;
          this.nextId = Math.max(this.nextId, id + 1);
          this.panes.set(id, pane);
          names.set(id, l.name && ![...names.values()].includes(l.name) ? l.name : auto(kind));
          fresh.push(id);
        }
      }
      if (l.role ?? l.name) roles.set((l.role ?? l.name)!, id);
      this.panes.get(id)!.writtenTitle = l.writtenTitle;
      this.panes.get(id)!.systemTitle = l.systemTitle;
      used.add(id);
      // A kind nobody has registered (an extension not loaded yet) says so in its place; its spec is kept as saved.
      // A tile the host gave (an exhibit) is its own kind, never one waiting for its extension.
      if (!isTileKind(l.kind) && !((own || restore) && l.name && this.given.has(l.name))) this.unregistered.set(id, l); else this.unregistered.delete(id);
      for (const w of l.wires ?? []) wantWires.push({ from: id, ...w });
      if (l.selectFrom) wantSources.push([id, l.selectFrom]);
      if (l.altReader) altReaders.add(id);
      if (l.collapsed) folded.set(id, l.collapsed === "h" ? { dir: "h" } : {});
      if (isAgentLevel(l.agents)) agentsOf.set(id, l.agents);
      // This tile's own look (PIE-675), as its spec kept it: string values only.
      const ownLook = l.look && typeof l.look === "object" ? Object.fromEntries(Object.entries(l.look).filter(([, v]) => typeof v === "string")) as Record<string, string> : null;
      if (ownLook && Object.keys(ownLook).length) this.panes.get(id)!.instanceLook = ownLook;
      return id;
    };
    const root = reviveTree(spec.root, tileOf);
    // Floats (PIE-511) come back where they were, each its own tile.
    const floats: Float<number>[] = (Array.isArray(spec.floats) ? spec.floats : []).filter(f => f?.tile?.t === "leaf" && isRect(f.rect)).map(f => ({ id: tileOf(f.tile), rect: { ...f.rect } }));
    let tree = root;
    // What the new layout has no place for: kept when it holds work (in one shut dock on the right), else closed.
    const kept: number[] = [];
    if (reuse) for (const [id, p] of old) {
      if (used.has(id)) continue;
      if (this.holdsWork(p)) {
        const was = oldNames.get(id) ?? p.kind;
        names.set(id, [...names.values()].includes(was) ? auto(was) : was);
        kept.push(id);
      } else { p.dispose?.(); this.panes.delete(id); if (this.ptyIn === p) this.ptyIn = null; }
    }
    if (kept.length) {
      const kid: LNode = kept.length > 1 ? { t: "tabs", ids: kept, active: 0 } : leaf(kept[0]!);
      tree = splitOf("row", [tree, { t: "dock", kid, edge: "right", open: false }], [0.7, 0.3]);
    }
    const wires: TileWire[] = [];
    this.selectSeeds.clear();
    this.ext.clear();
    for (const [to, source] of wantSources) {
      const src = [...names].find(([, n]) => n === source)?.[0];
      const container = node(tree, source);
      if (container) this.selectSeeds.set(to, source);
      for (const from of src !== undefined ? [src] : container ? leaves(container) : []) wires.push({ from, verb: "select", to });
    }
    for (const { from, verb, to, rule } of wantWires) {
      if (to.includes("/")) { this.addExt(from, { path: to, verb, rule }); continue; }
      const target = [...names].find(([, n]) => n === to)?.[0];
      if (target === undefined || (target === from && !own && !rule)) continue;
      if (!wires.some(w => w.from === from && w.verb === verb && w.to === target)) wires.push({ from, verb, to: target, ...(rule ? { rule } : {}) });
    }
    // The open rule is the screen's policy now (PIE-513); a spec's `rule` says it as it did.
    const policy = { ...policyOf(spec.policy), ...(spec.rule === "next" ? { opens: "next" as const } : {}) };
    const next = init({ tree, names, floats, collapsed: folded, wires, altReaders, agents: agentsOf, policy }, this.layout, { freshIds: !restore });
    this.state = next;
    this.specTiles = roles;
    if (this.ctx) this.reconcileNames();
    const ids = this.all();
    const f = typeof spec.focus === "string" ? [...names].find(([, n]) => n === spec.focus)?.[0] : ids[typeof spec.focus === "number" ? spec.focus : 0];
    this.focus = f !== undefined && ids.includes(f) ? f : ids[0]!;
    this.keysTo(this.focus);
    if (this.ctx) for (const id of fresh) this.startTile(id);
    this.settled = this.snapshotShape();
  }
  /** The keys on tile `id`, as the person's own: shown in its tab set (nothing else moves). */
  private keysTo(id: number) { const r = this.ask({ op: "focus", tile: id, quiet: true }); if (r.ok) this.commit(r); }

  /**
   * The tile-kind registry changed (an extension added, removed or reloaded while the door runs, PIE-512). A tile
   * saved with a kind that has come is made as that kind now, in its place, with its args; a tile whose kind
   * went ends its program and says why in its place, its spec kept so it comes back with its kind.
   */
  kindsChanged() {
    if (this.disposed) return;
    let changed = false;
    for (const [id, p] of [...this.panes]) {
      const saved = this.unregistered.get(id);
      if (saved && isTileKind(saved.kind)) {
        p.dispose?.();
        this.panes.set(id, makeTile(saved));
        this.unregistered.delete(id);
        if (this.ctx) this.startTile(id);
        changed = true;
      } else if (!saved && !isTileKind(p.kind) && wasTileKind(p.kind)) {
        // A tile still holding work (a program running) keeps its place until it's free (closing it would lose
        // what it holds); it goes then, and its tile says why. Its kind's own hooks say so, as they were.
        const was = lastKindOf(p);
        if (was?.holdsWork?.(p) && was.whenFree) { this.whenFree(p, id, was.whenFree); continue; }
        const spec = this.specOf(id);
        p.dispose?.();
        if (this.ptyIn === p) this.ptyIn = null;
        this.panes.set(id, makeTile(spec));
        this.unregistered.set(id, spec);
        changed = true;
      }
    }
    if (changed && this.ctx) this.redraw();
  }

  /** When a tile is free (its program exited) after its kind went away: its tile says why, in its place. */
  private whenFree(p: Pane, id: number, wait: (p: Pane, then: () => void) => void) {
    if (this.freeWatch.has(p)) return;
    this.freeWatch.add(p);
    wait(p, () => { this.freeWatch.delete(p); if (this.panes.get(id) === p) this.kindsChanged(); });
  }
  private readonly freeWatch = new WeakSet<Pane>();

  /** A running program, an unsaved edit, a screen with a draft: closing it would lose something (its kind says). */
  private holdsWork(p: Pane): boolean { return !!kindOf(p)?.holdsWork?.(p); }
  /** What a tile shows or has selected (a reader's note, the tree's row, a screen's card): its kind says. */
  private showing(p: Pane | undefined): Msg | null { return p ? kindOf(p)?.shows?.(p) ?? null : null; }
  /**
   * The tiles that follow tile `id` (a preview with source=tile:<its name>), by their kinds' `follows`: here, and on
   * the drawer's desk or the screen shown, any bound to this very tile (ADR 0001: a follower keeps following the tile
   * it followed wherever either goes, never another of that name).
   */
  private followers(id: number): Pane[] {
    return [...selectTargets(this.layout, id).flatMap(to => { const p = this.panes.get(to); return p ? [p] : []; }), ...(this.ext.get(id) ?? []).flatMap(w => { const target = w.verb === "select" ? this.extTarget(id, "select", w) : undefined; return target ? [target.pane] : []; })];
  }
  selectionSource(p: ReaderPane): Pane | null {
    const bound = boundSource.get(p);
    if (bound) return bound === NO_SOURCE ? null : bound;
    const id = this.idOf(p), source = id === undefined ? undefined : this.followsOf(id).source;
    return source === undefined ? null : this.panes.get(source) ?? null;
  }
  hasWiredPreview(p: ReaderPane): boolean {
    const id = this.idOf(p);
    return id !== undefined && this.followers(id).some(p => p instanceof PreviewPane);
  }
  /** This desk's tiles bound to follow `src`, a tile on another desk now (the drawer's, or the screen's). */
  boundTo(src: Pane): Pane[] { return [...this.panes.values()].filter(q => boundSource.get(q) === src); }
  /** The desk follower `p` is on: this one, or the drawer's or the screen's (its notes are read and drawn there). */
  private homeOf(p: Pane): Desk { return this.idOf(p) !== undefined ? this : this.ctx?.hostLayer?.desks().find(d => d.idOf(p) !== undefined) ?? this; }

  // ── links across a group's edge (PIE-651, PIE-696): a tile in a group and one outside it, linked ──

  /**
   * The screen holding this desk as a mount (a group, a mounted board): its tile there. Set as the mount makes the desk.
   * A tile's far end may be on a desk of this family (the holder above, a mount's desk below), which is not in this
   * layout's tree, so its link is kept here, beside the layout's own, as `ext`.
   */
  holder: { tile: Pane; desk: () => Desk | null } | null = null;
  /** Links whose far end is on another desk of the family, by the tile they start from: the pane (once found) or its path. */
  private readonly ext = new Map<number, ExtLink[]>();
  /** The outermost desk this one is mounted under. */
  private top(): Desk { let d: Desk = this; for (let h = d.holder?.desk(); h; h = d.holder?.desk()) d = h; return d; }
  /** This desk and every desk mounted under it, down. */
  private descend(): Desk[] {
    const out: Desk[] = [this];
    for (const p of this.panes.values()) if (p instanceof ScreenTile && p.inner) out.push(...p.inner.descend());
    return out;
  }
  /** Every desk a link or a follower can reach: this screen's family, and the drawer's and the other screen's. */
  private relatives(): Desk[] {
    const roots = new Set<Desk>([this.top(), ...(this.ctx?.hostLayer?.desks() ?? []).map(d => d.top())]);
    return [...roots].flatMap(r => r.descend());
  }
  /** `pane`'s name on this desk, or `<group>/<tile>` down into a mount. */
  private pathDown(pane: Pane): string | undefined {
    const id = this.idOf(pane);
    if (id !== undefined) return this.nameOf(id);
    for (const [pid, p] of this.panes) if (p instanceof ScreenTile && p.inner) { const r = p.inner.pathDown(pane); if (r !== undefined) return `${this.nameOf(pid)}/${r}`; }
    return undefined;
  }
  /**
   * The path to `pane` from here: its name on this desk, `<group>/<tile>` down into a mount, `../<tile>` up out of one.
   * Across the host layer's edge (PIE-700) the first part names the desk: `@drawer/<tile>` the drawer's, `@<screen>/<tile>`
   * the screen shown (by its name, so a link to a tile of one screen never lands on another's tile of the same name).
   */
  pathTo(pane: Pane): string | undefined {
    const here = this.pathDown(pane);
    if (here !== undefined) return here;
    const h = this.holder?.desk();
    if (h) { const up = h.pathTo(pane); return up === undefined ? undefined : up.startsWith("@") ? up : `../${up}`; }
    const host = this.ctx?.hostLayer;
    for (const d of host?.desks() ?? []) {
      if (d.top() === this) continue;
      const r = d.pathDown(pane);
      if (r !== undefined) return `@${host!.isDrawer(d) ? "drawer" : d.spec.name}/${r}`;
    }
    return undefined;
  }
  /** The desk of the host layer's an `@name` path part names: the drawer's, or the screen shown if that is its name. */
  private hostDesk(name: string): Desk | undefined {
    const host = this.ctx?.hostLayer;
    return host?.desks().find(d => (name === "drawer" ? host.isDrawer(d) : !host.isDrawer(d) && d.spec.name === name));
  }
  /** The tile a path names from this desk (`<group>/<tile>`, `../<tile>`), if it is there now. */
  paneAtPath(path: string): Pane | undefined {
    let d: Desk | null = this;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part === "..") { d = d.holder?.desk() ?? null; if (!d) return undefined; continue; }
      if (part.startsWith("@")) { d = this.hostDesk(part.slice(1)) ?? null; if (!d) return undefined; continue; }
      const p = d.pane(part);
      if (i === parts.length - 1) return p;
      d = p instanceof ScreenTile ? p.inner : null;
      if (!d) return undefined;
    }
    return undefined;
  }
  /** Where tile `id`'s link across an edge goes now: the tile and the desk it is on. A tile that has gone ends the link. */
  extTarget(id: number, verb: WireVerb = "open", entry?: ExtLink): { pane: Pane; desk: Desk; verb: WireVerb; rule?: AltRule } | undefined {
    const e = entry ?? this.ext.get(id)?.find(w => w.verb === verb);
    if (!e) return undefined;
    if (!e.pane && e.path) e.pane = this.paneAtPath(e.path);
    if (!e.pane) return undefined;
    let desk = this.relatives().find(d => d.idOf(e.pane!) !== undefined);
    // A tile that went with its desk (the drawer's made again, the screen replaced) may be back under its path already.
    if (!desk && e.path?.includes("@")) { e.pane = this.paneAtPath(e.path); desk = e.pane ? this.relatives().find(d => d.idOf(e.pane!) !== undefined) : undefined; }
    // A link across the host's edge (the drawer's list → a reader of the screen) waits for its tile: the screen shown can
    // change, the drawer shut and opened, and the link is still its path (PIE-700).
    if (!desk || !e.pane) { if (e.path?.includes("@")) e.pane = undefined; else if (e.found) this.cutExt(id, e); return undefined; }
    e.found = true;
    const path = this.pathTo(e.pane);
    if (path?.includes("@")) e.path = path;
    return { pane: e.pane, desk, verb: e.verb, rule: e.rule };
  }
  private addExt(id: number, wire: ExtLink) {
    const kept = (this.ext.get(id) ?? []).filter(w => w.verb !== wire.verb || (wire.verb === "select" && (wire.pane ? w.pane !== wire.pane : w.path !== wire.path)));
    this.ext.set(id, [...kept, wire]);
  }
  private cutExt(id: number, wire: ExtLink) {
    const rest = (this.ext.get(id) ?? []).filter(w => w !== wire);
    if (rest.length) this.ext.set(id, rest); else this.ext.delete(id);
  }
  private resolveExt() { for (const d of this.relatives()) for (const [id, wires] of d.ext) for (const w of wires) d.extTarget(id, w.verb, w); }
  private relink() {
    for (const d of this.relatives()) for (const [id, wires] of d.ext) for (const w of [...wires]) {
      const t = d.extTarget(id, w.verb, w), to = t ? d.idOf(t.pane) : undefined;
      if (!t || to === undefined || to === id) continue;
      try { d.apply({ op: "link", tile: id, to, verb: w.verb, rule: w.rule }, USER); d.cutExt(id, w); } catch { /* The wire keeps its path until the layout can accept it. */ }
    }
  }
  /** `tile.link to=<path>`: tile `id` opens into the tile at `path` on another desk of the family. */
  private linkAcross(id: number, path: string, verb: WireVerb, actor: Actor, rule?: AltRule): Pane {
    const target = this.paneAtPath(path);
    if (!target) throw new ActionRefused(`no tile ${path} to link to; a tile in a group is <group>/<tile>, one outside it ../<tile>`);
    if (this.idOf(target) !== undefined) throw new ActionRefused(`${path} is on this screen: link to its name`);
    const k = kindOf(target);
    if ((!rule || rule === "tile") && !k?.accepts?.notes) throw new ActionRefused(`${path} doesn't take notes: a link opens notes in it`);
    if (verb !== "select") this.apply({ op: "link", tile: id, verb }, actor);
    else { const why = refusal(this.layout, { op: "link", tile: id, verb }, this.layoutCtx(actor)); if (why) throw new ActionRefused(why); }
    const kept = this.pathTo(target);
    this.addExt(id, { pane: target, ...(kept?.includes("@") ? { path: kept } : {}), verb: verb ?? "open", rule, found: true });
    return target;
  }

  private selectSource(source: string): { ids: number[]; seed?: string; across?: { desk: Desk; id: number } } {
    const id = this.idNamed(source);
    if (id !== undefined) return { ids: [id] };
    const container = node(this.root, source);
    if (container) return { ids: leaves(container), seed: source };
    const pane = source.includes("/") ? this.paneAtPath(source) : undefined;
    const desk = pane ? this.relatives().find(d => d.idOf(pane) !== undefined) : undefined;
    if (desk && pane) return { ids: [], across: { desk, id: desk.idOf(pane)! } };
    return { ids: [this.tile(source).id] };
  }

  private wireSource(to: number, source: ReturnType<Desk["selectSource"]>) {
    if (source.seed) this.selectSeeds.set(to, source.seed);
    if (source.across) source.across.desk.addExt(source.across.id, { pane: this.panes.get(to)!, verb: "select", found: true });
  }

  /** A tile joins a live desk: it reads what it needs (its kind's `start`: a detail its note, a preview its source). */
  private startTile(id: number, moved = false) {
    if (!this.ctx) return; // Unshown groups start their tiles when they enter.
    const p = this.panes.get(id)!;
    const env: TileEnv = {
      desk: this, id: this.tileId(id), name: this.nameOf(id), place: this.layoutName ?? "desk", home: this.home ?? this.spec.saves ?? null,
      tile: name => this.pane(name),
      followers: () => (this.panes.has(id) ? this.followers(id) : []),
      ...(moved ? { moved } : {}),
    };
    p.init?.(this);
    // A tile moved here (from another screen, or the drawer) keeps the note it shows: it isn't handed this one's.
    if (!moved) p.select?.(this.current, this);
    kindOf(p)?.start?.(p, env);
    if (!moved) for (const w of this.layout.wires) if (w.verb === "select" && w.to === id) {
      const m = this.showing(this.panes.get(w.from));
      if (m) this.openInto(id, m, USER, true);
    }
  }

  /** What tile `name` shows or has selected (a reader's note, the tree's row, a screen's card), for a tile that follows it. */
  tileShowing(name: string): Msg | null {
    const id = this.idNamed(name);
    return this.showing(id !== undefined ? this.panes.get(id) : undefined);
  }

  private idNamed(name: string): number | undefined { return [...this.names].find(([id, n]) => n === name && this.panes.has(id))?.[0]; }

  /** A follower bound to a tile on another desk (a preview in a group, its source outside): its `source` is that tile's path. */
  private sourceAcross(p: Pane): Partial<TileSpec> {
    const id = this.idOf(p);
    if (id !== undefined && kindOf(p)?.follower) {
      const source = this.selectSeeds.get(id) ?? (this.followsOf(id).source !== undefined ? this.nameOf(this.followsOf(id).source!) : undefined);
      if (source) return { source: `tile:${source}` };
    }
    const b = boundSource.get(p), f = kindOf(p)?.follows?.(p);
    if (!b || b === NO_SOURCE || !f) return {};
    // Bound to a tile on this desk now: its name here (a spill brings `../tree` back to `tree`); on another: its path.
    const path = this.pathTo(b);
    return path && path !== f ? { source: `tile:${path}` } : {};
  }
  /** Tile `id`'s link across an edge as its spec says it: the path to the tile, and the verb. */
  private extSpec(id: number): Partial<TileSpec> {
    return { wires: (this.ext.get(id) ?? []).flatMap(e => {
      const path = (e.pane ? this.pathTo(e.pane) : undefined) ?? e.path;
      return path ? [{ verb: e.verb, to: path, ...(e.rule ? { rule: e.rule } : {}) }] : [];
    }) };
  }

  private specOf(id: number): TileSpec {
    const p = this.panes.get(id)!;
    const link = wireTarget(this.layout, id);
    const k = kindOf(p), kept = this.unregistered.get(id);
    const role = [...this.specTiles].find(([, tile]) => tile === id)?.[0];
    const wires = [...this.layout.wires.filter(w => w.from === id && this.panes.has(w.to)).map(w => ({ verb: w.verb, to: this.nameOf(w.to), ...(w.rule ? { rule: w.rule } : {}) })), ...(this.extSpec(id).wires ?? [])];
    return {
      ...(kept ? (({ link: _l, linkRole: _r, ...rest }) => rest)(kept) : {}),
      t: "leaf", kind: kept?.kind ?? p.kind, name: this.nameOf(id), id: this.tileId(id), ...(kept ? {} : (k?.save ? k.save(p) : p.spec?.()) ?? {}),
      ...(role ? { role } : {}),
      ...(p.writtenTitle !== undefined ? { writtenTitle: p.writtenTitle, systemTitle: p.systemTitle ?? false } : {}),
      ...this.sourceAcross(p),
      ...(this.selectSeeds.has(id) ? { selectFrom: this.selectSeeds.get(id) } : {}),
      ...(this.collapsed.has(id) ? { collapsed: this.collapsed.get(id)!.dir === "h" ? "h" as const : true as const } : {}),
      ...(this.layout.altReaders.has(id) ? { altReader: true } : {}),
      ...(this.layout.agents.has(id) ? { agents: this.layout.agents.get(id)! } : {}),
      ...(p.instanceLook && Object.keys(p.instanceLook).length ? { look: { ...p.instanceLook } } : {}),
      ...(wires.some(w => w.verb === "open") ? { link: wires.find(w => w.verb === "open")!.to } : {}),
      ...(wires.some(w => w.verb !== "open") ? { wires: wires.filter(w => w.verb !== "open") } : {}),
    };
  }

  /**
   * The layout as saved: without a ctrl+e edit tile, whose temp file and draft go when the door does (restored,
   * it would edit a file that's gone and bring nothing back).
   */
  /** Tiles opened into a container (the board's details) are opened, not kept, as a ctrl+e edit tile isn't. */
  // A comment's own tile (PIE-846) isn't kept either: a handover opens it again with its comment (Screen.reopen).
  private saved() { return serializeLayout(this.layout, id => this.specOf(id), id => { const p = this.panes.get(id); return (p instanceof PtyPane && !!p.run.temp) || p instanceof AttachedTilePane || this.openedInto(id) !== undefined; }); }
  /** The layout as saved: tile specs in the tree of containers (each with its policy), the focus, the open rule, the screen's policy. */
  layoutSpec(): LayoutSpec { return { ...this.saved(), focus: this.nameOf(this.focus), rule: this.rule, ...(this.layoutName ? { name: this.layoutName } : {}) }; }
  private savedPolicy() { return Object.keys(this.layout.policy).length ? { policy: { ...this.layout.policy } } : {}; }

  private readonly writes: boolean;
  /**
   * Where a mounted screen's tiles are known across session daemons (PIE-651): its mount's own place (`desk.json:t5`),
   * set by the mount before the tiles start, so a terminal in it is never taken for one on the full screen.
   */
  home: string | null = null;
  /** Where the person is, as a host that frames this screen says it (the drawer's tiles: only while the keys are in the drawer). */
  private whereNow: (() => Whereabouts) | null = null;
  /** A mounted screen's save (PIE-651): the desk holding it saves its own layout, which carries this one's (`savedState`). */
  private readonly onSave: (() => void) | null;
  /** Where an open with no reader here goes (a mounted part's): the screen holding the mount. */
  private readonly outward: DeskOpts["outward"] | null;
  /** Given tiles are this desk's own (a group's): saved, ended and carried as any tile moved here. */
  private readonly adopts: boolean;
  save() {
    if (this.onSave) return this.onSave();
    if (!this.spec.saves || !this.writes) return;
    writeState(this.spec.saves, this.savedState(), outlineState());
  }
  /** The screen as its save keeps it: the layout, the focus, the open rule, the zoom, the revision and ids, its models' state. */
  savedState(): SavedDesk {
    const models = Object.fromEntries([...this.models].map(([cid, m]) => [this.columnsIn().find(c => c.id === cid)?.key ?? cid, m.save?.()] as const).filter(([, v]) => v !== undefined));
    return { ...this.saved(), focus: this.all().indexOf(this.focus), rule: this.rule, ...(this.layoutName ? { layout: this.layoutName } : {}), ...(this.zoom !== null && this.panes.has(this.zoom) ? { zoom: this.nameOf(this.zoom) } : {}), rev: this.layout.rev, next: { tile: this.nextId, node: this.layout.nextNode }, ...(Object.keys(models).length ? { models } : {}) };
  }

  // ── DeskApi ────────────────────────────────────────────────────────────────

  enter(ctx: Ctx) {
    const again = !!this.ctx;
    this.ctx = ctx; this.shownAs(true);
    this.reconcileNames();
    if (again) return;
    for (const id of this.all()) this.startTile(id, this.movedIn.has(id));
    this.allModels();
    void this.fillColumns();
  }

  // ── columns whose tiles come from data (PIE-511) ──

  /** Every columns container in the tree. */
  private columnsIn(n: LNode = this.root): Columns<number>[] { return [...(n.t === "columns" ? [n] : []), ...kidsOf(n).flatMap(k => this.columnsIn(k))]; }

  /**
   * Fill each columns container from its source (`hub:<id>`: a hub's views, one query tile each): the tiles it
   * holds already (anywhere: one dragged out stays where it was put) are kept by their source's key, with what
   * they hold, and told the data again (`prime`); new ones join in the source's order; the source's own tiles it
   * no longer names are closed. The columns' weights stay with their tiles. Resolves once every source answered.
   */
  async fillColumns(only?: Columns<number>): Promise<void> {
    await Promise.all((only ? [only] : this.columnsIn()).map(c => this.fill(c)));
  }
  /** Which columns container a tile was supplied for (its id), from which source, and its key there: a refill keeps it by that key. */
  private sourced = new Map<number, { columns: string; source: string; key: string }>();
  /** The columns filled at least once (by id). */
  private filledOnce = new Set<string>();
  /** A data-filled container seeds select wires for each tile it supplies. Delivery reads only the wires. */
  private readonly selectSeeds = new Map<number, string>();
  private async fill(c0: Columns<number>): Promise<void> {
    const src = tileSource(c0.source);
    const cid = c0.id;
    if (!src || !this.ctx || !cid) return;
    const asked = c0.source!;
    let got: Awaited<ReturnType<typeof src.source.tiles>>;
    try { got = await src.source.tiles(src.arg, this); }
    catch (e) { this.ctx.flash(`couldn't fill ${c0.key ?? cid} from ${asked}: ${e instanceof Error ? e.message : String(e)}`, undefined, errorDetails(e)); return; }
    // The columns went, or show another source now (another hub): this answer is stale.
    const c1 = this.columnsIn().find(x => x.id === cid);
    if (!c1 || c1.source !== asked) return;
    // A tile it holds that came back with a saved layout is the source's again, by its key (on its first fill only:
    // a query tile the person drops in later is theirs, never closed by a refill).
    if (!this.filledOnce.has(cid)) for (const id of leaves(c1)) if (!this.sourced.has(id)) { const key = src.source.key(this.specOf(id)); if (key) this.sourced.set(id, { columns: cid, source: asked, key }); }
    const mine = [...this.sourced].filter(([id, s]) => s.columns === cid && this.panes.has(id));
    const byKey = new Map(mine.filter(([, s]) => s.source === asked).map(([id, s]) => [s.key, id] as const));
    const order: number[] = [], fresh: { id: number; kind: string; name?: string }[] = [], names: [number, string][] = [];
    for (const t of got.tiles) {
      const key = src.source.key(t.spec) ?? `${t.spec.kind}:${t.spec.name ?? ""}`;
      let id = byKey.get(key);
      if (id === undefined) {
        id = this.put(makeTile(t.spec));
        this.sourced.set(id, { columns: cid, source: asked, key });
        fresh.push({ id, kind: t.spec.kind, ...(t.spec.name ? { name: t.spec.name } : {}) });
      } else if (t.spec.name) names.push([id, t.spec.name]);
      t.prime?.(this.panes.get(id)!);
      this.modelOf(cid)?.supplied?.(this.panes.get(id)!);
      order.push(id);
    }
    // What it supplied before and doesn't name now (a view taken off the hub; all of them, when it's another hub): gone.
    const drop = mine.map(([id]) => id).filter(id => !order.includes(id));
    for (const id of drop) this.sourced.delete(id);
    // Its tiles in the source's order; one the person moved out stays where they put it; others they put in, after.
    const select = [...this.selectSeeds].filter(([to, source]) => this.panes.has(to) && (source === c1.key || source === c1.id)).map(([to]) => to);
    this.apply({ op: "fill", container: cid, order, fresh, drop, names, select });
    for (const id of drop) this.dropTile(id);
    for (const [id] of [...this.sourced]) if (!this.panes.has(id)) this.sourced.delete(id);
    const c = this.columnsIn().find(x => x.id === cid);
    if (!c) return;
    this.filledOnce.add(cid);
    // A part of a screen mounted alone (PIE-651) held a place holder until its source answered: its tiles take the place now.
    if (order.length) for (const id of leaves(c)) { const p = this.panes.get(id); if (p && !this.sourced.has(id) && kindOf(p)?.placeholder) this.closeId(id); }
    for (const t of fresh) this.startTile(t.id);
    this.modelOf(cid)?.filled?.(got.title);
    this.redraw();
  }
  // ── a source's model (PIE-515: the board's lanes are the hub source's tiles; what they share is its model) ──

  /** Each columns container's source model, by the container's id. */
  private models = new Map<string, SourceModel>();
  /** What the models kept last time (by the container's key or id), until each is made. */
  private savedModels: Record<string, unknown> = {};
  /** The model of columns container `cid` (made the first time it's asked, from its source), if its source has one. */
  private modelOf(cid: string): SourceModel | undefined {
    const had = this.models.get(cid);
    if (had) return had;
    const c = this.columnsIn().find(x => x.id === cid), src = c ? tileSource(c.source) : null;
    if (!c || !src?.source.model) return undefined;
    const m = src.source.model(this, cid, this.savedModels[c.key ?? cid]);
    this.models.set(cid, m);
    return m;
  }
  /** Every model there is (made as its container's screen starts). */
  private allModels(): SourceModel[] { for (const c of this.columnsIn()) if (c.id) this.modelOf(c.id); return [...this.models.values()]; }

  // ColumnsHost: what a source's model asks of the screen.
  supplied(container: string): Pane[] { const c = this.columnsIn().find(x => x.id === container); return c ? this.sourcedIn(c).map(id => this.panes.get(id)!) : []; }
  focusedPane(): Pane | undefined { return this.panes.get(this.focus); }
  async showSource(container: string, source: string): Promise<void> {
    this.apply({ op: "source", container, source });
    await this.fillColumns(this.columnsIn().find(x => x.id === container));
  }
  pressAction(set: ActionSet<any, any>, name: string, args: Record<string, unknown> = {}, p?: Pane, quiet: boolean | ((why: string) => string | null) = false, given?: unknown): Promise<unknown> {
    const id = this.idOf(p);
    return this.dispatch.pressIn(set, name, args, id === undefined ? undefined : this.nameOf(id), quiet, given);
  }
  paneAt(x: number, y: number): { pane: Pane; rect: Rect } | null {
    const id = this.topTileAt(x, y), r = id === null ? undefined : this.hits.find(([t]) => t === id)?.[1];
    return id !== null && r ? { pane: this.panes.get(id)!, rect: r } : null;
  }
  rectOf(p: Pane): Rect | undefined { const id = this.idOf(p); return id === undefined ? undefined : this.hits.find(([t]) => t === id)?.[1]; }
  folded(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && this.collapsed.has(id); }
  isFloating(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && this.isFloat(id); }
  sourceOf(container: string): string | undefined { return this.columnsIn().find(x => x.id === container)?.source; }
  followersOf(container: string): Pane[] {
    const c = this.columnsIn().find(x => x.id === container);
    return c ? [...new Set(leaves(c).flatMap(id => this.followers(id)))] : [];
  }
  nameOfPane(p: Pane): string { const id = this.idOf(p); return id === undefined ? "" : this.nameOf(id); }
  enterSession(p: ReaderPane) { this.entered.enter(p); this.ctx.flash(`in ${sessionName(p)}`); this.redraw(); }
  leave() { this.shell("screen.back"); }
  /** The tiles a columns container's source supplied, in its order (wherever they are now). */
  private sourcedIn(c: Columns<number>): number[] {
    const inside = leaves(c);
    const mine = [...this.sourced].filter(([id, x]) => x.columns === c.id && this.panes.has(id)).map(([id]) => id);
    return [...inside.filter(id => mine.includes(id)), ...mine.filter(id => !inside.includes(id))];
  }

  /**
   * The desk is left (esc, q, the menu). With programs running in its tiles it isn't ended: it stays alive in
   * the background, its programs running, and D on the menu brings the same desk back. Otherwise it's done.
   */
  dispose(): void | "keep" {
    this.ctx?.agentPointers?.drop(this);
    if (this.linking?.desk === this) this.linking = null;
    this.onScreen = false;
    this.leaveResize();
    if (this.spec.stays && this.running().length) { Desk.kept = this; return "keep"; }
    // Gone for good: kinds that come later never make tiles (nor start programs) here.
    this.disposed = true;
    unwatchTileKinds(this);
    // Never ended with this screen: a program still running in a tile here, and anything the drawer gave this screen
    // that still holds work, go into your drawer (said once, for all of them). A tile its host made (the showcase's
    // exhibits) is the host's, and ends with it.
    const host = this.ctx?.hostLayer, given = new Set(this.adopts ? [] : this.given.values());
    const keep = host ? this.carried(given) : [];
    if (keep.length) {
      const kept = host!.keep(keep.map(([id, p]) => ({ pane: p, name: this.nameOf(id), spec: this.specOf(id), from: this.title, typing: false })));
      for (const [id, p] of keep) if (kept.includes(p)) this.forgetTile(id, p);
    }
    for (const m of this.models.values()) m.dispose?.();
    for (const p of this.panes.values()) p.dispose?.();
  }
  private disposed = false;
  /** The desk kept alive with its programs, to come back to (the menu's D). */
  private static kept: Desk | null = null;
  /** The desk to open: the one kept running in the background, else a new one. */
  static resume(): Desk { const d = Desk.kept; Desk.kept = null; return d ?? new Desk(); }
  private onScreen = false;
  /** Popped out of a mount (PIE-651, `mount.out`): the mount it came from; `screen.mount` and `q` go back to it. */
  poppedFrom: { tile: Pane; desk: DeskApi } | null = null;
  /** Programs run in its tiles (a group's terminal): the tile holding it holds work. */
  holdsPrograms(): boolean { return this.running().length > 0; }
  /** Shown or not, for a screen a host draws itself (the drawer's tiles): its tiles' repaints reach the door only while shown. */
  shownAs(on: boolean) { if (this.ctx && this.onScreen !== on) { this.onScreen = on; for (const a of this.arrivals.values()) a.at = this.clock(); for (const p of this.panes.values()) p.shownAs?.(on && this.shownNow(p)); } }
  /** The programs this desk runs (the agent isn't one of them: it lives in the host layer, PIE-513). */
  /** Its terminal tiles with a program running, or kept for them in a session's terminal host (not drawn since a handoff). */
  private running() { return [...this.panes.values()].filter((p): p is PtyPane => p instanceof PtyPane && (p.running || (!!p.keptAs && ptyBackend().holds(p.keptAs)))); }
  /**
   * What goes into your drawer as this screen goes for good: a program still running in a tile here (or kept for it by
   * a session's terminal host, not drawn since a handoff), and anything the drawer gave it that still holds work.
   */
  private carried(given = new Set(this.given.values())): [number, Pane][] {
    const running = new Set<Pane>(this.running());
    return [...this.panes].filter(([id, p]) => (this.movedIn.has(id) && this.holdsWork(p)) || (running.has(p) && !given.has(p)));
  }
  /**
   * Leaving ends nothing: a screen's running programs go into your drawer as it goes (dispose). Where the drawer
   * can't take them (its layout locked), or there's no drawer (a test's bare desk), leaving would end them: it says so.
   */
  leaveRefusal(): string | null {
    const host = this.ctx?.hostLayer;
    if (this.spec.stays) return null;
    if (host) return host.keepRefusal(this.carried().map(([id]) => ({ name: this.nameOf(id), spec: this.specOf(id) })));
    const r = this.running();
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "runs" : "run"} in a tile here, and leaving would end ${r.length === 1 ? "it" : "them"} · ^W x ends ${r.length === 1 ? "it" : "them"} first` : null;
  }

  /**
   * A note opened, or the current note moved (PIE-794). An open from a tile (`link` or `reveal`: a link followed, a
   * list's ⏎, the tree's ⏎; `fresh`: alt+⏎) lands where `landing()` says (`landFrom`, the one landing path); anything else,
   * and an open that lands nowhere, moves the current note: every reader following it shows it, and the person's open
   * reveals it in the outline.
   */
  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    const by = opts.by ?? USER;
    // An open fresh (alt+⏎, a ctrl- or alt-click) from one of its tiles runs the screen's own action for it, as whoever
    // opened it (the welcome reads it in its detail: `ScreenSpec.fresh`).
    if (m && opts.fresh && this.spec.fresh && this.idOf(opts.from) !== undefined) { void this.perform(this.spec.fresh, { id: m.id }, by); return; }
    // A tile whose opens go beside it (its policy's open rule, `beside`: a pinned page, the brief): a reader beside it
    // follows the note (the one there, or one split off to its right); the tile itself stays on its own.
    const at = this.idOf(opts.from);
    // Drawer lists use the screen's open rule only when no wire gives the open a destination.
    if (m && at !== undefined && (opts.link || opts.reveal || opts.fresh) && kindOf(opts.from)?.opensOnScreen && this.ctx.hostLayer?.isDrawer(this) && !this.routes(opts.from!, opts.fresh ? "alt" : "open")) {
      return this.ctx.hostLayer.openOnScreen(m.id, !!opts.fresh, by, undefined, revealOn.get(m)).then(() => this.redraw());
    }
    const beside = !!m && !opts.fresh && at !== undefined && this.policyAt(at).opens === "beside";
    if (beside) this.readerBeside(opts.from!, by);
    if (m && at !== undefined && !beside && (opts.link || opts.reveal || opts.fresh)) { if (this.landFrom(at, m, opts, by)) return this.redraw(); }
    else if (m && at !== undefined) {
      this.follow(at, m, by);
      if (selectTargets(this.layout, at).length || this.ext.get(at)?.some(w => w.verb === "select")) return this.redraw();
    }
    // Which tile moved the current note last (PIE-814): a following reader's chip names it when it's out of sight.
    this.currentBy = at;
    this.moveCurrent(m, opts, by);
  }

  /** Tiles whose border cut the note's title as drawn last (PIE-815): focusing one says it whole. */
  private readonly cutTitles = new Set<number>();
  /** The tile that moved the current note last (a tree's selection, a reader's open), if it's still here. */
  private currentBy: number | undefined;

  /** A tile `p` can follow (PIE-814): one with a selection (a tree, a links list) or another reader, here. */
  private followable(id: number, p: ReaderPane): boolean {
    const q = this.panes.get(id);
    return !!q && q !== p && (!!kindOf(q)?.previews || (q instanceof ReaderPane && q.follows));
  }
  /** DeskApi.followSource: the tile reader `p` follows by a link (its preview verb), and whether it's out of sight now. */
  followSource(p: ReaderPane): { name: string; hidden: boolean; id: number } | null {
    const id = this.idOf(p);
    if (id === undefined) return null;
    for (const { from: z, to, verb } of this.layout.wires) {
      if (verb !== "select" || to !== id || z === id) continue;
      return { name: this.nameOf(z), hidden: !this.shownNow(this.panes.get(z)!), id: z };
    }
    return null;
  }
  /** DeskApi.steering: the tile that moved the current note last, when it's out of sight now (a tree in a shut dock). */
  steering(): { name: string; hidden: boolean } | null {
    const at = this.currentBy, q = at === undefined ? undefined : this.panes.get(at);
    return at !== undefined && q ? { name: this.nameOf(at), hidden: !this.shownNow(q) } : null;
  }
  /**
   * DeskApi.followFrom (`reader.follow`, PIE-814): reader `p` follows tile `source` by a link with the preview verb, the
   * one link model (alt+l's), saved with the layout; null takes every such link into it away (it follows the current
   * note, or nothing, as its mode says).
   */
  followFrom(p: ReaderPane, source: string | null, actor: Actor): void {
    const id = this.idOf(p);
    if (id === undefined) throw new ActionRefused("that reader isn't on this screen");
    const why = source === null ? null : this.followRefusal(p, source, actor);
    if (why) throw new ActionRefused(why);
    const from = source === null ? undefined : this.tile(source);
    if (from) this.apply({ op: "link", tile: from.id, to: id, verb: "select" }, actor);
    for (const w of this.layout.wires) if (w.to === id && w.verb === "select" && w.from !== from?.id) this.apply({ op: "link", tile: w.from, to: id, verb: "select", remove: true }, actor);
    this.selectSeeds.delete(id);
    this.save(); this.redraw();
  }
  /** DeskApi.followRefusal: why reader `p` can't follow tile `source`, or null. */
  followRefusal(p: ReaderPane, source: string, actor: Actor = USER): string | null {
    const id = this.idOf(p);
    if (id === undefined) return "that reader isn't on this screen";
    let from: { id: number; name: string };
    try { from = this.tile(source); } catch (e) { return (e as Error).message; }
    if (!this.followable(from.id, p)) return `${from.name} has no selection to follow: a tree, a links tile or another reader can be followed`;
    // The layout's own answer for the link (a locked screen relinks nothing), asked before anything changes.
    return refusal(this.layout, { op: "link", tile: from.id, to: id, verb: "select" }, this.layoutCtx(actor));
  }
  /** The state chip and P share the policy panel's reader controls. */
  askFollow(p: ReaderPane): void {
    const id = this.idOf(p);
    if (id === undefined) return;
    this.overlays.push(policyPanel(this, id));
    this.redraw();
  }

  /**
   * What tile `id` follows (PIE-855), in plain words from its real links: a reader's mode and the tile it follows by a
   * link (reader.follow), a #tag's list's reader (tile.hold cuts it), a preview's or a links tile's source. Each change
   * or unlink runs the action an agent would call. The tile's panel (^W P) and its header's ◄ mark say it.
   */
  followsOf(id: number): Wire {
    const p = this.panes.get(id), k = kindOf(p), name = this.nameOf(id);
    if (!p) return { says: "nothing" };
    const run = (action: string, args: Record<string, unknown> = {}) => () => this.run(action, args, name);
    if (p instanceof ReaderPane && p.follows) {
      const src = this.followSource(p), change = { label: "change what it shows", run: run("reader.follow") };
      const unlink = { label: "stays put on this note", run: run("reader.follow", { source: "none" }) };
      if (src) return { says: `${src.name}'s selection (a link)${src.hidden ? ", out of sight" : ""}`, source: src.id, change, unlink };
      // The current note: moved by the tile that moved it last, else the tile whose selection the screen's rule follows.
      if (p.followMode === "follows") return { says: "shows the current note", ...this.currentSource(), change, unlink };
      if (p.followMode === "pinned") return { says: `▣ stays put · [[${p.pinPage}]]`, change, unlink };
      return { says: "stays put", change };
    }
    const selectedBy = this.layout.wires.find(w => w.verb === "select" && w.to === id);
    if (selectedBy) return { says: `${this.nameOf(selectedBy.from)}'s selection (a preview follows its source)`, source: selectedBy.from };
    const home = k?.home?.(p) ?? null, held = p && k?.hold ? k.hold.held(p) : null;
    if (held === false && home) return { says: `the #tags opened in ${home}`, unlink: { label: "unlink: hold it on its tag; the next tag opens a new list", run: run("tile.hold", { on: true }) } };
    if (held === true) return { says: `nothing: held on its tag (${home ?? "its reader"}'s next tag opens a new list)`, change: { label: `follow ${home ?? "its reader"}'s tags again`, run: run("tile.hold", { on: false }) } };
    const src = k?.follows?.(p);
    if (src) {
      const bound = boundSource.get(p), at = bound && bound !== NO_SOURCE ? this.idOf(bound) : !bound ? (src.includes("/") ? undefined : this.idNamed(src)) : undefined;
      return { says: `${src}'s selection (a preview follows its source)`, ...(at !== undefined ? { source: at } : {}) };
    }
    if (home) return { says: `the note in ${home}` };
    return { says: "nothing" };
  }
  /** The tile the current note comes from: the one with a selection that moved it last, else the first such tile (a tree). */
  private currentSource(): { source?: number } {
    // Readers can select inline rows without becoming the list that drives following readers.
    const selects = (id: number | undefined) => {
      const p = id === undefined ? undefined : this.panes.get(id);
      return !!p && !!kindOf(p)?.previews && (kindOf(p)?.lists?.(p) ?? !(p instanceof ReaderPane));
    };
    const at = selects(this.currentBy) ? this.currentBy : [...this.panes.keys()].find(selects);
    return at !== undefined ? { source: at } : {};
  }
  /**
   * Where an open from tile `id` lands (PIE-855), in plain words from `landing()` (the one landing rule): its own link
   * (tile.link: change picks another tile, unlink takes it away), its container's opens-into, its home (a list's
   * reader), a flow's next column, or, with none, the current note. The tile's panel (^W P) and its header say it.
   */
  opensOf(id: number): Wire & { short: string } {
    const p = this.panes.get(id), name = this.nameOf(id);
    const change = { label: "change: link it to another tile", short: "change", run: () => this.askLink(id) };
    const unlink = { label: "unlink: its opens go by the screen's rule", run: () => this.run("tile.link", {}, name) };
    const ext = this.extTarget(id);
    if (ext) return { short: this.plainPath(this.pathTo(ext.pane)), says: `${this.plainPath(this.pathTo(ext.pane))} (its link, across the drawer)`, change, unlink };
    const to = landing(this.layout, id, "open", this.facts(id));
    if (to && "across" in to) return { short: to.across, says: `${to.across}, its reader (⏎ replaces its note, alt+⏎ a new detail beside it)`, change };
    if (to && "to" in to) {
      const via = this.linkVia(id), target = this.nameOf(to.to);
      if (via === "link") return { short: target, says: `${target} (its link: only what ⏎ opens)`, change, unlink };
      if (via === "home") return { short: target, says: `${target}, its reader (⏎ replaces its note, alt+⏎ a new detail beside it)`, change };
      return { short: target, says: `${target} (its container's opens into)`, change };
    }
    if (to && "into" in to) return { short: to.into, says: `a detail in ${to.into} (its container's opens into)`, change };
    if (to && "next" in to) return { short: "next column", says: "a new column after it (the flow's open rule: next)", change };
    if (p instanceof ReaderPane && p.follows && p.holding) return { short: "itself", says: "itself (stays put)", change };
    return { short: "current note", says: "the current note", change };
  }
  /** The open target is picked on screen, as with alt+l. */
  askLink(id: number): void {
    this.run("tile.link", { ask: true, verb: "open" }, this.nameOf(id));
  }

  /** The previews following tile `at` (a preview with source=tile:<its name>) show `m`: but one the screen limits for an agent's opens. */
  private follow(at: number, m: Msg, by: Actor) {
    for (const to of selectTargets(this.layout, at)) {
      const p = this.panes.get(to);
      if (to !== at && !(p instanceof ReaderPane && (p.editing || p.holdsKeys))) this.openInto(to, m, by, true);
    }
    for (const w of this.ext.get(at) ?? []) if (w.verb === "select") {
      const t = this.extTarget(at, "select", w);
      if (t) t.desk.openIntoPane(t.pane, m, t.desk.nameOfPane(t.pane), by, true);
    }
  }

  /**
   * Where an open from tile `at` lands (PIE-794: every open from a tile comes here), as `landing()` says: a container
   * (the board's readers row) takes it in a tile there; `fresh` (alt+⏎) opens a new held reader beside the tile's home
   * (a list's reader, or the reader itself; in a flow, the next column); else the tile its link or container names, or
   * its home, has its note replaced (`openInto`: a following reader moves the current note, a held one only itself); a
   * flow's next column; and a held reader with none of those is its own home: the note replaces its own, and nothing
   * else moves (held means local). False: it lands nowhere, and the current note moves.
   */
  private landFrom(at: number, m: Msg, opts: OpenHow & { reveal?: boolean }, by: Actor): boolean {
    const from = this.panes.get(at), to = landing(this.layout, at, opts.fresh ? "alt" : "open", this.facts(at), id => this.facts(id));
    if (to && "across" in to && !this.extTarget(at) && (!opts.fresh || !this.extTarget(at, "alt"))) {
      const target = this.paneAtPath(to.across), desk = target && this.relatives().find(d => d.idOf(target) !== undefined);
      if (desk && target) {
        const id = desk.idOf(target)!;
        if (to.rule === "tab") return desk.openReader(m, { kind: "tabs", target: id }, by, undefined, true, true);
        if (to.rule !== "tile") return desk.openReader(m, { kind: "split", target: id, dir: "right" }, by, undefined, true, true);
        this.follow(at, m, by);
        return desk.openIntoPane(target, m, to.across, by);
      }
    }
    const held = from instanceof ReaderPane && from.follows && from.holding;
    if (to && "into" in to) {
      // A held tile there following its own link changes only itself.
      if (!held) this.current = m;
      this.openIntoContainer(to.into, m, !!opts.fresh, by, at);
      return true;
    }
    // A link followed from an open edit or comment (PIE-592: the editor's ctrl+l, a click in its preview): the edit
    // stays where it is (PIE-812) and the note opens beside it, unless this reader's opens land somewhere already.
    if (from instanceof ReaderPane && (from.editing || from.holdsKeys) && !to && !this.extTarget(at) && !this.inFlow(at)) return this.besideEdit(at, m, by, !!opts.fresh);
    if (opts.fresh) {
      const across = this.extTarget(at, "alt");
      if (across) {
        const d = across.desk, target = d.idOf(across.pane)!;
        const route = landing({ ...d.layout, wires: [{ from: target, verb: "alt", to: target, rule: across.rule ?? "tile" }] }, target, "alt", d.facts(target), id => d.facts(id));
        if (route && "to" in route) return d.openInto(route.to, m, by);
        if (route && "tab" in route) return d.openReader(m, { kind: "tabs", target: route.tab }, by, undefined, true, true);
        if (route && "beside" in route) return d.openReader(m, { kind: "split", target: route.beside, dir: "right" }, by, undefined, true, true);
      }
      if (to && "to" in to) return this.openInto(to.to, m, by);
      if (to && "tab" in to) return this.openReader(m, { kind: "tabs", target: to.tab }, by, undefined, true, true);
      if (to && "next" in to) return this.openNext(at, m, by, true) !== undefined;
      const openAcross = this.extTarget(at);
      if (openAcross && !this.layout.wires.some(w => w.from === at && w.verb === "alt")) {
        const target = openAcross.desk.idOf(openAcross.pane)!;
        return openAcross.desk.openReader(m, { kind: "split", target, dir: "right" }, by, undefined, true, true);
      }
      return this.openReader(m, { kind: "split", target: to && "beside" in to ? to.beside : at, dir: "right" }, by, undefined, true, true);
    }
    this.follow(at, m, by);
    if (this.openAcross(at, m, by)) return true;
    if (to && "to" in to) return this.openInto(to.to, m, by);
    if (to && "next" in to) return this.openNext(at, m, by, false) !== undefined;
    if (held) { if (from.show(m, this)) this.arrived(at, by); return true; }
    return false;
  }

  /** The current note moves to `m`: every reader that follows it shows it; the person's open reveals it in the outline. */
  private moveCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow, by: Actor) {
    this.current = m;
    for (const p of this.panes.values()) {
      if (this.keptFrom(p, by)) continue;
      const was = this.showing(p)?.id;
      p.select?.(m, this);
      if (m && was !== m.id && this.showing(p)?.id === m.id) this.arrived(this.idOf(p)!, by, !opts.link && !opts.reveal);
      // Revealing moves the outline's cursor to the note: the person's own opens only (an agent's never does).
      if (opts.reveal && m && p !== opts.from && opts.by?.kind !== "agent") void p.reveal?.(m, this);
    }
    // The person's open that nothing here shows (the outline's ⏎ with no reader following the current note): said, with
    // how to give it somewhere to land, never a silent change of the current note.
    const shownBy = (p: Pane) => p !== opts.from && kindOf(p)?.shows?.(p)?.id === m?.id && this.shownNow(p);
    // (A following reader that stayed on its note for an open edit or comment said so itself, PIE-761.)
    const stayed = (p: Pane) => p instanceof ReaderPane && p.follows && !p.holding && p.editing;
    if (m && opts.from && (opts.link || opts.reveal) && opts.by?.kind !== "agent" && ![...this.panes.values()].some(p => shownBy(p) || stayed(p))) {
      this.ctx.flash(`no tile shows ${subject(m)} · alt+l, then click a reader: ⏎ and double-click open there`);
    }
    this.redraw();
  }

  /**
   * A selection moved in `from` (a backlinks tile's row, a tree's row), by `by`: the previews following it, and its link,
   * show `m`. The current note stays, so a reader that follows it (maybe the tile `from` lists the backlinks of) doesn't
   * move. An agent's (its `tree.pick`) is shown as the agent's, so the open path's guard keeps it out of a tile the screen
   * limits for agents, and the layout's rules keep it off the person's keys (PIE-632).
   */
  showFrom(from: Pane, m: Msg, by: Actor = USER) {
    const id = this.idOf(from);
    if (id === undefined) return;
    this.follow(id, m, by);
    this.redraw();
  }

  /** A list's home (the reader it belongs to), if it has one here. */
  private homeId(id: number): number | undefined {
    const name = this.homeName(id);
    return name !== undefined ? this.idNamed(name) : undefined;
  }
  /** Where tile `id`'s link comes from: a link of its own, its container's opens-into, or its home (a list's reader). */
  private linkVia(id: number): "link" | "opensInto" | "home" | undefined {
    const own = wireTarget(this.layout, id);
    if (own !== undefined && this.panes.has(own)) return "link";
    const to = this.linkOf(id);
    if (to === undefined) return undefined;
    return this.homeId(id) === to ? "home" : "opensInto";
  }
  /** Whether the person, or which agents, picked tile `id` to gather. */
  private pickView(id: number): Record<string, unknown> {
    const by = [...this.selected].filter(([, set]) => set.has(id)).map(([k]) => k);
    const agents = by.filter(k => k !== "person").map(k => k.slice(6));
    return { ...(by.includes("person") ? { picked: true } : {}), ...(agents.length ? { pickedBy: agents } : {}) };
  }
  /** What layout.get says of tile `id`'s link across an edge: the path to its tile (`group/reader`, `../tree`) and its verb. */
  private extView(id: number): Record<string, unknown> {
    const x = this.extTarget(id);
    const path = x ? this.pathTo(x.pane) : undefined;
    return x && path ? { link: path, linkAcross: "true" } : {};
  }
  /** What layout.get says of tile `id`'s link beyond where it goes (PIE-646): its verb, and where it comes from when it isn't a link of its own. */
  private linkView(id: number): Record<string, unknown> {
    return { ...(this.linkVia(id) ? { linkFrom: this.linkVia(id) } : {}), wires: [...this.layout.wires.filter(w => w.from === id).map(w => ({ verb: w.verb, to: this.nameOf(w.to), ...(w.rule ? { rule: w.rule } : {}) })), ...(this.extSpec(id).wires ?? [])] };
  }


  /** Opens from `pane` land somewhere else (a link, a container, a flow's next column, a link across an edge). */
  routes(pane: Pane, verb: "open" | "alt" = "open"): boolean {
    const id = this.idOf(pane);
    return id !== undefined && (verb === "alt"
      ? this.layout.wires.some(w => w.from === id && (w.verb === "alt" || w.verb === "open")) || this.extTarget(id, "alt") !== undefined || this.routes(pane)
      : landing(this.layout, id, verb, this.facts(id)) !== null || this.extTarget(id, verb) !== undefined);
  }

  /**
   * Where tile `id`'s opens land: its own link, else the opens-into of the nearest container that names one
   * (PIE-505's policy); undefined when neither names a tile here (or names itself). The module answers it.
   */
  private linkOf(id: number): number | undefined {
    const to = landing(this.layout, id, "open", this.facts(id));
    return to && "to" in to && this.panes.has(to.to) ? to.to : undefined;
  }

  /**
   * A new reader holding `m` at `at` (beside a reader: alt+⏎, a ctrl-click; the next column of a flow), by
   * `tile.open`'s operation. False, said, when the layout refuses it (a locked screen): the open lands as the
   * current note instead.
   */
  private openReader(m: Msg, at: At<number>, actor: Actor, spec?: TileSpec, keepKeys = false, alt = false): boolean {
    const before = rectsOf({ ...this.layout, zoom: null }, this.area, this.holds);
    const as: TileSpec = { ...(spec ?? { t: "leaf", kind: "reader", mode: "held" }) };
    // Named for what it is (its kind's word: a river column is a column; a held reader is a detail), numbered after the first.
    if (!as.name) as.name = this.autoName(this.wordFor(as));
    // Asked before the tile is made: a refused open makes nothing.
    const r = this.ask({ op: "open", tile: this.nextId, kind: as.kind, name: as.name, loose: true, at, alt, ...(keepKeys ? { keys: false as const } : {}) }, actor);
    if (!r.ok) { this.ctx.flash(`${r.refused} · opened here instead`); return false; }
    const id = this.put(makeTile(as));
    this.commit(r);
    this.startTile(id);
    // A reader opened from a reader reads its margin the same way (PIE-873: marks only stays marks only).
    const from = "target" in at ? at.target : "from" in at ? at.from : undefined, was = from === undefined ? undefined : this.panes.get(from);
    if (was instanceof ReaderPane && as.margin === undefined) (this.panes.get(id) as ReaderPane).takeMargin(was.surface.marginMode);
    (this.panes.get(id) as ReaderPane).hold(m, this);
    const room = this.makeRoom(id, actor, before, alt);
    this.arrived(id, actor, false, room);
    this.save();
    return true;
  }
  /**
   * Growth by room (PIE-794): tile `id` just opened beside others; the layout folds the earliest readers in its row
   * (never the first) to spines while it would be narrower than its `readable` width, said once.
   */
  private makeRoom(id: number, actor: Actor, before?: ReadonlyMap<number, Rect>, alt = false) {
    const r = this.ask({ op: "room", tile: id, before, alt }, actor);
    if (!r.ok || !r.changed) return;
    this.commit(r);
    const folded = (r.answer.folded as string[] | undefined) ?? [];
    if (folded.length) return `folded ${folded.join(", ")} to ${folded.length === 1 ? "a spine" : "spines"} to give ${this.nameOf(id)} room · a click on a spine opens it, its × closes it`;
  }
  /**
   * An open from tile `from` in a flow: a column after its own holding `m` (a detail: it keeps its note, saved with
   * the layout), or the column that shows `m` already (back from it returns to `from`). The person's goes there; an
   * agent's leaves their keys where they are.
   */
  private openNext(from: number, m: Msg, actor: Actor, fresh = false): number | undefined {
    // A tile that holds it already (not one that only has it selected in a list: the river's Library) is where it opens.
    const there = fresh ? undefined : this.namedReaders().find(x => x.id !== from && x.pane.msg?.id === m.id && !x.pane.editing && !kindOf(x.pane)?.lists?.(x.pane));
    if (there) { const r = this.ask({ op: "open", tile: there.id, kind: "reader", at: { kind: "next", from } }, actor); if (r.ok) { this.commit(r); this.arrived(there.id, actor); this.save(); return there.id; } }
    // A tile of a kind that opens its own (a river column) opens one; else a detail.
    const p = this.panes.get(from), spec = p ? kindOf(p)?.opensNext?.(p, m) : undefined;
    const id = this.nextId;
    return this.openReader(m, { kind: "next", from }, actor, spec) ? id : undefined;
  }

  /** What a new tile of this spec is called when nobody names it: its kind's word, and "detail" for a reader that is held (the glossary's word). */
  private wordFor(s: Pick<TileSpec, "kind" | "mode">): string { return s.mode ? "detail" : kindOf({ kind: s.kind } as Pane)?.word ?? s.kind; }

  private idOf(p: Pane | undefined): number | undefined { return p ? [...this.panes].find(([, x]) => x === p)?.[0] : undefined; }

  // ── a container opens land in (the board's readers row, PIE-515): the tiles opened into it ──

  /** Each such container's tiles opened into it (by key), the one an open lands in now, and the last number given. */
  private opened = new Map<string, { ids: number[]; active: number | null; count: number }>();
  private openedIn(key: string) { let r = this.opened.get(key); if (!r) this.opened.set(key, r = { ids: [], active: null, count: 0 }); return r; }
  /** The tiles opened into container `key` that are still there, in its order (a float of one counts: it goes back). */
  private openedTiles(key: string): number[] {
    const r = this.opened.get(key), c = node(this.root, key);
    if (!r) return [];
    const order = c ? leaves(c) : [];
    const live = r.ids.filter(id => this.panes.has(id));
    r.ids = live;
    return [...live.filter(id => order.includes(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b)), ...live.filter(id => !order.includes(id))];
  }
  /** The container a tile was opened into, if it was. */
  private openedInto(id: number): string | undefined { for (const [k, r] of this.opened) if (r.ids.includes(id)) return k; return undefined; }
  /** The tile an open into `key` lands in now: the one last opened or given the keys there (pinned), else the last. */
  private activeIn(key: string): number | undefined {
    const ids = this.openedTiles(key).filter(id => !this.isFloat(id)), r = this.opened.get(key);
    return r?.active !== null && r?.active !== undefined && ids.includes(r.active) ? r.active : ids.at(-1);
  }

  /**
   * Show `m` in a tile opened into container `key`, for `actor` (PIE-515: the board's readers row): the one an open
   * lands in now, unless it holds an edit, a comment or the panel, or `fresh` (alt+⏎) asks for another; a tile opened
   * there opens its own links in place. A new one makes room as any does (`makeRoom`, PIE-794): the earlier details
   * fold to spines (never the first tile there, nor the one the person types in). A locked or gone container takes none: the note opens in a
   * free one there, else the first tile there that takes notes, said. The person's keys follow the note there, unless
   * they're in an edit (it keeps them); an agent's never move. Answers the tile that shows it now, if one does.
   */
  private openIntoContainer(key: string, m: Msg, fresh: boolean, actor: Actor, from?: number): number | undefined {
    const c = node(this.root, key), agent = actor.kind === "agent";
    this.openWhy = null;
    if (!c) { this.ctx.flash(`no ${key} here to open it in (its tiles were moved out of it): the screen comes back whole when it's opened again`); return undefined; }
    const rec = this.openedIn(key), person = this.personIn(), mine = this.panes.get(this.focus);
    // A tile opened here follows its own links in place (a fresh one opens another).
    if (!fresh && from !== undefined && rec.ids.includes(from)) {
      const r = this.panes.get(from);
      if (r instanceof ReaderPane) { r.surface.track(() => r.hold(m, this)); this.arrived(from, actor); return from; }
    }
    let ids = this.openedTiles(key).filter(id => !this.isFloat(id));
    const active = this.activeIn(key);
    // A tile the screen limits for agents (PIE-639) is never one an agent's open lands in: its new tiles go elsewhere.
    const busy = (id: number) => { const p = this.panes.get(id); return p instanceof ReaderPane && (p.holdsKeys || p === person || this.keptFrom(p, actor)); };
    const wantNew = fresh || active === undefined || busy(active);
    let to = active, room: string | undefined;
    if (wantNew) {
      const why = this.openRefusal(key, actor);
      if (why) {
        // Nothing new opens here (a lock): a free tile opened here takes it, else the first tile here that takes notes.
        // An agent's never lands in the tile the person has (or reads through): refused instead.
        const theirs = (id: number) => agent && (id === this.focus || this.panes.get(id) === this.readerOfFocus() || this.agentOf(id).level !== "free");
        const free = ids.find(id => !busy(id) && !theirs(id));
        const take = free ?? leaves(c).find(id => kindOf(this.panes.get(id))?.accepts?.notes && !theirs(id));
        if (agent && take === undefined) { this.openWhy = `not opened: ${why}`; return undefined; }
        this.ctx.flash(`${why} · opened in ${take !== undefined ? this.nameOf(take) : "nothing"}`);
        const p = take !== undefined ? this.panes.get(take) : undefined;
        if (p instanceof ReaderPane) p.surface.track(() => (free !== undefined ? p.hold(m, this) : p.show(m, this)));
        if (p instanceof ReaderPane) this.arrived(take!, actor, false, why);
        if (free !== undefined) rec.active = free;
        return p instanceof ReaderPane ? take : undefined;
      }
      const before = rectsOf({ ...this.layout, zoom: null }, this.area, this.holds);
      to = this.openNewIn(key, actor, undefined, fresh);
      if (to === undefined) return undefined;
      // A new detail opened from a reader reads its margin the same way (PIE-873), as one opened beside it does.
      const was = from === undefined ? undefined : this.panes.get(from);
      if (was instanceof ReaderPane) (this.panes.get(to) as ReaderPane).takeMargin(was.surface.marginMode);
      room = this.makeRoom(to, actor, before, fresh);
      ids = this.openedTiles(key);
    }
    const p = this.panes.get(to!) as ReaderPane;
    rec.active = to!;
    p.surface.track(() => p.hold(m, this));
    // A note opened into a spine is meant to be seen.
    if (this.collapsed.has(to!)) { const r = this.ask({ op: "collapse", tile: to!, on: false }); if (r.ok) this.commit(r); }
    // The person's keys follow the note there, unless they're in an edit (they stay with it, wherever it moved).
    if (!agent) this.focus = person ? this.idOf(person) ?? to! : to!;
    if (!this.all().includes(this.focus)) this.focus = to!;
    this.arrived(to!, actor, false, room);
    this.save();
    return to!;
  }
  /** Why the last open into a container took nothing (every tile there busy), as it was said. */
  private openWhy: string | null = null;
  /** Why a new tile can't open into container `key` now (a lock over it), in the layout's words, or null. */
  private openRefusal(key: string, actor: Actor): string | null {
    const r = this.ask({ op: "open", tile: this.nextId, kind: "reader", loose: true, at: { kind: "in", key, weight: this.weightIn(key) }, keys: false }, actor);
    return r.ok ? null : r.refused;
  }
  /** A new tile opened into container `key` takes three parts to its first tile's four. */
  private weightIn(key: string): number { const c = node(this.root, key); return ((c && "weights" in c ? c.weights[0] : undefined) ?? 4) * 0.75; }
  /** A new detail in container `key`, named by its kind and a number never given there before (detail1, detail2). */
  private openNewIn(key: string, actor: Actor, at: At<number> = { kind: "in", key, weight: this.weightIn(key) }, alt = false): number | undefined {
    const rec = this.openedIn(key), n = rec.count + 1, name = `detail${n}`;
    const r = this.ask({ op: "open", tile: this.nextId, kind: "reader", name, loose: true, at, alt, keys: false }, actor);
    if (!r.ok) { this.ctx.flash(r.refused); return undefined; }
    rec.count = n;
    const pane = makeTile({ kind: "reader", mode: "held", label: `detail ${n}` });
    const id = this.put(pane);
    this.commit(r);
    rec.ids.push(id);
    this.startTile(id);
    return id;
  }

  /**
   * Replace what tile `to` shows with `m` (its link target, a list's home, the reader an open lands in): false when that
   * tile can't show a note, or holds an edit. `preview`: a selection shown there, not an open (showFrom).
   */
  private openInto(to: number, m: Msg, by: Actor = USER, preview = false): boolean { return this.openIntoPane(this.panes.get(to), m, this.nameOf(to), by, preview); }
  /**
   * Show `m` in tile `p` of this desk (a link's target, here or reached across a group's edge) as its kind takes a note:
   * a reader's note replaced, kept in its history (`take`, PIE-794: its mode stays). A selection previewed in a reader
   * that follows the current note only shows there, until the current note moves it: a preview never moves the current note.
   */
  private openIntoPane(p: Pane | undefined, m: Msg, name: string, by: Actor = USER, preview = false): boolean {
    // The one guard on every open into a tile (PIE-632): an agent's never lands in a tile the screen limits for agents
    // (PIE-639). A preview (a selection shown) passes it by quietly; an open is refused, saying why.
    if (p && preview && (this.keptFrom(p, by) || (p instanceof ReaderPane && (p.editing || p.holdsKeys)))) return false;
    if (p) this.mayOpen(p, by);
    const k = kindOf(p);
    const changed = this.showing(p)?.id !== m.id;
    // A tile whose kind takes notes takes it its own way (a preview follows it, a reader holds it in its history).
    if (!p || !k?.accepts?.notes || !k.take) { this.ctx.flash(`${name} can't show a note · alt+l links this tile somewhere else`); return false; }
    if (preview && p instanceof ReaderPane && p.follows && !p.holding && !p.editing) { p.show(m, this); if (changed) this.arrived(this.idOf(p)!, by, true); return true; }
    const why = k.take(p, m, this, by);
    // A reader holding an edit or a comment keeps it (PIE-812): what was opened into it opens beside it (PIE-592).
    if (why && p instanceof ReaderPane && this.idOf(p) !== undefined && this.besideEdit(this.idOf(p)!, m, by)) return true;
    if (why) { this.ctx.flash(`${name} ${why} · the note opened as the current one instead`); return false; }
    if (!preview || changed) this.arrived(this.idOf(p)!, by, preview);
    return true;
  }

  /** The detail `besideEdit` opened beside each reader holding an edit, by that reader's tile: the next open reuses it. */
  private besides = new Map<number, number>();
  /**
   * Note `m`, opened from or into reader `at` while it holds an edit or a comment (PIE-592): in the detail opened beside it
   * for the last such open, when that's still here and free, else in a new one to its right. The keys stay where they
   * are (in the edit, or the list it was opened from); `fresh` always opens a new one.
   */
  private besideEdit(at: number, m: Msg, by: Actor, fresh = false): boolean {
    const was = fresh ? undefined : this.besides.get(at), there = was !== undefined ? this.panes.get(was) : undefined;
    if (there instanceof ReaderPane && !there.editing && !there.holdsKeys && !this.keptFrom(there, by)) {
      there.surface.track(() => there.hold(m, this));
      if (this.collapsed.has(was!)) { const r = this.ask({ op: "collapse", tile: was!, on: false }); if (r.ok) this.commit(r); }
      this.arrived(was!, by, false, `${this.nameOf(at)} keeps its edit`);
      return true;
    }
    const id = this.nextId;
    if (!this.openReader(m, { kind: "split", target: at, dir: "right" }, by, undefined, true)) return false;
    this.besides.set(at, id);
    this.arrived(id, by, false, `${this.nameOf(at)} keeps its edit`);
    return true;
  }
  /** Tile `from`'s link across an edge takes `m` (an open, or a selection a preview follows): false when there is none or it can't. */
  private openAcross(from: number, m: Msg, by: Actor, following = false): boolean {
    const x = this.extTarget(from);
    if (!x || (following && x.verb !== "select")) return false;
    if (x.desk.keptFrom(x.pane, by)) return false;
    return x.desk.openIntoPane(x.pane, m, this.pathTo(x.pane) ?? x.desk.nameOfPane(x.pane), by, following);
  }


  /** DeskApi.summaryKeys: the summary a note shows with, as the columns listing it say (a board lane's view). */
  summaryKeys(m: Msg): readonly string[] | null { for (const md of this.models.values()) { const k = md.summaryKeys?.(m); if (k) return k; } return null; }

  /** DeskApi.shownNow: tile `p` is on screen (a float, or a tile shown in the tree). */
  shownNow(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && (this.isFloat(id) || visible(this.root).includes(id)); }

  /** A reader in a container that shuts its dock (the board's outline and backlinks previews): it follows its list. */
  private inShutting(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && chainOf(this.root, id).some(c => c.policy?.shuts); }
  /**
   * DeskApi.aimBacklinks, the person's (`b`): backlinks tile `L`'s subject becomes `m`, or the note of the reader they
   * read through (the focused reader; from the list itself, its home; else the one following their columns); that
   * reader becomes its home, its dock slides open, and the keys go to it. Resolves once the service has answered.
   */
  async aimBacklinks(L: Pane & { source: string; show(m: Msg, desk: DeskApi): Promise<void> }, m: Msg | null, given?: ReaderPane): Promise<void> {
    const lid = this.idOf(L);
    if (lid === undefined) throw new ActionRefused("that backlinks tile isn't on this screen");
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && !this.inShutting(p));
    const f = this.panes.get(this.focus);
    const forKeys = (f instanceof ReaderPane && !this.inShutting(f) ? f : undefined) ?? this.readerOfFocus()
      ?? readers.find(r => this.columnsIn().some(c => leaves(c).some(id => this.followers(id).includes(r)))) ?? readers[0];
    // b in the list itself aims it at its home's note (PIE-794).
    const home = this.focus === lid ? this.paneAtPath(L.source) : undefined;
    const reader = given ?? (m ? readers.find(r => r.msg?.id === m.id) : undefined) ?? (home instanceof ReaderPane ? home : undefined) ?? forKeys;
    const note = m ?? reader?.msg ?? null;
    if (!note) throw new ActionRefused("nothing in that reader to find backlinks for");
    if (reader) { L.source = this.pathTo(reader) ?? L.source; boundSource.set(L, reader); }
    this.revealPane(L, USER, true);
    const d = dockOf(this.root, lid);
    if (d && !d.open) this.apply({ op: "slide", tile: lid, open: true });
    if (this.focus !== lid) { this.keysTo(lid); this.entered.clear(); }
    this.redraw();
    await L.show(note, this);
    L.focused?.(this, USER);
    this.save(); this.redraw();
  }

  /**
   * DeskApi.openLinks (`b` in a reader): reader `r`'s note's links in this screen's links tile. The person's aims the
   * tile (aimBacklinks: its dock opens, their keys go to it); an agent's aims it without moving their keys. A screen
   * with none gets one below the reader, with a preview following its selection beside it (tile.open, as ^W o l and
   * ^W o p do), both by the actor: the layout's rules apply, so a locked screen says so.
   */
  async openLinks(r: Pane, actor: Actor): Promise<Record<string, unknown>> {
    const rid = this.idOf(r);
    const m = r instanceof ReaderPane ? r.msg : null;
    if (rid === undefined || !m) throw new ActionRefused("that reader isn't on this screen");
    const person = actor.kind !== "agent";
    // The screen's list `b` aims (a kind with `aim`: the links tile), one on screen first.
    const lists = this.relatives().flatMap(d => [...d.panes.values()].flatMap(p => {
      const list = kindOf(p)?.aim?.(p);
      return list ? [{ desk: d, list }] : [];
    }));
    const found = lists.find(({ desk, list }) => desk.shownNow(list)) ?? lists[0];
    let L = found?.list;
    const owner = found?.desk ?? this;
    let opened = false;
    if (!L) {
      const kind = tileKinds().find(k => k.aim);
      if (!kind) throw new ActionRefused("no kind of tile lists a note's links here");
      const at = this.nameOf(rid);
      const list = await this.openTile({ kind: kind.kind, source: `tile:${at}` }, at, "down", actor);
      if (kind.companion) await this.openTile({ kind: kind.companion, source: `tile:${list.tile}` }, list.tile, "right", actor);
      const made = this.panes.get(this.idNamed(list.tile)!)!;
      L = kind.aim!(made);
      opened = true;
    }
    if (person) await owner.aimBacklinks(L, m, r as ReaderPane);
    else if (opened) await L.show(m, this);                                       // its own new tile: nobody else's list
    else {
      // The person's list stays as it is (its note, its selection): an agent reads the note's links instead.
      return { tile: this.pathTo(L), of: m.id, opened, links: await readLinks(this.ctx.board, m.id) };
    }
    this.redraw();
    return { tile: this.pathTo(L), of: m.id, opened, links: L.describe() };
  }

  /**
   * DeskApi.revealInOutline (`reader.reveal`: alt+r, a click on a reader's crumbs, PIE-794): the outline's cursor moves to
   * reader `p`'s note, as the outliner's Tree's r does, its dock sliding open if it's shut; an outline in the drawer or
   * the screen beside does when this screen has none. Nothing else moves: not the current note, the reader, its mode or
   * the keys. A held reader's own navigation never moves the outline: this is how to find where it is.
   */
  async revealInOutline(p: Pane): Promise<{ revealed: string; outline: string }> {
    const m = p instanceof ReaderPane ? p.msg : null;
    if (!m) throw new ActionRefused("nothing in that reader to find in the outline");
    if (!isOutlineNote(m)) throw new ActionRefused(`${subject(m)} isn't a note in the outline (a Resource or a file): it has no place there`);
    const outline = (d: Desk) => d.all().find(id => typeof d.panes.get(id)?.reveal === "function");
    const desk = [this, ...this.relatives().filter(d => d !== this)].find(d => outline(d) !== undefined);
    const tid = desk ? outline(desk) : undefined;
    if (!desk || tid === undefined) throw new ActionRefused("no outline on this screen to show it in · ^W o t opens one beside this tile");
    const d = dockOf(desk.root, tid);
    if (d && !d.open) desk.apply({ op: "slide", tile: tid, open: true });
    await desk.panes.get(tid)!.reveal!(m, desk);
    desk.redraw(); this.redraw();
    return { revealed: m.id, outline: desk.pathTo(desk.panes.get(tid)!) ?? desk.nameOf(tid) };
  }

  /**
   * DeskApi.openTag (PIE-800): a `#tag` opened in reader `r` lists the notes carrying it (the service's `#tag` query, the
   * atom views use) in a query tile whose home is `r` (PIE-794: its selection previews, ⏎ replaces `r`'s note, alt+⏎ a
   * new detail beside `r`): the one already listing for `r` (not one held, PIE-855), asked the new tag, else one opened below `r` with a preview
   * following its selection beside it, as `b` opens the links tile (tile.open, the layout's rules: a locked screen says
   * so). The person's keys go to the list; an agent's stay where they are, and an agent never retargets the person's list
   * (it is answered the notes instead).
   */
  async openTag(r: Pane, tag: string, actor: Actor): Promise<TagList> {
    return { ...await this.openQuery(r, `#${tag}`, actor), tag };
  }

  async openQuery(r: Pane, query: string, actor: Actor): Promise<TagList> {
    const rid = this.idOf(r);
    if (rid === undefined) throw new ActionRefused("that reader isn't on this screen");
    const home = this.nameOf(rid);
    let id = this.all().find(i => { const p = this.panes.get(i); return p instanceof QueryPane && p.query !== null && p.home === home && !p.held; });
    const opened = id === undefined;
    // The person's list stays as it is (its tag, its selection): an agent reads the notes carrying the tag instead.
    if (!opened && actor.kind === "agent") {
      const r = await this.ctx.board.queryNotes(query, 200);
      return { tile: this.nameOf(id!), query, notes: r.notes.map(m => ({ id: m.id, title: subject(m) })) };
    }
    if (id === undefined) {
      const list = await this.openTile({ kind: "query", query, source: `tile:${home}` }, home, "down", actor);
      await this.openTile({ kind: "preview", source: `tile:${list.tile}` }, list.tile, "right", actor);
      id = this.idNamed(list.tile)!;
    }
    const q = this.panes.get(id);
    if (!(q instanceof QueryPane)) throw new ActionRefused(`no list opened for ${query}: the screen made ${this.nameOf(id)} instead`);
    await q.retarget(query, this);
    // A query the service refused is said, never answered as no notes (the tile shows it too).
    if (q.read?.status === "failed") throw new ActionRefused(`${query}: ${q.read.errors.join("; ") || "the service couldn't answer"}`);
    if (actor.kind !== "agent") { this.keysTo(id); q.focused(this); }
    this.save(); this.redraw();
    return { tile: this.nameOf(id), query, notes: (q.items ?? []).map((m: Msg) => ({ id: m.id, title: subject(m) })) };
  }

  /** DeskApi.hasFocus: tile `p` has the person's focus (a whole screen in it sees them through it). */
  hasFocus(p: Pane): boolean { return this.panes.get(this.focus) === p || this.readerOfFocus() === p; }
  /**
   * The reader the person reads through while their keys are in a list of columns (PIE-453: the board's lanes, whose
   * card its preview shows): it has their focus too, for what it draws and for whose it is.
   */
  private readerOfFocus(): ReaderPane | undefined {
    const c = chainOf(this.root, this.focus).find(x => x.t === "columns");
    return c ? this.followers(this.focus).find((q): q is ReaderPane => q instanceof ReaderPane) : undefined;
  }
  /** The kind of tile that has the person's keys (a view's own keys step aside for a tile that uses them). */
  private focusedKind(): TileKindName | undefined { return this.panes.get(this.focus)?.kind as TileKindName | undefined; }

  /** The person's keys to the first tile of `kind` (waiting's ⏎, the tree's open): `tile.focus`, as their key does. */
  focusKind(kind: TileKindName) {
    // A reader that follows the current note (a held one, a detail, keeps what it has: an open doesn't change it, so it isn't the one to go to).
    const id = this.all().find(i => { const p = this.panes.get(i); return p?.kind === kind && !(p instanceof ReaderPane && p.holding); });
    if (id !== undefined && id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
  }

  /** The shell's actions (screen.back, video.cycle) as the person's key (src/shell-keys.ts: screens.ts imports this module). */
  private shell(name: "screen.back" | "video.cycle") { shellKeyOf(name, this, this.ctx); }

  /** A repaint, while the desk is the screen shown (kept in the background, its programs don't repaint the menu). */
  redraw() { if (this.onScreen) this.ctx?.redraw(); }

  private arrivals = new Map<number, { by: string; note?: string; remaining: number; at: number }>();
  private arriving(id: number): boolean { return (this.arrivals.get(id)?.remaining ?? 0) > 0; }
  private arrived(id: number, by: Actor, preview = false, why = "") {
    const note = this.showing(this.panes.get(id))?.id;
    if (preview && this.arrivals.get(id)?.note === note) return;
    this.arrivals.set(id, { note, by: by.kind === "agent" ? by.id : "person", remaining: 10_000, at: this.clock() });
    if (!preview || by.kind === "agent") this.ctx?.flash(`${by.kind === "agent" ? `an agent (${by.id}) ` : ""}${preview ? "previewed" : "opened"} in ${this.numberOf(id)} · ${this.nameOf(id)}${why ? ` · ${why}` : ""}`);
    this.redraw();
  }
  clearArrival(sel?: string) {
    const t = this.tile(sel), arrival = this.arrivals.get(t.id);
    if (arrival) arrival.remaining = 0;
    this.redraw(); return { tile: t.name };
  }

  tick(): boolean {
    this.sweepTxns();
    let any = false;
    const now = this.clock();
    for (const [id, arrival] of this.arrivals) {
      const p = this.panes.get(id);
      if (!p) { this.arrivals.delete(id); continue; }
      if (arrival.remaining <= 0) continue;
      if (this.onScreen && this.shownNow(p) && this.hits.some(([tile]) => tile === id)) arrival.remaining -= now - arrival.at;
      arrival.at = now;
      if (arrival.remaining <= 0) any = true;
    }
    // A running transition asks for a frame every tick, and one more when it lands.
    if (this.pendingMotion) any = true;
    if (this.transition) { any = true; if (this.transition.done(this.clock())) this.transition = null; }
    for (const p of this.panes.values()) {
      p.shownAs?.(this.onScreen && this.shownNow(p));
      if (kindOf(p)?.tick?.(p)) any = true;
    }
    return any;
  }

  onEvent(e: OutlineEvent) {
    this.hear(e);
    for (const m of this.models.values()) m.onEvent?.(e);
    if (!this.ctx) return;
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && !p.msg?.id.startsWith("file:"));
    // Each reader the change makes stale re-reads its note (NoteSurface.staleOn, .reread; a draft is only marked).
    for (const r of readers) if (r.surface.staleOn(e)) r.reread(this);
    if (e.action === "reconnected") for (const r of readers) r.retry(this);   // a note whose read failed while away
  }

  /**
   * The tiles hear a change (but those `skip` names: a screen that refreshes its readers its own way), and each
   * columns container whose source it may change is filled again (a view added under the hub: a new lane).
   */
  private hear(e: OutlineEvent, skip?: (p: Pane) => boolean) {
    // A desk never entered (a showcase stage not opened yet) has no Ctx: its tiles read fresh when it is entered.
    if (!this.ctx) return;
    for (const p of this.panes.values()) {
      // A plain reader hears only what concerns it; a reader of its own kind (a pinned page waiting for its page, the brief
      // counting its days) hears everything, as any tile does.
      if (skip?.(p) || (p instanceof ReaderPane && p.onEvent === ReaderPane.prototype.onEvent && !readerHears(p, e))) continue;
      (p.onEvent as ((d: DeskApi, e?: OutlineEvent) => void) | undefined)?.call(p, this, e);
    }
    if (e.action === "reset") return void this.fillColumns();
    const c = e.change;
    if (c) for (const col of this.columnsIn()) { const src = tileSource(col.source); if (src?.source.affects?.(c, src.arg)) void this.fillColumns(col); }
  }

  /**
   * `ep0ch open <id>` (an agent's): the note is shown where the focused tile's opens land, else in a reader
   * that follows the current note, else in the first detail free to take it. The person's keys, their outline
   * cursor and what they're typing in stay where they are.
   */
  openBlock(m: Msg, by: Actor = USER) {
    try { this.landBlock(m, by); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); }
  }
  /**
   * Where an open naming no tile lands: the tile the spec says (`ScreenSpec.lands`) takes it its kind's way, a refusal
   * thrown (an agent's `open` is told why); else where the focused tile's opens land (`openShown`).
   */
  private landBlock(m: Msg, by: Actor) {
    // A flow by its key (the river's): the note opens in the column after the one the keys are in (or the last), its way.
    const flow = this.spec.lands !== undefined && this.specTile(this.spec.lands) === undefined ? node(this.root, this.spec.lands) : null;
    if (flow?.t === "flow") {
      const ids = leaves(flow), from = ids.includes(this.focus) ? this.focus : ids.at(-1);
      if (from === undefined || this.openNext(from, m, by) === undefined) throw new ActionRefused(`not opened: ${this.spec.lands} took no column for it`);
      this.current = m;
      this.redraw();
      return;
    }
    // A container by its key (the board's readers row): a tile opened there holds it, quietly for an agent.
    if (this.spec.lands !== undefined && this.specTile(this.spec.lands) === undefined && node(this.root, this.spec.lands)) {
      this.current = m;
      const at = this.openIntoContainer(this.spec.lands, m, false, by);
      this.redraw();
      if (at === undefined) throw new ActionRefused(this.openWhy ?? `not opened: nothing in ${this.spec.lands} could take it`);
      return;
    }
    const lands = this.spec.lands !== undefined ? this.specTile(this.spec.lands) : undefined;
    const p = lands !== undefined ? this.panes.get(lands) : undefined, take = p ? kindOf(p)?.take : undefined;
    if (p && take) this.mayOpen(p, by);
    if (p && take) { const why = take(p, m, this, by); this.redraw(); if (why) throw new ActionRefused(/^(holds|is|has|can't)\b/.test(why) ? `${this.nameOf(lands!)} ${why}` : why); this.arrived(lands!, by); return; }
    this.openShown(m, by);
  }
  /**
   * The reader an open naming no tile lands in (the drawer's what-changed list, `ep0ch open <id>`): a tile that cannot
   * open into a reader of its own has the keys and links somewhere (the daily layout's claude tile → middle), else the
   * reader that follows the current note, else the first reader. A reader's own link is where the links followed IN it
   * land (reader9 → reader10), never where an open from outside lands: it is not asked, so the chain's last link
   * isn't moved by opening into the reader before it (PIE-700).
   */
  private openLandingReader(by: Actor): { id: number; name: string; pane: ReaderPane } | undefined {
    const focused = this.panes.get(this.focus);
    const link = focused instanceof ReaderPane ? undefined : this.linkOf(this.focus);
    // Not a tile that follows a source (a preview of a tile or a file): what it shows is its source's.
    // A reader the screen limits for agents (PIE-639) isn't where an agent's open lands.
    const readers = this.namedReaders().filter(r => !r.pane.holdsKeys && !r.pane.editing && !kindOf(r.pane)?.follower && !this.keptFrom(r.pane, by) && (r.pane.followMode !== "pinned" || r.id === link));
    // (A reader pinned to a page, the daily layout's `now`, is where an open lands only when linked: other opens leave it on its page, PIE-705.)
    return (link !== undefined ? readers.find(x => x.id === link) : undefined) ?? readers.find(x => x.pane.follows && !x.pane.holding) ?? readers[0];
  }
  /**
   * `openBlock`, saying which reader it landed in: the reader `openLandingReader` names has its note replaced as any
   * open replaces one (`openInto`, PIE-794: a following reader moves the current note, a held one only itself); with no
   * reader here, the current note moves.
   */
  private openShown(m: Msg, by: Actor): string | null {
    // A link across a group's edge: the reader there (in its own desk) takes it. A reader's own link is for opens made in it.
    const across = this.panes.get(this.focus) instanceof ReaderPane ? undefined : this.linkOf(this.focus) === undefined ? this.extTarget(this.focus) : undefined;
    if (across && across.pane instanceof ReaderPane && !across.pane.holdsKeys && !across.pane.editing && !across.desk.keptFrom(across.pane, by)) {
      const path = this.pathTo(across.pane) ?? null;
      across.desk.openIntoPane(across.pane, m, path ?? across.desk.nameOfPane(across.pane), by);
      this.redraw(); across.desk.redraw();
      return path;
    }
    const r = this.openLandingReader(by);
    if (!r) { this.setCurrent(m, { by }); return null; }
    // Even when it shows `m` already (a selection previewed in a following reader): the open makes it current.
    this.openInto(r.id, m, by);
    this.redraw();
    return r.name;
  }

  /** `open fresh=true` naming no tile (the power bar's alt+⏎): a new detail beside the focused tile, as alt+⏎ on a link opens one; the keys go there only for the person. */
  async openFresh(id: string, actor: Actor): Promise<{ reader: string | null; id: string }> {
    const m = await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    const before = new Set(this.all());
    this.setCurrent(m, { from: this.panes.get(this.focus), link: true, fresh: true, by: actor });
    const made = this.all().find(x => !before.has(x));
    this.redraw();
    return { reader: made !== undefined ? this.nameOf(made) : null, id: m.id };
  }

  /**
   * Tile `from`'s explicit link across an edge (the drawer's what-changed list → a reader of the screen, PIE-700) takes
   * note `id`: the path of the tile it opened in, or null when `from` has no such link or the tile didn't take it (said).
   * An open from a linked tile never asks where focus last was.
   */
  async openOnLink(id: string, from: string, actor: Actor): Promise<string | null> {
    const t = this.tile(from), x = this.extTarget(t.id);
    if (!x) return null;
    const m = await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    const path = this.pathTo(x.pane) ?? "";
    if (!x.desk.openIntoPane(x.pane, m, path, actor)) return null;
    this.redraw(); x.desk.redraw();
    return path;
  }

  /**
   * `open from=<tile>` (PIE-491): the note lands where tile `from`'s opens go, its link (the daily layout's claude
   * tile links to middle). Unlinked, where `ep0ch open <id>` puts it. The caller names its own tile, never a reader.
   */
  async openFrom(id: string, from: string, actor: Actor, fresh = false): Promise<{ reader: string | null; id: string }> {
    // The host layer's agent (PIE-513: it lives above every screen, no tile here) opens where an agent's open lands.
    if ((from === DRAWER_NAME || from === DRAWER_TILE_ID) && this.idNamed(from) === undefined) return this.openLanding(id, actor);
    // Read with `tile=`'s grammar (a name, an id, a number), as an argument that may name the host layer's agent.
    const t = this.tile(this.dispatch.name(from) ?? from);
    if (fresh) {
      const m = this.onScreenBlock(id) ?? await readNote(this.ctx, id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      const before = new Set(this.all());
      this.setCurrent(m, { from: this.panes.get(t.id), link: true, fresh: true, by: actor });
      const made = this.all().find(x => !before.has(x));
      const target = wireTarget(this.layout, t.id, "alt");
      return { reader: made !== undefined ? this.nameOf(made) : target !== undefined ? this.nameOf(target) : null, id: m.id };
    }
    // Its opens land in a container (the board's readers row): a tile there holds it.
    const into = landing(this.layout, t.id, "open", this.facts(t.id));
    if (into && "into" in into) return this.openPlace(id, fresh ? "new-detail" : "detail", actor, t.id);
    // From a list (the links tile): fresh is a new detail beside its home, the list keeps the keys (PIE-646).
    const home = fresh ? this.homeId(t.id) : undefined;
    if (home !== undefined) {
      const m = await readNote(this.ctx, id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      const made = this.nextId;
      if (this.openReader(m, { kind: "split", target: home, dir: "right" }, actor, undefined, true)) { this.redraw(); return { reader: this.nameOf(made), id: m.id }; }
    }
    const to = this.linkOf(t.id);
    // A link across a group's edge: the note opens in that tile, wherever its desk is.
    const across = to === undefined ? this.extTarget(t.id) : undefined;
    if (across) {
      const m = await readNote(this.ctx, id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      if (across.desk.openIntoPane(across.pane, m, this.pathTo(across.pane) ?? "", actor)) { this.redraw(); across.desk.redraw(); return { reader: this.pathTo(across.pane) ?? null, id: m.id }; }
    }
    // A column of a flow (the river's): the column after it (`fresh`: a new one even when a column has the note).
    if (to === undefined && this.inFlow(t.id)) {
      const m = this.onScreenBlock(id) ?? await readNote(this.ctx, id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      const at = this.openNext(t.id, m, actor, fresh);
      if (at === undefined) throw new ActionRefused(`not opened: ${t.name}'s flow took no column for it`);
      this.current = m;
      this.redraw();
      return { reader: this.nameOf(at), id: m.id };
    }
    const m = await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    // A linked tile that takes notes its own way (an extension's kind): it takes it there.
    if (to !== undefined && this.openInto(to, m, actor)) { this.redraw(); return { reader: this.nameOf(to), id: m.id }; }
    // A reader with no link is its own home (PIE-794): the note replaces its own, as a link followed in it does (a held
    // one changes only itself; one following the current note moves the current note).
    const self = this.panes.get(t.id);
    if (to === undefined && !fresh && self instanceof ReaderPane && !kindOf(self)?.follower) {
      if (this.openInto(t.id, m, actor)) { this.redraw(); return { reader: t.name, id: m.id }; }
    }
    // A mounted part with no reader of its own (the lanes alone): where the mount's opens land, on the screen holding it.
    if (this.outward && !this.namedReaders().length && this.spec.lands === undefined) return this.outward(m, actor, fresh);
    return this.land(m, actor);
  }

  /**
   * An agent's `open id=` naming no reader and no tile (`ep0ch open <id>`): where this screen puts an agent's
   * open (`openBlock`: the desk's focused tile's link or a following reader, the board's detail, the welcome's
   * preview, the brief's step), never the reader the person types in.
   */
  async openLanding(id: string, by: Actor): Promise<{ reader: string | null; id: string }> {
    const m = await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    return this.land(m, by);
  }
  /**
   * `open fragment=` (`ep0ch open <uri>#<fragment>`, `((id^fragment))`): the reader that shows the note scrolls to the
   * fragment and marks it, as a followed link does (PIE-425); an agent's never scrolls the reader the person is in.
   */
  revealIn(reader: string | null, target: string | Reveal, actor: Actor): void {
    const r = this.namedReaders().find(x => x.name === reader);
    if (!r) return;
    const host = r.pane.host(this);
    if (actor.kind === "agent" && host.focused !== false) return;
    const reveal = typeof target === "string" ? { fragment: target } : target;
    if (reveal.fragment) void r.pane.surface.revealFragment(reveal.fragment, host, actor);
    else if (reveal.at !== undefined) void r.pane.surface.revealAt(reveal.at, host, actor, reveal.label, reveal.says);
  }

  /** A note that is no block (a file, its diff: `open file=`) where an agent's open lands. */
  landNote(m: Msg, by: Actor): { reader: string | null; id: string } { return this.land(m, by); }

  /** `openBlock(m)`, saying which reader shows it now. */
  private land(m: Msg, by: Actor): { reader: string | null; id: string } {
    // A spec's landing refuses with its reason (thrown to the agent); otherwise the screen's own open.
    this.landBlock(m, by);
    // A reader that keeps what it's given (a detail) before one that follows (a preview showing it already).
    const showing = this.namedReaders().filter(r => r.pane.msg?.id === m.id);
    return { reader: (showing.find(r => !kindOf(r.pane)?.follower) ?? showing[0])?.name ?? null, id: m.id };
  }

  // ── actions: what the keys do, by name, for agents (`ep0ch act`), through one dispatcher (PIE-514) ──

  /**
   * The desk's dispatcher: a screen built on the desk registers its own sets first (the board's, the welcome's);
   * then the desk's own, its tile actions, `pane.split`, each tile kind's (in a tile of that kind), a tile that
   * holds a whole screen (that screen's dispatcher, in its tile), and a reader's note actions. `tile=` is read with
   * one grammar over `tiles()`; `expected=` against the layout's revision; each action's declared touches against
   * where the person is (`keys`, through the shell's whereabouts).
   */
  private completionFloat: { completer: Completer; rect: Rect; origin: Rect } | null = null;
  private hintCard: HintCard | null = null;
  private hintPointer: { x: number; y: number } | undefined;
  private modeHintKey = "";
  private xray = false;
  private xrayCards: HintCard[] = [];
  private linkCards: HintCard[] = [];
  private hintCards(): HintCard[] { return this.xray ? this.xrayCards : this.linkCards.length ? this.linkCards : this.hintCard ? [this.hintCard] : []; }

  showHint(hint: Hint, sel?: string, actor: Actor = USER) {
    const t = this.tile(sel);
    const setting = hintSetting(hint.id ?? "hint.show", this.lookOf(this.panes.get(t.id)!)?.values.hints ?? "full");
    this.hintCard = setting === "card" ? new HintCard(hint, t.name, t.id, actor.kind === "agent" ? actor.id : undefined) : null;
    // The armed edit already owns this status line and clears it when its window ends.
    if (setting === "status" && hint.id !== "confirm") this.ctx.flash(hintStatus(hint));
    this.redraw();
    return this.hintGet();
  }
  hintShow(sel?: string, text?: string, actor: Actor = USER) {
    const t = this.tile(sel);
    return this.showHint(text === undefined ? this.controlsHint(t.id) : { title: "Hint", lines: [text] }, t.name, actor);
  }
  hintGet(all = false) {
    return { settings: this.hintsList(), xray: this.xray, cards: all ? this.hits.map(([id]) => new HintCard(this.controlsHint(id), this.nameOf(id), id).describe()) : this.hintCards().map(c => c.describe()) };
  }
  hintsList() { return { hints: declaredHints(this.lookOf(this.panes.get(this.focus)!)?.values.hints ?? "full") }; }
  hintsSet(id: string, to: HintSetting) { setHint(id, to, "full"); this.hintDismiss(); return this.hintsList(); }
  hintsReset() { resetHints(); this.hintDismiss(); return this.hintsList(); }
  hintNever(sel?: string) {
    const card = sel ? this.hintCards().find(c => c.anchor === this.tile(sel).id) : this.hintCards().at(-1);
    if (!card) throw new ActionRefused("no hint card here; hints.list shows every hint");
    const hint = card.hint;
    this.hintsSet(card.id, "status");
    this.ctx.flash(hintStatus(hint));
    return this.hintGet();
  }
  hintPin(sel?: string) { const card = this.xray || sel ? this.hintCards().find(c => c.anchor === this.tile(sel).id) : this.hintCard; if (card) { card.pinned = true; this.hintCard = card; this.linkCards = []; this.xray = false; this.xrayCards = []; } this.redraw(); return this.hintGet(); }
  hintScroll(by: number, sel?: string) { const card = this.xray || sel ? this.hintCards().find(c => c.anchor === this.tile(sel).id) : this.hintCard; card?.view.scroll(by); this.redraw(); return this.hintGet(); }
  hintDismiss() { this.hintCard = null; this.linkCards = []; this.xray = false; this.xrayCards = []; this.redraw(); return this.hintGet(); }
  xraySet(on?: boolean) {
    this.xray = on ?? !this.xray;
    this.xrayCards = this.xray ? this.hits.flatMap(([id]) => hintSetting("frame", this.lookOf(this.panes.get(id)!)?.values.hints ?? "full") === "card" ? [new HintCard(this.controlsHint(id), this.nameOf(id), id)] : []) : [];
    if (this.xray && hintSetting("frame", this.lookOf(this.panes.get(this.focus)!)?.values.hints ?? "full") === "status") {
      const hint = this.controlsHint(this.focus);
      this.ctx.flash(hintStatus(hint));
    }
    this.redraw(); return this.hintGet();
  }
  private controlsHint(id: number): Hint {
    const pane = this.panes.get(id);
    return { id: "frame", title: `${this.numLabel(id)}${this.displayTitle(id)} controls`, lines: [FRAME_LEGEND, ...(pane instanceof ReaderPane ? pane.surface.buttonHint() : [])] };
  }
  linkingHint(): Hint | null {
    if (!this.linking) return null;
    const { desk, from, verb } = this.linking, tile = desk.nameOf(from);
    const targets = this.screenTiles();
    // Two lines: where this wire lands now, and what a click does. The rows below carry the rest; no line repeats a row.
    const what = verb === "select" ? "A select in" : verb === "alt" ? "An alt-open from" : "An open from";
    return { id: "link", title: `${tile}: ${verb} wire`, lines: [
      `${what} ${tile} lands in ${desk.wireWords(from, verb)}.`,
      `Click a tile to send it there; alt+click an edge or gap for beside.`,
    ], keys: [{ keys: "h j k l / 1-9", does: "choose a tile" }],
      choices: [ ...targets.flatMap(({ pane }, i) => {
        if (pane === desk.panes.get(from) || !this.linkAccepts(pane)) return [];
        const owner = desk.relatives().find(d => d.idOf(pane) !== undefined)!;
        return [{ label: `${i + 1} · ${owner.nameOfPane(pane)}`, key: i < 9 ? String(i + 1) : undefined, act: { action: "tile.link", tile, args: { verb, to: desk.pathTo(pane)! } } }];
      }), ...(["select", "open", "alt"] as const).map(v => ({ label: `change ${v} wire`, key: v === "select" ? "s" : v === "open" ? "o" : "a", current: v === verb, act: { action: "tile.link", tile, args: { ask: true, verb: v } } })),
        { label: `unlink ${verb} wire`, act: { action: "tile.link", tile, args: { verb } } }, { label: "cancel", key: "esc", act: { action: "tile.link", tile, args: { ask: false } } } ] };
  }

  private syncModeHint(shown?: string) {
    const overlay = this.overlays.top();
    const mode = this.ctx?.armed?.() ? "confirm" : overlay?.hintCard ? `overlay:${overlay.name}` : this.linking ? `link:${this.linkOwner().pathTo(this.linkingFrom()!)}:${this.linking.verb}` : this.drag ? "resize" : this.dragging || this.floatDrag ? "drag" : this.prefix === "move" || this.prefix === "tab" ? this.prefix : this.prefix === "resize" ? "resize" : this.pickedBy(USER).length ? "gather" : "";
    if (mode === this.modeHintKey) return;
    const previous = this.modeHintKey;
    this.modeHintKey = mode;
    this.linkCards = [];
    if (!mode) { if (previous && !this.hintCard?.pinned) this.hintCard = null; return; }
    if (this.hintCard?.pinned) return;
    const hint = mode === "confirm" ? CONFIRM_HINT : overlay?.hintCard ?? (mode.startsWith("link:") ? this.linkingHint() : mode === "gather" ? GATHER_HINT : mode === "resize" ? RESIZE_HINT : MOVE_HINT);
    const id = mode === "confirm" ? "confirm" : overlay?.hintCard ? overlay.name : mode.startsWith("link:") ? "link" : mode === "gather" ? "gather" : mode === "resize" ? "resize" : "move";
    if (id === shown) return;
    if (hint && mode.startsWith("link:")) {
      // One card, on the tile the wire starts from, and only on the desk that holds it. Every other tile says
      // "click to link here" on its frame; a card on each was a wall of copies (Evan, Oct 19 10:55 AM).
      const from = this.linkingFrom(), id = from ? this.idOf(from) : undefined;
      this.linkCards = [];
      if (id !== undefined) this.showHint({ ...hint, id: "link" }, this.nameOf(id));
    } else if (hint) this.showHint({ ...hint, id }, this.nameOf(this.focus));
  }

  readonly dispatch: Dispatcher = new Dispatcher(this.dispatchHost(), this.registrations());

  async visitAgent(agent: string) {
    const p = this.ctx.agentPointers?.get(agent, this);
    if (!p) throw new ActionRefused(`no explicit pointer for ${agent} here`);
    await this.dispatch.press("tile.focus", {}, p.tile);
    if (p.note) {
      const pane = this.pane(p.name);
      if (pane instanceof ReaderPane && pane.msg?.id !== p.note) await this.dispatch.press("open", { id: p.note }, p.tile);
    }
    if (p.line !== undefined) {
      await this.dispatch.press("reading.place", { line: p.line }, p.tile);
      await this.dispatch.press("view.scrollTo", { line: p.line }, p.tile);
    }
    return { pointer: p };
  }

  private dispatchHost() {
    const d = this;
    return {
      pointerScope: d,
      beforeAction: (name: string) => { if (!name.startsWith("hint.") && !name.startsWith("hints.") && name !== "xray" && !d.hintCard?.pinned) d.hintCard = null; },
      hint: (hint: Hint, tile: string | undefined, actor: Actor) => { if (!d.hintCard?.pinned) { d.syncModeHint(hint.id); d.showHint(hint, tile, actor); } },
      get title() { return d.title; },
      ctx: () => d.ctx,
      get where() { return d.whereNow ? () => d.whereNow!() : undefined; },
      keys: () => d.keys(),
      bindings: () => [
        ...DAILY_LAYOUT_KEYS,
        ...W_KEYS.map(row => ({ ...row, key: `ctrl+w ${row.key === " " ? "space" : row.key}` })),
        ...d.spec.keys ?? [],
        ...[...d.panes.values()].flatMap(p => p.bindings ?? []),
        ...d.overlays.top()?.bindings ?? [],
      ],
      tiles: () => d.tiles(),
      revision: (expected: unknown) => revisionRefusal(d.layout, expected),
      draftOf: (t: TileRef) => {
        const p = d.pane(t.name);
        return p instanceof ReaderPane ? { board: d.ctx ? p.context(d).board : undefined, blockId: p.msg?.id ?? null, session: p.surface.draftSession() } : null;
      },
    };
  }

  private registrations(): (Registration | Delegation)[] {
    const pane = (t: TileRef | undefined) => (t ? this.pane(t.name) : undefined);
    const reader = (t: TileRef | undefined) => { const p = pane(t); if (!(p instanceof ReaderPane)) throw new ActionRefused(`${t?.name ?? "that tile"} isn't a reader`); return p; };
    const answerIn = (key: "tile" | "reader") => (out: unknown, at: { tile?: TileRef }) => ({ [key]: at.tile!.name, ...(out && typeof out === "object" ? out : { result: out }) });
    // Each tile kind's own actions (the tree's tree.*, a terminal's tile.type), in a tile of that kind.
    const kindSets = (): Registration[] => allKindActions().map(set => ({
      set, takes: "tile", pick: "only",
      in: t => kindActions(kindOf(pane(t))).includes(set),
      noun: () => [...new Set(tileKinds().filter(k => kindActions(k).includes(set)).map(k => kindNoun(k.kind)))].join(" or ") || "a tile",
      on: at => ({ pane: pane(at.tile)!, desk: this, tile: at.tile!.name }),
      answer: answerIn("tile"),
    }));
    return [
      // A tile of a screen mounted here (PIE-651), by its path: `tile=<mount>/<tile>`, any action that screen takes.
      {
        claims: (req: ActRequest) => isTilePath(req.tile) && !!this.mountIn(req)?.takes(this.pathRest(req)),
        delegate: (req?: ActRequest) => (req ? this.mountIn(req) : null),
        request: (req: ActRequest) => this.pathRest(req),
        answer: (out: unknown, req: ActRequest) => ({ ...(out && typeof out === "object" ? out : { result: out }), tile: req.tile }),
        listed: false,
      },
      {
        set: PROPOSAL_ACTIONS, takes: "screen",
        claims: req => req.tile === undefined && (typeof req.args?.id === "string" || typeof req.args?.block === "string") && PROPOSAL_ACTIONS.has(req.action),
        on: (_at, how) => ({ host: { ctx: how.ctx, redraw: () => this.ctx?.redraw() } }),
      },
      { set: HINT_ACTIONS, takes: "screen", on: at => ({ d: this, reader: at.name }) },
      { set: DESK_ACTIONS, takes: "screen", on: at => ({ d: this, reader: at.place ?? at.name }) },
      { set: TILE_ACTIONS, takes: "screen", on: at => ({ d: this, reader: at.place ?? at.name }) },
      { set: PANE_ACTIONS, takes: "screen", on: at => ({ h: this, reader: at.name }) },
      // Built from the registry each time: an extension's kind comes and goes while the door runs.
      { claims: (req: ActRequest) => kindSets().some(r => r.set.has(req.action)), delegate: () => this.kindDispatch(kindSets()), listed: true },
      // A columns container's source's actions (the board's lanes: card.*, board.hub), on its model there.
      { claims: (req: ActRequest) => this.sourceSets().some(r => r.set.has(req.action)), delegate: () => this.kindDispatch(this.sourceSets()), listed: true },
      // A tile holding a whole screen (the board, the river, the brief): its own actions there, tile= named.
      {
        claims: (req: ActRequest) => !!this.screenIn(req)?.has(req.action),
        delegate: (req?: ActRequest) => (req ? this.screenIn(req) : null),
        request: (req: ActRequest) => ({ ...req, tile: undefined }),
        answer: (out: unknown, req: ActRequest) => ({ tile: (req.tile && this.dispatch.tile(req.tile)?.name) || req.tile, ...(out && typeof out === "object" ? out : { result: out }) }),
        listed: false,
      },
      {
        set: NOTE_ACTIONS, takes: "tile", pick: "first", seen: true, noun: "a reader",
        in: t => this.pane(t.name) instanceof ReaderPane,
        // The person's key or click in a reader brings the host it was given (a click's own navigate); else the reader's.
        on: (at, how) => { const p = reader(at.tile); return { surface: p.surface, host: (how.given as SurfaceHost | undefined) ?? p.host(this) }; },
        run: (name, args, on, actor, typed) => on.surface.run(name, args, on.host, actor, typed),
        answer: answerIn("reader"),
      },
    ];
  }
  /** Each source model's actions, as the screen's own (none named: they run on that model). */
  private sourceSets(): Registration[] {
    return this.columnsIn().flatMap(c => {
      const src = tileSource(c.source), set = src?.source.actions, model = c.id ? this.modelOf(c.id) : undefined;
      if (!set || !model) return [];
      return [{
        set, takes: "screen" as const,
        // A lane's menu has its model's rows; the screen's other tiles' don't.
        menuIn: (t: TileRef) => { const id = this.idNamed(t.name); return id !== undefined && leaves(c).includes(id); },
        // `given` is what the person's key saw (the steps overlay's step, for their step.set from it).
        on: (_at: unknown, how: RunHow<unknown>) => ({ model, ...((how.given as object | undefined) ?? {}) }),
        // A card action writes the card it names (or the one selected): the draft rule is asked about that block.
        draftOf: (_at: unknown, a: Record<string, unknown>, actor: Actor) => ({ board: this.ctx?.board, blockId: typeof a.card === "string" ? a.card : model.draftBlock?.(actor) ?? null }),
      }];
    });
  }
  /** The kind sets' dispatcher: the same tiles and rules as the desk's (rebuilt with the registry, which changes). */
  private kindDispatch(regs: Registration[]): Dispatcher { return new Dispatcher(this.dispatchHost(), regs); }
  /** The dispatcher of the screen mounted in the tile a path's first part names (`tile=<mount>/…`). */
  private mountIn(req: ActRequest): Dispatcher | null {
    const head = req.tile?.slice(0, req.tile.indexOf("/")) ?? "";
    const t = head ? this.dispatch.tile(head) : null, p = t ? this.pane(t.name) : undefined;
    return p ? kindOf(p)?.dispatcher?.(p) ?? null : null;
  }
  /** The request as the mounted screen reads it: the rest of the path names its tile. */
  private pathRest(req: ActRequest): ActRequest { const rest = req.tile!.slice(req.tile!.indexOf("/") + 1); return { ...req, ...(rest ? { tile: rest } : { tile: undefined }) }; }
  /** The screen mounted in the tile with the keys (a group, a board in a tile), when it takes an open: the person's open naming no tile lands in there, as its own reader's would (PIE-651). */
  focusedMount(): { name: string; dispatch: Dispatcher } | null {
    const p = this.panes.get(this.focus), dsp = p ? kindOf(p)?.dispatcher?.(p) ?? null : null;
    return dsp?.has("open") ? { name: this.nameOf(this.focus), dispatch: dsp } : null;
  }
  /** The dispatcher of the whole screen in the tile a request names (a board in a tile), if it names one. */
  private screenIn(req: ActRequest): Dispatcher | null {
    // By the dispatcher's grammar (a name, an id, a number, an alias, a block id), as every other tile= is read.
    const t = req.tile ? this.dispatch.tile(req.tile) : null;
    const p = t ? this.pane(t.name) : undefined;
    return p ? kindOf(p)?.dispatcher?.(p) ?? null : null;
  }

  /** The tiles as `tile=` reads them: each by name, its stable id, its number on screen, what it shows. */
  private tiles(): TileRef[] {
    const all = this.all(), shown = new Set([...visible(this.root), ...this.floats.map(f => f.id)]);
    // Places, as aliases a tile answers to while it's there: `detail` (where an open into the screen's container lands now: the board's
    // readers row); `float` (the top float); a columns container's key (the tile last in it: the board's `lanes`).
    const more = new Map<number, string[]>();
    const add = (id: number | undefined, alias: string) => { if (id !== undefined && this.idNamed(alias) === undefined) more.set(id, [...(more.get(id) ?? []), alias]); };
    const into = this.opensIntoKey();
    if (into) add(this.activeIn(into), "detail");
    add(this.floats.at(-1)?.id, "float");
    for (const c of this.columnsIn()) if (c.key && c.id) { const ids = leaves(c), at = this.lastIn.get(c.id); add(at !== undefined && ids.includes(at) ? at : ids[0], c.key); }
    // A reader following a tile answers to that tile's name too, for a note action (`tile=tree` on the board is the
    // outline's preview): a note action runs only in a reader, so the tile itself is never meant.
    for (const { from, to, verb } of this.layout.wires) if (verb === "select" && this.panes.get(to) instanceof ReaderPane) more.set(to, [...(more.get(to) ?? []), this.nameOf(from)]);
    return all.map((id, i) => {
      const p = this.panes.get(id)!, rd = p instanceof ReaderPane ? p : null, name = this.nameOf(id), aliases = more.get(id), mount = kindOf(p)?.dispatcher?.(p);
      return {
        name, id: this.tileId(id), n: i + 1, kind: this.unregistered.get(id)?.kind ?? p.kind, shown: shown.has(id),
        ...(mount ? { mount } : {}),
        ...(rd?.noteAddress ?? {}),
        shows: this.showing(p)?.id ?? null, editing: !!rd?.editing,
        ...(rd ? { holds: (a: Actor) => rd.surface.heldBy(a) } : {}),
        // A note action doesn't change a note where the person can't see it: a spine, a reader in a shut dock.
        ...(this.collapsed.has(id) ? { readOnly: `${name} is collapsed to a spine; tile.collapse on=false tile=${name} opens it first` }
          : rd && !rd.editing && (this.coverNow(id) === "peek" || this.coverNow(id) === "spine") ? { readOnly: `${name} is a ${this.coverNow(id)} in its flow; a compressed column is a read-only view until it's full width · tile.widen tile=${name} or tile.hold tile=${name}; neither takes the person's keys` }
          : rd && !shown.has(id) && dockOf(this.root, id) ? { readOnly: `${name} isn't on screen (its dock is shut); open it first (tile.slide open=true tile=${name})` } : {}),
        ...(aliases?.length ? { aliases } : {}),
        ...(this.agentOf(id).level !== "free" ? { agents: this.agentOf(id) } : {}),
      };
    });
  }
  /** The tile named `name` (a name from the spec or `tile=`). */
  pane(name: string): Pane | undefined {
    const id = this.idNamed(name);
    // A path (`group/tile`, `../tile`) names a tile of another desk of the family (PIE-696).
    return id === undefined ? (name.includes("/") ? this.paneAtPath(name) : undefined) : this.panes.get(id);
  }

  // What a host reads of the screen (the showcase, a test): by name and by pane, never its ids or its state.

  /** The model of columns container `key` (the board's lanes: src/desk/lanes.ts). */
  modelFor(key: string): SourceModel | undefined { const c = node(this.root, key); return c?.t === "columns" && c.id ? this.modelOf(c.id) : undefined; }
  /** The tiles opened into container `key` (the board's details) that are pinned there, in its order. */
  openedPanes(key: string): Pane[] { return this.openedTiles(key).filter(id => !this.isFloat(id)).map(id => this.panes.get(id)!); }
  /** The tile an open into container `key` lands in now. */
  activePane(key: string): Pane | undefined { const id = this.activeIn(key); return id === undefined ? undefined : this.panes.get(id); }
  /** The floats, the top one last. */
  floatPanes(): Pane[] { return this.floats.map(f => this.panes.get(f.id)!); }
  /** The person's keys are in a column of a flow (the river's). */
  focusInFlow(): boolean { return this.inFlow(this.focus); }
  /** Tile `id` is a column (or in one) of a flow. */
  private inFlow(id: number): boolean { return chainOf(this.root, id).some(c => c.t === "flow"); }
  /** The name of the tile with the person's keys. */
  focusedName(): string { return this.nameOf(this.focus); }
  /** Tile `p` is in a dock (not pinned in the layout). */
  inDock(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && !!dockOf(this.root, id); }
  /** The columns of the flow (or columns container) with key `key`, in order: each column's tiles (a stacked one has several). */
  columnsOf(key: string): Pane[][] { const n = node(this.root, key); return n && "kids" in n ? n.kids.map(k => leaves(k).map(id => this.panes.get(id)!)) : []; }
  /** How tile `p` shows in its flow now: full, peek or spine (undefined outside a flow, or off its strip). */
  coverOf(p: Pane): "full" | "peek" | "spine" | undefined { const id = this.idOf(p); return id === undefined ? undefined : this.coverNow(id); }
  /** How tile `id` shows in its flow in the layout as it is now (not as last painted: an action may have just pinned it). */
  private coverNow(id: number): "full" | "peek" | "spine" | undefined {
    if (this.coversAt?.state !== this.state || this.coversAt.area !== this.area) {
      const ps = placeLayout(this.layout, this.area, this.holds), m = new Map(ps.covers ?? []);
      for (const d of ps.slid) for (const [k, v] of d.placed.covers ?? []) m.set(k, v);
      this.coversAt = { state: this.state, area: this.area, covers: m };
    }
    return this.coversAt.covers.get(id) as "full" | "peek" | "spine" | undefined;
  }
  private coversAt: { state: LayoutState<number>; area: Rect; covers: Map<number, string> } | null = null;
  /** Tile `p`'s column is the wide one of its flow. */
  isWide(p: Pane): boolean {
    const id = this.idOf(p), flow = id === undefined ? undefined : chainOf(this.root, id).find((c): c is Flow<number> => c.t === "flow");
    return !!flow && flow.anchor !== undefined && columnOf(flow, flow.anchor) === columnOf(flow, id);
  }
  /** The id of the container with key `key` (the board's `lanes`), as `layout.get` and `layout.policy` name it. */
  containerId(key: string): string | undefined { return node(this.root, key)?.id; }
  /** The person is in tile `p`'s edit, comment or panel (they opened it, or entered it with e or ⏎). */
  isIn(p: Pane): boolean { return p instanceof ReaderPane && this.entered.in(p); }
  /** The side of the screen tile `p` is on: its dock's edge (left or right), else which half its middle is in. */
  sideOf(p: Pane): "left" | "right" {
    const id = this.idOf(p), d = id === undefined ? null : dockOf(this.root, id);
    if (d && (d.edge === "left" || d.edge === "right")) return d.edge;
    const r = id === undefined ? undefined : this.rectsNow().get(id);
    return r && r.col + r.cols / 2 > this.area.col + this.area.cols / 2 ? "right" : "left";
  }
  /** Tile `p`'s fold, if it's folded to a spine: who folded it (an agent's id). */
  foldOf(p: Pane): { by?: string } | undefined { const id = this.idOf(p); return id === undefined ? undefined : this.collapsed.get(id); }
  /** Where tile `name` (or the container with that key) was last drawn. */
  drawnAt(name: string): Rect | undefined { const id = this.idNamed(name); return id !== undefined ? this.hits.find(([t]) => t === id)?.[1] : this.placed.nodes.get(name); }

  /**
   * Screen.keys: where the person's keys are on the desk, by tile name. They type in the focused tile while they're in
   * its edit, comment or panel, in its terminal, or in a whole screen's own edit there (takesKeys, a filter).
   */
  keys(): ScreenKeys {
    const f = this.panes.get(this.focus), via = this.readerOfFocus(), viaId = this.idOf(via);
    const name = viaId !== undefined ? this.nameOf(viaId) : f ? this.nameOf(this.focus) : null;
    const typing = !!f && (this.rawKeys() || !!this.personIn() || !!kindOf(f)?.takesKeys?.(f) || !!f.typing?.());
    const busy = this.holdsKeys();
    const why = !busy ? undefined : this.rawKeys() ? `the person is typing in ${name}, a terminal tile on the ${this.title}`
      : `the person is typing on the ${this.title}: in an edit, a comment or the property panel (or a filter, a picker, a ^W command)`;
    return { focus: name, typingIn: typing ? name : null, busy, ...(why ? { why } : {}) };
  }

  /** A key or a click runs the same action as `act`, as the person, through the dispatcher; a refusal is said, not thrown. */
  run(name: string, args: Record<string, unknown> = {}, reader?: string) { void this.dispatch.press(name, args, reader); }
  /** The note tile `sel` points at (`Pane.subject`: a reader's note, a list's selected row), the focused tile's when none is named. */
  subjectOf(sel: string | undefined): { tile: string; id: string | null } {
    const t = this.tile(sel);
    return { tile: t.name, id: this.panes.get(t.id)?.subject?.() ?? null };
  }
  /**
   * Run an action as `by`, in tile `tile` (a pane, or a name; left out, the action's own default): the person's as their
   * key does (`press`: a refusal said), an agent's as `act` (its refusal said on the status bar too, never thrown).
   */
  perform(action: string, args: Record<string, unknown>, by: Actor = USER, tile?: Pane | string): Promise<unknown> {
    const id = typeof tile === "object" ? this.idOf(tile) : undefined;
    const name = typeof tile === "string" ? tile : id !== undefined ? this.nameOf(id) : undefined;
    if (by.kind !== "agent") return this.dispatch.press(action, args, name);
    return this.dispatch.act({ action, args, ...(name !== undefined ? { tile: name } : {}) }, by).catch(e => { this.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); return undefined; });
  }
  /** ColumnsHost.within: another action run inside one (lane.collapse runs tile.collapse), its refusal thrown. */
  within(action: string, args: Record<string, unknown>, by: Actor, p?: Pane): Promise<unknown> {
    const id = this.idOf(p);
    if (p && id === undefined) return Promise.reject(new ActionRefused("that tile isn't on this screen any more"));
    return this.dispatch.act({ action, args, ...(id !== undefined ? { tile: this.nameOf(id) } : {}) }, by);
  }
  /** The tile `p`'s opens land in (its link, or its container's opens-into), if any. */
  linked(p: Pane): Pane | undefined {
    const id = this.idOf(p), to = id === undefined ? undefined : this.linkOf(id);
    return to === undefined ? (id === undefined ? undefined : this.extTarget(id)?.pane) : this.panes.get(to);
  }
  /** The actor rule for a step that moves something of the person's on the way (an open that steps the brief): why not, or null. */
  ruleFor(touches: "tile" | "screen", actor: Actor): string | null { return this.dispatch.rule(touches, actor); }
  /** The keys to tile `p`, as `tile.focus` gives them (an agent's never moves them). */
  focusPane(p: Pane, actor: Actor) { const id = this.idOf(p); if (id !== undefined) this.focusTile(this.nameOf(id), actor); }
  /** A tile's list picker over the screen (the home base's choices): on the desk's own overlay stack, first to take keys and clicks. */
  overlay(p: ListPicker<any, any>) { this.overlays.push(p); this.redraw(); }
  /** A picker is up over this screen (it has the keys). */
  overlaid(): boolean { return !!this.overlays.top(); }

  /** A tile's own key or click (its kind's set, a reader's note actions), as the person, in that tile. */
  press(p: Pane, set: ActionSet<any, any>, name: string, args: Record<string, unknown> = {}, quiet: boolean | ((why: string) => string | null) = false, given?: unknown): Promise<unknown> {
    const id = this.idOf(p);
    return this.dispatch.pressIn(set, name, args, id === undefined ? undefined : this.nameOf(id), quiet, given);
  }

  /** The reader panes with their numbers on screen (the ones `peek` shows), for a screen built on the desk. */
  readerPanes(): { name: string; pane: ReaderPane }[] { return this.namedReaders().map(({ name, pane }) => ({ name, pane })); }

  /**
   * A reader beside `pane` that follows the current note, for a screen whose own reader stays put (the
   * brief, a pinned page): the one already there, or one split off to its right. The person's focus
   * stays on `pane`; an agent's split never takes it.
   */
  readerBeside(pane: Pane, actor: Actor) {
    if (this.readerPanes().some(r => r.pane !== pane && !r.pane.holding && r.pane.follows)) return;
    // A locked screen keeps its shape: no reader is added, and it says so.
    if (this.screenLocked()) { this.ctx.flash(`the screen is locked: no reader added beside · ${UNLOCK}`); return; }
    const me = () => this.nameOf(this.idOf(pane)!);
    this.splitPane(me(), "reader", "row", actor);
    if (actor.kind !== "agent") this.focusOn(me());
  }

  /**
   * The person's keys belong to the desk right now: its search or layout picker is open, a ^W command is
   * pending, they are in (or opening) a reader's edit, comment or property panel or a step's status
   * choice, or in a terminal tile.
   * A screen built on the desk leaves its own keys to the desk then.
   */
  holdsKeys(): boolean {
    const f = this.panes.get(this.focus);
    return !!this.overlays.top() || !!this.linking || this.prefix !== "" || !!this.pending || !!this.personIn() || !!this.choosingReader() || this.rawKeys() || (!!f && !!kindOf(f)?.takesKeys?.(f)) || !!f?.typing?.()
      || [...this.models.values()].some(m => m.busy?.());
  }
  /** A hyper chord (PIE-699) is moving the keys: the edit, comment or panel the person is in is left as a click elsewhere leaves it (theirs stays open, PIE-812). False when it can't be left. */
  leaveTyping(): boolean { const w = this.personIn(); return w ? this.leaveSession(w) : true; }
  /** A reader whose step choice is open (PIE-472), wherever it is: it takes the keys (a click in a dock's preview opens one without focusing it). */
  private choosingReader(): ReaderPane | undefined { return this.namedReaders().find(r => r.pane.surface.choosing && !this.collapsed.has(r.id))?.pane; }

  /** The person is in a terminal tile (its program running, or exited and waiting for ⏎ or ctrl+]): every key is the tile's, ctrl+c included. */
  rawKeys(): boolean { return !!this.ptyIn && this.panes.get(this.focus) === this.ptyIn; }
  /** The person is in a terminal tile whose program exited: its keys wait for ⏎ (again), ^W x (closed), Esc or ctrl+]. */
  waitsOnExit(): boolean { return this.rawKeys() && !this.ptyIn!.running; }
  /** What an exited terminal tile `sel` offers: ⏎ runs it again, ^W x closes it (where it may close), ctrl+] leaves (in the drawer, Esc too). */
  exitedSay(sel: string, label = sel, back?: string): string {
    const id = this.idNamed(sel), drawer = !!this.ctx?.hostLayer?.isDrawer(this);
    return `${label} exited · ⏎ runs it again${id !== undefined && this.closesByMouse(id) ? " · ^W x closes" : ""} · ${drawer ? "Esc or " : ""}${ESCAPE_CHORD} back to ${back ?? (drawer ? "the screen" : "the door")}`;
  }
  canClose(p: Pane): boolean {
    const id = this.idOf(p);
    return id !== undefined && this.closesByMouse(id);
  }
  /** Tile `id` may close by its × (and ^W x): the layout lets it, and no container keeps it or shuts a dock instead. */
  private closesByMouse(id: number): boolean {
    return !chainOf(this.root, id).some(c => c.policy?.shuts) && !refusal(this.layout, { op: "close", tile: id }, this.layoutCtx(USER));
  }
  /** Raw input goes straight to the program while it runs (F-keys, shift-arrows, a bracketed paste): Term keeps the mouse and ctrl+]. */
  // A picker over it (the drawer's agent picker) has the keys first, as keyIn gives them: no bytes go past it.
  rawInput(): ((bytes: string) => void) | null { const p = this.ptyIn; return p && this.rawKeys() && p.running && !this.overlays.top() && !this.linking ? (s: string) => p.inputRaw(s) : null; }
  /** The last ctrl+] out of a terminal: a second one soon after sends ctrl+] to the program instead. */
  private chord: { pane: PtyPane; at: number } | null = null;

  /** Reader panes by their tile names (PIE-491: an answer names the tile, not its place). */
  private namedReaders(): { name: string; id: number; pane: ReaderPane }[] {
    return this.all().map(id => ({ name: this.nameOf(id), id, pane: this.panes.get(id)! }))
      .filter((r): r is { name: string; id: number; pane: ReaderPane } => r.pane instanceof ReaderPane);
  }

  /**
   * The reader `open` puts a note in: the tile `tile=` named (the dispatcher read the grammar: a name, an id, a number,
   * a block id it shows), which must be a reader; none named, the focused reader, else the first.
   */
  private pickReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.namedReaders();
    if (!all.length) throw new ActionRefused("the screen has no reader tile; add one (ctrl+w o r)");
    // None named: the focused reader, else the first that isn't pinned to a page (an open leaves a pinned one on its page).
    if (!sel || sel === "focused") return all.find(r => r.id === this.focus) ?? all.find(r => r.pane.followMode !== "pinned") ?? all[0]!;
    const named = all.find(r => r.name === sel);
    if (named) return named;
    const t = this.tileNamed(sel, false);
    // A tile that isn't a reader, followed by one (the board's tree, its preview): the reader that follows it, while it's on screen.
    const follower = t ? all.find(r => selectTargets(this.layout, t.id).includes(r.id)) : undefined;
    if (follower) {
      if (!this.shownNow(follower.pane)) throw new ActionRefused(`${follower.name} isn't on screen (its dock is shut); open it first (tile.slide open=true tile=${t!.name})`);
      return follower;
    }
    throw new ActionRefused(t ? `${t.name} is ${kindNoun(this.panes.get(t.id)!.kind)}, not a reader; readers: ${all.map(r => r.name).join(", ")}` : `no reader ${sel} on the desk; readers: ${all.map(r => `${r.name} (#${this.numberOf(r.id)}, ${this.tileId(r.id)})`).join(", ")}, focused, or a block id`);
  }

  /**
   * `open tile=detail|new-detail|float`: into the container the screen's opens land in (the board's readers row): the
   * tile an open lands in there now, a new one, or a new one floating. `from`: the tile it was opened from (its own
   * links open in place, if it's one opened there).
   */
  async openPlace(id: string, place: string, actor: Actor, from?: number): Promise<{ reader: string | null; id: string; why?: string }> {
    const key = this.layout.policy.opensInto;
    if (!key) throw new ActionRefused(`the ${this.title} has no ${place === "float" ? "details to float" : "detail"}; tile=<a reader> names one`);
    // The container was taken apart (its tiles moved out of it): the note opens where an open naming no tile goes, said.
    if (!node(this.root, key)) {
      const m = await readNote(this.ctx, id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      if (actor.kind === "agent") throw new ActionRefused(`not opened: the ${key} row is gone (its tiles were moved out of it) · the screen comes back whole when it's opened again`);
      const free = this.namedReaders().find(r => !r.pane.holdsKeys && this.shownNow(r.pane));
      if (free) { this.current = m; free.pane.surface.track(() => free.pane.show(m, this)); this.redraw(); }
      const reader = free?.name ?? null, why = `the ${key} row is gone (its tiles were moved out of it): opening a detail needs it · the screen comes back whole when it's opened again`;
      this.ctx.flash(why);
      return { reader, id: m.id, why };
    }
    // A note on screen already (the card the preview shows) opens at once, as the key is pressed; another is read first.
    const m = this.onScreenBlock(id) ?? await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    this.current = m;
    if (place === "float") {
      const fid = this.openNewIn(key, actor, { kind: "float", near: this.focus });
      if (fid === undefined) throw new ActionRefused("not floated");
      (this.panes.get(fid) as ReaderPane).hold(m, this);
      if (actor.kind !== "agent") this.keysTo(fid);
      this.arrived(fid, actor);
      this.redraw();
      return { reader: this.nameOf(fid), id: m.id };
    }
    const at = this.openIntoContainer(key, m, place === "new-detail", actor, from);
    this.redraw();
    // Nothing could take it (every tile there busy): why was said.
    if (at === undefined) throw new ActionRefused(this.openWhy ?? `not opened: every tile in ${key} holds an edit, a comment or properties`);
    return { reader: this.nameOf(at), id: m.id };
  }
  /** Block `id` as a tile here shows it now (the current note, a reader's), if one does. */
  private onScreenBlock(id: string): Msg | null {
    if (this.current?.id === id) return this.current;
    return [...this.panes.values()].map(p => this.showing(p)).find(m => m?.id === id) ?? null;
  }
  /** The screen's opens land in a container (its policy's `opensInto` names one): `open tile=detail|new-detail|float` are places. */
  hasPlaces(): boolean { const k = this.layout.policy.opensInto; return !!k && this.idNamed(k) === undefined; }
  /** The container the screen's opens land in (its own policy's `opensInto`, a container's key), if any. */
  private opensIntoKey(): string | undefined { const k = this.layout.policy.opensInto; return k && node(this.root, k) ? k : undefined; }

  /** `open`: the note becomes the desk's current note (unpinned readers follow) and the reader gets the keys. */
  async openIn(id: string, sel?: string, actor: Actor = USER): Promise<{ reader: string; id: string }> {
    // The reader is picked before the note is fetched: `expected=` was checked against the layout as it is
    // now, so a `#2` means this layout's second tile, not whatever moved there while the service answered.
    const r = this.pickReader(sel);
    const m = await readNote(this.ctx, id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    if (!this.all().includes(r.id) || this.panes.get(r.id) !== r.pane) throw new ActionRefused(`reader ${r.name} closed while the note was fetched; nothing was opened`);
    this.mayOpen(r.pane, actor);
    // An open into a reader is part of its history (PIE-453): back returns to what it showed.
    r.pane.surface.track(() => {
      this.setCurrent(m, { reveal: true, by: actor });
      const ok = r.pane.msg?.id === m.id || (r.pane.holding ? (r.pane.hold(m, this), r.pane.msg?.id === m.id) : r.pane.show(m, this));
      if (!ok) throw new ActionRefused(`reader ${r.name} is holding an edit or a comment on another note`);
    });
    // The person's open gives the reader the keys, unless they're in an edit, a comment, the panel or a
    // terminal: that keeps them. An agent's never moves them (Evan: agents change anything but where his cursor is).
    if (actor.kind !== "agent" && !this.personIn() && !this.rawKeys()) this.keysTo(r.id);
    this.arrived(r.id, actor);
    this.redraw();
    return { reader: r.name, id: m.id };
  }

  /** `current` as a reader shows it now: a save since it opened (a new note's first) changes its title. */
  private currentNow(): Msg | null {
    const c = this.current;
    if (!c) return null;
    // The newest any reader holds: the one that saved it has it first, before the change reaches the others.
    let best: Msg = c;
    for (const p of this.panes.values()) if (p instanceof ReaderPane && p.msg?.id === c.id && (p.msg.revision ?? -1) >= (best.revision ?? -1)) best = p.msg;
    return best;
  }

  /**
   * The note in the reader the person is in (PIE-544): a new note goes under it. A list, a lane or a terminal: none (the
   * Inbox). In a tile made for a new note (PIE-591), where that one went: a burst of ctrl+n makes siblings, not a chain.
   */
  noteContext(): string | null {
    const p = this.panes.get(this.focus), made = madeFor(p);
    if (made && p instanceof ReaderPane && p.msg?.id === made.id) return made.context;
    return p instanceof ReaderPane && p.msg ? p.msg.id : null;
  }

  /** What the spec says ctrl+n does with the keys where they are (PIE-591: the board's lanes make a card), or null. */
  newNoteRule(): NewNoteRule | null { return newNoteRule(this.spec, this.panes.get(this.focus)?.kind); }

  /** The person is typing in an edit here, nothing else open over it: ctrl+n is still a new note (PIE-591). */
  newNoteWhileTyping(): boolean {
    const p = this.focusedReader();
    return !!p && p.editing && this.entered.in(p) && !this.prefix && !this.overlays.top() && !this.choosingReader() && !this.pending;
  }

  /** DeskApi.noteGone: a new note's tile (PIE-591) whose note went to the trash unwritten closes with it. */
  noteGone(p: Pane, _id: string) {
    const id = this.idOf(p);
    if (id === undefined || !madeFor(p)) return;
    this.closeId(id);
    this.save(); this.redraw();
  }

  /**
   * A new note for the person to write (PIE-544, PIE-591): in a tile of its own where `how` says (a float over the
   * screen, a new tab on the tile they're in, their drawer), or where the focused tile's opens land (`lands`: its link,
   * the screen's readers row, the next river column, else a reader beside it); an empty reader they're in (^W o d) takes
   * it there. Its edit opens through the reader's own `edit` (the one editor and draft session) and their keys go to it.
   * From an edit, that edit stays open where it is, as a click away leaves it (PIE-812). The reader's name, or null when no reader took it.
   */
  async editNew(m: Msg, how: NewNoteHow = { opens: "lands", context: null }): Promise<string | null> {
    if (!this.all().length) {
      this.openReader(m, { kind: "edge", dir: "right" }, USER);
      const rd = this.panes.get(this.focus);
      return rd instanceof ReaderPane && await this.writeNew(rd, m) ? this.focusedName() : null;
    }
    const from = this.focusedName(), f = this.panes.get(this.focus);
    // An empty reader (^W o d) is where the person asked to write: the note opens in it.
    const empty = f instanceof ReaderPane && !f.msg && !f.surface.draft;
    const writing = this.personIn();
    if (writing && !this.leaveSession(writing)) this.entered.clear();
    if (!empty && how.opens !== "lands") {
      const made = this.openNoteTile(m, how.opens === "tab" ? "tab" : "float", USER, how.context);
      if (typeof made === "number") {
        const rd = this.panes.get(made) as ReaderPane, name = this.nameOf(made);
        // The keys left a dock (the board's outline): it shuts now, as after any key that moves them.
        this.shutLeftDocks();
        if (how.opens === "drawer") return this.writeInDrawer(rd, name, m);
        return await this.writeNew(rd, m) ? name : null;
      }
      // Nowhere for it to float (a locked screen): where the screen's opens land, said.
      this.ctx.flash(`${made} · the new note opens where this screen's opens land`);
    }
    // The note being read stays read: the new one never lands over it. A reader whose opens land nowhere else (no
    // link, no container, no flow) first gets one beside it, as O gives; a container opens a new tile (fresh).
    const into = landing(this.layout, this.focus, "open", this.facts(this.focus));
    if (f instanceof ReaderPane && f.msg && this.linkOf(this.focus) === undefined && !(into && "into" in into) && !this.inFlow(this.focus)) {
      await this.previewTile(from, undefined, USER);
    }
    // A refusal of the open is said as it is (thrown): note.new puts the empty note away.
    const at = empty ? await this.openIn(m.id, from, USER) : await this.openFrom(m.id, from, USER, true);
    const rd = at.reader ? this.pane(at.reader) : undefined;
    if (!(rd instanceof ReaderPane) || rd.msg?.id !== m.id) return null;
    this.focusOn(at.reader!);
    // The keys left a dock (the board's outline): it shuts now, as after any key that moves them.
    this.shutLeftDocks();
    // As the person's e does: the reader's `edit` action, and the person in it once it's open (esc meanwhile cancels).
    rd.surface.markNew(m.id);
    const open = await this.startSession(rd, "edit") && rd.surface.draft?.blockId === m.id;
    if (!open) rd.surface.markNew(m.id, false);
    return open ? at.reader! : null;
  }

  /**
   * An agent's new note shown here for the person (`note.new opens=`, PIE-591): a float or a tab of its own, by the
   * layout's open as the agent (which never gives it the person's keys), holding the note; no edit is opened.
   */
  async showNew(m: Msg, opens: NewNoteOpens, actor: Actor): Promise<string | null> {
    if (opens === "lands") return this.land(m, actor).reader;
    if (opens === "drawer") throw new ActionRefused("an agent's note doesn't go into the person's drawer: opens=float or tab shows it on the screen");
    const made = this.openNoteTile(m, opens, actor, null);
    if (typeof made === "string") throw new ActionRefused(`not shown: ${made}`);
    return this.nameOf(made);
  }

  /**
   * A detail tile made for new note `m` (PIE-591), holding it: a float over the screen, cascaded from the last (the
   * layout's float rule), or a new tab on the focused tile (a float, or a tile whose tabs refuse it: a float). One
   * layout `open`, as `actor`; its id, or the layout's refusal in its words and nothing made.
   */
  private openNoteTile(m: Msg, opens: "float" | "tab", actor: Actor, context: string | null): number | string {
    const tryAt = (at: At<number>) => this.ask({ op: "open", tile: this.nextId, kind: "reader", name: this.autoName("note"), loose: true, at }, actor);
    const base = this.focus;
    let r = opens === "tab" && !this.isFloat(base) && visible(this.root).includes(base) ? tryAt({ kind: "tabs", target: base }) : null;
    if (r && !r.ok && actor.kind !== "agent") this.ctx.flash(`not a tab here (${r.refused}): it floats instead`);
    if (!r?.ok) r = tryAt({ kind: "float" });
    if (!r.ok) return r.refused;
    const pane = makeTile({ kind: "reader", mode: "held" }) as ReaderPane;
    pane.label = "new note";
    const id = this.put(pane);
    this.commit(r);
    this.startTile(id);
    pane.hold(m, this);
    this.arrived(id, actor);
    // The tile knows what it was made for, wherever it goes (the drawer, another screen): its note and where it went.
    pane.newNote = { id: m.id, context };
    this.save(); this.redraw();
    return id;
  }

  /**
   * The edit on a new note's reader, opened whether or not the person's keys are still there (a burst of ctrl+n:
   * each note gets its edit, the keys stay on the newest); the person is in it when they are.
   */
  private async writeNew(rd: ReaderPane, m: Msg, desk: Desk = this): Promise<boolean> {
    const ok = await rd.surface.editNew(m, rd.host(desk));
    if (ok && desk.focusedReader() === rd) desk.entered.enter(rd);
    desk.redraw();
    return ok;
  }

  /** The new note's tile into the person's drawer (PIE-591, opens=drawer), the drawer up on it with their keys, its edit open. */
  private async writeInDrawer(rd: ReaderPane, name: string, m: Msg): Promise<string | null> {
    const host = this.ctx?.hostLayer;
    if (host && !host.isDrawer(this)) {
      try {
        host.put(this, name, USER, true);
        const d = host.desks().find(x => host.isDrawer(x));
        if (d) { const ok = await this.writeNew(rd, m, d); return ok ? d.nameOfPane(rd) : null; }
      } catch (e) { this.ctx.flash(`not in your drawer (${e instanceof Error ? e.message : String(e)}): it floats here`, undefined, errorDetails(e)); }
    }
    return await this.writeNew(rd, m) ? name : null;
  }

  focusOn(sel: string): { focus: string } {
    const r = this.pickReader(sel);
    // Coming back to a session by moving to it: e or ⏎ enters it again. Focusing the reader the person
    // is already in moves nothing, so they stay in it.
    if (r.id !== this.focus) this.entered.clear();
    this.keysTo(r.id);
    this.reenter();
    this.redraw();
    return { focus: r.name };
  }

  /** The keys are back on a reader holding the person's own edit or comment, left open when they went elsewhere: they're in it again, as it was (PIE-785, PIE-812). */
  private reenter() {
    const back = this.focusedReader();
    if (back && !this.entered.in(back) && back.surface.keepsOnFocusAway() && !this.prefix && !this.overlays.top()) this.entered.enter(back);
  }

  unsaved() { return this.drafts().length > 0 || [...this.models.values()].some(m => m.unsaved?.()); }
  /** A reader's history changed, or the door is handing over: the layout is saved with it (PIE-643). */
  keepLayout() { this.save(); }
  layoutUndoSeq(): number | undefined { return this.history.newest()?.seq; }
  keepPlace() { this.save(); }
  keepDrafts() { return [...this.drafts().flatMap(p => p.keepDrafts?.() ?? []), ...[...this.models.values()].flatMap(m => m.keepDrafts?.() ?? [])]; }
  /** The edits open here, by tile: what a session's next daemon opens again (src/session/restore.ts). */
  reopen(): (Step & { tile: string })[] {
    // The note first (a reader that comes back shows what its layout says), then its edit or comment (PIE-847).
    const steps = [...this.panes].flatMap(([id, p]): (Step & { tile: string })[] => {
      if (!(p instanceof ReaderPane) || !p.msg) return [];
      const opening = p.surface.reopenSteps();
      // A comment in its own tile comes back on the side of its note it was on (PIE-846).
      const side = this.commentSideOf(id);
      const sided = opening.map(s => (s.action === "comment.place" && s.args?.place === "tile" && side ? { ...s, args: { ...s.args, side } } : s));
      return sided.length ? [{ action: "open", tile: this.nameOf(id), args: { id: p.msg.id } }, ...sided.map(s => ({ ...s, tile: this.nameOf(id) }))] : [];
    });
    // Opening one gives it the keys: they go back to the tile that had them (the tune inspector beside a comment). A
    // comment's own tile isn't kept: the comment opening in it again gives it the keys (PIE-846).
    const at = this.nameOf(this.focus);
    return steps.length && steps.at(-1)!.tile !== at && !(this.panes.get(this.focus) instanceof AttachedTilePane) ? [...steps, { action: "tile.focus", tile: at }] : steps;
  }
  /** ctrl+e editors still open when the door ends: their files copied to drafts/ (keepEditFile). */
  keepEdits() { return [...this.panes.values()].flatMap(p => p instanceof PtyPane && p.run.temp && p.run.file ? [keepEditFile(p.run.file)].filter((x): x is string => !!x) : []); }
  private drafts() { return [...this.panes.values()].filter(p => p.unsaved?.()); }
  /** Quitting the door ends the desk's programs: said first, and asked twice (App). Leaving the desk doesn't. */
  leaveWarning(): string | null {
    // An agent attached from Herdr keeps running in its pane when the door quits: nothing of it ends here.
    const r = this.running().filter(p => !p.herdr);
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "is" : "are"} running in a tile · quitting ends ${r.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  describe(): Record<string, unknown> {
    const order = this.all();
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: prop(m, "work-id") ?? prop(m, "ticket") } : {});
    // What its tiles' kinds say about the screen (the welcome's notes, the brief's day) beside the tiles.
    const peeks = Object.assign({}, ...order.map(id => { const p = this.panes.get(id)!; return kindOf(p)?.peek?.(p, this) ?? {}; }), ...[...this.models.values()].map(m => m.peek?.() ?? {}));
    return {
      // Before the desk's own fields, so a kind never overwrites them.
      ...peeks,
      hints: this.hintsList(),
      kind: this.spec.name, current: this.current ? { id: this.current.id, title: subject(this.currentNow()!) } : null, zoom: this.zoom,
      // Where the keys are, as a place: a columns container by its key (the board's lanes), else the tile.
      focus: this.focusPlace(),
      // The tiles opened into the container the screen's opens land in (the board's details), and the one they land in now.
      ...(this.opensIntoKey() ? { details: this.openedTiles(this.opensIntoKey()!).filter(id => !this.isFloat(id)).map(id => ({ ...brief(this.showing(this.panes.get(id)!)), reader: this.nameOf(id), opensHere: id === this.activeIn(this.opensIntoKey()!) })) } : {}),
      // What an agent may do to the screen's tiles (PIE-639): the screen's default, and each tile it limits, so it reads its limits before acting.
      ...(this.layout.policy.agents ? { agentsDefault: this.layout.policy.agents } : {}),
      ...(order.some(id => this.agentOf(id).level !== "free") ? { agentLimits: order.filter(id => this.agentOf(id).level !== "free").map(id => ({ tile: this.nameOf(id), id: this.tileId(id), level: this.agentOf(id).level, by: this.agentOf(id).by })) } : {}),
      layoutName: this.layoutName, rule: this.rule, focusName: this.nameOf(this.focus), inTerminal: this.rawKeys() ? this.nameOf(this.focus) : null,
      linking: this.linking ? this.linking.desk.nameOf(this.linking.from) : null,
      dragging: this.dragging ? { tile: this.nameOf(this.dragging.src), drop: this.dragging.drop ? dropView(this.dragging.drop, id => this.nameOf(id)) : null } : null,
      layout: describeLayout(this.layout, id => String(order.indexOf(id) + 1)),
      tree: describeLayout(this.layout, id => this.nameOf(id)),
      floats: this.floats.map(f => { const p = this.panes.get(f.id)!; return { ...brief(this.showing(p)), tile: this.nameOf(f.id), rect: this.floatRect(f), ...(madeFor(p) ? { newNote: true, writing: p instanceof ReaderPane && !!p.surface.drafting } : {}) }; }),
      // Every reader holding a note, as its surface says it, and whether it's folded (with comments since).
      collapsedReaders: this.namedReaders().filter(r => this.collapsed.has(r.id)).map(r => r.name),
      readers: this.namedReaders().filter(r => r.pane.msg).map(r => { const c = this.collapsed.get(r.id); return { name: r.name, focused: r.id === this.focus, ...r.pane.describe(), ...(c ? { collapsed: true, ...(c.by ? { collapsedBy: c.by } : {}), newComments: r.pane.newComments() } : { collapsed: false }) }; }),
      panes: order.map((id, i) => this.tileView(id, i + 1)),
    };
  }

  /** Where the keys are, as a place: the key of a columns container they're in (the board's `lanes`), else the tile's name. */
  private focusPlace(): string {
    const c = chainOf(this.root, this.focus).find((x): x is Columns<number> => x.t === "columns" && !!x.key);
    return c?.key ?? this.nameOf(this.focus);
  }

  private tileView(id: number, n = this.numberOf(id)) {
    const p = this.panes.get(id)!; const r = this.placed.rects.get(id) ?? this.hits.find(([x]) => x === id)?.[1];
    const set = tabsOf(this.root, id);
    const link = wireTarget(this.layout, id), into = this.linkOf(id);
    const m = this.showing(p);
    return {
      n, name: this.nameOf(id), id: this.tileId(id), kind: p.kind, ...(this.unregistered.has(id) ? { unregistered: this.unregistered.get(id)!.kind } : {}), focused: id === this.focus, rect: r, shown: visible(this.root).includes(id) || this.isFloat(id),
      ...(this.isFloat(id) ? { float: true } : {}), ...(this.collapsed.has(id) ? { collapsed: true, ...(this.collapsed.get(id)!.dir === "h" ? { collapsedDir: "h" } : {}), ...(this.collapsed.get(id)!.by ? { collapsedBy: this.collapsed.get(id)!.by } : {}) } : {}),
      ...(this.cover(id) ? { cover: this.cover(id) } : {}),
      ...(this.arriving(id) ? { arrival: { by: this.arrivals.get(id)!.by } } : {}),
      ...this.pickView(id),
      ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), tabShown: this.nameOf(set.ids[set.active]!) } : {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link), ...this.linkView(id) } : into !== undefined ? { link: this.nameOf(into), ...this.linkView(id) } : this.extView(id)),
      ...this.linkView(id),
      ...(this.chainWords(id).trim() ? { chain: this.chainWords(id).trim() } : {}),
      ...this.dockView(id),
      ...this.policyView(id),
      ...(kindOf(p)?.describe?.(p, true) ?? {}),
      ...(kindOf(p)?.follower && !(p instanceof PreviewPane && "file" in p.source) && (this.selectSeeds.has(id) || this.followsOf(id).source !== undefined) ? { source: `tile:${this.selectSeeds.get(id) ?? this.nameOf(this.followsOf(id).source!)}` } : {}),
      title: this.frameTitle(id, r?.rows),
      label: this.displayTitle(id),
      showing: m ? { id: m.id, title: subject(m) } : undefined,
      agent: p instanceof ReaderPane ? p.surface.agent ?? undefined : undefined,
      editing: p instanceof ReaderPane && p.draft ? { id: p.draft.blockId, dirty: p.draft.dirty, changedElsewhere: p.draft.changedElsewhere, conflict: p.draft.conflict } : undefined,
      commenting: p instanceof ReaderPane && p.session ? p.session.describe() : undefined,
      threadPanel: p instanceof ReaderPane ? p.surface.replyLinks?.describe() : undefined,
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    if (!this.ctx) this.enter(ctx);
    const { cols, rows } = ctx.t;
    this.noteFocus();
    for (const m of this.models.values()) m.frame?.();
    // Each tile opened into a container says which it is, whether ⏎ opens there (two or more), and if it floats.
    for (const key of this.opened.keys()) {
      const ids = this.openedTiles(key), pinned = ids.filter(i => !this.isFloat(i)), a = this.activeIn(key);
      for (const id of ids) { const p = this.panes.get(id); if (p instanceof ReaderPane) { p.floating = this.isFloat(id); p.opensHere = pinned.length > 1 && id === a; } }
    }
    // A new note's tile (PIE-591) floating says what it holds, as a float opened into a container does.
    for (const [id, p] of this.panes) if (madeFor(p)) (p as ReaderPane).floating = this.isFloat(id);
    // An empty reader says where its notes come from: the tiles whose opens land in it.
    const into = new Map<number, string[]>();
    for (const id of this.all()) { const to = this.linkOf(id); if (to !== undefined && to !== id) into.set(to, [...(into.get(to) ?? []), this.nameOf(id)]); }
    for (const [id, p] of this.panes) if (p instanceof ReaderPane) p.landsFrom = into.get(id) ?? [];
    // A preview following a list that quotes its selection (the backlinks: where the source mentions the note) says it.
    for (const [id, p] of this.panes) if (p instanceof PreviewPane && "tile" in p.source) { const source = this.followsOf(id).source; const src = (source === undefined ? this.pane(p.source.tile) : this.panes.get(source)) as { snippet?(): string } | undefined; p.quote = src?.snippet && this.shownNow(p) ? src.snippet() : ""; }
    const canvas = new Canvas(cols, rows - 1);
    // A view built on the desk may keep rows above the tiles for its own art (the welcome's logo band).
    const band = this.band();
    const top = band ? Math.max(0, Math.min(rows - 6, band.kind.rows(band.pane, cols, rows, this))) : 0;
    this.bandTop = top;
    const area: Rect = { col: 0, row: top, cols, rows: rows - 2 - top };
    this.area = area;
    this.slid = [];
    const zoomed = this.zoom !== null && this.panes.has(this.zoom);
    if (zoomed) {
      this.placed = { rects: new Map([[this.zoom!, area]]), nodes: new Map(), dividers: [] };
      this.dividers = [];
    } else {
      // The tree, the docks that slide over it (PIE-505: containers, each from its edge), bottom first.
      const ps = placeLayout(this.layout, area, this.holds);
      this.placed = ps;
      // The dock with the keys is on top of the others sliding out.
      this.slid = [...ps.slid].sort((a, b) => Number(leaves(a.node.kid).includes(this.focus)) - Number(leaves(b.node.kid).includes(this.focus)));
      // A dock's own border (and those inside it) are over the layout's: grabbed first.
      this.dividers = [...this.slid.flatMap(d => [...(d.divider ? [d.divider] : []), ...d.placed.dividers]).reverse(), ...ps.dividers];
    }
    const pinned = [...this.placed.rects];
    // The keys never stay on a tile the room left no cells (a terminal made tiny): the largest tile shown takes them.
    const fr = this.slid.find(d => d.placed.rects.has(this.focus))?.placed.rects.get(this.focus) ?? this.placed.rects.get(this.focus);
    if (fr && (fr.cols <= 0 || fr.rows <= 0) && !this.holdsKeys()) {
      const best = [...this.slid.flatMap(d => [...d.placed.rects]), ...pinned].filter(([, r]) => r.cols > 0 && r.rows > 0).sort(([, a], [, b]) => b.cols * b.rows - a.cols * a.rows)[0];
      if (best) this.focus = best[0];
    }
    // Floats over everything (PIE-511): drawn on the screen as it is now, the last on top.
    const floats = zoomed ? [] : this.floats.map(f => [f.id, keepOnScreen(f.rect, area)] as [number, Rect]);
    this.pickReflows([...pinned, ...this.slid.flatMap(d => [...d.placed.rects]), ...floats]);
    // For the mouse: the top float first, then the top dock's tiles, then the layout's.
    this.hits = [...[...floats].reverse(), ...[...this.slid].reverse().flatMap(d => [...d.placed.rects]), ...pinned];
    // Motion (PIE-958): a change just made begins from where the tiles were; the tiles that move are drawn in flight, on top.
    if (this.pendingMotion) {
      const t = new Transition(this.pendingMotion.from, new Map(this.hits), this.clock(), this.pendingMotion.plan, this.pendingMotion.floated);
      this.pendingMotion = null;
      if (t.moves) this.transition = t;
    }
    const flying = this.transition && !this.transition.done(this.clock()) ? this.transition : null;
    if (this.transition && !flying) this.transition = null;
    const ghosts: [number, Rect][] = [];
    this.tileSpots = [];
    this.pointerHits = [];
    this.heads = []; this.markHits = []; this.spines = []; this.dockLabels = []; this.agentChips = []; this.dockCloses = []; this.floatButtons = []; this.foldButtons = []; this.holdButtons = []; this.closeButtons = []; this.wireChips = []; this.menuButtons = []; this.headPresses = []; this.headCtl.clear();
    let placements: Placement[] = top && band ? band.kind.draw(band.pane, canvas, { col: 0, row: 0, cols, rows: top }, this) : [];
    // A tile drawn over another (a flow's column over a peek's box, a dock, a float) takes away the images under it;
    // drawTile paints every cell of its box.
    const lay = (id: number, r: Rect, dock = false, float = false) => {
      const at = flying ? flying.at(id, this.clock(), area) : "settled";
      if (at !== "settled") { ghosts.push([id, at]); return; }
      const box = this.boxOf(id, r);
      placements = uncover(placements, box);
      this.tileSpots = this.tileSpots.filter(s => !overlaps({ col: s.from, row: s.y, cols: s.to - s.from, rows: 1 }, box));
      placements.push(...this.drawTile(canvas, id, r, dock, float));
    };
    for (const [id, r] of pinned) lay(id, r);
    for (const d of this.slid) {
      canvas.clear(d.rect, bg(C.black));
      placements = uncover(placements, d.rect);
      this.tileSpots = this.tileSpots.filter(s => !overlaps({ col: s.from, row: s.y, cols: s.to - s.from, rows: 1 }, d.rect));
      for (const [id, r] of d.placed.rects) lay(id, r, true);
    }
    for (const [id, r] of floats) {
      const shade: Rect = { ...r, cols: r.cols + 1, rows: r.rows + 1 };
      placements = placements.filter(p => !overlaps(p, shade));
      const values = this.lookAt(this.panes.get(id)!, r.cols).values;
      if (id === this.focus && this.keysHere()) canvas.backdrop(values);
      canvas.shadow(r, values);
      lay(id, r, false, true);
      canvas.under(r, bgRgb(floatTheme(values).bg));
      canvas.text(r.col + r.cols - 1, r.row + r.rows - 1, fg(C.yellow) + "◢" + RESET, 1);
    }
    // In flight, a tile is drawn as it is, at the rectangle it is in (its contents move with it: nothing goes dark and comes
    // back, so nothing pulses), on top of the rest; its pictures are taken away until it lands, so nothing bright slides over
    // text (src/motion.ts). They land where the layout puts them.
    // (A tile that was floating, or is, stays above the ones that were not: the floats were over the layout and still are.)
    const above = (id: number) => (flying?.floated.has(id) || this.isFloat(id) ? 1 : 0);
    for (const [id, r] of [...ghosts].sort((a, b) => above(a[0]) - above(b[0]))) {
      placements = uncover(placements, r);
      this.drawTile(canvas, id, r, false, this.isFloat(id));
    }
    if (this.linking?.desk === this) {
      const { from, verb } = this.linking;
      const source = this.hits.find(([id]) => id === from)?.[1];
      for (const wire of this.layout.wires.filter(w => w.from === from && w.verb === verb)) {
        const target = this.hits.find(([id]) => id === wire.to)?.[1];
        if (!source || !target || wire.to === from) continue;
        const right = target.col >= source.col + source.cols;
        const left = source.col >= target.col + target.cols;
        if (right || left) {
          const x0 = right ? source.col + source.cols - 1 : target.col + target.cols - 1;
          const x1 = right ? target.col : source.col;
          const y = Math.max(source.row, target.row) + 1;
          if (y < Math.min(source.row + source.rows, target.row + target.rows)) canvas.text(x0, y, fg(C.lmagenta) + (right ? "─".repeat(x1 - x0) + "►" : "◄" + "─".repeat(x1 - x0)) + RESET, x1 - x0 + 1);
        } else {
          const upper = source.row < target.row ? source : target, lower = source.row < target.row ? target : source;
          const x = Math.max(source.col, target.col) + 1;
          if (x < Math.min(source.col + source.cols, target.col + target.cols)) for (let y = upper.row + upper.rows - 1; y <= lower.row; y++) canvas.text(x, y, fg(C.lmagenta) + (source === upper && y === lower.row ? "▼" : source === lower && y === upper.row + upper.rows - 1 ? "▲" : "│") + RESET, 1);
        }
      }
    }
    this.drawEmpty(canvas);
    for (const m of this.models.values()) if (m.drawOver?.(canvas, area)) placements = [];
    if (this.dragging) this.drawGhost(canvas, this.dragging.drawer ? null : this.dragging.drop, this.nameOf(this.dragging.src), this.dragging.x, this.dragging.y, this.dragging.drawer ?? undefined);
    else if (this.foreign) this.drawGhost(canvas, this.foreign.drop, this.foreign.name, this.foreign.x, this.foreign.y);
    else if (this.floatDrag?.drop) this.drawGhost(canvas, this.floatDrag.drop, this.nameOf(this.floatDrag.id), this.floatDrag.x ?? 0, this.floatDrag.y ?? 0);
    this.syncModeHint();
    for (const card of this.hintCards()) {
      const id = card.anchor, anchor = this.hits.find(([i]) => i === id)?.[1];
      if (!anchor || id === undefined) continue;
      const look = this.lookAt(this.panes.get(id)!, anchor.cols).values;
      if (hintSetting(card.id, look.hints) !== "card") { card.clearHits(); continue; }
      const rect = card.draw(canvas, anchor, area, look.hints === "brief", this.hintPointer, TONE[look.tone], look);
      placements = uncover(placements, rect);
    }
    this.completionFloat = null;
    const completion = this.views.get(this.focus)?.view.completion;
    const origin = this.contents.get(this.focus);
    if (completion?.shown && completion.drawn && origin) {
      const height = Math.min(Math.floor(origin.rows / 2), area.rows);
      const cursor = { col: origin.col, row: origin.row + completion.drawn.row - 1, cols: origin.cols, rows: 1 };
      const rect = keepOnScreen({ col: area.col, row: cursor.row + 1, cols: area.cols, rows: height }, area, cursor);
      completion.drawn.row = rect.row - origin.row;
      const lines = withRowLimit(this.lookAt(this.panes.get(this.focus)!, rect.cols).values["rows.lines"], () => completion.inFrame(rect.cols, rect.col - origin.col, height, this.lookAt(this.panes.get(this.focus)!, rect.cols).values));
      canvas.backdrop(this.lookAt(this.panes.get(this.focus)!, rect.cols).values);
      canvas.clear(rect);
      lines.forEach((line, i) => canvas.text(rect.col, rect.row + i, line, rect.cols));
      this.completionFloat = { completer: completion, rect, origin };
      placements = uncover(placements, rect);
    }
    // Images would bleed through an overlay.
    for (const o of [...this.overlays.all()].reverse()) {
      const p = this.focusedPane(), values = p ? this.lookAt(p, cols).values : lookFor(this.lookSrc, { screen: this.name }, cols).values;
      withRowLimit(values["rows.lines"], () => o.draw(canvas, { col: 0, row: 0, cols, rows: rows - 2 }, values));
      placements = [];
    }
    const hint = this.hints(cols);
    if (!this.hintFull) this.hintMoreOpen = false;            // the row fits again: nothing is left to show
    if (this.hintBox || (this.hintFull && (this.hintMoreOpen || this.prefix))) { this.drawHintMore(canvas, cols, rows); placements = []; }
    canvas.text(0, rows - 2, hint, cols);
    return { lines: canvas.lines(), placements };
  }

  /**
   * Each tile's view as last drawn: the size it was drawn at, how long it took, and the frame it was drawn in. While a
   * resize goes on (src/resize.ts), a tile whose size changed keeps showing this one (cut or padded to its box) when
   * the frame has no time left to lay it out again (pickReflows).
   */
  private views = new Map<number, { cols: number; rows: number; view: PaneView; ms: number; frame: number; at: number }>();
  private frameNo = 0;
  /** The tiles this frame lays out again though a resize is going on; null: every tile, as always. */
  private reflows: Set<number> | null = null;
  private readerGutter(pane: Pane | undefined, cols: number): number {
    return pane instanceof ReaderPane ? Math.min(pane.surface.gutterWidth(), 3 * Math.floor(Math.max(0, cols - 8) / 3)) : 0;
  }
  /**
   * While a resize goes on, the tiles whose size changed are laid out again as the frame has time for: the one
   * waiting longest first, each counted at what it took last time, up to REFLOW_MS (at least one a frame). The rest
   * keep their last view a frame or two: a drag reflows live without laying out every tile it touches on every
   * report (PIE-623). The frame after it ends lays out every tile.
   */
  private pickReflows(placed: [number, Rect][]) {
    this.frameNo++;
    for (const id of this.views.keys()) if (!this.panes.has(id)) this.views.delete(id);
    if (!inResize()) { this.reflows = null; return; }
    const stale = placed.flatMap(([id, r0]) => {
      const r = this.boxOf(id, r0), last = this.views.get(id);
      const p = this.panes.get(id), look = p && this.looks.get(p);
      const gutter = this.readerGutter(p, r.cols - 2);
      const c = contentRect({ col: gutter, row: 0, cols: r.cols - 2 - gutter, rows: r.rows - 2 }, look, !!p?.measured, p?.beside?.() ?? 0);
      return last && (last.cols !== c.cols || last.rows !== c.rows) ? [{ id, last }] : [];
    }).sort((a, b) => a.last.frame - b.last.frame);
    this.reflows = new Set();
    let spent = 0;
    for (const { id, last } of stale) {
      if (this.reflows.size && spent + last.ms > REFLOW_MS) continue;
      this.reflows.add(id); spent += last.ms;
    }
    // A tile whose size didn't change is drawn again once its view is REDRAW_MS old (a terminal's output, an image
    // arriving): a frame of the drag lays out only what it moved.
    const now = performance.now();
    for (const [id] of placed) if (!stale.some(s => s.id === id) && now - (this.views.get(id)?.at ?? 0) >= REDRAW_MS) this.reflows.add(id);
  }

  /** Tile `id`'s view at `inner`'s size, or its last one while a resize has no time for it (pickReflows). */
  private drawn(id: number, pane: Pane, inner: Rect, focused: boolean, typing: boolean): PaneView {
    const last = this.views.get(id);
    if (last && this.reflows && !this.reflows.has(id)) return last.view;
    const t0 = performance.now();
    const view = withRowLimit(this.looks.get(pane)?.values["rows.lines"] ?? 2, () => pane.render(inner.cols, inner.rows, focused, this, typing));
    const at = performance.now();
    this.views.set(id, { cols: inner.cols, rows: inner.rows, view, ms: at - t0, frame: this.frameNo, at });
    return view;
  }

  /** Where tile `id`, placed at `r0`, is drawn: a flow's peek in its whole box (its right side under its neighbour), else `r0`. */
  private boxOf(id: number, r0: Rect): Rect {
    if (this.cover(id) !== "peek") return r0;
    return this.placed.boxes?.get(id) ?? this.slid.find(d => d.placed.boxes?.has(id))?.placed.boxes?.get(id) ?? r0;
  }

  /** A float's rectangle as drawn: kept on the screen as it is now (its own stays as it was put, for a larger screen). */
  private floatRect(f: Float<number>): Rect { return keepOnScreen(f.rect, this.area); }
  /** A tile holding work (a draft, a running program): its flow column resists compression. */
  private readonly holds = (id: number) => { const p = this.panes.get(id); return !!p && this.holdsWork(p); };
  /**
   * What the containers say when there's nothing in them: an empty columns container its model's status (no lanes
   * yet: looking for boards), and a row whose every tile is folded how to open one.
   */
  private readonly homeSurface = new HomeSurface();
  private drawEmpty(canvas: Canvas) {
    if (!this.all().length) {
      this.homeSurface.render(this.title, this.area.cols - 4, this.area.rows - 2).forEach((line, i) => canvas.text(this.area.col + 2, this.area.row + 1 + i, line, this.area.cols - 4));
    }
    for (const c of this.columnsIn()) {
      const at = c.key ? this.placed.nodes.get(c.key) : undefined, say = c.id ? this.models.get(c.id)?.empty?.() : null;
      if (!at || !say || leaves(c).length || at.cols <= 4 || at.rows <= 2) continue;
      canvas.box(at, fg(C.blue), fg(C.grey) + (this.title.split(" · ")[1] ?? this.title));
      canvas.text(at.col + 2, at.row + 1, fg(C.dark) + say + RESET, at.cols - 4);
      // Nothing to show: a note to write, offered (an empty outline has no board yet).
      if (at.rows > 4) {
        const { line, spot } = newNoteOffer(at.row + 3);
        canvas.text(at.col + 2, spot.row, line, at.cols - 4);
        this.tileSpots.push({ y: spot.row, from: at.col + 2, to: at.col + 2 + Math.min(spot.to, at.cols - 4), key: spot.key });
      }
    }
    for (const [key, at] of this.placed.nodes) {
      const n = node(this.root, key);
      const ids = n && isLine(n) && n.dir === "row" ? leaves(n) : [];
      if (ids.length < 2 || !ids.every(id => this.collapsed.has(id))) continue;
      const x = at.col + ids.length * 3;
      canvas.text(x + 1, at.row + 1, fg(C.dark) + "every tile here is folded to a spine · ⏎ or a click on a spine opens one" + RESET, Math.max(0, at.col + at.cols - x - 2));
    }
  }
  /** The desk's own overlay is open (its search, the layout picker, the policy panel): it takes every key and click. */
  private overlayOpen(): boolean { return !!this.overlays.top(); }

  /**
   * The screen's key map (its spec's `keys`): a key there runs its action as the person, before the focused tile's own
   * keys, unless the person is typing (an edit, a filter, a picker, a ^W chord, a terminal) or picking a tile to link.
   */
  private boundKey(k: Key): boolean {
    const keys = this.spec.keys;
    if (!keys?.length || k.kind === "mouse" || this.holdsKeys() || this.linking) return false;
    const name = keyName(k);
    const b = name === null ? undefined : this.screenKeys().find(x => x.key === name);
    if (!b) return false;
    const tile = b.tile === undefined ? undefined : this.specTile(b.tile);
    void this.dispatch.pressBinding(tile === undefined ? b : { ...b, tile: this.tileId(tile) });
    return true;
  }

  private screenKeys() {
    const kind = this.focusedKind();
    return (this.spec.keys ?? []).filter(x => !(kind && x.unless?.includes(kind)) && (!x.only || (!!kind && x.only.includes(kind))));
  }

  private screenKeyHint(): string {
    const pane = this.panes.get(this.focus);
    if (this.holdsKeys() || (pane instanceof ReaderPane && pane.surface.contextualHint() !== null)) return "";
    return modeHint(this.screenKeys().flatMap(row => {
      const def = this.dispatch.defOf(row.action)!;
      const menu = def.menu ? (Array.isArray(def.menu) ? def.menu[0] : def.menu) : undefined;
      const label = row.label ?? menu?.label;
      return label === undefined ? [] : [{ ...row, label }];
    }), action => this.dispatch.defOf(action));
  }

  /** The band across the top (the spec's `band`: a tile whose kind draws it), if the screen has one. */
  private band(): { pane: Pane; kind: NonNullable<TileKind["band"]> } | null {
    const id = this.spec.band ? this.specTile(this.spec.band) : undefined;
    const pane = id !== undefined ? this.panes.get(id) : undefined, kind = pane ? kindOf(pane)?.band : undefined;
    return pane && kind ? { pane, kind } : null;
  }
  /** The rows the band took as last drawn: a press above them is the band's. */
  private bandTop = 0;

  /** The person's keys are on this desk (a screen's: not in your drawer, nor elsewhere in a frame around it; the drawer's: in it): its focused tile has them. */
  private keysHere(): boolean {
    const w = this.ctx?.person?.();
    if (!w) return true;
    // Your drawer's desk has them while the person is in it (`keys: host`); a screen's, while they're on it.
    return this.ctx?.hostLayer?.isDrawer(this) ? w.keys === "host" : w.keys === "screen" && w.focus !== null;
  }

  /** One tile: its frame, its header (its name, or its tab set's tabs), its body, its placements. */
  private drawTile(canvas: Canvas, id: number, r0: Rect, dock = false, float = false): Placement[] {
    const pane = this.panes.get(id)!;
    const focused = id === this.focus;
    // A flow's column squeezed to a spine, or a tile folded to one; a peek is drawn whole in its box, its right
    // side under its neighbour (drawn after it), like a dock (PIE-513).
    const cover = this.cover(id);
    const fold = this.collapsed.get(id);
    if (fold?.dir === "h" ? r0.rows <= 1 : (fold || cover === "spine") && r0.cols <= SPINE) return this.drawSpineTile(canvas, id, r0, focused);
    const r = this.boxOf(id, r0);
    // Every cell of the box is the tile's: rows its view leaves short show nothing of a tile drawn under it (a dock's
    // or a float's on the black it slides over).
    const framed: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
    const look = this.lookAt(pane, framed.cols), lv = look.values;
    // Joined (PIE-886): no frame, a tinted pane that reads as part of the tile it follows, as the admin tree's preview does.
    // `border=joined` asks for it; a preview of a tree has it unless its look says another border.
    const joined = !dock && !float && (lv.border === "joined" || (lv.border === "auto" && this.joinedByDefault(id)));
    // Its surface (PIE-675, the look's `bg`): under its content, inside its frame; a dock or a float slides over on it.
    // A joined tile's tint runs to its edges, with no frame to stop at (dark, capped as every surface is).
    const surface = lv.bg !== "none" ? surfaceBg(lv.bg, lv["bg.strength"]) : joined ? surfaceBg("raised", lv["bg.strength"]) : "";
    canvas.clear(r, float ? "" : dock ? surface || bg(C.black) : "");
    this.looks.set(pane, look);
    const reader = pane instanceof ReaderPane ? pane : null;
    const gutter = this.readerGutter(pane, framed.cols);
    if (reader) reader.gutterCols = gutter;
    const inner = contentRect({ ...framed, col: framed.col + gutter, cols: framed.cols - gutter }, look, !!pane.measured, pane.beside?.() ?? 0);
    if (gutter) this.gutters.set(id, { col: framed.col, row: inner.row, cols: gutter, rows: inner.rows });
    else this.gutters.delete(id);
    if (reader) reader.innerFrame = { col: framed.col - inner.col, row: framed.row - inner.row, cols: framed.cols, rows: framed.rows };
    if (reader) reader.heroBounds = { col: framed.col - inner.col, row: framed.row - inner.row, cols: framed.cols };
    this.contents.set(id, inner);
    const typing = pane === this.ptyIn && focused;
    // The header first: a tile that puts controls on it (the backlinks' status) draws its body knowing it did.
    // The person's keys are in this tile (it's focused and they're on this desk): its frame and name wear the focus accent.
    const keys = focused && this.cover(id) !== "peek" && this.keysHere();
    // A refusal of the person's key or click (PIE-727) is said here, on the tile they're looking at, over its hint: in
    // the warning tone (amber), and loud (on its capped-dark amber surface, bold, the frame amber too) when the same key
    // was refused again. A tile with a screen of its own in it (a group) leaves it to that screen's focused tile.
    const no = keys && !pane.nestsTiles?.() ? this.ctx?.refusal?.() ?? null : null;
    // The controls on its top right corner (× ⧉ ⋯, drawn after the frame): where they start, so the title ends before them.
    const closes = !dock && cover === undefined && r.cols >= 10 && this.closesByMouse(id);
    const floats = focused && !float && !dock && cover === undefined && r.cols >= 12 && leaves(this.root).length > 1 && !this.ctx?.hostLayer?.isDrawer(this) && !refusal(this.layout, { op: "float", tile: id }, this.layoutCtx(USER));
    const floatX = r.col + r.cols - (closes ? 4 : 3), menuX = (floats ? floatX : closes ? r.col + r.cols - 2 : r.col + r.cols - 1) - 2;
    const menus = cover === undefined && r.cols >= 14;
    // The fold glyph, left of the ⋯ where the tile can fold to a spine: ◂ to a vertical one (tiles side by side), ▾ to a
    // horizontal one (stacked); a click folds it, alt+click folds it the other way (tile.collapse, as alt+h and alt+H).
    const foldDir = menus && !float && r.cols >= 20 ? this.foldDirOf(id) : null;
    const foldX = menuX - 2;
    // A list that can be held off its home (a #tag's list, PIE-855): ○, or ● while held, left of those; a click is tile.hold.
    const holdK = kindOf(pane)?.hold, listHeld = menus && !float && r.cols >= 24 && holdK ? holdK.held(pane) : null;
    const holdX = (foldDir ? foldX : menuX) - 2;
    const titleModeX = menus && pane.writtenTitle && r.cols >= 28 ? (listHeld !== null ? holdX : foldDir ? foldX : menuX) - 7 : null;
    const fits = Math.max(1, (titleModeX ?? (listHeld !== null ? holdX : foldDir ? foldX : menuX)) - r.col - 4);

    const arrival = this.arriving(id);
    const bright = (TONE[lv.tone] % 8) + 8;
    const head = (float ? `${fg(C.yellow)}${FRAME_GLYPHS.float} ${RESET}` : "") + this.header(id, r, keys, !joined && lv.border !== "none", float ? 2 : 0, r.col + 3 + fits);
    if (float) this.floatButtons.push({ id, row: r.row, from: r.col + 2, to: r.col + 5 });
    const view = inner.cols >= 1 && inner.rows >= 1 ? this.drawn(id, pane, inner, focused, typing) : null;
    // A kept session still needs an entry point when its reader is not taking keys.
    const held = pane instanceof ReaderPane && pane.holdsKeys && !this.entered.in(pane);
    const marked = this.marksOn(id);
    // A tile may say how its frame looks now (a lane a card is dragged over: what dropping it there would do).
    const own = pane.frameLook?.(focused) ?? null;
    // An edit armed in it (e, src/arm.ts) draws it in the edit's colour, frame and title, until ⏎ opens it or a key lets it go.
    const armedNow = pane instanceof ReaderPane && this.ctx ? this.ctx.armed?.() : null;
    const armed = !!armedNow && armedNow.of === (pane as ReaderPane).surface;
    // Tiles picked to gather into a group (tile.select): the person's own in bright cyan, an agent's dimmer, each said in the title.
    const pickedMe = this.selected.get("person")?.has(id) ?? false;
    const pickedBy = [...this.selected].filter(([k, set]) => k !== "person" && set.has(id)).map(([k]) => k.slice(6));
    // At rest, its frame in the look's tone when its `edge` asks for one (PIE-675); every state above keeps its own colour.
    const toned = lv.edge !== "none" && lv.tone !== "neutral" ? TONE[lv.tone] : null;
    const edgeC = no?.loud ? TONE.amber : arrival ? bright : this.linking ? (this.panes.get(id) === this.linkingFrom() ? C.lmagenta : C.magenta) : this.dragging?.src === id ? C.dark : pickedMe ? C.lcyan : armed ? C.yellow : marked.length ? C.lmagenta : typing ? C.yellow : pickedBy.length ? C.cyan : own?.colour ?? (keys ? "focus" : float ? C.yellow : dock ? C.brown : toned ?? "tile");
    const edge = (c: number | "focus" | "tile") => (typeof c === "number" ? fg(c) : fgRgb(theme().edge[c]));
    // One of the person's own left open here (PIE-812) is theirs again with the keys; another's takes e.
    const tail = (held ? fg(C.dark) + (pane instanceof ReaderPane && pane.surface.keepsOnFocusAway() ? " (kept open)" : " (e enters)") : "") + (pickedMe ? fg(C.lcyan) + " ◆ picked" : "") + (pickedBy.length ? fg(C.cyan) + ` ◇ picked by ${pickedBy.join(", ")}` : "");
    const bare = head.replace(/ +((?:\x1b\[[\d;]*m)*)$/, "$1");
    const title = rowLines(bare + (keys && width(bare) + width(tail) <= fits ? tail : ""), fits, 1)[0]!;
    // A title the border cuts (it ends in …) is said whole in the status line when the person's keys come to the tile
    // (PIE-815): the header inside shows it wrapped, and tile.info gives it to an agent.
    // A ◄ or → mark cut off by the title's end isn't a click (PIE-855): past it is the border, or the corner's controls.
    const titleEnd = r.col + 3 + width(title);
    this.headPresses = this.headPresses.filter(c => c.id !== id || c.to <= titleEnd);
    this.wireChips = this.wireChips.flatMap(c => (c.id !== id || c.to <= titleEnd ? [c] : c.from < titleEnd - 1 ? [{ ...c, to: titleEnd - 1 }] : []));
    const shownTitle = pane instanceof ReaderPane && pane.msg ? headedTitle(pane.titleNote!) : null;
    if (shownTitle && !visibleText(title).includes(shownTitle)) this.cutTitles.add(id); else this.cutTitles.delete(id);
    // One hint row: a tile whose keys the screen's hint row says for its kind (the board's lanes, outline, backlinks), or
    // whose controls sit on its header, doesn't repeat them along its frame.
    const said = this.headCtl.has(id) || (typeof this.spec.hint === "object" && this.spec.hint[pane.kind] !== undefined && !float && !held);
    const recovery = pane instanceof ReaderPane ? this.failedEdits.get(pane) : undefined;
    const hint = recovery && pane instanceof ReaderPane && recovery.of === pane.msg?.id ? `${recovery.why} · tile menu: recover typed text` : no ? refusalHint(no) : own?.hint ?? (focused && !said ? fg(C.dark) + (held && pane instanceof ReaderPane ? `e ⏎ enter${pane.surface.scrolls() ? " · j k scroll" : ""}` : float && !(pane instanceof ReaderPane && pane.holdsKeys) ? this.floatHint() : [this.spec.hint === undefined && focused ? this.screenKeyHint() : "", pane.hint()].filter(Boolean).join(" · ")) : "");
    // The focused tile's frame is double-lined (╔═╗, in the VGA font too) in whatever colour its state gives it, so which
    // tile the keys go to shows by its shape, apart from the colours of linking, marks, a drag or an edit.
    // Double-lined only while the person's keys are here: not while they're in your drawer, or in another part of a frame
    // around this screen (the showcase's index beside its stage).
    // At rest, the lines its look's `border` names (auto: the screen's frame; none: blank edges, the title kept).
    const lines = lv.border === "none" || joined ? NO_BOX : lv.border !== "auto" && lv.border !== "joined" ? BORDER_BOXES[lv.border] : this.spec.frame ? FRAMES[this.spec.frame] : undefined;
    const glyphs = keys ? FOCUS_BOX : arrival ? LINE_BOX : lines;
    const frameInk = (cover === "peek" && !focused && !arrival ? fg(C.dark) : edge(edgeC)) + (keys ? BOLD : "");
    const pointers = this.ctx?.agentPointers?.list(this).filter(p => p.tile === this.tileId(id)) ?? [];
    const pointerText = pointers.map(p => `@${p.agent}${p.line ? `:${p.line}` : ""}`).join(" ");
    const foot = fitHint(armed ? `${fg(C.yellow)}⏎ opens it · any other key cancels` : hint, Math.max(0, r.cols - 4)).text;
    canvas.box(r, float && !arrival ? fgRgb(floatTheme(lv).border) : frameInk, armed ? `${fg(C.yellow)}${BOLD}✎ edit? ${visibleText(title)}` : title, pointerText ? `${fg(C.dark)}${pointerText}${foot ? ` · ${foot}` : ""}` : foot, glyphs);
    if (arrival) canvas.text(r.col + 2, r.row, fg(bright) + BOLD + "*" + RESET, 1);
    let markerX = r.col + 3;
    for (const p of pointers) {
      const label = `@${p.agent}${p.line ? `:${p.line}` : ""}`;
      const size = Math.min(width(label), r.col + r.cols - 2 - markerX);
      if (size <= 0) break;
      this.pointerHits.push({ id, row: r.row + r.rows - 1, from: markerX, to: markerX + size, agent: p.agent });
      markerX += size + 1;
    }
    // `edge=bar`: a bar down its left side in the tone (the tile colour for neutral; a state's colour while it has one), over the frame's side.
    if (lv.edge === "bar" && r.rows > 2) for (let y = r.row + 1; y < r.row + r.rows - 1; y++) canvas.text(r.col, y, (edgeC === "tile" || edgeC === toned ? edge(toned ?? "tile") : frameInk) + "▌" + RESET, 1);
    // The focused tile's ⧉, in its frame's top right corner, floats it by mouse (tile.float, as ^W f); a float's own
    // ⧉, before its title, puts it back.
    // Every tile that can close has a × in its top right corner: a click closes it (tile.close, as ^W x; a running
    // program asks twice). A dock's tile closes by its dock's [×]; one the layout keeps (the board's lanes) has none.
    // A tab in the drawer has one too (the drawer's own exited program clears to an empty slot).
    if (closes) {
      const x = r.col + r.cols - 2;
      canvas.text(x, r.row, `${fg(focused ? C.grey : C.dark)}${FRAME_GLYPHS.close}${RESET}`, 1);
      this.closeButtons.push({ id, row: r.row, from: x, to: x + 1 });
    }
    if (floats) {
      canvas.text(floatX, r.row, `${fg(C.dark)}${FRAME_GLYPHS.float}${RESET}`, 1);
      this.floatButtons.push({ id, row: r.row, from: floatX, to: floatX + 1 });
    }
    if (foldDir) {
      canvas.text(foldX, r.row, `${fg(focused ? C.grey : C.dark)}${foldDir === "h" ? FRAME_GLYPHS.foldDown : FRAME_GLYPHS.foldLeft}${RESET}`, 1);
      this.foldButtons.push({ id, row: r.row, from: foldX, to: foldX + 1 });
    }
    if (titleModeX !== null) {
      const label = pane.systemTitle ? "[sys]" : "[name]";
      canvas.text(titleModeX, r.row, fg(C.grey) + label + RESET, label.length);
      this.headPresses.push({ id, row: r.row, from: titleModeX, to: titleModeX + label.length, press: () => this.run("tile.title.mode", {}, this.nameOf(id)) });
    }
    if (listHeld !== null) {
      canvas.text(holdX, r.row, `${fg(listHeld ? C.yellow : focused ? C.grey : C.dark)}${listHeld ? FRAME_GLYPHS.held : FRAME_GLYPHS.hold}${RESET}`, 1);
      this.holdButtons.push({ id, row: r.row, from: holdX, to: holdX + 1 });
    }
    if (menus) {
      const x = menuX;
      canvas.text(x, r.row, `${fg(focused ? C.grey : C.dark)}${FRAME_GLYPHS.menu}${RESET}`, 1);
      this.menuButtons.push({ id, row: r.row, from: x, to: x + 1, right: r.col + r.cols - x });
    }
    const out: Placement[] = [];
    if (!view) return out;
    if (view.headerBand) {
      const band = view.headerBand, row = band.row ? inner.row + band.row : framed.row;
      canvas.clear({ ...framed, row, rows: Math.min(framed.row + framed.rows, inner.row + band.row + band.rows) - row }, band.bg);
    }
    for (const g of view.gutter ?? []) {
      if (g.row < inner.rows) canvas.text(framed.col, inner.row + g.row, g.text, gutter);
    }
    // A peek's images would show through its neighbour: it draws text only.
    if (cover === "peek") {
      view.lines.slice(0, view.frame?.rows ?? inner.rows).forEach((l, i) => canvas.text(inner.col + (view.frame?.col ?? 0), inner.row + (view.frame?.row ?? 0) + i, l, view.frame?.cols ?? inner.cols));
      // Covered like a dock: what shows of it dimmed (less while the keys are in it), and the edge its neighbour slides over.
      const edge = r0.col + r0.cols - 1;
      canvas.dim({ ...r0, cols: r0.cols - 1 }, focused ? 0.8 : PEEK_DIM);
      for (let y = r0.row; y < r0.row + r0.rows; y++) canvas.text(edge, y, fg(C.dark) + "▒" + RESET, 1);
      return out;
    }
    view.lines.slice(0, view.frame?.rows ?? inner.rows).forEach((l, i) => canvas.text(inner.col + (view.frame?.col ?? 0), inner.row + (view.frame?.row ?? 0) + i, l, view.frame?.cols ?? inner.cols));
    if (view.frame && reader) for (const g of view.gutter ?? []) {
      if (g.row >= inner.rows) continue;
      for (let x = 0; x < gutter; x++) if (!reader.surface.floatAt(framed.col + x - inner.col, g.row)) {
        canvas.text(framed.col + x, inner.row + g.row, headOf(tailFrom(g.text, x), 1), 1);
      }
    }
    const lineEnds = new Map<number, number>();
    if (pane instanceof ReaderPane) for (const p of pointers) {
      if (p.line === undefined || (p.note && p.note !== pane.msg?.id)) continue;
      const drawn = view.lines.findIndex((_, row) => pane.surface.sourceLineAt(row + (view.frame?.row ?? 0)) === p.line! - 1);
      const y = drawn < 0 ? -1 : drawn + (view.frame?.row ?? 0);
      if (y < 0 || y >= inner.rows) continue;
      const end = lineEnds.get(y) ?? inner.col + inner.cols;
      const label = `@${p.agent}`, size = Math.min(width(label), end - inner.col);
      if (size <= 0) continue;
      const x = end - size;
      lineEnds.set(y, x - 1);
      canvas.text(x, inner.row + y, fg(C.dark) + label + RESET, size);
      this.pointerHits.push({ id, row: inner.row + y, from: x, to: x + size, agent: p.agent });
    }
    // The surface under what it drew and its padding, never over a picture drawn under the text (a header's backdrop:
    // Kitty shows it only through cells on the default background, so the surface yields there).
    if (surface && !(pane instanceof PtyPane)) {
      const under = (view.placements ?? []).filter(p => (p.z ?? 0) < 0).map(p => ({ c0: inner.col + p.col, c1: inner.col + p.col + p.cols, r0: inner.row + p.row, r1: inner.row + p.row + p.rows }));
      canvas.under(joined ? r : framed, surface, under.length ? (x, y) => under.some(u => x >= u.c0 && x < u.c1 && y >= u.r0 && y < u.r1) : undefined);
    }
    for (const s of view.spots ?? []) if (s.row < inner.rows && s.from < inner.cols) this.tileSpots.push({ y: inner.row + s.row, from: inner.col + s.from, to: inner.col + Math.min(s.to, inner.cols), key: s.key, tile: id });
    if (overflows(view.scroll)) canvas.thumb(r, view.scroll, fg(focused ? C.lcyan : C.cyan));
    for (const p of view.placements ?? []) out.push({ ...p, key: `p${id}:${p.key}`, col: p.col + inner.col, row: p.row + inner.row, cols: Math.min(p.cols, framed.col + framed.cols - (inner.col + p.col)), rows: Math.min(p.rows, framed.row + framed.rows - (inner.row + p.row)) });
    return out;
  }

  /** Whether tile `id` follows a tree (what `followsOf` says it follows): the default for a joined tile (PIE-886). */
  private joinedByDefault(id: number): boolean {
    const at = this.followsOf(id).source;
    return at !== undefined && kindOf(this.panes.get(at))?.kind === "tree";
  }

  /** Which way a click on tile `id`'s fold glyph folds it (v: ◂, h: ▾), or null where it can't fold now. */
  private foldDirOf(id: number): "v" | "h" | null {
    const axis = parentOf(this.root, id)?.parent.dir;
    const dir = axis === "col" ? "h" : "v";
    return refusal(this.layout, { op: "collapse", tile: id, on: true, dir }, this.layoutCtx(USER)) ? null : dir;
  }

  /**
   * The header row's text: the tile's number and name (bright when focused), or its tab set's tabs (the
   * one shown on blue); then what it shows, where its opens land (→), and a dock's state. Each tab's
   * label is kept as a hit for clicks and drags.
   */
  private header(id: number, r: Rect, focused: boolean, framed: boolean, indent = 0, max = r.col + r.cols - 2): string {
    const set = tabsOf(this.root, id);
    let x = r.col + 3 + indent;
    this.headOut = "";
    const xNow = () => x;
    const put = (text: string, sgr: string, hit?: number) => {
      // In cells: a wide glyph in a title takes two (PIE-809).
      const cells = width(text);
      if (hit !== undefined && x < max) this.heads.push({ id: hit, from: x, to: Math.min(max, x + cells), row: r.row });
      this.headOut += sgr + text + RESET; x += cells;
    };
    const pane = this.panes.get(id)!;
    if (this.linking && pane !== this.linkingFrom() && this.linkAccepts(pane)) {
      put(`${this.numLabel(id)}⌖ click to link here`, fg(C.lmagenta));
      return this.headOut;
    }
    const ctl = pane.headControls?.(Math.max(1, Math.min(22, Math.floor((max - x) / 3))), this) ?? [];
    const state = pane instanceof ReaderPane ? pane.surface.state()?.split(" ")[0] : null;
    const marks = this.marksOn(id).reduce((n, m) => n + width(markLabel(m)) + 2, 0);
    const home = kindOf(pane)?.home?.(pane);
    const follows = home && kindOf(pane)?.hold?.held(pane) === false ? width(home) + 3 : 0;
    const dock = dockOf(this.root, id) ? 14 : 0;
    const chips = ctl.reduce((n, c) => n + width(c.text) + 3, 0);
    const target = this.extTarget(id, "open");
    const wire = target ? ` ◄ ${this.plainPath(this.pathTo(target.pane))}` : "";
    const room = Math.max(1, max - x - marks - chips - dock - follows - width(wire) - (state ? state.length + 3 : 0));
    this.putStatus(id, put, true);
    if (state) put(`${state} · `, fg(C.dark));
    if (set && set.ids.length > 1) {
      set.ids.forEach((t, i) => {
        if (i) put(" | ", fg(C.dark));
        put(pad(`${this.numLabel(t)}${this.displayTitle(t)}`, Math.max(1, Math.floor((room - 3 * (set.ids.length - 1)) / set.ids.length))).trimEnd(), i === set.active ? fg(C.cyan) : fg(C.grey), t);
      });
    } else put(pad(`${this.numLabel(id)}${this.displayTitle(id)}`, room).trimEnd(), focused ? fgRgb(theme().edge.focus) + BOLD : fg(C.grey), id);
    if (wire) {
      const from = xNow() + 1;
      put(wire, fg(C.lmagenta));
      this.wireChips.push({ id, row: r.row, from, to: xNow(), wire: "open" });
    }
    this.putMarks(id, put, xNow, r.row);
    if (ctl.some(c => !c.chip)) this.headCtl.add(id);
    for (const c of ctl) {
      put(" · ", fg(C.dark));
      const from = xNow();
      put(c.text, c.sgr);
      if (c.press) this.headPresses.push({ id, row: r.row, from, to: xNow(), press: c.press });
    }
    return this.headerTail(id, put, xNow, r.row, max, focused, framed);
  }

  /**
   * A tile folded to a spine: its title turned on its side (the tile's own `spine`, else its name), what it holds
   * marked above it. A click on it opens it (`expandSpine`).
   */
  /** How tile `id` shows in its flow as last placed (full, peek, spine), if it's in one. */
  private cover(id: number) { return this.placed.covers?.get(id) ?? this.slid.find(d => d.placed.covers?.has(id))?.placed.covers?.get(id); }

  private drawSpineTile(canvas: Canvas, id: number, r: Rect, focused: boolean): Placement[] {
    const p = this.panes.get(id)!;
    canvas.clear(r);
    const tabs = tabsOf(this.root, id);
    const pile = tabs && tabs.ids.every(t => this.layout.altReaders.has(t));
    const own = { ...p.spine?.(), title: pile ? `▤ ${tabs.ids.length} · ${this.displayTitle(id)}` : this.displayTitle(id) };
    // A spine always names what it holds: a tile with no title yet (an empty reader, a note whose first line is blank)
    // falls back to its number and name, as its header says them ("4 detail").
    const sp = visibleText(own.title).trim() ? own : { ...own, title: `${this.numLabel(id)}${this.nameOf(id)}` };
    // A spine of a tile that closes has its × (PIE-794): a click closes it without opening it (tile.close, as ^W x).
    const closes = this.closesByMouse(id) && (this.collapsed.get(id)?.dir === "h" ? r.cols >= 6 : r.rows >= 3);
    const x = (col: number, row: number) => { canvas.text(col, row, `${fg(focused ? C.grey : C.dark)}${FRAME_GLYPHS.close}${RESET}`, 1); this.closeButtons.push({ id, row, from: col, to: col + 1 }); };
    if (this.collapsed.get(id)?.dir === "h") {
      const at = closes ? { ...r, cols: r.cols - 2 } : r;
      drawHSpine(canvas, at, { key: `spine:${id}`, title: sp.title, colour: focused ? C.white : C.cyan, marks: sp.marks, cellStyle: focused ? selected() : undefined });
      if (closes) x(r.col + r.cols - 2, r.row);
      this.spines.push([id, r]);
      return [];
    }
    const at = closes ? { ...r, row: r.row + 1, rows: r.rows - 1 } : r;
    const out = drawSpine(canvas, at, { key: `spine:${id}`, title: sp.title, colour: focused ? C.white : C.cyan, marks: sp.marks, cellStyle: focused ? selected() : undefined }, this.ctx);
    if (closes) x(r.col, r.row);
    this.spines.push([id, r]);
    return out ? [out] : [];
  }

  /** Tiles are numbered in their headers (what 1-9 focus), unless the view keeps the digits for itself. */
  private get numbered() { return this.spec.digits !== false; }
  private numLabel(id: number) {
    if (this.linking) {
      const n = this.screenTiles().findIndex(t => t.pane === this.panes.get(id));
      return n < 0 ? "" : `${n + 1} `;
    }
    return this.numbered ? `${this.numberOf(id)} ` : "";
  }
  private frameTitle(id: number, rows?: number): string {
    const p = this.panes.get(id)!, m = this.noteOf(id);
    if ((p.writtenTitle && !p.systemTitle) || !m || (tabsOf(this.root, id)?.ids.length ?? 0) > 1) return this.displayTitle(id);
    if (rows !== undefined && p instanceof ReaderPane && !p.surface.titleShown(rows - 2)) {
      return [p.surface.state(), workIdTitle(subject(m), prop(m, "work-id")).title].filter(Boolean).join(" · ");
    }
    const name = this.nameOf(id), own = visibleText(p.title()), sub = subject(m);
    const rest = own.startsWith(sub) ? own.slice(sub.length).replace(/^\s*·\s*/, "") : null;
    const kindWord = kindOf(p)?.word ?? p.kind;
    const word = rest === null ? own : !rest ? kindWord : /^\d/.test(rest) ? `${kindWord} ${rest}` : rest;
    return this.plainName(id) || word === name ? word : `${name} · ${word}`;
  }

  /** Display only: addressing and links keep the tile name. */
  displayTitle(id: number): string {
    const p = this.panes.get(id)!;
    const shownNote = this.noteOf(id);
    const note = p.titleNote ?? shownNote ?? this.showing(p);
    const system = p.headName?.() ?? (shownNote ? subject(shownNote) : p.title());
    if (!p.writtenTitle || p.systemTitle) return system;
    return interpolate(p.writtenTitle, span => {
      const missing = () => span.default === undefined ? [`⚠ {{${span.expression}}}`] : undefined;
      if (span.path === "tile.kind") return [p.kind];
      if (span.path === "tile.n") return [String(this.numberOf(id))];
      const path = span.parsed;
      if (!note || path?.head !== "this" || path.steps.length !== 1 || !("key" in path.steps[0]!)) return missing();
      const key = path.steps[0].key;
      if (key === "title") return [subject(note)];
      if (key === "subtitle") { const subtitle = subtitleOf(note); return subtitle ? [subtitle] : missing(); }
      const values = valuesOf(note, key);
      return values.length ? values : missing();
    });
  }

  titleTile(sel: string | undefined, text: string | undefined, toggle: boolean, actor: Actor): TileDone {
    const t = this.tile(sel), p = this.panes.get(t.id)!;
    if (toggle) p.systemTitle = !p.systemTitle;
    else if (text !== undefined) { p.writtenTitle = text || undefined; p.systemTitle = false; }
    else {
      if (actor.kind !== "user") throw new ActionRefused("tile.title needs text=<title>; text= clears it");
      this.overlay(linePrompt<Desk>({ name: "tile title", title: "Rename tile", text: p.writtenTitle ?? "", prefilled: true, verbatim: true,
        doing: () => "⏎ saves · empty uses the system title · {{this.title}} follows the note",
        done: (text, d) => { d.run("tile.title", { text }, t.name); },
      }));
      return { tile: t.name, prompt: true };
    }
    this.save(); this.redraw();
    return { tile: t.name, title: this.displayTitle(t.id), writtenTitle: p.writtenTitle ?? "", systemTitle: !!p.systemTitle };
  }

  private plainName(id: number) {
    const p = this.panes.get(id)!, k = kindOf(p)?.word ?? p.kind, n = this.nameOf(id);
    // A held reader the desk named a detail (detail, detail2: the glossary's word, PIE-705) is named for what it is too.
    return n === k || new RegExp(`^${k}\\d+$`).test(n) || (p instanceof ReaderPane && p.kind === "reader" && /^detail\d*$/.test(n));
  }

  private noteOf(id: number): Msg | null {
    const p = this.panes.get(id);
    // Not a list that only has a note selected (the river's Library, a #tag column): its border names the list.
    return p instanceof ReaderPane && p.msg && isOutlineNote(p.msg) && !p.msg.id.startsWith("file:") && !kindOf(p)?.lists?.(p) ? p.titleNote : null;
  }

  /** The tiles whose links end at `pane` (on this desk, or across the host layer's edge): their names, as the header says them. */
  private linkedFrom(pane: Pane): { names: string[]; across: boolean } {
    const names = this.layout.wires.filter(w => w.verb === "open" || w.verb === "select").map(w => [w.from, w.to] as const).filter(([src, to]) => this.panes.get(to) === pane && this.panes.has(src) && this.panes.get(src) !== pane).map(([src]) => this.nameOf(src));
    let across = false;
    for (const d of this.relatives()) for (const [sid, wires] of d.ext) if (wires.some(w => (w.verb === "open" || w.verb === "select") && d.extTarget(sid, w.verb, w)?.pane === pane)) { names.push(d.nameOf(sid)); across = true; }
    return { names: [...new Set(names)], across };
  }
  /** A path across the host layer's edge as a header says it: the tile's name (`@chain/reader9` is reader9). */
  private plainPath(path: string | undefined): string { return (path ?? "").replace(/^(\.\.\/)*@[^/]+\//, ""); }
  /**
   * What a tile's header says of the chain of links it is in (PIE-700): the tiles whose links end here (`← what-changed`);
   * for the reader an open from outside lands in by the rule (no link says so), that it is that one (`⏎ opens land here`);
   * for a drawer list with no link, which reader its picks land in now (`⏎ → reader9`), so the guess is visible.
   */
  private chainWords(id: number): string {
    const pane = this.panes.get(id)!;
    const { names, across } = this.linkedFrom(pane);
    let out = names.length ? ` ← ${names.join(", ")}` : "";
    if (pane instanceof ReaderPane && !across && (names.length > 0 || (wireTarget(this.layout, id) !== undefined)) && this.openLandingReader(USER)?.id === id) out += " opens land here";
    if (kindOf(pane)?.opensOnScreen && this.ctx?.hostLayer?.isDrawer(this) && !this.routes(pane)) {
      const to = this.otherDesk()?.landingName();
      if (to) out += ` open → ${to}`;
    }
    return out;
  }
  /** Where an open naming no tile lands on this screen now, by name: the guess a drawer list's header shows. */
  landingName(): string | null {
    if (this.hasPlaces() || (this.spec.lands !== undefined && this.specTile(this.spec.lands) === undefined)) return null;
    if (this.spec.lands !== undefined) { const id = this.specTile(this.spec.lands); return id === undefined ? this.spec.lands : this.nameOf(id); }
    return this.openLandingReader(USER)?.name ?? null;
  }

  private headerTail(id: number, put: (text: string, sgr: string, hit?: number) => void, xNow: () => number, row: number, max: number, focused: boolean, framed: boolean): string {
    // A list a #tag opened (PIE-855) follows its reader's tags until held: ◄ and the reader, a click opens ^W P's follows row.
    const p = this.panes.get(id)!, home = kindOf(p)?.home?.(p);
    if (home && kindOf(p)?.hold?.held(p) === false) { const from = xNow(); put(` ${FRAME_GLYPHS.follows} ${home}`, fg(C.lmagenta)); this.wireChips.push({ id, row, from: from + 1, to: xNow(), wire: "follows" }); }
    const dr = dockOf(this.root, id);
    // A click on it undocks it where it is (tile.dock on=false).
    if (dr) {
      const from = xNow(); put(` ${EDGE_GLYPH[dr.edge]} docked`, fg(C.brown)); this.dockLabels.push({ id, row, from: from + 1, to: xNow() });
      // A dock that slides shut says how, by mouse: [×] closes it as Esc in it does.
      if (dr.open && policyOfNode(this.layout, dr).collapsible) { const x = xNow(); put(` [${FRAME_GLYPHS.close}]`, fg(C.grey)); this.dockCloses.push({ id, row, from: x + 1, to: xNow() }); }
    }
    const verbs = ["select", "open", "alt"] as const;
    const glyphs = FRAME_GLYPHS;
    const words = verbs.map(verb => this.wireWords(id, verb));
    const wide = verbs.map((verb, i) => ` ${verb} → ${words[i]}`);
    const short = verbs.map((verb, i) => ` ${glyphs[verb]} ${words[i]}`);
    const chain = this.chainWords(id);
    const ag = this.agentOf(id).level;
    const room = max - xNow() - 14 - width(chain) - (ag === "free" ? 0 : width(AGENT_WORDS[ag]) + 3);
    const labels = wide.reduce((n, x) => n + width(x), 0) <= room ? wide : short.reduce((n, x) => n + width(x), 0) <= room ? short : verbs.map(verb => ` ${glyphs[verb]}`);
    if (framed && room >= 6 && (kindOf(p)?.previews || kindOf(p)?.accepts?.notes)) {
      // Wire controls are separate from the tile's identity and dock state.
      put(focused ? " ═" : " ─", fg(C.dark));
      verbs.forEach((verb, i) => {
        const from = xNow() + 1;
        put(labels[i]!, fg(C.lmagenta));
        this.wireChips.push({ id, row, from, to: xNow(), wire: verb });
      });
    }
    // The chain it is in (PIE-700): the tiles whose links end here, and, for the reader an open from outside (the drawer's
    // what-changed list, `ep0ch open`) lands in, that it is that one: "reader10 ← reader9", "reader9 ⏎ drawer → reader10".
    if (chain && xNow() + width(chain) < max) put(chain, fg(C.lmagenta));
    // What an agent may do here (PIE-639): free says nothing; a click cycles it (tile.agent), as ^W g does.
    if (ag !== "free") {
      const room = max - xNow() - (dockOf(this.root, id) ? 14 : 0) - 8, full = ` ${AGENT_GLYPH[ag]} ${AGENT_WORDS[ag]}`, text = full.length <= room ? full : ` ${AGENT_GLYPH[ag]}`;
      const from = xNow(); put(text, fg(ag === "off" ? C.lred : C.yellow)); this.agentChips.push({ id, row, from: from + 1, to: xNow() });
    }
    return this.headOut;
  }

  /** Attention marks on what a tile shows, right after its name (what the person should see when room is short); a click dismisses one. */
  /** Its program's status (OSC 7501), before its name: a glyph in the state's colour (src/desk/program-status.ts). */
  private putStatus(id: number, put: (text: string, sgr: string, hit?: number) => void, lead = false) {
    const st = this.panes.get(id)?.headStatus?.();
    if (st) put(lead ? `${st.glyph} ` : ` ${st.glyph}`, st.sgr, id);
  }

  private putMarks(id: number, put: (text: string, sgr: string) => void, xNow: () => number, row: number) {
    for (const m of this.marksOn(id)) {
      const from = xNow();
      put(` ${markLabel(m)} `, chipStyle(C.magenta));
      this.markHits.push({ id, n: m.n, row, from, to: xNow() });
    }
  }

  /** The drop the pointer is over: its outline, what it does, and the tile being carried, at the pointer. */
  private drawGhost(canvas: Canvas, drop: Drop<number> | null, name: string, x: number, y: number, drawer?: string) {
    if (drop) {
      const g = drop.ghost;
      // A drop the policy refuses is outlined in red, with the reason in place of what it would do.
      const why = drop.refused;
      const c = why ? C.lred : C.yellow;
      canvas.box(g, fg(c), `${chipStyle(c, C.black)} ${why ? `✕ ${why}` : drop.label} ${RESET}`, "");
      if (drop.kind === "tabs" && !why) canvas.text(g.col + 1, g.row + 1, `${fg(C.yellow)}${"▀".repeat(Math.max(0, g.cols - 2))}${RESET}`, Math.max(0, g.cols - 2));
    }
    // Over the drawer: the drawer lights up where it is (its chip, its dock); the tile carried says where it goes.
    const label = ` ⠿ ${name}${drawer ? ` · ${drawer}` : ""} `;
    const ly = Math.max(this.area.row, Math.min(this.area.row + this.area.rows - 1, y + 1));
    canvas.text(Math.max(0, Math.min(this.area.cols - width(label), x + 1)), ly, `${chipStyle(drawer ? C.yellow : C.magenta, C.black)}${label}${RESET}`);
  }

  /**
   * The whole hint row, wrapped, in a box just above it: the parts a narrow row cut (keys.more, or a ^W chord's
   * row, which shows it at once). Each line keeps the colour its first part was written in.
   */
  private drawHintMore(canvas: Canvas, cols: number, rows: number) {
    const lines = this.hintBox ? this.hintBox.flatMap(l => wrapHint(paint(l), Math.max(10, cols - 4))) : wrapHint(this.hintFull!, Math.max(10, cols - 4));
    const h = Math.min(lines.length + 2, Math.max(3, rows - 4));
    const r: Rect = { col: 0, row: rows - 3 - h, cols: cols - 1, rows: h };
    canvas.float(r, "keys", this.prefix ? "" : fg(C.dark) + "any key closes", () => {
      lines.slice(0, h - 2).forEach((l, i) => {
        canvas.text(r.col + 2, r.row + 1 + i, l, r.cols - 4);
        this.keySpots.push(...hintSpots(l, keyStyles()).map(p => ({ y: r.row + 1 + i, from: r.col + 2 + p.from, to: r.col + 2 + p.to, key: p.key })));
      });
    }, true, this.focusedPane() ? this.lookAt(this.focusedPane()!, cols).values : lookFor(this.lookSrc, { screen: this.name }, cols).values);
  }

  /** The hint part pressed, if `k` is a press on one: its key is pressed as typed. */
  private spotAt(k: Key): { key: Key; tile?: number } | undefined { return k.kind === "mouse" && k.action === "down" ? [...this.keySpots, ...this.tileSpots].find(s => s.y === k.y && k.x >= s.from && k.x < s.to) : undefined; }

  /** Every ^W key with its label and summary, joined from the actions it runs (wkeys.ts): what the keys box and the power bar's ^W list show. */
  wRows(): WRow[] { return wRows(name => this.dispatch.defOf(name)); }

  /**
   * Type `keys` after ^W, as the person's keys would (the power bar's ^W list picks one this way): `o s` is ^W o, then s.
   * Each key goes through `command`, the one place a ^W binding is read.
   */
  wChord(keys: string) {
    this.prefix = "wm";                  // a chord left waiting (^W m) is dropped: this one starts afresh
    for (const c of keys.split(" ").filter(Boolean)) {
      this.command({ kind: "char", ch: c === "space" ? " " : c });
    }
  }

  /** `keys.more`: show the whole hint row above it (or put it away); refused when the row isn't cut. */
  keysMore(): { shown: boolean } {
    if (!this.hintFull) throw new ActionRefused("the hint row shows all its keys already");
    this.hintMoreOpen = !this.hintMoreOpen;
    this.redraw();
    return { shown: this.hintMoreOpen };
  }

  /**
   * The spec's hint for where the keys are (`ScreenSpec.hint`): one string, or one per focused tile's kind. A tile the
   * person types in (a filter) says its own keys; a spine says what it is first.
   */
  private specHint(): string | null {
    const h = this.spec.hint;
    if (typeof h === "string") return h;
    const f = this.panes.get(this.focus);
    if (!f) return h?.["*"] ?? null;
    if (this.collapsed.has(this.focus)) {
      const holds = f instanceof ReaderPane && f.holdsKeys ? ` · keeps ${sessionName(f)}` : "";
      return `|14 ${(f instanceof ReaderPane ? f.detailLabel() : null) ?? this.nameOf(this.focus)} · collapsed${holds}|08 · ${h?.spine ?? this.screenKeyHint()}`;
    }
    if (h === undefined) return null;
    if (f.typing?.()) return `|08 ${f.hint()}`;
    if (this.isFloat(this.focus) && h.float !== undefined) return h.float;
    const k = h[f.kind] ?? h["*"] ?? null;
    // A tile that doesn't close (closable off, or kept by its source) isn't offered x: its kind's hint says it for the rest.
    return k && (!this.policyAt(this.focus).closable || this.facts(this.focus).keeps) ? k.split(" · ").filter(p => !/^(?:\|\d\d)?\s*\|15x\|08 close$/.test(p)).join(" · ") : k;
  }

  /** A float's frame hint, with this screen's keys for putting it back and closing it (the board has its own o and x). */
  private floatHint(): string { return "drag title · drag ◢ · H J K L move · ^W f back in · ^W x close · ^N another · its title onto a header or edge docks it"; }

  private hints(cols: number): string {
    const rd = this.panes.get(this.focus);
    // The docks slid shut, as handles at the end of the row (its edge, what it holds): a click opens one, and a
    // tile dropped on one goes into it. Then the lock chip: a click locks or unlocks the screen (layout.lock).
    // A dock holding a named container reads by its name (the board's outline); else by its tiles'.
    const handles = this.shutDocks().map(d => ({ id: leaves(d.kid)[0]!, dock: d, text: ` ${EDGE_GLYPH[d.edge]} ${isLine(d.kid) && d.kid.key ? d.kid.key : shown(d.kid).map(i => this.nameOf(i)).join("+")} ` }));
    const locked = this.screenLocked();
    const chip = this.spec.layouts || locked ? (locked ? " ▣ locked " : " □ lock ") : "";
    // The hyper layer is on (PIE-699): its chip, a click on it probes what a chord arrives as (keys.probe).
    const hyper = hyperOn() ? HYPER_CHIP : "";
    const hw = handles.reduce((a, h) => a + width(h.text) + 1, 0) + (chip ? width(chip) + 1 : 0) + (hyper ? width(hyper) + 1 : 0);
    this.handles = [];
    let x = cols - hw;
    let tail = "";
    for (const h of handles) { const hw = width(h.text); this.handles.push({ id: h.id, dock: h.dock, from: x, to: x + hw }); tail += `${chipStyle(C.brown)}${h.text}${RESET} `; x += hw + 1; }
    this.lockChip = chip ? { from: x, to: x + width(chip) } : null;
    if (chip) { tail += `${locked ? chipStyle(C.yellow, C.black) : fg(C.dark)}${chip}${RESET} `; x += width(chip) + 1; }
    this.hyperChip = hyper ? { from: x, to: x + width(hyper) } : null;
    if (hyper) tail += `${fg(C.magenta)}${hyper}${RESET} `;
    const room = Math.max(0, cols - hw);
    // Too long for the row (dock handles take its end): cut between its parts, never inside a key's, and say
    // "? more": ? (or a click on it) shows the whole row above it (keys.more). A ^W chord's row shows it at once.
    this.hintFull = null; this.moreChip = null; this.hintBox = null;
    const fit = (s: string) => {
      const f = fitHint(s, room, MORE);
      if (!f.cut) return s;
      this.hintFull = s;
      // A chord's row shows the rest at once, above it: its ? would be the chord's next key.
      if (this.prefix) return fitHint(s, room, paint("|08 · …")).text;
      this.moreChip = { from: f.at + 3, to: f.at + MORE_WIDTH };
      return f.text;
    };
    // A source's model says the screen's hint its way (the board's: a card trashed before it, its status after).
    const decorate = (s: string) => [...this.models.values()].reduce((h, m) => m.decorate?.(h) ?? h, s);
    const line = (s: string) => {
      const t = fit(decorate(s));
      // Its keys, but "? more" (its own chip: ? would be typed into a draft).
      this.keySpots = hintSpots(t, keyStyles()).filter(p => !this.moreChip || p.from < this.moreChip.from).map(p => ({ ...p, y: this.area.row + this.area.rows }));
      return pad(t, room) + tail;
    };
    // A refusal of the person's key on a tile folded to a spine (PIE-727): the spine has no edge to say it on, so the
    // screen's hint row under it says it, as the tile's frame would.
    const spineNo = this.collapsed.has(this.focus) && this.keysHere() ? this.ctx?.refusal?.() ?? null : null;
    if (spineNo) return line(refusalHint(spineNo));
    // A view's own mode (the board's composer, a card being dragged) says its keys first.
    const over = [...this.models.values()].map(m => m.hint?.() ?? null).find(h => h !== null) ?? null;
    if (over !== null) return line(over);
    if (this.dragging || this.floatDrag) {
      const why = this.dragging?.drop?.refused ?? this.dragging?.into?.refused ?? this.floatDrag?.drop?.refused;
      return line(fg(why ? C.lred : C.lmagenta) + (why ? `✕ ${why}` : "moving") + RESET);
    }
    if (this.drag || this.prefix === "resize") return line(fg(C.lmagenta) + "resizing" + RESET);
    if (this.prefix === "move" || this.prefix === "tab") return line(fg(C.lmagenta) + "moving" + RESET);
    if (this.pickedBy(USER).length) return line(fg(C.lmagenta) + "gathering" + RESET);
    if (this.linking) return line(fg(C.lmagenta) + "linking" + RESET);
    if (this.waitsOnExit()) return line(paint(`|12${this.exitedSay(this.nameOf(this.focus)).replace(" exited · ", " exited|08 · ")}`));
    if (this.rawKeys()) return line(paint(`|14in ${this.nameOf(this.focus)}|08 · every key goes to ${this.ptyIn!.title()} · |15${ESCAPE_CHORD}|08 back to the door (twice: send it)`));
    if (!this.prefix && rd instanceof ReaderPane && rd.holdsKeys && !this.collapsed.has(this.focus)) {
      const where = `${this.readerLabel(this.focus)} · ${rd.surface.state()}`;
      // Attached surfaces say their bindings in the tile's hint row.
      if (rd.surface.sourcesMode || rd.surface.replyLinks || rd.surface.session?.mode === "compose" || rd.surface.draft?.preview) return line(paint(`|14 ${where}`));
      return line(this.entered.in(rd)
        ? paint(`|14 ${where}|08 · `) + fg(C.grey) + rd.hint() + RESET
        : paint(`|14 ${where}|08 · |15e ⏎|08 enter ${sessionName(rd)}${rd.surface.scrolls() ? " · |15j k|08 scroll" : ""} · |15Tab/1-9|08 focus · |15^W|08 window`));
    }
    if (!this.prefix && !this.all().length) return line("");
    const leaving = this.prefix === "wm" && !!this.personIn()?.editing ? `|14${sessionName(this.personIn()!)}: the next key leaves it (saved, or kept as unsent) · |07esc |08stays · ` : "";
    if (this.prefix === "wm") this.hintBox = wBoxLines(this.wRows());
    const s = this.prefix === "wm"
      ? leaving + "|14^W |08… · |15?|08 all keys · |07esc |08cancel"
      : this.prefix === "add" || this.prefix === "addtab"
        ? `|14${this.prefix === "add" ? "open beside" : "open as a tab"}: ${tileKinds().flatMap(k => (k.keys ?? []).map(x => `|07${x.key} |08${x.label}`)).join(" · ")}`
        : this.specHint() ?? `|08 Tab/1-9 focus · |15^W|08 window · |15drag|08 a title moves, a border resizes · |15alt+l|08 link · ${this.spec.layouts ? `|15${keyCaption(DAILY_LAYOUT_KEYS[0]!.key)}|08 ${DAILY_LAYOUT_KEYS[0]!.label} · ` : ""}|15alt+k|08 ${this.screenLocked() ? "unlock" : "lock"} · |15^N|08 new · |15/|08 search · |15q|08 menu${this.layoutName ? ` · |03${screenTitle(this.layoutName)}` : ""}${this.shapeWarning() ? " · |15^W w|08 save the screen" : ""}${this.zoom !== null ? " · |14zoomed" : ""}${this.current ? ` · |03${subject(this.currentNow()!)}` : ""}`;
    return line(paint(s));
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** The focused pane, when it's a reader. */
  private focusedReader(): ReaderPane | null { const p = this.panes.get(this.focus); return p instanceof ReaderPane ? p : null; }
  /** The focused reader, when the person is in its edit, comment or property panel. */
  private personIn(): ReaderPane | null { const p = this.focusedReader(); return p?.holdsKeys && this.entered.in(p) ? p : null; }

  /** Start a session in a reader as the person's key does (⏎ or a click on a comment mark). */
  /** …; resolves true when the person is in it (opened, and still wanted), false when it didn't open or was cancelled. */
  startSession(rd: ReaderPane, kind: SessionKind, opener: Key = { kind: "char", ch: "e", ctrl: kind === "external" }, keys: Key[] = []): Promise<boolean> {
    // Esc, or leaving the desk, while the note is read cancels it: the token is cleared and nothing opens.
    // The person's session is where their keys are: a reader the key wasn't pressed in (the board's preview, from a lane) takes focus.
    if (this.focusedReader() !== rd) this.focusPane(rd, USER);
    const token: NonNullable<Desk["pending"]> = { pane: rd, kind, opener, keys: [...keys] };
    this.pending = token;
    const still = () => this.pending === token && this.focusedReader() === rd && !this.overlays.top();
    const opened = (open: boolean) => {
      const want = still();
      if (this.pending === token) this.pending = null;
      if (open && want) {
        this.failedEdits.delete(rd);
        this.entered.enter(rd);
        this.ctx.flash(`${this.readerLabel(this.focus)} · ${rd.surface.state()}`);
        for (const key of token.keys) rd.surface.key(key, rd.host(this));
      }
      this.redraw();
      return open && want;
    };
    const r = startSession(rd, kind, this, still);
    const said = (e: unknown) => {
      const why = e instanceof Error ? e.message : String(e);
      if (still() && token.keys.length && (kind === "edit" || kind === "external")) {
        const text = new Draft(rd.msg!.id, 0, "");
        for (const key of token.keys) text.key(key);
        const copy = keepCopy(text.text, "edit-opening");
        this.failedEdits.set(rd, { of: rd.msg!.id, keys: token.keys, text: text.text, copy, why });
        this.ctx.flash(`${why} · tile menu: recover typed text · copy kept at ${copy}`, undefined, errorDetails(e));
      } else this.ctx.flash(why, undefined, errorDetails(e));
      opened(false);
      return false;
    };
    // The property panel, or a thread list whose comments are already read, opens at once: the next key is already its.
    if (rd.sessionOf()) { const now = opened(true); return r.then(() => now, said); }
    return r.then(opened, said);
  }

  hasFailedEdit(sel?: string): boolean {
    const p = this.panes.get(this.tile(sel).id);
    const kept = p instanceof ReaderPane ? this.failedEdits.get(p) : undefined;
    return !!kept && p instanceof ReaderPane && kept.of === p.msg?.id;
  }

  async recoverEdit(sel?: string, op?: string) {
    const t = this.tile(sel), rd = this.panes.get(t.id);
    const kept = rd instanceof ReaderPane ? this.failedEdits.get(rd) : undefined;
    if (!kept || !(rd instanceof ReaderPane) || kept.of !== rd.msg?.id) throw new ActionRefused("this reader has no typing from a failed edit open");
    if (!op) {
      this.overlay(new ListPicker<{ label: string; op: string }, Desk>({
        name: "recover typed text", clickChooses: true,
        items: () => [{ label: "copy typed text", op: "copy" }, { label: "open edit with typed text", op: "open" }],
        row: (it, _i, on, w) => pickRows(` ${it.label}`, on, w),
        choose: (it, _i, d) => d.run("edit.recover", { op: it.op }, t.name),
        frame: (a, n) => ({ rect: centred(a, Math.min(64, a.cols - 4), n + 3), title: "recover typed text", head: [kept.why] }),
      }));
      return { text: kept.text, copy: kept.copy };
    }
    if (op === "copy") {
      if (this.ctx.copy?.(kept.text) === false) throw new ActionRefused(`clipboard refused the text; copy kept at ${kept.copy}`);
      this.ctx.flash("copied typing from the failed edit open");
      return { text: kept.text, copy: kept.copy };
    }
    return { opened: await this.startSession(rd, "edit", undefined, kept.keys) };
  }

  key(k: Key, ctx: Ctx): void {
    const pending = this.pending;
    if (pending && (pending.kind === "edit" || pending.kind === "external")) {
      const here = pending.pane === this.focusedReader() && !this.overlays.top();
      const pasted = k.kind === "paste" || "pasted" in k && k.pasted;
      const repeat = !pasted && k.kind === pending.opener.kind && (k.kind !== "char" || pending.opener.kind !== "char" || k.ch === pending.opener.ch && !!k.ctrl === !!pending.opener.ctrl);
      const text = k.kind === "paste" || k.kind === "char" && !k.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(k.ch)
        || k.kind === "enter" && !("ctrl" in k && k.ctrl) || k.kind === "tab" || k.kind === "backspace";
      if (here && (repeat || text)) {
        if (!repeat) pending.keys.push(k);
        return;
      }
      if (k.kind !== "mouse" || k.action === "down") {
        this.pending = null;
        if (here && k.kind === "esc") { ctx.flash("not opened"); this.redraw(); return; }
      }
    }
    if (this.arriving(this.focus) && (k.kind === "pgup" || k.kind === "pgdn" || k.kind === "up" || k.kind === "down" || k.kind === "char" && !k.ctrl && "jk".includes(k.ch))) this.run("tile.arrival.clear", {}, this.nameOf(this.focus));
    if (!this.all().length && !this.overlayOpen() && this.homeSurface.press(k.kind === "mouse" ? { ...k, x: k.x - this.area.col - 2, y: k.y - this.area.row - 1 } : k, action => { void ctx.press?.(action); })) return;
    if (k.kind === "mouse" && this.completionFloat && !this.overlays.all().length) {
      const { completer, rect, origin } = this.completionFloat;
      if (completer.shown && k.x >= rect.col && k.x < rect.col + rect.cols && k.y >= rect.row && k.y < rect.row + rect.rows) {
        if (k.action === "wheel-up" || k.action === "wheel-down") {
          const dir = k.action === "wheel-up" ? -1 : 1;
          if (completer.overPreview(k.x - origin.col, k.y - origin.row)) completer.scrollPreview(dir * 3);
          else completer.move(dir);
        } else if (k.action === "down" && k.button === 0) completer.previewPress(k.x - origin.col, k.y - origin.row, false);
        else if (k.action === "drag" && k.button === 0) completer.previewPress(k.x - origin.col, k.y - origin.row, true);
        else if (k.action === "up") completer.click(k.y - origin.row, k.x - origin.col, text => ctx.copy?.(text, "component preview"));
        this.redraw();
        return;
      }
    }
    if (k.kind === "alt" && k.ch === "N" && this.hintCards().length && !this.personIn() && !this.rawKeys() && !this.panes.get(this.focus)?.typing?.()) { this.run("hint.never"); return; }
    if (k.kind === "mouse") {
      this.hintPointer = { x: k.x, y: k.y };
      if (k.action === "wheel-up" || k.action === "wheel-down") {
        const card = [...(this.hintCards())].reverse().find(c => c.contains(k.x, k.y));
        if (card?.view.maxTop) { this.run("hint.scroll", { by: k.action === "wheel-down" ? 1 : -1 }, this.nameOf(card.anchor)); return; }
      }
      if (k.action === "down" && k.button === 0) {
        const cards = this.hintCards();
        const act = [...cards].reverse().map(c => c.at(k.x, k.y)).find(Boolean);
        if (act) { void (this.linking && act.action === "tile.link" ? this.linking.desk : this).dispatch.press(act.action, act.args, act.tile); return; }
      }
      const b = this.menuButtons.find(b => k.y === b.row && k.x >= b.from && k.x < b.to);
      // Only a click opens the menu. A hover over the control opens nothing (Evan, Oct 19 12:30 PM: "the menu is coming
      // up just on hovering? that's distracting"); the controls card is x-ray's and ?'s.
      if (b && k.action === "down" && k.button === 0) {
        if (b.id !== this.focus) this.run("tile.focus", {}, this.nameOf(b.id));
        return this.run("tile.menu", {}, this.nameOf(b.id));
      }
    }
    if (k.kind === "mouse" && k.action === "drag" && k.button === 3) return;
    if (k.kind === "esc" && (this.hintCard || this.xray)) {
      const inMode = this.linking || this.dragging || this.floatDrag || this.drag || this.prefix || this.overlayOpen() || this.pickedBy(USER).length;
      this.run("hint.dismiss");
      if (!inMode) return;
    }

    if (ch(k) === "?" && this.hintPointer && !this.holdsKeys()) {
      const at = this.hits.find(([, r]) => this.hintPointer!.y === r.row && this.hintPointer!.x >= r.col && this.hintPointer!.x < r.col + r.cols);
      if (at) { this.run("hint.show", {}, this.nameOf(at[0])); return; }
    }
    // A key or a click first settles a transition in flight, so it lands where the tile is (PIE-958).
    if (this.moving) { this.settle(); this.render(ctx); }
    // Esc while a script run is rearranging the screen stops it (layout.stop): one obvious key. Only then; a prefix, a draft, an overlay or a drag keep their Esc.
    if (k.kind === "esc" && this.runningScripts().length && !this.prefix && !this.holdsKeys() && !this.dragging && !this.floatDrag && ![...this.overlays.all()].length) return void this.run("layout.stop");
    // The band (the spec's): a press on it is its kind's. Only presses: a release or drag over it is the desk's, so a
    // border or tile drag still ends.
    if (k.kind === "mouse" && k.action === "down" && k.y < this.bandTop) { const b = this.band(); if (b?.kind.press) { b.kind.press(b.pane, k.x, k.y, this); return; } }
    // A click on a key in the hint row or its keys box: that key, as typed, wherever the keys are (an edit, a chord).
    // Not under an overlay of the desk's (the search, a picker): the row's keys aren't its.
    // While linking (alt+l), a click picks the tile, wherever in it: a tile's own spot (+ New note) doesn't take it.
    const spot = this.overlayOpen() || this.linking ? undefined : this.spotAt(k);
    if (spot) {
      this.hintMoreOpen = false;
      // A tile's own (its empty state's + New note): pressed in that tile, as a click there focuses it first.
      if (spot.tile !== undefined && spot.tile !== this.focus && !this.holdsKeys()) this.focusTile(this.nameOf(spot.tile), USER);
      this.redraw();
      return asBoundKey("click", () => this.key(spot.key, ctx));
    }
    // ctrl+n reaching the desk (a click on the hint row's ^N; a typed one the App takes first): a new note, the App's `note.new`.
    if (k.kind === "char" && k.ctrl && k.ch === "n" && !this.holdsKeys()) {
      if (this.ctx.press) void this.ctx.press("note.new");
      else this.ctx.flash("no new note here: this screen isn't given the door's actions · ctrl+n from the door's own screens");
      return;
    }
    // ? shows the whole hint row when it was cut (never while the person is typing: a draft, a filter, a
    // terminal, a ^W chord); the next key or click puts it away again and does what it does, but Esc only that.
    if (ch(k) === "?" && this.hintFull && !this.holdsKeys()) { this.run("keys.more"); return; }
    if (this.hintMoreOpen) {
      const chip = k.kind === "mouse" && this.moreChip && k.y === this.area.row + this.area.rows && k.x >= this.moreChip.from && k.x < this.moreChip.to;
      if (k.kind !== "mouse" || (k.action === "down" && !chip)) { this.hintMoreOpen = false; this.redraw(); if (k.kind === "esc") return; }
    }
    // A source's model holds the keys while its own overlay is open (the board's composer, pickers), before the screen's.
    const model = !this.overlayOpen() && [...this.models.values()].some(m => m.key?.(k));
    if (!model && !this.boundKey(k)) this.keyIn(k, ctx);
    this.entered.follow(this.focusedReader());          // moving away leaves a session; e or ⏎ enters it again
    this.reenter();
    for (const [id, p] of this.panes) if (id !== this.focus && p.typing?.()) p.blur?.();
    if (this.ptyIn && this.panes.get(this.focus) !== this.ptyIn) this.ptyIn = null;
    this.shutLeftDocks();
  }

  /** A dock sliding over shuts when the keys go elsewhere (tile.slide, as its key and an agent do it); one that takes its room, or can't collapse, stays. */
  private shutLeftDocks() {
    if (!this.dragging && !this.headPress) for (const d of docks(this.root)) {
      if (!d.open || d.policy?.overlay === false || d.policy?.stays || !leaves(d.kid).length || leaves(d.kid).includes(this.focus)) continue;
      if (!policyOfNode(this.layout, d).collapsible) continue;
      this.run("tile.slide", { open: false, container: d.id }, this.nameOf(leaves(d.kid)[0]!));
    }
  }

  private keyIn(k: Key, ctx: Ctx) {
    if (this.overlays.key(k, this) !== null) return this.redraw();
    if (this.linking && k.kind !== "mouse") return this.linkKey(k);
    // In a terminal tile: every key is the program's, but the escape chord and the mouse. Once the program
    // has exited, the keys wait for a choice (⏎ runs it again, ctrl+] leaves) and nothing leaks to the desk.
    if (this.rawKeys() && k.kind !== "mouse") {
      const p = this.ptyIn!;
      if (isEscapeChord(k)) return this.run("tile.leave", {}, this.nameOf(this.focus));
      if (!p.running) {
        const name = this.nameOf(this.focus);
        if (k.kind === "enter") this.run("tile.restart", {}, name);
        else if (k.kind === "char" && !k.ctrl && k.ch === "x" && (p as Pane).clearsOnClose?.()) this.run("tile.close", {}, name);
        // Nothing runs to take ^W: it's the window chord again (^W x closes the tile at once).
        else if (k.kind === "char" && k.ctrl && k.ch === "w") { this.ptyIn = null; this.prefix = "wm"; }
        else ctx.flash(this.exitedSay(name));
        return this.redraw();
      }
      if (k.kind === "paste") p.paste(k.text); else p.typed(k);
      return;
    }
    // ctrl+] twice: the second goes to the program (a literal ctrl+], telnet's own escape).
    if (isEscapeChord(k) && this.chord && Date.now() - this.chord.at < 1500 && this.panes.get(this.focus) === this.chord.pane && this.chord.pane.running) {
      this.chord = null;
      return this.run("tile.enter", { send: "\x1d" }, this.nameOf(this.focus));
    }
    // A board or river tile in its own edit, comment or panel: every key is its, the desk's included.
    const held = this.panes.get(this.focus), heldKind = held && kindOf(held);
    const windowKey = !!heldKind?.windowKeys && (!!this.prefix || (k.kind === "char" && k.ctrl && k.ch === "w"));
    if (held && heldKind?.takesKeys?.(held) && k.kind !== "mouse" && !windowKey) { held.key(k, this); return; }
    if (this.dragging && k.kind === "esc") { this.dragging = null; this.headPress = null; this.endGroupGhost(); ctx.flash("not moved"); return this.redraw(); }
    // A key while a tile is dragged acts on that tile, as its ^W chord does (the same actions): f floats it, p puts it
    // in a dock (or pins it), a puts it in your drawer. The drag ends there.
    const mid = this.dragging && k.kind === "char" && !k.ctrl ? DRAG_KEYS[k.ch] : undefined;
    if (mid && this.dragging) {
      const src = this.nameOf(this.dragging.src);
      this.dragging = null; this.headPress = null;
      return this.run(mid[0], mid[1], src);
    }
    // Esc while the person's own edit or comment is still opening cancels it, and does nothing else.
    if (k.kind === "esc" && this.pending?.pane === this.focusedReader()) { this.pending = null; ctx.flash("not opened"); return this.redraw(); }
    // An edit or comment of the person's kept open on the focused reader (brought back by a restore, or left by a ^W
    // chord) has their keys before anything else does (PIE-812): none of them goes to the desk underneath.
    const focused = this.focusedReader();
    const c = ch(k);
    // A restored edit invites e or Enter to carry on; that key belongs to entering, not to its text.
    const resuming = focused?.surface.draft && !this.entered.in(focused) && focused.surface.keepsOnFocusAway();
    this.reenter();
    if (resuming && this.entered.in(focused) && (c === "e" || k.kind === "enter") && !("pasted" in k && k.pasted)) return this.redraw();
    // A step's status choice the person opened (PIE-472) takes their keys until they choose or cancel.
    const choosing = this.choosingReader();
    if (choosing && k.kind !== "mouse") { choosing.key(k, this); return this.redraw(); }
    if (focused?.holdsKeys) {
      if (this.entered.in(focused)) {
        // The person is in it: every key is the edit's, comment's or panel's (tab indents), until it's closed
        // or left. ^W is the way out by keys: the window key after it leaves the edit as a click away does
        // (session.leave) and runs; esc after it stays in. The wheel scrolls the pane under the pointer.
        if (k.kind !== "mouse") {
          if (this.prefix === "wm") {
            if (k.kind === "esc") { this.prefix = ""; ctx.flash(`still in ${sessionName(focused)}`); return this.redraw(); }
            if (focused.editing && !this.leaveSession(focused)) { this.prefix = ""; return this.redraw(); }
            return this.command(k);
          }
          if (k.kind === "char" && k.ctrl && k.ch === "w" && !focused.surface.leaveRefusal()) { this.prefix = "wm"; return this.redraw(); }
          focused.key(k, this); return;
        }
        // The drag and release of a press the desk took before the keys came back into this edit (a float's title, a
        // border, a press elsewhere: PIE-812 re-enters the edit on that press) stay the desk's.
        const desks = k.action !== "down" && !this.editPressed && !!(this.headPress || this.pressed || this.dragging || this.mouseTile || this.drag || this.floatDrag || this.outDrag);
        if (focused.editing && !desks && k.action !== "wheel-up" && k.action !== "wheel-down") {
          if (k.action === "down") this.floatsWhereTheyAre();
          if ((k.action === "down" || k.action === "drag" || k.action === "up") && this.clickIn(focused, k)) return this.redraw();
          // Its own header and edges are the tile's, as any tile's (PIE-883: a new note's float couldn't be dragged, docked
          // or its ⋯ opened while it was being written): a press there is the desk's, and the edit stays open.
          if (k.action === "down" && this.topTileAt(k.x, k.y) === this.focus && this.onFrame(this.focus, k.x, k.y)) return this.mouse(k);
          // A click in the edit's own tile (its hint rows) stays in it. A click anywhere else leaves
          // it as any editor does (session.leave: saved, closed, or kept as unsent) and then does what it does.
          if (k.action !== "down" || this.topTileAt(k.x, k.y) === this.focus || !this.leaveSession(focused)) return;
        }
      } else if (k.kind !== "mouse" && !this.prefix && !this.collapsed.has(this.focus)) {
        // One they aren't in (and can see: a spine's is out of sight) (an agent's, or theirs after moving away): e or ⏎ enters it, j k PgDn scroll,
        // and the desk's keys keep working. None of its own keys get here.
        if (c === "e" || k.kind === "enter") { this.entered.enter(focused); ctx.flash(`in ${sessionName(focused)}`); return this.redraw(); }
        if (focused.scrollKey(k, this)) return;
      }
    }
    if (k.kind === "mouse") return this.mouse(k);
    if (this.prefix) return this.command(k);
    if (k.kind === "char" && k.ctrl && k.ch === "w") { this.prefix = "wm"; return this.redraw(); }
    if (k.kind === "alt") {
      if (k.ch === "l") return this.run("tile.link", { ask: true }, this.nameOf(this.focus));
      // alt+r shows the focused reader's note in the outline (PIE-794), as the Tree's r does.
      if (k.ch === "r" && this.panes.get(this.focus) instanceof ReaderPane) return this.run("reader.reveal", {}, this.nameOf(this.focus));
      const layout = modeBinding(DAILY_LAYOUT_KEYS, k);
      if (layout) return this.run(layout.action, layout.args ?? {});
      if (k.ch === "n" || k.ch === "p") return this.run("tab.select", { by: k.ch === "n" ? 1 : -1 }, this.nameOf(this.focus));
      if (k.ch === "m") return this.run("marks.next");
      if (k.ch === "x") return this.run("block.unmark", {}, this.nameOf(this.focus));
      if (k.ch === "k") return this.run("layout.lock");
      // alt+h folds the focused tile to a spine (alt+H a horizontal one), or opens it: a screen's key map rebinds them.
      if (k.ch === "h" || k.ch === "H") return this.run("tile.collapse", k.ch === "H" ? { dir: "h" } : {}, this.nameOf(this.focus));
    }
    // A tile whose current element is a live figure's takes tab, shift+tab and ← → first: they switch its tabs.
    const claimer = this.panes.get(this.focus);
    if (claimer?.claims?.(k) && !this.holdsKeys() && !this.collapsed.has(this.focus) && claimer.key(k, this)) return this.redraw();
    if (k.kind === "tab" && claimer?.completing?.()) { claimer.key(k, this); return this.redraw(); }
    if (k.kind === "tab" || k.kind === "backtab") {
      const ids = this.zoom !== null ? [this.zoom] : this.tabStops();
      const i = ids.indexOf(this.focus);
      return this.run("tile.focus", {}, this.nameOf(ids[(i + (k.kind === "tab" ? 1 : ids.length - 1)) % ids.length]!));
    }
    const pane = this.panes.get(this.focus);
    const c0 = ch(k);
    // A spine has the keys: ⏎ or space opens it; its own keys don't reach what it holds out of sight.
    if (this.collapsed.has(this.focus)) {
      // c too: it folded the tile (the board's c, ^W c), so it opens it again, as the spine's hint says.
      // - + = too (PIE-699): on a spine either one opens it.
      if (k.kind === "enter" || c0 === " " || c0 === "c" || FOLD_KEYS.has(c0)) return this.expandSpine(this.focus);
      if (k.kind === "char" && !k.ctrl && !/^[1-9q/V]$/.test(c0)) { refused(this.ctx, `${this.readerLabel(this.focus)} is collapsed to a spine · c, - or ⏎ or a click opens it · its × or ^W x closes it`); return; }
    }
    // A float has the keys: H J K L move it (float.place), as dragging its title does.
    if (this.isFloat(this.focus) && "HJKL".includes(c0) && c0 && !focused?.holdsKeys) return this.run("float.place", { dx: c0 === "H" ? -4 : c0 === "L" ? 4 : 0, dy: c0 === "K" ? -2 : c0 === "J" ? 2 : 0 }, this.nameOf(this.focus));
    // A key its kind gives an action of its own (a terminal the person isn't in: ⏎ or e starts typing in it; a river
    // column's h l w p x g), never while the person types (a filter, an edit opening).
    const pressed = pane && !this.holdsKeys() ? kindOf(pane)?.press?.(pane, k) : null;
    if (pressed) return this.run(pressed.action, pressed.args ?? {}, this.nameOf(this.focus));
    // Not while the tile takes typed text of its own (a river column's / filter): e, i and C are letters there.
    // A note that isn't a block keeps its own refusal (ReaderPane.key says it), except the comment keys a Resource takes.
    const kind = focused && !focused.holdsKeys && !pane?.typing?.() && focused.msg ? sessionStart(k) : null;
    const start = kind && !(pane instanceof ReaderPane && pane.refuses(kind)) ? kind : null;
    if (focused && start) {
      const host = focused.host(this);
      if (start === "edit" && host.attachment === "list-preview") return void focused.surface.runKey("list.preview.edit", {}, host);
      // e and ctrl+e arm the edit (edit.arm); a click on the hint row's e is the mouse's, and opens it at once (armsEdit).
      if (armsEdit(start)) return void focused.surface.runKey("edit.arm", start === "external" ? { external: true } : {}, focused.host(this));
      return void this.startSession(focused, start);
    }
    if (!focused?.holdsKeys && pane?.key(k, this)) return;
    // d (Delete too) trashes the note the tile points at (PIE-878, note.trash): the first press says what goes, d again confirms.
    // ctrl+z, with nothing of the tile's own to undo, brings back the note trashed last (note.untrash).
    if (!this.holdsKeys() && !pane?.typing?.()) {
      if (((k.kind === "char" && !k.ctrl && k.ch === "d") || k.kind === "delete") && pane?.subject?.()) return this.run("note.trash", {}, this.nameOf(this.focus));
      if (k.kind === "char" && k.ctrl && k.ch === "z") {
        // The newest of a layout change and a trash (PIE-957): a layout change is taken back as a trash is brought back.
        const trashed = lastTrashed(this.ctx.board, USER)?.seq, laid = this.history.newest()?.seq;
        if (laid !== undefined && (trashed === undefined || laid > trashed)) return this.run("layout.undo", {}, this.nameOf(this.focus));
        if (trashed !== undefined) return this.run("note.untrash", {}, this.nameOf(this.focus));
      }
    }
    // Bare - folds the focused tile to a spine and + or = opens it (PIE-699), only now: a tile's own - + = (the tune
    // inspector's nudge, an image's size, a figure's density) took the key above, and nothing that takes text is here.
    if (FOLD_KEYS.has(c0) && !this.holdsKeys()) return this.run("tile.collapse", { on: c0 === "-" }, this.nameOf(this.focus));
    // ⏎ in a preview (a reader following another tile's selection: the board's), on none of its elements, opens the note
    // it shows where its opens land (PIE-794: the board's readers row, its link), as ⏎ on a list's row does; alt+⏎ fresh.
    if ((k.kind === "enter" || k.kind === "alt-enter") && focused?.msg && !focused.holdsKeys && this.layout.wires.some(w => w.verb === "select" && w.to === this.focus) && this.routes(focused) && !this.collapsed.has(this.focus))
      return this.run("open", { id: focused.msg.id, from: this.nameOf(this.focus), ...(k.kind === "alt-enter" ? { fresh: true } : {}) });
    if (k.kind === "char" && !k.ctrl) {
      if (k.ch === "/") return this.run("search");
      if (k.ch === "V") return this.shell("video.cycle");
      if (/^[1-9]$/.test(k.ch) && this.numbered) { const id = this.all()[Number(k.ch) - 1]; if (id !== undefined) return this.run("tile.focus", {}, this.nameOf(id)); return; }
      if (k.ch === "q" && this.spec.home === undefined) { this.pending = null; return this.shell("screen.back"); }
    }
    // Esc closes the screen's next temporary thing (closeStep), and with none left says so and stays: it never leaves the
    // screen (UI-GRAMMAR, "Esc"). On a screen with a home, q takes the same steps and then leaves (PIE-489: q is back
    // everywhere).
    if (k.kind === "esc" || (c0 === "q" && this.spec.home !== undefined)) {
      if (this.closeStep(k.kind === "esc")) return;
      if (k.kind === "esc") return nothingToClose(this.ctx);
      this.pending = null; return this.shell("screen.back");
    }
  }

  /**
   * The screen's own next step out, as an action: out of a zoom, a dock the keys are in shuts, the keys go home (the
   * spec's), a dock sliding over shuts; for Esc, a float gives the keys back to the tile under it. False: none left.
   */
  private closeStep(esc: boolean): boolean {
    const step = (name: string, args: Record<string, unknown>, tile: string) => { this.run(name, args, tile); return true; };
    if (this.zoom !== null) return step("tile.zoom", { on: false }, String(this.numberOf(this.zoom)));
    // Esc lets go of the tiles the person picked to gather.
    if (esc && this.pickedBy(USER).length) return step("tile.select", { clear: true }, this.nameOf(this.focus));
    const shuts = (d: Dock<number> | null) => !!d?.open && d.policy?.overlay !== false && policyOfNode(this.layout, d).collapsible;
    const d = dockOf(this.root, this.focus);
    if (shuts(d)) return chainOf(this.root, this.focus).some(c => c.policy?.shuts) ? step("tile.close", {}, this.nameOf(this.focus)) : step("tile.slide", { open: false }, this.nameOf(this.focus));
    const home = this.homeTile();
    if (home !== undefined && !this.atHome()) return step("tile.focus", {}, this.nameOf(home));
    const open = this.spec.home !== undefined ? docks(this.root).find(x => shuts(x) && leaves(x.kid).length) : undefined;
    if (open) return step("tile.slide", { open: false, container: open.id }, this.nameOf(leaves(open.kid)[0]!));
    const ground = esc && this.isFloat(this.focus) ? this.grounded() : undefined;
    if (ground !== undefined) return step("tile.focus", {}, this.nameOf(ground));
    return false;
  }

  /** DeskApi.escaped: Esc found nothing left to close in a tile's own screen (a screen tile): the desk's next step, or nothing. */
  escaped() { if (!this.closeStep(true)) nothingToClose(this.ctx); }

  /** Every desk consults the screen's one pending wire, including the drawer. */
  linkingFrom(): Pane | null { const p = this.linking; return p ? p.desk.panes.get(p.from) ?? null : null; }

  linkingHere(): boolean { return this.linking?.desk.top() === this.top(); }

  private linkAccepts(pane: Pane): boolean {
    return pane === this.linkingFrom() || !!kindOf(pane)?.accepts?.notes || (this.linking?.verb === "alt" && !(pane instanceof ScreenTile));
  }

  /** Visible leaf tiles, in frame-number order, with rectangles in the screen's coordinates. */
  private screenTiles(): { pane: Pane; rect: Rect }[] {
    const walk = (d: Desk, offset: { col: number; row: number }): ReturnType<Desk["screenTiles"]> => {
      return d.all().flatMap(id => {
        const pane = d.panes.get(id)!;
        const r = d.hits.find(([i]) => i === id)?.[1];
        if (!r) return [];
        if (pane instanceof ScreenTile && pane.inner) {
          if (d.collapsed.has(id) || d.cover(id) === "spine") return [];
          const origin = d.origin(id, r);
          return walk(pane.inner, { col: offset.col + origin.col, row: offset.row + origin.row });
        }
        return [{ pane, rect: { ...r, col: r.col + offset.col, row: r.row + offset.row } }];
      });
    };
    const owner = this.linkOwner(), host = this.ctx?.hostLayer;
    const roots = new Set([...(host?.desks() ?? []).filter(d => !host!.isDrawer(d) && d.onScreen), owner, ...(host?.desks() ?? []).filter(d => d !== owner && d.onScreen)]);
    return [...roots].flatMap(d => walk(d, d.screenOrigin));
  }

  linkToPane(target: Pane, beside = false) {
    const pending = this.linking;
    if (!pending) return;
    const { desk, from, verb } = pending;
    this.linking = null;
    const path = desk.pathTo(target);
    if (path === undefined) { this.ctx.flash("not linked: that tile isn't reachable from here"); return this.redraw(); }
    desk.run("tile.link", { verb, ...(target === desk.panes.get(from) && !beside ? {} : { to: path, ...(beside && verb === "alt" ? { rule: "beside" } : {}) }) }, desk.nameOf(from));
  }

  linkAt(desk: Desk, x: number, y: number): void {
    if (!this.linking) return;
    const action = [...desk.hintCards()].reverse().map(c => c.at(x, y)).find(Boolean);
    if (action) { void (action.action === "tile.link" ? this.linking.desk : desk).dispatch.press(action.action, action.args, action.tile); return; }
    const hit = desk.hits.find(([, r]) => x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows);
    if (hit) {
      const pane = desk.panes.get(hit[0])!;
      if (pane instanceof ScreenTile && pane.inner) {
        if (desk.collapsed.has(hit[0]) || desk.cover(hit[0]) === "spine") return;
        const origin = desk.origin(hit[0], hit[1]);
        return this.linkAt(pane.inner, x - origin.col, y - origin.row);
      }
    }
    const distance = (r: Rect) => Math.max(r.col - x, 0, x - (r.col + r.cols - 1)) + Math.max(r.row - y, 0, y - (r.row + r.rows - 1));
    const target = hit ?? (this.linking.verb === "alt" ? [...desk.hits].sort(([, a], [, b]) => distance(a) - distance(b))[0] : undefined);
    if (!target) return;
    const [to, r] = target, pane = desk.panes.get(to)!;
    if (!this.linkAccepts(pane)) return;
    const beside = this.linking.verb === "alt" && (!hit || x === r.col || x === r.col + r.cols - 1 || y === r.row || y === r.row + r.rows - 1);
    this.linkToPane(pane, beside);
  }

  linkHint(): string {
    if (!this.linking) return "";
    return "linking";
  }

  private otherDesk(): Desk | undefined {
    const host = this.ctx?.hostLayer;
    return host?.isDrawer(this) ? host.desks().find(d => !host.isDrawer(d)) : undefined;
  }

  private linkKey(k: Key) {
    const { desk, from } = this.linking!;
    const c = ch(k);
    if (c === "s" || c === "a" || c === "o") return desk.run("tile.link", { ask: true, verb: c === "s" ? "select" : c === "a" ? "alt" : "open" }, desk.nameOf(from));
    if (k.kind === "esc") return desk.run("tile.link", { ask: false }, desk.nameOf(from));
    const tiles = this.screenTiles();
    const rects = new Map(tiles.filter(t => this.linkAccepts(t.pane)).map(t => [t.pane, t.rect]));
    const target = MOVE[c] ? neighbour(rects, desk.panes.get(from)!, MOVE[c]!) : /^[1-9]$/.test(c) ? tiles[Number(c) - 1]?.pane : null;
    if (target && this.linkAccepts(target)) this.linkToPane(target);
  }

  /** The ^W keys the desk does itself (W_KEYS' `special`): a handler for each, or this doesn't type-check. */
  private readonly wSpecial: Record<WSpecialKey, (me: string, flash: (s: string) => void) => void> = {
    T: (me, flash) => { if (tabsOf(this.root, this.focus)) this.run("layout.move", { to: me, where: "right" }, me); else flash(`${me} isn't in a tab set`); },
    P: () => { this.overlays.push(policyPanel(this, this.focus)); this.redraw(); },
    // Drop to shell (`screen.shell`), the menu's `!`: loaded when pressed, as screens.ts imports this module.
    "!": () => { void import("../screens").then(m => m.dropToShell(this, this.ctx)); },
    d: (me, flash) => {
      if (dockOf(this.root, this.focus)?.open) return this.run("tile.slide", { open: false }, me);
      const shut = this.shutDocks().at(-1);
      if (shut) this.run("tile.slide", { open: true, container: shut.id }, this.nameOf(leaves(shut.kid)[0]!)); else flash("no docks · ^W p puts this tile in one");
    },
    // The next tile in the tree (a float isn't in it: the swap says so).
    s: me => {
      const ids = leaves(this.root), j = this.isFloat(this.focus) ? ids[0]! : ids[(ids.indexOf(this.focus) + 1) % ids.length]!;
      if (j !== this.focus) this.run("layout.swap", { to: this.nameOf(j) }, me); else this.redraw();
    },
    // All the ^W keys: the power bar's actions scope on the ^W prefix, a list to filter (src/bar/sources.ts).
    "?": (_me, flash) => { if (this.ctx.press) void this.ctx.press("bar.open", { scope: "actions", query: "^W " }); else flash("the ^W list is the power bar's: this screen isn't given the door's actions"); },
  };
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Stay in (or enter) resize mode, and let go after RESIZE_IDLE_MS without a key. */
  private armResize() {
    this.prefix = "resize";
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => { this.resizeTimer = null; if (this.prefix === "resize") { this.prefix = ""; this.redraw(); } }, RESIZE_IDLE_MS);
  }
  private leaveResize() {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    if (this.prefix === "resize") this.prefix = "";
  }

  private command(k: Key) {
    const mode = this.prefix;
    // ^W held down repeats: while the prefix is pending (or resize mode is on) another ^W is ignored, not a toggle.
    if (k.kind === "char" && k.ctrl && k.ch === "w" && (mode === "wm" || mode === "resize")) { if (mode === "resize") this.armResize(); return; }
    if (mode === "resize") {
      // Esc or ⏎ leaves; another key leaves and is handled as if typed outside the mode; a resize key resizes again.
      if (k.kind === "esc" || k.kind === "enter") { this.leaveResize(); return this.redraw(); }
      const rc = k.kind === "char" && !k.ctrl ? k.ch : ARROW[k.kind] ?? "";
      const re = wKey(RESIZE_ALIAS[rc] ?? rc);
      if (re?.sticky && re.how.k === "run") { this.armResize(); return this.run(re.how.action, re.how.args ?? {}, re.how.tile === "-" ? undefined : String(this.numberOf(this.focus))); }
      this.leaveResize();
      this.redraw();
      return this.key(k, this.ctx);
    }
    this.prefix = "";
    // A ctrl+letter isn't the letter: ^W then ctrl+x closes nothing.
    const c = k.kind === "char" ? (k.ctrl ? "" : k.ch) : ARROW[k.kind] ?? "";
    const me = this.nameOf(this.focus);
    const flash = (s: string) => { this.ctx.flash(s); return this.redraw(); };
    if (mode === "add" || mode === "addtab") {
      // The kind under that key, from the registry (an extension's kind with a key is here too).
      const hit = kindForKey(c);
      if (!hit) return this.redraw();
      const s0 = hit.key.spec?.({ name: me, pane: this.panes.get(this.focus)! }) ?? {};
      const extra: Partial<NewTile> = { ...(s0.cmd ? { cmd: s0.cmd.join(" ") } : {}), ...(s0.file ? { file: s0.file } : {}), ...(s0.source ? { source: s0.source } : {}), ...(s0.view ? { view: s0.view } : {}), ...(s0.mode ? { mode: s0.mode } : {}), ...(s0.name ? { name: this.idNamed(s0.name) === undefined ? s0.name : this.autoName(s0.name) } : {}) };
      return this.run("tile.open", { kind: hit.kind.kind, ...extra, where: mode === "addtab" ? "tabs" : "right" }, me);
    }
    const dir = MOVE[c], n = dir ? neighbour(this.rectsNow(), this.focus, dir) : null;
    if (mode === "move" || mode === "tab") {
      if (!dir) return this.redraw();
      if (mode === "tab") return n === null ? flash(`no tile ${dir} of ${me}`) : this.run("layout.move", { to: this.nameOf(n), where: "tabs" }, me);
      return this.run("layout.move", n === null ? { where: `edge-${dir}` } : { to: this.nameOf(n), where: dir }, me);
    }
    const e = wKey(c);
    if (!e) return this.redraw();
    switch (e.how.k) {
      case "focus": return dir && n !== null ? this.run("tile.focus", {}, this.nameOf(n)) : this.redraw();
      case "edge": return this.run("layout.move", { where: `edge-${TO_EDGE[c]}` }, me);
      case "prefix": this.prefix = e.how.mode; return this.redraw();
      case "run": {
        const done = this.run(e.how.action, e.how.args ?? {}, e.how.tile === "-" ? undefined : e.how.tile === "n" ? String(this.numberOf(this.focus)) : me);
        // A resize key stays in resize mode (the hint row and the status bar say so): the next ones need no ^W.
        if (e.sticky) { this.armResize(); this.ctx.flash("resize · - + < > · h j k l · = evens · esc done", RESIZE_IDLE_MS); }
        return done;
      }
      case "special": return this.wSpecial[e.key as WSpecialKey](me, flash);
    }
    this.redraw();
  }

  /**
   * The policy panel's rows for tile `tile` itself, above its containers' (PIE-855): what it follows and where its opens
   * land, in plain words (`followsOf`, `opensOf`), each with a row that changes it and one that unlinks it where it can.
   */
  wireDescription(sel: string | undefined, verb: WireVerb) { return this.wireWords(this.tile(sel).id, verb); }

  private wireWords(id: number, verb: WireVerb): string {
    if (verb === "open") return this.opensOf(id).short;
    const targets = this.layout.wires.filter(w => w.from === id && w.verb === verb);
    const said = (target: string, rule?: AltRule) => rule === "first-unheld" ? "first unheld reader" : rule === "tab" ? `tab of ${target}` : rule === "beside" ? `beside ${target}` : target;
    const external = (this.ext.get(id) ?? []).filter(w => w.verb === verb).map(w => {
      const t = this.extTarget(id, verb, w);
      return said(t ? this.plainPath(this.pathTo(t.pane)) : w.path ?? "", w.rule);
    });
    if (targets.length || external.length) return [...targets.map(w => said(this.nameOf(w.to), w.rule)), ...external].join(", ");
    if (verb === "select") return kindOf(this.panes.get(id))?.previews ? "current note" : "nowhere";
    const to = landing(this.layout, id, verb, this.facts(id));
    if (to && "to" in to) return this.nameOf(to.to);
    if (to && "beside" in to) return `beside ${this.nameOf(to.beside)}`;
    if (to && "tab" in to) return `tab of ${this.nameOf(to.tab)}`;
    if (to && "into" in to) return to.into;
    if (to && "next" in to) return "next column";
    return "current note";
  }

  wireRows(tile: number): PanelRow[] {
    if (!this.panes.has(tile)) return [];
    const name = this.nameOf(tile), p = this.panes.get(tile)!;
    const rows: PanelRow[] = [];
    if (p instanceof ReaderPane && p.follows) {
      rows.push({ label: `Shows: ${p.stateLabel()} · change`, value: "", wide: true, wire: "follows", run: () => { this.run("reader.mode", {}, name); } });
      const page = p.pinPage ?? prop(p.msg, "page");
      if (page) rows.push({ label: `▣ ${p.pinPage ? "Unlock" : "Lock"} stays put on [[${page}]]`, value: "", wide: true, run: () => { this.run("reader.mode", { mode: p.pinPage ? "held" : "pinned" }, name); } });
    } else {
      const f = this.followsOf(tile);
      if (f.unlink || f.change) {
        rows.push({ label: `${name} follows: ${f.says}`, value: "", wide: true, wire: "follows", run: f.change?.run });
        if (f.unlink) rows.push({ label: `  ${f.unlink.label}`, value: "", wide: true, run: f.unlink.run });
      }
    }
    for (const verb of ["select", "open", "alt"] as const) {
      const label = verb === "select" ? "Select shows in" : verb === "open" ? "⏎ opens in" : "alt opens";
      rows.push({ label: `${label}: ${this.wireWords(tile, verb)} · pick on screen`, value: "", wide: true, wire: verb, run: () => { this.run("tile.link", { ask: true, verb }, name); }, clear: () => { this.run("tile.link", { verb }, name); } });
    }
    return rows;
  }
  /** ^W P opened at tile `tile`'s follows or opens row (a click on its header's ◄ or → mark). */
  openWires(tile: number, wire: "follows" | WireVerb): void {
    const panel = policyPanel(this, tile);
    panel.sel = Math.max(0, this.wireRows(tile).findIndex(r => r.wire === wire));
    this.overlays.push(panel); this.redraw();
  }

  /** The policy panel's containers over tile `tile`: the screen, then each one down to it. */
  policyNodes(tile: number): { label: string; node: Container | null }[] {
    if (!this.panes.has(tile)) return [{ label: "screen", node: null }];
    return [{ label: "screen", node: null }, ...chainOf(this.root, tile).map(c => ({ label: `${c.t === "split" ? `${c.dir} split` : c.t === "columns" ? "columns" : c.t === "tabs" ? "tabs" : c.t === "flow" ? "flow" : `${c.edge} dock`} ${c.id ?? ""}`.trim(), node: c }))];
  }

  /**
   * The policy panel's rows for container `node` (null: the screen): each field, what it is now, and what ⏎ or a
   * click does (the same `layout.policy`, `layout.lock` or `tile.dock` an agent calls); `adjust` is + and -.
   */
  policyRows(tile: number, node: Container | null): PanelRow[] {
    const own: Policy = node ? node.policy ?? {} : this.layout.policy;
    const at = node ? policyOfNode(this.layout, node) : effective([{ by: "screen", policy: this.layout.policy }]);
    const id = node ? node.id ?? "" : "screen";
    const tname = this.nameOf(tile);
    const set = (args: Record<string, unknown>) => this.run("layout.policy", { node: id, ...args }, tname);
    const onOff = (b: boolean) => (b ? "on" : "off");
    const flag = (k: "draggable" | "droppable" | "closable" | "resizable" | "collapsible", about: string) => ({
      label: `${k} · ${about}`, value: own[k] === undefined ? `${onOff(at[k])} (from ${at.by[k] ?? "the default"})` : onOff(own[k]!),
      // Cycles: from above → off → on → from above.
      run: () => (own[k] === undefined ? set({ [k]: false }) : own[k] === false ? set({ [k]: true }) : set({ clear: k })),
    });
    const rows: ReturnType<Desk["policyRows"]> = [{
      label: "locked · the shape is fixed, the contents live", value: own.locked ? "on" : at.locked ? `on (from ${at.by.locked})` : "off",
      run: () => (node ? set({ locked: !own.locked }) : this.run("layout.lock")),
    }, flag("draggable", "its tiles move out"), flag("droppable", "it takes tiles"), flag("closable", "its tiles close"), flag("resizable", "its borders move")];
    // What an agent may do to the tiles under it (PIE-639); a tile's own (^W g, tile.agent) wins over it.
    const ag = ["free", "edit", "off"] as const, agNow = own.agents ?? "free";
    rows.push({ label: "agents · what an agent may do to its tiles (free, edit only, hands off)", value: own.agents ?? `${at.agents}${at.by.agents ? ` (from ${at.by.agents})` : " (the default)"}`, run: () => set({ agents: ag[(ag.indexOf(agNow) + 1) % ag.length] }) });
    const kinds = [...new Set((node ? leaves(node) : this.all()).map(i => this.panes.get(i)!.kind))];
    rows.push({ label: "accepts · the tile kinds it takes", value: own.accepts ? own.accepts.join(", ") || "nothing" : at.accepts ? `${at.accepts.join(", ")} (from ${at.by.accepts})` : "any", run: () => (own.accepts ? set({ clear: "accepts" }) : set({ accepts: kinds.join(",") })) });
    const notes = this.all().filter(i => kindOf(this.panes.get(i))?.accepts?.notes && !(node && leaves(node).includes(i))).map(i => this.nameOf(i));
    // The open rule in plain words (PIE-855): what an open from a tile with no link does.
    const rule = (o: string) => (o === "next" ? "next: a new column after it" : "current: the current note moves");
    rows.push({ label: "opens · an open from a tile with no link", value: own.opens ? rule(own.opens) : `${rule(at.opens)}${at.by.opens ? ` (from ${at.by.opens})` : ""}`, run: () => (own.opens === undefined ? set({ opens: at.opens === "next" ? "current" : "next" }) : set({ clear: "opens" })) });
    if (!node) {
      const order = ["over", "beside", "none"] as const, now = own.host ?? "over";
      rows.push({ label: "host · where the host layer may appear (the agent)", value: own.host ?? "over (the default)", run: () => set({ host: order[(order.indexOf(now) + 1) % order.length] }) });
    }
    rows.push({
      label: "opens into · where its tiles' opens land", value: own.opensInto ?? (at.opensInto ? `${at.opensInto} (from ${at.by.opensInto})` : "—"),
      run: () => { const i = own.opensInto ? notes.indexOf(own.opensInto) : -1; const next = notes[i + 1]; return next ? set({ opensInto: next }) : set({ clear: "opensInto" }); },
    });
    if (node) {
      // Measured as laid out without a zoom (PIE-869: with another tile zoomed its tiles weren't on screen, and ⏎ here
      // fixed the desk's only row at a made-up 10 cells); none to measure (a shut dock): refused, with the command.
      const cellsNow = this.cellsOf(node);
      const measured = () => { if (cellsNow === null) throw new ActionRefused(`${id}'s tiles aren't on screen to measure: layout.policy node=${id} fixed=<cells>`); return cellsNow; };
      const ignored = this.unfixed(node);
      const sizes = (["fixed", "min", "max"] as const).map(k => ({
        label: `${k} size · cells (+ - change it)`,
        // A lock that's set says so, and how to clear it, where it's seen (PIE-869).
        value: own[k] === undefined ? "—" : `${own[k]}${k === "fixed" && ignored ? " · ignored: nothing beside" : ""} · ⏎ clears`,
        run: () => (own[k] === undefined ? set({ [k]: measured() }) : set({ clear: k })),
        adjust: (by: number) => set({ [k]: Math.max(1, (own[k] ?? measured()) + by) }),
      }));
      // The sizes go first, under locked: a lock that shapes the screen is the one to see. Always there, so a row set
      // by ⏎ stays under the selection for the ⏎ that clears it.
      rows.splice(1, 0, ...sizes);
    }
    if (node?.t === "dock") {
      rows.push(flag("collapsible", "it slides shut"));
      rows.push({ label: "overlay · slides over (off: takes its room)", value: onOff(node.policy?.overlay !== false), run: () => set({ overlay: node.policy?.overlay === false }) });
      rows.push({ label: "stays · open when the keys leave it", value: onOff(!!node.policy?.stays), run: () => set({ stays: !node.policy?.stays }) });
      const order: Dir[] = ["left", "up", "right", "down"];
      rows.push({ label: "edge · where it slides from", value: node.edge, run: () => this.run("tile.dock", { edge: order[(order.indexOf(node.edge) + 1) % 4] }, this.nameOf(leaves(node.kid)[0]!)) });
    }
    return rows;
  }
  /** A container's size along its parent's axis, as laid out without a zoom, in cells (the panel's size rows); null: none of its tiles is placed. */
  private cellsOf(node: Container): number | null {
    const rects = rectsOf({ ...this.layout, zoom: null }, this.area, this.holds), p = parentNode(this.root, node);
    const rs = leaves(node).map(i => rects.get(i)).filter((r): r is Rect => !!r);
    if (!rs.length) return null;
    const across = !p || p.parent.dir === "row";
    return across ? Math.max(...rs.map(r => r.col + r.cols)) - Math.min(...rs.map(r => r.col)) : Math.max(...rs.map(r => r.row + r.rows)) - Math.min(...rs.map(r => r.row));
  }

  /** Whether container `node`'s fixed size is ignored as the screen is laid out (layout.ts place: nothing beside it takes the rest). */
  private unfixed(node: Container): boolean {
    const ps = placeLayout(this.layout, this.area, this.holds);
    return !!ps.unfixed?.has(node) || ps.slid.some(d => !!d.placed.unfixed?.has(node));
  }

  // ── tile operations (TILE_ACTIONS): the keys, the mouse and `act` all come here ──

  /**
   * A tile by its name (what the dispatcher gives an action once it has read `tile=`'s grammar), or "focused"; none
   * named: the focused one. The grammar itself (ids, numbers, block ids, aliases) is the dispatcher's alone.
   */
  private tileNamed(sel: string | undefined, refuse = true): { name: string; id: number } | null {
    // An empty screen is its home: say so, and what starts something, never "no tile undefined".
    if (!this.all().length) {
      if (!refuse) return null;
      throw new ActionRefused("this screen is empty · ctrl+n a note, alt+s a shell, ctrl+k the power bar");
    }
    if (!sel || sel === "focused") return { name: this.nameOf(this.focus), id: this.focus };
    const byName = this.idNamed(sel);
    if (byName !== undefined) return { name: sel, id: byName };
    if (!refuse) return null;
    const ids = this.all();
    throw new ActionRefused(`no tile ${sel}; tiles: ${ids.map(i => `#${this.numberOf(i)} ${this.nameOf(i)} (${this.tileId(i)})`).join(", ")}, or focused`);
  }
  private tile(sel: string | undefined) { return this.tileNamed(sel)!; }

  /**
   * Where each tile is right now, placed from the tree as it is (not as last painted: paints are coalesced, and
   * a key that follows a change within a frame must see the change).
   */
  private rectsNow(): Map<number, Rect> { return rectsOf(this.layout, this.area, this.holds); }

  // ── policy (PIE-505): what each container allows; the screen-layout module checks it in every operation ──

  /** What applies to tile `id` (the screen's policy down through its containers to its kind's default). */
  /** What an agent may do to tile `sel` (PIE-639), for its menu row. */
  agentNow(sel: string | undefined): { level: AgentLevel; by: string } { return this.agentOf(this.tile(sel).id); }
  /** Why an agent may not do `what` to tile `id` (PIE-639), in the layout's words, or null. */
  private agentNo(id: number, what: string): string | null {
    const a = this.agentOf(id);
    return a.level === "free" ? null : agentRefusal(a.level, this.nameOf(id), what, { by: a.by });
  }
  /** Pane `p` is a tile the screen limits for agents (edit only or hands off). */
  private limitedFor(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && this.agentOf(id).level !== "free"; }
  /** Tile `p` is kept from `by`'s opens: `by` is an agent and the screen limits it there (PIE-639). Where an open may land asks this. */
  private keptFrom(p: Pane, by: Actor): boolean { return by.kind === "agent" && this.limitedFor(p); }
  /** An open by `by` into tile `p` that doesn't go through `openIntoPane` (a screen's own landing tile): the same guard, refused with why. */
  private mayOpen(p: Pane, by: Actor) { if (this.keptFrom(p, by)) throw new ActionRefused(this.agentNo(this.idOf(p)!, "opening a note in it")!); }
  /** What an agent may do to tile `id` (PIE-639), and which layer said so ("tile", "screen" or a container's id). */
  agentOf(id: number): { level: AgentLevel; by: string } { return agentLevel(this.layout, id, this.facts(id)); }
  private policyAt(id: number): Effective { return policyOver(this.layout, id, this.facts(id)); }
  /** The whole screen is locked (its own policy). */
  screenLocked(): boolean { return !!this.layout.policy.locked; }
  /** Where this screen lets the host layer (the drawer) appear: its policy's `host` (PIE-513), else over it. */
  hostMode(): HostMode { return this.layout.policy.host ?? "over"; }
  /** The docks shut now, outermost first (one inside a shut dock isn't reachable: its outer one's handle is). */
  private shutDocks(): Dock<number>[] {
    const out: Dock<number>[] = [];
    const walk = (n: LNode) => { if (n.t === "dock" && !n.open) { if (leaves(n.kid).length) out.push(n); return; } kidsOf(n).forEach(walk); };
    walk(this.root);
    return out;
  }
  /** A tile's dock, as `layout.get` and `peek` say it. */
  private dockView(id: number) {
    const d = dockOf(this.root, id);
    return d ? { dock: d.open ? "open" : "shut", edge: d.edge, ...(d.id ? { container: d.id } : {}) } : {};
  }
  /** What the policy over a tile says, when it says anything (locked, fixed in place, picky about kinds). */
  private policyView(id: number) {
    const e = this.policyAt(id);
    const out: Record<string, unknown> = {};
    if (e.locked) out.locked = e.by.locked;
    if (!e.draggable) out.draggable = false;
    if (!e.droppable) out.droppable = false;
    if (!e.closable) out.closable = false;
    if (!e.resizable) out.resizable = false;
    if (e.accepts) out.accepts = e.accepts;
    const ag = this.agentOf(id);
    return { ...(ag.level !== "free" ? { agents: ag.level, agentsBy: ag.by } : {}), ...(Object.keys(out).length ? { policy: out } : {}) };
  }

  moveTile(sel: string | undefined, to: string | undefined, where: Where, index: number | undefined, actor: Actor): TileDone {
    const src = this.tile(sel);
    let place: Place<number>;
    if (where.startsWith("edge-")) place = { kind: "edge", dir: where.slice(5) as Dir };
    else {
      if (!to) throw new ActionRefused(`layout.move: to=<tile> names the tile it goes ${where === "tabs" ? "into" : "beside"}`);
      const t = this.tile(to);
      place = where === "tabs" ? { kind: "tabs", target: t.id, index } : { kind: "split", target: t.id, dir: where as Dir };
    }
    // A tile dropped onto a spine opens it first, in the layout's one step (screen-layout.ts move).
    this.apply({ op: "move", tile: src.id, to: place }, actor);
    this.save(); this.redraw();
    return { tile: src.name, where, ...(to ? { to } : {}), tree: describeLayout(this.layout, id => this.nameOf(id)) };
  }

  /**
   * `tile.open`: a new tile beside (or in the tabs of) tile `at`. `link`: the tile whose opens land in it, linked in the
   * same layout step (tile.preview); `keys: false` leaves the person's keys where they are.
   */
  async openTile(given: NewTile, at: string | undefined, where: Where, actor: Actor, also: { link?: number; verb?: WireVerb; keys?: false } = {}): Promise<TileDone> {
    const t = canonSpec(given);
    if (t.outline) await outlineBoards(this.ctx).on({ outline: t.outline, machine: t.machine });
    const k = kindOf({ kind: t.kind } as Pane);
    if (!k || !isTileKind(t.kind)) throw new ActionRefused(`tile.open: kind is ${tileKindNames().join(", ")}, not ${t.kind}`);
    if (t.mode !== undefined && t.mode !== "held" && t.mode !== "pinned") throw new ActionRefused(`tile.open: mode is held or pinned (a reader that follows has none), not ${String(t.mode)}`);
    if (t.mode === "pinned" && !t.page) throw new ActionRefused("tile.open: a pinned reader names its page: tile.open kind=reader mode=pinned page=<name>");
    const bad = t.name !== undefined ? tileNameProblem(t.name) : null;
    if (bad) throw new ActionRefused(`tile.open: ${bad}`);
    if (t.name && this.idNamed(t.name) !== undefined) throw new ActionRefused(`there's already a tile named ${t.name}`);
    // From a float (a new note's, PIE-591) naming no tile: beside the tile under it, where esc in it goes back to.
    const under = at === undefined && this.isFloat(this.focus) ? this.grounded() : undefined;
    const empty = !this.all().length;
    const base = empty ? { id: this.focus, name: "home" } : this.tile(under !== undefined ? this.nameOf(under) : at);
    let spec: TileSpec = { t: "leaf", kind: t.kind, name: t.name ?? (t.mode ? this.autoName(this.wordFor(t)) : k.word && k.word !== t.kind ? this.autoName(k.word) : undefined), ...(t.mode ? { mode: t.mode } : {}), ...(t.cmd ? { cmd: lineWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.selectFrom ? { selectFrom: t.selectFrom } : {}), ...(t.outline ? { outline: t.outline, ...(t.machine ? { machine: t.machine } : {}) } : {}), ...(t.note ? { note: t.note } : {}), ...(t.page ? { page: t.page } : {}), ...(t.cwd ? { cwd: t.cwd } : {}), ...(t.view ? { view: t.view } : {}), ...(t.query ? { query: t.query } : {}), ...this.mountFields(t) };
    // The kind checks its fields (a preview's source) and fills what it starts with (it follows `at`).
    const wrong = k.check?.(spec);
    // Short of what it needs (a query tile with no view): the person picks it from the kind's choices, then it opens.
    if (wrong && k.choices && actor.kind !== "agent") {
      await this.askChoices(t.kind, more => this.run("tile.open", { ...t, ...more, to: base.name, where }, base.name));
      return { tile: base.name, picking: t.kind };
    }
    if (wrong) throw new ActionRefused(`tile.open: ${wrong}`);
    spec = canonSpec({ ...spec, ...(!empty ? k.defaults?.(spec, { name: base.name, pane: this.panes.get(base.id)! }) ?? {} : {}) });
    // The layout says yes (or why not) before the tile is made: a refused open starts no program.
    const id = this.nextId;
    const source = spec.selectFrom ? this.selectSource(spec.selectFrom) : undefined;
    const r = this.ask({ op: "open", tile: id, kind: t.kind, ...(spec.name ? { name: spec.name } : {}), at: empty ? { kind: "edge", dir: "right" } : placeOf(where, base.id), selectFrom: source?.ids, ...also }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    this.put(makeTile(spec));
    this.commit(r);
    if (source) this.wireSource(id, source);
    this.startTile(id);
    this.arrived(id, actor);
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind: t.kind, n: this.numberOf(id), beside: base.name, where, ...(also.link !== undefined ? { from: this.nameOf(also.link) } : {}) };
  }

  // ── mounts and groups (PIE-651) ──

  private outerChain: readonly string[] = [];
  /** The screens held one inside the next down to this one, outermost first: a mount here is refused when it is already in it. */
  mountChain(): string[] {
    const own = this.madeAs ?? (this.layoutName && madeScreen(this.layoutName) ? this.layoutName : this.spec.name);
    return [...this.outerChain, own];
  }
  /** A mount's fields from tile.open's (`target=` fills the screen's target argument: the board's hub). */
  private mountFields(t: NewTile): Partial<TileSpec> {
    if (!t.screen && t.inner === undefined) return {};
    const arg = t.screen ? screenTargetArg(t.screen) : undefined;
    if (t.target !== undefined && t.screen && !arg) throw new ActionRefused(`the ${t.screen} screen takes no target`);
    if (t.screen && !screenNames().includes(t.screen)) throw new ActionRefused(`no screen ${t.screen}; screens: ${screenNames().filter(n => n !== "desk").join(", ")}`);
    if (t.screen === "desk") throw new ActionRefused("the desk holds mounts; it isn't mounted in itself");
    const loop = t.screen ? mountProblem(this.mountChain(), t.screen, !!t.part) : null;
    if (loop) throw new ActionRefused(loop);
    if (t.part && t.screen) { const full = screenSpec(t.screen, t.target && arg ? { [arg]: t.target } : t.args); if (full && !screenParts(full).includes(t.part)) throw new ActionRefused(`the ${t.screen} screen has no part ${t.part}; its parts: ${screenParts(full).join(", ")}`); }
    const args = { ...(t.args ?? {}), ...(t.target !== undefined && arg ? { [arg]: t.target } : {}) };
    return { ...(t.screen ? { screen: t.screen } : {}), ...(Object.keys(args).length ? { args } : {}), ...(t.part ? { part: t.part } : {}), ...(t.label ? { label: t.label } : {}), ...(t.inner !== undefined ? { inner: t.inner } : {}) };
  }
  /** Tile `sel` is a group (tiles gathered into one, PIE-651). */
  isGroup(sel: string | undefined): boolean { const t = this.tileNamed(sel, false); const p = t ? this.panes.get(t.id) : undefined; return p instanceof ScreenTile && p.group; }

  /**
   * Gather tiles into a group (PIE-651, `tile.group`): tile `sel` (or the container `o.node`), with `o.with` beside it,
   * leave this layout whole into a new tile holding them as a screen of their own, in the place they leave. The layout
   * says yes first (the move rules, for each tile); their instances move, so nothing in them ends.
   */
  groupTile(sel: string | undefined, o: { node?: string; with?: string; where?: Dir; name?: string; label?: string }, actor: Actor): TileDone {
    if (o.name !== undefined) { const bad = tileNameProblem(o.name); if (bad) throw new ActionRefused(`tile.group: ${bad}`); }
    const t = this.tile(sel);
    const target = o.node !== undefined ? nodeById(this.root, o.node) ?? node(this.root, o.node) : null;
    if (o.node !== undefined && !target) throw new ActionRefused(`there's no container ${o.node} on the ${this.title}; layout.get names them`);
    const w = o.with !== undefined ? this.tile(o.with) : null;
    const inside = target ? leaves(target) : [t.id];
    if (w && inside.includes(w.id)) throw new ActionRefused(`${w.name} is gathered already`);
    const ids = [...inside, ...(w ? [w.id] : [])];
    return this.gather(t, target, ids, w, o, actor);
  }
  /** `tile.group` for the tiles selected: `ids` (in the layout's order) whole, as the group of them. */
  groupTiles(ids: number[], o: { where?: Dir; name?: string; label?: string }, actor: Actor): TileDone {
    if (!ids.length) throw new ActionRefused("tile.group: no tiles selected (shift+click a tile's title, or tile.select)");
    const order = leaves(this.root), flat = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const first = this.tileById(flat[0]!);
    return this.gather(first, null, flat, null, o, actor);
  }
  private tileById(id: number) { return { id, name: this.nameOf(id) }; }

  /**
   * The gathering both `groupTile` and `groupTiles` do: `ids` leave this layout whole into one group tile that takes the
   * place of `t` (or the container `target`). The group keeps their arrangement (`prune`): what was split stays split.
   * Links between a gathered tile and one that stays are kept (PIE-696), by path across the group's edge.
   */
  private gather(t: { id: number; name: string }, target: LNode | null, ids: number[], w: { id: number; name: string } | null, o: { node?: string; where?: Dir; name?: string; label?: string }, actor: Actor): TileDone {
    this.resolveExt();
    const inside = new Set(ids);
    for (const id of ids) this.bindFollows(id, this.panes.get(id)!);
    const specs = (id: number) => this.specIn(id, inside);
    let sub: SavedTree;
    if (target) sub = serializeTree(target as LNode, specs) as SavedTree;
    else if (!w && ids.length > 1) sub = serializeTree(this.prune(this.root, inside) ?? leaf(ids[0]!), specs) as SavedTree;
    else sub = specs(t.id) as SavedTree;
    if (w) {
      const before = o.where === "left" || o.where === "up";
      sub = { t: "split", dir: o.where === "up" || o.where === "down" ? "col" : "row", weights: [0.5, 0.5], kids: before ? [specs(w.id), sub] : [sub, specs(w.id)] } as SavedTree;
    }
    // The tiles outside that open into a gathered one: their links go to the group's, by path, once it has a name.
    const into: [number, WireVerb, string, AltRule | undefined][] = [];
    for (const { from: z, to, verb, rule } of this.layout.wires) if (inside.has(to) && !inside.has(z)) into.push([z, verb, this.nameOf(to), rule]);
    const gid = this.nextId;
    const r = this.ask({ op: "group", ...(target ? { node: o.node! } : { tile: t.id }), ...(w ? { take: [w.id] } : ids.length > 1 && !target ? { take: ids.filter(i => i !== t.id) } : {}), with: gid, kind: "screen", ...(o.name ? { name: o.name } : {}) }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    const given = new Map(ids.map(id => [this.nameOf(id), this.panes.get(id)!] as const));
    const gathered = ids.map(id => [id, this.panes.get(id)!] as const);
    const focusIn = ids.includes(this.focus) ? this.nameOf(this.focus) : this.nameOf(ids[0]!);
    const g = new ScreenTile("screen", { ...(o.label ? { label: o.label } : {}), inner: { root: sub, focus: focusIn } }, undefined, given);
    this.put(g);
    this.commit(r);
    for (const [id, p] of gathered) this.forgetTile(id, p);
    this.startTile(gid);
    for (const [z, verb, x, rule] of into) this.addExt(z, { path: `${this.nameOf(gid)}/${x}`, verb, rule });
    for (const id of ids) this.selected.forEach(set => set.delete(id));
    this.save(); this.redraw();
    return { tile: this.nameOf(gid), id: this.tileId(gid), grouped: [...given.keys()] };
  }

  /** Tile `id`'s spec as the group of `inside` holds it: a link to a tile that stays is by path out of the group (`../tree`). */
  private specIn(id: number, inside: ReadonlySet<number>): TileSpec {
    let spec = this.specOf(id);
    const pane = this.panes.get(id)!, b = boundSource.get(pane), f = kindOf(pane)?.follows?.(pane);
    const src = b && b !== NO_SOURCE ? this.idOf(b) : f ? this.idNamed(f) : undefined;
    if (f && typeof spec.source === "string" && src !== undefined && !inside.has(src)) spec = { ...spec, source: `tile:../${this.nameOf(src)}` };
    return { ...spec, wires: this.layout.wires.filter(w => w.from === id).map(w => ({ verb: w.verb, to: `${inside.has(w.to) ? "" : "../"}${this.nameOf(w.to)}`, ...(w.rule ? { rule: w.rule } : {}) })).concat((this.extSpec(id).wires ?? []).map(w => ({ ...w, to: w.to.startsWith("@") ? w.to : `../${w.to}` }))) };
  }
  /**
   * The layout tree cut down to the tiles in `keep`, in the arrangement they had: a split of them stays a split (its
   * weights kept in proportion), a tab set stays a tab set, and any other container (a dock, columns, a flow) lays what
   * it held of them side by side. Null when none of them is under `n`.
   */
  private prune(n: LNode, keep: ReadonlySet<number>): LNode | null {
    if (n.t === "leaf") return keep.has(n.id) ? n : null;
    if (n.t === "tabs") {
      const ids = n.ids.filter(i => keep.has(i));
      return !ids.length ? null : ids.length === 1 ? leaf(ids[0]!) : { t: "tabs", ids, active: Math.max(0, ids.indexOf(n.ids[n.active]!)) };
    }
    if (n.t === "dock") return this.prune(n.kid, keep);
    const kids: LNode[] = [], weights: number[] = [];
    n.kids.forEach((k, i) => { const x = this.prune(k, keep); if (x) { kids.push(x); weights.push(n.weights[i] ?? 1); } });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0]!;
    return { t: "split", dir: n.t === "split" ? n.dir : "row", kids, weights };
  }

  /** A group spills back (PIE-651): its tiles, as it laid them out, take its place here, whole. */
  ungroupTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel), g = this.panes.get(t.id);
    if (!(g instanceof ScreenTile) || !g.group) throw new ActionRefused(`${t.name} isn't a group (tile.group gathers tiles into one)`);
    const inner = g.inner;
    if (!inner) throw new ActionRefused(`${t.name} has nothing in it yet`);
    this.resolveExt();
    const out = inner.release();
    // Each tile under a new id here, in the tree the group had.
    const ids = new Map<number, number>();
    let next = this.nextId;
    for (const x of out.tiles) ids.set(x.id, next++);
    const tree = mapTree(out.tree, id => ids.get(id)!);
    const m = (id: number) => ids.get(id)!;
    const r = this.ask({
      op: "ungroup", tile: t.id, tree, names: out.tiles.map(x => [m(x.id), x.name] as [number, string]),
      folds: out.folds.filter(([k]) => ids.has(k)).map(([k, f]) => [m(k), f]), agents: out.agents.filter(([k]) => ids.has(k)).map(([k, l]) => [m(k), l]),
      wires: out.wires.filter(w => ids.has(w.from) && ids.has(w.to)).map(w => ({ ...w, from: m(w.from), to: m(w.to) })),
    }, actor);
    if (!r.ok) { inner.takeBack(out); throw new ActionRefused(r.refused); }
    for (const x of out.tiles) { const id = this.put(x.pane); this.movedIn.add(id); }
    this.commit(r);
    this.forgetTile(t.id, g);
    g.dispose();
    for (const x of out.tiles) this.startTile(ids.get(x.id)!, true);
    // A tile's link to one outside the group (or one outside to it) is across no edge now: the layout's own link.
    for (const [id, e] of out.ext) if (ids.has(id)) this.ext.set(ids.get(id)!, e);
    this.relink();
    this.save(); this.redraw();
    return { tile: t.name, spilled: out.tiles.map(x => this.nameOf(ids.get(x.id)!)) };
  }
  /**
   * Every tile leaves this desk whole (a group spilling back, PIE-651): the tree they were in (by this desk's ids), each
   * with its instance and name. Nothing ends; `takeBack` puts them back as they were when the other screen refuses them.
   */
  release(): { tree: LNode; tiles: { id: number; name: string; pane: Pane }[]; panes: Map<number, Pane>; folds: [number, Fold][]; agents: [number, AgentLevel][]; wires: TileWire[]; ext: [number, ExtLink[]][] } {
    if (this.floats.length) throw new ActionRefused(`${this.floats.map(f => this.nameOf(f.id)).join(", ")} float${this.floats.length === 1 ? "s" : ""} in it: put ${this.floats.length === 1 ? "it" : "them"} back first (^W f inside, ^W e goes in)`);
    const tiles = leaves(this.root).map(id => ({ id, name: this.nameOf(id), pane: this.panes.get(id)! }));
    for (const x of tiles) this.bindFollows(x.id, x.pane);
    const L = this.layout;
    const out = { tree: this.root, tiles, panes: new Map(this.panes), folds: [...L.collapsed].map(([k, v]) => [k, { ...v }] as [number, Fold]), agents: [...L.agents], wires: L.wires.map(w => ({ ...w })), ext: [...this.ext].map(([id, e]) => [id, e.map(w => ({ ...w }))] as [number, ExtLink[]]) };
    for (const x of tiles) this.forgetTile(x.id, x.pane);
    return out;
  }
  takeBack(out: { panes: Map<number, Pane>; ext: [number, ExtLink[]][] }) { for (const [id, p] of out.panes) this.panes.set(id, p); for (const [id, e] of out.ext) this.ext.set(id, e); }

  /** Why a mount can't open beside the focused tile here now (a locked desk), or null. */
  mountRefusal(actor: Actor): string | null {
    if (!this.panes.has(this.focus)) return null;
    const r = this.ask({ op: "open", tile: this.nextId, kind: "screen", at: placeOf("right", this.focus) }, actor);
    return r.ok ? null : r.refused;
  }
  /** Keep a desk made to ask (Desk.resume) for the next open of the desk, as leaving it with programs does. */
  static keep(d: Desk) { if (!Desk.kept) Desk.kept = d; }
  /** This screen can go on the desk as a mount (screen.mount): it's a registered screen, and not the desk or a mount. */
  mountable(): boolean { return this.spec.name !== "desk" && this.spec.name !== "group" && !this.onSave && screenNames().includes(this.spec.name) && !this.ctx?.hostLayer?.isDrawer(this); }
  /** The key of the nearest container around tile `sel` that has one (the board's lanes, readers): a part a mount can hold. */
  partAround(sel: string | undefined): string | null {
    const t = this.tileNamed(sel, false);
    if (!t) return null;
    const keys = chainOf(this.root, t.id).flatMap(c => ("key" in c && typeof c.key === "string" ? [c.key] : []));
    const known = new Set(screenParts(this.spec));
    return keys.reverse().find(k => known.has(k)) ?? null;
  }
  /**
   * `screen.mount` (PIE-651): this screen (or its part `part`) onto the desk as a mount. Popped out of a mount, it goes
   * back to it. Else the desk comes up (the one under this screen, else the desk running or a new one in this one's
   * place) with a mount beside its focused tile, carrying this screen's arrangement.
   */
  async mountOnDesk(part: string | undefined, actor: Actor): Promise<Record<string, unknown>> {
    if (!this.mountable()) throw new ActionRefused(this.spec.name === "desk" ? "this is the desk: tile.open kind=screen screen=<name> mounts a screen here" : `the ${this.title} can't go on the desk (it's no registered screen, or it's in a mount already)`);
    if (part !== undefined && !screenParts(this.spec).includes(part)) throw new ActionRefused(`the ${this.title} has no part ${part}; its parts: ${screenParts(this.spec).join(", ")}`);
    const from = this.poppedFrom;
    const ctx = this.ctx;
    if (from && part === undefined) {
      const name = from.desk.nameOfPane?.(from.tile);
      ctx.pop();
      if (name && actor.kind !== "agent") { await from.desk.perform?.("tile.expand", {}, USER, from.tile)?.catch(() => {}); from.desk.focusPane?.(from.tile, actor); }
      return { tile: name ?? null, back: true, screen: this.spec.name };
    }
    const stack = ctx.screens?.() ?? [];
    const under = stack.at(-2);
    const onDesk = under instanceof Desk && under.spec.name === "desk";
    const desk: Desk = onDesk ? under : Desk.resume();
    // The desk says yes before this screen goes: a locked desk refuses, and the person stays where they are.
    const no = desk.mountRefusal(actor);
    if (no) { if (!onDesk && desk !== under) Desk.keep(desk); throw new ActionRefused(`not put on the desk: ${no}`); }
    if (onDesk) ctx.pop(); else ctx.replace(desk);
    const arg = screenTargetArg(this.spec.name), target = this.screenOpenArgs?.target;
    const args = arg && typeof target === "string" ? { [arg]: target } : {};
    const models = this.savedState().models;
    const inner = part === undefined ? this.savedState() : models ? { models } : undefined;
    return await desk.openTile({ kind: "screen", screen: this.spec.name, ...(Object.keys(args).length ? { args } : {}), ...(part ? { part } : {}), ...(inner !== undefined ? { inner } : {}) }, undefined, "right", actor)
      .then(r => ({ ...r, screen: this.spec.name, ...(part ? { part } : {}) }));
  }

  closeTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    // A new note's tile (PIE-591) with its edit open: the edit is left first, as a click away leaves it (typed text
    // saved, else kept as unsent), or closed when nothing was typed (still empty, to the trash); then the tile closes.
    const nn = this.panes.get(t.id);
    if (actor.kind !== "agent" && madeFor(nn) && nn instanceof ReaderPane && nn.surface.drafting) {
      const why = this.ask({ op: "close", tile: t.id }, actor);
      if (!why.ok) throw new ActionRefused(why.refused);
      void this.closeNewNote(t.id, nn);
      return { tile: t.name, closing: true };
    }
    // A tile in a container that shuts its dock instead (the board's outline and backlinks, `shuts`): it does.
    if (chainOf(this.root, t.id).some(c => c.policy?.shuts)) return this.shutDockOf(t, actor);
    // Every rule (its container's, what keeps it, an edit, the last tile, the person's keys) is the module's.
    const r = this.ask({ op: "close", tile: t.id }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    if (nn?.clearsOnClose?.()) {
      nn.clearContent!();
      if (this.ptyIn === nn) this.ptyIn = null;
      this.redraw();
      return { tile: t.name, state: "empty" };
    }
    // Closing a tile with a program running ends the program: the person is asked twice, as quitting does.
    const pty = this.panes.get(t.id);
    if (pty instanceof PtyPane && pty.running) {
      const armed = this.closeArm && this.closeArm.id === t.id && Date.now() - this.closeArm.at < 3000;
      if (!armed) { this.closeArm = { id: t.id, at: Date.now() }; throw new ActionRefused(`${t.name} is running ${pty.title()} · closing ends it · ^W x again within 3s closes`); }
      this.closeArm = null;
    }
    const kind = this.panes.get(t.id)!.kind;
    // `pane`: its number on screen as it closed (pane.close's older answer, as tile.resize and tile.zoom give it).
    const n = String(this.numberOf(t.id));
    const into = this.openedInto(t.id), had = this.focus === t.id;
    this.commit(r);
    this.dropTile(t.id);
    // The person's tile opened into a container (the board's detail) closed: their keys go to the top float, else the
    // tile opens land in there now, else home.
    if (into !== undefined && had && actor.kind !== "agent") {
      const next = this.floats.at(-1)?.id ?? this.activeIn(into);
      if (next !== undefined) this.keysTo(next); else this.goHome();
    }
    // A program's tile beside a reader (ctrl+e, ctrl+t) the person closed: their keys go back to that reader.
    const from = this.openedFrom.get(t.id);
    this.openedFrom.delete(t.id);
    if (from !== undefined && had && actor.kind !== "agent" && this.panes.has(from)) this.keysTo(from);
    this.save(); this.redraw();
    return { tile: t.name, pane: n, kind };
  }

  /** `closeTile` on a new note's tile holding its edit (PIE-591): the edit left or closed, then the tile closed. */
  private async closeNewNote(id: number, rd: ReaderPane) {
    if (this.entered.in(rd)) this.entered.clear();
    const said = await this.press(rd, NOTE_ACTIONS, rd.surface.newAndUntouched() ? "edit.close" : "session.leave");
    const left = said && typeof said === "object" && "left" in said ? leaveSaid(said as Parameters<typeof leaveSaid>[0]) : null;
    if (left) this.ctx.flash(left, 10000);
    // Still open (a save still landing, a refusal kept it): the tile stays, and says why where it is.
    if (!this.panes.has(id) || rd.surface.drafting) return this.redraw();
    try { this.closeTile(this.nameOf(id), USER); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e), undefined, errorDetails(e)); }
  }

  /**
   * Shut the dock tile `t` is in (`shuts`: the board's outline and backlinks, whose lists stay theirs): pinned, the
   * container that shuts goes back into a dock first. The keys, if they were in it, go home (the spec's `home`).
   * The person's keys in it are theirs too: an agent doesn't.
   */
  private shutDockOf(t: { name: string; id: number }, actor: Actor): TileDone {
    this.dispatch.check("tile", actor, t.name, "an agent doesn't close it");
    const holder = chainOf(this.root, t.id).find(c => c.policy?.shuts)!;
    const had = this.focus, inside = leaves(holder).includes(had);
    if (!dockOf(this.root, t.id) && holder.id) this.apply({ op: "pin", tile: t.id, on: false, container: holder.id }, actor);
    const d = dockOf(this.root, t.id);
    if (d?.open) this.apply({ op: "slide", tile: t.id, open: false }, actor);
    if (inside && actor.kind !== "agent") this.goHome(); else if (this.all().includes(had)) this.focus = had;
    this.save(); this.redraw();
    return { tile: t.name, pane: t.name };
  }

  /**
   * Where Tab stops, in reading order: each tile shown, then the floats; columns (the board's lanes) are one stop, the
   * tile last in them, and a dock is one stop, its first tile (its list, not the preview beside it).
   */
  private tabStops(): number[] {
    const out: number[] = [], seen = new Set<string>();
    for (const id of visible(this.root)) {
      const c = chainOf(this.root, id).find(x => x.t === "columns" || x.t === "dock");
      if (!c) { out.push(id); continue; }
      const key = c.id ?? "";
      if (seen.has(key)) continue;
      seen.add(key);
      const at = c.t === "columns" ? this.lastIn.get(key) : undefined, ids = visible(c);
      out.push(ids.includes(this.focus) ? this.focus : at !== undefined && ids.includes(at) ? at : ids[0]!);
    }
    return [...out, ...this.floats.map(f => f.id)];
  }

  /** The tile the keys go back to (the spec's `home`: a tile, or the current tile of a container), if the screen has one. */
  private homeTile(): number | undefined {
    const h = this.spec.home;
    if (h === undefined) return undefined;
    const t = this.specTile(h);
    if (t !== undefined) return t;
    const c = node(this.root, h);
    if (!c) return undefined;
    const at = this.lastIn.get(c.id ?? h), ids = leaves(c).filter(id => this.panes.has(id));
    return at !== undefined && ids.includes(at) ? at : ids[0];
  }
  /** The person's keys home (the spec's `home`); none, nothing moves. */
  private goHome() { const h = this.homeTile(); if (h !== undefined && h !== this.focus) { this.keysTo(h); this.entered.clear(); } }
  /** Whether the keys are home now (in the home tile, or anywhere in the home container). */
  private atHome(): boolean {
    const h = this.spec.home;
    if (h === undefined) return true;
    const c = node(this.root, h);
    return c ? leaves(c).includes(this.focus) : this.idNamed(h) === this.focus;
  }
  /** The tile last given the keys in each columns container (by its id): its place for Tab and home. */
  private lastIn = new Map<string, number>();
  /** The last tile the keys were in that isn't a float: where esc in a float gives them back. */
  private lastGrounded: number | undefined;
  private grounded(): number | undefined {
    const g = this.lastGrounded;
    return g !== undefined && this.panes.has(g) && !this.isFloat(g) && visible(this.root).includes(g) ? g : this.tabStops().find(id => !this.isFloat(id));
  }
  /** Where the keys are now is the place of each columns container they're in. */
  private noteFocus() {
    if (!this.isFloat(this.focus)) this.lastGrounded = this.focus;
    for (const c of chainOf(this.root, this.focus)) if (c.t === "columns" && c.id) this.lastIn.set(c.id, this.focus);
    // A tile opened into a container that's given the keys is where the next open there lands.
    const k = this.openedInto(this.focus);
    if (k !== undefined && !this.isFloat(this.focus)) this.openedIn(k).active = this.focus;
  }

  startLink(sel: string | undefined, verb: WireVerb, ask: boolean): TileDone {
    const src = this.tile(sel);
    this.overlays.drop("policy");
    this.linking = ask ? { desk: this, from: src.id, verb } : null;
    this.redraw();
    return { tile: src.name, picking: ask ? verb : false };
  }

  linkTile(sel: string | undefined, to: string | undefined, actor: Actor, verb: WireVerb = "open", remove = false, rule?: AltRule): TileDone {
    const src = this.tile(sel);
    this.linking = null;
    if (to?.includes("/") && remove) {
      const why = refusal(this.layout, { op: "link", tile: src.id, verb }, this.layoutCtx(actor));
      if (why) throw new ActionRefused(why);
      const target = this.paneAtPath(to);
      for (const w of this.ext.get(src.id) ?? []) if (w.verb === verb && (w.path === to || (target && w.pane === target))) this.cutExt(src.id, w);
      this.save(); this.redraw();
      return { tile: src.name, link: null, verb };
    }
    if (to?.includes("/")) {
      const target = this.linkAcross(src.id, to, verb, actor, rule);
      this.save(); this.redraw();
      return { tile: src.name, link: this.pathTo(target) ?? to, verb };
    }
    const target = to ? this.tile(to).id : undefined;
    const removed = verb === "select" && (remove || !to) ? this.layout.wires.filter(w => w.from === src.id && w.verb === verb && (!to || w.to === target)).map(w => w.to) : [];
    const r = this.apply({ op: "link", tile: src.id, ...(target !== undefined ? { to: target } : rule ? { to: src.id } : {}), verb, remove, rule }, actor);
    for (const id of removed) this.selectSeeds.delete(id);
    for (const w of this.ext.get(src.id) ?? []) if (w.verb === verb && (verb !== "select" || !to)) this.cutExt(src.id, w);
    this.save(); this.redraw();
    return { tile: src.name, ...r.answer, link: to ?? null };
  }

  selectTab(sel: string | undefined, by: number | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const r = this.apply({ op: "tab", tile: t.id, ...(by ? { by } : {}) }, actor);
    this.save(); this.redraw();
    return { tile: String(r.answer.tile), tabs: r.answer.tabs as string[] };
  }

  focusTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const moved = t.id !== this.focus;
    this.apply({ op: "focus", tile: t.id }, actor);
    if (moved) { this.entered.clear(); this.panes.get(t.id)?.focused?.(this, actor); }
    // Its border cut the note's title (PIE-815): the whole title in the status line, as the person arrives.
    const p = this.panes.get(t.id);
    if (moved && actor.kind === "user" && this.cutTitles.has(t.id) && p instanceof ReaderPane && p.msg) this.ctx.flash(headedTitle(p.msg));
    // The person's keys back on an edit or comment of theirs left open there: they're in it again (PIE-785, PIE-812).
    if (moved && actor.kind === "user") this.reenter();
    this.save(); this.redraw();
    return { tile: t.name };
  }

  /** Reveal through the holding tiles too: a group's tab, spine or dock can hide a live target. */
  private revealPane(pane: Pane, actor: Actor, focus = false): void {
    const id = this.idOf(pane)!;
    const holder = this.holder;
    const parent = holder?.desk();
    if (parent) parent.revealPane(holder!.tile, actor, focus);
    else if (focus) this.ctx?.hostLayer?.goTo(pane, actor);
    this.apply({ op: "reveal", tile: id }, actor);
    if (focus) this.focusTile(this.nameOf(id), actor);
    this.save(); this.redraw();
  }

  /**
   * `tile.dock`: put the tile (its tab set, as one) in a dock where it is (`pin` false: tile.dock on=true), or take
   * its dock away so what it holds is back in the layout there (`pin` true: on=false); toggles by default. With `edge`, the dock slides from that
   * outer edge of the whole layout: a tile not in one is put in one there, a dock moves there.
   */
  dockTile(sel: string | undefined, pin: boolean | undefined, edge: Dir | "other" | undefined, actor: Actor, container0?: string): TileDone {
    const t = this.tile(sel);
    // A tile living in a dock's container (`shuts`: the board's outline, the list and its preview) goes in and out
    // of its dock with that container whole.
    const holder = chainOf(this.root, t.id).find(c => c.policy?.shuts);
    const pinned = !dockOf(this.root, t.id);
    const container = container0 ?? (holder?.id && pinned && pin !== true ? holder.id : undefined);
    // `other`: the opposite side to where it is now; pinned, it's moved into a dock there and pinned again.
    let edgeTo: Dir | undefined = edge === "other" ? undefined : edge;
    if (edge === "other") {
      const r = this.rectsNow().get(t.id), d = dockOf(this.root, t.id);
      const now: Dir = d ? d.edge : r && r.col + r.cols / 2 > this.area.col + this.area.cols / 2 ? "right" : "left";
      edgeTo = ({ left: "right", right: "left", up: "down", down: "up" } as const)[now];
      if (pinned) {
        this.apply({ op: "pin", tile: t.id, on: false, edge: edgeTo, ...(holder?.id ? { container: holder.id } : {}) }, actor);
        const back = this.apply({ op: "pin", tile: t.id, on: true }, actor);
        this.save(); this.redraw();
        return { tile: t.name, ...docked(back.answer), edge: edgeTo };
      }
    }
    const r = this.apply({ op: "pin", tile: t.id, ...(pin !== undefined ? { on: pin } : {}), ...(edgeTo ? { edge: edgeTo } : {}), ...(container !== undefined ? { container } : {}) }, actor);
    if (r.changed) this.save();
    this.redraw();
    return { tile: t.name, ...docked(r.answer) };
  }

  slideTile(sel: string | undefined, open: boolean | undefined, actor: Actor, container?: string): TileDone {
    const t = this.tile(sel);
    const r = this.apply({ op: "slide", tile: t.id, ...(open !== undefined ? { open } : {}), ...(container ? { container } : {}) }, actor);
    this.save(); this.redraw();
    return { tile: t.name, ...r.answer };
  }

  /** `layout.lock`: lock or unlock the whole screen (its own policy); default toggles. An agent undoes only its own. */
  lockScreen(on: boolean | undefined, actor: Actor): { locked: boolean; changed: boolean } {
    const r = this.apply({ op: "lock", ...(on !== undefined ? { on } : {}) }, actor);
    if (r.changed) { this.save(); this.redraw(); }
    return { locked: !!r.answer.locked, changed: r.changed };
  }

  /**
   * `tile.agent` (PIE-639): what an agent may do to tile `sel`: `free`, `edit` or `off` for the tile itself, `inherit` to take
   * the tile's own away so its container's and the screen's default say again, or (left out) the next level. An agent may only
   * tighten.
   */
  agentTile(sel: string | undefined, level: AgentLevel | "inherit" | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const was = this.agentOf(t.id).level;
    const want = level === "inherit" ? null : level ?? nextAgentLevel(was);
    const r = this.apply({ op: "agents", tile: t.id, level: want }, actor);
    if (r.changed) this.save();
    this.redraw();
    return { tile: t.name, ...r.answer, ...(r.changed ? { was } : {}) } as TileDone;
  }

  /**
   * `layout.policy`: change the policy of container `node` (an id from layout.get, or "screen"); left out, the
   * innermost container holding tile `sel`, else the screen. `set` fields are written, `clear` ones taken
   * away. While it's locked only `locked` itself changes.
   */
  setPolicy(sel: string | undefined, nodeSel: string | undefined, set: Policy, clear: string[], actor: Actor): { node: string; policy: Policy; effective?: Effective } {
    const t = sel ? this.tile(sel) : null;
    const r = this.apply({ op: "policy", ...(t ? { tile: t.id } : {}), ...(nodeSel ? { node: nodeSel } : {}), set, clear }, actor);
    this.save(); this.redraw();
    return { node: String(r.answer.node), policy: r.answer.policy as Policy, ...(t ? { effective: this.policyAt(t.id) } : {}) };
  }

  /** The policy over tile `sel` (or the focused one): each layer's, and what applies. */
  policyGet(sel: string | undefined): unknown {
    const t = this.tile(sel);
    return { tile: t.name, layers: policyLayers(this.layout, t.id, this.facts(t.id)).filter(l => l.policy && Object.keys(l.policy).length).map(({ by, policy }) => ({ by, policy })), effective: this.policyAt(t.id), containers: ["screen", ...chainOf(this.root, t.id).map(c => c.id ?? c.t)] };
  }

  /**
   * `tile.preview`: a reader beside tile `sel` where its opens land, opened and linked as one layout step, so what it
   * follows (a link, the tree's ⏎, a list's pick) shows there and the tile itself never navigates away. Which reader
   * is its kind's to say: what a preview of it follows (`previewSource`: a terminal's file, the board's card); a tile
   * that reads notes itself gets a detail, which keeps what's opened into it; any other tile a preview following its
   * selection. Its opens already landing in a tile: that one is shown instead (the person's keys go to it; an
   * agent's leaves them). `where` left out: beside it if it's wide, else below (`splitAxis`, the layout's one rule).
   */
  async previewTile(sel: string | undefined, where: Dir | undefined, actor: Actor): Promise<TileDone> {
    const t = this.tile(sel);
    const p = this.panes.get(t.id)!;
    // A flow's column already opens the next column (its open rule): a split inside it would end the trail.
    if (this.inFlow(t.id) && !(wireTarget(this.layout, t.id) !== undefined)) throw new ActionRefused(`${t.name} is a column of a flow: its opens already land in the next column`);
    const k = kindOf(p);
    const verb: WireVerb = k?.accepts?.notes && !k.previewSource ? "open" : "select";
    const had = verb === "select" ? selectTargets(this.layout, t.id)[0] : wireTarget(this.layout, t.id);
    const across = this.extTarget(t.id, verb);
    if (had === undefined && across) {
      across.desk.revealPane(across.pane, actor, actor.kind !== "agent");
      return { tile: this.pathTo(across.pane)!, from: t.name, existing: true, verb };
    }
    if (had !== undefined) {
      this.apply({ op: "reveal", tile: had }, actor);
      const name = this.nameOf(had);
      if (actor.kind !== "agent") this.focusTile(name, actor); else { this.save(); this.redraw(); }
      return { tile: name, from: t.name, existing: true, verb };
    }
    const r0 = this.rectsNow().get(t.id);
    const dir: Dir = where ?? (r0 && splitAxis(r0) === "col" ? "down" : "right");
    const name = this.autoName(`${t.name}-preview`);
    // Checked before the kind is asked (the board collapses its own strip for it): a refused name changes nothing.
    const bad = tileNameProblem(name);
    if (bad) throw new ActionRefused(`tile.preview: ${bad} · ^W v on a shorter-named tile, or tile.open name=… then tile.link`);
    // Asked of the layout before the kind is: a preview has nowhere to go beside a float or into a locked container.
    const why = refusal(this.layout, { op: "open", tile: this.nextId, kind: "preview", name, at: placeOf(dir, t.id), link: t.id, verb }, this.layoutCtx(actor));
    if (why) throw new ActionRefused(why);
    let spec: NewTile;
    try { spec = k?.previewSource ? { kind: "preview", source: await k.previewSource(p, t.name, actor) } : k?.accepts?.notes ? { kind: "reader", mode: "held" } : { kind: "preview", source: `tile:${t.name}` }; }
    catch (e) { throw e instanceof ActionRefused ? e : new ActionRefused(e instanceof Error ? e.message : String(e)); }
    return { ...await this.openTile({ ...spec, name }, t.name, dir, actor, { link: t.id, verb, keys: false }), verb };
  }

  // ── terminal tiles: what the terminal kind's actions (PTY_ACTIONS) change on the desk ──

  typeTerminal(name: string, p: PtyPane, text: string, actor: Actor): TileDone {
    if (!p.running) throw new ActionRefused(`${name}'s program isn't running · tile.restart runs it again`);
    p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
    return { tile: name, chars: text.length };
  }

  herdrTerminal(name: string, p: PtyPane, pane: string | undefined, on: boolean | undefined, _actor: Actor, agent?: string): TileDone {
    if (on === false) { p.herdr = null; return { tile: name, herdr: null }; }
    if (!pane) throw new ActionRefused("tile.herdr needs pane=<the Herdr pane's label>");
    if (!p.running) throw new ActionRefused(`${name}'s program isn't running`);
    p.herdr = { pane, ...(agent ? { name: agent } : {}) };
    this.redraw();
    return { tile: name, herdr: p.herdr };
  }

  /**
   * The person types in terminal tile `sel` (e, ⏎ or a click): every key but ctrl+] goes to its program. One that
   * exited runs again. `send`: bytes to give it first (ctrl+] twice sends a literal ctrl+]). An agent's would
   * take the person's keys, so it's refused: tile.type sends a program text without them.
   */
  enterTerminal(name: string, p: PtyPane, send: string | undefined): TileDone {
    if (this.panes.get(this.focus) !== p) throw new ActionRefused(`${name} doesn't have the keys · tile.focus first`);
    // The person going in (a click, e or ⏎) is them using it: its program's copy reaches their clipboard (PtyPane.copied).
    p.personClickAt = Date.now();
    if (!p.running && p.exited !== null) { p.restart(); return { tile: name, restarted: true }; }
    if (!p.running) throw new ActionRefused(`${name}'s program hasn't started`);
    this.ptyIn = p; this.chord = null;
    // Said by what its header calls it (the drawer's own tile: what runs in it, never its tile name).
    const said = (p as Pane).headName?.() ?? name;
    if (send) { p.input(send); this.ctx.flash(`sent ctrl+] to ${said}`); }
    else this.ctx.flash(`typing in ${said}`);
    return { tile: name, typing: true };
  }

  /** The person's keys leave this screen's terminal without a word (the drawer's keys went back to the screen shown). */
  stopTyping() { this.ptyIn = null; }

  /** Back to the door from the terminal the person types in (ctrl+]); ctrl+] again soon sends one to it. The person's only. */
  leaveTerminal(): TileDone {
    const p = this.ptyIn;
    if (!p) throw new ActionRefused("the person isn't typing in a terminal tile");
    this.ptyIn = null; this.chord = { pane: p, at: Date.now() };
    this.ctx.flash("back to the door");
    return { tile: this.nameOf(this.focus), typing: false };
  }

  /**
   * Find notes by text, as `/` does. An agent's (or anyone's with a query) answers the hits (the service's
   * search); the person's opens the search overlay (with the query typed in, when given), and ⏎ there runs `open`.
   */
  async searchNotes(query: string | undefined, limit: number | undefined, actor: Actor): Promise<unknown> {
    const q = query?.trim() ?? "";
    // The person's is the power bar in its notes scope (PIE-656): the same search, its hits beside the note read through a reader.
    if (actor.kind !== "agent") {
      if (!this.ctx.press) throw new ActionRefused("no power bar here: this screen isn't given the door's actions · ctrl+k from the door's own screens");
      await this.ctx.press("bar.open", { scope: "notes", ...(q ? { query: q } : {}) });
      return { bar: true, scope: "notes", query: q };
    }
    if (q.length < 2) throw new ActionRefused("search needs query=<at least 2 characters>");
    const hits = await this.ctx.board.search(q, Math.max(1, Math.min(100, limit ?? 30)), { near: this.current?.id });
    return { query: q, hits: hits.map((m, i) => ({ n: i + 1, id: m.id, title: subject(m), ...(prop(m, "work-id") ? { workId: prop(m, "work-id") } : {}) })) };
  }

  restartTerminal(name: string, p: PtyPane, _actor: Actor): TileDone {
    if (p.running) throw new ActionRefused(`${name} is still running`);
    p.restart();
    return { tile: name };
  }

  /** `tile.info`: the tile as `layout.get` lists it, with what it follows and where its opens land in plain words (PIE-855, ^W P's rows). */
  tileInfo(sel: string | undefined): unknown {
    const t = this.tile(sel), view = this.tileView(t.id) as Record<string, unknown>;
    return { ...view, follows: this.followsOf(t.id).says, opens: this.opensOf(t.id).says };
  }

  /**
   * `screen.save` (PIE-565): this screen, as it's laid out now, as the screen note named `name` (src/desk/screen-notes.ts):
   * written to the outline, so every door on it opens it (`--screen <name>`, `screen.open`, ^W r) and an agent reads it.
   * Saving under the name it already has writes its note again, at the revision this door read. The person's with no
   * name opens the prompt (^W w), the screen's own name typed in.
   */
  async saveScreen(name: string | undefined, actor: Actor): Promise<Record<string, unknown>> {
    if (name === undefined || !name.trim()) {
      if (actor.kind === "agent") throw new ActionRefused("screen.save needs name=<the screen's name>, as a person would type it (daily test saves as daily-test)");
      this.overlays.push(screenSaver(this.layoutName ? screenTitle(this.layoutName) : ""));
      this.redraw();
      return { prompt: true, name: this.layoutName };
    }
    // What was typed is the title; the name is its slug (daily test: daily-test). A name that can't be, said with one that can.
    const title = name.trim().replace(/\s+/g, " ");
    const refused = screenTitleProblem(title);
    if (refused) throw new ActionRefused(refused);
    name = screenSlug(title);
    // A screen as data (specData): this one's spec with the layout as it is now, never the file it keeps itself in.
    const { saves: _saves, stays: _stays, ...rest } = this.spec;
    const spec: ScreenSpec = { ...rest, name, title, layout: this.layoutSpec() };
    // The shape written, as it is now: a change made while the note is being written is still a change.
    const shape = this.shapeNow();
    let saved;
    try { saved = await saveScreenNote(this.ctx.board, spec, actor, this.layoutName === name ? this.madeBase : null); }
    catch (e) {
      // Changed elsewhere since this screen read it: the next save writes over the note as it is now (said in the refusal).
      if (e instanceof ScreenConflict && this.layoutName === name) this.madeBase = e.now;
      throw e;
    }
    const { note, created } = saved;
    this.layoutName = name;
    this.madeBase = { id: note.id, revision: note.revision };
    // A screen a person makes from blank (or one they made) is that screen now: its title, and what a session reopens.
    if (this.madeHere()) { this.title = title; this.madeAs = name; }
    this.savedAs = shape;
    this.settled = this.snapshotShape();
    this.save(); this.redraw();
    return { screen: name, title, ...(title !== name ? { slug: name } : {}), note: note.id, revision: note.revision, created, tiles: this.all().map(id => this.nameOf(id)) };
  }
  /**
   * ^W w's prompt chose `typed`: the save, as the person's. A save that is refused after all (the note changed since,
   * the service said no) puts the prompt back with what they typed, so nothing is lost and the reason is on the bar.
   */
  async saveFromPrompt(typed: string): Promise<void> {
    const r = await this.dispatch.press("screen.save", { name: typed });
    if (r === undefined) { this.overlays.push(screenSaver(typed)); this.redraw(); }
  }
  /** The name of the screen a person made that this desk shows (saved from blank, or opened by its name). */
  private madeAs: string | null = null;
  /** The screen note this screen was opened, laid out or last saved from, at the revision read then: what a save is checked against. */
  private madeBase: { id: string; revision: number } | null = null;
  /** The screen a person made that this desk shows, by name, while its note is there. */
  madeName(): string | null { return this.madeAs && madeScreen(this.madeAs) ? this.madeAs : null; }

  /**
   * `screen.delete`: the screen note named `name` to the outline's Trash, and the screen gone from every door's list.
   * The person's asks first (again within 3s deletes); a screen shown here stays as it is, now one of no name.
   */
  async deleteScreen(name: string, actor: Actor): Promise<Record<string, unknown>> {
    name = resolveScreen(name) ?? name;
    if (!madeScreen(name)) throw new ActionRefused(screenNames().includes(name) ? `${name} is a built-in screen: it can't be deleted` : `no screen ${name} that a person made · screen.list names them`);
    if (actor.kind !== "agent") {
      const armed = this.deleteArm?.name === name && Date.now() - this.deleteArm.at < 3000;
      if (!armed) { this.deleteArm = { name, at: Date.now() }; this.ctx.flash(`delete the screen ${name}? its note goes to the Trash · again within 3s deletes it`); return { screen: name, armed: true }; }
      this.deleteArm = null;
    }
    const n = await trashScreenNote(this.ctx.board, name, actor);
    if (this.madeAs === name) { this.madeAs = null; this.savedAs = null; }
    if (this.layoutName === name) this.layoutName = null;
    this.redraw();
    return { screen: name, note: n.id, trashed: true };
  }
  private deleteArm: { name: string; at: number } | null = null;
  /** This desk is a screen of the person's own (blank, or one they made), not a built-in with a name of its own. */
  private madeHere(): boolean { return this.madeAs !== null || !!madeScreen(this.spec.name) || (!!this.spec.layouts && !this.spec.saves); }
  /** The layout as last saved or loaded by name, to say on the hint row when it's changed since. */
  private savedAs: string | null = null;
  /** The screen's shape as saving it would write it, but not what its tiles show now (a detail's note, a reader's history) nor their ids. */
  private shapeNow(): string { return JSON.stringify({ ...this.saved(), rule: this.rule }, (k, v) => (k === "note" || k === "nav" || k === "id" ? undefined : v)); }

  /**
   * `layout.load`: lay this screen out as the screen named `name` (a screen note) or a built-in layout. Tiles with the same
   * name and kind are kept; one holding work the new layout has no place for goes in a shut dock. The person's with
   * no name opens the picker (^W r).
   */
  loadLayout(name: string | undefined, actor: Actor): { layout?: string; saved?: boolean; rule?: OpenRule; tiles?: string[]; kept?: string[]; picker?: boolean; layouts?: ReturnType<typeof layoutNames> } {
    if (name === undefined || !name.trim()) {
      if (actor.kind === "agent") throw new ActionRefused(`layout.load needs name=<a layout>: ${layoutNames().map(l => l.name).join(", ")}`);
      this.overlays.push(layoutPicker(layoutNames()));
      this.redraw();
      return { picker: true, layouts: layoutNames() };
    }
    name = resolveScreen(name) ?? name;
    const found = layoutNamed(name);
    if (!found) throw new ActionRefused(`no layout ${name}; layouts: ${layoutNames().map(l => l.name).join(", ")} (a screen you made is one: ^W w saves this one)`);
    if (!this.spec.layouts) {
      const desk = new Desk({ ...deskSpec(), layout: builtin("desk")! }, { saved: null });
      this.ctx.push(desk);
      return desk.loadLayout(name, actor);
    }
    // The lock, a container's lock the person set, their keys: the module says whether the screen may be laid out again.
    this.apply({ op: "load", name }, actor);
    this.entered.clear();
    this.ptyIn = null;
    const before = new Set(this.all());
    const was = this.layoutSpec();
    this.build(found.spec, true);
    this.recordChange(was, actor, `laid out ${name}`);
    this.layoutName = name;
    this.madeBase = madeScreen(name) ? { ...madeScreen(name)! } : null;
    this.savedAs = this.shapeNow();
    this.settled = this.snapshotShape();
    this.save(); this.redraw();
    // What it kept that the layout has no place for (a running program): in a shut dock, said.
    const kept = this.shutDocks().flatMap(d => leaves(d.kid)).filter(id => before.has(id) && this.holdsWork(this.panes.get(id)!)).map(id => this.nameOf(id));
    return { layout: name, saved: found.saved, rule: this.rule, tiles: this.all().map(id => this.nameOf(id)), ...(kept.length ? { kept } : {}) };
  }

  /**
   * A new tile of `t.kind` where tile `sel` is, in its place (the blank tile's rows: tile.open's fields, by one layout
   * operation, `replace`). The person's keys go to it when they were on the tile it replaces.
   */
  async replaceTile(sel: string | undefined, given: NewTile, actor: Actor): Promise<TileDone> {
    const t = canonSpec(given);
    const k = kindOf({ kind: t.kind } as Pane);
    if (!k || !isTileKind(t.kind)) throw new ActionRefused(`kind is ${tileKindNames().join(", ")}, not ${t.kind}`);
    const base = this.tile(sel);
    let spec: TileSpec = { t: "leaf", kind: t.kind, ...(t.name ? { name: t.name } : t.mode ? { name: this.autoName(this.wordFor(t)) } : {}), ...(t.mode ? { mode: t.mode } : {}), ...(t.cmd ? { cmd: lineWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.selectFrom ? { selectFrom: t.selectFrom } : {}), ...(t.outline ? { outline: t.outline, ...(t.machine ? { machine: t.machine } : {}) } : {}), ...(t.note ? { note: t.note } : {}), ...(t.view ? { view: t.view } : {}) };
    const wrong = k.check?.(spec);
    if (wrong) throw new ActionRefused(wrong);
    spec = canonSpec({ ...spec, ...(k.defaults?.(spec, { name: base.name, pane: this.panes.get(base.id)! }) ?? {}) });
    const id = this.nextId;
    const source = spec.selectFrom ? this.selectSource(spec.selectFrom) : undefined;
    const r = this.ask({ op: "replace", tile: base.id, with: id, kind: t.kind, ...(spec.name ? { name: spec.name } : {}), selectFrom: source?.ids }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    const old = this.panes.get(base.id)!;
    this.put(makeTile(spec));
    this.commit(r);
    this.dropTile(base.id);
    old.dispose?.();
    if (source) this.wireSource(id, source);
    this.startTile(id);
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind: t.kind, replaced: base.name };
  }

  /**
   * What a kind asks the person for when a new tile of it lacks something (a query tile's view): a picker of its
   * `choices`, each choice opening it through `then`. False when the kind asks for nothing.
   */
  async askChoices(kind: string, then: (spec: Partial<TileSpec>) => void): Promise<boolean> {
    const k = kindOf({ kind } as Pane);
    if (!k?.choices) return false;
    const c = await k.choices(this);
    this.overlays.push(choicePicker(c.title, c.items, it => then(it.spec)));
    this.redraw();
    return true;
  }

  /** The screens to open from here (the blank tile's o) in a picker: the ones people made, then the built-ins. */
  screenPicker() { this.overlays.push(screenPicker()); this.redraw(); }
  screensToOpen() { return screensToOpen(); }

  layouts() { return { current: this.layoutName, layouts: layoutNames() }; }
  layoutGet() {
    return { layout: this.layoutName, rev: this.layout.rev, rule: this.rule, focus: this.nameOf(this.focus), zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, locked: this.screenLocked(), ...this.savedPolicy(), tree: describeLayout(this.layout, id => this.nameOf(id), id => this.tileId(id)), floats: this.floats.map(f => ({ tile: this.nameOf(f.id), id: this.tileId(f.id), rect: this.floatRect(f) })), tiles: this.all().map(id => this.tileView(id)) };
  }

  /**
   * The screen's tiles in the layout tree's order, each with how deep it sits (a container inside a container is one
   * deeper), what it shows and how it's placed now: the power bar's tiles scope (PIE-656) lists them indented as the
   * tree. Floats come last. Reading it changes nothing.
   */
  tileOutline(): TileLine[] {
    const out: TileLine[] = [];
    const line = (id: number, depth: number, how: { tab?: boolean; shown?: boolean; docked?: boolean } = {}) => {
      const p = this.panes.get(id);
      if (!p) return;
      const m = this.showing(p);
      out.push({ id: this.tileId(id), name: this.nameOf(id), kind: p.kind, depth, label: this.displayTitle(id), showing: m ? { id: m.id, title: subject(m), ...(prop(m, "work-id") ? { workId: prop(m, "work-id") } : {}), ...(prop(m, "page") ? { page: prop(m, "page") } : {}) } : null,
        focused: id === this.focus, collapsed: this.collapsed.has(id), float: this.isFloat(id), docked: !!how.docked, tab: !!how.tab, shown: how.shown ?? true, ...(p instanceof ReaderPane && p.follows ? { mode: p.followMode } : {}) });
    };
    const walk = (n: LNode, depth: number, docked: boolean) => {
      if (n.t === "leaf") return line(n.id, depth, { docked });
      if (n.t === "tabs") { n.ids.forEach((id, i) => line(id, depth, { tab: n.ids.length > 1, shown: i === n.active, docked })); return; }
      const kids = kidsOf(n), inner = n === this.root ? depth : depth + 1;
      for (const k of kids) walk(k, inner, docked || n.t === "dock");
    };
    walk(this.root, 0, false);
    for (const f of this.floats) line(f.id, 0);
    return out;
  }

  /**
   * A program for a moment beside the reader the person is in (PIE-417): ctrl+e's editor, ctrl+t's picker. It runs in a
   * terminal tile with their keys, not over the whole door; when it exits, `done` hears its code, the tile closes and the
   * keys go back to the reader.
   */
  inTile(p: TileProgram, done: (code: number | null) => void): boolean {
    const at = this.focus;
    // A locked screen keeps its shape: the program runs over the whole door instead (as on a screen without tiles).
    if (!this.panes.has(at) || this.screenLocked()) return false;
    // In a flow (the river's columns) it is the next column, at reading width; elsewhere it splits beside, or below for a
    // program that wants width (a picker's list) when beside would leave it narrower than tall (`splitAxis`, the layout's
    // one rule). A tile not placed yet splits beside.
    const r0 = this.placed.rects.get(at);
    const dir = p.wide && r0 && splitAxis(r0, true) === "col" ? "down" : "right";
    const where: At<number> = this.inFlow(at) ? { kind: "next", from: at } : { kind: "split", target: at, dir };
    const r = this.ask({ op: "open", tile: this.nextId, kind: "pty", name: p.name, loose: true, at: where }, p.actor);
    if (!r.ok) return false;
    // Never kept in a layout (its program and files go with the door), so its spec is the door's own, never a saved one.
    const pane = new PtyPane({ cmd: p.cmd, ...(p.cwd ? { cwd: p.cwd } : {}), ...(p.file ? { file: p.file } : {}), ...(p.own ? { own: p.own } : {}), ...(p.shows ? { shows: p.shows } : {}), label: p.name, temp: true, output: p.output, ...(p.retain ? { rerun: () => { throw new ActionRefused("run this step again from the note to answer its form"); } } : {}) });
    const id = this.put(pane);
    this.commit(r);
    this.openedFrom.set(id, at);
    this.startTile(id);
    // The person was in the reader's edit: they come back into that edit (that session, never one opened since, an
    // agent's included), typing where they left off, if the keys were still in this tile when it closed.
    const from = this.panes.get(at), wasIn = from instanceof ReaderPane && this.entered.in(from) ? from.sessionOf() : null;
    pane.onExit = code => {
      // Its tile closed first (^W x, the door ending): it was ended, whatever it printed on its way out (a program that
      // reads its tile sees end-of-input), so it gave no answer: no code, and nothing it wrote is taken.
      done(this.panes.has(id) ? code : null);
      if (p.retain) { this.redraw(); return; }
      // Its keys come back to the reader when they were in the tile as it ended; a tile the person closed themselves
      // (^W x) gave them back to the reader as it closed (`openedFrom`), and they go on into the edit.
      const back = this.panes.has(id) ? this.focus === id : this.focus === at;
      this.openedFrom.delete(id);
      if (this.panes.has(id)) this.closeId(id);
      if (back && this.panes.has(at)) {
        this.keysTo(at);
        if (wasIn && from instanceof ReaderPane && this.panes.get(at) === from && from.sessionOf() === wasIn) this.entered.enter(from);
      }
      this.save(); this.redraw();
    };
    if (pane.startError) throw new Error(pane.startError);
    p.ready?.({
      focus: actor => this.dispatch.act({ action: "tile.focus", tile: this.nameOf(id) }, actor),
      start: (cmd, env, output, finished) => {
        pane.onExit = code => finished(this.panes.has(id) ? code : null);
        pane.replaceProgram(cmd, env, output);
      },
      stop: () => pane.kill(),
      dismiss: () => { if (this.panes.has(id)) this.closeId(id); this.redraw(); },
    });
    if (!p.actor || p.actor.kind === "user") { this.focus = id; this.ptyIn = pane; }
    this.redraw();
    return true;
  }

  // ── what the person sees, for agents: layout.get, view.get, view.subscribe (App diffs viewState) ──

  /** The layout's shape: what changes only when the layout does (not with what a tile shows). */
  private layoutShape() {
    return {
      name: this.layoutName, rev: this.layout.rev, rule: this.rule, zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, locked: this.screenLocked(), ...(this.layout.policy.agents ? { agents: this.layout.policy.agents } : {}), tree: layoutShapeOf(this.layout, id => this.nameOf(id), id => this.tileId(id)), floats: this.floats.map(f => ({ tile: this.nameOf(f.id), rect: this.floatRect(f) })),
      tiles: this.all().map(id => {
        const p = this.panes.get(id)!, link = this.linkOf(id), set = tabsOf(this.root, id), cover = this.cover(id);
        const dv = this.dockView(id);
        return {
          tile: this.nameOf(id), id: this.tileId(id), kind: p.kind, rect: this.hits.find(([x]) => x === id)?.[1] ?? null,
          ...(link !== undefined ? { link: this.nameOf(link) } : {}),
          ...this.linkView(id),
          ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), shown: set.ids[set.active] === id } : {}),
          ...("dock" in dv ? dv : this.isFloat(id) ? { float: true } : { pinned: true }),
          ...(this.collapsed.has(id) ? { collapsed: true, ...(this.collapsed.get(id)!.dir === "h" ? { collapsedDir: "h" } : {}) } : {}),
          ...(this.agentOf(id).level !== "free" ? { agents: this.agentOf(id).level } : {}),
          ...(cover ? { cover } : {}),
          ...(kindOf(p)?.describe?.(p, false) ?? {}),
        };
      }),
    };
  }

  /** One tile's view: what's in it, and where (its kind's `view`; a kind without one, its title). */
  private viewOf(id: number): { viewport: unknown; cursor?: unknown } {
    const p = this.panes.get(id)!;
    const visible = this.hits.some(([x]) => x === id);
    const v = kindOf(p)?.view?.(p, id === this.focus);
    return v ? { ...v, viewport: { visible, ...v.viewport } } : { viewport: { visible, title: p.title() } };
  }

  /** What `view.subscribe` publishes (App diffs it after each paint). */
  viewState(): ViewState {
    const f = this.panes.get(this.focus);
    return {
      focus: { tile: this.nameOf(this.focus), block: this.showing(f)?.id ?? null, ...(f instanceof PtyPane ? { file: f.file ?? null, typing: this.rawKeys() } : {}) },
      layout: this.layoutShape(),
      tiles: this.all().map(id => ({ tile: this.nameOf(id), ...this.viewOf(id) })),
      marks: this.markList(),
    };
  }

  viewGet(sel: string | undefined): unknown {
    if (sel) { const t = this.tile(sel); return { tile: t.name, ...this.viewOf(t.id), ...(this.panes.get(t.id) instanceof PtyPane ? { screen: (this.panes.get(t.id) as PtyPane).text() } : {}) }; }
    return { focus: this.viewState().focus, tiles: this.all().map(id => ({ tile: this.nameOf(id), ...this.viewOf(id) })) };
  }

  scrollTo(sel: string | undefined, at: { line?: number; text?: string; block?: string }, actor: Actor): TileDone {
    const t = this.tile(sel);
    const p = this.panes.get(t.id);
    if (!(p instanceof ReaderPane)) throw new ActionRefused(`${t.name} is a ${p?.kind} tile: view.scrollTo scrolls a reader (an nvim tile's view is the person's own; block.mark line=… points at a line)`);
    if (!p.msg) throw new ActionRefused(`${t.name} shows no note yet`);
    if (at.block && !p.msg.id.startsWith(at.block)) throw new ActionRefused(`${t.name} shows ${p.msg.id.slice(0, 8)}, not ${at.block}; open it there first (open id=${at.block} tile=${t.name})`);
    let line = at.line;
    if (line === undefined && at.text) {
      const i = p.msg.text.split("\n").findIndex(l => l.toLowerCase().includes(at.text!.toLowerCase()));
      if (i < 0) throw new ActionRefused(`no line in ${subject(p.msg)} has ${JSON.stringify(at.text)}`);
      line = i + 1;
    }
    if (line === undefined) throw new ActionRefused("view.scrollTo needs line=<n> or text=<words>");
    this.render(this.ctx);                     // the reader's rows as drawn now
    p.surface.scrollToLine(line);
    this.render(this.ctx);                     // and as they are after the scroll, for the answer
    this.redraw();
    return { tile: t.name, line, viewport: p.surface.viewport() };
  }

  // ── attention marks (PIE-423's door side) ──

  private markList() {
    return this.marksStore.list().map(m => ({ ...m, showing: m.block ? this.all().filter(id => this.showsBlock(id, m.block!)).map(id => this.nameOf(id)) : m.tile ? [m.tile] : [] }));
  }
  private showsBlock(id: number, block: string): boolean {
    return this.showing(this.panes.get(id))?.id === block;
  }
  /** The marks drawn on a tile: on the note it shows, or on lines of what it edits. */
  private marksOn(id: number): Mark[] {
    const name = this.nameOf(id);
    return this.marksStore.list().filter(m => (m.block ? this.showsBlock(id, m.block) : m.tile === name));
  }

  async markBlock(sel: string | undefined, m: { id?: string; line?: number; reason: string }, actor: Actor): Promise<unknown> {
    const by = whoOf(actor);
    const reason = m.reason.trim();
    if (!reason) throw new ActionRefused("block.mark needs reason=<a few words>");
    if (m.line !== undefined) {
      const t = this.tile(sel);
      const p = this.panes.get(t.id);
      if (!(p instanceof PtyPane) || !p.nvim) throw new ActionRefused(`${t.name} isn't an nvim tile the door is connected to; line= marks a line there`);
      const extmark = await p.nvim.mark(m.line, `${reason} · by ${authorName(by)}`, p.file);
      const mark = this.marksStore.add({ tile: t.name, line: m.line, file: p.file, extmark, reason, by });
      this.redraw();
      return { mark };
    }
    let block = m.id;
    if (!block) {
      const t = this.tile(sel);
      const p = this.panes.get(t.id);
      block = this.showing(p)?.id;
      if (!block) throw new ActionRefused(`${t.name} shows no note; block.mark id=<block id> names one`);
    } else {
      const found = await this.ctx.board.get(block);
      if (!found) throw new ActionRefused(`no block ${block}`);
      block = found.id;
    }
    const mark = this.marksStore.add({ block, reason, by });
    this.redraw();
    return { mark, showing: this.markList().find(x => x.n === mark.n)?.showing ?? [] };
  }

  async unmark(n: number | undefined, id: string | undefined, _actor: Actor): Promise<unknown> {
    const all = this.marksStore.list();
    const gone = n !== undefined ? all.filter(m => m.n === n) : id ? all.filter(m => m.block?.startsWith(id)) : this.marksOn(this.focus);
    if (!gone.length) throw new ActionRefused(n !== undefined ? `no mark ${n}` : "no mark there");
    for (const m of gone) {
      this.marksStore.remove(m.n);
      if (m.extmark !== undefined && m.tile) { const t = this.idNamed(m.tile); const p = t !== undefined ? this.panes.get(t) : null; if (p instanceof PtyPane) await p.nvim?.unmark(m.extmark, m.file).catch(() => {}); }
    }
    this.redraw();
    return { dismissed: gone.map(m => m.n) };
  }

  marks() { return { marks: this.markList() }; }

  nextMark(actor: Actor): TileDone | { mark: null } {
    const all = this.marksStore.list();
    if (!all.length) return { mark: null };
    this.markAt = (this.markAt + 1) % all.length;
    const m = all[this.markAt]!;
    const there = m.block ? this.all().find(id => this.showsBlock(id, m.block!)) : m.tile ? this.idNamed(m.tile) : undefined;
    if (there !== undefined) { this.focusTile(this.nameOf(there), actor); return { tile: this.nameOf(there), mark: m.n }; }
    if (m.block) {
      // Nowhere on screen: it opens where the focused tile's opens go (its link), else as the current note.
      void this.ctx.board.get(m.block).then(msg => { if (msg) this.setCurrent(msg, { from: this.panes.get(this.focus), link: true, reveal: true, by: actor }); }, () => {});
    }
    return { tile: this.nameOf(this.focus), mark: m.n };
  }
  private markAt = -1;
  private closeArm: { id: number; at: number } | null = null;

  // ── borders, evening out, swapping: actions too (a drag of a border ends in layout.resize) ──

  resizeBorder(at: { path?: string; split?: string }, border: number, share: number, actor: Actor) {
    const r = this.apply({ op: "resize", ...(at.split !== undefined ? { split: at.split } : {}), ...(at.path !== undefined ? { path: at.path } : {}), border, share }, actor);
    // During a border drag, desk.json is written once, on release.
    if (!this.drag) this.save();
    this.redraw();
    return r.answer as { split: string | undefined; path: string; border: number; share: number; tiles: string[] };
  }

  evenOut(actor: Actor) {
    this.apply({ op: "even" }, actor);
    this.save(); this.redraw(); return { even: true as const };
  }

  swapTile(sel: string | undefined, to: string, actor: Actor): TileDone {
    const a = this.tile(sel), b = this.tile(to);
    this.apply({ op: "swap", tile: a.id, with: b.id }, actor);
    this.save(); this.redraw();
    return { tile: a.name, with: b.name };
  }

  // ── tile.resize, tile.zoom, tile.float, and pane.split (PANE_ACTIONS) ──

  /** A tile by its number on screen (the one `peek` shows), its name, or the focused one; `n` its number. */
  private tileNumbered(sel?: string): { name: string; n: string; id: number } {
    const t = this.tileNamed(sel, false);
    if (t) return { name: t.name, n: String(this.numberOf(t.id)), id: t.id };
    const ids = this.all();
    throw new ActionRefused(`no tile ${sel} on the screen; tiles: ${ids.map((_, i) => i + 1).join(", ")}, their names, or focused`);
  }

  /**
   * A tile taken out because it's gone (its program ended, its source dropped it, a view replaced it): no rule keeps
   * it, but the screen's last tile stays. Its instance ends with it.
   */
  private closeId(id: number) {
    const r = this.ask({ op: "close", tile: id, gone: true });
    if (!r.ok || !r.changed) return;
    this.commit(r);
    this.dropTile(id);
  }
  /** A tile instance the layout no longer has: its program ended, its state let go. */
  private dropTile(id: number) {
    const p = this.panes.get(id);
    p?.dispose?.();
    if (p) this.forgetTile(id, p);
  }
  /** Everything this desk keeps about tile `id` that leaves it (closed, or moved whole to the drawer or another screen). */
  private forgetTile(id: number, p: Pane) {
    this.ctx?.agentPointers?.dropTile(this, this.tileId(id));
    if (this.ptyIn === p) this.ptyIn = null;
    if (this.chord?.pane === p) this.chord = null;
    if (this.pending?.pane === p) this.pending = null;
    if (p instanceof ReaderPane) {
      this.failedEdits.delete(p);
      if (this.entered.in(p)) this.entered.clear();
    }
    if (this.floatDrag?.id === id) this.floatDrag = null;
    if (this.linking?.desk === this && this.linking.from === id) this.linking = null;
    if (this.mouseTile?.id === id) this.mouseTile = null;
    if (this.headPress?.id === id) this.headPress = null;
    if (this.dragging?.src === id) this.dragging = null;
    for (const set of this.selected.values()) set.delete(id);
    for (const [k, v] of [...this.lastIn]) if (v === id) this.lastIn.delete(k);
    // (openedFrom is the closer's to read: a program's tile closed gives the keys back to its reader; takeOut clears it.)
    this.panes.delete(id); this.unregistered.delete(id); this.sourced.delete(id); this.movedIn.delete(id); this.ext.delete(id);
    for (const r of this.opened.values()) { r.ids = r.ids.filter(i => i !== id); if (r.active === id) r.active = null; }
  }
  /** Tiles moved here whole (from the drawer): when this screen goes for good, one still running goes back to the drawer. */
  private readonly movedIn = new Set<number>();

  /** `pane.split`: tile.open along the longer side (or `dir`): one code path, one rule. `pane` is the new tile's number. */
  async splitPane(sel: string | undefined, kind: string | undefined, dir: Axis | undefined, actor: Actor): Promise<PaneDone> {
    const at = this.tileNumbered(sel);
    const r = this.placed.rects.get(at.id) ?? { col: 0, row: 0, cols: 80, rows: 24 };
    const where: Where = (dir ?? splitAxis(r)) === "col" ? "down" : "right";
    const t = await this.openTile({ kind: (kind ?? "reader") as TileKindName }, at.name, where, actor);
    return { pane: String(t.n), kind: t.kind, beside: at.n, tile: t.tile };
  }

  /** `tile.resize`: the border of the innermost container along `axis` over the tile, moved by steps. `pane` is its number (the older answer). */
  resizeTile(sel: string | undefined, axis: Axis, by: number, actor: Actor): TileDone {
    const p = this.tileNumbered(sel);
    this.apply({ op: "grow", tile: p.id, axis, by }, actor);
    this.save(); this.redraw();
    return { tile: p.name, pane: p.n, axis, by };
  }

  /** `tile.zoom`: the tile fills the screen, or the screen comes back. */
  zoomTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    const p = this.tileNumbered(sel);
    const r = this.apply({ op: "zoom", tile: p.id, ...(on !== undefined ? { on } : {}) }, actor);
    this.redraw();
    return { tile: p.name, pane: p.n, zoomed: !!r.answer.zoomed };
  }

  /**
   * `tile.float`: pop tile `sel` out of the tree as a float over everything (its own rectangle), or put a float
   * back (beside the tile the person has; one opened into a container goes back into it). Refused where policy keeps the
   * tile where it is, and to an agent for the tile the person is typing in.
   */
  floatTile(sel: string | undefined, actor: Actor, on?: boolean): TileDone {
    const t = this.tile(sel), p = this.panes.get(t.id)!;
    // on=true|false (PIE-957): the state asked for, so a script that floats every tile never puts back one already floating.
    if (on !== undefined && on === this.isFloat(t.id)) return { tile: t.name, pane: t.name, floated: on, now: t.name } as TileDone;
    if (this.ctx?.hostLayer?.isDrawer(this)) throw new ActionRefused(`${t.name} is in the drawer: it doesn't float there · ^W a puts it on the screen, where it floats`);
    const key = this.openedInto(t.id), c = key !== undefined ? node(this.root, key) : null;
    // A float opened into a container (the board's readers row) goes back into it, as its last tile there; a full one
    // gives way, never a tile holding an edit or a comment, nor (for an agent) the one the person has.
    if (this.isFloat(t.id) && key !== undefined && c) {
      const at: At<number> = { kind: "in", key, weight: this.weightIn(key) };
      const asked = this.ask({ op: "float", tile: t.id, at }, actor);
      if (!asked.ok) throw new ActionRefused(asked.refused);
      this.apply({ op: "float", tile: t.id, at }, actor);
      const room = this.makeRoom(t.id, actor);
      if (room) this.ctx.flash(room);
      if (actor.kind !== "agent") { this.focus = t.id; this.noteFocus(); }
      this.save(); this.redraw();
      return { tile: t.name, pane: t.name, floated: false, now: t.name };
    }
    // A reader that follows something (the board's preview) stays where it follows: a copy of what it shows floats,
    // opened as the screen's opens are (its readers row's next detail).
    const into = this.opensIntoKey();
    if (!this.isFloat(t.id) && into && p instanceof ReaderPane && kindOf(p)?.follower) {
      if (!p.msg) throw new ActionRefused(`${t.name} shows nothing to float yet`);
      this.dispatch.check("tile", actor, t.name, "an agent doesn't float it");
      const fid = this.openNewIn(into, actor, { kind: "float", near: t.id });
      if (fid === undefined) throw new ActionRefused("not floated");
      (this.panes.get(fid) as ReaderPane).hold(p.msg, this);
      if (actor.kind !== "agent") this.keysTo(fid);
      this.save(); this.redraw();
      return { tile: t.name, pane: t.name, floated: true, now: this.nameOf(fid) };
    }
    const r = this.apply({ op: "float", tile: t.id }, actor);
    this.save(); this.redraw();
    return { tile: t.name, pane: t.name, floated: !!r.answer.floated, now: t.name };
  }

  /**
   * `tile.menu` (PIE-492): tile `sel`'s menu, its rows what the dispatcher would run there (`Dispatcher.menu`). The
   * person's opens over the screen at `at` ("col,row"), else under the tile's ⋯; an agent's answers the rows and draws
   * nothing, never taking the person's keys.
   */
  tileMenu(sel: string | undefined, at: string | undefined, actor: Actor, q = ""): TileDone {
    const t = this.tile(sel);
    const every: MenuRow[] = this.dispatch.menu(t.name, actor);
    // q= is what typing in the menu does: the rows that match, the power bar's matcher over label, group and key.
    const rows = q.trim() ? filtered(every, q, r => [r.label, r.group, r.key ? keyCaption(r.key) : ""]) : every;
    if (actor.kind === "agent") return { tile: t.name, rows, ...(q.trim() ? { of: every.length } : {}) };
    let anchor: { col: number; row: number; right?: boolean };
    if (at !== undefined) {
      const m = /^(\d+),(\d+)$/.exec(at.trim());
      if (!m) throw new ActionRefused(`tile.menu: at is col,row (screen cells from 0), not ${at}`);
      anchor = { col: Number(m[1]), row: Number(m[2]) };
    } else {
      // Under its ⋯ as last drawn, else under its top right corner.
      const b = this.menuButtons.find(x => x.id === t.id), r = this.rectsNow().get(t.id) ?? (this.isFloat(t.id) ? this.floatRect(this.floats.find(f => f.id === t.id)!) : undefined);
      anchor = b ? { col: b.from, row: b.row + 1, right: true } : r ? { col: r.col + r.cols - 1, row: r.row + 1, right: true } : { col: 0, row: 0 };
    }
    this.overlays.push(tileMenu<Desk>({ title: this.nameOf(t.id), rows: every, at: anchor, look: w => this.lookAt(this.panes.get(t.id)!, w).values, ...(q ? { q } : {}) }));
    this.redraw();
    return { tile: t.name, open: true, rows };
  }

  /** Tile `sel` as its menu shows it (TileNow): where it is, and why each tile operation would be refused there now. */
  tileNow(sel: string | undefined, actor: Actor): TileNow {
    const t = this.tile(sel), id = t.id, p = this.panes.get(id);
    const flow = chainOf(this.root, id).find((c): c is Flow<number> => c.t === "flow");
    const ask = (op: Op<number>) => { const r = this.ask(op, actor); return r.ok ? null : r.refused; };
    const inDrawer = !!this.ctx?.hostLayer?.isDrawer(this);
    return {
      altReader: this.layout.altReaders.has(id), float: this.isFloat(id), zoomed: this.zoom === id, collapsed: this.collapsed.has(id), dock: !!dockOf(this.root, id),
      shuts: chainOf(this.root, id).some(c => c.policy?.shuts), inDrawer, flow: !!flow,
      held: !!flow?.held?.some(h => columnOf(flow, h) === columnOf(flow, id)),
      listHeld: p && kindOf(p)?.hold ? kindOf(p)!.hold!.held(p) : null,
      running: p instanceof PtyPane && p.running ? p.title() : null,
      refused: op => {
        switch (op) {
          case "close": return ask({ op: "close", tile: id });
          case "float": return inDrawer ? `${t.name} is in the drawer: it doesn't float there` : ask({ op: "float", tile: id });
          case "zoom": return ask({ op: "zoom", tile: id });
          case "collapse": return ask({ op: "collapse", tile: id, on: !this.collapsed.has(id) });
          case "pin": return ask({ op: "pin", tile: id });
          case "drawer": return !this.ctx?.hostLayer ? "this door has no drawer here" : inDrawer ? null : this.takeRefusal(t.name, actor);
          case "widen": return ask({ op: "flow.widen", tile: id });
          case "hold": return ask({ op: this.layout.altReaders.has(id) ? "alt.hold" : "flow.hold", tile: id });
        }
      },
    };
  }

  /** Where tile `id`'s content was drawn (inside its frame, padding and measure), its frame at `r`. */
  private origin(id: number, r: Rect): Rect {
    return this.contents.get(id) ?? { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
  }
  /**
   * Screen cell `x`, `y` in tile `id` (its frame at `r`) as a cell of its content: a press in its padding or beside its
   * measure is the nearest cell of the content (a line's start or end), never nothing and never a cell the tile didn't draw.
   */
  private local(id: number, r: Rect, x: number, y: number): { x: number; y: number } {
    const c = this.origin(id, r), gutter = this.gutters.get(id);
    const popup = this.views.get(id)?.view.completion?.drawn;
    const pane = this.panes.get(id);
    if (pane instanceof ReaderPane && pane.surface.floatAt(x - c.col, y - c.row)) return { x: x - c.col, y: y - c.row };
    if (popup && y - c.row >= popup.row && y - c.row < popup.row + popup.items.length) return { x: x - c.col, y: y - c.row };
    if (gutter && x >= gutter.col && x < gutter.col + gutter.cols) return { x: x - gutter.col - gutter.cols, y: y - c.row };
    return { x: Math.max(0, Math.min(c.cols - 1, x - c.col)), y: Math.max(0, Math.min(c.rows - 1, y - c.row)) };
  }

  /** A right-click at screen cell `x`, `y` in tile `id` (drawn at `r`) is the tile's own (a program that asked for the mouse, a step's box). */
  private ownsRightClick(id: number, r: Rect, x: number, y: number): boolean {
    if (y <= r.row || x <= r.col || x >= r.col + r.cols - 1 || y >= r.row + r.rows - 1) return false;
    const at = this.local(id, r, x, y);
    return !!this.panes.get(id)?.ownsRightClick?.(at.x, at.y);
  }

  /** `float.place`: move or size a float, kept on the screen. */
  placeFloat(sel: string | undefined, a: { dx?: number; dy?: number; col?: number; row?: number; cols?: number; rows?: number }, actor: Actor): TileDone {
    const t = sel ? this.tile(sel) : null;
    const r = this.apply({ op: "place", ...(t ? { tile: t.id } : {}), ...a }, actor);
    if (!this.floatDrag) this.save();
    this.redraw();
    return r.answer as TileDone;
  }

  /**
   * `tile.collapse`: fold tile `sel` to a spine where it is, or open it again. It folds only side by side with
   * others (a row or columns), where its container's policy lets it; an agent never folds the tile the person has.
   */
  collapseTile(sel: string | undefined, on: boolean | undefined, actor: Actor, dir?: "v" | "h"): TileDone {
    if (sel !== "all" && this.ctx?.hostLayer?.isDrawer(this)) return this.ctx.hostLayer.collapse(this.tile(sel).name, on, actor);
    // tile=all opens every spine (alt+c on the board): each its own step, one the layout keeps folded (and why) said.
    if (sel === "all") {
      if (on !== false) throw new ActionRefused("tile=all only reopens every spine (on=false); fold tiles one by one");
      const reopened: string[] = [], kept: string[] = [];
      for (const id of [...this.collapsed.keys()]) {
        const r = this.ask({ op: "collapse", tile: id, on: false }, actor);
        if (r.ok) { this.commit(r); reopened.push(this.nameOf(id)); } else kept.push(`${this.nameOf(id)}: ${r.refused}`);
      }
      this.save(); this.redraw();
      return { tile: "every spine", reopened, ...(kept.length ? { kept } : {}) } as TileDone;
    }
    // No tile named while the keys are in columns (the board's lanes): the reader following them, as reader.collapse took it.
    const via = !sel || sel === "focused" ? this.readerOfFocus() : undefined;
    const t = via ? { id: this.idOf(via)!, name: this.nameOfPane(via) } : this.tile(sel);
    // A fold asked for the way it already is, or a toggle of one folded: opens. A fold of the other way refolds it.
    const r = this.apply({ op: "collapse", tile: t.id, ...(on !== undefined ? { on } : dir && this.collapsed.has(t.id) && (this.collapsed.get(t.id)!.dir ?? "v") !== dir ? { on: true } : {}), ...(dir ? { dir } : {}) }, actor);
    if (r.changed) this.save();
    // The person's fold says what it kept (an agent's is said by the action's own words).
    const p = this.panes.get(t.id);
    if (actor.kind !== "agent" && r.changed && r.answer.collapsed && p instanceof ReaderPane) {
      if (this.pending?.pane === p) this.pending = null;              // an edit still opening there doesn't open behind a spine
      this.ctx.flash(`${(p instanceof ReaderPane ? p.detailLabel() : null) ?? t.name} collapsed${p.holdsKeys ? `, keeping ${sessionName(p)}` : ""} · ⏎ or a click opens it`);
    }
    this.redraw();
    return { tile: t.name, ...r.answer } as TileDone;
  }

  /** `tile.widen`: the tile's flow column takes the wide place (the column read before stays full); the keys stay. */
  /**
   * The tile `dir` of tile `sel` (or the focused one), by name: in a flow, the column before or after (a column off its
   * strip too; the focus brings it on), else the tile placed that way.
   */
  neighbourOf(sel: string | undefined, dir: Dir): string {
    const t = this.tile(sel);
    const flow = chainOf(this.root, t.id).find(c => c.t === "flow");
    if (flow && "kids" in flow && (dir === "left" || dir === "right")) {
      const ci = columnOf(flow, t.id), to = flow.kids[ci + (dir === "left" ? -1 : 1)];
      if (!to) throw new ActionRefused(`no column ${dir === "left" ? "before" : "after"} ${t.name}`);
      return this.nameOf(leaves(to)[0]!);
    }
    const n = neighbour(this.rectsNow(), t.id, dir);
    if (n === null) throw new ActionRefused(`no tile ${dir} of ${t.name}`);
    return this.nameOf(n);
  }

  /** DeskApi.travelPeek: the title of the column back (-1) or forward (1) from tile `p`'s column goes to, if any. */
  travelPeek(p: Pane, dir: -1 | 1): string | null {
    const id = this.idOf(p), flow = id === undefined ? undefined : chainOf(this.root, id).find((c): c is Flow<number> => c.t === "flow");
    if (!flow || id === undefined) return null;
    const ci = columnOf(flow, id), to = travelTarget(flow, ci, dir), t = to < 0 ? undefined : tileOfColumn(flow, to);
    const q = t === undefined ? undefined : this.panes.get(t);
    return q ? q.headName?.() ?? q.title() : null;
  }

  /** `tile.travel`: back (-1) or forward (1) in tile `sel`'s flow, the column it was opened from or the one back left. The person's keys. */
  travelTile(sel: string | undefined, dir: -1 | 1, actor: Actor): TileDone {
    const t = this.tile(sel);
    const r = this.apply({ op: "flow.travel", tile: t.id, dir }, actor);
    this.entered.clear();
    this.panes.get(this.focus)?.focused?.(this, actor);
    this.save(); this.redraw();
    return { tile: String(r.answer.tile ?? this.nameOf(this.focus)), from: t.name };
  }

  /**
   * `tile.hold`: tile `sel`'s column resists compression in its flow (the river's `p`), or lets go; default toggles. A
   * list its kind lets hold (a #tag's list, PIE-855) is held off its home instead: it keeps what it lists and the next
   * tag opens a list of its own. Let go, it is its home's list again, unless another list already is (said, refused).
   */
  holdReader(pane: ReaderPane, actor: Actor): void {
    const id = this.idOf(pane);
    if (id !== undefined && this.layout.altReaders.has(id)) {
      this.apply({ op: "alt.hold", tile: id }, actor);
      this.save(); this.redraw();
    }
  }

  holdTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    const t = this.tile(sel), p = this.panes.get(t.id), k = kindOf(p);
    if (this.layout.altReaders.has(t.id) && on !== false) {
      this.apply({ op: "alt.hold", tile: t.id }, actor);
      this.save(); this.redraw();
      return { tile: t.name, held: true };
    }
    const was = p && k?.hold ? k.hold.held(p) : null;
    if (p && k?.hold && was !== null) {
      const to = on ?? !was;
      if (!to && was) {
        const home = k.home?.(p) ?? null;
        const other = home === null ? undefined : this.all().find(i => { const q = this.panes.get(i); return q !== p && !!q && kindOf(q) === k && k.hold!.held(q) === false && k.home?.(q) === home; });
        if (other !== undefined) throw new ActionRefused(`${this.nameOf(other)} is ${home}'s list now: close it or hold it (p in it) before letting ${t.name} go`);
      }
      k.hold.set(p, to);
      this.save(); this.redraw();
      return { tile: t.name, held: to, ...(to !== was ? {} : { changed: false }) };
    }
    const r = this.apply({ op: "flow.hold", tile: t.id, ...(on !== undefined ? { on } : {}) }, actor);
    this.save(); this.redraw();
    return { tile: t.name, held: !!r.answer.held };
  }

  // ── the drawer (PIE-498): a tile leaves a screen whole, or comes into one, its program, note and history with it ──

  /**
   * `tile.drawer`: tile `sel` goes into the drawer (on=true; default here), the host layer's tabs that travel with the
   * person across screens, or, from the drawer, back into the screen shown (on=false), beside `to` (where=). The host
   * layer does it (`Ctx.hostLayer`): this screen's part is `takeOut` and `bringIn`, each one layout operation.
   */
  drawerTile(sel: string | undefined, on: boolean | undefined, to: string | undefined, where: Where | undefined, actor: Actor): TileDone {
    const host = this.ctx?.hostLayer;
    if (!host) throw new ActionRefused("this door has no drawer here (the logon and the logoff have none)");
    const t = this.tile(sel);
    if (host.isDrawer(this)) {
      if (on === true) return { tile: t.name, inDrawer: true, changed: false };
      return host.take(t.name, to, where, actor);
    }
    // From a screen, on=false brings the drawer's tab shown here, beside tile= (^W A); a tile in the drawer by name is the drawer's own request.
    if (on === false) {
      const shown = host.shownTab();
      if (!shown) throw new ActionRefused("the drawer shows nothing to bring here");
      return host.take(shown, to ?? t.name, where, actor);
    }
    return host.put(this, t.name, actor);
  }

  /** Why tile `sel` can't leave this screen now, or null (nothing is done). `heir`: a new tile would take its place. */
  takeRefusal(sel: string | undefined, actor: Actor, heir = false): string | null {
    const t = this.tileNamed(sel, false);
    if (!t) return `no tile ${sel} on the ${this.title}`;
    // A screen of a fixed shape that saves comes back only with every tile its spec names: they stay.
    if (this.spec.saves && !this.spec.layouts && leafNames(this.spec.layout.root).includes(t.name) && !this.ctx?.hostLayer?.isDrawer(this)) return `${t.name} stays: the ${this.title} is laid out with it (its spec names it)`;
    const r = this.ask({ op: "take", tile: t.id, ...(heir ? { heir: { id: this.nextId } } : {}) }, actor);
    return r.ok ? null : r.refused;
  }
  /**
   * Tile `sel` leaves this screen whole (the layout's `take`), for the drawer or a screen from it: its instance goes,
   * nothing of it ends (a terminal's program runs on, a reader keeps its note, its history and its draft).
   */
  takeOut(sel: string | undefined, actor: Actor, heir?: Pane, keepLinks = false): MovedTile {
    const why = this.takeRefusal(sel, actor, !!heir);
    if (why) throw new ActionRefused(why);
    const t = this.tile(sel);
    const pane = this.panes.get(t.id)!;
    // Its links go with it (a group's edge, PIE-696): where it opens into, and the tiles that open into it, are tiles of another desk now.
    const links: ExtLink[] = [];
    const into: [number, WireVerb, AltRule | undefined][] = [];
    const agents = keepLinks ? this.layout.agents.get(t.id) : undefined, fold = keepLinks ? this.layout.collapsed.get(t.id) : undefined;
    {
      this.resolveExt();
      for (const w of this.layout.wires) {
        if (!keepLinks && w.verb !== "select") continue;
        if (w.from === t.id && w.to !== t.id && this.panes.has(w.to)) links.push({ pane: this.panes.get(w.to), verb: w.verb, rule: w.rule, found: true });
        if (w.to === t.id && w.from !== t.id) into.push([w.from, w.verb, w.rule]);
      }
      links.push(...(this.ext.get(t.id) ?? []).filter(w => keepLinks || w.verb === "select").map(w => ({ ...w })));
    }
    const spec = this.specOf(t.id);
    const typing = pane === this.ptyIn && this.focus === t.id;
    // A follower (a preview of a tile) leaving: bound to the tile it follows by identity (none here: to nothing).
    this.bindFollows(t.id, pane);
    const hid = this.nextId;
    this.commit(this.ask({ op: "take", tile: t.id, ...(heir ? { heir: { id: hid } } : {}) }, actor));
    this.forgetTile(t.id, pane);
    this.openedFrom.delete(t.id);
    // Its heir takes its place and its name: a new tile of its kind, started as any tile joining a live desk.
    if (heir) { this.put(heir); this.startTile(hid); }
    for (const [z, verb, rule] of into) this.addExt(z, { pane, verb, rule, found: true });
    this.save(); this.redraw();
    return { pane, name: t.name, spec, from: this.title, typing, links, ...(agents ? { agents } : {}), ...(fold ? { fold: { ...fold } } : {}) };
  }
  // ── picking tiles to gather into a group (PIE-696) ──

  /** The tiles picked to gather (tile.select), per actor: the person's own and each agent's own; an actor changes only its own. */
  private readonly selected = new Map<string, Set<number>>();
  private pickKey(actor: Actor): string { return actor.kind === "agent" ? `agent:${actor.id}` : "person"; }
  /** The tiles `actor` has picked, in the layout's order. */
  pickedBy(actor: Actor): number[] {
    const set = this.selected.get(this.pickKey(actor));
    return set ? this.all().filter(i => set.has(i)) : [];
  }
  /** Tile `sel` is one `actor` has picked. */
  isPicked(sel: string | undefined, actor: Actor): boolean { const t = this.tileNamed(sel, false); return !!t && !!this.selected.get(this.pickKey(actor))?.has(t.id); }
  /** `tile.select`: pick tile `sel`, let it go, or (`clear`) let go of all of `actor`'s picks. Nothing else moves: no focus, no layout. */
  selectTile(sel: string | undefined, on: boolean | undefined, clear: boolean, actor: Actor): TileDone {
    const key = this.pickKey(actor);
    if (clear) { this.selected.get(key)?.clear(); this.redraw(); return { tile: this.nameOf(this.focus), cleared: true, selected: [] as string[], by: key }; }
    const t = this.tile(sel);
    if (this.isFloat(t.id)) throw new ActionRefused(`${t.name} floats: a float isn't gathered into a group (^W f puts it back first)`);
    let set = this.selected.get(key);
    if (!set) this.selected.set(key, set = new Set());
    if (on ?? !set.has(t.id)) set.add(t.id); else set.delete(t.id);
    this.redraw();
    return { tile: t.name, picked: set.has(t.id), selected: this.pickedBy(actor).map(i => this.nameOf(i)), by: key };
  }
  /** The split `sel` is in, when there is a choice to offer: its id and the tiles in it. */
  gatherOffer(sel: string | undefined): { node: string; names: string[] } | null {
    const t = this.tile(sel);
    if (this.isFloat(t.id)) return null;
    const c = [...chainOf(this.root, t.id)].reverse().find(x => x.t === "split");
    const ids = c ? leaves(c as LNode) : [];
    const node = c?.id ?? c?.key;
    return c && node && ids.length > 1 ? { node, names: ids.map(i => this.nameOf(i)) } : null;
  }
  /** ^W G in a split: the person chooses this tile or the whole split (a list picker, the tile menu's own kind). */
  askGather(sel: string | undefined, offer: { node: string; names: string[] }): TileDone {
    const t = this.tile(sel);
    const rows: { label: string; args: Record<string, unknown> }[] = [
      { label: `this tile · ${t.name}`, args: {} },
      { label: `the whole split · ${offer.names.join(", ")}`, args: { node: offer.node } },
    ];
    this.overlay(new ListPicker<{ label: string; args: Record<string, unknown> }, Desk>({
      name: "gather", hint: GATHER_HINT, items: () => rows, clickChooses: true,
      row: (it, _i, on, w) => [...pickRows(` ${it.label}`, on, w)],
      choose: (it, _i, d) => void d.run("tile.group", it.args, t.name),
      frame: (a, n) => ({ rect: centred(a, Math.min(72, a.cols - 4), n + 2), title: "gather into a group" }),
    }));
    return { tile: t.name, asked: true };
  }

  /** This screen is a group's: its tiles can go back out. */
  inGroup(): boolean { const h = this.holder; return !!h && h.tile instanceof ScreenTile && h.tile.group && !!h.desk(); }
  /** The groups on this screen that tile `sel` could go into (not itself). */
  groupsFor(sel: string | undefined): string[] {
    const t = this.tileNamed(sel, false);
    return [...this.panes].filter(([id, p]) => p instanceof ScreenTile && p.group && !!p.inner && id !== t?.id).map(([id]) => this.nameOf(id));
  }
  /** ^W i with several groups: the person picks which one. */
  askGroup(sel: string | undefined, groups: string[]): TileDone {
    const t = this.tile(sel);
    this.overlay(new ListPicker<string, Desk>({
      name: "into a group", items: () => groups, clickChooses: true,
      row: (g, _i, on, w) => [...pickRows(` ${g}`, on, w)],
      choose: (g, _i, d) => void d.run("layout.move", { into: g }, t.name),
      frame: (a, n) => ({ rect: centred(a, Math.min(50, a.cols - 4), n + 2), title: `move ${t.name} into` }),
    }));
    return { tile: t.name, asked: true };
  }

  /** Tile `sel` is a mount of tiles gathered here: the group tile and its desk. */
  private groupOf(sel: string | undefined): { name: string; pane: ScreenTile; desk: Desk } {
    const g = this.tile(sel), p = this.panes.get(g.id);
    if (!(p instanceof ScreenTile) || !p.group) throw new ActionRefused(`${g.name} isn't a group (tile.group gathers tiles into one)`);
    if (!p.inner) throw new ActionRefused(`${g.name} has no tiles of its own yet`);
    return { name: g.name, pane: p, desk: p.inner };
  }
  /**
   * `layout.move into=<group>`: tile `sel` goes into a group whole (PIE-696), beside `beside` (one of the group's tiles;
   * its focused one when left out), `where` it (right, left, up, down, tabs). A running program, its agent policy, spine
   * and links come with it, as a group's gathering and spill do: the tile leaves this layout (`takeOut`) and joins the
   * group's (`bringIn`), the way a tile goes to the drawer.
   */
  moveIntoGroup(sel: string | undefined, into: string, beside: string | undefined, where: Where, actor: Actor): TileDone {
    const t = this.tile(sel);
    const g = this.groupOf(into);
    if (this.panes.get(t.id) === g.pane) throw new ActionRefused(`${t.name} is the group: a group doesn't go into itself`);
    const out = this.takeRefusal(t.name, actor);
    if (out) throw new ActionRefused(out);
    const kind = (this.panes.get(t.id) as { kind?: string } | undefined)?.kind ?? "tile";
    const bad = g.desk.bringRefusal({ name: t.name, spec: { t: "leaf", kind } }, beside, where, actor);
    if (bad) throw new ActionRefused(`${g.name} doesn't take ${t.name} there: ${bad}`);
    const keys = t.id === this.focus && actor.kind !== "agent";
    const moved = this.takeOut(t.name, actor, undefined, true);
    let done: TileDone;
    try { done = g.desk.bringIn(moved, beside, where, actor); }
    catch (e) { try { this.bringIn(moved, undefined, undefined, actor); } catch { /* nowhere: said below */ } throw e; }
    // The person's keys were in it: they stay with it, now in the group.
    if (keys) { this.focusTile(g.name, actor); g.desk.focusTile(String(done.tile), actor); }
    this.save(); this.redraw();
    return { ...done, into: g.name, from: this.title };
  }
  /**
   * `layout.move out=true` on a tile of a group's screen: it goes back out onto the screen holding the group (PIE-696),
   * beside `beside` (a tile there; the group itself when left out). The same whole move the other way. A group's last
   * tile spills the group instead: nothing is left to hold.
   */
  moveOutOfGroup(sel: string | undefined, beside: string | undefined, where: Where, actor: Actor): TileDone {
    const host = this.holder?.desk();
    if (!this.holder || !host) throw new ActionRefused(`${this.title} isn't inside a group: the tile is out already`);
    return host.takeFromGroup(this.holder.tile, this, this.tile(sel).name, beside, where, actor);
  }
  /** A group's tile `name` leaves it for this screen (`moveOutOfGroup` asks the screen holding the group). */
  takeFromGroup(group: Pane, inner: Desk, name: string, beside: string | undefined, where: Where, actor: Actor): TileDone {
    const gid = this.idOf(group);
    if (gid === undefined || !(group instanceof ScreenTile) || !group.group) throw new ActionRefused(`${inner.title} isn't a group: a mounted screen keeps its tiles (^W u pops it out)`);
    const g = this.nameOf(gid), at = beside ?? g;
    if (beside !== undefined) this.tile(beside);
    if (inner.tileCount() <= 1) {
      // The last tile: the group spills where it was, and the tile is placed from there (if that place refuses, it stays where the group was).
      const spilled = this.ungroupTile(g, actor);
      const only = (spilled.spilled as string[])[0]!;
      if (beside === undefined && where === "right") return { ...spilled, tile: only, out: true };
      try { return { ...this.moveTile(only, at === g ? undefined : at, where, undefined, actor), out: true }; }
      catch (e) { return { ...spilled, tile: only, out: true, stayed: e instanceof Error ? e.message : String(e) }; }
    }
    const out = inner.takeRefusal(name, actor);
    if (out) throw new ActionRefused(out);
    const kind = (inner.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    const bad = this.bringRefusal({ name, spec: { t: "leaf", kind } }, at, where, actor);
    if (bad) throw new ActionRefused(`the ${this.title} doesn't take ${name} there: ${bad}`);
    const keys = actor.kind !== "agent" && this.focus === gid && inner.focusName() === name;
    const moved = inner.takeOut(name, actor, undefined, true);
    let done: TileDone;
    try { done = this.bringIn(moved, at, where, actor); }
    catch (e) { try { inner.bringIn(moved, undefined, undefined, actor); } catch { /* nowhere */ } throw e; }
    if (keys) this.focusTile(String(done.tile), actor);
    this.save(); this.redraw();
    return { ...done, out: true, from: g };
  }
  /** The name of the tile the keys are in here. */
  focusName(): string { return this.nameOf(this.focus); }
  /** The tiles in the layout and its floats. */
  tileCount(): number { return this.all().length; }

  /**
   * A tile leaving this desk whole keeps its follows (ADR 0001): the tile it follows, and the tiles that follow it, are
   * bound to each other by identity, so a move to the drawer, into a group or out of one changes no name they use.
   */
  private bindFollows(id: number, pane: Pane) {
    // A follower (a preview of a tile) leaving: bound to the tile it follows by identity (none here: to nothing).
    const f = kindOf(pane)?.follows?.(pane);
    if (f && !boundSource.has(pane)) { const src = f.includes("/") ? this.paneAtPath(f) : this.panes.get(this.idNamed(f) ?? -1); boundSource.set(pane, src ?? NO_SOURCE); }
    // A tile followed here leaving: its followers keep following it, wherever it goes (bound to it, not to its name).
    for (const q of this.followers(id)) if (!boundSource.has(q)) boundSource.set(q, pane);
  }

  /** Where a tile moved here would land: beside `to` (the person's tile when left out), `where` (into the tabs of `to` here when this screen is the drawer). */
  private landingFor(to: string | undefined, where: Where | undefined): { at: At<number>; base: string; where: Where } {
    if (!this.all().length) return { at: { kind: "edge", dir: "right" }, base: "home", where: "right" };
    const base = this.tile(to), w = where ?? (this.ctx?.hostLayer?.isDrawer(this) ? "tabs" : "right");
    return { at: placeOf(w, base.id), base: base.name, where: w };
  }
  /** Why `moved` can't come into this screen there, or null (nothing is done). */
  bringRefusal(moved: { name: string; spec: TileSpec }, to: string | undefined, where: Where | undefined, actor: Actor): string | null {
    let l: ReturnType<Desk["landingFor"]>;
    try { l = this.landingFor(to, where); } catch (e) { return (e as Error).message; }
    return refusal(this.layout, { op: "open", tile: this.nextId, kind: moved.spec.kind, name: moved.name, loose: true, at: l.at }, this.layoutCtx(actor));
  }
  /** A tile moved here whole (`takeOut` on another screen, or the drawer): it joins this layout as it is, by the layout's open. */
  bringIn(moved: MovedTile, to: string | undefined, where: Where | undefined, actor: Actor): TileDone {
    const l = this.landingFor(to, where), kind = moved.spec.kind;
    const id = this.nextId;
    const r = this.ask({ op: "open", tile: id, kind, name: moved.name, loose: true, at: l.at }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    this.put(moved.pane);
    this.movedIn.add(id);
    if (!isTileKind(kind)) this.unregistered.set(id, moved.spec);
    this.commit(r);
    this.startTile(id, true);
    // What was said of it travels with it, as a group's gathering and spill carry it: an agent's limit, its spine, its links.
    if (moved.agents) { try { this.apply({ op: "agents", tile: id, level: moved.agents }, USER); } catch { /* the group's own rule stands */ } }
    if (moved.fold) { try { this.apply({ op: "collapse", tile: id, on: true, ...(moved.fold.dir === "h" ? { dir: "h" as const } : {}) }, USER); } catch { /* a place that can't fold it */ } }
    for (const w of moved.links ?? []) this.addExt(id, w);
    this.relink();
    // The terminal the person was typing in came with them: they type in it here.
    if (moved.typing && actor.kind !== "agent" && moved.pane instanceof PtyPane && this.focus === id) this.ptyIn = moved.pane;
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind, where: l.where, beside: l.base };
  }

  /** The tile the person is dragging by its header now (a drop on the drawer takes it there), or null. */
  draggedTile(): string | null { return this.dragging ? this.nameOf(this.dragging.src) : null; }
  /** The drag ends with nothing moved here (it was dropped on the drawer, or outside this screen). */
  cancelDrag() { this.dragging = null; this.headPress = null; this.foreign = null; this.redraw(); }
  /** The dragged tile is over the drawer (the status bar's chip, or the dock): the drag says it lands there. */
  drawerHover(label: string | null) { if (this.dragging && (this.dragging.drawer ?? null) !== label) { this.dragging = { ...this.dragging, drawer: label }; this.redraw(); } }
  /**
   * A tile from outside this screen (the drawer's) dragged over it at x, y: where it would land here, by the same drop
   * zones a tile of this screen gets, with the reason policy refuses it; drawn as the ghost until `cancelDrag`.
   */
  foreignAt(x: number, y: number, moving: { name: string; kind: string }): { to?: string; where: Where; label: string; refused?: string } | null {
    const refuse = (to: Place<number>) => refusal(this.layout, { op: "open", tile: this.nextId, kind: moving.kind, name: moving.name, loose: true, at: to }, this.layoutCtx(USER));
    const drop = this.saysDocked(dropAt(this.dropTiles(), this.area, x, y, -1, true, refuse));
    this.foreign = drop ? { name: moving.name, drop, x, y } : null;
    this.redraw();
    if (!drop) return null;
    const where: Where = drop.kind === "edge" ? `edge-${drop.dir}` : drop.kind === "tabs" ? "tabs" : drop.dir;
    return { ...(drop.kind !== "edge" ? { to: this.nameOf(drop.target) } : {}), where, label: drop.label, ...(drop.refused ? { refused: drop.refused } : {}) };
  }
  /** A drop as `layout.move`'s arguments (a drag's release, a float docked by its title). */
  private moveArgs(drop: Drop<number>): Record<string, unknown> {
    return drop.kind === "edge" ? { where: `edge-${drop.dir}` } : drop.kind === "tabs" ? { to: this.nameOf(drop.target), where: "tabs", ...(drop.index !== undefined ? { index: drop.index } : {}) } : { to: this.nameOf(drop.target), where: drop.dir };
  }
  /**
   * Where float `id` docks with its title dragged to x, y (PIE-591), by the same drop zones a tile's drag has, but only
   * those that can't be meant as a move: a shut dock's handle, the screen's outer edge, a tile's header (its tabs).
   */
  private floatDock(id: number, x: number, y: number): Drop<number> | null {
    const refuse = (to: Place<number>) => refusal(this.layout, { op: "move", tile: id, to }, this.layoutCtx(USER));
    const handles = this.handles.map(h => ({ from: h.from, to: h.to, row: this.area.row + this.area.rows, shows: shown(h.dock.kid)[0] ?? h.id, edge: h.dock.edge }));
    const onHandle = handleDrop(handles, this.area, x, y, id, refuse);
    if (onHandle) return onHandle;
    const d = dropAt(this.dropTiles(), this.area, x, y, id, true, refuse);
    if (!d) return null;
    const header = d.kind === "tabs" && this.dropTiles().some(t => t.id === d.target && t.rect.row === y);
    return d.kind === "edge" || header ? this.saysDocked(d) : null;
  }
  /** A drop beside or into a tile in a dock says it docks there (a dock's tiles stay on this screen). */
  private saysDocked(d: Drop<number> | null): Drop<number> | null {
    return d && d.kind !== "edge" && !d.label.includes(DOCK_DROP) && dockOf(this.root, d.target) ? { ...d, label: `${d.label} · ${DOCK_DROP}` } : d;
  }
  /** A tile from outside dragged over this screen, as last placed: its ghost. */
  private foreign: { name: string; drop: Drop<number>; x: number; y: number } | null = null;

  widenTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    this.apply({ op: "flow.widen", tile: t.id }, actor);
    this.save(); this.redraw();
    return { tile: t.name, wide: true };
  }
  /** A click on a spine, or ⏎ on one: it opens and takes the keys (a view may open its own way: the board's lanes). */
  private expandSpine(id: number) {
    // A flow's spine widens (the river's shift); a folded tile opens.
    this.run(this.collapsed.has(id) ? "tile.collapse" : "tile.widen", this.collapsed.has(id) ? { on: false } : {}, this.nameOf(id));
    if (id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
  }

  /** The tile drawn on top at a cell (a dock over the layout), or null. */
  private topTileAt(x: number, y: number): number | null {
    return this.hits.find(([, r]) => x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows)?.[0] ?? null;
  }

  /**
   * The person leaves the edit or comment they're in, by a click elsewhere or ^W: `session.leave`, as the
   * person (an agent's action never does this to their draft). False, with the reason said, when it can't
   * (a changed property value). The save, when there is one, lands in the background: the tile says
   * "saving…" meanwhile, and a refusal puts the draft aside as unsent with a flash.
   */
  private leaveSession(rd: ReaderPane): boolean {
    // A new note not typed in yet (PIE-591) stays open where it is, empty: only esc or its × puts it away.
    if (rd.surface.newAndUntouched()) { this.entered.clear(); return true; }
    // A comment the person is writing stays open where it is, as it was (PIE-785): theirs again when the keys come back.
    if (rd.surface.keepsOnFocusAway()) { this.entered.clear(); return true; }
    const why = rd.surface.leaveRefusal();
    if (why) { this.ctx.flash(why); return false; }
    this.entered.clear();
    // The person's own leave, through this screen's dispatcher (its note actions, in that reader's tile).
    void this.press(rd, NOTE_ACTIONS, "session.leave").then(r => { const said = r ? leaveSaid(r as Parameters<typeof leaveSaid>[0]) : null; if (said) this.ctx.flash(said, 10000); this.redraw(); });
    return true;
  }

  /** A float moved since the last paint is where the layout has it now (paints are coalesced; a press may come first). */
  private floatsWhereTheyAre() {
    this.hits = this.hits.map(([id, r]) => { const f = this.floats.find(x => x.id === id); return [id, f ? this.floatRect(f) : r]; });
    this.floatButtons = this.floatButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + 2, to: r.col + 5 }; });
    this.closeButtons = this.closeButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + r.cols - 2, to: r.col + r.cols - 1 }; });
    this.menuButtons = this.menuButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + r.cols - b.right, to: r.col + r.cols - b.right + 1 }; });
  }
  /** Whether (x, y) is on tile `id`'s frame as drawn: its header row or an edge (where a drag moves or sizes it). */
  private onFrame(id: number, x: number, y: number): boolean {
    const r = this.hits.find(([hid]) => hid === id)?.[1];
    return !!r && y >= r.row && y < r.row + r.rows && x >= r.col && x < r.col + r.cols && (y === r.row || y === r.row + r.rows - 1 || x === r.col || x === r.col + r.cols - 1);
  }
  /** A click inside the reader the person is editing in: the surface's (a completion candidate), or false. */
  private clickIn(pane: ReaderPane, k: Extract<Key, { kind: "mouse" }>): boolean {
    const at = this.hits.find(([id]) => this.panes.get(id) === pane);
    const hit = at?.[1];
    if (!hit) return false;
    // In the tile's content (its padding and measure, PIE-673): a press in the padding is the nearest cell; a drag and
    // its release go where they are, as a reader's do.
    const o = this.origin(at![0], hit), near = this.local(at![0], hit, k.x, k.y);
    const popup = this.views.get(at![0])?.view.completion?.drawn;
    const overPopup = popup && near.y >= popup.row && near.y < popup.row + popup.items.length;
    const { x, y } = k.action === "down" || overPopup ? near : this.pressedAt({ ...o, gutter: this.gutters.get(at![0]), frame: this.editFloat ? this.views.get(at![0])?.view.frame : undefined }, k);
    // The release of a press made in the edit is its, wherever it comes up: a click there (a control, a completion), or
    // the end of a drag, which copies what it selected (copy on select, as in a reader).
    // An alt- or ctrl-click on a link in it opens the link beside (PIE-592), as ctrl+l does: in the detail the last one
    // opened in, not a new one each time (besideEdit).
    if (k.action === "up") {
      if (this.editPressed !== pane) return false;
      const mod = this.editFresh;
      this.editPressed = null; this.editFresh = false;
      pane.release(x, y, this, mod ? (m, how) => this.setCurrent(m, { ...how, from: pane, reveal: true }) : undefined);
      return true;
    }
    // A drag in an open edit selects in its draft (the press placed the cursor).
    if (k.action === "drag") { if (this.editPressed !== pane) return false; pane.drag(x, y, this); return true; }
    // Only where the reader is on top: a float or a dock drawn over its popup keeps the click.
    if (!(this.topTileAt(k.x, k.y) === at![0] && k.x > hit.col && k.y > hit.row && k.x < hit.col + hit.cols - 1 && k.y < hit.row + hit.rows - 1)) return false;
    this.editPressed = pane;
    this.editFloat = !!pane.surface.floatAt(k.x - o.col, k.y - o.row);
    this.editFresh = !!((k.mods ?? 0) & 24);
    pane.press(x, y, this, !!((k.mods ?? 0) & 4));
    return true;
  }
  /** The reader whose edit the button went down in, until it comes up. */
  private editPressed: ReaderPane | null = null;
  /** That press was an alt- or ctrl-click. */
  private editFresh = false;
  private editFloat = false;

  /** How the hint row and a flash name a reader the person is in: by its number on screen (a view may name it its way). */
  /** A reader as the hint row says it: a detail by its label (detail 1), else its number, or its name where tiles aren't numbered. */
  private readerLabel(id: number): string { const p = this.panes.get(id); return (p instanceof ReaderPane ? p.detailLabel() : null) ?? (this.numbered ? `reader ${this.all().indexOf(id) + 1}` : this.nameOf(id)); }

  /**
   * The border under the pointer. A sliding dock's own border is its edge only: the cell beyond it is the tile it
   * slides over (a reader's row), not a border.
   */
  private borderAt(borders: Divider<number>[], x: number, y: number): Grab<number> | null {
    for (const b of borders) {
      const g = dividerAt([b], x, y);
      if (!g) continue;
      const slid = this.slid.find(s => s.divider === b);
      if (slid && b.node.kids[g.side === 0 ? b.i : b.i + 1] !== slid.node) continue;
      return g;
    }
    return null;
  }

  /** A click on a header's "⇤ dock": it undocks (tile.dock, so a view's own docks undock their way: the board's). */

  /** Where a header's grip ends: just past its last label (its number and title, or its tabs, and marks). */
  private gripEnd(r: Rect): number {
    const inRow = (h: { row: number; from: number; to: number }) => h.row === r.row && h.from >= r.col && h.to <= r.col + r.cols;
    const ends = [...this.heads.filter(inRow), ...this.markHits.filter(inRow)].map(h => h.to);
    return Math.min(r.col + r.cols - 1, (ends.length ? Math.max(...ends) : r.col + 3) + 1);
  }

  /** The tiles as the drag sees them: each shown tile's frame, and a tab set's tab labels. */
  private dropTiles(): DropTile<number>[] {
    // A float isn't a place in the tree: nothing is dropped into it (o puts it back).
    return this.hits.filter(([id]) => !this.isFloat(id)).map(([id, rect]) => {
      const set = tabsOf(this.root, id);
      return { id, rect, ...(set && set.ids.length > 1 ? { tabs: this.heads.filter(h => h.row === rect.row && set.ids.includes(h.id) && h.from >= rect.col && h.to <= rect.col + rect.cols).map(h => ({ id: h.id, from: h.from, to: h.to })) } : {}) };
    });
  }

  /** The group under x, y that tile `src` dragged there would go into (PIE-696), with where in it by the group's own drop zones. */
  private groupDropAt(x: number, y: number, src: number): GroupDrop | null {
    const id = this.topTileAt(x, y);
    if (id === null || id === src) return this.leaveGroup(null);
    const p = this.panes.get(id), r = this.hits.find(([t]) => t === id)?.[1];
    if (!(p instanceof ScreenTile) || !p.group || !p.inner || !r || this.collapsed.has(id)) return this.leaveGroup(null);
    const name = this.nameOf(id), moving = { name: this.nameOf(src), kind: (this.panes.get(src) as { kind?: string } | undefined)?.kind ?? "tile" };
    const o = this.origin(id, r), inside = x >= o.col && x < o.col + o.cols && y >= o.row && y < o.row + o.rows;
    const why = this.takeRefusal(moving.name, USER);
    let to: string | undefined, where: Where = "right", label = `into ${name}`, refused = why ?? undefined;
    if (inside) {
      if (this.groupGhost && this.groupGhost !== p.inner) this.groupGhost.cancelDrag();
      const d = p.inner.foreignAt(x - o.col, y - o.row, moving);
      this.groupGhost = p.inner;
      if (d) { to = d.to; where = d.where; label = `into ${name}: ${d.label}`; refused = refused ?? d.refused; }
    } else this.leaveGroup(p.inner);
    return { group: id, ...(to ? { to } : {}), where, label, ...(refused ? { refused } : {}) };
  }
  /** The drag left the group whose zones showed its ghost (or moved to `keep`): that ghost goes. */
  private leaveGroup(keep: Desk | null): null {
    if (this.groupGhost && this.groupGhost !== keep) { this.groupGhost.cancelDrag(); this.groupGhost = null; }
    return null;
  }
  private endGroupGhost() { this.leaveGroup(null); }
  /**
   * A tile of a group dragged by its title past the group's content: where it would land on this screen, by this
   * screen's own drop zones. True when the pointer is out there (the group's desk is not told); false inside.
   */
  private dragOut(k: Extract<Key, { kind: "mouse" }>): boolean {
    const m = this.mouseTile, p = m ? this.panes.get(m.id) : undefined;
    if (!m || !(p instanceof ScreenTile) || !p.group || !p.inner) return false;
    const name = p.inner.draggedTile();
    if (!name) return false;
    const outside = k.x < m.r.col || k.y < m.r.row || k.x >= m.r.col + m.r.cols || k.y >= m.r.row + m.r.rows;
    const kind = (p.inner.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    const target = outside ? this.foreignAt(k.x, k.y, { name, kind }) : null;
    // Over the group's own frame is still the group's.
    if (!outside || target?.to === this.nameOf(m.id)) { if (this.outDrag) { p.inner.drawerHover(null); this.outDrag = null; this.foreign = null; this.redraw(); } return false; }
    this.outDrag = { inner: p.inner, name, target };
    p.inner.drawerHover(target ? (target.refused ? `✕ ${target.refused}` : `↗ out of the group: ${target.label}`) : "nowhere here");
    return true;
  }

  /** Sideways wheel reports as steps: one a swipe. */
  private readonly swipe = new SidewaysWheel();
  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const p = this.pressed;
    if (k.action === "up") {
      const click = this.titleClick;
      this.titleClick = null;
      if (click && k.x === click.x && k.y === click.y && this.titlePresses.press(click.id) === "open") {
        this.floatDrag = null; this.dragging = null; this.headPress = null;
        if (click.id !== this.focus) this.run("tile.focus", {}, this.nameOf(click.id));
        return this.run("tile.title", {}, this.nameOf(click.id));
      }
      // A resize let go (src/resize.ts): laid out and scaled for where it ended.
      if (this.drag) { this.drag = null; resizeEnded(); this.save(); }
      if (this.floatDrag) {
        const g = this.floatDrag;
        this.floatDrag = null;
        if (g.size) resizeEnded();
        if (g.drop && !g.drop.refused) return void this.run("layout.move", this.moveArgs(g.drop), this.nameOf(g.id));
        if (g.drop?.refused) this.ctx.flash(`not docked: ${g.drop.refused}`);
        this.save(); return this.redraw();
      }
      // A tile of a group let go outside it: it goes out onto this screen, where the drop zones say.
      if (this.outDrag && this.mouseTile) {
        const o = this.outDrag;
        this.outDrag = null; this.mouseTile = null; this.foreign = null;
        o.inner.cancelDrag();
        if (!o.target) this.ctx.flash(`not moved: ${o.name} stays in the group · drop it on a tile's side, its header or centre, or the screen's edge`);
        else if (o.target.refused) this.ctx.flash(`not moved: ${o.target.refused}`);
        else o.inner.run("layout.move", { out: true, ...(o.target.to ? { beside: o.target.to } : {}), where: o.target.where }, o.name);
        return this.redraw();
      }
      const d = this.dragging, h = this.headPress;
      this.dragging = null; this.headPress = null;
      if (d?.drop) {
        const drop = d.drop;
        this.run("layout.move", this.moveArgs(drop), this.nameOf(d.src));
      } else if (d?.into) {
        this.endGroupGhost();
        const into = d.into;
        if (into.refused) { this.ctx.flash(`not moved: ${into.refused}`); this.redraw(); }
        else this.run("layout.move", { into: this.nameOf(into.group), ...(into.to ? { beside: into.to } : {}), where: into.where }, this.nameOf(d.src));
      } else if (d) { this.ctx.flash("not moved: dropped where it was"); this.redraw(); }
      else if (h) {
        // A click on a flow column's header is the shift (the river's): it takes the wide place.
        if (this.inFlow(h.id)) this.run("tile.widen", {}, this.nameOf(h.id));
        this.redraw();
      }
      if (this.mouseTile) { const m = this.mouseTile; this.mouseTile = null; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col, k.y - m.r.row, this); }
      if (p) { this.pressed = null; const at = this.pressedAt(p, k); p.pane.release(at.x, at.y, this, p.fresh ? (m, how) => this.setCurrent(m, { ...how, from: p.pane, fresh: true, reveal: true }) : undefined, p.focusing); this.redraw(); }
      return;
    }
    if (k.action === "drag") {
      this.titleClick = null;
      this.titlePresses.forget();
      // A float's title moves it, its corner sizes it: float.place, as H J K L and an agent's.
      if (this.floatDrag) {
        const f = this.floats.find(x => x.id === this.floatDrag!.id), g = this.floatDrag;
        if (g.size) resizing();
        if (f) { const at = this.floatRect(f); this.run("float.place", g.size ? { cols: k.x - at.col + 1, rows: k.y - at.row + 1 } : { col: k.x - g.dx, row: k.y - g.dy }, this.nameOf(g.id)); }
        if (!g.size && this.floatDrag === g) { g.drop = this.floatDock(g.id, k.x, k.y); g.x = k.x; g.y = k.y; this.redraw(); }
        return;
      }
      // A border follows the pointer by layout.resize (the same action an agent calls).
      // A report that wouldn't move it (the pointer within the cell, or past where the border stops) does nothing: a
      // frame for it would lay out every tile again for nothing.
      if (this.drag) {
        resizing();
        const g = this.drag, split = g.d.node.id, f = dragShare(g, k.x, k.y);
        if (split && f !== null && f !== this.dragAt) { this.dragAt = f; this.run("layout.resize", { split, border: g.d.i, share: f }); }
        return;
      }
      if (this.headPress) {
        const h = this.headPress;
        if (!this.dragging && Math.abs(k.x - h.x) + Math.abs(k.y - h.y) < 1) return;
        // Where it would land (a dock's handle on the hint row first), with the reason policy refuses it, if any.
        const refuse = (to: Place<number>) => refusal(this.layout, { op: "move", tile: h.id, to }, this.layoutCtx(USER));
        const handles = this.handles.map(x => ({ from: x.from, to: x.to, row: this.area.row + this.area.rows, shows: shown(x.dock.kid)[0] ?? x.id, edge: x.dock.edge }));
        // Over a group (PIE-696): its own drop zones say where it would land inside; the tile moves in whole.
        const into = handleDrop(handles, this.area, k.x, k.y, h.id, refuse) ? null : this.groupDropAt(k.x, k.y, h.id);
        if (into) { this.dragging = { src: h.id, drop: null, x: k.x, y: k.y, into }; return this.redraw(); }
        this.endGroupGhost();
        this.dragging = { src: h.id, drop: handleDrop(handles, this.area, k.x, k.y, h.id, refuse) ?? this.saysDocked(dropAt(this.dropTiles(), this.area, k.x, k.y, h.id, leaves(this.root).length > 1, refuse)), x: k.x, y: k.y };
        return this.redraw();
      }
      if (this.mouseTile && this.dragOut(k)) return;
      if (this.mouseTile) { const m = this.mouseTile; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col, k.y - m.r.row, this); return; }
      if (p) { const at = this.pressedAt(p, k); return p.pane.drag(at.x, at.y, this); }
      return;
    }
    if (k.action === "down") this.floatsWhereTheyAre();
    const hit = this.hits.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
    if (hit && this.arriving(hit[0]) && (k.action === "down" || k.action.startsWith("wheel"))) this.run("tile.arrival.clear", {}, this.nameOf(hit[0]));
    // The sideways wheel: a tile that takes the mouse has it (a terminal, the board's lanes); else the tile's kind says
    // what a step means where its content is horizontal (the river's columns: the one beside), one step a swipe
    // (SidewaysWheel). Anywhere else it does nothing: it is never read as the vertical wheel.
    const sw = sideways(k);
    if (sw) {
      if (!hit) return;
      const [id, r] = hit, pane = this.panes.get(id);
      const at = this.local(id, r, k.x, k.y);
      if (pane?.mouse?.(k, at.x, at.y, this)) return;
      const a = pane ? kindOf(pane)?.sideways?.(pane, sw) : null;
      if (a && this.swipe.step(sw)) this.run(a.action, a.args ?? {}, this.nameOf(id));
      return;
    }
    if (k.action === "down") {
      // A shut dock's handle, at the end of the hint row; the lock chip after them.
      if (k.y === this.area.row + this.area.rows) {
        const h = this.handles.find(h => k.x >= h.from && k.x < h.to);
        if (h) this.run("tile.slide", { open: true, container: h.dock.id }, this.nameOf(h.id));
        else if (this.lockChip && k.x >= this.lockChip.from && k.x < this.lockChip.to) this.run("layout.lock");
        else if (this.hyperChip && k.x >= this.hyperChip.from && k.x < this.hyperChip.to) void this.ctx.press?.("keys.probe");
        else if (this.moreChip && k.x >= this.moreChip.from && k.x < this.moreChip.to) this.run("keys.more");
        return;
      }
      if (this.linking) return this.linkAt(this, k.x, k.y);
      // A right-click in a tile opens its menu at the pointer (tile.menu), unless what's under it takes it itself (a
      // program that asked for the mouse, a step's box: their own choice opens). The tile gets the keys first.
      if (k.button === MOUSE_RIGHT && hit && !this.ownsRightClick(hit[0], hit[1], k.x, k.y)) {
        const id = hit[0];
        if (id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
        return this.run("tile.menu", { at: `${k.x},${k.y}` }, this.nameOf(id));
      }
      // What a header draws to be clicked, before its row is a grip, a border or a float's title to drag: a mark's
      // label dismisses the mark, a dock's "⇤ dock" pins it, its [×] shuts it as Esc in it does (a list whose
      // container shuts its dock, by its close), a control a tile put there (the backlinks' status) does what its key
      // does. A float's header carries the same controls: they're asked first, so its title drag doesn't swallow them.
      const at = (h: { id: number; row: number; from: number; to: number }) => hit?.[0] === h.id && h.row === k.y && k.x >= h.from && k.x < h.to;
      const pointer = this.pointerHits.find(at);
      if (pointer) return this.run("agent.visit", { agent: pointer.agent });
      const mh = this.markHits.find(at);
      if (mh) return this.run("block.unmark", { n: mh.n });
      const dx = this.dockCloses.find(at);
      if (dx) return chainOf(this.root, dx.id).some(c => c.policy?.shuts) ? this.run("tile.close", {}, this.nameOf(dx.id)) : this.run("tile.slide", { open: false }, this.nameOf(dx.id));
      const dl = this.dockLabels.find(at);
      if (dl) return this.run("tile.dock", { on: false }, this.nameOf(dl.id));
      const ac = this.agentChips.find(at);
      if (ac) return this.run("tile.agent", {}, this.nameOf(ac.id));
      const hp = this.headPresses.find(at);
      if (hp) { hp.press(); return this.redraw(); }
      // ⧉ on a tile's header: on a float it puts it back, on a pinned tile it floats it (tile.float either way, as ^W f).
      const fb = this.floatButtons.find(at);
      if (fb) return this.run("tile.float", {}, this.nameOf(fb.id));
      // × on a tile's frame: it closes (tile.close, as ^W x), without taking the keys there first.
      const xb = this.closeButtons.find(at);
      if (xb) return this.run("tile.close", {}, this.nameOf(xb.id));
      // ◂ ▾ on a tile's frame: it folds to a spine (tile.collapse, as alt+h), alt-click the other way (alt+H), without taking the keys.
      // ○ ● on a list's frame: it is held off its home or let go (tile.hold, as p in it), without taking the keys.
      const hb = this.holdButtons.find(at);
      if (hb) return this.run("tile.hold", {}, this.nameOf(hb.id));
      const ob = this.foldButtons.find(at);
      if (ob) {
        const alt = ((k.mods ?? 0) & 28) !== 0;
        return this.run("tile.collapse", { on: true, ...(alt ? { dir: "h" } : {}) }, this.nameOf(ob.id));
      }
      // ◄ → ⏎ marks on a header (PIE-855): ^W P opens on that row (what it follows, where its opens land).
      const wc = this.wireChips.find(at);
      if (wc) return wc.wire === "follows" ? this.openWires(wc.id, "follows") : this.run("tile.link", { ask: true, verb: wc.wire }, this.nameOf(wc.id));
      const titleHit = this.heads.find(h => h.row === k.y && k.x >= h.from && k.x < h.to && !!hit && (h.id === hit[0] || !!tabsOf(this.root, hit[0])?.ids.includes(h.id)));
      this.titleClick = titleHit && !(k.mods ?? 0) ? { id: titleHit.id, x: k.x, y: k.y } : null;
      // A float: a press gives it the keys and brings it to the top; its title moves it, its ◢ corner sizes it.
      if (hit && this.isFloat(hit[0])) {
        const [id, r] = hit;
        if (id !== this.focus || this.floats.at(-1)?.id !== id) this.run("tile.focus", {}, this.nameOf(id));
        if (k.x >= r.col + r.cols - 2 && k.y >= r.row + r.rows - 2) { this.floatDrag = { id, size: true, dx: 0, dy: 0 }; resizing(); return this.redraw(); }
        if (k.y === r.row) { this.floatDrag = { id, size: false, dx: k.x - r.col, dy: k.y - r.row }; return this.redraw(); }
      }
      // A spine: a click opens it (and gives it the keys), as ⏎ on it does.
      const sp = this.spines.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
      if (sp && hit?.[0] === sp[0]) return this.expandSpine(sp[0]);
      // A border: a dock's own over it, else the layout's (not one hidden under a dock). On a header row
      // only the title or tabs (the grip) move the tile; the bare line after them is the border above, so
      // pressing a tile's top edge resizes it. A header with no border above is all grip.
      const slid = hit ? this.slid.find(d => d.placed.rects.has(hit[0])) : undefined;
      const borders = hit && this.isFloat(hit[0]) ? [] : slid ? [...(slid.divider ? [slid.divider] : []), ...slid.placed.dividers] : this.dividers;
      // Alt or ctrl held, the grip is border too: a drag on a cramped title resizes from the edge it sits on (Evan, Oct 21).
      const onGrip = !!hit && !((k.mods ?? 0) & 24) && k.y === hit[1].row && k.x > hit[1].col && k.x < this.gripEnd(hit[1]);
      const d = this.zoom === null && !onGrip ? this.borderAt(borders, k.x, k.y) : null;
      if (d) {
        // A border the policy keeps where it is (locked, resizable off, a fixed size) doesn't follow the pointer: said once.
        const why = d.d.node.id ? refusal(this.layout, { op: "resize", split: d.d.node.id, border: d.d.i, share: d.d.sizes[0] / Math.max(1, d.d.sizes[0] + d.d.sizes[1]) }, this.layoutCtx(USER)) : null;
        if (why) { this.ctx.flash(why); return this.redraw(); }
        this.drag = d; this.dragAt = null; resizing(); return;
      }
      if (!hit) return;
      const [id, r] = hit;
      // A click elsewhere lets go of a reader's selected text.
      for (const [pid, pane] of this.panes) if (pid !== id && pane instanceof ReaderPane) pane.surface.selection = null;
      if (k.y === r.row) {
        // The header: a tab's label shows it; pressing anywhere on it can start a drag (the tab under the pointer, or the tile).
        const tab = this.heads.find(h => h.row === r.row && k.x >= h.from && k.x < h.to);
        const set = tabsOf(this.root, id);
        const grab = tab && set?.ids.includes(tab.id) ? tab.id : id;
        // Shift+click on a title picks the tile to gather with others (tile.select): no focus, no drag.
        if (((k.mods ?? 0) & 4) && !this.isFloat(grab)) return this.run("tile.select", {}, this.nameOf(grab));
        this.headPress = { id: grab, x: k.x, y: k.y };
        if (grab !== id) this.run("tab.select", {}, this.nameOf(grab));
        else if (id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
        return this.redraw();
      }
      // A press that gives a tile the keys: a list's row is only selected by it, never opened (RowView.press).
      const focusing = id !== this.focus;
      if (focusing) this.run("tile.focus", {}, this.nameOf(id));
      // Inside the frame only: its border (and the scroll thumb drawn on it) isn't the pane's.
      if (k.x > r.col && k.y > r.row && k.x < r.col + r.cols - 1 && k.y < r.row + r.rows - 1) {
        const pane = this.panes.get(id);
        const { x, y } = this.local(id, r, k.x, k.y);
        const how: RowPress = { mods: k.mods ?? 0, button: k.button, focusing };
        const press = pane ? kindOf(pane)?.press : undefined;
        if (pane && press) {
          // A click its kind gives an action (in a terminal: typing in it); the tile gets the click when it asks for the mouse.
          const a = press(pane, k);
          if (a) this.run(a.action, a.args ?? {}, this.nameOf(id));
          if (pane.mouse?.(k, x, y, this, how)) this.mouseTile = { id, r: this.origin(id, r) };
        } else if (pane?.mouse) { this.mouseTile = { id, r: this.origin(id, r) }; pane.mouse(k, x, y, this, how); }
        // A reader decides on release: a click, or a drag that selected text (PIE-419). A ctrl- or alt-click opens beside (PIE-473).
        else if (pane instanceof ReaderPane) {
          // The press that gives the keys back to an edit of theirs left open there (PIE-812) keeps its cursor and
          // selection where they were, as the keys coming back by ^W leave them; a control in its frame still runs (its
          // release is the edit's, as any press in it: clickIn).
          const o = this.origin(id, r);
          if (focusing && pane.editing && this.entered.in(pane)) { this.editPressed = pane; this.editFloat = !!pane.surface.floatAt(k.x - o.col, k.y - o.row); pane.press(x, y, this, false, true); return this.redraw(); }
          this.pressed = { frame: pane.surface.floatAt(k.x - o.col, k.y - o.row) ? this.views.get(id)?.view.frame : undefined, pane, gutter: this.gutters.get(id), col: o.col, row: o.row, cols: o.cols, fresh: !!((k.mods ?? 0) & 24), focusing };
          pane.press(x, y, this, !!((k.mods ?? 0) & 4));
          // A click that places the cursor in the person's own edit here (one left open while its tile lost
          // the keys) is in it again, as e would be. An agent's draft still takes e or ⏎ (PIE-411).
          if (id === this.focus && pane.surface.pressedIntoOwn) this.entered.enter(pane);
        }
        else pane?.click?.(x, y, this);
      }
      return this.redraw();
    }
    if (hit && (k.action === "wheel-up" || k.action === "wheel-down")) {
      const [id, r] = hit;
      const pane = this.panes.get(id);
      const at = this.local(id, r, k.x, k.y);
      if (pane?.mouse && pane.mouse(k, at.x, at.y, this)) return;
      pane?.wheel?.(k.action === "wheel-up" ? -1 : 1, this, at);
    }
  }
}

/**
 * A screen as it was saved (its spec's `saves`), when it can come back: one missing a tile or container its spec
 * names comes back as its spec instead.
 */
function savedScreen(x: unknown, spec: ScreenSpec): SavedDesk | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, any>;
  if (!o.root) return o.models ? { root: undefined as never, focus: 0, models: o.models } : null;
  const want = leafNames(spec.layout.root), have = new Set(slotNames(o.root)), wantKeys = containerKeys(spec.layout.root), haveKeys = new Set(containerKeys(o.root));
  // The desk's tiles are the person's own: anything goes. A screen of a fixed shape needs its tiles and named containers.
  if (!spec.layouts && (!want.every(n => have.has(n)) || !wantKeys.every(k => haveKeys.has(k)))) return { ...(o as SavedDesk), root: undefined as never };
  return o as SavedDesk;
}

/**
 * Whether a change concerns what reader `r` shows beyond its note's own text (which `staleOn` reads again): its comment
 * threads (a comment or a reply on it), or an edit of its note that can move a quoted passage (PIE-399: only what a
 * change can touch is refreshed). Without a change record (a reset), anything may have.
 */
function readerHears(r: ReaderPane, e: OutlineEvent): boolean {
  const c = e.change, m = r.msg;
  if (!c) return true;
  if (!m) return false;
  const id = c.blockId;
  if (c.kind === "annotate") return m.id === c.parentId || (r.comments ?? []).some(t => t.id === c.parentId || t.id === id || t.replies.some(x => x.id === id));
  return !!id && m.id === id && c.kind === "edit";
}

/** What a tile was made for when it's a new note's (PIE-591): its note, and the note it was made from; else null. */
const madeFor = (p: Pane | undefined): { id: string; context: string | null } | null => (p instanceof ReaderPane ? p.newNote : null);

/** How dim a peek column is drawn under its neighbour (the river's cover). */
const PEEK_DIM = 0.55;

/**
 * A refusal as a tile's hint row says it (PIE-727): ✗ and why, in the warning tone; loud, on the warning surface at its
 * full strength (capped dark by surfaceBg: no bright flash) and bold; it stays until another key.
 */
export function refusalHint(r: Refusal): string {
  const ink = fg(TONE.amber);
  if (!r.loud) return `${ink}✗ ${r.text}`;
  return `${surfaceBg("amber", SURFACE_STEPS)}${ink}${BOLD} ✗ ${r.text} ${UNBOLD}${RESET}`;
}
/** What a cut hint row ends with: ? (or a click on it) shows the rest (keys.more). */
let MORE = "";
themed(() => { MORE = paint("|08 · |15?|08 more") + RESET; });
const MORE_WIDTH = width(MORE);
/** The hint row's chip while the hyper layer is on (PIE-699): a click probes what a chord arrives as. */
const HYPER_CHIP = " ✦ hyper ";
/** How a hint row draws a key (|15; |07 in a ^W chord's row): a click on one presses it (hintSpots). */
const keyStyles = () => [fg(C.white), fg(C.grey)];
/**
 * A hint row's parts (split at " · ") put on lines at most `w` wide, a part never split unless it's wider than a
 * line. Each line starts with the colour codes in force where its first part began.
 */
export function wrapHint(s: string, w: number): string[] {
  const parts = s.replace(/^((?:\x1b\[[\d;]*m)*)\s+/, "$1").split(" · ");
  const out: string[] = [];
  let line = "", sgr = "", lineSgr = "";
  for (const p of parts) {
    if (line && width(line) + 3 + width(p) > w) { out.push(lineSgr + line + RESET); line = ""; }
    if (!line) { lineSgr = sgr; line = p; } else line += " · " + p;
    for (const m of p.matchAll(/\x1b\[[\d;]*m/g)) sgr = m[0] === RESET ? "" : sgr + m[0];
  }
  if (line) out.push(lineSgr + line + RESET);
  return out;
}
const isRect = (r: unknown): r is Rect => !!r && typeof r === "object" && ["col", "row", "cols", "rows"].every(k => typeof (r as Record<string, unknown>)[k] === "number" && Number.isFinite((r as Record<string, number>)[k]));
const overlaps = (p: Pick<Placement, "col" | "row" | "cols" | "rows">, r: Rect) => p.col < r.col + r.cols && p.col + p.cols > r.col && p.row < r.row + r.rows && p.row + p.rows > r.row;
/** Where a tile dragged over a group would go in it (PIE-696): the group, the tile of it beside which, and where. */
export interface GroupDrop { group: number; to?: string; where: Where; label: string; refused?: string }
/** A drop as `peek` says it: where the dragged tile would go. */
const dropView = (d: Drop<number>, name: (id: number) => string) => ({ kind: d.kind, ...("target" in d ? { target: name(d.target) } : {}), ...("dir" in d ? { dir: d.dir } : {}), ...(d.kind === "tabs" && d.index !== undefined ? { index: d.index } : {}), label: d.label, ghost: d.ghost, ...(d.refused ? { refused: d.refused } : {}) });
/** A follower that moved between screens, and the tile instance it follows (NO_SOURCE: it follows nothing now). */
const boundSource = new WeakMap<Pane, Pane | typeof NO_SOURCE>();
const NO_SOURCE = Symbol("no source");
/** The layout's `pin` answer in the action's words: `docked`, never `pinned`. */
const docked = ({ pinned, ...rest }: Record<string, unknown>) => ({ ...rest, ...(pinned !== undefined ? { docked: !pinned } : {}) });
/** A tile moving between screens (or into and out of the drawer) whole: its instance, its name, its spec, whether the person was typing in it. */
/** One tile as the power bar lists it (Desk.tileOutline): its stable id, name, kind, depth in the tree, and what it shows. */
export interface TileLine {
  id: string; name: string; kind: string; depth: number; label: string; showing: { id: string; title: string; workId?: string; page?: string } | null;
  focused: boolean; collapsed: boolean; float: boolean; docked: boolean; tab: boolean; shown: boolean;
  /** A reader's mode (PIE-705): follows, held or pinned. */
  mode?: "follows" | "held" | "pinned";
}

export interface MovedTile { pane: Pane; name: string; spec: TileSpec; from: string; typing: boolean; links?: ExtLink[]; agents?: AgentLevel; fold?: Fold }
/** A link whose far end is on another desk of the family (a group's tile and one outside it): its pane, or its path until it is found. */
export interface ExtLink { pane?: Pane; path?: string; verb: WireVerb; rule?: AltRule; found?: boolean }

/** Where `where` (a tile action's place) puts a tile, by tile `at`: beside it, into its tabs, or along an outer edge. */
const placeOf = (where: Where, at: number): At<number> => (where === "next" ? { kind: "next", from: at } : where === "tabs" ? { kind: "tabs", target: at } : where.startsWith("edge-") ? { kind: "edge", dir: where.slice(5) as Dir } : { kind: "split", target: at, dir: where as Dir });

// ── the desk's overlays (the layout picker, the policy panel, the search): pickers on its mode stack ─────────

type DeskPicker = ListPicker<any, Desk>;

/** ^W r: the layouts to lay this screen out as: the built-ins, and the screens people made (screen notes). */
function layoutPicker(items: { name: string; title: string; saved: boolean; builtin: boolean }[]): DeskPicker {
  return new ListPicker({
    name: "layouts", items: () => items,
    row: (it, _i, on, w) => [...pickRows(` ${it.title}${it.saved ? (it.builtin ? " · a screen you made, over the built-in" : " · a screen you made") : " · built-in"}`, on, w)],
    choose: (it, _i, d) => d.run("layout.load", { name: it.name }),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "lay this screen out as" }),
  });
}

/** ^W w: the name to save this screen as (its own, typed over): a screen note in the outline. */
function screenSaver(name: string): DeskPicker {
  return linePrompt<Desk>({
    name: "layouts", title: "save this screen as", text: name, w: 100,
    doing: t => (screenNotes().some(n => n.name === screenSlug(t)) ? `save it over the screen ${t.trim()} (a note in the outline)` : `save it as ${t.trim()}, a screen note in the outline`),
    // The reason shows as it's typed, and ⏎ on a name that can't be saved leaves the prompt open with what was typed.
    hint: t => { const why = screenTitleProblem(t); return why ? { text: why, warn: true } : { text: `saves as ${screenSlug(t)}`, ...{} }; },
    done: (t, d) => void d.saveFromPrompt(t),
  });
}

/**
 * The screens to open: the ones people made, then the built-ins that open on nothing in particular. ⏎ or a double click
 * is screen.open; x on one a person made is screen.delete (twice: it asks first).
 */
function screensToOpen(): { name: string; title: string; made: boolean }[] {
  const made = screenNotes().map(n => ({ name: n.name, title: n.title, made: true }));
  return [...made, ...screenNames().filter(n => !made.some(m => m.name === n) && !screenTargetArg(n) && n !== "home").map(name => ({ name, title: name, made: false }))];
}
function screenPicker(): DeskPicker {
  const items = screensToOpen;
  const p: DeskPicker = new ListPicker<{ name: string; title: string; made: boolean }, Desk>({
    name: "screens", items,
    row: (it, _i, on, w) => [...pickRows(` ${it.title} · ${it.made ? "a screen you made" : "built-in"}`, on, w)],
    // screen.open is the App's (the shell's), as the menu's letters run it.
    choose: (it, _i, d) => void d.ctx.press?.("screen.open", { name: it.name }),
    bindings: [{ key: "x", action: "screen.delete", label: "delete made screen" }],
    dispatch: (_, d) => { const it = items()[p.sel]; if (it?.made) d.run("screen.delete", { name: it.name }); },
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "open a screen" }),
  });
  return p;
}

/** A kind's choices for a new tile (a query tile's view): one picked runs `then`. */
function choicePicker(title: string, items: { label: string; spec: Partial<TileSpec> }[], then: (it: { label: string; spec: Partial<TileSpec> }) => void): DeskPicker {
  return new ListPicker({
    name: "choices", items: () => items,
    row: (it, _i, on, w) => [...pickRows(` ${it.label}`, on, w)],
    choose: it => then(it),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, Math.max(n, 1) + 2)), title }),
  });
}

/**
 * ^W P: the containers over a tile (the screen first, then each one down to it) and one's policy, a row per field.
 * ⏎, space or a click changes a row through the same action an agent calls; h l (or a click on a name) pick the
 * container; + - change a size; esc, q or a click outside closes it.
 */
function policyPanel(d: Desk, tile: number): DeskPicker {
  let wireWidth = 0;
  let node = Number.MAX_SAFE_INTEGER, crumbs: { from: number; to: number; y: number; i: number }[] = [];
  const nodes = () => { const ns = d.policyNodes(tile); node = Math.min(node, ns.length - 1); return ns; };
  // The tile's own rows first (what it follows, where its opens land: PIE-855), then the container's.
  const rows = () => [...d.wireRows(tile), ...d.policyRows(tile, nodes()[node]!.node)];
  const first = () => d.wireRows(tile).length;
  const p: DeskPicker = new ListPicker<PanelRow, Desk>({
    name: "policy", items: rows, closers: "q", stays: true,
    closed: () => { d.run("tile.link", { ask: false }); },
    row: (r, _i, on, w) => {
      wireWidth = w;
      const text = ` ${r.label}${!r.clear && !r.wide ? ` ${r.value}` : ""}`;
      return pickRows(text, on, r.clear ? w - 4 : w, r.clear || r.wire ? C.white : C.grey).map(line => line + (r.clear ? pickRow(" × ", on, 4) : ""));
    },
    clickedItem: (r, x) => { if (!r.clear || x < wireWidth - 4) return false; r.clear(); return true; },
    choose: r => r.run?.(),
    bindings: [
      ...["left", "h", "right", "l"].map(key => ({ key, action: "policy.container", label: "container", args: { by: ["left", "h"].includes(key) ? -1 : 1 } })),
      { key: "space", action: "policy.change", label: "change" },
      { key: "x", action: "policy.clear", label: "clear wire" },
      ...["+", "-"].map(key => ({ key, action: "policy.size", label: "size", args: { by: key === "+" ? 1 : -1 } })),
    ],
    dispatch: binding => {
      switch (binding.action) {
        case "policy.container": node = Math.max(0, Math.min(nodes().length - 1, node + (binding.args!.by as number))); p.sel = first(); break;
        case "policy.change": rows()[p.sel]?.run?.(); break;
        case "policy.clear": rows()[p.sel]?.clear?.(); break;
        case "policy.size": rows()[p.sel]?.adjust?.(binding.args!.by as number); break;
      }
    },
    clicked: (x, y) => { const n = crumbs.find(h => h.y === y && x >= h.from && x < h.to); if (n) { node = n.i; p.sel = first(); } return !!n; },
    frame: (a, n) => {
      const rect = centred(a, Math.min(96, a.cols - 4), Math.min(a.rows - 4, n + 4));
      let x = rect.col + 2, line = " ";
      crumbs = [];
      nodes().forEach((c, i) => {
        if (i) { line += fg(C.dark) + " › " + RESET; x += 3; }
        crumbs.push({ from: x, to: x + c.label.length, y: rect.row + 1, i });
        line += (i === node ? selected() : fg(C.grey)) + c.label + RESET; x += c.label.length;
      });
      return { rect, title: "policy", head: [line, ""] };
    },
  });
  return p;
}

interface DeskOn { d: Desk; reader?: string }


export const HINT_ACTIONS = actionSet<DeskOn>()("hint", {
  "hint.show": def({ summary: "show a hint beside a tile without taking its keys", keys: "? on a frame", touches: "nothing", replay: "safe",
    args: { text: { type: "string", optional: true, about: "words to show; absent lists the tile's controls" }, for: { type: "string", optional: true, kind: "tile", about: "the tile to anchor beside" } },
    examples: [{ act: 'hint.show text="Select a destination" for=reader', does: "shows an attributed hint beside the reader" }],
    run: (a, h, actor) => h.d.hintShow(a.for ?? h.reader, a.text, actor) }),
  "hint.get": def({ summary: "read the hint cards, or every tile's controls with xray=true", touches: "nothing", replay: "safe", args: { xray: { type: "boolean", optional: true, about: "read all the frame cards without showing them" } }, examples: [{ act: "hint.get xray=true", does: "reads every tile's controls" }], run: (a, h) => h.d.hintGet(a.xray) }),
  "hint.never": def({ summary: "show this hint on the status line from now on", keys: "alt+N, click", touches: "nothing", replay: "safe", person: "hint settings are the person's; hints.list reads them", args: {}, run: (_, h) => h.d.hintNever(h.reader) }),
  "hints.list": def({ summary: "read every declared hint, its trigger and personal setting; tune.section section=hints shows the list in the inspector", touches: "nothing", replay: "safe", args: {}, run: (_, h) => h.d.hintsList() }),
  "hints.set": def({ summary: "keep a hint as a card, a status line or off across restarts", keys: "c, s, o in the Hints section, click", touches: "nothing", replay: "safe", person: "hint settings are the person's; hints.list reads them", args: { id: { type: "string", about: "hint id from hints.list" }, to: { type: "string", about: "card, status or off" } }, examples: [{ act: "hints.set id=tile.collapse to=status", does: "keeps folding hints on the status line" }], run: (a, h) => h.d.hintsSet(a.id, a.to as HintSetting) }),
  "hints.reset": def({ summary: "reset all personal hint settings to their defaults", keys: "R in the Hints section, click", touches: "nothing", replay: "safe", person: "hint settings are the person's; hints.list reads them", args: {}, run: (_, h) => h.d.hintsReset() }),
  "hint.pin": def({ summary: "keep the current hint through the next action", touches: "nothing", replay: "safe", args: {}, run: (_, h) => h.d.hintPin(h.reader) }),
  "hint.scroll": def({ summary: "scroll a card whose controls do not fit", keys: "wheel", touches: "nothing", replay: "safe", args: { by: { type: "number", about: "rows to scroll" } }, examples: [{ act: "hint.scroll by=1", does: "shows the next row of controls" }], run: (a, h) => h.d.hintScroll(a.by, h.reader) }),
  "hint.dismiss": def({ summary: "put away hint cards", keys: "esc, click", touches: "nothing", replay: "safe", args: {}, run: (_, h) => h.d.hintDismiss() }),
  "xray": def({ summary: "show every tile's controls; hold ctrl or toggle with ctrl+] then ?", keys: "ctrl, ctrl+] then ?", touches: "nothing", replay: "safe", args: { on: { type: "boolean", optional: true, about: "true shows, false hides, absent toggles" } }, examples: [{ act: "xray on=true", does: "shows every tile's card" }], run: (a, h) => h.d.xraySet(a.on) }),
});

/** What the desk adds to a reader's note actions: which note is current, and which pane has the keys. */
export const DESK_ACTIONS = actionSet<DeskOn>()("desk", {
  "edit.recover": def({
    summary: "recover typing kept when an edit failed to open: copy it, or open a fresh edit with it inserted; a disk copy stays until the normal draft-copy cleanup",
    keys: "tile menu: recover typed text", touches: "draft", replay: "ask",
    person: "only the person recovers their held typing",
    menu: { label: "recover typed text", group: "Note", now: ({ d, reader }) => d.hasFailedEdit(reader) ? null : { hide: true } },
    args: { op: { type: "string", optional: true, choices: ["copy", "open"], about: "copy the typed text or open the edit with it; absent offers both" } },
    examples: [
      { act: "edit.recover op=copy", does: "copies the text kept when this reader failed to open its edit" },
      { act: "edit.recover op=open", does: "opens a fresh edit in this reader and inserts the kept typing" },
    ],
    run: ({ op }, { d, reader }) => d.recoverEdit(reader, op),
  }),
  "agent.visit": def({
    summary: "take your keys to an agent's explicit pointer", keys: "click an agent pointer",
    touches: "screen", replay: "safe", person: "only the person follows a pointer; agent.focus sets your own",
    args: { agent: { type: "string", about: "the agent whose pointer to visit" } },
    examples: [
      { act: "agent.visit agent=kitty", does: "takes the person's keys to the pointer agent kitty set" },
    ],
    run({ agent }, { d }) { return d.visitAgent(agent); },
  }),
  "screen.spec": def({
    summary: "the screen shown as its spec (PIE-515): its name, title, layout as it opens (containers with policy, tiles by kind), key map, hint, band and where opens land: the data a screen note holds. Nothing on screen moves; layout.get says how it's laid out now",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d }) { return { spec: specData(d.spec) }; },
  }),
  "keys.more": def({
    summary: "show the whole hint row in a box above it, when the screen is too narrow for it and it was cut (it ends \"? more\"); again, or the next key, puts it away. The person's view: an agent's is refused (peek and actions say every key already)",
    keys: "?, a click on ? more",
    touches: "screen", replay: "safe", person: "keys.more is the person's view of their hint row; `actions` lists every key",
    args: {},
    run(_, { d }) { return d.keysMore(); },
  }),
  "tile.arrival.clear": def({ summary: "clear the new arrival accent when you touch a tile", keys: "click, wheel, j, k, ↑, ↓, shift+up, shift+down, PgUp, PgDn", touches: "nothing", replay: "safe", args: {}, run(_, { d, reader }) { return d.clearArrival(reader); } }),
  "search": def({
    summary: "find notes by text (the service's search): query= answers the hits, numbered from 1, each with its id and title; nothing on screen moves. The person's (/) opens the power bar in its notes scope (bar.open scope=notes), where ⏎ opens the hit (`open`) and alt+⏎ opens it in a new detail",
    keys: "/; river column: g",
    touches: "nothing", replay: "safe",
    args: { query: { type: "string", optional: true, about: "the text to find (at least 2 characters)" }, limit: { type: "number", optional: true, about: "how many hits (default 30, at most 100)" } },
    examples: [
      { act: "search query=\"seed swap\"", does: "answers the notes that match seed swap, numbered, with ids; nothing moves" },
      { act: "search query=compost limit=5", does: "answers the five best hits for compost" },
    ],
    run({ query, limit }, { d }, actor) { return d.searchNotes(query, limit, actor); },
  }),
  "open": def({
    summary: "make a note the desk's current one and show it in tile=<tile name, id or #number> (a detail holds it); or, with from=<tile>, where that tile's opens land (its link; unlinked, where the desk's own open puts it; fresh=true: a new tile there). On a screen whose opens land in a container (the board's readers row), tile=detail is the tile an open lands in there, new-detail a new one, float a new one floating. An agent's naming neither (`ep0ch open <id>`) lands where the focused tile's opens go, else a reader that follows, never one the person is typing in. A program in a tile passes from=$EP0CH_TILE, so it never has to know which reader that is. The person's own open gives that reader the keys, an agent's never moves them", keys: "enter in the outline, / search; ⏎ alt+⏎ in a reader that follows (where its opens land)",
    // A reader named (tile=) is moved: an agent's is refused in the one the person has. Naming none (or a place word),
    // it lands where opens land: maybe the note they're reading, said on screen, never their keys or a reader they type in.
    touches: "tile", touchesWith: (_, tile) => (tile !== undefined ? "tile" : "nothing"), way: "opening a note there would move what they're reading · name another reader with tile=, or name none (ep0ch open <id>): it lands where opens land, never their keys or a reader they type in",
    replay: "safe", confirms: true, landing: true, places: ["detail", "new-detail", "float"],
    args: { id: { type: "string", optional: true, about: "the block id (or file=)" }, from: { type: "string", optional: true, about: "open it as this tile's opens go (its link): the tile a program runs in" }, fresh: { type: "boolean", optional: true, about: "with from=: a new tile where its opens land (alt+⏎); alone: a new detail beside the tile with the keys" }, fragment: { type: "string", optional: true, about: "a fragment of the note (^anchor or heading id): the reader scrolls to it and marks it" },
      file: { type: "string", optional: true, about: "a file on this machine (an absolute path) in place of id: Markdown drawn as a preview draws it, any other file through the file Resource reader (PIE-602)" },
      diff: { type: "boolean", optional: true, about: "with file=: its changes (git's diff against its last commit, else against=)" },
      against: { type: "string", optional: true, about: "with file= diff=true: a copy of the file from before the change, for a file outside git" },
      resource: { type: "string", optional: true, about: "a Resource in place of id (PIE-754): file:/path, web:https://… or resource:<id>, registered first when it isn't yet, its stored text shown as a note (as the links tile opens one)" } },
    examples: [
      { act: "open id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 tile=reader", does: "makes that note the desk's current one and shows it in the reader" },
      { act: "open file=/tmp/garden-plan.md", does: "shows the Markdown file as a preview draws it, where opens land" },
    ],
    async run({ id, from, fresh, fragment, file, diff, against, resource }, ctx, actor) {
      // A Resource an extension named (a bar row, a view's link, an action's open): registered if it must be, then shown.
      if (resource !== undefined) {
        const board = ctx.d.ctx?.board;
        if (!board) throw new ActionRefused("there's no outline open to read a Resource through yet");
        const to = resourceRefTarget(resource);
        if ("refused" in to) throw new ActionRefused(to.refused);
        const shown = await openResource(board, to, actor).catch((e: Error) => { throw new ActionRefused(`couldn't show ${resource}: ${e.message}`); });
        return ctx.d.landNote(shown.note, actor);
      }
      // A file lands where an agent's open lands (`ep0ch open file:<path>`): it is no block, so it has no tile's link to follow.
      if (file !== undefined) {
        const board = ctx.d.ctx?.board;
        if (!board) throw new ActionRefused("there's no outline open to read a file through yet");
        return ctx.d.landNote(await fileOpenNote(board, file, { diff: diff === true, ...(against ? { against } : {}) }, actor), actor);
      }
      if (id === undefined) throw new ActionRefused("open needs id=<block id> or file=<absolute path>");
      const r = await openNote({ id, from, fresh }, ctx, actor);
      if (fragment) ctx.d.revealIn(r.reader, fragment, actor);
      return fragment ? { ...r, fragment } : r;
    },
  }),
});

/** Where `open` puts a note: the screen's places, a flow's next column, a tile's link, an agent's landing, a reader. */
function openNote({ id, from, fresh }: { id: string; from?: string; fresh?: boolean }, { d, reader }: DeskOn, actor: Actor): Promise<{ reader: string | null; id: string }> {
  // An agent naming neither (`ep0ch open <id>`): where the focused tile's opens land, never the reader the
  // person types in (openShown). The person's own goes to the focused reader and gives it the keys.
  // The screen's places (its opens land in a container: the board's readers row); elsewhere a tile by that name.
  if ((reader === "detail" || reader === "new-detail" || reader === "float") && d.hasPlaces()) return d.openPlace(id, reader, actor);
  // The person's open naming no tile with their keys in a mounted screen (a group, a board in a tile): its readers take it,
  // so / and the power bar there open where that screen's own opens go, never refused for the screen around it having none.
  const mount = from === undefined && reader === undefined && actor.kind !== "agent" ? d.focusedMount() : null;
  if (mount) return (mount.dispatch.press("open", { id, ...(fresh ? { fresh } : {}) }) as Promise<{ reader: string | null; id: string }>)
    .then(r => ({ ...r, reader: r.reader ? `${mount.name}/${r.reader}` : null }));
  // fresh=true naming neither (the power bar's alt+⏎): a new detail beside the tile with the keys, as alt+⏎ on a link opens one.
  if (fresh && from === undefined && reader === undefined) return d.openFresh(id, actor);
  // The person's open naming no tile, with their keys in a flow (the river's search): the next column, as ⏎ there does.
  if (from === undefined && reader === undefined && actor.kind !== "agent" && d.focusInFlow()) return d.openFrom(id, d.focusedName(), actor, !!fresh);
  return from !== undefined ? d.openFrom(id, from, actor, !!fresh)
    : reader === undefined && actor.kind === "agent" ? d.openLanding(id, actor)
    : d.openIn(id, reader, actor);
}

/** A tree with its tiles' ids mapped (a group's tiles under this screen's ids as it spills, PIE-651). */
function mapTree(n: LNode, f: (id: number) => number): LNode {
  if (n.t === "leaf") return leaf(f(n.id));
  if (n.t === "tabs") return { ...n, ids: n.ids.map(f) };
  if (n.t === "dock") return { ...n, kid: mapTree(n.kid, f) };
  if (n.t === "flow") return { ...n, kids: n.kids.map(k => mapTree(k, f)), ...(n.anchor !== undefined ? { anchor: f(n.anchor) } : {}), ...(n.keep !== undefined ? { keep: f(n.keep) } : {}), ...(n.read !== undefined ? { read: f(n.read) } : {}), ...(n.held ? { held: n.held.map(f) } : {}), trail: undefined };
  return { ...n, kids: n.kids.map(k => mapTree(k, f)) } as LNode;
}

/**
 * Where a tile's content goes inside its frame (`framed`) by its look (PIE-673): its padding (never so much that less
 * than 8 columns or 3 rows are left), and, for a note's text (`measured`), at most `measure` columns, centred.
 */
export function contentRect(framed: Rect, look: Look | undefined, measured: boolean, beside = 0): Rect {
  if (!look) return framed;
  const v = look.values;
  const px = Math.max(0, Math.min(v["pad.x"], Math.floor((framed.cols - 8) / 2))), py = Math.max(0, Math.min(v["pad.y"], Math.floor((framed.rows - 3) / 2)));
  let col = framed.col + px, cols = framed.cols - 2 * px;
  // `beside`: columns the content keeps next to the measured text (a reader's margin column, ADR 0004 contract 6).
  const m = v.measure > 0 ? v.measure + beside : 0;
  if (measured && m > 0 && cols > m) { col += Math.floor((cols - m) / 2); cols = m; }
  return { col, row: framed.row + py, cols, rows: framed.rows - 2 * py };
}
