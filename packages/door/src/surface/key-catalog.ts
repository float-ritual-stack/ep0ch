// Every key binding the door has, with where it works and what it takes from what (PIE-492): the keys window's list, read
// from the parts that bind keys, never written again. An action's own keys (ActionDef.keys, its rows), the key tables
// (the ^W keys, each mode's, the hyper layer: `keyTable`), a screen's keys (its spec's), and the person's keymap file over
// all of them (src/surface/keymap.ts). Where two bind one key, the one the door hands the key to first takes it: the
// layers are in the order the App and the desk hand a key down (`LAYERS`).
import { ESCAPE_CHORD } from "../desk/pty";
import { hyperLabel } from "../hyper";
import { keyAlternatives } from "../figures/keys";
import { allActionSets, chordName, declaredKeys, keyCaption, type ActionDef, type KeyRow } from "./actions";
import { bindingId, effective, keymapEntries, keyTables, rebindable, type KeymapEntry, type TableRow } from "./keymap";
import { screenNames } from "../desk/screen-spec";

/**
 * The layers a key passes through, first first (App.route, then the desk's key, then its tile's): the hyper layer, the
 * person's keymap, the drawer, the door's keys on every screen, the ^W keys, a mode (an edit, a comment, a panel), the
 * screen's own (its spec's keys, which Desk.boundKey presses before any tile's: the river's x, PIE-1439), then the
 * focused tile's keys. A key a layer takes never reaches the ones under it.
 */
export const LAYERS = ["hyper", "yours", "drawer", "every screen", "^W", "mode", "screen", "tile"] as const;
export type Layer = (typeof LAYERS)[number];

/** Where an action set's keys work: its scope's layer. */
const SCOPE_LAYER: Record<string, Layer> = {
  shell: "every screen", "status bar": "every screen", bar: "every screen", macros: "every screen", new: "every screen", host: "every screen",
  hint: "every screen",
  // A screen's own sets: the message reader's (opened from a list), the message log's, the showcase's registry.
  message: "screen", status: "screen", registry: "screen",
  drawer: "drawer", agents: "drawer", "agent focus": "drawer",
  draft: "mode", completion: "mode",
  board: "screen", river: "screen", desk: "screen", home: "screen", welcome: "screen", echo: "screen", showcase: "screen", brief: "screen",
  waiting: "screen", menu: "screen", art: "screen", blank: "screen", activity: "screen", who: "screen",
};
/** A table's layer: the ^W keys and the hyper layer are their own; every other table is a mode's. */
const tableLayer = (scope: string): Layer => (scope === "^W" ? "^W" : scope === "hyper" ? "hyper" : SCOPE_LAYER[scope] ?? "mode");

/** One binding: a key, what it runs, where, and whether the keymap can move it. */
export interface Binding {
  /** The key by its one name (`j`, `ctrl+w x`, `hyper+p`), and as its keycap shows it (`^W x`, `✦p`). */
  key: string; cap: string;
  action: string; args: Record<string, unknown>;
  /** The binding's name in the keymap file: its act line. */
  id: string;
  /** Where it works: the action set's scope (note, tile, shell) or the table's (^W, sources, comment). */
  scope: string;
  /** The action set whose place its table is part of (KeyTable.within: the river column's tables, `river`). */
  within?: string;
  layer: Layer;
  /** What it does there, in its own words: the row's, the table's label, else the action's summary. */
  does: string;
  /** The action's own words (its summary's first clause). */
  about: string;
  /** Where it comes from: an action's own keys, a key table, or the keymap file (a key it gives). */
  from: "action" | "table" | "yours" | "unbound";
  /** `does` is the row's own whole sentence (`says`), not the action's words and then the row's. */
  said?: true;
  /** It can be moved through the keymap: true, or why not. */
  rebind: true | string;
  /** The keymap gives it this key (it's not the built-in). */
  yours?: true;
  /** The key table it's a row of (its place in `keyTables`): a key is looked up in one table first to last. */
  table?: number;
  /** A screen's row runs only while the focused tile is of these kinds (`only`), or not of these (`unless`). */
  only?: readonly string[]; unless?: readonly string[];
}

/** A screen's row's kinds of focused tile (KeyBinding's `only`, `unless`). */
const kinds = (r: TableRow & { only?: readonly string[]; unless?: readonly string[] }) => ({ ...(r.only ? { only: r.only } : {}), ...(r.unless ? { unless: r.unless } : {}) });
const clause = (summary: string) => summary.split(/[.:;(]/)[0]!.trim();
/** A table row's words: its `says`, else its label where it says something (`close sources`), else the action's words with it (`query` alone isn't). */
const tableWords = (r: TableRow, about: string) => r.says ?? (!r.label ? about : r.label.trim().split(/\s+/).length > 1 ? r.label : whole(about, r.label, ""));
/** An action's own words for a row: its `words`, else its summary's first clause. */
const aboutOf = (def: ActionDef<any, any>) => def.words ?? clause(def.summary);
/**
 * A row of an action's keys as the keys window lists it, a whole sentence: the action's own words, then the row's where
 * or when ("start recording, while recording"), since the list shows no heading above it as the action's page does. A row
 * that says the action's words already, or a part of them, is them; `then …` is a key and what follows it (^K then
 * typing); `or …` names another way, so the key itself does what the action does.
 */
function whole(about: string, does: string, cap: string): string {
  const d = does.trim().replace(/^\([^)]*\)\s*/, "");
  const a = about.toLowerCase(), l = d.toLowerCase();
  if (!d || l.startsWith(a) || a.includes(l) || /^or\b/.test(l)) return l.startsWith(a) ? d : about;
  if (/^then\b/.test(l)) return `${about}: ${cap} ${d}`;
  return `${about}, ${d}`;
}
const GESTURE_WORDS = ["click", "drag", "wheel", "hover", "sideways"];
/** A mouse gesture, with a modifier or not (ctrl+wheel, alt-click): a gesture, never a key the window lists or moves. */
const GESTURES = { has: (key: string) => GESTURE_WORDS.some(g => key === g || key.endsWith(`+${g}`) || key.endsWith(`-${g}`)) };
/** A table row's key as a binding's one name: the ^W keys after `ctrl+w `, the hyper ones after `hyper+`. */
const tableKey = (prefix: string, key: string) => (prefix === "ctrl+w " ? `ctrl+w ${key === " " ? "space" : key}` : prefix + key);
const capOf = (key: string) => (key.startsWith("hyper+") ? hyperLabel(key.slice(6)) : keyCaption(key));

/**
 * Every key binding now, with the keymap applied: each table's rows (through `effective`), each action's own keys that
 * no table holds (one key or a chord, mouse gestures left out), and the screen's keys `screen` gives (a spec's).
 * `defOf` finds an action's def (the screen's dispatcher), so a summary names what this screen runs.
 */
export function bindings(screen: readonly TableRow[] = [], screenName = "screen"): Binding[] {
  const out: Binding[] = [];
  const defs = new Map<string, { scope: string; def: ActionDef<any, any> }>();
  for (const set of allActionSets()) for (const name of set.names()) if (!defs.has(name)) defs.set(name, { scope: set.scope, def: set.def(name)! });
  const summary = (action: string) => { const d = defs.get(action)?.def; return d ? aboutOf(d) : action; };
  const held = new Set<string>();
  const tables = [...keyTables(), ...(screen.length ? [{ scope: screenName, about: "this screen's keys", rows: screen, prefix: "" }] : [])];
  for (const [table, t] of tables.entries()) {
    const rows = effective(t.rows, t.prefix);
    for (const r of rows) {
      if (GESTURES.has(r.key)) continue;
      const key = tableKey(t.prefix, r.key), args = r.args ?? {}, id = bindingId(r.action, args);
      const yours = keymapEntries().some(e => e.id === id && e.keys.includes(key));
      held.add(`${key} ${r.action}`);
      out.push({
        key, cap: capOf(key), action: r.action, args, id, scope: t.scope, ...(t.within ? { within: t.within } : {}), layer: t.screen || (t.scope === screenName && screen.length) ? "screen" : tableLayer(t.scope),
        does: tableWords(r, summary(r.action)), about: summary(r.action), from: yours ? "yours" : "table",
        rebind: t.prefix === "hyper+" ? `a hyper chord: the window can't read one (the door takes it first), so give it another in keybindings.json ("${bindingId(r.action, r.args ?? {})}": [..., "hyper+<key>"])` : rebindable(t.rows, r) ? true : `${r.action} is bound to several keys here, each a different way (${rows.filter(x => x.action === r.action && !GESTURES.has(x.key)).map(x => capOf(tableKey(t.prefix, x.key))).join(" ")}): they move together in code, not one at a time`,
        ...(yours ? { yours: true as const } : {}), table,
        ...kinds(r),
      });
      // The table's binding is said once, at its key, even when its tile kind's keys repeat it.
    }
  }
  for (const [action, { scope, def }] of defs) {
    // A key the keymap gives an action that declares none (one moved out of Unbound).
    if (!def.keys) {
      for (const key of keymapEntries().find(e => e.action === action && !Object.keys(e.args).length)?.keys ?? []) if (!held.has(`${key} ${action}`)) out.push({ key, cap: capOf(key), action, args: {}, id: bindingId(action), scope, layer: "yours", does: aboutOf(def), about: aboutOf(def), from: "yours", rebind: true, yours: true });
      continue;
    }
    // A line of keys reads as the rows `::graph-keys` draws from it (the parser test/key-rows.test.ts holds to keycaps).
    const rows: KeyRow[] = typeof def.keys === "string" ? keyAlternatives(def.keys).flatMap(r => (r.keys === "or" ? [] : [{ keys: r.keys, does: r.action }])) : [...def.keys];
    const entry = keymapEntries().find(e => e.action === action && !Object.keys(e.args).length);
    const seen = new Set<string>();
    for (const row of rows) {
      if (!("keys" in row)) continue;
      for (const key of declaredKeys(row.keys)) {
        if (GESTURES.has(key) || held.has(`${key} ${action}`) || seen.has(key) || key === "ctrl+w") continue;
        seen.add(key);
        const gone = entry && !entry.keys.includes(key);
        if (gone) continue;
        // A row that names its place (`on`) is that place's own key: a screen's (the menu's letters) in its layer, a tile
        // kind's (the tune inspector's) in the tile layer.
        const on = row.on;
        out.push({ key, cap: capOf(key), action, args: {}, id: bindingId(action), scope: on ?? scope, layer: on ? SCOPE_LAYER[on] ?? "tile" : SCOPE_LAYER[scope] ?? "tile", does: row.says ?? whole(aboutOf(def), row.does, capOf(key)), about: aboutOf(def), from: "action", ...(row.says ? { said: true as const } : {}), rebind: key.includes(" ") && !key.startsWith("ctrl+w ") ? "a key after another key (a then c): the keymap binds one key or a ^W chord" : true });
      }
    }
    // A key the keymap gives the whole action that it didn't declare.
    for (const key of entry?.keys ?? []) if (!seen.has(key) && !held.has(`${key} ${action}`)) out.push({ key, cap: capOf(key), action, args: {}, id: bindingId(action), scope, layer: "yours", does: aboutOf(def), about: aboutOf(def), from: "yours", rebind: true, yours: true });
  }
  // An entry with arguments for an action no table holds: its keys, pressed through the App's layer.
  for (const e of keymapEntries()) {
    if (!Object.keys(e.args).length || tables.some(t => t.rows.some(r => bindingId(r.action, r.args ?? {}) === e.id))) continue;
    for (const key of e.keys) out.push({ key, cap: capOf(key), action: e.action, args: e.args, id: e.id, scope: defs.get(e.action)?.scope ?? "yours", layer: "yours", does: summary(e.action), about: summary(e.action), from: "yours", rebind: true, yours: true });
  }
  return out;
}

/**
 * Every action the person can run that no key reaches on any screen (the keys window's Unbound): read from the action
 * sets, one row each with no key (`key` ""), where it runs as its scope. `rebind` says why a bare key won't do for one
 * that can't run without arguments (its act line with them goes in keybindings.json instead).
 */
export function unbound(all: readonly Binding[]): Binding[] {
  const keyed = new Set(all.map(b => b.action)), seen = new Set<string>(), out: Binding[] = [];
  for (const set of allActionSets()) for (const name of set.names()) {
    if (keyed.has(name) || seen.has(name)) continue;
    seen.add(name);
    const def = set.def(name)!, about = aboutOf(def);
    const needs = Object.entries(def.args ?? {}).filter(([, a]) => !(a as { optional?: boolean }).optional).map(([k]) => `${k}=`);
    out.push({ key: "", cap: "", action: name, args: {}, id: bindingId(name), scope: set.scope, layer: SCOPE_LAYER[set.scope] ?? "tile", does: about, about, from: "unbound",
      rebind: needs.length ? `it needs ${needs.join(" ")} to run: a bare key would be refused, so bind its act line with them in ${"keybindings.json"} ("${name} ${needs.map(n => `${n}…`).join(" ")}": ["<key>"])` : true });
  }
  return out;
}

/** The keymap entries whose action this door doesn't have (a typo, an extension not bound): the window says them. */
export function strayEntries(): KeymapEntry[] {
  const names = new Set(allActionSets().flatMap(s => s.names()));
  return keymapEntries().filter(e => !names.has(e.action));
}

/**
 * What binding `b` takes its key from and what takes it from `b`: the same key in a layer under it (it gets the key first,
 * where both apply) and over it. `terminal`: whether a program in a terminal tile still gets the key (only the hyper layer
 * and ctrl+], which steps out of the tile, are the door's there).
 */
export function shadowsOf(b: Binding, all: readonly Binding[]): { under: Binding[]; over: Binding[]; terminal: boolean } {
  const at = LAYERS.indexOf(b.layer);
  const same = all.filter(x => x !== b && x.key === b.key && x.id !== b.id && together(x, b));
  return {
    under: same.filter(x => LAYERS.indexOf(x.layer) > at),
    over: same.filter(x => LAYERS.indexOf(x.layer) < at),
    terminal: !(b.layer === "hyper" || b.key === ESCAPE_CHORD),
  };
}

/** The one screen a binding's key works on: a screen's own key (its scope), or a table's place (the river column's, `river`). */
const placeOf = (b: Binding): string | undefined => (b.layer === "screen" ? b.scope : b.within);
/** A screen of tiles (a registered screen spec: the desk, the board, the river), where tiles' keys, modes and ^W work. */
const tiled = (screen: string) => screenNames().includes(screen);
/** The layers only a screen of tiles has: a tile's keys, a mode's, the ^W keys. */
const TILE_LAYERS: ReadonlySet<Layer> = new Set(["^W", "mode", "tile"]);
/**
 * Whether two bindings can both be live on one screen (PIE-1439): two screens' own keys never meet, and a screen with no
 * tiles (the main menu) has no tile, mode or ^W keys. The keys window says a key "taken by" only where both are.
 */
function together(a: Binding, b: Binding): boolean {
  const pa = placeOf(a), pb = placeOf(b);
  if (pa && pb) return pa === pb;
  const lone = (p: string | undefined, other: Binding) => !!p && !tiled(p) && TILE_LAYERS.has(other.layer);
  return !lone(pa, b) && !lone(pb, a);
}
/** Whether binding `b` works on screen or in place `where` (`in:river`): its scope, the set its table is part of, its layer, or a ^W chord on a screen of tiles. */
export function worksIn(b: Binding, where: string): boolean {
  return b.scope.toLowerCase() === where || b.within === where || b.layer === where || (b.layer === "^W" && tiled(where));
}

/** Whether two rows of one table can be live at once: the kinds of focused tile each runs for meet. */
const meet = (a: Binding, b: Binding) => {
  if (a.only && b.only) return a.only.some(k => b.only!.includes(k));
  if (a.only || b.only) { const [o, x] = a.only ? [a, b] : [b, a]; return !x.unless || o.only!.some(k => !x.unless!.includes(k)); }
  return true;
};

/**
 * The keys two bindings really fight over, by the order the door looks a key up (the keys window's Conflicts): two rows of
 * one key table on one key, both live for the same tile (a table is read first to last, `modeBinding` and the screen's
 * keys, so the second never runs), and two entries of the keymap file on one key (the App's layer presses the last one,
 * `entryOfKey`). An action set's own keys aren't: its code matches each key once and picks by what's open (esc clears the
 * bar's line, then closes it), so two of its actions on one key are one key, one meaning at a time. A key in two layers
 * is a shadow, said on each binding (`shadowsOf`), not a fight.
 */
export function conflicts(all: readonly Binding[]): Binding[][] {
  // A key the file gives two entries: wherever their rows land, only the last entry is ever pressed for it.
  const twice = new Set(keymapEntries().flatMap(e => e.keys).filter((k, i, ks) => ks.indexOf(k) !== i));
  const groups = new Map<string, Binding[]>();
  for (const b of all) {
    const at = b.yours && twice.has(b.key) ? `file ${b.key}` : b.table !== undefined ? `table ${b.table} ${b.key}` : b.layer === "yours" ? `file ${b.key}` : null;
    if (at === null) continue;
    const g = groups.get(at) ?? [];
    if (!g.some(x => x.id === b.id)) g.push(b);
    groups.set(at, g);
  }
  const order = (id: string) => keymapEntries().findIndex(e => e.id === id);
  return [...groups.entries()].flatMap(([at, g]) => (at.startsWith("file ") ? (g.length > 1 ? [g.sort((a, b) => order(a.id) - order(b.id)).map(({ table: _table, ...b }) => b)] : []) : g.some((b, i) => g.slice(i + 1).some(x => meet(b, x))) ? [g] : []));
}

/** Who wins a fight `conflicts` found, by the same lookup: a table's first row, the file's last entry. */
export function fightOf(g: readonly Binding[]): { wins: string; loses: string[]; why: string } {
  const file = g[0]!.table === undefined;
  const w = file ? g.at(-1)! : g[0]!;
  // A first row that runs only on some tiles wins only there.
  const there = !file && w.only ? ` (on a ${w.only.join(" or ")} tile)` : !file && w.unless ? ` (but on a ${w.unless.join(" or ")} tile)` : "";
  return { wins: w.id, loses: g.filter(b => b !== w).map(b => b.id), why: file ? "the keymap file's last entry for a key is the one pressed" : `its table is read first to last: the first row on a key is the one that runs${there}` };
}

/**
 * What giving `key` to binding `b` would do, said before it lands: the bindings that have that key in the same scope or
 * layer (they lose it, or keep it under `b`), and the ones over it that keep taking it first. `key` is a one-key name or a ^W chord.
 */
export function rebindEffects(b: Binding, key: string, all: readonly Binding[]): { takes: Binding[]; under: Binding[]; over: Binding[]; problem: string | null } {
  const name = chordName(key) ?? key;
  if (b.rebind !== true) return { takes: [], under: [], over: [], problem: b.rebind };
  if (GESTURES.has(name)) return { takes: [], under: [], over: [], problem: "a mouse gesture isn't a key: clicks stay where they are" };
  if (b.key && b.key.startsWith("ctrl+w ") !== name.startsWith("ctrl+w ")) return { takes: [], under: [], over: [], problem: b.key.startsWith("ctrl+w ") ? `${b.cap} is a ^W key: press ^W, then the key` : "a ^W chord goes to a ^W key; this one is a key of its own" };
  if (b.key.startsWith("hyper+") !== name.startsWith("hyper+")) return { takes: [], under: [], over: [], problem: "a hyper chord goes to a hyper chord: hold ⌃⌥⇧⌘ and press the key" };
  // Only where both can work (PIE-1439): another screen's own key loses nothing, as the rows say.
  const there = all.filter(x => x.key === name && x.id !== b.id && together(x, b));
  // A key given to an action with none is pressed through the App's keymap layer, over the screens' own.
  const at = LAYERS.indexOf(!b.key || b.layer === "yours" ? "yours" : b.layer);
  // A key given to an action with none takes it only from your other keymap entries (setKeys moves those); a built-in
  // binding keeps it, under your keymap's layer, wherever the action can't run.
  const takes = (x: Binding) => (b.key ? x.scope === b.scope : x.from === "yours");
  return {
    takes: there.filter(takes),
    under: there.filter(x => !takes(x) && (b.key ? x.scope !== b.scope : true) && LAYERS.indexOf(x.layer) >= at),
    over: there.filter(x => !takes(x) && (b.key ? x.scope !== b.scope : true) && LAYERS.indexOf(x.layer) < at),
    problem: null,
  };
}
