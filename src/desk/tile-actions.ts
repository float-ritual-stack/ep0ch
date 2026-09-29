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
  resizeBorder(path: string, border: number, share: number, actor: Actor): TileDone | { split: string; [k: string]: unknown };
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
  "layout.resize": { path: string; border: number; share: number };
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
  "layout.resize": {
    summary: "move a border: in the split at path=<p> (as layout.get gives it: \"\" the root, \"1.0\" its second kid's first kid), the border after kid border=<i> is placed so kid i and kid i+1 share their room share=<0-1> to (1-share)",
    keys: "drag a border; ^W < > + - (pane.resize)",
    args: { path: { type: "string", about: "the split's path from layout.get" }, border: { type: "number", about: "the border after this kid (0 first)" }, share: { type: "number", about: "kid border's part of the pair, 0.08-0.92" } },
    run({ path, border, share }, { d }, actor) { return d.resizeBorder(path, border, share, actor); },
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
