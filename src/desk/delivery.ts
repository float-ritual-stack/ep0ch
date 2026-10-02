// The delivery board (PIE-511): a screen preset on the desk's one layout engine. Its lanes are query tiles in a
// columns container whose tiles come from data (the hub's views, `hub:<id>`, HUB_SOURCE); the readers row is
// the preview (following the lanes) and the details you open into; the outline tree (with its preview) is a
// drawer on the left and the backlinks (with theirs) a drawer at the bottom: the desk's drawer containers, the
// desk's floats, the desk's borders, spines and policy. What the board adds is its own: moving cards between
// lanes (drag, H L, m, `card.move`), writing new ones, steps, trash, the hub picker, and the lanes' refresh
// from the change feed. Every key and click is an action (BOARD_ACTIONS, and the desk's TILE_ACTIONS).
import type { Ctx, Frame } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import { byOf, USER, type Actor, type Change, type OutlineEvent } from "../socket";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, describeBacklinkView, backlinkOptionsFrom, type BacklinkViewOptions } from "../backlinks";
import { ActionRefused, ActionSet, agentLabel, asActor } from "../surface/actions";
import { Dispatcher, type TileRef } from "../surface/dispatch";
import type { ScreenKeys } from "../whereabouts";
import { draftPreview, leaveSaid, type OpenHow } from "../surface/note";
import { viewSummaryKeys } from "../props";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, NO_PLANNER, planMoves, type MovePlan } from "../move";
import { PROPERTY_KEY_SOURCE } from "../vendor/property-grammar";
import { wheelRows } from "../scroll";
import { Desk } from "./desk";
import { ReaderPane, sessionName, sessionStart, TreePane, type Pane, type SessionKind } from "./panes";
import { PreviewPane } from "./preview";
import { BacklinksPane, BACKLINKS_ACTIONS } from "./backlinks-pane";
import { DetailPane, type LayoutSpec } from "./tiles";
import { columnsOf, drawerOf, leaf, leaves, node, parentOf, serialize, splitOf, visible, type At, type Columns, type Dir, type LNode, type Op, type Policy } from "./screen-layout";
import { TILE_ACTIONS, type TileDone } from "./tile-actions";
import { shellKeyOf } from "../shell-keys";
import { DRAFT_ACTIONS } from "../edit";
import { cardTarget, DraftSession, openDraftOf, type DraftCommand, type LeaveResult } from "../draft-session";
import { editHint, editorClick, openInEditor, renderEditor, writtenBy } from "../surface/editor";
import { completerFor, completerOf } from "../surface/completer";
import { Refused, type ChecklistRead, type ChecklistStep, type CreatePlan, type StepStatus } from "../socket";
import { pickParent, titleOf, type ParentPick } from "./writes";
import { findBoards, hubViews, laneTileName, QueryPane } from "./query";
import type { TileKindName } from "./tile-kinds";

/**
 * The board's detail: a detail tile that says which one it is and whether ⏎ opens into it, or, popped out as a
 * float, the note it holds.
 */
class BoardDetail extends DetailPane {
  floating = false;
  opensHere = false;
  constructor(readonly label: string) { super(); }
  override title(): string {
    if (this.floating) return this.msg ? subject(this.msg) : "float";
    const st = this.surface.state();
    return [this.label.replace(/(\d+)$/, " $1"), this.msg ? "" : "empty", this.opensHere ? "⏎ opens here" : "", st].filter(Boolean).join(" · ");
  }
}

/** A lane: a query tile of the board's hub (its view, cards, cursor and read). */
type Lane = QueryPane;
/** A card pressed in a lane: dragged onto another lane it moves there; released where it was, a click (a second one opens it). */
interface CardDrag { from: number; card: Msg; over: number | null; open: boolean }

/** What delivery.json keeps: the hub shown in each workspace, the lane the cursor was in, and the board's layout (no details or floats). */
interface Saved { hubs?: Record<string, string>; lane?: string; layout?: LayoutSpec }
/**
 * delivery.json as the board wrote it before it was a preset on the desk (6d3f0f6 and earlier): its sizes as
 * shares, the drawers' sides and whether they were pinned, the lanes' weights and folds by lane name, the lane
 * by its place. `migrateOld` gives each its home in the preset.
 */
interface OldSaved {
  laneFrac?: unknown; previewFrac?: unknown; treeFrac?: unknown; linksFrac?: unknown; treeSide?: unknown;
  laneWeights?: unknown; readerWeights?: unknown; treePinned?: unknown; linksPinned?: unknown;
  lane?: unknown; collapsed?: unknown; collapsedReaders?: unknown; hubs?: Record<string, string>;
}
const isOldSaved = (s: object): s is OldSaved => ["laneFrac", "treeFrac", "linksFrac", "treeSide", "laneWeights", "readerWeights", "treePinned", "linksPinned", "collapsed"].some(k => k in s);
const share = (x: unknown, lo: number, hi: number): number | undefined => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined);

const SEL = bg(C.blue) + fg(C.white);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** The tiles every board has, by name (the lanes come from its hub). */
const FIXED = ["tree", "tree-preview", "preview", "backlinks", "backlinks-preview"] as const;
/**
 * The board's fixed shape, as policy (PIE-510, A1): what the desk's one close, move, drop and float path enforces
 * and `layout.policy` reads back, never a rule kept by tile name. The lanes stay where they are (draggable off; a
 * lane closes only when its view goes: the desk's rule for a tile a source supplies), only query tiles join them,
 * and their opens land in the preview.
 */
const LANES_POLICY: Policy = { draggable: false, accepts: ["query"], opensInto: "preview" };
/** The preview's own place (a tab set of one: a tile's policy holder): it stays in the readers row, takes no tabs, and folds instead of closing. */
const PREVIEW_POLICY: Policy = { draggable: false, droppable: false, closable: false };
/** The drawers' lists and their previews stay in their drawers (x shuts the drawer instead: the board's own rule, below). */
const DRAWER_POLICY: Policy = { draggable: false };
/** `n` with the fixed shape's fields it doesn't say yet (a person's own choice, set with layout.policy, is kept). */
const withPolicy = <N extends { policy?: Policy }>(n: N, p: Policy): N => { n.policy = { ...p, ...n.policy }; return n; };

/**
 * The board's screen: the outline drawer (the tree over its preview) on the left, then the lanes over the readers
 * row (the preview, then the details), the backlinks drawer (the list beside its preview) at the bottom.
 */
function boardTree(ids: number[], hub: string | undefined): LNode {
  const [tree, treePv, preview, links, linksPv] = ids as [number, number, number, number, number];
  const outline = withPolicy(splitOf("col", [leaf(tree), leaf(treePv)], [0.6, 0.4], "outline"), DRAWER_POLICY);
  const lanes = columnsOf<number>([], { key: "lanes", ...(hub ? { source: `hub:${hub}` } : {}), policy: { ...LANES_POLICY } });
  const readers = splitOf<number>("row", [{ t: "tabs", ids: [preview], active: 0, policy: { ...PREVIEW_POLICY } }], [4], "readers");
  const backlinks = withPolicy(splitOf("row", [leaf(links), leaf(linksPv)], [0.5, 0.5], "links"), DRAWER_POLICY);
  // The backlinks stay open while a source is read in a detail (stays); the outline slides shut as the keys leave it.
  const board = splitOf<number>("col", [lanes, readers, { t: "drawer", kid: backlinks, edge: "down", open: false, policy: { stays: true } }], [0.42, 0.58, 0.36], "board");
  return splitOf("row", [{ t: "drawer", kid: outline, edge: "left", open: false, policy: { min: 28 } }, board], [0.3, 0.7]);
}

export class DeliveryBoard extends Desk {
  private hub: Msg | null = null;
  /** The lane the cursor is in (its tile): what the board's keys and `card.*` act on when they name no lane. */
  private laneAt: number | null = null;
  /** Which detail ⏎ opens into, by place in the readers row. */
  private active = 0;
  private status = "looking for boards…";
  private hubs: Record<string, string> = {};
  /** The lane named in delivery.json: the cursor goes there once the lanes are read. */
  private wantLane: string | null = null;
  private hubPicker: { items: { hub: Msg; lanes: number }[]; sel: number } | null = null;
  /** Where the hub picker drew each board, for a click. */
  private pickerRows: { i: number; col: number; row: number; cols: number }[] = [];
  /** The move picker (`m`): every lane with what moving the selected card there would patch. */
  private mover: { card: Msg; from: number; plans: MovePlan[] | null; sel: number } | null = null;
  /**
   * The service's move plans for one card at one revision into the lanes as they're defined now, for
   * drawing a drag or the picker without asking on every paint. `plans` is null while they're asked.
   */
  private movePlans: { key: string; plans: Map<string, MovePlan> | null; failed?: boolean } | null = null;
  /** The card a move is patching right now; a second move waits for it. */
  private moving: string | null = null;
  private lastMove: { card: string; to: string; result: string; by?: string } | null = null;
  /** Lanes waiting to be asked again, gathered from change records and read together. */
  private dirtyLanes = new Set<Lane>();
  private reload: Timer | null = null;
  /** How the board has refreshed, for `peek` and tests: whole-board reloads vs lanes asked again. */
  private refreshes = { full: 0, lanes: 0, readers: 0, skipped: 0 };
  /** Names of the lanes asked again, oldest first (tests and `peek`). */
  private asked: string[] = [];
  /** A new card (`n`) or a note under a card (`N`) being written. Holds every key until created or closed. */
  private composer: Composer | null = null;
  /** Where the composer was last drawn, for the mouse. */
  private composerAt: Rect | null = null;
  /** The selected card's checklist steps (`s`): pick one and set its status. */
  private steps: { card: Msg; read: ChecklistRead | null; sel: number; busy: boolean; note: string } | null = null;
  /** The first `d` on a card: a second one within a few seconds trashes it. */
  private trashArm: { id: string; at: number } | null = null;
  /** The last card trashed from the board, until it is restored or another one is: `u` restores it. */
  private trashed: { id: string; title: string; lane: string; children: number; by?: string } | null = null;
  /**
   * Each agent's own selected card (`card.select`), by actor id: what its card actions default to when
   * they name no card. The person's lane cursor, preview and keys are never an agent's to move.
   */
  private agentCards = new Map<string, string>();
  /** The last create, step change, trash or restore, for `peek` and tests. */
  private lastWrite: { what: string; id?: string; result: string; by?: string } | null = null;
  /** A card pressed in a lane, being dragged. */
  private cardDrag: CardDrag | null = null;
  /** The details' names given so far (detail1, detail2…): a name is never given to another reader. */
  private detailCount = 0;

  /** `persist: false`: the layout and the remembered hub stay in memory (the showcase's board). */
  constructor(private readonly hubId?: string, private readonly persist = true) {
    const s = persist ? readState<Saved>("delivery.json") : null;
    const panes: Pane[] = [new TreePane(), new PreviewPane({ tile: "tree" }), new PreviewPane({ tile: "lanes" }), new BacklinksPane("preview"), new PreviewPane({ tile: "backlinks" })];
    super({ title: "board", panes, names: [...FIXED], digits: false, focus: 2, layout: ids => boardTree(ids, hubId) });
    if (s?.hubs && typeof s.hubs === "object") this.hubs = { ...s.hubs };
    if (typeof s?.lane === "string") this.wantLane = s.lane;
    // The board as the person left it (sizes, drawers pinned or shut, lanes folded), if it has the board's shape.
    if (s?.layout && this.boardShaped(s.layout)) {
      try { this.build(s.layout); } catch { /* the preset, below */ }
      if (!FIXED.every(n => this.idNamed(n) !== undefined) || !this.lanesNode()) this.freshLayout();
    } else if (s && !s.layout && typeof s === "object" && isOldSaved(s)) this.migrateOld(s);
    if (hubId) { const c = this.lanesNode(); if (c?.id) this.apply({ op: "source", container: c.id, source: `hub:${hubId}` }); }
    this.fixShape();
    this.focus = this.idNamed("preview") ?? this.focus;
    this.labelReaders();
    // Docked when the board was saved, its drawers slide as they should when put back.
    this.drawerPolicyFor(this.splitId("outline"), { min: 28 });
    this.drawerPolicyFor(this.splitId("links"), { stays: true });
    // The board's own actions before the desk's, through the desk's dispatcher: `tile=` read with the one grammar
    // (the board's older names are its tiles' aliases), `open`'s new-detail and float are where a new reader goes.
    this.dispatch.register([{
      set: BOARD_ACTIONS, takes: "screen",
      // `given` is the step the steps overlay read, for the person's step.set from it (checked against it).
      on: (at, how) => ({ b: this, reader: at.place ?? at.name, shown: (how.given as { shown?: BoardOn["shown"] } | undefined)?.shown }),
      // A card action writes the card it names (or the one selected): the draft rule is asked about that block.
      draftOf: (_, a, actor) => ({ board: this.ctx?.board, blockId: typeof a.card === "string" ? a.card : this.selectedCardOr(actor) }),
    }], true);
  }
  /**
   * An old delivery.json (OldSaved) on the preset: the outline's side and width (its drawer's edge and share), the
   * outline and backlinks pinned (their drawers docked, as tile.pin on=true does), the lanes' and readers' shares
   * of the board, the backlinks' share, the preview folded; the lanes' weights, folds and the lane the cursor was
   * in wait for the lanes (`filled`). What has no home now is dropped: `previewFrac` and `readerWeights` (the
   * details aren't kept; each opens at a detail's width). The next save writes the new shape.
   */
  private migrateOld(o: OldSaved) {
    const board = node(this.root, "board"), outline = node(this.root, "outline");
    if (!board || !outline || !node(this.root, "links")) return;
    const lf = share(o.laneFrac, 0.15, 0.85), tf = share(o.treeFrac, 0.1, 0.6), bf = share(o.linksFrac, 0.1, 0.8);
    const tree = this.idNamed("tree")!, backlinks = this.idNamed("backlinks")!, pv = this.idNamed("preview");
    // Each, the layout's own operation, as the person (what they had): sizes as shares, the outline to its side,
    // the drawers docked, the preview folded. One that doesn't apply is left as the preset has it.
    const op = (x: Op<number>) => { const r = this.ask(x); if (r.ok) this.commit(r); };
    const root = this.root;
    if (root.t === "split" && root.id && tf !== undefined) op({ op: "shares", split: root.id, shares: root.kids.map(k => (k.t === "drawer" ? tf : 1 - tf)) });
    if (board.id && (lf !== undefined || bf !== undefined)) {
      const lanes = lf ?? board.weights[0]! / (board.weights[0]! + board.weights[1]!);
      const back = bf !== undefined ? bf * (1 - lanes) : undefined;
      op({ op: "shares", split: board.id, shares: [lanes, 1 - lanes, back !== undefined ? back / (1 - back) : board.weights[2]!] });
    }
    if (o.treeSide === "right" && outline.id) op({ op: "pin", tile: tree, on: false, edge: "right", container: outline.id });
    if (o.treePinned === true) op({ op: "pin", tile: tree, on: true });
    if (o.linksPinned === true) op({ op: "pin", tile: backlinks, on: true });
    if (Array.isArray(o.collapsedReaders) && o.collapsedReaders.includes("preview") && pv !== undefined) op({ op: "collapse", tile: pv, on: true });
    const weights: Record<string, number> = {};
    if (o.laneWeights && typeof o.laneWeights === "object" && !Array.isArray(o.laneWeights)) for (const [k, v] of Object.entries(o.laneWeights)) { const w = typeof v === "number" && v > 0 ? share(v, 0.2, 5) : undefined; if (k.trim() && w !== undefined) weights[laneTileName(k)] = w; }
    const folded = Array.isArray(o.collapsed) ? o.collapsed.filter((x): x is string => typeof x === "string").map(laneTileName) : [];
    this.oldLanes = { weights, folded, ...(typeof o.lane === "number" && Number.isInteger(o.lane) && o.lane >= 0 ? { lane: o.lane } : {}) };
  }
  /**
   * A board saved before its fixed shape was policy (PIE-510): its lanes, its drawers' lists and its preview get
   * the fields boardTree gives them, where they don't say them already; a bare preview gets its own place.
   */
  private fixShape() {
    const pv = this.idNamed("preview");
    this.relayout(root => {
      const lanes = node(root, "lanes"), outline = node(root, "outline"), links = node(root, "links");
      if (lanes?.t === "columns") withPolicy(lanes, LANES_POLICY);
      if (outline) withPolicy(outline, DRAWER_POLICY);
      if (links) withPolicy(links, DRAWER_POLICY);
      // Only a preview in the readers row (a tab set it shares keeps its own rules: its other tabs close).
      const row = node(root, "readers"), at = pv !== undefined ? parentOf(root, pv) : null, k = at?.parent === row ? row?.kids[at!.i] : undefined;
      if (k?.t === "leaf") row!.kids[at!.i] = { t: "tabs", ids: [k.id], active: 0, policy: { ...PREVIEW_POLICY } };
      else if (k?.t === "tabs" && k.ids.length === 1) withPolicy(k, PREVIEW_POLICY);
      return root;
    });
  }
  /** An old delivery.json's lanes (`migrateOld`): applied when the lanes are first filled, then forgotten. */
  private oldLanes: { weights: Record<string, number>; folded: string[]; lane?: number } | null = null;
  /** The board's readers say what they follow: the lanes, the outline, the backlinks. */
  private labelReaders() {
    const say: [string, string][] = [["preview", "preview · follows the board"], ["tree-preview", "follows the outline"], ["backlinks-preview", "follows the backlinks"]];
    for (const [n, l] of say) { const p = this.panes.get(this.idNamed(n) ?? -1); if (p instanceof PreviewPane) p.label = l; }
  }

  /** The board as it first opens (a saved layout that didn't come back whole is put aside). */
  private freshLayout() {
    this.startOver([new TreePane(), new PreviewPane({ tile: "tree" }), new PreviewPane({ tile: "lanes" }), new BacklinksPane("preview"), new PreviewPane({ tile: "backlinks" })], FIXED, ids => boardTree(ids, this.hubId));
    this.labelReaders();
  }

  /** A saved layout the board can come back to: its fixed tiles by name, its lanes and its readers row. */
  private boardShaped(spec: LayoutSpec): boolean {
    const names = new Set<string>(), keys = new Set<string>();
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (n.t === "leaf") { if (typeof n.name === "string") names.add(n.name); return; }
      if (typeof n.key === "string") keys.add(n.key);
      for (const k of [...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid, n.a, n.b]) walk(k);
    };
    walk(spec.root);
    return FIXED.every(n => names.has(n)) && keys.has("lanes") && keys.has("readers");
  }

  /** Write delivery.json: the hubs, the lane, and the layout without the details and floats (they're opened, not kept). */
  protected override save() {
    if (!this.persist) return;
    // The details and floats are opened, not kept; the lanes' source is the hub shown (`useHub` set it).
    const layout: LayoutSpec | undefined = { root: serialize(this.layout, id => this.specOf(id), id => this.panes.get(id) instanceof DetailPane).root };
    writeState("delivery.json", { hubs: this.hubs, ...(this.laneTile() ? { lane: this.laneTile()!.name } : {}), ...(layout ? { layout } : {}) } satisfies Saved);
  }

  // ── what the board is made of, found in the layout ────────────────────────

  private named<P extends Pane>(name: string): P { return this.panes.get(this.idNamed(name)!) as P; }
  private get preview(): PreviewPane { return this.named("preview"); }
  private get outline(): TreePane { return this.named("tree"); }
  private get treePreview(): PreviewPane { return this.named("tree-preview"); }
  private get linksTile(): BacklinksPane { return this.named("backlinks"); }
  private get linksPreview(): PreviewPane { return this.named("backlinks-preview"); }
  /** The columns the lanes are in. */
  private lanesNode(): Columns<number> | null { return this.columnsIn().find(c => c.key === "lanes") ?? null; }
  /** The board's lanes (its hub's query tiles), in the columns' order; one moved out of them after. */
  private laneIds(): number[] { const c = this.lanesNode(); return c ? this.sourcedIn(c).filter(id => this.panes.get(id) instanceof QueryPane) : []; }
  private get lanes(): Lane[] { return this.laneIds().map(id => this.panes.get(id) as Lane); }
  /** The lane the cursor is in, by place. */
  private get lane(): number { const ids = this.laneIds(); const i = this.laneAt === null ? -1 : ids.indexOf(this.laneAt); return Math.max(0, i); }
  private set lane(i: number) {
    const ids = this.laneIds(), had = this.onLanes;
    this.laneAt = ids[clamp(i, 0, Math.max(0, ids.length - 1))] ?? null;
    // The lanes' keys go with the cursor: the lane it's in is the tile with the keys.
    if (had && this.laneAt !== null) this.focus = this.laneAt;
    this.markCurrent();
  }
  private laneTile(): Lane | undefined { return this.lanes[this.lane]; }
  /** Each lane knows whether the cursor is in it (its frame is brighter). */
  private markCurrent() { const ids = this.laneIds(); ids.forEach((id, i) => { (this.panes.get(id) as Lane).current = i === this.lane; }); }
  /** The lanes have the keys (the lane the cursor is in). */
  private get onLanes(): boolean { return this.laneIds().includes(this.focus); }
  private isLane(id: number) { return this.laneIds().includes(id); }
  /** The details, in the readers row's order. */
  private detailTiles(): { id: number; pane: ReaderPane }[] {
    const row = node(this.root, "readers");
    return (row ? leaves(row) : []).filter(id => this.panes.get(id) instanceof DetailPane).map(id => ({ id, pane: this.panes.get(id) as ReaderPane }));
  }
  /** The details' readers, in the row's order. */
  private get details(): ReaderPane[] { return this.detailTiles().map(d => d.pane); }
  private readers(): ReaderPane[] { return [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane); }
  /** The outline drawer is open (or pinned into the layout). */
  private get treeOpen(): boolean { return visible(this.root).includes(this.idNamed("tree")!); }
  private get treePinned(): boolean { return !drawerOf(this.root, this.idNamed("tree")!); }
  private get treeSide(): "left" | "right" {
    const d = drawerOf(this.root, this.idNamed("tree")!);
    if (d) return d.edge === "right" ? "right" : "left";
    const rects = this.rectsNow(), t = rects.get(this.idNamed("tree")!), p = rects.get(this.idNamed("preview")!);
    return t && p && t.col > p.col ? "right" : "left";
  }
  /** The backlinks drawer is open (or pinned): it lists what a reader's note is linked from. */
  private get linksOpen(): boolean { return visible(this.root).includes(this.idNamed("backlinks")!); }
  private get linksPinned(): boolean { return !drawerOf(this.root, this.idNamed("backlinks")!); }

  /** Where the focus is, as `peek` says it: "lanes", or the tile's name (preview, detail2, tree, backlinks…). */
  private focusName(): string { return this.onLanes ? "lanes" : this.nameOf(this.focus); }

  /** The person's keys to the lanes (the lane the cursor is in). */
  private toLanes() { const id = this.laneIds()[this.lane]; if (id !== undefined) { this.focus = id; this.entered.clear(); } }

  // ── data ───────────────────────────────────────────────────────────────────

  override enter(ctx: Ctx) {
    const again = !!this.ctx;
    // Lanes restored with the layout are the board's to read (once the hub fills them), not each its own.
    if (!again) for (const id of leaves(this.lanesNode() ?? leaf(-1))) { const p = this.panes.get(id); if (p instanceof QueryPane) p.managed = true; }
    super.enter(ctx);
    if (again) return;
    void this.chooseStart();
  }

  /** The hub to show first: the one named, the one remembered here, Delivery Flow, the only one, or the picker. */
  private async chooseStart() {
    const ctx = this.ctx;
    try {
      const remembered = this.hubId ?? this.hubs[ctx.workspace];
      const hub = remembered ? await ctx.board.get(remembered) : null;
      if (hub) return this.useHub(hub);
      const found = await findBoards(ctx.board);
      const df = found.find(f => subject(f.hub) === "Delivery Flow");
      if (df || found.length === 1) return this.useHub((df ?? found[0]!).hub);
      if (!found.length) { this.status = "no hub with virtual-branch children here; pass --board <block-id>"; return this.redraw(); }
      this.hubPicker = { items: found, sel: 0 };
      this.status = "";
    } catch (e) { this.status = String((e as Error).message); }
    this.redraw();
  }

  /** Show `hub`'s board: its views become the lanes (the columns' source), each asked for its cards. */
  private async useHub(hub: Msg) {
    this.hub = hub; this.hubPicker = null;
    this.hubs[this.ctx.workspace] = hub.id;
    this.title = `board · ${subject(hub)}`;
    const c = this.lanesNode();
    if (!c) { this.status = "the board's lanes are missing from its layout"; return this.redraw(); }
    const was = c.source, onLanes = this.onLanes;
    this.apply({ op: "source", container: c.id!, source: `hub:${hub.id}` });
    if (was !== `hub:${hub.id}`) this.laneAt = null;
    // The columns as the layout has them now (each operation answers a new state: `c` was the one before it).
    await this.fillColumns(this.lanesNode() ?? undefined);
    // The person was on the lanes: they're on the new board's (its old lanes were closed under them).
    if (onLanes && !this.personTyping()) this.toLanes();
    this.status = "";
    this.save();
    this.redraw();
  }

  /** A lane the hub supplied: the board refreshes it (precisely, from the change feed) and draws its hint. */
  protected override sourcedTile(_id: number, p: Pane) {
    if (!(p instanceof QueryPane)) return;
    p.managed = true;
    p.boardHint = "c collapse · H L move";
    p.loaded = q => { if (q === this.laneTile()) this.follow(); };
  }

  /** The lanes were filled (a hub shown, a view added or renamed): each is asked for its cards. */
  protected override filled(c: Columns<number>, title?: string) {
    if (c !== this.lanesNode() && c.key !== "lanes") return;
    if (title && this.hub) this.title = `board · ${title}`;
    const ids = this.laneIds();
    if (this.oldLanes && ids.length) {
      const o = this.oldLanes;
      this.oldLanes = null;
      // The columns as they are in the tree now (filling laid the tree out again).
      const now = this.lanesNode();
      if (now?.id) this.apply({ op: "fill", container: now.id, order: leaves(now), weights: leaves(now).filter(id => o.weights[this.nameOf(id)] !== undefined).map(id => [id, o.weights[this.nameOf(id)]!] as [number, number]) });
      for (const id of ids) if (o.folded.includes(this.nameOf(id))) { const r = this.ask({ op: "collapse", tile: id, on: true }); if (r.ok) this.commit(r); }
      if (o.lane !== undefined && ids[o.lane] !== undefined && this.laneAt === null) this.wantLane = this.nameOf(ids[o.lane]!);
      this.save();
    }
    if (this.laneAt === null || !ids.includes(this.laneAt)) {
      const want = this.wantLane ? this.lanes.findIndex(l => l.name === this.wantLane) : -1;
      this.wantLane = null;
      this.laneAt = ids[Math.max(0, want)] ?? null;
    }
    this.markCurrent();
    // The person starts on the lanes (unless they went elsewhere meanwhile).
    if (this.focus === this.idNamed("preview") && !this.personTyping() && this.laneAt !== null) this.focus = this.laneAt;
    this.loadLanes();
  }

  private loadLanes(which: Lane[] = this.lanes) {
    if (which === this.lanes || which.length === this.lanes.length) this.refreshes.full++; else this.refreshes.lanes += which.length;
    this.asked.push(...which.map(l => l.name));
    if (this.asked.length > 200) this.asked.splice(0, 100);
    for (const l of which) void l.load(this);
  }

  override onEvent(e: OutlineEvent) {
    // The tiles but the readers and lanes hear it (the tree, the backlinks); the hub's views refill the lanes.
    this.hear(e, p => p instanceof ReaderPane || p instanceof QueryPane);
    if (e.action === "reset") return this.reloadAll();
    if (e.action === "reconnected") {
      // Caught up; lanes that failed while the service was away are asked again.
      const failed = this.lanes.filter(l => l.read?.status === "failed" || !l.read);
      if (failed.length) this.loadLanes(failed);
      for (const r of this.readers()) r.retry(this);           // so are notes still waiting for their whole text
      return;
    }
    if (!e.change) return this.legacyEvent(e);
    this.changed(e.change, e);
  }

  /** A service without a change feed: the board reloads every lane shortly after any change. */
  private legacyEvent(e: OutlineEvent) {
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => this.loadLanes(), 1200);
    for (const r of this.readers()) r.onEvent(this);   // comment counts and threads
    // Any open reader showing the changed block re-reads it in place.
    const id = e.blockId;
    if (id && this.readers().some(r => r.msg?.id === id))
      this.ctx.board.get(id).then(m => { if (m) { for (const r of this.readers()) r.refresh(m); this.redraw(); } }, () => {});
  }

  /** Everything again: after a reconnect the door couldn't catch up on. Drafts are kept, only marked. */
  private reloadAll() {
    if (this.reload) clearTimeout(this.reload);
    if (this.hub) this.loadLanes();
    for (const r of this.readers()) {
      const m = r.msg;
      if (!m || m.id.startsWith("file:")) continue;
      this.ctx.board.get(m.id).then(n => { if (n) { r.refresh(n); this.redraw(); } }, () => {});
      void r.loadComments(this);
    }
  }

  /**
   * One committed change (PIE-399): refresh only what it can affect.
   *   - a reader showing the block re-reads it, unless it already has that revision (the door's own save);
   *     either way an edit re-reads the note's comments, whose quoted passages may have moved;
   *     a reader with a draft is only marked "changed elsewhere", never replaced;
   *   - a comment or reply re-reads the threads of the note it belongs to, nowhere else;
   *   - a lane is asked again when the block is in it, or could now be: the service's move plan for it into
   *     that lane is "already" (membership itself always comes from the service);
   *   - a reorder (Tree, `domain: "view"`) re-asks only the lane it names;
   *   - a view added, renamed or taken off the hub fills the lanes again (the hub source, through the desk);
   *   - a moved, trashed or restored block can take a subtree with it, and `other` has no one block:
   *     every lane.
   */
  private changed(c: Change, e: OutlineEvent) {
    const id = c.blockId;
    // An open steps overlay shows the note's checklist: a change to that note reads it again.
    const S = this.steps;
    if (S && id === S.card.id && !S.busy && (c.revision === undefined || c.revision !== S.read?.revision)) {
      this.ctx.board.checklist(id).then(r => {
        if (this.steps !== S || S.busy || (S.read && r.revision < S.read.revision)) return;
        S.read = r; S.sel = clamp(S.sel, 0, Math.max(0, r.items.length - 1)); this.redraw();
      }, () => {});
    }
    for (const r of this.readers()) {
      const m = r.msg;
      if (!m) continue;
      // A change it hasn't seen, or a trash, restore or purge (its own card's, or an ancestor's): NoteSurface.staleOn,
      // as every reader asks. The door's own save is current: only its comments below need their new offsets.
      if (r.surface.staleOn(e)) { this.refreshes.readers++; r.reread(this); }
      else if (id && m.id === id) this.refreshes.skipped++;
      const thread = (r.comments ?? []).some(t => t.id === c.parentId || t.id === id || t.replies.some(x => x.id === id));
      if (c.kind === "annotate" && (m.id === c.parentId || thread)) r.onEvent(this);
      else if (id && m.id === id && c.kind === "edit") r.onEvent(this);   // an edit can move or drop a quoted passage
    }
    if (!this.hub || c.kind === "annotate" || c.kind === "draft") return;
    // A reorder (made in Tree) changes one lane's ranks; its record names the lane, whose parent is the hub.
    if (c.kind === "reorder") return this.markLanes(this.lanes.filter(l => l.view === id));
    // A view added, renamed or taken away under the hub: the hub source fills the lanes again (and reads them).
    if (c.parentId === this.hub.id || c.previousParentId === this.hub.id) return;
    if (!id || c.kind === "other" || c.kind === "move" || c.kind === "delete" || c.kind === "restore" || c.kind === "purge") return this.markLanes(this.lanes);
    const own = this.lanes.filter(l => l.view === id);
    if (own.length) return this.markLanes(own);                       // a lane's definition or its ranks changed
    const members = this.lanes.filter(l => l.items?.some(m => m.id === id));
    // Which other lanes it's in now is the service's answer: a plan that's "already" there.
    const ready = this.lanes.filter(l => !members.includes(l) && l.read?.status === "ready");
    if (!ready.length) return this.markLanes(members);
    this.ctx.board.planMoves(ready.map(l => l.view), id).then(r => {
      this.markLanes(r ? [...members, ...ready.filter(l => r.plans.get(l.view)?.kind === "already")] : this.lanes);
    }, () => this.markLanes(this.lanes));
  }

  /** The lanes (other than `except`) the service says `card` is in now. */
  private async lanesHolding(card: Msg, except: number): Promise<string[]> {
    const others = this.lanes.filter((l, i) => i !== except && l.read?.status === "ready");
    if (!others.length) return [];
    const r = await this.ctx.board.planMoves(others.map(l => l.view), card.id).catch(() => null);
    return r ? others.filter(l => r.plans.get(l.view)?.kind === "already").map(l => l.name) : [];
  }

  /**
   * The service's plan for moving `card` into lane `l`, for drawing: from the plans asked for this card
   * at this revision and these lane definitions, or null while they're being asked (the first call asks).
   */
  private cachedPlan(card: Msg, l: Lane): MovePlan | null {
    const key = `${card.id}@${card.revision}|${this.lanes.map(x => `${x.view}@${x.def?.revision}`).join(",")}`;
    if (this.movePlans?.key !== key) {
      const entry: NonNullable<DeliveryBoard["movePlans"]> = { key, plans: null };
      this.movePlans = entry;
      const views = this.lanes.map(x => x.view);
      planMoves(this.ctx.board, card, views).then(
        plans => { entry.plans = plans; this.redraw(); },
        // Said for the rest of this drag only: the next drag asks again (a timeout or a dropped socket passes).
        (e: Error) => { entry.failed = true; entry.plans = new Map(views.map(v => [v, { kind: "refused" as const, reason: e.message }])); this.redraw(); },
      );
    }
    return this.movePlans.plans?.get(l.view) ?? null;
  }

  private markLanes(lanes: Lane[]) {
    if (!lanes.length) { this.refreshes.skipped++; return; }
    for (const l of lanes) this.dirtyLanes.add(l);
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => {
      const which = this.lanes.filter(l => this.dirtyLanes.has(l));
      this.dirtyLanes.clear();
      if (which.length) this.loadLanes(which.length === this.lanes.length ? this.lanes : which);
    }, 150);
  }

  override unsaved() { return super.unsaved() || !!this.composer?.session.dirty; }
  /**
   * Screen.holdsKeys: the person's keys are the board's own business right now: the desk's (an edit, a comment
   * or the property panel they're in, a filter, a ^W command), a new card or note being written, the mover or
   * steps overlay, or the hub picker. An agent doesn't move the person's screen then (the actor rule, PIE-514).
   */
  override personTyping(): boolean {
    return super.personTyping() || this.readers().some(r => r.surface.choosing && !this.collapsed.has(this.idOf(r) ?? -1))
      || !!this.composer || !!this.steps || !!this.mover || !!this.hubPicker;
  }
  override keepDrafts() {
    const c = this.composer;
    return [...super.keepDrafts(), ...(c?.session.dirty ? [c.session.keep()] : [])];
  }
  override dispose() { if (this.reload) clearTimeout(this.reload); return super.dispose(); }

  /** A lane's `[summary-properties::…]` decides the summary for the cards it lists (the selected lane first). */
  summaryKeys(m: Msg): readonly string[] | null {
    const lane = [this.laneTile(), ...this.lanes].find(l => l?.items?.some(x => x.id === m.id));
    return viewSummaryKeys(lane?.def ?? undefined);
  }

  override openBlock(m: Msg, by: Actor = USER) { this.current = m; this.openDetail(m, false, by); }

  // ── actions: what the keys do, by name, for agents (`ep0ch act`) ─────

  /**
   * The tiles as `tile=` reads them: the desk's, with the names agents used for the board's readers before it was a
   * preset as aliases (`detail`, the one ⏎ opens into; `float`, the top one; `lanes`, the lane the cursor is in; for a
   * note action, `tree` and `backlinks` are the drawers' previews). A reader that isn't on screen (a shut drawer's) or
   * is folded to a spine is read-only to a note action: it would change a note where the person can't see it.
   */
  protected override tiles(): TileRef[] {
    const more = new Map<string, string[]>();
    const add = (alias: string, name: string | undefined) => { if (name && name !== alias) more.set(name, [...(more.get(name) ?? []), alias]); };
    for (const a of ["detail", "float", "lanes"]) add(a, this.alias(a));
    add("tree", "tree-preview"); add("backlinks", "backlinks-preview");
    const shut = (name: string) => (name.startsWith("tree") ? "t opens the outline drawer" : name.startsWith("backlinks") ? "b opens a reader's backlinks" : "focus it");
    return super.tiles().map(t => {
      const reader = this.paneNamed(t.name) instanceof ReaderPane, drawer = t.name === "tree" || t.name === "backlinks";
      const readOnly = t.readOnly ?? (!t.shown && reader ? `${t.name} isn't on screen; open it first (${shut(t.name)})`
        : !t.shown && drawer ? (t.name === "tree" ? "the outline drawer is shut; t opens it" : "no backlinks drawer is open; b opens it on a reader's note") : null);
      const aliases = [...(t.aliases ?? []), ...(more.get(t.name) ?? [])];
      return { ...t, ...(aliases.length ? { aliases } : {}), ...(readOnly ? { readOnly } : {}) };
    });
  }

  /**
   * The names agents used for the board's readers before the board was a preset: `detail` (the one ⏎ opens
   * into), `float` (the top one), `lanes` (the lane the cursor is in); and for a note action, `tree` and
   * `backlinks` are the drawers' previews.
   */
  private alias(sel: string | undefined, note = false): string | undefined {
    if (sel === "detail") return this.detailTiles()[this.active] ? this.nameOf(this.detailTiles()[this.active]!.id) : sel;
    if (sel === "float") return this.floats.length ? this.nameOf(this.floats.at(-1)!.id) : sel;
    if (sel === "lanes") return this.laneTile() ? this.nameOf(this.laneIds()[this.lane]!) : sel;
    if (note && (sel === "tree" || sel === "backlinks")) return `${sel}-preview`;
    return sel;
  }

  /** Every reader by the name an agent uses: preview, detail1…, the drawers' previews, a float. */
  private boardReaders(): { name: string; id: number; pane: ReaderPane; shown: boolean }[] {
    const shownNow = new Set([...visible(this.root), ...this.floats.map(f => f.id)]);
    return this.all().filter(id => this.panes.get(id) instanceof ReaderPane).map(id => ({ name: this.nameOf(id), id, pane: this.panes.get(id) as ReaderPane, shown: shownNow.has(id) }));
  }

  /**
   * The reader the board puts a note in or acts on: by its name (the dispatcher read `tile=`), or `detail`, `float`
   * (the board's own words for its places). No name: the focused reader, or the preview when the lanes have focus.
   * A drawer's preview while its drawer is shut is refused: an action there would change a note the person can't see.
   */
  private pickBoardReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.boardReaders();
    const s = this.alias(sel, true);
    const r = !s || s === "focused" ? all.find(x => x.id === this.focus) ?? all.find(x => x.name === "preview") : all.find(x => x.name === s);
    if (!r) throw new ActionRefused(`no reader ${sel} on the board; readers: ${all.map(x => x.name).join(", ")}, focused, or a block id`);
    if (!r.shown) throw new ActionRefused(`${r.name} isn't on screen; open it first (${r.name.startsWith("tree") ? "t opens the outline drawer" : r.name.startsWith("backlinks") ? "b opens a reader's backlinks" : "focus it"})`);
    return r;
  }

  /** `open`: put a note in a reader — the preview (selecting its card when a lane lists it), a detail, a new detail, or a new float. */
  async openOnBoard(id: string, where = "detail", actor: Actor = USER): Promise<{ reader: string; id: string; why?: string }> {
    // A card the lanes list, or a note a reader shows, opens at once (the person's ⏎ on it); any other is read first.
    const known = this.lanes.flatMap(l => l.items ?? []).find(x => x.id === id) ?? this.readers().find(r => r.msg?.id === id)?.msg;
    const m = known ?? await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    this.current = m;
    // An open gives the reader it opened the keys, unless the person is in an edit, a comment or the property
    // panel (that keeps them), or it's an agent's: an agent never moves them, whatever reader it names.
    const keep = actor.kind === "agent" || !!this.personIn();
    let shown: ReaderPane | null = null;
    if (where === "preview") {
      // Selecting its card is the lanes moving; shown without one, it's an open into the preview (PIE-453).
      if (!this.selectCard(m.id, false)) this.preview.surface.track(() => this.preview.show(m, this));
      if (this.preview.msg?.id !== m.id) throw new ActionRefused("the preview is holding an edit or a comment on another note");
      if (!keep) this.focus = this.idNamed("preview")!;
      shown = this.preview;
    } else if (where === "detail" || where === "new-detail") {
      if (!this.openDetail(m, where === "new-detail", actor) || this.detailTiles()[this.active]?.pane.msg?.id !== m.id) {
        // A locked board (or one whose readers row was taken apart) opens no detail: the note is in the preview, said so.
        const locked = this.noReadersRow("opening a detail") ?? this.detailRefusal(actor);
        if (locked && this.preview.msg?.id === m.id) return { reader: "preview", id: m.id, why: locked };
        throw new ActionRefused(locked ?? "both details hold edits, comments or properties, or the person is in one · save or close one first");
      }
      shown = this.detailTiles()[this.active]!.pane;
    } else if (where === "float") {
      const pane = shown = this.floatNote(m, actor);
      if (!keep) this.focus = this.idOf(pane)!;
    } else {
      const r = this.pickBoardReader(where);
      if (!r.pane.surface.track(() => r.pane.show(m, this))) throw new ActionRefused(`${r.name} is holding an edit or a comment on another note`);
      if (!keep) this.focus = r.id;
      shown = r.pane;
    }
    const sid = this.idOf(shown ?? undefined);
    if (sid !== undefined && this.collapsed.has(sid)) { this.unfoldTile(sid); this.save(); }   // a note opened into a spine is meant to be seen
    this.entered.follow(this.focusedReader());
    this.redraw();
    const r = this.boardReaders().find(x => x.pane === shown) ?? this.boardReaders().find(x => x.pane.msg?.id === m.id);
    return { reader: r?.name ?? where, id: m.id };
  }

  /** A new float holding `m` (a copy of what the preview shows, or a note an agent opened as a float). */
  private floatNote(m: Msg, actor: Actor): ReaderPane {
    // A float is a new tile: a locked screen keeps its shape (the layout's rule for every open).
    return this.newDetail(m, { kind: "float", near: this.idNamed("preview")! }, actor);
  }
  /** A new detail holding `m` at `at` (the readers row, or a float), by the layout's open for `actor`: refused there, nothing made. */
  private newDetail(m: Msg | null, at: At<number>, actor: Actor): BoardDetail {
    const name = `detail${this.detailCount + 1}`;
    // Where the keys go is the board's to say after (its open, its float): the new detail doesn't take them here.
    const r = this.ask({ op: "open", tile: this.nextTileId(), kind: "detail", name, loose: true, at, keys: false }, actor);
    if (!r.ok) throw new ActionRefused(r.refused);
    this.detailCount++;
    const pane = new BoardDetail(name);
    const id = this.put(pane);
    this.commit(r);
    this.startTile(id);
    if (m) pane.hold(m, this);
    return pane;
  }
  /** Why the readers row takes no new detail now (a lock over it), in the layout's words, or null. */
  private detailRefusal(actor: Actor): string | null {
    const r = this.ask({ op: "open", tile: this.nextTileId(), kind: "detail", name: `detail${this.detailCount + 1}`, loose: true, at: { kind: "in", key: "readers", weight: this.detailWeight() } }, actor);
    return r.ok ? null : r.refused;
  }
  /** Tile `id` opened from its spine (a note is meant to be seen there), as the person's own. */
  private unfoldTile(id: number) { const r = this.ask({ op: "collapse", tile: id, on: false }); if (r.ok) this.commit(r); }

  /** Whether `sel` names the area that has the keys now. */
  focusedIs(sel: string): boolean {
    if (sel === "lanes") return this.onLanes;
    try { return this.pickBoardReader(sel).id === this.focus; } catch { return this.alias(sel) === this.nameOf(this.focus); }
  }

  /** `focus`: which area keys go to — "lanes", a reader, the tree, the backlinks, a lane by its tile's name. */
  override focusOn(sel: string): { focus: string } {
    const was = this.focus;
    if (sel === "lanes") this.toLanes();
    else {
      // A tile by name (a lane, the tree, a reader), else a reader by what it shows (a block id).
      const t = this.tileNamed(this.alias(sel), false) ?? (() => { const r = this.pickBoardReader(sel); return { name: r.name, id: r.id }; })();
      if (!visible(this.root).includes(t.id) && !this.isFloat(t.id)) throw new ActionRefused(`${t.name} isn't open`);
      this.focusTile(t.name, USER);
      if (this.isLane(t.id)) this.laneAt = t.id, this.markCurrent();
      const di = this.detailTiles().findIndex(d => d.id === t.id);
      if (di >= 0) this.active = di;
    }
    // The person comes back to a session by moving to it: they enter it again with e or ⏎. Focusing the
    // reader they're already in moves nothing, so they stay in it.
    if (this.focus !== was) this.entered.clear();
    this.redraw();
    return { focus: this.focusName() };
  }

  /** Select a card in the lanes (the preview follows). False when no loaded lane lists it. */
  selectCard(id: string, focus = true): boolean {
    const i = this.lanes.findIndex(l => l.items?.some(m => m.id === id || (id.length >= 8 && m.id.startsWith(id))));
    if (i < 0) return false;
    const l = this.lanes[i]!;
    this.lane = i; l.sel = l.items!.findIndex(m => m.id === id || m.id.startsWith(id));
    if (focus) this.toLanes();
    this.follow(); this.redraw();
    return true;
  }

  // ── the person's keys and clicks run the board's actions (PIE-506): the same code as `act` ──

  /** A board action as the person; a refusal is said on the status bar. */
  private runBoard<K extends Parameters<typeof BOARD_ACTIONS.run>[0]>(name: K, args: Parameters<typeof BOARD_ACTIONS.run<K>>[1], reader?: string, extra: Partial<BoardOn> = {}): Promise<unknown> {
    // A move says its own refusal as it lands ("not moved: …", "can't move to …"); the rest are said here.
    return this.dispatch.pressIn(BOARD_ACTIONS, name, args as Record<string, unknown>, reader, name === "card.move", extra.shown ? { shown: extra.shown } : undefined);
  }
  /** A tile action (TILE_ACTIONS) as the person, on the tile named as `peek` names it. */
  private tileAct<K extends Parameters<typeof TILE_ACTIONS.run>[0]>(name: K, args: Parameters<typeof TILE_ACTIONS.run<K>>[1], reader: string) {
    void this.dispatch.pressIn(TILE_ACTIONS, name, args as Record<string, unknown>, reader);
  }
  /** The shell's action (screen.back, video.cycle), as on every screen. */
  private shellKey(name: "screen.back" | "video.cycle") { shellKeyOf(name, this, this.ctx); }

  /** `card.select`: by id, or a step from the selection (the person's cursor, or an agent's own selection). */
  selectBy(a: { id?: string; lane?: string; by?: number; lanes?: number; focus?: boolean }, actor: Actor): unknown {
    const steps = a.by !== undefined || a.lanes !== undefined;
    if (a.id === undefined && !steps && a.lane === undefined) throw new ActionRefused("card.select takes id, or a step from the selection (by, lanes, lane)");
    if (a.id !== undefined && steps) throw new ActionRefused("card.select takes id, or a step (by, lanes), not both");
    const lanes = this.lanes;
    const named = (n: string) => { const i = lanes.findIndex(l => l.name.toLowerCase() === n.toLowerCase()); if (i < 0) throw new ActionRefused(`no lane ${n}; lanes: ${lanes.map(l => l.name).join(", ")}`); return i; };
    if (a.id !== undefined) {
      if (actor.kind === "agent") return this.selectForAgent(a.id, actor);
      const at = a.lane !== undefined ? named(a.lane) : -1;
      if (at >= 0) {
        const l = lanes[at]!, i = l.items?.findIndex(m => m.id === a.id || (a.id!.length >= 8 && m.id.startsWith(a.id!))) ?? -1;
        if (i < 0) throw new ActionRefused(`${l.name} doesn't list ${a.id}`);
        this.lane = at; l.sel = i; this.toLanes(); this.follow(); this.save(); this.redraw();
        return { selected: l.items![i]!.id, lane: l.name };
      }
      if (!this.selectCard(a.id)) throw new ActionRefused(`no lane on the board lists ${a.id}`);
      return { selected: a.id };
    }
    if (!lanes.length) throw new ActionRefused("the board has no lanes yet");
    // Where the step starts: an agent's own selection (else the person's cursor), never moving the person's.
    let lane = this.lane, sel = lanes[lane]?.sel ?? 0;
    if (actor.kind === "agent") {
      const own = this.agentCards.get(actor.id);
      const at = own ? lanes.findIndex(l => l.items?.some(m => m.id === own)) : -1;
      if (at >= 0) { lane = at; sel = lanes[at]!.items!.findIndex(m => m.id === own); }
    }
    // Moved to another lane (lane=, lanes=): the person's step starts at that lane's cursor, an agent's at its top.
    const moveTo = (to: number) => { if (to !== lane) { lane = to; sel = actor.kind === "agent" ? 0 : lanes[to]!.sel; } };
    if (a.lane !== undefined) moveTo(named(a.lane));
    moveTo(clamp(lane + (a.lanes ?? 0), 0, lanes.length - 1));
    const l = lanes[lane]!, n = l.items?.length ?? 0;
    sel = clamp(sel + (a.by ?? 0), 0, Math.max(0, n - 1));
    if (actor.kind === "agent") {
      const card = l.items?.[sel];
      if (!card) throw new ActionRefused(`${l.name} has no cards to select`);
      return this.selectForAgent(card.id, actor);
    }
    l.sel = sel;
    // focus=false (the wheel over a lane): that lane's cursor moves; the current lane and the keys stay.
    if (a.focus !== false) { this.lane = lane; this.toLanes(); }
    if (lane === this.lane) this.follow();
    this.save(); this.redraw();
    return { lane: l.name, selected: l.items?.[sel]?.id ?? null };
  }

  /** `board.hub`: the hubs (the person's opens the picker), or show the one named. */
  async chooseHub(id: string | undefined, actor: Actor): Promise<unknown> {
    if (id === undefined) {
      // The person's opens the picker (their keys go to it); an agent's reads the list.
      if (actor.kind !== "agent") { this.openPicker(); return { picker: true }; }
      const found = await findBoards(this.ctx.board);
      return { current: this.hub?.id ?? null, hubs: found.map(f => ({ id: f.hub.id, title: subject(f.hub), lanes: f.lanes })) };
    }
    const hub = this.hubPicker?.items.find(i => i.hub.id === id || (id.length >= 8 && i.hub.id.startsWith(id)))?.hub ?? await this.ctx.board.get(id);
    if (!hub) throw new ActionRefused(`no block ${id}`);
    if ((await hubViews(this.ctx.board, hub.id)).length < 2) throw new ActionRefused(`${subject(hub)} isn't a board: it has fewer than two virtual-branch lanes`);
    await this.useHub(hub);
    return { hub: hub.id, title: subject(hub), lanes: this.lanes.map(l => l.name) };
  }
  /** The picker put away (esc, q): the board as it was, or with no board yet, back to the menu. */
  closePicker() {
    if (!this.hubPicker) return { picker: false };
    if (!this.hub) { this.shellKey("screen.back"); return { left: true }; }
    this.hubPicker = null; this.redraw();
    return { picker: false };
  }
  /** `g`: the hub picker, the board shown now selected; it holds the keys until ⏎ or esc. */
  private openPicker() {
    this.status = "looking for boards…"; this.redraw();
    findBoards(this.ctx.board).then(items => {
      this.status = "";
      this.hubPicker = { items, sel: Math.max(0, items.findIndex(i => i.hub.id === this.hub?.id)) };
      this.redraw();
    }, e => { this.status = ""; this.ctx.flash(`couldn't look for boards: ${(e as Error).message}`); this.redraw(); });
  }

  /** `board.reload`: every lane asked again. */
  reloadLanes() {
    if (!this.hub) throw new ActionRefused("no board is shown yet; board.hub picks one");
    this.loadLanes();
    this.redraw();
    return { lanes: this.lanes.map(l => l.name) };
  }

  /** `lane.collapse`: a lane to a spine, or open again: the desk's tile.collapse on the lane's tile (its policy, its agent rule). */
  collapseLane(name: string | undefined, on: boolean | undefined, actor: Actor) {
    const lanes = this.lanes;
    const l = name === undefined ? lanes[this.lane] : lanes.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) throw new ActionRefused(name === undefined ? "the board has no lanes yet" : `no lane ${name}; lanes: ${lanes.map(x => x.name).join(", ")}`);
    const r = this.collapseTile(this.nameOf(this.idOf(l)!), on, actor);
    return { lane: l.name, collapsed: !!r.collapsed, ...(r.changed === false ? { changed: false } : {}) };
  }
  /** A lane folded to a spine is opened (a card moved or written into it should be seen). */
  private unfold(l: Lane) { const id = this.idOf(l); if (id !== undefined && this.collapsed.has(id)) { this.unfoldTile(id); this.save(); } }

  // ── the board's drawers: the desk's drawer containers, changed by the desk's tile.pin and tile.drawer ──

  /** The outline's split (the tree over its preview) and the backlinks' (the list beside its preview): their ids. */
  private splitId(key: "outline" | "links"): string { return node(this.root, key)!.id!; }

  /** `outline`: the outline drawer open or shut, and on which side. */
  outlineDrawer(open: boolean | undefined, side: string | undefined, actor: Actor) {
    const agent = actor.kind === "agent";
    const tree = this.idNamed("tree")!, inIt = this.focus === tree || this.focus === this.idNamed("tree-preview");
    if (side !== undefined) {
      if (side !== "left" && side !== "right" && side !== "other") throw new ActionRefused(`side is left, right or other, not ${side}`);
      const to: Dir = side === "other" ? (this.treeSide === "left" ? "right" : "left") : side;
      if (to !== this.treeSide) this.moveOutline(to, actor);
      if (open === undefined) open = true;
    }
    // The person's t: shut when it's open and theirs, else open and theirs.
    const want = open ?? (agent ? !this.treeOpen : !(this.treeOpen && inIt));
    if (!want) {
      if (agent && inIt) throw new ActionRefused("the person is in the outline drawer; an agent doesn't shut it");
      this.shutDrawer("tree", actor);
      if (this.focus === tree || this.focus === this.idNamed("tree-preview")) this.toLanes();
    } else if (!this.treePinned) this.drawerTile("tree", true, actor);
    if (want && !agent && side === undefined) { this.focus = tree; this.entered.clear(); }
    if (agent) this.ctx.flash(`${agentLabel(actor)} ${want ? "opened" : "shut"} the outline drawer${side ? ` on the ${this.treeSide}` : ""}`);
    this.save(); this.redraw();
    return { open: this.treeOpen, side: this.treeSide, pinned: this.treePinned };
  }
  /** The outline (pinned or not) to the other side, keeping its width: tile.pin with an edge, as ^W P's edge row does. */
  private moveOutline(to: Dir, actor: Actor) {
    const id = this.splitId("outline");
    if (!this.treePinned) { this.pinTile("tree", false, to, actor, id); return; }
    // Pinned: into a drawer at that edge, then docked there again.
    this.pinTile("tree", false, to, actor, id);
    super.pinTile("tree", true, undefined, actor);
  }
  /** One of the board's drawers shut (pinned, it goes back into its drawer first), by the desk's tile.pin and tile.drawer. */
  private shutDrawer(which: "tree" | "backlinks", actor: Actor) {
    if (which === "tree" ? this.treePinned : this.linksPinned) this.pinTile(which, false, which === "tree" ? this.treeSide : "down", actor, this.splitId(which === "tree" ? "outline" : "links"));
    const d = drawerOf(this.root, this.idNamed(which)!);
    if (d?.open) this.drawerTile(which, false, actor);
  }

  /**
   * `tile.pin` (`B`, `T`) on one of the board's drawers (the outline, the backlinks), with no edge or container
   * named: the whole drawer (the list with its preview) docks into the layout, or slides over again. Any other
   * tile, or an edge or a container named, is the desk's tile.pin.
   */
  override pinTile(sel: string | undefined, on: boolean | undefined, edgeTo: Dir | undefined, actor: Actor, container?: string): TileDone {
    const which = !sel || sel === "focused" ? (this.focus === this.idNamed("tree") || this.focus === this.idNamed("tree-preview") ? "tree" : this.focus === this.idNamed("backlinks") || this.focus === this.idNamed("backlinks-preview") ? "backlinks" : undefined) : sel.replace(/-preview$/, "");
    if ((which !== "tree" && which !== "backlinks") || edgeTo !== undefined || container !== undefined) return super.pinTile(sel, on, edgeTo, actor, container);
    const pinned = which === "tree" ? this.treePinned : this.linksPinned;
    const want = on ?? !pinned;
    if (want !== pinned) {
      if (which === "backlinks" && !this.linksOpen && actor.kind === "agent") throw new ActionRefused("the backlinks drawer isn't open; b opens it on a reader's note");
      // The whole container goes (the list with its preview), back to the edge it slides from.
      if (want) super.pinTile(which, true, undefined, actor);
      else super.pinTile(which, false, which === "tree" ? this.treeSide : "down", actor, this.splitId(which === "tree" ? "outline" : "links"));
      // Pinned with nothing in it yet, the backlinks are the focused reader's.
      if (which === "backlinks" && want && !this.linksTile.target) void this.aimLinks(this.readerForKeys(), false);
      this.save(); this.redraw();
    }
    return { tile: which, pane: which, pinned: want, changed: want !== pinned };
  }

  // ── the backlinks drawer: the backlinks tile, listing a reader's note's backlinks ──

  /** The reader whose note `b` lists the backlinks of: the focused one, or the preview. */
  private readerForKeys(): ReaderPane { const p = this.panes.get(this.focus); return p instanceof ReaderPane && p !== this.linksPreview && p !== this.treePreview ? p : this.preview; }

  /**
   * The backlinks drawer on `reader`'s note: the backlinks tile follows that reader (its source), the drawer
   * slides open, and the person's `b` gives it the keys. Resolves once the service has answered.
   */
  private aimLinks(reader: ReaderPane, focus = true, m?: Msg): Promise<void> {
    const L = this.linksTile, id = this.idOf(reader);
    if (id !== undefined) L.source = this.nameOf(id);
    if (!this.linksPinned && !this.linksOpen) { const keep = this.focus; this.drawerTile("backlinks", true, USER); if (!focus) this.focus = keep; }
    if (focus) { this.focus = this.idNamed("backlinks")!; this.entered.clear(); }
    const note = m ?? reader.msg;
    const asked = note ? L.show(note, this) : Promise.resolve();
    this.redraw();
    return asked.then(() => { if (focus) this.panes.get(this.idNamed("backlinks")!)?.focused?.(this, USER); this.redraw(); });
  }
  /** The backlinks drawer shut (it keeps what it listed). */
  private shutLinks(actor: Actor = USER) {
    this.shutDrawer("backlinks", actor);
    if (this.focus === this.idNamed("backlinks") || this.focus === this.idNamed("backlinks-preview")) this.toLanes();
  }

  /**
   * `backlinks` from the control socket. The person's (as=you) sets their drawer's options, opening it on
   * `id` first, and so does what the keys and clicks do. An agent's reads the same view (the person's
   * options, with its own on top) and changes nothing the person sees but the status bar saying so.
   */
  async readLinks(args: { id?: string; filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string }, actor: Actor) {
    const { id, ...want } = args;
    const L = this.linksTile;
    const open = this.linksOpen && !!L.target;
    const same = !id || (open && (L.target!.id === id || (id.length >= 8 && L.target!.id.startsWith(id))));
    if (!id && !open) throw new ActionRefused("no backlinks drawer is open; id=<block id> reads a note's backlinks (b opens the drawer on a reader's note)");
    const target = same ? L.target! : await this.ctx.board.get(id!);
    if (!target) throw new ActionRefused(`no block ${id}`);
    const kindsOf = (data: typeof L.data, o: BacklinkViewOptions) => backlinkView(data, { ...o, kind: null }).kinds;
    const parse = (base: BacklinkViewOptions, data: typeof L.data) => { try { return backlinkOptionsFrom(base, want, kindsOf(data, base)); } catch (e) { throw new ActionRefused((e as Error).message); } };
    if (actor.kind !== "agent") {
      if (!same || !open) {
        const reader = this.readers().find(r => r.msg?.id === target.id && r !== this.linksPreview && r !== this.treePreview) ?? this.readerForKeys();
        await this.aimLinks(reader, true, target);
      } else if (!L.data) await L.load(target, this, true);
      const next = parse(L.options, L.data);
      L.draft = null;
      return BACKLINKS_ACTIONS.run("backlinks.view", { filter: next.filter, kind: next.kind ?? "all", stage: next.stage, resolved: next.showResolved, related: next.showRelated, sort: `${next.sortField}-${next.sortDirection}` }, { pane: L, desk: this }, actor);
    }
    const data = same && L.data ? L.data : await this.ctx.board.backlinks(target.id);
    // The person's options carry over only for the note they're looking at; another note starts as Detail's.
    const base = same ? { ...L.options } : { ...DEFAULT_BACKLINK_VIEW_OPTIONS, sortField: L.options.sortField, sortDirection: L.options.sortDirection };
    const o = parse(base, data);
    this.ctx.flash(`${agentLabel(actor)} read the backlinks of ${subject(target).slice(0, 40)}`);
    return { backlinks: { target: { id: target.id, title: subject(target) }, ...describeBacklinkView(backlinkView(data, o), o, same ? L.expanded : new Set()) } };
  }

  /**
   * An agent's `card.select`: the card its later card actions default to (its own reference, beside the
   * person's cursor). Nothing the person sees moves; the status bar says what it picked.
   */
  selectForAgent(id: string, actor: Extract<Actor, { kind: "agent" }>): { selected: string; lane: string } {
    const card = this.cardFor(id);
    const lane = this.lanes.find(l => l.items?.some(m => m.id === card.id))!;
    this.agentCards.set(actor.id, card.id);
    this.ctx.flash(`${agentLabel(actor)} selected "${titleOf(card)}" in ${lane.name} · your cursor stays`);
    return { selected: card.id, lane: lane.name };
  }

  /** `card.move`: the selected card (or `card`) into the lane named `lane`, by the same move as H/L, m and a drag. */
  async moveCard(lane: string, card: string | undefined, actor: Actor) {
    // Refused before the move starts: said to the person as a move's refusal is (moveTo says its own).
    const refuse = (m: string) => { if (actor.kind !== "agent") this.ctx.flash(`not moved: ${m}`); return new ActionRefused(m); };
    if (!card && actor.kind === "agent") card = this.cardFor(undefined, actor).id;   // its own selection, else the person's
    // An agent's move names its card without selecting it: the person's lane, selection, preview and
    // keys stay where they are. (The person's own card.move, through the socket as `you`, selects it.)
    const lanes = this.lanes;
    let from = this.lane, c = this.card();
    if (card) {
      if (actor.kind === "agent") {
        from = lanes.findIndex(l => l.items?.some(m => m.id === card || (card.length >= 8 && m.id.startsWith(card))));
        c = from >= 0 ? lanes[from]!.items!.find(m => m.id === card || m.id.startsWith(card)) : undefined;
        if (!c) throw refuse(`no lane on the board lists ${card}`);
      } else if (!this.selectCard(card)) throw refuse(`no lane on the board lists ${card}`);
      else { from = this.lane; c = this.card(); }
    }
    if (!c) throw refuse("no card is selected");
    const want = lane.toLowerCase();
    const to = lanes.findIndex(l => l.name.toLowerCase() === want);
    if (to < 0) throw refuse(`no lane ${lane}; lanes: ${lanes.map(l => l.name).join(", ")}`);
    if (to === from) throw refuse(`the card is already in ${lanes[to]!.name}`);
    this.lastMove = null;
    await this.moveTo(to, actor, { card: c, from });
    const r = this.lastMove as DeliveryBoard["lastMove"];
    if (!r) throw new ActionRefused("not moved");
    if (r.result.startsWith("refused")) throw new ActionRefused(r.result.replace(/^refused: /, ""));
    for (const x of this.readers()) if (x.msg?.id === c.id) x.surface.noteAgent(actor, `moved this card to ${lanes[to]!.name}`);
    return { card: c.id, lane: lanes[to]!.name, result: r.result };
  }

  override describe() {
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : null);
    const L = this.linksTile, links = this.linksOpen && L.target;
    return {
      kind: "board", hub: brief(this.hub), focus: this.focusName(), focusTile: this.nameOf(this.focus),
      lanes: this.lanes.map((l, i) => ({ name: l.name, tile: this.nameOf(this.laneIds()[i]!), count: l.items?.length ?? null, status: l.read?.status, truncated: l.read?.truncated, collapsed: this.collapsed.has(this.laneIds()[i]!), focused: i === this.lane, selected: brief(l.items?.[l.sel]) })),
      preview: brief(this.preview.msg),
      details: this.detailTiles().map((d, i) => ({ ...brief(d.pane.msg), reader: this.nameOf(d.id), opensHere: i === this.active })),
      floats: this.floats.map(f => ({ ...brief((this.panes.get(f.id) as ReaderPane | undefined)?.msg), reader: this.nameOf(f.id), rect: { ...f.rect } })),
      tree: { open: this.treeOpen, pinned: this.treePinned, side: this.treeSide, preview: brief(this.treePreview.msg), ...(this.treeOpen ? { rows: this.outline.describe() } : {}) },
      layout: { tree: super.describe().tree, floats: this.floats.map(f => ({ pane: this.nameOf(f.id), rect: { ...f.rect } })) },
      backlinks: links ? { from: L.source, pinned: this.linksPinned, ...L.describe() } : null,
      moving: this.moving, lastMove: this.lastMove,
      composer: this.composer ? { kind: this.composer.kind, ...(this.composer.kind === "card" ? { lane: this.composer.lane.name, bornWith: this.composer.born, needs: this.composer.needs, parent: this.composer.parent } : { parent: brief(this.composer.parent) }), dirty: this.composer.session.dirty, note: this.composer.session.draft.note || null } : null,
      steps: this.steps ? { card: brief(this.steps.card), revision: this.steps.read?.revision ?? null, selected: this.steps.sel + 1, items: this.steps.read?.items.map((it, i) => ({ n: i + 1, status: it.status, text: stepText(it.text), id: it.itemId ?? null })) ?? null, note: this.steps.note || null } : null,
      agentSelected: Object.fromEntries(this.agentCards),
      trashArmed: this.trashArm?.id ?? null, trashed: this.trashed, lastWrite: this.lastWrite,
      refreshes: { ...this.refreshes },
      mover: this.mover ? { card: brief(this.mover.card), options: this.lanes.map((l, i) => ({ lane: l.name, plan: this.mover!.plans?.[i] ?? "planning", selected: i === this.mover!.sel })) } : null,
      readers: this.boardReaders().filter(r => r.pane.msg).map(r => ({ name: r.name, focused: r.id === this.focus, ...r.pane.describe(), ...this.collapsedState(r.id, r.pane) })),
      collapsedReaders: this.boardReaders().filter(r => this.collapsed.has(r.id)).map(r => r.name),
      editing: this.readers().filter(r => r.draft).map(r => draftState(r)),
      commenting: this.readers().filter(r => r.session).map(r => r.session!.describe()),
    };
  }
  /** How `peek` shows a reader's spine: collapsed, by which agent, and comments that arrived since. */
  private collapsedState(id: number, p: ReaderPane) {
    const s = this.collapsed.get(id);
    return s ? { collapsed: true, ...(s.by ? { collapsedBy: s.by } : {}), newComments: p.newComments() } : { collapsed: false };
  }

  private card(): Msg | undefined { return this.laneTile()?.card(); }
  /** The preview shows the card the lanes' cursor is on. */
  private follow() { const m = this.card(); if (m && m.id !== this.preview.msg?.id) { this.current = m; this.preview.follow(m, this); } }

  // ── where opens go on the board (DeskApi) ───────────────────────────────

  override setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    if (!m) return;
    const from = opts.from;
    // A lane's cursor moved (a click, query.pick): that's the lanes' selection, followed by the preview.
    if (from instanceof QueryPane && this.lanes.includes(from)) {
      const i = this.lanes.indexOf(from);
      if (opts.link) { this.current = m; this.openDetail(m, !!opts.fresh, opts.by); return; }
      // The lanes' cursor is the person's: an agent's pick in a lane (query.pick) is its own.
      if (opts.by?.kind !== "agent") { this.lane = i; this.follow(); }
      return this.redraw();
    }
    this.current = m;
    // alt+⏎ on a link opens a new detail; a link followed in the preview, or in a drawer's preview or list, opens
    // in a detail, as ⏎ on a card does (PIE-441). An agent's never takes the person's focus.
    const drawerTile = from === this.treePreview || from === this.linksPreview || from === this.linksTile;
    if ((from instanceof ReaderPane || from === this.linksTile) && (opts.fresh || (opts.link && (from === this.preview || drawerTile)))) { this.openDetail(m, !!opts.fresh, opts.by); return; }
    // The outline's cursor (and its ⏎): its preview follows it (the desk's followers).
    if (from === this.outline || from === this.linksTile) return this.showFrom(from, m);
    if (from instanceof ReaderPane && from !== this.preview) from.show(m, this);   // links open in place
    else this.preview.follow(m, this);
    this.redraw();
  }
  /** ⏎ in the outline: the note opens in a detail. */
  override focusKind(kind: TileKindName) { if (kind === "reader" && this.current) this.openDetail(this.current, false); }
  /** Tile `p` has the person's focus; with the lanes focused, the preview following them does too (PIE-453). */
  override hasFocus(p: Pane) { return p === (this.onLanes ? this.preview : this.panes.get(this.focus)); }
  /** Where the person's keys are on the board: the desk's answer, with the preview theirs while the lanes have them. */
  override keys(): ScreenKeys {
    const k = super.keys();
    return this.onLanes ? { ...k, focus: "preview" } : k;
  }

  /** Start a session in `pane` as the person's key does: it takes the keys first (the lanes' e, C, i edit the preview). */
  private startIn(pane: ReaderPane, kind: SessionKind) {
    const id = this.idOf(pane);
    if (id === undefined || !pane.msg) return;
    this.focus = id;
    const di = this.detailTiles().findIndex(d => d.id === id);
    if (di >= 0) this.active = di;
    if (pane.holdsKeys) { this.entered.enter(pane); this.ctx.flash(`in ${sessionName(pane)} · ${pane.hint()}`); return this.redraw(); }
    this.startSession(pane, kind);
  }

  /** Show `m` in a detail, for `actor`; false (with a flash) when none could take it. An agent's leaves the focus where it is. */
  private openDetail(m: Msg, fresh: boolean, actor: Actor = USER): boolean {
    const quiet = actor.kind === "agent";
    // The reader the person is in (an edit, a comment or the property panel), by identity: the readers row can
    // shift under it, and their keys stay with it wherever it lands.
    const keep = this.personIn();
    let details = this.detailTiles();
    // A detail holding an edit, a comment or the panel is never reused or dropped, nor the one the person is in.
    const wantNew = fresh || !details.length || details[this.active]?.pane.holdsKeys;
    // A locked screen keeps its shape: no detail is added; the note opens in a detail free to take it, else the preview.
    const locked = wantNew && (this.noReadersRow("opening a detail") ?? this.detailRefusal(actor));
    if (locked) {
      const free = details.findIndex(d => !d.pane.holdsKeys && d.pane !== keep);
      this.ctx.flash(`${locked} · opened in ${free >= 0 ? this.labelOf(details[free]!.pane) : "the preview"}`);
      if (free < 0) { this.preview.surface.track(() => this.preview.show(m, this)); this.redraw(); return false; }
      this.active = free;
    } else if (wantNew) {
      if (details.length >= 2) {
        const free = (d: ReaderPane) => !d.holdsKeys && d !== keep;
        const mine = this.panes.get(this.focus);
        // An agent's (quiet) open never replaces the detail the person has focused: it's refused instead.
        const drop = details.findIndex(d => free(d.pane) && !(quiet && d.pane === mine));
        if (drop < 0) { this.ctx.flash(quiet && details.some(d => free(d.pane)) ? "not opened: the other detail holds an edit, a comment or properties, and you have this one" : "both details hold edits, comments or properties · save or close one first"); return false; }
        this.closeId(details[drop]!.id);
      }
      this.newDetail(null, { kind: "in", key: "readers", weight: this.detailWeight() }, actor);
      details = this.detailTiles();
      this.active = details.length - 1;
    }
    // A detail is a reader opened on purpose: what it showed before is where back goes (PIE-453).
    const d = details[this.active]!;
    d.pane.surface.track(() => d.pane.hold(m, this));
    if (this.collapsed.has(d.id)) { this.unfoldTile(d.id); this.save(); }   // opening a note into a collapsed detail reopens it
    // Focus follows the note into its detail, unless the person is in an edit, comment or panel: it stays on
    // that reader, wherever the row moved it. An agent's never moves it.
    if (!quiet) this.focus = keep ? this.idOf(keep) ?? this.focus : d.id;
    if (!this.has(this.focus)) this.focus = d.id;
    // The outline sliding over shuts as the note opens (the desk's tile.drawer); a person's own only.
    if (!quiet && !this.treePinned && this.treeOpen) { try { this.drawerTile("tree", false, USER); } catch { /* it stays open (collapsible off) */ } }
    this.redraw();
    return true;
  }
  private has(id: number) { return this.all().includes(id); }

  /** The person's focused reader, when it is one (the preview, a detail, a float, a drawer's preview). */
  private labelOf(p: ReaderPane): string {
    if (p instanceof BoardDetail) return p.label.replace(/(\d+)$/, " $1");
    const id = this.idOf(p);
    return id === undefined ? "reader" : this.nameOf(id);
  }
  protected override readerLabel(id: number): string { const p = this.panes.get(id); return p instanceof ReaderPane ? this.labelOf(p) : super.readerLabel(id); }

  // ── collapsed readers: the desk's spines ────────────────────────────────

  /**
   * `tile.collapse` on the board (`reader.collapse`, `reader.expand`, `c`): a reader (the preview, a detail) by the
   * board's rules, below; `all` reopens every spine; anything else (a lane's tile) is the desk's.
   */
  override collapseTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    if (sel === "all") return { tile: "every spine", ...this.collapseReader(sel, on ?? false, actor) };
    // No tile named: the focused one; with the lanes focused, the preview following them (the board's reader for
    // the keys, PIE-453), as reader.collapse and reader.expand took it. A lane is named (or lane.collapse).
    const named = !sel || sel === "focused" ? { id: this.onLanes ? this.idNamed("preview")! : this.focus } : this.tileNamed(this.alias(sel), false);
    if (named && (this.isLane(named.id) || !(this.panes.get(named.id) instanceof ReaderPane))) return super.collapseTile(sel && this.alias(sel), on, actor);
    const r = this.collapseReader(sel, on ?? !(named && this.collapsed.has(named.id)), actor);
    return { tile: "reader" in r ? r.reader : "all", ...r };
  }

  /**
   * A reader to a spine, or open again (the desk's tile.collapse, keeping what the reader holds exactly): the
   * preview or a detail, never a drawer's preview. `all` reopens every collapsed lane and reader.
   */
  collapseReader(sel: string | undefined, on: boolean, actor: Actor): { reader: string; collapsed: boolean; holds: string | null } | { reopened: string[]; kept?: string[] } {
    if (sel === "all") {
      if (on) throw new ActionRefused("tile=all only reopens (alt+c); collapse readers one by one");
      // Each spine its own step: one the layout keeps folded (and why) doesn't stop the others reopening.
      const label = (id: number) => (this.isLane(id) ? `lane ${(this.panes.get(id) as Lane).name}` : this.nameOf(id));
      const reopened: string[] = [], kept: string[] = [];
      for (const id of [...this.collapsed.keys()]) {
        const r = this.ask({ op: "collapse", tile: id, on: false }, actor);
        if (r.ok) { this.commit(r); reopened.push(label(id)); } else kept.push(`${label(id)}: ${r.refused}`);
      }
      this.save(); this.redraw();
      return { reopened, ...(kept.length ? { kept } : {}) };
    }
    const r = this.pickReaderAny(sel);
    if (r.pane === this.treePreview || r.pane === this.linksPreview) throw new ActionRefused("only the preview and details collapse; a drawer shuts");
    // The layout's rules first (a float doesn't fold, an agent never folds the person's reader), with nothing done.
    const asked = this.ask({ op: "collapse", tile: r.id, on }, actor);
    if (!asked.ok) throw new ActionRefused(asked.refused);
    if (on && this.pending?.pane === r.pane) this.pending = null;              // an edit still opening there doesn't open behind a spine
    super.collapseTile(r.name, on, actor);
    // An agent's is said by tile.collapse ("folded detail1"); the person's says what it kept.
    if (actor.kind !== "agent" && on) this.ctx.flash(`${this.labelOf(r.pane)} collapsed${r.pane.holdsKeys ? `, keeping ${sessionName(r.pane)}` : ""} · c opens it`);
    return { reader: r.name, collapsed: this.collapsed.has(r.id), holds: r.pane.surface.state() };
  }
  /** A reader by name, for collapsing: on screen or folded (a spine is still where it was). */
  private pickReaderAny(sel?: string): { name: string; id: number; pane: ReaderPane } {
    if (!sel || sel === "focused") { const p = this.panes.get(this.focus); if (p instanceof ReaderPane) return { name: this.nameOf(this.focus), id: this.focus, pane: p }; return { name: "preview", id: this.idNamed("preview")!, pane: this.preview }; }
    const r = this.boardReaders().find(x => x.name === this.alias(sel));
    if (r) return r;
    return this.pickBoardReader(sel);
  }
  /** A spine clicked or ⏎ on it: a lane opens and takes the cursor, a reader opens and takes the keys. */
  protected override expandSpine(id: number) {
    if (this.isLane(id)) { const l = this.panes.get(id) as Lane; void this.runBoard("lane.collapse", { lane: l.name, on: false }); void this.runBoard("card.select", { lane: l.name, by: 0 }); return; }
    this.tileAct("tile.collapse", { on: false }, this.nameOf(id));
    void this.runBoard("focus", {}, this.nameOf(id));
  }

  // ── floats: the desk's (tile.float), with the board's rules for its readers ──

  /**
   * `o`: a detail pops out as a float; the preview keeps following the lanes, so a copy floats; a float docks
   * back as the last detail (taking a detail's place when both are open). The person's goes where they sent it;
   * an agent's leaves their focus on the reader they had.
   */
  override floatTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tileNamed(this.alias(sel ?? (this.onLanes ? undefined : this.nameOf(this.focus))), false) ?? { name: this.nameOf(this.focus), id: this.focus };
    const p = this.panes.get(t.id);
    if (this.isLane(t.id) || !(p instanceof ReaderPane) || p === this.treePreview || p === this.linksPreview) throw new ActionRefused(`${this.isLane(t.id) ? "lanes" : t.name} doesn't float; a reader does (the preview, a detail), and a float docks`);
    if (this.isFloat(t.id)) {
      // Nothing closes for a dock that's refused (the lock, or the readers row's policy): asked first.
      if (this.screenLocked()) return super.floatTile(t.name, actor);
      this.refuseIf(this.noReadersRow(`docking ${this.nameOf(t.id)}`));
      const asked = this.ask({ op: "float", tile: t.id, ...this.dockAt(t.id) }, actor);
      if (!asked.ok) throw new ActionRefused(asked.refused);
      // Docking takes a detail's place when both are open: never one holding an edit or a comment.
      const details = this.detailTiles();
      if (details.length >= 2) {
        let out = details.find(d => !d.pane.editing);
        if (!out) throw new ActionRefused("not docked: both details hold edits or comments · save or close one first");
        if (this.dispatch.rule("tile", actor, this.nameOf(out.id))) out = details.find(d => !d.pane.editing && !this.dispatch.rule("tile", actor, this.nameOf(d.id)));
        if (!out) throw new ActionRefused("not docked: the other detail holds an edit or a comment, and the person has this one");
        this.closeId(out.id);
      }
      const r = super.floatTile(t.name, actor);
      if (actor.kind !== "agent") { this.active = this.detailTiles().findIndex(d => d.id === t.id); this.focus = t.id; }
      return r;
    }
    if (this.collapsed.has(t.id)) throw new ActionRefused("it's collapsed · c or ⏎ opens it first");
    if (!p.msg) throw new ActionRefused("focus a reader with something in it, then o to pop it out");
    if (p === this.preview) {
      // A copy of what the preview shows floats: the preview stays, but its keys are the person's.
      this.dispatch.check("tile", actor, t.name, "an agent doesn't float it");
      const f = this.floatNote(p.msg, actor);
      if (actor.kind !== "agent") this.focus = this.idOf(f)!;
      this.redraw();
      return { tile: t.name, pane: t.name, floated: true, now: this.nameOf(this.idOf(f)!) };
    }
    const r = super.floatTile(t.name, actor);
    this.active = clamp(this.active, 0, Math.max(0, this.detailTiles().length - 1));
    return r;
  }
  /** A float docks as the last detail. */
  protected override dockAt(_id: number): { at: At<number> } { return { at: { kind: "in", key: "readers", weight: this.detailWeight() } }; }
  private refuseIf(why: string | null) { if (why) throw new ActionRefused(why); }
  /**
   * Why the readers row (the preview and the details) can't take a detail: it isn't in the layout, its tiles
   * moved out of it (its policy was changed to let them). Details open there; nothing guesses another place.
   */
  private noReadersRow(what: string): string | null {
    return node(this.root, "readers") ? null : `the board's readers row is gone (its tiles were moved out of it): ${what} needs it · the board comes back whole when it is opened again`;
  }
  /** A detail's share of the readers row as it opens: three to the preview's four. */
  private detailWeight(): number { const row = node(this.root, "readers"); return (row?.weights[0] ?? 4) * 0.75; }

  /** Which of the board's drawers tile `id` is in (the outline: the tree and its preview; the backlinks and theirs), by place, not name. */
  private inBoardDrawer(id: number): "tree" | "backlinks" | null {
    for (const [key, d] of [["outline", "tree"], ["links", "backlinks"]] as const) { const n = node(this.root, key); if (n && leaves(n).includes(id)) return d; }
    return null;
  }

  /**
   * `tile.close` (`x`, `^W x`) on the board: a detail or a float closes; a drawer's list or preview shuts its
   * drawer instead; the lanes and the preview stay (their policy: closable off, they collapse).
   */
  override closeTile(sel: string | undefined, actor: Actor): TileDone {
    const s = this.alias(sel ?? (this.onLanes ? "lanes" : this.nameOf(this.focus)));
    const t = this.tile(s);
    const drawer = this.inBoardDrawer(t.id);
    // Asked first, of the layout: a tile that stays says so to anyone (its container's rule, a source's, a lock).
    if (!drawer) { const asked = this.ask({ op: "close", tile: t.id }, actor); if (!asked.ok) throw new ActionRefused(asked.refused); }
    // A drawer's tile shuts its drawer (not a layout close): the person's keys there are theirs too.
    else this.dispatch.check("tile", actor, t.name, "an agent doesn't close it");
    if (drawer === "tree") { const keep = this.focus; this.shutDrawer("tree", actor); if (keep === t.id || keep === this.idNamed("tree-preview")) this.toLanes(); else this.focus = keep; this.save(); this.redraw(); return { tile: "tree", pane: "tree" }; }
    if (drawer === "backlinks") { const keep = this.focus; this.shutLinks(actor); if (keep !== this.idNamed("backlinks") && keep !== this.idNamed("backlinks-preview")) this.focus = keep; this.save(); this.redraw(); return { tile: "backlinks", pane: "backlinks" }; }
    const wasFocus = this.focus;
    super.closeTile(t.name, actor);
    // The person's focus goes to the detail left (or the lanes); an agent's leaves it.
    if (actor.kind !== "agent" && wasFocus === t.id) {
      const ds = this.detailTiles();
      this.active = Math.max(0, ds.length - 1);
      if (this.floats.length) this.focus = this.floats.at(-1)!.id; else if (ds.length) this.focus = ds[this.active]!.id; else this.toLanes();
    } else this.active = clamp(this.active, 0, Math.max(0, this.detailTiles().length - 1));
    this.save(); this.redraw();
    return { tile: t.name, pane: t.name };
  }

  /** `{ }` the lanes' height, `< >` a lane's or a reader's width, the outline's width, the backlinks' height. */
  override resizeTile(sel: string | undefined, axis: "row" | "col", by: number, actor: Actor): TileDone {
    const s = this.alias(sel ?? (this.onLanes ? "lanes" : undefined));
    // A reader's height is the room the lanes leave it; the backlinks list's is its drawer's.
    const t = this.tileNamed(s, false);
    const row = node(this.root, "readers");
    const reader = !!t && !!row && leaves(row).includes(t.id);
    if (t && reader && axis === "col") {
      const lane = this.laneIds()[this.lane];
      if (lane === undefined) throw new ActionRefused(`${t.name}'s height is the room the lanes leave it, and there are no lanes yet`);
      super.resizeTile(this.nameOf(lane), "col", -by, actor);
      return { tile: t.name, pane: t.name, axis, by };
    }
    return super.resizeTile(s, axis, by, actor);
  }

  // ── moving cards ───────────────────────────────────────────────────────────


  /** Why the selected card can't move at all right now, before any lane is considered. */
  private moveBlocked(card: Msg): string | null {
    if (this.moving) return "another move is still landing";
    // An open draft of this card keeps it where it is: the draft's base revision would go stale under
    // it. Saving or closing the edit first lets the revision checks decide in order.
    const r = openDraftOf(this.ctx.board, card.id);
    if (r) return `it's open for editing${r.dirty ? " with unsaved changes" : ""} · save (ctrl+s) or close (esc) the edit first`;
    // A comment names the revision its passage was read at; a write under it would make the send fail.
    const c = this.readers().find(p => p.session?.blockId === card.id);
    if (c) return `it's open for commenting${c.session!.dirty ? " with an unsent comment" : ""} · send (ctrl+s) or close (esc) the comment first`;
    return null;
  }

  /**
   * Move the selected card into lane `to` by patching the properties its query names. Keys, the mouse
   * and the `card.move` action all come here; `actor` is who the patch is recorded as.
   */
  private async moveTo(to: number, actor: Actor = USER, named?: { card: Msg; from: number }) {
    const from = named?.from ?? this.lane, card = named?.card ?? this.card(), target = this.lanes[to];
    // The person's move follows the card into its lane; an agent's leaves the person's selection alone.
    const person = actor.kind !== "agent";
    if (!card || !target || to === from) return;
    const ctx = asActor(this.ctx, actor);
    const by = byOf(actor);
    const blocked = this.moveBlocked(card);
    if (blocked) { this.lastMove = { card: card.id, to: target.name, result: `refused: ${blocked}`, ...by }; return ctx.flash(`not moved: ${blocked}`); }
    // From here until it lands or is refused, this card is moving: a second move waits for it.
    this.moving = card.id; this.status = `${actor.kind === "agent" ? `${agentLabel(actor)} is ` : ""}moving to ${target.name}...`; this.redraw();
    const plan = (await planMoves(this.ctx.board, card, [target.view]).catch((e: Error) => new Map<string, MovePlan>([[target.view, { kind: "refused", reason: e.message }]]))).get(target.view)
      ?? { kind: "refused" as const, reason: NO_PLANNER };
    if (plan.kind !== "patch") { this.moving = null; this.status = ""; }
    if (plan.kind === "refused") {
      this.lastMove = { card: card.id, to: target.name, result: `refused: ${plan.reason}`, ...by };
      return ctx.flash(plan.stale ? `not moved: ${plan.reason}` : `can't move to ${target.name}: ${plan.reason}`);
    }
    if (plan.kind === "already") {
      if (person) { this.lane = to; target.want = card.id; }
      this.loadLanes();
      this.lastMove = { card: card.id, to: target.name, result: "already there", ...by };
      return ctx.flash(`already in ${target.name} · nothing to change`);
    }
    let landed = false;
    try {
      const m = await applyMove(this.ctx.board, card, plan, actor);
      const also = await this.lanesHolding(m, to);
      this.lastMove = { card: card.id, to: target.name, result: `moved: ${describeChanges(plan.changes)} · revision ${m.revision}`, ...by };
      ctx.flash(`moved to ${target.name} · ${describeChanges(plan.changes)}${also.length ? ` · still in ${also.join(", ")} too` : ""}`);
      for (const r of this.readers()) r.refresh({ ...m, childIds: r.msg?.id === m.id ? r.msg.childIds : m.childIds });
      if (person) {
        if (this.lane === from) this.lane = to;           // follow the card unless the user already went elsewhere
        target.want = card.id;
        this.unfold(target);   // a card moved into a spine should still be seen
      }
      landed = true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.lastMove = { card: card.id, to: target.name, result: `refused: ${why}`, ...by };
      ctx.flash(`not moved: ${why.replace(/ · not moved$/, "")}`);
    } finally {
      this.moving = null; this.status = "";
      // Either way, show the lanes as the service has them now. After a move that landed, with a change
      // feed, the source and target are enough: the move's own change record refreshes any other lane.
      const feed = this.ctx.board.supports("changes.since") === true;
      this.loadLanes(landed && feed ? [this.lanes[from]!, target].filter(Boolean) : this.lanes);
    }
  }

  private openMover() {
    const card = this.card();
    if (!card) return this.ctx.flash("select a card to move");
    const blocked = this.moveBlocked(card);
    if (blocked) return this.ctx.flash(`not moved: ${blocked}`);
    const M: NonNullable<DeliveryBoard["mover"]> = { card, from: this.lane, plans: null, sel: this.lane };
    this.mover = M;
    this.redraw();
    const ids = this.lanes.map(l => l.view);
    planMoves(this.ctx.board, card, ids).then(
      plans => {
        if (this.mover !== M) return;
        M.plans = ids.map(id => plans.get(id) ?? { kind: "refused", reason: NO_PLANNER });
        const first = M.plans.findIndex((p, i) => i !== M.from && p.kind === "patch");
        if (first >= 0 && M.sel === M.from) M.sel = first;
        this.redraw();
      },
      (e: Error) => { if (this.mover === M) { M.plans = ids.map(() => ({ kind: "refused" as const, reason: e.message })); this.redraw(); } },
    );
  }

  private moverKey(k: Key, c: string) {
    const M = this.mover!;
    if (k.kind === "down" || c === "j") M.sel = Math.min(this.lanes.length - 1, M.sel + 1);
    else if (k.kind === "up" || c === "k") M.sel = Math.max(0, M.sel - 1);
    else if (k.kind === "esc" || c === "m" || c === "q") this.mover = null;
    else if (k.kind === "enter") {
      this.mover = null;
      if (this.card()?.id !== M.card.id || this.lane !== M.from) return this.ctx.flash("the selection changed · not moved");
      if (M.sel === M.from) return this.redraw();
      return void this.runBoard("card.move", { lane: this.lanes[M.sel]!.name, card: M.card.id });
    }
    this.redraw();
  }

  // ── writing cards: create, check off steps, trash and restore (PIE-406) ──────

  laneFor(name: string): Lane { return this.laneNamed(name); }
  /** The card an action names no card for: an agent's own `card.select`, else the person's selected card. */
  selectedCardId(actor?: Actor): string { return this.cardFor(undefined, actor).id; }
  /** The card an action with no card= acts on for `actor` (its own selection, else the person's), or null when none is. */
  private selectedCardOr(actor: Actor): string | null { try { return this.cardFor(undefined, actor).id; } catch { return null; } }
  async listSteps(id?: string, actor?: Actor) {
    const card = this.cardFor(id, actor);
    const r = await this.ctx.board.checklist(card.id);
    return { card: card.id, title: titleOf(card), revision: r.revision, steps: r.items.map((it, i) => ({ n: i + 1, status: it.status, text: stepText(it.text), depth: it.depth, id: it.itemId ?? null })) };
  }
  //
  // Keys and agents (`ep0ch-door act card.create …`) go through the same methods. Every write says who
  // did it: in the flash, in `lastWrite`, and to the service where it takes an author (create, steps).

  private laneNamed(name: string): Lane {
    const want = name.toLowerCase();
    const l = this.lanes.find(x => x.name.toLowerCase() === want);
    if (!l) throw new ActionRefused(`no lane ${name}; lanes: ${this.lanes.map(x => x.name).join(", ")}`);
    return l;
  }

  /** A card by id (or its first 8+ characters) from the lanes, else the selected card. */
  private cardFor(id?: string, actor?: Actor): Msg {
    const agent = !id && actor?.kind === "agent" ? actor.id : null;
    const own = agent ? this.agentCards.get(agent) : undefined;
    if (agent && own) {
      for (const l of this.lanes) { const m = l.items?.find(x => x.id === own); if (m) return m; }
      this.agentCards.delete(agent);
      throw new ActionRefused(`the card this agent selected (${own.slice(0, 8)}) isn't on the board any more; card.select another or pass card=<id>`);
    }
    if (!id) { const c = this.card(); if (!c) throw new ActionRefused("no card is selected"); return c; }
    for (const l of this.lanes) { const m = l.items?.find(x => x.id === id || (id.length >= 8 && x.id.startsWith(id))); if (m) return m; }
    throw new ActionRefused(`no lane on the board lists ${id}`);
  }

  /**
   * What a new card in `lane` is born with, and where it goes; the reason when the lane can't define one.
   * A roadmap lane's items go where the workboard's allocator puts them (their project's work queue), so
   * it has no parent to pick and a named one is refused.
   */
  private async cardPlan(lane: Lane, parent?: string, text = ""): Promise<CardPlan> {
    const plan = await this.ctx.board.planCreate(lane.view, text);
    if (!plan) throw new ActionRefused(`this outline can't plan new cards (views.planWrite, PIE-490); restart it from a current pi-herdr-outliner`);
    if (plan.kind === "refused") throw new ActionRefused(plan.reason);
    const { needs } = plan;
    if (plan.roadmap) {
      if (this.ctx.board.hasRoadmapAllocator() === false)
        throw new ActionRefused(`${lane.name} lists roadmap items, which are made by the workboard's allocator (roadmap.items.create), and this outline doesn't have it; create them in the outliner`);
      if (parent) throw new ActionRefused(`${lane.name} lists roadmap items: the workboard's allocator puts them under their project's work queue, so parent= can't be chosen`);
      return { born: plan.born, defaults: plan.defaults, needs, parent: null, plan };
    }
    const where = parent ? { id: parent, why: "named by the caller" } : pickParent(lane.name, lane.def!, lane.items ?? [], this.lanes.flatMap(l => l.items ?? []));
    if ("refused" in where) throw new ActionRefused(where.refused);
    return { born: plan.born, defaults: plan.defaults, needs, parent: where, plan };
  }

  /**
   * `n`: a new card in the focused lane, written in a composer over the board. It opens at once, so what
   * is typed next is the card's text, never board keys; the parent's title is filled in when it's read.
   */
  private openCardComposer() {
    const lane = this.lanes[this.lane];
    if (!lane || this.composer) return;
    // Open now, so what's typed next is the card's text; what the lane gives it is filled in when the
    // service's plan arrives. A lane that can't define a card says why, and the text is kept.
    // A new card put aside in this lane (esc twice, the board closed) comes back (the card adapter's place).
    const session = this.openComposer(cardTarget({ kind: "card", lane: lane.name, create: (text, by) => BOARD_ACTIONS.run("card.create", { lane: lane.name, text, ...(C0.parent ? { parent: C0.parent.id } : {}) }, { b: this }, by) }));
    const C0: Composer = { kind: "card", lane, planning: true, born: [], defaults: [], needs: [], parent: null, session };
    this.composer = C0;
    this.redraw();
    this.cardPlan(lane).then(plan => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      const pick = plan.parent;
      Object.assign(C0, { planning: false, born: plan.born, defaults: plan.defaults, needs: plan.needs, parent: pick ? { ...pick, title: pick.id.slice(0, 8) } : null });
      this.redraw();
      if (pick) this.ctx.board.get(pick.id).then(parent => {
        if (this.composer !== C0 || C0.kind !== "card" || !C0.parent) return;
        if (parent) C0.parent.title = titleOf(parent);
        else C0.session.draft.note = `its parent ${pick.id.slice(0, 8)} isn't in the outline; creating will be refused`;
        this.redraw();
      }, () => {});
    }, (e: Error) => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      C0.planning = false; C0.session.draft.note = `not created: can't create in ${lane.name}: ${e.message}`;
      if (!C0.session.dirty) { C0.session.close(); this.composer = null; }   // nothing typed yet: nothing to keep
      this.ctx.flash(`can't create in ${lane.name}: ${e.message}`);
      this.redraw();
    });
  }

  /** `N`: a note under the selected card, opened at once like `n`. */
  private openChildComposer() {
    const card = this.card();
    if (!card) return this.ctx.flash("select a card to add a note under");
    if (this.composer) return;
    const session = this.openComposer(cardTarget({ kind: "child", parent: card, create: (text, by) => BOARD_ACTIONS.run("note.create", { text, parent: card.id }, { b: this }, by) }));
    this.composer = { kind: "child", parent: card, session };
    this.redraw();
  }

  /** The composer's draft session (the card adapter): it ends by itself once created, closed or put aside. */
  private openComposer(target: ReturnType<typeof cardTarget>): DraftSession {
    const s: DraftSession = DraftSession.open(target, {}, { redraw: () => this.redraw(), closed: () => { if (this.composer?.session === s) this.composer = null; }, said: m => this.ctx.flash(m, 8000) });
    return s;
  }

  /** A key in the composer: typing is its draft's; what ends it runs the board's action, as a click would. */
  private composerKey(k: Key) {
    const s = this.composer!.session;
    // Reference completion ([[ (( [file::), as in every draft: the editing component's, from this board's connection.
    s.key(k, { completer: completerFor(s.draft, this.ctx.board, () => this.redraw()), run: cmd => this.composerCommand(cmd) });
    this.redraw();
  }

  private composerCommand(cmd: DraftCommand) {
    const C0 = this.composer!, d = C0.session.draft;
    if (cmd === "save") void this.submitComposer();
    else if (cmd === "editor") openInEditor(this.ctx, d);
    // cmd+c: the draft's selection to the person's clipboard, through the draft's copy action.
    else if (cmd === "copy") void Dispatcher.of(DRAFT_ACTIONS, d, () => this.ctx).press("draft.copy").then(r => { const c = r as { text: string; chars: number } | undefined; if (c) { this.ctx.copy?.(c.text); this.ctx.flash(`copied ${c.chars} chars`); } this.redraw(); });
    // Esc on nothing typed closes it; esc, esc on typed text puts it aside as unsent (never created), and says where.
    else if (cmd === "close" || cmd === "discard") void this.dispatch.pressIn(BOARD_ACTIONS, "composer.close", cmd === "discard" ? { discard: true } : {});
  }

  /**
   * The person leaves the new card or note they're writing (a click outside it, or esc twice): its session
   * leaves (never created: ctrl+s creates), and typed text is put aside as unsent where n or N brings it back.
   */
  async leaveComposer(): Promise<LeaveResult> {
    const C0 = this.composer;
    if (!C0) return { left: "nothing" };
    const r = await C0.session.leave(USER);
    this.redraw();
    return r;
  }

  /** Close the new card or note (esc): unchanged, it goes; typed text only with `discard`, put aside as unsent. */
  closeComposer(discard: boolean): { closed: boolean; keptAt?: string; said?: string } {
    const C0 = this.composer;
    if (!C0) return { closed: false };
    if (C0.session.dirty && !discard) throw new ActionRefused("there's typed text; ctrl+s creates it, discard=true puts it aside as unsent");
    const r = C0.session.close(discard);
    if (r.said) this.ctx.flash(r.said, 8000);
    this.redraw();
    return r;
  }

  /** Ctrl+S in the composer: create it (the card adapter, through card.create or note.create). A refusal keeps the text, says why, and copies it to disk. */
  private async submitComposer() {
    const C0 = this.composer;
    if (!C0) return;
    this.redraw();
    const r = await C0.session.submit(USER);
    if (!r.ok) this.ctx.flash(r.why);
    this.redraw();
  }

  /**
   * A new card in `lane`: the text, with the properties the lane needs appended to its first line, is
   * checked against the lane's whole query as the service would read it, then created under the lane's
   * parent. `create` has no revision or request id, so a lost answer is looked for, never retried.
   * A roadmap lane's card is a roadmap item, made by the workboard's allocator instead (createItem).
   */
  async createCard(lane: Lane, text: string, actor: Actor, parent?: string): Promise<{ id: string; workId?: string; lane: string; parent: string; text: string; bornWith: string[]; recordedAs: string }> {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) throw new ActionRefused("type the card's title first");
    const plan = await this.cardPlan(lane, parent, body);
    if (!plan.parent) return this.createItem(lane, actor, plan);
    const composed = plan.plan.text;
    if (composed === undefined) throw new ActionRefused(`the outline planned no text for the card in ${lane.name}`);
    const m = await this.landCreate(plan.parent.id, composed, actor);
    const bornWith = plan.plan.bornWith ?? [];
    this.created(lane, m, actor, `created in ${lane.name} · ${titleOf(m)}${bornWith.length ? ` · born with ${bornWith.map(p => `${p.key}=${p.value}`).join(" ")}` : ""}`, `created in ${lane.name} under ${plan.parent.id.slice(0, 8)}`);
    return { id: m.id, lane: lane.name, parent: plan.parent.id, text: m.text, bornWith: bornWith.map(p => `${p.key}=${p.value}`), recordedAs: recordedAs(actor) };
  }

  /**
   * A roadmap item in a roadmap lane, through the workboard's allocator (`roadmap.items.create`), never
   * a plain create: it issues the work-id and puts the item under its project's one active work queue.
   * Its fields are the service's plan (typed tokens, else the lane's plain clauses, else its create::
   * default), already checked against the lane's whole query. Not retried: a lost answer is looked for
   * among the project's newest items.
   */
  private async createItem(lane: Lane, actor: Actor, plan: CardPlan) {
    const board = this.ctx.board;
    const input = plan.plan.item;
    if (!input) throw new ActionRefused(`the outline planned no roadmap item for ${lane.name}`);
    const since = Date.now();
    let made: { workId: string; workQueueId: string; block: Msg } | null;
    try { made = await board.createRoadmapItem(input, actor); }
    catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.findItem(input.project, input.title, since).catch(() => null);
      if (!found) throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such item is there yet; the outcome is unknown, so look before creating it again`);
      made = { workId: found.props["work-id"] ?? "", workQueueId: found.parentId ?? "", block: found };
    }
    if (!made) throw new ActionRefused(`${lane.name} lists roadmap items, which are made by the workboard's allocator (roadmap.items.create), and this outline doesn't have it; create them in the outliner`);
    const m = made.block;
    const fields = [`priority=${input.priority}`, `arc=${input.arc}`, ...input.tracks.map(t => `track=${t}`), `project=${input.project}`];
    this.created(lane, m, actor, `created ${made.workId} in ${lane.name} · ${input.title.slice(0, 50)} · ${fields.join(" ")}`, `created ${made.workId} in ${lane.name} under its work queue ${made.workQueueId.slice(0, 8)}`);
    // What the allocator gave it, read off the block it made (its stage rule is the service's, not ours).
    const props = m.properties ?? Object.entries(m.props).map(([key, value]) => ({ key, value }));
    const bornWith = ["type", "priority", "work-stage", "work-batch", "project", "arc", "track"].flatMap(k => props.filter(p => p.key === k).map(p => `${k}=${p.value}`));
    return { id: m.id, workId: made.workId, lane: lane.name, parent: made.workQueueId, text: m.text, bornWith, recordedAs: recordedAs(actor) };
  }

  /** After an allocator create whose answer was lost: the project's item with that title, made since. */
  private async findItem(project: string, title: string, since: number): Promise<Msg | null> {
    const items = await this.ctx.board.query(`type=roadmap-item project=${project}`, 50, "created", "desc");
    return items.find(m => m.createdAt >= since - 1000 && m.text.split("\n")[0]!.includes(`— ${title}`)) ?? null;
  }

  /**
   * After a create landed: who did it, and the lane asked for it. The person's create selects the new
   * card (and opens a collapsed lane to show it); an agent's never moves the person's selection, focus
   * or saved layout.
   */
  private created(lane: Lane, m: Msg, actor: Actor, flash: string, result: string) {
    this.lastWrite = { what: "create", id: m.id, result, ...(byOf(actor)) };
    asActor(this.ctx, actor).flash(flash);
    if (actor.kind !== "agent") {
      lane.want = m.id; lane.wantVerb = "created";
      this.lane = this.lanes.indexOf(lane); this.toLanes();
      this.unfold(lane);
    }
    // The create's change record asks the lanes that could hold it; without a feed, ask this one now.
    if (this.ctx.board.supports("changes.since") !== true) this.loadLanes([lane]);
    this.redraw();
  }

  /** A note under `parentId` (a card's child), as it was typed. */
  async createNote(parentId: string, text: string, actor: Actor): Promise<{ id: string; parent: string; text: string }> {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) throw new ActionRefused("type the note first");
    const m = await this.landCreate(parentId, body, actor);
    const parent = await this.ctx.board.get(parentId).catch(() => null);
    if (parent) for (const r of this.readers()) r.refresh(parent);
    asActor(this.ctx, actor).flash(`added a note under ${parent ? titleOf(parent) : parentId.slice(0, 8)} · ${titleOf(m)}`);
    this.lastWrite = { what: "note", id: m.id, result: `created under ${parentId.slice(0, 8)}`, ...(byOf(actor)) };
    for (const r of this.readers()) if (r.msg?.id === parentId) r.surface.noteAgent(actor, "added a note under this card");
    this.redraw();
    return { id: m.id, parent: parentId, text: m.text };
  }

  /** One `create`, never retried: a refusal is the service's reason; a lost answer is looked for. */
  private async landCreate(parentId: string, text: string, actor: Actor): Promise<Msg> {
    const since = Date.now();
    try {
      return await this.ctx.board.createBlock(parentId, text, actor);
    } catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.ctx.board.findCreated(parentId, text, since).catch(() => null);
      if (found) return found;
      throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such block is there yet; the outcome is unknown, so look before creating it again`);
    }
  }

  // ── checklist steps ──

  /** `s`: the selected card's checklist steps, read from the service. */
  private async openSteps(card = this.card()) {
    if (!card) return this.ctx.flash("select a card to see its steps");
    const S = { card, read: null as ChecklistRead | null, sel: 0, busy: true, note: "" };
    this.steps = S; this.redraw();
    try {
      S.read = await this.ctx.board.checklist(card.id);
      if (!S.read.items.length) { if (this.steps === S) this.steps = null; this.ctx.flash(`${titleOf(card)} has no checklist steps`); }
    } catch (e) { if (this.steps === S) this.steps = null; this.ctx.flash(`couldn't read the steps: ${(e as Error).message}`); }
    finally { S.busy = false; this.redraw(); }
  }

  private stepsKey(k: Key, c: string) {
    const S = this.steps!;
    const n = S.read?.items.length ?? 0;
    if (k.kind === "esc" || c === "q" || c === "s") this.steps = null;
    else if (k.kind === "down" || c === "j") S.sel = Math.min(Math.max(0, n - 1), S.sel + 1);
    else if (k.kind === "up" || c === "k") S.sel = Math.max(0, S.sel - 1);
    else if (!S.busy && S.read && (c === " " || k.kind === "enter" || c === "x" || c === "w" || c === "!")) {
      const it = S.read.items[S.sel];
      if (it) {
        const status: StepStatus = c === "x" ? "done" : c === "w" ? "waiting" : c === "!" ? "problem" : it.status === "done" ? "todo" : "done";
        // The person's step change from the overlay: checked against the step as it was read; a refusal is its note.
        void this.dispatch.pressIn(BOARD_ACTIONS, "step.set", { step: String(S.sel + 1), status, card: S.card.id }, undefined, why => { S.note = why; return `not changed: ${why}`; }, { shown: { item: it, revision: S.read.revision } });
      }
    }
    this.redraw();
  }

  /**
   * Set step `index` of the card's checklist (as `checklist.query` numbers them) to `status`, checked by
   * the step's evidence: if the step changed since it was read, nothing is written and the steps are read
   * again. A step without an id is named by where it starts at the read revision, and the service gives
   * it one (the note's text gains `^t-…`).
   */
  async setStep(cardId: string, index: number | string, status: StepStatus | undefined, actor: Actor, shown?: { item: ChecklistStep; revision: number }): Promise<{ card: string; step: number; status: StepStatus; changed: boolean; revision?: number; id?: string }> {
    const card = this.cardFor(cardId);
    const blocked = this.moveBlocked(card);
    if (blocked) throw new ActionRefused(blocked.replace("another move is still landing", "a move is still landing"));
    const S = this.steps?.card.id === card.id ? this.steps : null;
    // The person's key names the step the overlay showed, at the revision it was read (the service's
    // evidence check refuses it if it changed since). A number or ^id from anyone else is resolved on a
    // fresh read, never on the overlay, which may be older than the note.
    const read = shown ? { revision: shown.revision, items: [shown.item] } : await this.ctx.board.checklist(card.id);
    const i = shown ? (typeof index === "number" ? index : 0) : typeof index === "number" ? index : read.items.findIndex(x => x.itemId === index || x.itemId === index.replace(/^\^/, ""));
    const it = shown ? shown.item : read.items[i];
    if (!it) throw new ActionRefused(typeof index === "number" ? `there's no step ${index + 1}; ${titleOf(card)} has ${read.items.length}` : `no step ^${index} in ${titleOf(card)}`);
    if (it.identity === "duplicate") throw new ActionRefused(`step ${i + 1} shares its id ^${it.itemId} with another step; fix it in the note's text first`);
    const to: StepStatus = status ?? (it.status === "done" ? "todo" : "done");
    if (S) { S.busy = true; S.note = "saving…"; this.redraw(); }
    try {
      const r = await this.ctx.board.setStep(card.id, it, read.revision, to, actor);
      for (const x of this.readers()) { x.refresh(r.block); if (x.msg?.id === card.id) x.surface.noteAgent(actor, `set step ${i + 1} to ${to}`); }
      const named = it.identity === "unassigned" && r.changed ? ` · the step now has an id (^${r.item.itemId})` : "";
      const said = `${to === "done" ? "checked off" : `set to ${to}`}: ${stepText(it.text)} · ${titleOf(card)}${named}`;
      asActor(this.ctx, actor).flash(r.changed ? said : `already ${to}: ${stepText(it.text)}`);
      this.lastWrite = { what: "step", id: card.id, result: `step ${i + 1} ${it.status} -> ${to} · revision ${r.block.revision}`, ...(byOf(actor)) };
      if (S) { S.note = r.changed ? said : ""; }
      return { card: card.id, step: i + 1, status: to, changed: r.changed, revision: r.block.revision, id: r.item.itemId };
    } catch (e) {
      const why = e instanceof Refused ? `${e.message} · the steps were read again; nothing changed` : e instanceof Error ? e.message : String(e);
      throw new ActionRefused(why);
    } finally {
      if (S && this.steps === S) {
        S.read = await this.ctx.board.checklist(card.id).catch(() => S.read);
        S.busy = false; this.redraw();
      }
    }
  }

  // ── trash ──

  /** `card.trash` with no confirm (the person's first `d`): the selected card is armed; a second d within five seconds trashes it. */
  async armTrash(): Promise<{ armed: string; title: string; notesUnder: number; say: string }> {
    const card = this.card();
    if (!card) throw new ActionRefused("select a card to trash");
    const blocked = this.moveBlocked(card);
    if (blocked) throw new ActionRefused(`not trashed: ${blocked}`);
    this.trashArm = { id: card.id, at: Date.now() };
    const fresh = await this.ctx.board.get(card.id).catch(() => null);
    const kids = fresh?.childIds.length ?? 0;
    const say = `d again trashes "${titleOf(card)}"${kids ? ` and the ${kids} note${kids === 1 ? "" : "s"} under it` : ""} · any other key keeps it`;
    if (this.trashArm?.id === card.id) this.ctx.flash(say);
    return { armed: card.id, title: titleOf(card), notesUnder: kids, say: "press d again" };
  }

  /**
   * Move a card (and its subtree) to Trash, if it is still at the revision the board showed. `confirm`
   * must name the same card: the second `d`, or an agent's `confirm=<id>`. The service's delete records
   * no author, so who did it is said on screen and in the result.
   */
  async trashCard(id: string, confirm: string, actor: Actor): Promise<{ trashed: string; title: string; lane: string; notesUnder: number; restore: string; recordedAs: string }> {
    const card = this.cardFor(id);
    if (!(confirm === card.id || (confirm.length >= 8 && card.id.startsWith(confirm))))
      throw new ActionRefused(`confirm=${confirm} doesn't name ${card.id.slice(0, 8)} ("${titleOf(card)}"); pass that card's id to trash it`);
    const blocked = this.moveBlocked(card);
    if (blocked) throw new ActionRefused(blocked);
    const fresh = await this.ctx.board.get(card.id);
    if (!fresh) throw new ActionRefused("the card isn't in the outline any more");
    if (card.revision !== undefined && fresh.revision !== card.revision)
      throw new ActionRefused(`the card changed since the board showed it (revision ${card.revision} -> ${fresh.revision}) · look again before trashing`);
    const lane = this.lanes.find(l => l.items?.some(m => m.id === card.id))?.name ?? "";
    let lost = "";
    try { await this.ctx.board.trash(card.id); }
    catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (e instanceof Refused) throw new ActionRefused(why);
      // The answer was lost, not refused: the card may be in Trash anyway. Look before saying either.
      const gone = await this.ctx.board.isTrashed(card.id);
      if (gone === false) throw new ActionRefused(`${why}; the card is still there`);
      if (gone === null) throw new ActionRefused(`${why}, and the outline didn't say whether the card is in Trash; look before trying again`);
      lost = ` (the outline's answer was lost: ${why}; it is in Trash)`;
    }
    const by = byOf(actor);
    this.trashed = { id: card.id, title: titleOf(card), lane, children: fresh.childIds.length, ...by };
    this.lastWrite = { what: "trash", id: card.id, result: `trashed from ${lane}`, ...by };
    asActor(this.ctx, actor).flash(`trashed "${titleOf(card)}"${fresh.childIds.length ? ` and ${fresh.childIds.length} note${fresh.childIds.length === 1 ? "" : "s"} under it` : ""} · u restores it${lost}`);
    if (this.ctx.board.supports("changes.since") !== true) this.loadLanes();
    this.redraw();
    return { trashed: card.id, title: titleOf(card), lane, notesUnder: fresh.childIds.length, restore: `card.restore id=${card.id}`, recordedAs: "not recorded: the service's delete takes no author" };
  }

  /** `u`: bring back the card trashed last (or `id`), where it was. */
  async restoreCard(id: string | undefined, actor: Actor): Promise<{ restored: string; title: string }> {
    const target = id ?? this.trashed?.id;
    if (!target) throw new ActionRefused("nothing was trashed from this board; pass id=<block id> to restore another");
    let m: Msg;
    try { m = await this.ctx.board.restore(target); }
    catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
    const title = titleOf(m);
    if (this.trashed?.id === m.id) {
      const lane = this.lanes.find(l => l.name === this.trashed!.lane);
      if (lane && actor.kind !== "agent") { lane.want = m.id; lane.wantVerb = "restored"; }   // an agent's restore never moves the person's selection
      this.trashed = null;
    }
    this.lastWrite = { what: "restore", id: m.id, result: "restored", ...(byOf(actor)) };
    asActor(this.ctx, actor).flash(`restored "${title}"`);
    if (this.ctx.board.supports("changes.since") !== true) this.loadLanes();
    this.redraw();
    return { restored: m.id, title };
  }

  // ── drawing: the desk draws the tiles; the board adds its pickers, its composer and its hint row ──

  override render(ctx: Ctx): Frame {
    // A card dragged over a lane: that lane's frame says what dropping it there would patch.
    const d = this.cardDrag;
    this.lanes.forEach((l, i) => { l.drop = d && d.over === i && i !== d.from ? { plan: this.cachedPlan(d.card, l) } : undefined; });
    this.markCurrent();
    // Each detail says whether ⏎ opens into it (when there are two); a float says what it holds.
    const ds = this.detailTiles();
    for (const x of ds) if (x.pane instanceof BoardDetail) { x.pane.floating = false; x.pane.opensHere = ds.length > 1 && ds[this.active]?.id === x.id; }
    for (const f of this.floats) { const p = this.panes.get(f.id); if (p instanceof BoardDetail) p.floating = true; }
    // The backlinks' preview says where its note mentions the listed one: the selected source's snippet.
    const snip = this.linksOpen ? this.linksTile.snippet() : "";
    this.linksPreview.label = snip ? `"${snip}"` : "follows the backlinks";
    return super.render(ctx);
  }

  protected override drawOver(canvas: Canvas, W: number, rows: number): boolean {
    const H = rows - 2;
    // No lanes yet (looking for boards, or none here): the lanes' place says so.
    const at = this.placed.nodes.get("lanes");
    if (at && !this.lanes.length && at.cols > 4 && at.rows > 2) {
      canvas.box(at, fg(C.blue), fg(C.grey) + (this.hub ? subject(this.hub) : "board"));
      canvas.text(at.col + 2, at.row + 1, fg(C.dark) + this.status + RESET, at.cols - 4);
    }
    const row = this.placed.nodes.get("readers");
    const ids = row ? leaves(node(this.root, "readers")!) : [];
    if (row && ids.length && ids.every(id => this.collapsed.has(id))) {
      const x = row.col + ids.length * 3;
      canvas.text(x + 1, row.row + 1, fg(C.dark) + "every reader is collapsed · c ⏎ or a click on a spine opens one · alt+c opens them all" + RESET, Math.max(0, row.col + row.cols - x - 2));
    }
    if (this.hubPicker) this.drawPicker(canvas, W, H);
    if (this.mover) this.drawMover(canvas, W, H);
    if (this.steps) this.drawSteps(canvas, W, H);
    if (this.composer) this.drawComposer(canvas, W, H);
    return !!(this.hubPicker || this.mover || this.steps || this.composer);
  }

  /** A mode of the board's own says its keys first: a card dragged, the mover, the composer, the steps. */
  protected override overHint(): string | null {
    const d = this.cardDrag;
    if (d) {
      const over = d.over === null ? null : this.lanes[d.over];
      const p = over && d.over !== d.from ? this.cachedPlan(d.card, over) : null;
      const say = over && d.over !== d.from && !p ? `|08 asking the outline what a move into |15${over.name}|08 would patch…`
        : !over || !p ? `|08 dragging |15${subject(d.card).slice(0, 60)}|08 · release over another lane to move it there`
        : p.kind === "patch" ? `|08 release to move into |15${over.name}|08 · |14${describeChanges(p.changes)}`
        : p.kind === "already" ? `|08 already in |15${over.name}|08 · nothing to change`
        : `|12 can't drop into ${over.name}: ${p.reason}`;
      return paint(say);
    }
    if (this.mover) return paint("|08 |15j k|08 pick a lane · |15enter|08 move the card there · |15esc|08 back · the second line says what would be patched");
    if (this.composer) return fg(C.dark) + " " + editHint(this.composer.session.draft, { save: "save", close: "back" }).replace("ctrl+s save", "ctrl+s create") + RESET;
    if (this.steps) return paint("|08 |15j k|08 step · |15space|08 done/to do · |15x|08 done · |15w|08 waiting · |15!|08 problem · |15esc|08 back · each change is checked against the step as it was read");
    return null;
  }

  protected override floatHint(): string { return "drag title · drag ◢ · H J K L move · o dock · x close"; }

  protected override screenHint(): string {
    const rd = this.panes.get(this.focus);
    const undo = this.trashed ? bg(C.red) + fg(C.white) + ` TRASHED "${this.trashed.title}"${this.trashed.by ? ` by an agent (${this.trashed.by})` : ""} · u restores ` + RESET + " " : "";
    if (rd instanceof ReaderPane && this.collapsed.has(this.focus)) {
      const holds = rd.holdsKeys ? ` · keeps ${sessionName(rd)}` : "";
      return undo + `|14 ${this.labelOf(rd)} · collapsed${holds}|08 · |15c ⏎|08 open · |15alt+c|08 open all · |15tab|08 area · |15esc|08 lanes`;
    }
    const L = this.linksTile;
    const base = this.onLanes
      ? "|08 |15g|08 boards · |15h l|08 lane · |15j k|08 card · |15⏎|08 detail · |15H L|08 move · |15m|08 move to... · |15n|08 new card · |15N|08 note under · |15s|08 steps · |15d d|08 trash · |15i|08 properties · |15C|08 comment · |15c|08 collapse · |15alt+c|08 open all · |15t|08 outline · |15b|08 backlinks · |15o|08 pop out · |15tab|08 area · |15q|08 menu"
      : this.focus === this.idNamed("backlinks")
        ? L.draft !== null
          ? "|08 type to filter the backlinks · |15⏎|08 keep · |15esc|08 undo · |15backspace ctrl+u|08 erase"
          : "|08 |15j k|08 row · |15⏎|08 open · |15alt+⏎|08 new detail · |15. space|08 group · |15/|08 filter · |15s|08 sort · |15K|08 kind · |15w|08 stage · |15h|08 resolved · |15n|08 this note · |15B|08 pin · |15tab|08 area · |15esc|08 close"
        : this.isFloat(this.focus)
          ? "|08 drag the title to move · drag |15◢|08 to resize · |15H J K L|08 move · |15o|08 dock · |15x|08 close · |15tab|08 area"
          : this.focus === this.idNamed("tree")
            ? "|08 |15j k|08 row · |15⏎|08 open · |15L|08 links · |15T|08 pin · |15S|08 side · |15tab|08 area · |15esc|08 close"
            : "|08 |15tab|08 area · |15c|08 collapse · |15t|08 outline · |15b|08 backlinks of this reader · |15o|08 pop out · |15x|08 close · |15{ } < >|08 size · |15q esc|08 lanes";
    return undo + base + (this.status ? ` · |14${this.status}` : "");
  }

  private drawPicker(canvas: Canvas, W: number, H: number) {
    const P = this.hubPicker!;
    const r: Rect = { col: Math.round(W * 0.2), row: Math.round(H * 0.15), cols: Math.round(W * 0.6), rows: Math.min(H - 4, P.items.length + 4) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + `pick a board · ${this.ctx.workspace}`, fg(C.dark) + "⏎ open · esc back");
    this.pickerRows = P.items.map((_, i) => ({ i, col: r.col + 1, row: r.row + 1 + i, cols: r.cols - 2 })).filter(x => x.row < r.row + r.rows - 1);
    P.items.forEach((it, i) => canvas.text(r.col + 1, r.row + 1 + i,
      (i === P.sel ? SEL : fg(C.grey)) + pad(` ${subject(it.hub)}  ${fg(C.dark)}${it.lanes} lanes · ${ago(it.hub.updatedAt)}`, r.cols - 2) + RESET, r.cols - 2));
  }

  // ── input: the board's own keys, before the desk's ─────────────────────

  protected override screenKey(k: Key, _ctx: Ctx): boolean {
    // The desk's search, layout picker or policy panel is open over the board: every key and click is its.
    if (this.overlayOpen()) return false;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A step's status choice the person opened (PIE-472) takes their keys until they choose or cancel, wherever it
    // is: a click on a box in the outline's or the backlinks' preview opens it without focusing it.
    const rd = this.focusedReader();
    const choosing = this.readers().find(r => r !== rd && r.surface.choosing && !this.collapsed.has(this.idOf(r) ?? -1));
    if (choosing && k.kind !== "mouse") { choosing.key(k, this); this.redraw(); return true; }
    // A card or note being written holds every key, like an edit.
    if (this.composer) {
      if (k.kind !== "mouse") { this.composerKey(k); return true; }
      // The wheel scrolls it, a click places the cursor, a drag selects. A click outside it puts it aside as
      // unsent (composer.leave: never created, n brings it back) and does what it does on the board.
      const d = this.composer.session.draft, r = this.composerAt;
      const pop = completerOf(d)?.shown ? completerOf(d) : null;
      if (k.action === "wheel-up" || k.action === "wheel-down") { if (pop) pop.move(k.action === "wheel-down" ? 1 : -1); else void DRAFT_ACTIONS.run("draft.scroll", { by: wheelRows(k.action === "wheel-down" ? 1 : -1) }, d, USER); this.redraw(); return true; }
      const inside = !!r && k.x >= r.col && k.y >= r.row && k.x < r.col + r.cols && k.y < r.row + r.rows;
      const inText = !!r && k.x > r.col && k.y > r.row && k.x < r.col + r.cols - 1 && k.y < r.row + r.rows - 1;
      if (r && pop && k.action === "down" && inText && pop.click(k.y - r.row - 1)) { this.redraw(); return true; }
      if (r && (k.action === "down" || k.action === "drag") && (inText || k.action === "drag") && editorClick(d, k.x - r.col - 1, k.y - r.row - 1, k.action === "drag")) { this.redraw(); return true; }
      if (k.action !== "down" || inside) return true;
      if (d.busy) { this.ctx.flash("the new card is being created · wait for it"); return true; }
      void this.dispatch.pressIn(BOARD_ACTIONS, "composer.leave").then(r => { const said = r ? leaveSaid(r as LeaveResult) : null; if (said) this.ctx.flash(said, 8000); this.redraw(); });
    }
    if (this.steps && k.kind !== "mouse") { this.stepsKey(k, c); return true; }
    if (this.trashArm && !(c === "d" && this.onLanes)) this.trashArm = null;   // any other key keeps the card
    if (this.mover && k.kind !== "mouse") { this.moverKey(k, c); return true; }
    if (this.hubPicker) {
      const P = this.hubPicker;
      if (k.kind === "mouse") {
        // A click on a board in the picker shows it, as ⏎ on it does.
        const row = k.action === "down" ? this.pickerRows.find(r => k.y === r.row && k.x >= r.col && k.x < r.col + r.cols) : undefined;
        if (row) { P.sel = row.i; void this.runBoard("board.hub", { id: P.items[row.i]!.hub.id }); }
        return true;
      }
      if (k.kind === "down" || c === "j") P.sel = Math.min(P.items.length - 1, P.sel + 1);
      else if (k.kind === "up" || c === "k") P.sel = Math.max(0, P.sel - 1);
      else if (k.kind === "enter") { const it = P.items[P.sel]; if (it) void this.runBoard("board.hub", { id: it.hub.id }); return true; }
      else if (k.kind === "esc" || c === "q") { void this.runBoard("board.hub", { close: true }); return true; }
      this.redraw();
      return true;
    }
    if (k.kind === "mouse") return this.boardMouse(k);
    // The desk's own states: a ^W command, the search, an edit or comment the person is in, a terminal, a filter.
    if (super.personTyping()) return false;
    // A reader holding a session the person isn't in: e or ⏎ enters it, j k PgDn scroll it (the desk's).
    if (rd?.holdsKeys && !this.collapsed.has(this.focus) && (c === "e" || k.kind === "enter" || k.kind === "up" || k.kind === "down" || c === "j" || c === "k" || k.kind === "pgup" || k.kind === "pgdn")) return false;
    const shut = this.collapsed.has(this.focus);
    const me = this.nameOf(this.focus);
    if (shut && rd && (c === "c" || c === " " || k.kind === "enter")) { this.tileAct("tile.collapse", { on: false }, me); return true; }
    if (c === "g") { void this.runBoard("board.hub", {}); return true; }
    if (k.kind === "tab" || k.kind === "backtab") {
      const lane = this.laneIds()[this.lane];
      const regions = [...(lane !== undefined ? [lane] : []), ...visible(this.root).filter(id => !this.isLane(id) && id !== this.idNamed("tree-preview") && id !== this.idNamed("backlinks-preview")), ...this.floats.map(f => f.id)];
      const here = this.onLanes ? lane! : this.focus;
      const i = regions.indexOf(here);
      const to = regions[(i + (k.kind === "tab" ? 1 : regions.length - 1)) % regions.length];
      if (to !== undefined) void this.runBoard("focus", {}, this.isLane(to) ? "lanes" : this.nameOf(to));
      return true;
    }
    // Layout keys work from anywhere: { } the lanes' height, < > the focused tile's width.
    if (c === "{" || c === "}") { this.tileAct("tile.resize", { by: c === "}" ? 1 : -1, axis: "col" }, "lanes"); return true; }
    if (c === "<" || c === ">") {
      if (!this.isFloat(this.focus) && this.focus !== this.idNamed("backlinks")) this.tileAct("tile.resize", { by: c === ">" ? 1 : -1, axis: "row" }, this.onLanes ? "lanes" : me);
      return true;
    }
    if (c === "t") { void this.runBoard("outline", {}); return true; }
    if (c === "T") { this.tileAct("tile.pin", {}, "tree"); return true; }
    if (c === "S") { void this.runBoard("outline", { side: "other" }); return true; }
    if (c === "b" && this.focus !== this.idNamed("backlinks")) {
      const r = this.readerForKeys();
      if (!r.msg) { this.ctx.flash("nothing in that reader to find backlinks for"); return true; }
      void this.runBoard("backlinks", { id: r.msg.id });
      return true;
    }
    if (c === "B") { this.tileAct("tile.pin", {}, "backlinks"); return true; }
    if (c === "o") { this.tileAct("tile.float", {}, this.onLanes ? "lanes" : me); return true; }
    if (k.kind === "alt" && k.ch === "c") { this.tileAct("tile.collapse", { on: false }, "all"); return true; }
    // c collapses the preview or a detail (the lanes' own c collapses a lane).
    const reader = rd && (rd === this.preview || this.detailTiles().some(d => d.pane === rd));
    // On a float too: the action says why it doesn't fold (floatRefusal).
    if (c === "c" && (reader || this.isFloat(this.focus))) { this.tileAct("tile.collapse", { on: true }, me); return true; }
    if (c === "x" && rd?.editing) { this.ctx.flash(`not closed: it holds ${sessionName(rd)} · ${shut ? "c opens it" : "e or ⏎ enters it"}`); return true; }
    // x closes a detail or a float; on the preview the same action says why it stays (its policy: closable off).
    if (c === "x" && (reader || this.isFloat(this.focus))) { this.tileAct("tile.close", {}, me); return true; }
    // Esc in a reader first lets go of a fold point selected with ( ), so ⏎ opens the note again.
    if (k.kind === "esc" && rd && !rd.holdsKeys && !shut && rd.key(k, this)) { this.redraw(); return true; }
    // q is back, as on every screen (PIE-489): the same steps as Esc, drawers and areas first, then the menu.
    if (k.kind === "esc" || c === "q") {
      const tree = this.idNamed("tree"), links = this.idNamed("backlinks");
      if (this.backlinksTyping()) return false;
      if ((this.focus === tree || this.focus === this.idNamed("tree-preview")) && !this.treePinned) { void this.runBoard("outline", { open: false }); return true; }
      if (this.focus === links && !this.linksPinned) { this.tileAct("tile.close", {}, "backlinks"); return true; }
      if (!this.onLanes) { void this.runBoard("focus", {}, "lanes"); return true; }
      if (this.treeOpen && !this.treePinned) { void this.runBoard("outline", { open: false }); return true; }
      if (this.linksOpen && !this.linksPinned) { this.tileAct("tile.close", {}, "backlinks"); return true; }
      this.pending = null; this.shellKey("screen.back");
      return true;
    }
    if (this.onLanes) return this.laneKey(k, c);
    if (shut) { if (k.kind === "char" && !k.ctrl) this.ctx.flash(`${this.labelOf(rd!)} is collapsed · c or ⏎ opens it`); return true; }
    // ⏎ or alt+⏎ in the preview that isn't on one of its elements opens its note, as on the card.
    if (rd === this.preview && !rd.holdsKeys && (k.kind === "enter" || k.kind === "alt-enter")) {
      if (!rd.key(k, this) && this.preview.msg) void this.runBoard("open", { id: this.preview.msg.id }, k.kind === "alt-enter" ? "new-detail" : "detail");
      this.redraw();
      return true;
    }
    return false;
  }
  private backlinksTyping() { return this.focus === this.idNamed("backlinks") && this.linksTile.draft !== null; }

  private laneKey(k: Key, c: string): boolean {
    const l = this.laneTile();
    if (k.kind === "left" || c === "h") { void this.runBoard("card.select", { lanes: -1 }); return true; }
    if (k.kind === "right" || c === "l") { void this.runBoard("card.select", { lanes: 1 }); return true; }
    // e, ctrl+e, i, I, C edit or open the properties of (or comment on) the selected card in the preview, which takes the keys.
    if ((c === "e" || c === "C" || c === "i" || c === "I" || (k.kind === "char" && k.ctrl && k.ch === "e")) && this.preview.msg) {
      if (this.collapsed.has(this.idNamed("preview")!)) { this.ctx.flash("the preview is collapsed · tab to its spine and c, or click it, to open it"); return true; }
      this.startIn(this.preview, sessionStart(k)!);
      return true;
    }
    if (c === "H" || c === "L") { const to = this.lanes[this.lane + (c === "H" ? -1 : 1)]; if (to) void this.runBoard("card.move", { lane: to.name }); return true; }
    if (c === "m") { this.openMover(); return true; }
    if (c === "n") { this.openCardComposer(); return true; }
    if (c === "N") { this.openChildComposer(); return true; }
    if (c === "s") { void this.openSteps(); return true; }
    if (c === "d") {
      // The second d within 5 s trashes the card the first one armed; the first arms it.
      const card = this.card(), armed = card && this.trashArm?.id === card.id && Date.now() - this.trashArm.at < 5000;
      if (armed) this.trashArm = null;
      void this.runBoard("card.trash", armed ? { confirm: card!.id, card: card!.id } : {});
      return true;
    }
    if (c === "u" && this.trashed) { void this.runBoard("card.restore", {}); return true; }
    if (c === "c" && l) { void this.runBoard("lane.collapse", { lane: l.name }); return true; }
    const id = this.laneIds()[this.lane];
    if (l && id !== undefined && this.collapsed.has(id) && (k.kind === "enter" || c === " ")) { void this.runBoard("lane.collapse", { lane: l.name, on: false }); return true; }
    const by = k.kind === "down" || c === "j" ? 1 : k.kind === "up" || c === "k" ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8 : 0;
    if (l && by) { void this.runBoard("card.select", { by }); return true; }
    if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.card(); if (m) void this.runBoard("open", { id: m.id }, k.kind === "alt-enter" ? "new-detail" : "detail"); return true; }
    if (c === "r") { void this.runBoard("board.reload", {}); return true; }
    return false;
  }

  /** The lane whose cards are drawn under the pointer (not its header or frame), and the card's row there. */
  private laneAtPoint(x: number, y: number): { i: number; lane: Lane; row: number } | null {
    const ids = this.laneIds();
    for (const [id, r] of this.hits) {
      if (x < r.col || x >= r.col + r.cols || y < r.row || y >= r.row + r.rows) continue;
      const i = ids.indexOf(id);
      if (i < 0 || this.collapsed.has(id)) return null;
      return { i, lane: this.panes.get(id) as Lane, row: y - r.row - 1 };
    }
    return null;
  }

  /**
   * The mouse over the lanes: a card pressed is selected (card.select) and can be dragged onto another lane to
   * move it there (card.move); a click on the selected card opens it on release (open); the wheel over a lane
   * moves its cursor. Everything else (headers, borders, spines, readers, drawers, floats) is the desk's.
   */
  private boardMouse(k: Extract<Key, { kind: "mouse" }>): boolean {
    const d = this.cardDrag;
    if (d && k.action === "drag") { d.over = this.laneAtPoint(k.x, k.y)?.i ?? this.laneOver(k.x, k.y); this.redraw(); return true; }
    if (d && k.action === "up") {
      this.cardDrag = null;
      // Released over another lane: move it there. Released where it started: a click (a second click opens it).
      if (d.over !== null && d.over !== d.from) { if (this.lane === d.from && this.card()?.id === d.card.id) void this.runBoard("card.move", { lane: this.lanes[d.over]!.name, card: d.card.id }); }
      else if (d.open) void this.runBoard("open", { id: d.card.id }, "detail");
      this.redraw();
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const at = this.laneAtPoint(k.x, k.y);
      if (!at || this.isFloat(this.topTileAt(k.x, k.y) ?? -1)) return false;
      void this.runBoard("card.select", { lane: at.lane.name, by: k.action === "wheel-up" ? -1 : 1, focus: false });
      return true;
    }
    if (k.action !== "down") return false;
    const at = this.laneAtPoint(k.x, k.y);
    const top = this.topTileAt(k.x, k.y);
    // Under a float or a drawer, or on a lane's header or frame: the desk's.
    if (!at || at.row < 0 || top !== this.laneIds()[at.i]) return false;
    const r = this.hits.find(([id]) => id === top)![1];
    if (k.x <= r.col || k.x >= r.col + r.cols - 1 || k.y >= r.row + r.rows - 1) return false;
    // The person leaves an edit they're in elsewhere, as a click outside it does (session.leave).
    const rd = this.personIn();
    if (rd?.editing && !this.leaveSession(rd)) return true;
    const l = at.lane, idx = l.rowAt(at.row);
    const same = this.lane === at.i && l.sel === idx && this.onLanes;
    if (idx >= 0) {
      void this.runBoard("card.select", { id: l.items![idx]!.id, lane: l.name });
      // Drag it onto another lane to move it; a click on the selected card opens it when released.
      this.cardDrag = { from: at.i, card: l.items![idx]!, over: null, open: same };
      if (this.movePlans?.failed) this.movePlans = null;
    } else void this.runBoard("card.select", { lane: l.name, by: 0 });
    // A click elsewhere lets go of a reader's selected text.
    for (const p of this.readers()) p.surface.selection = null;
    this.redraw();
    return true;
  }
  /** The lane under the pointer by its whole rectangle (its header too), while a card is dragged. */
  private laneOver(x: number, y: number): number | null {
    const ids = this.laneIds();
    const hit = this.hits.find(([id, r]) => ids.includes(id) && x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows);
    return hit ? ids.indexOf(hit[0]) : null;
  }

  private drawMover(canvas: Canvas, W: number, H: number) {
    const M = this.mover!;
    const r: Rect = { col: Math.round(W * 0.15), row: Math.round(H * 0.12), cols: Math.round(W * 0.7), rows: Math.min(H - 4, this.lanes.length * 2 + 3) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + `move · ${subject(M.card).slice(0, r.cols - 20)}`, fg(C.dark) + "enter move · esc back");
    const inner = r.cols - 2;
    this.lanes.forEach((l, i) => {
      const p = M.plans?.[i], sel = i === M.sel, y = r.row + 1 + i * 2;
      if (y + 1 >= r.row + r.rows - 1) return;
      const what = i === M.from ? fg(C.dark) + "the card's lane now"
        : !p ? fg(C.dark) + "asking the outline what would be patched…"
        : p.kind === "patch" ? fg(C.lgreen) + "-> " + describeChanges(p.changes)
        : p.kind === "already" ? fg(C.dark) + "already matches · nothing to change"
        : fg(C.lred) + "can't: " + p.reason;
      canvas.text(r.col + 1, y, (sel ? SEL : fg(C.white)) + pad(` ${sel ? ">" : " "} ${l.name}  ${fg(C.dark)}${l.read?.status === "ready" ? l.def?.props.query ?? "" : l.read?.status ?? "loading"}`, inner) + RESET, inner);
      canvas.text(r.col + 1, y + 1, pad(`     ${what}`, inner) + RESET, inner);
    });
  }

  private drawComposer(canvas: Canvas, W: number, H: number) {
    const C0 = this.composer!, d = C0.session.draft;
    const r: Rect = { col: Math.round(W * 0.18), row: Math.round(H * 0.1), cols: Math.round(W * 0.64), rows: Math.max(10, Math.round(H * 0.6)) };
    canvas.clear(r, bg(C.black));
    const title = C0.kind === "card" ? `new card · ${C0.lane.name}` : `new note under · ${titleOf(C0.parent, 40)}`;
    canvas.box(r, fg(C.yellow), fg(C.yellow) + title, fg(C.dark) + "ctrl+s create · esc back");
    const w = r.cols - 2;
    const line = (s: string, color: number) => fg(color) + pad(s, w) + RESET;
    const status = C0.kind === "card" && C0.planning ? [
      line(`asking the outline what a card in ${C0.lane.name} is born with…`, C.dark),
      line(d.note || "the first line is the title; [key::value] tokens are properties", C.dark),
    ] : C0.kind === "card" ? [
      line(`born with ${C0.born.map(p => `${p.key}=${p.value}`).join(" ") || "nothing (the lane sets no values)"}${C0.defaults.length ? ` · ${C0.defaults.map(p => `${p.key}=${p.value}`).join(" ")} unless the text says otherwise` : ""}`, C.lgreen),
      ...(C0.needs.length ? [line(`the text must also meet ${C0.needs.join(" and ")} · e.g. type [${hintToken(C0.needs[0]!)}]`, C.yellow)] : []),
      C0.parent
        ? line(`under ${C0.parent.title} · ${C0.parent.why}`, C.cyan)
        : line(`roadmap item · type ${roadmapHint(C0) || "its title"} · the allocator issues its work-id and files it in its project's work queue`, C.cyan),
      line(d.note || "the first line is the title; [key::value] tokens are properties", d.note.startsWith("not created") ? C.lred : C.dark),
    ] : [
      line(`a child note of ${titleOf(C0.parent, 60)}`, C.cyan),
      line(d.note || "the first line is the title", d.note.startsWith("not created") ? C.lred : C.dark),
    ];
    const lines = renderEditor(d, { title: C0.kind === "card" ? `new card in ${C0.lane.name}` : "new note", status, by: writtenBy(d, "save"), preview: draftPreview }, w, r.rows - 2);
    this.composerAt = r;
    lines.forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, w));
  }

  private drawSteps(canvas: Canvas, W: number, H: number) {
    const S = this.steps!;
    const items = S.read?.items ?? [];
    const r: Rect = { col: Math.round(W * 0.2), row: Math.round(H * 0.12), cols: Math.round(W * 0.6), rows: Math.min(H - 4, Math.max(6, items.length + 4)) };
    canvas.clear(r, bg(C.black));
    const done = items.filter(i => i.status === "done").length;
    canvas.box(r, fg(C.yellow), fg(C.yellow) + `steps · ${titleOf(S.card, 50)}${S.read ? ` · ${done}/${items.length} done · rev ${S.read.revision}` : ""}`, fg(C.dark) + "space done · esc back");
    const w = r.cols - 2;
    if (!S.read) { canvas.text(r.col + 1, r.row + 1, fg(C.dark) + " reading the steps…" + RESET, w); return; }
    const MARK: Record<StepStatus, string> = { todo: "[ ]", done: "[x]", waiting: "[~]", problem: "[!]" };
    const COLOR: Record<StepStatus, number> = { todo: C.white, done: C.lgreen, waiting: C.yellow, problem: C.lred };
    const room = r.rows - 3;
    const top = Math.max(0, Math.min(S.sel - room + 1, items.length - room));
    items.slice(top, top + room).forEach((it, j) => {
      const i = top + j, sel = i === S.sel;
      const text = `${"  ".repeat(it.depth)}${MARK[it.status]} ${stepText(it.text)}`;
      canvas.text(r.col + 1, r.row + 1 + j, (sel ? SEL : fg(COLOR[it.status])) + pad(` ${text}`, w) + RESET, w);
    });
    canvas.text(r.col + 1, r.row + r.rows - 2, fg(S.busy ? C.grey : C.dark) + pad(` ${S.busy ? "saving…" : S.note || "each step is changed by the service, checked against how it was read"}`, w) + RESET, w);
  }
}

/**
 * A new card's plan: born-with properties, create:: defaults, what the text must meet (the service's
 * plan, `plan`), and its parent (null: a roadmap item, placed by the allocator).
 */
interface CardPlan { born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: ParentPick | null; plan: Extract<CreatePlan, { kind: "create" }> }
/** The tokens a roadmap item still needs from the text: `[priority::high|medium|low] [arc::…] [track::…]`. */
const roadmapHint = (C0: { born: { key: string }[]; defaults: { key: string }[] }) =>
  ["project", "priority", "arc", "track"].filter(k => !C0.born.some(p => p.key === k) && !C0.defaults.some(p => p.key === k))
    .map(k => k === "priority" ? "[priority::high|medium|low]" : `[${k}::…]`).join(" ");
const recordedAs = (actor: Actor) => actor.kind === "agent" || actor.with?.length ? `agent ${[actor.kind === "agent" ? actor.id : "you", ...(actor.with ?? [])].join("+")}` : "you";

type Composer =
  | { kind: "card"; lane: Lane; planning: boolean; born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: (ParentPick & { title: string }) | null; session: DraftSession }
  | { kind: "child"; parent: Msg; session: DraftSession };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "lane";
/** A step's first line, without its list mark, checkbox and ^id. */
const stepText = (t: string) => (t.split("\n")[0] ?? "").replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX~!]\]\s*/, "").replace(/\s*\^[\w-]+\s*$/, "").trim();
/** `(project=a OR project=b)` → `project::a`: a token the person could type to meet it. */
const hintToken = (need: string) => { const m = need.match(new RegExp(`(${PROPERTY_KEY_SOURCE})=("[^"]*"|[^\\s()]+)`)); return m ? `${m[1]}::${m[2]!.replace(/^"|"$/g, "")}` : `${need.replace(/[()]/g, "")}::…`; };

const draftState = (r: ReaderPane) => {
  const d = r.draft!;
  return { id: d.blockId, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.changedElsewhere, conflict: d.conflict, savedCopy: d.savedCopy };
};

interface BoardOn {
  b: DeliveryBoard; reader?: string;
  /** The person's step change from the steps overlay: the step as it was read, so a change since is refused. */
  shown?: { item: ChecklistStep; revision: number };
}

/** What the board adds to a reader's note actions: which note is where, and moving cards. */
export const BOARD_ACTIONS = new ActionSet<{
  "open": { id: string; from?: string };
  "focus": Record<string, never>;
  "board.hub": { id?: string; close?: boolean };
  "board.reload": Record<string, never>;
  "card.select": { id?: string; lane?: string; by?: number; lanes?: number; focus?: boolean };
  "lane.collapse": { lane?: string; on?: boolean };
  "outline": { open?: boolean; side?: string };
  "card.move": { lane: string; card?: string };
  "card.create": { lane: string; text: string; parent?: string };
  "note.create": { text: string; parent?: string };
  "steps": { card?: string };
  "step.set": { step: string; status?: string; card?: string };
  "card.trash": { confirm?: string; card?: string };
  "card.restore": { id?: string };
  "composer.leave": Record<string, never>;
  "composer.close": { discard?: boolean };
  "backlinks": { id?: string; filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string };
}, BoardOn>("board", {
  "open": {
    summary: "open a note: tile=detail (default), new-detail, preview (selects its card), float, or a named reader; or, with from=<tile>, where that tile's opens land (its link, as on the desk; unlinked, the detail). An agent's naming neither (`ep0ch open <id>`) lands in a detail and leaves the person's keys where they are. A program in a tile passes from=$EP0CH_TILE", keys: "⏎, alt+⏎ (new-detail), click on the selected card, ⏎ in the outline or the backlinks",
    touches: "nothing", replay: "safe", confirms: true, places: ["detail", "new-detail", "float"], says: r => `opened a note${r.reader ? ` in ${r.reader}` : ""}`,
    args: { id: { type: "string", about: "the block id" }, from: { type: "string", optional: true, about: "open it as this tile's opens go (its link): the tile a program runs in" } },
    async run({ id, from }, { b, reader }, actor) {
      // The desk's own open from= (Desk.openFrom): the tile's link is honoured on the board as on any desk.
      // An agent naming neither (`ep0ch open <id>`): the detail, quietly (the person's keys stay where they are,
      // as on the desk); refused, said, when no detail is free. Naming a reader is asking for that one.
      return from !== undefined ? b.openFrom(id, from, actor) : b.openOnBoard(id, reader ?? "detail", actor);
    },
  },
  "focus": {
    summary: "give keys to tile=<name> (a reader, tree, backlinks, a lane's tile) or tile=lanes (a float comes to the top). An agent's is refused while the person is typing (an edit, a comment, a panel, a picker, a filter)", keys: "tab, shift+tab, click on a spine, esc q (back to the lanes)",
    touches: "screen", replay: "safe", says: r => `gave the keys to ${r.focus}`,
    args: {},
    run(_, { b, reader }, actor) {
      if (!reader) throw new ActionRefused("focus needs tile=<name> (or lanes)");
      return b.focusOn(reader);
    },
  },
  "card.select": {
    summary: "select a card: id (in lane=<name> when it's in more than one), or step from the selection: by=<cards> down its lane (negative up), lanes=<lanes> right (negative left), or lane=<name> with by. The preview follows. An agent's selection is its own: what its card actions default to, leaving the person's cursor, preview and keys where they are",
    keys: "h l j k ↑↓ ← → PgUp PgDn, click on a card, wheel over a lane",
    touches: "nothing", replay: "safe",
    args: {
      id: { type: "string", optional: true, about: "the card's block id (or its first 8+ characters)" },
      lane: { type: "string", optional: true, about: "the lane, by name: where id is, or whose cursor by moves" },
      by: { type: "number", optional: true, about: "cards to move down the lane (negative: up)" },
      lanes: { type: "number", optional: true, about: "lanes to move right (negative: left)" },
      focus: { type: "boolean", optional: true, about: "false: move that lane's cursor only, the current lane and the keys staying (the wheel over a lane); default true" },
    },
    // An agent's selection is its own (what its card actions default to): the person's lane cursor,
    // preview and keys stay where they are. The person's own card.select, through the socket as `you`, moves them.
    run(args, { b }, actor) { return b.selectBy(args, actor); },
  },
  "board.hub": {
    summary: "which board this is: with no id, the hubs it can show (every block with two or more virtual-branch lanes), and for the person the picker to choose one; with id=<hub block id>, show that board. An agent's switch is refused while the person is typing, and is said on the status bar",
    keys: "g, then j k ↑↓ and ⏎ or click on a board; esc q puts the picker away",
    touches: "screen", touchesWith: a => (a.id !== undefined ? "screen" : "nothing"), replay: "safe", says: r => (r.hub ? `showed the board ${r.title}` : null),
    args: { id: { type: "string", optional: true, about: "the hub's block id (or its first 8+ characters)" }, close: { type: "boolean", optional: true, about: "put the picker away (the person's own)" } },
    run({ id, close }, { b }, actor) {
      // Putting the picker away is the person's own (only their g opens it).
      if (close && actor.kind === "agent") throw new ActionRefused("the hub picker is the person's; an agent shows a board with board.hub id=<hub>");
      return close ? b.closePicker() : b.chooseHub(id, actor);
    },
  },
  "board.reload": {
    summary: "read every lane again from the service", keys: "r on the lanes",
    touches: "nothing", replay: "safe", says: () => "reloaded the lanes",
    args: {},
    run(_, { b }) { return b.reloadLanes(); },
  },
  "lane.collapse": {
    summary: "collapse a lane to a spine showing its name, or open it again (on=true/false; default toggles): lane=<name>, default the person's lane. Its cards stay where they are",
    keys: "c on the lanes, ⏎ or space on a collapsed lane, click on a lane's spine (the desk's tile.collapse on its tile)",
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `${r.collapsed ? "collapsed" : "opened"} the lane ${r.lane}`),
    args: { lane: { type: "string", optional: true, about: "the lane's name; default the lane the cursor is in" }, on: { type: "boolean", optional: true, about: "true collapses, false opens; default toggles" } },
    run: ({ lane, on }, { b }, actor) => b.collapseLane(lane, on, actor),
  },
  "outline": {
    summary: "the outline drawer (the desk's drawer container holding the tree over its preview): open=true opens it (the person's also gives it the keys; an agent's leaves them), open=false shuts it (pinned, it goes back into its drawer), left out toggles; side=left or right moves it, keeping its width. An agent doesn't shut it while the person is in it",
    keys: "t, S, esc q in the drawer",
    touches: "shape", replay: "safe",
    args: { open: { type: "boolean", optional: true, about: "true opens, false shuts; default toggles" }, side: { type: "string", optional: true, about: "left or right; other moves it to the other side" } },
    run: ({ open, side }, { b }, actor) => b.outlineDrawer(open, side, actor),
  },
  "card.move": {
    summary: "move the selected card (or card=<id>) into a lane, patching what the lane's query names", keys: "H L, m then ⏎, drag a card to a lane",
    touches: "draft", draft: "write", replay: "ask",
    args: { lane: { type: "string", about: "the lane's name" }, card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ lane, card }, { b }, actor) => b.moveCard(lane, card, actor),
  },
  "composer.leave": {
    summary: "leave the new card or note the person is writing, as a click outside it does: never created (ctrl+s creates); typed text is kept as unsent, and n or N brings it back. The person's own: an agent creates with card.create or note.create",
    keys: "click outside it",
    touches: "draft", draft: "leave", replay: "ask", person: "the new card or note being written is the person's; an agent doesn't close it (card.create writes its own)",
    args: {},
    run(_, { b }) { return b.leaveComposer(); },
  },
  "composer.close": {
    summary: "close the new card or note being written: unchanged, it goes; typed text needs discard=true, and is put aside as unsent (n or N brings it back). The person's own",
    keys: "esc (twice with typed text)",
    touches: "draft", draft: "leave", replay: "ask", person: "the new card or note being written is the person's; an agent doesn't close it (card.create writes its own)",
    args: { discard: { type: "boolean", optional: true, about: "put typed text aside as unsent and close" } },
    run: ({ discard }, { b }) => b.closeComposer(!!discard),
  },
  "card.create": {
    summary: "create a card in a lane: the text, born with the properties the lane's query sets (and its create:: default, unless the text sets that key), under the lane's create-parent or where its cards live. In a roadmap lane (type=roadmap-item) it's a roadmap item made by the workboard's allocator, which issues its work-id: the text gives priority, arc and track(s) as [key::value] tokens, and Review/Validate/Done lanes refuse (create in Queued or Doing, then move). Refused, with the reason, when the lane can't define it", keys: "n, typing, ctrl+s",
    touches: "nothing", replay: "ask",
    args: {
      lane: { type: "string", about: "the lane's name" },
      text: { type: "string", about: "title line and body; [key::value] tokens are properties (they must meet an OR group the lane has)" },
      parent: { type: "string", optional: true, about: "the block to create it under, instead of the lane's default" },
    },
    run: ({ lane, text, parent }, { b }, actor) => b.createCard(b.laneFor(lane), text, actor, parent),
  },
  "note.create": {
    summary: "add a note under the selected card (or parent=<id>)", keys: "N, typing, ctrl+s",
    touches: "nothing", replay: "ask",
    args: { text: { type: "string", about: "the note's text" }, parent: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ text, parent }, { b }, actor) => b.createNote(parent ?? b.selectedCardId(actor), text, actor),
  },
  "steps": {
    summary: "list a card's checklist steps (the selected card, or card=<id>)", keys: "s",
    touches: "nothing", replay: "safe",
    args: { card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ card }, { b }, actor) => b.listSteps(card, actor),
  },
  "step.set": {
    summary: "set a checklist step's status (default: toggle done / to do), checked against the step as it was read", keys: "s then space ⏎ x w !",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      step: { type: "string", about: "the step's number in `steps` (from 1), or its ^id" },
      status: { type: "string", optional: true, about: "todo, done, waiting or problem; default toggles done" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run({ step, status, card }, { b, shown }, actor) {
      if (status !== undefined && !["todo", "done", "waiting", "problem"].includes(status)) throw new ActionRefused(`status is todo, done, waiting or problem, not ${status}`);
      const n = /^\d+$/.test(step) ? Number(step) - 1 : step;
      if (typeof n === "number" && n < 0) throw new ActionRefused("steps are numbered from 1");
      return b.setStep(card ?? b.selectedCardId(actor), n, status as StepStatus | undefined, actor, shown);
    },
  },
  "card.trash": {
    summary: "move the selected card (or card=<id>) and the notes under it to Trash; confirm=<its id> is the second d. Without confirm, the person's first d arms it (a second d within 5 s trashes it, any other key keeps it); an agent always passes confirm. The service records no author for this", keys: "d d",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      confirm: { type: "string", optional: true, about: "the card's id (or its first 8+ characters): the same card, said twice" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run({ confirm, card }, { b }, actor) {
      if (confirm === undefined) {
        if (actor.kind === "agent") throw new ActionRefused("card.trash needs confirm=<the card's id>: the same card, said twice");
        return b.armTrash();
      }
      return b.trashCard(card ?? b.selectedCardId(actor), confirm, actor);
    },
  },
  "backlinks": {
    summary: "the backlinks drawer (the desk's backlinks tile in a drawer at the bottom) as Detail groups it: counts, groups with stage counts, each row. An agent's reads the person's view (or id=<block id>'s) with its own options on top and changes nothing of theirs; the person's (as=you) opens the drawer on id (following the reader that shows it) and sets their options; its rows and controls are the tile's (backlinks.pick, backlinks.view, backlinks.fold)",
    keys: "b",
    touches: "nothing", replay: "safe",
    args: {
      id: { type: "string", optional: true, about: "the note whose backlinks to read; default the drawer's" },
      filter: { type: "string", optional: true, about: "text to match, as / filters" },
      kind: { type: "string", optional: true, about: "one kind (its key or label), or all" },
      stage: { type: "string", optional: true, about: "all, open, waiting, draft, active or done" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
    },
    run: (args, { b }, actor) => b.readLinks(args, actor),
  },
  "card.restore": {
    summary: "bring back the card trashed last from this board (or id=<block id>), where it was", keys: "u",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "a Trash root's block id; default the card trashed last here" } },
    run: ({ id }, { b }, actor) => b.restoreCard(id, actor),
  },
});
