import { canonSpec } from "./tiles";
import { COPY_GROUP } from "../note-ref";
import { HYPER_KEYS } from "../hyper";
import { W_KEYS, wCaption, ZOOM_WHEEL } from "./wkeys";
import { FRAME_GLYPHS } from "./frame-controls";
import { GATHER_HINT } from "../surface/hint-card";
import { SPINES, ALT_RULES, OPEN_RULES, type AltRule } from "./layout";
// Tiles and layouts as actions (PIE-413, PIE-473, PIE-474): every change to the layout is one of these
// commands. The desk's keys, its mouse drags and clicks, and the control socket (`ep0ch act`) are only
// callers: a header dropped on a tile's centre runs `layout.move where=tabs`, `^W m l` runs
// `layout.move where=right`, alt+l then a click runs `tile.link`. An agent's is said on screen, and never
// takes the person's focus or keys: a tile it opens or moves leaves their focus where it is, and what the
// person is typing in (an edit, a terminal) is never closed, moved into, or typed into by an agent.
import { TXN } from "../surface/txn";
import { USER, type Actor } from "../socket";
import { ActionRefused, actionSet, asActor, def, lineWords, type ArgsOf } from "../surface/actions";
import { AGENT_WORDS, isAgentLevel, type AgentLevel } from "../surface/agent-level";
import { EDGE_WORD, isDir, OPEN_READS, WIRE_VERBS, type Axis, type Dir, type WireVerb, type Policy } from "./screen-layout";
import type { Desk } from "./desk";
import type { TileHeader } from "../surface/note";
import { lastTrashed, trashConfirm, trashNote, trashPlan, untrashNote } from "../note-trash";
import { subject } from "../board";
import { renamedPagesNote } from "@ep0ch/outline-core/protocol";
import { READER_MODES, tileKind, tileNoun, type TileKindName } from "./tile-kinds";

export type Where = Dir | "tabs" | "next" | "edge-left" | "edge-right" | "edge-up" | "edge-down";
export const WHERE: readonly Where[] = ["left", "right", "up", "down", "tabs", "next", "edge-left", "edge-right", "edge-up", "edge-down"];
export const whereOf = (s: string | undefined, _action: string, dflt: Where): Where => (s ?? dflt) as Where;

const PLACE: Record<string, string> = { left: "left of", right: "right of", up: "above", down: "below", tabs: "into the tabs of" };

/** A tile as its menu reads it (`Desk.tileNow`): where it is now, and why a tile operation would be refused there. */
export interface TileNow {
  altReader: boolean; float: boolean; zoomed: boolean; collapsed: boolean; dock: boolean; inDrawer: boolean; flow: boolean; held: boolean;
  /** A list held off its home (PIE-855): true or false where its kind can hold it, else null. */
  listHeld: boolean | null;
  /** A close in its container shuts its dock instead (the board's outline). */
  shuts: boolean;
  /** The program running in it (a terminal tile), whose close ends it. */
  running: string | null;
  /** The note it shows (a reader, not a list), and whether it is being edited there; null when it shows none. */
  note: { id: string; editing: boolean } | null;
  refused(op: "close" | "float" | "zoom" | "collapse" | "pin" | "drawer" | "widen" | "hold"): string | null;
}
/** The tile menu's group for the tile operations. */
const TILE = "Tile";

/** What a tile operation did, as the socket answers it. */
export interface TileDone { tile: string; [k: string]: unknown }

/** A new tile: its kind and what it needs (the fields of a saved tile). */
export interface NewTile { kind: TileKindName; name?: string; cmd?: string; file?: string; source?: string; note?: string; outline?: string; machine?: string; page?: string; mode?: "pinned" | "held"; cwd?: string; view?: string; query?: string; screen?: string; part?: string; target?: string; inner?: unknown; args?: Record<string, unknown>; label?: string; /** A kind's own state to start with (the keys window's filter), opened in code. */ state?: Record<string, unknown> }

/**
 * What a tile action runs on: the desk, and the tile `tile=` named (by its name: the dispatcher read the grammar).
 * An agent's change is said on screen with who made it (each def's `says`); the person's own isn't (they see it
 * happen), unless it `confirms`: something the screen doesn't show (a layout saved, where a drag put a tile).
 */
interface On { d: Desk; reader?: string; standing?: boolean }

/** The tile menu's group for saving and loading the screen. */
const SCREEN = "Screen";

const loadLayout = {
  words: "lay this screen out as a saved screen",
  summary: "lay this screen out as the screen named name= (one a person made: a screen note) or a built-in layout (daily, river, board, desk). Tiles with the same name and kind are kept as they are (a running program, a reader's note); a running program or an unsaved edit the new layout has no place for is kept as a shut dock (said: kept=), never ended. The person's with no name opens the picker. Refused to an agent while the person is typing",
  keys: [{ keys: "alt+d", does: "daily", says: "lay this screen out as the daily layout" }, { keys: "^W r", does: "picks one", says: "pick a saved screen to lay this one out as" }],
  touches: "screen", replay: "safe", confirms: true,
  says: (r: { layout?: string; kept?: string[]; picker?: boolean }, a: { name?: string }) => (r?.picker ? null : `laid out ${a.name}${r?.kept?.length ? ` · kept ${r.kept.join(", ")} in a shut dock (⇥ on the hint row)` : ""}`),
  menu: { label: "lay it out as a screen…", group: SCREEN, key: "ctrl+w r", now: ({ d }: On) => (d.spec.layouts ? null : { hide: true }) },
  args: { name: { type: "string", kind: "layout", optional: true, about: "the layout's or screen's name (left out: the person picks)" } },
  examples: [
    { act: "layout.load name=daily", does: "lays the screen out as the built-in daily layout" },
    { act: "layout.load name=garden-planning", does: "lays the screen out as the screen note garden-planning" },
  ],
  run({ name }: { name?: string }, { d }: On, actor: Actor) { return d.loadLayout(name, actor); },
} as const;

/** What `layout.policy`'s arguments set and clear (the run applies it; `says` puts it in words). */
function policyChange({ clear, accepts, opensInto, opens, altOpens, host, agents, min, max, fixed, readable, spines, "min-width": minWidth, node: _node, ...flags }: PolicyArgs): { set: Policy; gone: string[] } {
  const set: Policy = {}, gone = (clear ?? "").split(",").map(x => x.trim()).filter(Boolean);
  for (const [k, v] of Object.entries(flags)) if (typeof v === "boolean") (set as Record<string, unknown>)[k] = v;
  for (const [k, v] of Object.entries({ min, max, fixed, readable, "min-width": minWidth })) if (v !== undefined) { if (v < 0) gone.push(k); else (set as Record<string, unknown>)[k] = Math.round(v); }
  if (accepts !== undefined) { const kinds = accepts.split(",").map(x => x.trim()).filter(Boolean); if (!kinds.length || (kinds.length === 1 && kinds[0] === "any")) gone.push("accepts"); else set.accepts = kinds; }
  if (opensInto !== undefined) { if (opensInto) set.opensInto = opensInto; else gone.push("opensInto"); }
  if (spines !== undefined) set.spines = spines as Policy["spines"];
  if (opens !== undefined) set.opens = opens as Policy["opens"];
  if (altOpens !== undefined) set.altOpens = altOpens as AltRule;
  if (host !== undefined) set.host = host as Policy["host"];
  if (agents !== undefined) { if (agents === "free") gone.push("agents"); else set.agents = agents as AgentLevel; }
  return { set, gone };
}
/** What `layout.policy` sets: the schema `act` checks, and so its arguments' type. */
const POLICY_ARGS = {
  spines: { type: "string", optional: true, choices: SPINES, about: "book slides pages to their own side, start gathers left, end right, centre balances both sides, invoker keeps them toward the invoking tile; on a desk row (not a flow) a book spine kept by an open sits beside its reader (PIE-1457)" },
  "min-width": { type: "number", optional: true, about: "minimum open page width (default 40); opening a spine shares evenly and folds the least recently touched open page below this; 0 keeps all open, -1 clears" },
  node: { type: "string", optional: true, about: "the container's id, or screen" },
  draggable: { type: "boolean", optional: true, about: "its tiles can be dragged out" },
  droppable: { type: "boolean", optional: true, about: "it takes tiles moved or opened into it" },
  closable: { type: "boolean", optional: true, about: "its tiles close (tile.close); false: they stay" },
  accepts: { type: "string", optional: true, about: "the tile kinds it takes, comma-separated; any clears" },
  resizable: { type: "boolean", optional: true, about: "its borders move" },
  min: { type: "number", optional: true, about: "its least size in cells (-1 clears)" },
  max: { type: "number", optional: true, about: "its most size in cells (-1 clears)" },
  fixed: { type: "number", optional: true, about: "its size in cells, kept (-1 clears)" },
  readable: { type: "number", optional: true, about: "growth by room (PIE-794): the width in cells a reader opened beside others still gets; past it the earliest ones in its row (never the first) fold to spines; a flow's full column width. 0 never folds, -1 clears (the default, 48)" },
  collapsible: { type: "boolean", optional: true, about: "a dock can slide shut" },
  overlay: { type: "boolean", optional: true, about: "a dock slides over (true) or takes its room while open (false)" },
  stays: { type: "boolean", optional: true, about: "an open dock stays open when the keys leave it" },
  locked: { type: "boolean", optional: true, about: "its shape is fixed, its contents live" },
  altOpens: { type: "string", optional: true, choices: ALT_RULES, about: "alt-open rule (default beside); alt readers keep what fits and older ones fold" },
  opensInto: { type: "string", optional: true, kind: "tile", choices: [""], about: "the tile its tiles' opens land in (empty clears)" },
  opens: { type: "string", optional: true, choices: OPEN_RULES, about: "the open rule: reader (the first reader that isn't pinned, the default), next (a new column after the tile's own, in a flow), beside (a reader beside the tile), float (a follower over it), or full (zoom the opened reader)" },
  agents: { type: "string", optional: true, choices: ["free", "edit", "off"], about: "what an agent may do to the tiles under it (free, edit, off; PIE-639): node=screen is the screen's default, a tile's own wins (tile.agent); free clears" },
  host: { type: "string", optional: true, choices: ["over", "beside", "none"], about: "node=screen: where the host layer (the agent, terminals) may appear over this screen: over, beside or none" },
  clear: { type: "string", optional: true, about: "fields to take away, comma-separated" },
} as const;
type PolicyArgs = ArgsOf<typeof POLICY_ARGS>;

/** The person's `note.trash` waiting for the service's answer (what would go), per desk, and whether a second d came meanwhile. */
const asking = new WeakMap<Desk, { id: string; again: boolean }>();

export const TILE_ACTIONS = actionSet<On>()("tile", {
  "layout.get": def({
    answer: { tiles: { type: "array", about: "tiles on the screen, in groups and in the drawer" }, layers: { type: "array", about: "each desk's tree and tiles" }, brief: { type: "string", about: "said when tiles are described in brief (no full=true)" }, tree: { type: "object", about: "the screen layout tree" } },
    summary: "the layout as data: its revision (rev), the tile tree (each split with its id, path and shares, each tab set with its id and the tab shown) and each tile's id, kind, name, path, source, note, link, wires, dock state and rect, as its kind describes itself in brief; full=true adds each tile's whole description (a tree's rows, a facets tile's lists, a group's own layout)",
    touches: "nothing", replay: "safe",
    args: { full: { type: "boolean", optional: true, about: "each tile's whole description too (a tree's rows, a facets tile's lists): large on a busy desk" } },
    examples: [
      { act: "layout.get", does: "the tiles, their names, kinds, rects and wires, each in brief" },
      { act: "layout.get full=true", does: "the same with each tile's whole description: a tree's rows, a facets tile's lists" },
    ],
    run({ full }, { d }) { return d.layoutAll(!!full); },
  }),
  "layout.list": def({
    summary: "the layouts this screen can be laid out as: the built-ins and the screens people made (screen notes)",
    keys: "^W r",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d }) { return d.layouts(); },
  }),
  "layout.move": def({
    words: "move this tile beside another, into its tabs or to an edge",
    answer: { tile: { type: "string", kind: "tile", about: "the moved tile's stable id" }, name: { type: "string", about: "its displayed name" }, where: { type: "string", about: "its new placement" } },
    summary: "move tile=<tile> beside tile to=<tile> (where=left, right, up, down), into its tabs (where=tabs, at index=<n>), or along an outer edge of the whole layout (where=edge-left, edge-right, edge-down, edge-up: a full-height column or full-width row). A docked tile moved this way is undocked. into=<group> moves it into a group whole (PIE-696: a running program, its agent policy, spine and links go with it), beside=<one of the group's tiles> where=right/left/up/down/tabs of it (default the group's focused tile, right); out=true on a tile of a group (tile=<group>/<tile>) moves it back out onto the screen holding the group, beside=<a tile there> (default the group). The person's focus stays where it is",
    keys: [{ keys: "drag", does: "a header (onto a group to move into it, out of a group's frame to move out)" }, { keys: "^W m then h j k l", does: "beside", says: "move this tile beside the one in that direction" }, { keys: "^W t then h j k l", does: "into tabs", says: "move this tile into the tabs of the one in that direction" }, { keys: "^W H J K L", does: "to an edge" }, { keys: "^W T", does: "takes a tab out" }, { keys: "^W i", does: "into a group, or out of the one it's in" }],
    touches: "shape", replay: "safe", confirms: true,
    says: (r, a) => {
      if (r.into) return `moved ${r.name ?? r.tile} into ${r.into}`;
      if (r.out) return `moved ${r.name ?? r.tile} out of ${r.from ?? "its group"}`;
      const w = whereOf(a.where, "layout.move", "right");
      return `moved ${r.name ?? r.tile} ${w.startsWith("edge-") ? `to the ${w.slice(5)} edge` : `${PLACE[w]} ${r.to}`}`;
    },
    args: {
      to: { type: "string", optional: true, kind: "tile", about: "the tile it goes beside or into (not needed for an edge)" },
      where: { type: "string", optional: true, choices: WHERE, about: "left, right, up, down, tabs, or edge-left/right/up/down (default right)" },
      index: { type: "number", optional: true, implies: [{ where: "tabs" }], conflicts: ["into", "out"], about: "with where=tabs: the place among the tabs (0 first)" },
      into: { type: "string", optional: true, kind: "tile", conflicts: ["out", "to"], about: "a group tile on this screen: the tile goes into it whole" },
      out: { type: "boolean", optional: true, conflicts: ["to"], about: "on a tile of a group: it goes out onto the screen holding the group" },
      beside: { type: "string", optional: true, kind: "tile", implies: [{ into: null }, { out: true }], about: "with into=: the group's tile it goes beside or into; with out=true: the tile outside it goes beside (default the group)" },
    },
    examples: [
      { act: "layout.move tile=activity to=reader where=tabs", does: "puts the activity tile in the reader's tabs, as a tab beside it" },
      { act: "layout.move tile=tree where=edge-down", does: "lays the tree along the bottom of the screen, the whole width" },
    ],
    run({ to, where, index, into, out, beside }, { d, reader }, actor) {
      if (into !== undefined) return d.moveIntoGroup(reader, into, beside, whereOf(where, "layout.move", "right"), actor);
      if (out) return d.moveOutOfGroup(reader, beside, whereOf(where, "layout.move", "right"), actor);
      return d.moveTile(reader, to, whereOf(where, "layout.move", "right"), index, actor);
    },
  }),
  "tile.open": def({
    words: "open a new tile beside this one, or as a tab",
    answer: { tile: { type: "string", kind: "tile", about: "the new tile's stable id; pass it back as tile=" }, name: { type: "string", about: "its displayed name" }, kind: { type: "string", about: "the tile kind" }, where: { type: "string", about: "where it landed: the where= asked, or float" }, why: { type: "string", about: "only when an agent's tile is too narrow to read beside to=: it floated (no tile= nor where= named) or went where asked, and this says so" } },
    summary: `open a new tile beside tile=<tile> (where=left, right, up, down) or as a tab in it (where=tabs): kind=screen (screen=<name> target=<its hub or note> part=<a container>: a screen mounted here, PIE-651), tree, reader (note=<id> it shows and keeps; mode=pinned pins it on that note, or page=<name> on [[name]], so opens land beside it; kind=detail is a reader), preview (source=tile:<name> or file:<path>), pty (cmd="nvim draft.md", file=<path it edits>), query (view=<a saved view's block id>: its cards, as a board lane; or query=<a query, #tag> source=tile:<its home reader>), board, river, brief, thread, activity, who, art. name= already there delivers note= to that tile when its kind matches; a different kind names the call to use. The person's focus stays where it is, in yolo too. An agent's tile that would be narrower than ${OPEN_READS.cols} columns (or shorter than ${OPEN_READS.rows} rows) floats when the call names neither a tile nor where=, and goes where asked when it names one; the answer's why says so either way`,
    keys: [{ keys: "^W o", does: "then the key of the kind to open" }, { keys: "^W O", does: "then the key of the kind to open as a tab" }, { keys: "⏎ double-click", does: "on a view in ^W o q's picker" }],
    touches: "shape", landing: true, replay: "ask", says: (r, a) => `opened ${tileNoun(a.kind, r.name)} in ${r.n} · ${r.name ?? r.tile}${r.why ? ` · ${r.why}` : ""}`,
    args: {
      kind: { type: "string", kind: "tile-kind", about: "what the tile shows" },
      name: { type: "string", optional: true, about: "its name (default: its kind, numbered)" },
      cmd: { type: "string", optional: true, about: "pty: the command line (default $SHELL)" },
      file: { type: "string", optional: true, about: "pty: the file it edits; preview: the file it shows" },
      source: { type: "string", optional: true, about: "preview: tile:<name> or file:<path>" },
      mode: { type: "string", optional: true, choices: READER_MODES, about: "reader: pinned (on note=, or on page=): every open aimed at it lands beside it, and it comes back pinned after a restart; left out (or held, which every reader is now), opens land in it" },
      outline: { type: "string", optional: true, kind: "outline", about: "the outline the reader reads and saves in (default: this door)" },
      machine: { type: "string", optional: true, implies: [{ outline: null }], about: "the outline host machine (default: this door's host)" },
      note: { type: "string", optional: true, kind: "note", about: "reader: the note it starts on and keeps" },
      id: { type: "string", optional: true, kind: "note", conflicts: ["note"], about: "reader: the same as note=" },
      page: { type: "string", optional: true, kind: "page", about: "reader, pinned: the page it's pinned to, as in [[name]]" },
      cwd: { type: "string", optional: true, about: "pty: the folder it runs in" },
      view: { type: "string", optional: true, kind: "view", about: "query: the saved view (virtual branch) whose cards it lists" },
      query: { type: "string", optional: true, about: "query: a query in the views' grammar it lists instead (#garden, PIE-800); source=tile:<a reader> makes that reader its home" },
      screen: { type: "string", optional: true, kind: "screen", about: "screen (a mount, PIE-651): the screen it mounts (board, river, brief, a screen you made…)" },
      part: { type: "string", optional: true, about: "screen: a container's key of it to mount alone (the board's lanes)" },
      target: { type: "string", optional: true, about: "screen: what it opens on, where it takes one (the board's hub, detail's note)" },
      label: { type: "string", optional: true, about: "screen: what its title (and its spine) says" },
      to: { type: "string", optional: true, kind: "tile", about: "the tile it opens beside (default the focused one; tile= also names it)" },
      where: { type: "string", optional: true, choices: WHERE, about: "left, right, up, down or tabs (default right); next: the column after its own in a flow" },
    },
    examples: [
      { act: "tile.open kind=reader note=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 tile=tree where=right", does: "opens a reader beside the tree on the seed-swap note" },
      { act: "tile.open kind=pty cmd=\"nvim garden.md\" file=garden.md where=down", does: "opens a terminal below running nvim on garden.md" },
    ],
    async run({ kind, to, where, mode, id, ...t }, { d, reader }, actor) {
      if (id !== undefined && t.note === undefined) t.note = id;
      const opening = canonSpec({ kind: kind as TileKindName, ...(mode !== undefined ? { mode: mode as "pinned" | "held" } : {}), ...t });
      const wrong = tileKind(opening.kind)?.check?.({ ...opening, cmd: opening.cmd === undefined ? undefined : lineWords(opening.cmd) }, opening);
      if (wrong) throw new ActionRefused(`tile.open: ${wrong}`);
      return await d.openTile(opening, to ?? reader, whereOf(where, "tile.open", "right"), actor, { unnamed: to === undefined && reader === undefined && where === undefined });
    },
  }),
  "tile.close": def({
    words: "close this tile",
    summary: "close tile=<tile>: a program in it is ended. On the board a detail or a float closes, a dock's tile shuts its dock, and the lanes and the preview stay (closable off); the river's library stays (closable off). Refused while it holds an edit or a comment, and to an agent for the tile that has the person's keys",
    keys: [{ keys: "^W x", does: "close" }, { keys: "click", does: "on the × in its top right corner" }, { keys: "x", does: "on the board" }, { keys: "esc q", does: "on a dock" }],
    touches: "shape", replay: "ask", says: r => `closed ${r.name ?? r.tile}`,
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
    words: "grow or shrink this tile",
    summary: "grow (by>0) or shrink (by<0) tile=<tile> by steps along axis=row (width, default) or col (height), as its keys do; on the board tile=lanes is the lanes' row. layout.resize places a border exactly",
    keys: [{ keys: "^W < > + -", does: "resize", says: "make this tile narrower, wider, shorter or taller" }, { keys: "< >", does: "on the board" }, { keys: "drag", does: "a border" }],
    touches: "shape", replay: "safe", says: (r, a) => `${a.by > 0 ? "grew" : "shrank"} ${r.name ?? r.tile}`,
    args: { by: { type: "number", about: "steps: +1 grows it by one key press, -2 shrinks it by two" }, axis: { type: "string", optional: true, choices: ["row", "col"], about: "row (width, default) or col (height)" } },
    examples: [
      { act: "tile.resize by=2 tile=reader", does: "makes the reader wider by two key presses' worth" },
      { act: "tile.resize by=-3 axis=col tile=activity", does: "makes the activity tile shorter by three steps" },
    ],
    run({ by, axis }, { d, reader }, actor) {
      if (!Number.isInteger(by) || by === 0 || Math.abs(by) > 20) throw new ActionRefused("tile.resize: by is a whole number of steps, -20 to 20, not 0");
      return d.resizeTile(reader, (axis ?? "row") as Axis, by, actor);
    },
  }),
  "tile.zoom": def({
    words: "zoom a tile to fill the screen, or lift it above the drawer",
    summary: "zoom a tile to fill the screen, or lift it above the drawer with reach=column|full (a spine opens first); on=false drops it. An agent may lift another tile, never replace the person's lift",
    keys: [...W_KEYS.filter(k => k.action === "tile.zoom").map(k => wCaption(k.key)), ...HYPER_KEYS.filter(k => k.action === "tile.zoom").map(k => `✦${k.key}`), ZOOM_WHEEL.key].join(", "),
    touches: "shape", touchesWith: a => a.reach && a.reach !== "screen" ? "tile" : "shape", replay: "safe", says: (r, a) => `${r.zoomed ? a.reach && a.reach !== "screen" ? `lifted (${a.reach})` : "zoomed" : "dropped"} ${r.name ?? r.tile}`,
    menu: { label: "zoom", group: TILE, key: "ctrl+w z", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.zoomed ? { label: "unzoom" } : { refused: n.refused("zoom") }; } },
    args: { on: { type: "boolean", optional: true, about: "true zooms, false unzooms; default toggles" }, reach: { type: "string", optional: true, choices: ["screen", "column", "full"], about: "screen (default), column (lift this column above the drawer), or full (lift across the terminal)" } },
    examples: [
      { act: "tile.zoom tile=reader", does: "fills the screen with the reader, or unzooms it if it is zoomed" },
      { act: "tile.zoom on=false tile=reader", does: "returns a zoomed reader to its place in the layout" },
    ],
    run({ on, reach }, { d, reader }, actor) {
      if (reach !== undefined && reach !== "screen" && reach !== "column" && reach !== "full") throw new ActionRefused("reach is screen, column or full");
      return d.zoomTile(reader, on, actor, reach);
    },
  }),
  "tile.float": def({
    words: "pop this tile out as a float over everything, or put it back",
    summary: "pop tile=<tile> out of the layout as a float over everything (its own rectangle; the board floats a copy of its preview), or put a float back in the layout (on the board, as a detail). to=glass keeps it above every screen. where=right lands beside its opener. Refused where policy keeps the tile in place, and to an agent for the tile that has the person's keys",
    keys: [{ keys: "⤢", does: "land a peek beside its gallery" }, { keys: "^W f", does: "float" }, { keys: "^W U", does: "keep on the glass" }, { keys: "o", does: "on the board" }, { via: "the frame card's float or put back row" }, { keys: "f", does: "while dragging a tile" }],
    touches: "shape", replay: "safe", says: r => `${r.floated ? "popped out" : "put back"} ${r.name ?? r.tile}`,
    menu: [{ label: "keep on the glass", group: TILE, key: "ctrl+w U", args: { to: "glass" } }, { label: "float", group: TILE, key: "ctrl+w f", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.float ? { label: "put back in the layout" } : { refused: n.refused("float") }; } }],
    args: { to: { type: "string", optional: true, choices: ["glass"], about: "glass: keep this tile above every screen" }, where: { type: "string", optional: true, choices: ["right"], about: "right: land beside the tile that opened this float" }, on: { type: "boolean", optional: true, about: "true floats it, false puts it back; with it left out the action toggles. A tile already in that state is left as it is (a script floating every tile can't land one that floats)" } },
    examples: [
      { act: "tile.float on=true tile=activity", does: "pops the activity tile out as a float over the other tiles" },
      { act: "tile.float on=false tile=activity", does: "puts a floating activity tile back in the layout" },
    ],
    run({ on, where, to }, { d, reader }, actor) {
      return d.floatTile(reader, actor, on, where as "right" | undefined, to as "glass" | undefined);
    },
  }),
  "tile.link": def({
    words: "set a wire from this tile to another",
    menu: [
      { label: "select wire", group: TILE, key: "alt+l s", args: { ask: true, verb: "select" }, now: ({ d, reader }) => ({ label: `${FRAME_GLYPHS.select} where a select lands: ${d.wireDescription(reader, "select")}` }) },
      { label: "open wire", group: TILE, key: "alt+l o", args: { ask: true, verb: "open" }, now: ({ d, reader }) => ({ label: `${FRAME_GLYPHS.open} where an open lands: ${d.wireDescription(reader, "open")}` }) },
      { label: "hover wire", group: TILE, key: "alt+l v", args: { ask: true, verb: "hover" }, now: ({ d, reader }) => ({ label: `${FRAME_GLYPHS.hover} where a hover lands: ${d.wireDescription(reader, "hover")}` }) },
      { label: "alt wire", group: TILE, key: "alt+l a", args: { ask: true, verb: "alt" }, now: ({ d, reader }) => ({ label: `${FRAME_GLYPHS.alt} where an alt-open lands: ${d.wireDescription(reader, "alt")}` }) },
    ],
    hintId: "link",
    hint: (a, { d }) => a.ask ? d.linkingHint() : null,
    summary: "Set a wire from tile=<tile>: verb=select shows selections in to=<tile>, verb=open (default) sends Enter there, verb=alt sends alt-opens there, verb=hover shows a hover there after its delay. Each verb has one destination; setting it replaces the previous wire. A group cannot send a wire: name its inner tile. No to= removes that verb's wire; remove=true removes it only if it names that target. ask=true picks on screen; ask=false dismisses the controls without changing wires.",
    keys: [{ keys: "alt+l then v", does: "hover", says: "set the wire for where a hover lands" }, { keys: "alt+l then s", does: "select", says: "set the wire for what a select lands on" }, { keys: "alt+l then o", does: "open", says: "set the wire for where an open lands" }, { keys: "alt+l then a", does: "alt", says: "set the wire for where an alt-open lands" }, { keys: "click h j k l 1-9", does: "the tile itself unlinks", says: "link to the tile you pick; picking the tile itself unlinks" }, { keys: "^W P then enter or space", does: "picks", says: "link to the tile you have lit" }, { keys: "x", does: "clears a wire", says: "clear the wire you are setting" }, { keys: "esc q", does: "cancels", says: "stop choosing a tile to link to" }],
    touches: "shape", touchesWith: a => a.ask !== undefined ? "screen" : "shape", replay: "safe", says: (r, a) => r.picking !== undefined ? null : a.to ? `${r.name ?? r.tile}: ${a.verb ?? "open"} → ${a.to}` : `unlinked ${r.name ?? r.tile}'s ${a.verb ?? "open"}`,
    args: {
      ask: { type: "boolean", optional: true, conflicts: ["to", "rule", "role", "remove"], about: "true picks the target on screen; false dismisses link controls without changing wires" },
      to: { type: "string", optional: true, kind: "tile", about: "target tile; absent removes this verb's wires" },
      verb: { type: "string", optional: true, choices: WIRE_VERBS, about: "select, open (default), alt, hover" },
      rule: { type: "string", optional: true, choices: ALT_RULES, implies: [{ verb: "alt", to: null }, { verb: "alt", rule: "first-unheld" }], about: "verb=alt: beside, tab, tile, first-unheld; to= names the target" },
      role: { type: "string", optional: true, choices: ["preview", "target"], about: "script shorthand: preview selects, target opens; verb takes precedence" },
      remove: { type: "boolean", optional: true, about: "remove only this target" },
    },
    examples: [
      { act: "tile.link tile=tree to=reader", does: "makes the reader where the tree's opens (enter, double click) land" },
      { act: "tile.link tile=tree to=preview verb=select", does: "makes the preview show the tree's selection as it moves" },
      { act: "tile.link tile=tree verb=open", does: "takes the tree's open wires away, so its opens land where they did before" },
    ],
    run({ to, verb, role, remove, rule, ask }, { d, reader }, actor) {
      if (ask !== undefined) return d.startLink(reader, (verb ?? "open") as WireVerb, ask);
      return d.linkTile(reader, to, actor, (verb ?? (role === "preview" ? "select" : "open")) as WireVerb, remove, rule as AltRule | undefined);
    },
  }),
  "tile.pick": def({
    summary: "choose a tile on screen for what asked (a button's empty slot): then=<action line> runs, as the person, with value=<the tile's address> once a tile is chosen. A tile whose place an address names is asked about: this tile exactly (its t-<uuid> id) or whichever tile fills its place (drawer.agent, role:<role>, <slot>@<screen>). to= makes the choice a card row makes; value= is the answer; cancel=true puts the picker away",
    person: "choosing a tile is the person's click: an agent passes the tile itself (button.slot value=<tile>) and never opens their picker",
    keys: [{ keys: "click", does: "on a tile" }, { keys: "h j k l", does: "the tile in that direction" }, { keys: "1-9", does: "the tile with that number" }, { keys: "1 2", does: "exact tile or the one filling its place, when asked" }, { keys: "esc", does: "cancels", says: "stop choosing a tile" }],
    touches: "screen", replay: "ask", says: r => (r.picked !== undefined ? `chose ${r.picked}` : null),
    args: {
      then: { type: "string", optional: true, about: "the action line that runs with the choice, value=<address> added (`button.slot note=<id> line=3 key=target`); a choice in the pick that is waiting runs that pick's" },
      prompt: { type: "string", optional: true, about: "what the card says it is for (`pop it: choose a tile`)" },
      to: { type: "string", optional: true, kind: "tile", about: "the tile chosen, as a row of the card chooses it (a tile that fills a role is asked about next)" },
      value: { type: "string", optional: true, about: "the answer: the tile's id or its role, as written onto the line" },
      cancel: { type: "boolean", optional: true, about: "true puts the picker away, nothing chosen" },
    },
    examples: [{ act: "tile.pick then=\"button.slot note=7d9a1f40 line=3 key=target\" prompt=\"pop it: choose a tile\"", does: "the person picks a tile; the button's slot is written with its address" }],
    run({ then, prompt, to, value, cancel }, { d, reader }) { return d.pickTile(reader, { then, prompt, to, value, cancel }); },
  }),
  "tile.focus": def({
    words: "give your keys to a tile",
    summary: "give the person's keys to tile=<tile>. Refused to an agent while the person is typing (an edit, a comment, a terminal they're in)",
    keys: "click, Tab, shift+tab, 1-9, ^W h j k l (← ↓ ↑ →), ✦h ✦j ✦k ✦l ✦1-✦9 (hyper, from an edit or a terminal tile too); esc q back home (a screen with a home: the board's lanes)",
    touches: "screen", replay: "safe", says: r => `gave the keys to ${r.name ?? r.tile}`,
    args: { dir: { type: "string", optional: true, choices: ["left", "right", "up", "down"], about: "left, right, up or down: the tile that way from tile= (in a flow: the column before or after)" } },
    examples: [
      { act: "tile.focus tile=reader", does: "gives the person's keys to the reader" },
      { act: "tile.focus dir=left tile=reader", does: "gives the keys to the tile left of the reader" },
    ],
    run({ dir }, { d, reader }, actor) {
      return d.focusTile(dir ? d.neighbourOf(reader, dir as Dir) : reader, actor, true);
    },
  }),
  "tile.dock": def({
    words: "dock this tile to an edge",
    summary: "dock tile=<tile> to an edge (on=true): it goes in a dock, a container on this screen that slides over the others from its edge without moving them, and stays on this screen; or undock it, back in the layout where it was (on=false); default toggles. On the board tile=tree and tile=backlinks are its outline and backlinks docks, each a whole container (the list and its preview). A tab set goes in as one; container=<id> (a split of tiles, from layout.get) goes in whole. edge=left, right, up or down: the dock slides from that outer edge of the whole layout (a tile not docked is docked there; a dock moves there). Anything moved or opened into a dock lives in it. Refused on a locked screen",
    keys: [{ keys: "^W p", does: "dock" }, { keys: "^W P", does: "then pick the edge (⏎ or a click cycles it)" }, { keys: "T B", does: "on the board" }, { keys: "click", does: "a header's ⇤ docked undocks it" }, { keys: "p", does: "while dragging a tile" }, { keys: "drag", does: "a drop on a dock's handle" }],
    touches: "shape", replay: "safe", confirms: true, says: r => (r.changed === false ? null : r.docked ? `docked ${r.name ?? r.tile} to the ${EDGE_WORD[r.edge as Dir] ?? r.edge} edge` : `undocked ${r.name ?? r.tile}`),
    menu: { label: "dock it to an edge", group: TILE, key: "ctrl+w p", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.inDrawer ? { hide: true } : { refused: n.refused("pin"), ...(n.dock ? { label: "undock it" } : {}) }; } },
    args: { on: { type: "boolean", optional: true, about: "true docks it to an edge, false undocks it back into the layout" }, edge: { type: "string", optional: true, choices: ["left", "right", "up", "down", "other"], about: "left, right, up or down: the outer edge the dock slides from; other: the opposite side to where it is (undocked, it's moved there and stays undocked)" }, container: { type: "string", optional: true, about: "a split (s<n>) to dock whole, instead of the tile's own slot" } },
    examples: [
      { act: "tile.dock on=true edge=left tile=tree", does: "docks the tree to the left edge, sliding over the other tiles" },
      { act: "tile.dock on=false tile=tree", does: "undocks the tree, back in the layout where it was" },
    ],
    run({ on, edge, container }, { d, reader }, actor) {
      return d.dockTile(reader, on === undefined ? undefined : !on, edge as Dir | "other" | undefined, actor, container);
    },
  }),
  "tile.collapse": def({
    words: "fold this tile to a spine, or open it again",
    hint: (_a, { d, reader }) => reader !== "all" && d.tileNow(reader, USER).collapsed ? { title: "Folded tile", lines: ["A spine keeps the tile and its contents. Click its title to open it again."], keys: [{ keys: "ctrl+w c", does: "fold or open" }] } : null,
    summary: "fold tile=<tile> to a spine (on=true: a strip with its title, where it was; what's in it is kept exactly, a draft too), or open it again (on=false); default toggles. dir=v is a vertical spine (a column the title is written down, for a tile side by side with others), dir=h a horizontal one (one row with the title, for a tile stacked with others: its height goes to its neighbours); no dir takes the way its split runs. A tab set folds as one; opening a vertical spine shares the open group evenly and folds its least recently touched page below min-width (40 by default). Only a tile in a row or a column of others folds (a lane, a reader in a row), in the drawer's own layout too; a drawer tile with nothing beside it folds the drawer itself to a strip at its edge (its tiles kept as they were; putting the drawer away is drawer.away). On the board the preview and the details fold (a dock shuts instead), and tile=all opens every spine. Refused where its container can't collapse (collapsible off), and to an agent for the tile that has the person's keys",
    keys: [{ keys: "alt+h", does: "fold to a spine" }, { keys: "alt+H", does: "a horizontal spine" }, { keys: "-", does: "folds the focused tile where it takes no text" }, { keys: "+ =", does: "opens it again (a tile's own - + = win: the tune inspector, an image, a figure)" }, { keys: "✦- ✦=", does: "the same, on the hyper layer" }, { keys: "^W c", does: "fold or open" }, { keys: "⏎ space click", does: "on a spine opens it" }, { keys: "c", does: "on the board: folds a reader, and on a spine opens it" }, { keys: "alt+c", does: "every one" }, { via: "the frame card's fold row" }],
    // On the board, tile=all opens every spine (its own word for every one of them).
    places: ["all"],
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `${r.collapsed ? "folded" : "opened"} ${r.name ?? r.tile}`),
    menu: { label: "fold to a spine", group: TILE, key: "ctrl+w c", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.float ? { hide: true } : { refused: n.refused("collapse") }; } },
    args: {
      on: { type: "boolean", optional: true, about: "true folds it, false opens it; default toggles" },
      dir: { type: "string", optional: true, choices: ["v", "h"], about: "v: a vertical spine (tiles side by side), h: a horizontal one (tiles stacked); default the way its split runs. Another way than it's folded refolds it" },
    },
    examples: [
      { act: "tile.collapse on=true tile=activity", does: "folds the activity tile to a spine, keeping what is in it" },
      { act: "tile.collapse on=true dir=h tile=replies", does: "folds the replies tile to a one-row spine, its height going to its neighbours" },
    ],
    run({ on, dir }, { d, reader }, actor) {
      return d.collapseTile(reader, on, actor, dir as "v" | "h" | undefined);
    },
  }),
  "drawer.away": def({
    words: "put your drawer away",
    summary: "put your drawer away from tile=<a tile in it>: the drawer goes down and the keys to the screen, every tile in it as it was (host.toggle open=false); alt+a or the status bar chip pulls it up again. Folding a drawer tile is tile.collapse and never puts the drawer away",
    keys: [{ keys: "esc", does: "in the drawer (step out first, then esc puts it away)" }, { keys: "alt+a", does: "put the drawer away" }, { via: "the drawer tile's menu" }],
    touches: "screen", host: true, replay: "safe",
    menu: { label: "put away the drawer", group: TILE, key: "esc", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.inDrawer ? null : { hide: true }; } },
    says: r => (r.changed === false ? null : "put away the drawer"),
    args: {},
    run(_a, { d, reader }, actor) {
      return d.putDrawerAway(reader, actor);
    },
  }),
  "tile.expand": def({
    words: "open this tile from its spine",
    summary: "open tile=<tile> from its spine, sharing its row evenly (tile.collapse on=false); what was in it is as it was left",
    keys: [{ keys: "alt+h", does: "open a spine" }, { keys: "- + =", does: "on a spine" }, { keys: "⏎ space", does: "on a spine" }, { keys: "click", does: "on a spine" }, { keys: "drag", does: "a tile onto it" }],
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `opened ${r.name ?? r.tile}`),
    args: {},
    run(_a, { d, reader }, actor) {
      return d.collapseTile(reader, false, actor);
    },
  }),
  "tile.travel": def({
    words: "go back or forward in this tile: a column's flow, or the links tile's trail",
    summary: "back (dir=back, the default) or forward in tile=<tile>: in a flow, the person's keys go to the column it was opened from, or the one back last left (it widens only if it's covered, so the text comes back where it was); any other tile that keeps its own back and forward goes to what it showed before (PIE-1426: the links tile lists the note it listed before `b` or its home changed it). The person's: an agent goes back in a reader with back and forward, or opens beside (open, link.follow)",
    keys: [{ keys: "alt+← alt+b backspace", does: "back, in a river column or the links tile" }, { via: "the mouse's back button" }, { keys: "click", does: "on ← back (back)" }, { keys: "alt+→ alt+f", does: "forward" }, { via: "the mouse's forward button" }, { keys: "click", does: "on forward → (forward)" }],
    touches: "screen", replay: "safe", person: "back and forward in a flow move the person's keys between columns, and the links tile's are what the person is looking at; an agent opens beside (open, link.follow) instead",
    args: { dir: { type: "string", optional: true, choices: ["back", "forward"], about: "back or forward; default back" }, steps: { type: "number", optional: true, about: "stops at once, outside a flow (as back steps= in a reader); default 1" } },
    examples: [
      { act: "tile.travel tile=card", does: "takes the person's keys back to the column this one was opened from" },
      { act: "tile.travel dir=forward tile=card", does: "takes the keys forward to the column back last left" },
    ],
    run({ dir, steps }, { d, reader }, actor) {
      if (steps !== undefined && (!Number.isInteger(steps) || steps < 1)) throw new ActionRefused("steps is a whole number from 1");
      return d.travelTile(reader, dir === "forward" ? 1 : -1, actor, steps ?? 1);
    },
  }),
  "tile.hold": def({
    words: "hold this column or list where it is",
    summary: "hold tile=<tile>: an alt reader leaves the pile and stays open. For a flow or list (on=false lets it go; default toggles). A river column: its column stays full in its flow so it resists compression, the river's p; refused outside a flow and where its flow is locked. A #tag's list (PIE-855): it keeps its tag and stops being its reader's list, so the next tag opens a list of its own; its opens still land in that reader. Let go, it is the reader's list again, refused while another list is",
    keys: [{ keys: "p", does: "in a river column, or a #tag's list", says: "hold this column open in its flow, or keep a #tag's list on its tag" }, { via: "the frame card's hold row" }],
    touches: "shape", replay: "safe", says: r => (r.changed === false ? null : `${r.held ? "held" : "let go of"} ${r.name ?? r.tile}`),
    menu: {
      label: "hold it full", group: TILE, key: "p",
      now: ({ d, reader }, _t, actor) => {
        const n = d.tileNow(reader, actor);
        if (n.altReader) return { label: "keep this reader out of the pile" };
        if (n.listHeld !== null) return { label: n.listHeld ? "let it follow its reader's tags again" : "hold this list (a new tag opens its own)" };
        return !n.flow ? { hide: true } : n.held ? { label: "let it go" } : { refused: n.refused("hold") };
      },
    },
    args: { on: { type: "boolean", optional: true, about: "true holds it, false lets it go; default toggles" } },
    examples: [
      { act: "tile.hold on=true tile=card", does: "keeps a river column full in its flow so it resists compression" },
      { act: "tile.hold on=false tile=card", does: "lets the held column go, so it compresses like the others" },
    ],
    run({ on }, { d, reader }, actor) { return d.holdTile(reader, on, actor); },
  }),
  "tile.drawer": def({
    summary: "your drawer (PIE-498): tile=<tile> goes into your drawer, the tabs above every screen that travel with the person across screens (on=true, the default for a tile on a screen), keeping its program, note and history: the same tile, moved, never started again; or a tile in your drawer comes out into the screen shown (on=false, the default for a tile in the drawer; on=false named from a screen brings the drawer's tab shown), beside to=<tile> (where=left, right, up, down, tabs, edge-<side>; left out, beside the tile the person has). The drawer's own first tab comes out too, as an ordinary terminal tile with its program running, and the drawer starts a new own program when it next comes up. An agent's leaves the person's keys where they are and never moves the tile they type in or have; refused where the layout keeps the tile (locked, a container that keeps its tiles, a lane)",
    keys: [{ keys: "^W a", does: "on a screen: put in your drawer; in the drawer: take out" }, { keys: "^W A", does: "on a screen: the drawer's tab shown comes beside your tile" }, { keys: "drag", does: "a tile's title onto the status bar's drawer chip (a tab) or onto a side, edge or tab strip of a drawer tile (where its drop zone says)" }, { keys: "a", does: "while dragging a tile" }, { keys: "drag", does: "a drawer tab's title out onto the screen" }],
    touches: "shape", replay: "safe", confirms: true,
    says: r => (r.changed === false ? null : r.inDrawer ? `put ${r.name ?? r.tile} in your drawer${r.from ? ` from the ${r.from}` : ""}` : `took ${r.name ?? r.tile} out of your drawer into the ${r.into ?? "screen"}${r.fresh ? " · its program runs on there; your drawer starts a new one when it comes up" : ""}`),
    menu: { label: "put in your drawer", group: TILE, key: "ctrl+w a", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.inDrawer ? { label: "take out of your drawer" } : { refused: n.refused("drawer") }; } },
    args: {
      on: { type: "boolean", optional: true, about: "true: into your drawer; false: out of it into the screen shown; left out, whichever it isn't" },
      to: { type: "string", optional: true, kind: "tile", about: "the tile it goes beside, in the layout it goes into: on=false the screen's, on=true the drawer's (its name); left out, the tile the person has there" },
      where: { type: "string", optional: true, choices: WHERE, about: "left, right, up, down, tabs, edge-left, edge-right, edge-up, edge-down; into the drawer left out it joins the tabs of the one shown" },
    },
    examples: [
      { act: "tile.drawer on=true tile=activity", does: "puts the activity tile in your drawer, keeping its state" },
      { act: "tile.drawer on=false to=reader where=right tile=activity", does: "takes the tile out of the drawer to the right of the reader" },
      { act: "tile.drawer to=drawer.agent where=right tile=reader", does: "puts the reader in your drawer, to the right of the agent tab used last (where a drag onto that side drops it), not as a tab" },
    ],
    run({ on, to, where }, { d, reader }, actor) {
      return d.drawerTile(reader, on, to, where !== undefined ? whereOf(where, "tile.drawer", "right") : undefined, actor);
    },
  }),
  "tile.widen": def({
    words: "give this column the wide place in its flow",
    summary: "give tile=<tile>'s column the wide place in its flow (the river's shift, PIE-513): the flow is laid out around it, and the column the person was reading stays full beside it. The person's keys stay where they are; moving them between columns never moves a column. Refused outside a flow and where its flow is locked",
    keys: [{ keys: "^W W", does: "widen", says: "give this column the wide place in its flow" }, { keys: "click", does: "on a flow column's spine or header" }, { keys: "w", does: "in a river column" }],
    touches: "shape", replay: "safe", says: r => `widened ${r.name ?? r.tile}`,
    menu: { label: "widen", group: TILE, key: "ctrl+w W", now: ({ d, reader }, _t, actor) => { const n = d.tileNow(reader, actor); return n.flow ? { refused: n.refused("widen") } : { hide: true }; } },
    args: {},
    run(_, { d, reader }, actor) {
      return d.widenTile(reader, actor);
    },
  }),
  "float.place": def({
    words: "move or size this float",
    summary: "move or size tile=<a float> (a tile popped out over the others, tile.float): dx dy step it (columns, rows), col row put its corner there, cols rows size it. Never smaller than a float is drawn, never off the screen",
    keys: "H J K L on a float, drag its title or its ◢ corner",
    touches: "shape", replay: "safe", says: r => `moved ${r.name ?? r.tile}`,
    args: {
      dx: { type: "number", optional: true, about: "columns to move right (negative: left)" }, dy: { type: "number", optional: true, about: "rows to move down (negative: up)" },
      col: { type: "number", optional: true, about: "its left column" }, row: { type: "number", optional: true, about: "its top row" },
      cols: { type: "number", optional: true, about: "its width" }, rows: { type: "number", optional: true, about: "its height" },
    },
    examples: [
      { act: "float.place dx=4 dy=-2 tile=activity", does: "moves the floating activity tile four columns right and two rows up" },
      { act: "float.place col=10 row=3 cols=60 rows=20 tile=activity", does: "puts the float's corner at column 10, row 3, sized 60 by 20" },
    ],
    run(args, { d, reader }, actor) {
      return d.placeFloat(reader, args, actor);
    },
  }),
  "tile.agent": def({
    words: "say what an agent may do to this tile",
    hint: { title: "Agents", lines: ["Free allows changes. Edit keeps the shape. Off leaves this tile to you."], keys: [{ keys: "ctrl+w g", does: "cycle the level" }] },
    summary: "what an agent may do to tile=<tile> (PIE-639): policy=free (open notes in it, navigate, split, close, retarget it: the default), edit (edit the note it shows: patch, comment, set properties; no navigating, closing, retargeting or moving it; its own new tiles go elsewhere) or off (read it through peek; no action on it or its note); inherit takes the tile's own away, so its container's and the screen's default (layout.policy node=screen agents=edit) say again; left out, the next level. Saved with the layout, shown as a chip on the tile's frame, reported in peek, layout.get and `ep0ch where`. Enforced for agents only: the person's own keys are never limited. An agent may tighten a tile (free to edit, edit to off), never loosen one: the refusal names the person's command",
    keys: [{ keys: "^W g", does: "cycles free, edit, off" }, { keys: "click", does: "on the tile's agents chip" }, { via: "its ⋯ menu" }],
    touches: "shape", ownGate: true, replay: "safe", confirms: true,
    says: r => (r.changed === false ? null : `set ${r.name ?? r.tile} to ${AGENT_WORDS[r.agents as AgentLevel]}`),
    menu: { label: "what agents may do here", group: TILE, key: "ctrl+w g", now: ({ d, reader }) => { const a = d.agentNow(reader); return { label: a.level === "free" ? "agents: free · set edit only" : a.level === "edit" ? "agents: edit only · set hands off" : "agents: hands off · set free" }; } },
    args: { policy: { type: "string", optional: true, choices: ["free", "edit", "off", "inherit"], about: "free, edit, off, or inherit; left out, the next one (free, edit, off, free)" } },
    examples: [
      { act: "tile.agent policy=edit tile=reader", does: "lets agents edit the reader's note but not navigate, close or move it" },
      { act: "tile.agent policy=inherit tile=reader", does: "takes the reader's own agent level away, so its container's applies" },
    ],
    run({ policy }, { d, reader }, actor) {
      return d.agentTile(reader, policy as AgentLevel | "inherit" | undefined, actor);
    },
  }),
  "layout.policy": def({
    summary: "a container's policy, saved with the layout: node=<id> (s<n> a split, g<n> a tab set, d<n> a dock, from layout.get) or node=screen; left out, the innermost container holding tile=<tile>, else the screen. Sets draggable (its tiles move out), droppable (it takes tiles), accepts=<kind,kind> (only those kinds; any clears), resizable, min/max/fixed=<cells> along its parent's axis (-1 clears), collapsible, overlay and stays (a dock), locked, opensInto=<tile> (where its tiles' opens land when they have no link), opens=current|next (the open rule; a flow's is next), readable=<cells> (growth by room: past it, earlier readers in a row fold to spines as new ones open), host=over|beside|none (node=screen: where the host layer may appear over it); clear=<field,field> takes fields away. With nothing to set, it reads: each layer's policy over the tile and what applies. On a locked container only locked changes",
    keys: "^W P (enter, space or a click on a row changes it; its locked row locks the screen)",
    touches: "shape", replay: "safe", confirms: true,
    says: (r, a) => { if (!r || !("node" in r) || !("policy" in r) || "layers" in r) return null; const { set, gone } = policyChange(a); return `set ${r.node}'s policy: ${[...Object.entries(set).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`), ...gone.map(k => `${k} cleared`)].join(" ") || "unchanged"}`; },
    args: POLICY_ARGS,
    examples: [
      { act: "layout.policy tile=reader", does: "reads each layer's policy over the reader and what applies", safe: true },
      { act: "layout.policy node=screen agents=edit", does: "lets agents only edit notes in any tile of the screen that sets no level" },
      { act: "layout.policy tile=reader min=40 clear=max", does: "keeps the reader's container at least 40 cells and drops its maximum" },
    ],
    run(args, { d, reader }, actor) {
      const { set, gone } = policyChange(args);
      if (!Object.keys(set).length && !gone.length && args.node === undefined) return d.policyGet(reader);
      return d.setPolicy(reader, args.node, set, gone, actor);
    },
  }),
  "tile.slide": def({
    words: "slide this tile's dock open or shut",
    summary: "slide the dock holding tile=<tile> open (open=true) or shut (open=false); default toggles. A shut dock is a handle at the end of the hint row; a tile dragged onto the handle goes into the dock. Refused when its policy says it isn't collapsible",
    keys: [{ keys: "^W d", does: "slide a dock" }, { keys: "click", does: "on its handle (⇤ ⇥ ⤒ ⤓ on the hint row)" }, { via: "a dock slides shut when the keys go elsewhere" }],
    touches: "shape", replay: "safe", says: r => `${r.open ? "opened" : "shut"} dock ${r.name ?? r.tile}`,
    args: { open: { type: "boolean", optional: true, about: "true opens it, false shuts it" }, container: { type: "string", optional: true, about: "the dock's id (d<n>), when it isn't the innermost one holding tile=" } },
    examples: [
      { act: "tile.slide open=true tile=tree", does: "slides the dock holding the tree open over the other tiles" },
      { act: "tile.slide open=false tile=tree", does: "slides the tree's dock shut to a handle on the hint row" },
    ],
    run({ open, container }, { d, reader }, actor) {
      return d.slideTile(reader, open, actor, container);
    },
  }),
  "tile.preview": def({
    summary: "Open a preview beside or below a list, connected by a select wire; selections show there and nowhere else. On a reader, open a detail where its opens land, connected by an open wire. A terminal's preview follows its file. Again reveals the existing target. where=right, down, left or up.",
    keys: "O in a reader; ^W v beside, ^W V below",
    // Said to the person too (confirms): ^W v on a tile already linked shows the one there, which looked like nothing happening.
    touches: "shape", replay: "safe", confirms: true,
    says: r => (r.existing ? r.verb === "open" ? `${r.fromName} already opens into ${r.name ?? r.tile}: showed it · alt+l then click ${r.name ?? r.tile} to unlink` : `${r.fromName} already selects into ${r.name ?? r.tile}: showed it` : `opened ${tileNoun(String(r.kind), r.name)} ${r.verb === "open" ? `where ${r.fromName}'s opens land` : `for ${r.fromName}'s selections`}`),
    // Beside it and below it: where its opens land (a flow's column opens the next column instead).
    menu: [
      { label: "preview beside", group: TILE, key: "ctrl+w v", args: { where: "right" }, now: ({ d, reader }, _t, actor) => (d.tileNow(reader, actor).flow || d.tileNow(reader, actor).inDrawer ? { hide: true } : null) },
      { label: "preview below", group: TILE, key: "ctrl+w V", args: { where: "down" }, now: ({ d, reader }, _t, actor) => (d.tileNow(reader, actor).flow || d.tileNow(reader, actor).inDrawer ? { hide: true } : null) },
    ],
    args: { where: { type: "string", optional: true, choices: ["right", "down", "left", "up"], about: "right, down, left or up; default right if the tile is wide, else down" } },
    examples: [
      { act: "tile.preview tile=tree where=right", does: "opens a reader to the right of the tree where its opens land" },
      { act: "tile.preview tile=replies where=down", does: "opens a reader below the replies tile and links its opens to it" },
    ],
    async run({ where }, { d, reader }, actor) {
      return await d.previewTile(reader, where as Dir | undefined, actor);
    },
  }),
  "tile.title": def({
    summary: "rename a tile: a name (letters, digits, . - _) becomes its name, what tile= and paths resolve (unique in its layer: a taken name is refused) and is the title it shows; any other text (spaces, {{this.title}}) is a title written on it, the name staying, and a tile with a title written like that keeps taking text as a title (text= clears it first). Written titles support {{this.title}}, {{this.<property>}}, {{tile.kind}} and {{tile.n}}; text= clears a written title. Without text the person gets the rename prompt. Renaming the note a tile shows is the note's own edit",
    keys: [{ keys: "^W n", does: "rename" }, { keys: "double-click", does: "a frame title or tab" }, { via: "\"rename this tile\" in the tile menu (\"rename this note\" beside it is note.rename)" }],
    touches: "nothing", replay: "safe",
    says: r => r.prompt ? null : `${r.name}: ${r.title}`,
    menu: { label: "rename this tile…", group: TILE, key: "ctrl+w n" },
    args: { text: { type: "string", optional: true, about: "the new name, or a title to write on it; empty clears a written title" } },
    examples: [
      { act: "tile.title tile=reader text=yo", does: "renames the tile reader to yo: tile=yo and paths (who/yo) resolve it, its title reads yo" },
      { act: "tile.title text={{this.title}}", does: "writes the title of the note it shows on the tile, following it" },
      { act: "tile.title text=", does: "clears the written title, back to the system one" },
    ],
    run({ text }, { d, reader }, actor) { return d.titleTile(reader, text, false, actor); },
  }),
  "note.rename": def({
    words: "rename the note this tile shows",
    summary: "rename the note tile=<tile> shows (PIE-1283): text= replaces its title, the words of its first line; that line's properties, hashtags and the body stay, and it is saved at once as the actor's write, checked against the note as the service has it. Without text the person gets a prompt holding the title. tile.title renames the tile itself, never the note",
    keys: [{ via: "\"rename this note\" in the tile menu" }],
    touches: "nothing", replay: "ask",
    says: r => r.prompt ? null : `renamed the note: ${r.title}`,
    menu: { label: "rename this note…", group: TILE, key: "", now: ({ d, reader }, _t, actor) => {
      const shown = d.tileNow(reader, actor).note;
      return !shown ? { hide: true } : shown.editing ? { refused: "this reader is editing the note: change its title in the edit" } : null;
    } },
    args: {
      text: { type: "string", optional: true, about: "the note's new title; its first line's properties and the body stay" },
      note: { type: "string", optional: true, kind: "note", about: "the note you read the title from: refused when the tile shows another now" },
      revision: { type: "number", optional: true, about: "the revision you read it at: refused when the note changed since" },
    },
    examples: [
      { act: "note.rename tile=reader text=\"Seed swap, Saturday\"", does: "retitles the note the reader shows; [type::chirp] on its first line and its body stay" },
    ],
    run({ text, note, revision }, { d, reader }, actor) { return d.renameNote(reader, text, actor, { note, revision }); },
  }),
  "tile.header": def({
    words: "set what this tile's header shows",
    summary: "set tile=<tile>'s header (PIE-1248): what its reader draws above the note. mode=full (the crumbs, the title and the byline), title (the title alone, on one line) or none (the note starts on the first row); note takes the tile's own away, so the note's [header::…] decides again; left out, the next one (full, title, none). Saved with the layout. It wins over the note's own [header::…]; a note that is only embeds (an attached figure) has none until the tile says otherwise. With the byline hidden, its comment, comments, properties and sources stay in the tile menu; the frame names the note while the title is hidden. A title written on the tile (tile.title) heads it in place of the note's",
    keys: [{ keys: "^W b", does: "cycle full, title, none" }, { via: "the tile menu's header row" }],
    touches: "nothing", replay: "safe", repaints: r => r.changed !== false,
    says: r => (r.changed === false ? null : `${r.name}'s header: ${r.header === "note" ? `the note's (${r.shown})` : r.header}`),
    menu: { label: "header", group: TILE, key: "ctrl+w b", now: ({ d, reader }) => {
      const h = d.headerNow(reader);
      if (!h) return { hide: true };
      const next = ({ full: "title only", title: "none", none: "full" } as const)[h.shown];
      return { label: `header: ${h.shown === "title" ? "title only" : h.shown}${h.own ? "" : " (the note's)"} · set ${next}` };
    } },
    args: { mode: { type: "string", optional: true, choices: ["full", "title", "none", "note"], about: "full, title, none, or note (the note's [header::…] decides); left out, the next one" } },
    examples: [
      { act: "tile.header mode=none tile=reader", does: "the reader draws no header: its note starts on the first row" },
      { act: "tile.header mode=title tile=reader", does: "the reader's header is the title alone, on one line" },
      { act: "tile.header mode=note tile=reader", does: "takes the tile's own header away: the note's [header::…] decides again" },
    ],
    run({ mode }, { d, reader }, actor) { return d.headerTile(reader, mode as TileHeader | "note" | undefined, actor); },
  }),
  "tile.title.mode": def({
    summary: "toggle between the written tile title and the system title without losing the written title",
    keys: [{ keys: "^W N", does: "switch name/sys", says: "switch the tile's title between your name for it and the system's" }, { keys: "click", does: "the frame's name/sys chip" }, { via: "the tile menu" }],
    touches: "nothing", replay: "safe",
    says: r => `title: ${r.title}`,
    menu: { label: "toggle written / system title", group: TILE, key: "ctrl+w N" },
    args: {},
    run(_, { d, reader }, actor) { return d.titleTile(reader, undefined, true, actor); },
  }),
  "tile.menu": def({
    words: "open this tile's menu",
    summary: "tile=<tile>'s menu (PIE-492): every action its sets offer there (the tile operations, its kind's, a reader's note actions, a board's lane actions), each with its arguments, label, group, key and, when it would be refused now, why. An agent's answers the rows (rows=) and draws nothing; the person's opens the menu over the screen, under the tile's ⋯ or at at=<col,row>, where one click, ⏎ or a row's own key runs it as theirs",
    keys: "^W .; a right-click in a tile (not where its program asked for the mouse, or on a step's box)",
    touches: "nothing", replay: "safe",
    args: {
      at: { type: "string", optional: true, about: "col,row: the screen cell (from 0) the person's menu opens at; default under the tile's ⋯" },
      q: { type: "string", optional: true, about: "what typing in the menu does (PIE-879): only the rows that match it, by label, group and key (the power bar's matcher), `of` saying how many there are; the person's menu opens with it typed" },
    },
    examples: [
      { act: "tile.menu tile=reader", does: "lists every action the reader's menu offers, with labels, keys and why any is refused" },
      { act: "tile.menu q=zoom tile=reader", does: "lists only the menu rows matching zoom" },
    ],
    run({ at, q }, { d, reader }, actor) { return d.tileMenu(reader, at, actor, q); },
  }),
  "tile.info": def({
    answer: { tile: { type: "string", kind: "tile", about: "the tile's stable id" }, name: { type: "string", about: "its displayed name" }, kind: { type: "string", about: "what it shows" } },
    summary: "one tile as data: its kind, name, rect, link, dock state; a terminal's command, file, process and screen text; a reader's note; follows= and opens=: what it follows and where its opens land, in the words ^W P says them (reader.follow, tile.hold and tile.link change them). With card=true (^W ,, the tile menu's row) the person's shows it in a card by the tile, with copy id and copy reference on it",
    keys: [{ keys: "^W ,", does: "about this tile" }, { via: "the tile menu's \"about this tile\"" }],
    touches: "nothing", replay: "safe",
    menu: { label: "about this tile", group: TILE, key: "ctrl+w ,", args: { card: true } },
    hint: ({ card }, { d, reader, standing }) => (card && standing ? d.tileInfoHint(reader) : null),
    args: { card: { type: "boolean", optional: true, about: "the person's: show it in a card by the tile too (^W , and the menu's row do)" } },
    examples: [
      { act: "tile.info tile=reader", does: "answers the reader's id, kind, note, what it follows and where its opens land" },
      { act: "tile.info tile=reader card=true", does: "the person's: the same, shown in a card by the reader with copy id and copy reference" },
    ],
    run(_, { d, reader }) { return d.tileInfo(reader); },
  }),
  "tile.copy-ref": def({
    summary: "copy the tile's address (PIE-1297): kind=name its name as shown on it, %name (what `tile=`, the power bar's % and a script's left=/right= take), kind=id its id (t-<uuid>, exactly this tile, kept through moves, saves and restarts), kind=ref the address of its place in the tile grammar (drawer.agent, role:<role>, <slot>@<screen>: whichever tile fills it), or its id when nothing else names it alone. The person's goes to their clipboard; an agent's is returned to it and never touches the clipboard",
    keys: [{ via: "the tile menu's \"copy tile id\" and \"copy tile reference\" (its Copy group, beside the note's)" }],
    touches: "nothing", replay: "safe",
    menu: [{ label: "copy tile id", group: COPY_GROUP, args: { kind: "id" } }, { label: "copy tile reference", group: COPY_GROUP, args: { kind: "ref" } }, { label: "copy tile name", group: COPY_GROUP, args: { kind: "name" } }],
    args: { kind: { type: "string", optional: true, choices: ["id", "ref", "name"], about: "name: %<its name>; id (default): the tile's t-<uuid>; ref: the address of its place, which a restarted tile answers to" } },
    examples: [{ act: "tile.copy-ref kind=name tile=tree", does: "answers %tree: the name to give a button's or script's left= and right=" }, { act: "tile.copy-ref kind=ref tile=drawer.agent", does: "answers drawer.agent and the program's t-<uuid>, for a button's tile= or a script" }],
    run({ kind }, { d, reader }, actor) { return d.copyTileRef(reader, (kind ?? "id") as "id" | "ref" | "name", actor); },
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
    examples: [
      { act: "layout.resize split=s1 border=0 share=0.6", does: "moves split s1's first border so its first two kids share 60 to 40" },
      { act: "layout.resize path=1.0 border=1 share=0.25", does: "places the border after the split at path 1.0's second kid at a quarter" },
    ],
    run({ split, path, border, share }, { d }, actor) { return d.resizeBorder({ split, path }, border, share, actor); },
  }),
  "layout.gather": def({
    summary: "align open tiles left, centre or right by gathering their spines; keeps the alignment for later opens",
    keys: [{ keys: "^W {", does: "align left", says: "align the open tiles to the left" }, { keys: "^W }", does: "align right", says: "align the open tiles to the right" }, { keys: "^W |", does: "align centre", says: "align the open tiles in the centre" }, { keys: "click enter space", does: "in the container's policy menu" }],
    touches: "shape", replay: "safe", says: r => `gathered spines ${r.side}`,
    args: { side: { type: "string", choices: ["left", "right", "centre", "sides"], about: "spines left or right, centre (balanced), or sides (nearest edge)" }, node: { type: "string", optional: true, about: "row or flow container id; left out, the tile's nearest row" } },
    menu: [
      { label: "align left", group: "Container", key: "ctrl+w {", args: { side: "right" } },
      { label: "align centre", group: "Container", key: "ctrl+w |", args: { side: "centre" } },
      { label: "align right", group: "Container", key: "ctrl+w }", args: { side: "left" } },
    ],
    examples: [
      { act: "layout.gather tile=reader side=left", does: "gathers this row's spines on the left and keeps that policy" },
      { act: "layout.gather tile=reader side=sides", does: "gathers each spine at its nearer edge and keeps book policy" },
    ],
    run({ side, node }, { d, reader }, actor) { return d.gatherSpines(reader, side as "left" | "right" | "sides" | "centre", actor, node); },
  }),
  "layout.even": def({
    summary: "every split shares its room equally", keys: "^W =",
    touches: "shape", replay: "safe", says: () => "evened out the layout",
    args: {},
    run(_, { d }, actor) { return d.evenOut(actor); },
  }),
  "layout.swap": def({
    words: "swap this tile with another",
    summary: "tile=<tile> and tile to=<tile> trade places", keys: [{ keys: "^W s", does: "the next tile" }, { keys: "drag", does: "a tile title onto the lower middle swap band" }],
    touches: "shape", replay: "safe", says: (r, a) => `swapped ${r.name ?? r.tile} and ${a.to}`,
    args: { to: { type: "string", kind: "tile", about: "the tile it trades places with" } },
    examples: [
      { act: "layout.swap tile=tree to=reader", does: "trades the places of the tree and the reader" },
    ],
    run({ to }, { d, reader }, actor) { return d.swapTile(reader, to, actor); },
  }),
  "view.get": def({
    summary: "what each tile has in view: a reader's note and its lines in view (first, last) with the scroll; the outline's selected row; a terminal's screen, and for nvim its cursor, lines in view and file; tile=<tile> for one",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { d, reader }) { return d.viewGet(reader); },
  }),
  "view.scrollTo": def({
    words: "scroll this tile to a line of its note",
    summary: "scroll tile=<tile> so a note line (line=<n>, 1 the subject) or the first line with text=<words> is at the top. It moves what's in view, not the person's [ ] position, selection or keys. block=<id> checks the tile shows that note (open it there first: open id=… tile=…)",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't scroll the reader they type in", says: r => `scrolled ${r.name ?? r.tile}`,
    args: { line: { type: "number", optional: true, about: "the note line to bring to the top" }, text: { type: "string", optional: true, about: "or: the first line with these words" }, block: { type: "string", optional: true, about: "the note the tile must be showing" } },
    examples: [
      { act: "view.scrollTo line=40 tile=reader", does: "scrolls the reader so line 40 of its note is at the top" },
      { act: "view.scrollTo text=\"seed swap\" tile=reader", does: "scrolls the reader to the first line with the words seed swap" },
    ],
    run(at, { d, reader }, actor) { return d.scrollTo(reader, at, actor); },
  }),
  "block.mark": def({
    summary: "an attention mark, with the reason and who set it: on block id=<id> (default: the note tile=<tile> shows), framed and labelled in every tile that shows it; or on line=<n> of an nvim tile (tile=<tile>), as an extmark with virtual text. It stays until dismissed and never moves the person's focus, selection or cursor",
    keys: "alt+m steps through marks; a click on a tile's ◆ label dismisses it",
    touches: "nothing", replay: "safe", says: (_, a) => `marked: ${a.reason}`,
    args: { id: { type: "string", optional: true, about: "the block (note) id" }, line: { type: "number", optional: true, about: "an nvim tile's line (1-based)" }, reason: { type: "string", about: "what it's about, in a few words (\"needs your call\")" } },
    examples: [
      { act: "block.mark id=3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650 reason=\"needs your call\"", does: "frames that note in every tile showing it, labelled needs your call" },
      { act: "block.mark line=12 reason=\"check the bed sizes\" tile=shed-notes", does: "marks line 12 of an nvim tile with the reason as virtual text" },
    ],
    async run(m, { d, reader }, actor) { return await d.markBlock(reader, m, actor); },
  }),
  "block.unmark": def({
    words: "dismiss an attention mark",
    summary: "dismiss mark n=<n> (marks.list numbers them), or every mark on block id=<id>, or (neither) the marks on what tile=<tile> shows",
    keys: "a click on a tile's ◆ label; alt+x dismisses the focused tile's",
    touches: "nothing", replay: "safe", says: () => "dismissed a mark",
    args: { n: { type: "number", optional: true, about: "the mark's number" }, id: { type: "string", optional: true, about: "a block id" } },
    examples: [
      { act: "block.unmark n=2", does: "dismisses mark number 2 from marks.list" },
      { act: "block.unmark id=3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650", does: "dismisses every mark on that note" },
    ],
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
    words: "show another tab of this tile's tab set",
    summary: "show tab tile=<tile> in its tab set, or step by=1 (next) / by=-1 (previous) from it. An agent's leaves the person's focus where it is",
    keys: "click a tab; alt+n alt+p; ^W ] ^W [",
    touches: "shape", replay: "safe", says: r => `showed tab ${r.name ?? r.tile}`,
    args: { by: { type: "number", optional: true, about: "1 next, -1 previous; left out, that tab is shown" } },
    examples: [
      { act: "tab.select tile=activity", does: "shows the activity tab in its tab set" },
      { act: "tab.select by=1 tile=reader", does: "shows the tab after the reader's in its tab set" },
    ],
    run({ by }, { d, reader }, actor) {
      if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused("tab.select: by is 1 or -1");
      return d.selectTab(reader, by, actor);
    },
  }),
  "tile.group": def({
    summary: "gather tiles into a group (PIE-651): one tile holding them laid out as a screen of their own, so a tab set's tab can hold a split. tile=<tile> alone, or node=<a container's id or key> whole (a split), takes the group's place; with=<another tile> joins it beside it (where=right, left, up, down); selected=true gathers the tiles this actor picked (tile.select), keeping their arrangement as far as a split allows, else side by side. ask=true (the keys and the menu): with tiles picked it gathers them, else in a split the person chooses this tile or the whole split. On a group (or on=false) its tiles spill back where it was. ^W e goes into a group; tile=<group>/<tile> names one of its tiles for act; layout.move into=<group> and out=true move one tile in or out. Links between a gathered tile and one outside are kept (tile.link to=<group>/<tile>, ../<tile>). A container filled from data (the board's lanes) isn't gathered: mount its screen's part instead (tile.open kind=screen part=)",
    keys: [{ keys: "^W G", does: "a group: spills it; picked tiles: gathers them; in a split: asks this tile or the whole split" }, { keys: "click", does: "on ■ spill on a group's header" }, { via: "the tile menu" }],
    touches: "shape", replay: "ask", confirms: true,
    says: r => (r.asked ? `${r.name ?? r.tile}: this tile or the whole split?` : r.spilled ? `spilled ${r.name ?? r.tile}: ${(r.spilled as string[]).join(", ")}` : `gathered ${(r.grouped as string[] ?? []).join(", ")} into ${r.name ?? r.tile}`),
    menu: { label: "gather into a group", group: TILE, key: "ctrl+w G", args: { ask: true }, now: ({ d, reader }, _t, actor) => (d.isGroup(reader) ? { label: "spill the group back", args: { on: false } } : d.pickedBy(actor).length >= 1 ? { label: `gather the ${d.pickedBy(actor).length} picked tiles into a group` } : null) },
    args: {
      on: { type: "boolean", optional: true, about: "true gathers, false spills a group back; default: a group spills, any other tile is gathered" },
      node: { type: "string", optional: true, about: "a container (its id from layout.get, or its key) to gather whole, in place of tile=" },
      with: { type: "string", optional: true, kind: "tile", about: "another tile to put beside it in the group" },
      where: { type: "string", optional: true, choices: ["right", "left", "up", "down"], about: "with with=: right (default), left, up or down of it" },
      name: { type: "string", optional: true, about: "the group tile's name (default group, numbered)" },
      label: { type: "string", optional: true, about: "what its title says" },
      selected: { type: "boolean", optional: true, about: "gather the tiles this actor picked (tile.select) instead of tile=" },
      ask: { type: "boolean", optional: true, about: "the person is asked what to gather when there is a choice (picked tiles gather; in a split, this tile or the whole split); an agent's is never asked" },
    },
    examples: [
      { act: "tile.group tile=reader with=replies where=down name=thread label=Thread", does: "gathers the reader with the replies tile below it into a group titled Thread" },
      { act: "tile.group on=false tile=thread", does: "spills the thread group's tiles back onto the screen" },
    ],
    run({ on, node, with: w, where, name, label, selected, ask }, { d, reader }, actor) {
      const pl = whereOf(where, "tile.group", "right");
      if (!(on ?? !d.isGroup(reader))) return d.ungroupTile(reader, actor);
      const alone = node === undefined && w === undefined;
      if (selected || (ask && alone && d.pickedBy(actor).length >= 1)) return d.groupTiles(d.pickedBy(actor), { where: pl as Dir, name, label }, actor);
      if (ask && alone && actor.kind !== "agent") { const offer = d.gatherOffer(reader); if (offer) return d.askGather(reader, offer); }
      return d.groupTile(reader, { node, with: w, where: pl as Dir, name, label }, actor);
    },
  }),
  "tile.into": def({
    words: "move this tile into a group",
    summary: "move tile=<tile> into a group on this screen whole (group=<its tile>; with several groups and none named, the person picks one), or, on a tile of a group's screen, back out onto the screen holding it. A shorthand for layout.move into=<group> / out=true, which also place it (beside=, where=)",
    keys: [{ keys: "^W i", does: "put into a group" }, { via: "the tile menu" }],
    touches: "shape", replay: "safe", confirms: true,
    says: r => (r.asked ? `${r.name ?? r.tile}: into which group?` : `moved ${r.name ?? r.tile} ${r.out ? `out of ${r.from ?? "its group"}` : `into ${r.into}`}`),
    menu: { label: "move into a group…", group: TILE, key: "ctrl+w i", now: ({ d, reader }) => { const n = d.groupsFor(reader); return d.inGroup() ? { label: "move out of its group" } : n.length ? null : { hide: true }; } },
    args: { group: { type: "string", optional: true, kind: "tile", about: "the group tile to move it into" } },
    examples: [
      { act: "tile.into group=thread tile=activity", does: "moves the activity tile whole into the thread group" },
      { act: "tile.into tile=activity", does: "moves the activity tile back out of its group onto the screen" },
    ],
    run({ group }, { d, reader }, actor) {
      if (d.inGroup()) return d.moveOutOfGroup(reader, undefined, "right", actor);
      const groups = d.groupsFor(reader);
      if (!groups.length) throw new ActionRefused("tile.into: no group on this screen (^W G gathers tiles into one)");
      if (group !== undefined) return d.moveIntoGroup(reader, group, undefined, "right", actor);
      if (groups.length === 1) return d.moveIntoGroup(reader, groups[0]!, undefined, "right", actor);
      if (actor.kind === "agent") throw new ActionRefused(`tile.into: group=<${groups.join(" or ")}>`);
      return d.askGroup(reader, groups);
    },
  }),
  "tile.select": def({
    words: "pick this tile to gather into a group",
    hintId: "gather",
    hint: GATHER_HINT,
    summary: "pick tile=<tile> to gather with others into a group (on=true picks, on=false lets go; default toggles), or let go of all of this actor's picks (clear=true). A pick is the person's own or this agent's own: an agent's never touches the person's, and picking moves no focus. tile.group selected=true (^W G with tiles picked) gathers them",
    keys: [{ keys: "shift-click", does: "a tile's title" }, { keys: "^W space", does: "pick the tile" }, { keys: "esc", does: "lets go of the person's picks" }, { via: "the tile menu" }],
    touches: "nothing", replay: "safe",
    says: r => ((r.selected as string[] | undefined)?.length ? `picked ${(r.selected as string[]).join(", ")}` : "picked nothing"),
    menu: { label: "pick for a group", group: TILE, key: "ctrl+w space", now: ({ d, reader }, _t, actor) => (d.isPicked(reader, actor) ? { label: "let go of the pick" } : null) },
    args: {
      on: { type: "boolean", optional: true, about: "true picks it, false lets it go; default toggles" },
      clear: { type: "boolean", optional: true, about: "let go of all of this actor's picks" },
    },
    examples: [
      { act: "tile.select on=true tile=activity", does: "picks the activity tile to gather into a group with others" },
      { act: "tile.select clear=true", does: "lets go of all of this actor's picked tiles" },
    ],
    run({ on, clear }, { d, reader }, actor) { return d.selectTile(reader, on, !!clear, actor); },
  }),
  "tile.tune": def({
    summary: "open the tune inspector (PIE-673) on a tile (default the focused one): its look's spacing and list values (measure, padding, margin, list gap, zebra and dividers, surfaces, frames, edges and tone, the header's surface and rule, the note's header picture (its hero line), heading spacing, breakpoints), where each comes from (built-in, global, its kind, the screen, the page, a box), nudged live and saved to the level picked. The one on the screen turns to it, else one opens under it (beside it when too short to split)",
    keys: [{ keys: "alt+y", does: "tune its look" }, { keys: "^W o y", does: "open it beside the tile" }, { via: "the tile menu's \"tune its look\"" }],
    touches: "shape", replay: "ask", says: r => `· tuning ${r.tunes}`,
    menu: { label: "tune its look", group: TILE, key: "alt+y", now: ({ d, reader }) => (d.tileLook(reader ?? "") ? null : { hide: true }) },
    args: {},
    async run(_, { d, reader }, actor) { return await d.openTune(actor, reader); },
  }),
  // Last, so a tile's menu lists its Tile rows first and the Screen group after them.
  "screen.mount": def({
    summary: "put this screen on the desk as a mount (PIE-651): a tile there holding it, live, that folds to a spine and pops out again (mount.out). part=<a container's key> puts that part alone (the board's lanes: part=lanes); the tile menu offers the container around the tile. A screen popped out of a mount goes back to it (as q does). Its arrangement goes with it; from then on the mount's is its own. On the desk itself: refused (tile.open kind=screen mounts a screen there)",
    keys: [{ keys: "^W M", does: "this screen" }, { keys: "^W I", does: "the part around the focused tile" }, { via: "the tile menu's Screen rows" }],
    touches: "screen", replay: "ask", says: r => (r.back ? `back to the mount ${r.name ?? r.tile}` : `put the ${r.screen}${r.part ? `'s ${r.part}` : ""} on the desk as ${r.name ?? r.tile}`),
    menu: { label: "put this screen on the desk", group: SCREEN, key: "ctrl+w M", now: ({ d }) => (d.mountable() ? null : { hide: true }) },
    args: { part: { type: "string", optional: true, about: "a container's key (or a tile's name) of this screen: that part alone" } },
    examples: [
      { act: "screen.mount", does: "puts this whole screen on the desk as a mount tile" },
      { act: "screen.mount part=lanes", does: "puts only the board's lanes on the desk as a mount" },
    ],
    async run({ part }, { d }, actor) { return await d.mountOnDesk(part, actor); },
  }),
  "screen.part": def({
    words: "put the part of this screen around this tile on the desk as a mount",
    summary: "put the part of this screen around tile=<tile> on the desk as a mount (PIE-651): its nearest container with a key (the board's lanes, readers, outline, links), as screen.mount part= does",
    keys: [{ keys: "^W I", does: "the part around the focused tile" }, { via: "the tile menu's Screen rows" }],
    touches: "screen", replay: "ask", says: r => `put the ${r.screen}'s ${r.part} on the desk as ${r.name ?? r.tile}`,
    menu: { label: "put this part on the desk", group: SCREEN, key: "ctrl+w I", now: ({ d, reader }) => { const k = d.mountable() ? d.partAround(reader) : null; return k ? { label: `put ${k} on the desk` } : { hide: true }; } },
    args: {},
    async run(_, { d, reader }, actor) {
      const k = d.partAround(reader);
      if (!k) throw new ActionRefused(`${reader ?? "this tile"} is in no container with a key; screen.mount puts the whole screen on the desk`);
      return await d.mountOnDesk(k, actor);
    },
  }),
  "screen.save": def({
    words: "save this screen as a screen note",
    summary: "save this screen, as it's laid out now, as a screen note named name= in the outline (PIE-565: `[type::screen]`, its spec as data, as screen.spec answers it): every door on the outline then opens it (`ep0ch --screen <name>`, screen.open, ^W r) and an agent can read it. The name is kept as typed (the note's title) and the screen is opened by it or by its slug: lowercase, spaces to -, other characters dropped (daily test: daily-test). Saving under its own name again writes the same note, checked against the revision this door read (changed since: refused, read again). A built-in screen's name is refused. The person's with no name opens the prompt",
    keys: "^W w",
    touches: "nothing", replay: "ask", confirms: true,
    says: r => (r?.prompt ? null : `saved the screen as ${r.title}${r.slug ? ` (${r.slug})` : ""}${r.created ? " (a new screen note)" : ""} · ep0ch --screen ${r.slug ?? r.screen} opens it`),
    menu: { label: "save this screen as…", group: SCREEN, key: "ctrl+w w" },
    args: { name: { type: "string", optional: true, about: "the screen's name as a person would type it: spaces and capitals are fine (daily test is saved as daily-test; the answer says the name). An empty name, a built-in's or one with [ ] is refused with the reason (left out: the person types it)" } },
    examples: [
      { act: "screen.save name=\"garden planning\"", does: "saves this layout as the screen note garden planning, opened by garden-planning" },
    ],
    async run({ name }, { d }, actor) { return await d.saveScreen(name, actor); },
  }),
  "layout.lock": def({
    summary: "lock the layout the keys are in, the screen or your drawer (on=true): its shape is fixed (no moves, drops, opens of new tiles, closes, resizes, docks in or out, links or layout loads) and its contents stay live (reading, editing, typing in terminals, docks sliding, tabs shown, zoom); on=false unlocks; default toggles. Saved with the layout",
    keys: [{ keys: "click", does: "the hint row's □ lock / ▣ screen locked / ▣ drawer locked chip" }, { keys: "^W P then ⏎ space", does: "on locked" }, { via: "the power bar's row (its tile menu's)" }],
    touches: "shape", replay: "safe", confirms: true,
    // No key (PIE-1346): alt+k, a modifier away from ctrl+k, locked layouts by accident. The row and what it says name the layout.
    says: r => (r.changed ? (r.locked ? `locked ${r.layout} · ${r.unlock}` : `unlocked ${r.layout}`) : null),
    menu: { label: "lock the screen", group: SCREEN, key: "", now: ({ d }) => { const self = d.layoutSelf(); return { label: `${d.screenLocked() ? "unlock" : "lock"} ${self.name}` }; } },
    args: { on: { type: "boolean", optional: true, about: "true locks, false unlocks; default toggles" } },
    examples: [
      { act: "layout.lock on=true", does: "fixes the screen's shape while its contents stay live" },
      { act: "layout.lock on=false tile=drawer.agent", does: "unlocks your drawer (the layout of the tile named: here the agent tab, in every drawer)" },
      { act: "layout.lock on=false", does: "unlocks the screen so tiles can be moved and closed again" },
    ],
    run({ on }, { d }, actor) {
      return d.lockScreen(on, actor);
    },
  }),
  "screen.delete": def({
    words: "delete a screen you made",
    summary: "delete the screen named name= that a person made: its screen note goes to the outline's Trash (restorable there), and it's gone from every door's screens. A built-in can't be. The person's asks first: again within 3s deletes. Trashing the note anywhere (the outliner, an agent) does the same",
    keys: "x twice on a screen you made, in the screens picker (the blank tile's o)",
    touches: "nothing", replay: "ask", confirms: true,
    says: r => (r?.armed ? null : `deleted the screen ${r.screen} (its note is in the Trash)`),
    // No keycap: its x is the screens picker's, not this tile's.
    menu: { label: "delete this screen (its note to the Trash)", group: SCREEN, key: "", now: ({ d }) => (d.madeName() ? { args: { name: d.madeName()! } } : { hide: true }) },
    args: { name: { type: "string", kind: "screen", about: "the screen's name (screen.list's made screens)" } },
    examples: [
      { act: "screen.delete name=\"garden planning\"", does: "moves the garden planning screen note to the outline's Trash" },
    ],
    async run({ name }, { d }, actor) { return await d.deleteScreen(name, actor); },
  }),
  "layout.load": loadLayout,
  "layout.undo": def({
    summary: "take back the newest change to this screen's layout, from the one history every actor's changes go in (a move, a close, a float, a load; a script's run is one entry, a transaction): the screen is rebuilt as it was before it, tiles kept by name, the lock and the tile you type in holding. Yours takes back the newest; an agent's takes back its own newest only, and both are refused with who changed the layout since (\"undo that first\"). txn=<id> takes back that transaction",
    keys: [{ keys: "ctrl+z", does: "when a reader has nothing of its own to undo and the layout changed after the last trash" }, { via: "the tile menu's row" }],
    touches: "shape", replay: "ask", confirms: true,
    says: (r: { what: string; steps: number }) => `put the layout back · ${r.steps > 1 ? `${r.steps} steps` : r.what}`,
    menu: { label: "undo the last layout change", group: SCREEN, key: "ctrl+z", now: ({ d }: On) => (d.history.size ? null : { hide: true }) },
    args: {},
    run: (_a, { d }: On, actor: Actor) => d.undoLayout(actor, TXN.getStore()?.txn),
  }),
  "layout.stop": def({
    summary: "stop the script run that is rearranging this screen (a dance in flight): scripts.stop on it, and the layout it changed is put back, as far as nobody changed it since. The person's Esc does this while a run is moving the screen, and only then (a draft, an overlay, a ^W command or a drag keep their Esc)",
    keys: "esc while a script run is rearranging the screen",
    touches: "shape", replay: "ask", says: (r: { stopped: string[] }) => (r.stopped.length ? "stopped the dance" : "nothing to stop"),
    menu: { label: "stop the script rearranging this screen", group: SCREEN, key: "esc", now: ({ d }: On) => (d.runningScripts().length ? null : { hide: true }) },
    args: {},
    run: (_a, { d }: On, actor: Actor) => d.stopRuns(actor),
  }),
  "layout.txn.end": def({
    words: "finish a layout change made in steps",
    summary: "close the layout transaction txn=<id> (txn= opens one on the first action that carries it, for any actor; a script's run is its own, closed when it ends): it stays as the settled state and says once how many changes it made, with ctrl+z to put them back. layout.undo txn=<id> takes it back whole",
    keys: [{ via: "none: a script's run ends its own; an agent passes txn=<id>" }],
    touches: "nothing", replay: "safe",
    args: {},
    run: (_a, { d }: On, actor: Actor) => {
      const txn = TXN.getStore()?.txn;
      if (!txn) throw new ActionRefused("layout.txn.end closes a transaction: say which with txn=<id>");
      return d.endTxn(txn, "done", actor);
    },
  }),
  "note.trash": def({
    summary: "move the note the tile points at (a reader's note, a list's or the tree's selected row; or ref=<block id>) and the notes under it to Trash, recorded as the actor's, where note.untrash (ctrl+z) brings it back. The person's first press says what would go in a two-row choice (d again, Delete or ⏎ trashes it, any other key or esc keeps it); an agent passes confirm=<the note's id>, the same note said twice. Refused with why: a system note (the Inbox, Trash, Bookmarks), a note already in the Trash, a note with a draft open on it",
    keys: [{ keys: "d then d ⏎", does: "either confirms", says: "move the note to the Trash, after asking" }, { keys: "Delete then Delete ⏎", does: "the same", says: "move the note to the Trash, after asking" }, { via: "a click on the tile menu's row" }],
    touches: "draft", draft: "write", replay: "ask",
    says: r => `trashed “${r.title}”`,
    menu: { label: "trash this note", group: "Trash", key: "d", now: ({ d, reader }: On) => (d.subjectOf(reader).id ? null : { hide: true }) },
    args: {
      ref: { type: "string", optional: true, about: "the note's block id; default the note the tile points at" },
      confirm: { type: "string", optional: true, about: "the note's id (or its first 8+ characters): the same note, said twice" },
      revision: { type: "number", optional: true, about: "the revision you read it at: a note saved since is refused (the person's choice names the one it showed)" },
    },
    examples: [
      { act: "note.trash ref=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 confirm=7d9a1f40", does: "moves the seed-swap note and the notes under it to Trash" },
    ],
    async run({ ref, confirm, revision }, { d, reader }, actor) {
      const board = d.ctx.board, s = d.subjectOf(reader), id = ref ?? s.id;
      if (!id) throw new ActionRefused(`${s.tile} points at no note; ref=<a block id> names one`);
      if (confirm === undefined) {
        if (actor.kind === "agent") throw new ActionRefused("note.trash needs confirm=<the note's id>: the same note, said twice");
        // A second d typed before the first one's answer is back is the confirmation: the choice never opens for it.
        const asked = asking.get(d);
        if (asked?.id === id) { asked.again = true; return { armed: id, say: "asked already; confirming" }; }
        const now = { id, again: false };
        asking.set(d, now);
        let plan: Awaited<ReturnType<typeof trashPlan>>;
        try { plan = await trashPlan(board, id); } finally { asking.delete(d); }
        const { note, notesUnder } = plan;
        if (now.again) return d.dispatch.press("note.trash", { ref: note.id, confirm: note.id, ...(note.revision !== undefined ? { revision: note.revision } : {}) }, reader);
        d.overlay(trashConfirm({ title: subject(note), notesUnder, trash: () => d.run("note.trash", { ref: note.id, confirm: note.id, ...(note.revision !== undefined ? { revision: note.revision } : {}) }, reader) }));
        return { armed: note.id, title: subject(note), notesUnder, say: "d again, Delete or ⏎ trashes it" };
      }
      if (!(confirm === id || (confirm.length >= 8 && id.startsWith(confirm)))) throw new ActionRefused(`confirm=${confirm} doesn't name ${id.slice(0, 8)}; pass that note's id to trash it`);
      return trashNote(board, id, actor, msg => asActor(d.ctx, actor).flash(msg), revision);
    },
  }),
  "note.untrash": def({
    summary: "bring back the note the actor trashed last (or id=<a Trash root's block id>), where it was, with the page names it had to change",
    keys: [{ keys: "ctrl+z", does: "when the tile has nothing of its own to undo" }, { via: "the tile menu's row" }],
    touches: "nothing", replay: "ask",
    menu: { label: "bring back the note trashed last", group: "Trash", key: "ctrl+z", now: ({ d }: On, _t, actor) => (lastTrashed(d.ctx.board, actor) ? null : { hide: true }) },
    args: { id: { type: "string", optional: true, about: "a Trash root's block id; default the note this actor trashed last" } },
    examples: [
      { act: "note.untrash", does: "brings back the note this actor trashed last, where it was" },
      { act: "note.untrash id=4c1e9a73-8d20-4f65-b3a9-6e7d2c0f1b84", does: "brings back the Trash root with that block id" },
    ],
    run: ({ id }, { d }, actor) => untrashNote(d.ctx.board, id, actor, msg => asActor(d.ctx, actor).flash(msg), renamedPagesNote),
  }),
});
