// A screen as data: the layout tree as saved (splits, tab sets, docks, columns, flows, their policy), a tile as saved
// (TileSpec), a screen's spec (ScreenSpec: its layout, keys, hint, where opens land), the check that reads one back
// (`readSpec`), and the one grammar `tile=` names a tile by (`parseTileAddress`, `resolveAddress`). Moved from the door
// (its desk/layout.ts, tiles.ts, screen-spec.ts and tile-address.ts, which import them from here), so every client
// that lays a screen out reads the same shapes and the same validator: the door, the service's `screens.list`, and
// native, whose `Node` is this tree (packages/native/docs/DESIGN.md §1, §2).
//
// Pure data and checks. What a client owns stays with it: the door's tile-kind registry (`readSpec` is told which kinds
// exist), its screen registry, the layout operations and where an open lands (the door's desk/screen-layout.ts; the
// contract tables in ../fixtures say what those answer).
import { ActionRefused } from "./action-line";
import { isKeyName } from "./action-row";
import type { CalloutTone } from "./callouts";

// ── what an agent may do to a tile (PIE-639) ──

/**
 * `free` (the default): an agent may open notes in the tile, navigate it, split it, close it or retarget it.
 * `edit`: it may edit the note the tile shows (patch, comment, set properties), not navigate, close, retarget or move
 * the tile; its own new tiles go elsewhere. `off`: it may read the tile through `peek`, and takes no action on it or
 * its note.
 */
export type AgentLevel = "free" | "edit" | "off";
export const AGENT_LEVELS: readonly AgentLevel[] = ["free", "edit", "off"];
export const isAgentLevel = (x: unknown): x is AgentLevel => typeof x === "string" && (AGENT_LEVELS as readonly string[]).includes(x);

// ── the layout tree: its words and its policy ──

export type Dir = "left" | "right" | "up" | "down";
/** row: kids side by side; col: one over another. */
export type Axis = "row" | "col";
/** Where automatically folded pages gather in their row. */
export type Spines = "book" | "start" | "end" | "centre" | "invoker";
export const SPINES: readonly Spines[] = ["book", "start", "end", "centre", "invoker"];

/**
 * What a container allows (PIE-505), saved with the screen. Left out, a field is what the container around it
 * says (the screen's policy is the outermost); `locked` anywhere above locks everything under it.
 */
export interface Policy {
  /** Screen spacing, in cells: between tiles and inside its outer edge. */
  gap?: number;
  inset?: number;
  /** Where automatically folded pages gather; hand folds stay where they are. */
  spines?: Spines;
  /** Least width of an open page before the least recently touched one folds; 0 keeps all open. */
  "min-width"?: number;
  /** Its tiles can be dragged out (layout.move, layout.swap). */
  draggable?: boolean;
  /** It takes tiles moved or opened into it. */
  droppable?: boolean;
  /** Its tiles close (tile.close, ^W x); off, they stay (the board's preview and lanes: they fold to a spine instead). */
  closable?: boolean;
  /** The tile kinds it takes (any when left out): a locked board's columns take only query tiles. */
  accepts?: string[];
  /** Its borders move (a drag, layout.resize, tile.resize, layout.even). */
  resizable?: boolean;
  /** Its size along its parent's axis, in cells: at least `min`, at most `max`, or exactly `fixed`. */
  min?: number; max?: number; fixed?: number;
  /** A dock can slide shut (to its handle on the hint row). */
  collapsible?: boolean;
  /** A dock slides over the others (true, the default) or takes its room while open (false). */
  overlay?: boolean;
  /** An open dock stays open when the keys leave it (the board's backlinks: read a source, the list stays); it shuts by its key. */
  stays?: boolean;
  /** Task mode: the shape is fixed, the contents stay live. Unlocking is a click on its ▣ chip, the power bar's row or `layout.lock` (no key: PIE-1346). */
  locked?: boolean;
  /**
   * Where opens from its tiles land when a tile has no link of its own: a tile's name, or a container's key (the
   * board's readers row, PIE-515): a tile opened into it holds the note. An open lands in the one last opened (or
   * given the keys) there; a fresh one (alt+⏎), or one when that holds an edit, opens another (see `readable`).
   */
  opensInto?: string;
  /**
   * Growth by room (PIE-794): the width in cells a reader opened beside others still gets. A new one opens beside while
   * it does; past it, the earliest readers in its row (never the first) fold to spines. In a flow (the river) it is a
   * full column's width, the rest squeezed to peeks and spines. 0: nothing folds. Left out, `READABLE` (a flow: about
   * four tenths of its width).
   */
  readable?: number;
  /**
   * Closing a tile in it shuts the dock it's in instead (pinned, it goes back into a dock first): the board's
   * outline and backlinks, whose lists stay theirs.
   */
  shuts?: boolean;
  /**
   * The open rule (PIE-513; was the layout's `rule`): where an open from one of its tiles lands when no link or
   * opens-into says: the first reader that isn't pinned (`reader`, the default, PIE-1207), a new column right after the
   * tile's own in its flow (`next`, a flow's own rule when it says none), or a reader beside the tile, which stays on its
   * own note (`beside`, PIE-515: a pinned page, the brief), or the tile itself (`self`, PIE-1516: in place, a list showing the
   * note where it was, ← back returning to it). A saved `current` (the hidden current note, gone) reads as the default.
   */
  opens?: OpenRule;
  altOpens?: AltRule;
  /**
   * A screen's own (its outermost policy, PIE-513): where the host layer (the agent, the admin outline, terminals,
   * above every screen) may appear over it: `beside` it (the screen narrower), `over` it (a dock, the default),
   * or `none` (a full-screen screen: the host layer stays put away while it's shown).
   */
  host?: HostMode;
  /**
   * What an agent may do to the tiles under it (PIE-639): the screen's default, or a container's. A tile has its own
   * (`LayoutState.agents`), which wins. Left out, `free`. The person's own keys are never limited by it.
   */
  agents?: AgentLevel;
}
/** Where the host layer may appear over a screen. */
export type HostMode = "beside" | "over" | "none";
/** Where an alt-open lands: beside, a tab, the wired tile itself, or the first reader that isn't pinned (`first-unheld`). */
export type AltRule = "beside" | "tab" | "tile" | "first-unheld";
export const ALT_RULES: readonly AltRule[] = ["beside", "tab", "tile", "first-unheld"];
/** Where opens land after a tile's wire and its container's opensInto. */
export const OPEN_RULES = ["reader", "next", "beside", "float", "full", "self"] as const;
export type OpenRule = typeof OPEN_RULES[number];
export const POLICY_KEYS = ["draggable", "droppable", "closable", "accepts", "resizable", "min", "max", "fixed", "collapsible", "overlay", "stays", "locked", "opensInto", "opens", "altOpens", "host", "readable", "shuts", "agents", "spines", "min-width", "gap", "inset"] as const;

/** A wire's verb (PIE-473): what of a tile another tile takes: its selection, its opens, its alt-opens, its hover. */
export type WireVerb = "select" | "open" | "alt" | "hover";
export const WIRE_VERBS: readonly WireVerb[] = ["select", "open", "alt", "hover"];

// ── saved forms ──

/** The desk.json form before PIE-412: binary splits by ratio. The desk still writes it (it only makes pairs). */
export type BinaryForm<L> = L | { t: "split"; dir: Axis; ratio: number; a: BinaryForm<L>; b: BinaryForm<L>; id?: string; policy?: Policy } | DockForm<L> | ColumnsForm<L> | FlowForm<L>;
export type NaryForm<L> = L | { t: "split"; dir: Axis; kids: NaryForm<L>[]; weights: number[]; key?: string; pair?: true; id?: string; policy?: Policy } | TabsForm<L> | DockForm<L> | ColumnsForm<L> | FlowForm<L>;
/**
 * A flow as saved (PIE-513): its columns, and its memory by column number (0 the first): the wide one, the one kept
 * full, the one read before, the held ones, and each column's way back (`from`) and forward (`ahead`).
 */
export type FlowForm<L> = { t: "flow"; kids: NaryForm<L>[]; anchor?: number; keep?: number; read?: number; held?: number[]; recent?: number[]; sides?: { col: number; side: "left" | "right" }[]; trail?: { col: number; from?: number; ahead?: number }[]; key?: string; id?: string; policy?: Policy };
/** Columns as saved (PIE-511): its tiles as they were last filled, its weights, and where its tiles come from. */
export type ColumnsForm<L> = { t: "columns"; kids: NaryForm<L>[]; weights: number[]; source?: string; key?: string; id?: string; policy?: Policy };
/** A tab set as saved: its tiles and which one is shown. `id` (a split's too): absent in a form saved before PIE-491. */
export type TabsForm<L> = { t: "tabs"; tabs: L[]; active: number; id?: string; policy?: Policy };
/** A dock as saved (PIE-505): what it holds, its edge, open or shut. */
export type DockForm<L> = { t: "dock"; kid: NaryForm<L>; edge: Dir; open: boolean; view?: number[]; id?: string; policy?: Policy; keeps?: true };
const DIRS: readonly Dir[] = ["left", "right", "up", "down"];
/** A kind as a saved layout or policy names it: `detail` and `pinned` are readers now (the other retired names resolve in the registry). */
export const canonKind = (kind: string): string => (kind === "detail" || kind === "pinned" ? "reader" : kind);
/**
 * A tile saved under one of those two names, as the reader it is now with what the name said as its fields: a `detail`
 * started held, or pinned when it names a `page`; a `pinned` is pinned to its page. The one reading of the two names:
 * the door's canonSpec and the service's `screens.list` both ask it, so a kind served resolved keeps its pin. (Which
 * page a `pinned` with none means is the door's own setting, its "now" page: the door adds that itself.)
 */
export function canonLeaf<S extends { kind: string; mode?: string; page?: string }>(s: S): S {
  if (s.kind === "detail") return { ...s, kind: "reader", mode: s.mode ?? (s.page ? "pinned" : "held") };
  if (s.kind === "pinned") return { ...s, kind: "reader", mode: "pinned" };
  return s;
}
export const isDir = (x: unknown): x is Dir => typeof x === "string" && (DIRS as readonly string[]).includes(x);

/** A size in cells from a policy, or undefined when it isn't one. */
export const cells = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : undefined);

/**
 * A policy as saved or as an agent gave it, kept to the fields and types it has (a hand-edited save's
 * strays dropped). Empty: none.
 */
export function policyOf(x: unknown): Policy {
  const out: Policy = {};
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  for (const k of ["draggable", "droppable", "closable", "resizable", "collapsible", "overlay", "stays", "locked", "shuts"] as const) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  for (const k of ["min", "max", "fixed", "readable", "min-width", "gap", "inset"] as const) { const n = cells(o[k]); if (n !== undefined) out[k] = n; }
  if (Array.isArray(o.accepts)) out.accepts = [...new Set(o.accepts.filter((a): a is string => typeof a === "string" && /^[\w.-]{1,40}$/.test(a)).map(canonKind))];
  if (typeof o.opensInto === "string" && o.opensInto) out.opensInto = o.opensInto;
  if (OPEN_RULES.includes(o.opens as OpenRule)) out.opens = o.opens as OpenRule;
  // The open rule before PIE-1207 (the hidden current note) is the first reader not pinned now.
  else if (o.opens === "current") out.opens = "reader";
  if (SPINES.includes(o.spines as Spines)) out.spines = o.spines as Spines;
  if (ALT_RULES.includes(o.altOpens as AltRule)) out.altOpens = o.altOpens as AltRule;
  if (o.host === "beside" || o.host === "over" || o.host === "none") out.host = o.host;
  if (isAgentLevel(o.agents)) out.agents = o.agents;
  return out;
}

// ── a tile as saved ──

/** A named agent's card, as a terminal tile keeps it: who it is, where it runs and which outline it works in. */
export interface NamedAgent {
  persona: string;
  machine: string;
  folder: string;
  program: string;
  outline: string;
  outlineMachine?: string;
  /** A restored card resolves this folder's declaration again before starting a program. */
  declarationFolder?: string;
}
/** A tile's own header (PIE-1248, `tile.header`): the crumbs, the title and the byline; the title alone; or none. */
export type TileHeader = "full" | "title" | "none";
/** A tile's kind: a name in a client's tile-kind registry (an extension's too). */
export type TileKindName = string;

/** One tile as saved: what it is, its name, and what it needs to be built again. */
export interface TileSpec {
  namedAgent?: NamedAgent;
  t: "leaf";
  /** Its kind: a name in the tile-kind registry (an extension's too). */
  kind: TileKindName;
  /** The tile's name: what links, previews, `act tile=` and `peek` call it. See `tileNameProblem`. */
  name?: string;
  /** The slot this tile fills on its screen (a spec's tile name), kept when its public name changes: the place, whatever fills it. */
  slot?: string;
  /** What the tile is for (`agent`, `reader`), set by what made it and kept with its id; absent, its kind's (`tileRole`). */
  role?: string;
  /** The tile that opened this one (`t-<uuid>`): `^` names it. */
  openedFrom?: string;
  /** The tile this one was copied from (`t-<uuid>`), when a copy of a saved arrangement gave it a fresh id. */
  copiedFrom?: string;
  writtenTitle?: string;
  systemTitle?: boolean;
  /** Its own header (PIE-1248): full, title or none; absent, the note's `[header::…]` decides. */
  header?: TileHeader;
  /** Its id (`t<n>`, PIE-491), kept so a restarted door gives the tile the same one. */
  id?: string;
  /** A reader's note (block id): it starts on it and keeps it. */
  note?: string;
  outline?: string;
  machine?: string;
  /**
   * A reader's pin (PIE-1207): `pinned` keeps `note` (or the page named by `page`) and every open aimed at it lands
   * beside it. A saved `held` reads as no pin; `follows` (the hidden current note, gone) as `wasFollowing`. A query
   * list's `held` (PIE-855) keeps what it lists.
   */
  mode?: "pinned" | "held";
  /** Saved following the current note (PIE-1207: gone): it loads on the note it showed, and the desk wires a list to it once. */
  wasFollowing?: boolean;
  /** A reader's place and back and forward stacks (NoteSurface.saveNav, PIE-643): read by version, dropped when it isn't this one's. */
  nav?: unknown;
  /** A reader's margin when it isn't trim (PIE-873): "off" (marks only) or "full". */
  margin?: "full" | "off";
  /** A reader pinned to a page (`mode: pinned`): the note `[[page]]` names, asked for when the tile starts (the "now" tile). */
  page?: string;
  /** A terminal tile's program and its folder; `file`: the file it edits (a preview can follow it). */
  cmd?: string[];
  cwd?: string;
  file?: string;
  /**
   * The key its program runs under in a session's terminal host, when that isn't `<home>:<its id>`: a terminal tile moved
   * between screens or into the drawer (PIE-498) adopts its own program after a restart by it.
   */
  kept?: string;
  /** A terminal started as an agent session (PIE-737): its program, persona and config. */
  session?: { program: string; persona?: string; config?: string };
  /** A preview's source: `tile:<name>` or `file:<path>`; a backlinks tile's: `tile:<name>`. */
  source?: string;
  /** A board tile: false when its own preview strip is collapsed and a preview tile follows it instead. */
  preview?: boolean;
  /** A mount (PIE-651): the screen it mounts, by its registered name (`board`), and what that screen opens with (its target: the hub). */
  screen?: string;
  args?: Record<string, unknown>;
  /** A mount of a part of its screen: the container's key (or tile's name) it holds alone (`lanes`). */
  part?: string;
  /** A mount's own layout, as its desk saves it (a group's whole tree): the mount comes back as it was, never as its full screen was. */
  inner?: unknown;
  /** Where this tile's opens land: another tile's name (PIE-473). */
  altReader?: boolean;
  deliberate?: boolean;
  wires?: { verb: WireVerb; to: string; rule?: AltRule }[];
  selectFrom?: string;
  link?: string;
  /** What that link does when it isn't the kind's default (PIE-646): `preview` follows the source's selection too, `target` is only opened into. */
  linkRole?: "preview" | "target";
  /** A service-drawn tile's saved state (an extension's kind): what its service needs to draw it again. */
  state?: Record<string, unknown>;
  /** A query tile's view (PIE-511): the block id of the saved view (a virtual branch) whose cards it lists. */
  view?: string;
  /** A query tile's query in the views' grammar, with no saved view (`#garden`, PIE-800). */
  query?: string;
  /** Folded to a spine (`tile.collapse`, PIE-511): its place kept, its contents as they were. */
  collapsed?: true | "h";
  /** What an agent may do to this tile (PIE-639): `edit` or `off`; left out, the container's or the screen's `agents` says, else `free`. */
  agents?: "free" | "edit" | "off";
  /** This tile's own look (PIE-675, the tune inspector's "this tile"): field key → value, over the page's, under a list's. */
  look?: Record<string, string>;
  /** What its title calls it, where its kind lets a screen say (a preview's "preview · follows the board"; a pinned page's). */
  label?: string;
  /** A river column's filter (its clauses, as `/` takes them). */
  filter?: string;
  /** The glass extension's post-it and shelf (ext/glass): sticky, from a hover, pinned by; a shelf's refs, layout and colour. */
  sticky?: boolean; hover?: boolean; by?: string | null;
  refs?: { ref: string; title: string; by: string | null }[];
  shelfLayout?: "list" | "grid";
  colour?: CalloutTone;
  /** A backlinks tile whose groups start open (the welcome's). */
  groups?: "open";
  /** The link groups a backlinks tile lists (PIE-693), comma-separated (`children`: the thread tile's replies); left out, every group. */
  linkGroups?: string;
  /** A links tile's stage values, in order (`next,doing,waiting`, PIE-819): what its headers and Stage control name. */
  stages?: string;
  /** A links tile's subject (PIE-794): `held` (the default) keeps the note it lists until `b`; `follows` lists what its home shows. */
  subject?: "held" | "follows";
}
export type SavedTree = BinaryForm<TileSpec> | NaryForm<TileSpec>;

/**
 * A layout (a screen): its tree of containers and tiles, the focus, the open rule, and the screen's own policy
 * (the outermost container's: `locked` there locks the whole screen, PIE-505).
 */
export interface LayoutSpec { root: SavedTree; focus?: string | number; rule?: OpenRule; name?: string; policy?: Policy; floats?: SavedFloat[] }
/** A float as saved (PIE-511): its tile, and its rectangle. */
export interface SavedFloat { tile: TileSpec; rect: { col: number; row: number; cols: number; rows: number }; peekOf?: string }

/**
 * The rule for a tile's name (PIE-491): a letter, then letters, digits, `.`, `-` or `_`, at most 40, and not the
 * shape of an id (`t4` a tile, `s2` a split, `g1` a tab set: one of those letters, then digits). So a name is
 * never a number (`3` and `#3` are the tile numbered 3 on screen), never an id, and never holds the `:` of a
 * `tile:<name>` source. Null when it's a good name, else what's wrong, in words.
 */
export const ID_SHAPE = /^(?:[tsgk]\d+|t-[0-9a-f][0-9a-f-]{7,})$/i;
export function tileNameProblem(name: string): string | null {
  if (/^#?\d+$/.test(name)) return `a tile's name isn't a number (${name} would be read as the tile numbered ${name.replace("#", "")} on screen); start it with a letter`;
  if (ID_SHAPE.test(name)) return `a tile's name isn't shaped like an id (${name}: t, s, g or k and digits are tile, split, tab set and drawer tile ids)`;
  if (/^[A-Za-z][\w.-]{0,39}$/.test(name)) return null;
  return `a tile's name starts with a letter, then letters, digits, . - or _, at most 40 (not ${JSON.stringify(name)}; # is for numbers on screen)`;
}

// ── a screen as a spec (PIE-515) ──

/** One key of a screen's key map: the key by its one name (`keyName`: `L`, `,`, `alt+c`, `esc`, `alt+left`), the action it runs, and with what. */
export interface KeyBinding {
  key: string;
  action: string;
  label?: string;
  /** The whole sentence the keys window lists for it (TableRow.says). */
  says?: string;
  args?: Record<string, unknown>;
  /** The tile it runs in (by name); left out, the action's own default (the focused tile, or the one tile of its kind). */
  tile?: string;
  /** Not while the focused tile is one of these kinds (a tree's own `L`). */
  unless?: string[];
  /** Only while the focused tile is one of these kinds. */
  only?: string[];
}

/**
 * Where a new note opens (PIE-591): `float`, a draft floating over the screen (each one more, cascaded); `tab`, a new tab
 * on the focused tile; `drawer`, a tab in your drawer; `lands`, where the screen's opens land (a reader beside the one
 * you're in, the board's readers row, the river's next column).
 */
export type NewNoteOpens = "float" | "tab" | "drawer" | "lands";
export const NEW_NOTE_OPENS: readonly NewNoteOpens[] = ["float", "tab", "drawer", "lands"];
/**
 * One rule of a screen's new notes (PIE-591): while the focused tile is (`only`) or isn't (`unless`) one of these kinds,
 * ctrl+n runs `action` instead of making a note (the board's lanes: `card.new`, a card born with the lane's
 * properties), or opens the note where `opens` says. The first rule that matches wins; none: a float.
 */
export interface NewNoteRule {
  opens?: NewNoteOpens;
  action?: string;
  args?: Record<string, unknown>;
  only?: string[];
  unless?: string[];
}

export interface ScreenSpec {
  /** What the screen is (`desk`, `welcome`): `peek`'s kind, and how `openScreen` and the menu's items name it. */
  name: string;
  /** Its title (the status bar), until a tile of it names it otherwise. */
  title: string;
  /** Its containers with their policy and its tiles by kind: the layout tree as saved (PIE-474). */
  layout: LayoutSpec;
  /** Its keys: each names an action, run as the person, before the focused tile's own keys. */
  keys?: KeyBinding[];
  /**
   * Its hint row while nothing else is going on (`|NN` colours, as the BBS's): one for the whole screen, or one per
   * focused tile's kind (`query`, `backlinks`; `float` for a float, `spine` after a folded tile's name, `*` the rest).
   */
  hint?: string | Record<string, string>;
  /** The tile (by name) whose kind draws a band across the top of the screen (the welcome's logo and tabs). */
  band?: string;
  /** The glyphs its tiles' frames are drawn with: `dotted` (the welcome's `::....::`), or the desk's lines. */
  frame?: "dotted";
  /** `false`: the digits are the screen's own (its key map's), so tiles aren't numbered and 1-9 don't focus them. */
  digits?: false;
  /**
   * Where the keys go back to (a tile's name or a container's key: the board's lanes): `Esc` and `q` step back there
   * before they leave the screen, and the keys land there when the dock they were in shuts.
   */
  home?: string;
  /** Where an agent's open naming no tile lands (`ep0ch open <id>`): a tile, by name, that takes the note its way. */
  lands?: string;
  /** What an "open fresh" (alt+⏎, a ctrl- or alt-click) from its tiles runs, with `id`: an action's name. */
  fresh?: string;
  /** Where it keeps its layout between runs (a file in the door's state); left out, it opens as its spec says each time. */
  saves?: string;
  /** It loads and saves named layouts (alt+d, ^W r, ^W w): its tiles are the person's own, any kind in any place. */
  layouts?: true;
  /** Its programs keep running when it's left, and opening it again brings the same one back (the desk). */
  stays?: true;
  /** What ctrl+n (`note.new`) does here (PIE-591): the first rule matching the focused tile's kind; none, a float. */
  newNote?: NewNoteRule[];
  /**
   * Its row on the main menu (PIE-1525): the key that opens it there (one character), the label the row shows, and what
   * the help screen says of it. Any screen may name one: a built-in's, an extension's (`screens[]`), one a person made
   * (`screen.menu`). A key another row holds leaves this row keyless, said.
   */
  menu?: MenuRow;
  /**
   * Its toolbar, where a door draws one (the native window's): act lines, one a button. A button's label and keycap
   * are its action's row's, never written here.
   */
  toolbar?: string[];
  /** The screen a window with no arrangement of its own opens on (the native window; the door opens on its desk). */
  start?: true;
  /**
   * What the screen is opened on (`screen.open name=navigator target="type=bed"`, `ep0ch --screen <name> <target>`):
   * the argument a target fills (`arg`) and the tile's field it becomes (`fills`: `<tile name>.<field>`), so a screen
   * that starts on a query, a note or a hub is data. `targetFilled` is the one reader.
   */
  target?: ScreenTarget;
}

/** A screen's target (`ScreenSpec.target`). */
export interface ScreenTarget { arg: string; fills: string }

/**
 * `spec` opened on `args`: the tile `target.fills` names carries the argument's words in that field. No argument (or
 * blank), no target, or a tile the layout hasn't: the spec as it is.
 */
export function targetFilled(spec: ScreenSpec, args: Readonly<Record<string, unknown>> | undefined): ScreenSpec {
  const value = spec.target ? args?.[spec.target.arg] : undefined;
  if (!spec.target || typeof value !== "string" || !value.trim()) return spec;
  const dot = spec.target.fills.indexOf("."), tile = spec.target.fills.slice(0, dot), field = spec.target.fills.slice(dot + 1);
  const filled = structuredClone(spec);
  for (const leaf of [...savedNodes(filled.layout.root), ...(filled.layout.floats ?? []).map(f => f.tile)]) if (leaf?.t === "leaf" && leaf.name === tile) (leaf as Record<string, unknown>)[field] = value.trim();
  return filled;
}

/** A screen's row on the main menu (PIE-1525). */
export interface MenuRow { key: string; label: string; about?: string }

/** Why `m` can't be a menu row, or null: a key is one printable character, a label a few words. */
export function menuRowProblem(m: { key?: unknown; label?: unknown; about?: unknown }): string | null {
  if (typeof m.key !== "string" || [...m.key].length !== 1 || !/^[\x21-\x7e]$/.test(m.key)) return `a menu row's key is one character you can type (a letter, a digit, + ! …), not ${JSON.stringify(m.key ?? "")}`;
  if (typeof m.label !== "string" || !m.label.trim() || m.label.trim().length > 16 || /[\n\r]/.test(m.label)) return `a menu row's label is one to 16 characters on one line, not ${JSON.stringify(m.label ?? "")}`;
  if (m.about !== undefined && (typeof m.about !== "string" || m.about.length > 200)) return "a menu row's about is a line of up to 200 characters";
  return null;
}

/** The rule of `spec`'s new notes for a focused tile of `kind` (PIE-591), or null: a float. */
export function newNoteRule(spec: Pick<ScreenSpec, "newNote">, kind: string | undefined): NewNoteRule | null {
  return spec.newNote?.find(r => (!r.only || (kind !== undefined && r.only.includes(kind))) && (!r.unless || kind === undefined || !r.unless.includes(kind))) ?? null;
}

const NAME = /^[A-Za-z][\w.-]{0,39}$/;
const kinds = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every(k => typeof k === "string") ? x.map(canonKind) : undefined);
/** Why `name` can't be a screen's name, or null. */
export const screenNameProblem = (name: string): string | null => (NAME.test(name) ? null : `a screen's name is a letter, then letters, digits, . - _, at most 40 (not ${JSON.stringify(name)})`);

/**
 * The name a title is kept under: lowercase, runs of spaces to `-`, anything but letters, digits, `.` `-` `_` dropped,
 * at most 40. "Daily test" is `daily-test`. It may still not be a name (it must start with a letter): `screenTitleProblem`.
 */
export const screenSlug = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/-{2,}/g, "-").slice(0, 40).replace(/-+$/, "");

/**
 * A spec as data (what a note would hold): its fields as they are, nothing that isn't data. A spec is already plain
 * data; this is the copy that goes out (the layout's own tree as it was given).
 */
export function specData(s: ScreenSpec): unknown { return JSON.parse(JSON.stringify(s)); }

/**
 * A spec read back from data (a note's, a saved one's): checked field by field, a bad one refused with what's
 * wrong. The tiles' kinds are checked only when `isKind` says which exist (a client's registry: a kind an extension
 * hasn't loaded yet is a tile that says so, as in any saved layout).
 */
export function readSpec(x: unknown, isKind?: (kind: string) => boolean): ScreenSpec {
  const o = (x && typeof x === "object" ? x : null) as Record<string, unknown> | null;
  if (!o) throw new Error("a screen spec is an object");
  const name = o.name, title = o.title, layout = o.layout as LayoutSpec | undefined;
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`a screen's name is a letter, then letters, digits, . - _ (not ${JSON.stringify(name)})`);
  if (typeof title !== "string" || !title.trim()) throw new Error(`screen ${name}: title is the words its status bar shows`);
  if (!layout || typeof layout !== "object" || !layout.root || typeof layout.root !== "object") throw new Error(`screen ${name}: layout is a layout as saved, with a root`);
  const keys = o.keys === undefined ? undefined : Array.isArray(o.keys) ? o.keys.map((b: any, i: number) => {
    if (!b || typeof b !== "object" || !isKeyName(b.key)) throw new Error(`screen ${name}: key ${i + 1} names no key (a character, enter, esc, space, shift+tab, alt+left, alt+<c>, ctrl+<c>…)`);
    if (typeof b.action !== "string" || !b.action) throw new Error(`screen ${name}: key ${b.key} names no action`);
    return {
      key: b.key, action: b.action,
      ...(typeof b.label === "string" ? { label: b.label } : {}),
      ...(typeof b.says === "string" ? { says: b.says } : {}),
      ...(b.args && typeof b.args === "object" && !Array.isArray(b.args) ? { args: { ...b.args } } : {}),
      ...(typeof b.tile === "string" ? { tile: b.tile } : {}),
      ...(kinds(b.unless) ? { unless: kinds(b.unless)! } : {}),
      ...(kinds(b.only) ? { only: kinds(b.only)! } : {}),
    } satisfies KeyBinding;
  }) : (() => { throw new Error(`screen ${name}: keys is a list`); })();
  const newNote = o.newNote === undefined ? undefined : Array.isArray(o.newNote) ? o.newNote.map((r: any, i: number) => {
    if (!r || typeof r !== "object") throw new Error(`screen ${name}: newNote rule ${i + 1} is an object (opens= or action=)`);
    if (r.opens !== undefined && !NEW_NOTE_OPENS.includes(r.opens)) throw new Error(`screen ${name}: newNote rule ${i + 1} opens ${JSON.stringify(r.opens)}; it opens ${NEW_NOTE_OPENS.join(", ")}`);
    if (r.action !== undefined && (typeof r.action !== "string" || !r.action)) throw new Error(`screen ${name}: newNote rule ${i + 1} names no action`);
    if ((r.opens === undefined) === (r.action === undefined)) throw new Error(`screen ${name}: newNote rule ${i + 1} gives one of opens= or action=`);
    return {
      ...(r.opens !== undefined ? { opens: r.opens as NewNoteOpens } : {}), ...(r.action !== undefined ? { action: r.action as string } : {}),
      ...(r.args && typeof r.args === "object" && !Array.isArray(r.args) ? { args: { ...r.args } } : {}),
      ...(kinds(r.unless) ? { unless: kinds(r.unless)! } : {}),
      ...(kinds(r.only) ? { only: kinds(r.only)! } : {}),
    } satisfies NewNoteRule;
  }) : (() => { throw new Error(`screen ${name}: newNote is a list of rules`); })();
  let menu: MenuRow | undefined;
  if (o.menu !== undefined) {
    const m = (o.menu && typeof o.menu === "object" && !Array.isArray(o.menu) ? o.menu : {}) as Record<string, unknown>;
    const bad = menuRowProblem(m);
    if (bad) throw new Error(`screen ${name}: ${bad}`);
    menu = { key: (m.key as string).toUpperCase(), label: (m.label as string).trim(), ...(typeof m.about === "string" && m.about.trim() ? { about: m.about.trim() } : {}) };
  }
  if (o.toolbar !== undefined && !(Array.isArray(o.toolbar) && o.toolbar.every(l => typeof l === "string" && l.trim()))) throw new Error(`screen ${name}: toolbar is a list of act lines, one a button`);
  const toolbar = (o.toolbar as string[] | undefined)?.map(l => l.trim());
  let target: ScreenTarget | undefined;
  if (o.target !== undefined) {
    const t = (o.target && typeof o.target === "object" && !Array.isArray(o.target) ? o.target : {}) as Record<string, unknown>;
    if (typeof t.arg !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/i.test(t.arg) || typeof t.fills !== "string" || !/^[^.\s]+\.[A-Za-z][\w-]*$/.test(t.fills)) throw new Error(`screen ${name}: target is { arg, fills }: the argument a target fills and the tile's field it becomes (fills: "facets.query")`);
    target = { arg: t.arg, fills: t.fills };
  }
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? { [k]: o[k] as string } : {});
  const spec: ScreenSpec = {
    name, title, layout,
    ...(keys ? { keys } : {}),
    ...(newNote ? { newNote } : {}),
    ...(menu ? { menu } : {}),
    ...(toolbar?.length ? { toolbar } : {}),
    ...str("hint"), ...hintMap(o.hint), ...str("band"), ...str("home"), ...str("lands"), ...str("fresh"), ...str("saves"),
    ...(o.frame === "dotted" ? { frame: "dotted" as const } : {}),
    ...(o.digits === false ? { digits: false as const } : {}),
    ...(o.layouts === true ? { layouts: true as const } : {}),
    ...(o.stays === true ? { stays: true as const } : {}),
    ...(o.start === true ? { start: true as const } : {}),
    ...(target ? { target } : {}),
  };
  if (isKind) for (const k of leafKinds(layout.root)) if (!isKind(canonKind(k))) throw new Error(`screen ${name}: no tile kind ${k} here`);
  // What it names by name is in its layout: a key's tile, the band's tile, where opens land and the keys go home.
  const tiles = new Set(slotNames(layout.root)), places = new Set([...tiles, ...containerKeys(layout.root)]);
  // `all`: every tile (tile.collapse on=false tile=all reopens every spine); a container by its key: the tile last in it.
  for (const b of spec.keys ?? []) if (b.tile !== undefined && b.tile !== "all" && !places.has(b.tile)) throw new Error(`screen ${name}: key ${b.key} runs in tile ${b.tile}, which its layout hasn't`);
  if (spec.band !== undefined && !tiles.has(spec.band)) throw new Error(`screen ${name}: its band is drawn by tile ${spec.band}, which its layout hasn't`);
  for (const k of ["lands", "home"] as const) if (spec[k] !== undefined && !places.has(spec[k]!)) throw new Error(`screen ${name}: ${k} names ${spec[k]}, neither a tile nor a container of its layout`);
  if (target && !tiles.has(target.fills.slice(0, target.fills.indexOf(".")))) throw new Error(`screen ${name}: its target fills ${target.fills}, a tile its layout hasn't`);
  return spec;
}

/**
 * Every node of a saved or spec'd tree, outermost first: the one walk over a layout as data (either form; anything in
 * it that isn't a node is skipped).
 */
export function savedNodes(n: any): any[] {
  if (!n || typeof n !== "object") return [];
  if (n.t === "leaf") return [n];
  return [n, ...[...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid, n.a, n.b].flatMap(savedNodes)];
}
const leafField = (n: unknown, f: "name" | "kind" | "slot"): string[] => savedNodes(n).flatMap(x => (x.t === "leaf" && typeof x[f] === "string" ? [x[f]] : []));
/** The names of a saved tree's tiles, the kinds of them, and the keys of its containers. */
export const leafNames = (n: unknown) => leafField(n, "name");
/** The public names and preserved spec slots of the tiles in a layout. */
export const slotNames = (n: unknown): string[] => [...leafNames(n), ...leafField(n, "slot")];
const leafKinds = (n: unknown) => leafField(n, "kind");
export const containerKeys = (n: unknown): string[] => savedNodes(n).flatMap(x => (x.t !== "leaf" && typeof x.key === "string" ? [x.key] : []));
/** A hint per focused kind, as data: its strings only. */
const hintMap = (x: unknown): { hint?: Record<string, string> } => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out = Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]);
  return Object.keys(out).length ? { hint: out } : {};
};

/**
 * The part of a screen named `key` (a container's key, or a tile's name) as a screen of its own: its layout is that
 * subtree, and what the spec names outside it is left out (a key bound to a tile that isn't there, its band, where its
 * opens land and its keys go home), so a mount of the board's lanes is the lanes alone. A container whose tiles come from
 * data (the lanes) holds a place holder until its source fills it: a screen is never blank. Throws when there's no such part.
 */
export function partSpec(spec: ScreenSpec, key: string): ScreenSpec {
  const found = savedNodes(spec.layout.root).find(n => (n.t === "leaf" ? n.name === key : n.key === key));
  if (!found) throw new Error(`the ${spec.name} screen has no part ${key}; its parts: ${screenParts(spec).join(", ") || "none"}`);
  let root = JSON.parse(JSON.stringify(found.t === "dock" ? found.kid : found));
  if (!leafNames(root).length && root.t === "columns") root = { ...root, kids: [{ t: "leaf", kind: "filling", name: `${key}-filling`, label: `${key} · filling from its source…` }], weights: [1] };
  const tiles = new Set(leafNames(root)), places = new Set([...tiles, ...containerKeys(root)]);
  const inside = (name: string | undefined) => name === undefined || name === "all" || places.has(name);
  const { saves: _saves, band, home, lands, keys, ...rest } = spec;
  const policy = spec.layout.policy ? { ...spec.layout.policy } : undefined;
  if (policy?.opensInto && !places.has(policy.opensInto)) delete policy.opensInto;
  const focus = typeof spec.layout.focus === "string" && tiles.has(spec.layout.focus) ? spec.layout.focus : leafNames(root)[0];
  return {
    ...rest,
    title: `${spec.title} · ${key}`,
    layout: { root, ...(focus ? { focus } : {}), ...(spec.layout.rule ? { rule: spec.layout.rule } : {}), ...(policy && Object.keys(policy).length ? { policy } : {}) },
    ...(keys ? { keys: keys.filter(b => inside(b.tile)) } : {}),
    ...(band && tiles.has(band) ? { band } : {}),
    ...(home && places.has(home) ? { home } : {}),
    ...(lands && places.has(lands) ? { lands } : {}),
  };
}
/** The parts of a screen a mount can name (`part=`): its containers' keys, then its tiles' names. */
export const screenParts = (spec: ScreenSpec): string[] => [...containerKeys(spec.layout.root), ...leafNames(spec.layout.root)];

/**
 * A group (PIE-651): tiles gathered into one tile, laid out as a screen of their own (a tab's split, "splits in my
 * tabs"). Its spec is its tree; it has no screen elsewhere, no keys of its own and no file: the tile holding it saves it.
 */
export function groupSpec(root: unknown, label?: string): ScreenSpec {
  return { name: "group", title: label || "group", digits: false, layout: { root: root as LayoutSpec["root"] } };
}

// ── the tile address (PIE-1286) ──
//
// The one grammar `tile=` reads for a tile that is not on the screen you are asking from (PIE-1286). Four kinds of
// address, matched in this order, and nothing else decides which tile a request means:
//
//   t-<uuid>            this exact tile: a unique prefix of 8+ characters after `t-` works, as a block id's does
//   role:<role>[@scope] a tile of this kind, wherever it is: `role:agent` an agent tab (of several, the one the person
//                       used last), `role:reader` a reader. The role lives on the tile (set when it is made, saved with
//                       its id), so a restart, a handover or a restore keeps it. `@scope` narrows it to the drawer or to
//                       one screen
//   <slot>@<screen>     the place, whatever fills it now: a slot the screen declares (its spec's tile names, where
//                       opens land: `detail`, a docked tile) on that screen
//   ^, ^^               relative: the tile that opened this one (the acting tile's), or the one before it in the chain
//   <name>              the label a person typed. Matched last, and never the identity of anything
//
// `drawer.agent` stays as the alias of `role:agent`. Pure: the desk lists the tiles it has (AddressCandidate), this
// module says which one an address means, or why none does and what to run.

/** How a caller reads an address beyond the address: `program`: the tile a program runs in, by what it was told; `from`: the tile the request acts from (for `^`). */
/** `shown`: only the tiles on the desks shown now (the drawer's and the screen's), never one on a screen behind: where an open lands. */
export interface ResolveOpts { program?: true; from?: string; shown?: true }

export type TileAddress =
  | { kind: "id"; id: string; text: string }
  | { kind: "role"; role: string; scope?: string; text: string }
  | { kind: "slot"; slot: string; screen: string; text: string }
  | { kind: "relative"; up: number; text: string }
  | { kind: "name"; name: string; text: string };

/** The agent tab used last, by its name from before roles: an alias for `role:agent`. */
export const AGENT_ALIAS = "drawer.agent";
/** The role of an agent tab (PIE-1331: every agent in the drawer is a terminal tab with it). */
export const ROLE_AGENT = "agent";
/** A tile id's shortest prefix that names it (after `t-`), the rule block ids follow. */
export const MIN_ID_PREFIX = 8;
/** A tile's id as few characters as still name it (`t-1a2b3c4d`): the header of its menu and its card; the whole id is what copies and what a slot keeps. */
export const shortTileId = (id: string): string => (id.startsWith("t-") ? id.slice(0, 2 + MIN_ID_PREFIX) : id);

const ID = new RegExp(`^t-[0-9a-f][0-9a-f-]{${MIN_ID_PREFIX - 1},}$`, "i");   // the same shape tileNameProblem refuses as a name (ID_SHAPE)

/** What `sel` is an address of. A bare name, a number or a path is a `name` here: the dispatcher reads those itself. */
export function parseTileAddress(sel: string): TileAddress {
  if (sel === AGENT_ALIAS) return { kind: "role", role: ROLE_AGENT, text: sel };
  if (/^\^+$/.test(sel)) return { kind: "relative", up: sel.length, text: sel };
  if (ID.test(sel)) return { kind: "id", id: sel.toLowerCase(), text: sel };
  if (sel.startsWith("role:")) {
    const [role, scope] = sel.slice(5).split("@", 2) as [string, string | undefined];
    return { kind: "role", role, ...(scope ? { scope } : {}), text: sel };
  }
  const at = sel.indexOf("@");
  if (at > 0 && !sel.includes("/") && at < sel.length - 1) return { kind: "slot", slot: sel.slice(0, at), screen: sel.slice(at + 1), text: sel };
  return { kind: "name", name: sel, text: sel };
}

/** A tile as the resolver reads it: what it is, never how it is shown. `value` is what the caller gets back. */
export interface AddressCandidate<T> {
  value: T;
  /** Its `t-<uuid>`. */
  id: string;
  name: string;
  /** Its role: set on the tile, else its kind. */
  role: string;
  /** The slots it fills on its screen now (a spec's tile name, `detail`, a column's key). */
  slots: readonly string[];
  /** The tile that opened it (`t-<uuid>`), when one did and it was recorded with it: what `^` follows. */
  from?: string;
  /** The tile it was copied from (`t-<uuid>`): a saved arrangement loaded again made it, and an address of the old tile can say so. */
  copiedFrom?: string;
  /** Its screen's name (`drawer` for the drawer's own desk). */
  screen: string;
  /** When the person last typed in it or clicked it (a terminal's): of several agent tabs, `role:agent` is the one used last. */
  usedAt?: number;
  /** Where to find it, for a refusal that lists several (worked out only when a refusal needs it). */
  where: () => string;
}

const list = <T>(cs: readonly AddressCandidate<T>[]) => cs.map(c => `${c.where()} (${c.id})`).join(", ");
const inScope = <T>(c: AddressCandidate<T>, scope: string | undefined) => scope === undefined || c.screen === scope;

/** The tiles `a` names (an id, a role or a slot), none or several included. A `name` is not decided here. */
export function matches<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): AddressCandidate<T>[] {
  if (a.kind === "id") return cs.filter(c => c.id.startsWith(a.id));
  if (a.kind === "role") return cs.filter(c => c.role === a.role && inScope(c, a.scope));
  if (a.kind === "slot") return cs.filter(c => c.screen === a.screen && c.slots.includes(a.slot));
  return [];
}

/**
 * The one tile an address means, or null when none does; several is a refusal that lists them with the ids to type. A
 * `name` is null here: the caller's own names come after, and are never the identity of anything.
 */
export function resolveAddress<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): AddressCandidate<T> | null {
  const hits = matches(a, cs);
  // Several agent tabs: the one the person used last (PIE-1331), as the lift picks it.
  if (hits.length > 1 && a.kind === "role" && a.role === ROLE_AGENT && hits.every(h => h.usedAt !== undefined)) return hits.reduce((best, h) => (h.usedAt! > best.usedAt! ? h : best));
  if (hits.length > 1) throw new ActionRefused(`${a.text} names ${hits.length} tiles: ${list(hits)}; use tile=<id>${a.kind === "role" && a.scope === undefined ? ` or ${a.text}@<screen>` : ""}`);
  return hits[0] ?? null;
}

/**
 * `^` (the tile that opened the acting one) or `^^` (the one before it): follows each tile's recorded opener from `origin`
 * (the acting tile's id). Refused, with why, when there is no acting tile, no recorded opener, or the opener was closed.
 */
export function resolveRelative<T>(a: Extract<TileAddress, { kind: "relative" }>, cs: readonly AddressCandidate<T>[], origin: string | undefined): AddressCandidate<T> {
  let at = origin === undefined ? undefined : cs.find(c => c.id === origin);
  if (!at) throw new ActionRefused(`${a.text} is relative to the tile you act from, and none has your keys here; name it: role:<role>, t-<id> or <slot>@<screen>`);
  for (let i = 0; i < a.up; i++) {
    if (!at.from) throw new ActionRefused(`${a.text} names the tile that opened ${at.name}, and nothing recorded opening it (a layout made it); name it: role:<role>, t-<id> or <slot>@<screen>`);
    const opener: AddressCandidate<T> | undefined = cs.find(c => c.id === at!.from);
    if (!opener) throw new ActionRefused(`${a.text}: the tile that opened ${at.name} (${at.from}) was closed; name another: role:<role>, t-<id> or <slot>@<screen>`);
    at = opener;
  }
  return at;
}

/** Why `a` names no tile, with what to type instead (an id, role or slot that exists), or null for a plain name. */
export function whyNone<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): string | null {
  const roles = [...new Set(cs.map(c => c.role))].sort();
  if (a.kind === "id") {
    const copy = cs.find(c => c.copiedFrom !== undefined && (c.copiedFrom === a.id || c.copiedFrom.startsWith(a.id)));
    if (copy) return `no tile has the id ${a.text}: it was copied to ${copy.where()} (${copy.id}); tile.list shows the ids`;
    const near = cs.filter(c => c.id.startsWith(a.id.slice(0, 6)));
    return `no tile has the id ${a.text}${near.length ? `; did you mean ${near.slice(0, 3).map(c => c.id).join(", ")}?` : `; tile.list shows the ids`}`;
  }
  if (a.kind === "role") {
    const scoped = a.scope !== undefined && !cs.some(c => c.screen === a.scope);
    if (scoped) return `no screen ${a.scope} is on show to look for role:${a.role} in; screens: ${[...new Set(cs.map(c => c.screen))].join(", ")}`;
    return `no tile has the role ${a.role}${a.scope ? ` on ${a.scope}` : ""}; roles here: ${roles.join(", ")}`;
  }
  if (a.kind === "relative") return `${a.text} names no tile`;
  if (a.kind === "slot") {
    const onScreen = cs.filter(c => c.screen === a.screen);
    if (!onScreen.length) return `no screen ${a.screen} is on show or mounted here; screens: ${[...new Set(cs.map(c => c.screen))].join(", ")}`;
    return `${a.screen} has no slot ${a.slot}; its slots: ${[...new Set(onScreen.flatMap(c => c.slots))].join(", ") || "none"}`;
  }
  return null;
}
