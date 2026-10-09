// The hyper layer (PIE-699): ⌃⌥⇧⌘ held together (Kitty keyboard protocol modifiers 15; Raycast and Karabiner map Caps
// Lock to it), a namespace no program and no terminal claims. The door reads it before the focused tile's own keys, so
// a hyper chord works while typing in a draft or a terminal tile, where a bare key can't. It is OPTIONAL and OFF by
// default, and every binding here is a duplicate of an action that has other keys and a click: nothing is reachable
// only by hyper. This file is the whole keymap; change a row and the hints, the power bar, `keys.probe` and the docs'
// table (checked by test/hyper.test.ts) follow.
//
// On: `EP0CH_HYPER=1` (the environment wins either way: `0` is off), else the setting `hyper.set on=true` keeps in
// the state dir (`hyper.json`). Without the Kitty keyboard protocol nothing arrives as hyper at all (src/kbd.ts):
// `keys.probe` shows what a chord does arrive as.

/** One hyper chord: the base key (the key without shift: `=`, not `+`), the action it presses, and what it's called. */
export interface HyperBinding {
  key: string;
  action: string;
  args?: Record<string, unknown>;
  /** The tile the action is for (`#3`: the third); none: the focused one. */
  tile?: string;
  label: string;
  /** Moves the keys to another tile: an edit the person is in is left first, as a click elsewhere leaves it. */
  leaves?: true;
}

export const HYPER_KEYS: readonly HyperBinding[] = [
  { key: "p", action: "bar.open", label: "the power bar" },
  { key: "g", action: "bar.open", args: { scope: "screens" }, label: "go to a screen" },
  { key: "h", action: "tile.focus", args: { dir: "left" }, label: "focus the tile to the left", leaves: true },
  { key: "j", action: "tile.focus", args: { dir: "down" }, label: "focus the tile below", leaves: true },
  { key: "k", action: "tile.focus", args: { dir: "up" }, label: "focus the tile above", leaves: true },
  { key: "l", action: "tile.focus", args: { dir: "right" }, label: "focus the tile to the right", leaves: true },
  { key: "-", action: "tile.collapse", args: { on: true }, label: "fold the tile to a spine" },
  { key: "=", action: "tile.collapse", args: { on: false }, label: "open the tile from its spine" },
  { key: "z", action: "tile.zoom", label: "zoom the tile" },
  { key: "n", action: "note.new", label: "a new note" },
  ...Array.from({ length: 9 }, (_, i): HyperBinding => ({ key: String(i + 1), action: "tile.focus", tile: `#${i + 1}`, label: `focus tile ${i + 1}`, leaves: true })),
];

/** The chord a base key names: `+` is `=` with shift, which hyper always holds. */
const BASE: Record<string, string> = { "+": "=", _: "-" };
export const hyperBinding = (key: string): HyperBinding | undefined => { const k = BASE[key] ?? key; return HYPER_KEYS.find(b => b.key === k); };

/** `✦k`: how a chord is written in a hint, the power bar and the docs. */
export const hyperLabel = (key: string) => `✦${key}`;
/** The hyper chords an action is also reached by, as `✦-` (the hints and the power bar show them only while the layer is on). */
export function hyperKeysOf(action: string): string[] {
  return HYPER_KEYS.filter(b => b.action === action && b.tile === undefined && !(b.args?.scope)).map(b => hyperLabel(b.key));
}

let saved: boolean | null = null;
/** Use the setting kept from last time (the door's start) or just chosen (`hyper.set`). */
export function useHyper(v: unknown) { saved = typeof v === "boolean" ? v : null; }
/** Whether the layer is on: EP0CH_HYPER (1, on, yes, true; 0, off, no, false), else the person's setting, else off. */
export function hyperOn(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.EP0CH_HYPER?.trim().toLowerCase();
  if (v === "1" || v === "on" || v === "yes" || v === "true") return true;
  if (v === "0" || v === "off" || v === "no" || v === "false") return false;
  return saved ?? false;
}
