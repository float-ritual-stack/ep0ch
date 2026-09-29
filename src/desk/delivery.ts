// Delivery board: a hub's virtual branches as lanes across the top, one shared preview,
// details you open into, floating panes you can drag above everything, an outline drawer
// (left or right, with its own mini preview) and a backlinks drawer with its own preview.
// Drawers slide over; nothing reflows unless it is pinned. Every border can be dragged.
// All of it is one layout tree (src/desk/layout.ts, PIE-412): the lanes pane over the readers row,
// the backlinks drawer under the readers, the outline drawer beside everything.
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, overflows, scrollPct, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { onMediaChange } from "../media";
import { USER, type Actor, type Change, type OutlineEvent } from "../socket";
import {
  backlinkRows, backlinkRowSuffix, backlinkStageSummary, backlinkStatusParts, backlinkView,
  DEFAULT_BACKLINK_VIEW_OPTIONS, describeBacklinkView, backlinkOptionsFrom, fitBacklinkRow, nextBacklinkKindFilter, nextBacklinkSort, nextBacklinkStageFilter,
  type BacklinkCollection, type BacklinkControl, type BacklinkRow, type BacklinkSource, type BacklinkView, type BacklinkViewOptions,
} from "../backlinks";
import { ActionRefused, ActionSet, agentLabel, asActor, type ActRequest } from "../surface/actions";
import { drawSpine, SPINE } from "../spine";
import { NOTE_ACTIONS, type OpenHow } from "../surface/note";
import { viewSummaryKeys } from "../props";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET, width } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, planMove, type MovePlan } from "../move";
import { matchesFilters, readView, type ViewRead } from "../views";
import { holds } from "../query";
import { Entered, ReaderPane, sessionName, sessionStart, startSession, TreePane, type DeskApi, type Pane, type PaneKind, type PaneView, type SessionKind } from "./panes";
import {
  MIN_COLS, MIN_ROWS, beside, describeTree, dividerAt, dragTo as dragBorder, grow, has, insert, leaf, node, placeScreen, remove, resize, share, splitOf,
  type Axis, type Divider, type Grab, type LNode, type PlacedScreen, type PlaceOpts, type ScreenLayout, type Split,
} from "./layout";
import { PANE_ACTIONS, type PaneDone, type PaneHost } from "./pane-actions";
import { Draft } from "../edit";
import { editHint, openInEditor, renderEditor, writtenBy } from "../surface/editor";
import { createMisses, planCreate } from "../move";
import { showExpr } from "../query";
import { Refused, type ChecklistRead, type ChecklistStep, type StepStatus } from "../socket";
import { composeCardText, pickParent, planRoadmapItem, scanTokens, titleOf, type ParentPick } from "./writes";

interface Lane { name: string; def: Msg; items: Msg[] | null; sel: number; top: number; read?: ViewRead; want?: string; wantVerb?: string }
interface Float { pane: ReaderPane; rect: Rect }
type Region = "lanes" | "preview" | `detail${number}` | `float${number}` | "tree" | "backlinks";
type Drag =
  /** A border of the layout tree: the grabbed side follows the pointer, within the pair's minimums and bounds. */
  | { kind: "border"; g: Grab<string>; mins: [number, number]; bounds: [number, number] }
  | { kind: "lane-edge"; a: number; b: number }
  | { kind: "float-move"; f: Float; dx: number; dy: number } | { kind: "float-size"; f: Float }
  | { kind: "card"; from: number; card: Msg; over: number | null; open: boolean }
  /** The mouse went down in a reader (PIE-419): a drag selects its text, the release is the click. */
  | { kind: "select"; pane: ReaderPane; col: number; row: number; open?: (m: Msg, how?: OpenHow) => void };
/**
 * What delivery.json keeps, in the fields it had before PIE-412 (so any door reads it). The tree is built
 * from them and they're read back from it: `laneFrac` the lanes' share, `treeFrac` and `linksFrac` the
 * drawers' (kept while a drawer is shut), `readerWeights` the readers row's weights by position (the
 * preview, detail 1, detail 2: a detail opened in a place gets that place's width). `laneWeights` are the
 * lanes pane's own columns. `previewFrac` is unused, and kept.
 */
interface Layout { laneFrac: number; previewFrac: number; treeFrac: number; linksFrac: number; treeSide: "left" | "right"; laneWeights: Record<string, number>; readerWeights: number[] }
interface Saved extends Layout {
  treePinned: boolean; linksPinned: boolean; lane: number; collapsed: string[]; hubs?: Record<string, string>;
  /** Docked readers collapsed to a spine, by name (preview, detail1, detail2). Only the preview outlives the board: details aren't saved. */
  collapsedReaders?: string[];
}

const PREFERRED = ["validate", "doing", "queued", "review", "done"];
const HIDDEN = new Set(["superseded"]);
const SEL = bg(C.blue) + fg(C.white);
const PRIORITY: Record<string, number> = { high: C.lred, medium: C.yellow, low: C.dark };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The board's sizes, in one place (PIE-412). `share`: the range a pane's share of its split stays in,
 * whatever sets it (a border drag, `pane.resize`, a saved file); `keys`: the range its keys step within
 * (the lanes' keys stop short of what a drag reaches, as they always did), by `step`. A reader's size is
 * its weight in the readers row. `min`: the fewest cells each keeps.
 */
const SIZE = {
  lanes: { share: [0.12, 0.85], keys: [0.15, 0.8], step: 0.05 },
  tree: { share: [0.15, 0.7], keys: [0.15, 0.7], step: 0.04 },
  backlinks: { share: [0.2, 0.9], keys: [0.2, 0.9], step: 0.05 },
  reader: { weight: [0.2, 20], keys: [0.5, 20], step: 0.5, fallback: 3 },
  lane: { weight: [0.3, 5], step: 0.2 },
  float: { cols: 20, rows: 5, stepCols: 4, stepRows: 2 },
  min: { lanes: 5, tree: 28, backlinks: 6, reader: 12, underLanes: 6, overLinks: 3 },
} as const satisfies Record<string, unknown>;
type Range = readonly [number, number];
const within = (v: unknown, [lo, hi]: Range, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

export class DeliveryBoard implements Screen, DeskApi, PaneHost {
  title = "delivery";
  ctx!: Ctx;
  current: Msg | null = null;
  private hub: Msg | null = null;
  private lanes: Lane[] = [];
  private lane = 0;
  private collapsed = new Set<string>();
  /**
   * Docked readers collapsed to a spine (`c`), by identity: the detail list shifts under them. A collapsed
   * reader keeps its note, draft, comment and property panel exactly as they were. `by`: the agent that
   * collapsed it. `seen`: the note's comment and reply ids when it collapsed (null until they're read),
   * so ones arriving later mark the spine.
   */
  private shut = new Map<ReaderPane, { by?: string; seen: Set<string> | null }>();
  /** Where each collapsed reader's spine was drawn, for clicks. */
  private readerSpines: { region: Region; rect: Rect }[] = [];
  private preview = new ReaderPane();
  /**
   * The board's panes on the layout tree: `lanes` over the `readers` row (the preview, then the details by
   * their ids), the `backlinks` drawer under the readers and the `tree` (outline) drawer beside it all
   * when they're open; a drawer in `over` slides over the layout instead of joining it. Floats are panes
   * with their own rectangle. Reader panes are found by id in `paneById`.
   */
  private screen: ScreenLayout<string, Float> = { root: leaf("lanes"), over: new Set(["tree", "backlinks"]), floats: [] };
  private paneById = new Map<string, ReaderPane>([["preview", this.preview]]);
  private nextPane = 1;
  /** Where the tree was placed at the last render: rects, borders and the drawers sliding over it. */
  private placedScreen: PlacedScreen<string> | null = null;
  private active = 0;                        // which detail Enter replaces
  private tree = new TreePane();
  private treePreview = new ReaderPane();
  private treeReady = false;
  /** The backlinks drawer (`b`): its note, the sources the service sent (null while asked), the selected row. */
  private linkState: { target: Msg; from: string; data: BacklinkCollection | null; sel: number; top: number; ready?: Promise<void> } | null = null;
  /**
   * The person's view of the drawer (PIE-442): Detail's options and defaults, the kind groups they opened,
   * and a filter being typed (`draft`, applied as it's typed; esc goes back to `filter`). Only the person
   * changes it: an agent's `backlinks` reads a copy.
   */
  private linkView: { options: BacklinkViewOptions; expanded: Set<string>; draft: string | null } = { options: { ...DEFAULT_BACKLINK_VIEW_OPTIONS }, expanded: new Set(), draft: null };
  private linksPreview = new ReaderPane();
  /** How many lines the drawer's status line took when last drawn: its rows start under them. */
  private linkHead = 1;
  /** The sizes delivery.json keeps (see `Layout`): read into the tree, and back out of it to save. */
  private lay: Layout = { laneFrac: 0.42, previewFrac: 0.4, treeFrac: 0.3, linksFrac: 0.45, treeSide: "left", laneWeights: {}, readerWeights: [4, 3, 3] };
  private placed: { p: Placement; layer: number }[] = [];
  private overlays: { r: Rect; layer: number }[] = [];
  private laneEdges: { a: number; b: number; x: number; rect: Rect }[] = [];
  private focus: Region = "lanes";
  /** The reader edit, comment or property panel the person is in: only that one takes their keys (PIE-411). */
  private entered = new Entered();
  /** A session the person started by key that is still opening (the note being read): Esc cancels it. */
  private pending: { pane: ReaderPane } | null = null;
  private rects = new Map<string, Rect>();   // region → rect, plus "float-title:N", splitter lines
  private laneRects: { lane: number; rect: Rect; spine: boolean }[] = [];
  private drag: Drag | null = null;
  private reload: Timer | null = null;
  private status = "looking for boards…";
  private hubs: Record<string, string> = {};          // workspace → last board hub id
  private picker: { items: { hub: Msg; lanes: number }[]; sel: number } | null = null;
  /** The move picker (`m`): every lane with what moving the selected card there would patch. */
  private mover: { card: Msg; from: number; plans: MovePlan[]; sel: number } | null = null;
  /** The card a move is patching right now; a second move waits for it. */
  private moving: string | null = null;
  private lastMove: { card: string; to: string; result: string; by?: string } | null = null;
  /** Lanes waiting to be asked again, gathered from change records and read together. */
  private dirtyLanes = new Set<Lane>();
  /** How the board has refreshed, for `peek` and tests: whole-board reloads vs lanes asked again. */
  private refreshes = { full: 0, lanes: 0, readers: 0, skipped: 0 };
  /** Names of the lanes asked again, oldest first (tests and `peek`). */
  private asked: string[] = [];
  /** A new card (`n`) or a note under a card (`N`) being written. Holds every key until created or closed. */
  private composer: Composer | null = null;
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

  /** `persist: false`: layout, collapsed lanes and the remembered hub stay in memory (the showcase's board). */
  constructor(private readonly hubId?: string, private readonly persist = true) {
    const s = readState<Partial<Saved>>("delivery.json");
    if (s) this.lay = this.checked(s);
    const lf = this.lay.laneFrac;
    this.screen.root = splitOf("col", [leaf("lanes"), splitOf("row", [leaf("preview")], [1], "readers")], [lf, 1 - lf], "board");
    this.slots("into");
    if (s) {
      this.treePinned = !!s.treePinned; this.treeOpen = !!s.treePinned; this.linksPinned = !!s.linksPinned;
      this.lane = s.lane ?? 0; this.collapsed = new Set(s.collapsed ?? []); this.hubs = s.hubs ?? {};
      if (s.collapsedReaders?.includes("preview")) this.shut.set(this.preview, { seen: null });
    }
  }

  /**
   * delivery.json as written by any door, or by hand: each size within its range (a share out of range, a
   * weight that isn't a number, a missing list all fall back or clamp), so the tree never gets a negative
   * or NaN weight.
   */
  private checked(s: Partial<Saved>): Layout {
    const d = this.lay;
    const rw = Array.isArray(s.readerWeights) ? s.readerWeights : [];
    const lw = s.laneWeights && typeof s.laneWeights === "object" ? s.laneWeights : {};
    return {
      laneFrac: within(s.laneFrac, SIZE.lanes.share, d.laneFrac),
      previewFrac: within(s.previewFrac, [0, 1], d.previewFrac),
      treeFrac: within(s.treeFrac, SIZE.tree.share, d.treeFrac),
      linksFrac: within(s.linksFrac, SIZE.backlinks.share, d.linksFrac),
      treeSide: s.treeSide === "right" ? "right" : "left",
      laneWeights: Object.fromEntries(Object.entries(lw).map(([k, v]) => [k, within(v, SIZE.lane.weight, 1)])),
      readerWeights: d.readerWeights.map((w, i) => within(rw[i], SIZE.reader.weight, w)).concat(rw.slice(d.readerWeights.length).map(w => within(w, SIZE.reader.weight, SIZE.reader.fallback))),
    };
  }

  private save() {
    if (!this.persist) return;
    for (const p of this.shut.keys()) if (this.regionOf(p) === null || this.regionOf(p)!.startsWith("float")) this.shut.delete(p);   // closed or floated
    const collapsedReaders = this.namedReaders().filter(r => this.shut.has(r.pane)).map(r => r.name);
    this.remember();
    writeState("delivery.json", { ...this.lay, treePinned: this.treePinned, linksPinned: this.linksPinned, lane: this.lane, collapsed: [...this.collapsed], hubs: this.hubs, collapsedReaders } satisfies Saved);
  }

  // ── the layout tree ────────────────────────────────────────────────────────

  /** The details, in the readers row's order (region `detail<i>`). */
  private get details(): ReaderPane[] { return this.readerIds().filter(id => id !== "preview").map(id => this.paneById.get(id)!); }
  /** The floats, bottom to top (region `float<i>`): the layout's own list. */
  private get floats(): Float[] { return this.screen.floats; }
  /** The outline drawer is open: it's in the tree. */
  private get treeOpen(): boolean { return has(this.screen.root, "tree"); }
  private set treeOpen(on: boolean) { this.drawer("tree", on); }
  /** Pinned: part of the layout; unpinned, it slides over. Kept while the drawer is shut. */
  private get treePinned(): boolean { return !this.screen.over.has("tree"); }
  private set treePinned(on: boolean) { if (on) this.screen.over.delete("tree"); else this.screen.over.add("tree"); }
  private get linksPinned(): boolean { return !this.screen.over.has("backlinks"); }
  private set linksPinned(on: boolean) { if (on) this.screen.over.delete("backlinks"); else this.screen.over.add("backlinks"); }
  /** The backlinks drawer's state; the drawer is in the tree while there is one. */
  private get links() { return this.linkState; }
  private set links(v: DeliveryBoard["linkState"]) { this.linkState = v; this.drawer("backlinks", !!v); }

  /** Open or shut a drawer: the outline beside everything (its side, its width), the backlinks under the readers. */
  private drawer(id: "tree" | "backlinks", on: boolean) {
    const root = this.screen.root;
    if (on === has(root, id)) return;
    if (!on) { this.remember(); this.screen.root = remove(root, id)!; return; }
    this.screen.root = id === "tree"
      ? beside(root, { key: "board" }, leaf("tree"), { dir: "row", before: this.lay.treeSide === "left", weight: this.lay.treeFrac })
      : beside(root, { key: "readers" }, leaf("backlinks"), { dir: "col", weight: this.lay.linksFrac });
  }

  /** Read the sizes delivery.json keeps back out of the tree (a shut drawer keeps its last width). */
  private remember() {
    const root = this.screen.root;
    this.lay.laneFrac = share(root, "lanes") ?? this.lay.laneFrac;
    this.lay.treeFrac = share(root, "tree") ?? this.lay.treeFrac;
    this.lay.linksFrac = share(root, "backlinks") ?? this.lay.linksFrac;
    this.slots("out");
  }

  /**
   * The readers row's weights belong to places, not panes (as `readerWeights` always did): after a detail
   * opens or closes, each place takes its remembered weight ("into"); after a resize, the places remember
   * the row's weights ("out").
   */
  private slots(way: "into" | "out") {
    const row = node(this.screen.root, "readers");
    if (!row) return;
    const rw = this.lay.readerWeights;
    if (way === "into") row.weights = row.kids.map((_, i) => within(rw[i], SIZE.reader.weight, SIZE.reader.fallback));
    else row.weights.forEach((w, i) => { rw[i] = w; });
  }

  private readerIds(): string[] { return (node(this.screen.root, "readers")?.kids ?? []).flatMap(k => (k.t === "leaf" ? [k.id] : [])); }
  private idOf(p: ReaderPane): string | undefined { for (const [id, x] of this.paneById) if (x === p) return id; return undefined; }
  private idFor(p: ReaderPane): string {
    const had = this.idOf(p);
    if (had) return had;
    const id = `r${this.nextPane++}`;
    this.paneById.set(id, p);
    return id;
  }

  /** A detail at the end of the readers row. */
  private addDetail(p: ReaderPane) {
    this.screen.root = insert(this.screen.root, "readers", leaf(this.idFor(p)), 3);
    this.slots("into");
  }

  /** A float over the board: the next one a little lower and to the right. */
  private addFloat(p: ReaderPane) {
    const W = this.ctx.t.cols, H = this.ctx.t.rows - 2, n = this.screen.floats.length;
    this.screen.floats.push({ pane: p, rect: { col: Math.round(W * 0.22) + n * 3, row: Math.round(H * 0.12) + n * 2, cols: Math.round(W * 0.5), rows: Math.round(H * 0.6) } });
  }

  /** Take a detail or a float off the board; `keep`: it's moving (docking or floating), so it keeps its id. */
  private dropReader(p: ReaderPane, keep = false) {
    if (p === this.preview) return;
    const id = this.idOf(p);
    if (id && this.readerIds().includes(id)) { this.screen.root = remove(this.screen.root, id)!; this.slots("into"); }
    const f = this.screen.floats.findIndex(x => x.pane === p);
    if (f >= 0) this.screen.floats.splice(f, 1);
    if (id && !keep) this.paneById.delete(id);
  }

  /**
   * Run a change to the layout for an agent, or anything else that mustn't move the person: the reader
   * they have focused keeps the focus and the detail Enter opens into stays the same one, wherever the
   * change moved them in the row or the float list.
   */
  private keepPlace<T>(fn: () => T): T {
    const was = this.focusedReader(), act = this.details[this.active];
    const out = fn();
    const at = was && this.regionOf(was);
    if (at) this.focus = at;
    const i = act ? this.details.indexOf(act) : -1;
    if (i >= 0) this.active = i;
    else this.active = clamp(this.active, 0, Math.max(0, this.details.length - 1));
    return out;
  }

  /** How the board sizes its panes: a collapsed reader is a spine; the drawers keep their widths; each pane's minimum. */
  private placeOpts(): PlaceOpts<string> {
    return {
      fixed: (id, dir) => { const p = dir === "row" ? this.paneById.get(id) : undefined; return p && this.shut.has(p) ? SPINE : undefined; },
      sized: id => id === "tree" || id === "backlinks",
      min: (n, dir, parent) => this.minOf(n, dir, parent),
    };
  }

  /** The smallest a pane gets, in cells: what the board's fixed fractions clamped to before PIE-412. */
  private minOf(n: LNode<string>, dir: Axis, parent: Split<string>): number | undefined {
    const M = SIZE.min;
    if (n.t === "leaf") {
      if (n.id === "lanes" && dir === "col") return M.lanes;
      if (n.id === "tree" && dir === "row") return M.tree;
      if (n.id === "backlinks" && dir === "col") return M.backlinks;
      if (parent.key === "readers" && dir === "row") return M.reader;
    }
    if (parent.key === "board" && parent.kids[1] === n) return M.underLanes;              // under the lanes
    if (n.t === "split" && n.key === "readers" && dir === "col") return M.overLinks;      // over a pinned backlinks drawer
    return undefined;
  }

  // ── data ───────────────────────────────────────────────────────────────────

  async enter(ctx: Ctx) {
    this.ctx = ctx;
    onMediaChange(() => this.redraw());
    try {
      const remembered = this.hubId ?? this.hubs[ctx.workspace];
      const hub = remembered ? await ctx.board.get(remembered) : null;
      if (hub) return this.useHub(hub);
      const found = await this.findBoards();
      const df = found.find(f => subject(f.hub) === "Delivery Flow");
      if (df || found.length === 1) return this.useHub((df ?? found[0]!).hub);
      if (!found.length) { this.status = "no hub with virtual-branch children here; pass --board <block-id>"; return ctx.redraw(); }
      this.picker = { items: found, sel: 0 };
      this.status = "";
    } catch (e) { this.status = String((e as Error).message); }
    ctx.redraw();
  }

  /** Every block with two or more virtual-branch children is a board. */
  private async findBoards(): Promise<{ hub: Msg; lanes: number }[]> {
    const branches = await this.ctx.board.query("type=virtual-branch", 500, "updated", "desc", true);
    const count = new Map<string, number>();
    for (const b of branches) if (b.parentId && b.props.query) count.set(b.parentId, (count.get(b.parentId) ?? 0) + 1);
    const ids = [...count].filter(([, n]) => n >= 2).map(([id]) => id);
    const hubs = await this.ctx.board.readMany(ids);
    return hubs.map(hub => ({ hub, lanes: count.get(hub.id)! })).sort((a, b) => b.hub.updatedAt - a.hub.updatedAt);
  }

  private async useHub(hub: Msg) {
    this.hub = hub; this.picker = null;
    this.hubs[this.ctx.workspace] = hub.id; this.save();
    this.title = `board · ${subject(hub)}`;
    const kids = await this.ctx.board.children(hub.id);
    const lanes = kids.filter(k => (k.props.type ?? "").toLowerCase() === "virtual-branch" && !HIDDEN.has(subject(k).toLowerCase()));
    // Stage-named lanes get the delivery order; anything else keeps the hub's own order.
    const staged = lanes.some(k => PREFERRED.slice(0, 4).includes(subject(k).toLowerCase()));
    const rank = (n: string) => { const i = PREFERRED.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
    if (staged) lanes.sort((a, b) => rank(subject(a)) - rank(subject(b)));
    this.lanes = lanes.map(k => ({ name: subject(k), def: k, items: null, sel: 0, top: 0 }));
    this.lane = clamp(this.lane, 0, Math.max(0, this.lanes.length - 1));
    this.status = "";
    this.loadLanes();
    this.ctx.redraw();
  }

  private loadLanes(which: Lane[] = this.lanes) {
    if (which === this.lanes) this.refreshes.full++; else this.refreshes.lanes += which.length;
    this.asked.push(...which.map(l => l.name));
    if (this.asked.length > 200) this.asked.splice(0, 100);
    for (const l of which) readView(this.ctx.board, l.def).then(read => {
      const items = read.items;
      l.read = read;
      const keep = l.want ?? l.items?.[l.sel]?.id;
      l.items = items;
      const at = keep ? items.findIndex(m => m.id === keep) : -1;
      if (l.want) {
        if (at < 0) this.ctx.flash(`${l.wantVerb ?? "moved"}, but ${l.name} doesn't list it${read.truncated ? ` (past its limit of ${read.limit})` : ""}`);
        l.want = undefined; l.wantVerb = undefined;
      }
      l.sel = Math.max(0, at >= 0 ? at : Math.min(l.sel, items.length - 1));
      if (l === this.lanes[this.lane]) this.follow();
      this.ctx.redraw();
    }, () => { l.items = []; });
  }

  onEvent(e: OutlineEvent) {
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
    if (this.hub) void this.relane();
    for (const r of this.readers()) {
      const m = r.msg;
      if (!m) continue;
      this.ctx.board.get(m.id).then(n => { if (n) { r.refresh(n); this.redraw(); } }, () => {});
      void r.loadComments(this);
    }
  }

  /** The hub's lanes may have been added, removed or renamed: read its children again, keeping selections. */
  private async relane() {
    const hub = this.hub;
    if (!hub) return;
    const kids = await this.ctx.board.children(hub.id).catch(() => null);
    if (!kids || this.hub !== hub) return;
    const defs = kids.filter(k => (k.props.type ?? "").toLowerCase() === "virtual-branch" && !HIDDEN.has(subject(k).toLowerCase()));
    const byId = new Map(this.lanes.map(l => [l.def.id, l]));
    const same = defs.length === this.lanes.length && defs.every(d => byId.has(d.id));
    if (!same) {
      const focused = this.lanes[this.lane]?.def.id;
      const staged = defs.some(k => PREFERRED.slice(0, 4).includes(subject(k).toLowerCase()));
      const rank = (n: string) => { const i = PREFERRED.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
      if (staged) defs.sort((a, b) => rank(subject(a)) - rank(subject(b)));
      this.lanes = defs.map(d => byId.get(d.id) ?? { name: subject(d), def: d, items: null, sel: 0, top: 0 });
      this.lane = clamp(Math.max(0, this.lanes.findIndex(l => l.def.id === focused)), 0, Math.max(0, this.lanes.length - 1));
    }
    for (const l of this.lanes) { const d = defs.find(x => x.id === l.def.id); if (d) { l.def = d; l.name = subject(d); } }
    this.loadLanes();
    this.redraw();
  }

  /**
   * One committed change (PIE-399): refresh only what it can affect.
   *   - a reader showing the block re-reads it, unless it already has that revision (the door's own save);
   *     either way an edit re-reads the note's comments, whose quoted passages may have moved;
   *     a reader with a draft is only marked "changed elsewhere", never replaced;
   *   - a comment or reply re-reads the threads of the note it belongs to, nowhere else;
   *   - a lane is asked again when the block is in it, or could now be: its properties satisfy the
   *     lane's clauses (read with blocks.read), or the lane's query is more than clauses (OR, NOT,
   *     dates) and the door can't tell. Membership itself always comes from the service;
   *   - a reorder (Tree, `domain: "view"`) re-asks only the lane it names;
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
    if (c.kind === "reorder") return this.markLanes(this.lanes.filter(l => l.def.id === id));
    if (c.parentId === this.hub.id || c.previousParentId === this.hub.id) return void this.relane();
    if (!id || c.kind === "other" || c.kind === "move" || c.kind === "delete" || c.kind === "restore" || c.kind === "purge") return this.markLanes(this.lanes);
    const own = this.lanes.filter(l => l.def.id === id);
    if (own.length) return this.markLanes(own);                       // a lane's definition or its ranks changed
    const members = this.lanes.filter(l => l.items?.some(m => m.id === id));
    this.ctx.board.readMany([id], ["properties", "revision"]).then(([m]) => {
      const may = m ? this.lanes.filter(l => !members.includes(l) && this.couldHold(l, m)) : [];
      this.markLanes([...members, ...may]);
    }, () => this.markLanes(this.lanes));
  }

  /** Could `m` belong in lane `l` now? Loose on purpose: a yes only means "ask the service". */
  private couldHold(l: Lane, m: Msg): boolean {
    const read = l.read;
    if (!read || read.status !== "ready") return false;             // an invalid lane stays invalid until its definition changes
    // OR, NOT, dates: evaluated on its properties; a range the record can't tell (no timestamps) is a maybe.
    if (read.query) return holds(read.query.expr, { properties: m.properties ?? [] }) !== false;
    if (read.unpatchable) return true;
    return !read.filters.length || matchesFilters(m.properties ?? [], read.filters);
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

  unsaved() { return this.readers().some(r => r.unsaved()) || !!this.composer?.draft.dirty; }
  keepDrafts() {
    const c = this.composer;
    return [...this.readers().flatMap(r => r.keepDrafts()), ...(c?.draft.dirty ? [c.draft.copyOut(c.kind === "card" ? `new-card-${slug(c.lane.name)}` : `new-note-${c.parent.id.slice(0, 8)}`)] : [])];
  }

  private readers(): ReaderPane[] { return [this.preview, this.treePreview, this.linksPreview, ...this.details, ...this.floats.map(f => f.pane)]; }

  /** A lane's `[summary-properties::…]` decides the summary for the cards it lists (the selected lane first). */
  summaryKeys(m: Msg): readonly string[] | null {
    const lane = [this.lanes[this.lane], ...this.lanes].find(l => l?.items?.some(x => x.id === m.id));
    return viewSummaryKeys(lane?.def);
  }

  openBlock(m: Msg) { this.current = m; this.openDetail(m, false); }

  // ── actions: what the keys do, by name, for agents (`ep0ch-door act`) ─────

  actions() { return { actions: [...BOARD_ACTIONS.list(), ...PANE_ACTIONS.list(), ...NOTE_ACTIONS.list()], readers: this.namedReaders().map(r => r.name) }; }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (BOARD_ACTIONS.has(req.action)) return BOARD_ACTIONS.runUntyped(req.action, args, { b: this, reader: req.reader }, actor);
    if (PANE_ACTIONS.has(req.action)) return PANE_ACTIONS.runUntyped(req.action, args, { h: this, reader: req.reader }, actor);
    const r = this.pickReader(req.reader);
    // Like a shut drawer's reader: an action there would change a note where the person can't see it.
    if (this.shut.has(r.pane)) throw new ActionRefused(`${r.name} is collapsed to a spine; reader.expand reader=${r.name} opens it first`);
    const out = await r.pane.act(req.action, args, this, actor);
    return { reader: r.name, ...(out && typeof out === "object" ? out : { result: out }) };
  }

  /** Every reader by the name an agent uses: preview, detail1, detail2, float1…, tree (its preview), backlinks. */
  private namedReaders(): { name: string; region: Region | null; pane: ReaderPane }[] {
    return [
      { name: "preview", region: "preview", pane: this.preview },
      ...this.details.map((pane, i) => ({ name: `detail${i + 1}`, region: `detail${i}` as Region, pane })),
      ...this.floats.map((f, i) => ({ name: `float${i + 1}`, region: `float${i}` as Region, pane: f.pane })),
      { name: "tree", region: this.treeOpen ? "tree" : null, pane: this.treePreview },
      { name: "backlinks", region: this.links ? "backlinks" : null, pane: this.linksPreview },
    ];
  }

  /**
   * The reader an action names: by name, "detail" (the one Enter opens into), "float" (the top one),
   * "focused", or a block id (the reader showing that note, one that's editing it first). No name: the
   * focused reader, or the preview when the lanes have focus.
   */
  private pickReader(sel?: string): { name: string; region: Region | null; pane: ReaderPane } {
    const r = this.findReader(sel);
    // The outline drawer's and the backlinks' readers exist while their drawers are shut. An action there
    // would change a note where the person can't see it, so it is refused until the drawer is open.
    if (!r.region) throw new ActionRefused(`${r.name} isn't on screen; open it first (${r.name === "tree" ? "t opens the outline drawer" : "b opens a reader's backlinks"})`);
    return r;
  }

  private findReader(sel?: string): { name: string; region: Region | null; pane: ReaderPane } {
    const all = this.namedReaders();
    if (!sel || sel === "focused") {
      const f = this.focus === "lanes" ? null : all.find(r => r.region === this.focus);
      return f ?? all[0]!;
    }
    if (sel === "detail") { const r = all.find(x => x.name === `detail${this.active + 1}`); if (r) return r; }
    if (sel === "float") { const r = all.filter(x => x.name.startsWith("float")).at(-1); if (r) return r; }
    const named = all.find(r => r.name === sel);
    if (named) return named;
    if (/^[0-9a-f-]{8,}$/.test(sel)) {
      const showing = all.filter(r => r.pane.msg?.id.startsWith(sel));
      const r = showing.find(x => x.region && x.pane.editing) ?? showing.find(x => x.region) ?? showing[0];
      if (r) return r;
      throw new ActionRefused(`no reader shows ${sel}; open it first (open id=${sel})`);
    }
    throw new ActionRefused(`no reader ${sel} on the board; readers: ${all.map(r => r.name).join(", ")}, focused, or a block id`);
  }

  /** `open`: put a note in a reader — the preview (selecting its card when a lane lists it), a detail, a new detail, or a new float. */
  async openIn(id: string, where = "detail"): Promise<{ reader: string; id: string }> {
    const m = await this.ctx.board.get(id);
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
      if (!keep) this.focus = "preview";
      shown = this.preview;
    } else if (where === "detail" || where === "new-detail") {
      if (!this.openDetail(m, where === "new-detail") || this.details[this.active]?.msg?.id !== m.id)
        throw new ActionRefused("both details hold edits, comments or properties, or the person is in one · save or close one first");
      shown = this.details[this.active]!;
    } else if (where === "float") {
      const pane = shown = new ReaderPane(); pane.show(m, this);
      this.addFloat(pane);
      if (keep) this.focus = this.regionOf(this.personIn()!) ?? this.focus;   // the float list moved under it
      else this.focus = `float${this.floats.length - 1}`;
    } else {
      const r = this.pickReader(where);
      if (!r.pane.surface.track(() => r.pane.show(m, this))) throw new ActionRefused(`${r.name} is holding an edit or a comment on another note`);
      if (r.region && !keep) this.focus = r.region;
      shown = r.pane;
    }
    if (shown && this.shut.delete(shown)) this.save();   // a note opened into a spine is meant to be seen
    this.entered.follow(this.focusedReader());
    this.redraw();
    // The reader it opened in (focus may have stayed with the person's).
    const r = this.namedReaders().find(x => x.pane === shown) ?? this.namedReaders().find(x => x.pane.msg?.id === m.id);
    return { reader: r?.name ?? where, id: m.id };
  }

  /** `focus`: which area keys go to — "lanes" or a reader. */
  focusOn(sel: string): { focus: string } {
    const was = this.focus;
    if (sel === "lanes") this.focus = "lanes";
    else {
      const r = this.pickReader(sel);
      if (!r.region) throw new ActionRefused(`${r.name} isn't open`);
      this.focus = r.region;
      if (r.region.startsWith("detail")) this.active = Number(r.region.slice(6));
    }
    // The person comes back to a session by moving to it: they enter it again with e or ⏎. Focusing the
    // reader they're already in moves nothing, so they stay in it.
    if (this.focus !== was) this.entered.clear();
    this.redraw();
    return { focus: sel === "lanes" ? "lanes" : this.pickReader(sel).name };
  }

  /** Select a card in the lanes (the preview follows). False when no loaded lane lists it. */
  selectCard(id: string, focus = true): boolean {
    const i = this.lanes.findIndex(l => l.items?.some(m => m.id === id || (id.length >= 8 && m.id.startsWith(id))));
    if (i < 0) return false;
    const l = this.lanes[i]!;
    this.lane = i; l.sel = l.items!.findIndex(m => m.id === id || m.id.startsWith(id));
    if (focus) this.focus = "lanes";
    this.follow(); this.redraw();
    return true;
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
    if (!card && actor.kind === "agent") card = this.cardFor(undefined, actor).id;   // its own selection, else the person's
    // An agent's move names its card without selecting it: the person's lane, selection, preview and
    // keys stay where they are. (The person's own card.move, through the socket as `you`, selects it.)
    let from = this.lane, c = this.card();
    if (card) {
      if (actor.kind === "agent") {
        from = this.lanes.findIndex(l => l.items?.some(m => m.id === card || (card.length >= 8 && m.id.startsWith(card))));
        c = from >= 0 ? this.lanes[from]!.items!.find(m => m.id === card || m.id.startsWith(card)) : undefined;
        if (!c) throw new ActionRefused(`no lane on the board lists ${card}`);
      } else if (!this.selectCard(card)) throw new ActionRefused(`no lane on the board lists ${card}`);
      else { from = this.lane; c = this.card(); }
    }
    if (!c) throw new ActionRefused("no card is selected");
    const want = lane.toLowerCase();
    const to = this.lanes.findIndex(l => l.name.toLowerCase() === want);
    if (to < 0) throw new ActionRefused(`no lane ${lane}; lanes: ${this.lanes.map(l => l.name).join(", ")}`);
    if (to === from) throw new ActionRefused(`the card is already in ${this.lanes[to]!.name}`);
    this.lastMove = null;
    await this.moveTo(to, actor, { card: c, from });
    const r = this.lastMove as DeliveryBoard["lastMove"];
    if (!r) throw new ActionRefused("not moved");
    if (r.result.startsWith("refused")) throw new ActionRefused(r.result.replace(/^refused: /, ""));
    for (const x of this.readers()) if (x.msg?.id === c.id) x.surface.noteAgent(actor, `moved this card to ${this.lanes[to]!.name}`);
    return { card: c.id, lane: this.lanes[to]!.name, result: r.result };
  }

  describe() {
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : null);
    return {
      kind: "board", hub: brief(this.hub), focus: this.focus,
      lanes: this.lanes.map((l, i) => ({ name: l.name, count: l.items?.length ?? null, status: l.read?.status, by: l.read?.by, truncated: l.read?.truncated, collapsed: this.collapsed.has(l.name), focused: i === this.lane, selected: brief(l.items?.[l.sel]) })),
      preview: brief(this.preview.msg),
      details: this.details.map((d, i) => ({ ...brief(d.msg), opensHere: i === this.active })),
      floats: this.floats.map(f => ({ ...brief(f.pane.msg), rect: f.rect })),
      tree: { open: this.treeOpen, pinned: this.treePinned, side: this.lay.treeSide, preview: brief(this.treePreview.msg) },
      layout: this.describeLayout(),
      backlinks: this.links ? { from: this.links.from, pinned: this.linksPinned, ...this.describeLinks() } : null,
      images: this.placed.length,
      moving: this.moving, lastMove: this.lastMove,
      composer: this.composer ? { kind: this.composer.kind, ...(this.composer.kind === "card" ? { lane: this.composer.lane.name, bornWith: this.composer.born, needs: this.composer.needs, parent: this.composer.parent } : { parent: brief(this.composer.parent) }), dirty: this.composer.draft.dirty, note: this.composer.draft.note || null } : null,
      steps: this.steps ? { card: brief(this.steps.card), revision: this.steps.read?.revision ?? null, selected: this.steps.sel + 1, items: this.steps.read?.items.map((it, i) => ({ n: i + 1, status: it.status, text: stepText(it.text), id: it.itemId ?? null })) ?? null, note: this.steps.note || null } : null,
      agentSelected: Object.fromEntries(this.agentCards),
      trashArmed: this.trashArm?.id ?? null, trashed: this.trashed, lastWrite: this.lastWrite,
      refreshes: { ...this.refreshes },
      views: this.lanes[0]?.read?.by ?? null,
      mover: this.mover ? { card: brief(this.mover.card), options: this.lanes.map((l, i) => ({ lane: l.name, plan: this.mover!.plans[i], selected: i === this.mover!.sel })) } : null,
      readers: this.namedReaders().filter(r => r.pane.msg).map(r => ({ name: r.name, focused: r.region === this.focus, ...r.pane.describe(), ...this.collapsedState(r.pane) })),
      collapsedReaders: this.namedReaders().filter(r => this.shut.has(r.pane)).map(r => r.name),
      editing: this.readers().filter(r => r.draft).map(r => draftState(r)),
      commenting: this.readers().filter(r => r.session).map(r => r.session!.describe()),
    };
  }

  /** The layout tree as `peek` shows it: each pane by its agent name with its share, drawers sliding over, floats. */
  private describeLayout() {
    const ids = this.readerIds();
    const name = (id: string) => {
      const i = ids.indexOf(id);
      return i === 0 ? "preview" : i > 0 ? `detail${i}` : id;
    };
    return {
      tree: describeTree(this.screen.root, name, this.placeOpts()),
      sliding: [...this.screen.over].filter(id => has(this.screen.root, id)),
      floats: this.floats.map((f, i) => ({ pane: `float${i + 1}`, rect: f.rect })),
    };
  }

  private card(): Msg | undefined { const l = this.lanes[this.lane]; return l?.items?.[l.sel]; }
  private follow() { const m = this.card(); if (m && m.id !== this.preview.msg?.id) { this.current = m; this.preview.show(m, this); } }

  // ── DeskApi: the reused tree and reader panes call back through this ───────

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    if (!m) return;
    this.current = m;
    const from = opts.from;
    // alt+⏎ on a link opens a new detail; a link followed in the preview opens in a detail, as ⏎ on a
    // card does (PIE-441). An agent's never takes the person's focus.
    if (from instanceof ReaderPane && (opts.fresh || (opts.link && from === this.preview))) { this.openDetail(m, !!opts.fresh, !!opts.agent); return; }
    if (from === this.tree) this.treePreview.show(m, this);                     // tree → its own mini preview
    else if (from instanceof ReaderPane && from !== this.preview) from.show(m, this);   // links open in place
    else this.preview.show(m, this);
    this.redraw();
  }
  focusKind(kind: PaneKind) { if (kind === "reader" && this.current) this.openDetail(this.current, false); }
  redraw() { this.ctx?.redraw(); }

  /** Start a session in a reader as the person's key does (⏎ or a click on a comment mark). */
  startSession(pane: ReaderPane, kind: SessionKind) { this.start(pane, kind); }
  /** The reader the person has focused; with the lanes focused, the preview following them (PIE-453). */
  holdsFocus(pane: ReaderPane) { return pane === (this.focus === "lanes" ? this.preview : this.focusedReader()); }

  /** Show `m` in a detail; false (with a flash) when none could take it. `quiet`: an agent's, focus stays. */
  private openDetail(m: Msg, fresh: boolean, quiet = false): boolean {
    // The reader the person is in (an edit, a comment or the property panel), by identity: the detail
    // list can shift under it, and their keys stay with it wherever it lands.
    const keep = this.personIn();
    // A detail holding an edit, a comment or the panel is never reused or dropped, nor the one the person is in.
    if (fresh || !this.details.length || this.details[this.active]?.holdsKeys) {
      if (this.details.length >= 2) {
        const free = (d: ReaderPane) => !d.holdsKeys && d !== keep;
        const mine = this.focusedReader();
        // An agent's (quiet) open never replaces the detail the person has focused: it's refused instead.
        const drop = this.details.findIndex(d => free(d) && !(quiet && d === mine));
        if (drop < 0) { this.ctx.flash(quiet && this.details.some(free) ? "not opened: the other detail holds an edit, a comment or properties, and you have this one" : "both details hold edits, comments or properties · save or close one first"); return false; }
        // An agent's (quiet) open leaves the person on the reader they had, wherever the row moved it.
        const out = this.details[drop]!;
        if (quiet) this.keepPlace(() => this.dropReader(out)); else this.dropReader(out);
      }
      this.addDetail(new ReaderPane());
      this.active = this.details.length - 1;
    }
    // A detail is a reader opened on purpose: what it showed before is where back goes (PIE-453).
    const d = this.details[this.active]!;
    d.surface.track(() => d.show(m, this));
    if (this.shut.delete(this.details[this.active]!)) this.save();   // opening a note into a collapsed detail reopens it
    // Focus follows the note into its detail, unless the person is in an edit, comment or panel: it stays
    // on that reader, wherever the list moved it.
    if (!quiet) this.focus = keep ? this.regionOf(keep) ?? this.focus : `detail${this.active}`;
    if (!this.treePinned) this.treeOpen = false;
    this.redraw();
    return true;
  }

  /**
   * The reader whose area has focus: the preview, a detail or a float. The lanes, the outline drawer and
   * the backlinks list are not readers (their previews follow them and never take keys).
   */
  private focusedReader(): ReaderPane | null {
    const f = this.focus;
    return f === "preview" || f.startsWith("detail") || f.startsWith("float") ? this.readerFor(f)?.pane ?? null : null;
  }
  /** The focused reader, when the person is in its edit, comment or property panel. */
  private personIn(): ReaderPane | null { const p = this.focusedReader(); return p?.holdsKeys && this.entered.in(p) ? p : null; }
  /**
   * A click inside the reader the person is editing in, in its surface's cells: a completion candidate, or
   * false. Only where that reader is on top: a float or drawer drawn over the popup keeps the click.
   */
  private clickIn(p: ReaderPane, k: { x: number; y: number }): boolean {
    const region = this.regionOf(p);
    const r = region?.startsWith("float") ? this.floats[Number(region.slice(5))]?.rect : region ? this.rects.get(region) : undefined;
    if (!r || this.topAt(k.x, k.y) !== region) return false;
    const x = k.x - r.col - 1, y = k.y - r.row - 1;
    return x >= 0 && y >= 0 && x < r.cols - 2 && y < r.rows - 2 && p.click(x, y, this);
  }

  /**
   * What is drawn on top at a cell, in the order `mouse` hit-tests: a float, then an open drawer (its
   * preview included), then the docked readers. "covered" for a drawer's preview, which isn't an area.
   */
  private topAt(x: number, y: number): Region | "covered" | null {
    const inside = (r?: Rect) => !!r && x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows;
    const f = [...this.floats.keys()].reverse().find(i => inside(this.floats[i]!.rect));
    if (f !== undefined) return `float${f}` as Region;
    if ((this.treeOpen && inside(this.rects.get("tree-preview"))) || (this.links && inside(this.rects.get("links-preview")))) return "covered";
    if (this.treeOpen && inside(this.rects.get("tree"))) return "tree";
    if (this.links && inside(this.rects.get("backlinks"))) return "backlinks";
    return (["preview", ...this.details.map((_, i) => `detail${i}`)] as Region[]).find(r => inside(this.rects.get(r))) ?? null;
  }

  /** Where a docked or floating reader is now. */
  private regionOf(p: ReaderPane): Region | null {
    if (p === this.preview) return "preview";
    const d = this.details.indexOf(p);
    if (d >= 0) return `detail${d}`;
    const f = this.floats.findIndex(x => x.pane === p);
    return f >= 0 ? `float${f}` : null;
  }

  /**
   * The person's key starts an edit, a comment or the property panel in `pane`: the keys go there at once
   * (focus moves to it), and it is theirs once it opens, if they still want it by then: esc, or moving
   * to another area, while the note is read means it doesn't open.
   */
  private start(pane: ReaderPane, kind: SessionKind) {
    const region = this.regionOf(pane);
    if (!region || !pane.msg) return;
    this.focus = region;
    if (region.startsWith("detail")) this.active = Number(region.slice(6));
    if (pane.holdsKeys) return this.enterSession(pane);   // one is open already (an agent's): e enters it
    // Esc, or leaving the board, while the note is read cancels it: the token is cleared and nothing opens.
    const token = { pane: pane };
    this.pending = token;
    const still = () => this.pending === token && this.focusedReader() === pane;
    const opened = (open: boolean) => {
      const want = still();
      if (this.pending === token) this.pending = null;
      if (open && want) { this.entered.enter(pane); this.ctx.flash(`${this.labelOf(pane)} · ${pane.surface.state()} · ${pane.hint()}`); }
      this.redraw();
    };
    this.redraw();
    const r = startSession(pane, kind, this, still);
    // A thread list whose comments are already read opens at once: the next key is already its.
    if (r === true || pane.sessionOf()) opened(true);
    else r.then(opened, e => this.ctx.flash(e instanceof Error ? e.message : String(e)));
  }

  /** e or ⏎ on a reader holding a session the person isn't in: now they are. */
  private enterSession(pane: ReaderPane) {
    this.entered.enter(pane);
    this.ctx.flash(`in ${sessionName(pane)} · ${pane.hint()}`);
    this.redraw();
  }

  private labelOf(p: ReaderPane): string { const r = this.regionOf(p); return (r && this.readerFor(r)?.label) ?? "reader"; }

  private readerFor(r: Region): { pane: ReaderPane; label: string } | null {
    if (r === "preview" || r === "lanes") return { pane: this.preview, label: "preview" };
    if (r === "tree") return { pane: this.treePreview, label: "outline preview" };
    if (r === "backlinks") return { pane: this.linksPreview, label: "backlink preview" };
    if (r.startsWith("detail")) { const i = Number(r.slice(6)); const p = this.details[i]; return p ? { pane: p, label: `detail ${i + 1}` } : null; }
    if (r.startsWith("float")) { const i = Number(r.slice(5)); const f = this.floats[i]; return f ? { pane: f.pane, label: `float ${i + 1}` } : null; }
    return null;
  }

  private showLinks(r: Region) {
    const rd = this.readerFor(r) ?? this.readerFor("preview");
    const m = rd?.pane.msg;
    if (!rd || !m) return this.ctx.flash("nothing in that reader to find backlinks for");
    this.openLinks(m, rd.label);
  }

  /** The drawer on `m`'s backlinks. Resolves once the service has answered. */
  private openLinks(m: Msg, from: string): Promise<void> {
    // Another note: its own filter, kind and open groups; sort, stage and the hide toggles stay (as Detail does).
    if (this.links?.target.id !== m.id) this.linkView = { options: { ...this.linkView.options, filter: "", kind: null }, expanded: new Set(), draft: null };
    const links: NonNullable<DeliveryBoard["links"]> = { target: m, from, data: null, sel: 0, top: 0 };
    this.links = links;
    this.linksPreview.show(null, this);
    this.focus = "backlinks";
    const asked = this.ctx.board.backlinks(m.id).then(data => {
      links.data = data;
      // The first source drawn, not a group's header: ⏎ opens it, as it did before there were groups.
      if (this.links === links) links.sel = Math.max(0, this.linkRows().findIndex(row => row.kind === "source"));
      this.previewLink(); this.redraw();
    }, e => { links.data = { targetBlockId: m.id, sources: [], completeness: { kind: "complete" } }; this.ctx.flash(String(e.message)); });
    links.ready = asked;
    this.redraw();
    return asked;
  }

  /** The drawer's view for `peek`: what the person sees, row by row. */
  private describeLinks() {
    const L = this.links!, o = this.linkOptions();
    const brief = { id: L.target.id, title: subject(L.target) };
    if (!L.data) return { target: brief, loading: true };
    return { target: brief, ...describeBacklinkView(this.linkViewNow(), o, this.linkView.expanded, L.sel), typing: this.linkView.draft };
  }

  /**
   * `backlinks` from the control socket. The person's (as=you) sets their drawer's options, opening it on
   * `id` first, and so does what the keys and clicks do. An agent's reads the same view (the person's
   * options, with its own on top) and changes nothing the person sees but the status bar saying so.
   */
  async readLinks(args: { id?: string; filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string }, actor: Actor) {
    const { id, ...want } = args;
    const same = !id || this.links?.target.id === id || (id.length >= 8 && !!this.links?.target.id.startsWith(id));
    if (!id && !this.links) throw new ActionRefused("no backlinks drawer is open; id=<block id> reads a note's backlinks (b opens the drawer on a reader's note)");
    const target = same ? this.links!.target : await this.ctx.board.get(id!);
    if (!target) throw new ActionRefused(`no block ${id}`);
    const kindsOf = (data: BacklinkCollection | null, o: BacklinkViewOptions) => backlinkView(data, { ...o, kind: null }).kinds;
    const parse = (base: BacklinkViewOptions, data: BacklinkCollection | null) => { try { return backlinkOptionsFrom(base, want, kindsOf(data, base)); } catch (e) { throw new ActionRefused((e as Error).message); } };
    if (actor.kind !== "agent") {
      if (!same || !this.links) await this.openLinks(target, "act");
      else if (!this.links.data) await this.links.ready;
      const next = parse(this.linkView.options, this.links!.data);
      this.linkView.draft = null;
      this.changeLinks(() => { this.linkView.options = next; });
      return { backlinks: this.describeLinks() };
    }
    const data = same && this.links?.data ? this.links.data : await this.ctx.board.backlinks(target.id);
    // The person's options carry over only for the note they're looking at; another note starts as Detail's.
    const base = same ? { ...this.linkOptions() } : { ...DEFAULT_BACKLINK_VIEW_OPTIONS, sortField: this.linkView.options.sortField, sortDirection: this.linkView.options.sortDirection };
    const o = parse(base, data);
    this.ctx.flash(`${agentLabel(actor)} read the backlinks of ${subject(target).slice(0, 40)}`);
    return { backlinks: { target: { id: target.id, title: subject(target) }, ...describeBacklinkView(backlinkView(data, o), o, same ? this.linkView.expanded : new Set()) } };
  }

  /** The person's options, with a filter being typed applied as it's typed. */
  private linkOptions(): BacklinkViewOptions {
    const v = this.linkView;
    return v.draft === null ? v.options : { ...v.options, filter: v.draft.trim() };
  }
  private linkViewNow(): BacklinkView { return backlinkView(this.links?.data ?? null, this.linkOptions()); }
  private linkRows(): BacklinkRow[] { return this.links?.data ? backlinkRows(this.linkViewNow(), this.linkOptions(), this.linkView.expanded) : []; }
  private linkRow(): BacklinkRow | undefined { return this.links ? this.linkRows()[this.links.sel] : undefined; }
  private linkSource(): BacklinkSource | undefined { const r = this.linkRow(); return r?.kind === "source" ? r.source : undefined; }

  /**
   * Change the person's backlink view, keeping the selected row where it still shows (else the first
   * source). Keys, clicks on the status line and group headers, and the person's own `backlinks` act all
   * come here.
   */
  private changeLinks(change: () => string | void) {
    const L = this.links;
    const was = L ? rowKey(this.linkRows()[L.sel]) : undefined;
    const said = change();
    if (L) {
      const rows = this.linkRows(), kept = rows.findIndex(r => rowKey(r) === was);
      L.sel = kept >= 0 ? kept : Math.max(0, rows.findIndex(r => r.kind === "source"));
      this.previewLink();
    }
    if (said) this.ctx.flash(said);
    this.redraw();
  }

  /** One control: the same for its key, a click on it in the status line, and `backlinks` from the person. */
  private linkControl(c: BacklinkControl) {
    const o = this.linkView.options;
    // A click on the filter being typed keeps what's typed; otherwise it starts from the kept filter.
    if (c === "filter") { this.linkView.draft ??= o.filter; return this.redraw(); }
    this.changeLinks(() => {
      if (c === "sort") { [o.sortField, o.sortDirection] = nextBacklinkSort(o.sortField, o.sortDirection); return `backlinks sorted by ${o.sortField} ${o.sortDirection === "asc" ? "↑" : "↓"}`; }
      if (c === "kind") {
        const kinds = this.linkViewNow().kinds;
        if (!this.linkViewNow().faceted) return "nothing to pick: this service sends no backlink kinds";
        o.kind = nextBacklinkKindFilter(o.kind, kinds);
        return o.kind ? `backlinks: only ${kinds.find(k => k.kind === o.kind)?.label ?? o.kind}` : "backlinks: every kind";
      }
      if (c === "stage") { o.stage = nextBacklinkStageFilter(o.stage); return o.stage === "all" ? "backlinks: every stage" : `backlinks: only ${o.stage}`; }
      if (c === "resolved") { o.showResolved = !o.showResolved; return o.showResolved ? "showing resolved comments" : "hiding resolved comments"; }
      if (c === "related") { o.showRelated = !o.showRelated; return o.showRelated ? "showing this note and its descendants" : "hiding this note and its descendants"; }
    });
  }

  /** Open or fold a kind group (its header's ⏎, . or click). A narrowing filter opens every group, as in Detail. */
  private toggleLinkGroup(kind: string) {
    const o = this.linkOptions();
    if (o.filter !== "" || o.kind !== null || o.stage !== "all") return this.ctx.flash("every group is open while filtering · clear the filter, kind and stage to fold them");
    this.changeLinks(() => { const e = this.linkView.expanded; if (e.has(kind)) e.delete(kind); else e.add(kind); });
  }

  /**
   * A click in a reader's frame at `r`: to the surface, in its own cells (`skip`: rows above the pane in
   * the frame, the backlink preview's quote). A link clicked in a drawer's preview opens in a detail.
   */
  private clickReader(pane: ReaderPane, r: Rect, k: { x: number; y: number }, skip = 0) {
    const x = k.x - r.col - 1, y = k.y - r.row - 1 - skip;
    if (x < 0 || y < 0 || x >= r.cols - 2 || y >= r.rows - 2 - skip) return;
    const drawer = pane === this.treePreview || pane === this.linksPreview;
    // Decided on release: a click (a link opens, a heading folds…), or a drag that selected text.
    this.drag = { kind: "select", pane, col: r.col + 1, row: r.row + 1 + skip, open: drawer ? (m, how) => { this.current = m; this.openDetail(m, !!how?.fresh); } : undefined };
    pane.press(x, y, this);
  }

  /** The backlink source `id` in a detail (the list's click, like ⏎), read whole first. */
  private openLink(id: string, fresh = false) {
    this.ctx.board.get(id).then(m => { if (m) { this.current = m; this.openDetail(m, fresh); } else this.ctx.flash("that source isn't in the outline any more"); },
      (e: Error) => this.ctx.flash(`couldn't read the source: ${e.message}`));
  }

  private previewLink() {
    const b = this.linkSource();
    if (!b || b.blockId === this.linksPreview.msg?.id) return;
    this.ctx.board.get(b.blockId).then(m => { if (m && this.linkSource()?.blockId === m.id) { this.linksPreview.show(m, this); this.redraw(); } }, () => {});
  }

  /** `o`: pop the focused reader out as a floating pane, or dock a floating one back as a detail. */
  private popOut() { const why = this.floatOrDock(this.focus, USER); if (why) this.ctx.flash(why); }

  /**
   * Pop `region` out as a float (a detail moves; the preview and the drawers' previews keep following, so a
   * copy floats), or dock a float back as the last detail. The person's goes where they sent it; an agent's
   * leaves their focus on the reader they had. The reason, when it can't.
   */
  private floatOrDock(f: Region, actor: Actor): string | null {
    const agent = actor.kind === "agent";
    if (f.startsWith("float")) {
      const fl = this.floats[Number(f.slice(5))];
      if (!fl) return `no ${f}`;
      // Docking takes a detail's place when both are open: never one holding an edit or a comment.
      let out: ReaderPane | undefined;
      if (this.details.length >= 2) {
        out = this.details.find(d => !d.editing);
        if (!out) return "not docked: both details hold edits or comments · save or close one first";
        if (agent && out === this.focusedReader()) out = this.details.find(d => !d.editing && d !== this.focusedReader());
        if (!out) return "not docked: the other detail holds an edit or a comment, and the person has this one";
      }
      const dock = () => { if (out) this.dropReader(out); this.dropReader(fl.pane, true); this.addDetail(fl.pane); };
      if (agent) this.keepPlace(dock);
      else { dock(); this.active = this.details.length - 1; this.focus = `detail${this.active}`; }
      this.redraw();
      return null;
    }
    const rd = this.readerFor(f);
    if (rd && this.shut.has(rd.pane)) return "it's collapsed · c or ⏎ opens it first";
    if (!rd?.pane.msg) return "focus a reader with something in it, then o to pop it out";
    const pop = () => {
      let pane: ReaderPane;
      if (f.startsWith("detail")) { pane = rd.pane; this.dropReader(pane, true); this.active = Math.max(0, this.details.length - 1); }
      else { pane = new ReaderPane(); pane.show(rd.pane.msg, this); }            // preview and drawer previews keep following; float a copy
      this.addFloat(pane);
    };
    if (agent) this.keepPlace(pop);
    else { pop(); this.focus = `float${this.floats.length - 1}`; }
    this.redraw();
    return null;
  }

  // ── collapsed readers ──────────────────────────────────────────────────────

  /** The note's comment and reply ids as the reader last read them, or null before they're read. */
  private commentIds(p: ReaderPane): Set<string> | null {
    return p.comments ? new Set(p.comments.flatMap(t => [t.id, ...t.replies.map(r => r.id)])) : null;
  }

  /** Comments or replies that arrived since `p` collapsed. */
  private newComments(p: ReaderPane): number {
    const s = this.shut.get(p);
    if (!s) return 0;
    const now = this.commentIds(p);
    if (!now) return 0;
    if (!s.seen) { s.seen = now; return 0; }                     // read for the first time while collapsed: the baseline
    return [...now].filter(id => !s.seen!.has(id)).length;
  }

  /**
   * Collapse a docked reader (the preview or a detail) to a spine, or reopen it: `c`, a click on its
   * spine, and `reader.collapse` / `reader.expand` all come here. Nothing in the reader changes: a draft,
   * a comment being written or the property panel is kept exactly, never saved or dropped, and reopening
   * shows it again. The freed width goes to the other readers. An agent never collapses the reader the
   * person has focused (they may be in it), and its reopen never moves their focus.
   */
  private setShut(pane: ReaderPane, on: boolean, actor: Actor = USER): string | null {
    const region = this.regionOf(pane);
    if (!region || region.startsWith("float")) return "only the preview and details collapse; a float docks with o";
    const agent = actor.kind === "agent";
    if (on === this.shut.has(pane)) return null;
    if (on) {
      if (agent && pane === this.focusedReader()) return `the person is in ${this.labelOf(pane)} (it has their keys); an agent doesn't collapse it`;
      if (this.pending?.pane === pane) this.pending = null;              // an edit still opening there doesn't open behind a spine
      this.shut.set(pane, { ...(agent ? { by: actor.id } : {}), seen: this.commentIds(pane) });
    } else this.shut.delete(pane);
    this.save();
    this.redraw();
    return null;
  }

  /** `reader.collapse` / `reader.expand`: the named reader (default the focused one, or the preview). */
  collapseReader(sel: string | undefined, on: boolean, actor: Actor): { reader: string; collapsed: boolean; holds: string | null } | { reopened: string[] } {
    if (sel === "all") {
      if (on) throw new ActionRefused("reader=all only reopens (alt+c); collapse readers one by one");
      const reopened = [...this.namedReaders().filter(r => this.shut.has(r.pane)).map(r => r.name), ...[...this.collapsed].map(n => `lane ${n}`)];
      this.reopenAll();
      if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} opened every collapsed lane and reader`);
      return { reopened };
    }
    const r = this.pickReader(sel);
    const why = this.setShut(r.pane, on, actor);
    if (why) throw new ActionRefused(why);
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} ${on ? "collapsed" : "reopened"} ${this.labelOf(r.pane)}`);
    return { reader: r.name, collapsed: this.shut.has(r.pane), holds: r.pane.surface.state() };
  }

  /** How `peek` shows a reader's spine: collapsed, by which agent, and comments that arrived since. */
  private collapsedState(p: ReaderPane) {
    const s = this.shut.get(p);
    return s ? { collapsed: true, ...(s.by ? { collapsedBy: s.by } : {}), newComments: this.newComments(p) } : { collapsed: false };
  }

  /** alt+c: every collapsed lane and reader opens again. */
  private reopenAll() {
    this.collapsed.clear(); this.shut.clear();
    this.save(); this.redraw();
  }

  /** A collapsed reader's spine: its note's title, what it holds (✎ edit, ¶ comment, ≡ properties) and new comments (■). */
  private drawReaderSpine(canvas: Canvas, r: Rect, region: Region, pane: ReaderPane, label: string) {
    const on = this.focus === region, s = pane.surface;
    const hold = s.draft ? "✎" : s.session ? "¶" : s.panel ? "≡" : "";
    const marks = [hold ? fg(C.yellow) + hold + RESET : fg(C.dark) + "·" + RESET];
    if (this.newComments(pane)) marks.push(fg(C.yellow) + "■" + RESET);
    const title = pane.msg ? subject(pane.msg) : label;
    const p = drawSpine(canvas, r, { key: `reader-spine:${region}`, title, colour: on ? C.white : C.cyan, marks, cellStyle: on ? SEL : undefined }, this.ctx);
    if (p) this.placed.push({ layer: 0, p });
    this.readerSpines.push({ region, rect: r });
  }

  private raise(i: number) {
    const [f] = this.screen.floats.splice(i, 1);
    this.screen.floats.push(f!);
    this.focus = `float${this.floats.length - 1}`;
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
    const plan = planMove(card, target);
    if (plan.kind === "refused") { this.lastMove = { card: card.id, to: target.name, result: `refused: ${plan.reason}`, ...by }; return ctx.flash(`can't move to ${target.name}: ${plan.reason}`); }
    if (plan.kind === "already") {
      if (person) { this.lane = to; target.want = card.id; }
      this.loadLanes();
      this.lastMove = { card: card.id, to: target.name, result: "already there", ...by };
      return ctx.flash(`already in ${target.name} · nothing to change`);
    }
    this.moving = card.id; this.status = `${actor.kind === "agent" ? `${agentLabel(actor)} is ` : ""}moving to ${target.name}...`; this.redraw();
    let landed = false;
    try {
      const m = await applyMove(this.ctx.board, card, plan.changes, actor);
      const also = this.lanes.filter((l, i) => i !== to && l.read?.status === "ready" && (l.read.query ? holds(l.read.query.expr, { properties: m.properties ?? [], createdAt: m.createdAt, updatedAt: m.updatedAt }) === true : l.read.filters.length && matchesFilters(m.properties ?? [], l.read.filters))).map(l => l.name);
      this.lastMove = { card: card.id, to: target.name, result: `moved: ${describeChanges(plan.changes)} · revision ${m.revision}`, ...by };
      ctx.flash(`moved to ${target.name} · ${describeChanges(plan.changes)}${also.length ? ` · still in ${also.join(", ")} too` : ""}`);
      for (const r of this.readers()) r.refresh({ ...m, childIds: r.msg?.id === m.id ? r.msg.childIds : m.childIds });
      if (person) {
        if (this.lane === from) this.lane = to;           // follow the card unless the user already went elsewhere
        target.want = card.id;
        if (this.collapsed.delete(target.name)) this.save();   // a card moved into a spine should still be seen
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
    const plans = this.lanes.map(l => planMove(card, l));
    const first = plans.findIndex((p, i) => i !== this.lane && p.kind === "patch");
    this.mover = { card, from: this.lane, plans, sel: first >= 0 ? first : this.lane };
    this.redraw();
  }

  private moverKey(k: Key, c: string) {
    const M = this.mover!;
    if (k.kind === "down" || c === "j") M.sel = Math.min(this.lanes.length - 1, M.sel + 1);
    else if (k.kind === "up" || c === "k") M.sel = Math.max(0, M.sel - 1);
    else if (k.kind === "esc" || c === "m" || c === "q") this.mover = null;
    else if (k.kind === "enter") {
      this.mover = null;
      if (this.card()?.id !== M.card.id || this.lane !== M.from) return this.ctx.flash("the selection changed · not moved");
      void this.moveTo(M.sel);
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
  private cardPlan(lane: Lane, parent?: string): CardPlan {
    const plan = planCreate(lane);
    if (plan.kind === "refused") throw new ActionRefused(plan.reason);
    const needs = plan.needs.map(t => showExpr(t, true));
    if (plan.roadmap) {
      if (this.ctx.board.hasRoadmapAllocator() === false)
        throw new ActionRefused(`${lane.name} lists roadmap items, which are made by the workboard's allocator (roadmap.items.create), and this outline doesn't have it; create them in the outliner`);
      if (parent) throw new ActionRefused(`${lane.name} lists roadmap items: the workboard's allocator puts them under their project's work queue, so parent= can't be chosen`);
      return { born: plan.props, defaults: plan.defaults, needs, parent: null };
    }
    const where = parent ? { id: parent, why: "named by the caller" } : pickParent(lane.name, lane.def, lane.items ?? [], this.lanes.flatMap(l => l.items ?? []));
    if ("refused" in where) throw new ActionRefused(where.refused);
    return { born: plan.props, defaults: plan.defaults, needs, parent: where };
  }

  /**
   * `n`: a new card in the focused lane, written in a composer over the board. It opens at once, so what
   * is typed next is the card's text, never board keys; the parent's title is filled in when it's read.
   */
  private openCardComposer() {
    const lane = this.lanes[this.lane];
    if (!lane || this.composer) return;
    let plan: ReturnType<DeliveryBoard["cardPlan"]>;
    try { plan = this.cardPlan(lane); } catch (e) { return this.ctx.flash(`can't create in ${lane.name}: ${(e as Error).message}`); }
    const pick = plan.parent;
    const C0: Composer = { kind: "card", lane, born: plan.born, defaults: plan.defaults, needs: plan.needs, parent: pick ? { ...pick, title: pick.id.slice(0, 8) } : null, draft: new Draft(`new-${slug(lane.name)}`, 0, "") };
    this.composer = C0;
    this.redraw();
    if (pick) this.ctx.board.get(pick.id).then(parent => {
      if (this.composer !== C0 || C0.kind !== "card" || !C0.parent) return;
      if (parent) C0.parent.title = titleOf(parent);
      else C0.draft.note = `its parent ${pick.id.slice(0, 8)} isn't in the outline; creating will be refused`;
      this.redraw();
    }, () => {});
  }

  /** `N`: a note under the selected card, opened at once like `n`. */
  private openChildComposer() {
    const card = this.card();
    if (!card) return this.ctx.flash("select a card to add a note under");
    if (this.composer) return;
    this.composer = { kind: "child", parent: card, draft: new Draft(`new-under-${card.id.slice(0, 8)}`, 0, "") };
    this.redraw();
  }

  private composerKey(k: Key) {
    const C0 = this.composer!, d = C0.draft;
    if (d.busy) return;
    const a = d.key(k);
    if (a === "save") void this.submitComposer();
    else if (a === "editor") openInEditor(this.ctx, d);
    else if (a === "close") this.composer = null;
    this.redraw();
  }

  /** Ctrl+S in the composer: create it. A refusal keeps the text, says why, and copies it to disk. */
  private async submitComposer() {
    const C0 = this.composer;
    if (!C0) return;
    const d = C0.draft;
    const by = d.recordAs(USER);
    d.saving = true; d.note = "creating…"; this.redraw();
    try {
      if (C0.kind === "card") await this.createCard(C0.lane, d.text, by, C0.parent?.id);
      else await this.createNote(C0.parent.id, d.text, by);
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
    const plan = this.cardPlan(lane, parent);
    if (!plan.parent) return this.createItem(lane, body, actor, plan);
    const board = this.ctx.board;
    const typed = await board.previewPropertyList(body);
    const composed = composeCardText(body, plan.born, typed, plan.defaults);
    if ("refused" in composed) throw new ActionRefused(composed.refused);
    const final = typed ? await board.previewPropertyList(composed.text) : null;
    if (final) { const miss = createMisses(lane, final); if (miss) throw new ActionRefused(miss); }
    else if (plan.needs.length) throw new ActionRefused(`${lane.name} needs ${plan.needs.join(" and ")}, and this service can't preview properties, so the door can't check the text meets it; give the lane a [create::key=value]`);
    const m = await this.landCreate(plan.parent.id, composed.text, actor);
    const seen = typed ?? scanTokens(body);
    const bornWith = [...plan.born, ...plan.defaults.filter(p => !seen.some(t => t.key === p.key))];   // a default the text didn't override
    this.created(lane, m, actor, `created in ${lane.name} · ${titleOf(m)}${bornWith.length ? ` · born with ${bornWith.map(p => `${p.key}=${p.value}`).join(" ")}` : ""}`, `created in ${lane.name} under ${plan.parent.id.slice(0, 8)}`);
    return { id: m.id, lane: lane.name, parent: plan.parent.id, text: m.text, bornWith: bornWith.map(p => `${p.key}=${p.value}`), recordedAs: recordedAs(actor) };
  }

  /**
   * A roadmap item in a roadmap lane, through the workboard's allocator (`roadmap.items.create`), never
   * a plain create: it issues the work-id and puts the item under its project's one active work queue.
   * Its fields come from the typed tokens, the lane's plain clauses and its create:: default
   * (planRoadmapItem); the item as it will be is checked against the lane's whole query first. Not
   * retried: a lost answer is looked for among the project's newest items.
   */
  private async createItem(lane: Lane, body: string, actor: Actor, plan: CardPlan) {
    const board = this.ctx.board;
    const typed = await board.previewPropertyList(body);
    const item = planRoadmapItem(lane.name, body, plan.born, plan.defaults, typed);
    if ("refused" in item) throw new ActionRefused(item.refused);
    const miss = createMisses(lane, item.props);
    if (miss) throw new ActionRefused(miss);
    const since = Date.now();
    let made: { workId: string; workQueueId: string; block: Msg } | null;
    try { made = await board.createRoadmapItem(item.input, actor); }
    catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.findItem(item.input.project, item.input.title, since).catch(() => null);
      if (!found) throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such item is there yet; the outcome is unknown, so look before creating it again`);
      made = { workId: found.props["work-id"] ?? "", workQueueId: found.parentId ?? "", block: found };
    }
    if (!made) throw new ActionRefused(`${lane.name} lists roadmap items, which are made by the workboard's allocator (roadmap.items.create), and this outline doesn't have it; create them in the outliner`);
    const m = made.block;
    const fields = [`priority=${item.input.priority}`, `arc=${item.input.arc}`, ...item.input.tracks.map(t => `track=${t}`), `project=${item.input.project}`];
    this.created(lane, m, actor, `created ${made.workId} in ${lane.name} · ${item.input.title.slice(0, 50)} · ${fields.join(" ")}`, `created ${made.workId} in ${lane.name} under its work queue ${made.workQueueId.slice(0, 8)}`);
    return { id: m.id, workId: made.workId, lane: lane.name, parent: made.workQueueId, text: m.text, bornWith: item.props.filter(p => ["type", "work-stage", "project", "priority", "arc", "track", "work-batch"].includes(p.key)).map(p => `${p.key}=${p.value}`), recordedAs: recordedAs(actor) };
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
      this.lane = this.lanes.indexOf(lane); this.focus = "lanes";
      if (this.collapsed.delete(lane.name)) this.save();
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
        void this.setStep(S.card.id, S.sel, status, USER, { item: it, revision: S.read.revision }).catch(e => { S.note = (e as Error).message; this.ctx.flash(`not changed: ${(e as Error).message}`); this.redraw(); });
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

  /** `d`: the first press arms, a second within five seconds trashes. */
  private async armTrash() {
    const card = this.card();
    if (!card) return this.ctx.flash("select a card to trash");
    if (this.trashArm?.id === card.id && Date.now() - this.trashArm.at < 5000) {
      this.trashArm = null;
      return void this.trashCard(card.id, card.id, USER).catch(e => this.ctx.flash(`not trashed: ${(e as Error).message}`));
    }
    const blocked = this.moveBlocked(card);
    if (blocked) return this.ctx.flash(`not trashed: ${blocked}`);
    this.trashArm = { id: card.id, at: Date.now() };
    const fresh = await this.ctx.board.get(card.id).catch(() => null);
    const kids = fresh?.childIds.length ?? 0;
    if (this.trashArm?.id === card.id) this.ctx.flash(`d again trashes "${titleOf(card)}"${kids ? ` and the ${kids} note${kids === 1 ? "" : "s"} under it` : ""} · any other key keeps it`);
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

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols: W, rows } = ctx.t;
    const H = rows - 2;
    const canvas = new Canvas(W, rows - 1);
    this.rects.clear();
    this.placed = []; this.overlays = []; this.readerSpines = [];
    // The layout tree, placed: the docked panes, then where each drawer sliding over them goes.
    const P = this.placedScreen = placeScreen(this.screen, { col: 0, row: 0, cols: W, rows: H }, this.placeOpts());
    const at = (id: string) => P.rects.get(id) ?? P.over.get(id)?.rect;

    // Lanes across the top.
    const lanesR = at("lanes")!;
    this.drawLanes(canvas, lanesR);
    this.rects.set("split:lanes", { col: lanesR.col, row: lanesR.row + lanesR.rows, cols: lanesR.cols, rows: 1 });

    // Docked readers: the shared preview plus up to two details. A collapsed one is a spine; the others
    // share what's left by their weights, as the lanes do.
    const docked = this.readerIds().map((id, i) => {
      const pane = this.paneById.get(id)!;
      const label = i === 0 ? "preview · follows the board" : `detail ${i}${this.details.length > 1 && i - 1 === this.active ? " · ⏎ opens here" : ""}`;
      return { region: (i === 0 ? "preview" : `detail${i - 1}`) as Region, pane, label, r: at(id)! };
    });
    let x = P.nodes.get("readers")?.col ?? lanesR.col;
    for (const d of docked) {
      if (this.shut.has(d.pane)) this.drawReaderSpine(canvas, d.r, d.region, d.pane, d.label);
      else this.drawReader(canvas, d.r, d.region, d.pane, d.label, undefined, 0);
      x = d.r.col + d.r.cols;
    }
    const row = P.nodes.get("readers");
    if (row && docked.every(d => this.shut.has(d.pane)))
      canvas.text(x + 1, row.row + 1, fg(C.dark) + "every reader is collapsed · c ⏎ or a click on a spine opens one · alt+c opens them all" + RESET, Math.max(0, row.col + row.cols - x - 2));

    // Backlinks drawer spans every reader; overlays unless pinned.
    if (this.links) {
      const r = at("backlinks")!;
      if (!this.linksPinned) this.overlays.push({ r, layer: 1 });
      this.drawLinks(canvas, r);
      this.rects.set("split:links", { col: r.col, row: r.row, cols: r.cols, rows: 1 });
    }
    // Outline drawer on the left or right, sliding over unless pinned.
    if (this.treeOpen) {
      const r = at("tree")!;
      if (!this.treePinned) this.overlays.push({ r: { ...r, cols: r.cols + 1 }, layer: 2 });
      this.drawTree(canvas, r, !this.treePinned);
      this.rects.set("split:tree", { col: this.lay.treeSide === "left" ? r.col + r.cols - 1 : r.col, row: 0, cols: 1, rows: H });
    }
    if (this.picker) this.drawPicker(canvas, W, H);
    if (this.mover) this.drawMover(canvas, W, H);
    if (this.steps) this.drawSteps(canvas, W, H);
    if (this.composer) this.drawComposer(canvas, W, H);
    // Floating panes last, in z-order.
    this.floats.forEach((f, i) => { this.overlays.push({ r: { ...f.rect, cols: f.rect.cols + 1, rows: f.rect.rows + 1 }, layer: 3 + i }); this.drawFloat(canvas, f, i, W, H); });

    canvas.text(0, rows - 2, this.hints(W), W);
    // Kitty images sit under text but above cell backgrounds, so anything a drawer or float covers is left out.
    const hit = (a: Rect, b: Rect) => a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows;
    const placements = this.placed.filter(({ p, layer }) => !this.overlays.some(o => o.layer > layer && hit(o.r, { col: p.col, row: p.row, cols: p.cols, rows: p.rows }))).map(x => x.p);
    return { lines: canvas.lines(), placements };
  }

  /** `T` or a click on the outline drawer's `[ ] pin`: it joins the layout (pinned) or slides over again. */
  private pinTree() { this.treePinned = !this.treePinned; this.treeOpen = this.treePinned || this.treeOpen; this.save(); this.redraw(); }

  /** `S`: the outline drawer moves to the other side, keeping its width. */
  private treeSide() {
    const open = this.treeOpen;
    this.treeOpen = false;
    this.lay.treeSide = this.lay.treeSide === "left" ? "right" : "left";
    this.treeOpen = open;
  }

  /**
   * One step of a pane's size, as its key does: the lanes' height (`{ }`), a lane's width (`< >` on the
   * lanes), the outline drawer's width, a reader's share of the row, the backlinks drawer's height, a
   * float's size. False when the pane has no size along that axis.
   */
  private resizeRegion(region: Region, axis: Axis, by: number): boolean {
    const root = this.screen.root;
    const step = (id: "lanes" | "tree" | "backlinks", n: number) => resize(root, id, id === "tree" ? "row" : "col", SIZE[id].step * n, [...SIZE[id].keys]);
    if (region === "lanes" && axis === "col") return step("lanes", by);
    if (region === "lanes") {
      const n = this.lanes[this.lane]?.name;
      if (n) this.lay.laneWeights[n] = clamp((this.lay.laneWeights[n] ?? 1) + SIZE.lane.step * by, ...SIZE.lane.weight);
      return !!n;
    }
    if (region === "tree") return axis === "row" && this.treeOpen && step("tree", by);
    if (region === "backlinks") return axis === "col" && !!this.links && step("backlinks", by);
    if (region.startsWith("float")) {
      const f = this.floats[Number(region.slice(5))];
      if (!f) return false;
      // Never smaller than a float is drawn, never bigger than the screen.
      const W = this.ctx.t.cols, H = this.ctx.t.rows - 2, F = SIZE.float;
      if (axis === "row") f.rect.cols = clamp(f.rect.cols + F.stepCols * by, F.cols, W); else f.rect.rows = clamp(f.rect.rows + F.stepRows * by, F.rows, H);
      return true;
    }
    const rd = this.readerFor(region), id = rd && this.idOf(rd.pane);
    if (!id || !this.readerIds().includes(id)) return false;
    // A reader's height is the room the lanes (or a pinned backlinks drawer) leave it.
    if (axis === "col") return this.links && this.linksPinned ? step("backlinks", -by) : step("lanes", -by);
    const ok = grow(root, id, SIZE.reader.step * by, ...SIZE.reader.keys, SIZE.reader.fallback);
    this.slots("out");
    return ok;
  }

  /** `x`: close a detail or a float. The person's focus goes to the detail left (or the lanes); an agent's leaves it. */
  private closeReader(region: Region, actor: Actor) {
    const rd = this.readerFor(region);
    if (!rd) return;
    if (actor.kind === "agent") return this.keepPlace(() => this.dropReader(rd.pane));
    this.dropReader(rd.pane);
    if (region.startsWith("detail")) {
      this.active = Math.max(0, this.details.length - 1);
      this.focus = this.details.length ? `detail${this.active}` : "lanes";
    } else this.focus = this.floats.length ? `float${this.floats.length - 1}` : "lanes";
  }

  // ── pane operations for `act` (PANE_ACTIONS): the keys above call the same code ──

  /** A pane named as `peek` names it: lanes, preview, detail1…, float1…, tree, backlinks, focused, or a block id a reader shows. */
  private paneNamed(sel?: string): { region: Region; name: string } {
    if (!sel || sel === "focused") {
      const f = this.focus;
      return { region: f, name: this.nameOf(f) };
    }
    if (sel === "lanes") return { region: "lanes", name: "lanes" };
    if (sel === "tree" || sel === "backlinks") {
      if (sel === "tree" ? !this.treeOpen : !this.links) throw new ActionRefused(`the ${sel === "tree" ? "outline" : "backlinks"} drawer isn't open (${sel === "tree" ? "t" : "b"} opens it)`);
      return { region: sel, name: sel };
    }
    const r = this.pickReader(sel);
    return { region: r.region!, name: r.name };
  }

  /** A region by the name agents use (detail0 is detail1, float0 is float1). */
  private nameOf(r: Region): string {
    if (r.startsWith("detail")) return `detail${Number(r.slice(6)) + 1}`;
    if (r.startsWith("float")) return `float${Number(r.slice(5)) + 1}`;
    return r;
  }

  /** The person's focused pane: an agent doesn't close it, float it away, or collapse it (they may be in it). */
  private refuseOnFocus(region: Region, actor: Actor, what: string) {
    if (actor.kind === "agent" && region === this.focus) throw new ActionRefused(`${this.nameOf(region)} has the person's keys; an agent doesn't ${what} it`);
  }

  splitPane(): PaneDone { throw new ActionRefused("on the board a detail opens with a note: open id=<block id> reader=new-detail (alt+⏎)"); }

  closePane(sel: string | undefined, actor: Actor): PaneDone {
    const { region, name } = this.paneNamed(sel);
    if (region === "lanes" || region === "preview") throw new ActionRefused(`the ${region} stay on the board; c collapses ${region === "lanes" ? "a lane" : "the preview"} to a spine`);
    this.refuseOnFocus(region, actor, "close");
    if (region === "tree" || region === "backlinks") {
      const keep = this.focus;
      if (region === "tree") this.treeOpen = false; else this.links = null;
      this.focus = keep === region ? "lanes" : keep;
    } else {
      const rd = this.readerFor(region)!;
      if (rd.pane.editing) throw new ActionRefused(`not closed: ${name} holds ${sessionName(rd.pane)}`);
      this.closeReader(region, actor);
    }
    this.save(); this.redraw();
    return { pane: name };
  }

  resizePane(sel: string | undefined, axis: Axis, by: number, _actor: Actor): PaneDone {
    const { region, name } = this.paneNamed(sel);
    if (!this.resizeRegion(region, axis, by)) throw new ActionRefused(`${name} has no ${axis === "row" ? "width" : "height"} of its own to change${region === "tree" || region === "backlinks" ? ` (the ${region === "tree" ? "outline drawer's is its width" : "backlinks drawer's is its height"})` : ""}`);
    this.save(); this.redraw();
    return { pane: name, axis, by };
  }

  zoomPane(): PaneDone { throw new ActionRefused("the board has no zoom yet (PIE-428); the desk zooms with ^W z"); }

  floatPane(sel: string | undefined, actor: Actor): PaneDone {
    const { region, name } = this.paneNamed(sel);
    if (region === "lanes" || region === "tree" || region === "backlinks") throw new ActionRefused(`${name} doesn't float; a reader does (the preview, a detail), and a float docks`);
    this.refuseOnFocus(region, actor, "float");
    const floated = !region.startsWith("float");
    const why = this.floatOrDock(region, actor);
    if (why) throw new ActionRefused(why);
    this.save();
    return { pane: name, floated, now: floated ? `float${this.floats.length}` : `detail${this.details.length}` };
  }

  pinPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone {
    const which = !sel || sel === "focused" ? (this.focus === "tree" || this.focus === "backlinks" ? this.focus : undefined) : sel;
    if (which !== "tree" && which !== "backlinks") throw new ActionRefused("only a drawer pins: reader=tree (the outline) or reader=backlinks");
    const pinned = which === "tree" ? this.treePinned : this.linksPinned;
    const want = on ?? !pinned;
    if (want !== pinned) {
      if (which === "tree") this.pinTree();
      else {
        if (!this.links && actor.kind === "agent") throw new ActionRefused("the backlinks drawer isn't open; b opens it on a reader's note");
        this.pinLinks();
      }
    }
    return { pane: which, pinned: want, changed: want !== pinned };
  }
  /** `B` or a click on the backlinks drawer's `[ ] pin`, as `pinTree`. */
  private pinLinks() { this.linksPinned = !this.linksPinned; if (!this.links) this.showLinks(this.focus); this.save(); this.redraw(); }

  private frame(canvas: Canvas, r: Rect, region: Region, title: string, hint = "") {
    const on = this.focus === region;
    canvas.box(r, fg(on ? C.lcyan : C.blue), `${fg(on ? C.white : C.grey)}${title}`, on ? fg(C.dark) + hint : "");
    this.rects.set(region, r);
    return { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 } satisfies Rect;
  }

  private drawLanes(canvas: Canvas, r: Rect) {
    this.laneRects = [];
    if (!this.lanes.length) { canvas.box(r, fg(C.blue), fg(C.grey) + (this.hub ? subject(this.hub) : "board")); canvas.text(r.col + 2, r.row + 1, fg(C.dark) + this.status + RESET); return; }
    const spines = this.lanes.filter(l => this.collapsed.has(l.name)).length;
    const openLanes = this.lanes.map((l, i) => ({ l, i })).filter(x => !this.collapsed.has(x.l.name));
    const wsum = openLanes.reduce((a, x) => a + (this.lay.laneWeights[x.l.name] ?? 1), 0) || 1;
    const room = r.cols - spines * SPINE;
    this.laneEdges = [];
    let x = r.col, prevOpen = -1, openSeen = 0;
    this.lanes.forEach((l, i) => {
      const spine = this.collapsed.has(l.name);
      let w = SPINE;
      if (!spine) {
        openSeen++;
        const rest = this.lanes.slice(i + 1).filter(n => this.collapsed.has(n.name)).length * SPINE;
        w = openSeen === openLanes.length ? r.col + r.cols - x - rest : Math.max(10, Math.round((room * (this.lay.laneWeights[l.name] ?? 1)) / wsum));
      }
      const rect: Rect = { col: x, row: r.row, cols: w, rows: r.rows };
      if (!spine) {
        if (prevOpen >= 0 && this.laneRects[this.laneRects.length - 1] && !this.laneRects[this.laneRects.length - 1]!.spine) this.laneEdges.push({ a: prevOpen, b: i, x, rect: r });
        prevOpen = i;
      } else prevOpen = -1;
      this.laneRects.push({ lane: i, rect, spine });
      x += w;
      const on = this.focus === "lanes" && i === this.lane;
      const drop = this.drag?.kind === "card" && this.drag.over === i && i !== this.drag.from ? planMove(this.drag.card, l) : null;
      if (spine) {
        const p = drawSpine(canvas, rect, { key: `lane-spine:${i}`, title: `${l.name} ${l.items?.length ?? "…"}`, colour: on ? C.white : C.cyan, cellStyle: on ? SEL : undefined }, this.ctx);
        if (p) this.placed.push({ layer: 0, p });
        return;
      }
      canvas.box(rect, fg(drop ? (drop.kind === "refused" ? C.lred : C.yellow) : on ? C.lcyan : i === this.lane ? C.cyan : C.blue),
        `${fg(on ? C.white : C.grey)}${l.name} ${fg(C.dark)}${l.items ? l.items.length : "…"}${l.read?.truncated ? fg(C.yellow) + ` of ${l.read.limit}+` : ""}${l.read && l.read.status !== "ready" ? fg(C.lred) + " " + l.read.status : ""}`,
        drop ? (drop.kind === "patch" ? fg(C.yellow) + "drop: " + describeChanges(drop.changes) : drop.kind === "already" ? fg(C.dark) + "already here" : fg(C.lred) + "can't: " + drop.reason) : on ? fg(C.dark) + "c collapse · H L move" : "");
      const inner = { col: rect.col + 1, row: rect.row + 1, cols: rect.cols - 2, rows: rect.rows - 2 };
      const items = l.items ?? [];
      const fit = Math.max(1, Math.floor(inner.rows / 2));
      if (l.sel < l.top) l.top = l.sel;
      if (l.sel >= l.top + fit) l.top = l.sel - fit + 1;
      items.slice(l.top, l.top + fit).forEach((m, j) => {
        const k = l.top + j, sel = k === l.sel;
        const wid = m.props["work-id"] ?? m.props.ticket ?? "";
        const title = wid ? subject(m).replace(new RegExp(`^${wid}\\s*[—:-]?\\s*`), "") : subject(m);
        const pri = PRIORITY[m.props.priority ?? ""] ?? C.dark;
        // Whatever this lane's cards carry: stage fields, or outbox fields (to · channel · waiting on).
        const extra = [m.props.track, m.props.to && `→ ${m.props.to}`, m.props.channel, m.props["waiting-on"] && `waiting on ${m.props["waiting-on"]}`]
          .filter(Boolean).join(" · ");
        const y = inner.row + j * 2;
        if (sel) {
          const style = on ? SEL : bg(C.dark) + fg(C.white);
          canvas.text(inner.col, y, style + pad(` ${wid} ${m.props.priority ?? ""} ${extra} · ${ago(m.updatedAt)}`, inner.cols) + RESET, inner.cols);
          canvas.text(inner.col, y + 1, style + pad(` ${title}`, inner.cols) + RESET, inner.cols);
        } else {
          canvas.text(inner.col, y, pad(` ${fg(pri)}● ${fg(C.lcyan)}${wid}${wid ? " " : ""}${fg(C.dark)}${extra} · ${ago(m.updatedAt)}`, inner.cols) + RESET, inner.cols);
          canvas.text(inner.col, y + 1, fg(C.grey) + pad(` ${title}`, inner.cols) + RESET, inner.cols);
        }
      });
      if (!l.items) canvas.text(inner.col, inner.row, fg(C.dark) + " loading…" + RESET, inner.cols);
      else if (l.read && l.read.status !== "ready") l.read.errors.forEach((e, k) => canvas.text(inner.col, inner.row + k, fg(C.lred) + " " + e + RESET, inner.cols));
      else if (!items.length) canvas.text(inner.col, inner.row, fg(C.dark) + " empty" + RESET, inner.cols);
    });
  }

  private drawPicker(canvas: Canvas, W: number, H: number) {
    const P = this.picker!;
    const r: Rect = { col: Math.round(W * 0.2), row: Math.round(H * 0.15), cols: Math.round(W * 0.6), rows: Math.min(H - 4, P.items.length + 4) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + `pick a board · ${this.ctx.workspace}`, fg(C.dark) + "⏎ open · esc back");
    P.items.forEach((it, i) => canvas.text(r.col + 1, r.row + 1 + i,
      (i === P.sel ? SEL : fg(C.grey)) + pad(` ${subject(it.hub)}  ${fg(C.dark)}${it.lanes} lanes · ${ago(it.hub.updatedAt)}`, r.cols - 2) + RESET, r.cols - 2));
  }

  private drawMover(canvas: Canvas, W: number, H: number) {
    const M = this.mover!;
    const r: Rect = { col: Math.round(W * 0.15), row: Math.round(H * 0.12), cols: Math.round(W * 0.7), rows: Math.min(H - 4, this.lanes.length * 2 + 3) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + `move · ${subject(M.card).slice(0, r.cols - 20)}`, fg(C.dark) + "enter move · esc back");
    const inner = r.cols - 2;
    this.lanes.forEach((l, i) => {
      const p = M.plans[i]!, sel = i === M.sel, y = r.row + 1 + i * 2;
      if (y + 1 >= r.row + r.rows - 1) return;
      const what = i === M.from ? fg(C.dark) + "the card's lane now"
        : p.kind === "patch" ? fg(C.lgreen) + "-> " + describeChanges(p.changes)
        : p.kind === "already" ? fg(C.dark) + "already matches · nothing to change"
        : fg(C.lred) + "can't: " + p.reason;
      canvas.text(r.col + 1, y, (sel ? SEL : fg(C.white)) + pad(` ${sel ? ">" : " "} ${l.name}  ${fg(C.dark)}${l.read?.status === "ready" ? l.def.props.query ?? "" : l.read?.status ?? "loading"}`, inner) + RESET, inner);
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
    const status = C0.kind === "card" ? [
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
    const lines = renderEditor(d, { title: C0.kind === "card" ? `new card in ${C0.lane.name}` : "new note", status, by: writtenBy(d, "save") }, w, r.rows - 2);
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

  /**
   * A reader in its frame. The title says what holds it (editing, comments, properties) and, when the
   * note is longer than the frame, how far down it is (`· 42%`), with a thumb on the right border.
   */
  private drawReader(canvas: Canvas, r: Rect, region: Region, pane: ReaderPane, label: string, hint?: string, layer = 0) {
    const inner: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
    const view = inner.cols >= 4 && inner.rows >= 1 ? pane.render(inner.cols, inner.rows, false, this) : null;
    const on = this.focus === region, base = fg(on ? C.white : C.grey);
    const state = pane.surface.state();
    const held = pane.holdsKeys && !this.entered.in(pane);
    const tail = `${state ? `${fg(C.yellow)} · ${state}${held ? fg(C.dark) + " (e enters)" : ""}${base}` : ""}${overflows(view?.scroll) ? `${fg(C.dark)} · ${scrollPct(view!.scroll!)}` : ""}`;
    // The state and how far down always show: a long label (a float's subject) is cut to leave them room.
    const fits = Math.max(1, r.cols - 5 - width(tail));
    const title = `${width(label) > fits ? pad(label, fits) + base : label}${tail}`;
    this.frame(canvas, r, region, title, hint ?? (held ? `e ⏎ enter${pane.surface.scrolls() ? " · j k scroll" : ""}` : pane.hint()));
    if (!view) return;
    this.paneInto(canvas, inner, pane, region, layer, view);
    if (overflows(view.scroll)) canvas.thumb(r, view.scroll, fg(on ? C.lcyan : C.cyan));
  }

  private paneInto(canvas: Canvas, inner: Rect, pane: ReaderPane, key: string, layer: number, view: PaneView = pane.render(inner.cols, inner.rows, false, this)) {
    view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    for (const p of view.placements ?? [])
      this.placed.push({ layer, p: { ...p, key: `${key}:${p.key}`, col: inner.col + p.col, row: inner.row + p.row, cols: Math.min(p.cols, inner.cols - p.col), rows: Math.min(p.rows, inner.rows - p.row) } });
  }

  /**
   * The backlinks drawer: a status line (the counts, and each toggle as a clickable control), then one
   * line per row, kind groups with their stage counts and each source's dim breadcrumb and "Work ID ×N"
   * (PIE-442, Detail's view through src/backlinks.ts). Beside it, a preview of the selected source.
   */
  private drawLinks(canvas: Canvas, r: Rect) {
    const L = this.links!;
    if (!this.linksPinned) canvas.clear(r, bg(C.black));
    const count = L.data ? `${L.data.sources.length} source${L.data.sources.length === 1 ? "" : "s"}` : "…";
    const listW = Math.round(r.cols * 0.5);
    const listR: Rect = { ...r, cols: listW };
    const inner = this.frame(canvas, listR, "backlinks", `${pinBox(this.linksPinned)} · backlinks · ${subject(L.target).slice(0, 50)} · ${count} ${fg(C.dark)}(from ${L.from})`,
      this.linkView.draft !== null ? "type to filter · ⏎ keep · esc undo" : `⏎ open · / filter · s K w h n · B ${this.linksPinned ? "unpin" : "pin"} · esc`);
    this.rects.set("pin:backlinks", pinRect(listR));
    for (const c of LINK_CONTROLS) this.rects.delete(`bl:${c}`);
    const view = this.linkViewNow(), rows = this.linkRows(), o = this.linkOptions();
    // The status line, wrapped between its parts so every control stays on screen (at most half of
    // the drawer). While a filter is typed it shows the text with a cursor; its counts follow each key.
    let x = inner.col, y0 = inner.row;
    const end = inner.col + inner.cols, maxHead = Math.max(1, Math.floor(inner.rows / 2));
    const put = (text: string, colour: string, control?: BacklinkControl) => {
      const room = end - x;
      if (room <= 0) return;
      canvas.text(x, y0, colour + pad(text, Math.min(room, width(text))) + RESET, room);
      if (control) this.rects.set(`bl:${control}`, { col: x, row: y0, cols: Math.min(room, width(text)), rows: 1 });
      x += width(text);
    };
    if (L.data) {
      const typing = this.linkView.draft;
      const parts = backlinkStatusParts(view, o).filter(p => typing === null || p.control !== "filter");
      if (typing !== null) parts.unshift({ text: `Filter: ${typing}▏`, control: "filter" });
      if (L.data.completeness.kind === "truncated") parts.push({ text: `first ${L.data.completeness.limit ?? L.data.sources.length} sources` });
      parts.forEach((p, i) => {
        // A part that doesn't fit starts the next line (the separator stays at the end of this one).
        if (i && x + 3 + width(p.text) > end && y0 + 1 < inner.row + maxHead) { if (x + 2 <= end) put(" ·", fg(C.dark)); x = inner.col; y0 += 1; }
        else if (i) put(" · ", fg(C.dark));
        put(p.text, typing !== null && p.control === "filter" ? fg(C.yellow) : p.control ? fg(C.lcyan) : fg(C.grey), p.control);
      });
    } else put("asking the service…", fg(C.dark));
    // One line per row, under the status line.
    const head = this.linkHead = y0 - inner.row + 1;
    const fit = Math.max(1, inner.rows - head);
    L.sel = clamp(L.sel, 0, Math.max(0, rows.length - 1));
    if (L.sel < L.top) L.top = L.sel;
    if (L.sel >= L.top + fit) L.top = L.sel - fit + 1;
    L.top = clamp(L.top, 0, Math.max(0, rows.length - fit));
    const indent = view.faceted ? "   " : " ";
    rows.slice(L.top, L.top + fit).forEach((row, j) => {
      const sel = L.top + j === L.sel;
      const y = inner.row + head + j;
      const on = sel ? (this.focus === "backlinks" ? SEL : bg(C.dark) + fg(C.white)) : "";
      if (row.kind === "group") {
        const g = row.group;
        const head = ` ${row.expanded ? "−" : "+"} ${g.label} ${g.sources.length}`;
        canvas.text(inner.col, y, on + (sel ? "" : fg(C.yellow)) + head + (sel ? "" : fg(C.grey)) + pad(backlinkStageSummary(g), Math.max(0, inner.cols - width(head))) + RESET, inner.cols);
        return;
      }
      const f = fitBacklinkRow(row.source.title, backlinkRowSuffix(row.source), inner.cols - indent.length);
      const tail = f.suffix ? `${sel ? "" : fg(C.dark)} — ${f.suffix}` : "";
      canvas.text(inner.col, y, on + (sel ? "" : fg(C.white)) + pad(`${indent}${f.title}${tail}`, inner.cols) + RESET, inner.cols);
    });
    if (L.data && !L.data.sources.length) canvas.text(inner.col + 1, inner.row + head, fg(C.dark) + "nothing links here" + RESET, inner.cols - 1);
    else if (L.data && !rows.length) canvas.text(inner.col + 1, inner.row + head, fg(C.dark) + "nothing matches · the status line's controls, / and esc change what shows" + RESET, inner.cols - 1);
    // Its own preview, following the selected source.
    const pr: Rect = { col: r.col + listW, row: r.row, cols: r.cols - listW, rows: r.rows };
    canvas.box(pr, fg(C.blue), fg(C.grey) + "backlink preview");
    this.rects.set("links-preview", pr);
    const pin = { col: pr.col + 1, row: pr.row + 1, cols: pr.cols - 2, rows: pr.rows - 2 };
    const snip = String(this.linkSource()?.occurrences[0]?.snippet ?? "").replace(/\s+/g, " ").trim();
    if (snip) canvas.text(pin.col, pin.row, fg(C.green) + pad(`"${snip}"`, pin.cols) + RESET, pin.cols);
    this.paneInto(canvas, { ...pin, row: pin.row + 1, rows: pin.rows - 1 }, this.linksPreview, "links", this.linksPinned ? 0 : 1);
  }

  private drawTree(canvas: Canvas, r: Rect, overlay: boolean) {
    if (!this.treeReady) { this.tree.init(this); this.treeReady = true; }
    if (overlay) canvas.clear(r, bg(C.black));
    const treeRows = r.rows >= 24 ? Math.round(r.rows * 0.6) : r.rows;
    const tr: Rect = { ...r, rows: treeRows };
    const inner = this.frame(canvas, tr, "tree", `${pinBox(this.treePinned)} · outline · ${this.lay.treeSide}`, `⏎ open · T ${this.treePinned ? "unpin" : "pin"} · S side · esc`);
    this.rects.set("pin:tree", pinRect(tr));
    this.tree.render(inner.cols, inner.rows, this.focus === "tree", this).lines.slice(0, inner.rows)
      .forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    if (treeRows < r.rows) {
      const pr: Rect = { col: r.col, row: r.row + treeRows, cols: r.cols, rows: r.rows - treeRows };
      canvas.box(pr, fg(C.blue), fg(C.grey) + "outline preview");
      this.rects.set("tree-preview", pr);
      const pin = { col: pr.col + 1, row: pr.row + 1, cols: pr.cols - 2, rows: pr.rows - 2 };
      this.paneInto(canvas, pin, this.treePreview, "treepv", this.treePinned ? 0 : 2);
    }
    if (overlay) {
      const edge = this.lay.treeSide === "left" ? r.col + r.cols : r.col - 1;
      for (let y = r.row; y < r.row + r.rows; y++) canvas.text(edge, y, fg(C.dark) + (this.lay.treeSide === "left" ? "▐" : "▌") + RESET, 1);
    }
  }

  private drawFloat(canvas: Canvas, f: Float, i: number, W: number, H: number) {
    const r = f.rect;
    r.cols = clamp(r.cols, 20, W); r.rows = clamp(r.rows, 5, H);
    r.col = clamp(r.col, 0, W - r.cols); r.row = clamp(r.row, 0, H - r.rows);
    canvas.clear(r, bg(C.black));
    // Drop shadow on the right and bottom.
    for (let y = r.row + 1; y <= Math.min(H - 1, r.row + r.rows); y++) canvas.text(r.col + r.cols, y, fg(C.dark) + "▒" + RESET, 1);
    canvas.text(r.col + 1, r.row + r.rows, fg(C.dark) + "▒".repeat(Math.max(0, Math.min(r.cols, W - r.col - 1))) + RESET, W);
    const title = `${fg(C.yellow)}⧉ ${f.pane.msg ? subject(f.pane.msg) : "float"}`;
    this.drawReader(canvas, r, `float${i}`, f.pane, title, f.pane.holdsKeys ? undefined : "drag title · drag ◢ · o dock · x close", 3 + i);
    canvas.text(r.col + r.cols - 1, r.row + r.rows - 1, fg(C.yellow) + "◢" + RESET, 1);
    this.rects.set(`float-title:${i}`, { col: r.col, row: r.row, cols: r.cols, rows: 1 });
    this.rects.set(`float-corner:${i}`, { col: r.col + r.cols - 2, row: r.row + r.rows - 2, cols: 2, rows: 2 });
  }

  private hints(W: number): string {
    const d = this.drag?.kind === "card" ? this.drag : null;
    if (d) {
      const over = d.over === null ? null : this.lanes[d.over];
      const p = over && d.over !== d.from ? planMove(d.card, over) : null;
      const say = !over || !p ? `|08 dragging |15${subject(d.card).slice(0, 60)}|08 · release over another lane to move it there`
        : p.kind === "patch" ? `|08 release to move into |15${over.name}|08 · |14${describeChanges(p.changes)}`
        : p.kind === "already" ? `|08 already in |15${over.name}|08 · nothing to change`
        : `|12 can't drop into ${over.name}: ${p.reason}`;
      return pad(paint(say), W);
    }
    if (this.mover) return pad(paint("|08 |15j k|08 pick a lane · |15enter|08 move the card there · |15esc|08 back · the second line says what would be patched"), W);
    if (this.composer) return pad(fg(C.dark) + " " + editHint(this.composer.draft, { save: "save", close: "back" }).replace("ctrl+s save", "ctrl+s create") + RESET, W);
    if (this.steps) return pad(paint("|08 |15j k|08 step · |15space|08 done/to do · |15x|08 done · |15w|08 waiting · |15!|08 problem · |15esc|08 back · each change is checked against the step as it was read"), W);
    // A reader holding an edit, a comment or the property panel: what it is, and how to get in or out.
    const rd = this.focusedReader();
    if (rd && this.shut.has(rd)) {
      const holds = rd.holdsKeys ? ` · keeps ${sessionName(rd)}` : "";
      return pad(paint(`|14 ${this.labelOf(rd)} · collapsed${holds}|08 · |15c ⏎|08 open · |15alt+c|08 open all · |15tab|08 area · |15esc|08 lanes`), W);
    }
    if (rd?.holdsKeys) {
      const where = `${this.labelOf(rd)} · ${rd.surface.state()}`;
      return this.entered.in(rd)
        ? pad(paint(`|14 ${where}|08 · `) + fg(C.grey) + rd.hint() + RESET, W)
        : pad(paint(`|14 ${where}|08 · |15e ⏎|08 enter ${sessionName(rd)}${rd.surface.scrolls() ? " · |15j k|08 scroll" : ""} · |15tab|08 area · |15esc|08 lanes`), W);
    }
    const undo = this.trashed ? bg(C.red) + fg(C.white) + ` TRASHED "${this.trashed.title}"${this.trashed.by ? ` by an agent (${this.trashed.by})` : ""} · u restores ` + RESET + " " : "";
    const base = this.focus === "lanes"
      ? "|08 |15g|08 boards · h l lane · j k card · |15⏎|08 detail · |15H L|08 move · |15m|08 move to... · |15n|08 new card · |15N|08 note under · |15s|08 steps · |15d d|08 trash · |15i|08 properties · |15C|08 comment · |15c|08 collapse · |15alt+c|08 open all · |15t|08 outline · |15b|08 backlinks · |15o|08 pop out · |15tab|08 area"
      : this.focus === "backlinks"
        ? this.linkView.draft !== null
          ? "|08 type to filter the backlinks · |15⏎|08 keep · |15esc|08 undo · |15backspace ctrl+u|08 erase"
          : "|08 |15j k|08 row · |15⏎|08 open · |15alt+⏎|08 new detail · |15. space|08 group · |15/|08 filter · |15s|08 sort · |15K|08 kind · |15w|08 stage · |15h|08 resolved · |15n|08 this note · |15B|08 pin · |15tab|08 area · |15esc|08 close"
      : this.focus.startsWith("float")
        ? "|08 drag the title to move · drag |15◢|08 to resize · |15H J K L|08 move · |15o|08 dock · |15x|08 close · |15tab|08 area"
        : "|08 |15tab|08 area · |15c|08 collapse · |15t|08 outline · |15b|08 backlinks of this reader · |15o|08 pop out · |15x|08 close · |15{ } < >|08 size · |15esc|08 lanes";
    return pad(undo + paint(base + (this.status ? ` · |14${this.status}` : "")), W);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private regions(): Region[] {
    const r: Region[] = ["lanes", "preview", ...this.details.map((_, i) => `detail${i}` as Region)];
    if (this.links) r.push("backlinks");
    if (this.treeOpen) r.push("tree");
    this.floats.forEach((_, i) => r.push(`float${i}`));
    return r;
  }

  key(k: Key, ctx: Ctx) {
    this.keyIn(k, ctx);
    // Moving to another area leaves a session: coming back, e or ⏎ enters it again.
    this.entered.follow(this.focusedReader());
  }

  private keyIn(k: Key, ctx: Ctx) {
    // Only the focused reader's session can take keys (never the preview's while the lanes have focus),
    // and only one the person is in (PIE-411).
    // Esc while the person's own edit or comment is still opening cancels it, and does nothing else.
    if (k.kind === "esc" && this.pending?.pane === this.focusedReader()) { this.pending = null; this.ctx.flash("not opened"); return this.redraw(); }
    const rd = this.focusedReader();
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A collapsed reader is a spine: c, ⏎ or space opens it; the board's keys keep working, and none of the
    // reader's own (not even e into a session it holds) reach a note the person can't see.
    const shut = !!rd && this.shut.has(rd);
    // A step's status choice the person opened (PIE-472) takes their keys until they choose or cancel.
    if (rd?.surface.choosing && !shut && k.kind !== "mouse") { rd.key(k, this); return this.redraw(); }
    if (rd?.holdsKeys && !shut) {
      if (this.entered.in(rd)) {
        // Every key is the edit's, comment's or panel's, board shortcuts included, until it's closed. The
        // wheel still scrolls whatever is under the pointer. A click can't move focus off an open edit
        // (esc leaves it); with only the property panel open, clicks pass.
        if (k.kind !== "mouse") { rd.key(k, this); return; }
        if (rd.editing && k.action !== "wheel-up" && k.action !== "wheel-down") {
          if (k.action === "down" && this.clickIn(rd, k)) return this.redraw();
          if (k.action === "down") this.ctx.flash("finish the edit first · ctrl+s saves · esc closes");
          return;
        }
      } else if (k.kind !== "mouse") {
        // One the person isn't in (an agent's, or theirs after moving away): e or ⏎ enters it, j k PgDn
        // scroll the reader, and the board's keys keep working. None of its own keys get here.
        if (c === "e" || k.kind === "enter") return this.enterSession(rd);
        if (rd.scrollKey(k, this)) return;
      }
    }
    // A card or note being written holds every key, like an edit; a click can't take focus from it.
    if (this.composer) {
      if (k.kind === "mouse") { if (k.action === "down") this.ctx.flash("finish the new card first · ctrl+s creates · esc closes"); return; }
      return this.composerKey(k);
    }
    // A backlinks filter being typed holds every key, board shortcuts included (t, b, g are letters in it).
    // Leaving the drawer keeps what was typed.
    if (this.linkView.draft !== null && (this.focus !== "backlinks" || !this.links)) { this.linkView.options.filter = this.linkView.draft.trim(); this.linkView.draft = null; }
    if (this.linkView.draft !== null && k.kind !== "mouse") return this.linkFilterKey(k);
    if (this.steps && k.kind !== "mouse") return this.stepsKey(k, c);
    if (this.trashArm && !(c === "d" && this.focus === "lanes")) this.trashArm = null;   // any other key keeps the card
    if (this.mover && k.kind !== "mouse") return this.moverKey(k, c);
    if (this.picker) {
      const P = this.picker;
      if (k.kind === "down" || c === "j") P.sel = Math.min(P.items.length - 1, P.sel + 1);
      else if (k.kind === "up" || c === "k") P.sel = Math.max(0, P.sel - 1);
      else if (k.kind === "enter") { void this.useHub(P.items[P.sel]!.hub); return; }
      else if (k.kind === "esc") { if (this.hub) this.picker = null; else return ctx.pop(); }
      return this.redraw();
    }
    if (k.kind === "mouse") return this.mouse(k);
    if (shut && (c === "c" || c === " " || k.kind === "enter")) { this.setShut(rd!, false); return; }
    if (c === "g") { this.status = "looking for boards…"; this.redraw(); this.findBoards().then(items => { this.status = ""; this.picker = { items, sel: Math.max(0, items.findIndex(i => i.hub.id === this.hub?.id)) }; this.redraw(); }, () => {}); return; }
    if (k.kind === "tab" || k.kind === "backtab") {
      const rs = this.regions(), i = rs.indexOf(this.focus);
      this.focus = rs[(i + (k.kind === "tab" ? 1 : rs.length - 1)) % rs.length]!;
      if (this.focus.startsWith("detail")) this.active = Number(this.focus.slice(6));
      return this.redraw();
    }
    // Layout keys work from anywhere: { } the lanes' height, < > the focused pane's width.
    if (c === "{" || c === "}") { this.resizeRegion("lanes", "col", c === "}" ? 1 : -1); this.save(); return this.redraw(); }
    if (c === "<" || c === ">") {
      if (this.focus === "lanes" || this.focus === "tree" || this.focus === "preview" || this.focus.startsWith("detail")) this.resizeRegion(this.focus, "row", c === ">" ? 1 : -1);
      this.save(); return this.redraw();
    }
    if (c === "t") { this.treeOpen = !this.treeOpen || this.focus !== "tree"; this.focus = this.treeOpen ? "tree" : "lanes"; if (!this.treeOpen) this.treePinned = false; this.save(); return this.redraw(); }
    if (c === "T") return this.pinTree();
    if (c === "S") { this.treeSide(); this.treeOpen = true; this.save(); return this.redraw(); }
    if (c === "b" && this.focus !== "backlinks") return this.showLinks(this.focus);
    if (c === "B") return this.pinLinks();
    if (c === "o") return this.popOut();
    if (k.kind === "alt" && k.ch === "c") return this.reopenAll();
    // c collapses the preview or a detail (the lanes' own c collapses a lane).
    if (c === "c" && rd && (this.focus === "preview" || this.focus.startsWith("detail"))) {
      this.setShut(rd, true);
      return this.ctx.flash(`${this.labelOf(rd)} collapsed${rd.holdsKeys ? `, keeping ${sessionName(rd)}` : ""} · c opens it`);
    }
    if (c === "c" && this.focus.startsWith("float")) return this.ctx.flash("a float doesn't collapse · o docks it");
    if (c === "x" && rd?.editing) return this.ctx.flash(`not closed: it holds ${sessionName(rd)} · ${shut ? "c opens it" : "e or ⏎ enters it"}`);
    if (c === "x" && (this.focus.startsWith("detail") || this.focus.startsWith("float"))) { this.closeReader(this.focus, USER); return this.redraw(); }
    if (this.focus.startsWith("float") && "HJKL".includes(c) && c) {
      const f = this.floats[Number(this.focus.slice(5))]!;
      f.rect.col += c === "H" ? -4 : c === "L" ? 4 : 0;
      f.rect.row += c === "K" ? -2 : c === "J" ? 2 : 0;
      return this.redraw();
    }
    if (c === "V") return ctx.cycleVideo();
    // Esc in a reader first lets go of a fold point selected with ( ), so ⏎ opens the note again.
    if (k.kind === "esc" && rd && !rd.holdsKeys && !shut && rd.key(k, this)) return this.redraw();
    if (k.kind === "esc") {
      if (this.focus === "tree" && !this.treePinned) { this.treeOpen = false; this.focus = "lanes"; return this.redraw(); }
      if (this.focus === "backlinks" && !this.linksPinned) { this.links = null; this.focus = "lanes"; return this.redraw(); }
      if (this.focus !== "lanes") { this.focus = "lanes"; return this.redraw(); }
      if (this.treeOpen && !this.treePinned) { this.treeOpen = false; return this.redraw(); }
      if (this.links && !this.linksPinned) { this.links = null; return this.redraw(); }
      this.pending = null; return ctx.pop();
    }

    if (this.focus === "lanes") return this.laneKey(k, c);
    if (this.focus === "tree") { this.tree.key(k, this); return; }
    if (this.focus === "backlinks") return this.linksKey(k, c);
    if (shut) return k.kind === "char" && !k.ctrl ? this.ctx.flash(`${this.labelOf(rd!)} is collapsed · c or ⏎ opens it`) : undefined;
    if (!rd || rd.holdsKeys) return;
    const start = sessionStart(k);
    if (start) return this.start(rd, start);
    // ⏎ or alt+⏎ in the preview that isn't on one of its elements opens its note, as on the card.
    if (!rd.key(k, this) && (k.kind === "enter" || k.kind === "alt-enter") && rd === this.preview && this.preview.msg) this.openDetail(this.preview.msg, k.kind === "alt-enter");
  }

  private laneKey(k: Key, c: string) {
    const visible = this.lanes.map((_, i) => i);
    const l = this.lanes[this.lane];
    const n = l?.items?.length ?? 0;
    if (k.kind === "left" || c === "h") this.lane = visible[Math.max(0, visible.indexOf(this.lane) - 1)]!;
    else if (k.kind === "right" || c === "l") this.lane = visible[Math.min(visible.length - 1, visible.indexOf(this.lane) + 1)]!;
    // e, ctrl+e, i, I edit or open the properties of the selected card in the preview, which takes the keys.
    else if ((c === "e" || c === "C" || c === "i" || c === "I" || (k.kind === "char" && k.ctrl && k.ch === "e")) && this.preview.msg) {
      if (this.shut.has(this.preview)) return this.ctx.flash("the preview is collapsed · tab to its spine and c, or click it, to open it");
      return this.start(this.preview, sessionStart(k)!);
    }
    else if (c === "H" || c === "L") { const i = visible.indexOf(this.lane) + (c === "H" ? -1 : 1); if (i >= 0 && i < visible.length) void this.moveTo(visible[i]!); return; }
    else if (c === "m") return this.openMover();
    else if (c === "n") return this.openCardComposer();
    else if (c === "N") return this.openChildComposer();
    else if (c === "s") return void this.openSteps();
    else if (c === "d") return void this.armTrash();
    else if (c === "u" && this.trashed) return void this.restoreCard(undefined, USER).catch(e => this.ctx.flash(`not restored: ${(e as Error).message}`));
    else if (c === "c" && l) { this.collapsed.has(l.name) ? this.collapsed.delete(l.name) : this.collapsed.add(l.name); this.save(); return this.redraw(); }
    else if (l && this.collapsed.has(l.name) && (k.kind === "enter" || c === " ")) { this.collapsed.delete(l.name); this.save(); return this.redraw(); }
    else if (l && (k.kind === "down" || c === "j")) l.sel = Math.min(Math.max(0, n - 1), l.sel + 1);
    else if (l && (k.kind === "up" || c === "k")) l.sel = Math.max(0, l.sel - 1);
    else if (l && k.kind === "pgdn") l.sel = Math.min(Math.max(0, n - 1), l.sel + 8);
    else if (l && k.kind === "pgup") l.sel = Math.max(0, l.sel - 8);
    else if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.card(); if (m) return this.openDetail(m, k.kind === "alt-enter"); }
    else if (c === "r") this.loadLanes();
    else return;
    this.follow(); this.save(); this.redraw();
  }

  /**
   * The backlinks drawer's keys, Detail's where they don't clash with the board's: / filter, s sort,
   * h resolved, n this note, . a group. Detail's k (kind) and t (stage) are the board's up and outline
   * drawer, so kind is K and stage is w (the work stage).
   */
  private linksKey(k: Key, c: string) {
    const L = this.links!, n = this.linkRows().length;
    if (k.kind === "down" || c === "j") { L.sel = Math.min(Math.max(0, n - 1), L.sel + 1); this.previewLink(); }
    else if (k.kind === "up" || c === "k") { L.sel = Math.max(0, L.sel - 1); this.previewLink(); }
    else if (k.kind === "home") { L.sel = 0; this.previewLink(); }
    else if (k.kind === "end") { L.sel = Math.max(0, n - 1); this.previewLink(); }
    else if (k.kind === "pgdn" || k.kind === "pgup") this.linksPreview.key(k, this);
    else if (k.kind === "enter" || k.kind === "alt-enter") return this.enterLinkRow(k.kind === "alt-enter");
    else if (c === "." || c === " ") { const r = this.linkRow(); const kind = r?.kind === "group" ? r.group.kind : r?.source.facets?.kind; if (kind) return this.toggleLinkGroup(kind); }
    else if (c === "/") return this.linkControl("filter");
    else if (c === "s") return this.linkControl("sort");
    else if (c === "K") return this.linkControl("kind");
    else if (c === "w") return this.linkControl("stage");
    else if (c === "h") return this.linkControl("resolved");
    else if (c === "n") return this.linkControl("related");
    this.redraw();
  }

  /** ⏎ on a row: a group opens or folds; a source opens in the detail (alt: a new one), as a click does. */
  private enterLinkRow(fresh: boolean) {
    const r = this.linkRow();
    if (r?.kind === "group") return this.toggleLinkGroup(r.group.kind);
    const m = this.linksPreview.msg;
    if (r && m?.id === r.source.blockId) { this.current = m; this.openDetail(m, fresh); }
    else if (r) this.openLink(r.source.blockId, fresh);
  }

  /** Typing a filter: letters go into it and the list follows; ⏎ keeps it, esc goes back to what it was. */
  private linkFilterKey(k: Key) {
    const v = this.linkView;
    if (k.kind === "enter") { v.options.filter = (v.draft ?? "").trim(); v.draft = null; this.ctx.flash(v.options.filter ? `backlinks filtered by "${v.options.filter}"` : "backlink filter cleared"); }
    else if (k.kind === "esc") v.draft = null;
    else if (k.kind === "backspace") v.draft = (v.draft ?? "").slice(0, -1);
    else if (k.kind === "char" && k.ctrl && k.ch === "u") v.draft = "";
    else if (k.kind === "char" && !k.ctrl) v.draft = (v.draft ?? "") + k.ch;
    else return;
    this.changeLinks(() => {});
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    if (k.action !== "down") return this.pointer(k);
    this.pointer(k);
    // A click anywhere but in a reader's own text lets go of what's selected there.
    const keep = this.drag?.kind === "select" ? this.drag.pane : null;
    let cleared = false;
    for (const r of this.readers()) if (r !== keep && r.surface.selection) { r.surface.selection = null; cleared = true; }
    if (cleared) this.redraw();
  }

  private pointer(k: Extract<Key, { kind: "mouse" }>) {
    const inside = (r?: Rect) => !!r && k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    if (k.action === "up") {
      const d = this.drag;
      this.drag = null;
      if (d?.kind === "select") { d.pane.release(k.x - d.col, k.y - d.row, this, d.open); return this.redraw(); }
      if (d?.kind === "card") {
        // Released over another lane: move it there. Released where it started: a click (a second click opens it).
        if (d.over !== null && d.over !== d.from) { if (this.lane === d.from && this.card()?.id === d.card.id) void this.moveTo(d.over); }
        else if (d.open) return this.openDetail(d.card, false);
        return this.redraw();
      }
      if (d) this.save();
      return;
    }
    if (k.action === "drag" && this.drag) return this.dragTo(k.x, k.y);

    // Topmost first: floats, drawers, then the docked layout.
    const floatHit = [...this.floats.keys()].reverse().find(i => inside(this.floats[i]!.rect));
    const W = this.ctx.t.cols, H = this.ctx.t.rows - 2;
    if (k.action === "down") {
      if (floatHit !== undefined) {
        this.raise(floatHit);
        const top = this.floats.length - 1, f = this.floats[top]!;
        if (inside({ col: f.rect.col + f.rect.cols - 2, row: f.rect.row + f.rect.rows - 2, cols: 2, rows: 2 })) this.drag = { kind: "float-size", f };
        else if (k.y === f.rect.row) this.drag = { kind: "float-move", f, dx: k.x - f.rect.col, dy: k.y - f.rect.row };
        else this.clickReader(f.pane, f.rect, k);
        return this.redraw();
      }
      const near = (x: number, edge: number) => x === edge || x === edge - 1;
      // The layout's borders, topmost first: the outline drawer's, the backlinks drawer's (sliding over the
      // readers, only its own top border: the row above it is a reader's), the lanes' own columns, the
      // borders between readers, and the one under the lanes.
      const edgeHit = (): Drag | null => {
        const tree = this.border("tree"), links = this.border("backlinks");
        const grab = (d: Divider<string> | null | undefined, only?: 0 | 1): Drag | null => {
          const g = d ? dividerAt([d], k.x, k.y) : null;
          return g && (only === undefined || g.side === only) ? this.borderDrag(g) : null;
        };
        const P = this.placedScreen;
        const treeR = this.treeOpen ? P?.rects.get("tree") ?? P?.over.get("tree")?.rect : undefined;
        const inTree = !!treeR && inside({ ...treeR, cols: treeR.cols + (this.treePinned ? 0 : 1) });   // its shadow column too
        const hit = grab(tree) ?? (inTree ? null : grab(links, this.linksPinned ? undefined : 1));
        if (hit) return hit;
        // Under a drawer (sliding or pinned) a click is the drawer's: no border hidden beneath it drags.
        const top = this.topAt(k.x, k.y);
        if (inTree || top === "tree" || top === "backlinks" || top === "covered") return null;
        for (const e of this.laneEdges) if (near(k.x, e.x) && k.y >= e.rect.row && k.y < e.rect.row + e.rect.rows) return { kind: "lane-edge", a: e.a, b: e.b };
        const rest = (this.placedScreen?.dividers ?? []).filter(d => d !== tree && d !== links);
        for (const d of [...rest.filter(d => d.node.key === "readers"), ...rest.filter(d => d.node.key !== "readers")]) { const g = grab(d); if (g) return g; }
        return null;
      };
      const e = edgeHit();
      if (e) { this.drag = e; return; }
      // A drawer's `[ ] pin` in its top border: the same toggle as T and B.
      if (this.treeOpen && inside(this.rects.get("pin:tree"))) return this.pinTree();
      if (this.links && inside(this.rects.get("pin:backlinks"))) return this.pinLinks();
      // The drawers' previews aren't areas of their own (yet): a click there doesn't reach what's under
      // them, but a link clicked in one opens in a detail (their previews follow the drawer's selection).
      if (this.treeOpen && inside(this.rects.get("tree-preview"))) return void this.clickReader(this.treePreview, this.rects.get("tree-preview")!, k);
      if (this.links && inside(this.rects.get("links-preview"))) return void this.clickReader(this.linksPreview, this.rects.get("links-preview")!, k, 1);
      const order: Region[] = ["tree", "backlinks", "preview", ...this.details.map((_, i) => `detail${i}` as Region)];
      const region = order.find(r => inside(this.rects.get(r)) && (r !== "tree" || this.treeOpen) && (r !== "backlinks" || !!this.links));
      if (region) {
        if (this.treeOpen && !this.treePinned && region !== "tree") this.treeOpen = false;
        this.focus = region;
        if (region.startsWith("detail")) this.active = Number(region.slice(6));
        if (region === "tree") { const r = this.rects.get("tree")!; this.tree.click(k.x - r.col - 1, k.y - r.row - 1, this); }
        if (region === "backlinks") {
          // The status line's controls do what their keys do; a group's header opens or folds it; a source
          // clicked opens in a detail, as ⏎ opens it, and its preview follows. Only the rows drawn are rows:
          // not the frame, nor the spare lines under the last one.
          const r = this.rects.get("backlinks")!, L = this.links!;
          const control = LINK_CONTROLS.find(c => inside(this.rects.get(`bl:${c}`)));
          if (control) { this.linkControl(control); return; }
          const rows = this.linkRows(), j = k.y - r.row - 1 - this.linkHead, idx = L.top + j;
          const drawn = j >= 0 && k.y < r.row + r.rows - 1 && k.x > r.col && k.x < r.col + r.cols - 1;
          const row = drawn ? rows[idx] : undefined;
          if (row) {
            L.sel = idx;
            if (row.kind === "group") { this.toggleLinkGroup(row.group.kind); return; }
            this.previewLink(); this.openLink(row.source.blockId);
          }
        }
        const rd = this.readerFor(region);
        if (region !== "tree" && region !== "backlinks" && rd) this.clickReader(rd.pane, this.rects.get(region)!, k);
        return this.redraw();
      }
      // A collapsed reader's spine: it opens, and takes focus, as c on it does.
      const sp = this.readerSpines.find(x => inside(x.rect));
      const spPane = sp && this.readerFor(sp.region)?.pane;
      if (sp && spPane) {
        if (this.treeOpen && !this.treePinned) this.treeOpen = false;
        this.focus = sp.region;
        if (sp.region.startsWith("detail")) this.active = Number(sp.region.slice(6));
        this.setShut(spPane, false);
        return this.redraw();
      }
      const hit = this.laneRects.find(l => inside(l.rect));
      if (hit) {
        if (this.treeOpen && !this.treePinned) this.treeOpen = false;
        const l = this.lanes[hit.lane]!;
        if (hit.spine) { this.collapsed.delete(l.name); this.lane = hit.lane; this.focus = "lanes"; this.save(); return this.redraw(); }
        const idx = l.top + Math.floor((k.y - hit.rect.row - 1) / 2);
        const same = this.lane === hit.lane && l.sel === idx && this.focus === "lanes";
        this.lane = hit.lane; this.focus = "lanes";
        if (l.items && idx >= 0 && idx < l.items.length) {
          l.sel = idx; this.follow();
          // Drag it onto another lane to move it; a click on the selected card opens it when released.
          this.drag = { kind: "card", from: hit.lane, card: l.items[idx]!, over: null, open: same };
        }
        this.redraw();
      }
      void W; void H;
      return;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const dir = (k.action === "wheel-up" ? -1 : 1) as 1 | -1;
      if (floatHit !== undefined) return this.floats[floatHit]!.pane.wheel(dir, this);
      if (this.treeOpen && inside(this.rects.get("tree"))) return this.tree.wheel(dir, this);
      if (this.treeOpen && inside(this.rects.get("tree-preview"))) return this.treePreview.wheel(dir, this);
      if (this.links && inside(this.rects.get("backlinks"))) { const L = this.links; L.sel = clamp(L.sel + dir, 0, Math.max(0, this.linkRows().length - 1)); this.previewLink(); return this.redraw(); }
      if (this.links && inside(this.rects.get("links-preview"))) return this.linksPreview.wheel(dir, this);
      for (const r of ["preview", ...this.details.map((_, i) => `detail${i}`)] as Region[]) if (inside(this.rects.get(r))) return this.readerFor(r)!.pane.wheel(dir, this);
      const hit = this.laneRects.find(l => inside(l.rect));
      if (hit && !hit.spine) { const l = this.lanes[hit.lane]!; l.sel = clamp(l.sel + dir, 0, Math.max(0, (l.items?.length ?? 1) - 1)); if (hit.lane === this.lane) this.follow(); this.redraw(); }
    }
  }

  /** The border a drawer's side shares with the layout: from the tree when it's pinned, its own when it slides over. */
  private border(id: "tree" | "backlinks"): Divider<string> | null {
    const P = this.placedScreen;
    if (!P || !has(this.screen.root, id)) return null;
    const touches = (d: Divider<string>) => [d.node.kids[d.i]!, d.node.kids[d.i + 1]!].some(k => k.t === "leaf" && k.id === id);
    return P.over.get(id)?.divider ?? P.dividers.find(touches) ?? null;
  }

  /**
   * Dragging a layout border: each side at least its minimum, and the drawers and the lanes within the
   * shares their keys keep (the outline 15–70% of the width, the backlinks 20–90% of the readers' height,
   * the lanes 12–85% of the height).
   */
  private borderDrag(g: Grab<string>): Drag {
    const n = g.d.node, a = n.kids[g.d.i]!, b = n.kids[g.d.i + 1]!;
    const fallback = n.dir === "row" ? MIN_COLS : MIN_ROWS;
    const mins: [number, number] = [this.minOf(a, n.dir, n) ?? fallback, this.minOf(b, n.dir, n) ?? fallback];
    // The first kid's share: the drawer's or the lanes' own range, or its complement when that pane is second.
    const is = (k: LNode<string>, id: string) => k.t === "leaf" && k.id === id;
    const own = (["tree", "backlinks", "lanes"] as const).find(id => is(a, id) || is(b, id));
    const [lo, hi] = own ? SIZE[own].share : [0, 1];
    const bounds: [number, number] = own && is(b, own) ? [1 - hi, 1 - lo] : [lo, hi];
    return { kind: "border", g, mins, bounds };
  }

  private dragTo(x: number, y: number) {
    const d = this.drag!;
    if (d.kind === "border") { dragBorder(d.g, x, y, { mins: d.mins, bounds: d.bounds }); if (d.g.d.node.key === "readers") this.slots("out"); }
    else if (d.kind === "lane-edge") {
      const ra = this.laneRects.find(l => l.lane === d.a)?.rect, rb = this.laneRects.find(l => l.lane === d.b)?.rect;
      const na = this.lanes[d.a]!.name, nb = this.lanes[d.b]!.name;
      if (ra && rb) {
        const total = ra.cols + rb.cols, wa = clamp(x - ra.col + 1, 10, total - 10);
        const sum = (this.lay.laneWeights[na] ?? 1) + (this.lay.laneWeights[nb] ?? 1);
        this.lay.laneWeights[na] = (sum * wa) / total; this.lay.laneWeights[nb] = (sum * (total - wa)) / total;
      }
    }
    else if (d.kind === "float-move") { d.f.rect.col = x - d.dx; d.f.rect.row = y - d.dy; }
    else if (d.kind === "float-size") { d.f.rect.cols = Math.max(20, x - d.f.rect.col + 1); d.f.rect.rows = Math.max(5, y - d.f.rect.row + 1); }
    else if (d.kind === "select") d.pane.drag(x - d.col, y - d.row, this);
    else if (d.kind === "card") d.over = this.laneRects.find(l => x >= l.rect.col && x < l.rect.col + l.rect.cols && y >= l.rect.row && y < l.rect.row + l.rect.rows)?.lane ?? null;
    this.redraw();
  }
}

/** A new card's plan: born-with properties, create:: defaults, what the text must meet, and its parent (null: a roadmap item, placed by the allocator). */
interface CardPlan { born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: ParentPick | null }
/** The tokens a roadmap item still needs from the text: `[priority::high|medium|low] [arc::…] [track::…]`. */
const roadmapHint = (C0: { born: { key: string }[]; defaults: { key: string }[] }) =>
  ["project", "priority", "arc", "track"].filter(k => !C0.born.some(p => p.key === k) && !C0.defaults.some(p => p.key === k))
    .map(k => k === "priority" ? "[priority::high|medium|low]" : `[${k}::…]`).join(" ");
const recordedAs = (actor: Actor) => actor.kind === "agent" || actor.with?.length ? `agent ${[actor.kind === "agent" ? actor.id : "you", ...(actor.with ?? [])].join("+")}` : "you";

type Composer =
  | { kind: "card"; lane: Lane; born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: (ParentPick & { title: string }) | null; draft: Draft }
  | { kind: "child"; parent: Msg; draft: Draft };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "lane";
/** A step's first line, without its list mark, checkbox and ^id. */
const stepText = (t: string) => (t.split("\n")[0] ?? "").replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX~!]\]\s*/, "").replace(/\s*\^[\w-]+\s*$/, "").trim();
/** `(project=a OR project=b)` → `project::a`: a token the person could type to meet it. */
const hintToken = (need: string) => { const m = need.match(/([A-Za-z][\w.-]*)=("[^"]*"|[^\s()]+)/); return m ? `${m[1]}::${m[2]!.replace(/^"|"$/g, "")}` : `${need.replace(/[()]/g, "")}::…`; };

const draftState = (r: ReaderPane) => {
  const d = r.draft!;
  return { id: d.blockId, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.changedElsewhere, conflict: d.conflict, savedCopy: d.savedCopy };
};

interface BoardOn { b: DeliveryBoard; reader?: string }

/** What the board adds to a reader's note actions: which note is where, and moving cards. */
export const BOARD_ACTIONS = new ActionSet<{
  "open": { id: string };
  "focus": Record<string, never>;
  "card.select": { id: string };
  "card.move": { lane: string; card?: string };
  "card.create": { lane: string; text: string; parent?: string };
  "note.create": { text: string; parent?: string };
  "steps": { card?: string };
  "step.set": { step: string; status?: string; card?: string };
  "card.trash": { confirm: string; card?: string };
  "card.restore": { id?: string };
  "reader.collapse": Record<string, never>;
  "reader.expand": Record<string, never>;
  "backlinks": { id?: string; filter?: string; kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string };
}, BoardOn>("board", {
  "open": {
    summary: "open a note: reader=detail (default), new-detail, preview (selects its card), float, or a named reader", keys: "enter, alt+enter, o",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { b, reader }, actor) {
      const r = await b.openIn(id, reader ?? "detail");
      b.ctx.flash(`${agentLabel(actor)} opened a note in ${r.reader}`);
      return r;
    },
  },
  "focus": {
    summary: "give keys to reader=<name> or reader=lanes", keys: "tab, click",
    args: {},
    run(_, { b, reader }, actor) {
      if (!reader) throw new ActionRefused("focus needs reader=<name> (or lanes)");
      const r = b.focusOn(reader);
      b.ctx.flash(`${agentLabel(actor)} gave the keys to ${r.focus}`);
      return r;
    },
  },
  "card.select": {
    summary: "select a card in its lane; the preview follows. An agent's selection is its own: what its card actions default to, leaving the person's cursor, preview and keys where they are", keys: "h l j k, click",
    args: { id: { type: "string", about: "the card's block id (or its first 8+ characters)" } },
    // An agent's selection is its own (what its card actions default to): the person's lane cursor,
    // preview and keys stay where they are. The person's own card.select, through the socket as `you`, moves them.
    run({ id }, { b }, actor) {
      if (actor.kind === "agent") return b.selectForAgent(id, actor);
      if (!b.selectCard(id)) throw new ActionRefused(`no lane on the board lists ${id}`);
      return { selected: id };
    },
  },
  "card.move": {
    summary: "move the selected card (or card=<id>) into a lane, patching what the lane's query names", keys: "H L, m, drag",
    args: { lane: { type: "string", about: "the lane's name" }, card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ lane, card }, { b }, actor) => b.moveCard(lane, card, actor),
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
    summary: "set a checklist step's status (default: toggle done / to do), checked against the step as it was read", keys: "s, j k, space x w !",
    args: {
      step: { type: "string", about: "the step's number in `steps` (from 1), or its ^id" },
      status: { type: "string", optional: true, about: "todo, done, waiting or problem; default toggles done" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run({ step, status, card }, { b }, actor) {
      if (status !== undefined && !["todo", "done", "waiting", "problem"].includes(status)) throw new ActionRefused(`status is todo, done, waiting or problem, not ${status}`);
      const n = /^\d+$/.test(step) ? Number(step) - 1 : step;
      if (typeof n === "number" && n < 0) throw new ActionRefused("steps are numbered from 1");
      return b.setStep(card ?? b.selectedCardId(actor), n, status as StepStatus | undefined, actor);
    },
  },
  "card.trash": {
    summary: "move the selected card (or card=<id>) and the notes under it to Trash; confirm=<its id> is the second d. The service records no author for this", keys: "d d",
    args: {
      confirm: { type: "string", about: "the card's id (or its first 8+ characters): the same card, said twice" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run: ({ confirm, card }, { b }, actor) => b.trashCard(card ?? b.selectedCardId(actor), confirm, actor),
  },
  "reader.collapse": {
    summary: "collapse reader=<name> (the preview or a detail) to a spine showing its note's title; a draft, comment or property panel in it is kept exactly. Refused for the reader the person has focused", keys: "c",
    args: {},
    run: (_, { b, reader }, actor) => b.collapseReader(reader, true, actor),
  },
  "reader.expand": {
    summary: "open a collapsed reader=<name> again, as it was; reader=all opens every collapsed reader and lane (alt+c). The person's focus stays where it is", keys: "c, enter, click on the spine, alt+c",
    args: {},
    run: (_, { b, reader }, actor) => b.collapseReader(reader, false, actor),
  },
  "backlinks": {
    summary: "the backlinks drawer's view as Detail groups it: counts, groups with stage counts, each row. An agent's reads the person's view (or id=<block id>'s) with its own options on top and changes nothing of theirs; the person's (as=you) opens the drawer on id and sets their options",
    keys: "b, then / s K w h n . and clicks on the status line and group headers",
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

/** The backlinks status line's controls, each drawn at `bl:<control>` for clicks. */
const LINK_CONTROLS: readonly BacklinkControl[] = ["filter", "kind", "stage", "resolved", "related", "sort"];
/** A backlinks row's identity across a change of view: its group, or its source. */
const rowKey = (r: BacklinkRow | undefined) => (r ? (r.kind === "group" ? `g:${r.group.kind}` : `s:${r.source.blockId}`) : undefined);

/** A drawer's pin as it's drawn at the start of its title: checked when it's part of the layout. */
function pinBox(pinned: boolean) { return pinned ? "[x] pin" : "[ ] pin"; }
/** Where `pinBox` lands: Canvas.box writes the title from col+2 after one space. */
function pinRect(frame: Rect): Rect { return { col: frame.col + 3, row: frame.row, cols: 7, rows: 1 }; }
