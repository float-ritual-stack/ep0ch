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

/**
 * The layers a key passes through, first first (App.route, then the desk's key, then its tile's): the hyper layer, the
 * person's keymap, the drawer, the door's keys on every screen, the ^W keys, a mode (an edit, a comment, a panel), the
 * focused tile's keys, then the screen's own. A key a layer takes never reaches the ones under it.
 */
export const LAYERS = ["hyper", "yours", "drawer", "every screen", "^W", "mode", "tile", "screen"] as const;
export type Layer = (typeof LAYERS)[number];

/** Where an action set's keys work: its scope's layer. */
const SCOPE_LAYER: Record<string, Layer> = {
  shell: "every screen", "status bar": "every screen", bar: "every screen", macros: "every screen", new: "every screen", host: "every screen",
  message: "every screen", status: "every screen", registry: "every screen", hint: "every screen",
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
  layer: Layer;
  /** What it does there, in its own words: the row's, the table's label, else the action's summary. */
  does: string;
  /** The action's own words (its summary's first clause). */
  about: string;
  /** Where it comes from: an action's own keys, a key table, or the keymap file (a key it gives). */
  from: "action" | "table" | "yours";
  /** It can be moved through the keymap: true, or why not. */
  rebind: true | string;
  /** The keymap gives it this key (it's not the built-in). */
  yours?: true;
}

const clause = (summary: string) => summary.split(/[.:;(]/)[0]!.trim();
const GESTURES = new Set(["click", "drag", "wheel", "hover", "sideways"]);
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
  const summary = (action: string) => { const d = defs.get(action)?.def; return d ? clause(d.summary) : action; };
  const held = new Set<string>();
  const tables = [...keyTables(), ...(screen.length ? [{ scope: screenName, about: "this screen's keys", rows: screen, prefix: "" }] : [])];
  for (const t of tables) {
    const rows = effective(t.rows, t.prefix);
    for (const r of rows) {
      if (GESTURES.has(r.key)) continue;
      const key = tableKey(t.prefix, r.key), args = r.args ?? {}, id = bindingId(r.action, args);
      const yours = keymapEntries().some(e => e.id === id && e.keys.includes(key));
      held.add(`${key} ${r.action}`);
      out.push({
        key, cap: capOf(key), action: r.action, args, id, scope: t.scope, layer: t.screen || (t.scope === screenName && screen.length) ? "screen" : tableLayer(t.scope),
        does: (r as { label?: string }).label || summary(r.action), about: summary(r.action), from: yours ? "yours" : "table",
        rebind: t.prefix === "hyper+" ? `a hyper chord: the window can't read one (the door takes it first), so give it another in keybindings.json ("${bindingId(r.action, r.args ?? {})}": [..., "hyper+<key>"])` : rebindable(t.rows, r) ? true : `${r.action} is bound to several keys here, each a different way (${rows.filter(x => x.action === r.action && !GESTURES.has(x.key)).map(x => capOf(tableKey(t.prefix, x.key))).join(" ")}): they move together in code, not one at a time`,
        ...(yours ? { yours: true as const } : {}),
      });
      // The table's binding is said once, at its key, even when its tile kind's keys repeat it.
    }
  }
  for (const [action, { scope, def }] of defs) {
    if (!def.keys) continue;
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
        out.push({ key, cap: capOf(key), action, args: {}, id: bindingId(action), scope, layer: SCOPE_LAYER[scope] ?? "tile", does: row.does || clause(def.summary), about: clause(def.summary), from: "action", rebind: key.includes(" ") && !key.startsWith("ctrl+w ") ? "a key after another key (a then c): the keymap binds one key or a ^W chord" : true });
      }
    }
    // A key the keymap gives the whole action that it didn't declare.
    for (const key of entry?.keys ?? []) if (!seen.has(key) && !held.has(`${key} ${action}`)) out.push({ key, cap: capOf(key), action, args: {}, id: bindingId(action), scope, layer: "yours", does: clause(def.summary), about: clause(def.summary), from: "yours", rebind: true, yours: true });
  }
  // An entry with arguments for an action no table holds: its keys, pressed through the App's layer.
  for (const e of keymapEntries()) {
    if (!Object.keys(e.args).length || tables.some(t => t.rows.some(r => bindingId(r.action, r.args ?? {}) === e.id))) continue;
    for (const key of e.keys) out.push({ key, cap: capOf(key), action: e.action, args: e.args, id: e.id, scope: defs.get(e.action)?.scope ?? "yours", layer: "yours", does: summary(e.action), about: summary(e.action), from: "yours", rebind: true, yours: true });
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
  const same = all.filter(x => x !== b && x.key === b.key && x.id !== b.id);
  return {
    under: same.filter(x => LAYERS.indexOf(x.layer) > at),
    over: same.filter(x => LAYERS.indexOf(x.layer) < at),
    terminal: !(b.layer === "hyper" || b.key === ESCAPE_CHORD),
  };
}

/**
 * Keys two bindings claim in one place (the same layer and scope), so which runs depends on the code's order: the keys
 * window's Conflicts. A key the keymap gives that a built-in binding in the same scope also has is one too.
 */
export function conflicts(all: readonly Binding[]): Binding[][] {
  const groups = new Map<string, Binding[]>();
  for (const b of all) {
    const k = `${b.layer} ${b.scope} ${b.key}`;
    const g = groups.get(k) ?? [];
    if (!g.some(x => x.id === b.id)) g.push(b);
    groups.set(k, g);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

/**
 * What giving `key` to binding `b` would do, said before it lands: the bindings that have that key in the same scope or
 * layer (they lose it, or keep it under `b`), and the ones over it that keep taking it first. `key` is a one-key name or a ^W chord.
 */
export function rebindEffects(b: Binding, key: string, all: readonly Binding[]): { takes: Binding[]; under: Binding[]; over: Binding[]; problem: string | null } {
  const name = chordName(key) ?? key;
  if (b.rebind !== true) return { takes: [], under: [], over: [], problem: b.rebind };
  if (GESTURES.has(name)) return { takes: [], under: [], over: [], problem: "a mouse gesture isn't a key: clicks stay where they are" };
  if (b.key.startsWith("ctrl+w ") !== name.startsWith("ctrl+w ")) return { takes: [], under: [], over: [], problem: b.key.startsWith("ctrl+w ") ? `${b.cap} is a ^W key: press ^W, then the key` : "a ^W chord goes to a ^W key; this one is a key of its own" };
  if (b.key.startsWith("hyper+") !== name.startsWith("hyper+")) return { takes: [], under: [], over: [], problem: "a hyper chord goes to a hyper chord: hold ⌃⌥⇧⌘ and press the key" };
  const there = all.filter(x => x.key === name && x.id !== b.id);
  const at = LAYERS.indexOf(b.layer === "yours" ? "yours" : b.layer);
  return {
    takes: there.filter(x => x.scope === b.scope),
    under: there.filter(x => x.scope !== b.scope && LAYERS.indexOf(x.layer) >= at),
    over: there.filter(x => x.scope !== b.scope && LAYERS.indexOf(x.layer) < at),
    problem: null,
  };
}
