// The tile-kind registry (PIE-505, review F15): every kind of tile, built-in or an extension's, is one entry:
// its name, how to make it, its actions, its default policy, what it accepts, and how it saves and comes back.
// The desk and the layout never switch on a kind's name; they look the kind up here. The built-ins register
// at startup (src/desk/builtin-tiles.ts); an extension's kind registers the same way, and its `make` builds a
// tile whose content the service draws (`serviceKind`, below).
import type { Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { Actor, Change, OutlineEvent } from "../socket";
import type { ActionSet } from "../surface/actions";
import { nameKinds, type Dispatcher } from "../surface/dispatch";
import type { Key } from "../term";
import { wrap } from "../text";
import type { Policy } from "./screen-layout";
import type { DeskApi, Pane, PaneView } from "./panes";
import { PtyPane, type PtySpec } from "./pty";
import type { TileSpec } from "./tiles";

/** A kind's name: `tree`, `reader`, or an extension's dotted one (`jira.board`). */
export type TileKindName = string;

/** What a kind's actions run on: the tile (its pane and its name) and the desk it's on. */
export interface KindHost { pane: any; desk: DeskApi; tile: string }

/** What a kind's hooks get from the desk a tile of it is on. */
export interface TileEnv {
  desk: DeskApi;
  /** The tile's stable id (`t4`), its name, and the layout it's in. */
  id: string; name: string; place: string;
  /** Another tile on the desk, by name. */
  tile(name: string): Pane | undefined;
  /** The tiles that follow this one (a preview with `source=tile:<this>`). */
  followers(): Pane[];
}

/** A key under `^W o` (`^W O` as a tab) that opens a tile of the kind, with what it starts with. */
export interface KindKey { key: string; label: string; spec?(at: { name: string; pane: Pane }): Partial<TileSpec> }

export interface TileKind {
  readonly kind: TileKindName;
  /** One line: what the tile shows (tile.open's list, the docs). */
  readonly about: string;
  /**
   * What its tiles are called when named for what they are (a header shows such a tile's title alone): its kind's
   * name by default; a kind that is a screen's own sort of another says that one (the welcome's `welcome.detail`, a
   * detail).
   */
  readonly word?: string;
  /** How a message names one ("a terminal tile", an extension's "Tarot"); default "a <its first key's label> tile". */
  readonly noun?: string;
  /** Its keys under ^W o, in the order the hint row lists them. */
  readonly keys?: readonly KindKey[];
  /** Build a tile from its saved spec (or tile.open's fields). */
  make(spec: Partial<TileSpec> & { kind: TileKindName }): Pane;
  /** Its own actions (the tree's `tree.*`): `act` routes them to a tile of this kind, tile=<tile>, the focused one, or the first. */
  readonly actions?: ActionSet<any, KindHost>;
  /** Action sets it shares with the kind it's built on (a program an extension names runs in a terminal: tile.type, tile.enter…). */
  readonly inherits?: readonly ActionSet<any, KindHost>[];
  /** The policy a tile of this kind starts with, under its containers' (a terminal's least width, say). */
  readonly policy?: Policy;
  /** What it takes: notes opened into it (a link's target), and the tile kinds that may join it as tabs (any when left out). */
  readonly accepts?: { notes?: boolean; tiles?: readonly TileKindName[] };
  /** What it needs to be built again, beyond its kind, name and link (default: the tile's own `spec()`). */
  save?(p: Pane): Record<string, unknown>;
  /** A saved spec as this door reads it (an older form brought up to date); default as it is. */
  revive?(spec: TileSpec): TileSpec;
  /** Why tile.open's fields won't do (a preview's source that isn't tile: or file:), or null. */
  check?(spec: Partial<TileSpec>): string | null;
  /** What a new one opened beside tile `at` starts with when tile.open didn't say (a preview follows `at`). */
  defaults?(spec: Partial<TileSpec>, at: { name: string; pane: Pane }): Partial<TileSpec>;
  /**
   * It shows what its source picks (a tile's selection, a file): a link may send it a note, but an open that
   * names no tile (an agent's `open <id>`) never lands in it.
   */
  readonly follower?: boolean;
  /**
   * Take a note opened into it (its link's target, or where a screen's agent opens land, `ScreenSpec.lands`): null when
   * it did, else why not ("holds an edit"). `by`: who opened it (an agent's open never moves the person's keys).
   */
  take?(p: Pane, m: Msg, desk: DeskApi, by?: Actor): string | null;
  /** The tile it follows (a preview's `source=tile:<name>`): what that tile shows, this one shows. */
  follows?(p: Pane): string | null;
  /** It holds work closing would lose (a running program, an unsaved edit): a new layout keeps it in a drawer. */
  holdsWork?(p: Pane): boolean;
  /** What it shows or has selected (a reader's note, the tree's row, a board's card), for followers and marks. */
  shows?(p: Pane): Msg | null;
  /** The tile joins a live desk: it reads what it needs (a detail its note, a preview its source). */
  start?(p: Pane, env: TileEnv): void;
  /** What `layout.get` and `peek` add about it (a preview's source, a terminal's program). */
  describe?(p: Pane, full: boolean): Record<string, unknown>;
  /** What it has in view, for `view.get` and the live feed (`mine`: it has the person's keys): its viewport, and its cursor. */
  view?(p: Pane, mine: boolean): { viewport: Record<string, unknown>; cursor?: unknown };
  /** What a preview of it follows (`tile.preview`): its file, or the tile; it may change itself to make room. */
  previewSource?(p: Pane, name: string, actor: Actor): Promise<string> | string;
  // What the desk asks instead of which class a tile is (PIE-510, A2): a kind says how its tiles take keys, draw,
  // tick and answer actions, and the desk switches on none of them.
  /**
   * A key, or a click inside it, on a focused tile of this kind the person isn't typing in: the action of the
   * kind's it runs (a terminal's ⏎, e and a click: tile.enter), or null for the desk's usual keys.
   */
  press?(p: Pane, k: Key): { action: string; args?: Record<string, unknown> } | null;
  /** Every key is the tile's own now, the desk's included (a whole screen in a tile, in its own edit). */
  takesKeys?(p: Pane): boolean;
  /** The dispatcher of a whole screen in the tile (a board's), whose actions it answers there (the board's `card.*`). */
  dispatcher?(p: Pane): Dispatcher | null;
  /**
   * It draws a band across the top of the screen, above the tiles (a screen spec's `band` names its tile: the
   * welcome's logo and tabs): the rows it takes at this size, its drawing (and images), and a press on it.
   */
  band?: { rows(p: Pane, cols: number, rows: number, desk: DeskApi): number; draw(p: Pane, canvas: Canvas, r: Rect, desk: DeskApi): Placement[]; press?(p: Pane, x: number, y: number, desk: DeskApi): void };
  /** What `peek` says about the screen a tile of it is on (the welcome's notes, the brief's day), beside the tiles. */
  peek?(p: Pane, desk: DeskApi): Record<string, unknown>;
  /** A note opened from a tile of it into the next column of a flow opens as this tile (the river's column on a note); left out, a detail. */
  opensNext?(p: Pane, m: Msg): TileSpec;
  /** Its note is the one selected in a list it shows (the river's Library and #tag columns), not one it holds: an open doesn't reuse it. */
  lists?(p: Pane): boolean;
  /** A frame of its own animation: true when it changed (a screen in a tile, revealing its art). */
  tick?(p: Pane): boolean;
  /** Call `then` once it no longer holds work (`holdsWork`): a terminal's program exited. */
  whenFree?(p: Pane, then: () => void): void;
}

const registry = new Map<TileKindName, TileKind>();
// The dispatcher's refusals name a tile's kind as the registry does ("an outline tile", "a terminal tile").
nameKinds(kind => kindNoun(kind));
/** Kinds that were registered and went away, with why: their tiles say so instead of running something else. */
const gone = new Map<TileKindName, string>();

/** Register a kind. A second entry under the same name is refused: an extension can't take a built-in's place. */
export function registerTileKind(k: TileKind): void {
  if (!/^[A-Za-z][\w.-]{0,39}$/.test(k.kind)) throw new Error(`a tile kind's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(k.kind)})`);
  if (registry.has(k.kind)) throw new Error(`tile kind ${k.kind} is registered already`);
  registry.set(k.kind, k);
  gone.delete(k.kind);
  wentAway.delete(k.kind);
}
/** Take a kind out (an extension unloaded; tests). `why` is what its tiles say until it comes back. */
export function unregisterTileKind(kind: TileKindName, why?: string): boolean {
  const k = registry.get(kind);
  const had = registry.delete(kind);
  if (had) { gone.set(kind, why ?? "it was taken out of the door's tile kinds"); wentAway.set(kind, k!); }
  return had;
}
/** The entries of kinds that went away: a tile of one still running asks its kind's hooks (holds work, when it's free). */
const wentAway = new Map<TileKindName, TileKind>();
let missingReason: string | null = null;
/** Why no extension's kind can come here at all (an outline service without extensions), or null. */
export function setMissingKindReason(why: string | null): void { missingReason = why; }
/** Why there's no kind by that name: it went (and why), or nothing here registers it (and why not). */
export function missingKind(kind: TileKindName): string {
  return gone.get(kind) ?? missingReason ?? "nothing here registers it (an extension's kind: the extension isn't loaded yet, or isn't installed for this outline)";
}
/** Whether `kind` was registered once and went away (an extension removed while the door runs). */
export const wasTileKind = (kind: TileKindName): boolean => gone.has(kind);

// Who hears that kinds came or went (a desk: its tiles of those kinds are made again). Held weakly: a desk
// that's gone isn't kept alive by it.
const watchers = new Set<WeakRef<{ kindsChanged(): void }>>();
/** `owner.kindsChanged()` runs after kinds come or go, while `owner` lives. */
export function watchTileKinds(owner: { kindsChanged(): void }): void { watchers.add(new WeakRef(owner)); }
/** Stop telling `owner` (a desk that's gone for good). */
export function unwatchTileKinds(owner: object): void { for (const w of [...watchers]) if (w.deref() === owner || !w.deref()) watchers.delete(w); }
/** Say that kinds came or went (once, after a batch of register and unregister calls). */
export function kindsChanged(): void {
  for (const w of [...watchers]) { const o = w.deref(); if (!o) { watchers.delete(w); continue; } try { o.kindsChanged(); } catch { /* one desk's problem */ } }
}
export const tileKind = (kind: string): TileKind | undefined => registry.get(kind);
export const isTileKind = (kind: string): boolean => registry.has(kind);
/** A kind as a message says it (an agent "opened a terminal tile"), never its internal name (`pty`). */
export function kindNoun(kind: string): string {
  const k = registry.get(kind);
  if (k?.noun) return k.noun;
  const word = k?.keys?.[0]?.label ?? kind;
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word} tile`;
}
/** A tile as a message names it: its kind's word, and its name when that says more ("a terminal tile (editor)"). */
export const tileNoun = (kind: string, tile: string): string => `${kindNoun(kind)}${tile.replace(/-\d+$/, "") === kind ? "" : ` (${tile})`}`;
/** Every kind, in the order registered (the built-ins first). */
export const tileKinds = (): TileKind[] => [...registry.values()];
/** A pane's entry (a pane a view brought that isn't registered, the showcase's exhibit, has none). */
export const kindOf = (p: Pane | undefined): TileKind | undefined => (p ? registry.get(p.kind) : undefined);
/** A pane's entry, or the one its kind had before it went away (its tile still runs what that kind made). */
export const lastKindOf = (p: Pane | undefined): TileKind | undefined => (p ? registry.get(p.kind) ?? wentAway.get(p.kind) : undefined);
/** A kind's action sets: its own, then the ones it shares. */
export const kindActions = (k: TileKind | undefined): ActionSet<any, KindHost>[] => (k ? [...(k.actions ? [k.actions] : []), ...(k.inherits ?? [])] : []);
/** Every kind's action sets, each once (a shared one is listed once). */
export const allKindActions = (): ActionSet<any, KindHost>[] => [...new Set(tileKinds().flatMap(kindActions))];
/** The kind under `^W o <key>`, and that key's own start. */
export function kindForKey(key: string): { kind: TileKind; key: KindKey } | null {
  for (const k of registry.values()) for (const x of k.keys ?? []) if (x.key === key) return { kind: k, key: x };
  return null;
}

// ── tile sources: a container whose tiles come from data (PIE-511) ──────────────

/**
 * Where a columns container's tiles come from (its `source`, `<name>:<arg>`): the board's lanes are `hub:<id>`,
 * one query tile per view under that hub. The desk asks the source when the screen starts and again when a
 * change `affects` it, and keeps each tile it already has by its `key` (its cursor, its collapse), adding the new
 * ones and closing the gone ones. The desk never knows what a hub is; the source never knows the layout.
 */
export interface TileSource {
  readonly name: string;
  /** One line: what it supplies. */
  readonly about: string;
  /**
   * The tiles it supplies now for `arg`, in order: each one's spec, and `prime`, what a tile (new, or kept from
   * before) is told of the data it stands for (a query tile, its view as read now); and a title for the screen.
   */
  tiles(arg: string, desk: DeskApi): Promise<{ tiles: { spec: TileSpec; prime?(p: Pane): void }[]; title?: string }>;
  /** A change that may change what `tiles` answers (a view added under the hub, renamed, taken away). */
  affects?(c: Change, arg: string): boolean;
  /** How the person takes one of its tiles away (its tiles don't close: said when tile.close is refused). */
  readonly drop?: string;
  /** Which tile is which across a refill: a tile with the same key is kept. */
  key(spec: Partial<TileSpec>): string | null;
  /**
   * What it keeps for a columns container it fills, and does there (PIE-515: the board's lanes are the hub source's
   * tiles, and what they share is its model: the hub shown, the lane cursor, a card being moved or written). Made once
   * per container as the screen starts (`saved`: what it kept last time, `SourceModel.save`).
   */
  model?(host: ColumnsHost, container: string, saved?: unknown): SourceModel;
  /** Its model's actions (the board's card.*, board.hub), on the screen its container is on (none named: the model there). */
  readonly actions?: ActionSet<any, { model: SourceModel }>;
}

/**
 * What a source's model shares with the screen it's on: its tiles, the keys, the person's typing, where a note opens.
 * The desk is this; the model never sees the layout.
 */
export interface ColumnsHost extends DeskApi {
  /** The container's tiles its source supplied, in its order (a tile moved out of it after). */
  supplied(container: string): Pane[];
  /** The pane with the person's keys now. */
  focusedPane(): Pane | undefined;
  /** Show `source` in the container (another hub) and fill it again; resolves once filled. */
  showSource(container: string, source: string): Promise<void>;
  /** Run an action as the person's key (a refusal said), in tile `p` (or its own default). */
  pressAction(set: ActionSet<any, any>, name: string, args?: Record<string, unknown>, p?: Pane, quiet?: boolean | ((why: string) => string | null), given?: unknown): Promise<unknown>;
  /** Run another action inside this one, for `by`, in tile `p`: its refusal is thrown to the action that asked. */
  within(action: string, args: Record<string, unknown>, by: Actor, p?: Pane): Promise<unknown>;
  /** The screen's title, as it says it now (a model names its board: `board · Delivery Flow`). */
  title: string;
  /** The tile drawn on top at a cell, if any (a card dragged over a lane). */
  paneAt(x: number, y: number): { pane: Pane; rect: Rect } | null;
  /** Each tile as drawn now (for the mouse). */
  rectOf(p: Pane): Rect | undefined;
  /** Whether tile `p` is folded to a spine, or floats. */
  folded(p: Pane): boolean;
  isFloating(p: Pane): boolean;
  /** The source a container shows now (`hub:<id>`). */
  sourceOf?(container: string): string | undefined;
  /** Save the screen now (a model's state changed: the hub shown). */
  saveNow(): void;
  /** The tiles following any tile in the container (a preview with `source=tile:<its key>`). */
  followersOf(container: string): Pane[];
  /** Every reader on the screen, by name. */
  readerPanes(): { name: string; pane: import("./panes").ReaderPane }[];
  /** A tile's name. */
  nameOfPane(p: Pane): string;
  /** The person's keys go into the session `p` holds (an edit they left), as e or ⏎ does. */
  enterSession(p: import("./panes").ReaderPane): void;
  /** Leave the screen (the hub picker put away with no board yet): the shell's back. */
  leave(): void;
}

/** A source's model (`TileSource.model`): what a columns container it fills shares, beside its tiles. */
export interface SourceModel {
  /** A tile it supplied (new, or kept from before), before it starts. */
  supplied?(p: Pane): void;
  /** The container was filled (a hub shown, a view added): the source's title for the screen. */
  filled?(title?: string): void;
  /** The screen is about to draw (what its tiles show of it now: a card dragged over a lane). */
  frame?(): void;
  /** Its own overlay over the screen (a picker, the composer), in `area`; true when it took it (images go). */
  drawOver?(canvas: Canvas, area: Rect): boolean;
  /** A key or a click, before the screen's keys: true when it took it (an overlay open holds every key). */
  key?(k: Key): boolean;
  /** Its own mode's hint row, which outranks the screen's (a card dragged, the composer), or null. */
  hint?(): string | null;
  /** The screen's hint as it says it here (a banner before it: a card trashed; a status after). */
  decorate?(hint: string): string;
  /** The person's keys are its business now (an overlay or picker open). */
  busy?(): boolean;
  /** What an empty container of it says (no lanes yet: looking for boards). */
  empty?(): string | null;
  /** What `peek` says of it. */
  peek?(): Record<string, unknown>;
  onEvent?(e: OutlineEvent): void;
  /** An unsaved draft it holds (a new card being written), and keeping it when the screen goes. */
  unsaved?(): boolean;
  keepDrafts?(): string[];
  /** What it keeps between runs. */
  save?(): unknown;
  dispose?(): void;
  /** The block an action of its that names none writes, for `actor` (the card selected), for the draft rule. */
  draftBlock?(actor: Actor): string | null;
  /** The summary keys a note shows with, when the model's tiles list it (a lane's `[summary-properties::…]`). */
  summaryKeys?(m: Msg): readonly string[] | null;
}
const sources = new Map<string, TileSource>();
/** Register a tile source (refused under a name taken already). */
export function registerTileSource(s: TileSource): void {
  if (!/^[A-Za-z][\w.-]{0,39}$/.test(s.name)) throw new Error(`a tile source's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(s.name)})`);
  if (sources.has(s.name)) throw new Error(`tile source ${s.name} is registered already`);
  sources.set(s.name, s);
}
/** A columns container's `source` (`hub:<id>`), split into its registered source and its argument; null when none is registered. */
export function tileSource(source: string | undefined): { source: TileSource; arg: string } | null {
  if (!source) return null;
  const at = source.indexOf(":");
  const s = sources.get(at < 0 ? source : source.slice(0, at));
  return s ? { source: s, arg: at < 0 ? "" : source.slice(at + 1) } : null;
}

// ── a kind the service draws (an extension's whole tile) ──────────────────────

/**
 * What the service answers for a service-drawn tile: its rows (already styled), a title, and a hint. The door
 * draws them as given; the kind's code runs in the service (PIE-507's extensions), never in the door.
 */
export interface ServiceFrame { lines: string[]; title?: string; hint?: string }
/** How a service-drawn tile asks for its content: the kind, its saved state, and the room it has. */
export type ServiceRender = (req: { kind: TileKindName; state: Record<string, unknown>; cols: number; rows: number }) => Promise<ServiceFrame>;

/** A tile whose content the service draws: it asks again when its size changes or `refresh` is called. */
export class ServiceTile implements Pane {
  private frame: ServiceFrame | null = null;
  private error: string | null = null;
  private asked = "";
  constructor(readonly kind: TileKindName, private readonly render_: ServiceRender, readonly state: Record<string, unknown> = {}, private readonly label = kind) {}
  title() { return this.frame?.title ?? this.label; }
  hint() { return this.frame?.hint ?? "drawn by the service"; }
  /** Ask the service again (an event, or the size changed). */
  refresh(desk: DeskApi, cols: number, rows: number) {
    this.asked = `${cols}x${rows}`;
    this.render_({ kind: this.kind, state: this.state, cols, rows }).then(f => { this.frame = f; this.error = null; desk.redraw(); }, e => { this.error = e instanceof Error ? e.message : String(e); desk.redraw(); });
  }
  render(w: number, h: number, _focused: boolean, desk: DeskApi): PaneView {
    if (this.asked !== `${w}x${h}`) this.refresh(desk, w, h);
    if (this.error) return { lines: ["", `  the service couldn't draw ${this.kind}: ${this.error}`] };
    return { lines: this.frame?.lines.slice(0, h) ?? ["", `  asking the service for ${this.kind}…`] };
  }
  key(): boolean { return false; }
  spec() { return Object.keys(this.state).length ? { state: this.state } : {}; }
}

/**
 * A program the service names for a kind (an extension's whole tile, pi-herdr-outliner PIE-507): run in a
 * terminal tile with the service's command, folder and environment, and the tile's args (`state`) appended as
 * `--name=value`. `unavailable`: why it can't run here (the command is a path on another host).
 */
export interface ServiceProgram {
  command: string[]; cwd: string; env: Record<string, string>;
  /** The args a tile of it takes (`block`: a block id, by default the note shown where it's opened). */
  args: Record<string, { type: string; description?: string }>;
  unavailable?: string | null;
  /** Its title, and the keys its program answers (`d draw`), for the hint row. */
  label: string;
  keys?: readonly string[];
}

/** A tile running a service-named program: a terminal tile of its own kind, its args saved with it. */
export class ProgramTile extends PtyPane {
  constructor(override readonly kind: TileKindName, spec: PtySpec, readonly state: Record<string, unknown>, private readonly keyHint: readonly string[] = [], private readonly label = kind) { super(spec); }
  override title() {
    // Its kind went away while it ran: it keeps running until it exits, then its tile says why.
    const gone = registry.has(this.kind) ? "" : " · its kind is gone: ends with its program";
    return (this.exited !== null ? `${this.label} · exited ${this.exited}` : this.label) + gone;
  }
  override hint() { return this.exited !== null ? "⏎ runs it again" : `${this.keyHint.length ? `${this.keyHint.join(" · ")} · ` : ""}${super.hint()}`; }
  override spec() { return Object.keys(this.state).length ? { state: this.state } : {}; }
}

/** A tile whose kind isn't here (its extension went, or runs on another host): it says why and runs nothing. */
export class UnavailableTile implements Pane {
  constructor(readonly kind: TileKindName, private readonly why: string, readonly state: Record<string, unknown> = {}) {}
  title() { return `${this.kind} · unavailable`; }
  hint() { return "^W x closes it"; }
  render(w: number): PaneView {
    return { lines: ["", ...wrap(`${this.kind} isn't available here: ${this.why}.`, Math.max(10, w - 4)).map(l => `  ${l}`), "", "  It comes back by itself when its kind does; its place and args are kept."] };
  }
  key(): boolean { return false; }
  spec() { return Object.keys(this.state).length ? { state: this.state } : {}; }
}

const stateOf = (s: Partial<TileSpec>) => (s as { state?: Record<string, unknown> }).state ?? {};

/**
 * The registry entry for a kind the service provides: rows the service draws (`render`, a ServiceTile) or a
 * program the service names (`program`, a terminal tile of that kind with the terminal kind's own hooks).
 */
export function serviceKind(o: { kind: TileKindName; about: string; noun?: string; render?: ServiceRender; program?: ServiceProgram; policy?: Policy; accepts?: TileKind["accepts"]; keys?: readonly KindKey[]; actions?: TileKind["actions"] }): TileKind {
  const base = { kind: o.kind, about: o.about, noun: o.noun, keys: o.keys, policy: o.policy, accepts: o.accepts, actions: o.actions };
  const prog = o.program;
  if (!prog) {
    const render = o.render ?? (async () => ({ lines: ["", `  ${o.kind} has nothing to draw with`] }));
    return { ...base, make: s => new ServiceTile(o.kind, render, stateOf(s), s.name ?? o.kind) };
  }
  // A terminal tile's hooks are the built-in terminal kind's: how it starts, what it shows, that it holds work.
  const pty = registry.get("pty");
  const blockArg = Object.entries(prog.args).find(([, a]) => a.type === "block")?.[0];
  return {
    ...base,
    make: s => {
      const state = { ...stateOf(s), ...(blockArg && s.note && !stateOf(s)[blockArg] ? { [blockArg]: s.note } : {}) };
      if (prog.unavailable) return new UnavailableTile(o.kind, prog.unavailable, state);
      // Only the args it declares reach the program, each as --name=value.
      const argv = Object.keys(prog.args).flatMap(k => (typeof state[k] === "string" && state[k] ? [`--${k}=${state[k]}`] : []));
      return new ProgramTile(o.kind, { cmd: [...prog.command, ...argv], cwd: prog.cwd, env: prog.env, label: s.name ?? prog.label }, state, prog.keys, prog.label);
    },
    save: p => (p instanceof ProgramTile || p instanceof UnavailableTile ? (Object.keys(p.state).length ? { state: p.state } : {}) : {}),
    // A block arg is the note read where it's opened (^W o from a reader or a detail), unless tile.open named
    // one (note=). Only a kind that reads a note gives one, never a cursor (the tree's row, a lane's card,
    // which at the start is the outline's first root), so a program never writes where the person didn't
    // open it. A note the person reads counts even at the top level: an outline may have several roots.
    // Otherwise it's left unset, and the tile says so.
    defaults: (s, at) => {
      if (!blockArg || s.note || stateOf(s)[blockArg]) return {};
      const k = registry.get(at.pane.kind);
      if (!k?.accepts?.notes || k.follower) return {};
      const m = k.shows?.(at.pane);
      return m ? { state: { ...stateOf(s), [blockArg]: m.id } } : {};
    },
    holdsWork: p => p instanceof PtyPane && p.running,
    // The terminal's own actions, keys and wait for its program, as a built-in terminal tile has them.
    ...(pty?.actions ? { inherits: [pty.actions] } : {}),
    ...(pty?.press ? { press: (p: Pane, k: Key) => (p instanceof PtyPane ? pty.press!(p, k) : null) } : {}),
    ...(pty?.whenFree ? { whenFree: (p: Pane, then: () => void) => { if (p instanceof PtyPane) pty.whenFree!(p, then); } } : {}),
    ...(pty?.start ? { start: (p: Pane, env: TileEnv) => { if (p instanceof PtyPane) pty.start!(p, env); } } : {}),
    ...(pty?.view ? { view: (p: Pane, mine: boolean) => (p instanceof PtyPane ? pty.view!(p, mine) : { viewport: {} }) } : {}),
    describe: (p, full) => ({ ...(p instanceof PtyPane && pty?.describe ? pty.describe(p, full) : {}), ...(p instanceof ProgramTile || p instanceof UnavailableTile ? { args: p.state } : {}), ...(p instanceof UnavailableTile ? { unavailable: true } : {}) }),
  };
}
