// A screen as a spec (PIE-515): what a screen is, as data. The desk is the only screen host (src/desk/desk.ts); every
// screen built on it (the desk, the board, the welcome, the brief, Waiting, a pinned page, the river) is one of these,
// and nothing else: no subclass, no override. A spec says
//
// - its containers with their policy, and its tiles by kind with their names, args and links (`layout`: the layout
//   tree as saved, PIE-474; the screen's own policy, outermost, says where the host layer may appear: `host`);
// - a key map that names actions (`keys`): a key here runs that action, as the person, before the focused tile's own;
// - a hint row (`hint`), shown after the focused tile's own keys;
// - a band above the tiles, drawn by one of its tiles' kinds (`band`);
// - where an agent's open lands (`lands`), and what an "open fresh" (alt+⏎) runs (`fresh`);
// - whether it keeps its layout between runs (`saves`), and whether it loads named layouts (`layouts`).
//
// Everything a screen does that isn't layout lives in its tiles' kinds (src/desk/tile-kinds.ts) and their actions.
// A spec is plain data (`specData` writes it, `readSpec` reads it back and checks it): ready to be stored as a note
// (gap 4, screens as notes), which can't hold an override.
import { isTileKind } from "./tile-kinds";
import type { LayoutSpec } from "./tiles";
import { isKeyName } from "../surface/actions";

/** One key of a screen's key map: the key by its one name (`keyName`: `L`, `,`, `alt+c`, `esc`, `alt+left`), the action it runs, and with what. */
export interface KeyBinding {
  key: string;
  action: string;
  args?: Record<string, unknown>;
  /** The tile it runs in (by name); left out, the action's own default (the focused tile, or the one tile of its kind). */
  tile?: string;
  /** Not while the focused tile is one of these kinds (a tree's own `L`). */
  unless?: string[];
  /** Only while the focused tile is one of these kinds. */
  only?: string[];
}

export interface ScreenSpec {
  /** What the screen is (`desk`, `welcome`): `peek`'s kind, and how `openScreen` and the menu's items name it. */
  name: string;
  /** Its title (the status bar), until a tile of it names it otherwise. */
  title: string;
  /** Its containers with their policy and its tiles by kind: the layout tree as saved (PIE-474). */
  layout: LayoutSpec;
  /** Its keys: each names an action, run as the person, before the focused tile's own keys. */
  keys?: KeyBinding[];
  /**
   * Its hint row while nothing else is going on (`|NN` colours, as the BBS's): one for the whole screen, or one per
   * focused tile's kind (`query`, `backlinks`; `float` for a float, `spine` after a folded tile's name, `*` the rest).
   */
  hint?: string | Record<string, string>;
  /** The tile (by name) whose kind draws a band across the top of the screen (the welcome's logo and tabs). */
  band?: string;
  /** The glyphs its tiles' frames are drawn with: `dotted` (the welcome's `::....::`), or the desk's lines. */
  frame?: "dotted";
  /** `false`: the digits are the screen's own (its key map's), so tiles aren't numbered and 1-9 don't focus them. */
  digits?: false;
  /**
   * Where the keys go back to (a tile's name or a container's key: the board's lanes): `Esc` and `q` step back there
   * before they leave the screen, and the keys land there when the drawer they were in shuts.
   */
  home?: string;
  /** Where an agent's open naming no tile lands (`ep0ch open <id>`): a tile, by name, that takes the note its way. */
  lands?: string;
  /** What an "open fresh" (alt+⏎, a ctrl- or alt-click) from its tiles runs, with `id`: an action's name. */
  fresh?: string;
  /** Where it keeps its layout between runs (a file in the door's state); left out, it opens as its spec says each time. */
  saves?: string;
  /** It loads and saves named layouts (alt+d, ^W r, ^W w), and its programs keep running when it's left (the desk). */
  layouts?: true;
}

const NAME = /^[A-Za-z][\w.-]{0,39}$/;
const kinds = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every(k => typeof k === "string") ? [...x] : undefined);

/**
 * A spec as data (what a note would hold): its fields as they are, nothing that isn't data. A spec is already plain
 * data; this is the copy that goes out (the layout's own tree as it was given).
 */
export function specData(s: ScreenSpec): unknown { return JSON.parse(JSON.stringify(s)); }

/**
 * A spec read back from data (a note's, a saved one's): checked field by field, a bad one refused with what's
 * wrong. The tiles' kinds are checked against the registry only by `known` (a kind an extension hasn't loaded yet
 * is a tile that says so, as in any saved layout).
 */
export function readSpec(x: unknown, known = false): ScreenSpec {
  const o = (x && typeof x === "object" ? x : null) as Record<string, unknown> | null;
  if (!o) throw new Error("a screen spec is an object");
  const name = o.name, title = o.title, layout = o.layout as LayoutSpec | undefined;
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`a screen's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(name)})`);
  if (typeof title !== "string" || !title.trim()) throw new Error(`screen ${name}: title is the words its status bar shows`);
  if (!layout || typeof layout !== "object" || !layout.root || typeof layout.root !== "object") throw new Error(`screen ${name}: layout is a layout as saved, with a root`);
  const keys = o.keys === undefined ? undefined : Array.isArray(o.keys) ? o.keys.map((b: any, i: number) => {
    if (!b || typeof b !== "object" || !isKeyName(b.key)) throw new Error(`screen ${name}: key ${i + 1} names no key (a character, enter, esc, space, shift+tab, alt+left, alt+<c>, ctrl+<c>…)`);
    if (typeof b.action !== "string" || !b.action) throw new Error(`screen ${name}: key ${b.key} names no action`);
    return {
      key: b.key, action: b.action,
      ...(b.args && typeof b.args === "object" && !Array.isArray(b.args) ? { args: { ...b.args } } : {}),
      ...(typeof b.tile === "string" ? { tile: b.tile } : {}),
      ...(kinds(b.unless) ? { unless: kinds(b.unless)! } : {}),
      ...(kinds(b.only) ? { only: kinds(b.only)! } : {}),
    } satisfies KeyBinding;
  }) : (() => { throw new Error(`screen ${name}: keys is a list`); })();
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? { [k]: o[k] as string } : {});
  const spec: ScreenSpec = {
    name, title, layout,
    ...(keys ? { keys } : {}),
    ...str("hint"), ...hintMap(o.hint), ...str("band"), ...str("home"), ...str("lands"), ...str("fresh"), ...str("saves"),
    ...(o.frame === "dotted" ? { frame: "dotted" as const } : {}),
    ...(o.digits === false ? { digits: false as const } : {}),
    ...(o.layouts === true ? { layouts: true as const } : {}),
  };
  if (known) for (const k of leafKinds(layout.root)) if (!isTileKind(k)) throw new Error(`screen ${name}: no tile kind ${k} here`);
  // What it names by name is in its layout: a key's tile, the band's tile, where opens land and the keys go home.
  const tiles = new Set(leafNames(layout.root)), places = new Set([...tiles, ...containerKeys(layout.root)]);
  // `all`: every tile (tile.collapse on=false tile=all reopens every spine); a container by its key: the tile last in it.
  for (const b of spec.keys ?? []) if (b.tile !== undefined && b.tile !== "all" && !places.has(b.tile)) throw new Error(`screen ${name}: key ${b.key} runs in tile ${b.tile}, which its layout hasn't`);
  if (spec.band !== undefined && !tiles.has(spec.band)) throw new Error(`screen ${name}: its band is drawn by tile ${spec.band}, which its layout hasn't`);
  for (const k of ["lands", "home"] as const) if (spec[k] !== undefined && !places.has(spec[k]!)) throw new Error(`screen ${name}: ${k} names ${spec[k]}, neither a tile nor a container of its layout`);
  return spec;
}

/**
 * Every node of a saved or spec'd tree, outermost first: the one walk over a layout as data (either form; anything in
 * it that isn't a node is skipped).
 */
export function savedNodes(n: any): any[] {
  if (!n || typeof n !== "object") return [];
  if (n.t === "leaf") return [n];
  return [n, ...[...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid, n.a, n.b].flatMap(savedNodes)];
}
const leafField = (n: unknown, f: "name" | "kind"): string[] => savedNodes(n).flatMap(x => (x.t === "leaf" && typeof x[f] === "string" ? [x[f]] : []));
/** The names of a saved tree's tiles, the kinds of them, and the keys of its containers. */
export const leafNames = (n: unknown) => leafField(n, "name");
const leafKinds = (n: unknown) => leafField(n, "kind");
export const containerKeys = (n: unknown): string[] => savedNodes(n).flatMap(x => (x.t !== "leaf" && typeof x.key === "string" ? [x.key] : []));
/** A hint per focused kind, as data: its strings only. */
const hintMap = (x: unknown): { hint?: Record<string, string> } => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out = Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]);
  return Object.keys(out).length ? { hint: out } : {};
};

// ── the screens the door knows by name ──────────────────────────────────────────

/** A screen's spec, made when it's asked for (a pinned page's names its page). */
export type SpecOf = (args?: Record<string, unknown>) => ScreenSpec;
const specs = new Map<string, SpecOf>();
/** Register a screen by name (refused under a name taken already). */
export function registerScreen(name: string, of: SpecOf): void {
  if (!NAME.test(name)) throw new Error(`a screen's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(name)})`);
  if (specs.has(name)) throw new Error(`screen ${name} is registered already`);
  specs.set(name, of);
}
/** The spec of the screen named `name`, or null. */
export function screenSpec(name: string, args?: Record<string, unknown>): ScreenSpec | null {
  const of = specs.get(name);
  return of ? of(args) : null;
}
/** Every screen registered, by name. */
export const screenNames = (): string[] => [...specs.keys()];
