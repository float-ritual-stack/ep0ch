// The desk's ^W keys (PIE-704), one table. Every key that follows ^W is a row here: the desk's chord handler reads its
// binding from it (Desk.command), the keys box and the hint row are generated from it, and the ^W popup (`^W ?`: the
// power bar's `>actions` scope on the `^W` prefix) lists it. A key's label and summary are the action's own, joined
// from its ActionSet (the tile menu's row for the same `ctrl+w <key>`, else the summary's first clause), so the tile
// menu, the power bar and the hint can't name different things. A key bound anywhere else in the desk is a bug the
// tests find (test/wkeys.test.ts): add it here, with the action it runs.
import type { ActionDef } from "../surface/actions";
import { keyCaption } from "../surface/actions";

/** The groups the keys box and the popup show them under, in order. */
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
  /** In the short keys box, under this word (keys with the same word share one entry). Absent: only in the popup. */
  short?: string;
}

const run = (action: string, args?: Record<string, unknown>, tile?: "n" | "-"): WHow => ({ k: "run", action, ...(args ? { args } : {}), ...(tile ? { tile } : {}) });

/** Every key after ^W, in the order the popup lists them under each group. */
export const W_KEYS = [
  { key: "h", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile to the left", short: "focus" },
  { key: "j", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile below", short: "focus" },
  { key: "k", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile above", short: "focus" },
  { key: "l", group: "focus & move", action: "tile.focus", how: { k: "focus" }, label: "focus the tile to the right", short: "focus" },
  { key: "m", group: "focus & move", action: "layout.move", how: { k: "prefix", mode: "move" }, label: "move beside a tile (then h j k l)", short: "move" },
  { key: "t", group: "focus & move", action: "layout.move", how: { k: "prefix", mode: "tab" }, label: "move into a tile's tabs (then h j k l)", short: "into tabs" },
  { key: "T", group: "focus & move", action: "layout.move", how: { k: "special" }, label: "take this tab out of its tab set" },
  { key: "H", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the left edge" },
  { key: "J", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the bottom edge" },
  { key: "K", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the top edge" },
  { key: "L", group: "focus & move", action: "layout.move", how: { k: "edge" }, label: "to the right edge" },
  { key: "s", group: "focus & move", action: "layout.swap", how: { k: "special" }, label: "swap with the next tile" },

  { key: "<", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: -1, axis: "row" }, "n"), label: "narrower", short: "size" },
  { key: ">", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: 1, axis: "row" }, "n"), label: "wider", short: "size" },
  { key: "-", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: -1, axis: "col" }, "n"), label: "shorter", short: "size" },
  { key: "+", group: "size & shape", action: "tile.resize", how: run("tile.resize", { by: 1, axis: "col" }, "n"), label: "taller", short: "size" },
  { key: "=", group: "size & shape", action: "layout.even", how: run("layout.even", {}, "-"), label: "even out every split" },
  { key: "z", group: "size & shape", action: "tile.zoom", how: run("tile.zoom", {}, "n"), short: "zoom" },
  { key: "c", group: "size & shape", action: "tile.collapse", how: run("tile.collapse"), short: "spine" },
  { key: "W", group: "size & shape", action: "tile.widen", how: run("tile.widen") },
  { key: "f", group: "size & shape", action: "tile.float", how: run("tile.float"), short: "float" },
  { key: "p", group: "size & shape", action: "tile.dock", how: run("tile.dock"), label: "dock to an edge, or undock" },
  { key: "d", group: "size & shape", action: "tile.slide", how: { k: "special" }, label: "slide the dock open or shut" },

  { key: "[", group: "tabs", action: "tab.select", how: run("tab.select", { by: -1 }), label: "previous tab", short: "tabs" },
  { key: "]", group: "tabs", action: "tab.select", how: run("tab.select", { by: 1 }), label: "next tab", short: "tabs" },

  { key: "o", group: "open", action: "tile.open", how: { k: "prefix", mode: "add" }, label: "open a tile beside (then its kind's key)", short: "open" },
  { key: "O", group: "open", action: "tile.open", how: { k: "prefix", mode: "addtab" }, label: "open a tile as a tab (then its kind's key)", short: "open" },
  { key: "v", group: "open", action: "tile.preview", how: run("tile.preview", { where: "right" }), label: "preview beside", short: "preview" },
  { key: "V", group: "open", action: "tile.preview", how: run("tile.preview", { where: "down" }), label: "preview below" },
  { key: "x", group: "open", action: "tile.close", how: run("tile.close"), short: "close" },
  { key: ".", group: "open", action: "tile.menu", how: run("tile.menu"), label: "this tile's menu", short: "menu" },

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
  { key: "?", group: "layouts & more", action: "bar.open", how: { k: "special" }, label: "all the ^W keys: a list you can filter", short: "all keys" },
] as const satisfies readonly WKey[];

type Entry = (typeof W_KEYS)[number];
/** The keys the desk handles itself: it must have a handler for each (Desk's `WSPECIAL`, typed by this). */
export type WSpecialKey = Extract<Entry, { how: { k: "special" } }>["key"];

/** The entry for the key typed after ^W, or undefined: the one place a ^W binding is read. */
export const wKey = (key: string): WKey | undefined => (W_KEYS as readonly WKey[]).find(e => e.key === key);

/** A key as it is shown after ^W. */
export const wCaption = (key: string): string => `^W ${key === " " ? "space" : key}`;

/** A summary's first clause: what the popup says under a label. */
export const clause = (summary: string): string => summary.split(/[.:;(]/)[0]!.trim().slice(0, 90);

/** One key as the popup and the keys box list it: the entry with the words joined from its action. */
export interface WRow {
  key: string;
  group: WGroup;
  action: string;
  label: string;
  /** The action's summary (its first clause), or "" when the table words the key itself or no set has the action. */
  summary: string;
  /** The same key as the tile menu names it (`ctrl+w z`). */
  chord: string;
  short?: string;
  how: WHow["k"];
  args: Record<string, unknown>;
}

/**
 * Every ^W key with its label and summary, joined to its action's def: `defOf` finds an action's def by name (the
 * screen's dispatcher). The label is the table's where it has one, else the tile menu's row for `ctrl+w <key>`, else
 * the summary's first clause; the same def the menu and `actions` read.
 */
export function wRows(defOf: (action: string) => ActionDef<any, any> | undefined): WRow[] {
  return (W_KEYS as readonly WKey[]).map(e => {
    const def = defOf(e.action), chord = `ctrl+w ${e.key === " " ? "space" : e.key}`;
    const entries = def?.menu === undefined ? [] : Array.isArray(def.menu) ? def.menu : [def.menu];
    const menu = entries.find(m => m.key === chord);
    const args = e.how.k === "run" ? e.how.args ?? {} : {};
    return {
      key: e.key, group: e.group, action: e.action, chord, how: e.how.k, args,
      label: e.label ?? menu?.label ?? (def ? clause(def.summary) : e.action),
      // Where the table words the key itself, the action's summary is about the action, not this key: left out.
      summary: def && !e.label ? clause(def.summary) : "",
      ...(e.short ? { short: e.short } : {}),
    };
  });
}

/** What the tile menu and the popup show as the keycap of a row. */
export const wKeycap = (chord: string): string => keyCaption(chord);

/**
 * The keys box: the most-used keys, one line per group (`focus & move · hjkl focus · m move`), in the hint row's own
 * markup (|07 a key, |08 its word), keys with the same word sharing one entry. A group with none of its own is left out.
 */
export function wBoxLines(rows: readonly WRow[]): string[] {
  const lines: string[] = [];
  for (const g of W_GROUPS) {
    const words: { word: string; keys: string[] }[] = [];
    for (const r of rows) if (r.group === g && r.short) {
      const w = words.find(x => x.word === r.short);
      if (w) w.keys.push(r.key); else words.push({ word: r.short, keys: [r.key] });
    }
    if (!words.length) continue;
    lines.push(`|14${g} |08· ` + words.map(w => `|07${w.keys.join(w.keys.every(k => "hjkl".includes(k)) ? "" : " ")} |08${w.word}`).join(" · "));
  }
  return lines;
}
