// The tile-kind registry (PIE-505, review F15): every kind of tile, built-in or an extension's, is one entry:
// its name, how to make it, its actions, its default policy, what it accepts, and how it saves and comes back.
// The desk and the layout never switch on a kind's name; they look the kind up here. The built-ins register
// at startup (src/desk/builtin-tiles.ts); an extension's kind registers the same way, and its `make` builds a
// tile whose content the service draws (`serviceKind`, below).
import type { Msg } from "../board";
import type { Actor } from "../socket";
import type { ActionSet } from "../surface/actions";
import type { Policy } from "./layout";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { TileSpec } from "./tiles";

/** A kind's name: `tree`, `reader`, or an extension's dotted one (`jira.board`). */
export type TileKindName = string;

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
  /** Its keys under ^W o, in the order the hint row lists them. */
  readonly keys?: readonly KindKey[];
  /** Build a tile from its saved spec (or tile.open's fields). */
  make(spec: Partial<TileSpec> & { kind: TileKindName }): Pane;
  /** Its own actions (the tree's `tree.*`): `act` routes them to a tile of this kind, reader=<tile> or the first. */
  readonly actions?: ActionSet<any, { pane: any; desk: DeskApi }>;
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
}

const registry = new Map<TileKindName, TileKind>();

/** Register a kind. A second entry under the same name is refused: an extension can't take a built-in's place. */
export function registerTileKind(k: TileKind): void {
  if (!/^[A-Za-z][\w.-]{0,39}$/.test(k.kind)) throw new Error(`a tile kind's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(k.kind)})`);
  if (registry.has(k.kind)) throw new Error(`tile kind ${k.kind} is registered already`);
  registry.set(k.kind, k);
}
/** Take a kind out (an extension unloaded; tests). */
export function unregisterTileKind(kind: TileKindName): boolean { return registry.delete(kind); }
export const tileKind = (kind: string): TileKind | undefined => registry.get(kind);
export const isTileKind = (kind: string): boolean => registry.has(kind);
/** Every kind, in the order registered (the built-ins first). */
export const tileKinds = (): TileKind[] => [...registry.values()];
/** A pane's entry (a pane a view brought that isn't registered, the showcase's exhibit, has none). */
export const kindOf = (p: Pane | undefined): TileKind | undefined => (p ? registry.get(p.kind) : undefined);
/** The kind under `^W o <key>`, and that key's own start. */
export function kindForKey(key: string): { kind: TileKind; key: KindKey } | null {
  for (const k of registry.values()) for (const x of k.keys ?? []) if (x.key === key) return { kind: k, key: x };
  return null;
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

/** The registry entry for a kind the service draws: `make` builds a ServiceTile with the spec's saved state. */
export function serviceKind(o: { kind: TileKindName; about: string; render: ServiceRender; policy?: Policy; accepts?: TileKind["accepts"]; keys?: readonly KindKey[] }): TileKind {
  return {
    kind: o.kind, about: o.about, keys: o.keys, policy: o.policy, accepts: o.accepts,
    make: s => new ServiceTile(o.kind, o.render, (s as { state?: Record<string, unknown> }).state ?? {}, s.name ?? o.kind),
  };
}
