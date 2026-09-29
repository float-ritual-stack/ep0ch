// Tiles and layouts as actions (PIE-413, PIE-473, PIE-474): every change to the layout is one of these
// commands. The desk's keys, its mouse drags and clicks, and the control socket (`ep0ch act`) are only
// callers: a header dropped on a tile's centre runs `layout.move where=tabs`, `^W m l` runs
// `layout.move where=right`, alt+l then a click runs `tile.link`. An agent's is said on screen, and never
// takes the person's focus or keys: a tile it opens or moves leaves their focus where it is, and what the
// person is typing in (an edit, a terminal) is never closed, moved into, or typed into by an agent.
import type { Actor } from "../socket";
import { ActionRefused, ActionSet, agentLabel } from "../surface/actions";
import type { Dir } from "./layout";
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
export interface NewTile { kind: PaneKind; name?: string; cmd?: string; file?: string; source?: string; note?: string; cwd?: string }

/** The view that holds the tiles (the desk). `sel` names a tile by name or number, as `peek` shows it. */
export interface TileHost {
  ctx: { flash(msg: string): void };
  moveTile(sel: string | undefined, to: string | undefined, where: Where, index: number | undefined, actor: Actor): TileDone;
  openTile(t: NewTile, at: string | undefined, where: Where, actor: Actor): TileDone | Promise<TileDone>;
  closeTile(sel: string | undefined, actor: Actor): TileDone;
  linkTile(sel: string | undefined, to: string | undefined, actor: Actor): TileDone;
  selectTab(sel: string | undefined, by: number | undefined, actor: Actor): TileDone;
  focusTile(sel: string | undefined, actor: Actor): TileDone;
  pinTile(sel: string | undefined, on: boolean | undefined, actor: Actor): TileDone;
  drawerTile(sel: string | undefined, open: boolean | undefined, actor: Actor): TileDone;
  previewTile(sel: string | undefined, where: Where, actor: Actor): TileDone | Promise<TileDone>;
  typeTile(sel: string | undefined, text: string, actor: Actor): TileDone;
  restartTile(sel: string | undefined, actor: Actor): TileDone;
  tileInfo(sel: string | undefined): unknown;
  saveLayout(name: string, actor: Actor): TileDone | { layout: string; [k: string]: unknown };
  loadLayout(name: string, actor: Actor): { layout: string; [k: string]: unknown } | Promise<{ layout: string; [k: string]: unknown }>;
  layouts(): unknown;
  layoutGet(): unknown;
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
  "tile.open": { kind: string; name?: string; cmd?: string; file?: string; source?: string; note?: string; cwd?: string; to?: string; where?: string };
  "tile.close": Record<string, never>;
  "tile.link": { to?: string };
  "tile.focus": Record<string, never>;
  "tile.pin": { on?: boolean };
  "tile.drawer": { open?: boolean };
  "tile.preview": { where?: string };
  "tile.info": Record<string, never>;
  "tile.type": { text: string };
  "tile.restart": Record<string, never>;
  "tab.select": { by?: number };
}, On>("tile", {
  "layout.get": {
    summary: "the layout as data: the tile tree (splits with their shares, tab sets with the tab shown) and each tile's kind, name, source, note, link, drawer state and rect",
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
    keys: "drag a header; ^W m hjkl beside, ^W t hjkl into tabs, ^W HJKL to an edge, ^W T takes a tab out",
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
    summary: "open a new tile beside reader=<tile> (where=left, right, up, down) or as a tab in it (where=tabs): kind=tree, reader, detail (note=<id>), preview (source=tile:<name> or file:<path>), pty (cmd=\"nvim draft.md\", file=<path it edits>), board, river, brief, thread, activity, who, art. The person's focus stays where it is",
    keys: "^W o <kind>; ^W O <kind> as a tab",
    args: {
      kind: { type: "string", about: "what the tile shows" },
      name: { type: "string", optional: true, about: "its name (default: its kind, numbered)" },
      cmd: { type: "string", optional: true, about: "pty: the command line (default $SHELL)" },
      file: { type: "string", optional: true, about: "pty: the file it edits; preview: the file it shows" },
      source: { type: "string", optional: true, about: "preview: tile:<name> or file:<path>" },
      note: { type: "string", optional: true, about: "detail: the note it keeps" },
      cwd: { type: "string", optional: true, about: "pty: the folder it runs in" },
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
    keys: "alt+l, then click the tile (or h j k l, or its number); alt+l, then click the tile itself, unlinks",
    args: { to: { type: "string", optional: true, about: "the tile its opens land in; left out, the link is taken away" } },
    run({ to }, { d, reader }, actor) {
      const r = d.linkTile(reader, to, actor);
      say(d, actor, to ? `linked ${r.tile} → ${to}` : `unlinked ${r.tile}`);
      return r;
    },
  },
  "tile.focus": {
    summary: "give the person's keys to tile reader=<tile>. Refused to an agent while the person is typing (an edit, a comment, a terminal they're in)",
    keys: "click, Tab, 1-9, ^W hjkl",
    args: {},
    run(_, { d, reader }, actor) {
      const r = d.focusTile(reader, actor);
      say(d, actor, `gave the keys to ${r.tile}`);
      return r;
    },
  },
  "tile.pin": {
    summary: "pin reader=<tile> into the layout (on=true) or make it a drawer that slides over the others without moving them (on=false); default toggles. A tab can't be a drawer",
    keys: "^W p",
    args: { on: { type: "boolean", optional: true, about: "true pins it, false makes it slide over" } },
    run({ on }, { d, reader }, actor) {
      const r = d.pinTile(reader, on, actor);
      if (r.changed !== false) say(d, actor, `${r.pinned ? "pinned" : "unpinned"} ${r.tile}`);
      return r;
    },
  },
  "tile.drawer": {
    summary: "slide drawer reader=<tile> open (open=true) or shut (open=false); default toggles. A shut drawer is a handle at the end of the hint row",
    keys: "^W d; a click on its handle; a drawer slides shut when the keys go elsewhere",
    args: { open: { type: "boolean", optional: true, about: "true opens it, false shuts it" } },
    run({ open }, { d, reader }, actor) {
      const r = d.drawerTile(reader, open, actor);
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
