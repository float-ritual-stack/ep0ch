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
// - whether it keeps its layout between runs (`saves`), and whether it loads named layouts (`layouts`);
// - what a new note (ctrl+n, `note.new`) does on it (`newNote`): where it opens, or an action of its own in its place.
//
// Everything a screen does that isn't layout lives in its tiles' kinds (src/desk/tile-kinds.ts) and their actions.
// A spec is plain data (`specData` writes it, `readSpec` reads it back and checks it): what a screen note holds (a
// screen a person made, PIE-565: src/desk/screen-notes.ts), which can't hold an override.
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

/**
 * Where a new note opens (PIE-591): `float`, a draft floating over the screen (each one more, cascaded); `tab`, a new tab
 * on the focused tile; `drawer`, a tab in your drawer; `lands`, where the screen's opens land (a reader beside the one
 * you're in, the board's readers row, the river's next column).
 */
export type NewNoteOpens = "float" | "tab" | "drawer" | "lands";
export const NEW_NOTE_OPENS: readonly NewNoteOpens[] = ["float", "tab", "drawer", "lands"];
/**
 * One rule of a screen's new notes (PIE-591): while the focused tile is (`only`) or isn't (`unless`) one of these kinds,
 * ctrl+n runs `action` instead of making a note (the board's lanes: `card.new`, a card born with the lane's
 * properties), or opens the note where `opens` says. The first rule that matches wins; none: a float.
 */
export interface NewNoteRule {
  opens?: NewNoteOpens;
  action?: string;
  args?: Record<string, unknown>;
  only?: string[];
  unless?: string[];
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
   * before they leave the screen, and the keys land there when the dock they were in shuts.
   */
  home?: string;
  /** Where an agent's open naming no tile lands (`ep0ch open <id>`): a tile, by name, that takes the note its way. */
  lands?: string;
  /** What an "open fresh" (alt+⏎, a ctrl- or alt-click) from its tiles runs, with `id`: an action's name. */
  fresh?: string;
  /** Where it keeps its layout between runs (a file in the door's state); left out, it opens as its spec says each time. */
  saves?: string;
  /** It loads and saves named layouts (alt+d, ^W r, ^W w): its tiles are the person's own, any kind in any place. */
  layouts?: true;
  /** Its programs keep running when it's left, and opening it again brings the same one back (the desk). */
  stays?: true;
  /** What ctrl+n (`note.new`) does here (PIE-591): the first rule matching the focused tile's kind; none, a float. */
  newNote?: NewNoteRule[];
}

/** The rule of `spec`'s new notes for a focused tile of `kind` (PIE-591), or null: a float. */
export function newNoteRule(spec: Pick<ScreenSpec, "newNote">, kind: string | undefined): NewNoteRule | null {
  return spec.newNote?.find(r => (!r.only || (kind !== undefined && r.only.includes(kind))) && (!r.unless || kind === undefined || !r.unless.includes(kind))) ?? null;
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
  const newNote = o.newNote === undefined ? undefined : Array.isArray(o.newNote) ? o.newNote.map((r: any, i: number) => {
    if (!r || typeof r !== "object") throw new Error(`screen ${name}: newNote rule ${i + 1} is an object (opens= or action=)`);
    if (r.opens !== undefined && !NEW_NOTE_OPENS.includes(r.opens)) throw new Error(`screen ${name}: newNote rule ${i + 1} opens ${JSON.stringify(r.opens)}; it opens ${NEW_NOTE_OPENS.join(", ")}`);
    if (r.action !== undefined && (typeof r.action !== "string" || !r.action)) throw new Error(`screen ${name}: newNote rule ${i + 1} names no action`);
    if ((r.opens === undefined) === (r.action === undefined)) throw new Error(`screen ${name}: newNote rule ${i + 1} gives one of opens= or action=`);
    return {
      ...(r.opens !== undefined ? { opens: r.opens as NewNoteOpens } : {}), ...(r.action !== undefined ? { action: r.action as string } : {}),
      ...(r.args && typeof r.args === "object" && !Array.isArray(r.args) ? { args: { ...r.args } } : {}),
      ...(kinds(r.unless) ? { unless: kinds(r.unless)! } : {}),
      ...(kinds(r.only) ? { only: kinds(r.only)! } : {}),
    } satisfies NewNoteRule;
  }) : (() => { throw new Error(`screen ${name}: newNote is a list of rules`); })();
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? { [k]: o[k] as string } : {});
  const spec: ScreenSpec = {
    name, title, layout,
    ...(keys ? { keys } : {}),
    ...(newNote ? { newNote } : {}),
    ...str("hint"), ...hintMap(o.hint), ...str("band"), ...str("home"), ...str("lands"), ...str("fresh"), ...str("saves"),
    ...(o.frame === "dotted" ? { frame: "dotted" as const } : {}),
    ...(o.digits === false ? { digits: false as const } : {}),
    ...(o.layouts === true ? { layouts: true as const } : {}),
    ...(o.stays === true ? { stays: true as const } : {}),
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
/**
 * How a screen is registered: `target` names the argument a target fills (`ep0ch --screen <name> <target>`,
 * `screen.open name= target=`): detail's `note` (a block), the board's `hub`, a pinned page's `address`.
 */
export interface ScreenRegistration {
  target?: string;
  /** A screen a person made (a screen note in the outline, src/desk/screen-notes.ts): its note's id and revision. */
  made?: { id: string; revision: number };
}
const specs = new Map<string, SpecOf>();
const registrations = new Map<string, ScreenRegistration>();
/** Why `name` can't be a screen's name, or null. */
export const screenNameProblem = (name: string): string | null => (NAME.test(name) ? null : `a screen's name is a letter, then letters, digits, . - _, at most 40 (not ${JSON.stringify(name)})`);
/** Register a screen by name (refused under a name taken already). */
export function registerScreen(name: string, of: SpecOf, how: ScreenRegistration = {}): void {
  const bad = screenNameProblem(name);
  if (bad) throw new Error(bad);
  if (specs.has(name)) throw new Error(`screen ${name} is registered already`);
  specs.set(name, of);
  registrations.set(name, how);
}
/** Take out a screen a person made (its note was trashed, renamed or changed); a built-in never goes. */
export function forgetScreen(name: string): boolean {
  if (!registrations.get(name)?.made) return false;
  specs.delete(name);
  registrations.delete(name);
  return true;
}
/** The note a screen a person made is kept in (its id and the revision this door read), or undefined for a built-in. */
export const madeScreen = (name: string): { id: string; revision: number } | undefined => registrations.get(name)?.made;
/** A screen the door itself registers (desk, board, blank…): a screen note can't take its name. */
export const builtinScreen = (name: string): boolean => specs.has(name) && !registrations.get(name)?.made;
/** The spec of the screen named `name`, or null. */
export function screenSpec(name: string, args?: Record<string, unknown>): ScreenSpec | null {
  const of = specs.get(name);
  return of ? of(args) : null;
}
/** The argument a target fills on the screen named `name` (none: it takes no target). */
export const screenTargetArg = (name: string): string | undefined => registrations.get(name)?.target;
/** Every screen registered, by name. */
export const screenNames = (): string[] => [...specs.keys()];

// ── a screen mounted in another (PIE-651) ──────────────────────────────────────

/**
 * The part of a screen named `key` (a container's key, or a tile's name) as a screen of its own: its layout is that
 * subtree, and what the spec names outside it is left out (a key bound to a tile that isn't there, its band, where its
 * opens land and its keys go home), so a mount of the board's lanes is the lanes alone. A container whose tiles come from
 * data (the lanes) holds a place holder until its source fills it: a screen is never blank. Throws when there's no such part.
 */
export function partSpec(spec: ScreenSpec, key: string): ScreenSpec {
  const found = savedNodes(spec.layout.root).find(n => (n.t === "leaf" ? n.name === key : n.key === key));
  if (!found) throw new Error(`the ${spec.name} screen has no part ${key}; its parts: ${screenParts(spec).join(", ") || "none"}`);
  let root = JSON.parse(JSON.stringify(found.t === "dock" ? found.kid : found));
  if (!leafNames(root).length && root.t === "columns") root = { ...root, kids: [{ t: "leaf", kind: "filling", name: `${key}-filling`, label: `${key} · filling from its source…` }], weights: [1] };
  const tiles = new Set(leafNames(root)), places = new Set([...tiles, ...containerKeys(root)]);
  const inside = (name: string | undefined) => name === undefined || name === "all" || places.has(name);
  const { saves: _saves, band, home, lands, keys, ...rest } = spec;
  const policy = spec.layout.policy ? { ...spec.layout.policy } : undefined;
  if (policy?.opensInto && !places.has(policy.opensInto)) delete policy.opensInto;
  const focus = typeof spec.layout.focus === "string" && tiles.has(spec.layout.focus) ? spec.layout.focus : leafNames(root)[0];
  return {
    ...rest,
    title: `${spec.title} · ${key}`,
    layout: { root, ...(focus ? { focus } : {}), ...(spec.layout.rule ? { rule: spec.layout.rule } : {}), ...(policy && Object.keys(policy).length ? { policy } : {}) },
    ...(keys ? { keys: keys.filter(b => inside(b.tile)) } : {}),
    ...(band && tiles.has(band) ? { band } : {}),
    ...(home && places.has(home) ? { home } : {}),
    ...(lands && places.has(lands) ? { lands } : {}),
  };
}
/** The parts of a screen a mount can name (`part=`): its containers' keys, then its tiles' names. */
export const screenParts = (spec: ScreenSpec): string[] => [...containerKeys(spec.layout.root), ...leafNames(spec.layout.root)];

/**
 * A group (PIE-651): tiles gathered into one tile, laid out as a screen of their own (a tab's split, "splits in my
 * tabs"). Its spec is its tree; it has no screen elsewhere, no keys of its own and no file: the tile holding it saves it.
 */
export function groupSpec(root: unknown, label?: string): ScreenSpec {
  return { name: "group", title: label || "group", digits: false, layout: { root: root as LayoutSpec["root"] } };
}
