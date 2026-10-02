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
import type { Key } from "../term";

/** One key of a screen's key map: the key (`L`, `,`, `alt+c`, `esc`), the action it runs, and with what. */
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
  /** Its hint row, after the focused tile's own keys (`|NN` colours, as the BBS's). */
  hint?: string;
  /** The tile (by name) whose kind draws a band across the top of the screen (the welcome's logo and tabs). */
  band?: string;
  /** The glyphs its tiles' frames are drawn with: `dotted` (the welcome's `::....::`), or the desk's lines. */
  frame?: "dotted";
  /** `false`: the digits are the screen's own (its key map's), so tiles aren't numbered and 1-9 don't focus them. */
  digits?: false;
  /** Where an agent's open naming no tile lands (`ep0ch open <id>`): a tile, by name, that takes the note its way. */
  lands?: string;
  /** What an "open fresh" (alt+⏎, a ctrl- or alt-click) from its tiles runs, with `id`: an action's name. */
  fresh?: string;
  /** Where it keeps its layout between runs (a file in the door's state); left out, it opens as its spec says each time. */
  saves?: string;
  /** It loads and saves named layouts (alt+d, ^W r, ^W w), and its programs keep running when it's left (the desk). */
  layouts?: true;
}

const KEY_WORDS = new Set(["enter", "esc", "tab", "backtab", "backspace", "up", "down", "left", "right", "pgup", "pgdn", "home", "end", "delete", "alt-enter", "alt-left", "alt-right"]);

/** A key as a key map names it: the character, or its word (`enter`, `alt+c`, `ctrl+e`). Null: a key no map names. */
export function keyName(k: Key): string | null {
  if (k.kind === "char") return "pasted" in k && k.pasted ? null : k.ctrl ? `ctrl+${k.ch}` : k.ch;
  if (k.kind === "alt") return `alt+${k.ch}`;
  if (k.kind === "mouse" || k.kind === "paste" || k.kind === "super" || k.kind === "back" || k.kind === "forward") return null;
  if ((k.kind === "enter" || k.kind === "tab") && "pasted" in k && k.pasted) return null;
  return k.kind;
}
const goodKey = (s: unknown): s is string => typeof s === "string" && (/^.$/u.test(s) || /^(alt|ctrl)\+.$/u.test(s) || KEY_WORDS.has(s));
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
    if (!b || typeof b !== "object" || !goodKey(b.key)) throw new Error(`screen ${name}: key ${i + 1} names no key (a character, enter, esc, tab, alt+<c>, ctrl+<c>…)`);
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
    ...str("hint"), ...str("band"), ...str("lands"), ...str("fresh"), ...str("saves"),
    ...(o.frame === "dotted" ? { frame: "dotted" as const } : {}),
    ...(o.digits === false ? { digits: false as const } : {}),
    ...(o.layouts === true ? { layouts: true as const } : {}),
  };
  if (known) for (const k of leafKinds(layout.root)) if (!isTileKind(k)) throw new Error(`screen ${name}: no tile kind ${k} here`);
  // What it names by name is in its layout: a key's tile, the band's tile, where opens land and the keys go home.
  const tiles = new Set(leafNames(layout.root)), places = new Set([...tiles, ...containerKeys(layout.root)]);
  for (const b of spec.keys ?? []) if (b.tile !== undefined && !tiles.has(b.tile)) throw new Error(`screen ${name}: key ${b.key} runs in tile ${b.tile}, which its layout hasn't`);
  if (spec.band !== undefined && !tiles.has(spec.band)) throw new Error(`screen ${name}: its band is drawn by tile ${spec.band}, which its layout hasn't`);
  if (spec.lands !== undefined && !places.has(spec.lands)) throw new Error(`screen ${name}: lands names ${spec.lands}, neither a tile nor a container of its layout`);
  return spec;
}

/** The names of a saved tree's tiles, and the keys of its containers. */
function leafNames(n: any): string[] {
  if (!n || typeof n !== "object") return [];
  if (n.t === "leaf") return typeof n.name === "string" ? [n.name] : [];
  return [...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid, n.a, n.b].flatMap(leafNames);
}
function containerKeys(n: any): string[] {
  if (!n || typeof n !== "object" || n.t === "leaf") return [];
  return [...(typeof n.key === "string" ? [n.key] : []), ...[...(Array.isArray(n.kids) ? n.kids : []), n.kid, n.a, n.b].flatMap(containerKeys)];
}

/** The kinds of a saved tree's tiles. */
function leafKinds(n: any): string[] {
  if (!n || typeof n !== "object") return [];
  if (n.t === "leaf") return typeof n.kind === "string" ? [n.kind] : [];
  return [...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid, n.a, n.b].flatMap(leafKinds);
}

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
