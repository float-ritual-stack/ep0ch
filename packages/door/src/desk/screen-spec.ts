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
import { useScreenTables, type KeyTable } from "../surface/keymap";
import { isTileKind } from "./tile-kinds";
import { readSpec as readSpecData, savedNodes, screenNameProblem, screenSlug, type KeyBinding, type MenuRow, type ScreenSpec } from "@ep0ch/outline-core/screen-spec";
// What a screen is as data (ScreenSpec, its keys and new-note rules, the walk over a saved tree, a part of a screen, a
// group) is outline-core's (screen-spec.ts): every client that opens a screen reads the same spec. This module keeps
// what is the door's own: the check against its tile kinds, and the screens it knows by name.
export {
  containerKeys, groupSpec, leafNames, menuRowProblem, NEW_NOTE_OPENS, newNoteRule, partSpec, savedNodes, screenNameProblem, screenParts, screenSlug, slotNames, specData,
  type KeyBinding, type MenuRow, type NewNoteOpens, type NewNoteRule, type ScreenSpec,
} from "@ep0ch/outline-core/screen-spec";

/** x closes a reader or a preview where the screen lets it close (a detail, a float): the board's and the river's one key (PIE-1403). */
export const CLOSE_KEY: KeyBinding = { key: "x", label: "close", action: "tile.close", only: ["preview", "reader"] };

/**
 * A spec read back from data (a note's, a saved one's): checked field by field, a bad one refused with what's
 * wrong (outline-core's `readSpec`). The tiles' kinds are checked against the registry only by `known` (a kind an
 * extension hasn't loaded yet is a tile that says so, as in any saved layout).
 */
export function readSpec(x: unknown, known = false): ScreenSpec { return readSpecData(x, known ? k => isTileKind(k) : undefined); }

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
  made?: { id: string; revision: number; title?: string };
  /** A screen an extension ships (PIE-1525, its manifest's `screens[]`): the extension's id. It goes when the extension stops. */
  extension?: string;
}
const specs = new Map<string, SpecOf>();
const registrations = new Map<string, ScreenRegistration>();
/** Goes up with every screen registered or forgotten: what a reader of the registry (the menu's rows) keys its copy on. */
let version = 0;
export const screensVersion = (): number => version;

/**
 * Why a screen can't be saved as `title` (what a person typed: spaces and capitals are fine), or null. The reason says
 * the name it would have and, where there is one, a name that would work.
 */
export function screenTitleProblem(title: string): string | null {
  const t = title.trim();
  if (!t) return "type a name for the screen (daily test saves as daily-test)";
  if (/[\[\]\n\r]/.test(t)) return `a screen's name has no [ ], and is one line (${JSON.stringify(t)}) · try ${JSON.stringify(t.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim() || "my screen")}`;
  if (t.length > 60) return `a screen's name is at most 60 characters (this is ${t.length}) · try ${JSON.stringify(t.slice(0, 60).trim())}`;
  const slug = screenSlug(t);
  if (screenNameProblem(slug)) {
    const tail = slug.replace(/^[^a-z]+/, "");
    return slug
      ? `a screen's name starts with a letter (${JSON.stringify(t)} would be ${slug})${tail ? ` · try ${JSON.stringify(tail)}` : ""}`
      : `a screen's name needs letters (${JSON.stringify(t)} has none to make a name from) · try ${JSON.stringify("my screen")}`;
  }
  if (registrations.get(slug)?.extension) return `${slug} is the ${registrations.get(slug)!.extension} extension's screen · try ${JSON.stringify(`${t} 2`)} (saves as ${screenSlug(`${t} 2`)})`;
  if (builtinScreen(slug)) return `${slug} is a built-in screen's name · try ${JSON.stringify(`${t} 2`)} (saves as ${screenSlug(`${t} 2`)})`;
  return null;
}
/** The name a screen a person made is shown by: its title, as they typed it (else the name). */
export const screenTitle = (name: string): string => registrations.get(name)?.made?.title || name;
/**
 * The registered screen `asked` means: its name, a screen a person made by its title (case aside), or the name a
 * typed title would be. Null when there's none; a built-in's name is itself.
 */
export function resolveScreen(asked: string): string | null {
  const a = asked.trim();
  if (specs.has(a)) return a;
  const lower = a.toLowerCase();
  for (const [name, r] of registrations) if (r.made?.title && r.made.title.toLowerCase() === lower) return name;
  const slug = screenSlug(a);
  return slug && specs.has(slug) ? slug : null;
}
/** Register a screen by name (refused under a name taken already). */
export function registerScreen(name: string, of: SpecOf, how: ScreenRegistration = {}): void {
  const bad = screenNameProblem(name);
  if (bad) throw new Error(bad);
  if (specs.has(name)) throw new Error(`screen ${name} is registered already`);
  specs.set(name, of);
  registrations.set(name, how);
  version++;
}
/** Take out a screen a person made (its note was trashed, renamed or changed) or an extension's (it stopped); a built-in never goes. */
export function forgetScreen(name: string): boolean {
  const r = registrations.get(name);
  if (!r?.made && !r?.extension) return false;
  specs.delete(name);
  registrations.delete(name);
  version++;
  return true;
}
/** The note a screen a person made is kept in (its id and the revision this door read), or undefined for a built-in. */
export const madeScreen = (name: string): { id: string; revision: number; title?: string } | undefined => registrations.get(name)?.made;
/** A screen the door itself registers (desk, board, blank…): a screen note can't take its name. */
export const builtinScreen = (name: string): boolean => specs.has(name) && !registrations.get(name)?.made && !registrations.get(name)?.extension;
/** The screens an extension the repo offers (not installed here) would add, with the words that install it (PIE-1525). */
let installable = new Map<string, string>();
export const useInstallableScreens = (m: Map<string, string>): void => { installable = m; };
/** How to get screen `name` back, when an extension that isn't installed here adds it; else null. */
export const installableScreen = (name: string): string | null => installable.get(name) ?? null;
/** The extension whose screen `name` is (PIE-1525), or undefined. */
export const extensionScreen = (name: string): string | undefined => registrations.get(name)?.extension;
/** Who holds a screen name, in words: "the waiting extension", "a built-in", "a screen note". */
export const screenHolder = (name: string): string => {
  const r = registrations.get(name);
  return !r ? "nobody" : r.extension ? `the ${r.extension} extension` : r.made ? "a screen you made" : "a built-in screen";
};
/**
 * Every registered screen whose spec names a menu row (PIE-1525), in the order they were registered: built-ins, then
 * extensions', then the ones people made. A spec that needs its target to be made has none.
 */
export function menuScreens(): { name: string; menu: MenuRow; title: string }[] {
  const out: { name: string; menu: MenuRow; title: string }[] = [];
  for (const [name, of] of specs) {
    let spec: ScreenSpec | null = null;
    try { spec = of(); } catch { /* a screen that needs its target names no row */ }
    if (spec?.menu) out.push({ name, menu: spec.menu, title: registrations.get(name)?.made?.title || spec.title });
  }
  // Built-ins, then extensions', then made: the same order however the door's reads of them landed.
  const rank = (name: string) => (registrations.get(name)?.made ? 2 : registrations.get(name)?.extension ? 1 : 0);
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}
/** The spec of the screen named `name`, or null. */
export function screenSpec(name: string, args?: Record<string, unknown>): ScreenSpec | null {
  const of = specs.get(name);
  return of ? of(args) : null;
}
/** The argument a target fills on the screen named `name` (none: it takes no target). */
export const screenTargetArg = (name: string): string | undefined => registrations.get(name)?.target;
/** Every screen registered, by name. */
export const screenNames = (): string[] => [...specs.keys()];

// Each screen's own key map is a key table of the keymap's (PIE-492), under the screen's name: built once per set of screens.
let screenKeyTables: { names: string; tables: KeyTable[] } | null = null;
useScreenTables(() => {
  const names = screenNames().join(" ");
  if (screenKeyTables?.names === names) return screenKeyTables.tables;
  const tables: KeyTable[] = [];
  for (const n of screenNames()) {
    let keys: readonly KeyBinding[] | undefined;
    try { keys = screenSpec(n)?.keys; } catch { keys = undefined; }      // a screen that needs its target to be made has none to say
    if (keys?.length) tables.push({ scope: n, about: `the ${n} screen's own keys`, rows: keys, prefix: "", screen: true });
  }
  screenKeyTables = { names, tables };
  return tables;
});

// ── a screen mounted in another (PIE-651) ──

/** Mounts nest this deep at most: a screen holding a mount holding a mount… (four: the top, then three below it). */
export const MAX_MOUNT_DEPTH = 4;
/** The screens a spec mounts, by name (a `screen` tile; a saved one of the retired `board` and `river` kinds mounts that screen, as canonSpec reads it). */
const mountsIn = (spec: ScreenSpec): string[] => savedNodes(spec.layout.root).flatMap(n => (n.t === "leaf" ? [typeof n.screen === "string" && n.screen ? n.screen : n.kind === "board" || n.kind === "river" ? n.kind : ""] : [])).filter(Boolean);
/**
 * Why `screen` can't be mounted under `chain` (the screens held one inside the next, outermost first; "group" is a
 * group's tiles, never a screen), or null: it is in the chain already (itself, or A holding B holding A: said as the
 * chain, "daily-test → focus → daily-test"), a screen it mounts would be (its saved spec is walked), or the mounts
 * would nest past MAX_MOUNT_DEPTH (groups count for neither). `part`: only a part of it is mounted, so only the chain is checked. One rule for a mount opened, restored and a saved screen's spec loading.
 */
export function mountProblem(chain: readonly string[], screen: string, part = false): string | null {
  const shown = (extra: string) => [...chain.filter(n => n !== "group"), extra].join(" → ");
  if (chain.includes(screen)) return `a screen can't hold itself: ${shown(screen)}`;
  if (chain.filter(n => n !== "group").length >= MAX_MOUNT_DEPTH) return `mounts nest at most ${MAX_MOUNT_DEPTH} deep: ${shown(screen)}`;
  // A part holds only its container: what the rest of the screen mounts is not shown, so it is not walked.
  if (part) return null;
  let inner: ScreenSpec | null = null;
  try { inner = screenSpec(screen); } catch { /* a spec that needs its target: it mounts nothing to follow */ }
  if (!inner) return null;
  for (const m of mountsIn(inner)) { const why = mountProblem([...chain, screen], m); if (why) return why; }
  return null;
}

