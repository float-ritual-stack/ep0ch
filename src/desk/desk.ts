// The desk: the door owns the whole canvas, and the canvas is tiles (PIE-413). A tile is a view (the outline
// tree, a reader, a detail, a preview, a program in a terminal, a whole screen) in the layout tree: split,
// tabbed, dragged by its header and dropped on another tile's header or centre (tabs), a side (a split)
// or the layout's outer edge (a full-height column or full-width row). A tile can slide over the others as
// a drawer instead, and pinning docks it again. Each tile's opens can land in a tile of its choosing (its
// link, PIE-473). The arrangement is a layout saved by name (PIE-474).
//
// Every change goes through a named action (TILE_ACTIONS, PANE_ACTIONS, DESK_ACTIONS): the keys, the mouse
// and the control socket are callers. The desk draws the borders, headers, tabs and the drag's ghost.
import { shellKeyOf } from "../shell-keys";
import type { Ctx, Frame, Screen, ViewState } from "../app";
import { bodyLinesOf, subject, type Msg } from "../board";
import { Canvas, overflows, scrollPct, type BoxGlyphs, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, agentLabel, type ActRequest } from "../surface/actions";
import { leaveSaid, NOTE_ACTIONS, type OpenHow } from "../surface/note";
import { keepEditFile } from "../surface/editor";
import { readState, writeState } from "../state";
import { bg, C, fg, fitHint, headOf, INPUT_CURSOR, pad, paint, RESET, width } from "../style";
import type { Key } from "../term";
import { colourBody, wrap } from "../text";
import { emphasis } from "../inline";
import { presentLinks } from "../refs";
import { dropAt, handleDrop, type Drop, type DropTile } from "./drop";
import { activate, besideSlot, chainOf, clone, EDGE_GLYPH, isLine, parentNode as parentNodeOf, parentOf, cycle, describeTree, dividerAt, dockedTiles, drawerOf, drawers, drawerToEdge, dragShare, edge, effective, even, forgetIds, has, kidsOf, leaf, leaves, move, neighbour, nodeById, normalise, pair, placeScreen, policyOf, remove, resize, revive, serialize, shown, splitOf, tabInto, tabsOf, unwrapDrawer, visible, wrapDrawer, wrapNodeDrawer, POLICY_KEYS, type Axis, type Columns, type Container, type Dir, type Divider, type Drawer, type Effective, type Float, type Grab, type Line, type LNode, type Place, type Placed, type PlacedDrawer, type PlaceOpts, type Policy } from "./layout";
import { drawSpine, SPINE } from "../spine";
import { PANE_ACTIONS, type PaneDone, type PaneHost } from "./pane-actions";
import { Entered, ReaderPane, sessionName, sessionStart, startSession, type DeskApi, type Pane, type PaneView, type SessionKind } from "./panes";
import { isEscapeChord, PtyPane, ESCAPE_CHORD } from "./pty";
import { LocalMarks, markLabel, type Mark, type MarkStore } from "./marks";
import { TILE_ACTIONS, type NewTile, type TileDone, type TileHost, type Where } from "./tile-actions";
import type { TerminalHost } from "./pty-actions";
import { builtin, dailyAgent, type SavedFloat, sharedAgent, isTileKind, layoutNamed, layoutNames, makeTile, migrateDrawers, migrateLinks, migrateNames, saveLayout, withDailyAgent, tileKindNames, tileNameProblem, words, type LayoutSpec, type OpenRule, type SavedTree, type TileSpec } from "./tiles";
import { allKindActions, kindActions, kindForKey, kindNoun, kindOf, lastKindOf, tileKinds, tileSource, unwatchTileKinds, watchTileKinds, wasTileKind, type TileEnv, type TileKindName } from "./tile-kinds";

/**
 * desk.json: the layout tree of tile specs (pairs as `ratio a b`, what every door reads), the focus, the open
 * rule; and (PIE-491) the layout's revision and the next tile and split ids, so a restarted door never gives
 * out a revision or an id an agent may still hold from before (a Herdr agent outlives the door).
 */
interface SavedDesk { root: SavedTree; focus: number; rule?: OpenRule; layout?: string; rev?: number; next?: { tile?: number; node?: number }; policy?: Policy; floats?: SavedFloat[] }
/**
 * Panes a view puts on a desk of its own, and how they're laid out (default: side by side). `names`: each
 * pane's tile name, in order (what `act tile=`, links and previews call it); `links`: [from, to] by place
 * in `panes`, where the first's opens land (PIE-473); `focus`: the place of the pane that starts with the
 * keys; `frame`: the glyphs its tiles' frames are drawn with; `digits: false`: the digits are the view's own
 * (the welcome's notes), so the headers don't number the tiles and 1-9 don't focus them.
 */
export interface DeskPreset { panes: Pane[]; layout?: (ids: number[]) => LNode; title?: string; names?: string[]; links?: [number, number][]; focus?: number; frame?: BoxGlyphs; digits?: false }

const DOCK: Record<string, Dir> = { H: "left", J: "down", K: "up", L: "right" };
const MOVE: Record<string, Dir> = { h: "left", j: "down", k: "up", l: "right" };

type Prefix = "" | "wm" | "add" | "addtab" | "move" | "tab";
/** A header pressed: the tile (a tab) it would drag, and where. A drag of a cell or more starts moving it. */
interface HeadPress { id: number; x: number; y: number }

export class Desk implements Screen, DeskApi, PaneHost, TileHost, TerminalHost {
  title = "desk";
  ctx!: Ctx;
  current: Msg | null = null;
  protected panes = new Map<number, Pane>();
  private tree: LNode = leaf(0);
  /**
   * The layout tree (PIE-491). Set, it gives each split and tab set without one its id (`s<n>`, `g<n>`), and
   * when its shape changed (splits, tab sets, tiles, their order; not shares or the tab shown) a new revision.
   */
  protected get root(): LNode { return this.tree; }
  protected set root(n: LNode) { this.tree = n; this.stamp(); }
  /** The layout's revision: `layout.get` gives it, and `expected=` on any desk action is checked against it. */
  private rev = 0;
  private shapeKey = "";
  private nextNode = 1;
  protected focus: number;
  protected zoom: number | null = null;
  private nextId = 1;
  private prefix: Prefix = "";
  private drag: Grab | null = null;
  /** A reader the mouse went down in (PIE-419): its drag selects text, its release is the click. */
  private pressed: { pane: ReaderPane; col: number; row: number; fresh: boolean } | null = null;
  protected placed: Placed = { rects: new Map(), nodes: new Map(), dividers: [] };
  private search: SearchOverlay | null = null;
  private picker: LayoutPicker | null = null;
  /** The reader edit, comment or property panel the person is in: only that one takes their keys (PIE-411). */
  protected entered = new Entered();
  /** A session the person started by key that is still opening (the note being read): Esc cancels it. */
  protected pending: { pane: ReaderPane } | null = null;

  // ── tiles (PIE-413) ──
  /** Each tile's name: what links, previews, `act tile=` and `peek` call it. */
  protected names = new Map<number, string>();
  /** Where a tile's opens land (PIE-473): tile → tile. */
  private links = new Map<number, number>();
  /**
   * Tiles saved with a kind nobody has registered: a tile that says so stands in, saves write their spec back
   * as it was, and the tile is made again when the kind comes (`kindsChanged`).
   */
  private unregistered = new Map<number, TileSpec>();
  /** The screen's own policy (PIE-505): the outermost container's, `locked` there locking the whole screen. */
  private screenPolicy: Policy = {};
  /** The drawers sliding over the layout as last drawn, each with its tiles (for the mouse). */
  private slid: PlacedDrawer<number>[] = [];
  /** The lock chip at the end of the hint row, as last drawn. */
  private lockChip: { from: number; to: number } | null = null;
  /** The hint row as composed, when it was too long for the row and was cut ("? more"); where "? more" is on it. */
  private hintFull: string | null = null;
  private moreChip: { from: number; to: number } | null = null;
  /** The whole hint row shown above it (keys.more: ?, or a click on "? more"), until the next key or click elsewhere. */
  private hintMoreOpen = false;
  /** ^W P: the policy panel over the focused tile's containers. */
  private policyPanel: PolicyPanel | null = null;
  /**
   * Floats (PIE-511, `tile.float`): tiles taken out of the tree, each with its own rectangle, drawn above
   * everything, the last on top. One float model for the desk and every screen built on it (the board's).
   */
  protected floats: Float<number>[] = [];
  /** Tiles folded to a spine (`tile.collapse`), and the agent that folded one, if an agent did. */
  protected collapsed = new Map<number, { by?: string }>();
  /** The spines drawn, for a click. */
  private spines: [number, Rect][] = [];
  /** A float's title or ◢ corner being dragged: it follows the pointer by `float.place`. */
  private floatDrag: { id: number; size: boolean; dx: number; dy: number } | null = null;
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
  protected hits: [number, Rect][] = [];
  private heads: { id: number; from: number; to: number; row: number }[] = [];
  private markHits: { n: number; from: number; to: number; row: number }[] = [];
  /** Each header's "⇤ drawer" as drawn: a click there docks the drawer (tile.pin on=true). */
  private drawerLabels: { id: number; from: number; to: number; row: number }[] = [];
  private handles: { id: number; from: number; to: number; drawer: Drawer<number> }[] = [];
  private dividers: Divider<number>[] = [];
  protected area: Rect = { col: 0, row: 0, cols: 80, rows: 22 };
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
    // An extension's kind that comes or goes while the door runs (PIE-512): its tiles are made again.
    watchTileKinds(this);
    if (preset) {
      this.resume(null);
      const ids = preset.panes.map((p, i) => this.put(p, preset.names?.[i]));
      this.root = preset.layout ? preset.layout(ids) : ids.slice(1).reduce<LNode>((a, id) => pair("row", 0.5, a, { t: "leaf", id }), { t: "leaf", id: ids[0]! });
      for (const [from, to] of preset.links ?? []) if (ids[from] !== undefined && ids[to] !== undefined) this.links.set(ids[from]!, ids[to]!);
      this.focus = ids[preset.focus ?? 0] ?? ids[0]!;
      if (preset.title) this.title = preset.title;
      return;
    }
    const named = opts.layout ? layoutNamed(opts.layout) : null;
    const last = readState<SavedDesk>("desk.json");
    this.resume(last);
    this.root = leaf(0); this.focus = 0;
    const saved = named ? null : last;
    if (named) { this.build(named.spec); this.layoutName = opts.layout!; }
    else if (saved?.root) { this.build(withDailyAgent(migrateLinks({ root: saved.root, focus: saved.focus, rule: saved.rule, ...(saved.policy ? { policy: saved.policy } : {}), ...(saved.floats ? { floats: saved.floats } : {}) }, saved.layout), saved.layout), false, true); this.layoutName = saved.layout ?? null; }
    else this.build(layoutNamed("desk")!.spec);
  }

  /**
   * Go on from the last door's revision and ids (PIE-491). The revision starts at the clock (milliseconds), or
   * at the saved one if that's later, so it never repeats one an agent read before a restart, even when that
   * door saved nothing; the next tile and split ids go on from the saved ones, so a closed tile's id isn't reused.
   */
  private resume(last: SavedDesk | null) {
    const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : 0);
    this.rev = Math.max(n(last?.rev), Date.now());
    this.nextId = Math.max(this.nextId, n(last?.next?.tile));
    this.nextNode = Math.max(this.nextNode, n(last?.next?.node));
  }

  protected put(p: Pane, name?: string): number {
    const id = this.nextId++;
    this.panes.set(id, p);
    this.names.set(id, name && !tileNameProblem(name) && ![...this.names.values()].includes(name) ? name : this.autoName(p.kind));
    return id;
  }
  protected autoName(kind: string): string {
    const taken = new Set(this.names.values());
    if (!taken.has(kind)) return kind;
    for (let n = 2; ; n++) if (!taken.has(`${kind}${n}`)) return `${kind}${n}`;
  }
  protected nameOf(id: number) { return this.names.get(id) ?? String(id); }
  /** Every tile: the tree's, a tab set's hidden ones included, then the floats. */
  protected all(): number[] { return [...leaves(this.root), ...this.floats.map(f => f.id)]; }
  protected isFloat(id: number) { return this.floats.some(f => f.id === id); }
  private numberOf(id: number) { return this.all().indexOf(id) + 1; }
  /** A tile's stable id (PIE-491): `t<n>`, kept through moves, tabs and saves; never given to another tile. */
  protected tileId(id: number) { return `t${id}`; }

  /** Ids for the splits and tab sets that have none (kept ones first, so a saved id is never taken), and the revision. */
  private stamp() {
    const seen = new Set<string>(), all: Container[] = [];
    const walk = (n: LNode) => { if (n.t !== "leaf") { all.push(n); kidsOf(n).forEach(walk); } };
    walk(this.tree);
    const want = (n: Container) => (n.t === "split" ? "s" : n.t === "tabs" ? "g" : n.t === "columns" ? "c" : "d");
    for (const n of all) {
      const m = n.id?.startsWith(want(n)) ? /^[sgdc](\d+)$/.exec(n.id) : null;
      if (m && !seen.has(n.id!)) { seen.add(n.id!); this.nextNode = Math.max(this.nextNode, Number(m[1]) + 1); }
      else delete n.id;
    }
    for (const n of all) if (!n.id) n.id = `${want(n)}${this.nextNode++}`;
    // The shape: containers, tiles, their order, each container's policy and the screen's. Not shares, the tab
    // shown or whether a drawer is open: those don't change what an agent's path or id points at.
    const pol = (n: Container) => (n.policy ? JSON.stringify(n.policy) : "");
    const shape = (n: LNode): string => (n.t === "leaf" ? `t${n.id}` : n.t === "tabs" ? `${n.id}${pol(n)}[${n.ids.join(",")}]` : n.t === "drawer" ? `${n.id}<${n.edge}>${pol(n)}(${shape(n.kid)})` : `${n.id}${n.t === "columns" ? `columns:${n.source ?? ""}` : n.dir}${pol(n)}(${n.kids.map(shape).join(",")})`);
    const key = shape(this.tree) + JSON.stringify(this.screenPolicy ?? {}) + (this.floats ?? []).map(f => `f${f.id}`).join(",");
    if (key !== this.shapeKey) { this.shapeKey = key; this.rev++; }
  }

  /** `expected=<rev>`: refused when the layout's shape changed since the revision the caller read. */
  private checkRev(expected: unknown) {
    const e = typeof expected === "number" ? expected : typeof expected === "string" && /^\d+$/.test(expected) ? Number(expected) : NaN;
    if (!Number.isInteger(e)) throw new ActionRefused(`expected is the revision layout.get gave (a number), not ${JSON.stringify(expected)}`);
    if (e !== this.rev) throw new ActionRefused(`the layout changed since revision ${e} (it is ${this.rev} now): nothing was done; read layout.get again, or name splits and tiles by id`);
  }

  // ── building a layout (PIE-474) ──────────────────────────────────────────

  /**
   * Lay out `spec`. With `reuse`, a tile already here with the same name and kind (and program) is kept as
   * it is; the ones the layout has no place for that hold work (a running program, an unsaved edit) are kept
   * in a shut drawer on the right, and the rest are closed.
   */
  protected build(spec0: LayoutSpec, reuse = false, restore = false): void {
    const spec = migrateDrawers(migrateNames(spec0));
    // A saved id is the tile's, split's or tab set's own only when this is desk.json coming back (`restore`) or
    // it was never given out here: a layout loaded from layouts.json never hands a gone tile's id to another.
    const mine = (n: number, next: number) => n > 0 && (restore || n >= next);
    const old = new Map(this.panes);
    const oldNames = new Map(this.names);
    const byName = new Map([...this.names].map(([id, n]) => [n, id] as const));
    const used = new Set<number>(), fresh: number[] = [], wantLinks: [number, string][] = [];
    const names = new Map<number, string>();
    const folded = new Map<number, { by?: string }>();
    if (!reuse) this.panes.clear();
    this.names = names;
    this.floats = [];
    const tileOf = (l: TileSpec) => {
      // A kind nobody registers here is made as a tile that says so (src/desk/tiles.ts makeTile).
      const kind = l.kind;
      const o = reuse && l.name ? byName.get(l.name) : undefined;
      const p = o !== undefined ? old.get(o) : undefined;
      let id: number;
      if (o !== undefined && p && !used.has(o) && p.kind === kind && (!(p instanceof PtyPane) || !l.cmd || p.run.cmd.join(" ") === l.cmd.join(" "))) {
        id = o; names.set(id, l.name!);
      } else {
        let pane = makeTile({ ...l, kind });
        // The dock's agent (PIE-498) is one tile. Laid out again with `reuse`, the desk may hold it already under
        // another name: that tile is this one (a new program would be a second attach to the agent).
        const had = reuse && this.isShared(pane) ? [...old].find(([, q]) => q === pane)?.[0] : undefined;
        if (had !== undefined && !used.has(had)) {
          id = had;
          names.set(id, l.name && ![...names.values()].includes(l.name) ? l.name : oldNames.get(id) ?? this.autoName(kind));
        } else {
          // A second agent tile in the same layout gets a program of its own.
          if (this.isShared(pane) && [...names.keys()].some(n => this.panes.get(n) === pane)) pane = new PtyPane({ cmd: l.cmd?.length ? l.cmd : dailyAgent().cmd, cwd: l.cwd, label: l.name });
          // The tile's saved id, when no tile here has it (a saved layout loaded twice gets new ones the second time).
          const saved = /^t(\d+)$/.exec(l.id ?? "");
          const n = saved ? Number(saved[1]) : 0;
          id = mine(n, this.nextId) && !this.panes.has(n) ? n : this.nextId++;
          this.nextId = Math.max(this.nextId, id + 1);
          this.panes.set(id, pane);
          names.set(id, l.name && ![...names.values()].includes(l.name) ? l.name : this.autoName(kind));
          fresh.push(id);
        }
      }
      used.add(id);
      // A kind nobody has registered (an extension not loaded yet) says so in its place; its spec is kept as saved.
      if (!isTileKind(l.kind)) this.unregistered.set(id, l); else this.unregistered.delete(id);
      if (l.link) wantLinks.push([id, l.link]);
      if (l.collapsed) folded.set(id, {});
      return id;
    };
    const root = revive(spec.root, tileOf);
    // Floats (PIE-511) come back where they were, each its own tile.
    const floats: Float<number>[] = (Array.isArray(spec.floats) ? spec.floats : []).filter(f => f?.tile?.t === "leaf" && isRect(f.rect)).map(f => ({ id: tileOf(f.tile), rect: { ...f.rect } }));
    // A saved tree with no tiles in it (a hand-edited save): the desk's own layout instead.
    if (!leaves(root).length) { this.names = oldNames; return this.build(builtin("desk")!, reuse); }
    this.floats = floats;
    this.collapsed = folded;
    if (!restore) forgetIds(root, id => !mine(id, this.nextNode));
    let tree = normalise(root);
    // What the new layout has no place for: kept when it holds work (in one shut drawer on the right), else closed.
    const kept: number[] = [];
    if (reuse) for (const [id, p] of old) {
      if (used.has(id)) continue;
      if (this.holdsWork(p)) {
        const was = oldNames.get(id) ?? p.kind;
        names.set(id, [...names.values()].includes(was) ? this.autoName(was) : was);
        kept.push(id);
      } else { if (!this.isShared(p)) p.dispose?.(); this.panes.delete(id); if (this.ptyIn === p) this.ptyIn = null; }
    }
    if (kept.length) {
      const kid: LNode = kept.length > 1 ? { t: "tabs", ids: kept, active: 0 } : leaf(kept[0]!);
      tree = normalise(tree);
      tree = splitOf("row", [tree, { t: "drawer", kid, edge: "right", open: false }], [0.7, 0.3]);
    }
    this.screenPolicy = policyOf(spec.policy);
    this.root = normalise(tree);
    // Nothing left to show (a saved layout of empty tab sets): the desk as it always opened.
    if (!leaves(this.root).length) { this.names = names; return this.build(layoutNamed("desk")!.spec, reuse); }
    this.links = new Map();
    for (const [id, to] of wantLinks) { const t = [...names].find(([, n]) => n === to)?.[0]; if (t !== undefined && t !== id) this.links.set(id, t); }
    this.rule = spec.rule ?? "current";
    const ids = this.all();
    const f = typeof spec.focus === "string" ? [...names].find(([, n]) => n === spec.focus)?.[0] : ids[typeof spec.focus === "number" ? spec.focus : 0];
    this.focus = f !== undefined && ids.includes(f) ? f : ids[0]!;
    activate(this.root, this.focus);
    this.zoom = null;
    if (this.ctx) for (const id of fresh) this.startTile(id);
  }

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
  protected showing(p: Pane | undefined): Msg | null { return p ? kindOf(p)?.shows?.(p) ?? null : null; }
  /** The tiles that follow tile `id` (a preview with source=tile:<its name>), by their kinds' `follows`. */
  private followers(id: number): Pane[] {
    // A source may name a container (`tile:lanes`, the board's columns): any tile in it is followed.
    const names = new Set([this.nameOf(id), ...chainOf(this.root, id).flatMap(c => (isLine(c) && c.key ? [c.key] : []))]);
    return [...this.panes].filter(([pid, q]) => { const f = kindOf(q)?.follows?.(q); return pid !== id && f !== null && f !== undefined && names.has(f); }).map(([, q]) => q);
  }

  /** A tile joins a live desk: it reads what it needs (its kind's `start`: a detail its note, a preview its source). */
  protected startTile(id: number) {
    const p = this.panes.get(id)!;
    // The dock's agent is the App's (PIE-498): its id, its place and its repaints stay the dock's; the desk only shows it.
    if (this.isShared(p)) { sharedAgent()!.watch(this); return; }
    const env: TileEnv = {
      desk: this, id: this.tileId(id), name: this.nameOf(id), place: this.layoutName ?? "desk",
      tile: name => { const t = this.idNamed(name); return t !== undefined ? this.panes.get(t) : undefined; },
      followers: () => (this.panes.has(id) ? this.followers(id) : []),
    };
    p.init?.(this);
    p.select?.(this.current, this);
    kindOf(p)?.start?.(p, env);
  }

  /** What tile `name` shows or has selected (a reader's note, the tree's row, a screen's card), for a tile that follows it. */
  tileShowing(name: string): Msg | null {
    const id = this.idNamed(name);
    return this.showing(id !== undefined ? this.panes.get(id) : undefined);
  }

  protected idNamed(name: string): number | undefined { return [...this.names].find(([id, n]) => n === name && this.panes.has(id))?.[0]; }

  protected specOf(id: number): TileSpec {
    const p = this.panes.get(id)!;
    const link = this.links.get(id);
    const k = kindOf(p), kept = this.unregistered.get(id);
    return {
      ...(kept ? (({ link: _l, drawer: _d, ...rest }) => rest)(kept) : {}),
      t: "leaf", kind: kept?.kind ?? p.kind, name: this.nameOf(id), id: this.tileId(id), ...(kept ? {} : (k?.save ? k.save(p) : p.spec?.()) ?? {}),
      ...(link !== undefined && this.panes.has(link) ? { link: this.nameOf(link) } : {}),
      ...(this.collapsed.has(id) ? { collapsed: true as const } : {}),
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
  /** The layout as saved: tile specs in the tree of containers (each with its policy), the focus, the open rule, the screen's policy. */
  layoutSpec(): LayoutSpec { return { root: serialize(this.savedRoot(), id => this.specOf(id)), focus: this.nameOf(this.focus), rule: this.rule, ...this.savedPolicy(), ...this.savedFloats() }; }
  private savedPolicy() { return Object.keys(this.screenPolicy).length ? { policy: { ...this.screenPolicy } } : {}; }
  private savedFloats() { return this.floats.length ? { floats: this.floats.map(f => ({ tile: this.specOf(f.id), rect: { ...f.rect } })) } : {}; }

  protected save() {
    if (this.preset) return;
    const root = serialize(this.savedRoot(), id => this.specOf(id));
    writeState("desk.json", { root, focus: this.all().indexOf(this.focus), rule: this.rule, ...(this.layoutName ? { layout: this.layoutName } : {}), rev: this.rev, next: { tile: this.nextId, node: this.nextNode }, ...this.savedPolicy(), ...this.savedFloats() } satisfies SavedDesk);
  }

  // ── DeskApi ────────────────────────────────────────────────────────────────

  enter(ctx: Ctx) {
    const again = !!this.ctx;
    this.ctx = ctx; this.onScreen = true;
    if (again) return;
    for (const id of this.all()) this.startTile(id);
    void this.fillColumns();
  }

  // ── columns whose tiles come from data (PIE-511) ──

  /** Every columns container in the tree. */
  protected columnsIn(n: LNode = this.root): Columns<number>[] { return [...(n.t === "columns" ? [n] : []), ...kidsOf(n).flatMap(k => this.columnsIn(k))]; }

  /**
   * Fill each columns container from its source (`hub:<id>`: a hub's views, one query tile each): the tiles it
   * holds already (anywhere: one dragged out stays where it was put) are kept by their source's key, with what
   * they hold, and told the data again (`prime`); new ones join in the source's order; the source's own tiles it
   * no longer names are closed. The columns' weights stay with their tiles. Resolves once every source answered.
   */
  protected async fillColumns(only?: Columns<number>): Promise<void> {
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
    const order: number[] = [], fresh: number[] = [];
    for (const t of got.tiles) {
      const key = src.source.key(t.spec) ?? `${t.spec.kind}:${t.spec.name ?? ""}`;
      let id = byKey.get(key);
      if (id === undefined) {
        id = this.put(makeTile(t.spec), t.spec.name);
        this.sourced.set(id, { columns: cid, source: asked, key });
        fresh.push(id);
      }
      t.prime?.(this.panes.get(id)!);
      this.sourcedTile(id, this.panes.get(id)!);
      order.push(id);
    }
    // What it supplied before and doesn't name now (a view taken off the hub; all of them, when it's another hub): closed.
    for (const [id] of mine) if (!order.includes(id)) { this.sourced.delete(id); this.closeId(id); }
    for (const [id] of [...this.sourced]) if (!this.panes.has(id)) this.sourced.delete(id);
    // Closing a tile laid the tree out again: the columns as they are now.
    const c = this.columnsIn().find(x => x.id === cid);
    if (!c) return;
    // Its tiles in the source's order; one the person moved out stays where they put it; others they put in, after.
    const at = (id: number) => c.kids.findIndex(k => k.t === "leaf" && k.id === id);
    const kids: LNode[] = [], weights: number[] = [];
    for (const id of order) {
      const i = at(id);
      if (i < 0 && !fresh.includes(id)) continue;
      kids.push(i >= 0 ? c.kids[i]! : leaf(id)); weights.push(i >= 0 ? c.weights[i]! : 1);
    }
    c.kids.forEach((k, i) => { if (!kids.includes(k) && leaves(k).every(id => this.panes.has(id)) && leaves(k).length) { kids.push(k); weights.push(c.weights[i]!); } });
    c.kids = kids; c.weights = weights;
    this.filledOnce.add(cid);
    this.root = normalise(this.root);
    for (const id of fresh) this.startTile(id);
    this.filled(c, got.title);
    this.redraw();
  }
  /** A tile a source supplied (new, or kept), before it starts: a view takes charge of it here (the board, of its lanes). */
  protected sourcedTile(_id: number, _p: Pane) {}
  /** A columns container was filled (the board takes its title from it, and reads its lanes). */
  protected filled(_c: Columns<number>, _title?: string) {}
  /** The tiles a columns container's source supplied, in its order (wherever they are now). */
  protected sourcedIn(c: Columns<number>): number[] {
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
    if (!this.preset && this.running().length) { Desk.kept = this; return "keep"; }
    sharedAgent()?.unwatch(this);
    // Gone for good: kinds that come later never make tiles (nor start programs) here.
    this.disposed = true;
    unwatchTileKinds(this);
    for (const p of this.panes.values()) if (!this.isShared(p)) p.dispose?.();
  }
  private disposed = false;
  /** The desk kept alive with its programs, to come back to (the menu's D). */
  private static kept: Desk | null = null;
  /** The desk to open: the one kept running in the background, else a new one. */
  static resume(): Desk { const d = Desk.kept; Desk.kept = null; return d ?? new Desk(); }
  private onScreen = false;
  /** The programs this desk runs (the dock's agent isn't one of them: it runs on when the desk goes). */
  private running(shared = false) { return [...this.panes.values()].filter((p): p is PtyPane => p instanceof PtyPane && p.running && (shared || !this.isShared(p))); }
  /** The dock's agent tile (PIE-498): shown here, owned by the App. */
  private isShared(p: unknown): boolean { return !!sharedAgent()?.isShared(p); }
  /**
   * The dock's agent is pulled up in the drawer: its tile here draws a note, and isn't entered from here (the
   * drawer has it, at its own size; ctrl+] or a click there types in it). Said, with how to bring it back.
   */
  private inDrawer(p: unknown, say = true): boolean {
    if (!sharedAgent()?.drawnElsewhere(p)) return false;
    if (say) this.ctx.flash(`${this.nameOf(this.focus)} is in the agent drawer · type there (a click, or ctrl+]) · alt+a or Esc puts it back here`);
    return true;
  }
  /** A desk built for another view (the brief) has no way back: leaving it would end its programs, so it says so. */
  leaveRefusal(): string | null {
    const r = this.preset ? this.running() : [];
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "runs" : "run"} in a tile here · ^W x ends ${r.length === 1 ? "it" : "them"} first` : null;
  }

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    // alt+⏎ on a link, or a ctrl- or alt-click (PIE-441, PIE-473): a new reader beside this one holds it;
    // the others keep their notes. An agent's doesn't take the person's focus.
    // On a locked screen nothing new opens (its shape is fixed): the open lands as the current one instead.
    if (m && opts.fresh && opts.from instanceof ReaderPane && this.screenLocked()) this.ctx.flash(`the screen is locked: no new reader beside · opened here · ${UNLOCK}`);
    else if (m && opts.fresh && opts.from instanceof ReaderPane) {
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
    if (m && from !== undefined) for (const p of this.followers(from)) p.follow?.(m, this);
    // An open (a link followed, the tree's ⏎, a list's pick) lands in the tile's link (or its container's opens-into).
    if (m && from !== undefined && (opts.link || opts.reveal) && this.routes(opts.from!)) {
      const to = this.linkOf(from);
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
    for (const p of this.followers(id)) p.follow?.(m, this);
    const to = this.linkOf(id);
    if (to !== undefined) this.openInto(to, m, agent);
    this.redraw();
  }

  /** Opens from `pane` land somewhere else (a link, the river's rule): a held reader doesn't follow them in place. */
  routes(pane: Pane): boolean {
    const id = this.idOf(pane);
    return id !== undefined && this.linkOf(id) !== undefined;
  }

  /**
   * Where tile `id`'s opens land: its own link, else the opens-into of the nearest container that names one
   * (PIE-505's policy); undefined when neither names a tile here (or names itself).
   */
  protected linkOf(id: number): number | undefined {
    const own = this.links.get(id);
    if (own !== undefined && this.panes.has(own)) return own;
    const into = this.policyAt(id).opensInto;
    const to = into ? this.idNamed(into) : undefined;
    return to !== undefined && to !== id ? to : undefined;
  }

  protected idOf(p: Pane | undefined): number | undefined { return p ? [...this.panes].find(([, x]) => x === p)?.[0] : undefined; }

  /** Show `m` in tile `to` (its link target): false when that tile can't show a note, or holds an edit. */
  private openInto(to: number, m: Msg, _agent: boolean): boolean {
    const p = this.panes.get(to), k = kindOf(p);
    // A tile whose kind takes notes takes it its own way (a preview follows it, a reader holds it in its history).
    if (!p || !k?.accepts?.notes || !k.take) { this.ctx.flash(`${this.nameOf(to)} can't show a note · alt+l links this tile somewhere else`); return false; }
    const why = k.take(p, m, this);
    if (why) { this.ctx.flash(`${this.nameOf(to)} ${why} · the note opened as the current one instead`); return false; }
    return true;
  }


  /** The reader the person has focused (PIE-453). */
  holdsFocus(pane: ReaderPane) { return this.panes.get(this.focus) === pane; }
  /** The kind of tile that has the person's keys (a view's own keys step aside for a tile that uses them). */
  protected focusedKind(): TileKindName | undefined { return this.panes.get(this.focus)?.kind as TileKindName | undefined; }

  /** The person's keys to the first tile of `kind` (waiting's ⏎, the tree's open): `tile.focus`, as their key does. */
  focusKind(kind: TileKindName) {
    const id = this.all().find(i => this.panes.get(i)?.kind === kind);
    if (id !== undefined && id !== this.focus) this.cmd("tile.focus", {}, this.nameOf(id));
  }

  /** The shell's actions (screen.back, video.cycle) as the person's key (src/shell-keys.ts: screens.ts imports this module). */
  private shell(name: "screen.back" | "video.cycle") { shellKeyOf(name, this, this.ctx); }

  /** A repaint, while the desk is the screen shown (kept in the background, its programs don't repaint the menu). */
  redraw() { if (this.onScreen) this.ctx?.redraw(); }

  tick(): boolean { let any = false; for (const p of this.panes.values()) if (kindOf(p)?.tick?.(p)) any = true; return any; }

  onEvent(e: OutlineEvent) {
    this.hear(e);
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && !p.msg?.id.startsWith("file:"));
    // Each reader the change makes stale re-reads its note (NoteSurface.staleOn, .reread; a draft is only marked).
    for (const r of readers) if (r.surface.staleOn(e)) r.reread(this);
    if (e.action === "reconnected") for (const r of readers) r.retry(this);   // a note whose read failed while away
  }

  /**
   * The tiles hear a change (but those `skip` names: a screen that refreshes its readers its own way), and each
   * columns container whose source it may change is filled again (a view added under the hub: a new lane).
   */
  protected hear(e: OutlineEvent, skip?: (p: Pane) => boolean) {
    for (const p of this.panes.values()) if (!skip?.(p)) (p.onEvent as ((d: DeskApi, e?: OutlineEvent) => void) | undefined)?.call(p, this, e);
    if (e.action === "reset") return void this.fillColumns();
    const c = e.change;
    if (c) for (const col of this.columnsIn()) { const src = tileSource(col.source); if (src?.source.affects?.(c, src.arg)) void this.fillColumns(col); }
  }

  /**
   * `ep0ch open <id>` (an agent's): the note is shown where the focused tile's opens land, else in a reader
   * that follows the current note, else in the first detail free to take it. The person's keys, their outline
   * cursor and what they're typing in stay where they are.
   */
  openBlock(m: Msg) { this.openShown(m); }
  /** `openBlock`, saying which reader it landed in. */
  private openShown(m: Msg): string | null {
    const link = this.linkOf(this.focus);
    // Not a tile that follows a source (a preview of a tile or a file): what it shows is its source's.
    const readers = this.namedReaders().filter(r => !r.pane.holdsKeys && !r.pane.editing && !kindOf(r.pane)?.follower);
    const r = (link !== undefined ? readers.find(x => x.id === link) : undefined) ?? readers.find(x => x.pane.follows && !x.pane.holding) ?? readers[0];
    const show = () => { this.setCurrent(m, { agent: true }); if (r && r.pane.msg?.id !== m.id) { if (r.pane.holding) r.pane.hold(m, this); else r.pane.show(m, this); } };
    if (r) r.pane.surface.track(show); else show();
    this.redraw();
    return r?.name ?? null;
  }

  /**
   * `open from=<tile>` (PIE-491): the note lands where tile `from`'s opens go, its link (the daily layout's claude
   * tile links to middle). Unlinked, where `ep0ch open <id>` puts it. The caller names its own tile, never a reader.
   */
  async openFrom(id: string, from: string, actor: Actor): Promise<{ reader: string | null; id: string }> {
    const t = this.tile(from);
    const to = this.linkOf(t.id);
    if (to !== undefined && this.panes.get(to) instanceof ReaderPane) return this.openIn(id, this.tileId(to), actor);
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    // A linked tile that takes notes its own way (an extension's kind): it takes it there.
    if (to !== undefined && this.openInto(to, m, actor.kind === "agent")) { this.redraw(); return { reader: this.nameOf(to), id: m.id }; }
    return this.land(m);
  }

  /**
   * An agent's `open id=` naming no reader and no tile (`ep0ch open <id>`): where this screen puts an agent's
   * open (`openBlock`: the desk's focused tile's link or a following reader, the board's detail, the welcome's
   * preview, the brief's step), never the reader the person types in.
   */
  async openLanding(id: string): Promise<{ reader: string | null; id: string }> {
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    return this.land(m);
  }
  /** `openBlock(m)`, saying which reader shows it now. */
  private land(m: Msg): { reader: string | null; id: string } {
    this.openBlock(m);
    // A reader that keeps what it's given (a detail) before one that follows (a preview showing it already).
    const showing = this.namedReaders().filter(r => r.pane.msg?.id === m.id);
    return { reader: (showing.find(r => !kindOf(r.pane)?.follower) ?? showing[0])?.name ?? null, id: m.id };
  }

  // ── actions: what the keys do, by name, for agents (`ep0ch act`) ─────────

  actions() {
    return {
      actions: [...DESK_ACTIONS.list(), ...TILE_ACTIONS.list(), ...PANE_ACTIONS.list(), ...allKindActions().flatMap(a => a.list()), ...NOTE_ACTIONS.list()], readers: this.namedReaders().map(r => r.name), tiles: this.all().map(id => this.nameOf(id)),
      rev: this.rev, expected: "any action here takes expected=<rev> (layout.get's rev): refused, with nothing done, when the layout changed since",
    };
  }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    // Any desk action may say which layout it read (PIE-491): a path or a tile number is only good for that one.
    if ("expected" in args) { this.checkRev(args.expected); delete args.expected; }
    if (DESK_ACTIONS.has(req.action)) return DESK_ACTIONS.runUntyped(req.action, args, { d: this, reader: req.reader }, actor);
    if (TILE_ACTIONS.has(req.action)) return TILE_ACTIONS.runUntyped(req.action, args, { d: this, reader: req.reader }, actor);
    if (PANE_ACTIONS.has(req.action)) return PANE_ACTIONS.runUntyped(req.action, args, { h: this, reader: req.reader }, actor);
    // A tile kind's own actions (the tree's tree.*, a terminal's tile.type), on tile=<tile>, the focused tile or the first of that kind.
    const own = this.kindAction(req.action, req.reader, actor);
    if (own) return { tile: own.tile, ...(await own.set.runUntyped(req.action, args, { pane: own.pane, desk: this, tile: own.tile }, actor) as object) };
    // An action its kind answers itself (a whole screen's: the board's card.*), in its tile.
    const t = req.reader ? this.tileNamed(req.reader, false) : null;
    const sp = t ? this.panes.get(t.id) : undefined;
    const answers = kindOf(sp)?.act;
    if (sp && answers) return { tile: t!.name, ...(await answers(sp, { ...req, reader: undefined }, actor) as object) };
    const r = this.pickReader(req.reader);
    const out = await r.pane.act(req.action, args, this, actor);
    return { reader: r.name, ...(out && typeof out === "object" ? out : { result: out }) };
  }

  /**
   * The kind action `name` and the tile it runs on: tile=<tile> when its kind has the action, else (no reader
   * named) the focused tile when its kind has it, else the only tile whose kind has it (the person's, the first).
   * An agent never gets a guess between several (typing into whichever terminal came first): it names one.
   * Null when no kind has it; refused when the tile named, or every tile here, has a kind without it.
   */
  private kindAction(name: string, sel?: string, actor: Actor = USER): { set: ReturnType<typeof kindActions>[number]; tile: string; pane: Pane } | null {
    const sets = (p: Pane | undefined) => kindActions(kindOf(p)).find(a => a.has(name));
    const owners = tileKinds().filter(k => kindActions(k).some(a => a.has(name)));
    if (!owners.length) return null;
    const all = this.all().filter(id => sets(this.panes.get(id)));
    const t = sel ? this.tileNamed(sel, false) : null;
    const id = t ? (all.includes(t.id) ? t.id : undefined) : sel ? undefined : all.includes(this.focus) ? this.focus : all[0];
    if (!sel && id !== undefined && id !== this.focus && all.length > 1 && actor.kind === "agent") {
      throw new ActionRefused(`${name} needs tile=<tile>: the focused tile has no such action and several here do (${all.map(i => this.nameOf(i)).join(", ")})`);
    }
    if (id === undefined) {
      const key = owners.flatMap(k => k.keys ?? [])[0]?.key;
      const named = t ? this.panes.get(t.id) : undefined;
      const nouns = [...new Set(owners.map(k => kindNoun(k.kind)))].join(" or ");
      throw new ActionRefused(t ? `${t.name} is ${named ? kindNoun(named.kind) : "a tile"}: ${name} is for ${nouns}${all.length ? `; here: ${all.map(i => this.nameOf(i)).join(", ")}` : ""}`
        : sel ? `no tile ${sel} here` : `no ${nouns.replace(/^an? /, "")} here${key ? `; ^W o ${key} opens one` : ""}`);
    }
    return { set: sets(this.panes.get(id))!, tile: this.nameOf(id), pane: this.panes.get(id)! };
  }

  /** A key or a click runs the same action as `act`, as the person; a refusal is said, not thrown. */
  protected cmd(name: string, args: Record<string, unknown> = {}, reader?: string) {
    const on = { d: this, reader };
    const done = (p: Promise<unknown>) => p.then(() => this.redraw(), e => { this.ctx.flash(e instanceof Error ? e.message : String(e)); this.redraw(); });
    try {
      if (TILE_ACTIONS.has(name)) return void done(TILE_ACTIONS.run(name, args as never, on, USER));
      if (PANE_ACTIONS.has(name)) return void done(PANE_ACTIONS.run(name, args as never, { h: this, reader }, USER));
      if (DESK_ACTIONS.has(name)) return void done(DESK_ACTIONS.run(name, args as never, on, USER));
      const own = this.kindAction(name, reader);
      if (own) return void done(own.set.run(name, args as never, { pane: own.pane, desk: this, tile: own.tile }, USER));
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
    if (this.readerPanes().some(r => r.pane !== pane && !r.pane.holding && r.pane.follows)) return;
    // A locked screen keeps its shape: no reader is added, and it says so.
    if (this.screenLocked()) { this.ctx.flash(`the screen is locked: no reader added beside · ${UNLOCK}`); return; }
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
    return !!this.search || !!this.picker || !!this.policyPanel || !!this.linking || this.prefix !== "" || !!this.pending || !!this.personIn() || !!this.focusedReader()?.surface.choosing || this.inPty() || (!!f && !!kindOf(f)?.takesKeys?.(f)) || !!f?.typing?.();
  }
  /** Screen.holdsKeys: the same, for a frame around the desk (a brief tile) and the shell's agentMayMove (PIE-489). */
  holdsKeys(): boolean { return this.personTyping(); }

  /** The person is in a terminal tile (its program running, or exited and waiting for ⏎ or ctrl+]): every key is the tile's, ctrl+c included. */
  rawKeys(): boolean { return this.inPty(); }
  private inPty(): boolean { return !!this.ptyIn && this.panes.get(this.focus) === this.ptyIn && !this.inDrawer(this.ptyIn, false); }
  /** Raw input goes straight to the program while it runs (F-keys, shift-arrows, a bracketed paste): Term keeps the mouse and ctrl+]. */
  rawInput(): ((bytes: string) => void) | null { const p = this.ptyIn; return p && this.inPty() && p.running ? (s: string) => p.inputRaw(s) : null; }
  acceptsPaste(): boolean { return this.inPty(); }
  /** The last ctrl+] out of a terminal: a second one soon after sends ctrl+] to the program instead. */
  private chord: { pane: PtyPane; at: number } | null = null;

  /** Reader panes by their tile names (PIE-491: an answer names the tile, not its place). */
  private namedReaders(): { name: string; id: number; pane: ReaderPane }[] {
    return this.all().map(id => ({ name: this.nameOf(id), id, pane: this.panes.get(id)! }))
      .filter((r): r is { name: string; id: number; pane: ReaderPane } => r.pane instanceof ReaderPane);
  }

  /** A reader by tile name, id, number (#2), "reader" (the first), "focused", or a block id it shows. No name: the focused reader, else the first. */
  private pickReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.namedReaders();
    if (!all.length) throw new ActionRefused("the screen has no reader tile; add one (ctrl+w o r)");
    if (!sel || sel === "focused" || sel === "reader") return (sel !== "reader" && all.find(r => r.id === this.focus)) || all[0]!;
    const t = this.tileNamed(sel, false);
    const named = t ? all.find(r => r.id === t.id) : undefined;
    if (named) return named;
    if (/^[0-9a-f-]{8,}$/.test(sel)) {
      const showing = all.filter(r => r.pane.msg?.id.startsWith(sel));
      const r = showing.find(x => x.pane.editing) ?? showing[0];
      if (r) return r;
      throw new ActionRefused(`no reader shows ${sel}; open it first (open id=${sel})`);
    }
    throw new ActionRefused(`no reader ${sel} on the desk; readers: ${all.map(r => `${r.name} (#${this.numberOf(r.id)}, ${this.tileId(r.id)})`).join(", ")}, focused, or a block id`);
  }

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
  /** ctrl+e editors still open when the door ends: their files copied to drafts/ (keepEditFile). */
  keepEdits() { return [...this.panes.values()].flatMap(p => p instanceof PtyPane && p.run.temp && p.run.file ? [keepEditFile(p.run.file)].filter((x): x is string => !!x) : []); }
  private drafts() { return [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && p.unsaved()); }
  /** Quitting the door ends the desk's programs: said first, and asked twice (App). Leaving the desk doesn't. */
  leaveWarning(): string | null {
    // An agent attached from Herdr keeps running in its pane when the door quits: nothing of it ends here.
    const r = this.running(true).filter(p => !p.herdr);
    return r.length ? `${r.map(p => p.title()).join(", ")} ${r.length === 1 ? "is" : "are"} running in a tile · quitting ends ${r.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  describe(): Record<string, unknown> {
    const order = this.all();
    return {
      kind: "desk", current: this.current ? { id: this.current.id, title: subject(this.current) } : null, zoom: this.zoom,
      layoutName: this.layoutName, rule: this.rule, focusName: this.nameOf(this.focus), inTerminal: this.inPty() ? this.nameOf(this.focus) : null,
      linking: this.linking ? this.nameOf(this.linking.from) : null,
      dragging: this.dragging ? { tile: this.nameOf(this.dragging.src), drop: this.dragging.drop ? dropView(this.dragging.drop, id => this.nameOf(id)) : null } : null,
      layout: describeTree(this.root, id => String(order.indexOf(id) + 1), this.placeOpts()),
      tree: describeTree(this.root, id => this.nameOf(id), this.placeOpts()),
      floats: this.floats.map(f => ({ tile: this.nameOf(f.id), rect: { ...f.rect } })),
      panes: order.map((id, i) => this.tileView(id, i + 1)),
    };
  }

  private tileView(id: number, n = this.numberOf(id)) {
    const p = this.panes.get(id)!; const r = this.placed.rects.get(id) ?? this.hits.find(([x]) => x === id)?.[1];
    const set = tabsOf(this.root, id);
    const link = this.links.get(id), into = this.linkOf(id);
    const m = this.showing(p);
    return {
      n, name: this.nameOf(id), id: this.tileId(id), kind: p.kind, ...(this.unregistered.has(id) ? { unregistered: this.unregistered.get(id)!.kind } : {}), title: p.title(), focused: id === this.focus, rect: r, shown: visible(this.root).includes(id) || this.isFloat(id),
      ...(this.isFloat(id) ? { float: true } : {}), ...(this.collapsed.has(id) ? { collapsed: true, ...(this.collapsed.get(id)!.by ? { collapsedBy: this.collapsed.get(id)!.by } : {}) } : {}),
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
    const canvas = new Canvas(cols, rows - 1);
    // A view built on the desk may keep rows above the tiles for its own art (the welcome's logo band).
    const top = Math.max(0, Math.min(rows - 6, this.bandRows(cols, rows)));
    const area: Rect = { col: 0, row: top, cols, rows: rows - 2 - top };
    this.area = area;
    this.slid = [];
    const zoomed = this.zoom !== null && this.panes.has(this.zoom);
    this.showSomething();
    if (zoomed) {
      this.placed = { rects: new Map([[this.zoom!, area]]), nodes: new Map(), dividers: [] };
      this.dividers = [];
    } else {
      // The tree, the drawers that slide over it (PIE-505: containers, each from its edge), bottom first.
      const ps = placeScreen<number>({ root: this.root, floats: this.floats }, area, this.placeOpts());
      this.placed = ps;
      // The drawer with the keys is on top of the others sliding out.
      this.slid = [...ps.slid].sort((a, b) => Number(leaves(a.node.kid).includes(this.focus)) - Number(leaves(b.node.kid).includes(this.focus)));
      // A drawer's own border (and those inside it) are over the layout's: grabbed first.
      this.dividers = [...this.slid.flatMap(d => [...(d.divider ? [d.divider] : []), ...d.placed.dividers]).reverse(), ...ps.dividers];
    }
    const docked = [...this.placed.rects];
    // The keys never stay on a tile the room left no cells (a terminal made tiny): the largest tile shown takes them.
    const fr = this.slid.find(d => d.placed.rects.has(this.focus))?.placed.rects.get(this.focus) ?? this.placed.rects.get(this.focus);
    if (fr && (fr.cols <= 0 || fr.rows <= 0) && !this.personTyping()) {
      const best = [...this.slid.flatMap(d => [...d.placed.rects]), ...docked].filter(([, r]) => r.cols > 0 && r.rows > 0).sort(([, a], [, b]) => b.cols * b.rows - a.cols * a.rows)[0];
      if (best) this.focus = best[0];
    }
    // Floats over everything (PIE-511): kept on the screen, the last on top.
    const floats = zoomed ? [] : this.floats.map(f => { this.keepOnScreen(f.rect); return [f.id, f.rect] as [number, Rect]; });
    // For the mouse: the top float first, then the top drawer's tiles, then the layout's.
    this.hits = [...[...floats].reverse(), ...[...this.slid].reverse().flatMap(d => [...d.placed.rects]), ...docked];
    this.heads = []; this.markHits = []; this.spines = []; this.drawerLabels = [];
    let placements: Placement[] = top ? this.drawBand(canvas, { col: 0, row: 0, cols, rows: top }) : [];
    for (const [id, r] of docked) placements.push(...this.drawTile(canvas, id, r));
    for (const d of this.slid) {
      canvas.clear(d.rect, bg(C.black));
      placements = placements.filter(p => !overlaps(p, d.rect));
      for (const [id, r] of d.placed.rects) placements.push(...this.drawTile(canvas, id, r, true));
    }
    for (const [id, r] of floats) {
      const shade: Rect = { ...r, cols: r.cols + 1, rows: r.rows + 1 };
      placements = placements.filter(p => !overlaps(p, shade));
      canvas.clear(r, bg(C.black));
      // A drop shadow on the right and below, then the tile, then its ◢ corner (drag it to size the float).
      for (let y = r.row + 1; y <= Math.min(area.row + area.rows - 1, r.row + r.rows); y++) canvas.text(r.col + r.cols, y, fg(C.dark) + "▒" + RESET, 1);
      if (r.row + r.rows < area.row + area.rows) canvas.text(r.col + 1, r.row + r.rows, fg(C.dark) + "▒".repeat(Math.max(0, Math.min(r.cols, cols - r.col - 1))) + RESET, cols);
      placements.push(...this.drawTile(canvas, id, r, false, true));
      canvas.text(r.col + r.cols - 1, r.row + r.rows - 1, fg(C.yellow) + "◢" + RESET, 1);
    }
    if (this.drawOver(canvas, cols, rows)) placements = [];
    if (this.dragging) this.drawGhost(canvas);
    if (this.search) {
      const r: Rect = { col: Math.floor(cols * 0.1), row: Math.floor(rows * 0.12), cols: Math.floor(cols * 0.8), rows: Math.floor(rows * 0.72) };
      canvas.clear(r, bg(C.black));
      canvas.box(r, fg(C.yellow), `${fg(C.yellow)}search the board`, fg(C.dark) + "↑↓ pick · ⏎ open · esc close");
      this.search.render(r.cols - 2, r.rows - 2).forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, r.cols - 2));
      placements = [];   // images would bleed through the overlay
    }
    if (this.picker) { this.picker.draw(canvas, cols, rows); placements = []; }
    if (this.policyPanel) { this.policyPanel.draw(canvas, cols, rows, this); placements = []; }
    const hint = this.hints(cols);
    if (!this.hintFull) this.hintMoreOpen = false;            // the row fits again: nothing is left to show
    if (this.hintFull && (this.hintMoreOpen || this.prefix)) { this.drawHintMore(canvas, cols, rows); placements = []; }
    canvas.text(0, rows - 2, hint, cols);
    return { lines: canvas.lines(), placements };
  }

  /**
   * Never a blank screen: when every tile is in a shut drawer (a layout saved that way, the docked tiles closed),
   * the drawer holding the keys opens (else the first), so something is shown and the keys are on it.
   */
  private showSomething() {
    if (visible(this.root).length || !leaves(this.root).length) return;
    const d = drawerOf(this.root, this.focus) ?? drawers(this.root).find(x => leaves(x.kid).length);
    if (!d) return;
    for (const c of chainOf(this.root, leaves(d.kid)[0]!)) if (c.t === "drawer") c.open = true;
    if (!visible(this.root).includes(this.focus) && !this.isFloat(this.focus)) this.focus = visible(this.root)[0] ?? this.focus;
  }
  /** How tiles are sized as they're placed: a folded tile (`tile.collapse`) is a spine across a row. */
  protected placeOpts(): PlaceOpts<number> {
    return { fixed: (id, dir) => (dir === "row" && this.collapsed.has(id) ? SPINE : undefined) };
  }
  /** A float's rectangle kept on the screen: never smaller than a float is drawn, never off it. */
  private keepOnScreen(r: Rect) {
    const W = this.area.cols, H = this.area.rows, top = this.area.row;
    // Never smaller than a float is drawn, unless the screen itself is: then the screen.
    r.cols = Math.max(0, Math.min(W, Math.max(FLOAT_MIN.cols, Math.round(r.cols)))); r.rows = Math.max(0, Math.min(H, Math.max(FLOAT_MIN.rows, Math.round(r.rows))));
    r.col = Math.max(0, Math.min(W - r.cols, Math.round(r.col))); r.row = Math.max(top, Math.min(top + H - r.rows, Math.round(r.row)));
  }
  /** A view's own overlays over the tiles (the board's pickers, its composer): true when images should go. */
  protected drawOver(_canvas: Canvas, _cols: number, _rows: number): boolean { return false; }

  /** The desk's own overlay is open (its search, the layout picker, the policy panel): it takes every key and click. */
  protected overlayOpen(): boolean { return !!this.search || !!this.picker || !!this.policyPanel; }
  /** A view's own keys, before the desk's (the board's lanes, its pickers): true when it took the key. */
  protected screenKey(_k: Key, _ctx: Ctx): boolean { return false; }

  /** alt+l is waiting for the tile to link to: its next key (a tile's number, h j k l) is the desk's. */
  protected linkingNow(): boolean { return !!this.linking; }
  /** Rows kept above the tiles for a view's own art (none on the desk itself). */
  protected bandRows(_cols: number, _rows: number): number { return 0; }
  /** Draw the band above the tiles in `r`; its images, if any. */
  protected drawBand(_canvas: Canvas, _r: Rect): Placement[] { return []; }
  /** A view's own hint row while nothing else is going on (a drag, a link, a terminal, a prefix), or null for the desk's. */
  protected screenHint(): string | null { return null; }
  /** A view's own mode that outranks everything (the board's composer, its pickers, a card dragged): its hint, drawn as given. */
  protected overHint(): string | null { return null; }

  /** One tile: its frame, its header (its name, or its tab set's tabs), its body, its placements. */
  private drawTile(canvas: Canvas, id: number, r: Rect, drawer = false, float = false): Placement[] {
    const pane = this.panes.get(id)!;
    const focused = id === this.focus;
    if (this.collapsed.has(id) && r.cols <= SPINE) return this.drawSpineTile(canvas, id, r, focused);
    const inner: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
    const typing = pane === this.ptyIn && focused;
    // The dock's agent pulled up over the screen (PIE-498): drawn there, at one size, and said here.
    const away: PaneView | null = sharedAgent()?.drawnElsewhere(pane) ? { lines: ["", `${fg(C.dark)}  ${this.nameOf(id)} is in the agent drawer below${RESET}`, `${fg(C.dark)}  alt+a or Esc puts it back here${RESET}`] } : null;
    const view = inner.cols >= 1 && inner.rows >= 1 ? (away ?? pane.render(inner.cols, inner.rows, focused, this, typing)) : null;
    // A reader holding a session the person isn't in says how to get in; a long note says how far down it is.
    const held = pane instanceof ReaderPane && pane.holdsKeys && !this.entered.in(pane);
    const more = overflows(view?.scroll) ? `${fg(C.dark)} · ${scrollPct(view!.scroll!)}` : "";
    const marked = this.marksOn(id);
    // A tile may say how its frame looks now (a lane a card is dragged over: what dropping it there would do).
    const own = pane.frameLook?.(focused) ?? null;
    const edgeC = this.linking ? (id === this.linking.from ? C.lmagenta : C.magenta) : this.dragging?.src === id ? C.dark : marked.length ? C.lmagenta : typing ? C.yellow : own?.colour ?? (focused ? C.lcyan : float ? C.yellow : drawer ? C.brown : C.blue);
    // A float's long subject is cut so what it holds and how far down it is still show.
    const tail = (held ? fg(C.dark) + " (e enters)" : "") + more;
    const head = (float ? `${fg(C.yellow)}⧉ ${RESET}` : "") + this.header(id, r, focused, float ? 2 : 0);
    const fits = Math.max(1, r.cols - 5 - width(tail));
    const title = (float && width(head) > fits ? pad(head, fits) : head) + tail;
    const hint = own?.hint ?? (focused ? fg(C.dark) + (held && pane instanceof ReaderPane ? `e ⏎ enter${pane.surface.scrolls() ? " · j k scroll" : ""}` : float && !(pane instanceof ReaderPane && pane.holdsKeys) ? this.floatHint() : pane.hint()) : "");
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
    } else put(`${this.numLabel(id)}${this.panes.get(id)!.headName?.() ?? this.nameOf(id)}`, fg(focused ? C.white : C.grey), id);
    this.putMarks(id, put, xNow, r.row);
    const p = this.panes.get(id)!;
    // A tile that says what follows its name (a lane: its count) says it; a file shown read-only (a preview of
    // one) is named by its title alone.
    const label = p.headLabel?.();
    const what = label !== undefined ? null : p instanceof ReaderPane && p.msg && !p.msg.id.startsWith("file:") ? `${p.title()} · ${subject(p.msg)}` : p.title();
    if (label) put(` ${label}`, "");
    else if (what && what !== this.nameOf(id)) put(` ${what}`, fg(focused ? C.lcyan : C.cyan));
    return this.headerTail(id, put, xNow, r.row);
  }

  /**
   * A tile folded to a spine: its title turned on its side (the tile's own `spine`, else its name), what it holds
   * marked above it. A click on it opens it (`expandSpine`).
   */
  private drawSpineTile(canvas: Canvas, id: number, r: Rect, focused: boolean): Placement[] {
    const p = this.panes.get(id)!;
    const sp = p.spine?.() ?? { title: this.nameOf(id) };
    const out = drawSpine(canvas, r, { key: `spine:${id}`, title: sp.title, colour: focused ? C.white : C.cyan, marks: sp.marks, cellStyle: focused ? bg(C.blue) + fg(C.white) : undefined }, this.ctx);
    this.spines.push([id, r]);
    return out ? [out] : [];
  }

  /** A name the desk gave by kind (reader, reader2): not worth saying before the title. */
  /** Tiles are numbered in their headers (what 1-9 focus), unless the view keeps the digits for itself. */
  private get numbered() { return this.preset?.digits !== false; }
  private numLabel(id: number) { return this.numbered ? `${this.numberOf(id)} ` : ""; }
  private plainName(id: number) { const k = this.panes.get(id)!.kind, n = this.nameOf(id); return n === k || new RegExp(`^${k}\\d+$`).test(n); }

  private headerTail(id: number, put: (text: string, sgr: string, hit?: number) => void, xNow: () => number, row: number): string {
    const link = this.links.get(id);
    if (link !== undefined && this.panes.has(link)) put(` → ${this.nameOf(link)}`, fg(C.lmagenta));
    const dr = drawerOf(this.root, id);
    // A click on it docks the drawer where it is (tile.pin on=true).
    if (dr) { const from = xNow(); put(` ${EDGE_GLYPH[dr.edge]} drawer`, fg(C.brown)); this.drawerLabels.push({ id, row, from: from + 1, to: xNow() }); }
    if (this.linking && id !== this.linking.from) put(" ⌖ click to link here", fg(C.lmagenta));
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
      // A drop the policy refuses is outlined in red, with the reason in place of what it would do.
      const why = d.drop.refused;
      const c = why ? C.lred : C.yellow;
      canvas.box(g, fg(c), `${fg(C.black)}${bg(c)} ${why ? `✕ ${why}` : d.drop.label} ${RESET}`, "");
      if (d.drop.kind === "tabs" && !why) canvas.text(g.col + 1, g.row + 1, `${fg(C.yellow)}${"▀".repeat(Math.max(0, g.cols - 2))}${RESET}`, Math.max(0, g.cols - 2));
    }
    const label = ` ⠿ ${this.nameOf(d.src)} `;
    canvas.text(Math.max(0, Math.min(this.area.cols - label.length, d.x + 1)), Math.min(this.area.rows - 1, d.y + 1), `${bg(C.magenta)}${fg(C.white)}${label}${RESET}`);
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
    lines.slice(0, h - 2).forEach((l, i) => canvas.text(r.col + 2, r.row + 1 + i, l, cols - 4));
  }

  /** `keys.more`: show the whole hint row above it (or put it away); refused when the row isn't cut. */
  keysMore(): { shown: boolean } {
    if (!this.hintFull) throw new ActionRefused("the hint row shows all its keys already");
    this.hintMoreOpen = !this.hintMoreOpen;
    this.redraw();
    return { shown: this.hintMoreOpen };
  }

  /** A float's frame hint, with this screen's keys for docking and closing it (the board has its own o and x). */
  protected floatHint(): string { return "drag title · drag ◢ · H J K L move · ^W f dock · ^W x close"; }

  protected hints(cols: number): string {
    const rd = this.panes.get(this.focus);
    // The drawers slid shut, as handles at the end of the row (its edge, what it holds): a click opens one, and a
    // tile dropped on one goes into it. Then the lock chip: a click locks or unlocks the screen (layout.lock).
    // A drawer holding a named container reads by its name (the board's outline); else by its tiles'.
    const handles = this.shutDrawers().map(d => ({ id: leaves(d.kid)[0]!, drawer: d, text: ` ${EDGE_GLYPH[d.edge]} ${isLine(d.kid) && d.kid.key ? d.kid.key : shown(d.kid).map(i => this.nameOf(i)).join("+")} ` }));
    const locked = this.screenLocked();
    const chip = !this.preset || locked ? (locked ? " ▣ locked " : " □ lock ") : "";
    const hw = handles.reduce((a, h) => a + width(h.text) + 1, 0) + (chip ? width(chip) + 1 : 0);
    this.handles = [];
    let x = cols - hw;
    let tail = "";
    for (const h of handles) { const hw = width(h.text); this.handles.push({ id: h.id, drawer: h.drawer, from: x, to: x + hw }); tail += `${bg(C.brown)}${fg(C.white)}${h.text}${RESET} `; x += hw + 1; }
    this.lockChip = chip ? { from: x, to: x + width(chip) } : null;
    if (chip) tail += `${locked ? bg(C.yellow) + fg(C.black) : fg(C.dark)}${chip}${RESET} `;
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
    const line = (s: string) => pad(fit(s), room) + tail;
    // A view's own mode (the board's composer, a card being dragged) says its keys first.
    const over = this.overHint();
    if (over !== null) return line(over);
    if (this.dragging) {
      const why = this.dragging.drop?.refused;
      return line(paint(`|14dragging ${this.nameOf(this.dragging.src)}|08 · ${why ? `|12✕ ${why}` : this.dragging.drop ? `|15${this.dragging.drop.label}` : "|08nowhere here"}|08 · a header or the centre makes tabs, a side splits, the outer edge makes a column, a drawer's handle puts it in the drawer · release drops · esc cancels`));
    }
    if (this.linking) return line(paint(`|13alt+l|08 · click the tile where |15${this.nameOf(this.linking.from)}|08's opens land (or h j k l, or its number) · click it again to unlink · esc cancels`));
    if (this.inPty() && !this.ptyIn!.running) return line(paint(`|12${this.nameOf(this.focus)} exited|08 · |15⏎|08 runs it again · |15${ESCAPE_CHORD}|08 back to the door · other keys wait`));
    if (this.inPty()) return line(paint(`|14in ${this.nameOf(this.focus)}|08 · every key goes to ${this.ptyIn!.title()} · |15${ESCAPE_CHORD}|08 back to the door (twice: send it)`));
    if (!this.prefix && rd instanceof ReaderPane && rd.holdsKeys && !this.collapsed.has(this.focus)) {
      const where = `${this.readerLabel(this.focus)} · ${rd.surface.state()}`;
      return line(this.entered.in(rd)
        ? paint(`|14 ${where}|08 · `) + fg(C.grey) + rd.hint() + RESET
        : paint(`|14 ${where}|08 · |15e ⏎|08 enter ${sessionName(rd)}${rd.surface.scrolls() ? " · |15j k|08 scroll" : ""} · |15Tab/1-9|08 focus · |15^W|08 window`));
    }
    const leaving = this.prefix === "wm" && !!this.personIn()?.editing ? `|14${sessionName(this.personIn()!)}: the next key leaves it (saved, or kept as unsent) · |07esc |08stays · ` : "";
    const s = this.prefix === "wm"
      ? leaving + "|14^W |07hjkl |08focus · |07m |08move · |07t |08into tabs · |07T |08tab out · |07HJKL |08to an edge · |07[ ] |08tabs · |07< > + - = |08size · |07z |08zoom · |07o O |08open · |07v |08preview · |07p |08drawer in/out · |07d |08slide · |07c |08spine · |07f |08float · |07P |08policy · |07r w |08layouts · |07x |08close · |07s |08swap · |07! |08shell"
      : this.prefix === "add" || this.prefix === "addtab"
        ? `|14${this.prefix === "add" ? "open beside" : "open as a tab"}: ${tileKinds().flatMap(k => (k.keys ?? []).map(x => `|07${x.key} |08${x.label}`)).join(" · ")}`
        : this.prefix === "move" || this.prefix === "tab"
          ? `|14${this.prefix === "move" ? "move beside" : "into the tabs of"}: |07h j k l |08the tile that way${this.prefix === "move" ? " (none that way: to the edge)" : ""}`
          : this.screenHint() ?? `|08 Tab/1-9 focus · |15^W|08 window · |15drag|08 a title moves, a border resizes · |15alt+l|08 link · ${this.preset ? "" : "|15alt+d|08 daily · "}|15alt+k|08 ${this.screenLocked() ? "unlock" : "lock"} · |15/|08 search · |15q|08 menu${this.layoutName ? ` · |03${this.layoutName}` : ""}${this.zoom !== null ? " · |14zoomed" : ""}${this.current ? ` · |03${headOf(subject(this.current), 40)}` : ""}`;
    return line(paint(s));
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** The focused pane, when it's a reader. */
  protected focusedReader(): ReaderPane | null { const p = this.panes.get(this.focus); return p instanceof ReaderPane ? p : null; }
  /** The focused reader, when the person is in its edit, comment or property panel. */
  protected personIn(): ReaderPane | null { const p = this.focusedReader(); return p?.holdsKeys && this.entered.in(p) ? p : null; }

  /** Start a session in a reader as the person's key does (⏎ or a click on a comment mark). */
  startSession(rd: ReaderPane, kind: SessionKind) { this.start(rd, kind); }

  protected start(rd: ReaderPane, kind: SessionKind) {
    // Esc, or leaving the desk, while the note is read cancels it: the token is cleared and nothing opens.
    const token = { pane: rd };
    this.pending = token;
    const still = () => this.pending === token && this.focusedReader() === rd && !this.search;
    const opened = (open: boolean) => {
      const want = still();
      if (this.pending === token) this.pending = null;
      if (open && want) { this.entered.enter(rd); this.ctx.flash(`${this.readerLabel(this.focus)} · ${rd.surface.state()} · ${rd.hint()}`); }
      this.redraw();
    };
    const r = startSession(rd, kind, this, still);
    const said = (e: unknown) => this.ctx.flash(e instanceof Error ? e.message : String(e));
    // The property panel, or a thread list whose comments are already read, opens at once: the next key is already its.
    if (rd.sessionOf()) { opened(true); r.catch(said); }
    else r.then(opened, said);
  }

  key(k: Key, ctx: Ctx): void {
    // ? shows the whole hint row when it was cut (never while the person is typing: a draft, a filter, a
    // terminal, a ^W chord); the next key or click puts it away again and does what it does, but Esc only that.
    if (k.kind === "char" && !k.ctrl && k.ch === "?" && this.hintFull && !this.personTyping()) { this.cmd("keys.more"); return; }
    if (this.hintMoreOpen) {
      const chip = k.kind === "mouse" && this.moreChip && k.y === this.area.row + this.area.rows && k.x >= this.moreChip.from && k.x < this.moreChip.to;
      if (k.kind !== "mouse" || (k.action === "down" && !chip)) { this.hintMoreOpen = false; this.redraw(); if (k.kind === "esc") return; }
    }
    if (!this.screenKey(k, ctx)) this.keyIn(k, ctx);
    this.entered.follow(this.focusedReader());          // moving away leaves a session; e or ⏎ enters it again
    for (const [id, p] of this.panes) if (id !== this.focus && p.typing?.()) p.blur?.();
    if (this.ptyIn && this.panes.get(this.focus) !== this.ptyIn) this.ptyIn = null;
    // A drawer sliding over shuts when the keys go elsewhere (tile.drawer, as its key and an agent do it); one
    // that takes its room, or can't collapse, stays.
    if (!this.dragging && !this.headPress) for (const d of drawers(this.root)) {
      if (!d.open || d.policy?.overlay === false || d.policy?.stays || !leaves(d.kid).length || leaves(d.kid).includes(this.focus)) continue;
      if (!this.effectiveAt(d).collapsible) continue;
      this.cmd("tile.drawer", { open: false, container: d.id }, this.nameOf(leaves(d.kid)[0]!));
    }
  }

  private keyIn(k: Key, ctx: Ctx) {
    if (this.search) {
      if (this.search.key(k, this) === "close") this.search = null;
      return this.redraw();
    }
    if (this.picker) { this.picker.key(k, this); return this.redraw(); }
    if (this.policyPanel) { this.policyPanel.key(k, this); return this.redraw(); }
    // In a terminal tile: every key is the program's, but the escape chord and the mouse. Once the program
    // has exited, the keys wait for a choice (⏎ runs it again, ctrl+] leaves) and nothing leaks to the desk.
    if (this.inPty() && k.kind !== "mouse") {
      const p = this.ptyIn!;
      if (isEscapeChord(k)) return this.cmd("tile.leave", {}, this.nameOf(this.focus));
      if (!p.running) { if (k.kind === "enter") this.cmd("tile.restart", {}, this.nameOf(this.focus)); else ctx.flash(`${this.nameOf(this.focus)} exited · ⏎ runs it again · ctrl+] back to the door`); return this.redraw(); }
      if (k.kind === "paste") p.paste(k.text); else p.typed(k);
      return;
    }
    // ctrl+] twice: the second goes to the program (a literal ctrl+], telnet's own escape).
    if (isEscapeChord(k) && this.chord && Date.now() - this.chord.at < 1500 && this.panes.get(this.focus) === this.chord.pane && this.chord.pane.running && !this.inDrawer(this.chord.pane, false)) {
      this.chord = null;
      return this.cmd("tile.enter", { send: "\x1d" }, this.nameOf(this.focus));
    }
    // A board, river or brief tile in its own edit, comment or panel: every key is its, the desk's included.
    const held = this.panes.get(this.focus);
    if (held && kindOf(held)?.takesKeys?.(held) && k.kind !== "mouse") { held.key(k, this); return; }
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
      if (k.ch === "k") return this.cmd("layout.lock");
    }
    if (k.kind === "tab" || k.kind === "backtab") {
      const ids = this.zoom !== null ? [this.zoom] : [...visible(this.root), ...this.floats.map(f => f.id)];
      const i = ids.indexOf(this.focus);
      return this.cmd("tile.focus", {}, this.nameOf(ids[(i + (k.kind === "tab" ? 1 : ids.length - 1)) % ids.length]!));
    }
    const pane = this.panes.get(this.focus);
    const c0 = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A spine has the keys: ⏎ or space opens it; its own keys don't reach what it holds out of sight.
    if (this.collapsed.has(this.focus)) {
      if (k.kind === "enter" || c0 === " ") return this.expandSpine(this.focus);
      if (k.kind === "char" && !k.ctrl && !/^[1-9q/V]$/.test(c0)) { this.ctx.flash(`${this.nameOf(this.focus)} is folded to a spine · ⏎ or a click opens it`); return; }
    }
    // A float has the keys: H J K L move it (float.place), as dragging its title does.
    if (this.isFloat(this.focus) && "HJKL".includes(c0) && c0 && !focused?.holdsKeys) return this.cmd("float.place", { dx: c0 === "H" ? -4 : c0 === "L" ? 4 : 0, dy: c0 === "K" ? -2 : c0 === "J" ? 2 : 0 }, this.nameOf(this.focus));
    // A key its kind gives an action of its own (a terminal the person isn't in: ⏎ or e starts typing in it).
    const pressed = pane ? kindOf(pane)?.press?.(pane, k) : null;
    if (pressed) return this.cmd(pressed.action, pressed.args ?? {}, this.nameOf(this.focus));
    const readOnly = pane instanceof ReaderPane && pane.readOnly;
    const start = focused && !focused.holdsKeys && focused.msg && !readOnly ? sessionStart(k) : null;
    if (focused && start) return this.start(focused, start);
    if (!focused?.holdsKeys && pane?.key(k, this)) return;
    if (k.kind === "char" && !k.ctrl) {
      if (k.ch === "/") return this.cmd("search");
      if (k.ch === "V") return this.shell("video.cycle");
      if (/^[1-9]$/.test(k.ch) && this.numbered) { const id = this.all()[Number(k.ch) - 1]; if (id !== undefined) return this.cmd("tile.focus", {}, this.nameOf(id)); return; }
      if (k.ch === "q") { this.pending = null; return this.shell("screen.back"); }
    }
    if (k.kind === "esc") {
      if (this.zoom !== null) return this.cmd("tile.zoom", { on: false }, String(this.numberOf(this.zoom)));
      const d = drawerOf(this.root, this.focus);
      if (d?.open && d.policy?.overlay !== false && this.effectiveAt(d).collapsible) return this.cmd("tile.drawer", { open: false }, this.nameOf(this.focus));
      this.pending = null; return this.shell("screen.back");
    }
  }

  /** alt+l, then a key: h j k l (the tile that way), a tile's number, or esc. */
  private linkKey(k: Key) {
    const from = this.linking!.from;
    this.linking = null;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (k.kind === "esc") { this.ctx.flash("not linked"); return this.redraw(); }
    const to = MOVE[c] ? neighbour(this.rectsNow(), from, MOVE[c]!) : /^[1-9]$/.test(c) ? this.all()[Number(c) - 1] ?? null : null;
    if (to === null || to === undefined) { this.ctx.flash("not linked: alt+l, then click a tile, h j k l, or its number"); return this.redraw(); }
    this.cmd("tile.link", to === from ? {} : { to: this.nameOf(to) }, this.nameOf(from));
  }

  private command(k: Key) {
    const mode = this.prefix;
    this.prefix = "";
    // A ctrl+letter isn't the letter: ^W then ctrl+x closes nothing.
    const c = k.kind === "char" && !k.ctrl ? k.ch : k.kind === "left" ? "h" : k.kind === "right" ? "l" : k.kind === "up" ? "k" : k.kind === "down" ? "j" : "";
    const me = this.nameOf(this.focus);
    if (mode === "add" || mode === "addtab") {
      // The kind under that key, from the registry (an extension's kind with a key is here too).
      const hit = kindForKey(c);
      if (!hit) return this.redraw();
      const s0 = hit.key.spec?.({ name: me, pane: this.panes.get(this.focus)! }) ?? {};
      const extra: Partial<NewTile> = { ...(s0.cmd ? { cmd: s0.cmd.join(" ") } : {}), ...(s0.file ? { file: s0.file } : {}), ...(s0.source ? { source: s0.source } : {}), ...(s0.view ? { view: s0.view } : {}), ...(s0.name ? { name: this.idNamed(s0.name) === undefined ? s0.name : this.autoName(s0.name) } : {}) };
      return this.cmd("tile.open", { kind: hit.kind.kind, ...extra, where: mode === "addtab" ? "tabs" : "right" }, me);
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
    if (c === "<" || c === ">") return this.cmd("tile.resize", { by: c === ">" ? 1 : -1, axis: "row" }, String(this.numberOf(this.focus)));
    if (c === "+" || c === "-") return this.cmd("tile.resize", { by: c === "+" ? 1 : -1, axis: "col" }, String(this.numberOf(this.focus)));
    if (c === "z") return this.cmd("tile.zoom", {}, String(this.numberOf(this.focus)));
    if (c === "x") { const why = this.closeRefused(this.focus, USER); if (why) { if (why.flash) this.ctx.flash(why.why); return this.redraw(); } return this.cmd("tile.close", {}, me); }
    if (c === "o") { this.prefix = "add"; return this.redraw(); }
    if (c === "O") { this.prefix = "addtab"; return this.redraw(); }
    if (c === "m") { this.prefix = "move"; return this.redraw(); }
    if (c === "t") { this.prefix = "tab"; return this.redraw(); }
    if (c === "T") { if (!tabsOf(this.root, this.focus)) { this.ctx.flash(`${me} isn't in a tab set`); return this.redraw(); } return this.cmd("layout.move", { to: me, where: "right" }, me); }
    if (c === "]" || c === "[") return this.cmd("tab.select", { by: c === "]" ? 1 : -1 }, me);
    if (c === "v") return this.cmd("tile.preview", {}, me);
    if (c === "p") return this.cmd("tile.pin", {}, me);
    if (c === "c") return this.cmd("tile.collapse", {}, me);
    if (c === "f") return this.cmd("tile.float", {}, me);
    if (c === "P") { this.policyPanel = new PolicyPanel(this.focus); return this.redraw(); }
    if (c === "d") {
      const shutOne = this.shutDrawers().at(-1);
      if (drawerOf(this.root, this.focus)?.open) return this.cmd("tile.drawer", { open: false }, me);
      if (shutOne) return this.cmd("tile.drawer", { open: true, container: shutOne.id }, this.nameOf(leaves(shutOne.kid)[0]!));
      this.ctx.flash("no drawers · ^W p puts this tile in one"); return this.redraw();
    }
    if (c === "r") { this.picker = new LayoutPicker("load", layoutNames()); return this.redraw(); }
    if (c === "w") { this.picker = new LayoutPicker("save", layoutNames(), this.layoutName ?? ""); return this.redraw(); }
    if (c === "=") return this.cmd("layout.even");
    // Drop to shell (`screen.shell`), the menu's `!`: loaded when pressed, as screens.ts imports this module.
    if (c === "!") { void import("../screens").then(m => m.dropToShell(this, this.ctx)); return; }
    if (c === "s") {
      // The next tile in the tree (a float isn't in it: the swap says so).
      const ids = leaves(this.root), i = ids.indexOf(this.focus), j = this.isFloat(this.focus) ? ids[0]! : ids[(i + 1) % ids.length]!;
      return j !== this.focus ? this.cmd("layout.swap", { to: this.nameOf(j) }, me) : this.redraw();
    }
    this.redraw();
  }

  /** Run an action by name as the person (the layout picker's ⏎, the policy panel's rows). */
  run(name: string, args: Record<string, unknown>, reader?: string) { this.cmd(name, args, reader); }
  closePicker() { this.picker = null; }
  closePolicy() { this.policyPanel = null; }

  /** The policy panel's containers over tile `tile`: the screen, then each one down to it. */
  policyNodes(tile: number): { label: string; node: Container | null }[] {
    if (!this.panes.has(tile)) return [{ label: "screen", node: null }];
    return [{ label: "screen", node: null }, ...chainOf(this.root, tile).map(c => ({ label: `${c.t === "split" ? `${c.dir} split` : c.t === "columns" ? "columns" : c.t === "tabs" ? "tabs" : `${c.edge} drawer`} ${c.id ?? ""}`.trim(), node: c }))];
  }

  /**
   * The policy panel's rows for container `node` (null: the screen): each field, what it is now, and what ⏎ or a
   * click does (the same `layout.policy`, `layout.lock` or `tile.pin` an agent calls); `adjust` is + and -.
   */
  policyRows(tile: number, node: Container | null): { label: string; value: string; run?: () => void; adjust?: (by: number) => void }[] {
    const own: Policy = node ? node.policy ?? {} : this.screenPolicy;
    const at = node ? this.effectiveAt(node) : effective([{ by: "screen", policy: this.screenPolicy }]);
    const id = node ? node.id ?? "" : "screen";
    const tname = this.nameOf(tile);
    const set = (args: Record<string, unknown>) => this.cmd("layout.policy", { node: id, ...args }, tname);
    const onOff = (b: boolean) => (b ? "on" : "off");
    const flag = (k: "draggable" | "droppable" | "closable" | "resizable" | "collapsible", about: string) => ({
      label: `${k} · ${about}`, value: own[k] === undefined ? `${onOff(at[k])} (from ${at.by[k] ?? "the default"})` : onOff(own[k]!),
      // Cycles: from above → off → on → from above.
      run: () => (own[k] === undefined ? set({ [k]: false }) : own[k] === false ? set({ [k]: true }) : set({ clear: k })),
    });
    const rows: ReturnType<Desk["policyRows"]> = [{
      label: "locked · the shape is fixed, the contents live", value: own.locked ? "on" : at.locked ? `on (from ${at.by.locked})` : "off",
      run: () => (node ? set({ locked: !own.locked }) : this.cmd("layout.lock")),
    }, flag("draggable", "its tiles move out"), flag("droppable", "it takes tiles"), flag("closable", "its tiles close"), flag("resizable", "its borders move")];
    const kinds = [...new Set((node ? leaves(node) : this.all()).map(i => this.panes.get(i)!.kind))];
    rows.push({ label: "accepts · the tile kinds it takes", value: own.accepts ? own.accepts.join(", ") || "nothing" : at.accepts ? `${at.accepts.join(", ")} (from ${at.by.accepts})` : "any", run: () => (own.accepts ? set({ clear: "accepts" }) : set({ accepts: kinds.join(",") })) });
    const notes = this.all().filter(i => kindOf(this.panes.get(i))?.accepts?.notes && !(node && leaves(node).includes(i))).map(i => this.nameOf(i));
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
      rows.push({ label: "edge · where it slides from", value: node.edge, run: () => this.cmd("tile.pin", { edge: order[(order.indexOf(node.edge) + 1) % 4] }, this.nameOf(leaves(node.kid)[0]!)) });
    }
    return rows;
  }
  /** A container's size along its parent's axis now, in cells (for the panel's size rows). */
  private cellsOf(node: Container): number {
    const rects = this.rectsNow(), p = parentNodeOf(this.root, node);
    const rs = leaves(node).map(i => rects.get(i)).filter((r): r is Rect => !!r);
    if (!rs.length) return 10;
    const across = !p || p.parent.dir === "row";
    return across ? Math.max(...rs.map(r => r.col + r.cols)) - Math.min(...rs.map(r => r.col)) : Math.max(...rs.map(r => r.row + r.rows)) - Math.min(...rs.map(r => r.row));
  }

  // ── tile operations (TILE_ACTIONS): the keys, the mouse and `act` all come here ──

  /**
   * A tile by name, id (`t4`), number on screen (`#3`, or `3`: a name is never digits, so they can't clash) or
   * "focused"; none named: the focused one. A number is where the tile is now; `expected=` checks it's still so.
   */
  protected tileNamed(sel: string | undefined, refuse = true): { name: string; id: number } | null {
    const ids = this.all();
    if (!sel || sel === "focused") return { name: this.nameOf(this.focus), id: this.focus };
    const byName = this.idNamed(sel);
    if (byName !== undefined) return { name: sel, id: byName };
    const tid = /^t(\d+)$/.exec(sel);
    const num = /^#?([1-9][0-9]*)$/.exec(sel);
    const id = tid ? ids.find(i => i === Number(tid[1])) : num ? ids[Number(num[1]) - 1] : undefined;
    if (id !== undefined) return { name: this.nameOf(id), id };
    if (!refuse) return null;
    throw new ActionRefused(`no tile ${sel}; tiles: ${ids.map(i => `#${this.numberOf(i)} ${this.nameOf(i)} (${this.tileId(i)})`).join(", ")}, or focused`);
  }
  protected tile(sel: string | undefined) { return this.tileNamed(sel)!; }

  /**
   * Where each tile is right now, placed from the tree as it is (not as last painted: paints are coalesced, and
   * a key that follows a change within a frame must see the change).
   */
  protected rectsNow(): Map<number, Rect> {
    if (this.zoom !== null && this.panes.has(this.zoom)) return new Map([[this.zoom, this.area]]);
    const ps = placeScreen<number>({ root: this.root, floats: this.floats }, this.area, this.placeOpts());
    const out = new Map(ps.rects);
    for (const d of ps.slid) for (const [id, r] of d.placed.rects) out.set(id, r);
    for (const f of this.floats) out.set(f.id, { ...f.rect });
    return out;
  }

  // ── policy (PIE-505): what each container allows, and the refusals that say so ──

  /** The policy layers over tile `id`: the screen's, each container's down to it, then its kind's default. */
  private layers(id: number): { by: string; policy?: Policy }[] {
    const p = this.panes.get(id);
    return [{ by: "screen", policy: this.screenPolicy }, ...chainOf(this.root, id).map(c => ({ by: c.id ?? c.t, policy: c.policy })), { by: `${p?.kind ?? "tile"} tiles`, policy: kindOf(p)?.policy }];
  }
  /** What applies to tile `id`. */
  protected policyAt(id: number): Effective { return effective(this.layers(id)); }
  /** What applies to container `c` (its own policy and those above it). */
  private effectiveAt(c: Container): Effective {
    const first = leaves(c)[0];
    const chain = first !== undefined ? chainOf(this.root, first) : [];
    const upto = chain.indexOf(c);
    return effective([{ by: "screen", policy: this.screenPolicy }, ...(upto >= 0 ? chain.slice(0, upto + 1) : [c]).map(x => ({ by: x.id ?? x.t, policy: x.policy }))]);
  }
  /** The whole screen is locked (its own policy). */
  screenLocked(): boolean { return !!this.screenPolicy.locked; }
  /** Why a locked layer refuses `what`, with how to unlock it. */
  private lockedWhy(e: Effective, what: string): string { return e.by.locked === "screen" ? `the screen is locked: ${what} is refused · ${UNLOCK}` : `${e.by.locked} is locked: ${what} is refused · ^W P (or layout.policy node=${e.by.locked} locked=false) unlocks it`; }
  /** Refuse with `why`, when there is one. */
  protected refuse(why: string | null) { if (why) throw new ActionRefused(why); }
  /** Why the shape can't change around tile `id` (it, or a container over it, is locked): `what` names the change. */
  protected shapeRefusal(id: number, what: string): string | null { const e = this.policyAt(id); return e.locked ? this.lockedWhy(e, what) : null; }

  /**
   * The one rule for floats (PIE-511): a float has no place in the tree, so nothing goes beside it or into its
   * tabs, it swaps with nothing, and it doesn't fold or go in a drawer, until it's docked. Every action that needs
   * a tile's place in the tree asks this (through `intoRefusal` for a target); `what` names the action.
   */
  protected floatRefusal(id: number, what: string): string | null {
    return this.isFloat(id) ? `${this.nameOf(id)} is a float: ${what} needs a tile in the layout · ^W f (o on the board) or a click on its ⧉ docks it first` : null;
  }
  /**
   * Why tile `id` can't close: a container over it keeps its tiles (closable off), or a tile source supplied it
   * (the board's lanes: it goes when its data does, and a refill would bring it back). It folds to a spine instead, when it may.
   */
  protected closeRefusal(id: number): string | null {
    const e = this.policyAt(id);
    const fold = e.collapsible ? " · tile.collapse folds it to a spine" : "";
    if (!e.closable) return `${this.nameOf(id)} stays: ${e.by.closable === "screen" ? "the screen" : e.by.closable} keeps its tiles (closable off)${fold}`;
    const src = this.sourced.get(id);
    if (src) { const how = tileSource(src.source)?.source.drop; return `${this.nameOf(id)} stays: ${src.source} supplies it, and it goes when its data does${how ? ` · to drop it, ${how}` : ""}${fold}`; }
    return null;
  }
  /** Why tile `src` can't leave where it is: locked, or its container keeps its tiles (draggable off). */
  protected dragRefusal(src: number): string | null {
    const e = this.policyAt(src);
    if (e.locked) return this.lockedWhy(e, `moving ${this.nameOf(src)}`);
    if (!e.draggable) return `${this.nameOf(src)} stays where it is: ${e.by.draggable === "screen" ? "the screen" : e.by.draggable} keeps its tiles (draggable off)`;
    return null;
  }
  /**
   * Why a tile of `kind` can't go into the place `to` names: the container there is locked, takes no drops, or
   * takes only other kinds; or the tile it would join as a tab takes only other kinds.
   */
  private intoRefusal(kind: string, name: string, to: Place<number>): string | null {
    // An edge: the screen and the root. Beside a tile: the containers it would join (the target's chain, not its
    // tab set or kind, which it doesn't join). Into its tabs: everything over the target.
    if (to.kind !== "edge") { const f = this.floatRefusal(to.target, `putting ${name} ${to.kind === "tabs" ? "into its tabs" : "beside it"}`); if (f) return f; }
    const chain = to.kind === "edge" ? (this.root.t !== "leaf" ? [this.root] : []) : chainOf(this.root, to.target);
    const joins = to.kind === "split" && chain.at(-1)?.t === "tabs" ? chain.slice(0, -1) : chain;
    const e = to.kind === "tabs" ? this.policyAt(to.target) : effective([{ by: "screen", policy: this.screenPolicy }, ...joins.map(c => ({ by: c.id ?? c.t, policy: c.policy }))]);
    const there = to.kind === "edge" ? `the ${to.dir} edge` : this.nameOf(to.target);
    if (e.locked) return this.lockedWhy(e, `putting ${name} by ${there}`);
    if (!e.droppable) return `${e.by.droppable === "screen" ? "the screen" : e.by.droppable} takes no drops (droppable off): ${name} can't go by ${there}`;
    if (e.accepts && !e.accepts.includes(kind)) return `${e.by.accepts === "screen" ? "the screen" : e.by.accepts} takes only ${e.accepts.join(", ") || "nothing"}: not ${name} (${kind})`;
    const t = to.kind === "tabs" ? kindOf(this.panes.get(to.target)) : undefined;
    if (t?.accepts?.tiles && !t.accepts.tiles.includes(kind)) return `${there} (${t.kind}) takes only ${t.accepts.tiles.join(", ") || "no tiles"} as tabs: not ${name} (${kind})`;
    return null;
  }
  /** Why a drop of `src` at `d` is refused (drop.ts carries it to the ghost and the hint row before the release). */
  private dropRefusal(src: number, d: Place<number>): string | null {
    return this.dragRefusal(src) ?? this.intoRefusal(this.panes.get(src)?.kind ?? "tile", this.nameOf(src), d);
  }
  /** Why a border of split `n` can't move: locked, not resizable, or a kid beside it has a fixed size. */
  private resizeRefusal(n: Container, border?: number): string | null {
    const e = this.effectiveAt(n);
    if (e.locked) return this.lockedWhy(e, "resizing");
    if (!e.resizable) return `${e.by.resizable === "screen" ? "the screen" : e.by.resizable} keeps its sizes (resizable off)`;
    if (isLine(n) && border !== undefined) for (const k of [n.kids[border], n.kids[border + 1]]) if (k && k.t !== "leaf" && k.policy?.resizable === false) return `${k.id ?? k.t} keeps its size (resizable off)`;
    if (isLine(n) && border !== undefined) for (const k of [n.kids[border], n.kids[border + 1]]) if (k && k.t !== "leaf" && k.policy?.fixed !== undefined) return `${k.id ?? k.t} is fixed at ${k.policy.fixed} cells (layout.policy node=${k.id} fixed=-1 frees it)`;
    return null;
  }
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

  /**
   * The one rule for agents and the person's keys: an agent's action moves the person's focus only when they
   * aren't typing (an edit, a comment, the property panel, a terminal, a screen tile's own edit, a picker).
   * Every agent path that would move the focus, or take away the tile that has it, asks this first.
   */
  protected mayMoveKeys(actor: Actor, what: string) {
    if (actor.kind === "agent" && this.personTyping()) throw new ActionRefused(`the person is typing; an agent doesn't ${what} (block.mark gets their attention)`);
  }

  /** What an agent may not do to the tile the person is typing in: close it, move it. */
  protected guard(id: number, actor: Actor, what: string) {
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
    this.refuse(this.dragRefusal(src.id) ?? this.intoRefusal(this.panes.get(src.id)!.kind, src.name, place));
    // A float moved into the tree docks there: it isn't a float any more.
    if (this.isFloat(src.id)) {
      this.floats = this.floats.filter(f => f.id !== src.id);
      this.root = normalise(putAt(this.root, src.id, place));
      if (actor.kind !== "agent") this.focus = src.id;
      this.save(); this.redraw();
      return { tile: src.name, where, ...(to ? { to } : {}), tree: describeTree(this.root, id => this.nameOf(id)) };
    }
    const next = move(this.root, src.id, place);
    if (!next) throw new ActionRefused(`${src.name} can't go there: ${leaves(this.root).length < 2 ? "it's the only tile" : "that's where it is"}`);
    // Into a drawer, or beside a tile in one, it lives in that drawer (the tree's own move); out of one, it's docked.
    this.root = next;
    // A spine moved where it isn't side by side with others opens.
    if (this.collapsed.has(src.id) && parentOf(this.root, src.id)?.parent.dir !== "row") { this.collapsed.delete(src.id); this.panes.get(src.id)?.folded?.(false); }
    // Moved into a shut drawer (its handle), the drawer opens for the person; an agent's leaves it as it was.
    // An agent's move of the tile the person has into a shut drawer opens it too: their tile never vanishes.
    const wasShown = visible(this.root);
    for (const c of chainOf(this.root, src.id)) if (c.t === "drawer" && !c.open && (actor.kind !== "agent" || src.id === this.focus)) c.open = true;
    activate(this.root, src.id);
    // An agent's move into the tabs the person has open leaves their tab shown.
    if (actor.kind === "agent" && wasShown.includes(this.focus) && !shown(this.root).includes(this.focus)) activate(this.root, this.focus);
    this.zoom = null;
    if (actor.kind !== "agent") this.focus = src.id;
    this.save(); this.redraw();
    return { tile: src.name, where, ...(to ? { to } : {}), tree: describeTree(this.root, id => this.nameOf(id)) };
  }

  async openTile(t: NewTile, at: string | undefined, where: Where, actor: Actor): Promise<TileDone> {
    const k = kindOf({ kind: t.kind } as Pane);
    if (!k || !isTileKind(t.kind)) throw new ActionRefused(`tile.open: kind is ${tileKindNames().join(", ")}, not ${t.kind}`);
    const bad = t.name !== undefined ? tileNameProblem(t.name) : null;
    if (bad) throw new ActionRefused(`tile.open: ${bad}`);
    if (t.name && this.idNamed(t.name) !== undefined) throw new ActionRefused(`there's already a tile named ${t.name}`);
    const base = this.tile(at);
    let spec: TileSpec = { t: "leaf", kind: t.kind, name: t.name, ...(t.cmd ? { cmd: splitWords(t.cmd) } : {}), ...(t.file ? { file: t.file } : {}), ...(t.source ? { source: t.source } : {}), ...(t.note ? { note: t.note } : {}), ...(t.page ? { page: t.page } : {}), ...(t.cwd ? { cwd: t.cwd } : {}), ...(t.view ? { view: t.view } : {}) };
    // The kind checks its fields (a preview's source) and fills what it starts with (it follows `at`).
    const wrong = k.check?.(spec);
    if (wrong) throw new ActionRefused(`tile.open: ${wrong}`);
    spec = { ...spec, ...(k.defaults?.(spec, { name: base.name, pane: this.panes.get(base.id)! }) ?? {}) };
    const place: Place<number> = where === "tabs" ? { kind: "tabs", target: base.id } : where.startsWith("edge-") ? { kind: "edge", dir: where.slice(5) as Dir } : { kind: "split", target: base.id, dir: where as Dir };
    this.refuse(this.intoRefusal(t.kind, t.name ?? `a new ${t.kind} tile`, place));
    const id = this.put(makeTile(spec), t.name);
    const wasShown = shown(this.root);
    this.root = normalise(putAt(this.root, id, place));
    // An agent's new tab is added without being shown over the tab the person has there.
    if (actor.kind === "agent" && wasShown.includes(this.focus) && !shown(this.root).includes(this.focus)) activate(this.root, this.focus);
    this.zoom = null;
    this.startTile(id);
    if (actor.kind !== "agent") this.focus = id;
    this.save(); this.redraw();
    return { tile: this.nameOf(id), id: this.tileId(id), kind: t.kind, n: this.numberOf(id), beside: base.name, where };
  }

  closeTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    // A tile that stays says so first, to anyone: its container's rule, not who asked.
    this.refuse(this.shapeRefusal(t.id, `closing ${t.name}`) ?? this.closeRefusal(t.id));
    const why = this.closeRefused(t.id, actor);
    if (why) throw new ActionRefused(why.why);
    // Closing a tile with a program running ends the program: the person is asked twice, as quitting does.
    const pty = this.panes.get(t.id);
    if (pty instanceof PtyPane && pty.running && !this.isShared(pty)) {
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
    this.refuse(this.shapeRefusal(src.id, `changing where ${src.name}'s opens land`));
    if (!to) { this.links.delete(src.id); this.save(); this.redraw(); return { tile: src.name, link: null }; }
    const dst = this.tile(to);
    if (dst.id === src.id) throw new ActionRefused(`${src.name} can't open into itself · leave to= out to unlink`);
    const p = this.panes.get(dst.id);
    if (!kindOf(p)?.accepts?.notes) throw new ActionRefused(`${dst.name} is a ${p?.kind} tile: opens land in a tile that takes notes (${tileKinds().filter(k => k.accepts?.notes).map(k => k.kind).join(", ")})`);
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
    // A float given the keys comes to the top.
    const fi = this.floats.findIndex(f => f.id === t.id);
    if (fi >= 0 && fi < this.floats.length - 1) this.floats.push(...this.floats.splice(fi, 1));
    // A tile in a shut drawer: the drawer slides open (every drawer around it).
    for (const c of chainOf(this.root, t.id)) if (c.t === "drawer") c.open = true;
    this.zoom = this.zoom !== null ? t.id : null;
    this.save(); this.redraw();
    return { tile: t.name };
  }

  /**
   * `tile.pin`: put the tile (its tab set, as one) in a drawer where it is (on=false), or take its drawer away so
   * what it holds is docked there again (on=true); toggles by default. With `edge`, the drawer slides from that
   * outer edge of the whole layout: a tile not in one is put in one there, a drawer moves there.
   */
  pinTile(sel: string | undefined, on: boolean | undefined, edgeTo: Dir | undefined, actor: Actor, container?: string): TileDone {
    const t = this.tile(sel);
    this.refuse(this.floatRefusal(t.id, "a drawer"));
    // A whole container (a split of tiles: the board's outline and its preview) goes into a drawer as one.
    if (container !== undefined && on !== true) {
      const c = nodeById(this.root, container);
      if (!c || c.t === "drawer") throw new ActionRefused(`no container ${container} to put in a drawer; layout.get gives each one's id`);
      if (!leaves(c).includes(t.id)) throw new ActionRefused(`${container} doesn't hold ${t.name}`);
      if (leaves(c).includes(this.focus)) this.guard(this.focus, actor, "move");
      const inDrawer = drawerOf(this.root, t.id);
      if (inDrawer && chainOf(this.root, t.id).indexOf(inDrawer) < chainOf(this.root, t.id).indexOf(c)) {
        if (!edgeTo || inDrawer.edge === edgeTo) return { tile: t.name, pinned: false, changed: false, edge: inDrawer.edge, container: inDrawer.id };
      }
      this.refuse(this.shapeRefusal(t.id, `putting ${container} in a drawer`));
      const open = actor.kind !== "agent" || leaves(c).includes(this.focus);
      const next = inDrawer && edgeTo ? drawerToEdge(this.root, inDrawer, edgeTo) : wrapNodeDrawer(this.root, c, edgeTo, open);
      if (!next) throw new ActionRefused(`${container} is the whole layout, holds every tile still docked, or is in a drawer already; a drawer needs something to slide over`);
      this.root = normalise(next);
      const now = drawerOf(this.root, t.id);
      if (now && !inDrawer) this.rememberedPolicy(now, container);
      this.save(); this.redraw();
      return { tile: t.name, pinned: !now, ...(now ? { edge: now.edge, container: now.id, open: now.open } : {}) };
    }
    const d = drawerOf(this.root, t.id);
    const pinned = !d;
    const want = on ?? (edgeTo ? false : !pinned);
    if (want === pinned && !(edgeTo && !want && d && d.edge !== edgeTo)) return { tile: t.name, pinned, changed: false, ...(d ? { edge: d.edge, container: d.id } : {}) };
    for (const id of tabsOf(this.root, t.id)?.ids ?? [t.id]) this.guard(id, actor, "move");
    this.refuse(this.shapeRefusal(t.id, want ? `taking ${t.name} out of its drawer` : `putting ${t.name} in a drawer`));
    if (want) { this.dockedPolicy.set(this.drawerKey(d!), d!.policy); this.root = normalise(unwrapDrawer(this.root, d!)); }
    else if (d && edgeTo) {
      const next = drawerToEdge(this.root, d, edgeTo);
      if (!next) throw new ActionRefused(`${d.id ?? "the drawer"} holds every tile; there's nothing for it to slide over`);
      this.root = normalise(next);
    } else {
      // The person's drawer opens on what they have; an agent's starts shut unless it holds their keys.
      const open = actor.kind !== "agent" || (tabsOf(this.root, t.id)?.ids ?? [t.id]).includes(this.focus);
      const next = wrapDrawer(this.root, t.id, edgeTo, open);
      if (!next) throw new ActionRefused(`${t.name} is the last tile docked (or its tab set is the whole layout); a drawer needs something to slide over`);
      this.root = normalise(next);
      const nd = drawerOf(this.root, t.id);
      if (nd) this.rememberedPolicy(nd, this.drawerKey(nd));
    }
    const now = drawerOf(this.root, t.id);
    this.save(); this.redraw();
    return { tile: t.name, pinned: !now, ...(now ? { edge: now.edge, container: now.id, open: now.open } : {}) };
  }

  /**
   * A drawer docked (tile.pin on=true) keeps its policy here, by what it held (a container's id, a tile's): put
   * back in a drawer, it slides as it did (the board's backlinks stay open, its outline keeps its least width).
   */
  private dockedPolicy = new Map<string, Policy | undefined>();
  private drawerKey(d: Drawer<number>): string { return d.kid.t === "leaf" ? this.tileId(d.kid.id) : d.kid.id ?? `t${leaves(d.kid)[0]}`; }
  /** A view's own drawer's policy, for when it's put back after a restart docked (the board's outline and backlinks). */
  protected drawerPolicyFor(key: string, policy: Policy) { if (!this.dockedPolicy.has(key)) this.dockedPolicy.set(key, policy); }
  private rememberedPolicy(d: Drawer<number>, key: string) {
    const p = this.dockedPolicy.get(key);
    if (p && !d.policy) d.policy = { ...p };
    this.stamp();
  }

  drawerTile(sel: string | undefined, open: boolean | undefined, actor: Actor, container?: string): TileDone {
    const t = this.tile(sel);
    // The drawer named (a handle's, an outer one holding another drawer), else the innermost holding the tile.
    const named = container ? nodeById(this.root, container) : null;
    if (container && named?.t !== "drawer") throw new ActionRefused(`no drawer ${container} in the layout; layout.get gives each drawer's id (d<n>)`);
    const d = named?.t === "drawer" ? named : drawerOf(this.root, t.id);
    if (!d) throw new ActionRefused(`${t.name} isn't in a drawer · tile.pin on=false (^W p) puts it in one`);
    const want = open ?? !d.open;
    if (!want && !this.effectiveAt(d).collapsible) throw new ActionRefused(`${d.id ?? "the drawer"} stays open (collapsible off)`);
    // Shutting the drawer that has the person's keys moves them: the same rule as any move of the keys.
    const inside = leaves(d.kid);
    if (!want && inside.includes(this.focus)) this.mayMoveKeys(actor, "shut the drawer they have");
    // The last drawer showing anything stays open: shut, the screen would be blank (every tile in a drawer).
    if (!want && d.open) { d.open = false; const none = !visible(this.root).length; d.open = true; if (none) throw new ActionRefused(`${d.id ?? "the drawer"} is all the screen shows: shut, nothing would be left · ^W p on a tile in it docks it`); }
    d.open = want;
    if (want) { if (actor.kind !== "agent" && !this.personTyping()) { this.focus = visible(d.kid).find(id => id === t.id) ?? visible(d.kid)[0] ?? t.id; activate(this.root, this.focus); } }
    else if (inside.includes(this.focus)) this.focus = visible(this.root)[0] ?? this.focus;
    this.save(); this.redraw();
    return { tile: t.name, open: want, edge: d.edge, ...(d.id ? { container: d.id } : {}) };
  }

  /**
   * The locks an agent set (the screen's, "screen", or a container's id). An agent may lock, and unlock its own
   * lock; a lock the person set (or one that came with a saved layout) is theirs to undo.
   */
  private agentLocks = new Set<string>();
  /** Who set or took away lock `key`: refused to an agent undoing a lock it didn't set. */
  private lockedBy(key: string, lock: boolean, actor: Actor) {
    if (actor.kind === "agent" && !lock && !this.agentLocks.has(key)) throw new ActionRefused(`${key === "screen" ? "the screen" : key} was locked by the person; an agent doesn't unlock it (block.mark gets their attention)`);
    if (lock && actor.kind === "agent") this.agentLocks.add(key); else this.agentLocks.delete(key);
  }

  /** `layout.lock`: lock or unlock the whole screen (its own policy); default toggles. */
  lockScreen(on: boolean | undefined, actor: Actor): { locked: boolean; changed: boolean } {
    const want = on ?? !this.screenLocked();
    if (want === this.screenLocked()) return { locked: want, changed: false };
    this.lockedBy("screen", want, actor);
    const { locked: _l, ...rest } = this.screenPolicy;
    this.screenPolicy = want ? { ...rest, locked: true } : rest;
    this.stamp(); this.save(); this.redraw();
    return { locked: want, changed: true };
  }

  /**
   * `layout.policy`: change the policy of container `node` (an id from layout.get, or "screen"); left out, the
   * innermost container holding tile `sel`, else the screen. `set` fields are written, `clear` ones taken
   * away. While it's locked only `locked` itself changes.
   */
  setPolicy(sel: string | undefined, nodeSel: string | undefined, set: Policy, clear: string[], actor: Actor): { node: string; policy: Policy; effective?: Effective } {
    const t = sel ? this.tile(sel) : null;
    const chain = t ? chainOf(this.root, t.id) : [];
    const c: Container | "screen" | null = nodeSel === "screen" ? "screen" : nodeSel ? nodeById(this.root, nodeSel) : chain.at(-1) ?? "screen";
    if (!c) throw new ActionRefused(`no container ${nodeSel} in the layout; layout.get gives each one's id (s<n> a split, g<n> a tab set, d<n> a drawer), or node=screen`);
    const bad = clear.filter(k => !(POLICY_KEYS as readonly string[]).includes(k));
    if (bad.length) throw new ActionRefused(`layout.policy: clear names ${POLICY_KEYS.join(", ")}, not ${bad.join(", ")}`);
    const name = c === "screen" ? "screen" : c.id ?? c.t;
    const before = c === "screen" ? this.screenPolicy : c.policy ?? {};
    const e = c === "screen" ? effective([{ by: "screen", policy: this.screenPolicy }]) : this.effectiveAt(c);
    const changes = [...Object.keys(set), ...clear];
    if (e.locked && changes.some(k => k !== "locked")) throw new ActionRefused(this.lockedWhy(e, `changing ${name}'s policy`));
    if (set.opensInto !== undefined) {
      const to = this.idNamed(set.opensInto);
      if (to === undefined) throw new ActionRefused(`no tile ${set.opensInto} for opens to land in`);
      if (!kindOf(this.panes.get(to))?.accepts?.notes) throw new ActionRefused(`${set.opensInto} is a ${this.panes.get(to)!.kind} tile: opens land in a tile that takes notes`);
    }
    if (set.accepts) { const unknown = set.accepts.filter(k => !isTileKind(k)); if (unknown.length) throw new ActionRefused(`layout.policy: accepts names tile kinds (${tileKindNames().join(", ")}), not ${unknown.join(", ")}`); }
    const locking = set.locked === true ? true : (set.locked === false || clear.includes("locked")) && before.locked ? false : null;
    if (locking !== null && locking !== !!before.locked) this.lockedBy(c === "screen" ? "screen" : c.id ?? c.t, locking, actor);
    const next: Policy = { ...before, ...set };
    for (const k of clear) delete (next as Record<string, unknown>)[k];
    const policy = policyOf(next);
    if (c === "screen") this.screenPolicy = policy;
    else if (Object.keys(policy).length) c.policy = policy; else delete c.policy;
    this.stamp(); this.save(); this.redraw();
    return { node: name, policy, ...(t ? { effective: this.policyAt(t.id) } : {}) };
  }

  /** The policy over tile `sel` (or the focused one): each layer's, and what applies. */
  policyGet(sel: string | undefined): unknown {
    const t = this.tile(sel);
    return { tile: t.name, layers: this.layers(t.id).filter(l => l.policy && Object.keys(l.policy).length), effective: this.policyAt(t.id), containers: ["screen", ...chainOf(this.root, t.id).map(c => c.id ?? c.t)] };
  }

  async previewTile(sel: string | undefined, where: Where, actor: Actor): Promise<TileDone> {
    const t = this.tile(sel);
    const p = this.panes.get(t.id)!;
    // What a preview of it follows is its kind's to say (a terminal's file, the board's card); else the tile itself.
    const k = kindOf(p);
    this.refuse(this.intoRefusal("preview", `${t.name}-preview`, where === "tabs" ? { kind: "tabs", target: t.id } : where.startsWith("edge-") ? { kind: "edge", dir: where.slice(5) as Dir } : { kind: "split", target: t.id, dir: where as Dir }));
    let source: string;
    try { source = k?.previewSource ? await k.previewSource(p, t.name, actor) : `tile:${t.name}`; }
    catch (e) { throw e instanceof ActionRefused ? e : new ActionRefused(e instanceof Error ? e.message : String(e)); }
    return this.openTile({ kind: "preview", source, name: this.autoName(`${t.name}-preview`) }, t.name, where, actor);
  }

  // ── terminal tiles: what the terminal kind's actions (PTY_ACTIONS) change on the desk ──

  typeTerminal(name: string, p: PtyPane, text: string, actor: Actor): TileDone {
    if (!p.running) throw new ActionRefused(`${name}'s program isn't running · tile.restart runs it again`);
    if (actor.kind === "agent" && this.ptyIn === p && this.panes.get(this.focus) === p) throw new ActionRefused(`the person is typing in ${name}; an agent doesn't type there (an nvim tile's socket edits other lines without their cursor)`);
    // The dock's agent is this tile too (PIE-498): the person typing in it in the drawer holds its keys as well.
    if (actor.kind === "agent" && sharedAgent()?.personIn(p)) throw new ActionRefused(`the person is typing in ${name} in the agent drawer; an agent doesn't type there`);
    p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
    return { tile: name, chars: text.length };
  }

  herdrTerminal(name: string, p: PtyPane, pane: string | undefined, on: boolean | undefined, _actor: Actor): TileDone {
    if (on === false) { p.herdr = null; return { tile: name, herdr: null }; }
    if (!pane) throw new ActionRefused("tile.herdr needs pane=<the Herdr pane's label>");
    if (!p.running) throw new ActionRefused(`${name}'s program isn't running`);
    p.herdr = { pane };
    this.redraw();
    return { tile: name, herdr: p.herdr };
  }

  /**
   * The person types in terminal tile `sel` (e, ⏎ or a click): every key but ctrl+] goes to its program. One that
   * exited runs again. `send`: bytes to give it first (ctrl+] twice sends a literal ctrl+]). An agent's would
   * take the person's keys, so it's refused: tile.type sends a program text without them.
   */
  enterTerminal(name: string, p: PtyPane, send: string | undefined, actor: Actor): TileDone {
    if (actor.kind === "agent") throw new ActionRefused("typing in a terminal tile takes the person's keys; an agent sends it text with tile.type");
    if (this.panes.get(this.focus) !== p) throw new ActionRefused(`${name} doesn't have the keys · tile.focus first`);
    if (this.inDrawer(p)) { this.redraw(); return { tile: name, drawer: true }; }
    if (!p.running && p.exited !== null) { p.restart(); return { tile: name, restarted: true }; }
    if (!p.running) throw new ActionRefused(`${name}'s program hasn't started`);
    this.ptyIn = p; this.chord = null;
    if (send) { p.input(send); this.ctx.flash(`sent ctrl+] to ${name}`); }
    else this.ctx.flash(`typing in ${name} · ${ESCAPE_CHORD} back to the door`);
    return { tile: name, typing: true };
  }

  /** Back to the door from the terminal the person types in (ctrl+]); ctrl+] again soon sends one to it. The person's only. */
  leaveTerminal(actor: Actor): TileDone {
    if (actor.kind === "agent") throw new ActionRefused("the person's keys are theirs: an agent doesn't take them out of a terminal tile");
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
      this.search = new SearchOverlay(q, this);
      this.redraw();
      return { overlay: true, query: q };
    }
    if (q.length < 2) throw new ActionRefused("search needs query=<at least 2 characters>");
    const hits = await this.ctx.board.search(q, Math.max(1, Math.min(100, limit ?? 30)));
    return { query: q, hits: hits.map((m, i) => ({ n: i + 1, id: m.id, title: subject(m), ...(m.props["work-id"] ? { workId: m.props["work-id"] } : {}) })) };
  }

  restartTerminal(name: string, p: PtyPane, _actor: Actor): TileDone {
    if (p.running) throw new ActionRefused(`${name} is still running`);
    p.restart();
    return { tile: name };
  }

  tileInfo(sel: string | undefined): unknown { const t = this.tile(sel); return this.tileView(t.id); }

  saveLayout(name: string, _actor: Actor) {
    if (!/^[\w.-]{1,40}$/.test(name)) throw new ActionRefused("a layout's name is 1-40 letters, digits, . - _");
    if (this.preset) throw new ActionRefused(`the ${this.title} keeps its own layout; save one on the desk (D)`);
    saveLayout(name, this.layoutSpec());
    this.layoutName = name;
    this.save();
    return { layout: name, tiles: this.all().map(id => this.nameOf(id)) };
  }

  loadLayout(name: string, actor: Actor) {
    const found = layoutNamed(name);
    if (!found) throw new ActionRefused(`no layout ${name}; layouts: ${layoutNames().map(l => l.name).join(", ")}`);
    if (this.screenLocked()) throw new ActionRefused(`the screen is locked: loading ${name} would change its shape · ${UNLOCK}`);
    // A layout loaded drops every container's lock with it: an agent doesn't, over a lock the person set.
    if (actor.kind === "agent") {
      const locks = (n: LNode): string[] => (n.t === "leaf" ? [] : [...(n.policy?.locked ? [n.id ?? n.t] : []), ...kidsOf(n).flatMap(locks)]);
      const theirs = locks(this.root).find(k => !this.agentLocks.has(k));
      if (theirs) throw new ActionRefused(`${theirs} was locked by the person; loading ${name} would undo it, and an agent doesn't (block.mark gets their attention)`);
    }
    this.mayMoveKeys(actor, "lay the desk out under them");
    if (this.preset) throw new ActionRefused(`the ${this.title} keeps its own layout; load one on the desk (D)`);
    this.entered.clear();
    this.ptyIn = null;
    this.build(found.spec, true);
    this.layoutName = name;
    this.save(); this.redraw();
    return { layout: name, saved: found.saved, rule: this.rule, tiles: this.all().map(id => this.nameOf(id)) };
  }

  layouts() { return { current: this.layoutName, layouts: layoutNames() }; }
  layoutGet() {
    return { layout: this.layoutName, rev: this.rev, rule: this.rule, focus: this.nameOf(this.focus), zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, locked: this.screenLocked(), ...this.savedPolicy(), tree: describeTree(this.root, id => this.nameOf(id), this.placeOpts(), id => this.tileId(id)), floats: this.floats.map(f => ({ tile: this.nameOf(f.id), id: this.tileId(f.id), rect: { ...f.rect } })), tiles: this.all().map(id => this.tileView(id)) };
  }

  /** Ctrl+E in a reader (PIE-417): the editor runs in a terminal tile beside it, not over the whole door. */
  editInTile(path: string, cmd: string, done: (code: number | null) => void): boolean {
    const at = this.focus;
    // A locked screen keeps its shape: the editor runs over the whole door instead (as on a screen without tiles).
    if (!this.panes.has(at) || this.screenLocked()) return false;
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

  /** The split with this id, if it's in the tree. */
  private splitById(id: string): Line | null {
    const n = nodeById(this.root, id);
    return isLine(n) ? n : null;
  }
  /** The split at `path` ("" the root, "1.0" its second kid's first kid; a drawer's kid is its `.0`), if there is one. */
  private splitAt(path: string): LNode | null {
    let n: LNode = this.root;
    for (const p of path.split(".").filter(Boolean)) { const k = kidsOf(n)[Number(p)]; if (!k) return null; n = k; }
    return isLine(n) ? n : null;
  }
  /** The tree with each split's path (layout.resize names a border by it), each container's policy and each tile by name. */
  private shapeOf(n: LNode = this.root, path = ""): unknown {
    const pol = n.t !== "leaf" && n.policy ? { policy: n.policy } : {};
    if (n.t === "leaf") return { tile: this.nameOf(n.id), id: this.tileId(n.id) };
    if (n.t === "tabs") return { tabs: n.ids.map(id => this.nameOf(id)), id: n.id, shown: this.nameOf(n.ids[n.active]!), ...pol };
    if (n.t === "drawer") return { drawer: n.edge, open: n.open, id: n.id, path, ...pol, kid: this.shapeOf(n.kid, path ? `${path}.0` : "0") };
    const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
    if (n.t === "columns") return { columns: n.source ?? null, id: n.id, path, shares: n.weights.map(w => Math.round((w / sum) * 1000) / 1000), ...pol, kids: n.kids.map((k, i) => this.shapeOf(k, path ? `${path}.${i}` : String(i))) };
    return { split: n.dir, id: n.id, path, shares: n.weights.map(w => Math.round((w / sum) * 1000) / 1000), ...pol, kids: n.kids.map((k, i) => this.shapeOf(k, path ? `${path}.${i}` : String(i))) };
  }
  /** The layout's shape: what changes only when the layout does (not with what a tile shows). */
  private layoutShape() {
    return {
      name: this.layoutName, rev: this.rev, rule: this.rule, zoom: this.zoom !== null ? this.nameOf(this.zoom) : null, locked: this.screenLocked(), tree: this.shapeOf(), floats: this.floats.map(f => ({ tile: this.nameOf(f.id), rect: { ...f.rect } })),
      tiles: this.all().map(id => {
        const p = this.panes.get(id)!, link = this.linkOf(id), set = tabsOf(this.root, id);
        const dv = this.drawerView(id);
        return {
          tile: this.nameOf(id), id: this.tileId(id), kind: p.kind, rect: this.hits.find(([x]) => x === id)?.[1] ?? null,
          ...(link !== undefined ? { link: this.nameOf(link) } : {}),
          ...(set ? { tabs: set.ids.map(x => this.nameOf(x)), shown: set.ids[set.active] === id } : {}),
          ...("drawer" in dv ? dv : this.isFloat(id) ? { float: true } : { pinned: true }),
          ...(this.collapsed.has(id) ? { collapsed: true } : {}),
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
      focus: { tile: this.nameOf(this.focus), block: this.showing(f)?.id ?? null, ...(f instanceof PtyPane ? { file: f.file ?? null, typing: this.inPty() } : {}) },
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
    this.mayMoveKeys(actor, "move their keys to a mark");
    this.markAt = (this.markAt + 1) % all.length;
    const m = all[this.markAt]!;
    const there = m.block ? this.all().find(id => this.showsBlock(id, m.block!)) : m.tile ? this.idNamed(m.tile) : undefined;
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

  resizeBorder(at: { path?: string; split?: string }, border: number, share: number, _actor: Actor) {
    if ((at.path === undefined) === (at.split === undefined)) throw new ActionRefused("layout.resize names its split by split=<id> (layout.get gives each one), or by path=<p>");
    const n = at.split !== undefined ? this.splitById(at.split) : this.splitAt(at.path!);
    if (!n || !isLine(n)) throw new ActionRefused(at.split !== undefined ? `no split ${at.split} in the layout (it's gone: its tiles were moved or closed); layout.get gives each split's id` : `no split at path ${JSON.stringify(at.path)}; layout.get gives each split's path`);
    const path = this.pathOf(n) ?? "";
    if (!Number.isInteger(border) || border < 0 || border >= n.kids.length - 1) throw new ActionRefused(`split ${n.id} has borders 0-${n.kids.length - 2}`);
    this.refuse(this.resizeRefusal(n, border));
    const f = Math.max(0.08, Math.min(0.92, share));
    const sum = n.weights[border]! + n.weights[border + 1]!;
    // A drawer sliding over takes no room: only its own size changes, and the docked kids keep their shares.
    const slides = (k: LNode | undefined) => k?.t === "drawer" && k.policy?.overlay !== false;
    const di = slides(n.kids[border]) ? border : slides(n.kids[border + 1]) ? border + 1 : -1;
    if (di >= 0) {
      const total = n.weights.reduce((a, w) => a + w, 0), want = di === border ? sum * f : sum * (1 - f);
      const others = total - n.weights[di]!, scale = others > 0 ? (total - want) / others : 1;
      n.weights = n.weights.map((w, i) => (i === di ? want : w * scale));
    } else { n.weights[border] = sum * f; n.weights[border + 1] = sum - n.weights[border]!; }
    // During a border drag, desk.json is written once, on release.
    if (!this.drag) this.save();
    this.redraw();
    return { split: n.id, path, border, share: Math.round(f * 1000) / 1000, tiles: leaves(n).map(id => this.nameOf(id)) };
  }

  evenOut(_actor: Actor) {
    if (this.screenLocked()) throw new ActionRefused(`the screen is locked: evening it out is refused · ${UNLOCK}`);
    // A split that keeps its sizes (locked, resizable off) keeps them.
    even(this.root, n => !!this.resizeRefusal(n));
    this.save(); this.redraw(); return { even: true as const };
  }

  swapTile(sel: string | undefined, to: string, actor: Actor): TileDone {
    const a = this.tile(sel), b = this.tile(to);
    if (a.id === b.id) throw new ActionRefused("a tile can't swap with itself");
    this.guard(a.id, actor, "move"); this.guard(b.id, actor, "move");
    this.refuse(this.floatRefusal(a.id, "a swap") ?? this.floatRefusal(b.id, "a swap") ?? this.dragRefusal(a.id) ?? this.dragRefusal(b.id) ?? this.intoRefusal(this.panes.get(a.id)!.kind, a.name, { kind: "tabs", target: b.id }) ?? this.intoRefusal(this.panes.get(b.id)!.kind, b.name, { kind: "tabs", target: a.id }));
    this.root = swap(this.root, a.id, b.id);
    this.save(); this.redraw();
    return { tile: a.name, with: b.name };
  }

  /** The path of a split in the tree (for a dragged border's layout.resize). */
  private pathOf(target: LNode, n: LNode = this.root, path = ""): string | null {
    if (n === target) return path;
    const kids = kidsOf(n);
    for (let i = 0; i < kids.length; i++) { const p = this.pathOf(target, kids[i]!, path ? `${path}.${i}` : String(i)); if (p !== null) return p; }
    return null;
  }

  // ── tile.resize, tile.zoom, tile.float, and pane.split (PANE_ACTIONS) ──

  /** A tile by its number on screen (the one `peek` shows), its name, or the focused one; `n` its number. */
  private tileNumbered(sel?: string): { name: string; n: string; id: number } {
    const t = this.tileNamed(sel, false);
    if (t) return { name: t.name, n: String(this.numberOf(t.id)), id: t.id };
    const ids = this.all();
    throw new ActionRefused(`no tile ${sel} on the screen; tiles: ${ids.map((_, i) => i + 1).join(", ")}, their names, or focused`);
  }

  /** Why a tile can't close: it holds an edit or a comment, it's the last one, or it has the person's keys and an agent asks. */
  private closeRefused(id: number, actor: Actor): { why: string; flash: boolean } | null {
    const p = this.panes.get(id);
    if (p instanceof ReaderPane && p.editing) return { why: `not closed: it holds ${sessionName(p)} · e or ⏎ enters it`, flash: true };
    if (!this.isFloat(id) && leaves(this.root).length <= 1) return { why: "the screen's last tile stays", flash: false };
    if (actor.kind === "agent" && id === this.focus) return { why: `${this.nameOf(id)} has the person's keys; an agent doesn't close it`, flash: false };
    if (actor.kind === "agent" && p instanceof PtyPane && p.running) return { why: `${this.nameOf(id)} is running ${p.run.cmd[0]}; an agent doesn't end it`, flash: false };
    return null;
  }

  protected closeId(id: number) {
    const float = this.isFloat(id);
    const next = float ? this.root : remove(this.root, id);
    if (!next) return;
    const p = this.panes.get(id);
    if (!this.isShared(p)) p?.dispose?.();
    if (this.ptyIn === p) this.ptyIn = null;
    this.floats = this.floats.filter(f => f.id !== id);
    this.collapsed.delete(id);
    this.panes.delete(id); this.root = normalise(next);
    this.names.delete(id); this.links.delete(id); this.unregistered.delete(id);
    for (const [from, to] of this.links) if (to === id) this.links.delete(from);
    if (this.focus === id) this.focus = visible(this.root).find(x => !this.collapsed.has(x)) ?? visible(this.root)[0] ?? this.all()[0]!;
    if (this.zoom === id || !this.panes.has(this.zoom ?? -1)) this.zoom = null;
  }

  /** `pane.split`: tile.open along the longer side (or `dir`): one code path, one rule. `pane` is the new tile's number. */
  async splitPane(sel: string | undefined, kind: string | undefined, dir: Axis | undefined, actor: Actor): Promise<PaneDone> {
    const at = this.tileNumbered(sel);
    const r = this.placed.rects.get(at.id) ?? { col: 0, row: 0, cols: 80, rows: 24 };
    const where: Where = dir === "col" ? "down" : dir === "row" ? "right" : r.cols >= r.rows * 2.2 ? "right" : "down";
    const t = await this.openTile({ kind: (kind ?? "reader") as TileKindName }, at.n, where, actor);
    return { pane: String(t.n), kind: t.kind, beside: at.n, tile: t.tile };
  }

  /** `tile.resize`: the border of the innermost container along `axis` over the tile, moved by steps. `pane` is its number (the older answer). */
  resizeTile(sel: string | undefined, axis: Axis, by: number, _actor: Actor): TileDone {
    const p = this.tileNumbered(sel);
    // The container whose border it would move: the innermost along that axis over it.
    const along = [...chainOf(this.root, p.id)].reverse().find(c => isLine(c) && c.dir === axis && c.kids.length > 1);
    this.refuse(along ? this.resizeRefusal(along) : this.shapeRefusal(p.id, "resizing"));
    if (!resize(this.root, p.id, axis, 0.05 * by)) throw new ActionRefused(`tile ${p.name} has no border ${axis === "row" ? "beside it" : "above or below it"} to move`);
    this.save(); this.redraw();
    return { tile: p.name, pane: p.n, axis, by };
  }

  /** `tile.zoom`: the tile fills the screen, or the screen comes back. */
  zoomTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    const p = this.tileNumbered(sel);
    const want = on ?? this.zoom !== p.id;
    // Zooming another tile would hide the one with the person's keys.
    if (actor.kind === "agent" && want && p.id !== this.focus) throw new ActionRefused(`zooming tile ${p.name} would hide tile ${this.nameOf(this.focus)}, which has the person's keys`);
    if (!want) this.zoom = null;
    else { this.zoom = p.id; if (actor.kind !== "agent") this.focus = p.id; }
    this.redraw();
    return { tile: p.name, pane: p.n, zoomed: this.zoom === p.id };
  }

  /**
   * `tile.float`: pop tile `sel` out of the tree as a float over everything (its own rectangle), or dock a float
   * back (`dockFloat`: beside the tile the person has, unless a view says where). Refused where policy keeps the
   * tile where it is, and to an agent for the tile the person is typing in.
   */
  floatTile(sel: string | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    this.guard(t.id, actor, "float");
    if (this.isFloat(t.id)) {
      this.refuse(this.screenLocked() ? `the screen is locked: docking ${t.name} is refused · ${UNLOCK}` : null);
      this.root = this.docking(t.id, t.name);
      this.floats = this.floats.filter(f => f.id !== t.id);
      this.save(); this.redraw();
      return { tile: t.name, pane: t.name, floated: false, now: t.name };
    }
    this.refuse(this.dragRefusal(t.id));
    if (leaves(this.root).length < 2) throw new ActionRefused(`${t.name} is the only tile in the layout; there's nothing for it to float over`);
    const at = this.rectsNow().get(t.id);
    this.root = normalise(remove(this.root, t.id)!);
    this.collapsed.delete(t.id);
    this.floats.push({ id: t.id, rect: this.newFloatRect(at) });
    if (actor.kind !== "agent") this.focus = t.id;
    this.zoom = null;
    this.save(); this.redraw();
    return { tile: t.name, pane: t.name, floated: true, now: t.name };
  }
  /** Where a new float goes: half the screen, a little lower and to the right of the last one. */
  protected newFloatRect(_from?: Rect): Rect {
    const W = this.area.cols, H = this.area.rows, n = this.floats.length;
    return { col: Math.round(W * 0.22) + n * 3, row: this.area.row + Math.round(H * 0.12) + n * 2, cols: Math.round(W * 0.5), rows: Math.round(H * 0.6) };
  }
  /**
   * The tree with float `id` docked: where `dockFloat` puts it, when the containers there take it (their policy:
   * locked, droppable, accepts, as any move asks); else beside the first tile whose containers do, else along an
   * outer edge; refused, with the first place's reason, when nothing takes it.
   */
  protected docking(id: number, name: string): LNode {
    const kind = this.panes.get(id)?.kind ?? "tile";
    // Where a tile would land in `next`: the containers over it there, each with its policy.
    const why = (next: LNode): string | null => {
      if (!has(next, id)) return `there's no place for ${name} in the layout`;
      const e = effective([{ by: "screen", policy: this.screenPolicy }, ...chainOf(next, id).map(c => ({ by: c.id ?? c.t, policy: c.policy }))]);
      if (e.locked) return this.lockedWhy(e, `docking ${name}`);
      if (!e.droppable) return `${e.by.droppable === "screen" ? "the screen" : e.by.droppable} takes no drops (droppable off): ${name} doesn't dock there`;
      if (e.accepts && !e.accepts.includes(kind)) return `${e.by.accepts === "screen" ? "the screen" : e.by.accepts} takes only ${e.accepts.join(", ") || "nothing"}: not ${name} (${kind})`;
      return null;
    };
    const first = normalise(this.dockFloat(id));
    const refused = why(first);
    if (!refused) return first;
    const tries: (() => LNode)[] = [
      // Beside a docked tile only: one in a drawer would put the float where it isn't shown (a shut drawer).
      ...dockedTiles(this.root).map(at => () => besideSlot(clone(this.root), at, leaf(id), "right")),
      ...(["right", "down", "left", "up"] as Dir[]).map(d => () => edge(clone(this.root), id, d)),
    ];
    for (const f of tries) { const next = normalise(f()); if (!why(next)) return next; }
    throw new ActionRefused(refused);
  }
  /** Where a docked float goes in the tree: beside the tile the person has (a view may say otherwise: the board's readers row). */
  protected dockFloat(id: number): LNode {
    const at = this.isFloat(this.focus) || this.focus === id || !has(this.root, this.focus) ? (dockedTiles(this.root).at(-1) ?? leaves(this.root).at(-1)!) : this.focus;
    return besideSlot(clone(this.root), at, leaf(id), "right");
  }

  /** `float.place`: move or size a float, kept on the screen. */
  placeFloat(sel: string | undefined, a: { dx?: number; dy?: number; col?: number; row?: number; cols?: number; rows?: number }, actor: Actor): TileDone {
    const t = sel ? this.tile(sel) : this.isFloat(this.focus) ? this.tile(undefined) : this.floats.length ? { name: this.nameOf(this.floats.at(-1)!.id), id: this.floats.at(-1)!.id } : null;
    const f = t ? this.floats.find(x => x.id === t.id) : undefined;
    if (!t || !f) throw new ActionRefused(`${t ? t.name : "no tile"} isn't a float; tile.float (o on the board) pops a tile out as one`);
    this.guard(t.id, actor, "move");
    // Moving or sizing a float changes the screen's shape: refused while it's locked (as any move is).
    this.refuse(this.shapeRefusal(t.id, `moving ${t.name}`));
    const r = f.rect;
    if (a.cols !== undefined) r.cols = a.cols;
    if (a.rows !== undefined) r.rows = a.rows;
    r.col = a.col ?? r.col + (a.dx ?? 0);
    r.row = a.row ?? r.row + (a.dy ?? 0);
    this.keepOnScreen(r);
    if (!this.floatDrag) this.save();
    this.redraw();
    return { tile: t.name, rect: { ...r } };
  }

  /**
   * `tile.collapse`: fold tile `sel` to a spine where it is, or open it again. It folds only side by side with
   * others (a row or columns), where its container's policy lets it; an agent never folds the tile the person has.
   */
  collapseTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone {
    const t = this.tile(sel);
    const was = this.collapsed.has(t.id);
    const want = on ?? !was;
    if (want === was) return { tile: t.name, collapsed: was, changed: false };
    if (want) {
      this.refuse(this.floatRefusal(t.id, "a spine") ?? this.shapeRefusal(t.id, `folding ${t.name}`));
      const p = parentOf(this.root, t.id);
      if (!p || p.parent.dir !== "row") throw new ActionRefused(`${t.name} isn't side by side with other tiles: only a tile in a row or columns folds to a spine`);
      if (!this.policyAt(t.id).collapsible) throw new ActionRefused(`${t.name} stays open: ${this.policyAt(t.id).by.collapsible} doesn't collapse (collapsible off)`);
      if (actor.kind === "agent" && t.id === this.focus) throw new ActionRefused(`${t.name} has the person's keys; an agent doesn't fold it`);
      this.collapsed.set(t.id, actor.kind === "agent" ? { by: actor.id } : {});
    } else this.collapsed.delete(t.id);
    this.panes.get(t.id)?.folded?.(want);
    this.save(); this.redraw();
    return { tile: t.name, collapsed: want };
  }
  /** A click on a spine, or ⏎ on one: it opens and takes the keys (a view may open its own way: the board's lanes). */
  protected expandSpine(id: number) {
    this.cmd("tile.collapse", { on: false }, this.nameOf(id));
    if (id !== this.focus) this.cmd("tile.focus", {}, this.nameOf(id));
  }

  /** The tile drawn on top at a cell (a drawer over the layout), or null. */
  protected topTileAt(x: number, y: number): number | null {
    return this.hits.find(([, r]) => x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows)?.[0] ?? null;
  }

  /**
   * The person leaves the edit or comment they're in, by a click elsewhere or ^W: `session.leave`, as the
   * person (an agent's action never does this to their draft). False, with the reason said, when it can't
   * (a changed property value). The save, when there is one, lands in the background: the tile says
   * "saving…" meanwhile, and a refusal puts the draft aside as unsent with a flash.
   */
  protected leaveSession(rd: ReaderPane): boolean {
    const why = rd.surface.leaveRefusal();
    if (why) { this.ctx.flash(why); return false; }
    this.entered.clear();
    rd.act("session.leave", {}, this, USER).then(r => { const said = leaveSaid(r); if (said) this.ctx.flash(said, 10000); this.redraw(); }, e => { this.ctx.flash(e instanceof Error ? e.message : String(e)); this.redraw(); });
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
  protected readerLabel(id: number): string { return `reader ${this.all().indexOf(id) + 1}`; }

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

  /** A click on a header's "⇤ drawer": the drawer docks (tile.pin, so a view's own drawers dock their way: the board's). */
  protected pinByClick(id: number) { this.cmd("tile.pin", { on: true }, this.nameOf(id)); }

  /** Where a header's grip ends: just past its last label (its number and title, or its tabs, and marks). */
  private gripEnd(r: Rect): number {
    const inRow = (h: { row: number; from: number; to: number }) => h.row === r.row && h.from >= r.col && h.to <= r.col + r.cols;
    const ends = [...this.heads.filter(inRow), ...this.markHits.filter(inRow)].map(h => h.to);
    return Math.min(r.col + r.cols - 1, (ends.length ? Math.max(...ends) : r.col + 3) + 1);
  }

  /** The tiles as the drag sees them: each shown tile's frame, and a tab set's tab labels. */
  private dropTiles(): DropTile<number>[] {
    // A float isn't a place in the tree: nothing is dropped into it (o docks it).
    return this.hits.filter(([id]) => !this.isFloat(id)).map(([id, rect]) => {
      const set = tabsOf(this.root, id);
      return { id, rect, ...(set && set.ids.length > 1 ? { tabs: this.heads.filter(h => h.row === rect.row && set.ids.includes(h.id) && h.from >= rect.col && h.to <= rect.col + rect.cols).map(h => ({ id: h.id, from: h.from, to: h.to })) } : {}) };
    });
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const p = this.pressed;
    if (k.action === "up") {
      if (this.drag) { this.drag = null; this.save(); }
      if (this.floatDrag) { this.floatDrag = null; this.save(); return; }
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
      // A float's title moves it, its corner sizes it: float.place, as H J K L and an agent's.
      if (this.floatDrag) {
        const f = this.floats.find(x => x.id === this.floatDrag!.id), g = this.floatDrag;
        if (f) this.cmd("float.place", g.size ? { cols: k.x - f.rect.col + 1, rows: k.y - f.rect.row + 1 } : { col: k.x - g.dx, row: k.y - g.dy }, this.nameOf(g.id));
        return;
      }
      // A border follows the pointer by layout.resize (the same action an agent calls).
      if (this.drag) { const g = this.drag, split = g.d.node.id, f = dragShare(g, k.x, k.y); if (split && f !== null) this.cmd("layout.resize", { split, border: g.d.i, share: f }); return; }
      if (this.headPress) {
        const h = this.headPress;
        if (!this.dragging && Math.abs(k.x - h.x) + Math.abs(k.y - h.y) < 1) return;
        // Where it would land (a drawer's handle on the hint row first), with the reason policy refuses it, if any.
        const refuse = (to: Place<number>) => this.dropRefusal(h.id, to);
        const handles = this.handles.map(x => ({ from: x.from, to: x.to, row: this.area.row + this.area.rows, shows: shown(x.drawer.kid)[0] ?? x.id, edge: x.drawer.edge }));
        this.dragging = { src: h.id, drop: handleDrop(handles, this.area, k.x, k.y, h.id, refuse) ?? dropAt(this.dropTiles(), this.area, k.x, k.y, h.id, leaves(this.root).length > 1, refuse), x: k.x, y: k.y };
        return this.redraw();
      }
      if (this.mouseTile) { const m = this.mouseTile; this.panes.get(m.id)?.mouse?.(k, k.x - m.r.col - 1, k.y - m.r.row - 1, this); return; }
      if (p) return p.pane.drag(k.x - p.col, k.y - p.row, this);
      return;
    }
    const hit = this.hits.find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
    if (k.action === "down") {
      // A shut drawer's handle, at the end of the hint row; the lock chip after them.
      if (k.y === this.area.row + this.area.rows) {
        const h = this.handles.find(h => k.x >= h.from && k.x < h.to);
        if (h) this.cmd("tile.drawer", { open: true, container: h.drawer.id }, this.nameOf(h.id));
        else if (this.lockChip && k.x >= this.lockChip.from && k.x < this.lockChip.to) this.cmd("layout.lock");
        else if (this.moreChip && k.x >= this.moreChip.from && k.x < this.moreChip.to) this.cmd("keys.more");
        return;
      }
      if (this.linking) {
        const from = this.linking.from;
        this.linking = null;
        if (!hit) { this.ctx.flash("not linked"); return this.redraw(); }
        return this.cmd("tile.link", hit[0] === from ? {} : { to: this.nameOf(hit[0]) }, this.nameOf(from));
      }
      // A float: a press gives it the keys and brings it to the top; its title moves it, its ◢ corner sizes it.
      if (hit && this.isFloat(hit[0])) {
        const [id, r] = hit;
        if (id !== this.focus || this.floats.at(-1)?.id !== id) this.cmd("tile.focus", {}, this.nameOf(id));
        if (k.x >= r.col + r.cols - 2 && k.y >= r.row + r.rows - 2) { this.floatDrag = { id, size: true, dx: 0, dy: 0 }; return this.redraw(); }
        // The ⧉ before its title docks it (tile.float, as ^W f and the board's o do).
        if (k.y === r.row && k.x === r.col + 3) return this.cmd("tile.float", {}, this.nameOf(id));
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
        const why = this.resizeRefusal(d.d.node, d.d.i);
        if (why) { this.ctx.flash(why); return this.redraw(); }
        this.drag = d; return;
      }
      if (!hit) return;
      const [id, r] = hit;
      // A click elsewhere lets go of a reader's selected text.
      for (const [pid, pane] of this.panes) if (pid !== id && pane instanceof ReaderPane) pane.surface.selection = null;
      // A mark's label in a header: a click dismisses the mark.
      const mh = this.markHits.find(h => h.row === k.y && k.x >= h.from && k.x < h.to);
      if (mh) return this.cmd("block.unmark", { n: mh.n });
      // A header's "⇤ drawer": a click docks the drawer where it is.
      const dl = this.drawerLabels.find(h => h.row === k.y && k.x >= h.from && k.x < h.to);
      if (dl) return this.pinByClick(dl.id);
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
        const press = pane ? kindOf(pane)?.press : undefined;
        if (pane && press) {
          // A click its kind gives an action (in a terminal: typing in it); the tile gets the click when it asks for the mouse.
          if (this.inDrawer(pane)) return this.redraw();
          const a = press(pane, k);
          if (a) this.cmd(a.action, a.args ?? {}, this.nameOf(id));
          if (pane.mouse?.(k, x, y, this)) this.mouseTile = { id, r };
        } else if (pane?.mouse) { this.mouseTile = { id, r }; pane.mouse(k, x, y, this); }
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

/** How to unlock a locked screen, said with every refusal it causes. */
const UNLOCK = "alt+k or a click on ▣ locked unlocks it";
/** What a cut hint row ends with: ? (or a click on it) shows the rest (keys.more). */
const MORE = paint("|08 · |15?|08 more") + RESET;
const MORE_WIDTH = width(MORE);
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
/** A float's least size. */
const FLOAT_MIN = { cols: 20, rows: 5 };
const overlaps = (p: Placement, r: Rect) => p.col < r.col + r.cols && p.col + p.cols > r.col && p.row < r.row + r.rows && p.row + p.rows > r.row;
/** A drop as `peek` says it: where the dragged tile would go. */
const dropView = (d: Drop<number>, name: (id: number) => string) => ({ kind: d.kind, ...("target" in d ? { target: name(d.target) } : {}), ...("dir" in d ? { dir: d.dir } : {}), ...(d.kind === "tabs" && d.index !== undefined ? { index: d.index } : {}), label: d.label, ghost: d.ghost, ...(d.refused ? { refused: d.refused } : {}) });
/** Two tiles trade places in the tree (^W s). */
/** Tile `id` put at `place` in `root`: beside a tile, into its tabs, or along an outer edge. */
function putAt(root: LNode, id: number, place: Place<number>): LNode {
  return place.kind === "edge" ? edge(root, id, place.dir) : place.kind === "tabs" ? tabInto(root, place.target, id, place.index) : besideSlot(root, place.target, leaf(id), place.dir);
}

function swap(n: LNode, a: number, b: number): LNode {
  if (n.t === "leaf") return n.id === a ? leaf(b) : n.id === b ? leaf(a) : n;
  if (n.t === "tabs") return { ...n, ids: n.ids.map(x => (x === a ? b : x === b ? a : x)) };
  if (n.t === "drawer") return { ...n, kid: swap(n.kid, a, b) };
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
    if (this.mode === "save") { canvas.text(r.col + 2, r.row + 1, this.prefilled ? `${bg(C.blue)}${fg(C.white)}${this.text}${RESET}${paint(`|07${INPUT_CURSOR} |08⏎ keeps it, typing replaces it`)}` : paint(`|15${this.text}|07${INPUT_CURSOR}`), w - 4); return; }
    this.items.forEach((it, i) => {
      const label = `${it.name}${it.saved ? (it.builtin ? " · saved over the built-in" : " · saved") : " · built-in"}`;
      canvas.text(r.col + 1, r.row + 1 + i, (i === this.sel ? bg(C.blue) + fg(C.white) : fg(C.grey)) + pad(` ${label}`, w - 2) + RESET, w - 2);
    });
  }
}

// ── the policy panel (^W P): what each container over the focused tile allows ──

/**
 * The containers over a tile (the screen first, then each one down to it) and one's policy, a row per field.
 * ⏎, space or a click changes a row through the same action an agent calls; h l (or a click on a name) pick
 * the container; + - change a size; esc, q or a click outside closes it.
 */
class PolicyPanel {
  private node: number;
  private row = 0;
  private hits: { rows: { y: number; i: number }[]; nodes: { from: number; to: number; y: number; i: number }[]; rect: Rect | null } = { rows: [], nodes: [], rect: null };
  constructor(private readonly tile: number) { this.node = Number.MAX_SAFE_INTEGER; }
  key(k: Key, desk: Desk) {
    const nodes = desk.policyNodes(this.tile);
    this.node = Math.min(this.node, nodes.length - 1);
    const rows = desk.policyRows(this.tile, nodes[this.node]!.node);
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (k.kind === "esc" || c === "q") return desk.closePolicy();
    if (k.kind === "mouse") {
      if (k.action !== "down") return;
      const r = this.hits.rect;
      if (!r || k.x < r.col || k.x >= r.col + r.cols || k.y < r.row || k.y >= r.row + r.rows) return desk.closePolicy();
      const n = this.hits.nodes.find(h => h.y === k.y && k.x >= h.from && k.x < h.to);
      if (n) { this.node = n.i; this.row = 0; return; }
      const row = this.hits.rows.find(h => h.y === k.y);
      if (row) { this.row = row.i; rows[row.i]?.run?.(); }
      return;
    }
    if (k.kind === "up" || c === "k") this.row = Math.max(0, this.row - 1);
    else if (k.kind === "down" || c === "j") this.row = Math.min(rows.length - 1, this.row + 1);
    else if (k.kind === "left" || c === "h") { this.node = Math.max(0, this.node - 1); this.row = 0; }
    else if (k.kind === "right" || c === "l") { this.node = Math.min(nodes.length - 1, this.node + 1); this.row = 0; }
    else if (k.kind === "enter" || c === " ") rows[this.row]?.run?.();
    else if (c === "+" || c === "-") rows[this.row]?.adjust?.(c === "+" ? 1 : -1);
  }
  draw(canvas: Canvas, cols: number, rowsN: number, desk: Desk) {
    const nodes = desk.policyNodes(this.tile);
    this.node = Math.min(this.node, nodes.length - 1);
    const rows = desk.policyRows(this.tile, nodes[this.node]!.node);
    this.row = Math.min(this.row, rows.length - 1);
    const w = Math.min(76, cols - 4), h = Math.min(rowsN - 4, rows.length + 4);
    const r: Rect = { col: Math.floor((cols - w) / 2), row: Math.floor((rowsN - h) / 3), cols: w, rows: h };
    this.hits = { rows: [], nodes: [], rect: r };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), `${fg(C.yellow)}policy`, fg(C.dark) + "j k pick · ⏎ or a click changes · h l container · + - size · esc");
    let x = r.col + 2;
    let crumbs = "";
    nodes.forEach((n, i) => {
      if (i) crumbs += fg(C.dark) + " › " + RESET, x += 3;
      this.hits.nodes.push({ from: x, to: x + n.label.length, y: r.row + 1, i });
      crumbs += (i === this.node ? bg(C.blue) + fg(C.white) : fg(C.grey)) + n.label + RESET; x += n.label.length;
    });
    canvas.text(r.col + 2, r.row + 1, crumbs, w - 4);
    const lw = Math.max(20, Math.min(52, w - 28));
    rows.slice(0, h - 4).forEach((row, i) => {
      const y = r.row + 3 + i;
      this.hits.rows.push({ y, i });
      canvas.text(r.col + 1, y, (i === this.row ? bg(C.blue) + fg(C.white) : fg(C.grey)) + pad(` ${row.label}`, lw) + RESET + fg(C.lcyan) + ` ${row.value}` + RESET, w - 2);
    });
  }
}

// ── floating search ──────────────────────────────────────────────────────────

class SearchOverlay {
  private hits: Msg[] = [];
  private sel = 0;
  private busy = false;
  private timer: Timer | null = null;
  private seq = 0;
  constructor(private q = "", desk?: Desk) { if (q && desk) this.run(desk); }

  key(k: Key, desk: Desk): "keep" | "close" {
    if (k.kind === "esc") return "close";
    if (k.kind === "up") this.sel = Math.max(0, this.sel - 1);
    else if (k.kind === "down" || k.kind === "tab") this.sel = Math.min(Math.max(0, this.hits.length - 1), this.sel + 1);
    else if (k.kind === "enter") { const m = this.hits[this.sel]; if (m) { desk.run("open", { id: m.id }); return "close"; } }
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
    const lines = [paint(`|14/ |15${this.q}|07${INPUT_CURSOR} ${this.busy ? "|08searching…" : `|08${this.hits.length} hit(s)`}`), fg(C.blue) + "─".repeat(w) + RESET];
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
export const DESK_ACTIONS = new ActionSet<{ "open": { id: string; from?: string }; "search": { query?: string; limit?: number }; "keys.more": Record<string, never> }, DeskOn>("desk", {
  "keys.more": {
    summary: "show the whole hint row in a box above it, when the screen is too narrow for it and it was cut (it ends \"? more\"); again, or the next key, puts it away. The person's view: an agent's is refused (peek and actions say every key already)",
    keys: "?, a click on ? more",
    args: {},
    run(_, { d }, actor) {
      if (actor.kind === "agent") throw new ActionRefused("keys.more is the person's view of their hint row; `actions` lists every key");
      return d.keysMore();
    },
  },
  "search": {
    summary: "find notes by text (the service's search): query= answers the hits, numbered from 1, each with its id and title; nothing on screen moves. The person's (/) opens the search overlay, ⏎ there opens the hit (`open`)",
    keys: "/",
    args: { query: { type: "string", optional: true, about: "the text to find (at least 2 characters)" }, limit: { type: "number", optional: true, about: "how many hits (default 30, at most 100)" } },
    run({ query, limit }, { d }, actor) { return d.searchNotes(query, limit, actor); },
  },
  "open": {
    summary: "make a note the desk's current one and show it in tile=<tile name, id or #number> (a detail holds it); or, with from=<tile>, where that tile's opens land (its link; unlinked, where the desk's own open puts it). An agent's naming neither (`ep0ch open <id>`) lands where the focused tile's opens go, else a reader that follows, never one the person is typing in. A program in a tile passes from=$EP0CH_TILE, so it never has to know which reader that is. The person's own open gives that reader the keys, an agent's never moves them", keys: "enter in the outline, / search",
    args: { id: { type: "string", about: "the block id" }, from: { type: "string", optional: true, about: "open it as this tile's opens go (its link): the tile a program runs in" } },
    async run({ id, from }, { d, reader }, actor) {
      // An agent naming neither (`ep0ch open <id>`): where the focused tile's opens land, never the reader the
      // person types in (openShown). The person's own goes to the focused reader and gives it the keys.
      const r = from !== undefined ? await d.openFrom(id, from, actor)
        : reader === undefined && actor.kind === "agent" ? await d.openLanding(id)
        : await d.openIn(id, reader, actor);
      d.ctx.flash(`${agentLabel(actor)} opened a note${r.reader ? ` in reader ${r.reader}` : ""}`);
      return r;
    },
  },
});

/** A search hit's body under its title, wrapped: literal-region markers hidden, properties in a region plain (PIE-422). */
function previewLines(m: Msg, w: number): string[] {
  // A draft proposal's hidden patch (`[draft-patch::…]`, PIE-501) is machine data, never shown.
  const body = bodyLinesOf(m.text).filter(l => !/^\s*\[draft-patch::[A-Za-z0-9_-]*\]\s*$/.test(l.text));
  while (body.length && !body[0]!.text.trim()) body.shift();
  while (body.length && !body.at(-1)!.text.trim()) body.pop();
  // Links read as their labels and **bold** as bold, as the reader draws them (no ((uuid|…)) or ** in a preview).
  return body.flatMap(l => (l.text ? wrap(l.literal ? l.text : emphasis(presentLinks(l.text, false, null, m.text)), w) : [""]).map(x => colourBody(x, l.literal)));
}
export { previewLines as searchPreviewLines };
