// Delivery board: a hub's virtual branches as lanes across the top, one shared preview,
// details you open into, floating panes you can drag above everything, an outline drawer
// (left or right, with its own mini preview) and a backlinks drawer with its own preview.
// Drawers slide over; nothing reflows unless it is pinned. Every border can be dragged.
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { onMediaChange } from "../media";
import { USER, type Actor, type Backlink, type Change, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, agentLabel, asActor, type ActRequest } from "../surface/actions";
import { NOTE_ACTIONS } from "../surface/note";
import { viewSummaryKeys } from "../props";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, planMove, type MovePlan } from "../move";
import { matchesFilters, readView, type ViewRead } from "../views";
import { holds } from "../query";
import { ReaderPane, TreePane, type DeskApi, type Pane, type PaneKind } from "./panes";
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
  | { kind: "lanes-split" } | { kind: "tree-edge" } | { kind: "links-edge" }
  | { kind: "lane-edge"; a: number; b: number } | { kind: "reader-edge"; a: number; b: number }
  | { kind: "float-move"; f: Float; dx: number; dy: number } | { kind: "float-size"; f: Float }
  | { kind: "card"; from: number; card: Msg; over: number | null; open: boolean };
interface Layout { laneFrac: number; previewFrac: number; treeFrac: number; linksFrac: number; treeSide: "left" | "right"; laneWeights: Record<string, number>; readerWeights: number[] }
interface Saved extends Layout { treePinned: boolean; linksPinned: boolean; lane: number; collapsed: string[]; hubs?: Record<string, string> }

const PREFERRED = ["validate", "doing", "queued", "review", "done"];
const HIDDEN = new Set(["superseded"]);
const SEL = bg(C.blue) + fg(C.white);
const PRIORITY: Record<string, number> = { high: C.lred, medium: C.yellow, low: C.dark };
const SPINE = 3;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class DeliveryBoard implements Screen, DeskApi {
  title = "delivery";
  ctx!: Ctx;
  current: Msg | null = null;
  private hub: Msg | null = null;
  private lanes: Lane[] = [];
  private lane = 0;
  private collapsed = new Set<string>();
  private preview = new ReaderPane();
  private details: ReaderPane[] = [];
  private floats: Float[] = [];
  private active = 0;                        // which detail Enter replaces
  private tree = new TreePane();
  private treePreview = new ReaderPane();
  private treeReady = false;
  private treeOpen = false;
  private treePinned = false;
  private links: { target: Msg; from: string; items: Backlink[] | null; sel: number; top: number } | null = null;
  private linksPreview = new ReaderPane();
  private linksPinned = false;
  private lay: Layout = { laneFrac: 0.42, previewFrac: 0.4, treeFrac: 0.3, linksFrac: 0.45, treeSide: "left", laneWeights: {}, readerWeights: [4, 3, 3] };
  private placed: { p: Placement; layer: number }[] = [];
  private overlays: { r: Rect; layer: number }[] = [];
  private laneEdges: { a: number; b: number; x: number; rect: Rect }[] = [];
  private readerEdges: { a: number; b: number; x: number; area: Rect }[] = [];
  private focus: Region = "lanes";
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
  /** The last create, step change, trash or restore, for `peek` and tests. */
  private lastWrite: { what: string; id?: string; result: string; by?: string } | null = null;

  constructor(private readonly hubId?: string) {
    const s = readState<Partial<Saved>>("delivery.json");
    if (s) {
      this.treePinned = !!s.treePinned; this.treeOpen = !!s.treePinned; this.linksPinned = !!s.linksPinned;
      this.lane = s.lane ?? 0; this.collapsed = new Set(s.collapsed ?? []); this.hubs = s.hubs ?? {};
      for (const k of ["laneFrac", "previewFrac", "treeFrac", "linksFrac", "treeSide", "laneWeights", "readerWeights"] as const) if (s[k] !== undefined) (this.lay as any)[k] = s[k];
    }
  }

  private save() {
    writeState("delivery.json", { ...this.lay, treePinned: this.treePinned, linksPinned: this.linksPinned, lane: this.lane, collapsed: [...this.collapsed], hubs: this.hubs } satisfies Saved);
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

  actions() { return { actions: [...BOARD_ACTIONS.list(), ...NOTE_ACTIONS.list()], readers: this.namedReaders().map(r => r.name) }; }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (BOARD_ACTIONS.has(req.action)) return BOARD_ACTIONS.runUntyped(req.action, args, { b: this, reader: req.reader }, actor);
    const r = this.pickReader(req.reader);
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
    if (where === "preview") {
      if (!this.selectCard(m.id, false)) this.preview.show(m, this);
      if (this.preview.msg?.id !== m.id) throw new ActionRefused("the preview is holding an edit or a comment on another note");
      this.focus = "preview";
    } else if (where === "detail" || where === "new-detail") {
      this.openDetail(m, where === "new-detail");
      if (this.details[this.active]?.msg?.id !== m.id) throw new ActionRefused("both details hold edits · save or close one first");
    } else if (where === "float") {
      const pane = new ReaderPane(); pane.show(m, this);
      const W = this.ctx.t.cols, H = this.ctx.t.rows - 2, n = this.floats.length;
      this.floats.push({ pane, rect: { col: Math.round(W * 0.22) + n * 3, row: Math.round(H * 0.12) + n * 2, cols: Math.round(W * 0.5), rows: Math.round(H * 0.6) } });
      this.focus = `float${this.floats.length - 1}`;
    } else {
      const r = this.pickReader(where);
      if (!r.pane.show(m, this)) throw new ActionRefused(`${r.name} is holding an edit or a comment on another note`);
      if (r.region) this.focus = r.region;
    }
    this.redraw();
    const r = this.namedReaders().find(x => x.region === this.focus) ?? this.namedReaders().find(x => x.pane.msg?.id === m.id);
    return { reader: r?.name ?? where, id: m.id };
  }

  /** `focus`: which area keys go to — "lanes" or a reader. */
  focusOn(sel: string): { focus: string } {
    if (sel === "lanes") this.focus = "lanes";
    else {
      const r = this.pickReader(sel);
      if (!r.region) throw new ActionRefused(`${r.name} isn't open`);
      this.focus = r.region;
      if (r.region.startsWith("detail")) this.active = Number(r.region.slice(6));
    }
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

  /** `card.move`: the selected card (or `card`) into the lane named `lane`, by the same move as H/L, m and a drag. */
  async moveCard(lane: string, card: string | undefined, actor: Actor) {
    // Selecting the card to move never takes the keys from the reader the person is in.
    if (card && !this.selectCard(card, actor.kind !== "agent")) throw new ActionRefused(`no lane on the board lists ${card}`);
    const c = this.card();
    if (!c) throw new ActionRefused("no card is selected");
    const want = lane.toLowerCase();
    const to = this.lanes.findIndex(l => l.name.toLowerCase() === want);
    if (to < 0) throw new ActionRefused(`no lane ${lane}; lanes: ${this.lanes.map(l => l.name).join(", ")}`);
    if (to === this.lane) throw new ActionRefused(`the card is already in ${this.lanes[to]!.name}`);
    this.lastMove = null;
    await this.moveTo(to, actor);
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
      backlinks: this.links ? { target: brief(this.links.target), from: this.links.from, count: this.links.items?.length ?? null, selected: this.links.items?.[this.links.sel]?.title ?? null, pinned: this.linksPinned } : null,
      images: this.placed.length,
      moving: this.moving, lastMove: this.lastMove,
      composer: this.composer ? { kind: this.composer.kind, ...(this.composer.kind === "card" ? { lane: this.composer.lane.name, bornWith: this.composer.born, needs: this.composer.needs, parent: this.composer.parent } : { parent: brief(this.composer.parent) }), dirty: this.composer.draft.dirty, note: this.composer.draft.note || null } : null,
      steps: this.steps ? { card: brief(this.steps.card), revision: this.steps.read?.revision ?? null, selected: this.steps.sel + 1, items: this.steps.read?.items.map((it, i) => ({ n: i + 1, status: it.status, text: stepText(it.text), id: it.itemId ?? null })) ?? null, note: this.steps.note || null } : null,
      trashArmed: this.trashArm?.id ?? null, trashed: this.trashed, lastWrite: this.lastWrite,
      refreshes: { ...this.refreshes },
      views: this.lanes[0]?.read?.by ?? null,
      mover: this.mover ? { card: brief(this.mover.card), options: this.lanes.map((l, i) => ({ lane: l.name, plan: this.mover!.plans[i], selected: i === this.mover!.sel })) } : null,
      readers: this.namedReaders().filter(r => r.pane.msg).map(r => ({ name: r.name, focused: r.region === this.focus, ...r.pane.describe() })),
      editing: this.readers().filter(r => r.draft).map(r => draftState(r)),
      commenting: this.readers().filter(r => r.session).map(r => r.session!.describe()),
    };
  }

  private card(): Msg | undefined { const l = this.lanes[this.lane]; return l?.items?.[l.sel]; }
  private follow() { const m = this.card(); if (m && m.id !== this.preview.msg?.id) { this.current = m; this.preview.show(m, this); } }

  // ── DeskApi: the reused tree and reader panes call back through this ───────

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } = {}) {
    if (!m) return;
    this.current = m;
    const from = opts.from;
    if (from === this.tree) this.treePreview.show(m, this);                     // tree → its own mini preview
    else if (from instanceof ReaderPane && from !== this.preview) from.show(m, this);   // links open in place
    else this.preview.show(m, this);
    this.redraw();
  }
  focusKind(kind: PaneKind) { if (kind === "reader" && this.current) this.openDetail(this.current, false); }
  redraw() { this.ctx?.redraw(); }

  private openDetail(m: Msg, fresh: boolean) {
    // A detail holding an edit is never reused, dropped or left behind by focus.
    if (fresh || !this.details.length || this.details[this.active]?.editing) {
      if (this.details.length >= 2) {
        const drop = this.details.findIndex(d => !d.editing);
        if (drop < 0) return this.ctx.flash("both details hold edits · save or close one first");
        this.details.splice(drop, 1);
      }
      this.details.push(new ReaderPane());
      this.active = this.details.length - 1;
    }
    this.details[this.active]!.show(m, this);
    if (!this.readerFor(this.focus)?.pane.editing) this.focus = `detail${this.active}`;
    if (!this.treePinned) this.treeOpen = false;
    this.redraw();
  }

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
    const links: NonNullable<DeliveryBoard["links"]> = { target: m, from: rd.label, items: null, sel: 0, top: 0 };
    this.links = links;
    this.linksPreview.show(null, this);
    this.focus = "backlinks";
    this.ctx.board.backlinks(m.id).then(items => { links.items = items; this.previewLink(); this.redraw(); }, e => { links.items = []; this.ctx.flash(String(e.message)); });
    this.redraw();
  }

  private previewLink() {
    const b = this.links?.items?.[this.links.sel];
    if (!b || b.id === this.linksPreview.msg?.id) return;
    this.ctx.board.get(b.id).then(m => { if (m && this.links?.items?.[this.links.sel]?.id === m.id) { this.linksPreview.show(m, this); this.redraw(); } }, () => {});
  }

  /** Pop the focused reader out as a floating pane, or dock a floating one back as a detail. */
  private popOut() {
    const f = this.focus;
    const W = this.ctx.t.cols, H = this.ctx.t.rows - 2;
    if (f.startsWith("float")) {
      const i = Number(f.slice(5)), fl = this.floats[i]!;
      this.floats.splice(i, 1);
      if (this.details.length >= 2) this.details.shift();
      this.details.push(fl.pane);
      this.active = this.details.length - 1;
      this.focus = `detail${this.active}`;
      return this.redraw();
    }
    const rd = this.readerFor(f);
    if (!rd?.pane.msg) return this.ctx.flash("focus a reader with something in it, then o to pop it out");
    let pane: ReaderPane;
    if (f.startsWith("detail")) { pane = this.details.splice(Number(f.slice(6)), 1)[0]!; this.active = Math.max(0, this.details.length - 1); }
    else { pane = new ReaderPane(); pane.show(rd.pane.msg, this); }            // preview and drawer previews keep following; float a copy
    const n = this.floats.length;
    this.floats.push({ pane, rect: { col: Math.round(W * 0.22) + n * 3, row: Math.round(H * 0.12) + n * 2, cols: Math.round(W * 0.5), rows: Math.round(H * 0.6) } });
    this.focus = `float${this.floats.length - 1}`;
    this.redraw();
  }

  private raise(i: number) {
    const [f] = this.floats.splice(i, 1);
    this.floats.push(f!);
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
  private async moveTo(to: number, actor: Actor = USER) {
    const from = this.lane, card = this.card(), target = this.lanes[to];
    if (!card || !target || to === from) return;
    const ctx = asActor(this.ctx, actor);
    const by = actor.kind === "agent" ? { by: actor.id } : {};
    const blocked = this.moveBlocked(card);
    if (blocked) { this.lastMove = { card: card.id, to: target.name, result: `refused: ${blocked}`, ...by }; return ctx.flash(`not moved: ${blocked}`); }
    const plan = planMove(card, target);
    if (plan.kind === "refused") { this.lastMove = { card: card.id, to: target.name, result: `refused: ${plan.reason}`, ...by }; return ctx.flash(`can't move to ${target.name}: ${plan.reason}`); }
    if (plan.kind === "already") {
      this.lane = to; target.want = card.id; this.loadLanes();
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
      if (this.lane === from) this.lane = to;           // follow the card unless the user already went elsewhere
      target.want = card.id;
      if (this.collapsed.delete(target.name)) this.save();   // a card moved into a spine should still be seen
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
  selectedCardId(): string { return this.cardFor().id; }
  async listSteps(id?: string) {
    const card = this.cardFor(id);
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
  private cardFor(id?: string): Msg {
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
   * it one (the note's text gains `^task-…`).
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
    this.placed = []; this.overlays = []; this.readerEdges = [];
    const treeW = clamp(Math.round(W * this.lay.treeFrac), 28, Math.round(W * 0.7));
    const pinnedTree = this.treePinned && this.treeOpen;
    const area: Rect = {
      col: pinnedTree && this.lay.treeSide === "left" ? treeW : 0, row: 0,
      cols: W - (pinnedTree ? treeW : 0), rows: H,
    };

    // Lanes across the top.
    const laneH = clamp(Math.round(H * this.lay.laneFrac), 5, H - 6);
    this.drawLanes(canvas, { ...area, rows: laneH });
    this.rects.set("split:lanes", { col: area.col, row: laneH, cols: area.cols, rows: 1 });

    // Docked readers: the shared preview plus up to two details.
    let readersH = H - laneH;
    const linksH = clamp(Math.round(readersH * this.lay.linksFrac), 6, readersH - 3);
    if (this.links && this.linksPinned) readersH -= linksH;
    const docked: { region: Region; pane: ReaderPane; label: string }[] = [
      { region: "preview", pane: this.preview, label: "preview · follows the board" },
      ...this.details.map((p, i) => ({ region: `detail${i}` as Region, pane: p, label: `detail ${i + 1}${this.details.length > 1 && i === this.active ? " · ⏎ opens here" : ""}` })),
    ];
    const ww = docked.map((_, i) => Math.max(0.2, this.lay.readerWeights[i] ?? 3));
    const wsum = ww.reduce((a, b) => a + b, 0);
    let x = area.col;
    docked.forEach((r, i) => {
      const w = i === docked.length - 1 ? area.col + area.cols - x : Math.max(12, Math.round((area.cols * ww[i]!) / wsum));
      this.drawReader(canvas, { col: x, row: laneH, cols: w, rows: readersH }, r.region, r.pane, r.label, r.pane.hint(), 0);
      x += w;
      if (i < docked.length - 1) this.readerEdges.push({ a: i, b: i + 1, x, area: { col: area.col, row: laneH, cols: area.cols, rows: readersH } });
    });

    // Backlinks drawer spans every reader; overlays unless pinned.
    if (this.links) {
      const r: Rect = { col: area.col, row: laneH + (this.linksPinned ? readersH : readersH - linksH), cols: area.cols, rows: linksH };
      if (!this.linksPinned) this.overlays.push({ r, layer: 1 });
      this.drawLinks(canvas, r);
      this.rects.set("split:links", { col: r.col, row: r.row, cols: r.cols, rows: 1 });
    }
    // Outline drawer on the left or right, sliding over unless pinned.
    if (this.treeOpen) {
      const r: Rect = { col: this.lay.treeSide === "left" ? 0 : W - treeW, row: 0, cols: treeW, rows: H };
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
        for (let y = rect.row; y < rect.row + rect.rows; y++) canvas.text(rect.col + rect.cols - 1, y, fg(C.blue) + "│" + RESET, 1);
        const label = `${l.name} ${l.items?.length ?? "…"}`;
        [...label].slice(0, rect.rows).forEach((ch, k) => canvas.text(rect.col + 1, rect.row + k, (on ? SEL : fg(C.cyan)) + ch + RESET, 1));
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

  private drawReader(canvas: Canvas, r: Rect, region: Region, pane: ReaderPane, label: string, hint = pane.hint(), layer = 0) {
    const inner = this.frame(canvas, r, region, label, hint);
    if (inner.cols < 4 || inner.rows < 1) return;
    this.paneInto(canvas, inner, pane, region, layer);
  }

  private paneInto(canvas: Canvas, inner: Rect, pane: ReaderPane, key: string, layer: number) {
    const view = pane.render(inner.cols, inner.rows, false, this);
    view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    for (const p of view.placements ?? [])
      this.placed.push({ layer, p: { ...p, key: `${key}:${p.key}`, col: inner.col + p.col, row: inner.row + p.row, cols: Math.min(p.cols, inner.cols - p.col), rows: Math.min(p.rows, inner.rows - p.row) } });
  }

  private drawLinks(canvas: Canvas, r: Rect) {
    const L = this.links!;
    if (!this.linksPinned) canvas.clear(r, bg(C.black));
    const count = L.items ? `${L.items.length} source${L.items.length === 1 ? "" : "s"}` : "…";
    const listW = Math.round(r.cols * 0.5);
    const listR: Rect = { ...r, cols: listW };
    const inner = this.frame(canvas, listR, "backlinks", `backlinks · ${subject(L.target).slice(0, 50)} · ${count} ${fg(C.dark)}(from ${L.from})${this.linksPinned ? " · pinned" : ""}`, "⏎ open · alt⏎ new detail · B pin · esc");
    const items = L.items ?? [];
    const fit = Math.max(1, Math.floor(inner.rows / 2));
    if (L.sel < L.top) L.top = L.sel;
    if (L.sel >= L.top + fit) L.top = L.sel - fit + 1;
    items.slice(L.top, L.top + fit).forEach((b, j) => {
      const sel = L.top + j === L.sel;
      const y = inner.row + j * 2;
      canvas.text(inner.col, y, (sel ? (this.focus === "backlinks" ? SEL : bg(C.dark) + fg(C.white)) : fg(C.white)) + pad(` ${b.title}`, inner.cols) + RESET, inner.cols);
      canvas.text(inner.col, y + 1, fg(C.dark) + pad(`   ${b.context} · ${b.kinds} · ${ago(b.updatedAt)}`, inner.cols) + RESET, inner.cols);
    });
    if (L.items && !items.length) canvas.text(inner.col + 1, inner.row, fg(C.dark) + "nothing links here" + RESET, inner.cols);
    // Its own preview, following the selected source.
    const pr: Rect = { col: r.col + listW, row: r.row, cols: r.cols - listW, rows: r.rows };
    canvas.box(pr, fg(C.blue), fg(C.grey) + "backlink preview");
    const pin = { col: pr.col + 1, row: pr.row + 1, cols: pr.cols - 2, rows: pr.rows - 2 };
    const snip = items[L.sel]?.snippet;
    if (snip) canvas.text(pin.col, pin.row, fg(C.green) + pad(`"${snip}"`, pin.cols) + RESET, pin.cols);
    this.paneInto(canvas, { ...pin, row: pin.row + 1, rows: pin.rows - 1 }, this.linksPreview, "links", this.linksPinned ? 0 : 1);
  }

  private drawTree(canvas: Canvas, r: Rect, overlay: boolean) {
    if (!this.treeReady) { this.tree.init(this); this.treeReady = true; }
    if (overlay) canvas.clear(r, bg(C.black));
    const treeRows = r.rows >= 24 ? Math.round(r.rows * 0.6) : r.rows;
    const tr: Rect = { ...r, rows: treeRows };
    const inner = this.frame(canvas, tr, "tree", `outline · ${this.treePinned ? "pinned" : "drawer"} · ${this.lay.treeSide}`, "⏎ open · T pin · S side · esc");
    this.tree.render(inner.cols, inner.rows, this.focus === "tree", this).lines.slice(0, inner.rows)
      .forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    if (treeRows < r.rows) {
      const pr: Rect = { col: r.col, row: r.row + treeRows, cols: r.cols, rows: r.rows - treeRows };
      canvas.box(pr, fg(C.blue), fg(C.grey) + "outline preview");
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
    const title = `${fg(C.yellow)}⧉ ${f.pane.msg ? subject(f.pane.msg).slice(0, r.cols - 12) : "float"}`;
    this.drawReader(canvas, r, `float${i}`, f.pane, title, "drag title · drag ◢ · o dock · x close", 3 + i);
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
    const undo = this.trashed ? bg(C.red) + fg(C.white) + ` TRASHED "${this.trashed.title}"${this.trashed.by ? ` by an agent (${this.trashed.by})` : ""} · u restores ` + RESET + " " : "";
    const base = this.focus === "lanes"
      ? "|08 |15g|08 boards · h l lane · j k card · |15⏎|08 detail · |15H L|08 move · |15m|08 move to... · |15n|08 new card · |15N|08 note under · |15s|08 steps · |15d d|08 trash · |15c|08 collapse · |15t|08 outline · |15b|08 backlinks · |15o|08 pop out · |15tab|08 area"
      : this.focus.startsWith("float")
        ? "|08 drag the title to move · drag |15◢|08 to resize · |15H J K L|08 move · |15o|08 dock · |15x|08 close · |15tab|08 area"
        : "|08 |15tab|08 area · |15t|08 outline · |15b|08 backlinks of this reader · |15o|08 pop out · |15x|08 close · |15{ } < >|08 size · |15esc|08 lanes";
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
    // An open edit takes every key, board shortcuts included, until it is saved or closed.
    const editing = this.readerFor(this.focus)?.pane;
    if (editing?.editing) {
      // Clicks can't move focus off an open edit; that would strand it where no key reaches it.
      if (k.kind === "mouse") { if (k.action === "down") this.ctx.flash("finish the edit first · ctrl+s saves · esc closes"); return; }
      editing.key(k, this); return;
    }
    // The property panel takes the keys it uses (Tab, y, o, e) before the board's own; clicks still pass.
    if (editing?.holdsKeys && k.kind !== "mouse") { editing.key(k, this); return; }
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A card or note being written holds every key, like an edit; a click can't take focus from it.
    if (this.composer) {
      if (k.kind === "mouse") { if (k.action === "down") this.ctx.flash("finish the new card first · ctrl+s creates · esc closes"); return; }
      return this.composerKey(k);
    }
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
    if (c === "g") { this.status = "looking for boards…"; this.redraw(); this.findBoards().then(items => { this.status = ""; this.picker = { items, sel: Math.max(0, items.findIndex(i => i.hub.id === this.hub?.id)) }; this.redraw(); }, () => {}); return; }
    if (k.kind === "tab" || k.kind === "backtab") {
      const rs = this.regions(), i = rs.indexOf(this.focus);
      this.focus = rs[(i + (k.kind === "tab" ? 1 : rs.length - 1)) % rs.length]!;
      if (this.focus.startsWith("detail")) this.active = Number(this.focus.slice(6));
      return this.redraw();
    }
    // Layout keys work from anywhere.
    const nudge = (key: keyof Layout, d: number, lo: number, hi: number) => { (this.lay as any)[key] = clamp((this.lay as any)[key] + d, lo, hi); this.save(); this.redraw(); };
    if (c === "{") return nudge("laneFrac", -0.05, 0.15, 0.8);
    if (c === "}") return nudge("laneFrac", 0.05, 0.15, 0.8);
    if (c === "<" || c === ">") {
      const d = c === ">" ? 1 : -1;
      if (this.focus === "tree") return nudge("treeFrac", 0.04 * d, 0.15, 0.7);
      if (this.focus === "lanes") { const n = this.lanes[this.lane]?.name; if (n) this.lay.laneWeights[n] = clamp((this.lay.laneWeights[n] ?? 1) + 0.2 * d, 0.3, 5); }
      else { const i = this.focus === "preview" ? 0 : this.focus.startsWith("detail") ? Number(this.focus.slice(6)) + 1 : -1; if (i >= 0) this.lay.readerWeights[i] = clamp((this.lay.readerWeights[i] ?? 3) + 0.5 * d, 0.5, 20); }
      this.save(); return this.redraw();
    }
    if (c === "t") { this.treeOpen = !this.treeOpen || this.focus !== "tree"; this.focus = this.treeOpen ? "tree" : "lanes"; if (!this.treeOpen) this.treePinned = false; this.save(); return this.redraw(); }
    if (c === "T") { this.treePinned = !this.treePinned; this.treeOpen = this.treePinned || this.treeOpen; this.save(); return this.redraw(); }
    if (c === "S") { this.lay.treeSide = this.lay.treeSide === "left" ? "right" : "left"; this.treeOpen = true; this.save(); return this.redraw(); }
    if (c === "b" && this.focus !== "backlinks") return this.showLinks(this.focus);
    if (c === "B") { this.linksPinned = !this.linksPinned; if (!this.links) this.showLinks(this.focus); this.save(); return this.redraw(); }
    if (c === "o") return this.popOut();
    if (c === "C") { this.collapsed.clear(); this.save(); return this.redraw(); }
    if (c === "x" && this.focus.startsWith("detail")) {
      this.details.splice(Number(this.focus.slice(6)), 1);
      this.active = Math.max(0, this.details.length - 1);
      this.focus = this.details.length ? `detail${this.active}` : "lanes";
      return this.redraw();
    }
    if (c === "x" && this.focus.startsWith("float")) {
      this.floats.splice(Number(this.focus.slice(5)), 1);
      this.focus = this.floats.length ? `float${this.floats.length - 1}` : "lanes";
      return this.redraw();
    }
    if (this.focus.startsWith("float") && "HJKL".includes(c) && c) {
      const f = this.floats[Number(this.focus.slice(5))]!;
      f.rect.col += c === "H" ? -4 : c === "L" ? 4 : 0;
      f.rect.row += c === "K" ? -2 : c === "J" ? 2 : 0;
      return this.redraw();
    }
    if (c === "V") return ctx.cycleVideo();
    if (k.kind === "esc") {
      if (this.focus === "tree" && !this.treePinned) { this.treeOpen = false; this.focus = "lanes"; return this.redraw(); }
      if (this.focus === "backlinks" && !this.linksPinned) { this.links = null; this.focus = "lanes"; return this.redraw(); }
      if (this.focus !== "lanes") { this.focus = "lanes"; return this.redraw(); }
      if (this.treeOpen && !this.treePinned) { this.treeOpen = false; return this.redraw(); }
      if (this.links && !this.linksPinned) { this.links = null; return this.redraw(); }
      return ctx.pop();
    }

    if (this.focus === "lanes") return this.laneKey(k, c);
    if (this.focus === "tree") { this.tree.key(k, this); return; }
    if (this.focus === "backlinks") return this.linksKey(k, c);
    const rd = this.readerFor(this.focus);
    if (rd && !rd.pane.key(k, this) && k.kind === "enter" && rd.pane === this.preview && this.preview.msg) this.openDetail(this.preview.msg, false);
  }

  private laneKey(k: Key, c: string) {
    const visible = this.lanes.map((_, i) => i);
    const l = this.lanes[this.lane];
    const n = l?.items?.length ?? 0;
    if (k.kind === "left" || c === "h") this.lane = visible[Math.max(0, visible.indexOf(this.lane) - 1)]!;
    else if (k.kind === "right" || c === "l") this.lane = visible[Math.min(visible.length - 1, visible.indexOf(this.lane) + 1)]!;
    else if ((c === "e" || (k.kind === "char" && k.ctrl && k.ch === "e")) && this.preview.msg) { this.focus = "preview"; void this.preview.edit(this, c !== "e"); return this.redraw(); }
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

  private linksKey(k: Key, c: string) {
    const L = this.links!, n = L.items?.length ?? 0;
    if (k.kind === "down" || c === "j") { L.sel = Math.min(Math.max(0, n - 1), L.sel + 1); this.previewLink(); }
    else if (k.kind === "up" || c === "k") { L.sel = Math.max(0, L.sel - 1); this.previewLink(); }
    else if (k.kind === "pgdn" || k.kind === "pgup") this.linksPreview.key(k, this);
    else if (k.kind === "enter" || k.kind === "alt-enter") {
      const m = this.linksPreview.msg;
      if (m) { this.current = m; this.openDetail(m, k.kind === "alt-enter"); }
      return;
    }
    this.redraw();
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const inside = (r?: Rect) => !!r && k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    if (k.action === "up") {
      const d = this.drag;
      this.drag = null;
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
        return this.redraw();
      }
      const near = (x: number, edge: number) => x === edge || x === edge - 1;
      const edgeHit = (): Drag | null => {
        const tr = this.rects.get("split:tree");
        if (this.treeOpen && tr && k.y >= tr.row && k.y < tr.row + tr.rows && (k.x === tr.col || k.x === tr.col + (this.lay.treeSide === "left" ? 1 : -1))) return { kind: "tree-edge" };
        const lr = this.rects.get("split:links");
        if (this.links && lr && (k.y === lr.row) && k.x >= lr.col && k.x < lr.col + lr.cols) return { kind: "links-edge" };
        for (const e of this.laneEdges) if (near(k.x, e.x) && k.y >= e.rect.row && k.y < e.rect.row + e.rect.rows) return { kind: "lane-edge", a: e.a, b: e.b };
        for (const e of this.readerEdges) if (near(k.x, e.x) && k.y >= e.area.row && k.y < e.area.row + e.area.rows) return { kind: "reader-edge", a: e.a, b: e.b };
        const sl = this.rects.get("split:lanes");
        if (sl && (k.y === sl.row || k.y === sl.row - 1) && k.x >= sl.col && k.x < sl.col + sl.cols) return { kind: "lanes-split" };
        return null;
      };
      const e = edgeHit();
      if (e) { this.drag = e; return; }
      const order: Region[] = ["tree", "backlinks", "preview", ...this.details.map((_, i) => `detail${i}` as Region)];
      const region = order.find(r => inside(this.rects.get(r)) && (r !== "tree" || this.treeOpen) && (r !== "backlinks" || !!this.links));
      if (region) {
        if (this.treeOpen && !this.treePinned && region !== "tree") this.treeOpen = false;
        this.focus = region;
        if (region.startsWith("detail")) this.active = Number(region.slice(6));
        if (region === "tree") { const r = this.rects.get("tree")!; this.tree.click(k.x - r.col - 1, k.y - r.row - 1, this); }
        if (region === "backlinks") {
          const r = this.rects.get("backlinks")!, L = this.links!;
          const idx = L.top + Math.floor((k.y - r.row - 1) / 2);
          if (L.items && idx >= 0 && idx < L.items.length) { L.sel = idx; this.previewLink(); }
        }
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
      if (this.links && inside(this.rects.get("backlinks"))) { const L = this.links; L.sel = clamp(L.sel + dir, 0, Math.max(0, (L.items?.length ?? 1) - 1)); this.previewLink(); return this.redraw(); }
      for (const r of ["preview", ...this.details.map((_, i) => `detail${i}`)] as Region[]) if (inside(this.rects.get(r))) return this.readerFor(r)!.pane.wheel(dir, this);
      const hit = this.laneRects.find(l => inside(l.rect));
      if (hit && !hit.spine) { const l = this.lanes[hit.lane]!; l.sel = clamp(l.sel + dir, 0, Math.max(0, (l.items?.length ?? 1) - 1)); if (hit.lane === this.lane) this.follow(); this.redraw(); }
    }
  }

  private dragTo(x: number, y: number) {
    const d = this.drag!, W = this.ctx.t.cols, H = this.ctx.t.rows - 2;
    if (d.kind === "lanes-split") this.lay.laneFrac = clamp(y / H, 0.12, 0.85);
    else if (d.kind === "lane-edge") {
      const ra = this.laneRects.find(l => l.lane === d.a)?.rect, rb = this.laneRects.find(l => l.lane === d.b)?.rect;
      const na = this.lanes[d.a]!.name, nb = this.lanes[d.b]!.name;
      if (ra && rb) {
        const total = ra.cols + rb.cols, wa = clamp(x - ra.col + 1, 10, total - 10);
        const sum = (this.lay.laneWeights[na] ?? 1) + (this.lay.laneWeights[nb] ?? 1);
        this.lay.laneWeights[na] = (sum * wa) / total; this.lay.laneWeights[nb] = (sum * (total - wa)) / total;
      }
    }
    else if (d.kind === "reader-edge") {
      const ra = this.rects.get(d.a === 0 ? "preview" : `detail${d.a - 1}`), rb = this.rects.get(`detail${d.b - 1}`);
      if (ra && rb) {
        const total = ra.cols + rb.cols, wa = clamp(x - ra.col + 1, 12, total - 12);
        const rw = this.lay.readerWeights;
        const sum = (rw[d.a] ?? 3) + (rw[d.b] ?? 3);
        rw[d.a] = (sum * wa) / total; rw[d.b] = (sum * (total - wa)) / total;
      }
    }
    else if (d.kind === "tree-edge") this.lay.treeFrac = clamp((this.lay.treeSide === "left" ? x + 1 : W - x) / W, 0.15, 0.7);
    else if (d.kind === "links-edge") {
      const laneH = Math.round(H * this.lay.laneFrac);
      this.lay.linksFrac = clamp((H - y) / (H - laneH), 0.2, 0.9);
    }
    else if (d.kind === "float-move") { d.f.rect.col = x - d.dx; d.f.rect.row = y - d.dy; }
    else if (d.kind === "float-size") { d.f.rect.cols = Math.max(20, x - d.f.rect.col + 1); d.f.rect.rows = Math.max(5, y - d.f.rect.row + 1); }
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
    summary: "select a card in its lane; the preview follows", keys: "h l j k, click",
    args: { id: { type: "string", about: "the card's block id (or its first 8+ characters)" } },
    // An agent's selection moves the lanes' cursor (and the preview with it), never the person's keys.
    run({ id }, { b }, actor) { if (!b.selectCard(id, actor.kind !== "agent")) throw new ActionRefused(`no lane on the board lists ${id}`); return { selected: id }; },
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
    run: ({ text, parent }, { b }, actor) => b.createNote(parent ?? b.selectedCardId(), text, actor),
  },
  "steps": {
    summary: "list a card's checklist steps (the selected card, or card=<id>)", keys: "s",
    args: { card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ card }, { b }) => b.listSteps(card),
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
      return b.setStep(card ?? b.selectedCardId(), n, status as StepStatus | undefined, actor);
    },
  },
  "card.trash": {
    summary: "move the selected card (or card=<id>) and the notes under it to Trash; confirm=<its id> is the second d. The service records no author for this", keys: "d d",
    args: {
      confirm: { type: "string", about: "the card's id (or its first 8+ characters): the same card, said twice" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run: ({ confirm, card }, { b }, actor) => b.trashCard(card ?? b.selectedCardId(), confirm, actor),
  },
  "card.restore": {
    summary: "bring back the card trashed last from this board (or id=<block id>), where it was", keys: "u",
    args: { id: { type: "string", optional: true, about: "a Trash root's block id; default the card trashed last here" } },
    run: ({ id }, { b }, actor) => b.restoreCard(id, actor),
  },
});
