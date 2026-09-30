// The desk: the door owns the whole canvas, and the canvas is tiles (PIE-413). A tile is a view (the outline
// tree, a reader, a detail, a preview, a program in a terminal, a whole screen) in the layout tree: split,
// tabbed, dragged by its header and dropped on another tile's header or centre (tabs), a side (a split)
// or the layout's outer edge (a full-height column or full-width row). A tile can slide over the others as
// a drawer instead, and pinning docks it again. Each tile's opens can land in a tile of its choosing (its
// link, PIE-473). The arrangement is a layout saved by name (PIE-474).
//
// Every change goes through a named action (TILE_ACTIONS, PANE_ACTIONS, DESK_ACTIONS): the keys, the mouse
// and the control socket are callers. The desk draws the borders, headers, tabs and the drag's ghost.
import type { Ctx, Frame, Screen, ViewState } from "../app";
import { bodyLinesOf, subject, type Msg } from "../board";
import { Canvas, overflows, scrollPct, type BoxGlyphs, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, agentLabel, type ActRequest } from "../surface/actions";
import { NOTE_ACTIONS, type OpenHow } from "../surface/note";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { colourBody, wrap } from "../text";
import { dropAt, type Drop, type DropTile } from "./drop";
import { activate, besideSlot, cycle, describeTree, dividerAt, dragShare, edge, even, leaf, leaves, move, neighbour, normalise, pair, placeScreen, remove, resize, revive, serialize, shown, split, tabInto, tabsOf, type Axis, type Dir, type Divider, type Grab, type LNode, type Place, type Placed } from "./layout";
import { PANE_ACTIONS, type PaneDone, type PaneHost } from "./pane-actions";
import { Entered, ReaderPane, TreePane, sessionName, sessionStart, startSession, type DeskApi, type Pane, type PaneKind, type SessionKind } from "./panes";
import { PreviewPane, sourceName } from "./preview";
import { BACKLINKS_ACTIONS, BacklinksPane } from "./backlinks-pane";
import { isEscapeChord, PtyPane, ESCAPE_CHORD } from "./pty";
import { ScreenTile } from "./screen-tile";
import { LocalMarks, markLabel, type Mark, type MarkStore } from "./marks";
import { TILE_ACTIONS, type NewTile, type TileDone, type TileHost, type Where } from "./tile-actions";
import { builtin, DetailPane, dailyDraft, editor, layoutNamed, layoutNames, makeTile, saveLayout, TILE_KINDS, words, type LayoutSpec, type OpenRule, type SavedTree, type TileSpec } from "./tiles";

/** desk.json: the layout tree of tile specs (pairs as `ratio a b`, what every door reads), the focus, the open rule. */
interface SavedDesk { root: SavedTree; focus: number; rule?: OpenRule; layout?: string }
/**
 * Panes a view puts on a desk of its own, and how they're laid out (default: side by side). `names`: each
 * pane's tile name, in order (what `act reader=`, links and previews call it); `links`: [from, to] by place
 * in `panes`, where the first's opens land (PIE-473); `focus`: the place of the pane that starts with the
 * keys; `frame`: the glyphs its tiles' frames are drawn with; `digits: false`: the digits are the view's own
 * (the welcome's notes), so the headers don't number the tiles and 1-9 don't focus them.
 */
export interface DeskPreset { panes: Pane[]; layout?: (ids: number[]) => LNode; title?: string; names?: string[]; links?: [number, number][]; focus?: number; frame?: BoxGlyphs; digits?: false }

/** ^W o <key>: the tile a key adds. */
const ADD: Record<string, PaneKind> = { t: "tree", r: "reader", d: "detail", p: "preview", e: "pty", s: "pty", h: "thread", a: "activity", w: "who", b: "art", k: "board", v: "river", f: "brief", l: "backlinks" };
const DOCK: Record<string, Dir> = { H: "left", J: "down", K: "up", L: "right" };
const MOVE: Record<string, Dir> = { h: "left", j: "down", k: "up", l: "right" };

type Prefix = "" | "wm" | "add" | "addtab" | "move" | "tab";
/** A header pressed: the tile (a tab) it would drag, and where. A drag of a cell or more starts moving it. */
interface HeadPress { id: number; x: number; y: number }

export class Desk implements Screen, DeskApi, PaneHost, TileHost {
  title = "desk";
  ctx!: Ctx;
  current: Msg | null = null;
  private panes = new Map<number, Pane>();
  protected root: LNode;
  private focus: number;
  private zoom: number | null = null;
  private nextId = 1;
  private prefix: Prefix = "";
  private drag: Grab | null = null;
  /** A reader the mouse went down in (PIE-419): its drag selects text, its release is the click. */
  private pressed: { pane: ReaderPane; col: number; row: number; fresh: boolean } | null = null;
  private placed: Placed = { rects: new Map(), nodes: new Map(), dividers: [] };
  private search: SearchOverlay | null = null;
  private picker: LayoutPicker | null = null;
  /** The reader edit, comment or property panel the person is in: only that one takes their keys (PIE-411). */
  private entered = new Entered();
  /** A session the person started by key that is still opening (the note being read): Esc cancels it. */
  private pending: { pane: ReaderPane } | null = null;

  // ── tiles (PIE-413) ──
  /** Each tile's name: what links, previews, `act reader=` and `peek` call it. */
  private names = new Map<number, string>();
  /** Where a tile's opens land (PIE-473): tile → tile. */
  private links = new Map<number, number>();
  /** Tiles that slide over the layout as drawers (not pinned), and the ones of those slid shut. */
  private over = new Set<number>();
  private shut = new Set<number>();
  /** Where an open without a link lands: the current note (the desk), or a new column to the right (the river). */
  private rule: OpenRule = "current";
  /** The layout last loaded or saved by name. */
  private layoutName: string | null = null;
  /** The terminal tile the person is typing in: every key but the escape chord is its program's. */
  private ptyIn: PtyPane | null = null;
  /** The tile under the pointer's press on a header, and the drag it became. */
  private headPress: HeadPress | null = null;
  private dragging: { src: number; drop: Drop<number> | null; x: number; y: number } | null = null;
  /** alt+l: the next click (or h j k l, a digit) picks where this tile's opens land. */
  private linking: { from: number } | null = null;
  /** A tile that takes every mouse event while the button is down (a terminal, a screen). */
  private mouseTile: { id: number; r: Rect } | null = null;
  /** What was drawn, for the mouse: tiles (drawers first, they're on top), header labels, drawer handles. */
  private hits: [number, Rect][] = [];
  private heads: { id: number; from: number; to: number; row: number }[] = [];
  private markHits: { n: number; from: number; to: number; row: number }[] = [];
  private handles: { id: number; from: number; to: number }[] = [];
  private dividers: Divider<number>[] = [];
  private area: Rect = { col: 0, row: 0, cols: 80, rows: 22 };
  /** Attention marks (door-local until PIE-423's service store; a preset desk keeps its own, unsaved). */
  private marksStore: MarkStore;
  private headOut = "";

  /**
   * A desk with a `preset`: these panes in this layout (by their ids, in order), a title of its own, and
   * nothing saved to desk.json, so a view built on the desk (the showcase, the brief) never moves the
   * person's own layout. Without one, the layout named by `opts.layout`, the saved layout, or the default.
   */
  constructor(private readonly preset?: DeskPreset, opts: { layout?: string } = {}) {
    this.marksStore = new LocalMarks(!preset);
    if (preset) {
      const ids = preset.panes.map((p, i) => this.put(p, preset.names?.[i]));
      this.root = preset.layout ? preset.layout(ids) : ids.slice(1).reduce<LNode>((a, id) => pair("row", 0.5, a, { t: "leaf", id }), { t: "leaf", id: ids[0]! });
      for (const [from, to] of preset.links ?? []) if (ids[from] !== undefined && ids[to] !== undefined) this.links.set(ids[from]!, ids[to]!);
      this.focus = ids[preset.focus ?? 0] ?? ids[0]!;
      if (preset.title) this.title = preset.title;
      return;
    }
    this.root = leaf(0); this.focus = 0;
    const named = opts.layout ? layoutNamed(opts.layout) : null;
    const saved = named ? null : readState<SavedDesk>("desk.json");
    if (named) { this.build(named.spec); this.layoutName = opts.layout!; }
    else if (saved?.root) { this.build({ root: saved.root, focus: saved.focus, rule: saved.rule }); this.layoutName = saved.layout ?? null; }
    else this.build(layoutNamed("desk")!.spec);
  }

  private put(p: Pane, name?: string): number {
    const id = this.nextId++;
    this.panes.set(id, p);
    this.names.set(id, name && ![...this.names.values()].includes(name) ? name : this.autoName(p.kind));
    return id;
  }
  private autoName(kind: string): string {
    const taken = new Set(this.names.values());
    if (!taken.has(kind)) return kind;
    for (let n = 2; ; n++) if (!taken.has(`${kind}${n}`)) return `${kind}${n}`;
  }
  private nameOf(id: number) { return this.names.get(id) ?? String(id); }
  private numberOf(id: number) { return leaves(this.root).indexOf(id) + 1; }

  // ── building a layout (PIE-474) ──────────────────────────────────────────

  /**
   * Lay out `spec`. With `reuse`, a tile already here with the same name and kind (and program) is kept as
   * it is; one the layout has no place for that holds work (a running program, an unsaved edit) is kept as
   * a shut drawer on the right, and the rest are closed.
   */
  private build(spec: LayoutSpec, reuse = false): void {
    const old = new Map(this.panes);
    const oldNames = new Map(this.names);
    const byName = new Map([...this.names].map(([id, n]) => [n, id] as const));
    const used = new Set<number>(), fresh: number[] = [], wantLinks: [number, string][] = [];
    const names = new Map<number, string>(), over = new Set<number>(), shut = new Set<number>();
    if (!reuse) this.panes.clear();
    this.names = names;
    const root = revive(spec.root, (l: TileSpec) => {
      const kind = (TILE_KINDS as readonly string[]).includes(l.kind) ? l.kind : "reader";
      const o = reuse && l.name ? byName.get(l.name) : undefined;
      const p = o !== undefined ? old.get(o) : undefined;
      let id: number;
      if (o !== undefined && p && !used.has(o) && p.kind === kind && (!(p instanceof PtyPane) || !l.cmd || p.run.cmd.join(" ") === l.cmd.join(" "))) {
        id = o; names.set(id, l.name!);
      } else {
        const pane = makeTile({ ...l, kind });
        id = this.nextId++; this.panes.set(id, pane);
        names.set(id, l.name && ![...names.values()].includes(l.name) ? l.name : this.autoName(kind));
        fresh.push(id);
      }
      used.add(id);
      if (l.link) wantLinks.push([id, l.link]);
      if (l.drawer) { over.add(id); if (l.drawer === "shut") shut.add(id); }
      return id;
    });
    // A saved tree with no tiles in it (a hand-edited save): the desk's own layout instead.
    if (!leaves(root).length) { this.names = oldNames; return this.build(builtin("desk")!, reuse); }
    let tree = normalise(root);
    // What the new layout has no place for: kept when it holds work, else closed.
    if (reuse) for (const [id, p] of old) {
      if (used.has(id)) continue;
      if (this.holdsWork(p)) {
        const was = oldNames.get(id) ?? p.kind;
        names.set(id, [...names.values()].includes(was) ? this.autoName(was) : was);
        tree = edge(tree, id, "right", 0.3); over.add(id); shut.add(id);
      } else { p.dispose?.(); this.panes.delete(id); if (this.ptyIn === p) this.ptyIn = null; }
    }
    this.root = normalise(tree);
    // Nothing left to show (a saved layout of empty tab sets): the desk as it always opened.
    if (!leaves(this.root).length) { this.names = names; return this.build(layoutNamed("desk")!.spec, reuse); }
    this.over = over; this.shut = shut;
    this.links = new Map();
    for (const [id, to] of wantLinks) { const t = [...names].find(([, n]) => n === to)?.[0]; if (t !== undefined && t !== id) this.links.set(id, t); }
    this.rule = spec.rule ?? "current";
    const ids = leaves(this.root);
    const f = typeof spec.focus === "string" ? [...names].find(([, n]) => n === spec.focus)?.[0] : ids[typeof spec.focus === "number" ? spec.focus : 0];
    this.focus = f !== undefined && ids.includes(f) ? f : ids[0]!;
    activate(this.root, this.focus);
    this.zoom = null;
    if (this.ctx) for (const id of fresh) this.startTile(id);
  }

  /** A running program, an unsaved edit, a screen with a draft: closing it would lose something. */
  private holdsWork(p: Pane): boolean {
    if (p instanceof PtyPane) return p.running;
    if (p instanceof ReaderPane) return p.unsaved() || p.editing;
    if (p instanceof ScreenTile) return p.unsaved();
    return false;
  }

  /** A tile joins a live desk: it reads what it needs, a detail its note, a preview its source. */
  private startTile(id: number) {
    const p = this.panes.get(id)!;
    p.init?.(this);
    p.select?.(this.current, this);
    if (p instanceof DetailPane && p.page && !p.msg) {
      const page = p.page;
      this.ctx.board.resolvePage(page).then(r => { if (r.status === "resolved" && r.block && !p.msg) { p.hold(r.block, this); this.redraw(); } }, () => {});
    }
    if (p instanceof DetailPane && p.want && !p.msg) {
      const want = p.want;
      this.ctx.board.get(want).then(m => { if (m && !p.msg) { p.hold(m, this); this.redraw(); } }, () => {});
    }
    // A terminal tile's view (nvim's buffer): previews following it show its file.
    if (p instanceof PtyPane) p.onView = v => { for (const q of this.panes.values()) if (q instanceof PreviewPane && "tile" in q.source && this.idNamed(q.source.tile) === this.idOf(p)) q.followFile(v.file, this); };
    if (p instanceof PreviewPane && "tile" in p.source) {
      const src = this.idNamed(p.source.tile);
      const sp = src !== undefined ? this.panes.get(src) : undefined;
      if (sp instanceof PtyPane) p.followFile(sp.file, this);
      const m = sp instanceof ReaderPane ? sp.msg : sp instanceof ScreenTile ? sp.current() : sp instanceof TreePane ? sp.selected() : null;
      if (m) p.follow(m, this);
    }
  }

  /** What tile `name` shows or has selected (a reader's note, the tree's row, a screen's card), for a tile that follows it. */
  tileShowing(name: string): Msg | null {
    const id = this.idNamed(name);
    const p = id !== undefined ? this.panes.get(id) : undefined;
    return p instanceof ReaderPane ? p.msg : p instanceof ScreenTile ? p.current() : p instanceof TreePane ? p.selected() : null;
  }

  private idNamed(name: string): number | undefined { return [...this.names].find(([id, n]) => n === name && this.panes.has(id))?.[0]; }

  private specOf(id: number): TileSpec {
    const p = this.panes.get(id)!;
    const link = this.links.get(id);
    return {
      t: "leaf", kind: p.kind as PaneKind, name: this.nameOf(id), ...(p.spec?.() ?? {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : {}),
      ...(this.over.has(id) ? { drawer: this.shut.has(id) ? "shut" as const : "over" as const } : {}),
    };
  }

  /**
   * The tree as saved: without a ctrl+e edit tile, whose temp file and draft go when the door does (restored,
   * it would edit a file that's gone and bring nothing back).
   */
  private savedRoot(): LNode {
    let root: LNode | null = this.root;
    for (const [id, p] of this.panes) if (p instanceof PtyPane && p.run.temp && root) root = remove(root, id);
    return root ?? this.root;
  }
  /** The layout as saved: tile specs in the tree, the focus, the open rule. */
  layoutSpec(): LayoutSpec { return { root: serialize(this.savedRoot(), id => this.specOf(id)), focus: this.nameOf(this.focus), rule: this.rule }; }

  private save() {
    if (this.preset) return;
    const root = serialize(this.savedRoot(), id => this.specOf(id));
    writeState("desk.json", { root, focus: leaves(this.root).indexOf(this.focus), rule: this.rule, ...(this.layoutName ? { layout: this.layoutName } : {}) } satisfies SavedDesk);
  }

  // ── DeskApi ────────────────────────────────────────────────────────────────

  enter(ctx: Ctx) { const again = !!this.ctx; this.ctx = ctx; this.onScreen = true; if (!again) for (const id of leaves(this.root)) this.startTile(id); }

  /**
   * The desk is left (esc, q, the menu). With programs running in its tiles it isn't ended: it stays alive in
   * the background, its programs running, and D on the menu brings the same desk back. Otherwise it's done.
   */
  dispose(): void | "keep" {
    this.onScreen = false;
    if (!this.preset && this.running().length) { Desk.kept = this; return "keep"; }
    for (const p of this.panes.values()) p.dispose?.();
  }
  /** The desk kept alive with its programs, to come back to (the menu's D). */
  private static kept: Desk | null = null;
  /** The desk to open: the one kept running in the background, else a new one. */
  static resume(): Desk { const d = Desk.kept; Desk.kept = null; return d ?? new Desk(); }
  private onScreen = false;
  private running() { return [...this.panes.values()].filter((p): p is PtyPane => p instanceof PtyPane && p.running); }
  /** A desk built for another view (the brief) has no way back: leaving it would end its programs, so it says so. */
  leaveRefusal(): string | null {
    const r = this.preset ? this.running() : [];
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "runs" : "run"} in a tile here · ^W x ends ${r.length === 1 ? "it" : "them"} first` : null;
  }

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    // alt+⏎ on a link, or a ctrl- or alt-click (PIE-441, PIE-473): a new reader beside this one holds it;
    // the others keep their notes. An agent's doesn't take the person's focus.
    if (m && opts.fresh && opts.from instanceof ReaderPane) {
      const at = this.idOf(opts.from);
      if (at !== undefined) {
        // A held reader: a detail by another name, as it has been since PIE-441.
        const id = this.put(makeTile({ kind: "reader" }));
        this.root = normalise(besideSlot(this.root, at, leaf(id), "right"));
        this.zoom = null;
        this.startTile(id);
        (this.panes.get(id) as ReaderPane).hold(m, this);
        if (!opts.agent) this.focus = id;
        this.save();
        return this.redraw();
      }
    }
    const from = this.idOf(opts.from);
    // A preview follows its source tile's selection (PIE-473).
    if (m && from !== undefined) for (const [id, p] of this.panes) if (p instanceof PreviewPane && "tile" in p.source && this.idNamed(p.source.tile) === from && id !== from) p.follow(m, this);
    // An open (a link followed, the tree's ⏎, a list's pick) lands in the tile's link.
    if (m && from !== undefined && (opts.link || opts.reveal) && this.routes(opts.from!)) {
      const to = this.links.get(from);
      if (to !== undefined && this.openInto(to, m, !!opts.agent)) return this.redraw();
    }
    this.current = m;
    for (const p of this.panes.values()) {
      p.select?.(m, this);
      // Revealing moves the outline's cursor to the note: the person's own opens only (an agent's never does).
      if (opts.reveal && m && p !== opts.from && !opts.agent) void p.reveal?.(m, this);
    }
    this.redraw();
  }

  /**
   * A selection moved in `from` (a backlinks tile's row): the previews following it, and its link, show `m`.
   * The current note stays, so a reader that follows it (maybe the tile `from` lists the backlinks of) doesn't move.
   */
  showFrom(from: Pane, m: Msg, agent = false) {
    const id = this.idOf(from);
    if (id === undefined) return;
    for (const [pid, p] of this.panes) if (pid !== id && p instanceof PreviewPane && "tile" in p.source && this.idNamed(p.source.tile) === id) p.follow(m, this);
    const to = this.links.get(id);
    if (to !== undefined && this.panes.has(to)) this.openInto(to, m, agent);
    this.redraw();
  }

  /** Opens from `pane` land somewhere else (a link, the river's rule): a held reader doesn't follow them in place. */
  routes(pane: Pane): boolean {
    const id = this.idOf(pane);
    if (id === undefined) return false;
    const to = this.links.get(id);
    return to !== undefined && this.panes.has(to);
  }

  private idOf(p: Pane | undefined): number | undefined { return p ? [...this.panes].find(([, x]) => x === p)?.[0] : undefined; }

  /** Show `m` in tile `to` (its link target): false when that tile can't show a note, or holds an edit. */
  private openInto(to: number, m: Msg, _agent: boolean): boolean {
    const p = this.panes.get(to);
    if (p instanceof PreviewPane) { p.follow(m, this); return true; }
    if (!(p instanceof ReaderPane)) { this.ctx.flash(`${this.nameOf(to)} can't show a note · alt+l links this tile somewhere else`); return false; }
    if (p.holdsKeys || p.editing) { this.ctx.flash(`${this.nameOf(to)} holds ${sessionName(p)} · the note opened as the current one instead`); return false; }
    // The target keeps it in its history (PIE-453): back returns to what it showed.
    p.surface.track(() => p.hold(m, this));
    return true;
  }


  /** The reader the person has focused (PIE-453). */
  holdsFocus(pane: ReaderPane) { return this.panes.get(this.focus) === pane; }

  focusKind(kind: PaneKind) {
    const id = leaves(this.root).find(i => this.panes.get(i)?.kind === kind);
    if (id !== undefined) { this.focus = id; activate(this.root, id); this.redraw(); }
  }

  /** A repaint, while the desk is the screen shown (kept in the background, its programs don't repaint the menu). */
  redraw() { if (this.onScreen) this.ctx?.redraw(); }

  tick(): boolean { let any = false; for (const p of this.panes.values()) if (p instanceof ScreenTile && p.tick()) any = true; return any; }

  onEvent(e: OutlineEvent) {
    for (const p of this.panes.values()) (p.onEvent as ((d: DeskApi, e?: OutlineEvent) => void) | undefined)?.call(p, this, e);
    const id = e.blockId;
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && !p.msg?.id.startsWith("file:"));
    // After a reconnect that couldn't catch up, every reader re-reads its note (a draft is only marked).
    const stale = e.action === "reset" ? readers.map(r => r.msg?.id).filter((x): x is string => !!x)
      : id && readers.some(r => r.msg?.id === id && !(e.change?.revision !== undefined && r.msg.revision === e.change.revision && !r.msg.partial)) ? [id] : [];
    for (const x of new Set(stale)) this.ctx.board.get(x).then(m => { if (m) { readers.forEach(r => r.refresh(m)); this.redraw(); } }, () => {});
    if (e.action === "reconnected") for (const r of readers) r.retry(this);   // a note whose read failed while away
  }

  /**
   * `ep0ch open <id>` (an agent's): the note is shown where the focused tile's opens land, else in a reader
   * that follows the current note, else in the first detail free to take it. The person's keys, their outline
   * cursor and what they're typing in stay where they are.
   */
  openBlock(m: Msg) {
    const link = this.links.get(this.focus);
    const readers = this.namedReaders().filter(r => !r.pane.holdsKeys && !r.pane.editing && !(r.pane instanceof PreviewPane));
    const r = (link !== undefined ? readers.find(x => x.id === link) : undefined) ?? readers.find(x => x.pane.follows && !x.pane.holding) ?? readers[0];
    const show = () => { this.setCurrent(m, { agent: true }); if (r && r.pane.msg?.id !== m.id) { if (r.pane.holding || r.pane instanceof DetailPane) r.pane.hold(m, this); else r.pane.show(m, this); } };
    if (r) r.pane.surface.track(show); else show();
    this.redraw();
  }

  // ── actions: what the keys do, by name, for agents (`ep0ch act`) ─────────

  actions() {
    return { actions: [...DESK_ACTIONS.list(), ...TILE_ACTIONS.list(), ...PANE_ACTIONS.list(), ...BACKLINKS_ACTIONS.list(), ...NOTE_ACTIONS.list()], readers: this.namedReaders().map(r => r.name), tiles: leaves(this.root).map(id => this.nameOf(id)) };
  }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (DESK_ACTIONS.has(req.action)) return DESK_ACTIONS.runUntyped(req.action, args, { d: this, reader: req.reader }, actor);
    if (TILE_ACTIONS.has(req.action)) return TILE_ACTIONS.runUntyped(req.action, args, { d: this, reader: req.reader }, actor);
    if (PANE_ACTIONS.has(req.action)) return PANE_ACTIONS.runUntyped(req.action, args, { h: this, reader: req.reader }, actor);
    if (BACKLINKS_ACTIONS.has(req.action)) return { tile: this.backlinksTile(req.reader).name, ...(await BACKLINKS_ACTIONS.runUntyped(req.action, args, { pane: this.backlinksTile(req.reader).pane, desk: this }, actor) as object) };
    // A whole screen's own actions (the board's card.*), in its tile.
    const t = req.reader ? this.tileNamed(req.reader, false) : null;
    const sp = t ? this.panes.get(t.id) : null;
    if (sp instanceof ScreenTile) return { tile: t!.name, ...(await sp.act({ ...req, reader: undefined }, actor) as object) };
    const r = this.pickReader(req.reader);
    const out = await r.pane.act(req.action, args, this, actor);
    return { reader: r.name, ...(out && typeof out === "object" ? out : { result: out }) };
  }

  /** A backlinks tile by name or number, or the first one. */
  private backlinksTile(sel?: string): { name: string; pane: BacklinksPane } {
    const all = leaves(this.root).filter(id => this.panes.get(id) instanceof BacklinksPane);
    const t = sel ? this.tileNamed(sel, false) : null;
    const id = t && all.includes(t.id) ? t.id : !sel ? all[0] : undefined;
    if (id === undefined) throw new ActionRefused(all.length ? `${sel} isn't a backlinks tile; backlinks tiles: ${all.map(i => this.nameOf(i)).join(", ")}` : "no backlinks tile here; ^W o l opens one beside a reader");
    return { name: this.nameOf(id), pane: this.panes.get(id) as BacklinksPane };
  }

  /** A key or a click runs the same action as `act`, as the person; a refusal is said, not thrown. */
  private cmd(name: string, args: Record<string, unknown> = {}, reader?: string) {
    const on = { d: this, reader };
    const done = (p: Promise<unknown>) => p.then(() => this.redraw(), e => { this.ctx.flash(e instanceof Error ? e.message : String(e)); this.redraw(); });
    try {
      if (TILE_ACTIONS.has(name)) return void done(TILE_ACTIONS.run(name, args as never, on, USER));
      if (PANE_ACTIONS.has(name)) return void done(PANE_ACTIONS.run(name, args as never, { h: this, reader }, USER));
      if (DESK_ACTIONS.has(name)) return void done(DESK_ACTIONS.run(name, args as never, on, USER));
    } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e)); this.redraw(); }
  }

  /** The reader panes with their numbers on screen (the ones `peek` shows), for a screen built on the desk. */
  readerPanes(): { name: string; pane: ReaderPane }[] { return this.namedReaders().map(({ name, pane }) => ({ name, pane })); }

  /**
   * A reader beside `pane` that follows the current note, for a screen whose own reader stays put (the
   * brief, a pinned page): the one already there, or one split off to its right. The person's focus
   * stays on `pane`; an agent's split never takes it.
   */
  readerBeside(pane: ReaderPane, actor: Actor) {
    if (this.readerPanes().some(r => r.pane !== pane && !r.pane.holding && r.pane.kind === "reader" && r.pane.follows)) return;
    const me = () => this.readerPanes().find(r => r.pane === pane)!.name;
    this.splitPane(me(), "reader", "row", actor);
    if (actor.kind !== "agent") this.focusOn(me());
  }

  /**
   * The person's keys belong to the desk right now: its search or layout picker is open, a ^W command is
   * pending, they are in (or opening) a reader's edit, comment or property panel or a step's status
   * choice, or in a terminal tile.
   * A screen built on the desk leaves its own keys to the desk then.
   */
  personTyping(): boolean {
    const f = this.panes.get(this.focus);
    return !!this.search || !!this.picker || this.prefix !== "" || !!this.pending || !!this.personIn() || !!this.focusedReader()?.surface.choosing || this.inPty() || (f instanceof ScreenTile && f.holdsKeys());
  }

  /** The person is in a terminal tile (its program running, or exited and waiting for ⏎ or ctrl+]): every key is the tile's, ctrl+c included. */
  rawKeys(): boolean { return this.inPty(); }
  private inPty(): boolean { return !!this.ptyIn && this.panes.get(this.focus) === this.ptyIn; }
  /** Raw input goes straight to the program while it runs (F-keys, shift-arrows, a bracketed paste): Term keeps the mouse and ctrl+]. */
  rawInput(): ((bytes: string) => void) | null { const p = this.ptyIn; return p && this.inPty() && p.running ? (s: string) => p.inputRaw(s) : null; }
  acceptsPaste(): boolean { return this.inPty(); }
  /** The last ctrl+] out of a terminal: a second one soon after sends ctrl+] to the program instead. */
  private chord: { pane: PtyPane; at: number } | null = null;

  /** Reader panes by their number on screen (the one `peek` shows): "2", "3"… */
  private namedReaders(): { name: string; id: number; pane: ReaderPane }[] {
    return leaves(this.root).map((id, i) => ({ name: String(i + 1), id, pane: this.panes.get(id)! }))
      .filter((r): r is { name: string; id: number; pane: ReaderPane } => r.pane instanceof ReaderPane);
  }

  /** A reader by number, tile name, "reader" (the first), "focused", or a block id it shows. No name: the focused reader, else the first. */
  private pickReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.namedReaders();
    if (!all.length) throw new ActionRefused("the desk has no reader pane; add one (ctrl+w o r)");
    if (!sel || sel === "focused" || sel === "reader") return (sel !== "reader" && all.find(r => r.id === this.focus)) || all[0]!;
    const named = all.find(r => r.name === sel || this.names.get(r.id) === sel);
    if (named) return named;
    if (/^[0-9a-f-]{8,}$/.test(sel)) {
      const showing = all.filter(r => r.pane.msg?.id.startsWith(sel));
      const r = showing.find(x => x.pane.editing) ?? showing[0];
      if (r) return r;
      throw new ActionRefused(`no reader shows ${sel}; open it first (open id=${sel})`);
    }
    throw new ActionRefused(`no reader ${sel} on the desk; readers: ${all.map(r => `${r.name} (${this.nameOf(r.id)})`).join(", ")}, focused, or a block id`);
  }

  /** `open`: the note becomes the desk's current note (unpinned readers follow) and the reader gets the keys. */
  async openIn(id: string, sel?: string, actor: Actor = USER): Promise<{ reader: string; id: string }> {
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    const r = this.pickReader(sel);
    // An open into a reader is part of its history (PIE-453): back returns to what it showed.
    r.pane.surface.track(() => {
      this.setCurrent(m, { reveal: actor.kind !== "agent", agent: actor.kind === "agent" });
      const ok = r.pane.msg?.id === m.id || (r.pane.holding ? (r.pane.hold(m, this), r.pane.msg?.id === m.id) : r.pane.show(m, this));
      if (!ok) throw new ActionRefused(`reader ${r.name} is holding an edit or a comment on another note`);
    });
    // The person's open gives the reader the keys, unless they're in an edit, a comment, the panel or a
    // terminal: that keeps them. An agent's never moves them (Evan: agents change anything but where his cursor is).
    if (actor.kind !== "agent" && !this.personIn() && !this.inPty()) { this.focus = r.id; activate(this.root, r.id); this.zoom = this.zoom !== null ? r.id : null; }
    this.redraw();
    return { reader: r.name, id: m.id };
  }

  focusOn(sel: string): { focus: string } {
    const r = this.pickReader(sel);
    // Coming back to a session by moving to it: e or ⏎ enters it again. Focusing the reader the person
    // is already in moves nothing, so they stay in it.
    if (r.id !== this.focus) this.entered.clear();
    this.focus = r.id; activate(this.root, r.id); this.zoom = this.zoom !== null ? r.id : null;
    this.redraw();
    return { focus: r.name };
  }

  unsaved() { return this.drafts().length > 0; }
  keepDrafts() { return this.drafts().flatMap(p => p.keepDrafts()); }
  private drafts() { return [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && p.unsaved()); }
  /** Quitting the door ends the desk's programs: said first, and asked twice (App). Leaving the desk doesn't. */
  leaveWarning(): string | null {
    // An agent attached from Herdr keeps running in its pane when the door quits: nothing of it ends here.
    const r = this.running().filter(p => !p.inHerdr);
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "is" : "are"} running in a tile · quitting ends ${r.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  describe() {
    const order = leaves(this.root);
    return {
      kind: "desk", current: this.current ? { id: this.current.id, title: subject(this.current) } : null, zoom: this.zoom,
      layoutName: this.layoutName, rule: this.rule, focusName: this.nameOf(this.focus), inTerminal: this.inPty() ? this.nameOf(this.focus) : null,
      linking: this.linking ? this.nameOf(this.linking.from) : null,
      dragging: this.dragging ? { tile: this.nameOf(this.dragging.src), drop: this.dragging.drop ? dropView(this.dragging.drop, id => this.nameOf(id)) : null } : null,
      layout: describeTree(this.root, id => String(order.indexOf(id) + 1)),
      tree: describeTree(this.root, id => this.nameOf(id)),
      panes: order.map((id, i) => this.tileView(id, i + 1)),
    };
  }

  private tileView(id: number, n = this.numberOf(id)) {
    const p = this.panes.get(id)!; const r = this.placed.rects.get(id) ?? this.hits.find(([x]) => x === id)?.[1];
    const set = tabsOf(this.root, id);
    const link = this.links.get(id);
    return {
      n, name: this.nameOf(id), kind: p.kind, title: p.title(), focused: id === this.focus, rect: r, shown: shown(this.root).includes(id) && !this.shut.has(id),
      ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), tabShown: this.nameOf(set.ids[set.active]!) } : {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : {}),
      ...(this.over.has(id) ? { drawer: this.shut.has(id) ? "shut" : "open" } : {}),
      ...(p instanceof PreviewPane ? { source: sourceName(p.source) } : {}),
      ...(p instanceof BacklinksPane ? { source: `tile:${p.source}`, backlinks: p.describe() } : {}),
      ...(p instanceof PtyPane ? { terminal: p.describe() } : {}),
      showing: p instanceof ReaderPane && p.msg ? { id: p.msg.id, title: subject(p.msg) } : p instanceof ScreenTile && p.current() ? { id: p.current()!.id, title: subject(p.current()!) } : undefined,
      agent: p instanceof ReaderPane ? p.surface.agent ?? undefined : undefined,
      editing: p instanceof ReaderPane && p.draft ? { id: p.draft.blockId, dirty: p.draft.dirty, changedElsewhere: p.draft.changedElsewhere, conflict: p.draft.conflict } : undefined,
      commenting: p instanceof ReaderPane && p.session ? p.session.describe() : undefined,
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols, rows } = ctx.t;
    const canvas = new Canvas(cols, rows - 1);
    // A view built on the desk may keep rows above the tiles for its own art (the welcome's logo band).
    const top = Math.max(0, Math.min(rows - 6, this.bandRows(cols, rows)));
    const area: Rect = { col: 0, row: top, cols, rows: rows - 2 - top };
    this.area = area;
    const drawers: [number, Rect][] = [];
    if (this.zoom !== null && this.panes.has(this.zoom)) {
      this.placed = { rects: new Map([[this.zoom, area]]), nodes: new Map(), dividers: [] };
      this.dividers = [];
    } else {
      const ps = placeScreen({ root: this.root, over: this.over, floats: [] }, area);
      this.placed = ps;
      this.dividers = [...ps.dividers];
      for (const id of this.over) {
        const o = ps.over.get(id);
        if (!o || this.shut.has(id) || !shown(this.root).includes(id)) continue;
        drawers.push([id, o.rect]);
        if (o.divider) this.dividers.unshift(o.divider);
      }
    }
    const docked = [...this.placed.rects];
    this.hits = [...drawers, ...docked];
    this.heads = []; this.markHits = [];
    let placements: Placement[] = top ? this.drawBand(canvas, { col: 0, row: 0, cols, rows: top }) : [];
    for (const [id, r] of docked) placements.push(...this.drawTile(canvas, id, r));
    for (const [id, r] of drawers) { canvas.clear(r, bg(C.black)); placements = placements.filter(p => !overlaps(p, r)); placements.push(...this.drawTile(canvas, id, r, true)); }
    if (this.dragging) this.drawGhost(canvas);
    if (this.search) {
      const r: Rect = { col: Math.floor(cols * 0.1), row: Math.floor(rows * 0.12), cols: Math.floor(cols * 0.8), rows: Math.floor(rows * 0.72) };
      canvas.clear(r, bg(C.black));
      canvas.box(r, fg(C.yellow), `${fg(C.yellow)}search the board`, fg(C.dark) + "↑↓ pick · ⏎ open · esc close");
      this.search.render(r.cols - 2, r.rows - 2).forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, r.cols - 2));
      placements = [];   // images would bleed through the overlay
    }
    if (this.picker) { this.picker.draw(canvas, cols, rows); placements = []; }
    canvas.text(0, rows - 2, this.hints(cols), cols);
    return { lines: canvas.lines(), placements };
  }

  /** alt+l is waiting for the tile to link to: its next key (a tile's number, h j k l) is the desk's. */
  protected linkingNow(): boolean { return !!this.linking; }
  /** Rows kept above the tiles for a view's own art (none on the desk itself). */
  protected bandRows(_cols: number, _rows: number): number { return 0; }
  /** Draw the band above the tiles in `r`; its images, if any. */
  protected drawBand(_canvas: Canvas, _r: Rect): Placement[] { return []; }
  /** A view's own hint row while nothing else is going on (a drag, a link, a terminal, a prefix), or null for the desk's. */
  protected screenHint(): string | null { return null; }

  /** One tile: its frame, its header (its name, or its tab set's tabs), its body, its placements. */
  private drawTile(canvas: Canvas, id: number, r: Rect, drawer = false): Placement[] {
    const pane = this.panes.get(id)!;
    const focused = id === this.focus;
    const inner: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
    const typing = pane === this.ptyIn && focused;
    const view = inner.cols >= 1 && inner.rows >= 1 ? (pane instanceof PtyPane ? pane.render(inner.cols, inner.rows, focused, this, typing) : pane.render(inner.cols, inner.rows, focused, this)) : null;
    // A reader holding a session the person isn't in says how to get in; a long note says how far down it is.
    const held = pane instanceof ReaderPane && pane.holdsKeys && !this.entered.in(pane);
    const more = overflows(view?.scroll) ? `${fg(C.dark)} · ${scrollPct(view!.scroll!)}` : "";
    const marked = this.marksOn(id);
    const edgeC = this.linking ? (id === this.linking.from ? C.lmagenta : C.magenta) : this.dragging?.src === id ? C.dark : marked.length ? C.lmagenta : typing ? C.yellow : focused ? C.lcyan : drawer ? C.brown : C.blue;
    const title = this.header(id, r, focused) + (held ? fg(C.dark) + " (e enters)" : "") + more;
    const hint = focused ? fg(C.dark) + (held && pane instanceof ReaderPane ? `e ⏎ enter${pane.surface.scrolls() ? " · j k scroll" : ""}` : pane.hint()) : "";
    canvas.box(r, fg(edgeC), title, hint, this.preset?.frame);
    const out: Placement[] = [];
    if (!view) return out;
    view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    if (overflows(view.scroll)) canvas.thumb(r, view.scroll, fg(focused ? C.lcyan : C.cyan));
    for (const p of view.placements ?? []) out.push({ ...p, key: `p${id}:${p.key}`, col: p.col + inner.col, row: p.row + inner.row, cols: Math.min(p.cols, inner.cols), rows: Math.min(p.rows, inner.rows) });
    return out;
  }

  /**
   * The header row's text: the tile's number and name (bright when focused), or its tab set's tabs (the
   * one shown on blue); then what it shows, where its opens land (→), and a drawer's state. Each tab's
   * label is kept as a hit for clicks and drags.
   */
  private header(id: number, r: Rect, focused: boolean): string {
    const set = tabsOf(this.root, id);
    let x = r.col + 3;
    const max = r.col + r.cols - 2;
    this.headOut = "";
    const xNow = () => x;
    const put = (text: string, sgr: string, hit?: number) => {
      if (hit !== undefined && x < max) this.heads.push({ id: hit, from: x, to: Math.min(max, x + text.length), row: r.row });
      this.headOut += sgr + text + RESET; x += text.length;
    };
    if (set && set.ids.length > 1) {
      set.ids.forEach((t, i) => {
        if (i) put("│", fg(C.blue));
        const on = i === set.active;
        put(` ${this.numLabel(t)}${this.nameOf(t)} `, on ? bg(focused ? C.blue : C.dark) + fg(C.white) : fg(C.grey), t);
      });
    } else if (this.plainName(id)) {
      // A tile named only by its kind reads as it always did: its number, then its title.
      if (this.numbered) put(`${this.numberOf(id)}`, fg(focused ? C.white : C.dark), id);
      this.putMarks(id, put, xNow, r.row);
      put(`${this.numbered ? " " : ""}${this.panes.get(id)!.title()}`, fg(focused ? C.lcyan : C.cyan), id);
      return this.headerTail(id, put, xNow, r.row);
    } else put(`${this.numLabel(id)}${this.nameOf(id)}`, fg(focused ? C.white : C.grey), id);
    this.putMarks(id, put, xNow, r.row);
    const p = this.panes.get(id)!;
    const what = p instanceof ReaderPane && p.msg && !(p instanceof PreviewPane && "file" in p.source) ? `${p.title()} · ${subject(p.msg)}` : p.title();
    if (what && what !== this.nameOf(id)) put(` ${what}`, fg(focused ? C.lcyan : C.cyan));
    return this.headerTail(id, put, xNow, r.row);
  }

  /** A name the desk gave by kind (reader, reader2): not worth saying before the title. */
  /** Tiles are numbered in their headers (what 1-9 focus), unless the view keeps the digits for itself. */
  private get numbered() { return this.preset?.digits !== false; }
  private numLabel(id: number) { return this.numbered ? `${this.numberOf(id)} ` : ""; }
  private plainName(id: number) { const k = this.panes.get(id)!.kind, n = this.nameOf(id); return n === k || new RegExp(`^${k}\\d+$`).test(n); }

  private headerTail(id: number, put: (text: string, sgr: string, hit?: number) => void, xNow: () => number, row: number): string {
    const link = this.links.get(id);
    if (link !== undefined && this.panes.has(link)) put(` → ${this.nameOf(link)}`, fg(C.lmagenta));
    if (this.over.has(id)) put(" ⇤ drawer", fg(C.brown));
    if (this.linking && id !== this.linking.from) put(" ⌖ click to link here", fg(C.lmagenta));
    void xNow; void row;
    return this.headOut;
  }

  /** Attention marks on what a tile shows, right after its name (what the person should see when room is short); a click dismisses one. */
  private putMarks(id: number, put: (text: string, sgr: string) => void, xNow: () => number, row: number) {
    for (const m of this.marksOn(id)) {
      const from = xNow();
      put(` ${markLabel(m)} `, bg(C.magenta) + fg(C.white));
      this.markHits.push({ n: m.n, row, from, to: xNow() });
    }
  }

  /** The drop the pointer is over: its outline, what it does, and the tile being carried, at the pointer. */
  private drawGhost(canvas: Canvas) {
    const d = this.dragging!;
    if (d.drop) {
      const g = d.drop.ghost;
      canvas.box(g, fg(C.yellow), `${fg(C.black)}${bg(C.yellow)} ${d.drop.label} ${RESET}`, "");
      if (d.drop.kind === "tabs") canvas.text(g.col + 1, g.row + 1, `${fg(C.yellow)}${"▀".repeat(Math.max(0, g.cols - 2))}${RESET}`, Math.max(0, g.cols - 2));
    }
    const label = ` ⠿ ${this.nameOf(d.src)} `;
    canvas.text(Math.max(0, Math.min(this.area.cols - label.length, d.x + 1)), Math.min(this.area.rows - 1, d.y + 1), `${bg(C.magenta)}${fg(C.white)}${label}${RESET}`);
  }

  private hints(cols: number): string {
    const rd = this.panes.get(this.focus);
    // The drawers slid shut, as handles at the end of the row: a click opens one.
    const handles = shown(this.root).filter(id => this.shut.has(id)).map(id => ({ id, text: ` ▸ ${this.nameOf(id)} ` }));
    const hw = handles.reduce((a, h) => a + h.text.length + 1, 0);
    this.handles = [];
    let x = cols - hw;
    let tail = "";
    for (const h of handles) { this.handles.push({ id: h.id, from: x, to: x + h.text.length }); tail += `${bg(C.brown)}${fg(C.white)}${h.text}${RESET} `; x += h.text.length + 1; }
    const room = Math.max(0, cols - hw);
    const line = (s: string) => pad(s, room) + tail;
    if (this.dragging) return line(paint(`|14dragging ${this.nameOf(this.dragging.src)}|08 · ${this.dragging.drop ? `|15${this.dragging.drop.label}` : "|08nowhere here"}|08 · a header or the centre makes tabs, a side splits, the outer edge makes a column · release drops · esc cancels`));
    if (this.linking) return line(paint(`|13alt+l|08 · click the tile where |15${this.nameOf(this.linking.from)}|08's opens land (or h j k l, or its number) · click it again to unlink · esc cancels`));
    if (this.inPty() && !this.ptyIn!.running) return line(paint(`|12${this.nameOf(this.focus)} exited|08 · |15⏎|08 runs it again · |15${ESCAPE_CHORD}|08 back to the door · other keys wait`));
    if (this.inPty()) return line(paint(`|14in ${this.nameOf(this.focus)}|08 · every key goes to ${this.ptyIn!.title()} · |15${ESCAPE_CHORD}|08 back to the door (twice: send it)`));
    if (!this.prefix && rd instanceof ReaderPane && rd.holdsKeys) {
      const where = `reader ${leaves(this.root).indexOf(this.focus) + 1} · ${rd.surface.state()}`;
      return line(this.entered.in(rd)
        ? paint(`|14 ${where}|08 · `) + fg(C.grey) + rd.hint() + RESET
        : paint(`|14 ${where}|08 · |15e ⏎|08 enter ${sessionName(rd)}${rd.surface.scrolls() ? " · |15j k|08 scroll" : ""} · |15Tab/1-9|08 focus · |15^W|08 window`));
    }
    const s = this.prefix === "wm"
      ? "|14^W |07hjkl |08focus · |07m |08move · |07t |08into tabs · |07T |08tab out · |07HJKL |08to an edge · |07[ ] |08tabs · |07< > + - = |08size · |07z |08zoom · |07o O |08open · |07v |08preview · |07p |08pin · |07d |08drawer · |07r w |08layouts · |07x |08close · |07s |08swap"
      : this.prefix === "add" || this.prefix === "addtab"
        ? `|14${this.prefix === "add" ? "open beside" : "open as a tab"}: |07t |08outline · |07r |08reader · |07d |08detail · |07p |08preview · |07e |08editor · |07s |08shell · |07k |08board · |07v |08river · |07f |08brief · |07h |08thread · |07a |08activity · |07w |08who · |07b |08art · |07l |08backlinks`
        : this.prefix === "move" || this.prefix === "tab"
          ? `|14${this.prefix === "move" ? "move beside" : "into the tabs of"}: |07h j k l |08the tile that way${this.prefix === "move" ? " (none that way: to the edge)" : ""}`
          : this.screenHint() ?? `|08 Tab/1-9 focus · |15^W|08 window · |15drag|08 a header · |15alt+l|08 link · |15alt+d|08 daily · |15/|08 search · |15q|08 menu${this.layoutName ? ` · |03${this.layoutName}` : ""}${this.zoom !== null ? " · |14zoomed" : ""}${this.current ? ` · |03${subject(this.current).slice(0, 40)}` : ""}`;
    return line(paint(s));
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** The focused pane, when it's a reader. */
  private focusedReader(): ReaderPane | null { const p = this.panes.get(this.focus); return p instanceof ReaderPane ? p : null; }
  /** The focused reader, when the person is in its edit, comment or property panel. */
  private personIn(): ReaderPane | null { const p = this.focusedReader(); return p?.holdsKeys && this.entered.in(p) ? p : null; }

  /** Start a session in a reader as the person's key does (⏎ or a click on a comment mark). */
  startSession(rd: ReaderPane, kind: SessionKind) { this.start(rd, kind); }

  private start(rd: ReaderPane, kind: SessionKind) {
    // Esc, or leaving the desk, while the note is read cancels it: the token is cleared and nothing opens.
    const token = { pane: rd };
    this.pending = token;
    const still = () => this.pending === token && this.focusedReader() === rd && !this.search;
    const opened = (open: boolean) => {
      const want = still();
      if (this.pending === token) this.pending = null;
      if (open && want) { this.entered.enter(rd); this.ctx.flash(`reader ${leaves(this.root).indexOf(this.focus) + 1} · ${rd.surface.state()} · ${rd.hint()}`); }
      this.redraw();
    };
    const r = startSession(rd, kind, this, still);
    // A thread list whose comments are already read opens at once: the next key is already its.
    if (r === true || rd.sessionOf()) opened(true);
    else r.then(opened, e => this.ctx.flash(e instanceof Error ? e.message : String(e)));
  }

  key(k: Key, ctx: Ctx) {
    this.keyIn(k, ctx);
    this.entered.follow(this.focusedReader());          // moving away leaves a session; e or ⏎ enters it again
    if (this.ptyIn && this.panes.get(this.focus) !== this.ptyIn) this.ptyIn = null;
    // A drawer slides shut when the keys go elsewhere (tile.drawer, as its key and an agent do it).
    for (const id of shown(this.root)) if (this.over.has(id) && !this.setOf(id).includes(this.focus) && !this.shut.has(id) && !this.dragging && !this.headPress) this.cmd("tile.drawer", { open: false }, this.nameOf(id));
  }

  private keyIn(k: Key, ctx: Ctx) {
    if (this.search) {
      if (this.search.key(k, this) === "close") this.search = null;
      return this.redraw();
    }
    if (this.picker) { this.picker.key(k, this); return this.redraw(); }
    // In a terminal tile: every key is the program's, but the escape chord and the mouse. Once the program
    // has exited, the keys wait for a choice (⏎ runs it again, ctrl+] leaves) and nothing leaks to the desk.
    if (this.inPty() && k.kind !== "mouse") {
      const p = this.ptyIn!;
      if (isEscapeChord(k)) { this.ptyIn = null; this.chord = { pane: p, at: Date.now() }; ctx.flash(`back to the door · ctrl+] again sends ctrl+] to ${this.nameOf(this.focus)} · e or ⏎ types in it again`); return this.redraw(); }
      if (!p.running) { if (k.kind === "enter") p.restart(); else ctx.flash(`${this.nameOf(this.focus)} exited · ⏎ runs it again · ctrl+] back to the door`); return this.redraw(); }
      if (k.kind === "paste") p.paste(k.text); else p.key(k, this);
      return;
    }
    // ctrl+] twice: the second goes to the program (a literal ctrl+], telnet's own escape).
    if (isEscapeChord(k) && this.chord && Date.now() - this.chord.at < 1500 && this.panes.get(this.focus) === this.chord.pane && this.chord.pane.running) {
      const p = this.chord.pane;
      this.chord = null; this.ptyIn = p; p.input("\x1d");
      ctx.flash(`sent ctrl+] to ${this.nameOf(this.focus)}`); return this.redraw();
    }
    // A board, river or brief tile in its own edit, comment or panel: every key is its, the desk's included.
    const held = this.panes.get(this.focus);
    if (held instanceof ScreenTile && held.holdsKeys() && k.kind !== "mouse") { held.key(k); return; }
    if (this.dragging && k.kind === "esc") { this.dragging = null; this.headPress = null; ctx.flash("not moved"); return this.redraw(); }
    if (this.linking && k.kind !== "mouse") return this.linkKey(k);
    // Esc while the person's own edit or comment is still opening cancels it, and does nothing else.
    if (k.kind === "esc" && this.pending?.pane === this.focusedReader()) { this.pending = null; ctx.flash("not opened"); return this.redraw(); }
    const focused = this.focusedReader();
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A step's status choice the person opened (PIE-472) takes their keys until they choose or cancel.
    if (focused?.surface.choosing && k.kind !== "mouse") { focused.key(k, this); return this.redraw(); }
    if (focused?.holdsKeys) {
      if (this.entered.in(focused)) {
        // The person is in it: every key is the edit's, comment's or panel's, window commands included,
        // until it's closed. The wheel still scrolls the pane under the pointer; a click can't move focus
        // off an open edit (esc leaves it), but passes with only the property panel open.
        if (k.kind !== "mouse") { focused.key(k, this); return; }
        if (focused.editing && k.action !== "wheel-up" && k.action !== "wheel-down") {
          if (k.action === "down" && this.clickIn(focused, k)) return this.redraw();
          if (k.action === "down") this.ctx.flash("finish the edit first · ctrl+s saves · esc closes");
          return;
        }
      } else if (k.kind !== "mouse" && !this.prefix) {
        // One they aren't in (an agent's, or theirs after moving away): e or ⏎ enters it, j k PgDn scroll,
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
      if (k.ch === "d") return this.cmd("layout.load", { name: "daily" });
      if (k.ch === "n" || k.ch === "p") return this.cmd("tab.select", { by: k.ch === "n" ? 1 : -1 }, this.nameOf(this.focus));
      if (k.ch === "m") return this.cmd("marks.next");
      if (k.ch === "x") return this.cmd("block.unmark", {}, this.nameOf(this.focus));
    }
    if (k.kind === "tab" || k.kind === "backtab") {
      const ids = this.zoom !== null ? [this.zoom] : shown(this.root).filter(id => !this.shut.has(id));
      const i = ids.indexOf(this.focus);
      return this.cmd("tile.focus", {}, this.nameOf(ids[(i + (k.kind === "tab" ? 1 : ids.length - 1)) % ids.length]!));
    }
    const pane = this.panes.get(this.focus);
    // A terminal tile the person isn't in: ⏎ or e starts typing in it (⏎ on one that exited runs it again).
    if (pane instanceof PtyPane && (k.kind === "enter" || c === "e")) {
      if (!pane.running && pane.exited !== null) { pane.restart(); return this.redraw(); }
      this.ptyIn = pane; ctx.flash(`typing in ${this.nameOf(this.focus)} · ${ESCAPE_CHORD} back to the door`); return this.redraw();
    }
    const readOnly = pane instanceof PreviewPane && pane.readOnly;
    const start = focused && !focused.holdsKeys && focused.msg && !readOnly ? sessionStart(k) : null;
    if (focused && start) return this.start(focused, start);
    if (!focused?.holdsKeys && !(pane instanceof PtyPane) && pane?.key(k, this)) return;
    if (k.kind === "char" && !k.ctrl) {
      if (k.ch === "/") { this.search = new SearchOverlay(); return this.redraw(); }
      if (k.ch === "V") return ctx.cycleVideo();
      if (/^[1-9]$/.test(k.ch) && this.numbered) { const id = leaves(this.root)[Number(k.ch) - 1]; if (id !== undefined) return this.cmd("tile.focus", {}, this.nameOf(id)); return; }
      if (k.ch === "q") { this.pending = null; return ctx.pop(); }
    }
    if (k.kind === "esc") {
      if (this.zoom !== null) return this.cmd("pane.zoom", { on: false }, String(this.numberOf(this.zoom)));
      if (this.over.has(this.focus) && !this.shut.has(this.focus)) return this.cmd("tile.drawer", { open: false }, this.nameOf(this.focus));
      this.pending = null; return ctx.pop();
    }
  }

  /** alt+l, then a key: h j k l (the tile that way), a tile's number, or esc. */
  private linkKey(k: Key) {
    const from = this.linking!.from;
    this.linking = null;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (k.kind === "esc") { this.ctx.flash("not linked"); return this.redraw(); }
    const to = MOVE[c] ? neighbour(this.rectsNow(), from, MOVE[c]!) : /^[1-9]$/.test(c) ? leaves(this.root)[Number(c) - 1] ?? null : null;
    if (to === null || to === undefined) { this.ctx.flash("not linked: alt+l, then click a tile, h j k l, or its number"); return this.redraw(); }
    this.cmd("tile.link", to === from ? {} : { to: this.nameOf(to) }, this.nameOf(from));
  }

  private command(k: Key) {
    const mode = this.prefix;
    this.prefix = "";
    const c = k.kind === "char" ? k.ch : k.kind === "left" ? "h" : k.kind === "right" ? "l" : k.kind === "up" ? "k" : k.kind === "down" ? "j" : "";
    const me = this.nameOf(this.focus);
    if (mode === "add" || mode === "addtab") {
      const kind = ADD[c];
      if (!kind) return this.redraw();
      const extra: Partial<NewTile> = kind === "pty" ? (c === "e" ? this.editorFor() : {}) : kind === "preview" || kind === "backlinks" ? { source: `tile:${me}` } : {};
      return this.cmd("tile.open", { kind, ...extra, where: mode === "addtab" ? "tabs" : "right" }, me);
    }
    if (mode === "move" || mode === "tab") {
      const dir = MOVE[c];
      if (!dir) return this.redraw();
      const n = neighbour(this.rectsNow(), this.focus, dir);
      if (mode === "tab") { if (n === null) { this.ctx.flash(`no tile ${dir} of ${me}`); return this.redraw(); } return this.cmd("layout.move", { to: this.nameOf(n), where: "tabs" }, me); }
      return this.cmd("layout.move", n === null ? { where: `edge-${dir}` } : { to: this.nameOf(n), where: dir }, me);
    }
    if (MOVE[c]) { const n = neighbour(this.rectsNow(), this.focus, MOVE[c]!); if (n !== null) return this.cmd("tile.focus", {}, this.nameOf(n)); return this.redraw(); }
    if (DOCK[c]) return this.cmd("layout.move", { where: `edge-${DOCK[c]}` }, me);
    if (c === "<" || c === ">") return this.cmd("pane.resize", { by: c === ">" ? 1 : -1, axis: "row" }, String(this.numberOf(this.focus)));
    if (c === "+" || c === "-") return this.cmd("pane.resize", { by: c === "+" ? 1 : -1, axis: "col" }, String(this.numberOf(this.focus)));
    if (c === "z") return this.cmd("pane.zoom", {}, String(this.numberOf(this.focus)));
    if (c === "x") { const why = this.closeRefused(this.focus, USER); if (why) { if (why.flash) this.ctx.flash(why.why); return this.redraw(); } return this.cmd("tile.close", {}, me); }
    if (c === "o") { this.prefix = "add"; return this.redraw(); }
    if (c === "O") { this.prefix = "addtab"; return this.redraw(); }
    if (c === "m") { this.prefix = "move"; return this.redraw(); }
    if (c === "t") { this.prefix = "tab"; return this.redraw(); }
    if (c === "T") { if (!tabsOf(this.root, this.focus)) { this.ctx.flash(`${me} isn't in a tab set`); return this.redraw(); } return this.cmd("layout.move", { to: me, where: "right" }, me); }
    if (c === "]" || c === "[") return this.cmd("tab.select", { by: c === "]" ? 1 : -1 }, me);
    if (c === "v") return this.cmd("tile.preview", {}, me);
    if (c === "p") return this.cmd("tile.pin", {}, me);
    if (c === "d") {
      const shutOne = [...this.shut].at(-1);
      if (this.over.has(this.focus) && !this.shut.has(this.focus)) return this.cmd("tile.drawer", { open: false }, me);
      if (shutOne !== undefined) return this.cmd("tile.drawer", { open: true }, this.nameOf(shutOne));
      this.ctx.flash("no drawers · ^W p makes this tile one"); return this.redraw();
    }
    if (c === "r") { this.picker = new LayoutPicker("load", layoutNames()); return this.redraw(); }
    if (c === "w") { this.picker = new LayoutPicker("save", layoutNames(), this.layoutName ?? ""); return this.redraw(); }
    if (c === "=") return this.cmd("layout.even");
    if (c === "s") {
      const ids = leaves(this.root), i = ids.indexOf(this.focus), j = ids[(i + 1) % ids.length]!;
      return j !== this.focus ? this.cmd("layout.swap", { to: this.nameOf(j) }, me) : this.redraw();
    }
    this.redraw();
  }

  /** The person's editor on the daily scratch draft (^W o e). */
  private editorFor(): Partial<NewTile> { const f = dailyDraft(); return { cmd: [...words(editor()), f].join(" "), file: f, name: "editor" }; }

  /** Run an action by name as the person (the layout picker's ⏎). */
  run(name: string, args: Record<string, unknown>, reader?: string) { this.cmd(name, args, reader); }
  closePicker() { this.picker = null; }

  // ── tile operations (TILE_ACTIONS): the keys, the mouse and `act` all come here ──

  /** A tile by name, number (as `peek` shows it) or "focused"; none named: the focused one. */
  private tileNamed(sel: string | undefined, refuse = true): { name: string; id: number } | null {
    const ids = leaves(this.root);
    if (!sel || sel === "focused") return { name: this.nameOf(this.focus), id: this.focus };
    const byName = this.idNamed(sel);
    if (byName !== undefined) return { name: sel, id: byName };
    const id = /^[1-9][0-9]*$/.test(sel) ? ids[Number(sel) - 1] : undefined;
    if (id !== undefined) return { name: this.nameOf(id), id };
    if (!refuse) return null;
    throw new ActionRefused(`no tile ${sel}; tiles: ${ids.map(i => `${this.numberOf(i)} ${this.nameOf(i)}`).join(", ")}, or focused`);
  }
  private tile(sel: string | undefined) { return this.tileNamed(sel)!; }

  /**
   * Where each tile is right now, placed from the tree as it is (not as last painted: paints are coalesced, and
   * a key that follows a change within a frame must see the change).
   */
  private rectsNow(): Map<number, Rect> {
    if (this.zoom !== null && this.panes.has(this.zoom)) return new Map([[this.zoom, this.area]]);
    const ps = placeScreen({ root: this.root, over: this.over, floats: [] }, this.area);
    const out = new Map(ps.rects);
    for (const [id, o] of ps.over) if (!this.shut.has(id)) out.set(id, o.rect);
    return out;
  }

  /** The tiles that move, pin and slide as one with `id`: its tab set, or itself. */
  private setOf(id: number): number[] { return tabsOf(this.root, id)?.ids ?? [id]; }

  /**
   * The one rule for agents and the person's keys: an agent's action moves the person's focus only when they
   * aren't typing (an edit, a comment, the property panel, a terminal, a screen tile's own edit, a picker).
   * Every agent path that would move the focus, or take away the tile that has it, asks this first.
   */
  private mayMoveKeys(actor: Actor, what: string) {
    if (actor.kind === "agent" && this.personTyping()) throw new ActionRefused(`the person is typing; an agent doesn't ${what} (block.mark gets their attention)`);
  }

  /** What an agent may not do to the tile the person is typing in: close it, move it. */
  private guard(id: number, actor: Actor, what: string) {
    if (actor.kind !== "agent" || id !== this.focus) return;
    if (this.inPty() || this.personIn()) throw new ActionRefused(`${this.nameOf(id)} is where the person is typing; an agent doesn't ${what} it`);
  }

  moveTile(sel: string | undefined, to: string | undefined, where: Where, index: number | undefined, actor: Actor): TileDone {
    const src = this.tile(sel);
    this.guard(src.id, actor, "move");
    let place: Place<number>;
    if (where.startsWith("edge-")) place = { kind: "edge", dir: where.slice(5) as Dir };
    else {
      if (!to) throw new ActionRefused(`layout.move: to=<tile> names the tile it goes ${where === "tabs" ? "into" : "beside"}`);
      const t = this.tile(to);
      place = where === "tabs" ? { kind: "tabs", target: t.id, index } : { kind: "split", target: t.id, dir: where as Dir };
    }
    const next = move(this.root, src.id, place);
    if (!next) throw new ActionRefused(`${src.name} can't go there: ${leaves(this.root).length < 2 ? "it's the only tile" : "that's where it is"}`);
    this.root = next;
    // A drawer dropped somewhere is pinned there; dropped into a drawer's tabs, it's part of that drawer.
    this.over.delete(src.id); this.shut.delete(src.id);
    if (place.kind === "tabs" && this.over.has(place.target)) { this.over.add(src.id); if (this.shut.has(place.target)) this.shut.add(src.id); }
    const wasShown = shown(this.root);
    activate(this.root, src.id);
    // An agent's move into the tabs the person has open leaves their tab shown.
    if (actor.kind === "agent" && wasShown.includes(this.focus) && !shown(this.root).includes(this.focus)) activate(this.root, this.focus);
    this.zoom = null;
    if (actor.kind !== "agent") this.focus = src.id;
    this.save(); this.redraw();
    return { tile: src.name, where, ...(to ? { to } : {}), tree: describeTree(this.root, id => this.nameOf(id)) };
  }

  async openTile(t: NewTile, at: string | undefined, where: Where, actor: Actor): Promise<TileDone> {
    if (!(TILE_KINDS as readonly string[]).includes(t.kind)) throw new ActionRefused(`tile.open: kind is ${TILE_KINDS.join(", ")}, not ${t.kind}`);
    if (t.kind === "preview" && t.source && !/^(tile|file):./.test(t.source)) throw new ActionRefused("tile.open: a preview's source is tile:<name> or file:<path>");
    if (t.kind === "backlinks" && t.source && !/^tile:./.test(t.source)) throw new ActionRefused("tile.open: a backlinks tile's source is tile:<name>");
    if (t.kind === "preview" && t.file && !t.source) t.source = `file:${t.file}`;
    if (t.name && this.idNamed(t.name) !== undefined) throw new ActionRefused(`there's already a tile named ${t.name}`);
    const base = this.tile(at);
    const spec: TileSpec = { t: "leaf", kind: t.kind, name: t.name, ...(t.cmd ? { cmd: splitWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.note ? { note: t.note } : {}), ...(t.page ? { page: t.page } : {}), ...(t.cwd ? { cwd: t.cwd } : {}) };
    if ((t.kind === "preview" || t.kind === "backlinks") && !t.source) spec.source = `tile:${base.name}`;
    const id = this.put(makeTile(spec), t.name);
    const wasShown = shown(this.root);
    this.root = where === "tabs" ? tabInto(this.root, base.id, id) : where.startsWith("edge-") ? edge(this.root, id, where.slice(5) as Dir) : besideSlot(this.root, base.id, leaf(id), where as Dir);
    this.root = normalise(this.root);
    // An agent's new tab is added without being shown over the tab the person has there.
    if (actor.kind === "agent" && wasShown.includes(this.focus) && !shown(this.root).includes(this.focus)) activate(this.root, this.focus);
    this.zoom = null;
    this.startTile(id);
    if (actor.kind !== "agent") this.focus = id;
    this.save(); this.redraw();
    return { tile: this.nameOf(id), kind: t.kind, n: this.numberOf(id), beside: base.name, where };
  }

  closeTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const why = this.closeRefused(t.id, actor);
    if (why) throw new ActionRefused(why.why);
    // Closing a tile with a program running ends the program: the person is asked twice, as quitting does.
    const pty = this.panes.get(t.id);
    if (pty instanceof PtyPane && pty.running) {
      const armed = this.closeArm && this.closeArm.id === t.id && Date.now() - this.closeArm.at < 3000;
      if (!armed) { this.closeArm = { id: t.id, at: Date.now() }; throw new ActionRefused(`${t.name} is running ${pty.title()} · closing ends it · ^W x again within 3s closes`); }
      this.closeArm = null;
    }
    const kind = this.panes.get(t.id)!.kind;
    this.closeId(t.id);
    this.save(); this.redraw();
    return { tile: t.name, kind };
  }

  linkTile(sel: string | undefined, to: string | undefined, _actor: Actor): TileDone {
    const src = this.tile(sel);
    if (!to) { this.links.delete(src.id); this.save(); this.redraw(); return { tile: src.name, link: null }; }
    const dst = this.tile(to);
    if (dst.id === src.id) throw new ActionRefused(`${src.name} can't open into itself · leave to= out to unlink`);
    const p = this.panes.get(dst.id);
    if (!(p instanceof ReaderPane)) throw new ActionRefused(`${dst.name} is a ${p?.kind} tile: opens land in a reader, a detail or a preview`);
    this.links.set(src.id, dst.id);
    this.save(); this.redraw();
    return { tile: src.name, link: dst.name };
  }

  selectTab(sel: string | undefined, by: number | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const set = tabsOf(this.root, t.id);
    if (!set) throw new ActionRefused(`${t.name} isn't in a tab set`);
    const hadFocus = set.ids.includes(this.focus);
    const before = set.active;
    const showing = by ? set.ids[(set.active + by + set.ids.length) % set.ids.length]! : t.id;
    // An agent never hides the tab the person has.
    if (actor.kind === "agent" && hadFocus && showing !== this.focus) throw new ActionRefused(`${this.nameOf(this.focus)} is the tab the person has; an agent doesn't hide it`);
    if (by) cycle(this.root, t.id, by as 1 | -1); else activate(this.root, t.id);
    void before;
    // The person's click or key moves their keys with the tab.
    if (actor.kind !== "agent" && hadFocus) this.focus = showing;
    this.save(); this.redraw();
    return { tile: this.nameOf(showing), tabs: set.ids.map(x => this.nameOf(x)) };
  }

  focusTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    if (t.id !== this.focus) this.mayMoveKeys(actor, "move their keys");
    const moved = t.id !== this.focus;
    if (moved) this.entered.clear();
    this.focus = t.id;
    if (moved) this.panes.get(t.id)?.focused?.(this, actor);
    activate(this.root, t.id);
    if (this.over.has(t.id)) this.shut.delete(t.id);
    this.zoom = this.zoom !== null ? t.id : null;
    this.save(); this.redraw();
    return { tile: t.name };
  }

  pinTile(sel: string | undefined, on: boolean | undefined, _actor: Actor): TileDone {
    const t = this.tile(sel);
    const pinned = !this.over.has(t.id);
    const want = on ?? !pinned;
    if (want === pinned) return { tile: t.name, pinned, changed: false };
    // A tab set slides over, or pins, as one.
    const set = this.setOf(t.id);
    if (!want) {
      if (shown(this.root).filter(id => !set.includes(id)).length < 1) throw new ActionRefused(`${t.name} is the only tile; there's nothing for it to slide over`);
      for (const id of set) this.over.add(id);
    } else for (const id of set) { this.over.delete(id); this.shut.delete(id); }
    this.save(); this.redraw();
    return { tile: t.name, pinned: want };
  }

  drawerTile(sel: string | undefined, open: boolean | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    if (!this.over.has(t.id)) throw new ActionRefused(`${t.name} is pinned in the layout · tile.pin on=false makes it a drawer`);
    const want = open ?? this.shut.has(t.id);
    // Shutting the drawer that has the person's keys moves them: the same rule as any move of the keys.
    const set = this.setOf(t.id);
    if (!want && set.includes(this.focus)) this.mayMoveKeys(actor, "shut the drawer they have");
    if (want) { for (const id of set) this.shut.delete(id); if (actor.kind !== "agent" && !this.personTyping()) this.focus = shown(this.root).find(id => set.includes(id)) ?? t.id; }
    else { for (const id of set) this.shut.add(id); if (set.includes(this.focus)) this.focus = shown(this.root).find(id => !this.over.has(id)) ?? this.focus; }
    this.save(); this.redraw();
    return { tile: t.name, open: want };
  }

  async previewTile(sel: string | undefined, where: Where, actor: Actor): Promise<TileDone> {
    const t = this.tile(sel);
    const p = this.panes.get(t.id);
    let source: string;
    if (p instanceof PtyPane) {
      if (!p.file) throw new ActionRefused(`${t.name} runs ${p.run.cmd[0]} on no file; a preview follows the file an editor tile was opened on`);
      // nvim tells the door which buffer it's on, so the preview follows the tile; another editor, the file.
      source = p.isNvim ? `tile:${t.name}` : `file:${p.file}`;
    } else if (p instanceof ScreenTile && p.kind === "board") {
      source = `tile:${t.name}`;
      // The board's own preview strip gives its place to the tile (collapsed to a spine, as its `c` does).
      await p.ownPreview(false, actor);
    } else source = `tile:${t.name}`;
    return this.openTile({ kind: "preview", source, name: this.autoName(`${t.name}-preview`) }, t.name, where, actor);
  }

  typeTile(sel: string | undefined, text: string, actor: Actor): TileDone {
    const t = this.tile(sel);
    const p = this.panes.get(t.id);
    if (!(p instanceof PtyPane)) throw new ActionRefused(`${t.name} isn't a terminal tile`);
    if (!p.running) throw new ActionRefused(`${t.name}'s program isn't running · tile.restart runs it again`);
    if (actor.kind === "agent" && this.ptyIn === p && this.focus === t.id) throw new ActionRefused(`the person is typing in ${t.name}; an agent doesn't type there (an nvim tile's socket edits other lines without their cursor)`);
    p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
    return { tile: t.name, chars: text.length };
  }

  restartTile(sel: string | undefined, _actor: Actor): TileDone {
    const t = this.tile(sel);
    const p = this.panes.get(t.id);
    if (!(p instanceof PtyPane)) throw new ActionRefused(`${t.name} isn't a terminal tile`);
    if (p.running) throw new ActionRefused(`${t.name} is still running`);
    p.restart();
    return { tile: t.name };
  }

  tileInfo(sel: string | undefined): unknown { const t = this.tile(sel); return this.tileView(t.id); }

  saveLayout(name: string, _actor: Actor) {
    if (!/^[\w.-]{1,40}$/.test(name)) throw new ActionRefused("a layout's name is 1-40 letters, digits, . - _");
    if (this.preset) throw new ActionRefused(`the ${this.title} keeps its own layout; save one on the desk (D)`);
    saveLayout(name, this.layoutSpec());
    this.layoutName = name;
    this.save();
    return { layout: name, tiles: leaves(this.root).map(id => this.nameOf(id)) };
  }

  loadLayout(name: string, actor: Actor) {
    const found = layoutNamed(name);
    if (!found) throw new ActionRefused(`no layout ${name}; layouts: ${layoutNames().map(l => l.name).join(", ")}`);
    this.mayMoveKeys(actor, "lay the desk out under them");
    if (this.preset) throw new ActionRefused(`the ${this.title} keeps its own layout; load one on the desk (D)`);
    this.entered.clear();
    this.ptyIn = null;
    this.build(found.spec, true);
    this.layoutName = name;
    this.save(); this.redraw();
    return { layout: name, saved: found.saved, rule: this.rule, tiles: leaves(this.root).map(id => this.nameOf(id)) };
  }

  layouts() { return { current: this.layoutName, layouts: layoutNames() }; }
  layoutGet() {
    return { layout: this.layoutName, rule: this.rule, focus: this.nameOf(this.focus), zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, tree: describeTree(this.root, id => this.nameOf(id)), tiles: leaves(this.root).map(id => this.tileView(id)) };
  }

  /** Ctrl+E in a reader (PIE-417): the editor runs in a terminal tile beside it, not over the whole door. */
  editInTile(path: string, cmd: string, done: (code: number | null) => void): boolean {
    const at = this.focus;
    if (!this.panes.has(at)) return false;
    const pane = makeTile({ kind: "pty", cmd: [...words(cmd), path], file: path, name: "edit" }) as PtyPane;
    pane.run.temp = true;
    const id = this.put(pane, this.autoName("edit"));
    this.root = normalise(besideSlot(this.root, at, leaf(id), "right"));
    this.startTile(id);
    pane.onExit = code => {
      done(code);
      if (this.panes.has(id)) { this.closeId(id); if (this.panes.has(at)) this.focus = at; }
      this.save(); this.redraw();
    };
    this.focus = id; this.ptyIn = pane; this.zoom = null;
    this.redraw();
    return true;
  }

  // ── what the person sees, for agents: layout.get, view.get, view.subscribe (App diffs viewState) ──

  /** The split at `path` ("" the root, "1.0" its second kid's first kid), if there is one. */
  private splitAt(path: string): LNode | null {
    let n: LNode = this.root;
    for (const p of path.split(".").filter(Boolean)) { if (n.t !== "split") return null; const k = n.kids[Number(p)]; if (!k) return null; n = k; }
    return n.t === "split" ? n : null;
  }
  /** The tree with each split's path (layout.resize names a border by it) and each tile by name. */
  private shapeOf(n: LNode = this.root, path = ""): unknown {
    if (n.t === "leaf") return { tile: this.nameOf(n.id) };
    if (n.t === "tabs") return { tabs: n.ids.map(id => this.nameOf(id)), shown: this.nameOf(n.ids[n.active]!) };
    const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
    return { split: n.dir, path, shares: n.weights.map(w => Math.round((w / sum) * 1000) / 1000), kids: n.kids.map((k, i) => this.shapeOf(k, path ? `${path}.${i}` : String(i))) };
  }
  /** The layout's shape: what changes only when the layout does (not with what a tile shows). */
  private layoutShape() {
    return {
      name: this.layoutName, rule: this.rule, zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, tree: this.shapeOf(),
      tiles: leaves(this.root).map(id => {
        const p = this.panes.get(id)!, link = this.links.get(id), set = tabsOf(this.root, id);
        return {
          tile: this.nameOf(id), kind: p.kind, rect: this.hits.find(([x]) => x === id)?.[1] ?? null,
          ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : {}),
          ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), shown: set.ids[set.active] === id } : {}),
          ...(this.over.has(id) ? { drawer: this.shut.has(id) ? "shut" : "open" } : { pinned: true }),
          ...(p instanceof PreviewPane ? { source: sourceName(p.source) } : {}),
          ...(p instanceof BacklinksPane ? { source: `tile:${p.source}` } : {}),
          ...(p instanceof PtyPane ? { cmd: p.run.cmd, ...(p.socket ? { nvim: p.socket } : {}) } : {}),
        };
      }),
    };
  }

  /** One tile's view: what's in it, and where. */
  private viewOf(id: number): { viewport: unknown; cursor?: unknown } {
    const p = this.panes.get(id)!;
    const visible = shown(this.root).includes(id) && !this.shut.has(id) && this.hits.some(([x]) => x === id);
    if (p instanceof ReaderPane) {
      const m = p.msg;
      const sel = p.surface.selection;
      return { viewport: { visible, block: m?.id ?? null, title: m ? subject(m) : null, ...(p.surface.viewport() ?? {}) }, cursor: sel ? { selection: p.surface.describeSelection(sel) } : null };
    }
    if (p instanceof PtyPane) {
      const nv = p.nvim?.view;
      const mine = id === this.focus;
      return {
        viewport: { visible, file: p.file ?? null, running: p.running, ...(nv ? { first: nv.top, last: nv.bottom } : {}) },
        // Only the focused terminal's cursor: another tile's (claude redrawing) would be noise in the feed.
        ...(mine ? { cursor: nv ? { file: nv.file, line: nv.line, col: nv.col, mode: nv.mode } : p.running ? { screen: p.cursor() } : null } : {}),
      };
    }
    if (p instanceof TreePane) { const m = p.selected(); return { viewport: { visible, selected: m?.id ?? null, title: m ? subject(m) : null } }; }
    if (p instanceof ScreenTile) { const m = p.current(); return { viewport: { visible, screen: p.screen?.title ?? null, selected: m?.id ?? null } }; }
    return { viewport: { visible, title: p.title() } };
  }

  /** What `view.subscribe` publishes (App diffs it after each paint). */
  viewState(): ViewState {
    const f = this.panes.get(this.focus);
    return {
      focus: { tile: this.nameOf(this.focus), block: f instanceof ReaderPane ? f.msg?.id ?? null : f instanceof TreePane ? f.selected()?.id ?? null : f instanceof ScreenTile ? f.current()?.id ?? null : null, ...(f instanceof PtyPane ? { file: f.file ?? null, typing: this.inPty() } : {}) },
      layout: this.layoutShape(),
      tiles: leaves(this.root).map(id => ({ tile: this.nameOf(id), ...this.viewOf(id) })),
      marks: this.markList(),
    };
  }

  viewGet(sel: string | undefined): unknown {
    if (sel) { const t = this.tile(sel); return { tile: t.name, ...this.viewOf(t.id), ...(this.panes.get(t.id) instanceof PtyPane ? { screen: (this.panes.get(t.id) as PtyPane).text() } : {}) }; }
    return { focus: this.viewState().focus, tiles: leaves(this.root).map(id => ({ tile: this.nameOf(id), ...this.viewOf(id) })) };
  }

  scrollTo(sel: string | undefined, at: { line?: number; text?: string; block?: string }, actor: Actor): TileDone {
    const t = this.tile(sel);
    const p = this.panes.get(t.id);
    if (!(p instanceof ReaderPane)) throw new ActionRefused(`${t.name} is a ${p?.kind} tile: view.scrollTo scrolls a reader (an nvim tile's view is the person's own; block.mark line=… points at a line)`);
    if (!p.msg) throw new ActionRefused(`${t.name} shows no note yet`);
    if (at.block && !p.msg.id.startsWith(at.block)) throw new ActionRefused(`${t.name} shows ${p.msg.id.slice(0, 8)}, not ${at.block}; open it there first (open id=${at.block} reader=${t.name})`);
    if (actor.kind === "agent" && p.editing && t.id === this.focus) throw new ActionRefused(`${t.name} holds the person's edit; an agent doesn't scroll it`);
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
    return this.marksStore.list().map(m => ({ ...m, showing: m.block ? leaves(this.root).filter(id => this.showsBlock(id, m.block!)).map(id => this.nameOf(id)) : m.tile ? [m.tile] : [] }));
  }
  private showsBlock(id: number, block: string): boolean {
    const p = this.panes.get(id);
    return p instanceof ReaderPane ? p.msg?.id === block : p instanceof ScreenTile ? p.current()?.id === block : false;
  }
  /** The marks drawn on a tile: on the note it shows, or on lines of what it edits. */
  private marksOn(id: number): Mark[] {
    const name = this.nameOf(id);
    return this.marksStore.list().filter(m => (m.block ? this.showsBlock(id, m.block) : m.tile === name));
  }

  async markBlock(sel: string | undefined, m: { id?: string; line?: number; reason: string }, actor: Actor): Promise<unknown> {
    const by = actor.kind === "agent" ? actor.id : "you";
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
      block = p instanceof ReaderPane ? p.msg?.id : p instanceof ScreenTile ? p.current()?.id : undefined;
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
    this.mayMoveKeys(actor, "move their keys to a mark");
    this.markAt = (this.markAt + 1) % all.length;
    const m = all[this.markAt]!;
    const there = m.block ? leaves(this.root).find(id => this.showsBlock(id, m.block!)) : m.tile ? this.idNamed(m.tile) : undefined;
    if (there !== undefined) { this.focusTile(this.nameOf(there), actor); return { tile: this.nameOf(there), mark: m.n }; }
    if (m.block) {
      // Nowhere on screen: it opens where the focused tile's opens go (its link), else as the current note.
      void this.ctx.board.get(m.block).then(msg => { if (msg) this.setCurrent(msg, { from: this.panes.get(this.focus), link: true, reveal: true, agent: actor.kind === "agent" }); }, () => {});
    }
    return { tile: this.nameOf(this.focus), mark: m.n };
  }
  private markAt = -1;
  private closeArm: { id: number; at: number } | null = null;

  // ── borders, evening out, swapping: actions too (a drag of a border ends in layout.resize) ──

  resizeBorder(path: string, border: number, share: number, _actor: Actor) {
    const n = this.splitAt(path);
    if (!n || n.t !== "split") throw new ActionRefused(`no split at path ${JSON.stringify(path)}; layout.get gives each split's path`);
    if (!Number.isInteger(border) || border < 0 || border >= n.kids.length - 1) throw new ActionRefused(`the split at ${JSON.stringify(path)} has borders 0-${n.kids.length - 2}`);
    const f = Math.max(0.08, Math.min(0.92, share));
    const sum = n.weights[border]! + n.weights[border + 1]!;
    n.weights[border] = sum * f; n.weights[border + 1] = sum - n.weights[border]!;
    // During a border drag, desk.json is written once, on release.
    if (!this.drag) this.save();
    this.redraw();
    return { split: path, border, share: Math.round(f * 1000) / 1000 };
  }

  evenOut(_actor: Actor) { even(this.root); this.save(); this.redraw(); return { even: true as const }; }

  swapTile(sel: string | undefined, to: string, actor: Actor): TileDone {
    const a = this.tile(sel), b = this.tile(to);
    if (a.id === b.id) throw new ActionRefused("a tile can't swap with itself");
    this.guard(a.id, actor, "move"); this.guard(b.id, actor, "move");
    this.root = swap(this.root, a.id, b.id);
    this.save(); this.redraw();
    return { tile: a.name, with: b.name };
  }

  /** The path of a split in the tree (for a dragged border's layout.resize). */
  private pathOf(target: LNode, n: LNode = this.root, path = ""): string | null {
    if (n === target) return path;
    if (n.t !== "split") return null;
    for (let i = 0; i < n.kids.length; i++) { const p = this.pathOf(target, n.kids[i]!, path ? `${path}.${i}` : String(i)); if (p !== null) return p; }
    return null;
  }

  // ── pane operations (PANE_ACTIONS): the older names, the same tiles ──

  /** A pane by its number on screen (the one `peek` shows), its name, or the focused one. */
  private paneNamed(sel?: string): { name: string; id: number } {
    const t = this.tileNamed(sel, false);
    if (t) return { name: String(this.numberOf(t.id)), id: t.id };
    const ids = leaves(this.root);
    throw new ActionRefused(`no pane ${sel} on the desk; panes: ${ids.map((_, i) => i + 1).join(", ")} or focused`);
  }

  /** Why a pane can't close: it holds an edit or a comment, it's the last one, or it has the person's keys and an agent asks. */
  private closeRefused(id: number, actor: Actor): { why: string; flash: boolean } | null {
    const p = this.panes.get(id);
    const n = leaves(this.root).indexOf(id) + 1;
    if (p instanceof ReaderPane && p.editing) return { why: `not closed: it holds ${sessionName(p)} · e or ⏎ enters it`, flash: true };
    if (leaves(this.root).length <= 1) return { why: "the desk's last pane stays", flash: false };
    if (actor.kind === "agent" && id === this.focus) return { why: `pane ${n} has the person's keys; an agent doesn't close it`, flash: false };
    if (actor.kind === "agent" && p instanceof PtyPane && p.running) return { why: `${this.nameOf(id)} is running ${p.run.cmd[0]}; an agent doesn't end it`, flash: false };
    return null;
  }

  private closeId(id: number) {
    const next = remove(this.root, id);
    if (!next) return;
    const p = this.panes.get(id);
    p?.dispose?.();
    if (this.ptyIn === p) this.ptyIn = null;
    this.panes.delete(id); this.root = normalise(next);
    this.names.delete(id); this.over.delete(id); this.shut.delete(id); this.links.delete(id);
    for (const [from, to] of this.links) if (to === id) this.links.delete(from);
    if (this.focus === id) this.focus = shown(this.root)[0] ?? leaves(this.root)[0]!;
    if (this.zoom === id || !this.panes.has(this.zoom ?? -1)) this.zoom = null;
  }

  // pane.split and pane.close are the older names of tile.open and tile.close: one code path, one rule.
  async splitPane(sel: string | undefined, kind: string | undefined, dir: Axis | undefined, actor: Actor): Promise<PaneDone> {
    const at = this.paneNamed(sel);
    const r = this.placed.rects.get(at.id) ?? { col: 0, row: 0, cols: 80, rows: 24 };
    const where: Where = dir === "col" ? "down" : dir === "row" ? "right" : r.cols >= r.rows * 2.2 ? "right" : "down";
    const t = await this.openTile({ kind: (kind ?? "reader") as PaneKind }, String(this.numberOf(at.id)), where, actor);
    return { pane: String(t.n), kind: t.kind, beside: at.name, tile: t.tile };
  }

  closePane(sel: string | undefined, actor: Actor): PaneDone {
    const p = this.paneNamed(sel);
    const r = this.closeTile(String(this.numberOf(p.id)), actor);
    return { pane: sel && /^[1-9][0-9]*$/.test(sel) ? sel : p.name, kind: r.kind };
  }

  resizePane(sel: string | undefined, axis: Axis, by: number, _actor: Actor): PaneDone {
    const p = this.paneNamed(sel);
    if (!resize(this.root, p.id, axis, 0.05 * by)) throw new ActionRefused(`pane ${p.name} has no border ${axis === "row" ? "beside it" : "above or below it"} to move`);
    this.save(); this.redraw();
    return { pane: p.name, axis, by };
  }

  zoomPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone {
    const p = this.paneNamed(sel);
    const want = on ?? this.zoom !== p.id;
    // Zooming another pane would hide the one with the person's keys.
    if (actor.kind === "agent" && want && p.id !== this.focus) throw new ActionRefused(`zooming pane ${p.name} would hide pane ${leaves(this.root).indexOf(this.focus) + 1}, which has the person's keys`);
    if (!want) this.zoom = null;
    else { this.zoom = p.id; if (actor.kind !== "agent") this.focus = p.id; }
    this.redraw();
    return { pane: p.name, zoomed: this.zoom === p.id };
  }

  floatPane(): PaneDone { throw new ActionRefused("the desk has no floats yet; a tile slides over as a drawer instead (tile.pin on=false)"); }
  pinPane(sel: string | undefined, on: boolean | undefined, actor: Actor): PaneDone {
    const r = this.pinTile(sel, on, actor);
    return { ...r, pane: r.tile };
  }

  /** A click inside the reader the person is editing in: the surface's (a completion candidate), or false. */
  private clickIn(pane: ReaderPane, k: Extract<Key, { kind: "mouse" }>): boolean {
    const hit = this.hits.find(([id]) => this.panes.get(id) === pane)?.[1];
    return !!hit && k.x > hit.col && k.y > hit.row && k.x < hit.col + hit.cols - 1 && k.y < hit.row + hit.rows - 1
      && pane.click(k.x - hit.col - 1, k.y - hit.row - 1, this);
  }

  /** The tiles as the drag sees them: each shown tile's frame, and a tab set's tab labels. */
  private dropTiles(): DropTile<number>[] {
    return this.hits.map(([id, rect]) => {
      const set = tabsOf(this.root, id);
      return { id, rect, ...(set && set.ids.length > 1 ? { tabs: this.heads.filter(h => h.row === rect.row && set.ids.includes(h.id) && h.from >= rect.col && h.to <= rect.col + rect.cols).map(h => ({ id: h.id, from: h.from, to: h.to })) } : {}) };
    });
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const p = this.pressed;
    if (k.action === "up") {
      if (this.drag) { this.drag = null; this.save(); }
      const d = this.dragging, h = this.headPress;
      this.dragging = null; this.headPress = null;
      if (d?.drop) {
        const drop = d.drop;
        this.cmd("layout.move", drop.kind === "edge" ? { where: `edge-${drop.dir}` } : drop.kind === "tabs" ? { to: this.nameOf(drop.target), where: "tabs", ...(drop.index !== undefined ? { index: drop.index } : {}) } : { to: this.nameOf(drop.target), where: drop.dir }, this.nameOf(d.src));
      } else if (d) { this.ctx.flash("not moved: dropped where it was"); this.redraw(); }
      else if (h) this.redraw();
      if (this.mouseTile) { const m = this.mouseTile; this.mouseTile = null; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col - 1, k.y - m.r.row - 1, this); }
      if (p) { this.pressed = null; p.pane.release(k.x - p.col, k.y - p.row, this, p.fresh ? (m, how) => this.setCurrent(m, { ...how, from: p.pane, fresh: true, reveal: true }) : undefined); this.redraw(); }
      return;
    }
    if (k.action === "drag") {
      // A border follows the pointer by layout.resize (the same action an agent calls).
      if (this.drag) { const g = this.drag, path = this.pathOf(g.d.node as LNode), f = dragShare(g, k.x, k.y); if (path !== null && f !== null) this.cmd("layout.resize", { path, border: g.d.i, share: f }); return; }
      if (this.headPress) {
        const h = this.headPress;
        if (!this.dragging && Math.abs(k.x - h.x) + Math.abs(k.y - h.y) < 1) return;
        this.dragging = { src: h.id, drop: dropAt(this.dropTiles(), this.area, k.x, k.y, h.id, leaves(this.root).length > 1), x: k.x, y: k.y };
        return this.redraw();
      }
      if (this.mouseTile) { const m = this.mouseTile; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col - 1, k.y - m.r.row - 1, this); return; }
      if (p) return p.pane.drag(k.x - p.col, k.y - p.row, this);
      return;
    }
    const hit = this.hits.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
    if (k.action === "down") {
      // A shut drawer's handle, at the end of the hint row.
      if (k.y === this.area.row + this.area.rows) {
        const h = this.handles.find(h => k.x >= h.from && k.x < h.to);
        if (h) this.cmd("tile.drawer", { open: true }, this.nameOf(h.id));
        return;
      }
      if (this.linking) {
        const from = this.linking.from;
        this.linking = null;
        if (!hit) { this.ctx.flash("not linked"); return this.redraw(); }
        return this.cmd("tile.link", hit[0] === from ? {} : { to: this.nameOf(hit[0]) }, this.nameOf(from));
      }
      // A border: a drawer's own over it, else the layout's (not one hidden under a drawer). The header row is the header's.
      const inDrawer = !!hit && this.over.has(hit[0]);
      const borders = inDrawer ? this.dividers.filter(x => x.node.kids.some(kk => kk.t === "leaf" && kk.id === hit![0])) : this.dividers;
      const onHeader = !!hit && k.y === hit[1].row && k.x > hit[1].col && k.x < hit[1].col + hit[1].cols - 1;
      const d = this.zoom === null && !onHeader ? dividerAt(borders, k.x, k.y) : null;
      if (d) { this.drag = d; return; }
      if (!hit) return;
      const [id, r] = hit;
      // A click elsewhere lets go of a reader's selected text.
      for (const [pid, pane] of this.panes) if (pid !== id && pane instanceof ReaderPane) pane.surface.selection = null;
      // A mark's label in a header: a click dismisses the mark.
      const mh = this.markHits.find(h => h.row === k.y && k.x >= h.from && k.x < h.to);
      if (mh) return this.cmd("block.unmark", { n: mh.n });
      if (k.y === r.row) {
        // The header: a tab's label shows it; pressing anywhere on it can start a drag (the tab under the pointer, or the tile).
        const tab = this.heads.find(h => h.row === r.row && k.x >= h.from && k.x < h.to);
        const set = tabsOf(this.root, id);
        const grab = tab && set?.ids.includes(tab.id) ? tab.id : id;
        this.headPress = { id: grab, x: k.x, y: k.y };
        if (grab !== id) this.cmd("tab.select", {}, this.nameOf(grab));
        else if (id !== this.focus) this.cmd("tile.focus", {}, this.nameOf(id));
        return this.redraw();
      }
      if (id !== this.focus) this.cmd("tile.focus", {}, this.nameOf(id));
      // Inside the frame only: its border (and the scroll thumb drawn on it) isn't the pane's.
      if (k.x > r.col && k.y > r.row && k.x < r.col + r.cols - 1 && k.y < r.row + r.rows - 1) {
        const pane = this.panes.get(id);
        const x = k.x - r.col - 1, y = k.y - r.row - 1;
        if (pane instanceof PtyPane) {
          // A click in a terminal starts typing in it; the program gets the click when it asked for the mouse.
          if (pane.running) this.ptyIn = pane;
          if (pane.wantsMouse()) { this.mouseTile = { id, r }; pane.mouse(k, x, y); }
        } else if (pane?.mouse) { this.mouseTile = { id, r }; pane.mouse(k, x, y, this); }
        // A reader decides on release: a click, or a drag that selected text (PIE-419). A ctrl- or alt-click opens beside (PIE-473).
        else if (pane instanceof ReaderPane) { this.pressed = { pane, col: r.col + 1, row: r.row + 1, fresh: !!((k.mods ?? 0) & 24) }; pane.press(x, y, this); }
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

const overlaps = (p: Placement, r: Rect) => p.col < r.col + r.cols && p.col + p.cols > r.col && p.row < r.row + r.rows && p.row + p.rows > r.row;
/** A drop as `peek` says it: where the dragged tile would go. */
const dropView = (d: Drop<number>, name: (id: number) => string) => ({ kind: d.kind, ...("target" in d ? { target: name(d.target) } : {}), ...("dir" in d ? { dir: d.dir } : {}), ...(d.kind === "tabs" && d.index !== undefined ? { index: d.index } : {}), label: d.label, ghost: d.ghost });
/** Two tiles trade places in the tree (^W s). */
function swap(n: LNode, a: number, b: number): LNode {
  if (n.t === "leaf") return n.id === a ? leaf(b) : n.id === b ? leaf(a) : n;
  if (n.t === "tabs") return { ...n, ids: n.ids.map(x => (x === a ? b : x === b ? a : x)) };
  return { ...n, kids: n.kids.map(k => swap(k, a, b)) };
}
/** A command line as words, "quoted words" kept together. */
export function splitWords(s: string): string[] { return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]!); }

// ── the layout picker (^W r loads, ^W w saves) ──────────────────────────────

class LayoutPicker {
  private sel = 0;
  /** The name it opened with (the layout's own): the first key typed replaces it, ⏎ keeps it. */
  private prefilled: boolean;
  constructor(readonly mode: "load" | "save", private readonly items: { name: string; saved: boolean; builtin: boolean }[], private text = "") { this.prefilled = !!text; }
  key(k: Key, desk: Desk) {
    if (k.kind === "esc" || (k.kind === "mouse" && k.action === "down")) return desk.closePicker();
    if (this.mode === "load") {
      if (k.kind === "up" || (k.kind === "char" && k.ch === "k")) this.sel = Math.max(0, this.sel - 1);
      else if (k.kind === "down" || (k.kind === "char" && k.ch === "j")) this.sel = Math.min(this.items.length - 1, this.sel + 1);
      else if (k.kind === "enter") { desk.closePicker(); desk.run("layout.load", { name: this.items[this.sel]!.name }); }
      return;
    }
    if (k.kind === "enter") { desk.closePicker(); if (this.text.trim()) desk.run("layout.save", { name: this.text.trim() }); }
    else if (k.kind === "backspace") { this.text = this.prefilled ? "" : this.text.slice(0, -1); this.prefilled = false; }
    else if (k.kind === "char" && !k.ctrl && this.text.length < 40) { this.text = (this.prefilled ? "" : this.text) + k.ch; this.prefilled = false; }
  }
  draw(canvas: Canvas, cols: number, rows: number) {
    const w = Math.min(60, cols - 4), h = this.mode === "load" ? Math.min(rows - 4, this.items.length + 2) : 3;
    const r: Rect = { col: Math.floor((cols - w) / 2), row: Math.floor((rows - h) / 3), cols: w, rows: h };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), `${fg(C.yellow)}${this.mode === "load" ? "load a layout" : "save the layout as"}`, fg(C.dark) + (this.mode === "load" ? "↑↓ pick · ⏎ load · esc" : "⏎ save · esc"));
    if (this.mode === "save") { canvas.text(r.col + 2, r.row + 1, this.prefilled ? `${bg(C.blue)}${fg(C.white)}${this.text}${RESET}${paint("|07▁ |08⏎ keeps it, typing replaces it")}` : paint(`|15${this.text}|07▁`), w - 4); return; }
    this.items.forEach((it, i) => {
      const label = `${it.name}${it.saved ? (it.builtin ? " · saved over the built-in" : " · saved") : " · built-in"}`;
      canvas.text(r.col + 1, r.row + 1 + i, (i === this.sel ? bg(C.blue) + fg(C.white) : fg(C.grey)) + pad(` ${label}`, w - 2) + RESET, w - 2);
    });
  }
}

// ── floating search ──────────────────────────────────────────────────────────

class SearchOverlay {
  private q = "";
  private hits: Msg[] = [];
  private sel = 0;
  private busy = false;
  private timer: Timer | null = null;
  private seq = 0;

  key(k: Key, desk: Desk): "keep" | "close" {
    if (k.kind === "esc") return "close";
    if (k.kind === "up") this.sel = Math.max(0, this.sel - 1);
    else if (k.kind === "down" || k.kind === "tab") this.sel = Math.min(Math.max(0, this.hits.length - 1), this.sel + 1);
    else if (k.kind === "enter") { const m = this.hits[this.sel]; if (m) { desk.setCurrent(m, { reveal: true }); return "close"; } }
    else if (k.kind === "backspace") { this.q = this.q.slice(0, -1); this.run(desk); }
    else if (k.kind === "char" && !k.ctrl) { this.q += k.ch; this.run(desk); }
    return "keep";
  }

  private run(desk: Desk) {
    if (this.timer) clearTimeout(this.timer);
    const q = this.q.trim();
    if (q.length < 2) { this.hits = []; return; }
    this.timer = setTimeout(() => {
      const n = ++this.seq;
      this.busy = true; desk.redraw();
      desk.ctx.board.search(q, 30).then(h => { if (n === this.seq) { this.hits = h; this.sel = 0; this.busy = false; desk.redraw(); } }, () => { this.busy = false; });
    }, 250);
  }

  render(w: number, h: number): string[] {
    const listW = Math.floor(w * 0.42);
    const lines = [paint(`|14/ |15${this.q}|07▁ ${this.busy ? "|08searching…" : `|08${this.hits.length} hit(s)`}`), fg(C.blue) + "─".repeat(w) + RESET];
    const m = this.hits[this.sel];
    const preview = m ? [fg(C.white) + subject(m) + RESET, ...previewLines(m, w - listW - 3)] : [];
    for (let i = 0; i < h - 2; i++) {
      const hit = this.hits[i];
      const left = hit ? (i === this.sel ? bg(C.blue) + fg(C.white) : fg(C.grey)) + pad(` ${hit.props["work-id"] && !subject(hit).startsWith(hit.props["work-id"]) ? hit.props["work-id"] + " " : ""}${subject(hit)}`, listW) + RESET : " ".repeat(listW);
      lines.push(left + fg(C.blue) + " │ " + RESET + (preview[i] ?? ""));
    }
    return lines;
  }
}

interface DeskOn { d: Desk; reader?: string }

/** What the desk adds to a reader's note actions: which note is current, and which pane has the keys. */
export const DESK_ACTIONS = new ActionSet<{ "open": { id: string }; "focus": Record<string, never> }, DeskOn>("desk", {
  "open": {
    summary: "make a note the desk's current one and show it in reader=<pane number or tile name> (a detail holds it); the person's own open gives that reader the keys, an agent's never moves them", keys: "enter in the outline, / search",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { d, reader }, actor) {
      const r = await d.openIn(id, reader, actor);
      d.ctx.flash(`${agentLabel(actor)} opened a note in reader ${r.reader}`);
      return r;
    },
  },
  "focus": {
    summary: "give keys to reader=<pane number or tile name> (tile.focus does the same for any tile)", keys: "tab, 1-9, click",
    args: {},
    // The older name of tile.focus: the same code, the same rule (never while the person is typing).
    run(_, { d, reader }, actor) {
      if (!reader) throw new ActionRefused("focus needs reader=<pane number or tile name>");
      d.focusTile(reader, actor);
      d.ctx.flash(`${agentLabel(actor)} gave the keys to ${reader}`);
      return { focus: reader };
    },
  },
});

/** A search hit's body under its title, wrapped: literal-region markers hidden, properties in a region plain (PIE-422). */
function previewLines(m: Msg, w: number): string[] {
  const body = bodyLinesOf(m.text);
  while (body.length && !body[0]!.text.trim()) body.shift();
  while (body.length && !body.at(-1)!.text.trim()) body.pop();
  return body.flatMap(l => (l.text ? wrap(l.text, w) : [""]).map(x => colourBody(x, l.literal)));
}
