// The desk: the door owns the whole canvas, and the canvas is tiles (PIE-413). A tile is a view (the outline
// tree, a reader, a detail, a preview, a program in a terminal, a whole screen) in the layout tree: split,
// tabbed, dragged by its header and dropped on another tile's header or centre (tabs), a side (a split)
// or the layout's outer edge (a full-height column or full-width row). A tile can slide over the others as
// a drawer instead, and pinning puts it back. Each tile's opens can land in a tile of its choosing (its
// link, PIE-473). The arrangement is a layout saved by name (PIE-474).
//
// Every change goes through a named action (TILE_ACTIONS, PANE_ACTIONS, DESK_ACTIONS): the keys, the mouse
// and the control socket are callers. The desk draws the borders, headers, tabs and the drag's ghost.
import { shellKeyOf } from "../shell-keys";
import type { Ctx, Frame, Screen, ViewState } from "../app";
import { bodyLinesOf, subject, type Msg } from "../board";
import { Canvas, DOTTED_BOX, overflows, scrollPct, type BoxGlyphs, type Rect } from "../canvas";
import { MOUSE_RIGHT, sideways, SidewaysWheel, type RowPress } from "../scroll";
import { readLinks } from "../links";
import type { Placement } from "../kitty";
import { whoOf, USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, actionSet, def, asBoundKey, hintSpots, keyName, type ActRequest } from "../surface/actions";
import { newNoteOffer } from "../new-note";
import { actorRule, Dispatcher, type Delegation, type MenuRow, type Registration, type RunHow, type TileRef } from "../surface/dispatch";
import type { ScreenKeys, Whereabouts } from "../whereabouts";
import { leaveSaid, NOTE_ACTIONS, type OpenHow, type SurfaceHost } from "../surface/note";
import { keepEditFile } from "../surface/editor";
import { LineInput } from "../surface/line";
import { jevOff, notConfigured, SEARCH_JEV_PAUSE_MS } from "../surface/completer";
import { Modes } from "../surface/modes";
import { centred, linePrompt, ListPicker, pickRow } from "../surface/picker";
import { outlineState, readState, writeState } from "../state";
import { containerKeys, leafNames, madeScreen, savedNodes, screenNames, screenTargetArg, specData, type ScreenSpec } from "./screen-spec";
import { saveScreenNote, screenNotes, trashScreenNote } from "./screen-notes";
import { bg, C, chip as chipStyle, fg, fitHint, headOf, pad, paint, RESET, selected, width } from "../style";
import { themed } from "../theme";
import { ch, type Key, type TileProgram } from "../term";
import { colourBody, wrap } from "../text";
import { emphasis } from "../inline";
import { presentLinks } from "../refs";
import { dropAt, handleDrop, type Drop, type DropTile } from "./drop";
import {
  allTiles, apply as applyOp, autoName, chainOf, describe as describeLayout, dividerAt, dragShare, drawerOf, drawers, EDGE_GLYPH, effective, init, isLine, keepOnScreen, kidsOf, landing, layers as policyLayers, leaf, leaves,
  neighbour, node, parentNode, place as placeLayout, policyAt as policyOver, policyOf, policyOfNode, rects as rectsOf, refusal, reviveTree, revisionRefusal, serialize as serializeLayout, splitAxis,
  shape as layoutShapeOf, shown, splitOf, tabsOf, tileOfColumn, travelTarget, visible, columnOf, UNLOCK, type At, type Axis, type Columns, type Container, type Ctx as LayoutCtx, type Dir, type Divider, type Drawer, type Effective, type Float, type Flow,
  type Grab, type HostMode, type LayoutState, type LNode, type Op, type Place, type Placed, type PlacedDrawer, type Policy, type Result, type TileFacts,
} from "./screen-layout";
import { drawSpine, SPINE } from "../spine";
import { PANE_ACTIONS, type PaneDone } from "./pane-actions";
import { Entered, ReaderPane, sessionName, sessionStart, startSession, type DeskApi, type Pane, type SessionKind } from "./panes";
import { isEscapeChord, PtyPane, ESCAPE_CHORD } from "./pty";
import { ptyBackend } from "./pty-backend";
import { PreviewPane } from "./preview";
import { LocalMarks, markLabel, type Mark, type MarkStore } from "./marks";
import { TILE_ACTIONS, type NewTile, type TileDone, type TileNow, type Where } from "./tile-actions";
import { tileMenu } from "./tile-menu";
import { DOCK_NAME, DOCK_TILE_ID } from "./agent-env";
import { builtin, DetailPane, type SavedFloat, isTileKind, layoutNamed, layoutNames, makeTile, tileKindNames, tileNameProblem, type LayoutSpec, type OpenRule, type SavedTree, type TileSpec } from "./tiles";
import { allKindActions, kindActions, kindForKey, kindNoun, kindOf, lastKindOf, tileKinds, tileSource, unwatchTileKinds, watchTileKinds, wasTileKind, type ColumnsHost, type SourceModel, type TileEnv, type TileKind, type TileKindName } from "./tile-kinds";

/**
 * desk.json: the layout tree of tile specs (pairs as `ratio a b`, what every door reads), the focus, the open
 * rule; and (PIE-491) the layout's revision and the next tile and split ids, so a restarted door never gives
 * out a revision or an id an agent may still hold from before (a Herdr agent outlives the door).
 */
interface SavedDesk { root: SavedTree; focus: number; rule?: OpenRule; layout?: string; rev?: number; next?: { tile?: number; node?: number }; policy?: Policy; floats?: SavedFloat[]; models?: Record<string, unknown> }
/** The desk's own spec (PIE-515): the desk as it has always opened, kept in desk.json, and the screen that loads named layouts. */
export function deskSpec(): ScreenSpec {
  // A layout saved under the name "desk" is the desk's own.
  return { name: "desk", title: "desk", layout: layoutNamed("desk")?.spec ?? builtin("desk")!, saves: "desk.json", layouts: true, stays: true };
}
/** Frame glyphs by a spec's `frame`. */
const FRAMES: Record<NonNullable<ScreenSpec["frame"]>, BoxGlyphs> = { dotted: DOTTED_BOX };

const TO_EDGE: Record<string, Dir> = { H: "left", J: "down", K: "up", L: "right" };
const MOVE: Record<string, Dir> = { h: "left", j: "down", k: "up", l: "right" };
const ARROW: Record<string, string> = { left: "h", right: "l", up: "k", down: "j" };
/** ^W and a key that waits for one more: o O open a kind, m t move beside or into tabs. */
const PREFIX: Record<string, Prefix> = { o: "add", O: "addtab", m: "move", t: "tab" };
/** ^W and a key that runs one action: its args, and its tile (`n` the focused tile's number, `-` none, else its name). */
const WM: Record<string, [string, Record<string, unknown>, ("n" | "-")?]> = {
  "<": ["tile.resize", { by: -1, axis: "row" }, "n"], ">": ["tile.resize", { by: 1, axis: "row" }, "n"],
  "-": ["tile.resize", { by: -1, axis: "col" }, "n"], "+": ["tile.resize", { by: 1, axis: "col" }, "n"],
  z: ["tile.zoom", {}, "n"], "=": ["layout.even", {}, "-"], x: ["tile.close", {}], v: ["tile.preview", { where: "right" }], V: ["tile.preview", { where: "down" }], p: ["tile.pin", {}],
  c: ["tile.collapse", {}], f: ["tile.float", {}], W: ["tile.widen", {}], "]": ["tab.select", { by: 1 }], "[": ["tab.select", { by: -1 }],
  // The dock (PIE-498): into it from a screen, back into the screen shown from it; A brings the dock's tab shown here.
  a: ["host.dock", {}], A: ["host.dock", { on: false }],
  // The tile's menu (PIE-492), as its header's ⋯ and a right-click open it.
  ".": ["tile.menu", {}],
};

type Prefix = "" | "wm" | "add" | "addtab" | "move" | "tab";
/** A key pressed while a tile is dragged by its header: the action its ^W chord runs, on the dragged tile. */
const DRAG_KEYS: Record<string, [string, Record<string, unknown>]> = { f: ["tile.float", {}], p: ["tile.pin", {}], a: ["host.dock", {}] };
/** A header pressed: the tile (a tab) it would drag, and where. A drag of a cell or more starts moving it. */
interface HeadPress { id: number; x: number; y: number }

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
  /** The layout as the module last answered it: read it; it changes by `apply`. */
  private get layout(): LayoutState<number> { return this.state; }
  /** The layout tree as the module last answered it: read it, never change it (`apply` does). */
  private get root(): LNode { return this.layout.tree; }
  /** Tiles with their own rectangle, above everything, the last on top (one float model for every screen). */
  private get floats(): readonly Float<number>[] { return this.layout.floats; }
  /** Tiles folded to a spine (`tile.collapse`), and the agent that folded one, if an agent did. */
  private get collapsed(): ReadonlyMap<number, { by?: string }> { return this.layout.collapsed; }
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
  /** A reader the mouse went down in (PIE-419): its drag selects text, its release is the click. */
  private pressed: { pane: ReaderPane; col: number; row: number; fresh: boolean } | null = null;
  private placed: Placed = { rects: new Map(), nodes: new Map(), dividers: [] };
  /** `inTile`'s tiles, by id: the reader each opened beside, where the person's keys go back when they close it. */
  private openedFrom = new Map<number, number>();
  /** Its own overlays (the search, the layout picker, the policy panel): the first takes every key and click. */
  private readonly overlays = new Modes<Desk, ListPicker<any, Desk>>();
  /** The reader edit, comment or property panel the person is in: only that one takes their keys (PIE-411). */
  private entered = new Entered();
  /** A session the person started by key that is still opening (the note being read): Esc cancels it. */
  private pending: { pane: ReaderPane } | null = null;

  // ── tiles (PIE-413) ──
  /**
   * Tiles saved with a kind nobody has registered: a tile that says so stands in, saves write their spec back
   * as it was, and the tile is made again when the kind comes (`kindsChanged`).
   */
  private unregistered = new Map<number, TileSpec>();
  /** The drawers sliding over the layout as last drawn, each with its tiles (for the mouse). */
  private slid: PlacedDrawer<number>[] = [];
  /** The lock chip at the end of the hint row, as last drawn. */
  private lockChip: { from: number; to: number } | null = null;
  /** The hint row as composed, when it was too long for the row and was cut ("? more"); where "? more" is on it. */
  private hintFull: string | null = null;
  private moreChip: { from: number; to: number } | null = null;
  /** The hint row's parts that start with a key, and the open keys box's: a click on one presses it (`hintSpots`). */
  private keySpots: { y: number; from: number; to: number; key: Key }[] = [];
  /** The tiles' own (PaneView.spots, an empty place's `+ New note`), on the screen; a tile laid over one takes it away. */
  private tileSpots: { y: number; from: number; to: number; key: Key; tile?: number }[] = [];
  /** The whole hint row shown above it (keys.more: ?, or a click on "? more"), until the next key or click elsewhere. */
  private hintMoreOpen = false;
  /** ^W P: the policy panel over the focused tile's containers. */
  /** The spines drawn, for a click. */
  private spines: [number, Rect][] = [];
  /** A float's title or ◢ corner being dragged: it follows the pointer by `float.place`. */
  private floatDrag: { id: number; size: boolean; dx: number; dy: number } | null = null;
  /** The layout last loaded or saved by name. */
  private layoutName: string | null = null;
  /** The terminal tile the person is typing in: every key but the escape chord is its program's. */
  private ptyIn: PtyPane | null = null;
  /** The tile under the pointer's press on a header, and the drag it became. */
  private headPress: HeadPress | null = null;
  /** `dock`: it's over the dock (the status bar's chip, or the drawer), where a release docks it: what that says. */
  private dragging: { src: number; drop: Drop<number> | null; x: number; y: number; dock?: string | null } | null = null;
  /** alt+l: the next click (or h j k l, a digit) picks where this tile's opens land. */
  private linking: { from: number } | null = null;
  /** A tile that takes every mouse event while the button is down (a terminal, a screen). */
  private mouseTile: { id: number; r: Rect } | null = null;
  /** What was drawn, for the mouse: tiles (drawers first, they're on top), header labels, drawer handles. */
  private hits: [number, Rect][] = [];
  private heads: { id: number; from: number; to: number; row: number }[] = [];
  private markHits: { id: number; n: number; from: number; to: number; row: number }[] = [];
  /** Each header's "⇤ drawer" as drawn: a click there pins the drawer (tile.pin on=true). */
  private drawerLabels: { id: number; from: number; to: number; row: number }[] = [];
  /** Each ⧉ as drawn (a float's, and the focused pinned tile's): a click runs tile.float, putting back or floating it. */
  private floatButtons: { id: number; from: number; to: number; row: number }[] = [];
  /** Each closable tile's × (tile.close by mouse). */
  private closeButtons: { id: number; from: number; to: number; row: number }[] = [];
  /** Each tile's ⋯ (its menu, tile.menu), and how far its cell is from the tile's right edge (a float moves under it). */
  private menuButtons: { id: number; from: number; to: number; row: number; right: number }[] = [];
  /** Each open drawer's `[×]` as drawn: a click closes it, as Esc in it does. */
  private drawerCloses: { id: number; from: number; to: number; row: number }[] = [];
  /** Controls a tile put on its header (the backlinks' status) as drawn: a click presses one. */
  private headPresses: { id: number; row: number; from: number; to: number; press: () => void }[] = [];
  /** The tiles whose header carries their controls this frame. */
  private headCtl = new Set<number>();
  private handles: { id: number; from: number; to: number; drawer: Drawer<number> }[] = [];
  private dividers: Divider<number>[] = [];
  private area: Rect = { col: 0, row: 0, cols: 80, rows: 22 };
  /** Attention marks (door-local until PIE-423's service store; only the desk's are saved). */
  private marksStore: MarkStore;
  private headOut = "";
  /** Tiles the host made itself (the showcase's exhibits), by the name the spec gives them: built as given, never saved. */
  private readonly given: ReadonlyMap<string, Pane>;

  /**
   * A screen from its spec: its tiles in its layout, its title, keys, hint and band. One that `saves` comes back as it
   * was left (the desk's desk.json); `opts.layout` lays it out as that named layout instead (the desk's alt+d, --layout).
   * `opts.given`: tiles the host made (the showcase's), by name, used for the spec's leaves of those names.
   * `opts.writes: false`: it reads its save but never writes it (the board in a tile: the board screen owns delivery.json).
   */
  constructor(readonly spec: ScreenSpec = deskSpec(), opts: { layout?: string; given?: ReadonlyMap<string, Pane>; writes?: boolean; where?: () => Whereabouts; idPrefix?: string; openArgs?: Record<string, unknown> } = {}) {
    this.title = spec.title;
    this.idPrefix = opts.idPrefix ?? "t";
    this.whereNow = opts.where ?? null;
    this.writes = opts.writes ?? true;
    this.given = opts.given ?? new Map();
    this.screenOpenArgs = opts.openArgs ?? null;
    this.marksStore = new LocalMarks(!!spec.layouts);
    // An extension's kind that comes or goes while the door runs (PIE-512): its tiles are made again.
    watchTileKinds(this);
    const want = opts.layout && spec.layouts ? layoutNamed(opts.layout) : null;
    const last = spec.saves ? savedScreen(readState<unknown>(spec.saves, outlineState()), spec) : null;
    this.resume(last);
    this.focus = 0;
    if (last?.models && typeof last.models === "object") this.savedModels = { ...last.models };
    const saved = want ? null : last;
    if (want) { this.build(want.spec); this.layoutName = opts.layout!; }
    else if (saved?.root) { this.build({ root: saved.root, focus: spec.home !== undefined ? spec.layout.focus : saved.focus, rule: saved.rule, ...(saved.policy ? { policy: saved.policy } : {}), ...(saved.floats ? { floats: saved.floats } : {}) }, false, true); this.layoutName = saved.layout ?? null; }
    else this.build(spec.layout, false, false, true);
    this.fromSpec(spec);
    // A screen a person made (a screen note) opened by its name: ^W w saves it again under it.
    if (madeScreen(spec.name)) { this.layoutName = spec.name; this.madeAs = spec.name; }
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
      if (p instanceof DetailPane) { const a = p.spec(); return typeof a.note === "string" ? { target: a.note } : a; }
    }
    return this.screenOpenArgs;
  }

  /**
   * What the spec says that a saved layout doesn't override: a columns container's source the spec names outright
   * (`--screen board <hub>`: `hub:<id>`, not `hub:`), and each drawer's own policy, kept for when what it holds goes back
   * into it after being pinned (the board's outline: its width; its backlinks: they stay).
   */
  private fromSpec(spec: ScreenSpec) {
    for (const n of savedNodes(spec.layout.root)) {
      if (n.t === "columns" && typeof n.key === "string" && typeof n.source === "string" && /:./.test(n.source)) {
        const c = node(this.root, n.key);
        if (c?.t === "columns" && c.id && c.source !== n.source) this.apply({ op: "source", container: c.id, source: n.source });
      }
      if (n.t === "drawer" && n.kid?.key && n.policy) { const k = node(this.root, n.kid.key); if (k?.id) this.apply({ op: "remember", key: k.id, policy: n.policy }); }
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
  private autoName(kind: string): string { return autoName(this.layout, kind); }
  private nameOf(id: number) { return this.names.get(id) ?? String(id); }
  /** Every tile: the tree's, a tab set's hidden ones included, then the floats. */
  private all(): number[] { return allTiles(this.layout); }
  private isFloat(id: number) { return this.floats.some(f => f.id === id); }
  private numberOf(id: number) { return this.all().indexOf(id) + 1; }
  /** A tile's stable id (PIE-491): `t<n>`, kept through moves, tabs and saves; never given to another tile. */
  private tileId(id: number) { return `${this.idPrefix}${id}`; }
  /** Its tiles' id letter: `t` on a screen, `k` in the dock (PIE-498: a docked tile's id is never a screen tile's). */
  private readonly idPrefix: string;

  // ── the layout's one way to change (PIE-513) ──

  /** What a tile is, as the layout's rules need it (its kind, its kind's policy, what keeps it, what it holds). */
  private facts(id: number): TileFacts {
    const p = this.panes.get(id), k = kindOf(p), src = this.sourced.get(id);
    const how = src ? tileSource(src.source)?.source.drop : undefined;
    return {
      kind: this.unregistered.get(id)?.kind ?? p?.kind ?? "tile",
      ...(k?.policy ? { policy: k.policy } : {}), ...(k?.accepts?.tiles ? { tabs: k.accepts.tiles } : {}), notes: !!k?.accepts?.notes,
      ...(src ? { keeps: `${src.source} supplies it, and it goes when its data does${how ? ` · to drop it, ${how}` : ""}` } : {}),
      ...(k?.placeholder ? { placeholder: true } : {}),
      ...(p instanceof ReaderPane && p.editing ? { editing: sessionName(p) } : {}),
      ...(p instanceof PtyPane && p.running ? { running: p.run.cmd[0] ?? "a program" } : {}),
      ...(p && this.holdsWork(p) ? { holds: true } : {}),
    };
  }
  /**
   * Who acts, where the person is, the room: what `apply` reads. Where the person is comes from the shell's one
   * answer (the whereabouts query, PIE-514): the tile they type in, and whether they're busy anywhere (here, in the
   * host layer's drawer, in a shell the door waits under). Their focus here is this screen's own state.
   */
  private layoutCtx(actor: Actor): LayoutCtx<number> {
    const w = this.dispatch.where();
    const typing = w.typingIn !== null ? this.idNamed(w.typingIn) ?? null : null;
    return {
      actor, area: this.area, tile: id => this.facts(id),
      person: { focus: this.focus, typingIn: typing, busy: w.busy, held: actorRule({ touches: "screen" }, actor, w, {}), here: w.focus !== null || w.typingIn !== null },
      kinds: { all: tileKindNames(), notes: tileKinds().filter(k => k.accepts?.notes).map(k => k.kind) },
    };
  }
  /** What `op` would do, asked (nothing changes): the new state, or the refusal. */
  private ask(op: Op<number>, actor: Actor = USER): Result<number> { return applyOp(this.layout, op, this.layoutCtx(actor)); }
  /** Take the module's answer: its state is the layout now, the keys go where it says; a refusal is thrown, nothing done. */
  private commit(r: Result<number>): Extract<Result<number>, { ok: true }> {
    if (!r.ok) throw new ActionRefused(r.refused);
    // An answer asked of an earlier state would undo what changed since: never taken (asks and commits are paired).
    if (r.base !== this.state) throw new Error("a layout answer was committed over a newer layout; ask again");
    const was = this.layout.collapsed;
    this.state = r.state;
    this.focus = r.focus;
    this.noteFocus();
    // A tile folded or opened is told (it keeps what it holds exactly).
    for (const id of new Set([...was.keys(), ...r.state.collapsed.keys()])) if (was.has(id) !== r.state.collapsed.has(id)) this.panes.get(id)?.folded?.(r.state.collapsed.has(id));
    return r;
  }
  /** Apply one layout operation for `actor`: the layout changes as one checked step, or the refusal is thrown. */
  private apply(op: Op<number>, actor: Actor = USER): Extract<Result<number>, { ok: true }> { return this.commit(this.ask(op, actor)); }

  // ── building a layout (PIE-474) ──────────────────────────────────────────

  /**
   * Lay out `spec`. With `reuse`, a tile already here with the same name and kind (and program) is kept as
   * it is; the ones the layout has no place for that hold work (a running program, an unsaved edit) are kept
   * in a shut drawer on the right, and the rest are closed.
   */
  private build(spec: LayoutSpec, reuse = false, restore = false, own = false): void {
    // A saved id is the tile's, split's or tab set's own only when this is desk.json coming back (`restore`) or
    // it was never given out here: a layout loaded from a screen note never hands a gone tile's id to another.
    const mine = (n: number, next: number) => n > 0 && (restore || n >= next);
    const old = new Map(this.panes);
    const oldNames = new Map(this.names);
    const byName = new Map([...this.names].map(([id, n]) => [n, id] as const));
    const used = new Set<number>(), fresh: number[] = [], wantLinks: [number, string][] = [];
    const names = new Map<number, string>();
    const folded = new Map<number, { by?: string }>();
    const auto = (kind: string) => autoName({ names }, kind);
    if (!reuse) this.panes.clear();
    const tileOf = (l: TileSpec) => {
      // A kind nobody registers here is made as a tile that says so (src/desk/tiles.ts makeTile).
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
      used.add(id);
      // A kind nobody has registered (an extension not loaded yet) says so in its place; its spec is kept as saved.
      // A tile the host gave (an exhibit) is its own kind, never one waiting for its extension.
      if (!isTileKind(l.kind) && !((own || restore) && l.name && this.given.has(l.name))) this.unregistered.set(id, l); else this.unregistered.delete(id);
      if (l.link) wantLinks.push([id, l.link]);
      if (l.collapsed) folded.set(id, {});
      return id;
    };
    const root = reviveTree(spec.root, tileOf);
    // Floats (PIE-511) come back where they were, each its own tile.
    const floats: Float<number>[] = (Array.isArray(spec.floats) ? spec.floats : []).filter(f => f?.tile?.t === "leaf" && isRect(f.rect)).map(f => ({ id: tileOf(f.tile), rect: { ...f.rect } }));
    // A saved tree with no tiles in it (a hand-edited save): the desk's own layout instead.
    if (!leaves(root).length) return this.build(builtin("desk")!, reuse);
    let tree = root;
    // What the new layout has no place for: kept when it holds work (in one shut drawer on the right), else closed.
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
      tree = splitOf("row", [tree, { t: "drawer", kid, edge: "right", open: false }], [0.7, 0.3]);
    }
    const links = new Map<number, number>();
    // A spec may link a tile to itself (the welcome's preview: its own links open in it); a saved layout never does.
    for (const [id, to] of wantLinks) { const t = [...names].find(([, n]) => n === to)?.[0]; if (t !== undefined && (t !== id || own)) links.set(id, t); }
    // The open rule is the screen's policy now (PIE-513); a spec's `rule` says it as it did.
    const policy = { ...policyOf(spec.policy), ...(spec.rule === "next" ? { opens: "next" as const } : {}) };
    const next = init({ tree, names, floats, collapsed: folded, links, policy }, this.layout, { freshIds: !restore });
    // Nothing left to show (a saved layout of empty tab sets): the layout named desk.
    if (!leaves(next.tree).length) return this.build(layoutNamed("desk")!.spec, reuse);
    this.state = next;
    const ids = this.all();
    const f = typeof spec.focus === "string" ? [...names].find(([, n]) => n === spec.focus)?.[0] : ids[typeof spec.focus === "number" ? spec.focus : 0];
    this.focus = f !== undefined && ids.includes(f) ? f : ids[0]!;
    this.keysTo(this.focus);
    if (this.ctx) for (const id of fresh) this.startTile(id);
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
  /** The tiles that follow tile `id` (a preview with source=tile:<its name>), by their kinds' `follows`. */
  private followers(id: number): Pane[] {
    // A source may name a container (`tile:lanes`, the board's columns): any tile in it is followed.
    const names = new Set([this.nameOf(id), ...chainOf(this.root, id).flatMap(c => (isLine(c) && c.key ? [c.key] : []))]);
    // A follower moved here from another screen follows the very tile it followed there, never one here of that name.
    const src = this.panes.get(id);
    return [...this.panes].filter(([pid, q]) => { const f = kindOf(q)?.follows?.(q); const b = boundSource.get(q); return pid !== id && f !== null && f !== undefined && names.has(f) && (b === undefined || b === src); }).map(([, q]) => q);
  }

  /** A tile joins a live desk: it reads what it needs (its kind's `start`: a detail its note, a preview its source). */
  private startTile(id: number, moved = false) {
    const p = this.panes.get(id)!;
    const env: TileEnv = {
      desk: this, id: this.tileId(id), name: this.nameOf(id), place: this.layoutName ?? "desk", home: this.spec.saves ?? null,
      tile: name => { const t = this.idNamed(name); return t !== undefined ? this.panes.get(t) : undefined; },
      followers: () => (this.panes.has(id) ? this.followers(id) : []),
      ...(moved ? { moved } : {}),
    };
    p.init?.(this);
    // A tile moved here (from another screen, or the dock) keeps the note it shows: it isn't handed this one's.
    if (!moved) p.select?.(this.current, this);
    kindOf(p)?.start?.(p, env);
  }

  /** What tile `name` shows or has selected (a reader's note, the tree's row, a screen's card), for a tile that follows it. */
  tileShowing(name: string): Msg | null {
    const id = this.idNamed(name);
    return this.showing(id !== undefined ? this.panes.get(id) : undefined);
  }

  private idNamed(name: string): number | undefined { return [...this.names].find(([id, n]) => n === name && this.panes.has(id))?.[0]; }

  private specOf(id: number): TileSpec {
    const p = this.panes.get(id)!;
    const link = this.layout.links.get(id);
    const k = kindOf(p), kept = this.unregistered.get(id);
    return {
      ...(kept ? (({ link: _l, ...rest }) => rest)(kept) : {}),
      t: "leaf", kind: kept?.kind ?? p.kind, name: this.nameOf(id), id: this.tileId(id), ...(kept ? {} : (k?.save ? k.save(p) : p.spec?.()) ?? {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : {}),
      ...(this.collapsed.has(id) ? { collapsed: true as const } : {}),
    };
  }

  /**
   * The layout as saved: without a ctrl+e edit tile, whose temp file and draft go when the door does (restored,
   * it would edit a file that's gone and bring nothing back).
   */
  /** Tiles opened into a container (the board's details) are opened, not kept, as a ctrl+e edit tile isn't. */
  private saved() { return serializeLayout(this.layout, id => this.specOf(id), id => { const p = this.panes.get(id); return (p instanceof PtyPane && !!p.run.temp) || this.openedInto(id) !== undefined; }); }
  /** The layout as saved: tile specs in the tree of containers (each with its policy), the focus, the open rule, the screen's policy. */
  layoutSpec(): LayoutSpec { return { ...this.saved(), focus: this.nameOf(this.focus), rule: this.rule }; }
  private savedPolicy() { return Object.keys(this.layout.policy).length ? { policy: { ...this.layout.policy } } : {}; }

  private readonly writes: boolean;
  /** Where the person is, as a host that frames this screen says it (the dock's tiles: only while the keys are in the dock). */
  private whereNow: (() => Whereabouts) | null = null;
  save() {
    if (!this.spec.saves || !this.writes) return;
    const models = Object.fromEntries([...this.models].map(([cid, m]) => [this.columnsIn().find(c => c.id === cid)?.key ?? cid, m.save?.()] as const).filter(([, v]) => v !== undefined));
    writeState(this.spec.saves, { ...this.saved(), focus: this.all().indexOf(this.focus), rule: this.rule, ...(this.layoutName ? { layout: this.layoutName } : {}), rev: this.layout.rev, next: { tile: this.nextId, node: this.layout.nextNode }, ...(Object.keys(models).length ? { models } : {}) } satisfies SavedDesk, outlineState());
  }

  // ── DeskApi ────────────────────────────────────────────────────────────────

  enter(ctx: Ctx) {
    const again = !!this.ctx;
    this.ctx = ctx; this.onScreen = true;
    if (again) return;
    for (const id of this.all()) this.startTile(id);
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
  private async fill(c0: Columns<number>): Promise<void> {
    const src = tileSource(c0.source);
    const cid = c0.id;
    if (!src || !this.ctx || !cid) return;
    const asked = c0.source!;
    let got: Awaited<ReturnType<typeof src.source.tiles>>;
    try { got = await src.source.tiles(src.arg, this); }
    catch (e) { this.ctx.flash(`couldn't fill ${c0.key ?? cid} from ${asked}: ${e instanceof Error ? e.message : String(e)}`); return; }
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
    this.apply({ op: "fill", container: cid, order, fresh, drop, names });
    for (const id of drop) this.dropTile(id);
    for (const [id] of [...this.sourced]) if (!this.panes.has(id)) this.sourced.delete(id);
    const c = this.columnsIn().find(x => x.id === cid);
    if (!c) return;
    this.filledOnce.add(cid);
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
    const c = this.columnsIn().find(x => x.id === container), key = c?.key;
    return key ? [...this.panes.values()].filter(q => kindOf(q)?.follows?.(q) === key) : [];
  }
  nameOfPane(p: Pane): string { const id = this.idOf(p); return id === undefined ? "" : this.nameOf(id); }
  enterSession(p: ReaderPane) { this.entered.enter(p); this.ctx.flash(`in ${sessionName(p)} · ${p.hint()}`); this.redraw(); }
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
    this.onScreen = false;
    if (this.spec.stays && this.running().length) { Desk.kept = this; return "keep"; }
    // Gone for good: kinds that come later never make tiles (nor start programs) here.
    this.disposed = true;
    unwatchTileKinds(this);
    // A tile moved here from the dock that still holds work (a program running) goes back to it, never ended with this screen.
    for (const id of [...this.movedIn]) {
      const p = this.panes.get(id);
      if (!p || !this.holdsWork(p) || !this.ctx?.hostLayer) continue;
      try { this.ctx.hostLayer.keep({ pane: p, name: this.nameOf(id), spec: this.specOf(id), from: this.title, typing: false }); this.forgetTile(id, p); } catch { /* ends with the screen */ }
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
  /** Shown or not, for a screen a host draws itself (the dock's tiles): its tiles' repaints reach the door only while shown. */
  shownAs(on: boolean) { if (this.ctx) this.onScreen = on; }
  /** The programs this desk runs (the agent isn't one of them: it lives in the host layer, PIE-513). */
  /** Its terminal tiles with a program running, or kept for them in a session's terminal host (not drawn since a handoff). */
  private running() { return [...this.panes.values()].filter((p): p is PtyPane => p instanceof PtyPane && (p.running || (!!p.keptAs && ptyBackend().holds(p.keptAs)))); }
  /** A desk built for another view (the brief) has no way back: leaving it would end its programs, so it says so. */
  leaveRefusal(): string | null {
    // A tile the dock gave this screen goes back to the dock when it's left (dispose): it doesn't hold the screen.
    const back = (p: PtyPane) => !!this.ctx?.hostLayer && [...this.movedIn].some(id => this.panes.get(id) === p);
    const r = this.spec.stays ? [] : this.running().filter(p => !back(p));
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "runs" : "run"} in a tile here · ^W a docks ${r.length === 1 ? "it" : "them"} (it travels with you), ^W x ends ${r.length === 1 ? "it" : "them"}` : null;
  }

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    const by = opts.by ?? USER;
    // An open fresh (alt+⏎, a ctrl- or alt-click) from one of its tiles runs the screen's own action for it, as whoever
    // opened it (the welcome reads it in its detail: `ScreenSpec.fresh`).
    if (m && opts.fresh && this.spec.fresh && this.idOf(opts.from) !== undefined) { void this.perform(this.spec.fresh, { id: m.id }, by); return; }
    // A tile whose opens go beside it (its policy's open rule, `beside`: a pinned page, the brief): a reader beside it
    // follows the note (the one there, or one split off to its right); the tile itself stays on its own.
    const at = this.idOf(opts.from);
    if (m && !opts.fresh && at !== undefined && this.policyAt(at).opens === "beside") this.readerBeside(opts.from!, by);
    // An open from a tile whose opens land in a container (the board's readers row): a tile there holds it; a fresh
    // one (alt+⏎) opens another there.
    const into = m && at !== undefined && (opts.link || opts.reveal || opts.fresh) ? landing(this.layout, at, this.facts(at)) : null;
    if (m && into && "into" in into) { this.current = m; this.openIntoContainer(into.into, m, !!opts.fresh, by, at); return this.redraw(); }
    // alt+⏎ on a link, or a ctrl- or alt-click (PIE-441, PIE-473): a new reader beside this one holds it;
    // the others keep their notes. An agent's doesn't take the person's focus.
    // On a locked screen nothing new opens (its shape is fixed): the open lands as the current one instead.
    if (m && opts.fresh && opts.from instanceof ReaderPane) {
      const at = this.idOf(opts.from);
      // In a flow (the river's columns): a new column after its own, as its kind opens one.
      if (at !== undefined && this.inFlow(at)) { if (this.openNext(at, m, opts.by ?? USER, true) !== undefined) return this.redraw(); }
      // A held reader: a detail by another name.
      if (at !== undefined && this.openReader(m, { kind: "split", target: at, dir: "right" }, opts.by ?? USER)) return this.redraw();
    }
    const from = this.idOf(opts.from);
    // A preview follows its source tile's selection (PIE-473).
    if (m && from !== undefined) for (const p of this.followers(from)) p.follow?.(m, this);
    // An open (a link followed, the tree's ⏎, a list's pick) lands in the tile's link (or its container's opens-into),
    // or, in a flow, in a new column right after the tile's own (the flow's open rule, PIE-513).
    if (m && from !== undefined && (opts.link || opts.reveal) && this.routes(opts.from!)) {
      const to = landing(this.layout, from, this.facts(from));
      if (to && "to" in to && this.openInto(to.to, m)) return this.redraw();
      if (to && "next" in to && this.openNext(from, m, opts.by ?? USER, !!opts.fresh) !== undefined) return this.redraw();
    }
    this.current = m;
    for (const p of this.panes.values()) {
      p.select?.(m, this);
      // Revealing moves the outline's cursor to the note: the person's own opens only (an agent's never does).
      if (opts.reveal && m && p !== opts.from && opts.by?.kind !== "agent") void p.reveal?.(m, this);
    }
    // The person's open that nothing here shows (the outline's ⏎ with no reader following the current note): said, with
    // how to give it somewhere to land, never a silent change of the current note.
    const shownBy = (p: Pane) => p !== opts.from && kindOf(p)?.shows?.(p)?.id === m?.id && this.shownNow(p);
    if (m && opts.from && (opts.link || opts.reveal) && opts.by?.kind !== "agent" && ![...this.panes.values()].some(shownBy)) {
      this.ctx.flash(`no tile here shows ${headOf(subject(m), 30)} · alt+l in ${this.nameOfPane(opts.from)}, then a click on a reader, sends its opens there; ^W o r opens a reader`);
    }
    this.redraw();
  }

  /**
   * A selection moved in `from` (a backlinks tile's row): the previews following it, and its link, show `m`.
   * The current note stays, so a reader that follows it (maybe the tile `from` lists the backlinks of) doesn't move.
   */
  showFrom(from: Pane, m: Msg) {
    const id = this.idOf(from);
    if (id === undefined) return;
    for (const p of this.followers(id)) p.follow?.(m, this);
    const to = this.linkOf(id);
    if (to !== undefined) this.openInto(to, m);
    this.redraw();
  }

  /** Opens from `pane` land somewhere else (a link, a flow's next column): a held reader doesn't follow them in place. */
  routes(pane: Pane): boolean {
    const id = this.idOf(pane);
    return id !== undefined && landing(this.layout, id, this.facts(id)) !== null;
  }

  /**
   * Where tile `id`'s opens land: its own link, else the opens-into of the nearest container that names one
   * (PIE-505's policy); undefined when neither names a tile here (or names itself). The module answers it.
   */
  private linkOf(id: number): number | undefined {
    const to = landing(this.layout, id, this.facts(id));
    return to && "to" in to && this.panes.has(to.to) ? to.to : undefined;
  }

  /**
   * A new reader holding `m` at `at` (beside a reader: alt+⏎, a ctrl-click; the next column of a flow), by
   * `tile.open`'s operation. False, said, when the layout refuses it (a locked screen): the open lands as the
   * current note instead.
   */
  private openReader(m: Msg, at: At<number>, actor: Actor, kind: "reader" | "detail" = "reader", spec?: TileSpec): boolean {
    const as: TileSpec = { ...(spec ?? { t: "leaf", kind }) };
    // Named for what it is (its kind's word: a river column is a column), numbered after the first.
    if (!as.name) as.name = this.autoName(kindOf({ kind: as.kind } as Pane)?.word ?? as.kind);
    // Asked before the tile is made: a refused open makes nothing.
    const r = this.ask({ op: "open", tile: this.nextId, kind: as.kind, name: as.name, loose: true, at }, actor);
    if (!r.ok) { this.ctx.flash(`${r.refused} · opened here instead`); return false; }
    const id = this.put(makeTile(as));
    this.commit(r);
    this.startTile(id);
    (this.panes.get(id) as ReaderPane).hold(m, this);
    this.save();
    return true;
  }
  /**
   * An open from tile `from` in a flow: a column after its own holding `m` (a detail: it keeps its note, saved with
   * the layout), or the column that shows `m` already (back from it returns to `from`). The person's goes there; an
   * agent's leaves their keys where they are.
   */
  private openNext(from: number, m: Msg, actor: Actor, fresh = false): number | undefined {
    // A tile that holds it already (not one that only has it selected in a list: the river's Library) is where it opens.
    const there = fresh ? undefined : this.namedReaders().find(x => x.id !== from && x.pane.msg?.id === m.id && !x.pane.editing && !kindOf(x.pane)?.lists?.(x.pane));
    if (there) { const r = this.ask({ op: "open", tile: there.id, kind: "reader", at: { kind: "next", from } }, actor); if (r.ok) { this.commit(r); this.save(); return there.id; } }
    // A tile of a kind that opens its own (a river column) opens one; else a detail.
    const p = this.panes.get(from), spec = p ? kindOf(p)?.opensNext?.(p, m) : undefined;
    const id = this.nextId;
    return this.openReader(m, { kind: "next", from }, actor, "detail", spec) ? id : undefined;
  }

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
   * there opens its own links in place. Past the container's `keep`, the oldest free one gives way (never the one the
   * person is in, nor, for an agent, the one they have). A locked or gone container takes none: the note opens in a
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
      if (r instanceof ReaderPane) { r.surface.track(() => r.hold(m, this)); return from; }
    }
    let ids = this.openedTiles(key).filter(id => !this.isFloat(id));
    const active = this.activeIn(key);
    const busy = (id: number) => { const p = this.panes.get(id); return p instanceof ReaderPane && (p.holdsKeys || p === person); };
    const wantNew = fresh || active === undefined || busy(active);
    let to = active;
    if (wantNew) {
      const why = this.openRefusal(key, actor);
      if (why) {
        // Nothing new opens here (a lock): a free tile opened here takes it, else the first tile here that takes notes.
        // An agent's never lands in the tile the person has (or reads through): refused instead.
        const theirs = (id: number) => agent && (id === this.focus || this.panes.get(id) === this.readerOfFocus());
        const free = ids.find(id => !busy(id) && !theirs(id));
        const take = free ?? leaves(c).find(id => kindOf(this.panes.get(id))?.accepts?.notes && !theirs(id));
        if (agent && take === undefined) { this.openWhy = `not opened: ${why}`; return undefined; }
        this.ctx.flash(`${why} · opened in ${take !== undefined ? this.nameOf(take) : "nothing"}`);
        const p = take !== undefined ? this.panes.get(take) : undefined;
        if (p instanceof ReaderPane) p.surface.track(() => (free !== undefined ? p.hold(m, this) : p.show(m, this)));
        if (free !== undefined) rec.active = free;
        return p instanceof ReaderPane ? take : undefined;
      }
      const keep = c.policy?.keep ?? Infinity;
      if (ids.length >= keep) {
        // An agent's open never replaces the tile the person has: it's refused instead.
        const drop = ids.find(id => !busy(id) && !(agent && this.panes.get(id) === mine));
        if (drop === undefined) { this.openWhy = agent && ids.some(id => !busy(id)) ? `not opened: the other tiles in ${key} hold edits, comments or properties, and the person has this one` : `not opened: every tile in ${key} holds an edit, a comment or properties · save or close one first`; this.ctx.flash(this.openWhy); return undefined; }
        this.closeId(drop);
      }
      to = this.openNewIn(key, actor);
      if (to === undefined) return undefined;
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
    this.save();
    return to!;
  }
  /** Why the last open into a container took nothing (every tile there busy), as it was said. */
  private openWhy: string | null = null;
  /** Why a new tile can't open into container `key` now (a lock over it), in the layout's words, or null. */
  private openRefusal(key: string, actor: Actor): string | null {
    const r = this.ask({ op: "open", tile: this.nextId, kind: "detail", loose: true, at: { kind: "in", key, weight: this.weightIn(key) }, keys: false }, actor);
    return r.ok ? null : r.refused;
  }
  /** A new tile opened into container `key` takes three parts to its first tile's four. */
  private weightIn(key: string): number { const c = node(this.root, key); return ((c && "weights" in c ? c.weights[0] : undefined) ?? 4) * 0.75; }
  /** A new detail in container `key`, named by its kind and a number never given there before (detail1, detail2). */
  private openNewIn(key: string, actor: Actor, at: At<number> = { kind: "in", key, weight: this.weightIn(key) }): number | undefined {
    const rec = this.openedIn(key), n = rec.count + 1, name = `detail${n}`;
    const r = this.ask({ op: "open", tile: this.nextId, kind: "detail", name, loose: true, at, keys: false }, actor);
    if (!r.ok) { this.ctx.flash(r.refused); return undefined; }
    rec.count = n;
    const pane = makeTile({ kind: "detail", label: `detail ${n}` });
    const id = this.put(pane);
    this.commit(r);
    rec.ids.push(id);
    this.startTile(id);
    return id;
  }

  /** Show `m` in tile `to` (its link target): false when that tile can't show a note, or holds an edit. */
  private openInto(to: number, m: Msg): boolean {
    const p = this.panes.get(to), k = kindOf(p);
    // A tile whose kind takes notes takes it its own way (a preview follows it, a reader holds it in its history).
    if (!p || !k?.accepts?.notes || !k.take) { this.ctx.flash(`${this.nameOf(to)} can't show a note · alt+l links this tile somewhere else`); return false; }
    const why = k.take(p, m, this);
    if (why) { this.ctx.flash(`${this.nameOf(to)} ${why} · the note opened as the current one instead`); return false; }
    return true;
  }


  /** DeskApi.summaryKeys: the summary a note shows with, as the columns listing it say (a board lane's view). */
  summaryKeys(m: Msg): readonly string[] | null { for (const md of this.models.values()) { const k = md.summaryKeys?.(m); if (k) return k; } return null; }

  /** DeskApi.shownNow: tile `p` is on screen (a float, or a tile shown in the tree). */
  shownNow(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && (this.isFloat(id) || visible(this.root).includes(id)); }

  /** A reader in a container that shuts its drawer (the board's outline and backlinks previews): it follows its list. */
  private inShutting(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && chainOf(this.root, id).some(c => c.policy?.shuts); }
  /**
   * DeskApi.aimBacklinks, the person's: backlinks tile `L` lists `m`'s backlinks, or the note of the reader they read
   * through (the focused reader, else the one following their columns); it follows the reader that shows it, its
   * drawer slides open, and the keys go to it. Resolves once the service has answered.
   */
  async aimBacklinks(L: Pane & { source: string; show(m: Msg, desk: DeskApi): Promise<void> }, m: Msg | null, given?: ReaderPane): Promise<void> {
    const lid = this.idOf(L);
    if (lid === undefined) throw new ActionRefused("that backlinks tile isn't on this screen");
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && !this.inShutting(p));
    const f = this.panes.get(this.focus);
    const forKeys = (f instanceof ReaderPane && !this.inShutting(f) ? f : undefined) ?? this.readerOfFocus()
      ?? readers.find(r => { const k = kindOf(r)?.follows?.(r); return !!k && this.columnsIn().some(c => c.key === k); }) ?? readers[0];
    const reader = given ?? (m ? readers.find(r => r.msg?.id === m.id) : undefined) ?? forKeys;
    const note = m ?? reader?.msg ?? null;
    if (!note) throw new ActionRefused("nothing in that reader to find backlinks for");
    const rid = this.idOf(reader);
    if (rid !== undefined) L.source = this.nameOf(rid);
    const d = drawerOf(this.root, lid);
    if (d && !d.open) this.apply({ op: "drawer", tile: lid, open: true });
    if (this.focus !== lid) { this.keysTo(lid); this.entered.clear(); }
    this.redraw();
    await L.show(note, this);
    L.focused?.(this, USER);
    this.save(); this.redraw();
  }

  /**
   * DeskApi.openLinks (`b` in a reader): reader `r`'s note's links in this screen's links tile. The person's aims the
   * tile (aimBacklinks: its drawer opens, their keys go to it); an agent's aims it without moving their keys. A screen
   * with none gets one below the reader, with a preview following its selection beside it (tile.open, as ^W o l and
   * ^W o p do), both by the actor: the layout's rules apply, so a locked screen says so.
   */
  async openLinks(r: Pane, actor: Actor): Promise<Record<string, unknown>> {
    const rid = this.idOf(r);
    const m = r instanceof ReaderPane ? r.msg : null;
    if (rid === undefined || !m) throw new ActionRefused("that reader isn't on this screen");
    const person = actor.kind !== "agent";
    // The screen's list `b` aims (a kind with `aim`: the links tile), one on screen first.
    const lists = [...this.panes.values()].flatMap(p => { const a = kindOf(p)?.aim?.(p); return a ? [a] : []; });
    let L = lists.find(p => this.shownNow(p)) ?? lists[0];
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
    if (person) await this.aimBacklinks(L, m, r as ReaderPane);
    else if (opened) await L.show(m, this);                                       // its own new tile: nobody else's list
    else {
      // The person's list stays as it is (its note, its selection): an agent reads the note's links instead.
      return { tile: this.nameOf(this.idOf(L)!), of: m.id, opened, links: await readLinks(this.ctx.board, m.id) };
    }
    this.redraw();
    return { tile: this.nameOf(this.idOf(L)!), of: m.id, opened, links: L.describe() };
  }

  /** DeskApi.hasFocus: tile `p` has the person's focus (a whole screen in it sees them through it). */
  hasFocus(p: Pane): boolean { return this.panes.get(this.focus) === p || this.readerOfFocus() === p; }
  /**
   * The reader the person reads through while their keys are in a list of columns (PIE-453: the board's lanes, whose
   * card its preview shows): it has their focus too, for what it draws and for whose it is.
   */
  private readerOfFocus(): ReaderPane | undefined {
    const c = chainOf(this.root, this.focus).find(x => x.t === "columns");
    const key = c && c.key;
    return key ? [...this.panes.values()].find((q): q is ReaderPane => q instanceof ReaderPane && kindOf(q)?.follows?.(q) === key) : undefined;
  }
  /** The kind of tile that has the person's keys (a view's own keys step aside for a tile that uses them). */
  private focusedKind(): TileKindName | undefined { return this.panes.get(this.focus)?.kind as TileKindName | undefined; }

  /** The person's keys to the first tile of `kind` (waiting's ⏎, the tree's open): `tile.focus`, as their key does. */
  focusKind(kind: TileKindName) {
    const id = this.all().find(i => this.panes.get(i)?.kind === kind);
    if (id !== undefined && id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
  }

  /** The shell's actions (screen.back, video.cycle) as the person's key (src/shell-keys.ts: screens.ts imports this module). */
  private shell(name: "screen.back" | "video.cycle") { shellKeyOf(name, this, this.ctx); }

  /** A repaint, while the desk is the screen shown (kept in the background, its programs don't repaint the menu). */
  redraw() { if (this.onScreen) this.ctx?.redraw(); }

  tick(): boolean { let any = false; for (const p of this.panes.values()) if (kindOf(p)?.tick?.(p)) any = true; return any; }

  onEvent(e: OutlineEvent) {
    this.hear(e);
    for (const m of this.models.values()) m.onEvent?.(e);
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
    try { this.landBlock(m, by); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e)); }
  }
  /**
   * Where an open naming no tile lands: the tile the spec says (`ScreenSpec.lands`) takes it its kind's way, a refusal
   * thrown (an agent's `open` is told why); else where the focused tile's opens land (`openShown`).
   */
  private landBlock(m: Msg, by: Actor) {
    // A flow by its key (the river's): the note opens in the column after the one the keys are in (or the last), its way.
    const flow = this.spec.lands !== undefined && this.idNamed(this.spec.lands) === undefined ? node(this.root, this.spec.lands) : null;
    if (flow?.t === "flow") {
      const ids = leaves(flow), from = ids.includes(this.focus) ? this.focus : ids.at(-1);
      if (from === undefined || this.openNext(from, m, by) === undefined) throw new ActionRefused(`not opened: ${this.spec.lands} took no column for it`);
      this.current = m;
      this.redraw();
      return;
    }
    // A container by its key (the board's readers row): a tile opened there holds it, quietly for an agent.
    if (this.spec.lands !== undefined && this.idNamed(this.spec.lands) === undefined && node(this.root, this.spec.lands)) {
      this.current = m;
      const at = this.openIntoContainer(this.spec.lands, m, false, by);
      this.redraw();
      if (at === undefined) throw new ActionRefused(this.openWhy ?? `not opened: nothing in ${this.spec.lands} could take it`);
      return;
    }
    const lands = this.spec.lands !== undefined ? this.idNamed(this.spec.lands) : undefined;
    const p = lands !== undefined ? this.panes.get(lands) : undefined, take = p ? kindOf(p)?.take : undefined;
    if (p && take) { const why = take(p, m, this, by); this.redraw(); if (why) throw new ActionRefused(/^(holds|is|has|can't)\b/.test(why) ? `${this.nameOf(lands!)} ${why}` : why); return; }
    this.openShown(m, by);
  }
  /** `openBlock`, saying which reader it landed in. */
  private openShown(m: Msg, by: Actor): string | null {
    const link = this.linkOf(this.focus);
    // Not a tile that follows a source (a preview of a tile or a file): what it shows is its source's.
    const readers = this.namedReaders().filter(r => !r.pane.holdsKeys && !r.pane.editing && !kindOf(r.pane)?.follower);
    const r = (link !== undefined ? readers.find(x => x.id === link) : undefined) ?? readers.find(x => x.pane.follows && !x.pane.holding) ?? readers[0];
    const show = () => { this.setCurrent(m, { by }); if (r && r.pane.msg?.id !== m.id) { if (r.pane.holding) r.pane.hold(m, this); else r.pane.show(m, this); } };
    if (r) r.pane.surface.track(show); else show();
    this.redraw();
    return r?.name ?? null;
  }

  /**
   * `open from=<tile>` (PIE-491): the note lands where tile `from`'s opens go, its link (the daily layout's claude
   * tile links to middle). Unlinked, where `ep0ch open <id>` puts it. The caller names its own tile, never a reader.
   */
  async openFrom(id: string, from: string, actor: Actor, fresh = false): Promise<{ reader: string | null; id: string }> {
    // The host layer's agent (PIE-513: it lives above every screen, no tile here) opens where an agent's open lands.
    if ((from === DOCK_NAME || from === DOCK_TILE_ID) && this.idNamed(from) === undefined) return this.openLanding(id, actor);
    // Read with `tile=`'s grammar (a name, an id, a number), as an argument that may name the host layer's agent.
    const t = this.tile(this.dispatch.name(from) ?? from);
    // Its opens land in a container (the board's readers row): a tile there holds it (`fresh`: a new one).
    const into = landing(this.layout, t.id, this.facts(t.id));
    if (into && "into" in into) return this.openPlace(id, fresh ? "new-detail" : "detail", actor, t.id);
    const to = this.linkOf(t.id);
    // A column of a flow (the river's): the column after it (`fresh`: a new one even when a column has the note).
    if (to === undefined && this.inFlow(t.id)) {
      const m = this.onScreenBlock(id) ?? await this.ctx.board.get(id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      const at = this.openNext(t.id, m, actor, fresh);
      if (at === undefined) throw new ActionRefused(`not opened: ${t.name}'s flow took no column for it`);
      this.current = m;
      this.redraw();
      return { reader: this.nameOf(at), id: m.id };
    }
    if (to !== undefined && this.panes.get(to) instanceof ReaderPane) return this.openIn(id, this.nameOf(to), actor);
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    // A linked tile that takes notes its own way (an extension's kind): it takes it there.
    if (to !== undefined && this.openInto(to, m)) { this.redraw(); return { reader: this.nameOf(to), id: m.id }; }
    return this.land(m, actor);
  }

  /**
   * An agent's `open id=` naming no reader and no tile (`ep0ch open <id>`): where this screen puts an agent's
   * open (`openBlock`: the desk's focused tile's link or a following reader, the board's detail, the welcome's
   * preview, the brief's step), never the reader the person types in.
   */
  async openLanding(id: string, by: Actor): Promise<{ reader: string | null; id: string }> {
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    return this.land(m, by);
  }
  /**
   * `open fragment=` (`ep0ch open <uri>#<fragment>`, `((id^fragment))`): the reader that shows the note scrolls to the
   * fragment and marks it, as a followed link does (PIE-425); an agent's never scrolls the reader the person is in.
   */
  revealIn(reader: string | null, fragment: string, actor: Actor): void {
    const r = this.namedReaders().find(x => x.name === reader);
    if (!r) return;
    const host = r.pane.host(this);
    if (actor.kind === "agent" && host.focused !== false) return;
    void r.pane.surface.revealFragment(fragment, host, actor);
  }

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
  readonly dispatch: Dispatcher = new Dispatcher(this.dispatchHost(), this.registrations());

  private dispatchHost() {
    const d = this;
    return {
      get title() { return d.title; },
      ctx: () => d.ctx,
      ...(d.whereNow ? { where: () => d.whereNow!() } : {}),
      keys: () => d.keys(),
      tiles: () => d.tiles(),
      revision: (expected: unknown) => revisionRefusal(d.layout, expected),
      draftOf: (t: TileRef) => {
        const p = d.pane(t.name);
        return p instanceof ReaderPane ? { board: d.ctx?.board, blockId: p.msg?.id ?? null, session: p.surface.draftSession() } : null;
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
    for (const [id, p] of this.panes) { const f = kindOf(p)?.follows?.(p); if (f && p instanceof ReaderPane && this.idNamed(f) !== undefined) more.set(id, [...(more.get(id) ?? []), f]); }
    return all.map((id, i) => {
      const p = this.panes.get(id)!, rd = p instanceof ReaderPane ? p : null, name = this.nameOf(id), aliases = more.get(id);
      return {
        name, id: this.tileId(id), n: i + 1, kind: this.unregistered.get(id)?.kind ?? p.kind, shown: shown.has(id),
        shows: this.showing(p)?.id ?? null, editing: !!rd?.editing,
        ...(rd ? { holds: (a: Actor) => rd.surface.heldBy(a) } : {}),
        // A note action doesn't change a note where the person can't see it: a spine, a reader in a shut drawer.
        ...(this.collapsed.has(id) ? { readOnly: `${name} is collapsed to a spine; tile.collapse on=false tile=${name} opens it first` }
          : rd && !rd.editing && (this.coverNow(id) === "peek" || this.coverNow(id) === "spine") ? { readOnly: `${name} is a ${this.coverNow(id)} in its flow; a compressed column is a read-only view until it's full width · tile.widen tile=${name} or tile.hold tile=${name}; neither takes the person's keys` }
          : rd && !shown.has(id) && drawerOf(this.root, id) ? { readOnly: `${name} isn't on screen (its drawer is shut); open it first (tile.drawer open=true tile=${name})` } : {}),
        ...(aliases?.length ? { aliases } : {}),
      };
    });
  }
  /** The tile named `name` (a name from the spec or `tile=`). */
  pane(name: string): Pane | undefined { const id = this.idNamed(name); return id === undefined ? undefined : this.panes.get(id); }

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
  /** Tile `p` is in a drawer (not pinned in the layout). */
  inDrawer(p: Pane): boolean { const id = this.idOf(p); return id !== undefined && !!drawerOf(this.root, id); }
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
  /** The side of the screen tile `p` is on: its drawer's edge (left or right), else which half its middle is in. */
  sideOf(p: Pane): "left" | "right" {
    const id = this.idOf(p), d = id === undefined ? null : drawerOf(this.root, id);
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
  /**
   * Run an action as `by`, in tile `tile` (a pane, or a name; left out, the action's own default): the person's as their
   * key does (`press`: a refusal said), an agent's as `act` (its refusal said on the status bar too, never thrown).
   */
  perform(action: string, args: Record<string, unknown>, by: Actor = USER, tile?: Pane | string): Promise<unknown> {
    const id = typeof tile === "object" ? this.idOf(tile) : undefined;
    const name = typeof tile === "string" ? tile : id !== undefined ? this.nameOf(id) : undefined;
    if (by.kind !== "agent") return this.dispatch.press(action, args, name);
    return this.dispatch.act({ action, args, ...(name !== undefined ? { tile: name } : {}) }, by).catch(e => { this.ctx.flash(e instanceof Error ? e.message : String(e)); return undefined; });
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
    return to === undefined ? undefined : this.panes.get(to);
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
  /** A reader whose step choice is open (PIE-472), wherever it is: it takes the keys (a click in a drawer's preview opens one without focusing it). */
  private choosingReader(): ReaderPane | undefined { return this.namedReaders().find(r => r.pane.surface.choosing && !this.collapsed.has(r.id))?.pane; }

  /** The person is in a terminal tile (its program running, or exited and waiting for ⏎ or ctrl+]): every key is the tile's, ctrl+c included. */
  rawKeys(): boolean { return !!this.ptyIn && this.panes.get(this.focus) === this.ptyIn; }
  /** The person is in a terminal tile whose program exited: its keys wait for ⏎ (again), ^W x (closed), Esc or ctrl+]. */
  waitsOnExit(): boolean { return this.rawKeys() && !this.ptyIn!.running; }
  /** What an exited terminal tile `sel` offers: ⏎ runs it again, ^W x closes it (where it may close), ctrl+] leaves (in the dock, Esc too). */
  exitedSay(sel: string, label = sel, back?: string): string {
    const id = this.idNamed(sel), dock = !!this.ctx?.hostLayer?.isDock(this);
    return `${label} exited · ⏎ runs it again${id !== undefined && this.closesByMouse(id) ? " · ^W x closes" : ""} · ${dock ? "Esc or " : ""}${ESCAPE_CHORD} back to ${back ?? (dock ? "the screen" : "the door")}`;
  }
  /** Tile `id` may close by its × (and ^W x): the layout lets it, and no container keeps it or shuts a drawer instead. */
  private closesByMouse(id: number): boolean {
    return !chainOf(this.root, id).some(c => c.policy?.shuts) && !refusal(this.layout, { op: "close", tile: id }, this.layoutCtx(USER));
  }
  /** Raw input goes straight to the program while it runs (F-keys, shift-arrows, a bracketed paste): Term keeps the mouse and ctrl+]. */
  // A picker over it (the dock's agent picker) has the keys first, as keyIn gives them: no bytes go past it.
  rawInput(): ((bytes: string) => void) | null { const p = this.ptyIn; return p && this.rawKeys() && p.running && !this.overlays.top() ? (s: string) => p.inputRaw(s) : null; }
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
    if (!sel || sel === "focused") return all.find(r => r.id === this.focus) ?? all[0]!;
    const named = all.find(r => r.name === sel);
    if (named) return named;
    const t = this.tileNamed(sel, false);
    // A tile that isn't a reader, followed by one (the board's tree, its preview): the reader that follows it, while it's on screen.
    const follower = t ? all.find(r => kindOf(r.pane)?.follows?.(r.pane) === t.name) : undefined;
    if (follower) {
      if (!this.shownNow(follower.pane)) throw new ActionRefused(`${follower.name} isn't on screen (its drawer is shut); open it first (tile.drawer open=true tile=${t!.name})`);
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
      const m = await this.ctx.board.get(id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      if (actor.kind === "agent") throw new ActionRefused(`not opened: the ${key} row is gone (its tiles were moved out of it) · the screen comes back whole when it's opened again`);
      const free = this.namedReaders().find(r => !r.pane.holdsKeys && this.shownNow(r.pane));
      if (free) { this.current = m; free.pane.surface.track(() => free.pane.show(m, this)); this.redraw(); }
      const reader = free?.name ?? null, why = `the ${key} row is gone (its tiles were moved out of it): opening a detail needs it · the screen comes back whole when it's opened again`;
      this.ctx.flash(why);
      return { reader, id: m.id, why };
    }
    // A note on screen already (the card the preview shows) opens at once, as the key is pressed; another is read first.
    const m = this.onScreenBlock(id) ?? await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    this.current = m;
    if (place === "float") {
      const fid = this.openNewIn(key, actor, { kind: "float", near: this.focus });
      if (fid === undefined) throw new ActionRefused("not floated");
      (this.panes.get(fid) as ReaderPane).hold(m, this);
      if (actor.kind !== "agent") this.keysTo(fid);
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
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    if (!this.all().includes(r.id) || this.panes.get(r.id) !== r.pane) throw new ActionRefused(`reader ${r.name} closed while the note was fetched; nothing was opened`);
    // An open into a reader is part of its history (PIE-453): back returns to what it showed.
    r.pane.surface.track(() => {
      this.setCurrent(m, { reveal: true, by: actor });
      const ok = r.pane.msg?.id === m.id || (r.pane.holding ? (r.pane.hold(m, this), r.pane.msg?.id === m.id) : r.pane.show(m, this));
      if (!ok) throw new ActionRefused(`reader ${r.name} is holding an edit or a comment on another note`);
    });
    // The person's open gives the reader the keys, unless they're in an edit, a comment, the panel or a
    // terminal: that keeps them. An agent's never moves them (Evan: agents change anything but where his cursor is).
    if (actor.kind !== "agent" && !this.personIn() && !this.rawKeys()) this.keysTo(r.id);
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

  /** The note in the reader the person is in (PIE-544): a new note goes under it. A list, a lane or a terminal: none (the Inbox). */
  noteContext(): string | null {
    const p = this.panes.get(this.focus);
    return p instanceof ReaderPane && p.msg ? p.msg.id : null;
  }

  /**
   * A new note for the person to write (PIE-544, `note.new`): where the focused tile's opens land (its link, the
   * screen's readers row, the next river column, else a free reader), given their keys, its edit open through the
   * reader's own `edit` (the one editor and draft session). The reader's name, or null when no reader took it.
   */
  async editNew(m: Msg): Promise<string | null> {
    // The note being read stays read: the new one never lands over it. A reader whose opens land nowhere else (no
    // link, no container, no flow) first gets one beside it, as O gives; a container opens a new tile (fresh).
    const from = this.focusedName(), f = this.panes.get(this.focus);
    // An empty reader (^W o d) is where the person asked to write: the note opens in it.
    const empty = f instanceof ReaderPane && !f.msg && !f.surface.draft;
    const into = landing(this.layout, this.focus, this.facts(this.focus));
    if (f instanceof ReaderPane && f.msg && this.linkOf(this.focus) === undefined && !(into && "into" in into) && !this.inFlow(this.focus)) {
      await this.previewTile(from, undefined, USER);
    }
    // A refusal of the open is said as it is (thrown): note.new puts the empty note away.
    const at = empty ? await this.openIn(m.id, from, USER) : await this.openFrom(m.id, from, USER, true);
    const rd = at.reader ? this.pane(at.reader) : undefined;
    if (!(rd instanceof ReaderPane) || rd.msg?.id !== m.id) return null;
    this.focusOn(at.reader!);
    // The keys left a drawer (the board's outline): it shuts now, as after any key that moves them.
    this.shutLeftDrawers();
    // As the person's e does: the reader's `edit` action, and the person in it once it's open (esc meanwhile cancels).
    rd.surface.markNew(m.id);
    const open = await this.startSession(rd, "edit") && rd.surface.draft?.blockId === m.id;
    if (!open) rd.surface.markNew(m.id, false);
    return open ? at.reader! : null;
  }

  focusOn(sel: string): { focus: string } {
    const r = this.pickReader(sel);
    // Coming back to a session by moving to it: e or ⏎ enters it again. Focusing the reader the person
    // is already in moves nothing, so they stay in it.
    if (r.id !== this.focus) this.entered.clear();
    this.keysTo(r.id);
    this.redraw();
    return { focus: r.name };
  }

  unsaved() { return this.drafts().length > 0 || [...this.models.values()].some(m => m.unsaved?.()); }
  keepDrafts() { return [...this.drafts().flatMap(p => p.keepDrafts()), ...[...this.models.values()].flatMap(m => m.keepDrafts?.() ?? [])]; }
  /** The edits open here, by tile: what a session's next daemon opens again (src/session/restore.ts). */
  reopen(): { action: string; tile: string; args?: Record<string, unknown> }[] {
    // The note first (a reader that comes back shows what its layout says), then its edit.
    return [...this.panes].flatMap(([id, p]) => (p instanceof ReaderPane && p.surface.draft && p.msg ? [{ action: "open", tile: this.nameOf(id), args: { id: p.msg.id } }, { action: "edit", tile: this.nameOf(id) }] : []));
  }
  /** ctrl+e editors still open when the door ends: their files copied to drafts/ (keepEditFile). */
  keepEdits() { return [...this.panes.values()].flatMap(p => p instanceof PtyPane && p.run.temp && p.run.file ? [keepEditFile(p.run.file)].filter((x): x is string => !!x) : []); }
  private drafts() { return [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && p.unsaved()); }
  /** Quitting the door ends the desk's programs: said first, and asked twice (App). Leaving the desk doesn't. */
  leaveWarning(): string | null {
    // An agent attached from Herdr keeps running in its pane when the door quits: nothing of it ends here.
    const r = this.running().filter(p => !p.herdr);
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "is" : "are"} running in a tile · quitting ends ${r.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  describe(): Record<string, unknown> {
    const order = this.all();
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : {});
    // What its tiles' kinds say about the screen (the welcome's notes, the brief's day) beside the tiles.
    const peeks = Object.assign({}, ...order.map(id => { const p = this.panes.get(id)!; return kindOf(p)?.peek?.(p, this) ?? {}; }), ...[...this.models.values()].map(m => m.peek?.() ?? {}));
    return {
      // Before the desk's own fields, so a kind never overwrites them.
      ...peeks,
      kind: this.spec.name, current: this.current ? { id: this.current.id, title: subject(this.currentNow()!) } : null, zoom: this.zoom,
      // Where the keys are, as a place: a columns container by its key (the board's lanes), else the tile.
      focus: this.focusPlace(),
      // The tiles opened into the container the screen's opens land in (the board's details), and the one they land in now.
      ...(this.opensIntoKey() ? { details: this.openedTiles(this.opensIntoKey()!).filter(id => !this.isFloat(id)).map(id => ({ ...brief(this.showing(this.panes.get(id)!)), reader: this.nameOf(id), opensHere: id === this.activeIn(this.opensIntoKey()!) })) } : {}),
      layoutName: this.layoutName, rule: this.rule, focusName: this.nameOf(this.focus), inTerminal: this.rawKeys() ? this.nameOf(this.focus) : null,
      linking: this.linking ? this.nameOf(this.linking.from) : null,
      dragging: this.dragging ? { tile: this.nameOf(this.dragging.src), drop: this.dragging.drop ? dropView(this.dragging.drop, id => this.nameOf(id)) : null } : null,
      layout: describeLayout(this.layout, id => String(order.indexOf(id) + 1)),
      tree: describeLayout(this.layout, id => this.nameOf(id)),
      floats: this.floats.map(f => ({ ...brief(this.showing(this.panes.get(f.id)!)), tile: this.nameOf(f.id), rect: this.floatRect(f) })),
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
    const link = this.layout.links.get(id), into = this.linkOf(id);
    const m = this.showing(p);
    return {
      n, name: this.nameOf(id), id: this.tileId(id), kind: p.kind, ...(this.unregistered.has(id) ? { unregistered: this.unregistered.get(id)!.kind } : {}), title: p.title(), focused: id === this.focus, rect: r, shown: visible(this.root).includes(id) || this.isFloat(id),
      ...(this.isFloat(id) ? { float: true } : {}), ...(this.collapsed.has(id) ? { collapsed: true, ...(this.collapsed.get(id)!.by ? { collapsedBy: this.collapsed.get(id)!.by } : {}) } : {}),
      ...(this.cover(id) ? { cover: this.cover(id) } : {}),
      ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), tabShown: this.nameOf(set.ids[set.active]!) } : {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : into !== undefined ? { link: this.nameOf(into), linkFrom: "opensInto" } : {}),
      ...this.drawerView(id),
      ...this.policyView(id),
      ...(kindOf(p)?.describe?.(p, true) ?? {}),
      showing: m ? { id: m.id, title: subject(m) } : undefined,
      agent: p instanceof ReaderPane ? p.surface.agent ?? undefined : undefined,
      editing: p instanceof ReaderPane && p.draft ? { id: p.draft.blockId, dirty: p.draft.dirty, changedElsewhere: p.draft.changedElsewhere, conflict: p.draft.conflict } : undefined,
      commenting: p instanceof ReaderPane && p.session ? p.session.describe() : undefined,
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols, rows } = ctx.t;
    this.noteFocus();
    for (const m of this.models.values()) m.frame?.();
    // Each tile opened into a container says which it is, whether ⏎ opens there (two or more), and if it floats.
    for (const key of this.opened.keys()) {
      const ids = this.openedTiles(key), pinned = ids.filter(i => !this.isFloat(i)), a = this.activeIn(key);
      for (const id of ids) { const p = this.panes.get(id); if (p instanceof DetailPane) { p.floating = this.isFloat(id); p.opensHere = pinned.length > 1 && id === a; } }
    }
    // An empty reader says where its notes come from: the tiles whose opens land in it.
    const into = new Map<number, string[]>();
    for (const id of this.all()) { const to = this.linkOf(id); if (to !== undefined && to !== id) into.set(to, [...(into.get(to) ?? []), this.nameOf(id)]); }
    for (const [id, p] of this.panes) if (p instanceof ReaderPane) p.landsFrom = into.get(id) ?? [];
    // A preview following a list that quotes its selection (the backlinks: where the source mentions the note) says it.
    for (const p of this.panes.values()) if (p instanceof PreviewPane && "tile" in p.source) { const src = this.pane(p.source.tile) as { snippet?(): string } | undefined; p.quote = src?.snippet && this.shownNow(p) ? src.snippet() : ""; }
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
      // The tree, the drawers that slide over it (PIE-505: containers, each from its edge), bottom first.
      const ps = placeLayout(this.layout, area, this.holds);
      this.placed = ps;
      // The drawer with the keys is on top of the others sliding out.
      this.slid = [...ps.slid].sort((a, b) => Number(leaves(a.node.kid).includes(this.focus)) - Number(leaves(b.node.kid).includes(this.focus)));
      // A drawer's own border (and those inside it) are over the layout's: grabbed first.
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
    // For the mouse: the top float first, then the top drawer's tiles, then the layout's.
    this.hits = [...[...floats].reverse(), ...[...this.slid].reverse().flatMap(d => [...d.placed.rects]), ...pinned];
    this.tileSpots = [];
    this.heads = []; this.markHits = []; this.spines = []; this.drawerLabels = []; this.drawerCloses = []; this.floatButtons = []; this.closeButtons = []; this.menuButtons = []; this.headPresses = []; this.headCtl.clear();
    let placements: Placement[] = top && band ? band.kind.draw(band.pane, canvas, { col: 0, row: 0, cols, rows: top }, this) : [];
    // A tile drawn over another (a flow's column over a peek's box, a drawer, a float) takes away the images under it;
    // drawTile paints every cell of its box.
    const lay = (id: number, r: Rect, drawer = false, float = false) => {
      const box = this.boxOf(id, r);
      placements = placements.filter(p => !overlaps(p, box));
      this.tileSpots = this.tileSpots.filter(s => !overlaps({ col: s.from, row: s.y, cols: s.to - s.from, rows: 1 }, box));
      placements.push(...this.drawTile(canvas, id, r, drawer, float));
    };
    for (const [id, r] of pinned) lay(id, r);
    for (const d of this.slid) {
      canvas.clear(d.rect, bg(C.black));
      placements = placements.filter(p => !overlaps(p, d.rect));
      this.tileSpots = this.tileSpots.filter(s => !overlaps({ col: s.from, row: s.y, cols: s.to - s.from, rows: 1 }, d.rect));
      for (const [id, r] of d.placed.rects) lay(id, r, true);
    }
    for (const [id, r] of floats) {
      const shade: Rect = { ...r, cols: r.cols + 1, rows: r.rows + 1 };
      placements = placements.filter(p => !overlaps(p, shade));
      // A drop shadow on the right and below, then the tile, then its ◢ corner (drag it to size the float).
      for (let y = r.row + 1; y <= Math.min(area.row + area.rows - 1, r.row + r.rows); y++) canvas.text(r.col + r.cols, y, fg(C.dark) + "▒" + RESET, 1);
      if (r.row + r.rows < area.row + area.rows) canvas.text(r.col + 1, r.row + r.rows, fg(C.dark) + "▒".repeat(Math.max(0, Math.min(r.cols, cols - r.col - 1))) + RESET, cols);
      lay(id, r, false, true);
      canvas.text(r.col + r.cols - 1, r.row + r.rows - 1, fg(C.yellow) + "◢" + RESET, 1);
    }
    this.drawEmpty(canvas);
    for (const m of this.models.values()) if (m.drawOver?.(canvas, area)) placements = [];
    if (this.dragging) this.drawGhost(canvas, this.dragging.dock ? null : this.dragging.drop, this.nameOf(this.dragging.src), this.dragging.x, this.dragging.y, this.dragging.dock ?? undefined);
    else if (this.foreign) this.drawGhost(canvas, this.foreign.drop, this.foreign.name, this.foreign.x, this.foreign.y);
    // Images would bleed through an overlay.
    for (const o of [...this.overlays.all()].reverse()) { o.draw(canvas, { col: 0, row: 0, cols, rows }); placements = []; }
    const hint = this.hints(cols);
    if (!this.hintFull) this.hintMoreOpen = false;            // the row fits again: nothing is left to show
    if (this.hintFull && (this.hintMoreOpen || this.prefix)) { this.drawHintMore(canvas, cols, rows); placements = []; }
    canvas.text(0, rows - 2, hint, cols);
    return { lines: canvas.lines(), placements };
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
  private drawEmpty(canvas: Canvas) {
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
    const name = keyName(k), kind = this.focusedKind();
    const b = name === null ? undefined : keys.find(x => x.key === name && !(kind && x.unless?.includes(kind)) && (!x.only || (!!kind && x.only.includes(kind))));
    if (!b) return false;
    void asBoundKey(b.key, () => this.dispatch.press(b.action, b.args ?? {}, b.tile));
    return true;
  }

  /** The band across the top (the spec's `band`: a tile whose kind draws it), if the screen has one. */
  private band(): { pane: Pane; kind: NonNullable<TileKind["band"]> } | null {
    const id = this.spec.band ? this.idNamed(this.spec.band) : undefined;
    const pane = id !== undefined ? this.panes.get(id) : undefined, kind = pane ? kindOf(pane)?.band : undefined;
    return pane && kind ? { pane, kind } : null;
  }
  /** The rows the band took as last drawn: a press above them is the band's. */
  private bandTop = 0;

  /** One tile: its frame, its header (its name, or its tab set's tabs), its body, its placements. */
  private drawTile(canvas: Canvas, id: number, r0: Rect, drawer = false, float = false): Placement[] {
    const pane = this.panes.get(id)!;
    const focused = id === this.focus;
    // A flow's column squeezed to a spine, or a tile folded to one; a peek is drawn whole in its box, its right
    // side under its neighbour (drawn after it), like a drawer (PIE-513).
    const cover = this.cover(id);
    if ((this.collapsed.has(id) || cover === "spine") && r0.cols <= SPINE) return this.drawSpineTile(canvas, id, r0, focused);
    const r = this.boxOf(id, r0);
    // Every cell of the box is the tile's: rows its view leaves short show nothing of a tile drawn under it (a drawer's
    // or a float's on the black it slides over).
    canvas.clear(r, drawer || float ? bg(C.black) : "");
    const inner: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
    const typing = pane === this.ptyIn && focused;
    // The header first: a tile that puts controls on it (the backlinks' status) draws its body knowing it did.
    const head = (float ? `${fg(C.yellow)}⧉ ${RESET}` : "") + this.header(id, r, focused, float ? 2 : 0);
    // A float's ⧉ puts it back: the cell either side counts too (a font that draws the glyph wide puts it under the pointer there).
    if (float) this.floatButtons.push({ id, row: r.row, from: r.col + 2, to: r.col + 5 });
    const view = inner.cols >= 1 && inner.rows >= 1 ? pane.render(inner.cols, inner.rows, focused, this, typing) : null;
    // A reader holding a session the person isn't in says how to get in; a long note says how far down it is.
    const held = pane instanceof ReaderPane && pane.holdsKeys && !this.entered.in(pane);
    const more = overflows(view?.scroll) ? `${fg(C.dark)} · ${scrollPct(view!.scroll!)}` : "";
    const marked = this.marksOn(id);
    // A tile may say how its frame looks now (a lane a card is dragged over: what dropping it there would do).
    const own = pane.frameLook?.(focused) ?? null;
    const edgeC = this.linking ? (id === this.linking.from ? C.lmagenta : C.magenta) : this.dragging?.src === id ? C.dark : marked.length ? C.lmagenta : typing ? C.yellow : own?.colour ?? (focused ? C.lcyan : float ? C.yellow : drawer ? C.brown : C.blue);
    // A float's long subject is cut so what it holds and how far down it is still show.
    const tail = (held ? fg(C.dark) + " (e enters)" : "") + more;
    // The controls on its top right corner (× ⧉ ⋯, drawn after the frame): where they start, so the title ends before them.
    const closes = !drawer && cover === undefined && r.cols >= 10 && this.closesByMouse(id);
    const floats = focused && !float && !drawer && cover === undefined && r.cols >= 12 && leaves(this.root).length > 1 && !this.ctx?.hostLayer?.isDock(this) && !refusal(this.layout, { op: "float", tile: id }, this.layoutCtx(USER));
    const floatX = r.col + r.cols - (closes ? 4 : 3), menuX = (floats ? floatX : closes ? r.col + r.cols - 2 : r.col + r.cols - 1) - 2;
    // A mark's chip ends in a space: where room is short, the chip ends at its own last word.
    const bare = head.replace(/ +((?:\x1b\[[\d;]*m)*)$/, "$1");
    // An attention mark's label (who set it, why) outranks the ⋯ where both don't fit: a right-click or ^W . still opens
    // the menu, and the title runs up to the ⧉ or × as it always did.
    const menus = cover === undefined && r.cols >= 14 && !(marked.length && width(bare) + (float ? width(tail) : 0) > menuX - r.col - 4);
    // With the ⋯, the title ends a cell before it; what follows the title (how far down, "e enters") gives way first.
    const fits = Math.max(1, menuX - r.col - 4);
    // Without it, as before: a float's long subject is cut so how far down it is still shows.
    const floatFits = Math.max(1, r.cols - 5 - width(tail));
    const title = !menus ? (float && width(head) > floatFits ? pad(head, floatFits) : head) + tail : width(head) + width(tail) <= fits ? head + tail
      // A float keeps how far down it is (it has no other place to say it); a tile in the layout keeps its name.
      : float ? pad(head, Math.max(1, fits - width(tail))) + tail : width(bare) <= fits ? bare : pad(head, fits);
    // One hint row: a tile whose keys the screen's hint row says for its kind (the board's lanes, outline, backlinks), or
    // whose controls sit on its header, doesn't repeat them along its frame.
    const said = this.headCtl.has(id) || (typeof this.spec.hint === "object" && this.spec.hint[pane.kind] !== undefined && !float && !held);
    const hint = own?.hint ?? (focused && !said ? fg(C.dark) + (held && pane instanceof ReaderPane ? `e ⏎ enter${pane.surface.scrolls() ? " · j k scroll" : ""}` : float && !(pane instanceof ReaderPane && pane.holdsKeys) ? this.floatHint() : pane.hint()) : "");
    canvas.box(r, fg(cover === "peek" && !focused ? C.dark : edgeC), title, hint, this.spec.frame ? FRAMES[this.spec.frame] : undefined);
    // The focused tile's ⧉, in its frame's top right corner, floats it by mouse (tile.float, as ^W f); a float's own
    // ⧉, before its title, puts it back.
    // Every tile that can close has a × in its top right corner: a click closes it (tile.close, as ^W x; a running
    // program asks twice). A drawer's tile closes by its drawer's [×]; one the layout keeps (the board's lanes) has none.
    // A docked tab has one too (the dock's own tab never closes: its policy).
    if (closes) {
      const x = r.col + r.cols - 2;
      canvas.text(x, r.row, `${fg(focused ? C.grey : C.dark)}×${RESET}`, 1);
      this.closeButtons.push({ id, row: r.row, from: x, to: x + 1 });
    }
    if (floats) {
      canvas.text(floatX, r.row, `${fg(C.dark)}⧉${RESET}`, 1);
      this.floatButtons.push({ id, row: r.row, from: floatX, to: floatX + 1 });
    }
    // Every tile's ⋯, left of those: a click opens its menu (tile.menu, as ^W . and a right-click in it do).
    if (menus) {
      const x = menuX;
      canvas.text(x, r.row, `${fg(focused ? C.grey : C.dark)}⋯${RESET}`, 1);
      this.menuButtons.push({ id, row: r.row, from: x, to: x + 1, right: r.col + r.cols - x });
    }
    const out: Placement[] = [];
    if (!view) return out;
    // A peek's images would show through its neighbour: it draws text only.
    if (cover === "peek") {
      view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
      // Covered like a drawer: what shows of it dimmed (less while the keys are in it), and the edge its neighbour slides over.
      const edge = r0.col + r0.cols - 1;
      canvas.dim({ ...r0, cols: r0.cols - 1 }, focused ? 0.8 : PEEK_DIM);
      for (let y = r0.row; y < r0.row + r0.rows; y++) canvas.text(edge, y, fg(C.dark) + "▒" + RESET, 1);
      return out;
    }
    view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    for (const s of view.spots ?? []) if (s.row < inner.rows && s.from < inner.cols) this.tileSpots.push({ y: inner.row + s.row, from: inner.col + s.from, to: inner.col + Math.min(s.to, inner.cols), key: s.key, tile: id });
    if (overflows(view.scroll)) canvas.thumb(r, view.scroll, fg(focused ? C.lcyan : C.cyan));
    for (const p of view.placements ?? []) out.push({ ...p, key: `p${id}:${p.key}`, col: p.col + inner.col, row: p.row + inner.row, cols: Math.min(p.cols, inner.cols), rows: Math.min(p.rows, inner.rows) });
    return out;
  }

  /**
   * The header row's text: the tile's number and name (bright when focused), or its tab set's tabs (the
   * one shown on blue); then what it shows, where its opens land (→), and a drawer's state. Each tab's
   * label is kept as a hit for clicks and drags.
   */
  private header(id: number, r: Rect, focused: boolean, indent = 0): string {
    const set = tabsOf(this.root, id);
    let x = r.col + 3 + indent;
    const max = r.col + r.cols - 2;
    this.headOut = "";
    const xNow = () => x;
    const put = (text: string, sgr: string, hit?: number) => {
      if (hit !== undefined && x < max) this.heads.push({ id: hit, from: x, to: Math.min(max, x + text.length), row: r.row });
      this.headOut += sgr + text + RESET; x += text.length;
    };
    // A held column of a flow (the river's p): it resists compression, and says so.
    const flow = chainOf(this.root, id).find((c): c is Flow<number> => c.t === "flow");
    if (flow?.held?.some(t => columnOf(flow, t) === columnOf(flow, id))) put("⊙ ", fg(C.yellow));
    if (set && set.ids.length > 1) {
      set.ids.forEach((t, i) => {
        if (i) put("│", fg(C.blue));
        const on = i === set.active;
        put(` ${this.numLabel(t)}${this.panes.get(t)?.headName?.() ?? this.nameOf(t)} `, on ? selected(focused, "idleRow") : fg(C.grey), t);
      });
    } else if (this.plainName(id)) {
      // A tile named only by its kind reads as its number, then its title.
      if (this.numbered) put(`${this.numberOf(id)}`, fg(focused ? C.white : C.dark), id);
      this.putMarks(id, put, xNow, r.row);
      put(`${this.numbered ? " " : ""}${this.panes.get(id)!.title()}`, fg(focused ? C.lcyan : C.cyan), id);
      return this.headerEnd(id, put, xNow, max, r.row);
    } else put(`${this.numLabel(id)}${this.panes.get(id)!.headName?.() ?? this.nameOf(id)}`, fg(focused ? C.white : C.grey), id);
    this.putMarks(id, put, xNow, r.row);
    const p = this.panes.get(id)!;
    // A tile that says what follows its name (a lane: its count) says it; a file shown read-only (a preview of
    // one) is named by its title alone.
    const label = p.headLabel?.();
    const what = label !== undefined ? null : p instanceof ReaderPane && p.msg && !p.msg.id.startsWith("file:") ? `${p.title()} · ${subject(p.msg)}` : p.title();
    if (label) put(` ${label}`, "");
    else if (what && what !== this.nameOf(id)) put(` ${what}`, fg(focused ? C.lcyan : C.cyan));
    return this.headerEnd(id, put, xNow, max, r.row);
  }

  /**
   * Controls the tile puts on its header where they fit (the backlinks' status, who's online's refresh), each a click;
   * room is kept for the drawer's own glyph and [×] and how far down it is. Then the header's tail.
   */
  private headerEnd(id: number, put: (text: string, sgr: string) => void, xNow: () => number, max: number, row: number): string {
    const ctl = this.panes.get(id)!.headControls?.(max - xNow() - (drawerOf(this.root, id) ? 14 : 0) - 8, this) ?? null;
    if (ctl?.length) {
      this.headCtl.add(id);
      put(" ·", fg(C.dark));
      ctl.forEach((c, i) => { if (i) put(" ·", fg(C.dark)); const from = xNow() + 1; put(` ${c.text}`, c.sgr); if (c.press) this.headPresses.push({ id, row, from, to: xNow(), press: c.press }); });
    }
    return this.headerTail(id, put, xNow, row);
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
    const sp = p.spine?.() ?? { title: this.nameOf(id) };
    const out = drawSpine(canvas, r, { key: `spine:${id}`, title: sp.title, colour: focused ? C.white : C.cyan, marks: sp.marks, cellStyle: focused ? selected() : undefined }, this.ctx);
    this.spines.push([id, r]);
    return out ? [out] : [];
  }

  /** A name the desk gave by kind (reader, reader2): not worth saying before the title. */
  /** Tiles are numbered in their headers (what 1-9 focus), unless the view keeps the digits for itself. */
  private get numbered() { return this.spec.digits !== false; }
  private numLabel(id: number) { return this.numbered ? `${this.numberOf(id)} ` : ""; }
  private plainName(id: number) { const p = this.panes.get(id)!, k = kindOf(p)?.word ?? p.kind, n = this.nameOf(id); return n === k || new RegExp(`^${k}\\d+$`).test(n); }

  private headerTail(id: number, put: (text: string, sgr: string, hit?: number) => void, xNow: () => number, row: number): string {
    // A tile whose opens land in itself (the welcome's preview) says nothing about where they go.
    const link = this.layout.links.get(id);
    if (link !== undefined && link !== id && this.panes.has(link)) put(` → ${this.nameOf(link)}`, fg(C.lmagenta));
    const dr = drawerOf(this.root, id);
    // A click on it pins the drawer where it is (tile.pin on=true).
    if (dr) {
      const from = xNow(); put(` ${EDGE_GLYPH[dr.edge]} drawer`, fg(C.brown)); this.drawerLabels.push({ id, row, from: from + 1, to: xNow() });
      // A drawer that slides shut says how, by mouse: [×] closes it as Esc in it does.
      if (dr.open && policyOfNode(this.layout, dr).collapsible) { const x = xNow(); put(" [×]", fg(C.grey)); this.drawerCloses.push({ id, row, from: x + 1, to: xNow() }); }
    }
    if (this.linking && id !== this.linking.from) put(" ⌖ click to link here", fg(C.lmagenta));
    return this.headOut;
  }

  /** Attention marks on what a tile shows, right after its name (what the person should see when room is short); a click dismisses one. */
  private putMarks(id: number, put: (text: string, sgr: string) => void, xNow: () => number, row: number) {
    for (const m of this.marksOn(id)) {
      const from = xNow();
      put(` ${markLabel(m)} `, chipStyle(C.magenta));
      this.markHits.push({ id, n: m.n, row, from, to: xNow() });
    }
  }

  /** The drop the pointer is over: its outline, what it does, and the tile being carried, at the pointer. */
  private drawGhost(canvas: Canvas, drop: Drop<number> | null, name: string, x: number, y: number, dock?: string) {
    if (drop) {
      const g = drop.ghost;
      // A drop the policy refuses is outlined in red, with the reason in place of what it would do.
      const why = drop.refused;
      const c = why ? C.lred : C.yellow;
      canvas.box(g, fg(c), `${chipStyle(c, C.black)} ${why ? `✕ ${why}` : drop.label} ${RESET}`, "");
      if (drop.kind === "tabs" && !why) canvas.text(g.col + 1, g.row + 1, `${fg(C.yellow)}${"▀".repeat(Math.max(0, g.cols - 2))}${RESET}`, Math.max(0, g.cols - 2));
    }
    // Over the dock: the dock lights up where it is (its chip, its drawer); the tile carried says where it goes.
    const label = ` ⠿ ${name}${dock ? ` · ${dock}` : ""} `;
    const ly = Math.max(this.area.row, Math.min(this.area.row + this.area.rows - 1, y + 1));
    canvas.text(Math.max(0, Math.min(this.area.cols - width(label), x + 1)), ly, `${chipStyle(dock ? C.yellow : C.magenta, C.black)}${label}${RESET}`);
  }

  /**
   * The whole hint row, wrapped, in a box just above it: the parts a narrow row cut (keys.more, or a ^W chord's
   * row, which shows it at once). Each line keeps the colour its first part was written in.
   */
  private drawHintMore(canvas: Canvas, cols: number, rows: number) {
    const lines = wrapHint(this.hintFull!, Math.max(10, cols - 4));
    const h = Math.min(lines.length + 2, Math.max(3, rows - 4));
    const r: Rect = { col: 0, row: rows - 2 - h, cols, rows: h };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.brown), `${fg(C.yellow)}keys`, this.prefix ? "" : fg(C.dark) + "any key closes");
    lines.slice(0, h - 2).forEach((l, i) => {
      canvas.text(r.col + 2, r.row + 1 + i, l, cols - 4);
      this.keySpots.push(...hintSpots(l, keyStyles()).map(p => ({ y: r.row + 1 + i, from: r.col + 2 + p.from, to: r.col + 2 + p.to, key: p.key })));
    });
  }

  /** The hint part pressed, if `k` is a press on one: its key is pressed as typed. */
  private spotAt(k: Key): { key: Key; tile?: number } | undefined { return k.kind === "mouse" && k.action === "down" ? [...this.keySpots, ...this.tileSpots].find(s => s.y === k.y && k.x >= s.from && k.x < s.to) : undefined; }

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
    if (h === undefined) return null;
    if (typeof h === "string") return h;
    const f = this.panes.get(this.focus);
    if (!f) return h["*"] ?? null;
    if (f.typing?.()) return `|08 ${f.hint()}`;
    if (this.collapsed.has(this.focus)) {
      const holds = f instanceof ReaderPane && f.holdsKeys ? ` · keeps ${sessionName(f)}` : "";
      return `|14 ${f instanceof DetailPane && f.label ? f.label : this.nameOf(this.focus)} · collapsed${holds}|08 · ${h.spine ?? ""}`;
    }
    if (this.isFloat(this.focus) && h.float !== undefined) return h.float;
    const k = h[f.kind] ?? h["*"] ?? null;
    // A tile that doesn't close (closable off, or kept by its source) isn't offered x: its kind's hint says it for the rest.
    return k && (!this.policyAt(this.focus).closable || this.facts(this.focus).keeps) ? k.split(" · ").filter(p => !/^(?:\|\d\d)?\s*\|15x\|08 close$/.test(p)).join(" · ") : k;
  }

  /** A float's frame hint, with this screen's keys for putting it back and closing it (the board has its own o and x). */
  private floatHint(): string { return "drag title · drag ◢ · H J K L move · ^W f back in · ^W x close"; }

  private hints(cols: number): string {
    const rd = this.panes.get(this.focus);
    // The drawers slid shut, as handles at the end of the row (its edge, what it holds): a click opens one, and a
    // tile dropped on one goes into it. Then the lock chip: a click locks or unlocks the screen (layout.lock).
    // A drawer holding a named container reads by its name (the board's outline); else by its tiles'.
    const handles = this.shutDrawers().map(d => ({ id: leaves(d.kid)[0]!, drawer: d, text: ` ${EDGE_GLYPH[d.edge]} ${isLine(d.kid) && d.kid.key ? d.kid.key : shown(d.kid).map(i => this.nameOf(i)).join("+")} ` }));
    const locked = this.screenLocked();
    const chip = this.spec.layouts || locked ? (locked ? " ▣ locked " : " □ lock ") : "";
    const hw = handles.reduce((a, h) => a + width(h.text) + 1, 0) + (chip ? width(chip) + 1 : 0);
    this.handles = [];
    let x = cols - hw;
    let tail = "";
    for (const h of handles) { const hw = width(h.text); this.handles.push({ id: h.id, drawer: h.drawer, from: x, to: x + hw }); tail += `${chipStyle(C.brown)}${h.text}${RESET} `; x += hw + 1; }
    this.lockChip = chip ? { from: x, to: x + width(chip) } : null;
    if (chip) tail += `${locked ? chipStyle(C.yellow, C.black) : fg(C.dark)}${chip}${RESET} `;
    const room = Math.max(0, cols - hw);
    // Too long for the row (drawer handles take its end): cut between its parts, never inside a key's, and say
    // "? more": ? (or a click on it) shows the whole row above it (keys.more). A ^W chord's row shows it at once.
    this.hintFull = null; this.moreChip = null;
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
    // A view's own mode (the board's composer, a card being dragged) says its keys first.
    const over = [...this.models.values()].map(m => m.hint?.() ?? null).find(h => h !== null) ?? null;
    if (over !== null) return line(over);
    if (this.dragging) {
      const why = this.dragging.drop?.refused;
      return line(paint(`|14dragging ${this.nameOf(this.dragging.src)}|08 · ${this.dragging.dock ? `|15${this.dragging.dock}` : why ? `|12✕ ${why}` : this.dragging.drop ? `|15${this.dragging.drop.label}` : "|08nowhere here"}|08 · a header or the centre makes tabs, a side splits, the outer edge makes a column, a drawer's handle puts it in the drawer, the dock's chip docks it · |15f|08 float · |15p|08 drawer · |15a|08 dock · release drops · esc cancels`));
    }
    if (this.linking) return line(paint(`|13alt+l|08 · click the tile where |15${this.nameOf(this.linking.from)}|08's opens land (or h j k l, or its number) · click it again to unlink · esc cancels`));
    if (this.waitsOnExit()) return line(paint(`|12${this.exitedSay(this.nameOf(this.focus)).replace(" exited · ", " exited|08 · ")}`));
    if (this.rawKeys()) return line(paint(`|14in ${this.nameOf(this.focus)}|08 · every key goes to ${this.ptyIn!.title()} · |15${ESCAPE_CHORD}|08 back to the door (twice: send it)`));
    if (!this.prefix && rd instanceof ReaderPane && rd.holdsKeys && !this.collapsed.has(this.focus)) {
      const where = `${this.readerLabel(this.focus)} · ${rd.surface.state()}`;
      return line(this.entered.in(rd)
        ? paint(`|14 ${where}|08 · `) + fg(C.grey) + rd.hint() + RESET
        : paint(`|14 ${where}|08 · |15e ⏎|08 enter ${sessionName(rd)}${rd.surface.scrolls() ? " · |15j k|08 scroll" : ""} · |15Tab/1-9|08 focus · |15^W|08 window`));
    }
    const leaving = this.prefix === "wm" && !!this.personIn()?.editing ? `|14${sessionName(this.personIn()!)}: the next key leaves it (saved, or kept as unsent) · |07esc |08stays · ` : "";
    const s = this.prefix === "wm"
      ? leaving + "|14^W |07hjkl |08focus · |07m |08move · |07t |08into tabs · |07T |08tab out · |07HJKL |08to an edge · |07[ ] |08tabs · |07< > + - = |08size · |07z |08zoom · |07o O |08open · |07v |08preview beside · |07V |08preview below · |07p |08drawer in/out · |07d |08slide · |07c |08spine · |07W |08widen · |07f |08float · |07P |08policy · |07r w |08layouts · |07x |08close · |07s |08swap · |07. |08menu · |07! |08shell"
      : this.prefix === "add" || this.prefix === "addtab"
        ? `|14${this.prefix === "add" ? "open beside" : "open as a tab"}: ${tileKinds().flatMap(k => (k.keys ?? []).map(x => `|07${x.key} |08${x.label}`)).join(" · ")}`
        : this.prefix === "move" || this.prefix === "tab"
          ? `|14${this.prefix === "move" ? "move beside" : "into the tabs of"}: |07h j k l |08the tile that way${this.prefix === "move" ? " (none that way: to the edge)" : ""}`
          : this.specHint() ?? `|08 Tab/1-9 focus · |15^W|08 window · |15drag|08 a title moves, a border resizes · |15alt+l|08 link · ${this.spec.layouts ? "|15alt+d|08 daily · " : ""}|15alt+k|08 ${this.screenLocked() ? "unlock" : "lock"} · |15^N|08 new · |15/|08 search · |15q|08 menu${this.layoutName ? ` · |03${this.layoutName}` : ""}${this.shapeWarning() ? " · |15^W w|08 save the screen" : ""}${this.zoom !== null ? " · |14zoomed" : ""}${this.current ? ` · |03${headOf(subject(this.currentNow()!), 40)}` : ""}`;
    return line(paint(s));
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** The focused pane, when it's a reader. */
  private focusedReader(): ReaderPane | null { const p = this.panes.get(this.focus); return p instanceof ReaderPane ? p : null; }
  /** The focused reader, when the person is in its edit, comment or property panel. */
  private personIn(): ReaderPane | null { const p = this.focusedReader(); return p?.holdsKeys && this.entered.in(p) ? p : null; }

  /** Start a session in a reader as the person's key does (⏎ or a click on a comment mark). */
  /** …; resolves true when the person is in it (opened, and still wanted), false when it didn't open or was cancelled. */
  startSession(rd: ReaderPane, kind: SessionKind): Promise<boolean> {
    // Esc, or leaving the desk, while the note is read cancels it: the token is cleared and nothing opens.
    const token = { pane: rd };
    this.pending = token;
    const still = () => this.pending === token && this.focusedReader() === rd && !this.overlays.get("search");
    const opened = (open: boolean) => {
      const want = still();
      if (this.pending === token) this.pending = null;
      if (open && want) { this.entered.enter(rd); this.ctx.flash(`${this.readerLabel(this.focus)} · ${rd.surface.state()} · ${rd.hint()}`); }
      this.redraw();
      return open && want;
    };
    const r = startSession(rd, kind, this, still);
    const said = (e: unknown) => { this.ctx.flash(e instanceof Error ? e.message : String(e)); return false; };
    // The property panel, or a thread list whose comments are already read, opens at once: the next key is already its.
    if (rd.sessionOf()) { const now = opened(true); return r.then(() => now, said); }
    return r.then(opened, said);
  }

  key(k: Key, ctx: Ctx): void {
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
    if (k.kind === "char" && k.ctrl && k.ch === "n" && !this.holdsKeys() && this.ctx.press) { void this.ctx.press("note.new"); return; }
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
    for (const [id, p] of this.panes) if (id !== this.focus && p.typing?.()) p.blur?.();
    if (this.ptyIn && this.panes.get(this.focus) !== this.ptyIn) this.ptyIn = null;
    this.shutLeftDrawers();
  }

  /** A drawer sliding over shuts when the keys go elsewhere (tile.drawer, as its key and an agent do it); one that takes its room, or can't collapse, stays. */
  private shutLeftDrawers() {
    if (!this.dragging && !this.headPress) for (const d of drawers(this.root)) {
      if (!d.open || d.policy?.overlay === false || d.policy?.stays || !leaves(d.kid).length || leaves(d.kid).includes(this.focus)) continue;
      if (!policyOfNode(this.layout, d).collapsible) continue;
      this.run("tile.drawer", { open: false, container: d.id }, this.nameOf(leaves(d.kid)[0]!));
    }
  }

  private keyIn(k: Key, ctx: Ctx) {
    if (this.overlays.key(k, this) !== null) return this.redraw();
    // In a terminal tile: every key is the program's, but the escape chord and the mouse. Once the program
    // has exited, the keys wait for a choice (⏎ runs it again, ctrl+] leaves) and nothing leaks to the desk.
    if (this.rawKeys() && k.kind !== "mouse") {
      const p = this.ptyIn!;
      if (isEscapeChord(k)) return this.run("tile.leave", {}, this.nameOf(this.focus));
      if (!p.running) {
        const name = this.nameOf(this.focus);
        if (k.kind === "enter") this.run("tile.restart", {}, name);
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
    const held = this.panes.get(this.focus);
    if (held && kindOf(held)?.takesKeys?.(held) && k.kind !== "mouse") { held.key(k, this); return; }
    if (this.dragging && k.kind === "esc") { this.dragging = null; this.headPress = null; ctx.flash("not moved"); return this.redraw(); }
    // A key while a tile is dragged acts on that tile, as its ^W chord does (the same actions): f floats it, p puts it
    // in a drawer (or pins it), a docks it. The drag ends there.
    const mid = this.dragging && k.kind === "char" && !k.ctrl ? DRAG_KEYS[k.ch] : undefined;
    if (mid && this.dragging) {
      const src = this.nameOf(this.dragging.src);
      this.dragging = null; this.headPress = null;
      return this.run(mid[0], mid[1], src);
    }
    if (this.linking && k.kind !== "mouse") return this.linkKey(k);
    // Esc while the person's own edit or comment is still opening cancels it, and does nothing else.
    if (k.kind === "esc" && this.pending?.pane === this.focusedReader()) { this.pending = null; ctx.flash("not opened"); return this.redraw(); }
    const focused = this.focusedReader();
    const c = ch(k);
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
        if (focused.editing && k.action !== "wheel-up" && k.action !== "wheel-down") {
          if ((k.action === "down" || k.action === "drag") && this.clickIn(focused, k)) return this.redraw();
          // A click in the edit's own tile (its frame, its hint rows) stays in it. A click anywhere else leaves
          // it as any editor does (session.leave: saved, closed, or kept as unsent) and then does what it does.
          if (k.action !== "down" || this.topTileAt(k.x, k.y) === this.focus || !this.leaveSession(focused)) return;
        }
      } else if (k.kind !== "mouse" && !this.prefix && !this.collapsed.has(this.focus)) {
        // One they aren't in (and can see: a spine's is out of sight) (an agent's, or theirs after moving away): e or ⏎ enters it, j k PgDn scroll,
        // and the desk's keys keep working. None of its own keys get here.
        if (c === "e" || k.kind === "enter") { this.entered.enter(focused); ctx.flash(`in ${sessionName(focused)} · ${focused.hint()}`); return this.redraw(); }
        if (focused.scrollKey(k, this)) return;
      }
    }
    if (k.kind === "mouse") return this.mouse(k);
    if (this.prefix) return this.command(k);
    if (k.kind === "char" && k.ctrl && k.ch === "w") { this.prefix = "wm"; return this.redraw(); }
    if (k.kind === "alt") {
      if (k.ch === "l") { this.linking = { from: this.focus }; return this.redraw(); }
      if (k.ch === "d") return this.run("layout.load", { name: "daily" });
      if (k.ch === "n" || k.ch === "p") return this.run("tab.select", { by: k.ch === "n" ? 1 : -1 }, this.nameOf(this.focus));
      if (k.ch === "m") return this.run("marks.next");
      if (k.ch === "x") return this.run("block.unmark", {}, this.nameOf(this.focus));
      if (k.ch === "k") return this.run("layout.lock");
    }
    // A tile whose current element is a live figure's takes tab, shift+tab and ← → first: they switch its tabs.
    const claimer = this.panes.get(this.focus);
    if (claimer?.claims?.(k) && !this.holdsKeys() && !this.collapsed.has(this.focus) && claimer.key(k, this)) return this.redraw();
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
      if (k.kind === "enter" || c0 === " " || c0 === "c") return this.expandSpine(this.focus);
      if (k.kind === "char" && !k.ctrl && !/^[1-9q/V]$/.test(c0)) { this.ctx.flash(`${this.readerLabel(this.focus)} is collapsed to a spine · c, ⏎ or a click opens it`); return; }
    }
    // A float has the keys: H J K L move it (float.place), as dragging its title does.
    if (this.isFloat(this.focus) && "HJKL".includes(c0) && c0 && !focused?.holdsKeys) return this.run("float.place", { dx: c0 === "H" ? -4 : c0 === "L" ? 4 : 0, dy: c0 === "K" ? -2 : c0 === "J" ? 2 : 0 }, this.nameOf(this.focus));
    // A key its kind gives an action of its own (a terminal the person isn't in: ⏎ or e starts typing in it; a river
    // column's h l w p x g), never while the person types (a filter, an edit opening).
    const pressed = pane && !this.holdsKeys() ? kindOf(pane)?.press?.(pane, k) : null;
    if (pressed) return this.run(pressed.action, pressed.args ?? {}, this.nameOf(this.focus));
    const readOnly = pane instanceof ReaderPane && pane.readOnly;
    // Not while the tile takes typed text of its own (a river column's / filter): e, i and C are letters there.
    const start = focused && !focused.holdsKeys && !pane?.typing?.() && focused.msg && !readOnly ? sessionStart(k) : null;
    if (focused && start) return this.startSession(focused, start);
    if (!focused?.holdsKeys && pane?.key(k, this)) return;
    // ⏎ in a reader that follows another tile (the board's preview), on none of its elements, opens its note where its
    // opens land on a screen whose opens go into a container (the readers row): alt+⏎ in a new tile there.
    if ((k.kind === "enter" || k.kind === "alt-enter") && focused?.msg && !focused.holdsKeys && kindOf(focused)?.follows?.(focused) && this.opensIntoKey() && !this.collapsed.has(this.focus))
      return this.run("open", { id: focused.msg.id, from: this.nameOf(this.focus), ...(k.kind === "alt-enter" ? { fresh: true } : {}) });
    if (k.kind === "char" && !k.ctrl) {
      if (k.ch === "/") return this.run("search");
      if (k.ch === "V") return this.shell("video.cycle");
      if (/^[1-9]$/.test(k.ch) && this.numbered) { const id = this.all()[Number(k.ch) - 1]; if (id !== undefined) return this.run("tile.focus", {}, this.nameOf(id)); return; }
      if (k.ch === "q" && this.spec.home === undefined) { this.pending = null; return this.shell("screen.back"); }
    }
    // Esc steps back: out of a zoom, a drawer the keys are in shuts, the keys go home (the spec's), a drawer sliding over
    // shuts, then the screen is left. On a screen with a home, q takes the same steps (PIE-489: q is back everywhere).
    if (k.kind === "esc" || (c0 === "q" && this.spec.home !== undefined)) {
      if (this.zoom !== null) return this.run("tile.zoom", { on: false }, String(this.numberOf(this.zoom)));
      const shuts = (d: Drawer<number> | null) => !!d?.open && d.policy?.overlay !== false && policyOfNode(this.layout, d).collapsible;
      const d = drawerOf(this.root, this.focus);
      if (shuts(d)) return this.run(chainOf(this.root, this.focus).some(c => c.policy?.shuts) ? "tile.close" : "tile.drawer", chainOf(this.root, this.focus).some(c => c.policy?.shuts) ? {} : { open: false }, this.nameOf(this.focus));
      const home = this.homeTile();
      if (home !== undefined && !this.atHome()) return this.run("tile.focus", {}, this.nameOf(home));
      const open = this.spec.home !== undefined ? drawers(this.root).find(x => shuts(x) && leaves(x.kid).length) : undefined;
      if (open) return this.run("tile.drawer", { open: false, container: open.id }, this.nameOf(leaves(open.kid)[0]!));
      this.pending = null; return this.shell("screen.back");
    }
  }

  /** alt+l, then a key: h j k l (the tile that way), a tile's number, or esc. */
  private linkKey(k: Key) {
    const from = this.linking!.from;
    this.linking = null;
    const c = ch(k);
    if (k.kind === "esc") { this.ctx.flash("not linked"); return this.redraw(); }
    const to = MOVE[c] ? neighbour(this.rectsNow(), from, MOVE[c]!) : /^[1-9]$/.test(c) ? this.all()[Number(c) - 1] ?? null : null;
    if (to === null || to === undefined) { this.ctx.flash("not linked: alt+l, then click a tile, h j k l, or its number"); return this.redraw(); }
    this.run("tile.link", to === from ? {} : { to: this.nameOf(to) }, this.nameOf(from));
  }

  private command(k: Key) {
    const mode = this.prefix;
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
      const extra: Partial<NewTile> = { ...(s0.cmd ? { cmd: s0.cmd.join(" ") } : {}), ...(s0.file ? { file: s0.file } : {}), ...(s0.source ? { source: s0.source } : {}), ...(s0.view ? { view: s0.view } : {}), ...(s0.name ? { name: this.idNamed(s0.name) === undefined ? s0.name : this.autoName(s0.name) } : {}) };
      return this.run("tile.open", { kind: hit.kind.kind, ...extra, where: mode === "addtab" ? "tabs" : "right" }, me);
    }
    const dir = MOVE[c], n = dir ? neighbour(this.rectsNow(), this.focus, dir) : null;
    if (mode === "move" || mode === "tab") {
      if (!dir) return this.redraw();
      if (mode === "tab") return n === null ? flash(`no tile ${dir} of ${me}`) : this.run("layout.move", { to: this.nameOf(n), where: "tabs" }, me);
      return this.run("layout.move", n === null ? { where: `edge-${dir}` } : { to: this.nameOf(n), where: dir }, me);
    }
    if (dir) return n !== null ? this.run("tile.focus", {}, this.nameOf(n)) : this.redraw();
    if (TO_EDGE[c]) return this.run("layout.move", { where: `edge-${TO_EDGE[c]}` }, me);
    if (PREFIX[c]) { this.prefix = PREFIX[c]; return this.redraw(); }
    const wm = WM[c];
    if (wm) return this.run(wm[0], wm[1], wm[2] === "-" ? undefined : wm[2] === "n" ? String(this.numberOf(this.focus)) : me);
    switch (c) {
      case "T": return tabsOf(this.root, this.focus) ? this.run("layout.move", { to: me, where: "right" }, me) : flash(`${me} isn't in a tab set`);
      case "P": this.overlays.push(policyPanel(this, this.focus)); return this.redraw();
      case "r": return this.run("layout.load", {}, me);
      case "w": return this.run("screen.save", {}, me);
      // Drop to shell (`screen.shell`), the menu's `!`: loaded when pressed, as screens.ts imports this module.
      case "!": void import("../screens").then(m => m.dropToShell(this, this.ctx)); return;
      case "d": {
        if (drawerOf(this.root, this.focus)?.open) return this.run("tile.drawer", { open: false }, me);
        const shut = this.shutDrawers().at(-1);
        return shut ? this.run("tile.drawer", { open: true, container: shut.id }, this.nameOf(leaves(shut.kid)[0]!)) : flash("no drawers · ^W p puts this tile in one");
      }
      case "s": { // the next tile in the tree (a float isn't in it: the swap says so)
        const ids = leaves(this.root), j = this.isFloat(this.focus) ? ids[0]! : ids[(ids.indexOf(this.focus) + 1) % ids.length]!;
        return j !== this.focus ? this.run("layout.swap", { to: this.nameOf(j) }, me) : this.redraw();
      }
    }
    this.redraw();
  }

  /** The policy panel's containers over tile `tile`: the screen, then each one down to it. */
  policyNodes(tile: number): { label: string; node: Container | null }[] {
    if (!this.panes.has(tile)) return [{ label: "screen", node: null }];
    return [{ label: "screen", node: null }, ...chainOf(this.root, tile).map(c => ({ label: `${c.t === "split" ? `${c.dir} split` : c.t === "columns" ? "columns" : c.t === "tabs" ? "tabs" : c.t === "flow" ? "flow" : `${c.edge} drawer`} ${c.id ?? ""}`.trim(), node: c }))];
  }

  /**
   * The policy panel's rows for container `node` (null: the screen): each field, what it is now, and what ⏎ or a
   * click does (the same `layout.policy`, `layout.lock` or `tile.pin` an agent calls); `adjust` is + and -.
   */
  policyRows(tile: number, node: Container | null): { label: string; value: string; run?: () => void; adjust?: (by: number) => void }[] {
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
    const kinds = [...new Set((node ? leaves(node) : this.all()).map(i => this.panes.get(i)!.kind))];
    rows.push({ label: "accepts · the tile kinds it takes", value: own.accepts ? own.accepts.join(", ") || "nothing" : at.accepts ? `${at.accepts.join(", ")} (from ${at.by.accepts})` : "any", run: () => (own.accepts ? set({ clear: "accepts" }) : set({ accepts: kinds.join(",") })) });
    const notes = this.all().filter(i => kindOf(this.panes.get(i))?.accepts?.notes && !(node && leaves(node).includes(i))).map(i => this.nameOf(i));
    rows.push({ label: "opens · the open rule (a flow's is next)", value: own.opens ?? `${at.opens}${at.by.opens ? ` (from ${at.by.opens})` : ""}`, run: () => (own.opens === undefined ? set({ opens: at.opens === "next" ? "current" : "next" }) : set({ clear: "opens" })) });
    if (!node) {
      const order = ["over", "beside", "none"] as const, now = own.host ?? "over";
      rows.push({ label: "host · where the host layer may appear (the agent)", value: own.host ?? "over (the default)", run: () => set({ host: order[(order.indexOf(now) + 1) % order.length] }) });
    }
    rows.push({
      label: "opens into · where its tiles' opens land", value: own.opensInto ?? (at.opensInto ? `${at.opensInto} (from ${at.by.opensInto})` : "—"),
      run: () => { const i = own.opensInto ? notes.indexOf(own.opensInto) : -1; const next = notes[i + 1]; return next ? set({ opensInto: next }) : set({ clear: "opensInto" }); },
    });
    if (node) {
      const cellsNow = this.cellsOf(node);
      for (const k of ["fixed", "min", "max"] as const) rows.push({
        label: `${k} size · cells (+ - change it)`, value: own[k] === undefined ? "—" : String(own[k]),
        run: () => (own[k] === undefined ? set({ [k]: cellsNow }) : set({ clear: k })),
        adjust: by => set({ [k]: Math.max(1, (own[k] ?? cellsNow) + by) }),
      });
    }
    if (node?.t === "drawer") {
      rows.push(flag("collapsible", "it slides shut"));
      rows.push({ label: "overlay · slides over (off: takes its room)", value: onOff(node.policy?.overlay !== false), run: () => set({ overlay: node.policy?.overlay === false }) });
      rows.push({ label: "stays · open when the keys leave it", value: onOff(!!node.policy?.stays), run: () => set({ stays: !node.policy?.stays }) });
      const order: Dir[] = ["left", "up", "right", "down"];
      rows.push({ label: "edge · where it slides from", value: node.edge, run: () => this.run("tile.pin", { edge: order[(order.indexOf(node.edge) + 1) % 4] }, this.nameOf(leaves(node.kid)[0]!)) });
    }
    return rows;
  }
  /** A container's size along its parent's axis now, in cells (for the panel's size rows). */
  private cellsOf(node: Container): number {
    const rects = this.rectsNow(), p = parentNode(this.root, node);
    const rs = leaves(node).map(i => rects.get(i)).filter((r): r is Rect => !!r);
    if (!rs.length) return 10;
    const across = !p || p.parent.dir === "row";
    return across ? Math.max(...rs.map(r => r.col + r.cols)) - Math.min(...rs.map(r => r.col)) : Math.max(...rs.map(r => r.row + r.rows)) - Math.min(...rs.map(r => r.row));
  }

  // ── tile operations (TILE_ACTIONS): the keys, the mouse and `act` all come here ──

  /**
   * A tile by its name (what the dispatcher gives an action once it has read `tile=`'s grammar), or "focused"; none
   * named: the focused one. The grammar itself (ids, numbers, block ids, aliases) is the dispatcher's alone.
   */
  private tileNamed(sel: string | undefined, refuse = true): { name: string; id: number } | null {
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
  private policyAt(id: number): Effective { return policyOver(this.layout, id, this.facts(id)); }
  /** The whole screen is locked (its own policy). */
  screenLocked(): boolean { return !!this.layout.policy.locked; }
  /** Where this screen lets the host layer (the dock) appear: its policy's `host` (PIE-513), else over it. */
  hostMode(): HostMode { return this.layout.policy.host ?? "over"; }
  /** The drawers shut now, outermost first (one inside a shut drawer isn't reachable: its outer one's handle is). */
  private shutDrawers(): Drawer<number>[] {
    const out: Drawer<number>[] = [];
    const walk = (n: LNode) => { if (n.t === "drawer" && !n.open) { if (leaves(n.kid).length) out.push(n); return; } kidsOf(n).forEach(walk); };
    walk(this.root);
    return out;
  }
  /** A tile's drawer, as `layout.get` and `peek` say it. */
  private drawerView(id: number) {
    const d = drawerOf(this.root, id);
    return d ? { drawer: d.open ? "open" : "shut", edge: d.edge, ...(d.id ? { container: d.id } : {}) } : {};
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
    return Object.keys(out).length ? { policy: out } : {};
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
    this.apply({ op: "move", tile: src.id, to: place }, actor);
    this.save(); this.redraw();
    return { tile: src.name, where, ...(to ? { to } : {}), tree: describeLayout(this.layout, id => this.nameOf(id)) };
  }

  /**
   * `tile.open`: a new tile beside (or in the tabs of) tile `at`. `link`: the tile whose opens land in it, linked in the
   * same layout step (tile.preview); `keys: false` leaves the person's keys where they are.
   */
  async openTile(t: NewTile, at: string | undefined, where: Where, actor: Actor, also: { link?: number; keys?: false } = {}): Promise<TileDone> {
    const k = kindOf({ kind: t.kind } as Pane);
    if (!k || !isTileKind(t.kind)) throw new ActionRefused(`tile.open: kind is ${tileKindNames().join(", ")}, not ${t.kind}`);
    const bad = t.name !== undefined ? tileNameProblem(t.name) : null;
    if (bad) throw new ActionRefused(`tile.open: ${bad}`);
    if (t.name && this.idNamed(t.name) !== undefined) throw new ActionRefused(`there's already a tile named ${t.name}`);
    const base = this.tile(at);
    let spec: TileSpec = { t: "leaf", kind: t.kind, name: t.name ?? (k.word && k.word !== t.kind ? this.autoName(k.word) : undefined), ...(t.cmd ? { cmd: splitWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.note ? { note: t.note } : {}), ...(t.page ? { page: t.page } : {}), ...(t.cwd ? { cwd: t.cwd } : {}), ...(t.view ? { view: t.view } : {}) };
    // The kind checks its fields (a preview's source) and fills what it starts with (it follows `at`).
    const wrong = k.check?.(spec);
    // Short of what it needs (a query tile with no view): the person picks it from the kind's choices, then it opens.
    if (wrong && k.choices && actor.kind !== "agent") {
      await this.askChoices(t.kind, more => this.run("tile.open", { ...t, ...more, to: base.name, where }, base.name));
      return { tile: base.name, picking: t.kind };
    }
    if (wrong) throw new ActionRefused(`tile.open: ${wrong}`);
    spec = { ...spec, ...(k.defaults?.(spec, { name: base.name, pane: this.panes.get(base.id)! }) ?? {}) };
    // The layout says yes (or why not) before the tile is made: a refused open starts no program.
    const id = this.nextId;
    const r = this.ask({ op: "open", tile: id, kind: t.kind, ...(spec.name ? { name: spec.name } : {}), at: placeOf(where, base.id), ...also }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    this.put(makeTile(spec));
    this.commit(r);
    this.startTile(id);
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind: t.kind, n: this.numberOf(id), beside: base.name, where, ...(also.link !== undefined ? { from: this.nameOf(also.link) } : {}) };
  }

  closeTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    // A tile in a container that shuts its drawer instead (the board's outline and backlinks, `shuts`): it does.
    if (chainOf(this.root, t.id).some(c => c.policy?.shuts)) return this.shutDrawerOf(t, actor);
    // Every rule (its container's, what keeps it, an edit, the last tile, the person's keys) is the module's.
    const r = this.ask({ op: "close", tile: t.id }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
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

  /**
   * Shut the drawer tile `t` is in (`shuts`: the board's outline and backlinks, whose lists stay theirs): pinned, the
   * container that shuts goes back into a drawer first. The keys, if they were in it, go home (the spec's `home`).
   * The person's keys in it are theirs too: an agent doesn't.
   */
  private shutDrawerOf(t: { name: string; id: number }, actor: Actor): TileDone {
    this.dispatch.check("tile", actor, t.name, "an agent doesn't close it");
    const holder = chainOf(this.root, t.id).find(c => c.policy?.shuts)!;
    const had = this.focus, inside = leaves(holder).includes(had);
    if (!drawerOf(this.root, t.id) && holder.id) this.apply({ op: "pin", tile: t.id, on: false, container: holder.id }, actor);
    const d = drawerOf(this.root, t.id);
    if (d?.open) this.apply({ op: "drawer", tile: t.id, open: false }, actor);
    if (inside && actor.kind !== "agent") this.goHome(); else if (this.all().includes(had)) this.focus = had;
    this.save(); this.redraw();
    return { tile: t.name, pane: t.name };
  }

  /**
   * Where Tab stops, in reading order: each tile shown, then the floats; columns (the board's lanes) are one stop, the
   * tile last in them, and a drawer is one stop, its first tile (its list, not the preview beside it).
   */
  private tabStops(): number[] {
    const out: number[] = [], seen = new Set<string>();
    for (const id of visible(this.root)) {
      const c = chainOf(this.root, id).find(x => x.t === "columns" || x.t === "drawer");
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
    const t = this.idNamed(h);
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
  /** Where the keys are now is the place of each columns container they're in. */
  private noteFocus() {
    for (const c of chainOf(this.root, this.focus)) if (c.t === "columns" && c.id) this.lastIn.set(c.id, this.focus);
    // A tile opened into a container that's given the keys is where the next open there lands.
    const k = this.openedInto(this.focus);
    if (k !== undefined && !this.isFloat(this.focus)) this.openedIn(k).active = this.focus;
  }

  linkTile(sel: string | undefined, to: string | undefined, actor: Actor): TileDone {
    const src = this.tile(sel);
    const r = this.apply({ op: "link", tile: src.id, ...(to ? { to: this.tile(to).id } : {}) }, actor);
    this.save(); this.redraw();
    return { tile: src.name, link: r.answer.link ?? null };
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
    this.save(); this.redraw();
    return { tile: t.name };
  }

  /**
   * `tile.pin`: put the tile (its tab set, as one) in a drawer where it is (on=false), or take its drawer away so
   * what it holds is pinned there again (on=true); toggles by default. With `edge`, the drawer slides from that
   * outer edge of the whole layout: a tile not in one is put in one there, a drawer moves there.
   */
  pinTile(sel: string | undefined, on: boolean | undefined, edge: Dir | "other" | undefined, actor: Actor, container0?: string): TileDone {
    const t = this.tile(sel);
    // A tile living in a drawer's container (`shuts`: the board's outline, the list and its preview) goes in and out
    // of its drawer with that container whole.
    const holder = chainOf(this.root, t.id).find(c => c.policy?.shuts);
    const pinned = !drawerOf(this.root, t.id);
    const container = container0 ?? (holder?.id && pinned && on !== true ? holder.id : undefined);
    // `other`: the opposite side to where it is now; pinned, it's moved into a drawer there and pinned again.
    let edgeTo: Dir | undefined = edge === "other" ? undefined : edge;
    if (edge === "other") {
      const r = this.rectsNow().get(t.id), d = drawerOf(this.root, t.id);
      const now: Dir = d ? d.edge : r && r.col + r.cols / 2 > this.area.col + this.area.cols / 2 ? "right" : "left";
      edgeTo = ({ left: "right", right: "left", up: "down", down: "up" } as const)[now];
      if (pinned) {
        this.apply({ op: "pin", tile: t.id, on: false, edge: edgeTo, ...(holder?.id ? { container: holder.id } : {}) }, actor);
        const back = this.apply({ op: "pin", tile: t.id, on: true }, actor);
        this.save(); this.redraw();
        return { tile: t.name, ...back.answer, edge: edgeTo };
      }
    }
    const r = this.apply({ op: "pin", tile: t.id, ...(on !== undefined ? { on } : {}), ...(edgeTo ? { edge: edgeTo } : {}), ...(container !== undefined ? { container } : {}) }, actor);
    if (r.changed) this.save();
    this.redraw();
    return { tile: t.name, ...r.answer };
  }

  drawerTile(sel: string | undefined, open: boolean | undefined, actor: Actor, container?: string): TileDone {
    const t = this.tile(sel);
    const r = this.apply({ op: "drawer", tile: t.id, ...(open !== undefined ? { open } : {}), ...(container ? { container } : {}) }, actor);
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
    if (this.inFlow(t.id) && !this.layout.links.has(t.id)) throw new ActionRefused(`${t.name} is a column of a flow: its opens already land in the next column`);
    const had = this.linkOf(t.id);
    if (had !== undefined) {
      this.apply({ op: "reveal", tile: had }, actor);
      const name = this.nameOf(had);
      if (actor.kind !== "agent") this.focusTile(name, actor); else { this.save(); this.redraw(); }
      return { tile: name, from: t.name, existing: true };
    }
    const r0 = this.rectsNow().get(t.id);
    const dir: Dir = where ?? (r0 && splitAxis(r0) === "col" ? "down" : "right");
    const name = this.autoName(`${t.name}-preview`);
    // Checked before the kind is asked (the board collapses its own strip for it): a refused name changes nothing.
    const bad = tileNameProblem(name);
    if (bad) throw new ActionRefused(`tile.preview: ${bad} · ^W v on a shorter-named tile, or tile.open name=… then tile.link`);
    const k = kindOf(p);
    // Asked of the layout before the kind is: a preview has nowhere to go beside a float or into a locked container.
    const why = refusal(this.layout, { op: "open", tile: this.nextId, kind: "preview", name, at: placeOf(dir, t.id), link: t.id }, this.layoutCtx(actor));
    if (why) throw new ActionRefused(why);
    let spec: NewTile;
    try { spec = k?.previewSource ? { kind: "preview", source: await k.previewSource(p, t.name, actor) } : k?.accepts?.notes ? { kind: "detail" } : { kind: "preview", source: `tile:${t.name}` }; }
    catch (e) { throw e instanceof ActionRefused ? e : new ActionRefused(e instanceof Error ? e.message : String(e)); }
    return this.openTile({ ...spec, name }, t.name, dir, actor, { link: t.id, keys: false });
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
    if (send) { p.input(send); this.ctx.flash(`sent ctrl+] to ${name}`); }
    else this.ctx.flash(`typing in ${name} · ${ESCAPE_CHORD} back to the door`);
    return { tile: name, typing: true };
  }

  /** The person's keys leave this screen's terminal without a word (the dock's keys went back to the screen shown). */
  stopTyping() { this.ptyIn = null; }

  /** Back to the door from the terminal the person types in (ctrl+]); ctrl+] again soon sends one to it. The person's only. */
  leaveTerminal(): TileDone {
    const p = this.ptyIn;
    if (!p) throw new ActionRefused("the person isn't typing in a terminal tile");
    this.ptyIn = null; this.chord = { pane: p, at: Date.now() };
    this.ctx.flash(`back to the door · ctrl+] again sends ctrl+] to ${this.nameOf(this.focus)} · e or ⏎ types in it again`);
    return { tile: this.nameOf(this.focus), typing: false };
  }

  /**
   * Find notes by text, as `/` does. An agent's (or anyone's with a query) answers the hits (the service's
   * search); the person's opens the search overlay (with the query typed in, when given), and ⏎ there runs `open`.
   */
  async searchNotes(query: string | undefined, limit: number | undefined, actor: Actor): Promise<unknown> {
    const q = query?.trim() ?? "";
    if (actor.kind !== "agent") {
      this.overlays.push(searchOverlay(this, q));
      this.redraw();
      return { overlay: true, query: q };
    }
    if (q.length < 2) throw new ActionRefused("search needs query=<at least 2 characters>");
    const hits = await this.ctx.board.search(q, Math.max(1, Math.min(100, limit ?? 30)), { near: this.current?.id });
    return { query: q, hits: hits.map((m, i) => ({ n: i + 1, id: m.id, title: subject(m), ...(m.props["work-id"] ? { workId: m.props["work-id"] } : {}) })) };
  }

  restartTerminal(name: string, p: PtyPane, _actor: Actor): TileDone {
    if (p.running) throw new ActionRefused(`${name} is still running`);
    p.restart();
    return { tile: name };
  }

  tileInfo(sel: string | undefined): unknown { const t = this.tile(sel); return this.tileView(t.id); }

  /**
   * `screen.save` (PIE-565): this screen, as it's laid out now, as the screen note named `name` (src/desk/screen-notes.ts):
   * written to the outline, so every door on it opens it (`--screen <name>`, `screen.open`, ^W r) and an agent reads it.
   * Saving under the name it already has writes its note again, at the revision this door read. The person's with no
   * name opens the prompt (^W w), the screen's own name typed in.
   */
  async saveScreen(name: string | undefined, actor: Actor): Promise<Record<string, unknown>> {
    if (name === undefined || !name.trim()) {
      if (actor.kind === "agent") throw new ActionRefused("screen.save needs name=<the screen's name> (a letter, then letters, digits, . - _)");
      this.overlays.push(screenSaver(this.layoutName ?? ""));
      this.redraw();
      return { prompt: true, name: this.layoutName };
    }
    name = name.trim();
    // A screen as data (specData): this one's spec with the layout as it is now, never the file it keeps itself in.
    const { saves: _saves, stays: _stays, ...rest } = this.spec;
    const spec: ScreenSpec = { ...rest, name, title: name, layout: this.layoutSpec() };
    const { note, created } = await saveScreenNote(this.ctx.board, spec, actor);
    this.layoutName = name;
    // A screen a person makes from blank (or one they made) is that screen now: its title, and what a session reopens.
    if (this.madeHere()) { this.title = name; this.madeAs = name; }
    this.savedAs = this.shapeNow();
    this.save(); this.redraw();
    return { screen: name, note: note.id, revision: note.revision, created, tiles: this.all().map(id => this.nameOf(id)) };
  }
  /** The name of the screen a person made that this desk shows (saved from blank, or opened by its name). */
  private madeAs: string | null = null;
  /** The screen a person made that this desk shows, by name, while its note is there. */
  madeName(): string | null { return this.madeAs && madeScreen(this.madeAs) ? this.madeAs : null; }

  /**
   * `screen.delete`: the screen note named `name` to the outline's Trash, and the screen gone from every door's list.
   * The person's asks first (again within 3s deletes); a screen shown here stays as it is, now one of no name.
   */
  async deleteScreen(name: string, actor: Actor): Promise<Record<string, unknown>> {
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
  /** The screen's shape as saving it would write it, but not what its tiles show now (a detail's note) nor their ids. */
  private shapeNow(): string { return JSON.stringify({ ...this.saved(), rule: this.rule }, (k, v) => (k === "note" || k === "id" ? undefined : v)); }

  /**
   * `layout.load`: lay this screen out as the screen named `name` (a screen note) or a built-in layout. Tiles with the same
   * name and kind are kept; one holding work the new layout has no place for goes in a shut drawer. The person's with
   * no name opens the picker (^W r).
   */
  loadLayout(name: string | undefined, actor: Actor) {
    if (name === undefined || !name.trim()) {
      if (actor.kind === "agent") throw new ActionRefused(`layout.load needs name=<a layout>: ${layoutNames().map(l => l.name).join(", ")}`);
      this.overlays.push(layoutPicker(layoutNames()));
      this.redraw();
      return { picker: true, layouts: layoutNames() };
    }
    const found = layoutNamed(name);
    if (!found) throw new ActionRefused(`no layout ${name}; layouts: ${layoutNames().map(l => l.name).join(", ")} (a screen you made is one: ^W w saves this one)`);
    // The lock, a container's lock the person set, their keys: the module says whether the screen may be laid out again.
    this.apply({ op: "load", name }, actor);
    if (!this.spec.layouts) throw new ActionRefused(`the ${this.title} keeps its own layout; load one on the desk (D) or a blank screen (M on the menu)`);
    this.entered.clear();
    this.ptyIn = null;
    const before = new Set(this.all());
    this.build(found.spec, true);
    this.layoutName = name;
    this.savedAs = this.shapeNow();
    this.save(); this.redraw();
    // What it kept that the layout has no place for (a running program): in a shut drawer, said.
    const kept = this.shutDrawers().flatMap(d => leaves(d.kid)).filter(id => before.has(id) && this.holdsWork(this.panes.get(id)!)).map(id => this.nameOf(id));
    return { layout: name, saved: found.saved, rule: this.rule, tiles: this.all().map(id => this.nameOf(id)), ...(kept.length ? { kept } : {}) };
  }

  /**
   * A new tile of `t.kind` where tile `sel` is, in its place (the blank tile's rows: tile.open's fields, by one layout
   * operation, `replace`). The person's keys go to it when they were on the tile it replaces.
   */
  async replaceTile(sel: string | undefined, t: NewTile, actor: Actor): Promise<TileDone> {
    const k = kindOf({ kind: t.kind } as Pane);
    if (!k || !isTileKind(t.kind)) throw new ActionRefused(`kind is ${tileKindNames().join(", ")}, not ${t.kind}`);
    const base = this.tile(sel);
    let spec: TileSpec = { t: "leaf", kind: t.kind, ...(t.name ? { name: t.name } : {}), ...(t.cmd ? { cmd: splitWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.note ? { note: t.note } : {}), ...(t.view ? { view: t.view } : {}) };
    const wrong = k.check?.(spec);
    if (wrong) throw new ActionRefused(wrong);
    spec = { ...spec, ...(k.defaults?.(spec, { name: base.name, pane: this.panes.get(base.id)! }) ?? {}) };
    const id = this.nextId;
    const r = this.ask({ op: "replace", tile: base.id, with: id, kind: t.kind, ...(spec.name ? { name: spec.name } : {}) }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    const old = this.panes.get(base.id)!;
    this.put(makeTile(spec));
    this.commit(r);
    this.dropTile(base.id);
    old.dispose?.();
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
    const r = this.ask({ op: "open", tile: this.nextId, kind: "pty", name: p.name, loose: true, at: where });
    if (!r.ok) return false;
    // Never kept in a layout (its program and files go with the door), so its spec is the door's own, never a saved one.
    const pane = new PtyPane({ cmd: p.cmd, ...(p.cwd ? { cwd: p.cwd } : {}), ...(p.file ? { file: p.file } : {}), ...(p.own ? { own: p.own } : {}), ...(p.shows ? { shows: p.shows } : {}), label: p.name, temp: true });
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
    this.focus = id; this.ptyIn = pane;
    this.redraw();
    return true;
  }

  // ── what the person sees, for agents: layout.get, view.get, view.subscribe (App diffs viewState) ──

  /** The layout's shape: what changes only when the layout does (not with what a tile shows). */
  private layoutShape() {
    return {
      name: this.layoutName, rev: this.layout.rev, rule: this.rule, zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, locked: this.screenLocked(), tree: layoutShapeOf(this.layout, id => this.nameOf(id), id => this.tileId(id)), floats: this.floats.map(f => ({ tile: this.nameOf(f.id), rect: this.floatRect(f) })),
      tiles: this.all().map(id => {
        const p = this.panes.get(id)!, link = this.linkOf(id), set = tabsOf(this.root, id), cover = this.cover(id);
        const dv = this.drawerView(id);
        return {
          tile: this.nameOf(id), id: this.tileId(id), kind: p.kind, rect: this.hits.find(([x]) => x === id)?.[1] ?? null,
          ...(link !== undefined ? { link: this.nameOf(link) } : {}),
          ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), shown: set.ids[set.active] === id } : {}),
          ...("drawer" in dv ? dv : this.isFloat(id) ? { float: true } : { pinned: true }),
          ...(this.collapsed.has(id) ? { collapsed: true } : {}),
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
      if (i < 0) throw new ActionRefused(`no line in ${subject(p.msg).slice(0, 40)} has ${JSON.stringify(at.text)}`);
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
    const reason = m.reason.trim().slice(0, 80);
    if (!reason) throw new ActionRefused("block.mark needs reason=<a few words>");
    if (m.line !== undefined) {
      const t = this.tile(sel);
      const p = this.panes.get(t.id);
      if (!(p instanceof PtyPane) || !p.nvim) throw new ActionRefused(`${t.name} isn't an nvim tile the door is connected to; line= marks a line there`);
      const extmark = await p.nvim.mark(m.line, `${reason} · by ${by}`, p.file);
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
  /** Everything this desk keeps about tile `id` that leaves it (closed, or moved whole to the dock or another screen). */
  private forgetTile(id: number, p: Pane) {
    if (this.ptyIn === p) this.ptyIn = null;
    if (this.chord?.pane === p) this.chord = null;
    if (this.pending?.pane === p) this.pending = null;
    if (p instanceof ReaderPane && this.entered.in(p)) this.entered.clear();
    if (this.floatDrag?.id === id) this.floatDrag = null;
    if (this.linking?.from === id) this.linking = null;
    if (this.mouseTile?.id === id) this.mouseTile = null;
    if (this.headPress?.id === id) this.headPress = null;
    if (this.dragging?.src === id) this.dragging = null;
    for (const [k, v] of [...this.lastIn]) if (v === id) this.lastIn.delete(k);
    // (openedFrom is the closer's to read: a program's tile closed gives the keys back to its reader; takeOut clears it.)
    this.panes.delete(id); this.unregistered.delete(id); this.sourced.delete(id); this.movedIn.delete(id);
    for (const r of this.opened.values()) { r.ids = r.ids.filter(i => i !== id); if (r.active === id) r.active = null; }
  }
  /** Tiles moved here whole (from the dock): when this screen goes for good, one still running goes back to the dock. */
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
  floatTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel), p = this.panes.get(t.id)!;
    if (this.ctx?.hostLayer?.isDock(this)) throw new ActionRefused(`${t.name} is in the dock: it doesn't float there · ^W a puts it on the screen, where it floats`);
    const key = this.openedInto(t.id), c = key !== undefined ? node(this.root, key) : null;
    // A float opened into a container (the board's readers row) goes back into it, as its last tile there; a full one
    // gives way, never a tile holding an edit or a comment, nor (for an agent) the one the person has.
    if (this.isFloat(t.id) && key !== undefined && c) {
      const at: At<number> = { kind: "in", key, weight: this.weightIn(key) };
      const asked = this.ask({ op: "float", tile: t.id, at }, actor);
      if (!asked.ok) throw new ActionRefused(asked.refused);
      const pinned = this.openedTiles(key).filter(id => !this.isFloat(id));
      if (pinned.length >= (c.policy?.keep ?? Infinity)) {
        const out = pinned.find(id => { const q = this.panes.get(id); return !(q instanceof ReaderPane && q.editing) && !this.dispatch.rule("tile", actor, this.nameOf(id)); });
        if (out === undefined) throw new ActionRefused(`not put back: the other tiles in ${key} hold edits or comments${actor.kind === "agent" ? ", or the person has them" : ""} · save or close one first`);
        this.closeId(out);
      }
      this.apply({ op: "float", tile: t.id, at }, actor);
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
  tileMenu(sel: string | undefined, at: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const rows: MenuRow[] = this.dispatch.menu(t.name, actor);
    if (actor.kind === "agent") return { tile: t.name, rows };
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
    this.overlays.push(tileMenu<Desk>({ title: this.nameOf(t.id), rows, at: anchor }));
    this.redraw();
    return { tile: t.name, open: true, rows };
  }

  /** Tile `sel` as its menu shows it (TileNow): where it is, and why each tile operation would be refused there now. */
  tileNow(sel: string | undefined, actor: Actor): TileNow {
    const t = this.tile(sel), id = t.id, p = this.panes.get(id);
    const flow = chainOf(this.root, id).find((c): c is Flow<number> => c.t === "flow");
    const ask = (op: Op<number>) => { const r = this.ask(op, actor); return r.ok ? null : r.refused; };
    const docked = !!this.ctx?.hostLayer?.isDock(this);
    return {
      float: this.isFloat(id), zoomed: this.zoom === id, collapsed: this.collapsed.has(id), drawer: !!drawerOf(this.root, id),
      shuts: chainOf(this.root, id).some(c => c.policy?.shuts), docked, flow: !!flow,
      held: !!flow?.held?.some(h => columnOf(flow, h) === columnOf(flow, id)),
      running: p instanceof PtyPane && p.running ? p.title() : null,
      refused: op => {
        switch (op) {
          case "close": return ask({ op: "close", tile: id });
          case "float": return docked ? `${t.name} is in the dock: it doesn't float there` : ask({ op: "float", tile: id });
          case "zoom": return ask({ op: "zoom", tile: id });
          case "collapse": return ask({ op: "collapse", tile: id, on: !this.collapsed.has(id) });
          case "pin": return ask({ op: "pin", tile: id });
          case "dock": return !this.ctx?.hostLayer ? "this door has no dock here" : docked ? null : this.takeRefusal(t.name, actor);
          case "widen": return ask({ op: "flow.widen", tile: id });
          case "hold": return ask({ op: "flow.hold", tile: id });
        }
      },
    };
  }

  /** A right-click at screen cell `x`, `y` in tile `id` (drawn at `r`) is the tile's own (a program that asked for the mouse, a step's box). */
  private ownsRightClick(id: number, r: Rect, x: number, y: number): boolean {
    if (y <= r.row || x <= r.col || x >= r.col + r.cols - 1 || y >= r.row + r.rows - 1) return false;
    return !!this.panes.get(id)?.ownsRightClick?.(x - r.col - 1, y - r.row - 1);
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
  collapseTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
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
    const r = this.apply({ op: "collapse", tile: t.id, ...(on !== undefined ? { on } : {}) }, actor);
    if (r.changed) this.save();
    // The person's fold says what it kept (an agent's is said by the action's own words).
    const p = this.panes.get(t.id);
    if (actor.kind !== "agent" && r.changed && r.answer.collapsed && p instanceof ReaderPane) {
      if (this.pending?.pane === p) this.pending = null;              // an edit still opening there doesn't open behind a spine
      this.ctx.flash(`${p instanceof DetailPane && p.label ? p.label : t.name} collapsed${p.holdsKeys ? `, keeping ${sessionName(p)}` : ""} · ⏎ or a click opens it`);
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

  /** `tile.hold`: tile `sel`'s column resists compression in its flow (the river's `p`), or lets go; default toggles. */
  holdTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const r = this.apply({ op: "flow.hold", tile: t.id, ...(on !== undefined ? { on } : {}) }, actor);
    this.save(); this.redraw();
    return { tile: t.name, held: !!r.answer.held };
  }

  // ── the dock (PIE-498): a tile leaves a screen whole, or comes into one, its program, note and history with it ──

  /**
   * `host.dock`: tile `sel` goes into the dock (on=true; default here), the host layer's drawer that travels with the
   * person across screens, or, from the dock, back into the screen shown (on=false), beside `to` (where=). The host
   * layer does it (`Ctx.hostLayer`): this screen's part is `takeOut` and `bringIn`, each one layout operation.
   */
  dockTile(sel: string | undefined, on: boolean | undefined, to: string | undefined, where: Where | undefined, actor: Actor): TileDone {
    const host = this.ctx?.hostLayer;
    if (!host) throw new ActionRefused("this door has no dock here (the logon and the logoff have none)");
    const t = this.tile(sel);
    if (host.isDock(this)) {
      if (on === true) return { tile: t.name, docked: true, changed: false };
      return host.undock(t.name, to, where, actor);
    }
    // From a screen, on=false brings the dock's tab shown here, beside tile= (^W A); a docked tile by name is the dock's own request.
    if (on === false) {
      const shown = host.shownTab();
      if (!shown) throw new ActionRefused("the dock shows nothing to bring here");
      return host.undock(shown, to ?? t.name, where, actor);
    }
    return host.dock(this, t.name, actor);
  }

  /** Why tile `sel` can't leave this screen now, or null (nothing is done). */
  takeRefusal(sel: string | undefined, actor: Actor): string | null {
    const t = this.tileNamed(sel, false);
    if (!t) return `no tile ${sel} on the ${this.title}`;
    // A screen of a fixed shape that saves comes back only with every tile its spec names: they stay.
    if (this.spec.saves && !this.spec.layouts && leafNames(this.spec.layout.root).includes(t.name) && !this.ctx?.hostLayer?.isDock(this)) return `${t.name} stays: the ${this.title} is laid out with it (its spec names it)`;
    const r = this.ask({ op: "take", tile: t.id }, actor);
    return r.ok ? null : r.refused;
  }
  /**
   * Tile `sel` leaves this screen whole (the layout's `take`), for the dock or a screen from it: its instance goes,
   * nothing of it ends (a terminal's program runs on, a reader keeps its note, its history and its draft).
   */
  takeOut(sel: string | undefined, actor: Actor): MovedTile {
    const why = this.takeRefusal(sel, actor);
    if (why) throw new ActionRefused(why);
    const t = this.tile(sel);
    const pane = this.panes.get(t.id)!;
    const spec = this.specOf(t.id);
    const typing = pane === this.ptyIn && this.focus === t.id;
    // A follower (a preview of a tile) leaving: bound to the tile it follows by identity (none here: to nothing).
    const f = kindOf(pane)?.follows?.(pane);
    if (f && !boundSource.has(pane)) { const sid = this.idNamed(f); boundSource.set(pane, sid !== undefined ? this.panes.get(sid) ?? NO_SOURCE : NO_SOURCE); }
    this.commit(this.ask({ op: "take", tile: t.id }, actor));
    this.forgetTile(t.id, pane);
    this.openedFrom.delete(t.id);
    this.save(); this.redraw();
    return { pane, name: t.name, spec, from: this.title, typing };
  }
  /** Where a tile moved here would land: beside `to` (the person's tile when left out), `where` (into the tabs of `to` here when this screen is the dock). */
  private landingFor(to: string | undefined, where: Where | undefined): { at: At<number>; base: string; where: Where } {
    const base = this.tile(to), w = where ?? (this.ctx?.hostLayer?.isDock(this) ? "tabs" : "right");
    return { at: placeOf(w, base.id), base: base.name, where: w };
  }
  /** Why `moved` can't come into this screen there, or null (nothing is done). */
  bringRefusal(moved: { name: string; spec: TileSpec }, to: string | undefined, where: Where | undefined, actor: Actor): string | null {
    let l: ReturnType<Desk["landingFor"]>;
    try { l = this.landingFor(to, where); } catch (e) { return (e as Error).message; }
    return refusal(this.layout, { op: "open", tile: this.nextId, kind: moved.spec.kind, name: moved.name, loose: true, at: l.at }, this.layoutCtx(actor));
  }
  /** A tile moved here whole (`takeOut` on another screen, or the dock): it joins this layout as it is, by the layout's open. */
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
    // The terminal the person was typing in came with them: they type in it here.
    if (moved.typing && actor.kind !== "agent" && moved.pane instanceof PtyPane && this.focus === id) this.ptyIn = moved.pane;
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind, where: l.where, beside: l.base };
  }

  /** The tile the person is dragging by its header now (a drop on the dock takes it there), or null. */
  draggedTile(): string | null { return this.dragging ? this.nameOf(this.dragging.src) : null; }
  /** The drag ends with nothing moved here (it was dropped on the dock, or outside this screen). */
  cancelDrag() { this.dragging = null; this.headPress = null; this.foreign = null; this.redraw(); }
  /** The dragged tile is over the dock (the status bar's chip, or the drawer): the drag says it lands there. */
  dockHover(label: string | null) { if (this.dragging && (this.dragging.dock ?? null) !== label) { this.dragging = { ...this.dragging, dock: label }; this.redraw(); } }
  /**
   * A tile from outside this screen (the dock's) dragged over it at x, y: where it would land here, by the same drop
   * zones a tile of this screen gets, with the reason policy refuses it; drawn as the ghost until `cancelDrag`.
   */
  foreignAt(x: number, y: number, moving: { name: string; kind: string }): { to?: string; where: Where; label: string; refused?: string } | null {
    const refuse = (to: Place<number>) => refusal(this.layout, { op: "open", tile: this.nextId, kind: moving.kind, name: moving.name, loose: true, at: to }, this.layoutCtx(USER));
    const drop = dropAt(this.dropTiles(), this.area, x, y, -1, true, refuse);
    this.foreign = drop ? { name: moving.name, drop, x, y } : null;
    this.redraw();
    if (!drop) return null;
    const where: Where = drop.kind === "edge" ? `edge-${drop.dir}` : drop.kind === "tabs" ? "tabs" : drop.dir;
    return { ...(drop.kind !== "edge" ? { to: this.nameOf(drop.target) } : {}), where, label: drop.label, ...(drop.refused ? { refused: drop.refused } : {}) };
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

  /** The tile drawn on top at a cell (a drawer over the layout), or null. */
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
    const why = rd.surface.leaveRefusal();
    if (why) { this.ctx.flash(why); return false; }
    this.entered.clear();
    // The person's own leave, through this screen's dispatcher (its note actions, in that reader's tile).
    void this.press(rd, NOTE_ACTIONS, "session.leave").then(r => { const said = r ? leaveSaid(r as Parameters<typeof leaveSaid>[0]) : null; if (said) this.ctx.flash(said, 10000); this.redraw(); });
    return true;
  }

  /** A click inside the reader the person is editing in: the surface's (a completion candidate), or false. */
  private clickIn(pane: ReaderPane, k: Extract<Key, { kind: "mouse" }>): boolean {
    const at = this.hits.find(([id]) => this.panes.get(id) === pane);
    const hit = at?.[1];
    // Only where the reader is on top: a float or a drawer drawn over its popup keeps the click.
    return !!hit && this.topTileAt(k.x, k.y) === at![0] && k.x > hit.col && k.y > hit.row && k.x < hit.col + hit.cols - 1 && k.y < hit.row + hit.rows - 1
      // A drag in an open edit selects in its draft (the press placed the cursor).
      && (k.action === "drag" ? (pane.drag(k.x - hit.col - 1, k.y - hit.row - 1, this), true) : pane.click(k.x - hit.col - 1, k.y - hit.row - 1, this));
  }

  /** How the hint row and a flash name a reader the person is in: by its number on screen (a view may name it its way). */
  /** A reader as the hint row says it: a detail by its label (detail 1), else its number, or its name where tiles aren't numbered. */
  private readerLabel(id: number): string { const p = this.panes.get(id); return p instanceof DetailPane && p.label ? p.label : this.numbered ? `reader ${this.all().indexOf(id) + 1}` : this.nameOf(id); }

  /**
   * The border under the pointer. A sliding drawer's own border is its edge only: the cell beyond it is the tile it
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

  /** A click on a header's "⇤ drawer": the drawer is pinned (tile.pin, so a view's own drawers pin their way: the board's). */

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

  /** Sideways wheel reports as steps: one a swipe. */
  private readonly swipe = new SidewaysWheel();
  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const p = this.pressed;
    if (k.action === "up") {
      if (this.drag) { this.drag = null; this.save(); }
      if (this.floatDrag) { this.floatDrag = null; this.save(); return; }
      const d = this.dragging, h = this.headPress;
      this.dragging = null; this.headPress = null;
      if (d?.drop) {
        const drop = d.drop;
        this.run("layout.move", drop.kind === "edge" ? { where: `edge-${drop.dir}` } : drop.kind === "tabs" ? { to: this.nameOf(drop.target), where: "tabs", ...(drop.index !== undefined ? { index: drop.index } : {}) } : { to: this.nameOf(drop.target), where: drop.dir }, this.nameOf(d.src));
      } else if (d) { this.ctx.flash("not moved: dropped where it was"); this.redraw(); }
      else if (h) {
        // A click on a flow column's header is the shift (the river's): it takes the wide place.
        if (this.inFlow(h.id)) this.run("tile.widen", {}, this.nameOf(h.id));
        this.redraw();
      }
      if (this.mouseTile) { const m = this.mouseTile; this.mouseTile = null; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col - 1, k.y - m.r.row - 1, this); }
      if (p) { this.pressed = null; p.pane.release(k.x - p.col, k.y - p.row, this, p.fresh ? (m, how) => this.setCurrent(m, { ...how, from: p.pane, fresh: true, reveal: true }) : undefined); this.redraw(); }
      return;
    }
    if (k.action === "drag") {
      // A float's title moves it, its corner sizes it: float.place, as H J K L and an agent's.
      if (this.floatDrag) {
        const f = this.floats.find(x => x.id === this.floatDrag!.id), g = this.floatDrag;
        if (f) { const at = this.floatRect(f); this.run("float.place", g.size ? { cols: k.x - at.col + 1, rows: k.y - at.row + 1 } : { col: k.x - g.dx, row: k.y - g.dy }, this.nameOf(g.id)); }
        return;
      }
      // A border follows the pointer by layout.resize (the same action an agent calls).
      if (this.drag) { const g = this.drag, split = g.d.node.id, f = dragShare(g, k.x, k.y); if (split && f !== null) this.run("layout.resize", { split, border: g.d.i, share: f }); return; }
      if (this.headPress) {
        const h = this.headPress;
        if (!this.dragging && Math.abs(k.x - h.x) + Math.abs(k.y - h.y) < 1) return;
        // Where it would land (a drawer's handle on the hint row first), with the reason policy refuses it, if any.
        const refuse = (to: Place<number>) => refusal(this.layout, { op: "move", tile: h.id, to }, this.layoutCtx(USER));
        const handles = this.handles.map(x => ({ from: x.from, to: x.to, row: this.area.row + this.area.rows, shows: shown(x.drawer.kid)[0] ?? x.id, edge: x.drawer.edge }));
        this.dragging = { src: h.id, drop: handleDrop(handles, this.area, k.x, k.y, h.id, refuse) ?? dropAt(this.dropTiles(), this.area, k.x, k.y, h.id, leaves(this.root).length > 1, refuse), x: k.x, y: k.y };
        return this.redraw();
      }
      if (this.mouseTile) { const m = this.mouseTile; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col - 1, k.y - m.r.row - 1, this); return; }
      if (p) return p.pane.drag(k.x - p.col, k.y - p.row, this);
      return;
    }
    // A float moved since the last paint is where the layout has it now (paints are coalesced; a press may come first).
    if (k.action === "down") {
      this.hits = this.hits.map(([id, r]) => { const f = this.floats.find(x => x.id === id); return [id, f ? this.floatRect(f) : r]; });
      // Its ⧉ too: where the float is now, not where it was last drawn.
      this.floatButtons = this.floatButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + 2, to: r.col + 5 }; });
      this.closeButtons = this.closeButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + r.cols - 2, to: r.col + r.cols - 1 }; });
      this.menuButtons = this.menuButtons.map(b => { const f = this.floats.find(x => x.id === b.id); if (!f) return b; const r = this.floatRect(f); return { ...b, row: r.row, from: r.col + r.cols - b.right, to: r.col + r.cols - b.right + 1 }; });
    }
    const hit = this.hits.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
    // The sideways wheel: a tile that takes the mouse has it (a terminal, the board's lanes); else the tile's kind says
    // what a step means where its content is horizontal (the river's columns: the one beside), one step a swipe
    // (SidewaysWheel). Anywhere else it does nothing: it is never read as the vertical wheel.
    const sw = sideways(k);
    if (sw) {
      if (!hit) return;
      const [id, r] = hit, pane = this.panes.get(id);
      if (pane?.mouse?.(k, k.x - r.col - 1, k.y - r.row - 1, this)) return;
      const a = pane ? kindOf(pane)?.sideways?.(pane, sw) : null;
      if (a && this.swipe.step(sw)) this.run(a.action, a.args ?? {}, this.nameOf(id));
      return;
    }
    if (k.action === "down") {
      // A shut drawer's handle, at the end of the hint row; the lock chip after them.
      if (k.y === this.area.row + this.area.rows) {
        const h = this.handles.find(h => k.x >= h.from && k.x < h.to);
        if (h) this.run("tile.drawer", { open: true, container: h.drawer.id }, this.nameOf(h.id));
        else if (this.lockChip && k.x >= this.lockChip.from && k.x < this.lockChip.to) this.run("layout.lock");
        else if (this.moreChip && k.x >= this.moreChip.from && k.x < this.moreChip.to) this.run("keys.more");
        return;
      }
      if (this.linking) {
        const from = this.linking.from;
        this.linking = null;
        if (!hit) { this.ctx.flash("not linked"); return this.redraw(); }
        return this.run("tile.link", hit[0] === from ? {} : { to: this.nameOf(hit[0]) }, this.nameOf(from));
      }
      // A right-click in a tile opens its menu at the pointer (tile.menu), unless what's under it takes it itself (a
      // program that asked for the mouse, a step's box: their own choice opens). The tile gets the keys first.
      if (k.button === MOUSE_RIGHT && hit && !this.ownsRightClick(hit[0], hit[1], k.x, k.y)) {
        const id = hit[0];
        if (id !== this.focus) this.run("tile.focus", {}, this.nameOf(id));
        return this.run("tile.menu", { at: `${k.x},${k.y}` }, this.nameOf(id));
      }
      // What a header draws to be clicked, before its row is a grip, a border or a float's title to drag: a mark's
      // label dismisses the mark, a drawer's "⇤ drawer" pins it, its [×] shuts it as Esc in it does (a list whose
      // container shuts its drawer, by its close), a control a tile put there (the backlinks' status) does what its key
      // does. A float's header carries the same controls: they're asked first, so its title drag doesn't swallow them.
      const at = (h: { id: number; row: number; from: number; to: number }) => hit?.[0] === h.id && h.row === k.y && k.x >= h.from && k.x < h.to;
      const mh = this.markHits.find(at);
      if (mh) return this.run("block.unmark", { n: mh.n });
      const dx = this.drawerCloses.find(at);
      if (dx) return chainOf(this.root, dx.id).some(c => c.policy?.shuts) ? this.run("tile.close", {}, this.nameOf(dx.id)) : this.run("tile.drawer", { open: false }, this.nameOf(dx.id));
      const dl = this.drawerLabels.find(at);
      if (dl) return this.run("tile.pin", { on: true }, this.nameOf(dl.id));
      const hp = this.headPresses.find(at);
      if (hp) { hp.press(); return this.redraw(); }
      // ⧉ on a tile's header: on a float it puts it back, on a pinned tile it floats it (tile.float either way, as ^W f).
      const fb = this.floatButtons.find(at);
      if (fb) return this.run("tile.float", {}, this.nameOf(fb.id));
      // × on a tile's frame: it closes (tile.close, as ^W x), without taking the keys there first.
      const xb = this.closeButtons.find(at);
      if (xb) return this.run("tile.close", {}, this.nameOf(xb.id));
      // ⋯ on a tile's frame: its menu opens under it (tile.menu, as ^W . does), the keys given to the tile it's for.
      const mb = this.menuButtons.find(at);
      if (mb) { if (mb.id !== this.focus) this.run("tile.focus", {}, this.nameOf(mb.id)); return this.run("tile.menu", {}, this.nameOf(mb.id)); }
      // A float: a press gives it the keys and brings it to the top; its title moves it, its ◢ corner sizes it.
      if (hit && this.isFloat(hit[0])) {
        const [id, r] = hit;
        if (id !== this.focus || this.floats.at(-1)?.id !== id) this.run("tile.focus", {}, this.nameOf(id));
        if (k.x >= r.col + r.cols - 2 && k.y >= r.row + r.rows - 2) { this.floatDrag = { id, size: true, dx: 0, dy: 0 }; return this.redraw(); }
        if (k.y === r.row) { this.floatDrag = { id, size: false, dx: k.x - r.col, dy: k.y - r.row }; return this.redraw(); }
      }
      // A spine: a click opens it (and gives it the keys), as ⏎ on it does.
      const sp = this.spines.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
      if (sp && hit?.[0] === sp[0]) return this.expandSpine(sp[0]);
      // A border: a drawer's own over it, else the layout's (not one hidden under a drawer). On a header row
      // only the title or tabs (the grip) move the tile; the bare line after them is the border above, so
      // pressing a tile's top edge resizes it. A header with no border above is all grip.
      const slid = hit ? this.slid.find(d => d.placed.rects.has(hit[0])) : undefined;
      const borders = hit && this.isFloat(hit[0]) ? [] : slid ? [...(slid.divider ? [slid.divider] : []), ...slid.placed.dividers] : this.dividers;
      const onGrip = !!hit && k.y === hit[1].row && k.x > hit[1].col && k.x < this.gripEnd(hit[1]);
      const d = this.zoom === null && !onGrip ? this.borderAt(borders, k.x, k.y) : null;
      if (d) {
        // A border the policy keeps where it is (locked, resizable off, a fixed size) doesn't follow the pointer: said once.
        const why = d.d.node.id ? refusal(this.layout, { op: "resize", split: d.d.node.id, border: d.d.i, share: d.d.sizes[0] / Math.max(1, d.d.sizes[0] + d.d.sizes[1]) }, this.layoutCtx(USER)) : null;
        if (why) { this.ctx.flash(why); return this.redraw(); }
        this.drag = d; return;
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
        const x = k.x - r.col - 1, y = k.y - r.row - 1;
        const how: RowPress = { mods: k.mods ?? 0, button: k.button, focusing };
        const press = pane ? kindOf(pane)?.press : undefined;
        if (pane && press) {
          // A click its kind gives an action (in a terminal: typing in it); the tile gets the click when it asks for the mouse.
          const a = press(pane, k);
          if (a) this.run(a.action, a.args ?? {}, this.nameOf(id));
          if (pane.mouse?.(k, x, y, this, how)) this.mouseTile = { id, r };
        } else if (pane?.mouse) { this.mouseTile = { id, r }; pane.mouse(k, x, y, this, how); }
        // A reader decides on release: a click, or a drag that selected text (PIE-419). A ctrl- or alt-click opens beside (PIE-473).
        else if (pane instanceof ReaderPane) {
          this.pressed = { pane, col: r.col + 1, row: r.row + 1, fresh: !!((k.mods ?? 0) & 24) };
          pane.press(x, y, this);
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
      if (pane?.mouse && pane.mouse(k, k.x - r.col - 1, k.y - r.row - 1, this)) return;
      pane?.wheel?.(k.action === "wheel-up" ? -1 : 1, this);
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
  const want = leafNames(spec.layout.root), have = new Set(leafNames(o.root)), wantKeys = containerKeys(spec.layout.root), haveKeys = new Set(containerKeys(o.root));
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

/** How dim a peek column is drawn under its neighbour (the river's cover). */
const PEEK_DIM = 0.55;
/** What a cut hint row ends with: ? (or a click on it) shows the rest (keys.more). */
let MORE = "";
themed(() => { MORE = paint("|08 · |15?|08 more") + RESET; });
const MORE_WIDTH = width(MORE);
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
/** A drop as `peek` says it: where the dragged tile would go. */
const dropView = (d: Drop<number>, name: (id: number) => string) => ({ kind: d.kind, ...("target" in d ? { target: name(d.target) } : {}), ...("dir" in d ? { dir: d.dir } : {}), ...(d.kind === "tabs" && d.index !== undefined ? { index: d.index } : {}), label: d.label, ghost: d.ghost, ...(d.refused ? { refused: d.refused } : {}) });
/** A follower that moved between screens, and the tile instance it follows (NO_SOURCE: it follows nothing now). */
const boundSource = new WeakMap<Pane, Pane | typeof NO_SOURCE>();
const NO_SOURCE = Symbol("no source");
/** A tile moving between screens (or into and out of the dock) whole: its instance, its name, its spec, whether the person was typing in it. */
export interface MovedTile { pane: Pane; name: string; spec: TileSpec; from: string; typing: boolean }

/** Where `where` (a tile action's place) puts a tile, by tile `at`: beside it, into its tabs, or along an outer edge. */
const placeOf = (where: Where, at: number): At<number> => (where === "next" ? { kind: "next", from: at } : where === "tabs" ? { kind: "tabs", target: at } : where.startsWith("edge-") ? { kind: "edge", dir: where.slice(5) as Dir } : { kind: "split", target: at, dir: where as Dir });
/** A command line as words, "quoted words" kept together. */
export function splitWords(s: string): string[] { return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]!); }

// ── the desk's overlays (the layout picker, the policy panel, the search): pickers on its mode stack ─────────

type DeskPicker = ListPicker<any, Desk>;

/** ^W r: the layouts to lay this screen out as: the built-ins, and the screens people made (screen notes). */
function layoutPicker(items: { name: string; saved: boolean; builtin: boolean }[]): DeskPicker {
  return new ListPicker({
    name: "layouts", items: () => items,
    row: (it, _i, on, w) => [pickRow(` ${it.name}${it.saved ? (it.builtin ? " · a screen you made, over the built-in" : " · a screen you made") : " · built-in"}`, on, w)],
    choose: (it, _i, d) => d.run("layout.load", { name: it.name }),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "lay this screen out as", foot: "↑↓ pick · ⏎ load · esc" }),
  });
}

/** ^W w: the name to save this screen as (its own, typed over): a screen note in the outline. */
function screenSaver(name: string): DeskPicker {
  return linePrompt<Desk>({
    name: "layouts", title: "save this screen as", text: name, w: 60,
    doing: t => (screenNotes().some(n => n.name === t.trim()) ? `save it over the screen ${t.trim()} (a note in the outline)` : `save it as ${t.trim() || "…"}, a screen note in the outline`),
    done: (t, d) => d.run("screen.save", { name: t }),
  });
}

/**
 * The screens to open: the ones people made, then the built-ins that open on nothing in particular. ⏎ or a double click
 * is screen.open; x on one a person made is screen.delete (twice: it asks first).
 */
function screensToOpen(): { name: string; made: boolean }[] {
  const made = screenNotes().map(n => ({ name: n.name, made: true }));
  return [...made, ...screenNames().filter(n => !made.some(m => m.name === n) && !screenTargetArg(n) && n !== "home").map(name => ({ name, made: false }))];
}
function screenPicker(): DeskPicker {
  const items = screensToOpen;
  const p: DeskPicker = new ListPicker<{ name: string; made: boolean }, Desk>({
    name: "screens", items,
    row: (it, _i, on, w) => [pickRow(` ${it.name} · ${it.made ? "a screen you made" : "built-in"}`, on, w)],
    // screen.open is the App's (the shell's), as the menu's letters run it.
    choose: (it, _i, d) => void d.ctx.press?.("screen.open", { name: it.name }),
    keys: (k, d) => {
      const it = items()[p.sel];
      if (ch(k) !== "x" || !it?.made) return false;
      d.run("screen.delete", { name: it.name });
      return true;
    },
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "open a screen", foot: items().some(i => i.made) ? "↑↓ pick · ⏎ open · x x deletes one you made · esc" : "↑↓ pick · ⏎ open · esc · ^W w saves one you make" }),
  });
  return p;
}

/** A kind's choices for a new tile (a query tile's view): one picked runs `then`. */
function choicePicker(title: string, items: { label: string; spec: Partial<TileSpec> }[], then: (it: { label: string; spec: Partial<TileSpec> }) => void): DeskPicker {
  return new ListPicker({
    name: "choices", items: () => items,
    row: (it, _i, on, w) => [pickRow(` ${it.label}`, on, w)],
    choose: it => then(it),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, Math.max(n, 1) + 2)), title, foot: items.length ? "↑↓ pick · ⏎ open · esc" : "none yet · esc" }),
  });
}

/**
 * ^W P: the containers over a tile (the screen first, then each one down to it) and one's policy, a row per field.
 * ⏎, space or a click changes a row through the same action an agent calls; h l (or a click on a name) pick the
 * container; + - change a size; esc, q or a click outside closes it.
 */
function policyPanel(d: Desk, tile: number): DeskPicker {
  let node = Number.MAX_SAFE_INTEGER, crumbs: { from: number; to: number; y: number; i: number }[] = [];
  const nodes = () => { const ns = d.policyNodes(tile); node = Math.min(node, ns.length - 1); return ns; };
  const rows = () => d.policyRows(tile, nodes()[node]!.node);
  const p: DeskPicker = new ListPicker<ReturnType<Desk["policyRows"]>[number], Desk>({
    name: "policy", items: rows, closers: "q", stays: true,
    row: (r, _i, on, w) => [pickRow(` ${r.label}`, on, Math.max(20, Math.min(52, w - 26))) + fg(C.lcyan) + ` ${r.value}` + RESET],
    choose: r => r.run?.(),
    keys: k => {
      const c = ch(k);
      if (k.kind === "left" || c === "h" || k.kind === "right" || c === "l") { node = Math.max(0, Math.min(nodes().length - 1, node + (k.kind === "left" || c === "h" ? -1 : 1))); p.sel = 0; return true; }
      if (c === " ") { rows()[p.sel]?.run?.(); return true; }
      if (c === "+" || c === "-") { rows()[p.sel]?.adjust?.(c === "+" ? 1 : -1); return true; }
      return false;
    },
    clicked: (x, y) => { const n = crumbs.find(h => h.y === y && x >= h.from && x < h.to); if (n) { node = n.i; p.sel = 0; } return !!n; },
    frame: (a, n) => {
      const rect = centred(a, Math.min(76, a.cols - 4), Math.min(a.rows - 4, n + 4));
      let x = rect.col + 2, line = " ";
      crumbs = [];
      nodes().forEach((c, i) => {
        if (i) { line += fg(C.dark) + " › " + RESET; x += 3; }
        crumbs.push({ from: x, to: x + c.label.length, y: rect.row + 1, i });
        line += (i === node ? selected() : fg(C.grey)) + c.label + RESET; x += c.label.length;
      });
      return { rect, title: "policy", foot: "j k pick · ⏎ or a click changes · h l container · + - size · esc", head: [line, ""] };
    },
  });
  return p;
}

/**
 * `/`: the service's search (the one search, `tree.search`) as it's typed, from the desk's current note (nearer
 * notes first), the hits on the left, the one picked read on the right; ⏎ opens it. A pause asks Jev to re-order
 * the same hits, used only if the query and the pick haven't moved, and the picked hit stays picked.
 */
function searchOverlay(d: Desk, q: string): DeskPicker {
  let hits: Msg[] = [], busy = false, timer: Timer | null = null, seq = 0, jev: "asking" | "ranked" | undefined;
  const input = new LineInput(q);
  const near = () => d.current?.id;
  const stop = () => { if (timer) clearTimeout(timer); timer = null; seq++; };
  const askJev = (n: number, t: string) => {
    if (t.length < 3 || hits.length < 2 || jevOff.has(d.ctx.board)) return;
    timer = setTimeout(() => {
      if (n !== seq) return;
      const sel = p.sel, id = hits[sel]?.id;
      jev = "asking"; d.redraw();
      d.ctx.board.search(t, 30, { semantic: true, near: near() }).then(h => {
        if (h.semantic && notConfigured(h.semantic)) jevOff.add(d.ctx.board);
        if (n !== seq) return;
        const at = h.findIndex(m => m.id === id);
        if (p.sel !== sel || hits[sel]?.id !== id || at < 0) { jev = undefined; d.redraw(); return; }
        hits = h; p.sel = at; jev = h.semantic?.status === "ranked" ? "ranked" : undefined; d.redraw();
      }, () => { if (n === seq) { jev = undefined; d.redraw(); } });
    }, SEARCH_JEV_PAUSE_MS);
  };
  const run = () => {
    if (timer) clearTimeout(timer);
    const n = ++seq, t = input.text.trim();
    jev = undefined;
    if (t.length < 2) { hits = []; return; }
    timer = setTimeout(() => {
      busy = true; d.redraw();
      d.ctx.board.search(t, 30, { near: near() }).then(h => { if (n === seq) { hits = h; p.sel = 0; busy = false; d.redraw(); askJev(n, t); } }, () => { busy = false; });
    }, 250);
  };
  const p: ListPicker<Msg, Desk> = new ListPicker<Msg, Desk>({
    name: "search", items: () => hits, input, typed: run,
    row: (m, _i, on, w) => [pickRow(` ${m.props["work-id"] && !subject(m).startsWith(m.props["work-id"]) ? m.props["work-id"] + " " : ""}${subject(m)}`, on, w)],
    // Putting it away stops a pending ask: no Jev call for a search that's gone.
    choose: m => { stop(); d.run("open", { id: m.id }); },
    closed: () => stop(),
    frame: a => {
      const rect: Rect = { col: Math.floor(a.cols * 0.1), row: Math.floor(a.rows * 0.12), cols: Math.floor(a.cols * 0.8), rows: Math.floor(a.rows * 0.72) };
      const w = rect.cols - 2, listW = Math.floor(w * 0.42), m = hits[p.sel];
      return {
        rect, title: "search the board", foot: "↑↓ pick · ⏎ open · esc close",
        head: [paint("|14/ ") + input.show(w - 20) + paint(` ${busy ? "|08searching…" : `|08${hits.length} hit(s)${jev === "ranked" ? " · jev ranked" : jev === "asking" ? " · jev…" : ""}`}`), fg(C.blue) + "─".repeat(w) + RESET],
        side: { w: listW, lines: m ? [fg(C.white) + subject(m) + RESET, ...previewLines(m, w - listW - 3)] : [] },
      };
    },
  });
  if (q) run();
  return p;
}

interface DeskOn { d: Desk; reader?: string }

/** What the desk adds to a reader's note actions: which note is current, and which pane has the keys. */
export const DESK_ACTIONS = actionSet<DeskOn>()("desk", {
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
  "search": def({
    summary: "find notes by text (the service's search): query= answers the hits, numbered from 1, each with its id and title; nothing on screen moves. The person's (/) opens the search overlay, ⏎ there opens the hit (`open`)",
    keys: "/; river column: g",
    touches: "nothing", replay: "safe",
    args: { query: { type: "string", optional: true, about: "the text to find (at least 2 characters)" }, limit: { type: "number", optional: true, about: "how many hits (default 30, at most 100)" } },
    run({ query, limit }, { d }, actor) { return d.searchNotes(query, limit, actor); },
  }),
  "open": def({
    summary: "make a note the desk's current one and show it in tile=<tile name, id or #number> (a detail holds it); or, with from=<tile>, where that tile's opens land (its link; unlinked, where the desk's own open puts it; fresh=true: a new tile there). On a screen whose opens land in a container (the board's readers row), tile=detail is the tile an open lands in there, new-detail a new one, float a new one floating. An agent's naming neither (`ep0ch open <id>`) lands where the focused tile's opens go, else a reader that follows, never one the person is typing in. A program in a tile passes from=$EP0CH_TILE, so it never has to know which reader that is. The person's own open gives that reader the keys, an agent's never moves them", keys: "enter in the outline, / search; ⏎ alt+⏎ in a reader that follows (where its opens land)",
    // A reader named (tile=) is moved: an agent's is refused in the one the person has. Naming none (or a place word),
    // it lands where opens land: maybe the note they're reading, said on screen, never their keys or a reader they type in.
    touches: "tile", touchesWith: (_, tile) => (tile !== undefined ? "tile" : "nothing"), way: "opening a note there would move what they're reading · name another reader with tile=, or name none (ep0ch open <id>): it lands where opens land, never their keys or a reader they type in",
    replay: "safe", confirms: true, places: ["detail", "new-detail", "float"], says: r => `opened a note${r.reader ? ` in ${r.reader}` : ""}`,
    args: { id: { type: "string", about: "the block id" }, from: { type: "string", optional: true, about: "open it as this tile's opens go (its link): the tile a program runs in" }, fresh: { type: "boolean", optional: true, about: "with from=: a new tile where its opens land (alt+⏎)" }, fragment: { type: "string", optional: true, about: "a fragment of the note (^anchor or heading id): the reader scrolls to it and marks it" } },
    async run({ id, from, fresh, fragment }, ctx, actor) {
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
  // The person's open naming no tile, with their keys in a flow (the river's search): the next column, as ⏎ there does.
  if (from === undefined && reader === undefined && actor.kind !== "agent" && d.focusInFlow()) return d.openFrom(id, d.focusedName(), actor, !!fresh);
  return from !== undefined ? d.openFrom(id, from, actor, !!fresh)
    : reader === undefined && actor.kind === "agent" ? d.openLanding(id, actor)
    : d.openIn(id, reader, actor);
}

/** A search hit's body under its title, wrapped: literal-region markers hidden, properties in a region plain (PIE-422). */
function previewLines(m: Msg, w: number): string[] {
  // A draft proposal's hidden patch (`[draft-patch::…]`, PIE-501) is machine data, never shown.
  const body = bodyLinesOf(m.text).filter(l => !/^\s*\[draft-patch::[A-Za-z0-9_-]*\]\s*$/.test(l.text));
  while (body.length && !body[0]!.text.trim()) body.shift();
  while (body.length && !body.at(-1)!.text.trim()) body.pop();
  // Links read as their labels and **bold** as bold, as the reader draws them (no ((uuid|…)) or ** in a preview).
  return body.flatMap(l => (l.text ? wrap(l.literal ? l.text : emphasis(presentLinks(l.text, false, null, m.text)), w, { code: true }) : [""]).map(x => colourBody(x, l.literal)));
}
export { previewLines as searchPreviewLines };
