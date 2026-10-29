// The desk's ^W keys (PIE-704), one table. Every key that follows ^W is a row here: the desk's chord handler reads its
// binding from it (Desk.command), the panel ^W opens (PIE-1304) and the hint row are generated from it, and the ^W popup (`^W ?`: the
// power bar's `>actions` scope on the `^W` prefix) lists it. A key's label and summary are the action's own, joined
// from its ActionSet (the tile menu's row for the same `ctrl+w <key>`, else the summary's first clause), so the tile
// menu, the power bar and the hint can't name different things. A key bound anywhere else in the desk is a bug the
// tests find (test/wkeys.test.ts): add it here, with the action it runs.
import type { ActionDef } from "../surface/actions";
import { keyCaption } from "../surface/actions";
import { effective, keyTable } from "../surface/keymap";
import type { PanelGroup } from "./key-panel";

/** The groups the panel and the popup show them under, in order. */
export const W_GROUPS = ["focus & move", "size & shape", "tabs", "open", "mounts & groups", "drawer", "layouts & more"] as const;
export type WGroup = (typeof W_GROUPS)[number];

/** A key that waits for one more: o O open a kind, m t move beside or into tabs. */
export type WPrefix = "add" | "addtab" | "move" | "tab";

/**
 * What a key does: `run` an action (its args, and its tile: `n` the focused tile's number, `-` none, else the focused
 * one by name); `focus` the tile that way (h j k l); `edge` take the tile to that outer edge (H J K L); `prefix` wait
 * for another key; `special` something the desk does itself (a panel, a swap, the shell, the popup), whose handler
 * the desk must have (its type is checked).
 */
export type WHow =
  | { k: "run"; action: string; args?: Record<string, unknown>; tile?: "n" | "-" }
  | { k: "focus" } | { k: "edge" }
  | { k: "prefix"; mode: WPrefix }
  | { k: "special" };

export interface WKey {
  /** The key typed after ^W (the space bar is " "). */
  key: string;
  group: WGroup;
  /** The action it stands for: the label, the summary and the menu's row come from it. */
  action: string;
  how: WHow;
  /** A label where the action alone says too little (several keys run `tile.resize`). */
  label?: string;
  /** Stays in resize mode after it (the desk's sticky mode): the next resize keys need no ^W. */
  sticky?: true;
}

const run = (action: string, args?: Record<string, unknown>, tile?: "n" | "-"): WHow => ({ k: "run", action, ...(args ? { args } : {}), ...(tile ? { tile } : {}) });

/** Every key after ^W, in the order the popup lists them under each group. */
const W_TABLE = [
  { key: "h", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile to the left" },
  { key: "j", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile below" },
  { key: "k", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile above" },
  { key: "l", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile to the right" },
  { key: "m", group: "focus & move", action: "layout.move", how: { k: "prefix", mode: "move" }, label: "move beside a tile (then h j k l)" },
  { key: "t", group: "focus & move", action: "layout.move", how: { k: "prefix", mode: "tab" }, label: "move into a tile's tabs (then h j k l)" },
  { key: "T", group: "focus & move", action: "layout.move", how: { k: "special" }, label: "take this tab out of its tab set" },
  { key: "H", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the left edge" },
  { key: "J", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the bottom edge" },
  { key: "K", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the top edge" },
  { key: "L", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the right edge" },
  { key: "s", group: "focus & move", action: "layout.swap", how: { k: "special" }, label: "swap with the next tile" },

  { key: "<", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: -1, axis: "row" }, "n"), label: "narrower", sticky: true },
  { key: ">", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: 1, axis: "row" }, "n"), label: "wider", sticky: true },
  { key: "-", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: -1, axis: "col" }, "n"), label: "shorter", sticky: true },
  { key: "+", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: 1, axis: "col" }, "n"), label: "taller", sticky: true },
  { key: "=", group: "size & shape", action: "layout.even", how: run("layout.even", {}, "-"), label: "even out every split", sticky: true },
  { key: "{", group: "size & shape", action: "layout.gather", how: run("layout.gather", { side: "right" }) },
  { key: "}", group: "size & shape", action: "layout.gather", how: run("layout.gather", { side: "left" }) },
  { key: "|", group: "size & shape", action: "layout.gather", how: run("layout.gather", { side: "centre" }) },
  { key: "z", group: "size & shape", action: "tile.zoom", how: run("tile.zoom", {}, "n") },
  { key: "Z", group: "size & shape", action: "tile.zoom", how: run("tile.zoom", { reach: "column" }, "n"), label: "lift or drop this column" },
  { key: "F", group: "size & shape", action: "tile.zoom", how: run("tile.zoom", { reach: "full" }, "n"), label: "lift or drop across the terminal" },
  { key: "c", group: "size & shape", action: "tile.collapse", how: run("tile.collapse") },
  { key: "W", group: "size & shape", action: "tile.widen", how: run("tile.widen") },
  { key: "f", group: "size & shape", action: "tile.float", how: run("tile.float") },
  { key: "p", group: "size & shape", action: "tile.dock", how: run("tile.dock"), label: "dock to an edge, or undock" },
  { key: "d", group: "size & shape", action: "tile.slide", how: { k: "special" }, label: "slide the dock open or shut" },

  { key: "[", group: "tabs", action: "tab.select", how: run("tab.select", { by: -1 }), label: "previous tab" },
  { key: "]", group: "tabs", action: "tab.select", how: run("tab.select", { by: 1 }), label: "next tab" },

  { key: "o", group: "open", action: "tile.open", how: { k: "prefix", mode: "add" }, label: "open a tile beside (then its kind's key)" },
  { key: "O", group: "open", action: "tile.open", how: { k: "prefix", mode: "addtab" }, label: "open a tile as a tab (then its kind's key)" },
  { key: "v", group: "open", action: "tile.preview", how: run("tile.preview", { where: "right" }), label: "preview beside" },
  { key: "V", group: "open", action: "tile.preview", how: run("tile.preview", { where: "down" }), label: "preview below" },
  { key: "x", group: "open", action: "tile.close", how: run("tile.close") },
  { key: "n", group: "open", action: "tile.title", how: run("tile.title") },
  { key: "N", group: "open", action: "tile.title.mode", how: run("tile.title.mode") },
  { key: ".", group: "open", action: "tile.menu", how: run("tile.menu"), label: "this tile's menu" },
  { key: ",", group: "open", action: "tile.info", how: run("tile.info", { card: true }), label: "about this tile: its id, kind, wires" },
  { key: "y", group: "open", action: "note.copy-ref", how: run("note.copy-ref", { kind: "ref" }), label: "copy a reference to its note" },

  { key: " ", group: "mounts & groups", action: "tile.select", how: run("tile.select"), label: "pick this tile to gather, or let it go" },
  { key: "G", group: "mounts & groups", action: "tile.group", how: run("tile.group", { ask: true }), label: "gather the picked tiles into a group, or spill one" },
  { key: "i", group: "mounts & groups", action: "tile.into", how: run("tile.into"), label: "move this tile into a group, or out of the one it's in" },
  { key: "e", group: "mounts & groups", action: "mount.enter", how: run("mount.enter"), label: "go into a mount: every key is its own" },
  { key: "u", group: "mounts & groups", action: "mount.out", how: run("mount.out"), label: "pop a mount out to its full screen" },
  { key: "M", group: "mounts & groups", action: "screen.mount", how: run("screen.mount", {}, "-"), label: "put this screen on the desk" },
  { key: "I", group: "mounts & groups", action: "screen.part", how: run("screen.part"), label: "put the part around this tile on the desk" },

  { key: "a", group: "drawer", action: "tile.drawer", how: run("tile.drawer"), label: "put in your drawer, or take out" },
  { key: "A", group: "drawer", action: "tile.drawer", how: run("tile.drawer", { on: false }), label: "bring the drawer's tab here" },

  { key: "g", group: "layouts & more", action: "tile.agent", how: run("tile.agent"), label: "what agents may do here (free, edit, off)" },
  { key: "P", group: "layouts & more", action: "layout.policy", how: { k: "special" }, label: "the policy panel" },
  { key: "r", group: "layouts & more", action: "layout.load", how: run("layout.load"), label: "lay the screen out from a saved one" },
  { key: "w", group: "layouts & more", action: "screen.save", how: run("screen.save"), label: "save this screen" },
  { key: "!", group: "layouts & more", action: "screen.shell", how: { k: "special" }, label: "drop to your shell" },
  { key: "?", group: "layouts & more", action: "bar.open", how: { k: "special" }, label: "all the ^W keys: a list you can filter" },
] as const satisfies readonly WKey[];
export const W_KEYS = keyTable("^W", "the desk's window keys, after ^W", W_TABLE, "ctrl+w ") as typeof W_TABLE;

type Entry = (typeof W_TABLE)[number];
/** The keys the desk handles itself: it must have a handler for each (Desk's `WSPECIAL`, typed by this). */
export type WSpecialKey = Extract<Entry, { how: { k: "special" } }>["key"];

/** The entry for the key typed after ^W, or undefined: the one place a ^W binding is read. */
export const wKey = (key: string): WKey | undefined => wNow().find(e => e.key === key);
/**
 * The ^W keys with the person's keymap applied (src/surface/keymap.ts): a key the file moves is found at its new key, and
 * a `ctrl+w <key>` the file gives any action is a row that runs it, in "yours".
 */
export const wNow = (): readonly WKey[] => effective(W_KEYS as readonly WKey[], "ctrl+w ", (e, key) => W_KEYS.some(w => w.action === e.action && w.how.k !== "run") ? null : { key, group: "layouts & more", action: e.action, how: run(e.action, e.args), label: undefined } as WKey);

/** A key as it is shown after ^W. */
export const wCaption = (key: string): string => `^W ${key === " " ? "space" : key}`;

/** A summary's first clause: what the popup says under a label. */
export const clause = (summary: string): string => summary.split(/[.:;(]/)[0]!.trim();

/** One key as the popup and the panel list it: the entry with the words joined from its action. */
export interface WRow {
  key: string;
  group: WGroup;
  action: string;
  label: string;
  /** The action's summary (its first clause), or "" when the table words the key itself or no set has the action. */
  summary: string;
  /** The same key as the tile menu names it (`ctrl+w z`). */
  chord: string;
  how: WHow["k"];
  args: Record<string, unknown>;
}

/**
 * Every ^W key with its label and summary, joined to its action's def: `defOf` finds an action's def by name (the
 * screen's dispatcher). The label is the table's where it has one, else the tile menu's row for `ctrl+w <key>`, else
 * the summary's first clause; the same def the menu and `actions` read.
 */
export function wRows(defOf: (action: string) => ActionDef<any, any> | undefined): WRow[] {
  return wNow().map(e => {
    const def = defOf(e.action), chord = `ctrl+w ${e.key === " " ? "space" : e.key}`;
    const entries = def?.menu === undefined ? [] : Array.isArray(def.menu) ? def.menu : [def.menu];
    const menu = entries.find(m => m.key === chord);
    const args = e.how.k === "run" ? e.how.args ?? {} : {};
    return {
      key: e.key, group: e.group, action: e.action, chord, how: e.how.k, args,
      label: e.label ?? menu?.label ?? (def ? clause(def.summary) : e.action),
      // Where the table words the key itself, the action's summary is about the action, not this key: left out.
      summary: def && !e.label ? clause(def.summary) : "",
    };
  });
}

/** What the tile menu and the popup show as the keycap of a row. */
export const wKeycap = (chord: string): string => keyCaption(chord);

/** The ^W panel's groups (PIE-1304): every key, under its group, as the table orders them, with the words joined from its action. */
export function wPanel(rows: readonly WRow[]): PanelGroup[] {
  return W_GROUPS.map(g => ({ title: g, keys: rows.filter(r => r.group === g).map(r => ({ key: r.key, cap: r.key === " " ? "space" : r.key, label: r.label })) }));
}

export const ZOOM_WHEEL = { mods: 16, key: "ctrl+wheel on the frame", action: "tile.zoom" } as const;
