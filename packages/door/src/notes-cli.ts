// `ep0ch find` and `ep0ch show`: the outline's notes for programs outside the door (a picker's channel, a script, an
// agent's shell). Which outline is the one rule every client applies (`--ws`, `--machine`, EP0CH_WS, EP0CH_SOCKET,
// the folder's `.ep0ch`: resolveTarget). Nothing here writes.
//
// `find <words>` asks the service's forgiving ranker (`tree.search`, Goto's: punctuation folded, any word order,
// typos), best first. `find` with no words lists every note, newest first, for a picker that filters as it's typed
// (television runs its source once and matches locally); the path is the note's ancestors' titles from the tree index.
//
// `show <id>` draws the note as a reader draws it: the note surface (`NoteSurface.render`), at the width asked for,
// in the person's theme, never a second renderer. `--ansi` keeps its colours; without it, plain text.
import { resolveTarget } from "./discover";
import { forwardTo } from "./machine";
import { previewTitle, SocketBoard, type IndexBlock } from "./socket";
import { readState } from "./state";
import { MARKS, TAGS, visible } from "./style";
import { NoteSurface, type SurfaceHost } from "./surface/note";
import { paintable, printable } from "./text";
import { setTheme, startTheme } from "./theme";
import type { Ctx } from "./app";

export const NOTES_USAGE = `  ep0ch find [<words>…] [--lines | --json] [--ws <name>] [--machine <ssh-name>]
                                   notes: with words, the service's ranked search (as (( and Goto rank them, at
                                   most 30); without, every note, newest first. --lines prints one per line,
                                   id<TAB>title<TAB>path, for a picker
  ep0ch show <id> [--ansi] [--width <n>] [--ws <name>] [--machine <ssh-name>]
                                   the note drawn as a reader draws it, at that width (default the terminal's,
                                   else 80); --ansi keeps its colours`;

/** One note as `find` lists it. */
export interface Found { id: string; title: string; path: string }

/** A field of a `--lines` row: one line, no tabs. */
const field = (s: string) => printable(s.replace(/[\t\r\n]+/g, " ")).trim();

/** The `--lines` form: id, title, path, tab-separated. */
export const foundLine = (f: Found) => [f.id, field(f.title), field(f.path)].join("\t");

/** Every note in the tree index, newest first: its title (the preview's first line) and its ancestors' titles as its path (` › `, as the service's). */
export function everyNote(index: readonly IndexBlock[]): Found[] {
  const by = new Map(index.map(b => [b.id, b]));
  const pathOf = (b: IndexBlock) => {
    const up: string[] = [];
    const seen = new Set([b.id]);
    for (let p = b.parentId; p && !seen.has(p) && up.length < 12; p = by.get(p)?.parentId ?? null) {
      seen.add(p);
      const a = by.get(p);
      if (!a) break;
      up.unshift(previewTitle(a.title));
    }
    return up.join(" › ");
  };
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(b => ({ id: b.id, title: previewTitle(b.title), path: pathOf(b) }));
}

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
  const target = resolveTarget(args);
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

export interface Out { out: (s: string) => void; err: (s: string) => void; columns?: number }

/** `ep0ch find …`: its exit code. */
export async function findCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  const lines = args.includes("--lines"), json = args.includes("--json");
  for (const f of ["--ws", "--machine"]) { const v = flag(args, f); if (typeof v === "object") { io.err(`ep0ch: ${v.error}`); return 2; } }
  const words = without(args, ["--ws", "--machine"], ["--lines", "--json"]);
  const unknown = words.find(w => w.startsWith("--"));
  if (unknown) { io.err(`ep0ch: find doesn't take ${unknown}\n${NOTES_USAGE}`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    const query = words.join(" ").trim();
    const found = query ? await board.ranked(query) : everyNote(await board.index());
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
  const surface = new NoteSurface(), tall = 100_000, end = Date.now() + settle.max;
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

/** `ep0ch show <id> …`: its exit code. */
export async function showCommand(argsIn: string[], io: Out = { out: console.log, err: console.error, columns: process.stdout.columns }): Promise<number> {
  const args = argsIn.slice(1);
  for (const f of ["--ws", "--machine", "--width"]) { const v = flag(args, f); if (typeof v === "object") { io.err(`ep0ch: ${v.error}`); return 2; } }
  const ansi = args.includes("--ansi");
  const rest = without(args, ["--ws", "--machine", "--width"], ["--ansi"]);
  const [id, ...more] = rest;
  if (!id || more.length || id.startsWith("--")) { io.err(`ep0ch: show takes one note's id\n${NOTES_USAGE}`); return 2; }
  const wArg = flag(args, "--width") as string | undefined;
  const width = wArg !== undefined ? Number(wArg) : io.columns || 80;
  if (!Number.isInteger(width) || width < 10 || width > 1000) { io.err(`ep0ch: --width takes a number of columns, 10 to 1000`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    // The person's theme, as their door draws in it (EP0CH_THEME, else the one last chosen).
    setTheme(startTheme(process.env.EP0CH_THEME, readState<{ name?: string }>("theme.json")?.name));
    const lines = await drawNote(board, id.replace(/^\(\(|\)\)$/g, ""), width);
    if (!lines) { io.err(`ep0ch: no note ${id} in this outline`); return 1; }
    for (const l of lines) io.out(ansi ? l : visible(l).trimEnd());
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}
