// The delivery board (PIE-511): a screen preset on the desk's one layout engine. Its lanes are query tiles in a
// columns container whose tiles come from data (the hub's views, `hub:<id>`, HUB_SOURCE); the readers row is
// the preview (following the lanes) and the details you open into; the outline tree (with its preview) is a
// drawer on the left and the backlinks (with theirs) a drawer at the bottom: the desk's drawer containers, the
// desk's floats, the desk's borders, spines and policy. What the board adds is its own: moving cards between
// lanes (drag, H L, m, `card.move`), writing new ones, steps, trash, the hub picker, and the lanes' refresh
// from the change feed. Every key and click is an action (BOARD_ACTIONS, and the desk's TILE_ and PANE_ACTIONS).
import type { Ctx, Frame } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import { USER, type Actor, type Change, type OutlineEvent } from "../socket";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, describeBacklinkView, backlinkOptionsFrom, type BacklinkViewOptions } from "../backlinks";
import { ActionRefused, ActionSet, runAsPerson, agentLabel, asActor, type ActRequest } from "../surface/actions";
import { draftPreview, leaveSaid, NOTE_ACTIONS, type OpenHow } from "../surface/note";
import { viewSummaryKeys } from "../props";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, NO_PLANNER, planMoves, type MovePlan } from "../move";
import { PROPERTY_KEY_SOURCE } from "../vendor/property-grammar";
import { wheelRows } from "../scroll";
import { Desk } from "./desk";
import { ReaderPane, sessionName, sessionStart, TreePane, type Pane, type PaneKind, type SessionKind } from "./panes";
import { PreviewPane } from "./preview";
import { BacklinksPane, BACKLINKS_ACTIONS } from "./backlinks-pane";
import { DetailPane, type LayoutSpec } from "./tiles";
import { clone, columnsOf, drawerOf, insert, leaf, leaves, node, normalise, remove, serialize, splitOf, unwrapDrawer, visible, wrapNodeDrawer, drawerToEdge, type Columns, type Dir, type LNode } from "./layout";
import { PANE_ACTIONS, type PaneDone } from "./pane-actions";
import { TREE_ACTIONS } from "./tree";
import { shellKeyOf } from "../shell-keys";
import { Draft, DRAFT_ACTIONS, tidy } from "../edit";
import { editHint, editorClick, openInEditor, renderEditor, writtenBy } from "../surface/editor";
import { Refused, type ChecklistRead, type ChecklistStep, type CreatePlan, type StepStatus } from "../socket";
import { pickParent, titleOf, type ParentPick } from "./writes";
import { findBoards, hubViews, QueryPane } from "./query";

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

const SEL = bg(C.blue) + fg(C.white);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** The tiles every board has, by name (the lanes come from its hub). */
const FIXED = ["tree", "tree-preview", "preview", "backlinks", "backlinks-preview"] as const;
/** The board's lanes policy: its tiles stay (draggable off), only query tiles join, and their opens land in the preview. */
const LANES_POLICY = { draggable: false, accepts: ["query"], opensInto: "preview" };

/**
 * The board's screen: the outline drawer (the tree over its preview) on the left, then the lanes over the readers
 * row (the preview, then the details), the backlinks drawer (the list beside its preview) at the bottom.
 */
function boardTree(ids: number[], hub: string | undefined): LNode {
  const [tree, treePv, preview, links, linksPv] = ids as [number, number, number, number, number];
  const outline = splitOf("col", [leaf(tree), leaf(treePv)], [0.6, 0.4], "outline");
  const lanes = columnsOf<number>([], { key: "lanes", ...(hub ? { source: `hub:${hub}` } : {}), policy: LANES_POLICY });
  const readers = splitOf("row", [leaf(preview)], [4], "readers");
  const backlinks = splitOf("row", [leaf(links), leaf(linksPv)], [0.5, 0.5], "links");
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
    }
    if (hubId) { const c = this.lanesNode(); if (c) c.source = `hub:${hubId}`; }
    this.focus = this.idNamed("preview") ?? this.focus;
    this.labelReaders();
  }
  /** The board's readers say what they follow: the lanes, the outline, the backlinks. */
  private labelReaders() {
    const say: [string, string][] = [["preview", "preview · follows the board"], ["tree-preview", "follows the outline"], ["backlinks-preview", "follows the backlinks"]];
    for (const [n, l] of say) { const p = this.panes.get(this.idNamed(n) ?? -1); if (p instanceof PreviewPane) p.label = l; }
  }

  /** The board as it first opens (a saved layout that didn't come back whole is put aside). */
  private freshLayout() {
    for (const p of this.panes.values()) p.dispose?.();
    this.panes.clear(); this.names.clear(); this.floats = []; this.collapsed.clear();
    const ids = [new TreePane(), new PreviewPane({ tile: "tree" }), new PreviewPane({ tile: "lanes" }), new BacklinksPane("preview"), new PreviewPane({ tile: "backlinks" })].map((p, i) => this.put(p, FIXED[i]));
    this.root = boardTree(ids, this.hubId);
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
    let root: LNode | null = clone(this.root);
    for (const id of this.detailTiles().map(d => d.id)) root = root && remove(root, id);
    const c = root ? node(root, "lanes") : null;
    if (c?.t === "columns") c.source = this.hub ? `hub:${this.hub.id}` : c.source;
    const layout: LayoutSpec | undefined = root ? { root: serialize(root, id => this.specOf(id)) } : undefined;
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
    c.source = `hub:${hub.id}`;
    if (was !== c.source) this.laneAt = null;
    await this.fillColumns(c);
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
    this.changed(e.change);
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
  private changed(c: Change) {
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
      if (id && m.id === id) {
        // The door's own save: the text is current, but its comments below still need their new offsets.
        if (c.revision !== undefined && m.revision === c.revision && !m.partial) this.refreshes.skipped++;
        else {
          this.refreshes.readers++;
          this.ctx.board.get(id).then(n => { if (n) { r.refresh(n); this.redraw(); } }, () => {});
        }
      }
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

  override unsaved() { return super.unsaved() || !!this.composer?.draft.dirty; }
  /**
   * Screen.holdsKeys: the person's keys are the board's own business right now: the desk's (an edit, a comment
   * or the property panel they're in, a filter, a ^W command), a new card or note being written, the mover or
   * steps overlay, or the hub picker. An agent doesn't move the person's screen then (agentMayMove, PIE-489).
   */
  override personTyping(): boolean {
    return super.personTyping() || this.readers().some(r => r.surface.choosing && !this.collapsed.has(this.idOf(r) ?? -1))
      || !!this.composer || !!this.steps || !!this.mover || !!this.hubPicker;
  }
  override keepDrafts() {
    const c = this.composer;
    return [...super.keepDrafts(), ...(c?.draft.dirty ? [c.draft.keep()] : [])];
  }
  override dispose() { if (this.reload) clearTimeout(this.reload); return super.dispose(); }

  /** A lane's `[summary-properties::…]` decides the summary for the cards it lists (the selected lane first). */
  summaryKeys(m: Msg): readonly string[] | null {
    const lane = [this.laneTile(), ...this.lanes].find(l => l?.items?.some(x => x.id === m.id));
    return viewSummaryKeys(lane?.def ?? undefined);
  }

  override openBlock(m: Msg) { this.current = m; this.openDetail(m, false, true); }

  // ── actions: what the keys do, by name, for agents (`ep0ch act`) ─────

  override actions() {
    const d = super.actions();
    const mine = new Set(BOARD_ACTIONS.list().map(a => a.name));
    return { ...d, actions: [...BOARD_ACTIONS.list(), ...d.actions.filter(a => !mine.has(a.name))], readers: this.boardReaders().map(r => r.name) };
  }

  override async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (BOARD_ACTIONS.has(req.action)) return BOARD_ACTIONS.runUntyped(req.action, args, { b: this, reader: req.reader }, actor);
    const reader = this.alias(req.reader, NOTE_ACTIONS.has(req.action));
    // The outline drawer's tree and the backlinks list: their rows are the ones on screen, so a shut drawer refuses.
    if (TREE_ACTIONS.has(req.action) && !this.treeOpen) throw new ActionRefused("the outline drawer is shut; t opens it");
    if (BACKLINKS_ACTIONS.has(req.action) && !this.linksOpen) throw new ActionRefused("no backlinks drawer is open; b opens it on a reader's note");
    if (NOTE_ACTIONS.has(req.action)) {
      const r = this.pickBoardReader(reader);
      // Like a shut drawer's reader: an action there would change a note where the person can't see it.
      if (this.collapsed.has(r.id)) throw new ActionRefused(`${r.name} is collapsed to a spine; reader.expand reader=${r.name} opens it first`);
      return super.act({ ...req, reader: r.name }, actor);
    }
    return super.act({ ...req, reader }, actor);
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
   * The reader an action names: by name, `detail`, `float`, `focused`, or a block id (the reader showing that
   * note, one that's editing it first). No name: the focused reader, or the preview when the lanes have focus.
   * The drawers' previews exist while their drawers are shut: an action there would change a note where the
   * person can't see it, so it's refused until the drawer is open.
   */
  private pickBoardReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.boardReaders();
    const s = this.alias(sel, true);
    let r: (typeof all)[number] | undefined;
    if (!s || s === "focused") r = all.find(x => x.id === this.focus) ?? all.find(x => x.name === "preview");
    else r = all.find(x => x.name === s);
    if (!r && s && /^[0-9a-f-]{8,}$/.test(s)) {
      const showing = all.filter(x => x.pane.msg?.id.startsWith(s));
      r = showing.find(x => x.shown && x.pane.editing) ?? showing.find(x => x.shown) ?? showing[0];
      if (!r) throw new ActionRefused(`no reader shows ${s}; open it first (open id=${s})`);
    }
    if (!r) throw new ActionRefused(`no reader ${sel} on the board; readers: ${all.map(x => x.name).join(", ")}, focused, or a block id`);
    if (!r.shown) throw new ActionRefused(`${r.name} isn't on screen; open it first (${r.name.startsWith("tree") ? "t opens the outline drawer" : r.name.startsWith("backlinks") ? "b opens a reader's backlinks" : "focus it"})`);
    return r;
  }

  /** `open`: put a note in a reader — the preview (selecting its card when a lane lists it), a detail, a new detail, or a new float. */
  async openOnBoard(id: string, where = "detail"): Promise<{ reader: string; id: string }> {
    // A card the lanes list, or a note a reader shows, opens at once (the person's ⏎ on it); any other is read first.
    const known = this.lanes.flatMap(l => l.items ?? []).find(x => x.id === id) ?? this.readers().find(r => r.msg?.id === id)?.msg;
    const m = known ?? await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    this.current = m;
    // An agent's open gives the keys to the reader it opened, unless the person is in an edit, a comment
    // or the property panel: that keeps them.
    const keep = !!this.personIn();
    let shown: ReaderPane | null = null;
    if (where === "preview") {
      // Selecting its card is the lanes moving; shown without one, it's an open into the preview (PIE-453).
      if (!this.selectCard(m.id, false)) this.preview.surface.track(() => this.preview.show(m, this));
      if (this.preview.msg?.id !== m.id) throw new ActionRefused("the preview is holding an edit or a comment on another note");
      if (!keep) this.focus = this.idNamed("preview")!;
      shown = this.preview;
    } else if (where === "detail" || where === "new-detail") {
      if (!this.openDetail(m, where === "new-detail") || this.detailTiles()[this.active]?.pane.msg?.id !== m.id)
        throw new ActionRefused("both details hold edits, comments or properties, or the person is in one · save or close one first");
      shown = this.detailTiles()[this.active]!.pane;
    } else if (where === "float") {
      const pane = shown = this.floatNote(m);
      if (!keep) this.focus = this.idOf(pane)!;
    } else {
      const r = this.pickBoardReader(where);
      if (!r.pane.surface.track(() => r.pane.show(m, this))) throw new ActionRefused(`${r.name} is holding an edit or a comment on another note`);
      if (!keep) this.focus = r.id;
      shown = r.pane;
    }
    const sid = this.idOf(shown ?? undefined);
    if (sid !== undefined && this.collapsed.delete(sid)) { shown!.folded?.(false); this.save(); }   // a note opened into a spine is meant to be seen
    this.entered.follow(this.focusedReader());
    this.redraw();
    const r = this.boardReaders().find(x => x.pane === shown) ?? this.boardReaders().find(x => x.pane.msg?.id === m.id);
    return { reader: r?.name ?? where, id: m.id };
  }

  /** A new float holding `m` (a copy of what the preview shows, or a note an agent opened as a float). */
  private floatNote(m: Msg): ReaderPane {
    const name = `detail${++this.detailCount}`;
    const pane = new BoardDetail(name);
    const id = this.put(pane, name);
    this.floats.push({ id, rect: this.newFloatRect() });
    this.startTile(id);
    pane.hold(m, this);
    return pane;
  }

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
    const said = name === "card.move";
    return runAsPerson(BOARD_ACTIONS, name, args, { b: this, reader, ...extra }, msg => { if (!said) this.ctx.flash(msg); this.redraw(); });
  }
  /** A pane operation (PANE_ACTIONS) as the person, on the tile named as `peek` names it. */
  private paneAct<K extends Parameters<typeof PANE_ACTIONS.run>[0]>(name: K, args: Parameters<typeof PANE_ACTIONS.run<K>>[1], reader: string) {
    void runAsPerson(PANE_ACTIONS, name, args, { h: this, reader }, msg => { this.ctx.flash(msg); this.redraw(); });
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
      if (actor.kind !== "agent") { this.openPicker(); return { picker: true }; }
      const found = await findBoards(this.ctx.board);
      return { current: this.hub?.id ?? null, hubs: found.map(f => ({ id: f.hub.id, title: subject(f.hub), lanes: f.lanes })) };
    }
    if (actor.kind === "agent" && this.personTyping()) throw new ActionRefused("the person is typing on the board (an edit, a comment, a picker or a filter); the board stays as it is");
    const hub = this.hubPicker?.items.find(i => i.hub.id === id || (id.length >= 8 && i.hub.id.startsWith(id)))?.hub ?? await this.ctx.board.get(id);
    if (!hub) throw new ActionRefused(`no block ${id}`);
    if ((await hubViews(this.ctx.board, hub.id)).length < 2) throw new ActionRefused(`${subject(hub)} isn't a board: it has fewer than two virtual-branch lanes`);
    await this.useHub(hub);
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} showed the board ${subject(hub)}`);
    return { hub: hub.id, title: subject(hub), lanes: this.lanes.map(l => l.name) };
  }
  /** The picker put away (esc, q): the board as it was, or with no board yet, back to the menu. */
  closePicker(actor: Actor = USER) {
    if (actor.kind === "agent") throw new ActionRefused("the hub picker is the person's; an agent shows a board with board.hub id=<hub>");
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
  reloadLanes(actor: Actor) {
    if (!this.hub) throw new ActionRefused("no board is shown yet; board.hub picks one");
    this.loadLanes();
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} reloaded the lanes`);
    this.redraw();
    return { lanes: this.lanes.map(l => l.name) };
  }

  /** `lane.collapse`: a lane to a spine, or open again (the desk's tile.collapse on the lane's tile). */
  collapseLane(name: string | undefined, on: boolean | undefined, actor: Actor) {
    const lanes = this.lanes;
    const l = name === undefined ? lanes[this.lane] : lanes.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) throw new ActionRefused(name === undefined ? "the board has no lanes yet" : `no lane ${name}; lanes: ${lanes.map(x => x.name).join(", ")}`);
    const id = this.idOf(l)!;
    const want = on ?? !this.collapsed.has(id);
    // The person's own lane folds as any lane does: the cursor stays in it.
    if (want) this.collapsed.set(id, actor.kind === "agent" ? { by: actor.id } : {}); else this.collapsed.delete(id);
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} ${want ? "collapsed" : "opened"} the lane ${l.name}`);
    this.save(); this.redraw();
    return { lane: l.name, collapsed: want };
  }
  /** A lane folded to a spine is opened (a card moved or written into it should be seen). */
  private unfold(l: Lane) { const id = this.idOf(l); if (id !== undefined && this.collapsed.delete(id)) this.save(); }

  /** `outline`: the outline drawer open or shut, and on which side. */
  outlineDrawer(open: boolean | undefined, side: string | undefined, actor: Actor) {
    const agent = actor.kind === "agent";
    const tree = this.idNamed("tree")!;
    if (side !== undefined) {
      if (side !== "left" && side !== "right" && side !== "other") throw new ActionRefused(`side is left, right or other, not ${side}`);
      const to: Dir = side === "other" ? (this.treeSide === "left" ? "right" : "left") : side;
      if (to !== this.treeSide) this.moveOutline(to, actor);
      if (open === undefined) open = true;
    }
    // The person's t: shut when it's open and theirs, else open and theirs.
    const want = open ?? (agent ? !this.treeOpen : !(this.treeOpen && this.focus === tree));
    if (!want) {
      if (agent && this.focus === tree) throw new ActionRefused("the person is in the outline drawer; an agent doesn't shut it");
      // Pinned, it goes back into its drawer, shut.
      if (this.treePinned) this.rewrapOutline(false);
      else { const d = drawerOf(this.root, tree)!; d.open = false; }
      if (this.focus === tree || this.focus === this.idNamed("tree-preview")) this.toLanes();
    } else {
      const d = drawerOf(this.root, tree);
      if (d) d.open = true;
      if (!agent && side === undefined) { this.focus = tree; this.entered.clear(); }
    }
    if (agent) this.ctx.flash(`${agentLabel(actor)} ${want ? "opened" : "shut"} the outline drawer${side ? ` on the ${this.treeSide}` : ""}`);
    this.save(); this.redraw();
    return { open: this.treeOpen, side: this.treeSide, pinned: this.treePinned };
  }
  /** The outline's split (the tree over its preview), wherever it is. */
  private outlineSplit() { return node(this.root, "outline"); }
  /** The outline (pinned or not) to the other side, keeping its width. */
  private moveOutline(to: Dir, actor: Actor) {
    const tree = this.idNamed("tree")!;
    const d = drawerOf(this.root, tree);
    if (d) { const next = drawerToEdge(this.root, d, to, 0.3); if (next) this.root = normalise(next); return; }
    // Pinned: into a drawer at that edge, then docked there again.
    this.rewrapOutline(true, to);
    const nd = drawerOf(this.root, tree);
    if (nd) this.root = normalise(unwrapDrawer(this.root, nd));
    void actor;
  }
  /** The outline's split back in a drawer (open or shut), at `edge` or where it is. */
  private rewrapOutline(open: boolean, edge?: Dir) {
    const s = this.outlineSplit();
    if (!s) return;
    const next = wrapNodeDrawer(this.root, s, edge ?? this.treeSide, open, 0.3);
    if (next) { this.root = normalise(next); const d = drawerOf(this.root, this.idNamed("tree")!); if (d) d.policy = { min: 28 }; }
  }

  /** `B`, `T`: a drawer of the board's (the outline, the backlinks) pinned into the layout, or sliding over again. */
  override pinPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone {
    const which = !sel || sel === "focused" ? (this.focus === this.idNamed("tree") || this.focus === this.idNamed("tree-preview") ? "tree" : this.focus === this.idNamed("backlinks") || this.focus === this.idNamed("backlinks-preview") ? "backlinks" : undefined) : sel.replace(/-preview$/, "");
    if (which !== "tree" && which !== "backlinks") return super.pinPane(sel, on, actor);
    const pinned = which === "tree" ? this.treePinned : this.linksPinned;
    const want = on ?? !pinned;
    if (want !== pinned) {
      if (which === "backlinks" && !this.linksOpen && actor.kind === "agent") throw new ActionRefused("the backlinks drawer isn't open; b opens it on a reader's note");
      const id = this.idNamed(which)!;
      this.refuse(this.shapeRefusal(id, `${want ? "pinning" : "unpinning"} the ${which === "tree" ? "outline" : "backlinks"} drawer`));
      if (want) { const d = drawerOf(this.root, id)!; d.open = true; this.root = normalise(unwrapDrawer(this.root, d)); }
      else if (which === "tree") this.rewrapOutline(true);
      else {
        this.rewrapLinks(true);
      }
      // Pinned with nothing in it yet, the backlinks are the focused reader's.
      if (which === "backlinks" && want && !this.linksTile.target) this.aimLinks(this.readerForKeys(), false);
      this.save(); this.redraw();
    }
    return { pane: which, pinned: want, changed: want !== pinned };
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
    const d = drawerOf(this.root, this.idNamed("backlinks")!);
    if (d) d.open = true;
    if (focus) { this.focus = this.idNamed("backlinks")!; this.entered.clear(); }
    const note = m ?? reader.msg;
    const asked = note ? L.show(note, this) : Promise.resolve();
    this.redraw();
    return asked.then(() => { if (focus) this.panes.get(this.idNamed("backlinks")!)?.focused?.(this, USER); this.redraw(); });
  }
  /** The backlinks' split back in its drawer at the bottom, staying open while the keys go elsewhere. */
  private rewrapLinks(open: boolean) {
    const s = node(this.root, "links");
    const next = s ? wrapNodeDrawer(this.root, s, "down", open, 0.36) : null;
    if (next) { this.root = normalise(next); const d = drawerOf(this.root, this.idNamed("backlinks")!); if (d) d.policy = { stays: true }; }
  }
  /** The backlinks drawer shut (it keeps what it listed). */
  private shutLinks() {
    const d = drawerOf(this.root, this.idNamed("backlinks")!);
    if (d) d.open = false;
    else this.rewrapLinks(false);
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
      composer: this.composer ? { kind: this.composer.kind, ...(this.composer.kind === "card" ? { lane: this.composer.lane.name, bornWith: this.composer.born, needs: this.composer.needs, parent: this.composer.parent } : { parent: brief(this.composer.parent) }), dirty: this.composer.draft.dirty, note: this.composer.draft.note || null } : null,
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
      if (opts.link) { this.current = m; this.openDetail(m, !!opts.fresh, !!opts.agent); return; }
      if (!opts.agent) { this.lane = i; this.follow(); }
      return this.redraw();
    }
    this.current = m;
    // alt+⏎ on a link opens a new detail; a link followed in the preview, or in a drawer's preview or list, opens
    // in a detail, as ⏎ on a card does (PIE-441). An agent's never takes the person's focus.
    const drawerTile = from === this.treePreview || from === this.linksPreview || from === this.linksTile;
    if ((from instanceof ReaderPane || from === this.linksTile) && (opts.fresh || (opts.link && (from === this.preview || drawerTile)))) { this.openDetail(m, !!opts.fresh, !!opts.agent); return; }
    // The outline's cursor (and its ⏎): its preview follows it (the desk's followers).
    if (from === this.outline || from === this.linksTile) return this.showFrom(from, m, !!opts.agent);
    if (from instanceof ReaderPane && from !== this.preview) from.show(m, this);   // links open in place
    else this.preview.follow(m, this);
    this.redraw();
  }
  /** ⏎ in the outline: the note opens in a detail. */
  override focusKind(kind: PaneKind) { if (kind === "reader" && this.current) this.openDetail(this.current, false); }
  /** The reader the person has focused; with the lanes focused, the preview following them (PIE-453). */
  override holdsFocus(pane: ReaderPane) { return pane === (this.onLanes ? this.preview : this.panes.get(this.focus)); }

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

  /** Show `m` in a detail; false (with a flash) when none could take it. `quiet`: an agent's, focus stays. */
  private openDetail(m: Msg, fresh: boolean, quiet = false): boolean {
    // The reader the person is in (an edit, a comment or the property panel), by identity: the readers row can
    // shift under it, and their keys stay with it wherever it lands.
    const keep = this.personIn();
    let details = this.detailTiles();
    // A detail holding an edit, a comment or the panel is never reused or dropped, nor the one the person is in.
    if (fresh || !details.length || details[this.active]?.pane.holdsKeys) {
      if (details.length >= 2) {
        const free = (d: ReaderPane) => !d.holdsKeys && d !== keep;
        const mine = this.panes.get(this.focus);
        // An agent's (quiet) open never replaces the detail the person has focused: it's refused instead.
        const drop = details.findIndex(d => free(d.pane) && !(quiet && d.pane === mine));
        if (drop < 0) { this.ctx.flash(quiet && details.some(d => free(d.pane)) ? "not opened: the other detail holds an edit, a comment or properties, and you have this one" : "both details hold edits, comments or properties · save or close one first"); return false; }
        this.closeId(details[drop]!.id);
      }
      const name = `detail${++this.detailCount}`;
      const pane = new BoardDetail(name);
      const id = this.put(pane, name);
      this.root = insert(this.root, "readers", leaf(id), this.detailWeight());
      this.startTile(id);
      details = this.detailTiles();
      this.active = details.length - 1;
    }
    // A detail is a reader opened on purpose: what it showed before is where back goes (PIE-453).
    const d = details[this.active]!;
    d.pane.surface.track(() => d.pane.hold(m, this));
    if (this.collapsed.delete(d.id)) { d.pane.folded?.(false); this.save(); }   // opening a note into a collapsed detail reopens it
    // Focus follows the note into its detail, unless the person is in an edit, comment or panel: it stays on
    // that reader, wherever the row moved it. An agent's never moves it.
    if (!quiet) this.focus = keep ? this.idOf(keep) ?? this.focus : d.id;
    if (!this.has(this.focus)) this.focus = d.id;
    if (!this.treePinned) { const t = drawerOf(this.root, this.idNamed("tree")!); if (t) t.open = false; }
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
   * `reader.collapse` / `reader.expand`: the preview or a detail to a spine, or open again (the desk's
   * tile.collapse, keeping what the reader holds exactly). `all` reopens every collapsed lane and reader.
   */
  collapseReader(sel: string | undefined, on: boolean, actor: Actor): { reader: string; collapsed: boolean; holds: string | null } | { reopened: string[] } {
    if (sel === "all") {
      if (on) throw new ActionRefused("reader=all only reopens (alt+c); collapse readers one by one");
      const reopened = [...this.collapsed.keys()].map(id => (this.isLane(id) ? `lane ${(this.panes.get(id) as Lane).name}` : this.nameOf(id)));
      for (const id of this.collapsed.keys()) this.panes.get(id)?.folded?.(false);
      this.collapsed.clear();
      if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} opened every collapsed lane and reader`);
      this.save(); this.redraw();
      return { reopened };
    }
    const r = this.pickReaderAny(sel);
    if (this.isFloat(r.id)) throw new ActionRefused("only the preview and details collapse; a float docks with o");
    if (r.pane === this.treePreview || r.pane === this.linksPreview) throw new ActionRefused("only the preview and details collapse; a drawer shuts");
    if (on && this.pending?.pane === r.pane) this.pending = null;              // an edit still opening there doesn't open behind a spine
    if (on && actor.kind === "agent" && r.id === this.focus) throw new ActionRefused(`the person is in ${r.name} (it has their keys); an agent doesn't collapse it`);
    this.collapseTile(r.name, on, actor);
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} ${on ? "collapsed" : "reopened"} ${this.labelOf(r.pane)}`);
    else if (on) this.ctx.flash(`${this.labelOf(r.pane)} collapsed${r.pane.holdsKeys ? `, keeping ${sessionName(r.pane)}` : ""} · c opens it`);
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
    void this.runBoard("reader.expand", {}, this.nameOf(id));
    void this.runBoard("focus", {}, this.nameOf(id));
  }

  // ── floats: the desk's (pane.float), with the board's rules for its readers ──

  /**
   * `o`: a detail pops out as a float; the preview keeps following the lanes, so a copy floats; a float docks
   * back as the last detail (taking a detail's place when both are open). The person's goes where they sent it;
   * an agent's leaves their focus on the reader they had.
   */
  override floatPane(sel: string | undefined, actor: Actor): PaneDone {
    const t = this.tileNamed(this.alias(sel ?? (this.onLanes ? undefined : this.nameOf(this.focus))), false) ?? { name: this.nameOf(this.focus), id: this.focus };
    const p = this.panes.get(t.id);
    if (this.isLane(t.id) || !(p instanceof ReaderPane) || p === this.treePreview || p === this.linksPreview) throw new ActionRefused(`${this.isLane(t.id) ? "lanes" : t.name} doesn't float; a reader does (the preview, a detail), and a float docks`);
    if (actor.kind === "agent" && t.id === this.focus) throw new ActionRefused(`${t.name} has the person's keys; an agent doesn't float it`);
    if (this.isFloat(t.id)) {
      // Docking takes a detail's place when both are open: never one holding an edit or a comment.
      const details = this.detailTiles();
      if (details.length >= 2) {
        let out = details.find(d => !d.pane.editing);
        if (!out) throw new ActionRefused("not docked: both details hold edits or comments · save or close one first");
        if (actor.kind === "agent" && out.id === this.focus) out = details.find(d => !d.pane.editing && d.id !== this.focus);
        if (!out) throw new ActionRefused("not docked: the other detail holds an edit or a comment, and the person has this one");
        this.closeId(out.id);
      }
      const r = super.floatPane(t.name, actor);
      if (actor.kind !== "agent") { this.active = this.detailTiles().findIndex(d => d.id === t.id); this.focus = t.id; }
      return r;
    }
    if (this.collapsed.has(t.id)) throw new ActionRefused("it's collapsed · c or ⏎ opens it first");
    if (!p.msg) throw new ActionRefused("focus a reader with something in it, then o to pop it out");
    if (p === this.preview) {
      const f = this.floatNote(p.msg);
      if (actor.kind !== "agent") this.focus = this.idOf(f)!;
      this.redraw();
      return { pane: t.name, floated: true, now: this.nameOf(this.idOf(f)!) };
    }
    const r = super.floatPane(t.name, actor);
    this.active = clamp(this.active, 0, Math.max(0, this.detailTiles().length - 1));
    return r;
  }
  /** A float docks as the last detail. */
  protected override dockFloat(id: number): LNode { return insert(this.root, "readers", leaf(id), this.detailWeight()); }
  /** A detail's share of the readers row as it opens: three to the preview's four. */
  private detailWeight(): number { const row = node(this.root, "readers"); return (row?.weights[0] ?? 4) * 0.75; }

  /** Close a detail or a float (`x`), the drawers shut; the lanes and the preview stay (they collapse). */
  override closePane(sel: string | undefined, actor: Actor): PaneDone {
    const s = this.alias(sel ?? (this.onLanes ? "lanes" : this.nameOf(this.focus)));
    if (sel === "lanes" || (s && this.isLane(this.tileNamed(s, false)?.id ?? -1)) || s === "preview") throw new ActionRefused(`the ${s === "preview" ? "preview stays" : "lanes stay"} on the board; c collapses ${s === "preview" ? "the preview" : "a lane"} to a spine`);
    const t = this.tile(s);
    if (actor.kind === "agent" && t.id === this.focus) throw new ActionRefused(`${t.name} has the person's keys; an agent doesn't close it`);
    if (t.name.startsWith("tree")) { const d = drawerOf(this.root, this.idNamed("tree")!); if (d) d.open = false; else this.rewrapOutline(false); if (this.focus === t.id) this.toLanes(); this.save(); this.redraw(); return { pane: "tree" }; }
    if (t.name.startsWith("backlinks")) { const keep = this.focus; this.shutLinks(); if (keep !== this.idNamed("backlinks")) this.focus = keep; this.save(); this.redraw(); return { pane: "backlinks" }; }
    const rd = this.panes.get(t.id);
    if (rd instanceof ReaderPane && rd.editing) throw new ActionRefused(`not closed: ${t.name} holds ${sessionName(rd)}`);
    const wasFocus = this.focus;
    this.closeTile(t.name, actor);
    // The person's focus goes to the detail left (or the lanes); an agent's leaves it.
    if (actor.kind !== "agent" && wasFocus === t.id) {
      const ds = this.detailTiles();
      this.active = Math.max(0, ds.length - 1);
      if (this.floats.length) this.focus = this.floats.at(-1)!.id; else if (ds.length) this.focus = ds[this.active]!.id; else this.toLanes();
    } else this.active = clamp(this.active, 0, Math.max(0, this.detailTiles().length - 1));
    this.save(); this.redraw();
    return { pane: t.name };
  }

  /** `{ }` the lanes' height, `< >` a lane's or a reader's width, the outline's width, the backlinks' height. */
  override resizePane(sel: string | undefined, axis: "row" | "col", by: number, actor: Actor): PaneDone {
    const s = this.alias(sel ?? (this.onLanes ? "lanes" : undefined));
    // A reader's height is the room the lanes leave it; the backlinks list's is its drawer's.
    const t = this.tileNamed(s, false);
    const reader = !!t && (t.name === "preview" || this.detailTiles().some(d => d.id === t.id));
    if (t && reader && axis === "col") {
      const lane = this.laneIds()[this.lane];
      if (lane === undefined) throw new ActionRefused(`${t.name}'s height is the room the lanes leave it, and there are no lanes yet`);
      super.resizePane(this.nameOf(lane), "col", -by, actor);
      return { pane: t.name, axis, by };
    }
    return super.resizePane(s, axis, by, actor);
  }

  // ── moving cards ───────────────────────────────────────────────────────────


  /** Why the selected card can't move at all right now, before any lane is considered. */
  private moveBlocked(card: Msg): string | null {
    if (this.moving) return "another move is still landing";
    // An open draft of this card keeps it where it is: the draft's base revision would go stale under
    // it. Saving or closing the edit first lets the revision checks decide in order.
    const r = this.readers().find(p => p.draft?.blockId === card.id);
    if (r) return `it's open for editing${r.draft!.dirty ? " with unsaved changes" : ""} · save (ctrl+s) or close (esc) the edit first`;
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
    const by = actor.kind === "agent" ? { by: actor.id } : {};
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
    const C0: Composer = { kind: "card", lane, planning: true, born: [], defaults: [], needs: [], parent: null, draft: new Draft(`new-${slug(lane.name)}`, 0, "") };
    // A new card put aside in this lane (esc twice, the board closed) comes back.
    C0.draft.shelf = { key: `card:${lane.name}`, back: `n in ${lane.name} brings it back`, label: `new-card-${slug(lane.name)}` };
    C0.draft.restore();
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
        else C0.draft.note = `its parent ${pick.id.slice(0, 8)} isn't in the outline; creating will be refused`;
        this.redraw();
      }, () => {});
    }, (e: Error) => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      C0.planning = false; C0.draft.note = `not created: can't create in ${lane.name}: ${e.message}`;
      if (!C0.draft.dirty) this.composer = null;                     // nothing typed yet: nothing to keep
      this.ctx.flash(`can't create in ${lane.name}: ${e.message}`);
      this.redraw();
    });
  }

  /** `N`: a note under the selected card, opened at once like `n`. */
  private openChildComposer() {
    const card = this.card();
    if (!card) return this.ctx.flash("select a card to add a note under");
    if (this.composer) return;
    this.composer = { kind: "child", parent: card, draft: new Draft(`new-under-${card.id.slice(0, 8)}`, 0, "") };
    this.composer.draft.shelf = { key: `child:${card.id}`, back: "N on the card brings it back", label: `new-note-${card.id.slice(0, 8)}` };
    this.composer.draft.restore();
    this.redraw();
  }

  private composerKey(k: Key) {
    const C0 = this.composer!, d = C0.draft;
    if (d.busy) return;
    const a = d.key(k);
    if (a === "save") void this.submitComposer();
    else if (a === "editor") openInEditor(this.ctx, d);
    else if (a === "close") { this.composer = null; if (d.closedWith) this.ctx.flash(d.closedWith, 8000); }
    this.redraw();
  }

  /**
   * The person leaves the new card or note they're writing by a click outside it: it's never created
   * (ctrl+s creates), and typed text is put aside as unsent where n or N brings it back.
   */
  leaveComposer(): { left: "nothing" | "creating" | "closed" } | { left: "kept"; keptAt: string; said: string } {
    const C0 = this.composer;
    if (!C0) return { left: "nothing" };
    const d = C0.draft;
    if (d.busy) return { left: "creating" };
    this.composer = null;
    this.redraw();
    if (!d.dirty) return { left: "closed" };
    const keptAt = d.keep();
    const what = C0.kind === "card" ? `the new card in ${C0.lane.name}` : `the new note under “${titleOf(C0.parent).slice(0, 40)}”`;
    const said = `${what} was kept as unsent, not created · ${d.shelf?.back ?? `a copy is at ${tidy(keptAt)}`}`;
    this.ctx.flash(said, 8000);
    return { left: "kept", keptAt, said };
  }

  /** Ctrl+S in the composer: create it. A refusal keeps the text, says why, and copies it to disk. */
  private async submitComposer() {
    const C0 = this.composer;
    if (!C0) return;
    const d = C0.draft;
    const by = d.recordAs(USER);
    d.saving = true; d.note = "creating…"; this.redraw();
    try {
      // The same actions an agent creates with: card.create, note.create.
      if (C0.kind === "card") await BOARD_ACTIONS.run("card.create", { lane: C0.lane.name, text: d.text, ...(C0.parent ? { parent: C0.parent.id } : {}) }, { b: this }, by);
      else await BOARD_ACTIONS.run("note.create", { text: d.text, parent: C0.parent.id }, { b: this }, by);
      if (this.composer === C0) this.composer = null;
    } catch (e) {
      d.saving = false;
      const why = e instanceof Error ? e.message : String(e);
      d.note = `not created: ${why}${d.dirty ? ` · your text is kept (and copied to ${d.copyOut(C0.kind === "card" ? `new-card-${slug(C0.lane.name)}` : `new-note-${C0.parent.id.slice(0, 8)}`)})` : ""}`;
      this.ctx.flash(`not created: ${why}`);
    } finally {
      d.saving = false;
      this.redraw();
    }
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
    this.lastWrite = { what: "create", id: m.id, result, ...(actor.kind === "agent" ? { by: actor.id } : {}) };
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
    this.lastWrite = { what: "note", id: m.id, result: `created under ${parentId.slice(0, 8)}`, ...(actor.kind === "agent" ? { by: actor.id } : {}) };
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
        BOARD_ACTIONS.run("step.set", { step: String(S.sel + 1), status, card: S.card.id }, { b: this, shown: { item: it, revision: S.read.revision } }, USER)
          .catch(e => { S.note = (e as Error).message; this.ctx.flash(`not changed: ${(e as Error).message}`); this.redraw(); });
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
      this.lastWrite = { what: "step", id: card.id, result: `step ${i + 1} ${it.status} -> ${to} · revision ${r.block.revision}`, ...(actor.kind === "agent" ? { by: actor.id } : {}) };
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
    const by = actor.kind === "agent" ? { by: actor.id } : {};
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
    this.lastWrite = { what: "restore", id: m.id, result: "restored", ...(actor.kind === "agent" ? { by: actor.id } : {}) };
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
    if (this.composer) return fg(C.dark) + " " + editHint(this.composer.draft, { save: "save", close: "back" }).replace("ctrl+s save", "ctrl+s create") + RESET;
    if (this.steps) return paint("|08 |15j k|08 step · |15space|08 done/to do · |15x|08 done · |15w|08 waiting · |15!|08 problem · |15esc|08 back · each change is checked against the step as it was read");
    return null;
  }

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
      const d = this.composer.draft, r = this.composerAt;
      if (k.action === "wheel-up" || k.action === "wheel-down") { void DRAFT_ACTIONS.run("draft.scroll", { by: wheelRows(k.action === "wheel-down" ? 1 : -1) }, d, USER); this.redraw(); return true; }
      const inside = !!r && k.x >= r.col && k.y >= r.row && k.x < r.col + r.cols && k.y < r.row + r.rows;
      const inText = !!r && k.x > r.col && k.y > r.row && k.x < r.col + r.cols - 1 && k.y < r.row + r.rows - 1;
      if (r && (k.action === "down" || k.action === "drag") && (inText || k.action === "drag") && editorClick(d, k.x - r.col - 1, k.y - r.row - 1, k.action === "drag")) { this.redraw(); return true; }
      if (k.action !== "down" || inside) return true;
      if (d.busy) { this.ctx.flash("the new card is being created · wait for it"); return true; }
      void BOARD_ACTIONS.run("composer.leave", {}, { b: this }, USER).then(r => { const said = leaveSaid(r); if (said) this.ctx.flash(said, 8000); this.redraw(); }, e => this.ctx.flash(e instanceof Error ? e.message : String(e)));
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
    if (shut && rd && (c === "c" || c === " " || k.kind === "enter")) { void this.runBoard("reader.expand", {}, me); return true; }
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
    if (c === "{" || c === "}") { this.paneAct("pane.resize", { by: c === "}" ? 1 : -1, axis: "col" }, "lanes"); return true; }
    if (c === "<" || c === ">") {
      if (!this.isFloat(this.focus) && this.focus !== this.idNamed("backlinks")) this.paneAct("pane.resize", { by: c === ">" ? 1 : -1, axis: "row" }, this.onLanes ? "lanes" : me);
      return true;
    }
    if (c === "t") { void this.runBoard("outline", {}); return true; }
    if (c === "T") { this.paneAct("pane.pin", {}, "tree"); return true; }
    if (c === "S") { void this.runBoard("outline", { side: "other" }); return true; }
    if (c === "b" && this.focus !== this.idNamed("backlinks")) {
      const r = this.readerForKeys();
      if (!r.msg) { this.ctx.flash("nothing in that reader to find backlinks for"); return true; }
      void this.runBoard("backlinks", { id: r.msg.id });
      return true;
    }
    if (c === "B") { this.paneAct("pane.pin", {}, "backlinks"); return true; }
    if (c === "o") { this.paneAct("pane.float", {}, this.onLanes ? "lanes" : me); return true; }
    if (k.kind === "alt" && k.ch === "c") { void this.runBoard("reader.expand", {}, "all"); return true; }
    // c collapses the preview or a detail (the lanes' own c collapses a lane).
    const reader = rd && (rd === this.preview || this.detailTiles().some(d => d.pane === rd));
    if (c === "c" && reader) { void this.runBoard("reader.collapse", {}, me); return true; }
    if (c === "c" && this.isFloat(this.focus)) { this.ctx.flash("a float doesn't collapse · o docks it"); return true; }
    if (c === "x" && rd?.editing) { this.ctx.flash(`not closed: it holds ${sessionName(rd)} · ${shut ? "c opens it" : "e or ⏎ enters it"}`); return true; }
    if (c === "x" && (this.detailTiles().some(d => d.id === this.focus) || this.isFloat(this.focus))) { this.paneAct("pane.close", {}, me); return true; }
    // Esc in a reader first lets go of a fold point selected with ( ), so ⏎ opens the note again.
    if (k.kind === "esc" && rd && !rd.holdsKeys && !shut && rd.key(k, this)) { this.redraw(); return true; }
    // q is back, as on every screen (PIE-489): the same steps as Esc, drawers and areas first, then the menu.
    if (k.kind === "esc" || c === "q") {
      const tree = this.idNamed("tree"), links = this.idNamed("backlinks");
      if (this.backlinksTyping()) return false;
      if ((this.focus === tree || this.focus === this.idNamed("tree-preview")) && !this.treePinned) { void this.runBoard("outline", { open: false }); return true; }
      if (this.focus === links && !this.linksPinned) { this.paneAct("pane.close", {}, "backlinks"); return true; }
      if (!this.onLanes) { void this.runBoard("focus", {}, "lanes"); return true; }
      if (this.treeOpen && !this.treePinned) { void this.runBoard("outline", { open: false }); return true; }
      if (this.linksOpen && !this.linksPinned) { this.paneAct("pane.close", {}, "backlinks"); return true; }
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
    const C0 = this.composer!, d = C0.draft;
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
  | { kind: "card"; lane: Lane; planning: boolean; born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: (ParentPick & { title: string }) | null; draft: Draft }
  | { kind: "child"; parent: Msg; draft: Draft };

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
  "open": { id: string };
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
  "reader.collapse": Record<string, never>;
  "reader.expand": Record<string, never>;
  "composer.leave": Record<string, never>;
  "backlinks": { id?: string; filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string };
}, BoardOn>("board", {
  "open": {
    summary: "open a note: reader=detail (default), new-detail, preview (selects its card), float, or a named reader", keys: "⏎, alt+⏎ (new-detail), click on the selected card, ⏎ in the outline or the backlinks",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { b, reader }, actor) {
      const r = await b.openOnBoard(id, reader ?? "detail");
      b.ctx.flash(`${agentLabel(actor)} opened a note in ${r.reader}`);
      return r;
    },
  },
  "focus": {
    summary: "give keys to reader=<name> (a reader, tree, backlinks, a lane's tile) or reader=lanes (a float comes to the top). An agent's is refused while the person is typing (an edit, a comment, a panel, a picker, a filter)", keys: "tab, shift+tab, click on a spine, esc q (back to the lanes)",
    args: {},
    run(_, { b, reader }, actor) {
      if (!reader) throw new ActionRefused("focus needs reader=<name> (or lanes)");
      // Refused only when it would move the keys of a person who is typing; focusing where they already are leaves them in it.
      if (actor.kind === "agent" && b.personTyping() && !b.focusedIs(reader)) throw new ActionRefused("the person is typing on the board (an edit, a comment, a panel, a picker or a filter); their keys stay where they are");
      const r = b.focusOn(reader);
      if (actor.kind === "agent") b.ctx.flash(`${agentLabel(actor)} gave the keys to ${r.focus}`);
      return r;
    },
  },
  "card.select": {
    summary: "select a card: id (in lane=<name> when it's in more than one), or step from the selection: by=<cards> down its lane (negative up), lanes=<lanes> right (negative left), or lane=<name> with by. The preview follows. An agent's selection is its own: what its card actions default to, leaving the person's cursor, preview and keys where they are",
    keys: "h l j k ↑↓ ← → PgUp PgDn, click on a card, wheel over a lane",
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
    args: { id: { type: "string", optional: true, about: "the hub's block id (or its first 8+ characters)" }, close: { type: "boolean", optional: true, about: "put the picker away (the person's own)" } },
    run: ({ id, close }, { b }, actor) => (close ? b.closePicker(actor) : b.chooseHub(id, actor)),
  },
  "board.reload": {
    summary: "read every lane again from the service", keys: "r on the lanes",
    args: {},
    run(_, { b }, actor) { return b.reloadLanes(actor); },
  },
  "lane.collapse": {
    summary: "collapse a lane to a spine showing its name, or open it again (on=true/false; default toggles): lane=<name>, default the person's lane. Its cards stay where they are",
    keys: "c on the lanes, ⏎ or space on a collapsed lane, click on a lane's spine (the desk's tile.collapse on its tile)",
    args: { lane: { type: "string", optional: true, about: "the lane's name; default the lane the cursor is in" }, on: { type: "boolean", optional: true, about: "true collapses, false opens; default toggles" } },
    run: ({ lane, on }, { b }, actor) => b.collapseLane(lane, on, actor),
  },
  "outline": {
    summary: "the outline drawer (the desk's drawer container holding the tree over its preview): open=true opens it (the person's also gives it the keys; an agent's leaves them), open=false shuts it (pinned, it goes back into its drawer), left out toggles; side=left or right moves it, keeping its width. An agent doesn't shut it while the person is in it",
    keys: "t, S, esc q in the drawer",
    args: { open: { type: "boolean", optional: true, about: "true opens, false shuts; default toggles" }, side: { type: "string", optional: true, about: "left or right; other moves it to the other side" } },
    run: ({ open, side }, { b }, actor) => b.outlineDrawer(open, side, actor),
  },
  "card.move": {
    summary: "move the selected card (or card=<id>) into a lane, patching what the lane's query names", keys: "H L, m then ⏎, drag a card to a lane",
    args: { lane: { type: "string", about: "the lane's name" }, card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ lane, card }, { b }, actor) => b.moveCard(lane, card, actor),
  },
  "composer.leave": {
    summary: "leave the new card or note the person is writing, as a click outside it does: never created (ctrl+s creates); typed text is kept as unsent, and n or N brings it back. The person's own: an agent creates with card.create or note.create",
    keys: "click outside it",
    args: {},
    run(_, { b }, actor) {
      if (actor.kind === "agent") throw new ActionRefused("the new card or note being written is the person's; an agent doesn't close it (card.create writes its own)");
      return b.leaveComposer();
    },
  },
  "card.create": {
    summary: "create a card in a lane: the text, born with the properties the lane's query sets (and its create:: default, unless the text sets that key), under the lane's create-parent or where its cards live. In a roadmap lane (type=roadmap-item) it's a roadmap item made by the workboard's allocator, which issues its work-id: the text gives priority, arc and track(s) as [key::value] tokens, and Review/Validate/Done lanes refuse (create in Queued or Doing, then move). Refused, with the reason, when the lane can't define it", keys: "n, typing, ctrl+s",
    args: {
      lane: { type: "string", about: "the lane's name" },
      text: { type: "string", about: "title line and body; [key::value] tokens are properties (they must meet an OR group the lane has)" },
      parent: { type: "string", optional: true, about: "the block to create it under, instead of the lane's default" },
    },
    run: ({ lane, text, parent }, { b }, actor) => b.createCard(b.laneFor(lane), text, actor, parent),
  },
  "note.create": {
    summary: "add a note under the selected card (or parent=<id>)", keys: "N, typing, ctrl+s",
    args: { text: { type: "string", about: "the note's text" }, parent: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ text, parent }, { b }, actor) => b.createNote(parent ?? b.selectedCardId(actor), text, actor),
  },
  "steps": {
    summary: "list a card's checklist steps (the selected card, or card=<id>)", keys: "s",
    args: { card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ card }, { b }, actor) => b.listSteps(card, actor),
  },
  "step.set": {
    summary: "set a checklist step's status (default: toggle done / to do), checked against the step as it was read", keys: "s then space ⏎ x w !",
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
  "reader.collapse": {
    summary: "collapse reader=<name> (the preview or a detail) to a spine showing its note's title (the desk's tile.collapse); a draft, comment or property panel in it is kept exactly. Refused for the reader the person has focused", keys: "c on a reader",
    args: {},
    run: (_, { b, reader }, actor) => b.collapseReader(reader, true, actor),
  },
  "reader.expand": {
    summary: "open a collapsed reader=<name> again, as it was; reader=all opens every collapsed reader and lane (alt+c). The person's focus stays where it is", keys: "c ⏎ space on a spine, click on the spine, alt+c",
    args: {},
    run: (_, { b, reader }, actor) => b.collapseReader(reader, false, actor),
  },
  "backlinks": {
    summary: "the backlinks drawer (the desk's backlinks tile in a drawer at the bottom) as Detail groups it: counts, groups with stage counts, each row. An agent's reads the person's view (or id=<block id>'s) with its own options on top and changes nothing of theirs; the person's (as=you) opens the drawer on id (following the reader that shows it) and sets their options; its rows and controls are the tile's (backlinks.pick, backlinks.view, backlinks.fold)",
    keys: "b",
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
    args: { id: { type: "string", optional: true, about: "a Trash root's block id; default the card trashed last here" } },
    run: ({ id }, { b }, actor) => b.restoreCard(id, actor),
  },
});
