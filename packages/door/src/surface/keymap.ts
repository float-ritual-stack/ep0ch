// The person's keymap (PIE-492): one file, `keybindings.json` in the door's state dir, in the outliner's
// keybindings.json shape: an object from a binding to its keys, where `[]` leaves it unbound. A binding is named by its act
// line (the action and the arguments it runs with, `tile.resize by=-1 axis=row`, as `ep0ch act` takes it), so the same
// name works for a key, a click and an agent. A key is one key or a ^W chord, by its one name (`alt+l`, `ctrl+w q`).
//
//   { "note.new": ["alt+n"], "tile.close": ["ctrl+w q"], "element.select by=1": ["]", "n"], "callouts": [] }
//
// What follows it: every key table (W_KEYS, the modes' tables, HYPER_KEYS, a screen's keys) through `effective`, so the
// key that matches is the key the hint, the panel and the menu say; a key matched in code (the reader's `z`) through the
// App's layer (a key the file gives an action presses it) and `moved` (a key the file took away from an action is refused,
// saying where it went). The keys window (src/surface/keys-window.ts) writes it; a person may edit it by hand.
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "../state";
import { actRequestOf, allActionSets, chordName, declaredKeys, keyCaption, lineWords, shownLine, type Keys, type KeyRow } from "./actions";

/** The file: EP0CH_KEYMAP when set (a test's), else keybindings.json in the state dir (EP0CH_STATE moves it with the rest). */
export const keymapPath = (env: Record<string, string | undefined> = process.env) => env.EP0CH_KEYMAP?.trim() || join(stateDir(), "keybindings.json");

/** One entry of the file: the binding (its act line, split) and its keys. */
export interface KeymapEntry { id: string; action: string; args: Record<string, unknown>; keys: string[] }

/** A binding's name: its act line. */
export const bindingId = (action: string, args: Record<string, unknown> = {}): string => shownLine(action, args);

let cache: { path: string; mtime: number; entries: KeymapEntry[]; problem: string | null } | null = null;
let version = 0, checkedAt = 0;
/** Bumped by every change the door makes or reads: tables cached against it are worked out again. */
export const keymapVersion = () => (current(), version);

/** The file as read: its entries, and what's wrong with it (a key that isn't one, a line that isn't an act line), said once. */
function current(): { entries: KeymapEntry[]; problem: string | null } {
  const path = keymapPath();
  // Asked on every key and every hint drawn: the file is looked at again at most every half second (an edit by hand shows then).
  const now = Date.now();
  if (cache && cache.path === path && now - checkedAt < 500) return cache;
  checkedAt = now;
  let mtime = -1;
  try { mtime = statSync(path).mtimeMs; } catch { /* no file: nothing rebound */ }
  if (cache && cache.path === path && cache.mtime === mtime) return cache;
  const read = mtime < 0 ? { entries: [], problem: null } : parse(readText(path));
  cache = { path, mtime, ...read };
  version++;
  return cache;
}
const readText = (path: string) => { try { return readFileSync(path, "utf8"); } catch (e) { return e instanceof Error ? e : new Error(String(e)); } };

/** The file's text as entries: each act line checked, each key named once; a bad entry is left out and said. */
export function parse(text: string | Error): { entries: KeymapEntry[]; problem: string | null } {
  if (text instanceof Error) return { entries: [], problem: `${keymapPath()} couldn't be read: ${text.message}` };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { entries: [], problem: `${keymapPath()} isn't JSON (${(e as Error).message}); the built-in keys hold until it is` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { entries: [], problem: `${keymapPath()} is an object from an act line to its keys, like {"note.new": ["alt+n"]}` };
  const entries: KeymapEntry[] = [], problems: string[] = [];
  for (const [id, value] of Object.entries(raw)) {
    let req;
    try { req = actRequestOf(lineWords(id)); } catch (e) { problems.push(`"${id}": ${(e as Error).message}`); continue; }
    if (!Array.isArray(value) || value.some(v => typeof v !== "string")) { problems.push(`"${id}" takes a list of keys, like ["alt+n"]`); continue; }
    const keys: string[] = [];
    for (const v of value as string[]) {
      const k = chordName(v);
      if (!k) problems.push(`"${id}": ${JSON.stringify(v)} isn't a key or a ^W chord (alt+n, ctrl+w q)`);
      else if (!keys.includes(k)) keys.push(k);
    }
    entries.push({ id: bindingId(req.action, req.args ?? {}), action: req.action, args: req.args ?? {}, keys });
  }
  return { entries, problem: problems.length ? `${keymapPath()}: ${problems.join("; ")}` : null };
}

/** Read the file again now (a change made by hand, a test's): what `keymap.reload` runs. */
export function reloadKeymap(): { entries: number; problem: string | null } { cache = null; const c = current(); return { entries: c.entries.length, problem: c.problem }; }
/** Every entry of the file, in its order. */
export const keymapEntries = (): readonly KeymapEntry[] => current().entries;
/** What's wrong with the file, or null. */
export const keymapProblem = (): string | null => current().problem;
/** The keys the file gives the binding `id`, or undefined when it says nothing of it (the built-in keys hold). */
export const keysFor = (id: string): readonly string[] | undefined => current().entries.find(e => e.id === id)?.keys;
/** The entries for one action, whatever arguments they bind it with. */
export const entriesOf = (action: string): KeymapEntry[] => current().entries.filter(e => e.action === action);
/** The entry a key presses (one key or a ^W chord), or undefined. The last entry naming it wins, as a hand-edited file reads. */
export const entryOfKey = (key: string): KeymapEntry | undefined => current().entries.findLast(e => e.keys.includes(key));

/** Whether a run with `args` is the binding `e` names: every argument it binds is the same (an entry with none is every run). */
const runs = (e: KeymapEntry, args: Record<string, unknown>) => Object.entries(e.args).every(([k, v]) => String(args[k]) === String(v));

// ── changes, each undoable ──────────────────────────────────────────────────

const history: string[] = [];
/** The file's text now ("{}" when there is none). */
const textNow = () => { const t = readText(keymapPath()); return t instanceof Error ? "{}" : t; };
function write(entries: readonly KeymapEntry[]): void {
  const path = keymapPath();
  history.push(textNow());
  if (history.length > 50) history.shift();
  writeText(path, JSON.stringify(Object.fromEntries(entries.map(e => [e.id, e.keys])), null, 2) + "\n");
}
function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
  cache = null;
}

/**
 * Give binding `id` these keys (`[]` unbinds it), and take each of them from any other entry that had it, so a key
 * names one binding. Returns the entries that lost a key.
 */
export function setKeys(id: string, keys: readonly string[]): KeymapEntry[] {
  const req = actRequestOf(lineWords(id));
  const name = bindingId(req.action, req.args ?? {});
  const entries = current().entries.map(e => ({ ...e, keys: [...e.keys] }));
  const lost: KeymapEntry[] = [];
  for (const e of entries) if (e.id !== name && e.keys.some(k => keys.includes(k))) { e.keys = e.keys.filter(k => !keys.includes(k)); lost.push(e); }
  const at = entries.findIndex(e => e.id === name), entry = { id: name, action: req.action, args: req.args ?? {}, keys: [...keys] };
  if (at < 0) entries.push(entry); else entries[at] = entry;
  write(entries);
  return lost;
}
/** Take binding `id` out of the file: its built-in keys hold again. */
export function resetKeys(id: string): boolean {
  const entries = current().entries;
  if (!entries.some(e => e.id === id)) return false;
  write(entries.filter(e => e.id !== id));
  return true;
}
/** Put the file back as it was before the last change made here; false when there's none. */
export function undoKeymap(): boolean {
  const was = history.pop();
  if (was === undefined) return false;
  writeText(keymapPath(), was);
  return true;
}

// ── tables: what matches is what's said ─────────────────────────────────────

/** A row of a key table: a key and the action (with arguments) it runs. W_KEYS, ModeKey, HyperBinding and KeyBinding are. */
/**
 * A key table's row: its key, the action and arguments it runs, its `label` (the short word a hint row shows: `columns`,
 * `wider`) and `says`, the whole sentence the keys window lists for it where the label alone would read as a fragment
 * after the action's words (PIE-1425: "give your keys to the column on the left", not "…, columns").
 */
export interface TableRow { readonly key: string; readonly action: string; readonly args?: Record<string, unknown>; readonly label?: string; readonly says?: string }

/**
 * Whether a table's row can be rebound by its binding's name: its other rows with that name are the same binding (the
 * same words: esc q S all "close sources"), not several meanings under one name (h j k l, each `tile.focus` one way),
 * which the file can't tell apart.
 */
export function rebindable(rows: readonly TableRow[], row: TableRow): boolean {
  const id = bindingId(row.action, row.args ?? {});
  return rows.every(r => bindingId(r.action, r.args ?? {}) !== id || (r.label ?? "") === (row.label ?? "") || isMouse(r.key) || isMouse(row.key));
}
const isMouse = (key: string) => GESTURE_NAMES.has(key);

const tables = new WeakMap<readonly TableRow[], Map<string, { version: number; rows: readonly TableRow[] }>>();
/**
 * A key table with the keymap applied: the rows of a binding the file names take the file's keys instead of their own
 * (none, when it unbinds it; a mouse row stays); a key the file gives one of this table's bindings is that binding's here,
 * whatever else had it; and a file entry whose key belongs to this table (`prefix`: `ctrl+w ` for the ^W keys, `hyper+` for
 * the hyper layer, "" for one key) and that `extra` makes a row of, is one. The match, the hint and the panel all read
 * this, so they can't disagree. A binding `rebindable` says isn't one keeps its rows.
 */
export function effective<R extends TableRow>(rows: readonly R[], prefix = "", extra?: (e: KeymapEntry, key: string) => R | null): readonly R[] {
  const v = keymapVersion();
  let per = tables.get(rows);
  if (!per) tables.set(rows, per = new Map());
  const hit = per.get(prefix);
  if (hit && hit.version === v && !extra) return hit.rows as readonly R[];
  const entries = current().entries;
  if (!entries.length) return rows;
  // A key of the file as this table's (`ctrl+w space` is the ^W table's " "), and a row's key as the file names it.
  const of = (key: string) => (prefix ? (key.startsWith(prefix) ? (prefix === "ctrl+w " && key === "ctrl+w space" ? " " : key.slice(prefix.length)) : null) : key.includes(" ") ? null : key);
  const full = (key: string) => (prefix === "ctrl+w " && key === " " ? "ctrl+w space" : prefix + key);
  const entryOf = (r: R) => (rebindable(rows, r) ? entries.find(e => e.id === bindingId(r.action, r.args ?? {})) : undefined);
  // An entry lists every key its binding has now, wherever (the window writes them all: x on the board, ^W x on the desk).
  // A row of it keeps its key when the entry still has it; a key the binding never had anywhere (the new one) becomes a
  // row of this table when it's this table's kind of key (a ^W chord for the ^W keys).
  const made: R[] = [], done = new Set<string>();
  for (const r of rows) {
    const e = entryOf(r);
    if (!e || isMouse(r.key) || done.has(e.id)) continue;
    done.add(e.id);
    const had = builtInKeys(e.id);
    for (const k of e.keys) { const key = of(k); if (key !== null && !had.has(k)) made.push({ ...r, key }); }
  }
  const named = new Set(rows.map(r => bindingId(r.action, r.args ?? {})));
  if (extra) for (const e of entries) if (!named.has(e.id)) for (const k of e.keys) { const key = of(k); const row = key === null || builtInKeys(e.id).has(k) ? null : extra(e, key); if (row) made.push(row); }
  const taken = new Set(made.map(r => r.key));
  const kept = (r: R) => { const e = entryOf(r); return e ? e.keys.includes(full(r.key)) : !taken.has(r.key); };
  const out = [...rows.filter(r => isMouse(r.key) || kept(r)), ...made];
  if (!extra) per.set(prefix, { version: v, rows: out });
  return out;
}

/**
 * The key a part that names binding (`action`, `args`) and its built-in key `key` shows now (a hint row's part, a tile
 * menu row's keycap): `key` while the keymap keeps it, else the key that took its place (one the binding never had built
 * in), else the keymap's first; null when the keymap unbinds it. Without an entry, `key`.
 */
export function keyNow(action: string, args: Record<string, unknown>, key: string | undefined): string | null | undefined {
  const id = bindingId(action, args);
  const e = entriesOf(action).find(x => x.id === id) ?? entriesOf(action).find(x => !Object.keys(x.args).length);
  if (!e || (key !== undefined && e.keys.includes(key))) return key;
  const had = builtInKeys(e.id);
  return e.keys.find(k => !had.has(k)) ?? e.keys[0] ?? null;
}

/**
 * Every key binding `id` has built in, by its one name: its rows in every key table (with the table's prefix: `ctrl+w x`,
 * `hyper+n`) and, for an action's own name, the keys its def declares. What a rebind adds is any other key.
 */
const builtIn = new Map<string, Set<string>>();
let builtInFor = { version: -1, tables: -1 };
export function builtInKeys(id: string): Set<string> {
  // Asked for every row of every table drawn: kept until the tables or the file change.
  if (builtInFor.version !== version || builtInFor.tables !== TABLES.length) { builtIn.clear(); builtInFor = { version, tables: TABLES.length }; }
  const tables = keyTables();
  const hit = builtIn.get(id);
  if (hit) return hit;
  const out = new Set<string>();
  builtIn.set(id, out);
  for (const t of tables) for (const r of t.rows) if (bindingId(r.action, r.args ?? {}) === id) out.add(t.prefix === "ctrl+w " ? `ctrl+w ${r.key === " " ? "space" : r.key}` : t.prefix + r.key);
  const req = actRequestOf(lineWords(id));
  if (!Object.keys(req.args ?? {}).length) for (const k of declaredKeys(declaredOf(req.action))) out.add(k);
  return out;
}

/**
 * The keys an action's def declares with the keymap applied: an entry for the whole action (no arguments) lists every key
 * it has now, so each row keeps the keys still in it (a row losing all of them goes) and a key that's new is a row
 * "yours"; an entry with arguments adds its keys as rows saying them. Its clicks and other ways stay.
 */
export function keysNow(action: string, keys: Keys | undefined): Keys | undefined {
  const mine = entriesOf(action);
  if (!mine.length) return keys;
  const rows: KeyRow[] = typeof keys === "string" ? [{ keys, does: "" }] : [...(keys ?? [])];
  const whole = mine.find(e => !Object.keys(e.args).length);
  const declared = declaredKeys(keys);
  const kept: KeyRow[] = !whole ? rows : rows.flatMap((r): KeyRow[] => {
    if (!("keys" in r)) return [r];
    const ks = [...declaredKeys(r.keys)].filter(k => !GESTURE_NAMES.has(k));
    if (ks.every(k => whole.keys.includes(k))) return [r];
    const left = ks.filter(k => whole.keys.includes(k));
    return left.length ? [{ keys: left.map(keyCaption).join(" "), does: r.does }] : [];
  });
  const yours: KeyRow[] = mine.flatMap(e => e.keys.filter(k => e !== whole || !declared.has(k)).map(k => ({ keys: keyCaption(k), does: Object.keys(e.args).length ? `yours: ${shownLine("", e.args).trim()}` : "yours (keybindings.json)" })));
  const out = [...yours, ...kept];
  return out.length ? out : undefined;
}
const GESTURE_NAMES = new Set(["click", "drag", "wheel", "hover", "sideways"]);

// ── a key matched in code ───────────────────────────────────────────────────

/** The key the person typed, while the door handles it (App.pressKey): `moved` asks it of the first action it runs. */
const typing = new AsyncLocalStorage<{ key: string; asked: boolean }>();
/** Handle `f` as the person's typed key `key` (its one name), so the first action it runs can be checked against the keymap. */
export const asTyped = <T>(key: string | null, f: () => T): T => (key ? typing.run({ key, asked: false }, f) : f());

/**
 * Why the person's typed key no longer runs `action` (with `args`): the file gave that binding other keys and this one
 * isn't among them. Asked once per key, of the first action it runs that the file names (one it runs in turn is its own
 * business; one the file says nothing of, run on the way, is passed over); null when
 * the key still runs it, the file says nothing of it, or no typed key is being handled (an agent's act, a click).
 */
export function moved(action: string, args: Record<string, unknown>, declared: Keys | undefined): string | null {
  const t = typing.getStore();
  if (!t || t.asked) return null;
  // An action the file says nothing of is passed over (a tile's arrival mark cleared on j, on the key's way to scrolling).
  const e = entriesOf(action).find(x => runs(x, args));
  if (!e) return null;
  t.asked = true;
  if (!declaredKeys(declared).has(t.key)) return null;
  // The second key of a ^W chord the file gives it (^W q: the desk's table ran it, at q).
  if (e.keys.includes(t.key) || e.keys.includes(`ctrl+w ${t.key}`)) return null;
  const to = e.keys.filter(k => !builtInKeys(e.id).has(k));
  return `${keyCaption(t.key)} no longer runs ${e.id}: your keymap ${to.length ? `gives it ${to.map(keyCaption).join(", ")}` : "takes it away"} (? shows the keys; ctrl+z in it undoes)`;
}

// ── the tables, by where they bind ──────────────────────────────────────────

/** A key table as the keys window lists it: where its keys work (`scope`), what reads them, and the keymap prefix its keys take. */
export interface KeyTable { readonly scope: string; readonly about: string; readonly rows: readonly TableRow[]; readonly prefix: string; /** The action set whose place this table's keys are part of (the river column's, `river`): `in:<it>` in the keys window lists them too. */ readonly within?: string; /** A screen's own key map (its spec's): the screen layer. */ readonly screen?: true }
const TABLES: KeyTable[] = [];
/**
 * Say a key table (a mode's, the ^W keys, the hyper layer) where it's made, so the keys window lists it under its scope
 * and the App's keymap layer leaves its keys to it (the table reads the file itself, through `effective`). Returns the rows.
 */
export function keyTable<R extends TableRow>(scope: string, about: string, rows: readonly R[], prefix = "", within?: string): readonly R[] {
  TABLES.push({ scope, about, rows, prefix, ...(within ? { within } : {}) });
  return rows;
}
/** Every key table said so far. */
export const keyTables = (): readonly KeyTable[] => [...TABLES, ...screenTables()];
/**
 * The screens' own key maps (a spec's `keys`: the board's t S c B), as tables under each screen's name: the screen-spec
 * registry says them (`useScreenTables`), so the window lists them and a rebind keeps them.
 */
let screenTables: () => readonly KeyTable[] = () => [];
export function useScreenTables(f: () => readonly KeyTable[]): void { screenTables = f; }

/**
 * The binding a typed key presses through the App's keymap layer: an entry giving the key to an action no one-key table
 * runs (a key matched in code: the reader's `z`, the shell's alt+v). A table's own actions get theirs from the table.
 */
export function layerEntry(key: string): KeymapEntry | undefined {
  if (key.includes(" ")) return undefined;
  const e = entryOfKey(key);
  if (!e || keyTables().some(t => !t.prefix && t.rows.some(r => r.action === e.action))) return undefined;
  // A key the action already declares stays where the code that matches it is: it knows what it means there (a `-` that folds).
  return Object.keys(e.args).length || !declaredKeys(declaredOf(e.action)).has(key) ? e : undefined;
}
/** An action's own keys, as its def declares them (the first set that has it). */
export const declaredOf = (action: string): Keys | undefined => allActionSets().find(s => s.has(action))?.def(action)?.keys;

/**
 * Why a table's key runs nothing now: its built-in row's binding was moved by the keymap (`^W x` after tile.close went to
 * `^W q`), said with where it went; null when the key was never the table's, or is still.
 */
export function movedInTable(rows: readonly TableRow[], prefix: string, key: string): string | null {
  const r = rows.find(x => x.key === key), full = prefix === "ctrl+w " && key === " " ? "ctrl+w space" : prefix + key;
  if (!r || effective(rows, prefix).some(x => x.key === key)) return null;
  const e = entriesOf(r.action).find(x => x.id === bindingId(r.action, r.args ?? {}));
  if (!e) return null;
  const to = e.keys.filter(k => !builtInKeys(e.id).has(k));
  return `${keyCaption(full)} no longer runs ${e.id}: your keymap ${to.length ? `gives it ${to.map(keyCaption).join(", ")}` : "unbinds it"} (? shows the keys)`;
}
