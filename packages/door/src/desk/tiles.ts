// Tiles and named layouts (PIE-413, PIE-474). A tile is a view in the layout tree: the outline tree, a
// reader (a detail) that keeps the note opened into it, pinned or not, a preview following a tile or a
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
import { leaf, serializeTree, splitOf, type LNode } from "./screen-layout";
import { type Pane } from "./panes";
import { isTileHeader } from "../surface/note";
import { nowPage } from "../hub/now";
import { isTileKind, missingKind, resolveKind, tileKind, tileKinds, UnavailableTile, type TileKindName } from "./tile-kinds";
import { registerBuiltinTiles } from "./builtin-tiles";
import { tileRegistry } from "./tile-registry";

// A tile as saved (TileSpec), a layout as saved (LayoutSpec) and the rule for a tile's name are outline-core's
// (screen-spec.ts): what every client that reads a screen shares.
export { ID_SHAPE, tileNameProblem, type LayoutSpec, type SavedFloat, type SavedTree, type TileSpec } from "@ep0ch/outline-core/screen-spec";
import { canonLeaf, type LayoutSpec, type SavedTree, type TileSpec } from "@ep0ch/outline-core/screen-spec";

/**
 * Where an open from a tile goes when it has no link: the first reader that isn't pinned, (`next`) a new column after
 * its own in its flow, or (`beside`) a reader beside it. A layout's `rule` is read into its screen policy's `opens` (PIE-513: the open rule is policy now).
 */
export type { OpenRule } from "./screen-layout";
import { words } from "../text";

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
  const p = k.make(s);
  p.deliberate = s.deliberate ?? p.deliberate;
  tileRegistry.restore(p, { role: s.role, openedFrom: s.openedFrom, copiedFrom: s.copiedFrom });
  p.writtenTitle = s.writtenTitle;
  p.systemTitle = s.systemTitle;
  p.tileHeader = isTileHeader(s.header) ? s.header : undefined;
  return p;
}
export { isTileKind };

/**
 * A spec as a saved layout, a screen spec or an agent wrote it, in the kinds there are now. `detail` was a kind of its
 * own (PIE-705): it reads as a reader that starts held, or pinned when it names a `page`.
 */
export function canonSpec<S extends { kind: TileKindName; page?: string; mode?: string; note?: string; nav?: unknown; wasFollowing?: boolean; link?: string; linkRole?: string; source?: string; wires?: TileSpec["wires"]; selectFrom?: string }>(s: S): S & { selectFrom?: string } {
  const { link, linkRole, ...rest } = s;
  const out = { ...rest, ...(link ? { wires: [...(s.wires ?? []), ...(!s.wires?.some(w => w.verb === "open") ? [{ verb: "open" as const, to: link }] : []), ...(!s.wires?.some(w => w.verb === "select") && (linkRole ?? (s.kind === "backlinks" ? "target" : "preview")) === "preview" ? [{ verb: "select" as const, to: link }] : [])] } : {}) };
  // `detail` and `pinned` are readers, with what each name said as fields: outline-core's one reading of the two
  // (canonLeaf), which `screens.list` serves a screen note's tiles by too. A `pinned` that names no page is pinned to
  // this door's "now" page.
  const was = out.kind;
  Object.assign(out, canonLeaf(out));
  if (was === "pinned") out.page ??= nowPage().address;
  // The kinds that were a second copy of another (PIE-1528) keep what they were as that kind's own fields; the kind's
  // `replaces` (resolveKind, below) gives the name. thread: the links tile with Children alone; tags: the facets tile
  // opened on the tags facet, with no calendar; board and river: the screen mount.
  const o = out as typeof out & { linkGroups?: string; args?: Record<string, unknown>; screen?: string; label?: string };
  if (out.kind === "thread") o.linkGroups ??= "children";
  else if (out.kind === "tags") o.args = { open: ["tag"], calendar: false, ...o.args };
  else if (out.kind === "board" || out.kind === "river") o.screen ||= out.kind;
  // A retired kind another kind replaces (PIE-1514) reads as that kind, and saves under it.
  out.kind = resolveKind(out.kind);
  // The reader modes before the pin (PIE-1207): `held` is any reader now (it names a new tile a detail, and the reader
  // ignores it); one that followed the current note (saved with its place and no note and no mode, or `mode: follows`)
  // loads on the note it showed, and the desk wires a list to it once.
  if (out.kind === "reader" && out.mode === "follows") { out.wasFollowing = true; delete out.mode; }
  else if (out.kind === "reader" && out.mode === undefined && out.note === undefined && out.nav !== undefined) out.wasFollowing = true;
  if (out.kind === "preview" && out.source?.startsWith("tile:")) {
    out.selectFrom = out.source.slice(5);
    delete out.source;
  }
  return out as S;
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
      name, focus: "tree", policy: { host: "beside" },
      root: serial(splitOf("row", [
        T("reader", "now", { link: "middle", mode: "pinned", page: nowPage().address }),
        splitOf("col", [splitOf("col", [T("tree", "tree", { wires: [{ verb: "open", to: "middle" }] }), T("preview", "preview", { source: "tile:tree" })], [0.6, 0.4]), T("reader", "middle")], [0.6, 0.4]),
        splitOf("col", [T("pty", "draft", { cmd: [...words(editor()), draft], file: draft }), T("reader", "side", { link: "middle" })], [0.6, 0.4]),
      ], [0.34, 0.33, 0.33])),
    };
  }
  // The river's columns are a flow on the desk itself (PIE-515), a preview following whichever column the keys are in.
  if (name === "river") return { name, focus: "library", root: { t: "split", dir: "row", weights: [0.7, 0.3], kids: [{ t: "flow", key: "river", kids: [{ t: "leaf", kind: "river.column", name: "library", source: "roots" }] }, { t: "leaf", kind: "preview", name: "card", source: "tile:river" }] } as SavedTree };
  if (name === "board") return { name, focus: "board", root: serial(splitOf("col", [T("screen", "board", { screen: "board", preview: false }), splitOf("row", [T("preview", "card", { source: "tile:board" }), T("detail", "detail")], [0.5, 0.5])], [0.62, 0.38])) };
  if (name === "desk") return { name, focus: "reader", root: serial(splitOf("row", [T("tree", "tree", { wires: [{ verb: "select", to: "reader" }] }), splitOf("row", [T("reader", "reader"), splitOf("col", [T("backlinks", "replies", { source: "tile:reader", linkGroups: "children", subject: "follows" }), T("activity", "activity")], [0.58, 0.42])], [0.66, 0.34])], [0.24, 0.76])) };
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
