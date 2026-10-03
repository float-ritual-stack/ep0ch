// `ep0ch find` and `ep0ch show`: the outline's notes for programs outside the door (a picker's channel, a script, an
// agent's shell). Which outline is the one rule every client applies (`--ws`, `--machine`, EP0CH_WS, EP0CH_SOCKET,
// the folder's `.ep0ch`: resolveTarget). Nothing here writes.
//
// `find <words>` asks the service's forgiving ranker (`tree.search`, Goto's: punctuation folded, any word order,
// typos), best first. `find` with no words lists every note, newest first, for a picker that filters as it's typed
// (television runs its source once and matches locally); the path is the note's ancestors' titles from the tree index.
// `find --tree [<root>]` lists them as the outline holds them: the tree index in the service's own order (depth first,
// children by position, as Tree draws it), each row with its depth and the `├─ │ └─` that draw it.
//
// `show <id>…` draws each note as a reader draws it: the note surface (`NoteSurface.render`), at the width asked for,
// in the person's theme, its live figures and `::links` answered by the outline (connectFigures, as the door's App
// connects them), folded callouts unfolded (no key works in what it prints), a view note followed by its results as
// the reader draws them (viewResults), never a second renderer. `--ansi` keeps its colours;
// without it, plain text. `--cells` prints the same drawing as JSON cells (src/cells.ts) for a program that paints a
// grid: a Claude Code mod's Raster. `--source` prints each note's text as written, for a file to keep.
import { linesToCells } from "./cells";
import { connectFigures } from "./graphs";
import { resolveTarget } from "./discover";
import { redundantLabel } from "./authored";
import { forwardTo } from "./machine";
import { summarySegments } from "./props";
import { previewTitle, SocketBoard, type IndexBlock } from "./socket";
import { readState } from "./state";
import { MARKS, TAGS, visible } from "./style";
import { NoteSurface, type SurfaceHost } from "./surface/note";
import { blockIdOf, paintable, printable } from "./text";
import { setTheme, startTheme } from "./theme";
import type { Ctx } from "./app";

export const NOTES_USAGE = `  ep0ch find [<words>… | --recent | --tree [<root id>]] [--lines | --json] [--ws <name>] [--machine <ssh-name>]
                                   notes: with words, the service's ranked search, tree.search (the ranker
                                   Goto, the door's / and (( use, asked from no note and without Jev; at
                                   most 30); --recent, its newest 30; --tree, the outline (or the notes under
                                   <root id>) depth first, as Tree draws it; without, every note, newest first.
                                   --lines prints one per line, id<TAB>title<TAB>path, for a picker; with --tree,
                                   then <TAB>depth<TAB>glyphs<TAB>about (├─ │ └─; about: work-id · stage · type)
  ep0ch show <id>… [--source | --ansi | --cells] [--width <n>] [--rows <n>] [--ws <name>] [--machine <ssh-name>]
                                   each note drawn as a reader draws it, at that width (default the terminal's,
                                   else 80), live figures, ::links and a view's results answered by the
                                   outline, folded callouts open, a blank line between notes; --source prints each note's text exactly as written
                                   (properties, links and :: blocks verbatim, no header, no wrapping), a ---
                                   line between notes; --ansi keeps the drawing's colours; --cells prints each
                                   as a line of JSON {id, columns, rows, cells, replaced}: cells row-major,
                                   base64 of u32 LE [codePoint, fg, bg] (0x00RRGGBB, 0x01000000 the
                                   terminal's own), one width-1 BMP glyph a cell, U+FFFD for a wider one
                                   (counted in replaced); --rows keeps the first n rows`;

/** One note as `find` lists it. */
export interface Found { id: string; title: string; path: string }

/** A field of a `--lines` row: one line, no tabs. */
const field = (s: string) => printable(s.replace(/[\t\r\n]+/g, " ")).trim();

/** The `--lines` form: id, title, path, tab-separated. */
export const foundLine = (f: Found) => [f.id, field(f.title), field(f.path)].join("\t");

/** Every note in the tree index, newest first: its title (the preview's first line) and its ancestors' titles as its path (` › `, as the service's). */
/** A note's ancestors' titles as its path (` › `, as the service's), from the tree index by id. */
function pathsOf(index: readonly IndexBlock[]): (b: IndexBlock) => string {
  const by = new Map(index.map(b => [b.id, b]));
  return b => {
    const up: string[] = [];
    const seen = new Set([b.id]);
    for (let p = b.parentId; p && !seen.has(p) && up.length < 12; p = by.get(p)?.parentId ?? null) {
      seen.add(p);
      const a = by.get(p);
      if (!a) break;
      up.unshift(previewTitle(a.title).slice(0, 90));
    }
    return up.join(" › ").slice(-500);
  };
}

/** Every note in the tree index, newest first: its title (the preview's first line) and its ancestors' titles as its path. */
export function everyNote(index: readonly IndexBlock[]): Found[] {
  const pathOf = pathsOf(index);
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(b => ({ id: b.id, title: previewTitle(b.title), path: pathOf(b) }));
}

/** One row of `find --tree`: a note, its depth under the root, the glyphs that draw its place, and what it is. */
export interface TreeFound extends Found { depth: number; glyphs: string; about: string }

/** Levels drawn before the indent is elided (`…<depth>` stands for the rest): ten levels is thirty columns. */
export const TREE_LEVELS = 10;

/** What a note is, beside its title: its work id (unless the title starts with it), stage and type: Detail's summary, its values. */
const ABOUT_KEYS = ["work-id", "work-stage", "stage", "type"];
const aboutOf = (props: Record<string, string>, title: string) =>
  summarySegments(Object.entries(props).map(([key, value]) => ({ key, value })), ABOUT_KEYS)
    .filter(s => !(s.key === "work-id" && redundantLabel(s.value, title))).map(s => field(s.value)).join(" · ");

/**
 * The outline as a tree, from the index in the service's order (`SocketBoard.index`: its one walk, depth first): every
 * note, or `root` and the notes under it (the root at depth 0). Each row's glyphs are its ancestors' rails (`│  ` while
 * that ancestor has a later sibling) and its own branch (`├─ `, or `└─ ` for the last child); a top-level note has none.
 * Past `levels` deep, the outer rails go and `…<depth> ` stands for them, so a deep row keeps its title in view.
 * Null when there's no `root` (its whole id).
 */
export function treeOf(index: readonly IndexBlock[], root?: string, levels = TREE_LEVELS): TreeFound[] | null {
  let rows = index;
  if (root) {
    const i = index.findIndex(b => b.id === root);
    if (i < 0) return null;
    const d0 = index[i]!.depth;
    let end = i + 1;
    while (end < index.length && index[end]!.depth > d0) end++;
    rows = index.slice(i, end).map(b => ({ ...b, depth: b.depth - d0 }));
  }
  // Last among its siblings: walking back, a row is last when no later row at its depth came before a shallower one.
  const last: boolean[] = new Array(rows.length);
  const later: boolean[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = rows[i]!.depth;
    last[i] = !later[d];
    later[d] = true;
    later.length = d + 1;
  }
  const pathOf = pathsOf(index);
  const open: boolean[] = [];    // open[k]: the ancestor at depth k has a later sibling, so its rail goes on down
  return rows.map((b, i) => {
    const d = b.depth;
    open[d] = !last[i];
    const rails = open.slice(1, d).map(o => (o ? "│  " : "   "));
    const kept = rails.length > levels - 1 ? [`…${d}`.padEnd(3) + " ", ...rails.slice(rails.length - (levels - 2))] : rails;
    const glyphs = d === 0 ? "" : kept.join("") + (last[i] ? "└─ " : "├─ ");
    const title = previewTitle(b.title);
    return { id: b.id, title, path: pathOf(b), depth: d, glyphs, about: aboutOf(b.props, title) };
  });
}

/** The `--tree --lines` form: id, title, path, depth, glyphs, about, tab-separated. */
export const treeLine = (f: TreeFound) => [foundLine(f), String(f.depth), f.glyphs, field(f.about)].join("\t");

/** A flag's value, or why it's missing. */
function flag(args: string[], name: string): string | undefined | { error: string } {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const v = args[at + 1];
  return v === undefined || v.startsWith("--") ? { error: `${name} needs a value` } : v;
}

/** The arguments with these flags (and their values) taken out. */
const without = (args: string[], valued: string[], bare: string[]) =>
  args.filter((a, i) => !valued.includes(a) && !valued.includes(args[i - 1] ?? "") && !bare.includes(a));

/** The board of the outline the rule names, its protocol checked; or why not. */
async function boardFor(args: string[]): Promise<SocketBoard | { error: string }> {
  // Only the flags that name an outline: a search word with a `/` isn't a socket path.
  const named = ["--ws", "--machine"].flatMap(f => { const at = args.indexOf(f); return at >= 0 ? [f, args[at + 1]!] : []; });
  const target = resolveTarget(named);
  if ("error" in target) return target;
  if ("unnamed" in target) return { error: `no outline is named here (${target.unnamed}); pass --ws <name>` };
  if (target.machine) {
    try { await forwardTo(target.machine); } catch (e) { return { error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }; }
  }
  const board = new SocketBoard(target.path, undefined, target.outline);
  try { await board.info(); }
  catch (e) { board.close(); return { error: `no carrier on ${target.path}: ${(e as Error).message}` }; }
  return board;
}

export interface Out { out: (s: string) => void; err: (s: string) => void; columns?: number; tty?: boolean }

/** `ep0ch find …`: its exit code. */
export async function findCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  const lines = args.includes("--lines"), json = args.includes("--json"), recent = args.includes("--recent");
  if (lines && json) { io.err("ep0ch: find prints --lines or --json, not both"); return 2; }
  for (const f of ["--ws", "--machine"]) { const v = flag(args, f); if (typeof v === "object") { io.err(`ep0ch: ${v.error}`); return 2; } }
  // --tree takes the root's id as its value when one follows.
  const treeAt = args.indexOf("--tree"), tree = treeAt >= 0;
  const root = tree && args[treeAt + 1] !== undefined && !args[treeAt + 1]!.startsWith("--") ? blockIdOf(args[treeAt + 1]!) : undefined;
  const words = without(args, ["--ws", "--machine", ...(root !== undefined ? ["--tree"] : [])], ["--lines", "--json", "--recent", "--tree"]);
  if (recent && words.length) { io.err("ep0ch: find --recent takes no words"); return 2; }
  if (tree && (recent || words.length)) { io.err("ep0ch: find --tree takes a root id at most, and no words or --recent"); return 2; }
  const unknown = words.find(w => w.startsWith("--"));
  if (unknown) { io.err(`ep0ch: find doesn't take ${unknown}\n${NOTES_USAGE}`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    if (tree) {
      const rows = treeOf(await board.index(), root);
      if (!rows) { io.err(`ep0ch: no note ${root} in this outline`); return 1; }
      if (json) io.out(JSON.stringify(rows, null, 2));
      else if (lines) { for (const f of rows) io.out(treeLine(f)); }
      else if (!rows.length) io.out("the outline has no notes");
      else for (const f of rows) io.out(`${f.id.slice(0, 8)}  ${f.glyphs}${field(f.title)}${f.about ? `  · ${f.about}` : ""}`);
      return 0;
    }
    const query = words.join(" ").trim();
    // --recent: the service's own answer to an empty search (the newest notes), without reading the whole index.
    const found = query || recent ? (await board.searchBlocks(query)).matches.map(m => ({ id: m.block.id, title: m.title, path: m.path })) : everyNote(await board.index());
    if (json) io.out(JSON.stringify(found, null, 2));
    else if (lines) { for (const f of found) io.out(foundLine(f)); }
    else if (!found.length) io.out(query ? `nothing matches ${query}` : "the outline has no notes");
    else for (const f of found) io.out(`${f.id.slice(0, 8)}  ${field(f.title)}${f.path ? `  · ${field(f.path)}` : ""}`);
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}

/** How long `show` waits for what a reader reads after the note (link titles, embeds, steps, projections) to stop arriving. */
const SETTLE = { quiet: 250, max: 3000 };

/**
 * The note drawn by the note surface at `width`, once what it reads besides the note has arrived (each render may ask
 * for more: it's drawn again until a quiet spell passes with nothing new); null when there's no such note.
 */
export async function drawNote(board: SocketBoard, id: string, width: number, settle = SETTLE): Promise<string[] | null> {
  const m = await board.get(id);
  if (!m) return null;
  let arrived = false;
  // A reader's host with nothing else to host: no graphics (an image is named on its line), no history, no keys.
  const ctx = { board, t: { cols: width, rows: 1000, cellW: 9, cellH: 18, kitty: false }, graphics: false, flash() {}, redraw() {} } as unknown as Ctx;
  const host: SurfaceHost = { ctx, redraw() { arrived = true; }, navigate() {} };
  // Live figures and ::links ask this outline, as in the door; an answer arriving draws the note again.
  connectFigures(board, () => { arrived = true; });
  const surface = new NoteSurface(), tall = 100_000, end = Date.now() + settle.max;
  // Nobody presses a key in what show prints: folded callouts come unfolded, with no "z unfolds".
  surface.unfold = true;
  surface.show(m, host);
  surface.render(width, tall, host);
  while (Date.now() < end) {
    arrived = false;
    await Bun.sleep(settle.quiet);
    if (!arrived) break;
    surface.render(width, tall, host);
  }
  const lines = surface.render(width, tall, host).lines.map(l => paintable(l).replace(TAGS, "").replace(MARKS, ""));
  while (lines.length && !visible(lines.at(-1)!).trim()) lines.pop();
  return lines;
}

/** `ep0ch show <id>… …`: its exit code. */
export async function showCommand(argsIn: string[], io: Out = { out: console.log, err: console.error, columns: process.stdout.columns, tty: !!process.stdout.isTTY }): Promise<number> {
  const args = argsIn.slice(1);
  for (const f of ["--ws", "--machine", "--width", "--rows"]) { const v = flag(args, f); if (typeof v === "object") { io.err(`ep0ch: ${v.error}`); return 2; } }
  const ansi = args.includes("--ansi"), cells = args.includes("--cells"), source = args.includes("--source");
  if (Number(ansi) + Number(cells) + Number(source) > 1) { io.err("ep0ch: show prints the drawing, --ansi, --cells or --source: one of them"); return 2; }
  const rowsArg = flag(args, "--rows") as string | undefined;
  const rows = rowsArg === undefined ? Infinity : Number(rowsArg);
  if (rowsArg !== undefined && (!Number.isInteger(rows) || rows < 1)) { io.err("ep0ch: --rows takes a number of rows, 1 or more"); return 2; }
  const ids = without(args, ["--ws", "--machine", "--width", "--rows"], ["--ansi", "--cells", "--source"]);
  if (!ids.length || ids.some(id => id.startsWith("--"))) { io.err(`ep0ch: show takes notes' ids (${ids.find(id => id.startsWith("--")) ?? "none given"})\n${NOTES_USAGE}`); return 2; }
  const wArg = flag(args, "--width") as string | undefined;
  const width = wArg !== undefined ? Number(wArg) : io.columns || 80;
  if (!Number.isInteger(width) || width < 10 || width > 1000) { io.err(`ep0ch: --width takes a number of columns, 10 to 1000`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    // The person's theme, as their door draws in it (EP0CH_THEME, else the one last chosen).
    if (!source) setTheme(startTheme(process.env.EP0CH_THEME, readState<{ name?: string }>("theme.json")?.name));
    let code = 0, shown = 0;
    for (const id of ids) {
      // --source: the note's text as written; else the drawing (a JSON object a line with --cells).
      const text = source ? (await board.get(blockIdOf(id)))?.text : undefined;
      const lines = source ? (text === undefined ? null : text.replace(/\n+$/, "").split("\n")) : await drawNote(board, blockIdOf(id), width);
      if (!lines) { io.err(`ep0ch: no note ${id} in this outline`); code = 1; continue; }
      // A preview asks for its first rows: a long note's whole drawing is never encoded or sent.
      const kept = lines.slice(0, rows);
      if (cells) { io.out(JSON.stringify({ id: blockIdOf(id), ...linesToCells(kept, width) })); continue; }
      // Notes apart: a blank line, and a --- line between sources (a Markdown file's rule).
      if (shown++) { io.out(""); if (source) { io.out("---"); io.out(""); } }
      // --source is the text as written; to a terminal, what a terminal would act on (an escape in a note) is taken out.
      for (const l of kept) io.out(source ? (io.tty ? printable(l, "", { lines: true }) : l) : ansi ? l : visible(l).trimEnd());
    }
    return code;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}
