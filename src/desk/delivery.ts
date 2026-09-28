// Delivery board: a hub's virtual branches as lanes across the top, one shared preview,
// details you open into, floating panes you can drag above everything, an outline drawer
// (left or right, with its own mini preview) and a backlinks drawer with its own preview.
// Drawers slide over; nothing reflows unless it is pinned. Every border can be dragged.
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { onMediaChange } from "../media";
import type { Backlink, OutlineEvent } from "../socket";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { applyMove, describeChanges, planMove, type MovePlan } from "../move";
import { matchesFilters, readView, type ViewRead } from "../views";
import { ReaderPane, TreePane, type DeskApi, type Pane, type PaneKind } from "./panes";

interface Lane { name: string; def: Msg; items: Msg[] | null; sel: number; top: number; read?: ViewRead; want?: string }
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
  private lastMove: { card: string; to: string; result: string } | null = null;

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
    const branches = await this.ctx.board.query("type=virtual-branch", 500);
    const count = new Map<string, number>();
    for (const b of branches) if (b.parentId && b.props.query) count.set(b.parentId, (count.get(b.parentId) ?? 0) + 1);
    const ids = [...count].filter(([, n]) => n >= 2).map(([id]) => id);
    const hubs = await Promise.all(ids.map(id => this.ctx.board.get(id)));
    return hubs.flatMap((h, i) => (h ? [{ hub: h, lanes: count.get(ids[i]!)! }] : [])).sort((a, b) => b.hub.updatedAt - a.hub.updatedAt);
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

  private loadLanes() {
    for (const l of this.lanes) readView(this.ctx.board, l.def).then(read => {
      const items = read.items;
      l.read = read;
      const keep = l.want ?? l.items?.[l.sel]?.id;
      l.items = items;
      const at = keep ? items.findIndex(m => m.id === keep) : -1;
      if (l.want) {
        if (at < 0) this.ctx.flash(`moved, but ${l.name} doesn't list it${read.truncated ? ` (past its limit of ${read.limit})` : ""}`);
        l.want = undefined;
      }
      l.sel = Math.max(0, at >= 0 ? at : Math.min(l.sel, items.length - 1));
      if (l === this.lanes[this.lane]) this.follow();
      this.ctx.redraw();
    }, () => { l.items = []; });
  }

  onEvent(e: OutlineEvent) {
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => this.loadLanes(), 1200);
    for (const r of this.readers()) r.onEvent(this);   // comment counts and threads
    // Any open reader showing the changed block re-reads it in place.
    const id = e.blockId;
    if (id && this.readers().some(r => r.msg?.id === id))
      this.ctx.board.get(id).then(m => { if (m) { for (const r of this.readers()) r.refresh(m); this.redraw(); } }, () => {});
  }

  unsaved() { return this.readers().some(r => r.unsaved()); }
  keepDrafts() { return this.readers().flatMap(r => r.keepDrafts()); }

  private readers(): ReaderPane[] { return [this.preview, this.treePreview, this.linksPreview, ...this.details, ...this.floats.map(f => f.pane)]; }

  openBlock(m: Msg) { this.current = m; this.openDetail(m, false); }

  describe() {
    const brief = (m: Msg | null | undefined) => (m ? { id: m.id, title: subject(m), workId: m.props["work-id"] ?? m.props.ticket } : null);
    return {
      kind: "board", hub: brief(this.hub), focus: this.focus,
      lanes: this.lanes.map((l, i) => ({ name: l.name, count: l.items?.length ?? null, status: l.read?.status, truncated: l.read?.truncated, collapsed: this.collapsed.has(l.name), focused: i === this.lane, selected: brief(l.items?.[l.sel]) })),
      preview: brief(this.preview.msg),
      details: this.details.map((d, i) => ({ ...brief(d.msg), opensHere: i === this.active })),
      floats: this.floats.map(f => ({ ...brief(f.pane.msg), rect: f.rect })),
      tree: { open: this.treeOpen, pinned: this.treePinned, side: this.lay.treeSide, preview: brief(this.treePreview.msg) },
      backlinks: this.links ? { target: brief(this.links.target), from: this.links.from, count: this.links.items?.length ?? null, selected: this.links.items?.[this.links.sel]?.title ?? null, pinned: this.linksPinned } : null,
      images: this.placed.length,
      moving: this.moving, lastMove: this.lastMove,
      mover: this.mover ? { card: brief(this.mover.card), options: this.lanes.map((l, i) => ({ lane: l.name, plan: this.mover!.plans[i], selected: i === this.mover!.sel })) } : null,
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
    return null;
  }

  /** Move the selected card into lane `to` by patching the properties its query names. */
  private async moveTo(to: number) {
    const from = this.lane, card = this.card(), target = this.lanes[to];
    if (!card || !target || to === from) return;
    const blocked = this.moveBlocked(card);
    if (blocked) return this.ctx.flash(`not moved: ${blocked}`);
    const plan = planMove(card, target);
    if (plan.kind === "refused") { this.lastMove = { card: card.id, to: target.name, result: `refused: ${plan.reason}` }; return this.ctx.flash(`can't move to ${target.name}: ${plan.reason}`); }
    if (plan.kind === "already") {
      this.lane = to; target.want = card.id; this.loadLanes();
      return this.ctx.flash(`already in ${target.name} · nothing to change`);
    }
    this.moving = card.id; this.status = `moving to ${target.name}...`; this.redraw();
    try {
      const m = await applyMove(this.ctx.board, card, plan.changes);
      const also = this.lanes.filter((l, i) => i !== to && l.read?.status === "ready" && l.read.filters.length && matchesFilters(m.properties ?? [], l.read.filters)).map(l => l.name);
      this.lastMove = { card: card.id, to: target.name, result: `moved: ${describeChanges(plan.changes)} · revision ${m.revision}` };
      this.ctx.flash(`moved to ${target.name} · ${describeChanges(plan.changes)}${also.length ? ` · still in ${also.join(", ")} too` : ""}`);
      for (const r of this.readers()) r.refresh({ ...m, childIds: r.msg?.id === m.id ? r.msg.childIds : m.childIds });
      if (this.lane === from) this.lane = to;           // follow the card unless the user already went elsewhere
      target.want = card.id;
      if (this.collapsed.delete(target.name)) this.save();   // a card moved into a spine should still be seen
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.lastMove = { card: card.id, to: target.name, result: `refused: ${why}` };
      this.ctx.flash(`not moved: ${why.replace(/ · not moved$/, "")}`);
    } finally {
      this.moving = null; this.status = "";
      this.loadLanes();                                  // either way, show the lanes as the service has them now
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
    if (snip) canvas.text(pin.col, pin.row, fg(C.green) + pad(`“${snip}”`, pin.cols) + RESET, pin.cols);
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
    const base = this.focus === "lanes"
      ? "|08 |15g|08 boards · h l lane · j k card · |15⏎|08 detail · |15alt⏎|08 new detail · |15H L|08 move card · |15m|08 move to... · |15c|08 collapse · |15t|08 outline · |15b|08 backlinks · |15o|08 pop out · |15{ } < >|08 size · |15tab|08 area"
      : this.focus.startsWith("float")
        ? "|08 drag the title to move · drag |15◢|08 to resize · |15H J K L|08 move · |15o|08 dock · |15x|08 close · |15tab|08 area"
        : "|08 |15tab|08 area · |15t|08 outline · |15b|08 backlinks of this reader · |15o|08 pop out · |15x|08 close · |15{ } < >|08 size · |15esc|08 lanes";
    return pad(paint(base + (this.status ? ` · |14${this.status}` : "")), W);
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
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
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

const draftState = (r: ReaderPane) => {
  const d = r.draft!;
  return { id: d.blockId, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.changedElsewhere, conflict: d.conflict, savedCopy: d.savedCopy };
};
