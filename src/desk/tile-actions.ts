// Tiles and layouts as actions (PIE-413, PIE-473, PIE-474): every change to the layout is one of these
// commands. The desk's keys, its mouse drags and clicks, and the control socket (`ep0ch act`) are only
// callers: a header dropped on a tile's centre runs `layout.move where=tabs`, `^W m l` runs
// `layout.move where=right`, alt+l then a click runs `tile.link`. An agent's is said on screen, and never
// takes the person's focus or keys: a tile it opens or moves leaves their focus where it is, and what the
// person is typing in (an edit, a terminal) is never closed, moved into, or typed into by an agent.
import type { Actor } from "../socket";
import { ActionRefused, ActionSet, agentLabel } from "../surface/actions";
import { isDir, type Dir, type Policy } from "./layout";
import type { PaneKind } from "./panes";

export type Where = Dir | "tabs" | "edge-left" | "edge-right" | "edge-up" | "edge-down";
const WHERE = ["left", "right", "up", "down", "tabs", "edge-left", "edge-right", "edge-up", "edge-down"];
export const whereOf = (s: string | undefined, action: string, dflt: Where): Where => {
  if (s === undefined) return dflt;
  if (WHERE.includes(s)) return s as Where;
  throw new ActionRefused(`${action}: where is ${WHERE.join(", ")}, not ${s}`);
};

const PLACE: Record<string, string> = { left: "left of", right: "right of", up: "above", down: "below", tabs: "into the tabs of" };

/** What a tile operation did, as the socket answers it. */
export interface TileDone { tile: string; [k: string]: unknown }

/** A new tile: its kind and what it needs (the fields of a saved tile). */
export interface NewTile { kind: PaneKind; name?: string; cmd?: string; file?: string; source?: string; note?: string; page?: string; cwd?: string; view?: string }

/**
 * The view that holds the tiles (the desk). `sel` names a tile by name, by id (`t4`), by its number on screen
 * (`#3`) or `focused` (PIE-491). Any of its actions takes `expected=<rev>`, checked before it runs.
 */
export interface TileHost {
  ctx: { flash(msg: string): void };
  moveTile(sel: string | undefined, to: string | undefined, where: Where, index: number | undefined, actor: Actor): TileDone;
  openTile(t: NewTile, at: string | undefined, where: Where, actor: Actor): TileDone | Promise<TileDone>;
  closeTile(sel: string | undefined, actor: Actor): TileDone;
  linkTile(sel: string | undefined, to: string | undefined, actor: Actor): TileDone;
  selectTab(sel: string | undefined, by: number | undefined, actor: Actor): TileDone;
  focusTile(sel: string | undefined, actor: Actor): TileDone;
  pinTile(sel: string | undefined, on: boolean | undefined, edge: Dir | undefined, actor: Actor, container?: string): TileDone;
  collapseTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone;
  placeFloat(sel: string | undefined, a: { dx?: number; dy?: number; col?: number; row?: number; cols?: number; rows?: number }, actor: Actor): TileDone;
  lockScreen(on: boolean | undefined, actor: Actor): { locked: boolean; changed: boolean };
  setPolicy(sel: string | undefined, node: string | undefined, set: Policy, clear: string[], actor: Actor): { node: string; policy: Policy };
  policyGet(sel: string | undefined): unknown;
  drawerTile(sel: string | undefined, open: boolean | undefined, actor: Actor, container?: string): TileDone;
  previewTile(sel: string | undefined, where: Where, actor: Actor): TileDone | Promise<TileDone>;
  typeTile(sel: string | undefined, text: string, actor: Actor): TileDone;
  restartTile(sel: string | undefined, actor: Actor): TileDone;
  enterTile(sel: string | undefined, send: string | undefined, actor: Actor): TileDone;
  leaveTile(actor: Actor): TileDone;
  tileInfo(sel: string | undefined): unknown;
  saveLayout(name: string, actor: Actor): TileDone | { layout: string; [k: string]: unknown };
  loadLayout(name: string, actor: Actor): { layout: string; [k: string]: unknown } | Promise<{ layout: string; [k: string]: unknown }>;
  layouts(): unknown;
  layoutGet(): unknown;
  resizeBorder(at: { path?: string; split?: string }, border: number, share: number, actor: Actor): TileDone | { split: string | undefined; [k: string]: unknown };
  herdrTile(sel: string | undefined, pane: string | undefined, on: boolean | undefined, actor: Actor): TileDone;
  evenOut(actor: Actor): { even: true };
  swapTile(sel: string | undefined, to: string, actor: Actor): TileDone;
  viewGet(sel: string | undefined): unknown;
  scrollTo(sel: string | undefined, at: { line?: number; text?: string; block?: string }, actor: Actor): TileDone;
  markBlock(sel: string | undefined, m: { id?: string; line?: number; reason: string }, actor: Actor): Promise<unknown>;
  unmark(n: number | undefined, id: string | undefined, actor: Actor): Promise<unknown>;
  marks(): unknown;
  nextMark(actor: Actor): TileDone | { mark: null };
}

interface On { d: TileHost; reader?: string }
const say = (d: TileHost, actor: Actor, what: string) => d.ctx.flash(`${agentLabel(actor)} ${what}`);

const loadLayout = {
  summary: "replace the layout with the one saved by name (or the built-in daily, river, board or desk). Tiles with the same name and kind are kept as they are (a running program, a reader's note); a running program or an unsaved edit the new layout has no place for is kept as a shut drawer, never ended. Refused to an agent while the person is typing",
  keys: "alt+d (daily); ^W r picks one",
  args: { name: { type: "string", about: "the layout's name" } },
  async run({ name }: { name: string }, { d }: On, actor: Actor) {
    const r = await d.loadLayout(name, actor);
    say(d, actor, `laid out ${name}`);
    return r;
  },
} as const;

export const TILE_ACTIONS = new ActionSet<{
  "layout.get": Record<string, never>;
  "layout.list": Record<string, never>;
  "layout.save": { name: string };
  "layout.load": { name: string };
  "layout.restore": { name: string };
  "layout.move": { to?: string; where?: string; index?: number };
  "tile.open": { kind: string; name?: string; cmd?: string; file?: string; source?: string; note?: string; page?: string; cwd?: string; view?: string; to?: string; where?: string };
  "tile.close": Record<string, never>;
  "tile.link": { to?: string };
  "tile.focus": Record<string, never>;
  "tile.pin": { on?: boolean; edge?: string; container?: string };
  "tile.collapse": { on?: boolean };
  "float.place": { dx?: number; dy?: number; col?: number; row?: number; cols?: number; rows?: number };
  "layout.lock": { on?: boolean };
  "layout.policy": { node?: string; draggable?: boolean; droppable?: boolean; accepts?: string; resizable?: boolean; min?: number; max?: number; fixed?: number; collapsible?: boolean; overlay?: boolean; stays?: boolean; locked?: boolean; opensInto?: string; clear?: string };
  "tile.drawer": { open?: boolean; container?: string };
  "tile.preview": { where?: string };
  "tile.info": Record<string, never>;
  "tile.type": { text: string };
  "tile.restart": Record<string, never>;
  "tile.enter": { send?: string };
  "tile.leave": Record<string, never>;
  "tab.select": { by?: number };
  "tile.herdr": { pane?: string; on?: boolean };
  "layout.resize": { split?: string; path?: string; border: number; share: number };
  "layout.even": Record<string, never>;
  "layout.swap": { to: string };
  "view.get": Record<string, never>;
  "view.scrollTo": { line?: number; text?: string; block?: string };
  "block.mark": { id?: string; line?: number; reason: string };
  "block.unmark": { n?: number; id?: string };
  "marks.list": Record<string, never>;
  "marks.next": Record<string, never>;
}, On>("tile", {
  "layout.get": {
    summary: "the layout as data: its revision (rev), the tile tree (each split with its id, path and shares, each tab set with its id and the tab shown) and each tile's id, kind, name, source, note, link, drawer state and rect",
    args: {},
    run(_, { d }) { return d.layoutGet(); },
  },
  "layout.list": {
    summary: "the layouts that can be loaded: the ones saved by name and the built-ins",
    keys: "^W r",
    args: {},
    run(_, { d }) { return d.layouts(); },
  },
  "layout.save": {
    summary: "save the layout under a name (the door's layouts.json): the tree, each tile's kind, name, note, program, source, link and drawer state, and the open rule",
    keys: "^W w",
    args: { name: { type: "string", about: "the name to save it under (daily replaces the built-in daily)" } },
    run({ name }, { d }, actor) {
      const r = d.saveLayout(name, actor);
      say(d, actor, `saved the layout as ${name}`);
      return r;
    },
  },
  "layout.load": loadLayout,
  "layout.restore": { ...loadLayout, summary: `the same as layout.load. ${loadLayout.summary}` },
  "layout.move": {
    summary: "move tile reader=<tile> beside tile to=<tile> (where=left, right, up, down), into its tabs (where=tabs, at index=<n>), or along an outer edge of the whole layout (where=edge-left, edge-right, edge-down, edge-up: a full-height column or full-width row). A drawer moved this way is pinned. The person's focus stays where it is",
    keys: "drag a header; ^W m then h j k l beside, ^W t then h j k l into tabs, ^W H J K L to an edge, ^W T takes a tab out",
    args: {
      to: { type: "string", optional: true, about: "the tile it goes beside or into (not needed for an edge)" },
      where: { type: "string", optional: true, about: "left, right, up, down, tabs, or edge-left/right/up/down (default right)" },
      index: { type: "number", optional: true, about: "with where=tabs: the place among the tabs (0 first)" },
    },
    run({ to, where, index }, { d, reader }, actor) {
      const r = d.moveTile(reader, to, whereOf(where, "layout.move", "right"), index, actor);
      const w = whereOf(where, "layout.move", "right");
      say(d, actor, `moved ${r.tile} ${w.startsWith("edge-") ? `to the ${w.slice(5)} edge` : `${PLACE[w]} ${to}`}`);
      return r;
    },
  },
  "tile.open": {
    summary: "open a new tile beside reader=<tile> (where=left, right, up, down) or as a tab in it (where=tabs): kind=tree, reader, detail (note=<id>, or page=<name> to pin the note [[name]]), preview (source=tile:<name> or file:<path>), pty (cmd=\"nvim draft.md\", file=<path it edits>), query (view=<a saved view's block id>: its cards, as a board lane), board, river, brief, thread, activity, who, art. The person's focus stays where it is",
    keys: "^W o <kind>; ^W O <kind> as a tab",
    args: {
      kind: { type: "string", about: "what the tile shows" },
      name: { type: "string", optional: true, about: "its name (default: its kind, numbered)" },
      cmd: { type: "string", optional: true, about: "pty: the command line (default $SHELL)" },
      file: { type: "string", optional: true, about: "pty: the file it edits; preview: the file it shows" },
      source: { type: "string", optional: true, about: "preview: tile:<name> or file:<path>" },
      note: { type: "string", optional: true, about: "detail: the note it keeps" },
      page: { type: "string", optional: true, about: "detail: the page it's pinned to, as in [[name]]" },
      cwd: { type: "string", optional: true, about: "pty: the folder it runs in" },
      view: { type: "string", optional: true, about: "query: the saved view (virtual branch) whose cards it lists" },
      to: { type: "string", optional: true, about: "the tile it opens beside (default the focused one; reader= also names it)" },
      where: { type: "string", optional: true, about: "left, right, up, down or tabs (default right)" },
    },
    async run({ kind, to, where, ...t }, { d, reader }, actor) {
      const r = await d.openTile({ kind: kind as PaneKind, ...t }, to ?? reader, whereOf(where, "tile.open", "right"), actor);
      say(d, actor, `opened ${r.tile}`);
      return r;
    },
  },
  "tile.close": {
    summary: "close tile reader=<tile>: a program in it is ended. Refused while it holds an edit or a comment, and to an agent for the tile that has the person's keys",
    keys: "^W x",
    args: {},
    run(_, { d, reader }, actor) {
      const r = d.closeTile(reader, actor);
      say(d, actor, `closed ${r.tile}`);
      return r;
    },
  },
  "tile.link": {
    summary: "where reader=<tile>'s opens land: a link followed in it, the tree's ⏎, a list's pick opens in tile to=<tile> (a detail, a reader or a preview). No to= unlinks. Alt+⏎ or a ctrl- or alt-click still opens beside",
    keys: "alt+l then click the tile, h j k l or 1-9 (the tile itself unlinks)",
    args: { to: { type: "string", optional: true, about: "the tile its opens land in; left out, the link is taken away" } },
    run({ to }, { d, reader }, actor) {
      const r = d.linkTile(reader, to, actor);
      say(d, actor, to ? `linked ${r.tile} → ${to}` : `unlinked ${r.tile}`);
      return r;
    },
  },
  "tile.focus": {
    summary: "give the person's keys to tile reader=<tile>. Refused to an agent while the person is typing (an edit, a comment, a terminal they're in)",
    keys: "click, Tab, shift+tab, 1-9, ^W h j k l (← ↓ ↑ →)",
    args: {},
    run(_, { d, reader }, actor) {
      const r = d.focusTile(reader, actor);
      say(d, actor, `gave the keys to ${r.tile}`);
      return r;
    },
  },
  "tile.pin": {
    summary: "put reader=<tile> in a drawer, a container that slides over the others without moving them (on=false), or take its drawer away so what it holds is docked where it was (on=true); default toggles. A tab set goes in as one; container=<id> (a split of tiles, from layout.get) goes in whole. edge=left, right, up or down: the drawer slides from that outer edge of the whole layout (a tile not in one is put in one there; a drawer moves there). Anything moved or opened into a drawer lives in it. Refused on a locked screen",
    keys: "^W p; ^W P then edge (⏎ or a click cycles it)",
    args: { on: { type: "boolean", optional: true, about: "false puts it in a drawer, true docks it again" }, edge: { type: "string", optional: true, about: "left, right, up or down: the outer edge the drawer slides from" }, container: { type: "string", optional: true, about: "a split (s<n>) to put in the drawer whole, instead of the tile's own slot" } },
    run({ on, edge, container }, { d, reader }, actor) {
      if (edge !== undefined && !isDir(edge)) throw new ActionRefused(`tile.pin: edge is left, right, up or down, not ${edge}`);
      const r = d.pinTile(reader, on, edge as Dir | undefined, actor, container);
      if (r.changed !== false) say(d, actor, r.pinned ? `docked ${r.tile}` : `put ${r.tile} in a drawer on the ${r.edge}`);
      return r;
    },
  },
  "tile.collapse": {
    summary: "fold reader=<tile> to a spine (on=true: a strip with its title, where it was; what's in it is kept exactly, a draft too), or open it again (on=false); default toggles. Only a tile side by side with others folds (a lane, a reader in a row). Refused where its container can't collapse (collapsible off), and to an agent for the tile that has the person's keys",
    keys: "^W c; ⏎ space or a click on a spine opens it",
    args: { on: { type: "boolean", optional: true, about: "true folds it, false opens it; default toggles" } },
    run({ on }, { d, reader }, actor) {
      const r = d.collapseTile(reader, on, actor);
      if (r.changed !== false) say(d, actor, `${r.collapsed ? "folded" : "opened"} ${r.tile}`);
      return r;
    },
  },
  "float.place": {
    summary: "move or size reader=<a float> (a tile popped out over the others, pane.float): dx dy step it (columns, rows), col row put its corner there, cols rows size it. Never smaller than a float is drawn, never off the screen",
    keys: "H J K L on a float, drag its title or its ◢ corner",
    args: {
      dx: { type: "number", optional: true, about: "columns to move right (negative: left)" }, dy: { type: "number", optional: true, about: "rows to move down (negative: up)" },
      col: { type: "number", optional: true, about: "its left column" }, row: { type: "number", optional: true, about: "its top row" },
      cols: { type: "number", optional: true, about: "its width" }, rows: { type: "number", optional: true, about: "its height" },
    },
    run(args, { d, reader }, actor) {
      const r = d.placeFloat(reader, args, actor);
      if (actor.kind === "agent") say(d, actor, `moved ${r.tile}`);
      return r;
    },
  },
  "layout.lock": {
    summary: "lock the screen (on=true): its shape is fixed (no moves, drops, opens of new tiles, closes, resizes, drawers in or out, links or layout loads) and its contents stay live (reading, editing, typing in terminals, drawers sliding, tabs shown, zoom); on=false unlocks; default toggles. Saved with the layout",
    keys: "alt+k; a click on the hint row's □ lock / ▣ locked chip",
    args: { on: { type: "boolean", optional: true, about: "true locks, false unlocks; default toggles" } },
    run({ on }, { d }, actor) {
      const r = d.lockScreen(on, actor);
      if (r.changed) say(d, actor, r.locked ? "locked the screen (alt+k unlocks)" : "unlocked the screen");
      return r;
    },
  },
  "layout.policy": {
    summary: "a container's policy, saved with the layout: node=<id> (s<n> a split, g<n> a tab set, d<n> a drawer, from layout.get) or node=screen; left out, the innermost container holding reader=<tile>, else the screen. Sets draggable (its tiles move out), droppable (it takes tiles), accepts=<kind,kind> (only those kinds; any clears), resizable, min/max/fixed=<cells> along its parent's axis (-1 clears), collapsible, overlay and stays (a drawer), locked, opensInto=<tile> (where its tiles' opens land when they have no link); clear=<field,field> takes fields away. With nothing to set, it reads: each layer's policy over the tile and what applies. On a locked container only locked changes",
    keys: "^W P (⏎ or a click on a row changes it; alt+k locks the screen)",
    args: {
      node: { type: "string", optional: true, about: "the container's id, or screen" },
      draggable: { type: "boolean", optional: true, about: "its tiles can be dragged out" },
      droppable: { type: "boolean", optional: true, about: "it takes tiles moved or opened into it" },
      accepts: { type: "string", optional: true, about: "the tile kinds it takes, comma-separated; any clears" },
      resizable: { type: "boolean", optional: true, about: "its borders move" },
      min: { type: "number", optional: true, about: "its least size in cells (-1 clears)" },
      max: { type: "number", optional: true, about: "its most size in cells (-1 clears)" },
      fixed: { type: "number", optional: true, about: "its size in cells, kept (-1 clears)" },
      collapsible: { type: "boolean", optional: true, about: "a drawer can slide shut" },
      overlay: { type: "boolean", optional: true, about: "a drawer slides over (true) or takes its room while open (false)" },
      stays: { type: "boolean", optional: true, about: "an open drawer stays open when the keys leave it" },
      locked: { type: "boolean", optional: true, about: "its shape is fixed, its contents live" },
      opensInto: { type: "string", optional: true, about: "the tile its tiles' opens land in (empty clears)" },
      clear: { type: "string", optional: true, about: "fields to take away, comma-separated" },
    },
    run({ node, clear, accepts, opensInto, min, max, fixed, ...flags }, { d, reader }, actor) {
      const set: Policy = {}, gone = (clear ?? "").split(",").map(x => x.trim()).filter(Boolean);
      for (const [k, v] of Object.entries(flags)) if (typeof v === "boolean") (set as Record<string, unknown>)[k] = v;
      for (const [k, v] of Object.entries({ min, max, fixed })) if (v !== undefined) { if (v < 0) gone.push(k); else (set as Record<string, unknown>)[k] = Math.round(v); }
      if (accepts !== undefined) { const kinds = accepts.split(",").map(x => x.trim()).filter(Boolean); if (!kinds.length || (kinds.length === 1 && kinds[0] === "any")) gone.push("accepts"); else set.accepts = kinds; }
      if (opensInto !== undefined) { if (opensInto) set.opensInto = opensInto; else gone.push("opensInto"); }
      if (!Object.keys(set).length && !gone.length && node === undefined) return d.policyGet(reader);
      const r = d.setPolicy(reader, node, set, gone, actor);
      say(d, actor, `set ${r.node}'s policy: ${[...Object.entries(set).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`), ...gone.map(k => `${k} cleared`)].join(" ") || "unchanged"}`);
      return r;
    },
  },
  "tile.drawer": {
    summary: "slide the drawer holding reader=<tile> open (open=true) or shut (open=false); default toggles. A shut drawer is a handle at the end of the hint row; a tile dragged onto the handle goes into the drawer. Refused when its policy says it isn't collapsible",
    keys: "^W d; a click on its handle (⇤ ⇥ ⤒ ⤓ on the hint row); a drawer slides shut when the keys go elsewhere",
    args: { open: { type: "boolean", optional: true, about: "true opens it, false shuts it" }, container: { type: "string", optional: true, about: "the drawer's id (d<n>), when it isn't the innermost one holding reader=" } },
    run({ open, container }, { d, reader }, actor) {
      const r = d.drawerTile(reader, open, actor, container);
      say(d, actor, `${r.open ? "opened" : "shut"} drawer ${r.tile}`);
      return r;
    },
  },
  "tile.preview": {
    summary: "open a preview of reader=<tile> beside it: of a terminal tile, the file it edits (re-read on each save); of the board, its card (its own preview strip collapses); of anything else, what it selects",
    keys: "^W v",
    args: { where: { type: "string", optional: true, about: "left, right, up, down or tabs (default right)" } },
    async run({ where }, { d, reader }, actor) {
      const r = await d.previewTile(reader, whereOf(where, "tile.preview", "right"), actor);
      say(d, actor, `opened ${r.tile}`);
      return r;
    },
  },
  "tile.info": {
    summary: "one tile as data: its kind, name, rect, link, drawer state; a terminal's command, file, process and screen text; a reader's note",
    args: {},
    run(_, { d, reader }) { return d.tileInfo(reader); },
  },
  "tile.type": {
    summary: "send text=<text> to the program in terminal tile reader=<tile>, as typed keys (\\n is ⏎). Refused to an agent for the terminal the person is in",
    args: { text: { type: "string", about: "what to type; \\n for enter, \\e for escape" } },
    run({ text }, { d, reader }, actor) {
      const r = d.typeTile(reader, text, actor);
      say(d, actor, `typed into ${r.tile}`);
      return r;
    },
  },
  "tile.restart": {
    summary: "run the program in terminal tile reader=<tile> again (after it exited)",
    keys: "⏎ on an exited terminal",
    args: {},
    run(_, { d, reader }, actor) {
      const r = d.restartTile(reader, actor);
      say(d, actor, `restarted ${r.tile}`);
      return r;
    },
  },
  "tile.enter": {
    summary: "type in terminal tile reader=<tile> (the focused one): every key but ctrl+] goes to its program; one that exited runs again. The person's only: an agent's would take their keys (tile.type sends a program text)",
    keys: "e, ⏎, click in a terminal tile; ctrl+] then ctrl+] sends ctrl+] to it",
    args: { send: { type: "string", optional: true, about: "bytes to give the program first (a literal ctrl+])" } },
    run({ send }, { d, reader }, actor) { return d.enterTile(reader, send, actor); },
  },
  "tile.leave": {
    summary: "back to the door from the terminal tile the person types in (ctrl+] again soon sends one to the program). The person's only",
    keys: "ctrl+]",
    args: {},
    run(_, { d }, actor) { return d.leaveTile(actor); },
  },
  "layout.resize": {
    summary: "move a border: in split split=<id> (layout.get gives each split's id, s<n>; it stays with the split when tiles move around it), or the split at path=<p> (\"\" the root, \"1.0\" its second kid's first kid: where it is now, so pass expected=<rev> too), the border after kid border=<i> is placed so kid i and kid i+1 share their room share=<0-1> to (1-share). The answer names the split, its path and its tiles",
    keys: "drag a border; ^W < > + - (pane.resize)",
    args: {
      split: { type: "string", optional: true, about: "the split's id from layout.get (s<n>)" },
      path: { type: "string", optional: true, about: "or: the split's path from layout.get (check it with expected=<rev>)" },
      border: { type: "number", about: "the border after this kid (0 first)" },
      share: { type: "number", about: "kid border's part of the pair, 0.08-0.92" },
    },
    run({ split, path, border, share }, { d }, actor) { return d.resizeBorder({ split, path }, border, share, actor); },
  },
  "tile.herdr": {
    summary: "terminal tile reader=<tile> shows an agent that lives in Herdr pane pane=<label> (on=false: it no longer does). Said by scripts/door-agent-herdr.ts, the program in the tile, while it attaches: quitting the door then ends only the attach, not the agent. Cleared when the program exits",
    args: { pane: { type: "string", optional: true, about: "the Herdr pane's label (door-claude)" }, on: { type: "boolean", optional: true, about: "false: the tile no longer shows a Herdr agent" } },
    run({ pane, on }, { d, reader }, actor) {
      const r = d.herdrTile(reader, pane, on, actor);
      say(d, actor, on === false ? `${r.tile} no longer shows an agent in Herdr` : `${r.tile} shows ${pane} in Herdr (quitting the door leaves it running)`);
      return r;
    },
  },
  "layout.even": {
    summary: "every split shares its room equally", keys: "^W =",
    args: {},
    run(_, { d }, actor) { const r = d.evenOut(actor); say(d, actor, "evened out the layout"); return r; },
  },
  "layout.swap": {
    summary: "tile reader=<tile> and tile to=<tile> trade places", keys: "^W s (the next tile)",
    args: { to: { type: "string", about: "the tile it trades places with" } },
    run({ to }, { d, reader }, actor) { const r = d.swapTile(reader, to, actor); say(d, actor, `swapped ${r.tile} and ${to}`); return r; },
  },
  "view.get": {
    summary: "what each tile has in view: a reader's note and its lines in view (first, last) with the scroll; the outline's selected row; a terminal's screen, and for nvim its cursor, lines in view and file; reader=<tile> for one",
    args: {},
    run(_, { d, reader }) { return d.viewGet(reader); },
  },
  "view.scrollTo": {
    summary: "scroll reader=<tile> so a note line (line=<n>, 1 the subject) or the first line with text=<words> is at the top. It moves what's in view, not the person's [ ] position, selection or keys. block=<id> checks the tile shows that note (open it there first: open id=… reader=…)",
    args: { line: { type: "number", optional: true, about: "the note line to bring to the top" }, text: { type: "string", optional: true, about: "or: the first line with these words" }, block: { type: "string", optional: true, about: "the note the tile must be showing" } },
    run(at, { d, reader }, actor) { const r = d.scrollTo(reader, at, actor); if (actor.kind === "agent") say(d, actor, `scrolled ${r.tile}`); return r; },
  },
  "block.mark": {
    summary: "an attention mark, with the reason and who set it: on block id=<id> (default: the note tile reader=<tile> shows), framed and labelled in every tile that shows it; or on line=<n> of an nvim tile (reader=<tile>), as an extmark with virtual text. It stays until dismissed and never moves the person's focus, selection or cursor",
    keys: "alt+m steps through marks; a click on a tile's ◆ label dismisses it",
    args: { id: { type: "string", optional: true, about: "the block (note) id" }, line: { type: "number", optional: true, about: "an nvim tile's line (1-based)" }, reason: { type: "string", about: "what it's about, in a few words (\"needs your call\")" } },
    async run(m, { d, reader }, actor) { const r = await d.markBlock(reader, m, actor); say(d, actor, `marked: ${m.reason}`); return r; },
  },
  "block.unmark": {
    summary: "dismiss mark n=<n> (marks.list numbers them), or every mark on block id=<id>, or (neither) the marks on what reader=<tile> shows",
    keys: "a click on a tile's ◆ label; alt+x dismisses the focused tile's",
    args: { n: { type: "number", optional: true, about: "the mark's number" }, id: { type: "string", optional: true, about: "a block id" } },
    async run({ n, id }, { d, reader }, actor) { void reader; const r = await d.unmark(n, id, actor); say(d, actor, "dismissed a mark"); return r; },
  },
  "marks.list": {
    summary: "every attention mark: its number, block or tile and line, reason, who set it, when, and the tiles showing it",
    args: {},
    run(_, { d }) { return d.marks(); },
  },
  "marks.next": {
    summary: "step to the next mark: the keys go to a tile showing it, or it opens where the focused tile's opens go. Refused to an agent while the person is typing",
    keys: "alt+m",
    args: {},
    run(_, { d }, actor) { return d.nextMark(actor); },
  },
  "tab.select": {
    summary: "show tab reader=<tile> in its tab set, or step by=1 (next) / by=-1 (previous) from it. An agent's leaves the person's focus where it is",
    keys: "click a tab; alt+n alt+p; ^W ] ^W [",
    args: { by: { type: "number", optional: true, about: "1 next, -1 previous; left out, that tab is shown" } },
    run({ by }, { d, reader }, actor) {
      if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused("tab.select: by is 1 or -1");
      const r = d.selectTab(reader, by, actor);
      if (actor.kind === "agent") say(d, actor, `showed tab ${r.tile}`);
      return r;
    },
  },
});
