// Tiles and named layouts (PIE-413, PIE-474). A tile is a view in the layout tree: the outline tree, a
// reader that follows the current note, a detail that keeps its note, a preview following a tile or a
// file, a program in a terminal, a whole screen (board, river), the brief, and the desk's other panes. A
// layout is the tree of splits and tab sets over tiles, with each tile's name, where its opens land (its
// link), whether it slides over as a dock, and the layout's open rule. It is data: a screen saved by name is a
// screen note in the outline (PIE-565, src/desk/screen-notes.ts), its layout one `layout.load` lays a screen out
// as; the built-in layouts below are the others.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../state";
import { screenNote, screenNotes } from "./screen-notes";
import { resolveScreen } from "./screen-spec";
import { subject } from "../board";
import { leaf, serializeTree, splitOf, type LNode, type NaryForm, type BinaryForm, type Policy } from "./screen-layout";
import { ReaderPane, type Pane } from "./panes";
import { nowPage } from "../hub/now";
import { isTileKind, missingKind, tileKind, tileKinds, UnavailableTile, type TileKindName } from "./tile-kinds";
import { registerBuiltinTiles } from "./builtin-tiles";

/** One tile as saved: what it is, its name, and what it needs to be built again. */
export interface TileSpec {
  t: "leaf";
  /** Its kind: a name in the tile-kind registry (an extension's too). */
  kind: TileKindName;
  /** The tile's name: what links, previews, `act tile=` and `peek` call it. See `tileNameProblem`. */
  name?: string;
  /** Its id (`t<n>`, PIE-491), kept so a restarted door gives the tile the same one. */
  id?: string;
  /** A held reader's note (block id): it starts on it and keeps it. */
  note?: string;
  /** How a reader shows notes (PIE-705): omitted it follows the current note; `held` keeps `note`; `pinned` keeps the page named by `page`. */
  mode?: "held" | "pinned";
  /** A reader's place and back and forward stacks (NoteSurface.saveNav, PIE-643): read by version, dropped when it isn't this one's. */
  nav?: unknown;
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
  link?: string;
  /** What that link does when it isn't the kind's default (PIE-646): `preview` follows the source's selection too, `target` is only opened into. */
  linkRole?: "preview" | "target";
  /** A service-drawn tile's saved state (an extension's kind): what its service needs to draw it again. */
  state?: Record<string, unknown>;
  /** A query tile's view (PIE-511): the block id of the saved view (a virtual branch) whose cards it lists. */
  view?: string;
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
  /** A backlinks tile whose groups start open (the welcome's). */
  groups?: "open";
  /** The link groups a backlinks tile lists (PIE-693), comma-separated (`children`: the thread tile's replies); left out, every group. */
  linkGroups?: string;
}
export type SavedTree = BinaryForm<TileSpec> | NaryForm<TileSpec>;

/**
 * Where an open from a tile goes when it has no link: the current note, or (`next`) a new column after its own in
 * its flow. A layout's `rule` is read into its screen policy's `opens` (PIE-513: the open rule is policy now).
 */
export type { OpenRule } from "./screen-layout";
import type { OpenRule } from "./screen-layout";
import { words } from "../text";
/**
 * A layout (a screen): its tree of containers and tiles, the focus, the open rule, and the screen's own policy
 * (the outermost container's: `locked` there locks the whole screen, PIE-505).
 */
export interface LayoutSpec { root: SavedTree; focus?: string | number; rule?: OpenRule; name?: string; policy?: Policy; floats?: SavedFloat[] }
/** A float as saved (PIE-511): its tile, and its rectangle. */
export interface SavedFloat { tile: TileSpec; rect: { col: number; row: number; cols: number; rows: number } }

/**
 * The rule for a tile's name (PIE-491): a letter, then letters, digits, `.`, `-` or `_`, at most 40, and not the
 * shape of an id (`t4` a tile, `s2` a split, `g1` a tab set: one of those letters, then digits). So a name is
 * never a number (`3` and `#3` are the tile numbered 3 on screen), never an id, and never holds the `:` of a
 * `tile:<name>` source. Null when it's a good name, else what's wrong, in words.
 */
export const ID_SHAPE = /^[tsgk]\d+$/;
export function tileNameProblem(name: string): string | null {
  if (/^#?\d+$/.test(name)) return `a tile's name isn't a number (${name} would be read as the tile numbered ${name.replace("#", "")} on screen); start it with a letter`;
  if (ID_SHAPE.test(name)) return `a tile's name isn't shaped like an id (${name}: t, s, g or k and digits are tile, split, tab set and drawer tile ids)`;
  if (/^[A-Za-z][\w.-]{0,39}$/.test(name)) return null;
  return `a tile's name starts with a letter, then letters, digits, . - or _, at most 40 (not ${JSON.stringify(name)}; # is for numbers on screen)`;
}

/** The kinds a tile can be: every kind in the registry, built-ins first. */
export const tileKindNames = (): string[] => tileKinds().map(k => k.kind);

/**
 * Build a tile from its spec, by its kind's registry entry. A kind nobody registers here (an extension's, not
 * loaded yet or gone) is a tile that says so and runs nothing; the desk keeps its spec and makes it again when
 * the kind comes.
 */
export function makeTile(given: Partial<TileSpec> & { kind: TileKindName }): Pane {
  const s = canonSpec(given);
  const k = tileKind(s.kind);
  if (!k) return new UnavailableTile(s.kind, missingKind(s.kind), s.state ?? {});
  return k.make(s);
}
export { isTileKind };

/**
 * A spec as a saved layout, a screen spec or an agent wrote it, in the kinds there are now. `detail` was a kind of its
 * own (PIE-705): it reads as a reader that starts held, or pinned when it names a `page`.
 */
export function canonSpec<S extends { kind: TileKindName; page?: string; mode?: "held" | "pinned" }>(s: S): S {
  if (s.kind !== "detail") return s;
  return { ...s, kind: "reader", mode: s.mode ?? (s.page ? "pinned" : "held") };
}

export const shell = () => process.env.SHELL || "sh";
/** The editor the daily layout starts: $VISUAL, $EDITOR, nvim where it's installed, else vi. */
export const editor = () => process.env.VISUAL || process.env.EDITOR || (Bun.which("nvim") ? "nvim" : "vi");

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
        T("reader", "now", { link: "middle", mode: "pinned", page: nowPage().address }),
        splitOf("col", [splitOf("col", [T("tree", "tree", { link: "middle" }), T("preview", "preview", { source: "tile:tree" })], [0.6, 0.4]), T("reader", "middle", { mode: "held" })], [0.6, 0.4]),
        splitOf("col", [T("pty", "draft", { cmd: [...words(editor()), draft], file: draft }), T("reader", "side", { link: "middle", mode: "held" })], [0.6, 0.4]),
      ], [0.34, 0.33, 0.33])),
    };
  }
  // The river's columns are a flow on the desk itself (PIE-515), a preview following whichever column the keys are in.
  if (name === "river") return { name, rule: "current", focus: "library", root: { t: "split", dir: "row", weights: [0.7, 0.3], kids: [{ t: "flow", key: "river", kids: [{ t: "leaf", kind: "river.column", name: "library", source: "roots" }] }, { t: "leaf", kind: "preview", name: "card", source: "tile:river" }] } as SavedTree };
  if (name === "board") return { name, rule: "current", focus: "board", root: serial(splitOf("col", [T("board", "board", { preview: false }), splitOf("row", [T("preview", "card", { source: "tile:board" }), T("detail", "detail")], [0.5, 0.5])], [0.62, 0.38])) };
  if (name === "desk") return { name, rule: "current", focus: "reader", root: serial(splitOf("row", [T("tree", "tree"), splitOf("row", [T("reader", "reader"), splitOf("col", [T("backlinks", "replies", { source: "tile:reader", linkGroups: "children" }), T("activity", "activity")], [0.58, 0.42])], [0.66, 0.34])], [0.24, 0.76])) };
  return null;
}
export const BUILTIN = ["daily", "river", "board", "desk"] as const;

/** A layout by name: a screen note's (a screen a person made, PIE-565), else the built-in. */
export function layoutNamed(asked: string): { spec: LayoutSpec; saved: boolean } | null {
  const name = (screenNote(asked) ? asked : resolveScreen(asked)) ?? asked;
  const n = screenNote(name);
  if (n) return { spec: { ...n.spec.layout, name }, saved: true };
  const b = builtin(name);
  return b ? { spec: b, saved: false } : null;
}
/** Every layout a screen can be laid out as: the built-ins, then the screens people made (a note may take a built-in layout's name: daily). */
export function layoutNames(): { name: string; title: string; saved: boolean; builtin: boolean }[] {
  const saved = screenNotes().map(n => n.name);
  return [...new Set([...BUILTIN, ...saved])].map(name => ({ name, title: screenNote(name)?.title ?? name, saved: saved.includes(name), builtin: (BUILTIN as readonly string[]).includes(name) }));
}

// The built-in kinds register as the door starts (an extension's join the same registry later).
registerBuiltinTiles();
