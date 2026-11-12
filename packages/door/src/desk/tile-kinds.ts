// The tile-kind registry (PIE-505, review F15): every kind of tile, built-in or an extension's, is one entry:
// its name, how to make it, its actions, its default policy, what it accepts, and how it saves and comes back.
// The desk and the layout never switch on a kind's name; they look the kind up here. The built-ins register
// at startup (src/desk/builtin-tiles.ts); an extension's kind registers the same way, and its `make` builds a
// tile whose content the service draws (`serviceKind`, below).
import { lineEscCloses } from "../surface/completer";
import { activationOf, type ListPrimitive } from "@ep0ch/outline-core/list-row";
import type { Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import { primitiveLines } from "../components";
import type { Placement } from "../kitty";
import { listOpenTarget } from "../refs";
import { pressOn, wheelRows, type RowPress } from "../scroll";
import { EVERY_CHANGE, heardBy, RELOAD_PAUSE_MS, SearchSchedule } from "../search-schedule";
import { USER, type Actor, type Change, type OutlineEvent } from "../socket";
import { ActionRefused, type ActionSet } from "../surface/actions";
import { nameKinds, type Dispatcher } from "../surface/dispatch";
import { filterLine } from "../surface/line";
import { LISTVIEW_ACTIONS, type ListHost, type ListTile } from "../surface/list-actions";
import { LIST_KEYS } from "../surface/list-keys";
import { modeHint, type ModeKey } from "../surface/modes";
import { ListView, listRowsOf, PERSON, type ListHandle, type ListViewRow } from "../surface/list-view";
import { ch, isDown, isUp, type Key } from "../term";
import { wrap } from "../text";
import type { Policy, TileFacts } from "./screen-layout";
import type { DeskApi, Pane, PaneView } from "./panes";
import { PtyPane, type PtySpec } from "./pty";
import type { TileSpec } from "./tiles";

/** A kind's name: `tree`, `reader`, or an extension's dotted one (`jira.board`). A saved tile names it (outline-core's TileSpec). */
export type { TileKindName } from "@ep0ch/outline-core/screen-spec";
import type { TileKindName } from "@ep0ch/outline-core/screen-spec";

/** What a kind's actions run on: the tile (its pane and its name) and the desk it's on. */
export interface KindHost { pane: any; desk: DeskApi; tile: string; standing: boolean }

/** What a kind's hooks get from the desk a tile of it is on. */
export interface TileEnv {
  desk: DeskApi;
  /** The tile's stable id (`t4`), its name, and the layout it's in. */
  id: string; name: string; place: string;
  /** Where its screen's layout is saved (`desk.json`), when it is: with its id, what a tile is known by across session daemons. */
  home: string | null;
  /** Another tile on the desk, by name. */
  tile(name: string): Pane | undefined;
  /** The tiles that follow this one (a preview with `source=tile:<this>`). */
  followers(): Pane[];
  /** It was moved here whole (from another screen, or the drawer): it keeps what it shows, whatever is here. */
  moved?: boolean;
}

/**
 * What a tile says about itself for the layout's rules (PIE-1523): the kind answers (`TileKind.facts`) and the desk
 * merges it with what only the desk knows (its wires, its sources, who asks), so the layout never asks which class a
 * tile is. An extension's kind answers the same way, from its manifest's `holds`.
 */
export type KindFacts = Pick<TileFacts, "editing" | "running" | "holds" | "pinned" | "history" | "lists"> & {
  /** It keeps a session the person's keys go into (a reader's edit or comment, kept or not; an extension tile that holds them): no note is sent into it. */
  holdsKeys?: boolean;
  /**
   * The person types in it now, with their keys on it (an extension tile that holds them): the typing rule's tile, as a
   * terminal they're in is. A reader's edit is the desk's to say (whether they entered it), so a reader leaves it out.
   */
  typing?: boolean;
  /** It keeps the note opened into it unless a list feeds it (a reader the person owns): the desk says whether it's held now. */
  holdable?: boolean;
};
/** What a kind's `facts` is asked with. */
export interface KindFactsAsk {
  /** The person's keys are on the tile (its desk's focus). */
  keys: boolean;
  /** The person acting may leave its draft (a new note's tile closes with its edit, PIE-591): the draft isn't an edit to keep. */
  leavesDraft?: boolean;
  /** Who asks: an agent, or the person (left out: the layout itself). */
  actor?: Actor;
}

/** A key under `^W o` (`^W O` as a tab) that opens a tile of the kind, with what it starts with. */
export interface KindKey { key: string; label: string; spec?(at: { name: string; pane: Pane }): Partial<TileSpec> }

export interface TileKind {
  readonly kind: TileKindName;
  /**
   * Kinds this one serves in place of (PIE-1514): a retired built-in's name an extension took over (what-changed's
   * `what-changed.list` replaces `what-changed`). A saved tile of one opens as this kind and saves under it; the
   * registry resolves the name (resolveKind), so nothing else maps old names to new.
   */
  readonly replaces?: readonly TileKindName[];
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
  /** What its tiles are for when nothing says otherwise (`role:<role>` finds them): its kind's name by default. */
  readonly role?: string;
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
  /** Why its policy keeps a tile of it (closable or draggable off), in a person's words with what to do instead: said whole in place of the policy's own refusal. */
  readonly stays?: string;
  /** What it takes: notes opened into it (a link's target), and the tile kinds that may join it as tabs (any when left out). */
  readonly accepts?: { notes?: boolean; tiles?: readonly TileKindName[] };
  /** A content drop in this tile's centre: the source tile runs this action on release. */
  receive?(p: Pane, from: Pane, desk: DeskApi): import("./drop").DropReceive | null;
  /** What it needs to be built again, beyond its kind, name and link (default: the tile's own `spec()`). */
  save?(p: Pane): Record<string, unknown>;
  /** Why tile.open's fields won't do (a preview's source that isn't tile: or file:), or null. */
  readonly openArgs?: readonly string[];
  check?(spec: Partial<TileSpec>, opening?: object): string | null;
  /**
   * What the person picks from when a new tile of it lacks what it needs (a query tile's view: the outline's saved
   * views), each choice the fields it opens with; ^W o and the blank tile's rows ask it instead of refusing.
   */
  choices?(desk: DeskApi): Promise<{ title: string; items: { label: string; spec: Partial<TileSpec> }[] }>;
  /**
   * It only holds a place (the blank tile): nothing in it to lose, so an agent may put a tile in its place (blank.fill)
   * even while the person's keys are on it; the keys stay in that place, on the new tile.
   */
  readonly placeholder?: true;
  /** What a new one opened beside tile `at` starts with when tile.open didn't say (a preview follows `at`). */
  defaults?(spec: Partial<TileSpec>, at: { name: string; pane: Pane }): Partial<TileSpec>;
  /**
   * It shows what its source picks (a tile's selection, a file): a link may send it a note, but an open that
   * names no tile (an agent's `open <id>`) never lands in it.
   */
  readonly follower?: boolean;
  /** Its note rows are wire sources: the frame offers select, open and alt through the desk's shared routing. */
  readonly previews?: true;
  /**
   * A tile that narrows by a query takes the ones a reader on its screen opens (a `#tag`, a figure row's query, a
   * calendar day: PIE-1448), instead of a list tile opening beside the reader: the facets tile's selection becomes it.
   */
  takesQuery?(p: Pane, query: string, desk: DeskApi, actor: Actor): Promise<{ query: string; notes: { id: string; title: string }[] }>;
  /** In the drawer, opens without a wire use the screen shown. Local and cross-edge wires take precedence. */
  readonly opensOnScreen?: true;
  /**
   * Its home (PIE-794): the reader it belongs to (the links tile's: the reader it was opened beside). Its opens land
   * there when no link or container says otherwise: ⏎ on a row replaces that reader's note, alt+⏎ opens a new detail
   * beside it (PIE-646).
   */
  home?(p: Pane): string | null;
  /**
   * A list that can be held off its home (PIE-855: a `#tag`'s list): `held` says whether it is now (null: it can't be,
   * as a saved view's lane), `set` holds it or lets it go. A held list keeps what it lists, and the next tag opened in
   * its home opens a list of its own; its opens still land in its home. `tile.hold` runs it.
   */
  hold?: { held(p: Pane): boolean | null; set(p: Pane, on: boolean): void };
  /**
   * A list about a note that `b` aims (the links tile: a reader's note's Outlinks, Resources and Backlinks): the
   * tile as the desk aims it, and the kind of tile opened beside it to follow its selection when a screen has
   * none and `b` opens one (`companion`, a preview).
   */
  aim?(p: Pane): AimedList;
  /**
   * What one step of the sideways wheel (a trackpad's swipe, -1 left, 1 right) does in it, where its content is
   * horizontal (a river column: the column beside, as h l): an action run in the tile, or null. Without it the
   * sideways wheel does nothing there.
   */
  sideways?(p: Pane, dir: 1 | -1): { action: string; args?: Record<string, unknown> } | null;
  readonly companion?: TileKindName;
  /**
   * Take a note opened into it (its link's target, or where a screen's agent opens land, `ScreenSpec.lands`): null when
   * it did, else why not ("holds an edit"). `by`: who opened it (an agent's open never moves the person's keys).
   */
  take?(p: Pane, m: Msg, desk: DeskApi, by?: Actor): string | null;
  /** The tile it follows (a preview's `source=tile:<name>`): what that tile shows, this one shows. */
  follows?(p: Pane): string | null;
  /** It holds work closing would lose (a running program, an unsaved edit): a new layout keeps it in a dock. */
  holdsWork?(p: Pane): boolean;
  /** That work in words, after the tile's name ("is still running"): what a layout keeping the tile says (PIE-1571). */
  workWords?(p: Pane): string;
  /** What it shows or has selected (a reader's note, the tree's row, a board's card), for followers and marks. */
  shows?(p: Pane): Msg | null;
  /**
   * What a tile of it is now, as the layout's rules ask (PIE-1523): an edit it holds, a program running, the person's
   * keys in it, a pin. Placement, the typing rule, closing and the select wires read only this, never the tile's class.
   */
  facts?(p: Pane, ask: KindFactsAsk): KindFacts;
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
  /**
   * A click here (tile-local x, y) presses something and leaves the person's keys where they are: an answer tile's button
   * beside the edit they type in (PIE-1722), so their next keys go on in the edit.
   */
  clickKeepsKeys?(p: Pane, x: number, y: number): boolean;
  /**
   * Whether a screen's save keeps it now (false: left out of desk.json and the handover, kept in the live layout and its
   * undo): an answer tile whose ask is gone (PIE-1733). Left out: always kept.
   */
  kept?(p: Pane, desk: DeskApi): boolean;
  /** While it takes every key, ^W and the window key after it are still the desk's: the way out by keys (the comment tile). */
  readonly windowKeys?: true;
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
/** Retired names and the kind that serves each now (`TileKind.replaces`): the one map from an old kind to its new one. */
const aliases = new Map<TileKindName, TileKindName>();
/** Counts the kinds coming and going: what a list built from the registry is kept against. */
let registryEdits = 0;
// The dispatcher's refusals name a tile's kind as the registry does ("an outline tile", "a terminal tile").
nameKinds(kind => kindNoun(kind));
/** Kinds that were registered and went away, with why: their tiles say so instead of running something else. */
const gone = new Map<TileKindName, string>();

/** Register a kind. A second entry under the same name is refused: an extension can't take a built-in's place. */
export function registerTileKind(k: TileKind): void {
  if (!/^[A-Za-z][\w.-]{0,39}$/.test(k.kind)) throw new Error(`a tile kind's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(k.kind)})`);
  if (registry.has(k.kind)) throw new Error(`tile kind ${k.kind} is registered already`);
  // A live kind keeps its name: a replaces entry over it is refused with the rest of the kind.
  for (const old of k.replaces ?? []) if (registry.has(old)) throw new Error(`tile kind ${k.kind} can't replace ${old}: the door has a kind by that name`);
  const check = k.check;
  registry.set(k.kind, { ...k, check(spec, opening) {
    if (opening) {
      const unused = Object.entries(opening).filter(([key, value]) => value !== undefined && !["kind", "name", ...(k.openArgs ?? [])].includes(key)).map(([key]) => key);
      if (unused.length) return `kind=${k.kind} does not read ${unused.map(key => `${key}=`).join(", ")}; try: ep0ch act tile.open kind=${k.kind}${Object.entries(opening).filter(([key, value]) => value !== undefined && !unused.includes(key) && key !== "kind").map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join("")}`;
      // Missing kind fields still reach the desk, which offers the person the kind's picker.
      return null;
    }
    return check?.(spec) ?? null;
  } });
  for (const old of k.replaces ?? []) { aliases.set(old, k.kind); gone.delete(old); }
  gone.delete(k.kind);
  wentAway.delete(k.kind);
  registryEdits++;
}
/** Take a kind out (an extension unloaded; tests). `why` is what its tiles say until it comes back. */
export function unregisterTileKind(kind: TileKindName, why?: string): boolean {
  const k = registry.get(kind);
  const had = registry.delete(kind);
  registryEdits++;
  if (had) { gone.set(kind, why ?? "it was taken out of the door's tile kinds"); wentAway.set(kind, k!); }
  for (const [old, to] of [...aliases]) if (to === kind) aliases.delete(old);
  return had;
}
/**
 * A served name one of the door's own kinds answers to (the screens extension's `screens.reader` is the door's
 * `reader`): `screens.list` serves a tile's kind as the kind that serves it, and the door draws that kind itself.
 * Nothing when the door has no kind by that name, or already has one by the served name.
 */
export function aliasTileKind(served: TileKindName, own: TileKindName): void { if (registry.has(own) && !registry.has(served)) aliases.set(served, own); }
/**
 * A kind's name as the registry has it now: itself, or, for a retired name an extension's kind `replaces`, that kind.
 * Every lookup by name goes through it (tileKind, isTileKind, a spec's canon), so a saved tile of a replaced kind opens
 * as, and saves under, the kind that serves it. A name nobody replaces is its own.
 */
export const resolveKind = (kind: TileKindName): TileKindName => (registry.has(kind) ? kind : aliases.get(kind) ?? kind);
/** The entries of kinds that went away: a tile of one still running asks its kind's hooks (holds work, when it's free). */
const wentAway = new Map<TileKindName, TileKind>();
/**
 * Built-in kinds the door no longer has, and what took their place (PIE-1455): a saved layout's tile of one is left out as
 * the layout loads, said once, and the layout saves without it. An extension's kind that isn't here waits for its
 * extension instead (UnavailableTile).
 */
export const RETIRED_KINDS: Readonly<Record<string, string>> = {
  "drawer.own": "the drawer's agent is a tab of its own since PIE-1331 (alt+a)",
  "dock.own": "the drawer's agent is a tab of its own since PIE-1331 (alt+a)",
};
/** Why there's no kind by that name: it went (and why), or nothing here registers it (and why not). */
export function missingKind(kind: TileKindName): string {
  return gone.get(kind) ?? "nothing here registers it (an extension's kind: the extension isn't loaded yet, or isn't installed for this outline)";
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
export const tileKind = (kind: string): TileKind | undefined => registry.get(resolveKind(kind));
export const isTileKind = (kind: string): boolean => registry.has(resolveKind(kind));
/** A kind as a message says it (an agent "opened a terminal tile"), never its internal name (`pty`). */
export function kindNoun(kind: string): string {
  const k = registry.get(kind);
  if (k?.noun) return k.noun;
  const word = k?.keys?.[0]?.label ?? kind;
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word} tile`;
}
/** A tile as a message names it: its kind's word, and its name when that says more ("a terminal tile (editor)"). */
export const tileNoun = (kind: string, tile: string): string => `${kindNoun(kind)}${tile.replace(/-\d+$/, "") === kind ? "" : ` (${tile})`}`;
/** A list `b` aims at a note (TileKind.aim): what it lists the links of, and how it's told. */
export interface AimedList extends Pane { source: string; show(m: Msg, desk: DeskApi): Promise<void>; describe(): unknown }
/** Every kind, in the order registered (the built-ins first). */
export const tileKinds = (): TileKind[] => [...registry.values()];
/** A pane's entry (a pane a view brought that isn't registered, the showcase's exhibit, has none). */
export const kindOf = (p: Pane | undefined): TileKind | undefined => (p ? registry.get(p.kind) : undefined);

/** A note sent by a wire or a preview doesn't land in it now: it holds an edit, or the person's keys. */
export const busyFor = (f: KindFacts): boolean => !!(f.editing || f.holdsKeys);
/** A terminal tile's facts (the built-in terminal kind's, and an extension's program tile's): the program running in it. */
export const terminalFacts = (p: Pane): KindFacts => (p instanceof PtyPane && p.running ? { running: p.run.cmd[0] ?? "a program" } : {});
/**
 * An extension kind's declared holds (its manifest's `holds`, PIE-1523): while the person's keys are on a tile of it,
 * it holds them (the typing rule: an agent doesn't move, resize, float or close it, and no open lands in it), and to an
 * agent it holds `edit` when named.
 */
export const declaredFacts = (holds: ServiceHolds | undefined) => (_p: Pane, ask: KindFactsAsk): KindFacts =>
  !holds?.keys || !ask.keys ? {} : { holdsKeys: true, typing: true, holds: true, ...(holds.edit && ask.actor?.kind === "agent" ? { editing: holds.edit } : {}) };
/** What an extension's tile kind declares it holds (`extension.json`'s `tiles[].holds`). */
export interface ServiceHolds { keys?: boolean; edit?: string }
/** A pane's entry, or the one its kind had before it went away (its tile still runs what that kind made). */
export const lastKindOf = (p: Pane | undefined): TileKind | undefined => (p ? registry.get(p.kind) ?? wentAway.get(p.kind) : undefined);
/**
 * What tile `p`'s kind says it is now (`TileKind.facts`); nothing for a kind that says nothing. A kind taken out while
 * its tile lives on (an extension removed with its program running) still answers, as `lastKindOf` does for the desk.
 */
export const factsOf = (p: Pane | undefined, ask: KindFactsAsk = { keys: false }): KindFacts => lastKindOf(p)?.facts?.(p!, ask) ?? {};
/** A kind's action sets: its own, then the ones it shares. */
export const kindActions = (k: TileKind | undefined): ActionSet<any, KindHost>[] => (k ? [...(k.actions ? [k.actions] : []), ...(k.inherits ?? [])] : []);
/** Every kind's action sets, each once (a shared one is listed once). */
export const allKindActions = (): ActionSet<any, KindHost>[] => {
  // Asked by every claim a dispatcher weighs (the power bar's rows ask it for each action line): built once per registry.
  if (kept?.at !== registryEdits) kept = { at: registryEdits, sets: [...new Set(tileKinds().flatMap(kindActions))] };
  return kept.sets;
};
let kept: { at: number; sets: ActionSet<any, KindHost>[] } | null = null;
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
  save(): void;
  /** The tiles following any tile in the container (a preview with `source=tile:<its key>`). */
  followersOf(container: string): Pane[];
  /** Every reader on the screen, by name. */
  readerPanes(): { name: string; pane: import("./panes").ReaderPane }[];
  /** A tile's name. */
  nameOfPane(p: Pane): string;
  /** The person's keys go into the session `p` holds (an edit they left), as e or ⏎ does. */
  enterSession(p: import("./panes").ReaderPane): void;
  /** Leave the screen (the hub picker's q with no board yet): the shell's back. */
  leave(): void;
}

/** A source's model (`TileSource.model`): what a columns container it fills shares, beside its tiles. */
export interface SourceModel {
  /** What the next Esc closes among what it holds open, in the hint's words (esc-rule.ts). */
  escCloses?(): string | null;
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
 * What the service answers for a service-drawn tile: its rows (already styled) or a view (a primitive tree, PIE-1506: a
 * render script's answer, drawn with the door's own primitives, its `list` as the one ListView), a title, and a hint.
 * The kind's code runs in the service (PIE-507's extensions), never in the door.
 */
export interface ServiceFrame {
  lines?: string[]; view?: unknown; title?: string; hint?: string;
  /**
   * What a script's drawing read (PIE-1546): the notes, and whether it asked for machinery. A tool's bookkeeping change
   * (`hidden`) draws it again only when it did, or read that note; absent, every change does.
   */
  read?: { ids: readonly string[]; machinery: boolean };
}
/** How a service-drawn tile asks for its content: the kind, its saved state (the tile's args), the room it has, and the desk it's on. */
export type ServiceRender = (req: { kind: TileKindName; state: Record<string, unknown>; cols: number; rows: number; desk: DeskApi }) => Promise<ServiceFrame>;

/** Marks a drawn list's lines on their way through the view's drawing, so a click finds its row: stripped before the lines are shown. */
const ROW_MARK = "\u{10FFF0}";
const markRow = (row: number | null) => `${ROW_MARK}${row === null ? "-" : row}${ROW_MARK}`;
const MARKED = /^\u{10FFF0}(-|\d+)\u{10FFF0}/u;

/** The list keys a drawn tile's hint row names (LIST_KEYS, the list's own table), and the filter box's while one is typed. */
const SERVICE_KEYS: readonly ModeKey[] = LIST_KEYS.filter(r => ["j", "k", "enter", "alt+enter", "/"].includes(r.key)).map(r => r.key === "alt+enter" ? { ...r, label: "new detail" } : r);
const SERVICE_FILTER_KEYS: readonly ModeKey[] = [{ key: "enter", action: "list.filter", label: "keep" }, { key: "esc", action: "list.filter", label: "undo" }];

/**
 * A tile whose content the service draws: it asks again when its size changes, when the outline changes (after a pause),
 * or when `refresh` is called. A frame that is a view with a `list` is the door's list (PIE-1506): j k and a click pick a
 * row (the preview follows), ⏎ runs the row's one activation (an open lands where this tile's opens land), / filters,
 * and the lists' actions (`list.*`) reach it as they reach a links tile. The picked row's note is the tile's subject, so an
 * extension's block action on the tile acts on it.
 */
export class ServiceTile implements Pane, ListTile<DeskApi> {
  private frame: ServiceFrame | null = null;
  private error: string | null = null;
  private asked = "";
  private drawing = false;
  private drawAgain = false;
  private disposed = false;
  /** The one list its view holds, when it does: the person's pick, each agent's own, the typed filter. */
  readonly list = new ListView<ListViewRow>("service");
  private listNode: ListPrimitive | null = null;
  /** The row each drawn line belongs to (an index into the list's visible rows), or null: for the mouse. */
  private rowAt: (number | null)[] = [];
  private readonly schedule = new SearchSchedule(RELOAD_PAUSE_MS);
  private desk: DeskApi | null = null;
  constructor(readonly kind: TileKindName, private readonly render_: ServiceRender, readonly state: Record<string, unknown> = {}, private readonly label = kind, private readonly keyHint: readonly string[] = []) {}
  title() { return this.frame?.title ?? this.label; }
  hint() {
    if (this.frame?.hint) return this.frame.hint;
    if (this.list.typing) return "type to filter the rows · " + modeHint(SERVICE_FILTER_KEYS, () => undefined);
    const keys = this.keyHint.length ? ` · ${this.keyHint.join(" · ")}` : "";
    return this.listNode ? modeHint(SERVICE_KEYS, () => undefined) + keys : `drawn by the service${keys}`;
  }
  /** Ask the service again (an event, or the size changed). */
  refresh(desk: DeskApi, cols: number, rows: number) {
    if (this.disposed) return;
    this.asked = `${cols}x${rows}`;
    this.desk = desk;
    // One drawing at a time (PIE-1602): each is a worker on the service, up to its whole budget, so a change while one
    // draws asks once more when it ends, and an older answer never lands over a newer one.
    if (this.drawing) { this.drawAgain = true; return; }
    this.drawing = true;
    void this.render_({ kind: this.kind, state: this.state, cols, rows, desk })
      .then(f => { this.frame = f; this.error = null; }, e => { this.error = e instanceof Error ? e.message : String(e); })
      .finally(() => {
        this.drawing = false;
        if (this.disposed) return;
        desk.redraw();
        if (!this.drawAgain) return;
        this.drawAgain = false;
        const [c, r] = this.asked.split("x").map(Number);
        if (c && r) this.refresh(desk, c, r);
      });
  }
  /** Closed: a waiting refresh is dropped, and a drawing still out asks for nothing after it (a redraw, the next drawing). */
  dispose() { this.disposed = true; this.drawAgain = false; this.schedule.cancel(); }
  init(desk: DeskApi) { this.desk = desk; }
  /** Its args changed (the drawer's changes.open on the tab there already): the next frame asks the service again. */
  invalidate() { this.asked = ""; this.desk?.redraw(); }
  /** The outline changed: ask again once the burst is over (what the drawing read isn't known here; the service draws it cheaply). */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    // A tool's bookkeeping a drawing never asked for and never read can't change it (PIE-1546): a note it read is one
    // changed, or one a note was made, moved or trashed under (its children may be what it drew).
    const read = this.frame?.read;
    if (e && !heardBy(e, read && !read.machinery ? id => !e.hidden || (!!id && read.ids.includes(id)) : EVERY_CHANGE)) return;
    this.schedule.pause(() => { const [c, r] = this.asked.split("x").map(Number); if (c && r) this.refresh(desk, c, r); });
  }
  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    // Asked once, and again when the room changed for a frame drawn to fit it (lines); a view is laid out here at any
    // width, so a tile drawn at two sizes in turn (a peek beside its own frame) never asks twice for it.
    if (!this.asked || (this.asked !== `${w}x${h}` && this.frame?.view === undefined)) this.refresh(desk, w, h);
    // Its reason reads whole however narrow the tile: a cut-off says so here (PIE-1602).
    if (this.error) return { lines: ["", ...wrap(`the service couldn't draw ${this.kind}: ${this.error}`, Math.max(1, w - 2)).map(line => `  ${line}`)] };
    if (!this.frame) return { lines: ["", `  asking the service for ${this.kind}…`] };
    if (this.frame.view === undefined) { this.listNode = null; this.rowAt = []; return { lines: (this.frame.lines ?? []).slice(0, h) }; }
    this.listNode = null;
    let drawn: string[];
    try {
      drawn = primitiveLines(this.frame.view, w, {
        list: (node, width) => {
          // The first list is the tile's: its rows go to the one ListView, which keeps the pick and the filter across redraws.
          if (this.listNode) { const v = new ListView("other"); v.set(listRowsOf(node)); return v.draw({ primitive: node, cols: width, lines: 2, focused: false, selection: false, empty: node.empty }).lines; }
          this.listNode = node;
          const was = this.list.picked()?.id;
          this.list.set(listRowsOf(node));
          this.showFirst(desk, was);
          const d = this.list.draw({ primitive: node, cols: width, lines: 2, focused, selection: true, room: h, empty: node.empty ?? "nothing here" });
          return d.lines.map((l, i) => markRow(d.rowAt[i] ?? null) + l);
        },
      });
    } catch (e) { return { lines: ["", `  ${this.kind}: ${e instanceof Error ? e.message : String(e)}`] }; }
    const marked = drawn.map(l => MARKED.exec(l));
    this.rowAt = marked.map(m => (m && m[1] !== "-" ? Number(m[1]) : null));
    const lines = drawn.map((l, i) => (marked[i] ? l.slice(marked[i]![0].length) : l));
    return { lines: lines.slice(0, h) };
  }
  /** The row last handed to the previews (a pick, or showFirst), so a redraw never asks twice. */
  private shownFirst: string | null = null;
  /**
   * The picked row, to the previews its select wire feeds (PIE-1525), through the same path a pick takes: while they show
   * nothing yet (Waiting's reader shows the longest wait as it opens, as the tree shows its first row), and when the
   * rows that came back moved the pick off the row they showed (that ask was answered and left the list).
   */
  private showFirst(desk: DeskApi, was: string | undefined) {
    const row = this.list.picked();
    if (!row || row.id === this.shownFirst || !listOpenTarget(row)?.block || desk.shownNow?.(this) === false) return;
    const moved = was !== undefined && was === this.shownFirst && row.id !== was;
    if (!moved && !desk.previewsEmpty?.(this)) return;
    this.shownFirst = row.id;
    void this.listHost(desk).picked(this.handle(desk), row);
  }
  /** The picked row's note: what the tile is about (an extension's block action on it, `note.trash`, a wire's select). */
  subject(): string | null { const row = this.list.picked(); const to = row ? listOpenTarget(row) : null; return to?.block ?? null; }
  /** The list as the lists' actions run over it (`list.*`, PIE-747): one handle, the tile's own. */
  private handle(desk: DeskApi): ListHandle<ListViewRow> {
    return { n: 1, key: "service", title: this.title(), view: this.list, entered: !!desk.hasFocus?.(this), describeRow: (row, n) => ({ n, ...(listOpenTarget(row)?.block ? { id: listOpenTarget(row)!.block! } : {}) }) };
  }
  listHost(desk: DeskApi): ListHost {
    const show = async (row: ListViewRow, by: Actor) => { if (by.kind !== "agent") this.shownFirst = row.id; const id = listOpenTarget(row)?.block; const m = id ? await desk.ctx.board.get(id) : null; if (m && desk.showFrom && this.list.picked()?.id === row.id) desk.showFrom(this, m, by); desk.redraw(); };
    return {
      lists: () => (this.listNode ? [this.handle(desk)] : []),
      current: () => "service",
      none: `${this.title()} draws no list${this.frame ? "" : " yet"}`,
      picked: (_l, row) => show(row, USER),
      open: async (_l, row, where, actor, standing) => {
        const a = activationOf(row);
        if (!a) throw new ActionRefused(`${row.label} is a header: nothing to open`);
        if (standing) this.list.setPick(PERSON, row.id, row.group);
        if (a.kind === "open") {
          const to = listOpenTarget(row)!;
          if (to.resourceRef) return desk.perform?.("open", { resource: to.resourceRef }, actor, this);
          const m = await desk.ctx.board.get(to.block!);
          if (!m) throw new ActionRefused(`${row.label}: its note ${to.block} is gone`);
          // In the drawer the open lands on the screen shown (a promise, refused when nothing there takes it): awaited, so the refusal is the caller's.
          await (desk.openFromTile(m, { from: this, link: true, reveal: true, ...(where === "new" ? { fresh: true } : {}), by: actor }) as unknown as Promise<void> | void);
          desk.redraw();
          return { opened: m.id, title: row.label };
        }
        if (a.kind === "run") { const v = a.value as { action: string; args?: Record<string, string> }; return desk.perform?.(v.action, v.args ?? {}, actor, this); }
        if (a.kind === "copy") { if (actor.kind !== "agent") desk.ctx.copy?.(a.value as string); return { copied: a.value }; }
        throw new ActionRefused(`${row.label} inserts text: that belongs in a note's list, where a draft is; a drawn tile has none`);
      },
      enter: () => {},
      type: () => { if (!this.list.typing) this.list.startTyping(filterLine); desk.redraw(); },
      redraw: () => desk.redraw(),
    };
  }
  private runList(desk: DeskApi, name: "list.pick" | "list.step" | "list.open" | "list.filter", args: Record<string, unknown>) { void desk.press?.(this, LISTVIEW_ACTIONS, name, args); }
  /** Esc takes back the filter being typed (esc-rule.ts). */
  escCloses() { return this.list.typing ? lineEscCloses(this.list.typing, "the filter") : undefined; }
  private filterKey(k: Key, desk: DeskApi): boolean {
    const t = this.list.typing!;
    if (k.kind === "enter") this.list.stopTyping(true);
    else if (k.kind === "esc") this.list.stopTyping(false);
    else if (!t.take(k)) return k.kind !== "tab" && k.kind !== "backtab";
    desk.redraw();
    return true;
  }
  blur() { if (this.list.typing) this.list.stopTyping(true); }
  key(k: Key, desk: DeskApi): boolean {
    if (!this.listNode) return false;
    if (this.list.typing && k.kind !== "mouse") return this.filterKey(k, desk);
    const n = this.list.pickable().length, c = ch(k);
    if (isDown(k)) { if (n) this.runList(desk, "list.step", { by: 1 }); return true; }
    if (isUp(k)) { if (n) this.runList(desk, "list.step", { by: -1 }); return true; }
    if (k.kind === "home") { if (n) this.runList(desk, "list.pick", { n: 1 }); return true; }
    if (k.kind === "end") { if (n) this.runList(desk, "list.pick", { n }); return true; }
    if (k.kind === "enter" || k.kind === "alt-enter") { if (n) this.runList(desk, "list.open", { where: k.kind === "alt-enter" ? "new" : "home" }); return true; }
    if (c === "/") { this.runList(desk, "list.filter", {}); return true; }
    return false;
  }
  /** A press as the keys escalate: select, a double click opens (⏎), an alt-, ctrl- or middle-click opens in a new detail (alt+⏎); the wheel moves the pick. */
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (!this.listNode) return true;
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.runList(desk, "list.step", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const i = this.rowAt[y] ?? -1, row = this.list.visible()[i];
    if (!row) return true;
    const picked = this.list.picked()?.id === row.id;
    const gesture = this.list.press(i, pressOn(k, press, picked));
    const n = this.list.pickable().indexOf(row) + 1;
    if (!n) return true;
    if (gesture === "open" || gesture === "fresh") this.runList(desk, "list.open", { n, where: gesture === "fresh" ? "new" : "home" });
    else if (gesture === "select" || !picked) this.runList(desk, "list.pick", { n });
    return true;
  }
  describe() { return { ...(this.listNode ? { rows: this.list.describe(PERSON, (row, n) => ({ n, ...(listOpenTarget(row)?.block ? { id: listOpenTarget(row)!.block! } : {}) })) } : {}), ...(this.error ? { error: this.error } : {}) }; }
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

/** The args a service kind's tiles take (a program's `--name=value`, a drawn tile's props), as the service declares them. */
export type ServiceArgs = Record<string, { type: string; description?: string }>;

/**
 * The registry entry for a kind the service provides (PIE-507, PIE-1506): rows or a view the service draws (`render`, a
 * ServiceTile), a query the door's query tile lists (`view`, the query kind's own hooks, the tile of this kind), or a
 * program the service names (`program`, a terminal tile of that kind with the terminal kind's own hooks). `args` are
 * what a tile of it is opened and saved with; a `block` arg is the note read where it's opened.
 */
export function serviceKind(o: { kind: TileKindName; about: string; noun?: string; render?: ServiceRender; view?: string; program?: ServiceProgram; args?: ServiceArgs; keyHint?: readonly string[]; /** A drawn tile's keys to its actions (an extension's `d`): pressed in it, the action runs on the picked row. */ keyActions?: Readonly<Record<string, string>>; policy?: Policy; accepts?: TileKind["accepts"]; keys?: readonly KindKey[]; actions?: TileKind["actions"]; replaces?: readonly TileKindName[]; /** What its tiles hold while the person's keys are on one (PIE-1523). */ holds?: ServiceHolds }): TileKind {
  const declared = declaredFacts(o.holds);
  const base = { kind: o.kind, about: o.about, noun: o.noun, keys: o.keys, policy: o.policy, accepts: o.accepts, actions: o.actions, replaces: o.replaces, facts: declared };
  const prog = o.program;
  const args = o.args ?? prog?.args ?? {};
  const blockArg = Object.entries(args).find(([, a]) => a.type === "block")?.[0];
  // A block arg is the note read where it's opened (^W o from a reader or a detail), unless tile.open named
  // one (note=). Only a kind that reads a note gives one, never a cursor (the tree's row, a lane's card,
  // which at the start is the outline's first root), so a program never writes where the person didn't
  // open it. A note the person reads counts even at the top level: an outline may have several roots.
  // Otherwise it's left unset, and the tile says so.
  const defaults: TileKind["defaults"] = (s, at) => {
    if (!blockArg || s.note || stateOf(s)[blockArg]) return {};
    const k = registry.get(at.pane.kind);
    if (!k?.accepts?.notes || k.follower) return {};
    const m = k.shows?.(at.pane);
    return m ? { state: { ...stateOf(s), [blockArg]: m.id } } : {};
  };
  /** The tile's args from its spec: its saved state (tile.open's with=), and `note=` for its block arg. */
  const stateFrom = (s: Partial<TileSpec>) => ({ ...stateOf(s), ...(blockArg && s.note && !stateOf(s)[blockArg] ? { [blockArg]: s.note } : {}) });
  if (o.view !== undefined) {
    // A view tile is the query kind's tile: the same cards, keys, mouse, previews and saving; the kind is this one.
    const q = registry.get("query");
    if (!q) throw new Error(`${o.kind} draws a view through the query kind, which isn't registered yet`);
    return {
      ...q, ...base, check: undefined, choices: undefined, openArgs: ["view", "source", "mode"], previews: true,
      make: s => { const p = q.make({ ...s, kind: "query", ...(s.view ? {} : { query: o.view }) }) as Pane & { kind: TileKindName }; p.kind = o.kind; return p; },
      ...(q.actions ? { inherits: [q.actions] } : {}),
    };
  }
  if (!prog) {
    const render = o.render ?? (async () => ({ lines: ["", `  ${o.kind} has nothing to draw with`] }));
    // A drawn list in the drawer opens its rows on the screen shown (as the waiting and what-changed lists do), unless a wire says where.
    const keyActions = o.keyActions ?? {};
    return { ...base, previews: true, opensOnScreen: true, openArgs: ["state", ...(blockArg ? ["note"] : [])], defaults, make: s => new ServiceTile(o.kind, render, stateFrom(s), s.name ?? o.kind, o.keyHint),
      // The extension's keys in its tile (`d`): its action on the picked row, unless the person is typing a filter.
      press: (p, k) => { const c = ch(k); return p instanceof ServiceTile && !p.list.typing && c && keyActions[c] ? { action: keyActions[c]! } : null; },
      describe: (p, full) => ({ ...(p instanceof ServiceTile ? { args: p.state, ...(full ? p.describe() : {}) } : {}) }),
      peek: p => (p instanceof ServiceTile ? { [o.kind]: p.describe() } : {}) };
  }
  // A terminal tile's hooks are the built-in terminal kind's: how it starts, what it shows, that it holds work.
  const pty = registry.get("pty");
  return {
    ...base,
    openArgs: ["state", ...(blockArg ? ["note"] : [])],
    make: s => {
      const state = stateFrom(s);
      if (prog.unavailable) return new UnavailableTile(o.kind, prog.unavailable, state);
      // Only the args it declares reach the program, each as --name=value.
      const argv = Object.keys(prog.args).flatMap(k => (typeof state[k] === "string" && state[k] ? [`--${k}=${state[k]}`] : []));
      return new ProgramTile(o.kind, { cmd: [...prog.command, ...argv], cwd: prog.cwd, env: prog.env, label: s.name ?? prog.label }, state, prog.keys, prog.label);
    },
    save: p => (p instanceof ProgramTile || p instanceof UnavailableTile ? (Object.keys(p.state).length ? { state: p.state } : {}) : {}),
    defaults,
    holdsWork: p => p instanceof PtyPane && p.running,
    facts: (p, ask) => ({ ...terminalFacts(p), ...declared(p, ask) }),
    // The terminal's own actions, keys and wait for its program, as a built-in terminal tile has them.
    ...(pty?.actions ? { inherits: [pty.actions] } : {}),
    ...(pty?.press ? { press: (p: Pane, k: Key) => (p instanceof PtyPane ? pty.press!(p, k) : null) } : {}),
    ...(pty?.whenFree ? { whenFree: (p: Pane, then: () => void) => { if (p instanceof PtyPane) pty.whenFree!(p, then); } } : {}),
    ...(pty?.start ? { start: (p: Pane, env: TileEnv) => { if (p instanceof PtyPane) pty.start!(p, env); } } : {}),
    ...(pty?.view ? { view: (p: Pane, mine: boolean) => (p instanceof PtyPane ? pty.view!(p, mine) : { viewport: {} }) } : {}),
    describe: (p, full) => ({ ...(p instanceof PtyPane && pty?.describe ? pty.describe(p, full) : {}), ...(p instanceof ProgramTile || p instanceof UnavailableTile ? { args: p.state } : {}), ...(p instanceof UnavailableTile ? { unavailable: true } : {}) }),
  };
}

/** A reader's one mode (PIE-1207): pinned, or left out; `held` (every reader now) reads as left out, for scripts that say it. */
export const READER_MODES = ["pinned", "held"] as const;
