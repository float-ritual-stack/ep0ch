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
import { listenLive, liveBoard, liveSettled, liveSource, setLiveSource } from "./live";
import { linksSource, setLinksSource } from "./links";
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
import { recordJson } from "@ep0ch/outline-core/block-record";

export const NOTES_USAGE = `  ep0ch find [<words>… | --recent | --tree [<root id>]] [--ids | --lines | --json] [--ws <name>] [--machine <ssh-name>]
  ep0ch find [<words>…] [--query "<expression>"] [--view <id>] [--under <id>]
             [--updated-after|--updated-before|--created-after|--created-before <date>] [--ids | --lines | --json]
                                   notes: with words, the service's ranked search, tree.search (the ranker
                                   Goto, the door's / and (( use, asked from no note and without Jev; at
                                   most 30); --recent, its newest 30; --tree, the outline (or the notes under
                                   <root id>) depth first, as Tree draws it; without, every note, newest first.
                                   --query takes the saved views' grammar, evaluated by the outline
                                   ("type=chore area=garden", OR, NOT, ( ), created/updated ranges such as
                                   "updated >= -7d"); --view the members of a saved view (type::virtual-branch),
                                   in its order; --under the notes under that one (itself included). They
                                   combine with each other and with words (then every word, any order: the
                                   service's text filter), in outline order, at most 1000. The date flags only
                                   write the query (--updated-after 2026-03-01 is "updated > 2026-03-01": a
                                   date is a whole UTC day; -7d, today, an ISO time also do).
                                   --ids prints ((id)) a line, for $(…) (ep0ch show $(ep0ch find --ids …));
                                   --lines one per line, id<TAB>title<TAB>path, for a picker; with --tree,
                                   then <TAB>depth<TAB>glyphs<TAB>about (├─ │ └─; about: work-id · stage · type);
                                   --json each note as a block record (outline-core's block-record.ts: title,
                                   header, properties as lists, children, tasks, links, backlinks, resources,
                                   created, updated, author), keys sorted; with --tree, the rows
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
export async function boardFor(args: string[]): Promise<SocketBoard | { error: string }> {
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

/** Which notes, by the outline's own reading: a query, a saved view, a subtree, words, or ids given. */
export interface Selection { ids: string[]; query?: string; view?: string; under?: string; words: string[]; dates: string[] }

/** The flags that select notes and take a value, and the query clause each date flag writes. */
export const SELECT_FLAGS = ["--query", "--view", "--under", "--updated-after", "--updated-before", "--created-after", "--created-before"];
const DATE_CLAUSES: Record<string, string> = {
  "--updated-after": "updated >", "--updated-before": "updated <", "--created-after": "created >", "--created-before": "created <",
};

/** The selection flags of `args` (their values, ((id)) or bare ids alike); `rest` is the other words. */
export function selectionOf(args: string[]): { selection: Omit<Selection, "ids" | "words">; rest: string[] } | { error: string } {
  const sel: Omit<Selection, "ids" | "words"> = { dates: [] };
  for (const f of SELECT_FLAGS) {
    const v = flag(args, f);
    if (typeof v === "object") return v;
    if (v === undefined) continue;
    if (args.filter(a => a === f).length > 1) return { error: `${f} is given once` };
    if (f === "--query") sel.query = v;
    else if (f === "--view") sel.view = blockIdOf(v);
    else if (f === "--under") sel.under = blockIdOf(v);
    else if (/\s/.test(v.trim())) return { error: `${f} takes one date or time (2026-03-01, -7d, today, 2026-03-01T09:00Z), not ${v}` };
    else sel.dates.push(`${DATE_CLAUSES[f]} ${v.trim()}`);
  }
  return { selection: sel, rest: without(args, SELECT_FLAGS, []) };
}

/** The query a selection asks: --query (grouped) and each date clause, ANDed; undefined when there's none. */
export const selectionQuery = (s: Pick<Selection, "query" | "dates">) =>
  [s.query?.trim() ? `(${s.query.trim()})` : "", ...s.dates].filter(Boolean).join(" ") || undefined;

/** Whether a selection asks the outline anything beyond ids. */
export const selects = (s: Selection) => !!(s.query || s.view || s.under || s.dates.length || s.words.length);

/**
 * The notes a selection names, in order: the ids given, then a view's members in the view's order (narrowed by the
 * query, the subtree and words through `query.matches`), or else the notes a query, a subtree and words hold for, in
 * outline order (`blocks.query`). The outline evaluates all of it. `truncated` says what was cut at its limits.
 */
export async function selectNotes(board: SocketBoard, s: Selection): Promise<{ ids: string[]; truncated?: string } | { error: string }> {
  const ids = s.ids.map(blockIdOf);
  const expression = selectionQuery(s), text = s.words.join(" ").trim() || undefined;
  const filtered = !!(expression || text || s.under);
  let truncated: string | undefined;
  let found: string[] = [];
  const refused = (e: unknown) => {
    const why = (e as Error).message;
    if (s.under && why.includes(`Block not found: ${s.under}`)) return { error: `no note ${s.under} in this outline (--under takes a note's id: ep0ch find --tree --lines lists them)` };
    return { error: `the outline can't read that query: ${why}\n  the grammar is the saved views': ep0ch find --query "type=chore (area=garden OR area=kitchen) updated >= -7d"` };
  };
  if (s.view) {
    const members: string[] = [];
    for (let offset = 0; ;) {
      const r = await board.readSavedView(s.view, { limit: 1000, offset });
      if (r.status !== "ready") {
        const why = r.problems?.map(p => p.message).join("; ") || r.errors.join("; ") || r.status;
        return { error: `the view ${s.view} can't be read (${r.status}): ${why}\n  ${r.status === "missing" || r.status === "unsupported" ? "the outline's views: ep0ch find --query type=virtual-branch" : `its definition: ep0ch show ${s.view} --source`}` };
      }
      members.push(...r.blocks.map(b => b.id));
      if (r.nextOffset === undefined) break;
      if (members.length >= MAX_VIEW_MEMBERS) { truncated = `the view's first ${MAX_VIEW_MEMBERS} members`; break; }
      offset = r.nextOffset;
    }
    try {
      const keep = filtered ? await board.matchQuery(expression ?? "", members, { ...(text ? { text } : {}), ...(s.under ? { subtreeRootId: s.under } : {}) }) : null;
      found = keep ? members.filter(id => keep.has(id)) : members;
    } catch (e) { return refused(e); }
  } else if (filtered) {
    try {
      const q = await board.queryIds({ expression, text, subtreeRootId: s.under });
      if (q.truncated) truncated = "the outline's first 1000 matches";
      found = q.ids;
    } catch (e) { return refused(e); }
  }
  const seen = new Set<string>();
  return { ids: [...ids, ...found].filter(id => !seen.has(id) && !!seen.add(id)), ...(truncated ? { truncated } : {}) };
}

/** The most of a view's members a selection reads (ten pages of the service's thousand). */
export const MAX_VIEW_MEMBERS = 10_000;

/** `ep0ch find …`: its exit code. */
export async function findCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  const lines = args.includes("--lines"), json = args.includes("--json"), recent = args.includes("--recent"), idsOut = args.includes("--ids");
  if (Number(lines) + Number(json) + Number(idsOut) > 1) { io.err("ep0ch: find prints --ids, --lines or --json: one of them"); return 2; }
  for (const f of ["--ws", "--machine"]) { const v = flag(args, f); if (typeof v === "object") { io.err(`ep0ch: ${v.error}`); return 2; } }
  const picked = selectionOf(args);
  if ("error" in picked) { io.err(`ep0ch: ${picked.error}`); return 2; }
  const sel = picked.selection;
  const asked = !!(sel.query || sel.view || sel.under || sel.dates.length);
  // --tree takes the root's id as its value when one follows.
  const treeAt = args.indexOf("--tree"), tree = treeAt >= 0;
  const root = tree && args[treeAt + 1] !== undefined && !args[treeAt + 1]!.startsWith("--") ? blockIdOf(args[treeAt + 1]!) : undefined;
  const words = without(picked.rest, ["--ws", "--machine", ...(root !== undefined ? ["--tree"] : [])], ["--lines", "--json", "--recent", "--tree", "--ids"]);
  if (recent && (words.length || asked)) { io.err("ep0ch: find --recent takes no words, --query, --view or --under"); return 2; }
  if (tree && (recent || words.length || asked)) { io.err("ep0ch: find --tree takes a root id at most, and no words, --recent, --query, --view or --under (find --under <id> lists a subtree in outline order)"); return 2; }
  const unknown = words.find(w => w.startsWith("--"));
  if (unknown) { io.err(`ep0ch: find doesn't take ${unknown}\n${NOTES_USAGE}`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    if (tree) {
      const rows = treeOf(await board.index(), root);
      if (!rows) { io.err(`ep0ch: no note ${root} in this outline`); return 1; }
      if (idsOut) { for (const f of rows) io.out(`((${f.id}))`); }
      else if (json) io.out(JSON.stringify(rows, null, 2));
      else if (lines) { for (const f of rows) io.out(treeLine(f)); }
      else if (!rows.length) io.out("the outline has no notes");
      else for (const f of rows) io.out(`${f.id.slice(0, 8)}  ${f.glyphs}${field(f.title)}${f.about ? `  · ${f.about}` : ""}`);
      return 0;
    }
    const query = words.join(" ").trim();
    let found: Found[];
    if (asked) {
      // --query, --view, --under (and words with them): the outline's own reading, in outline (or the view's) order.
      const picked = await selectNotes(board, { ids: [], ...sel, words });
      if ("error" in picked) { io.err(`ep0ch: ${picked.error}`); return 1; }
      if (picked.truncated) io.err(`ep0ch: only ${picked.truncated}; narrow it (another clause, --under <id>)`);
      if (idsOut) { for (const id of picked.ids) io.out(`((${id}))`); return 0; }
      if (json) return await printRecords(board, picked.ids, io);
      const index = await board.index(), by = new Map(index.map(b => [b.id, b])), pathOf = pathsOf(index);
      found = picked.ids.flatMap(id => { const b = by.get(id); return b ? [{ id, title: previewTitle(b.title), path: pathOf(b) }] : []; });
    } else {
      // --recent: the service's own answer to an empty search (the newest notes), without reading the whole index.
      found = query || recent ? (await board.searchBlocks(query)).matches.map(m => ({ id: m.block.id, title: m.title, path: m.path })) : everyNote(await board.index());
    }
    if (idsOut) { for (const f of found) io.out(`((${f.id}))`); }
    else if (json) return await printRecords(board, found.map(f => f.id), io);
    else if (lines) { for (const f of found) io.out(foundLine(f)); }
    else if (!found.length) io.out(asked ? "nothing matches" : query ? `nothing matches ${query}` : "the outline has no notes");
    else for (const f of found) io.out(`${f.id.slice(0, 8)}  ${field(f.title)}${f.path ? `  · ${field(f.path)}` : ""}`);
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}

/** Notes as block records, a JSON array with its keys sorted (outline-core's recordJson). */
async function printRecords(board: SocketBoard, ids: string[], io: Out): Promise<number> {
  const { records } = await board.records(ids);
  io.out(recordJson(records).trimEnd());
  return 0;
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
  // Live figures and ::links ask this outline, as in the door; an answer arriving draws the note again. A process that
  // already has a connection to it (a door) keeps it and this only listens; one connected elsewhere lends it for the
  // draw and gets it back after.
  const lent = liveBoard() === board ? null : { live: liveSource(), links: linksSource() };
  if (lent) connectFigures(board, () => {});
  const unlisten = listenLive(() => { arrived = true; });
  const surface = new NoteSurface(), tall = 100_000, end = Date.now() + settle.max;
  // Nobody presses a key in what show prints: folded callouts come unfolded, with no "z unfolds".
  surface.unfold = true;
  // …and a tabs figure prints every group in turn under a heading, with no tab or density control.
  surface.printed = true;
  surface.show(m, host);
  surface.render(width, tall, host);
  let drawn: string[] = [];
  try {
    while (Date.now() < end) {
      arrived = false;
      // The figures' answers, then a quiet spell for what else the reader reads (link titles, embeds, steps).
      await liveSettled(Math.max(0, end - Date.now()));
      await Bun.sleep(settle.quiet);
      if (!arrived) break;
      surface.render(width, tall, host);
    }
    // The last draw while the connection is still this outline's.
    drawn = surface.render(width, tall, host).lines;
  } finally {
    unlisten();
    if (lent) { setLiveSource(lent.live.board, lent.live.redraw); setLinksSource(lent.links.board, lent.links.redraw); }
  }
  const lines = drawn.map(l => paintable(l).replace(TAGS, "").replace(MARKS, ""));
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
