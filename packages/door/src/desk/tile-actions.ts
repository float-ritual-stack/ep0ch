// Tiles and layouts as actions (PIE-413, PIE-473, PIE-474): every change to the layout is one of these
// commands. The desk's keys, its mouse drags and clicks, and the control socket (`ep0ch act`) are only
// callers: a header dropped on a tile's centre runs `layout.move where=tabs`, `^W m l` runs
// `layout.move where=right`, alt+l then a click runs `tile.link`. An agent's is said on screen, and never
// takes the person's focus or keys: a tile it opens or moves leaves their focus where it is, and what the
// person is typing in (an edit, a terminal) is never closed, moved into, or typed into by an agent.
import type { Actor } from "../socket";
import { ActionRefused, actionSet, def, type ArgsOf } from "../surface/actions";
import { AGENT_WORDS, isAgentLevel, type AgentLevel } from "../surface/agent-level";
import { EDGE_WORD, isDir, LINK_ROLES, type Axis, type Dir, type LinkRole, type Policy } from "./screen-layout";
import type { Desk } from "./desk";
import { tileNoun, type TileKindName } from "./tile-kinds";

export type Where = Dir | "tabs" | "next" | "edge-left" | "edge-right" | "edge-up" | "edge-down";
const WHERE = ["left", "right", "up", "down", "tabs", "next", "edge-left", "edge-right", "edge-up", "edge-down"];
export const whereOf = (s: string | undefined, action: string, dflt: Where): Where => {
  if (s === undefined) return dflt;
  if (WHERE.includes(s)) return s as Where;
  throw new ActionRefused(`${action}: where is ${WHERE.join(", ")}, not ${s}`);
};

const PLACE: Record<string, string> = { left: "left of", right: "right of", up: "above", down: "below", tabs: "into the tabs of" };

/** A tile as its menu reads it (`Desk.tileNow`): where it is now, and why a tile operation would be refused there. */
export interface TileNow {
  float: boolean; zoomed: boolean; collapsed: boolean; dock: boolean; inDrawer: boolean; flow: boolean; held: boolean;
  /** A close in its container shuts its dock instead (the board's outline). */
  shuts: boolean;
  /** The program running in it (a terminal tile), whose close ends it. */
  running: string | null;
  refused(op: "close" | "float" | "zoom" | "collapse" | "pin" | "drawer" | "widen" | "hold"): string | null;
}
/** The tile menu's group for the tile operations. */
const TILE = "Tile";

/** What a tile operation did, as the socket answers it. */
export interface TileDone { tile: string; [k: string]: unknown }

/** A new tile: its kind and what it needs (the fields of a saved tile). */
export interface NewTile { kind: TileKindName; name?: string; cmd?: string; file?: string; source?: string; note?: string; page?: string; cwd?: string; view?: string }

/**
 * What a tile action runs on: the desk, and the tile `tile=` named (by its name: the dispatcher read the grammar).
 * An agent's change is said on screen with who made it (each def's `says`); the person's own isn't (they see it
 * happen), unless it `confirms`: something the screen doesn't show (a layout saved, where a drag put a tile).
 */
interface On { d: Desk; reader?: string }

/** The tile menu's group for saving and loading the screen. */
const SCREEN = "Screen";

const loadLayout = {
  summary: "lay this screen out as the screen named name= (one a person made: a screen note) or a built-in layout (daily, river, board, desk). Tiles with the same name and kind are kept as they are (a running program, a reader's note); a running program or an unsaved edit the new layout has no place for is kept as a shut dock (said: kept=), never ended. The person's with no name opens the picker. Refused to an agent while the person is typing",
  keys: "alt+d (daily); ^W r picks one",
  touches: "screen", replay: "safe", confirms: true,
  says: (r: { layout?: string; kept?: string[]; picker?: boolean }, a: { name?: string }) => (r?.picker ? null : `laid out ${a.name}${r?.kept?.length ? ` · kept ${r.kept.join(", ")} in a shut dock (⇥ on the hint row)` : ""}`),
  menu: { label: "lay it out as a screen…", group: SCREEN, key: "ctrl+w r", now: ({ d }: On) => (d.spec.layouts ? null : { hide: true }) },
  args: { name: { type: "string", optional: true, about: "the layout's or screen's name (left out: the person picks)" } },
  run({ name }: { name?: string }, { d }: On, actor: Actor) { return d.loadLayout(name, actor); },
} as const;

/** What `layout.policy`'s arguments set and clear (the run applies it; `says` puts it in words). */
function policyChange({ clear, accepts, opensInto, opens, host, agents, min, max, fixed, node: _node, ...flags }: PolicyArgs): { set: Policy; gone: string[] } {
  const set: Policy = {}, gone = (clear ?? "").split(",").map(x => x.trim()).filter(Boolean);
  for (const [k, v] of Object.entries(flags)) if (typeof v === "boolean") (set as Record<string, unknown>)[k] = v;
  for (const [k, v] of Object.entries({ min, max, fixed })) if (v !== undefined) { if (v < 0) gone.push(k); else (set as Record<string, unknown>)[k] = Math.round(v); }
  if (accepts !== undefined) { const kinds = accepts.split(",").map(x => x.trim()).filter(Boolean); if (!kinds.length || (kinds.length === 1 && kinds[0] === "any")) gone.push("accepts"); else set.accepts = kinds; }
  if (opensInto !== undefined) { if (opensInto) set.opensInto = opensInto; else gone.push("opensInto"); }
  if (opens !== undefined) { if (opens !== "current" && opens !== "next" && opens !== "beside") throw new ActionRefused(`layout.policy: opens is current, next or beside, not ${opens}`); set.opens = opens; }
  if (host !== undefined) { if (host !== "over" && host !== "beside" && host !== "none") throw new ActionRefused(`layout.policy: host is over, beside or none, not ${host}`); set.host = host; }
  if (agents !== undefined) { if (!isAgentLevel(agents)) throw new ActionRefused(`layout.policy: agents is free, edit or off, not ${agents}`); if (agents === "free") gone.push("agents"); else set.agents = agents; }
  return { set, gone };
}
/** What `layout.policy` sets: the schema `act` checks, and so its arguments' type. */
const POLICY_ARGS = {
  node: { type: "string", optional: true, about: "the container's id, or screen" },
  draggable: { type: "boolean", optional: true, about: "its tiles can be dragged out" },
  droppable: { type: "boolean", optional: true, about: "it takes tiles moved or opened into it" },
  closable: { type: "boolean", optional: true, about: "its tiles close (tile.close); false: they stay" },
  accepts: { type: "string", optional: true, about: "the tile kinds it takes, comma-separated; any clears" },
  resizable: { type: "boolean", optional: true, about: "its borders move" },
  min: { type: "number", optional: true, about: "its least size in cells (-1 clears)" },
  max: { type: "number", optional: true, about: "its most size in cells (-1 clears)" },
  fixed: { type: "number", optional: true, about: "its size in cells, kept (-1 clears)" },
  collapsible: { type: "boolean", optional: true, about: "a dock can slide shut" },
  overlay: { type: "boolean", optional: true, about: "a dock slides over (true) or takes its room while open (false)" },
  stays: { type: "boolean", optional: true, about: "an open dock stays open when the keys leave it" },
  locked: { type: "boolean", optional: true, about: "its shape is fixed, its contents live" },
  opensInto: { type: "string", optional: true, about: "the tile its tiles' opens land in (empty clears)" },
  opens: { type: "string", optional: true, about: "the open rule: current (the current note) or next (a new column after the tile's own, in a flow)" },
  agents: { type: "string", optional: true, about: "what an agent may do to the tiles under it (free, edit, off; PIE-639): node=screen is the screen's default, a tile's own wins (tile.agent); free clears" },
  host: { type: "string", optional: true, about: "node=screen: where the host layer (the agent, terminals) may appear over this screen: over, beside or none" },
  clear: { type: "string", optional: true, about: "fields to take away, comma-separated" },
} as const;
type PolicyArgs = ArgsOf<typeof POLICY_ARGS>;

export const TILE_ACTIONS = actionSet<On>()("tile", {
  "layout.get": def({
    summary: "the layout as data: its revision (rev), the tile tree (each split with its id, path and shares, each tab set with its id and the tab shown) and each tile's id, kind, name, source, note, link, dock state and rect",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d }) { return d.layoutGet(); },
  }),
  "layout.list": def({
    summary: "the layouts this screen can be laid out as: the built-ins and the screens people made (screen notes)",
    keys: "^W r",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d }) { return d.layouts(); },
  }),
  "layout.move": def({
    summary: "move tile=<tile> beside tile to=<tile> (where=left, right, up, down), into its tabs (where=tabs, at index=<n>), or along an outer edge of the whole layout (where=edge-left, edge-right, edge-down, edge-up: a full-height column or full-width row). A docked tile moved this way is undocked. The person's focus stays where it is",
    keys: "drag a header; ^W m then h j k l beside, ^W t then h j k l into tabs, ^W H J K L to an edge, ^W T takes a tab out",
    touches: "shape", replay: "safe", confirms: true,
    says: (r, a) => { const w = whereOf(a.where, "layout.move", "right"); return `moved ${r.tile} ${w.startsWith("edge-") ? `to the ${w.slice(5)} edge` : `${PLACE[w]} ${a.to}`}`; },
    args: {
      to: { type: "string", optional: true, tile: true, about: "the tile it goes beside or into (not needed for an edge)" },
      where: { type: "string", optional: true, about: "left, right, up, down, tabs, or edge-left/right/up/down (default right)" },
      index: { type: "number", optional: true, about: "with where=tabs: the place among the tabs (0 first)" },
    },
    run({ to, where, index }, { d, reader }, actor) {
      return d.moveTile(reader, to, whereOf(where, "layout.move", "right"), index, actor);
    },
  }),
  "tile.open": def({
    summary: "open a new tile beside tile=<tile> (where=left, right, up, down) or as a tab in it (where=tabs): kind=tree, reader, detail (note=<id>, or page=<name> to pin the note [[name]]), preview (source=tile:<name> or file:<path>), pty (cmd=\"nvim draft.md\", file=<path it edits>), query (view=<a saved view's block id>: its cards, as a board lane), board, river, brief, thread, activity, who, art. The person's focus stays where it is",
    keys: "^W o <kind>; ^W O <kind> as a tab; ⏎ or a double click on a view in ^W o q's picker",
    touches: "shape", replay: "ask", says: (r, a) => `opened ${tileNoun(a.kind, r.tile)}`,
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
      to: { type: "string", optional: true, tile: true, about: "the tile it opens beside (default the focused one; tile= also names it)" },
      where: { type: "string", optional: true, about: "left, right, up, down or tabs (default right); next: the column after its own in a flow" },
    },
    async run({ kind, to, where, ...t }, { d, reader }, actor) {
      return await d.openTile({ kind: kind as TileKindName, ...t }, to ?? reader, whereOf(where, "tile.open", "right"), actor);
    },
  }),
  "tile.close": def({
    summary: "close tile=<tile>: a program in it is ended. On the board a detail or a float closes, a dock's tile shuts its dock, and the lanes and the preview stay (closable off); the river's library stays (closable off). Refused while it holds an edit or a comment, and to an agent for the tile that has the person's keys",
    keys: "^W x, or a click on the × in its top right corner; board x, esc q on a dock",
    touches: "shape", replay: "ask", says: r => `closed ${r.tile}`,
    menu: {
      label: "close", group: TILE, key: "ctrl+w x",
      now: ({ d, reader }, _t, actor) => {
        const n = d.tileNow(reader, actor);
        return n.shuts ? { label: "shut its dock" } : { refused: n.refused("close"), ...(n.running ? { label: `close (ends ${n.running})` } : {}) };
      },
    },
    args: {},
    run(_, { d, reader }, actor) {
      return d.closeTile(reader, actor);
    },
  }),
  "tile.resize": def({
    summary: "grow (by>0) or shrink (by<0) tile=<tile> by steps along axis=row (width, default) or col (height), as its keys do; on the board tile=lanes is the lanes' row. layout.resize places a border exactly",
    keys: "^W < > + -; board { } < >; drag a border",
    touches: "shape", replay: "safe", says: (r, a) => `${a.by > 0 ? "grew" : "shrank"} ${r.tile}`,
    args: { by: { type: "number", about: "steps: +1 grows it by one key press, -2 shrinks it by two" }, axis: { type: "string", optional: true, about: "row (width, default) or col (height)" } },
    run({ by, axis }, { d, reader }, actor) {
      if (!Number.isInteger(by) || by === 0 || Math.abs(by) > 20) throw new ActionRefused("tile.resize: by is a whole number of steps, -20 to 20, not 0");
      if (axis !== undefined && axis !== "row" && axis !== "col") throw new ActionRefused(`tile.resize: axis is row (across) or col (down), not ${axis}`);
      return d.resizeTile(reader, (axis ?? "row") as Axis, by, actor);
    },
  }),
  "tile.zoom": def({
    summary: "zoom tile=<tile> to fill the screen (on=false, or again, unzooms). An agent zooms only the tile that has the person's keys, never one that would hide it",
    keys: "^W z",
    touches: "shape", replay: "safe", says: r => `${r.zoomed ? "zoomed" : "unzoomed"} ${r.tile}`,
    menu: { label: "zoom", group: TILE, key: "ctrl+w z", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.zoomed ? { label: "unzoom" } : { refused: n.refused("zoom") }; } },
    args: { on: { type: "boolean", optional: true, about: "true zooms, false unzooms; default toggles" } },
    run({ on }, { d, reader }, actor) {
      return d.zoomTile(reader, on, actor);
    },
  }),
  "tile.float": def({
    summary: "pop tile=<tile> out of the layout as a float over everything (its own rectangle; the board floats a copy of its preview), or put a float back in the layout (on the board, as a detail). Refused where policy keeps the tile in place, and to an agent for the tile that has the person's keys",
    keys: "^W f; board o; a click on the focused tile's ⧉ floats it, on a float's ⧉ puts it back; while dragging a tile, f",
    touches: "shape", replay: "safe", says: r => `${r.floated ? "popped out" : "put back"} ${r.tile}`,
    menu: { label: "float", group: TILE, key: "ctrl+w f", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.float ? { label: "put back in the layout" } : { refused: n.refused("float") }; } },
    args: {},
    run(_, { d, reader }, actor) {
      return d.floatTile(reader, actor);
    },
  }),
  "tile.link": def({
    summary: "where tile=<tile>'s opens land: a link followed in it, the tree's ⏎, a list's pick opens in tile to=<tile> (a detail, a reader or a preview). role=preview also follows the source's selection as it moves; role=target takes only what is opened into it (⏎), so a selection can be previewed elsewhere (the links tile's default). role= alone changes the role of the link it has. No to= and no role= unlinks. Alt+⏎ or a ctrl- or alt-click still opens beside",
    keys: "alt+l then click the tile, h j k l or 1-9 (the tile itself unlinks); a click on the link's role on the header (⏎ target, ◌ preview)",
    touches: "shape", replay: "safe", says: (r, a) => (a.role && !a.to ? `${r.tile}'s link is a ${a.role}` : a.to ? `linked ${r.tile} → ${a.to}` : `unlinked ${r.tile}`),
    args: {
      to: { type: "string", optional: true, tile: true, about: "the tile its opens land in; left out, the link is taken away (or, with role=, kept)" },
      role: { type: "string", optional: true, about: "preview (the linked tile follows the selection) or target (it takes only what is opened into it); default the source kind's: the links tile's is target" },
    },
    run({ to, role }, { d, reader }, actor) {
      if (role !== undefined && !(LINK_ROLES as readonly string[]).includes(role)) throw new ActionRefused(`tile.link: role is preview or target, not ${role}`);
      return d.linkTile(reader, to, actor, role as LinkRole | undefined);
    },
  }),
  "tile.focus": def({
    summary: "give the person's keys to tile=<tile>. Refused to an agent while the person is typing (an edit, a comment, a terminal they're in)",
    keys: "click, Tab, shift+tab, 1-9, ^W h j k l (← ↓ ↑ →); esc q back home (a screen with a home: the board's lanes)",
    touches: "screen", replay: "safe", says: r => `gave the keys to ${r.tile}`,
    args: { dir: { type: "string", optional: true, about: "left, right, up or down: the tile that way from tile= (in a flow: the column before or after)" } },
    run({ dir }, { d, reader }, actor) {
      if (dir !== undefined && !isDir(dir)) throw new ActionRefused(`tile.focus: dir is left, right, up or down, not ${dir}`);
      return d.focusTile(dir ? d.neighbourOf(reader, dir) : reader, actor);
    },
  }),
  "tile.dock": def({
    summary: "dock tile=<tile> to an edge (on=true): it goes in a dock, a container on this screen that slides over the others from its edge without moving them, and stays on this screen; or undock it, back in the layout where it was (on=false); default toggles. On the board tile=tree and tile=backlinks are its outline and backlinks docks, each a whole container (the list and its preview). A tab set goes in as one; container=<id> (a split of tiles, from layout.get) goes in whole. edge=left, right, up or down: the dock slides from that outer edge of the whole layout (a tile not docked is docked there; a dock moves there). Anything moved or opened into a dock lives in it. Refused on a locked screen",
    keys: "^W p; ^W P then edge (⏎ or a click cycles it); board T, B; a click on a header's ⇤ docked undocks it; while dragging a tile, p, or a drop on a dock's handle",
    touches: "shape", replay: "safe", confirms: true, says: r => (r.changed === false ? null : r.docked ? `docked ${r.tile} to the ${EDGE_WORD[r.edge as Dir] ?? r.edge} edge` : `undocked ${r.tile}`),
    menu: { label: "dock it to an edge", group: TILE, key: "ctrl+w p", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.inDrawer ? { hide: true } : { refused: n.refused("pin"), ...(n.dock ? { label: "undock it" } : {}) }; } },
    args: { on: { type: "boolean", optional: true, about: "true docks it to an edge, false undocks it back into the layout" }, edge: { type: "string", optional: true, about: "left, right, up or down: the outer edge the dock slides from; other: the opposite side to where it is (undocked, it's moved there and stays undocked)" }, container: { type: "string", optional: true, about: "a split (s<n>) to dock whole, instead of the tile's own slot" } },
    run({ on, edge, container }, { d, reader }, actor) {
      if (edge !== undefined && !isDir(edge) && edge !== "other") throw new ActionRefused(`tile.dock: edge is left, right, up, down or other, not ${edge}`);
      return d.dockTile(reader, on === undefined ? undefined : !on, edge as Dir | "other" | undefined, actor, container);
    },
  }),
  "tile.collapse": def({
    summary: "fold tile=<tile> to a spine (on=true: a strip with its title, where it was; what's in it is kept exactly, a draft too), or open it again (on=false); default toggles. dir=v is a vertical spine (a column the title is written down, for a tile side by side with others), dir=h a horizontal one (one row with the title, for a tile stacked with others: its height goes to its neighbours); no dir takes the way its split runs. A tab set folds as one; opening a spine gives the tile back its size. Only a tile in a row or a column of others folds (a lane, a reader in a row). On the board the preview and the details fold (a dock shuts instead), and tile=all opens every spine. Refused where its container can't collapse (collapsible off), and to an agent for the tile that has the person's keys",
    keys: "alt+h (alt+H a horizontal spine); the ◂ ▾ on a tile's frame (alt+click: horizontal); ^W c; ⏎ space or a click on a spine opens it; board c on a reader, c ⏎ space on a spine, alt+c (every one)",
    // On the board, tile=all opens every spine (its own word for every one of them).
    places: ["all"],
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `${r.collapsed ? "folded" : "opened"} ${r.tile}`),
    menu: { label: "fold to a spine", group: TILE, key: "ctrl+w c", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.float || n.inDrawer ? { hide: true } : { refused: n.refused("collapse") }; } },
    args: {
      on: { type: "boolean", optional: true, about: "true folds it, false opens it; default toggles" },
      dir: { type: "string", optional: true, about: "v: a vertical spine (tiles side by side), h: a horizontal one (tiles stacked); default the way its split runs. Another way than it's folded refolds it" },
    },
    run({ on, dir }, { d, reader }, actor) {
      if (dir !== undefined && dir !== "v" && dir !== "h") throw new ActionRefused(`tile.collapse: dir is v (a vertical spine) or h (a horizontal one), not ${dir}`);
      return d.collapseTile(reader, on, actor, dir as "v" | "h" | undefined);
    },
  }),
  "tile.expand": def({
    summary: "open tile=<tile> from its spine, back at the size it had (tile.collapse on=false); what was in it is as it was left",
    keys: "alt+h or ⏎ space on a spine; a click on a spine; dragging a tile onto it",
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `opened ${r.tile}`),
    args: {},
    run(_a, { d, reader }, actor) {
      return d.collapseTile(reader, false, actor);
    },
  }),
  "tile.travel": def({
    summary: "back (dir=back, the default) or forward in tile=<tile>'s flow: the person's keys go to the column it was opened from, or the one back last left; it widens only if it's covered, so the text comes back where it was. The person's keys only: an agent opens beside instead (open, link.follow)",
    keys: "river column: alt+← alt+b backspace the mouse's back button, a click on ← back (back); alt+→ alt+f the forward button, a click on forward → (forward)",
    touches: "screen", replay: "safe", person: "back and forward in a flow move the person's keys between columns; an agent opens beside (open, link.follow) instead",
    args: { dir: { type: "string", optional: true, about: "back or forward; default back" } },
    run({ dir }, { d, reader }, actor) {
      if (dir !== undefined && dir !== "back" && dir !== "forward") throw new ActionRefused(`tile.travel: dir is back or forward, not ${dir}`);
      return d.travelTile(reader, dir === "forward" ? 1 : -1, actor);
    },
  }),
  "tile.hold": def({
    summary: "hold tile=<tile>'s column full in its flow so it resists compression (on=false lets it go; default toggles), the river's p. Refused outside a flow and where its flow is locked",
    keys: "river column: p",
    touches: "shape", replay: "safe", says: r => `${r.held ? "held" : "let go of"} ${r.tile}`,
    menu: { label: "hold it full", group: TILE, key: "p", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return !n.flow ? { hide: true } : n.held ? { label: "let it go" } : { refused: n.refused("hold") }; } },
    args: { on: { type: "boolean", optional: true, about: "true holds it, false lets it go; default toggles" } },
    run({ on }, { d, reader }, actor) { return d.holdTile(reader, on, actor); },
  }),
  "tile.drawer": def({
    summary: "your drawer (PIE-498): tile=<tile> goes into your drawer, the tabs above every screen that travel with the person across screens (on=true, the default for a tile on a screen), keeping its program, note and history: the same tile, moved, never started again; or a tile in your drawer comes out into the screen shown (on=false, the default for a tile in the drawer; on=false named from a screen brings the drawer's tab shown), beside to=<tile> (where=left, right, up, down, tabs, edge-<side>; left out, beside the tile the person has). The drawer's own first tab comes out too, as an ordinary terminal tile with its program running, and the drawer starts a new own program when it next comes up. An agent's leaves the person's keys where they are and never moves the tile they type in or have; refused where the layout keeps the tile (locked, a container that keeps its tiles, a lane)",
    keys: "^W a (on a screen: put in your drawer; in the drawer: take out); ^W A on a screen: the drawer's tab shown comes beside your tile; drag a tile's title onto the status bar's drawer chip or the open drawer; a while dragging; drag a drawer tab's title out onto the screen",
    touches: "shape", replay: "safe", confirms: true,
    says: r => (r.changed === false ? null : r.inDrawer ? `put ${r.tile} in your drawer${r.from ? ` from the ${r.from}` : ""}` : `took ${r.tile} out of your drawer into the ${r.into ?? "screen"}${r.fresh ? " · its program runs on there; your drawer starts a new one when it comes up" : ""}`),
    menu: { label: "put in your drawer", group: TILE, key: "ctrl+w a", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.inDrawer ? { label: "take out of your drawer" } : { refused: n.refused("drawer") }; } },
    args: {
      on: { type: "boolean", optional: true, about: "true: into your drawer; false: out of it into the screen shown; left out, whichever it isn't" },
      to: { type: "string", optional: true, about: "on=false: the screen's tile it goes beside (its name); left out, the tile the person has" },
      where: { type: "string", optional: true, about: "on=false: left, right, up, down, tabs, edge-left, edge-right, edge-up, edge-down" },
    },
    run({ on, to, where }, { d, reader }, actor) {
      return d.drawerTile(reader, on, to, where !== undefined ? whereOf(where, "tile.drawer", "right") : undefined, actor);
    },
  }),
  "tile.widen": def({
    summary: "give tile=<tile>'s column the wide place in its flow (the river's shift, PIE-513): the flow is laid out around it, and the column the person was reading stays full beside it. The person's keys stay where they are; moving them between columns never moves a column. Refused outside a flow and where its flow is locked",
    keys: "^W W; a click on a flow column's spine or header; river column: w",
    touches: "shape", replay: "safe", says: r => `widened ${r.tile}`,
    menu: { label: "widen", group: TILE, key: "ctrl+w W", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.flow ? { refused: n.refused("widen") } : { hide: true }; } },
    args: {},
    run(_, { d, reader }, actor) {
      return d.widenTile(reader, actor);
    },
  }),
  "float.place": def({
    summary: "move or size tile=<a float> (a tile popped out over the others, tile.float): dx dy step it (columns, rows), col row put its corner there, cols rows size it. Never smaller than a float is drawn, never off the screen",
    keys: "H J K L on a float, drag its title or its ◢ corner",
    touches: "shape", replay: "safe", says: r => `moved ${r.tile}`,
    args: {
      dx: { type: "number", optional: true, about: "columns to move right (negative: left)" }, dy: { type: "number", optional: true, about: "rows to move down (negative: up)" },
      col: { type: "number", optional: true, about: "its left column" }, row: { type: "number", optional: true, about: "its top row" },
      cols: { type: "number", optional: true, about: "its width" }, rows: { type: "number", optional: true, about: "its height" },
    },
    run(args, { d, reader }, actor) {
      return d.placeFloat(reader, args, actor);
    },
  }),
  "tile.agent": def({
    summary: "what an agent may do to tile=<tile> (PIE-639): policy=free (open notes in it, navigate, split, close, retarget it: the default), edit (edit the note it shows: patch, comment, set properties; no navigating, closing, retargeting or moving it; its own new tiles go elsewhere) or off (read it through peek; no action on it or its note); inherit takes the tile's own away, so its container's and the screen's default (layout.policy node=screen agents=edit) say again; left out, the next level. Saved with the layout, shown as a chip on the tile's frame, reported in peek, layout.get and `ep0ch where`. Enforced for agents only: the person's own keys are never limited. An agent may tighten a tile (free to edit, edit to off), never loosen one: the refusal names the person's command",
    keys: "^W g (cycles free, edit, off); a click on the tile's agents chip, or its ⋯ menu",
    touches: "shape", ownGate: true, replay: "safe", confirms: true,
    says: r => (r.changed === false ? null : `set ${r.tile} to ${AGENT_WORDS[r.agents as AgentLevel]}`),
    menu: { label: "what agents may do here", group: TILE, key: "ctrl+w g", now: ({ d, reader }) => { const a = d.agentNow(reader); return { label: a.level === "free" ? "agents: free · set edit only" : a.level === "edit" ? "agents: edit only · set hands off" : "agents: hands off · set free" }; } },
    args: { policy: { type: "string", optional: true, about: "free, edit, off, or inherit; left out, the next one (free, edit, off, free)" } },
    run({ policy }, { d, reader }, actor) {
      if (policy !== undefined && policy !== "inherit" && !isAgentLevel(policy)) throw new ActionRefused(`tile.agent: policy is free, edit, off or inherit, not ${policy}`);
      return d.agentTile(reader, policy as AgentLevel | "inherit" | undefined, actor);
    },
  }),
  "layout.lock": def({
    summary: "lock the screen (on=true): its shape is fixed (no moves, drops, opens of new tiles, closes, resizes, docks in or out, links or layout loads) and its contents stay live (reading, editing, typing in terminals, docks sliding, tabs shown, zoom); on=false unlocks; default toggles. Saved with the layout",
    keys: "alt+k; a click on the hint row's □ lock / ▣ locked chip",
    touches: "shape", replay: "safe", confirms: true, says: r => (r.changed ? (r.locked ? "locked the screen (alt+k unlocks)" : "unlocked the screen") : null),
    args: { on: { type: "boolean", optional: true, about: "true locks, false unlocks; default toggles" } },
    run({ on }, { d }, actor) {
      return d.lockScreen(on, actor);
    },
  }),
  "layout.policy": def({
    summary: "a container's policy, saved with the layout: node=<id> (s<n> a split, g<n> a tab set, d<n> a dock, from layout.get) or node=screen; left out, the innermost container holding tile=<tile>, else the screen. Sets draggable (its tiles move out), droppable (it takes tiles), accepts=<kind,kind> (only those kinds; any clears), resizable, min/max/fixed=<cells> along its parent's axis (-1 clears), collapsible, overlay and stays (a dock), locked, opensInto=<tile> (where its tiles' opens land when they have no link), opens=current|next (the open rule; a flow's is next), host=over|beside|none (node=screen: where the host layer may appear over it); clear=<field,field> takes fields away. With nothing to set, it reads: each layer's policy over the tile and what applies. On a locked container only locked changes",
    keys: "^W P (⏎ or a click on a row changes it; alt+k locks the screen)",
    touches: "shape", replay: "safe", confirms: true,
    says: (r, a) => { if (!r || !("node" in r) || !("policy" in r) || "layers" in r) return null; const { set, gone } = policyChange(a); return `set ${r.node}'s policy: ${[...Object.entries(set).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`), ...gone.map(k => `${k} cleared`)].join(" ") || "unchanged"}`; },
    args: POLICY_ARGS,
    run(args, { d, reader }, actor) {
      const { set, gone } = policyChange(args);
      if (!Object.keys(set).length && !gone.length && args.node === undefined) return d.policyGet(reader);
      return d.setPolicy(reader, args.node, set, gone, actor);
    },
  }),
  "tile.slide": def({
    summary: "slide the dock holding tile=<tile> open (open=true) or shut (open=false); default toggles. A shut dock is a handle at the end of the hint row; a tile dragged onto the handle goes into the dock. Refused when its policy says it isn't collapsible",
    keys: "^W d; a click on its handle (⇤ ⇥ ⤒ ⤓ on the hint row); a dock slides shut when the keys go elsewhere",
    touches: "shape", replay: "safe", says: r => `${r.open ? "opened" : "shut"} dock ${r.tile}`,
    args: { open: { type: "boolean", optional: true, about: "true opens it, false shuts it" }, container: { type: "string", optional: true, about: "the dock's id (d<n>), when it isn't the innermost one holding tile=" } },
    run({ open, container }, { d, reader }, actor) {
      return d.slideTile(reader, open, actor, container);
    },
  }),
  "tile.preview": def({
    summary: "a reader beside tile=<tile> where its opens land (opened and linked as one step): a link followed in it, the tree's ⏎, a list's pick show there, and the tile itself never navigates away. A tile that reads notes gets a detail; a terminal tile a preview of the file it edits (re-read on each save); the board one of its card (its own preview strip collapses); anything else a preview following its selection. Its opens already land in a tile (a link, or its container's opensInto naming one): that one is shown instead, where= aside (the person's keys go to it, an agent's leave them). Refused on a flow's column, whose opens already open the next column. where=right, down, left or up; default beside it if it's wide, else below. tile.link unlinks",
    keys: "O in a reader; ^W v beside, ^W V below",
    // Said to the person too (confirms): ^W v on a tile already linked shows the one there, which looked like nothing happening.
    touches: "shape", replay: "safe", confirms: true,
    says: r => (r.existing ? `${r.from} already opens into ${r.tile}: showed it · alt+l then click ${r.tile} to unlink` : `opened ${tileNoun(String(r.kind), r.tile)} where ${r.from}'s opens land`),
    // Beside it and below it: where its opens land (a flow's column opens the next column instead).
    menu: [
      { label: "preview beside", group: TILE, key: "ctrl+w v", args: { where: "right" }, now: ({ d, reader }, _t, actor) => (d.tileNow(reader, actor).flow || d.tileNow(reader, actor).inDrawer ? { hide: true } : null) },
      { label: "preview below", group: TILE, key: "ctrl+w V", args: { where: "down" }, now: ({ d, reader }, _t, actor) => (d.tileNow(reader, actor).flow || d.tileNow(reader, actor).inDrawer ? { hide: true } : null) },
    ],
    args: { where: { type: "string", optional: true, about: "right, down, left or up; default right if the tile is wide, else down" } },
    async run({ where }, { d, reader }, actor) {
      if (where !== undefined && !isDir(where)) throw new ActionRefused(`tile.preview: where is right, down, left or up, not ${where}`);
      return await d.previewTile(reader, where as Dir | undefined, actor);
    },
  }),
  "tile.menu": def({
    summary: "tile=<tile>'s menu (PIE-492): every action its sets offer there (the tile operations, its kind's, a reader's note actions, a board's lane actions), each with its arguments, label, group, key and, when it would be refused now, why. An agent's answers the rows (rows=) and draws nothing; the person's opens the menu over the screen, under the tile's ⋯ or at at=<col,row>, where one click, ⏎ or a row's own key runs it as theirs",
    keys: "^W .; a click on a tile's ⋯; a right-click in a tile (not where its program asked for the mouse, or on a step's box)",
    touches: "nothing", replay: "safe",
    args: { at: { type: "string", optional: true, about: "col,row: the screen cell (from 0) the person's menu opens at; default under the tile's ⋯" } },
    run({ at }, { d, reader }, actor) { return d.tileMenu(reader, at, actor); },
  }),
  "tile.info": def({
    summary: "one tile as data: its kind, name, rect, link, dock state; a terminal's command, file, process and screen text; a reader's note",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d, reader }) { return d.tileInfo(reader); },
  }),
  "layout.resize": def({
    summary: "move a border: in split split=<id> (layout.get gives each split's id, s<n>; it stays with the split when tiles move around it), or the split at path=<p> (\"\" the root, \"1.0\" its second kid's first kid: where it is now, so pass expected=<rev> too), the border after kid border=<i> is placed so kid i and kid i+1 share their room share=<0-1> to (1-share). The answer names the split, its path and its tiles",
    keys: "drag a border",
    touches: "shape", replay: "safe",
    args: {
      split: { type: "string", optional: true, about: "the split's id from layout.get (s<n>)" },
      path: { type: "string", optional: true, about: "or: the split's path from layout.get (check it with expected=<rev>)" },
      border: { type: "number", about: "the border after this kid (0 first)" },
      share: { type: "number", about: "kid border's part of the pair, 0.08-0.92" },
    },
    run({ split, path, border, share }, { d }, actor) { return d.resizeBorder({ split, path }, border, share, actor); },
  }),
  "layout.even": def({
    summary: "every split shares its room equally", keys: "^W =",
    touches: "shape", replay: "safe", says: () => "evened out the layout",
    args: {},
    run(_, { d }, actor) { return d.evenOut(actor); },
  }),
  "layout.swap": def({
    summary: "tile=<tile> and tile to=<tile> trade places", keys: "^W s (the next tile)",
    touches: "shape", replay: "safe", says: (r, a) => `swapped ${r.tile} and ${a.to}`,
    args: { to: { type: "string", tile: true, about: "the tile it trades places with" } },
    run({ to }, { d, reader }, actor) { return d.swapTile(reader, to, actor); },
  }),
  "view.get": def({
    summary: "what each tile has in view: a reader's note and its lines in view (first, last) with the scroll; the outline's selected row; a terminal's screen, and for nvim its cursor, lines in view and file; tile=<tile> for one",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d, reader }) { return d.viewGet(reader); },
  }),
  "view.scrollTo": def({
    summary: "scroll tile=<tile> so a note line (line=<n>, 1 the subject) or the first line with text=<words> is at the top. It moves what's in view, not the person's [ ] position, selection or keys. block=<id> checks the tile shows that note (open it there first: open id=… tile=…)",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't scroll the reader they type in", says: r => `scrolled ${r.tile}`,
    args: { line: { type: "number", optional: true, about: "the note line to bring to the top" }, text: { type: "string", optional: true, about: "or: the first line with these words" }, block: { type: "string", optional: true, about: "the note the tile must be showing" } },
    run(at, { d, reader }, actor) { return d.scrollTo(reader, at, actor); },
  }),
  "block.mark": def({
    summary: "an attention mark, with the reason and who set it: on block id=<id> (default: the note tile=<tile> shows), framed and labelled in every tile that shows it; or on line=<n> of an nvim tile (tile=<tile>), as an extmark with virtual text. It stays until dismissed and never moves the person's focus, selection or cursor",
    keys: "alt+m steps through marks; a click on a tile's ◆ label dismisses it",
    touches: "nothing", replay: "safe", says: (_, a) => `marked: ${a.reason}`,
    args: { id: { type: "string", optional: true, about: "the block (note) id" }, line: { type: "number", optional: true, about: "an nvim tile's line (1-based)" }, reason: { type: "string", about: "what it's about, in a few words (\"needs your call\")" } },
    async run(m, { d, reader }, actor) { return await d.markBlock(reader, m, actor); },
  }),
  "block.unmark": def({
    summary: "dismiss mark n=<n> (marks.list numbers them), or every mark on block id=<id>, or (neither) the marks on what tile=<tile> shows",
    keys: "a click on a tile's ◆ label; alt+x dismisses the focused tile's",
    touches: "nothing", replay: "safe", says: () => "dismissed a mark",
    args: { n: { type: "number", optional: true, about: "the mark's number" }, id: { type: "string", optional: true, about: "a block id" } },
    async run({ n, id }, { d, reader }, actor) { return await d.unmark(n, id, actor); },
  }),
  "marks.list": def({
    summary: "every attention mark: its number, block or tile and line, reason, who set it, when, and the tiles showing it",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d }) { return d.marks(); },
  }),
  "marks.next": def({
    summary: "step to the next mark: the keys go to a tile showing it, or it opens where the focused tile's opens go. Refused to an agent while the person is typing",
    keys: "alt+m",
    touches: "screen", replay: "safe",
    args: {},
    run(_, { d }, actor) { return d.nextMark(actor); },
  }),
  "tab.select": def({
    summary: "show tab tile=<tile> in its tab set, or step by=1 (next) / by=-1 (previous) from it. An agent's leaves the person's focus where it is",
    keys: "click a tab; alt+n alt+p; ^W ] ^W [",
    touches: "shape", replay: "safe", says: r => `showed tab ${r.tile}`,
    args: { by: { type: "number", optional: true, about: "1 next, -1 previous; left out, that tab is shown" } },
    run({ by }, { d, reader }, actor) {
      if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused("tab.select: by is 1 or -1");
      return d.selectTab(reader, by, actor);
    },
  }),
  // Last, so a tile's menu lists its Tile rows first and the Screen group after them.
  "screen.save": def({
    summary: "save this screen, as it's laid out now, as a screen note named name= in the outline (PIE-565: `[type::screen]`, its spec as data, as screen.spec answers it): every door on the outline then opens it (`ep0ch --screen <name>`, screen.open, ^W r) and an agent can read it. Saving under its own name again writes the same note, checked against the revision this door read (changed since: refused, read again). A built-in screen's name is refused. The person's with no name opens the prompt",
    keys: "^W w",
    touches: "nothing", replay: "ask", confirms: true,
    says: r => (r?.prompt ? null : `saved the screen as ${r.screen}${r.created ? " (a new screen note)" : ""} · ep0ch --screen ${r.screen} opens it`),
    menu: { label: "save this screen as…", group: SCREEN, key: "ctrl+w w" },
    args: { name: { type: "string", optional: true, about: "the screen's name: a letter, then letters, digits, . - _ (left out: the person types it)" } },
    async run({ name }, { d }, actor) { return await d.saveScreen(name, actor); },
  }),
  "screen.delete": def({
    summary: "delete the screen named name= that a person made: its screen note goes to the outline's Trash (restorable there), and it's gone from every door's screens. A built-in can't be. The person's asks first: again within 3s deletes. Trashing the note anywhere (the outliner, an agent) does the same",
    keys: "x twice on a screen you made, in the screens picker (the blank tile's o)",
    touches: "nothing", replay: "ask", confirms: true,
    says: r => (r?.armed ? null : `deleted the screen ${r.screen} (its note is in the Trash)`),
    // No keycap: its x is the screens picker's, not this tile's.
    menu: { label: "delete this screen (its note to the Trash)", group: SCREEN, key: "", now: ({ d }) => (d.madeName() ? { args: { name: d.madeName()! } } : { hide: true }) },
    args: { name: { type: "string", about: "the screen's name (screen.list's made screens)" } },
    async run({ name }, { d }, actor) { return await d.deleteScreen(name, actor); },
  }),
  "layout.load": loadLayout,
});
