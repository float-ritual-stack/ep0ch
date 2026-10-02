// Tiles and named layouts (PIE-413, PIE-474). A tile is a view in the layout tree: the outline tree, a
// reader that follows the current note, a detail that keeps its note, a preview following a tile or a
// file, a program in a terminal, a whole screen (board, river), the brief, and the desk's other panes. A
// layout is the tree of splits and tab sets over tiles, with each tile's name, where its opens land (its
// link), whether it slides over as a drawer, and the layout's open rule. It is data: saved by name in the
// door's state (layouts.json), restored with one key or `act layout.restore name=…`.
//
// Screen notes in the outline (PIE-412's slice 3) aren't built yet, so layouts live in the door's state
// only; the saved form is the same one desk.json uses, ready to be written into a note when they are.
import { homedir } from "node:os";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readState, stateDir, writeState } from "../state";
import { leaf, serializeTree, splitOf, type Dir, type LNode, type NaryForm, type BinaryForm, type Policy } from "./screen-layout";
import { ReaderPane, type Pane } from "./panes";
import type { PtyPane } from "./pty";
import { nowPage } from "../hub/now";
import { SCREEN_KINDS, type ScreenKind } from "./screen-tile";
import { isTileKind, missingKind, tileKind, tileKinds, UnavailableTile, type TileKindName } from "./tile-kinds";
import { registerBuiltinTiles } from "./builtin-tiles";

/** One tile as saved: what it is, its name, and what it needs to be built again. */
export interface TileSpec {
  t: "leaf";
  /** Its kind: a name in the tile-kind registry (an extension's too). */
  kind: TileKindName;
  /** The tile's name: what links, previews, `act tile=` and `peek` call it. See `tileNameProblem`. */
  name?: string;
  /** Its id (`t<n>`, PIE-491), kept so a restarted door gives the tile the same one. Absent before PIE-491. */
  id?: string;
  /** A detail's note (block id). */
  note?: string;
  /** A detail pinned to a page: the note `[[page]]` names, asked for when the tile starts (the "now" tile). */
  page?: string;
  /** A terminal tile's program and its folder; `file`: the file it edits (a preview can follow it). */
  cmd?: string[];
  /**
   * The daily layout's agent tile, in a layout saved before the agent moved to the host layer (PIE-513): read once
   * and left out (`withoutAgentTile`): the agent has one home, the host layer's drawer.
   */
  agent?: true;
  cwd?: string;
  file?: string;
  /** A preview's source: `tile:<name>` or `file:<path>`; a backlinks tile's: `tile:<name>`. */
  source?: string;
  /** A board tile: false when its own preview strip is collapsed and a preview tile follows it instead. */
  preview?: boolean;
  /** Where this tile's opens land: another tile's name (PIE-473). */
  link?: string;
  /**
   * Before PIE-505, a drawer was a flag on its tile: slides over (`over`), shut (`shut`). Read once and turned
   * into a drawer container holding the tile (`migrateDrawers`); never written now.
   */
  drawer?: "over" | "shut";
  /** A service-drawn tile's saved state (an extension's kind): what its service needs to draw it again. */
  state?: Record<string, unknown>;
  /** A query tile's view (PIE-511): the block id of the saved view (a virtual branch) whose cards it lists. */
  view?: string;
  /** Folded to a spine (`tile.collapse`, PIE-511): its place kept, its contents as they were. */
  collapsed?: true;
  /** What its title calls it, where its kind lets a screen say (a preview's "preview · follows the board"; a pinned page's). */
  label?: string;
  /** A backlinks tile whose groups start open (the welcome's). */
  groups?: "open";
}
export type SavedTree = BinaryForm<TileSpec> | NaryForm<TileSpec>;

/**
 * Where an open from a tile goes when it has no link: the current note, or (`next`) a new column after its own in
 * its flow. A layout's `rule` is read into its screen policy's `opens` (PIE-513: the open rule is policy now).
 */
export type { OpenRule } from "./screen-layout";
import type { OpenRule } from "./screen-layout";
/**
 * A layout (a screen): its tree of containers and tiles, the focus, the open rule, and the screen's own policy
 * (the outermost container's: `locked` there locks the whole screen, PIE-505).
 */
export interface LayoutSpec { root: SavedTree; focus?: string | number; rule?: OpenRule; name?: string; policy?: Policy; floats?: SavedFloat[] }
/** A float as saved (PIE-511): its tile, and its rectangle. */
export interface SavedFloat { tile: TileSpec; rect: { col: number; row: number; cols: number; rows: number } }

/**
 * A layout saved before PIE-505 marks a drawer on its tile (`drawer: "over"` or `"shut"`). Each such tile (a tab
 * set whose tiles all say so, as one) is put in a drawer container where it was, sliding from the edge it sits
 * at, open or shut as it was. A layout with drawer containers comes back as it was.
 */
export function migrateDrawers(spec: LayoutSpec): LayoutSpec {
  if (!savedLeaves(spec.root).some(l => l.drawer)) return spec;
  const strip = (l: TileSpec): TileSpec => { const { drawer: _d, ...rest } = l; return rest; };
  const wrap = (n: any, edge: Dir): any => {
    if (n?.t === "leaf" && n.drawer) return { t: "drawer", edge, open: n.drawer === "over", kid: strip(n) };
    if (n?.t === "tabs" && Array.isArray(n.tabs) && n.tabs.length && n.tabs.every((l: any) => l?.drawer)) return { t: "drawer", edge, open: n.tabs.some((l: any) => l.drawer === "over"), kid: { ...n, tabs: n.tabs.map(strip) } };
    return fix(n);
  };
  const fix = (n: any): any => {
    if (!n || typeof n !== "object") return n;
    if (n.t === "leaf") return n.drawer ? strip(n) : n;
    if (n.t === "tabs") return { ...n, tabs: (n.tabs ?? []).map((l: any) => (l?.drawer ? strip(l) : l)) };
    if (n.t === "drawer") return { ...n, kid: fix(n.kid) };
    const row = n.dir !== "col";
    if (n.a) return { ...n, a: wrap(n.a, row ? "left" : "up"), b: wrap(n.b, row ? "right" : "down") };
    if (Array.isArray(n.kids)) return { ...n, kids: n.kids.map((k: any, i: number) => wrap(k, i === n.kids.length - 1 && i > 0 ? (row ? "right" : "down") : (row ? "left" : "up"))) };
    return n;
  };
  // A whole layout that was one drawer has nothing to slide over: it's just its tiles.
  return { ...spec, root: fix(spec.root) };
}


/**
 * The rule for a tile's name (PIE-491): a letter, then letters, digits, `.`, `-` or `_`, at most 40, and not the
 * shape of an id (`t4` a tile, `s2` a split, `g1` a tab set: one of those letters, then digits). So a name is
 * never a number (`3` and `#3` are the tile numbered 3 on screen), never an id, and never holds the `:` of a
 * `tile:<name>` source. Null when it's a good name, else what's wrong, in words.
 */
export const ID_SHAPE = /^[tsg]\d+$/;
export function tileNameProblem(name: string): string | null {
  if (/^#?\d+$/.test(name)) return `a tile's name isn't a number (${name} would be read as the tile numbered ${name.replace("#", "")} on screen); start it with a letter`;
  if (ID_SHAPE.test(name)) return `a tile's name isn't shaped like an id (${name}: t, s or g and digits are tile, split and tab set ids)`;
  if (/^[A-Za-z][\w.-]{0,39}$/.test(name)) return null;
  return `a tile's name starts with a letter, then letters, digits, . - or _, at most 40 (not ${JSON.stringify(name)}; # is for numbers on screen)`;
}

/**
 * A layout saved before PIE-491 may name a tile with digits (`2`), which now means the tile numbered 2. Each
 * such name becomes the tile's kind (numbered when taken, `detail2`), and the links, sources and focus that
 * named it follow. A spec with good names comes back as it was.
 */
export function migrateNames(spec: LayoutSpec): LayoutSpec {
  const all = savedLeaves(spec.root);
  const bad = all.filter(l => typeof l.name === "string" && tileNameProblem(l.name));
  if (!bad.length) return spec;
  const taken = new Set(all.map(l => l.name).filter((n): n is string => !!n && !tileNameProblem(n)));
  const renamed = new Map<string, string>();
  for (const l of bad) {
    if (renamed.has(l.name!)) continue;
    const kind = /^[A-Za-z]/.test(String(l.kind)) ? String(l.kind) : "tile";
    let n = kind;
    for (let i = 2; taken.has(n); i++) n = `${kind}${i}`;
    taken.add(n); renamed.set(l.name!, n);
  }
  const to = (x: string | undefined) => (x !== undefined && renamed.has(x) ? renamed.get(x)! : x);
  const root = mapLeaves(spec.root, (n: any) => {
    const src = typeof n.source === "string" && n.source.startsWith("tile:") ? `tile:${to(n.source.slice(5))}` : n.source;
    return { ...n, ...(n.name !== undefined ? { name: to(n.name) } : {}), ...(n.link !== undefined ? { link: to(n.link) } : {}), ...(src !== undefined ? { source: src } : {}) };
  });
  return { ...spec, root, ...(typeof spec.focus === "string" ? { focus: to(spec.focus) } : {}) };
}

/**
 * A desk saved from built-in layout `from` before PIE-491 (no tile has an id yet), or a layout saved in
 * layouts.json under a built-in's name then, gets the links that layout has gained since, on tiles of the
 * same name and kind that have none: the daily layout's now tile links to middle, so an agent's
 * `open from=claude` lands in middle, as the Claude mod's `--reader middle` did. Once saved with ids, a link
 * the person took away stays away.
 */
export function migrateLinks(spec: LayoutSpec, from: string | undefined): LayoutSpec {
  const preset = from ? builtin(from) : null;
  const all = savedLeaves(spec.root);
  if (!preset || all.some(l => l.id)) return spec;
  const names = new Set(all.map(l => l.name));
  const want = new Map(savedLeaves(preset.root).filter(l => l.name && l.link).map(l => [l.name!, l] as const));
  const root = mapLeaves(spec.root, (l: TileSpec) => {
    const w = l.name ? want.get(l.name) : undefined;
    return !l.link && w && w.kind === l.kind && names.has(w.link) && w.link !== l.name ? { ...l, link: w.link } : l;
  });
  return { ...spec, root };
}

/**
 * A tile has one home (PIE-513): the agent lives in the host layer's drawer, above every screen, so a layout saved
 * with the daily agent tile comes back without it, and its screen lets the host layer sit beside it (`host:
 * beside`, where the tile was) unless it says otherwise. The agent tile is one flagged `agent`; in a layout named
 * `daily` saved before the flag, a pty tile named `claude` whose command is exactly `["claude"]`. A terminal the
 * person made themselves (any other command) is theirs, and stays.
 */
export function withoutAgentTile(spec: LayoutSpec, from: string | undefined): LayoutSpec {
  const isAgent = (l: TileSpec) => !!l.agent || (from === "daily" && l.kind === "pty" && l.name === "claude" && l.cmd?.length === 1 && l.cmd[0] === "claude");
  const floats = Array.isArray(spec.floats) ? spec.floats : [];
  const gone = [...savedLeaves(spec.root), ...floats.map(f => f.tile)].filter(l => l && isAgent(l));
  if (!gone.length) return spec;
  // Nothing but the agent: the desk as it always opened (a second attach to the agent is never made).
  const root = dropLeaves(spec.root, isAgent) ?? builtin("desk")!.root;
  const names = new Set(gone.map(l => l.name));
  const tidy = mapLeaves(root, l => (l.link && names.has(l.link) ? (({ link: _l, ...rest }) => rest)(l) : l));
  const kept = floats.filter(f => !(f.tile && isAgent(f.tile)));
  return {
    ...spec, root: tidy, policy: { host: "beside", ...(spec.policy ?? {}) }, ...(Array.isArray(spec.floats) ? { floats: kept } : {}),
    ...(typeof spec.focus === "string" && names.has(spec.focus) ? { focus: undefined } : {}),
  };
}

/** A saved tree with the tiles `gone` says left out (a split left one kid, a tab set or drawer left none, give way). */
function dropLeaves(root: SavedTree, gone: (l: TileSpec) => boolean): SavedTree | null {
  const drop = (n: any): any => {
    if (!n || typeof n !== "object") return n;
    if (n.t === "leaf") return gone(n) ? null : n;
    if (n.a || n.b) { const a = drop(n.a), b = drop(n.b); return a && b ? { ...n, a, b } : a ?? b; }
    if (n.t === "tabs") { const tabs = (Array.isArray(n.tabs) ? n.tabs : []).filter((l: any) => !(l?.t === "leaf" && gone(l))); return tabs.length ? { ...n, tabs, active: Math.max(0, Math.min(Number(n.active) || 0, tabs.length - 1)) } : null; }
    if (n.t === "drawer") { const kid = drop(n.kid); return kid ? { ...n, kid } : null; }
    if (Array.isArray(n.kids)) {
      const kids: any[] = [], weights: number[] = [];
      n.kids.forEach((k: any, i: number) => { const r = drop(k); if (r) { kids.push(r); if (Array.isArray(n.weights)) weights.push(n.weights[i]); } });
      if (!kids.length && n.t !== "columns") return null;
      return { ...n, kids, ...(Array.isArray(n.weights) ? { weights } : {}) };
    }
    return n;
  };
  return drop(root);
}

/** Every tile spec in a saved tree (either form, tab sets too). */
function savedLeaves(root: SavedTree): TileSpec[] {
  const all: TileSpec[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.t === "leaf") { all.push(n); return; }
    for (const k of [n.a, n.b, n.kid, ...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : [])]) walk(k);
  };
  walk(root);
  return all;
}

/** A saved tree with each tile spec replaced by `f`'s (a copy; the tree it was given is left as it was). */
function mapLeaves(root: SavedTree, f: (l: TileSpec) => TileSpec): SavedTree {
  const fix = (n: any): any => {
    if (!n || typeof n !== "object") return n;
    if (n.t === "leaf") return f(n);
    return { ...n, ...(n.a ? { a: fix(n.a), b: fix(n.b) } : {}), ...(n.kid ? { kid: fix(n.kid) } : {}), ...(Array.isArray(n.kids) ? { kids: n.kids.map(fix) } : {}), ...(Array.isArray(n.tabs) ? { tabs: n.tabs.map(fix) } : {}) };
  };
  return fix(root);
}


/** The kinds a tile can be: every kind in the registry, built-ins first. */
export const tileKindNames = (): string[] => tileKinds().map(k => k.kind);

/**
 * Build a tile from its spec, by its kind's registry entry. A kind nobody registers here (an extension's, not
 * loaded yet or gone) is a tile that says so and runs nothing; the desk keeps its spec and makes it again when
 * the kind comes.
 */
export function makeTile(s: Partial<TileSpec> & { kind: TileKindName }): Pane {
  const k = tileKind(s.kind);
  if (!k) return new UnavailableTile(s.kind, missingKind(s.kind), s.state ?? {});
  return k.make(k.revive ? (k.revive({ t: "leaf", ...s } as TileSpec) as typeof s) : s);
}
export { isTileKind };

/** A reader that keeps its note: opened on purpose, the current note never moves it (the board's detail). */
export class DetailPane extends ReaderPane {
  override readonly kind: TileKindName = "detail";
  /** The note it should show once the desk can read it (a restored layout). */
  want: string | null = null;
  /** The page it's pinned to, if any: it shows that page each time it starts, not the last note it held. */
  page: string | null = null;
  constructor() { super(true); this.holdOn(); }
  override title(): string { return this.msg ? "detail" : "detail · empty"; }
  override select() {}
  spec(): Record<string, unknown> { return this.page ? { page: this.page } : this.msg ? { note: this.msg.id } : this.want ? { note: this.want } : {}; }
}

export const shell = () => process.env.SHELL || "sh";
/** The editor the daily layout starts: $VISUAL, $EDITOR, nvim where it's installed, else vi. */
export const editor = () => process.env.VISUAL || process.env.EDITOR || (Bun.which("nvim") ? "nvim" : "vi");
/** A command line as words (the daily agent's EP0CH_DAILY_AGENT, "claude" by default). */
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** The daily agent's program and folder, read now: EP0CH_DAILY_AGENT ("claude" unset) and EP0CH_DAILY_CWD (~ allowed; unset, the door's own folder). */
export function dailyAgent(): { cmd: string[]; cwd?: string } {
  const cmd = words(process.env.EP0CH_DAILY_AGENT || "claude");
  const cwd = process.env.EP0CH_DAILY_CWD?.trim().replace(/^~(?=$|\/)/, homedir());
  return { cmd: cmd.length ? cmd : ["claude"], ...(cwd ? { cwd } : {}) };
}

/** The daily scratch file the editor tile opens: EP0CH_DAILY_DRAFT, or scratch.md in the door's state. */
export function dailyDraft(): string {
  const p = process.env.EP0CH_DAILY_DRAFT || join(stateDir(), "scratch.md");
  if (!existsSync(p)) try { writeFileSync(p, `# scratch\n\nWritten in the editor tile. The preview beside it follows each save.\n`); } catch { /* the editor makes it */ }
  return p;
}

const T = (kind: TileKindName, name: string, more: Partial<TileSpec> = {}): LNode<TileSpec> => leaf({ t: "leaf", kind, name, ...more });
/** A tree of tile specs as a layout saves it (a spec built in code: the board's, the built-in layouts). */
export const savedTree = (n: LNode<TileSpec>): SavedTree => serializeTree(n, l => l) as SavedTree;

/**
 * The built-in layouts, as trees of tile specs:
 * - `daily`: Evan's arrangement (the 2026-09-29 screenshots). The "now" detail on the left; the outline tree over
 *   its preview, above the middle detail; the editor on the scratch draft over a third detail on the right. The
 *   tree, the "now" detail and the right detail open into the middle one. The agent is the host layer's, pulled
 *   up beside the desk (alt+a), not a tile here.
 * - `river`: the River screen (Quay) in a tile, its columns and open rule its own, a preview following what
 *   it selects beside it. One implementation of the river: the screen's (see docs/UI-GRAMMAR.md §7).
 * - `board`: the kanban as a tile, its selection followed by a preview tile that can go anywhere.
 * - `desk`: the desk as it has always opened.
 */
export function builtin(name: string): LayoutSpec | null {
  const serial = savedTree;
  if (name === "daily") {
    const draft = dailyDraft();
    return {
      // The agent is the host layer's (alt+a), beside the desk, never a tile of its own here (PIE-513).
      name, rule: "current", focus: "tree", policy: { host: "beside" },
      root: serial(splitOf("row", [
        T("detail", "now", { link: "middle", page: nowPage().address }),
        splitOf("col", [splitOf("col", [T("tree", "tree", { link: "middle" }), T("preview", "preview", { source: "tile:tree" })], [0.6, 0.4]), T("detail", "middle")], [0.6, 0.4]),
        splitOf("col", [T("pty", "draft", { cmd: [...words(editor()), draft], file: draft }), T("detail", "side", { link: "middle" })], [0.6, 0.4]),
      ], [0.34, 0.33, 0.33])),
    };
  }
  if (name === "river") return { name, rule: "current", focus: "river", root: serial(splitOf("row", [T("river", "river"), T("preview", "card", { source: "tile:river" })], [0.7, 0.3])) };
  if (name === "board") return { name, rule: "current", focus: "board", root: serial(splitOf("col", [T("board", "board", { preview: false }), splitOf("row", [T("preview", "card", { source: "tile:board" }), T("detail", "detail")], [0.5, 0.5])], [0.62, 0.38])) };
  if (name === "desk") return { name, rule: "current", focus: 2, root: serial(splitOf("row", [T("tree", "tree"), splitOf("row", [T("reader", "reader"), splitOf("col", [T("thread", "thread"), T("activity", "activity")], [0.58, 0.42])], [0.66, 0.34])], [0.24, 0.76])) };
  return null;
}
export const BUILTIN = ["daily", "river", "board", "desk"] as const;

/** layouts.json: every layout saved by name. */
type Saved = Record<string, LayoutSpec>;
export function savedLayouts(): Saved { const s = readState<Saved>("layouts.json"); return s && typeof s === "object" ? s : {}; }
export function saveLayout(name: string, spec: LayoutSpec) { const all = savedLayouts(); all[name] = { ...spec, name }; writeState("layouts.json", all); }
/** A layout by name: the one saved under it, else the built-in. */
export function layoutNamed(name: string): { spec: LayoutSpec; saved: boolean } | null {
  const s = savedLayouts()[name];
  if (s?.root) return { spec: withoutAgentTile(migrateLinks(s, name), name), saved: true };
  const b = builtin(name);
  return b ? { spec: b, saved: false } : null;
}
export function layoutNames(): { name: string; saved: boolean; builtin: boolean }[] {
  const saved = Object.keys(savedLayouts());
  return [...new Set([...BUILTIN, ...saved])].map(name => ({ name, saved: saved.includes(name), builtin: (BUILTIN as readonly string[]).includes(name) }));
}

// The built-in kinds register as the door starts (an extension's join the same registry later).
registerBuiltinTiles();
