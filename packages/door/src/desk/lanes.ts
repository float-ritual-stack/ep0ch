// The board's lanes (PIE-511, PIE-515): what the hub source keeps for a columns container it fills, its model. The
// lanes are query tiles (src/desk/query.ts), one per view under the hub; what they share is here: the hub shown (and
// the hub picker), the lane the cursor is in, moving cards between lanes (H L, m, a drag, `card.move`), writing new
// cards and notes (the composer), a card's steps, trash and restore, each agent's own selected card, and the lanes'
// refresh from the change feed. The board is a screen spec on the desk (src/desk/screen-specs.ts); its readers row,
// drawers, floats and spines are the desk's. Every key and click runs an action (BOARD_ACTIONS, the source's).
import { subject, type Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import { byOf, USER, type Actor, type Change, type OutlineEvent } from "../socket";
import { ActionRefused, actionSet, def, agentLabel, asActor } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { draftPreview, leaveSaid, sessionStart } from "../surface/note";
import { viewSummaryKeys } from "../props";
import { bg, C, chip, ellipsize, fg, pad, paint, RESET } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, NO_PLAN, planMoves, type MovePlan } from "../move";
import { PROPERTY_KEY_SOURCE } from "@ep0ch/outline-core/property-grammar";
import { clamp, sideways, SidewaysWheel, wheelRows, type RowPress } from "../scroll";
import { DRAFT_ACTIONS } from "../edit";
import { cardTarget, DraftSession, openDraftOf, type DraftCommand, type LeaveResult } from "../draft-session";
import { editHint, editorClick, openInEditor, renderEditor, writtenBy } from "../surface/editor";
import { pickInto, type Picked } from "../pick";
import { completerFor, completerOf } from "../surface/completer";
import { Modes } from "../surface/modes";
import { ListPicker, pickRow } from "../surface/picker";
import { changedSinceRead, Refused, type ChecklistRead, type ChecklistStep, type CreatePlan, type StepStatus } from "../socket";
import { pickParent, titleOf, type ParentPick } from "./writes";
import { findBoards, hubViews, laneDefs, laneTileName, QueryPane } from "./query";
import type { TileSpec } from "./tiles";
import { ReaderPane, type Pane } from "./panes";
import type { ColumnsHost, SourceModel, TileSource } from "./tile-kinds";

/** A lane: a query tile of the board's hub (its view, cards, cursor and read). */
type Lane = QueryPane;
/** A card pressed in a lane: dragged onto another lane it moves there; released where it was, a click (a second one opens it). */
interface CardDrag { from: number; card: Msg; over: number | null; open: "open" | "fresh" | null }
/** What the lanes keep between runs: the hub shown in each workspace, and the lane the cursor was in. */
export interface LanesSaved { hubs?: Record<string, string>; lane?: string }


/** The board's pickers: the boards (`g`), the lanes a card moves to (`m`), a card's checklist steps (`s`). */
type HubPicker = ListPicker<{ hub: Msg; lanes: number }, Lanes>;
type Mover = ListPicker<Lane, Lanes> & { card: Msg; from: number; plans: MovePlan[] | null };
type Steps = ListPicker<ChecklistStep, Lanes> & { card: Msg; read: ChecklistRead | null; busy: boolean; note: string };

export class Lanes implements SourceModel {
  hub: Msg | null = null;
  /** The lane the cursor is in: what the lanes' keys and `card.*` act on when they name no lane. */
  private at: Lane | null = null;
  status = "looking for boards…";
  private hubs: Record<string, string> = {};
  /** The lane named last time: the cursor goes there once the lanes are read. */
  private wantLane: string | null = null;
  /** Its overlays (the hub picker, the mover, the steps): pickers on one mode stack; the first takes every key and click. */
  private readonly overlays = new Modes<Lanes, ListPicker<any, Lanes>>();
  /** The hub picker (`g`): the boards here. */
  get hubPicker(): HubPicker | null { return this.overlays.get("hubs") as HubPicker | null; }
  set hubPicker(p: HubPicker | null) { this.overlay("hubs", p); }
  /** The move picker (`m`): every lane with what moving the selected card there would patch. */
  get mover(): Mover | null { return this.overlays.get("mover") as Mover | null; }
  set mover(p: Mover | null) { this.overlay("mover", p); }
  /**
   * The service's move plans for one card at one revision into the lanes as they're defined now, for
   * drawing a drag or the picker without asking on every paint. `plans` is null while they're asked.
   */
  movePlans: { key: string; plans: Map<string, MovePlan> | null; failed?: boolean } | null = null;
  /** The card a move is patching right now; a second move waits for it. */
  moving: string | null = null;
  lastMove: { card: string; to: string; result: string; by?: string } | null = null;
  /** Lanes waiting to be asked again, gathered from change records and read together. */
  private dirtyLanes = new Set<Lane>();
  private reload: Timer | null = null;
  /** How the board has refreshed, for `peek` and tests: whole-board reloads vs lanes asked again. */
  refreshes = { full: 0, lanes: 0, readers: 0, skipped: 0 };
  /** Names of the lanes asked again, oldest first (tests and `peek`). */
  asked: string[] = [];
  /** A new card (`n`) or a note under a card (`N`) being written. Holds every key until created or closed. */
  composer: Composer | null = null;
  /** Where the composer was last drawn, for the mouse. */
  composerAt: Rect | null = null;
  /** The selected card's checklist steps (`s`): pick one and set its status. */
  get steps(): Steps | null { return this.overlays.get("steps") as Steps | null; }
  set steps(p: Steps | null) { this.overlay("steps", p); }
  private overlay(name: string, p: ListPicker<any, Lanes> | null) { if (p) this.overlays.push(p); else this.overlays.drop(name); }
  /** The first `d` on a card: a second one within a few seconds trashes it. */
  trashArm: { id: string; at: number } | null = null;
  /** The last card trashed from the board, until it is restored or another one is: `u` restores it. */
  trashed: { id: string; title: string; lane: string; children: number; by?: string } | null = null;
  /**
   * Each agent's own selected card (`card.select`), by actor id: what its card actions default to when
   * they name no card. The person's lane cursor, preview and keys are never an agent's to move.
   */
  private agentCards = new Map<string, string>();
  /** The last create, step change, trash or restore, for `peek` and tests. */
  lastWrite: { what: string; id?: string; result: string; by?: string } | null = null;
  /** A card pressed in a lane, being dragged. */
  cardDrag: CardDrag | null = null;
  /** Sideways wheel reports over the lanes, one step a swipe. */
  private readonly swipe = new SidewaysWheel();
  /** The lanes were filled once: the person started on them (a later refill never moves their keys). */
  private started = false;

  /** `named`: the hub the container names (`hub:<id>`), shown first; else the one remembered for the workspace. */
  constructor(readonly host: ColumnsHost, readonly container: string, private readonly named: string | null, saved?: LanesSaved) {
    if (saved?.hubs && typeof saved.hubs === "object") this.hubs = { ...saved.hubs };
    if (typeof saved?.lane === "string") this.wantLane = saved.lane;
    queueMicrotask(() => void this.chooseStart());
  }

  // ── the lanes and the cursor ──

  /** The board's lanes (its hub's query tiles), in the columns' order; one moved out of them after. */
  get lanes(): Lane[] { return this.host.supplied(this.container).filter((p): p is Lane => p instanceof QueryPane); }
  /** The lane the cursor is in, by place: the lane with the keys, else the one it was last in. */
  get lane(): number {
    const lanes = this.lanes, f = this.host.focusedPane();
    if (f instanceof QueryPane && lanes.includes(f)) this.at = f;
    return Math.max(0, this.at ? lanes.indexOf(this.at) : -1);
  }
  set lane(i: number) {
    const lanes = this.lanes, had = this.onLanes;
    this.at = lanes[clamp(i, 0, Math.max(0, lanes.length - 1))] ?? null;
    // The lanes' keys go with the cursor: the lane it's in is the tile with the keys.
    if (had && this.at) this.host.focusPane?.(this.at, USER);
    this.markCurrent();
  }
  laneTile(): Lane | undefined { return this.lanes[this.lane]; }
  /** Each lane knows whether the cursor is in it (its frame is brighter). */
  private markCurrent() { const at = this.laneTile(); for (const l of this.lanes) l.current = l === at; }
  /** The lanes have the keys (the lane the cursor is in). */
  private get onLanes(): boolean { const f = this.host.focusedPane(); return f instanceof QueryPane && this.lanes.includes(f); }
  /** The person's keys to the lanes (the lane the cursor is in). */
  private toLanes() { const l = this.laneTile(); if (l) this.host.focusPane?.(l, USER); }
  /** The reader following the lanes (the board's preview), if one does. */
  private preview(): ReaderPane | undefined { return this.host.followersOf(this.container).find((p): p is ReaderPane => p instanceof ReaderPane); }
  /** Every reader on the screen. */
  private readers(): ReaderPane[] { return this.host.readerPanes().map(r => r.pane); }

  // ── what the desk asks of a source's model ──

  /** A lane the hub supplied: the board refreshes it (precisely, from the change feed) and draws its hint. */
  supplied(p: Pane) {
    if (!(p instanceof QueryPane)) return;
    p.model = this;
    p.managed = true;
    p.boardHint = "c collapse · H L move";
    p.loaded = q => { if (q === this.laneTile()) this.follow(); };
  }

  /** The lanes were filled (a hub shown, a view added or renamed): each is asked for its cards. */
  filled(title?: string) {
    if (title && this.hub) this.host.title = `board · ${title}`;
    const lanes = this.lanes;
    if (!this.at || !lanes.includes(this.at)) {
      const want = this.wantLane ? lanes.findIndex(l => l.name === this.wantLane) : -1;
      this.wantLane = null;
      this.at = lanes[Math.max(0, want)] ?? null;
    }
    this.markCurrent();
    // The person starts on the lanes (unless they went elsewhere meanwhile).
    const pv = this.preview();
    if (!this.started && this.at && pv && this.host.focusedPane() === pv && !this.host.holdsKeys?.()) this.host.focusPane?.(this.at, USER);
    if (this.at) this.started = true;
    this.loadLanes();
  }

  /** Before the screen draws: a card dragged over a lane, that lane's frame says what dropping it there would patch. */
  frame() {
    const d = this.cardDrag;
    this.lanes.forEach((l, i) => { l.drop = d && d.over === i && i !== d.from ? { plan: this.cachedPlan(d.card, l) } : undefined; });
    this.markCurrent();
  }

  empty(): string | null { return this.lanes.length ? null : this.status || (this.hub ? subject(this.hub) : "board"); }

  /** The person's keys are the board's own business right now: a new card or note being written, the mover or steps overlay, or the hub picker. */
  busy(): boolean { return !!this.composer || !!this.overlays.top(); }

  unsaved() { return !!this.composer?.session.dirty; }
  keepDrafts() { const c = this.composer; return c?.session.dirty ? [c.session.keep()] : []; }
  save(): LanesSaved { const l = this.laneTile(); return { hubs: this.hubs, ...(l ? { lane: l.name } : {}) }; }
  dispose() { if (this.reload) clearTimeout(this.reload); }
  draftBlock(actor: Actor): string | null { return this.selectedCardOr(actor); }

  onEvent(e: OutlineEvent) {
    if (e.action === "reset") return this.reloadAll();
    if (e.action === "reconnected") {
      // Caught up; lanes that failed while the service was away are asked again.
      const failed = this.lanes.filter(l => l.read?.status === "failed" || !l.read);
      if (failed.length) this.loadLanes(failed);
      return;
    }
    if (e.change) this.changed(e.change, e);
  }

  /** Its overlays over the screen (the hub picker, the mover, the steps, the composer): true when one took it. */
  drawOver(canvas: Canvas, area: Rect): boolean {
    const W = area.cols, H = area.rows + area.row;
    for (const o of [...this.overlays.all()].reverse()) o.draw(canvas, { col: 0, row: 0, cols: W, rows: H });
    if (this.composer) this.drawComposer(canvas, W, H);
    return !!(this.overlays.top() || this.composer);
  }

  /** A mode of the board's own says its keys first: a card dragged, the mover, the composer, the steps. */
  hint(): string | null {
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

  /** The screen's hint here: the card trashed last before it (u restores it), what the board is doing after. */
  decorate(hint: string): string {
    const undo = this.trashed ? chip(C.red) + ` TRASHED "${this.trashed.title}"${this.trashed.by ? ` by an agent (${this.trashed.by})` : ""} · u restores ` + RESET + " " : "";
    return undo + hint + (this.status && this.lanes.length ? paint(` · |14${this.status}`) : "");
  }

  /**
   * Its own keys before the screen's: an open overlay (the composer, the steps, the mover, the hub picker) holds every
   * key and click; a key that isn't `d` lets go of a trash armed.
   */
  key(k: Key): boolean {
    const c = ch(k);
    // A card or note being written holds every key, like an edit.
    if (this.composer) {
      if (k.kind !== "mouse") { this.composerKey(k); return true; }
      // The wheel scrolls it, a click places the cursor, a drag selects. A click outside it puts it aside as
      // unsent (composer.leave: never created, n brings it back) and does what it does on the board.
      const d = this.composer.session.draft, r = this.composerAt;
      const pop = completerOf(d)?.shown ? completerOf(d) : null;
      if (k.action === "wheel-up" || k.action === "wheel-down") { if (pop) pop.move(k.action === "wheel-down" ? 1 : -1); else void DRAFT_ACTIONS.run("draft.scroll", { by: wheelRows(k.action === "wheel-down" ? 1 : -1) }, d, USER); this.host.redraw(); return true; }
      const inside = !!r && k.x >= r.col && k.y >= r.row && k.x < r.col + r.cols && k.y < r.row + r.rows;
      const inText = !!r && k.x > r.col && k.y > r.row && k.x < r.col + r.cols - 1 && k.y < r.row + r.rows - 1;
      if (r && pop && k.action === "down" && inText && pop.click(k.y - r.row - 1)) { this.host.redraw(); return true; }
      if (r && (k.action === "down" || k.action === "drag") && (inText || k.action === "drag") && editorClick(d, k.x - r.col - 1, k.y - r.row - 1, k.action === "drag", USER, { pick: () => void this.host.pressAction(BOARD_ACTIONS, "composer.pick", {}) })) { this.host.redraw(); return true; }
      if (k.action !== "down" || inside) return true;
      if (d.busy) { this.host.ctx.flash("the new card is being created · wait for it"); return true; }
      void this.host.pressAction(BOARD_ACTIONS, "composer.leave").then(r => { const said = r ? leaveSaid(r as LeaveResult) : null; if (said) this.host.ctx.flash(said, 8000); this.host.redraw(); });
    }
    if (this.trashArm && !(c === "d" && this.onLanes)) this.trashArm = null;   // any other key keeps the card
    if (this.overlays.key(k, this) !== null) { this.host.redraw(); return true; }
    // A card dragged across lanes: the drag and the release are its, wherever they land.
    if (k.kind === "mouse" && this.cardDrag) return this.laneMouse(k);
    return false;
  }

  /** A key on a lane (the query tile's own, `QueryPane.key`, on the board): the lanes' keys. */
  laneKeys(k: Key): boolean { return this.laneKey(k, ch(k)); }

  /** A board action as the person; a refusal is said on the status bar (a move says its own as it lands). */
  private run(name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null)): Promise<unknown> {
    return this.host.pressAction(BOARD_ACTIONS, name, args, undefined, quiet ?? name === "card.move");
  }

  peek(): Record<string, unknown> {
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : null);
    const lanes = this.lanes;
    return {
      hub: brief(this.hub),
      lanes: lanes.map((l, i) => ({ name: l.name, tile: this.host.nameOfPane(l), count: l.items?.length ?? null, status: l.read?.status, truncated: l.read?.truncated, collapsed: this.host.folded(l), focused: i === this.lane, selected: brief(l.items?.[l.sel]) })),
      preview: brief(this.preview()?.msg),
      moving: this.moving, lastMove: this.lastMove,
      composer: this.composer ? { kind: this.composer.kind, ...(this.composer.kind === "card" ? { lane: this.composer.lane.name, bornWith: this.composer.born, needs: this.composer.needs, parent: this.composer.parent } : { parent: brief(this.composer.parent) }), dirty: this.composer.session.dirty, note: this.composer.session.draft.note || null } : null,
      steps: this.steps ? { card: brief(this.steps.card), revision: this.steps.read?.revision ?? null, selected: this.steps.sel + 1, items: this.steps.read?.items.map((it, i) => ({ n: i + 1, status: it.status, text: stepText(it.text), id: it.itemId ?? null })) ?? null, note: this.steps.note || null } : null,
      agentSelected: Object.fromEntries(this.agentCards),
      trashArmed: this.trashArm?.id ?? null, trashed: this.trashed, lastWrite: this.lastWrite,
      refreshes: { ...this.refreshes },
      mover: this.mover ? { card: brief(this.mover.card), options: lanes.map((l, i) => ({ lane: l.name, plan: this.mover!.plans?.[i] ?? "planning", selected: i === this.mover!.sel })) } : null,
    };
  }

  /** The hub to show first: the one named, the one remembered here, Delivery Flow, the only one, or the picker. */
  private async chooseStart() {
    const ctx = this.host.ctx;
    try {
      const remembered = this.named ?? this.hubs[ctx.workspace];
      const hub = remembered ? await ctx.board.get(remembered) : null;
      if (hub) return this.useHub(hub);
      const found = await findBoards(ctx.board);
      const df = found.find(f => subject(f.hub) === "Delivery Flow");
      if (df || found.length === 1) return this.useHub((df ?? found[0]!).hub);
      if (!found.length) { this.status = "no hub with virtual-branch children here; pass --board <block-id>"; return this.host.redraw(); }
      this.hubPicker = this.hubList(found);
      this.status = "";
    } catch (e) { this.status = String((e as Error).message); }
    this.host.redraw();
  }

  /** Show `hub`'s board: its views become the lanes (the columns' source), each asked for its cards. */
  private async useHub(hub: Msg) {
    this.hub = hub; this.hubPicker = null;
    this.hubs[this.host.ctx.workspace] = hub.id;
    this.host.title = `board · ${subject(hub)}`;
    const onLanes = this.onLanes;
    await this.host.showSource(this.container, `hub:${hub.id}`);
    // The person was on the lanes: they're on the new board's (its old lanes were closed under them).
    if (onLanes && !this.host.holdsKeys?.()) this.toLanes();
    this.status = "";
    this.host.save();
    this.host.redraw();
  }

  loadLanes(which: Lane[] = this.lanes) {
    if (which === this.lanes || which.length === this.lanes.length) this.refreshes.full++; else this.refreshes.lanes += which.length;
    this.asked.push(...which.map(l => l.name));
    if (this.asked.length > 200) this.asked.splice(0, 100);
    for (const l of which) void l.load(this.host);
  }

  /** Everything again: after a reconnect the door couldn't catch up on. Drafts are kept, only marked. */
  private reloadAll() {
    if (this.reload) clearTimeout(this.reload);
    if (this.hub) this.loadLanes();
    for (const r of this.readers()) {
      const m = r.msg;
      if (!m || m.id.startsWith("file:")) continue;
      this.host.ctx.board.get(m.id).then(n => { if (n) { r.refresh(n); this.host.redraw(); } }, () => {});
      void r.loadComments(this.host);
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
      this.host.ctx.board.checklist(id).then(r => {
        if (this.steps !== S || S.busy || (S.read && r.revision < S.read.revision)) return;
        S.read = r; S.sel = clamp(S.sel, 0, Math.max(0, r.items.length - 1)); this.host.redraw();
      }, () => {});
    }
    // The readers are the desk's to refresh (it re-reads a stale one, and tells one whose threads changed); the lanes
    // only count what a change did to them, for peek and tests.
    for (const r of this.readers()) {
      const m = r.msg;
      if (!m) continue;
      if (r.surface.staleOn(e)) this.refreshes.readers++;
      else if (id && m.id === id) this.refreshes.skipped++;
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
    this.host.ctx.board.planMoves(ready.map(l => l.view), id).then(r => {
      this.markLanes([...members, ...ready.filter(l => r.plans.get(l.view)?.kind === "already")]);
    }, () => this.markLanes(this.lanes));
  }

  /** The lanes (other than `except`) the service says `card` is in now. */
  private async lanesHolding(card: Msg, except: number): Promise<string[]> {
    const others = this.lanes.filter((l, i) => i !== except && l.read?.status === "ready");
    if (!others.length) return [];
    const r = await this.host.ctx.board.planMoves(others.map(l => l.view), card.id).catch(() => null);
    return r ? others.filter(l => r.plans.get(l.view)?.kind === "already").map(l => l.name) : [];
  }

  /**
   * The service's plan for moving `card` into lane `l`, for drawing: from the plans asked for this card
   * at this revision and these lane definitions, or null while they're being asked (the first call asks).
   */
  private cachedPlan(card: Msg, l: Lane): MovePlan | null {
    const key = `${card.id}@${card.revision}|${this.lanes.map(x => `${x.view}@${x.def?.revision}`).join(",")}`;
    if (this.movePlans?.key !== key) {
      const entry: NonNullable<Lanes["movePlans"]> = { key, plans: null };
      this.movePlans = entry;
      const views = this.lanes.map(x => x.view);
      planMoves(this.host.ctx.board, card, views).then(
        plans => { entry.plans = plans; this.host.redraw(); },
        // Said for the rest of this drag only: the next drag asks again (a timeout or a dropped socket passes).
        (e: Error) => { entry.failed = true; entry.plans = new Map(views.map(v => [v, { kind: "refused" as const, reason: e.message }])); this.host.redraw(); },
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

  /** A lane's `[summary-properties::…]` decides the summary for the cards it lists (the selected lane first). */
  summaryKeys(m: Msg): readonly string[] | null {
    const lane = [this.laneTile(), ...this.lanes].find(l => l?.items?.some(x => x.id === m.id));
    return viewSummaryKeys(lane?.def ?? undefined);
  }

  /** Select a card in the lanes (the preview follows). False when no loaded lane lists it. */
  selectCard(id: string, focus = true): boolean {
    const i = this.lanes.findIndex(l => l.items?.some(m => m.id === id || (id.length >= 8 && m.id.startsWith(id))));
    if (i < 0) return false;
    const l = this.lanes[i]!;
    this.lane = i; l.sel = l.items!.findIndex(m => m.id === id || m.id.startsWith(id));
    if (focus) this.toLanes();
    this.follow(); this.host.redraw();
    return true;
  }

  // ── the person's keys and clicks run the board's actions (PIE-506): the same code as `act` ──

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
        this.lane = at; l.sel = i; this.toLanes(); this.follow(); this.host.save(); this.host.redraw();
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
    this.host.save(); this.host.redraw();
    return { lane: l.name, selected: l.items?.[sel]?.id ?? null };
  }

  /** `board.hub`: the hubs (the person's opens the picker), or show the one named. */
  async chooseHub(id: string | undefined, actor: Actor): Promise<unknown> {
    if (id === undefined) {
      // The person's opens the picker (their keys go to it); an agent's reads the list.
      if (actor.kind !== "agent") { this.openPicker(); return { picker: true }; }
      const found = await findBoards(this.host.ctx.board);
      return { current: this.hub?.id ?? null, hubs: found.map(f => ({ id: f.hub.id, title: subject(f.hub), lanes: f.lanes })) };
    }
    const hub = this.hubPicker?.items.find(i => i.hub.id === id || (id.length >= 8 && i.hub.id.startsWith(id)))?.hub ?? await this.host.ctx.board.get(id);
    if (!hub) throw new ActionRefused(`no block ${id}`);
    if ((await hubViews(this.host.ctx.board, hub.id)).length < 2) throw new ActionRefused(`${subject(hub)} isn't a board: it has fewer than two virtual-branch lanes`);
    await this.useHub(hub);
    return { hub: hub.id, title: subject(hub), lanes: this.lanes.map(l => l.name) };
  }

  /** The picker put away (esc, q): the board as it was, or with no board yet, back to the menu. */
  closePicker() {
    if (!this.hubPicker) return { picker: false };
    if (!this.hub) { this.host.leave(); return { left: true }; }
    this.hubPicker = null; this.host.redraw();
    return { picker: false };
  }

  /** `g`: the hub picker, the board shown now selected; it holds the keys until ⏎ or esc. */
  private openPicker() {
    this.status = "looking for boards…"; this.host.redraw();
    findBoards(this.host.ctx.board).then(items => {
      this.status = "";
      const p = this.hubPicker = this.hubList(items);
      p.sel = Math.max(0, items.findIndex(i => i.hub.id === this.hub?.id));
      this.host.redraw();
    }, e => { this.status = ""; this.host.ctx.flash(`couldn't look for boards: ${(e as Error).message}`); this.host.redraw(); });
  }

  /** The boards to pick from: ⏎ or a click shows one (board.hub id=), esc or q puts it away (board.hub close=true). */
  private hubList(items: { hub: Msg; lanes: number }[]): HubPicker {
    return new ListPicker({
      name: "hubs", items: () => items, closers: "q", stays: true,             // useHub puts it away once the board is shown
      row: (it, _i, on, w) => [pickRow(` ${subject(it.hub)}  ${fg(C.dark)}${it.lanes} lanes · ${ago(it.hub.updatedAt)}`, on, w)],
      choose: it => void this.run("board.hub", { id: it.hub.id }),
      closed: () => void this.run("board.hub", { close: true }),
      clicked: () => true,                                     // a click beside it isn't a choice, nor a way out
      frame: (a, n) => ({ rect: { col: Math.round(a.cols * 0.2), row: Math.round(a.rows * 0.15), cols: Math.round(a.cols * 0.6), rows: Math.min(a.rows - 4, n + 4) }, title: `pick a board · ${this.host.ctx.workspace}`, foot: "⏎ open · esc back" }),
    });
  }

  /** `board.reload`: every lane asked again. */
  reloadLanes() {
    if (!this.hub) throw new ActionRefused("no board is shown yet; board.hub picks one");
    this.loadLanes();
    this.host.redraw();
    return { lanes: this.lanes.map(l => l.name) };
  }

  /** `lane.collapse`: a lane to a spine, or open again: the desk's tile.collapse on the lane's tile (its policy, its agent rule). */
  async collapseLane(name: string | undefined, on: boolean | undefined, actor: Actor) {
    const lanes = this.lanes;
    const l = name === undefined ? lanes[this.lane] : lanes.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) throw new ActionRefused(name === undefined ? "the board has no lanes yet" : `no lane ${name}; lanes: ${lanes.map(x => x.name).join(", ")}`);
    const r = await this.host.within("tile.collapse", on === undefined ? {} : { on }, actor, l) as { collapsed?: boolean; changed?: boolean };
    return { lane: l.name, collapsed: !!r.collapsed, ...(r.changed === false ? { changed: false } : {}) };
  }

  /** A lane folded to a spine is opened (a card moved or written into it should be seen). */
  private unfold(l: Lane) { if (this.host.folded(l)) void this.host.perform?.("tile.collapse", { on: false }, USER, l); }

  // ── an agent's own card: its selection beside the person's cursor, and the cards it moves ──

  /**
   * An agent's `card.select`: the card its later card actions default to (its own reference, beside the
   * person's cursor). Nothing the person sees moves; the status bar says what it picked.
   */
  selectForAgent(id: string, actor: Extract<Actor, { kind: "agent" }>): { selected: string; lane: string } {
    const card = this.cardFor(id);
    const lane = this.lanes.find(l => l.items?.some(m => m.id === card.id))!;
    this.agentCards.set(actor.id, card.id);
    this.host.ctx.flash(`${agentLabel(actor)} selected "${titleOf(card)}" in ${lane.name} · your cursor stays`);
    return { selected: card.id, lane: lane.name };
  }

  /** `card.move`: the selected card (or `card`) into the lane named `lane`, by the same move as H/L, m and a drag. */
  async moveCard(lane: string, card: string | undefined, actor: Actor) {
    // Refused before the move starts: said to the person as a move's refusal is (moveTo says its own).
    const refuse = (m: string) => { if (actor.kind !== "agent") this.host.ctx.flash(`not moved: ${m}`); return new ActionRefused(m); };
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
    const r = this.lastMove as Lanes["lastMove"];
    if (!r) throw new ActionRefused("not moved");
    if (r.result.startsWith("refused")) throw new ActionRefused(r.result.replace(/^refused: /, ""));
    for (const x of this.readers()) if (x.msg?.id === c.id) x.surface.noteAgent(actor, `moved this card to ${lanes[to]!.name}`);
    return { card: c.id, lane: lanes[to]!.name, result: r.result };
  }

  card(): Msg | undefined { return this.laneTile()?.card(); }

  /** The preview shows the card the lanes' cursor is on. */
  follow() { const m = this.card(), l = this.laneTile(); if (m && l) this.host.setCurrent(m, { from: l }); }

  // ── where opens go on the board (DeskApi) ───────────────────────────────

  /** Why the selected card can't move at all right now, before any lane is considered. */
  private moveBlocked(card: Msg): string | null {
    if (this.moving) return "another move is still landing";
    // An open draft of this card keeps it where it is: the draft's base revision would go stale under
    // it. Saving or closing the edit first lets the revision checks decide in order.
    const r = openDraftOf(this.host.ctx.board, card.id);
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
  async moveTo(to: number, actor: Actor = USER, named?: { card: Msg; from: number }) {
    const from = named?.from ?? this.lane, card = named?.card ?? this.card(), target = this.lanes[to];
    // The person's move follows the card into its lane; an agent's leaves the person's selection alone.
    const person = actor.kind !== "agent";
    if (!card || !target || to === from) return;
    const ctx = asActor(this.host.ctx, actor);
    const by = byOf(actor);
    const blocked = this.moveBlocked(card);
    if (blocked) { this.lastMove = { card: card.id, to: target.name, result: `refused: ${blocked}`, ...by }; return ctx.flash(`not moved: ${blocked}`); }
    // From here until it lands or is refused, this card is moving: a second move waits for it.
    this.moving = card.id; this.status = `${actor.kind === "agent" ? `${agentLabel(actor)} is ` : ""}moving to ${target.name}...`; this.host.redraw();
    const plan = (await planMoves(this.host.ctx.board, card, [target.view]).catch((e: Error) => new Map<string, MovePlan>([[target.view, { kind: "refused", reason: e.message }]]))).get(target.view)
      ?? { kind: "refused" as const, reason: NO_PLAN };
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
      const m = await applyMove(this.host.ctx.board, card, plan, actor);
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
      // Either way, show the lanes as the service has them now. After a move that landed, the source and
      // target are enough: the move's own change record refreshes any other lane.
      this.loadLanes(landed ? [this.lanes[from]!, target].filter(Boolean) : this.lanes);
    }
  }

  private openMover() {
    const card = this.card();
    if (!card) return this.host.ctx.flash("select a card to move");
    const blocked = this.moveBlocked(card);
    if (blocked) return this.host.ctx.flash(`not moved: ${blocked}`);
    const from = this.lane;
    const M: Mover = Object.assign(new ListPicker<Lane, Lanes>({
      name: "mover", items: () => this.lanes, closers: "mq",
      // The lane, and what moving the card there would patch (the service's plan).
      row: (l, i, on, w) => {
        const p = M.plans?.[i];
        const what = i === from ? fg(C.dark) + "the card's lane now"
          : !p ? fg(C.dark) + "asking the outline what would be patched…"
          : p.kind === "patch" ? fg(C.lgreen) + "-> " + describeChanges(p.changes)
          : p.kind === "already" ? fg(C.dark) + "already matches · nothing to change"
          : fg(C.lred) + "can't: " + p.reason;
        return [pickRow(` ${on ? ">" : " "} ${l.name}  ${fg(C.dark)}${l.read?.status === "ready" ? l.def?.props.query ?? "" : l.read?.status ?? "loading"}`, on, w, C.white), pad(`     ${what}`, w) + RESET];
      },
      choose: (_, i) => {
        if (this.card()?.id !== card.id || this.lane !== from) return this.host.ctx.flash("the selection changed · not moved");
        if (i !== from) void this.run("card.move", { lane: this.lanes[i]!.name, card: card.id });
      },
      frame: a => ({ rect: { col: Math.round(a.cols * 0.15), row: Math.round(a.rows * 0.12), cols: Math.round(a.cols * 0.7), rows: Math.min(a.rows - 4, this.lanes.length * 2 + 3) }, title: `move · ${ellipsize(subject(card), Math.round(a.cols * 0.7) - 20)}`, foot: "enter move · esc back" }),
    }), { card, from, plans: null as MovePlan[] | null });
    M.sel = from;
    this.mover = M;
    this.host.redraw();
    const ids = this.lanes.map(l => l.view);
    planMoves(this.host.ctx.board, card, ids).then(
      plans => {
        if (this.mover !== M) return;
        M.plans = ids.map(id => plans.get(id) ?? { kind: "refused", reason: NO_PLAN });
        const first = M.plans.findIndex((p, i) => i !== M.from && p.kind === "patch");
        if (first >= 0 && M.sel === M.from) M.sel = first;
        this.host.redraw();
      },
      (e: Error) => { if (this.mover === M) { M.plans = ids.map(() => ({ kind: "refused" as const, reason: e.message })); this.host.redraw(); } },
    );
  }

  // ── writing cards: create, check off steps, trash and restore (PIE-406) ──────

  laneFor(name: string): Lane { return this.laneNamed(name); }

  /** The card an action names no card for: an agent's own `card.select`, else the person's selected card. */
  selectedCardId(actor?: Actor): string { return this.cardFor(undefined, actor).id; }

  /** The card an action with no card= acts on for `actor` (its own selection, else the person's), or null when none is. */
  private selectedCardOr(actor: Actor): string | null { try { return this.cardFor(undefined, actor).id; } catch { return null; } }

  async listSteps(id?: string, actor?: Actor) {
    const card = this.cardFor(id, actor);
    const r = await this.host.ctx.board.checklist(card.id);
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
    const plan = await this.host.ctx.board.planCreate(lane.view, text);
    if (plan.kind === "refused") throw new ActionRefused(plan.reason);
    const { needs } = plan;
    if (plan.roadmap) {
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
    // A new card put aside in this lane (esc twice, a click away, the board closed) comes back: the card adapter's
    // place is the lane's view, so another hub's lane of the same name never brings it back (or creates it there).
    const session = this.openComposer(cardTarget({ kind: "card", lane: lane.name, view: lane.view, create: (text, by) => BOARD_ACTIONS.run("card.create", { lane: lane.name, text, ...(C0.parent ? { parent: C0.parent.id } : {}) }, { model: this }, by) }));
    const C0: Composer = { kind: "card", lane, planning: true, born: [], defaults: [], needs: [], parent: null, session };
    this.composer = C0;
    this.host.redraw();
    this.cardPlan(lane).then(plan => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      const pick = plan.parent;
      Object.assign(C0, { planning: false, born: plan.born, defaults: plan.defaults, needs: plan.needs, parent: pick ? { ...pick, title: pick.id.slice(0, 8) } : null });
      this.host.redraw();
      if (pick) this.host.ctx.board.get(pick.id).then(parent => {
        if (this.composer !== C0 || C0.kind !== "card" || !C0.parent) return;
        if (parent) C0.parent.title = titleOf(parent);
        else C0.session.draft.note = `its parent ${pick.id.slice(0, 8)} isn't in the outline; creating will be refused`;
        this.host.redraw();
      }, () => {});
    }, (e: Error) => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      C0.planning = false; C0.session.draft.note = `not created: can't create in ${lane.name}: ${e.message}`;
      if (!C0.session.dirty) { C0.session.close(); this.composer = null; }   // nothing typed yet: nothing to keep
      this.host.ctx.flash(`can't create in ${lane.name}: ${e.message}`);
      this.host.redraw();
    });
  }

  /** `N`: a note under the selected card, opened at once like `n`. */
  private openChildComposer() {
    const card = this.card();
    if (!card) return this.host.ctx.flash("select a card to add a note under");
    if (this.composer) return;
    const session = this.openComposer(cardTarget({ kind: "child", parent: card, create: (text, by) => BOARD_ACTIONS.run("note.create", { text, parent: card.id }, { model: this }, by) }));
    this.composer = { kind: "child", parent: card, session };
    this.host.redraw();
  }

  /** The composer's draft session (the card adapter): it ends by itself once created, closed or put aside. */
  private openComposer(target: ReturnType<typeof cardTarget>): DraftSession {
    const s: DraftSession = DraftSession.open(target, {}, { redraw: () => this.host.redraw(), closed: () => { if (this.composer?.session === s) this.composer = null; }, said: m => this.host.ctx.flash(m, 8000) });
    return s;
  }

  /** A key in the composer: typing is its draft's; what ends it runs the board's action, as a click would. */
  private composerKey(k: Key) {
    const s = this.composer!.session;
    // Reference completion ([[ (( [file::), as in every draft: the editing component's, from this board's connection.
    s.key(k, { completer: completerFor(s.draft, this.host.ctx.board, () => this.host.redraw()), run: cmd => this.composerCommand(cmd) });
    this.host.redraw();
  }

  private composerCommand(cmd: DraftCommand) {
    const C0 = this.composer!, d = C0.session.draft;
    if (cmd === "save") void this.submitComposer();
    else if (cmd === "editor") void openInEditor(this.host.ctx, d, () => this.composer?.session.draft === d).then(() => this.host.redraw());
    else if (cmd === "pick") void this.host.pressAction(BOARD_ACTIONS, "composer.pick", {});
    // cmd+c: the draft's selection to the person's clipboard, through the draft's copy action.
    else if (cmd === "copy") void Dispatcher.of(DRAFT_ACTIONS, d, () => this.host.ctx).press("draft.copy").then(r => { const c = r as { text: string; chars: number } | undefined; if (c && this.host.ctx.copy?.(c.text) !== false) this.host.ctx.flash(`copied ${c.chars} chars`); this.host.redraw(); });
    // Esc on nothing typed closes it; esc, esc on typed text puts it aside as unsent (never created), and says where.
    else if (cmd === "close" || cmd === "discard") void this.host.pressAction(BOARD_ACTIONS, "composer.close", cmd === "discard" ? { discard: true } : {});
  }

  /**
   * The person leaves the new card or note they're writing (a click outside it, or esc twice): its session
   * leaves (never created: ctrl+s creates), and typed text is put aside as unsent where n or N brings it back.
   */
  async leaveComposer(): Promise<LeaveResult> {
    const C0 = this.composer;
    if (!C0) return { left: "nothing" };
    const r = await C0.session.leave(USER);
    this.host.redraw();
    return r;
  }

  /** Close the new card or note (esc): unchanged, it goes; typed text only with `discard`, put aside as unsent. */
  closeComposer(discard: boolean): { closed: boolean; keptAt?: string; said?: string } {
    const C0 = this.composer;
    if (!C0) return { closed: false };
    if (C0.session.dirty && !discard) throw new ActionRefused("there's typed text; ctrl+s creates it, discard=true puts it aside as unsent");
    const r = C0.session.close(discard);
    if (r.said) this.host.ctx.flash(r.said, 8000);
    this.host.redraw();
    return r;
  }

  /** Ctrl+T in the composer: insert from a picker at its cursor (src/pick.ts), as in every draft. */
  async pickComposer(channel?: string): Promise<Picked> {
    const C0 = this.composer;
    if (!C0) throw new ActionRefused("no new card or note is being written");
    const d = C0.session.draft, board = this.host.ctx.board;
    if (d.busy) throw new ActionRefused("the new card is being created");
    const r = await pickInto(this.host.ctx, d, { socket: board.path, name: board.outline }, { ...(channel !== undefined ? { channel } : {}), held: () => this.composer?.session.draft === d });
    if ("kept" in r) this.host.ctx.flash(`${r.why}: ${r.kept} · copied to ${r.at}`, 12000);
    else if ("nothing" in r) d.note = r.nothing;
    this.host.redraw();
    return r;
  }

  /** Ctrl+S in the composer: create it (the card adapter, through card.create or note.create). A refusal keeps the text, says why, and copies it to disk. */
  private async submitComposer() {
    const C0 = this.composer;
    if (!C0) return;
    this.host.redraw();
    const r = await C0.session.submit(USER);
    if (!r.ok) this.host.ctx.flash(r.why);
    this.host.redraw();
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
    const board = this.host.ctx.board;
    const input = plan.plan.item;
    if (!input) throw new ActionRefused(`the outline planned no roadmap item for ${lane.name}`);
    const since = Date.now();
    let made: { workId: string; workQueueId: string; block: Msg };
    try { made = await board.createRoadmapItem(input, actor); }
    catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.findItem(input.project, input.title, since).catch(() => null);
      if (!found) throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such item is there yet; the outcome is unknown, so look before creating it again`);
      made = { workId: found.props["work-id"] ?? "", workQueueId: found.parentId ?? "", block: found };
    }
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
    const items = await this.host.ctx.board.query(`type=roadmap-item project=${project}`, 50, "created", "desc");
    return items.find(m => m.createdAt >= since - 1000 && m.text.split("\n")[0]!.includes(`— ${title}`)) ?? null;
  }

  /**
   * After a create landed: who did it, and the lane asked for it. The person's create selects the new
   * card (and opens a collapsed lane to show it); an agent's never moves the person's selection, focus
   * or saved layout.
   */
  private created(lane: Lane, m: Msg, actor: Actor, flash: string, result: string) {
    this.lastWrite = { what: "create", id: m.id, result, ...(byOf(actor)) };
    asActor(this.host.ctx, actor).flash(flash);
    if (actor.kind !== "agent") {
      lane.want = m.id; lane.wantVerb = "created";
      this.lane = this.lanes.indexOf(lane); this.toLanes();
      this.unfold(lane);
    }
    // The create's change record asks the lanes that could hold it.
    this.host.redraw();
  }

  /** A note under `parentId` (a card's child), as it was typed. */
  async createNote(parentId: string, text: string, actor: Actor): Promise<{ id: string; parent: string; text: string }> {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) throw new ActionRefused("type the note first");
    const m = await this.landCreate(parentId, body, actor);
    const parent = await this.host.ctx.board.get(parentId).catch(() => null);
    if (parent) for (const r of this.readers()) r.refresh(parent);
    asActor(this.host.ctx, actor).flash(`added a note under ${parent ? titleOf(parent) : parentId.slice(0, 8)} · ${titleOf(m)}`);
    this.lastWrite = { what: "note", id: m.id, result: `created under ${parentId.slice(0, 8)}`, ...(byOf(actor)) };
    for (const r of this.readers()) if (r.msg?.id === parentId) r.surface.noteAgent(actor, "added a note under this card");
    this.host.redraw();
    return { id: m.id, parent: parentId, text: m.text };
  }

  /** One `create`, never retried: a refusal is the service's reason; a lost answer is looked for. */
  private async landCreate(parentId: string, text: string, actor: Actor): Promise<Msg> {
    const since = Date.now();
    try {
      return await this.host.ctx.board.createBlock(parentId, text, actor);
    } catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.host.ctx.board.findCreated(parentId, text, since).catch(() => null);
      if (found) return found;
      throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such block is there yet; the outcome is unknown, so look before creating it again`);
    }
  }

  // ── checklist steps ──

  /** `s`: the selected card's checklist steps, read from the service. */
  private async openSteps(card = this.card()) {
    if (!card) return this.host.ctx.flash("select a card to see its steps");
    const MARK: Record<StepStatus, string> = { todo: "[ ]", done: "[x]", waiting: "[~]", problem: "[!]" };
    const COLOR: Record<StepStatus, number> = { todo: C.white, done: C.lgreen, waiting: C.yellow, problem: C.lred };
    // The person's step change from the overlay: checked against the step as it was read; a refusal is its note.
    const set = (to?: StepStatus) => {
      const it = S.read?.items[S.sel];
      if (S.busy || !S.read || !it) return;
      const status = to ?? (it.status === "done" ? "todo" : "done");
      void this.host.pressAction(BOARD_ACTIONS, "step.set", { step: String(S.sel + 1), status, card: S.card.id }, undefined, why => { S.note = why; return `not changed: ${why}`; }, { shown: { item: it, revision: S.read.revision } });
    };
    const S: Steps = Object.assign(new ListPicker<ChecklistStep, Lanes>({
      name: "steps", items: () => S.read?.items ?? [], closers: "qs", stays: true,
      row: (it, _i, on, w) => [pickRow(` ${"  ".repeat(it.depth)}${MARK[it.status]} ${stepText(it.text)}`, on, w, COLOR[it.status])],
      choose: () => set(),
      keys: k => { const c = ch(k), to = ({ " ": undefined, x: "done", w: "waiting", "!": "problem" } as Record<string, StepStatus | undefined>)[c]; if (!(c in { " ": 1, x: 1, w: 1, "!": 1 })) return false; set(to); return true; },
      frame: (a, n) => {
        const done = S.read?.items.filter(i => i.status === "done").length ?? 0;
        return {
          rect: { col: Math.round(a.cols * 0.2), row: Math.round(a.rows * 0.12), cols: Math.round(a.cols * 0.6), rows: Math.min(a.rows - 4, Math.max(6, n + 4)) },
          title: `steps · ${titleOf(S.card, 50)}${S.read ? ` · ${done}/${n} done · rev ${S.read.revision}` : ""}`, foot: "space done · esc back",
          head: S.read ? [] : [fg(C.dark) + " reading the steps…" + RESET],
          tail: S.read ? [fg(S.busy ? C.grey : C.dark) + ` ${S.busy ? "saving…" : S.note || "each step is changed by the service, checked against how it was read"}` + RESET] : [],
        };
      },
    }), { card, read: null as ChecklistRead | null, busy: true, note: "" });
    this.steps = S; this.host.redraw();
    try {
      S.read = await this.host.ctx.board.checklist(card.id);
      if (!S.read.items.length) { if (this.steps === S) this.steps = null; this.host.ctx.flash(`${titleOf(card)} has no checklist steps`); }
    } catch (e) { if (this.steps === S) this.steps = null; this.host.ctx.flash(`couldn't read the steps: ${(e as Error).message}`); }
    finally { S.busy = false; this.host.redraw(); }
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
    const read = shown ? { revision: shown.revision, items: [shown.item] } : await this.host.ctx.board.checklist(card.id);
    const i = shown ? (typeof index === "number" ? index : 0) : typeof index === "number" ? index : read.items.findIndex(x => x.itemId === index || x.itemId === index.replace(/^\^/, ""));
    const it = shown ? shown.item : read.items[i];
    if (!it) throw new ActionRefused(typeof index === "number" ? `there's no step ${index + 1}; ${titleOf(card)} has ${read.items.length}` : `no step ^${index} in ${titleOf(card)}`);
    if (it.identity === "duplicate") throw new ActionRefused(`step ${i + 1} shares its id ^${it.itemId} with another step; fix it in the note's text first`);
    const to: StepStatus = status ?? (it.status === "done" ? "todo" : "done");
    if (S) { S.busy = true; S.note = "saving…"; this.host.redraw(); }
    try {
      const r = await this.host.ctx.board.setStep(card.id, it, read.revision, to, actor);
      for (const x of this.readers()) { x.refresh(r.block); if (x.msg?.id === card.id) x.surface.noteAgent(actor, `set step ${i + 1} to ${to}`); }
      const named = it.identity === "unassigned" && r.changed ? ` · the step now has an id (^${r.item.itemId})` : "";
      const said = `${to === "done" ? "checked off" : `set to ${to}`}: ${stepText(it.text)} · ${titleOf(card)}${named}`;
      asActor(this.host.ctx, actor).flash(r.changed ? said : `already ${to}: ${stepText(it.text)}`);
      this.lastWrite = { what: "step", id: card.id, result: `step ${i + 1} ${it.status} -> ${to} · revision ${r.block.revision}`, ...(byOf(actor)) };
      if (S) { S.note = r.changed ? said : ""; }
      return { card: card.id, step: i + 1, status: to, changed: r.changed, revision: r.block.revision, id: r.item.itemId };
    } catch (e) {
      const why = e instanceof Refused ? `${e.message} · the steps were read again; nothing changed` : e instanceof Error ? e.message : String(e);
      throw new ActionRefused(why);
    } finally {
      if (S && this.steps === S) {
        S.read = await this.host.ctx.board.checklist(card.id).catch(() => S.read);
        S.busy = false; this.host.redraw();
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
    const fresh = await this.host.ctx.board.get(card.id).catch(() => null);
    const kids = fresh?.childIds.length ?? 0;
    const say = `d again trashes "${titleOf(card)}"${kids ? ` and the ${kids} note${kids === 1 ? "" : "s"} under it` : ""} · any other key keeps it`;
    if (this.trashArm?.id === card.id) this.host.ctx.flash(say);
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
    const fresh = await this.host.ctx.board.get(card.id);
    if (!fresh) throw new ActionRefused("the card isn't in the outline any more");
    if (card.revision !== undefined && fresh.revision !== card.revision)
      throw new ActionRefused(`the card changed since the board showed it (revision ${card.revision} -> ${fresh.revision}) · look again before trashing`);
    const lane = this.lanes.find(l => l.items?.some(m => m.id === card.id))?.name ?? "";
    let lost = "";
    try { await this.host.ctx.board.trash(card.id, undefined, { revision: fresh.revision }); }
    catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (changedSinceRead(e)) throw new ActionRefused("the card changed just now (another client saved it) · look again before trashing");
      if (e instanceof Refused) throw new ActionRefused(why);
      // The answer was lost, not refused: the card may be in Trash anyway. Look before saying either.
      const gone = await this.host.ctx.board.isTrashed(card.id);
      if (gone === false) throw new ActionRefused(`${why}; the card is still there`);
      if (gone === null) throw new ActionRefused(`${why}, and the outline didn't say whether the card is in Trash; look before trying again`);
      lost = ` (the outline's answer was lost: ${why}; it is in Trash)`;
    }
    const by = byOf(actor);
    this.trashed = { id: card.id, title: titleOf(card), lane, children: fresh.childIds.length, ...by };
    this.lastWrite = { what: "trash", id: card.id, result: `trashed from ${lane}`, ...by };
    asActor(this.host.ctx, actor).flash(`trashed "${titleOf(card)}"${fresh.childIds.length ? ` and ${fresh.childIds.length} note${fresh.childIds.length === 1 ? "" : "s"} under it` : ""} · u restores it${lost}`);
    this.host.redraw();
    return { trashed: card.id, title: titleOf(card), lane, notesUnder: fresh.childIds.length, restore: `card.restore id=${card.id}`, recordedAs: "not recorded: the service's delete takes no author" };
  }

  /** `u`: bring back the card trashed last (or `id`), where it was. */
  async restoreCard(id: string | undefined, actor: Actor): Promise<{ restored: string; title: string }> {
    const target = id ?? this.trashed?.id;
    if (!target) throw new ActionRefused("nothing was trashed from this board; pass id=<block id> to restore another");
    let m: Msg;
    try { m = await this.host.ctx.board.restore(target); }
    catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
    const title = titleOf(m);
    if (this.trashed?.id === m.id) {
      const lane = this.lanes.find(l => l.name === this.trashed!.lane);
      if (lane && actor.kind !== "agent") { lane.want = m.id; lane.wantVerb = "restored"; }   // an agent's restore never moves the person's selection
      this.trashed = null;
    }
    this.lastWrite = { what: "restore", id: m.id, result: "restored", ...(byOf(actor)) };
    asActor(this.host.ctx, actor).flash(`restored "${title}"`);
    this.host.redraw();
    return { restored: m.id, title };
  }

  // ── drawing: the desk draws the tiles; the board adds its pickers, its composer and its hint row ──

  // ── input: the board's own keys, before the desk's ─────────────────────

  private laneKey(k: Key, c: string): boolean {
    const l = this.laneTile();
    if (k.kind === "left" || c === "h") { void this.run("card.select", { lanes: -1 }); return true; }
    if (k.kind === "right" || c === "l") { void this.run("card.select", { lanes: 1 }); return true; }
    // e, ctrl+e, i, I, C edit or open the properties of (or comment on) the selected card in the preview, which takes the keys.
    const pv = this.preview();
    if ((c === "e" || c === "C" || c === "i" || c === "I" || (k.kind === "char" && k.ctrl && k.ch === "e")) && pv?.msg) {
      if (this.host.folded(pv)) { this.host.ctx.flash("the preview is collapsed · tab to its spine and c, or click it, to open it"); return true; }
      // The preview takes the keys, then the session starts there as the person's key would.
      this.host.focusPane?.(pv, USER);
      if (pv.holdsKeys) { this.host.enterSession?.(pv); return true; }
      this.host.startSession?.(pv, sessionStart(k)!);
      return true;
    }
    if (c === "H" || c === "L") { const to = this.lanes[this.lane + (c === "H" ? -1 : 1)]; if (to) void this.run("card.move", { lane: to.name }); return true; }
    if (c === "m") { this.openMover(); return true; }
    if (c === "n") { this.openCardComposer(); return true; }
    if (c === "N") { this.openChildComposer(); return true; }
    if (c === "s") { void this.openSteps(); return true; }
    if (c === "d") {
      // The second d within 5 s trashes the card the first one armed; the first arms it.
      const card = this.card(), armed = card && this.trashArm?.id === card.id && Date.now() - this.trashArm.at < 5000;
      if (armed) this.trashArm = null;
      void this.run("card.trash", armed ? { confirm: card!.id, card: card!.id } : {});
      return true;
    }
    if (c === "u" && this.trashed) { void this.run("card.restore", {}); return true; }
    if (c === "c" && l) { void this.run("lane.collapse", { lane: l.name }); return true; }
    if (l && this.host.folded(l) && (k.kind === "enter" || c === " ")) { void this.run("lane.collapse", { lane: l.name, on: false }); return true; }
    const by = isDown(k) ? 1 : isUp(k) ? -1 : k.kind === "pgdn" ? 8 : k.kind === "pgup" ? -8 : 0;
    if (l && by) { void this.run("card.select", { by }); return true; }
    // ⏎ opens the card where the lane's opens land (the readers row's detail), alt+⏎ in a new one: the desk's `open from=`.
    if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.card(); if (m && l) void this.host.perform?.("open", { id: m.id, from: this.host.nameOfPane(l), ...(k.kind === "alt-enter" ? { fresh: true } : {}) }, USER); return true; }
    if (c === "r") { void this.run("board.reload", {}); return true; }
    return false;
  }

  /** The lane whose cards are drawn under the pointer (not its header or frame), and the card's row there. */
  private laneAtPoint(x: number, y: number): { i: number; lane: Lane; row: number; rect: Rect } | null {
    const hit = this.host.paneAt(x, y);
    if (!hit || !(hit.pane instanceof QueryPane)) return null;
    const i = this.lanes.indexOf(hit.pane);
    if (i < 0 || this.host.folded(hit.pane)) return null;
    return { i, lane: hit.pane, row: y - hit.rect.row - 1, rect: hit.rect };
  }

  /**
   * The mouse on a lane (its own `mouse`, the desk gives it every event while the button is down): a card pressed is
   * selected (card.select) and can be dragged onto another lane to move it there (card.move); a click on the selected
   * card opens it on release (open); the wheel over a lane moves its cursor. Its header and frame are the desk's.
   */
  laneMouse(k: Extract<Key, { kind: "mouse" }>, press?: RowPress): boolean {
    const d = this.cardDrag;
    if (d && k.action === "drag") { d.over = this.laneAtPoint(k.x, k.y)?.i ?? this.laneOver(k.x, k.y); this.host.redraw(); return true; }
    if (d && k.action === "up") {
      this.cardDrag = null;
      // Released over another lane: move it there. Released where it started: a click, which opens it when it was a double click.
      if (d.over !== null && d.over !== d.from) { if (this.lane === d.from && this.card()?.id === d.card.id) void this.run("card.move", { lane: this.lanes[d.over]!.name, card: d.card.id }); }
      else if (d.open) void this.host.perform?.("open", { id: d.card.id, from: this.host.nameOfPane(this.lanes[d.from]!), ...(d.open === "fresh" ? { fresh: true } : {}) }, USER);
      this.host.redraw();
      return true;
    }
    // A swipe sideways steps the cursor to the lane beside, as h and l do (one step a swipe).
    const sw = sideways(k);
    if (sw) { if (this.swipe.step(sw)) void this.run("card.select", { lanes: sw }); return true; }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const at = this.laneAtPoint(k.x, k.y);
      if (!at) return false;
      void this.run("card.select", { lane: at.lane.name, by: k.action === "wheel-up" ? -1 : 1, focus: false });
      return true;
    }
    if (k.action !== "down") return true;
    const at = this.laneAtPoint(k.x, k.y);
    if (!at || at.row < 0) return false;
    const r = at.rect;
    if (k.x <= r.col || k.x >= r.col + r.cols - 1 || k.y >= r.row + r.rows - 1) return false;
    const l = at.lane, idx = l.rowAt(at.row);
    if (idx >= 0) {
      // The mouse escalates as the keys do (RowView.press): a click picks the card, a double click opens it (⏎), an
      // alt-, ctrl- or middle-click opens it in a new detail (alt+⏎); the click that gives the lanes the keys only picks.
      const g = l.cursor.press(idx, press ?? { mods: k.mods ?? 0, button: k.button, focusing: !this.onLanes });
      void this.run("card.select", { id: l.items![idx]!.id, lane: l.name });
      // Drag it onto another lane to move it; a double click opens it when released.
      this.cardDrag = { from: at.i, card: l.items![idx]!, over: null, open: g === "open" ? "open" : g === "fresh" ? "fresh" : null };
      if (this.movePlans?.failed) this.movePlans = null;
    } else void this.run("card.select", { lane: l.name, by: 0 });
    this.host.redraw();
    return true;
  }

  /** The lane under the pointer by its whole rectangle (its header too), while a card is dragged. */
  private laneOver(x: number, y: number): number | null {
    const hit = this.host.paneAt(x, y);
    return hit && hit.pane instanceof QueryPane && this.lanes.includes(hit.pane) ? this.lanes.indexOf(hit.pane) : null;
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
    const lines = renderEditor(d, { title: C0.kind === "card" ? `new card in ${C0.lane.name}` : "new note", status, by: writtenBy(d, "save"), preview: draftPreview, pick: true }, w, r.rows - 2);
    this.composerAt = r;
    lines.forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, w));
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

/** A step's first line, without its list mark, checkbox and ^id. */
const stepText = (t: string) => (t.split("\n")[0] ?? "").replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX~!]\]\s*/, "").replace(/\s*\^[\w-]+\s*$/, "").trim();
/** `(project=a OR project=b)` → `project::a`: a token the person could type to meet it. */
const hintToken = (need: string) => { const m = need.match(new RegExp(`(${PROPERTY_KEY_SOURCE})=("[^"]*"|[^\\s()]+)`)); return m ? `${m[1]}::${m[2]!.replace(/^"|"$/g, "")}` : `${need.replace(/[()]/g, "")}::…`; };

interface BoardOn {
  model: SourceModel;
  /** The person's step change from the steps overlay: the step as it was read, so a change since is refused. */
  shown?: { item: ChecklistStep; revision: number };
}
/** The lanes an action runs on: the model the hub source keeps for the board's columns. */
const lanesOf = (o: BoardOn): Lanes => { if (!(o.model instanceof Lanes)) throw new ActionRefused("there are no board lanes here"); return o.model; };

/**
 * The board's lanes' actions (the hub source's: they run on its model, PIE-515): which card is selected, moving it,
 * writing new cards and notes, steps, trash and restore, which hub is shown. The lanes' keys and clicks run them.
 */
export const BOARD_ACTIONS = actionSet<BoardOn>()("board", {
  "card.select": def({
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
    run(args, { model }, actor) { return lanesOf({ model }).selectBy(args, actor); },
  }),
  "board.hub": def({
    summary: "which board this is: with no id, the hubs it can show (every block with two or more virtual-branch lanes), and for the person the picker to choose one; with id=<hub block id>, show that board. An agent's switch is refused while the person is typing, and is said on the status bar",
    keys: "g, then j k ↑↓ and ⏎ or click on a board; esc q puts the picker away",
    touches: "screen", touchesWith: a => (a.id !== undefined ? "screen" : "nothing"), replay: "safe", says: r => (r.hub ? `showed the board ${r.title}` : null),
    args: { id: { type: "string", optional: true, about: "the hub's block id (or its first 8+ characters)" }, close: { type: "boolean", optional: true, about: "put the picker away (the person's own)" } },
    run({ id, close }, { model }, actor) {
      // Putting the picker away is the person's own (only their g opens it).
      if (close && actor.kind === "agent") throw new ActionRefused("the hub picker is the person's; an agent shows a board with board.hub id=<hub>");
      return close ? lanesOf({ model }).closePicker() : lanesOf({ model }).chooseHub(id, actor);
    },
  }),
  "board.reload": def({
    summary: "read every lane again from the service", keys: "r on the lanes",
    touches: "nothing", replay: "safe", says: () => "reloaded the lanes",
    args: {},
    run(_, { model }) { return lanesOf({ model }).reloadLanes(); },
  }),
  "lane.collapse": def({
    summary: "collapse a lane to a spine showing its name, or open it again (on=true/false; default toggles): lane=<name>, default the person's lane. Its cards stay where they are",
    keys: "c on the lanes, ⏎ or space on a collapsed lane, click on a lane's spine (the desk's tile.collapse on its tile)",
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `${r.collapsed ? "collapsed" : "opened"} the lane ${r.lane}`),
    args: { lane: { type: "string", optional: true, about: "the lane's name; default the lane the cursor is in" }, on: { type: "boolean", optional: true, about: "true collapses, false opens; default toggles" } },
    run: ({ lane, on }, { model }, actor) => lanesOf({ model }).collapseLane(lane, on, actor),
  }),
  "card.move": def({
    summary: "move the selected card (or card=<id>) into a lane, patching what the lane's query names", keys: "H L, m then ⏎, drag a card to a lane",
    touches: "draft", draft: "write", replay: "ask",
    args: { lane: { type: "string", about: "the lane's name" }, card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ lane, card }, { model }, actor) => lanesOf({ model }).moveCard(lane, card, actor),
  }),
  "composer.leave": def({
    summary: "leave the new card or note the person is writing, as a click outside it does: never created (ctrl+s creates); typed text is kept as unsent, and n or N brings it back. The person's own: an agent creates with card.create or note.create",
    keys: "click outside it",
    touches: "draft", draft: "leave", replay: "ask", person: "the new card or note being written is the person's; an agent doesn't close it (card.create writes its own)",
    args: {},
    run(_, { model }) { return lanesOf({ model }).leaveComposer(); },
  }),
  "composer.pick": def({
    summary: "insert from a picker in the new card or note being written: the picker (EP0CH_PICKER, default tv) takes the person's terminal (the board's shape is locked, so not a tile) on a channel (default EP0CH_PICK_CHANNEL, else ep0ch), and what they choose goes in at the cursor, space-separated. The person's own: it takes their keys",
    keys: "ctrl+t, a click on [insert] in its title row",
    touches: "draft", draft: "type", replay: "ask", person: "an agent doesn't hand the person's terminal to a picker; card.create and note.create write their own text",
    args: { channel: { type: "string", optional: true, about: "the picker's argument (a television channel: ep0ch, ep0ch-files …); empty for none" } },
    run({ channel }, { model }) {
      return lanesOf({ model }).pickComposer(channel);
    },
  }),
  "composer.close": def({
    summary: "close the new card or note being written: unchanged, it goes; typed text needs discard=true, and is put aside as unsent (n or N brings it back). The person's own",
    keys: "esc (twice with typed text)",
    touches: "draft", draft: "leave", replay: "ask", person: "the new card or note being written is the person's; an agent doesn't close it (card.create writes its own)",
    args: { discard: { type: "boolean", optional: true, about: "put typed text aside as unsent and close" } },
    run: ({ discard }, { model }) => lanesOf({ model }).closeComposer(!!discard),
  }),
  "card.create": def({
    summary: "create a card in a lane: the text, born with the properties the lane's query sets (and its create:: default, unless the text sets that key), under the lane's create-parent or where its cards live. In a roadmap lane (type=roadmap-item) it's a roadmap item made by the workboard's allocator, which issues its work-id: the text gives priority, arc and track(s) as [key::value] tokens, and Review/Validate/Done lanes refuse (create in Queued or Doing, then move). Refused, with the reason, when the lane can't define it", keys: "n, typing, ctrl+s",
    touches: "nothing", replay: "ask",
    args: {
      lane: { type: "string", about: "the lane's name" },
      text: { type: "string", about: "title line and body; [key::value] tokens are properties (they must meet an OR group the lane has)" },
      parent: { type: "string", optional: true, about: "the block to create it under, instead of the lane's default" },
    },
    run: ({ lane, text, parent }, { model }, actor) => lanesOf({ model }).createCard(lanesOf({ model }).laneFor(lane), text, actor, parent),
  }),
  "note.create": def({
    summary: "add a note under the selected card (or parent=<id>)", keys: "N, typing, ctrl+s",
    touches: "nothing", replay: "ask",
    args: { text: { type: "string", about: "the note's text" }, parent: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ text, parent }, { model }, actor) => lanesOf({ model }).createNote(parent ?? lanesOf({ model }).selectedCardId(actor), text, actor),
  }),
  "steps": def({
    summary: "list a card's checklist steps (the selected card, or card=<id>)", keys: "s",
    touches: "nothing", replay: "safe",
    args: { card: { type: "string", optional: true, about: "the card's block id; default the selected card" } },
    run: ({ card }, { model }, actor) => lanesOf({ model }).listSteps(card, actor),
  }),
  "step.set": def({
    summary: "set a checklist step's status (default: toggle done / to do), checked against the step as it was read", keys: "s then space ⏎ x w !",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      step: { type: "string", about: "the step's number in `steps` (from 1), or its ^id" },
      status: { type: "string", optional: true, about: "todo, done, waiting or problem; default toggles done" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run({ step, status, card }, { model, shown }, actor) {
      if (status !== undefined && !["todo", "done", "waiting", "problem"].includes(status)) throw new ActionRefused(`status is todo, done, waiting or problem, not ${status}`);
      const n = /^\d+$/.test(step) ? Number(step) - 1 : step;
      if (typeof n === "number" && n < 0) throw new ActionRefused("steps are numbered from 1");
      return lanesOf({ model }).setStep(card ?? lanesOf({ model }).selectedCardId(actor), n, status as StepStatus | undefined, actor, shown);
    },
  }),
  "card.trash": def({
    summary: "move the selected card (or card=<id>) and the notes under it to Trash; confirm=<its id> is the second d. Without confirm, the person's first d arms it (a second d within 5 s trashes it, any other key keeps it); an agent always passes confirm. The service records no author for this", keys: "d d",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      confirm: { type: "string", optional: true, about: "the card's id (or its first 8+ characters): the same card, said twice" },
      card: { type: "string", optional: true, about: "the card's block id; default the selected card" },
    },
    run({ confirm, card }, { model }, actor) {
      if (confirm === undefined) {
        if (actor.kind === "agent") throw new ActionRefused("card.trash needs confirm=<the card's id>: the same card, said twice");
        return lanesOf({ model }).armTrash();
      }
      return lanesOf({ model }).trashCard(card ?? lanesOf({ model }).selectedCardId(actor), confirm, actor);
    },
  }),
  "card.restore": def({
    summary: "bring back the card trashed last from this board (or id=<block id>), where it was", keys: "u",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "a Trash root's block id; default the card trashed last here" } },
    run: ({ id }, { model }, actor) => lanesOf({ model }).restoreCard(id, actor),
  }),
});

/**
 * The hub source: `hub:<block id>`'s views as query tiles, in lane order. A view added, renamed or taken
 * away under the hub (a change whose parent is the hub, or was) asks it again.
 */
export const HUB_SOURCE: TileSource = {
  name: "hub",
  about: "a hub's views (its virtual-branch children), one query tile each, in lane order",
  drop: "take its view out of the hub in the outline (move it elsewhere or trash it)",
  async tiles(arg, desk) {
    if (!arg) return { tiles: [] };
    const [hub, kids] = await Promise.all([desk.ctx.board.get(arg), desk.ctx.board.children(arg)]);
    const defs = laneDefs(kids);
    return {
      ...(hub ? { title: subject(hub) } : {}),
      tiles: defs.map(d => ({ spec: { t: "leaf", kind: "query", name: laneTileName(subject(d)), view: d.id } as TileSpec, prime: (p: Pane) => { if (p instanceof QueryPane) p.define(d); } })),
    };
  },
  affects: (c, arg) => !!arg && c.kind !== "reorder" && c.kind !== "annotate" && c.kind !== "draft" && (c.parentId === arg || c.previousParentId === arg || c.blockId === arg),
  key: s => (s.kind === "query" && s.view ? `query:${s.view}` : null),
  // What the lanes share (PIE-515): the hub shown, the cursor, cards moved and written (src/desk/lanes.ts).
  model: (host, container, saved) => {
    const c = host.sourceOf?.(container) ?? "";
    return new Lanes(host, container, c.startsWith("hub:") && c.length > 4 ? c.slice(4) : null, saved as LanesSaved | undefined);
  },
  get actions() { return BOARD_ACTIONS; },
};
