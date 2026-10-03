// Which outline a client opens, and where outlines live (PIE-530). One rule for every client: the door, the
// outliner's Herdr panes and CLI, the Claude mod. It does no I/O of its own: callers pass a reader for files, so the
// rule is the same everywhere and testable without a disk.
//
// Which outline (first match wins):
// 1. `--ws <name>`, from anywhere.
// 2. `EP0CH_WS=<name>`, for shells and scripts.
// 3. The nearest `.ep0ch` walking up from the folder (like `.git` or `.nvmrc`). It holds only a name
//    (`ws = "float-hub"`), never a path or a hash.
// 4. Nothing: the client offers init (with a guess: the folder's name, or its repository's), pick or import.
//    Accepting the guess writes `.ep0ch`, so renaming the folder later changes nothing.
//
// Where: every outline is `<outlines>/<name>.sqlite`, with its own folder `<outlines>/<name>/` beside it (prompts,
// assistant sessions, files it links relatively). `<outlines>` is EP0CH_OUTLINES, else `~/outlines`. An outline is
// found by name, never by path.
import { basename, dirname, join, resolve } from "node:path";
import { OUTLINE_NAME_PATTERN } from "./protocol";

export { OUTLINE_NAME_PATTERN };

export function isOutlineName(name: unknown): name is string {
  return typeof name === "string" && OUTLINE_NAME_PATTERN.test(name);
}

/** Text as an outline name: lowercase, hyphens for runs of anything else, at most 32. */
export function slugifyOutlineName(text: string): string {
  const slug = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return slug || "outline";
}

/** The first free name from `base`: itself, then `-2`, `-3`… (the name offered when `base` is taken). */
export function freeOutlineName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 32 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** The file that names a folder's outline. */
export const DOT_EP0CH = ".ep0ch";

/** `.ep0ch`'s text for a name. */
export function formatDotEp0ch(name: string): string {
  if (!isOutlineName(name)) throw new Error(`"${name}" isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
  return `ws = "${name}"\n`;
}

/**
 * The name a `.ep0ch` holds. Blank lines and `#` comments are allowed; anything else but one `ws = "<name>"` is
 * refused, so a typo is said, never read as "no outline".
 */
export function parseDotEp0ch(text: string, file: string): string {
  let name: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^ws\s*=\s*"([^"]*)"$/.exec(line);
    if (!m || name !== undefined) throw new Error(`${file} must hold one line, ws = "<name>"; it has ${JSON.stringify(line)}`);
    if (!isOutlineName(m[1])) throw new Error(`${file} names "${m[1]}", which isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
    name = m[1];
  }
  if (name === undefined) throw new Error(`${file} is empty; it must hold ws = "<name>"`);
  return name;
}

/** What the rule reads from disk: a file's text, or undefined when there is none. */
export interface LocationReader {
  readFile(path: string): string | undefined;
  exists(path: string): boolean;
}

export interface DotEp0ch { folder: string; file: string; name: string }

/** The nearest `.ep0ch` from `folder` up to `/`. A malformed one throws (it names its file). */
export function nearestDotEp0ch(folderInput: string, fs: LocationReader): DotEp0ch | undefined {
  for (let folder = resolve(folderInput); ; folder = dirname(folder)) {
    const file = join(folder, DOT_EP0CH);
    const text = fs.readFile(file);
    if (text !== undefined) return { folder, file, name: parseDotEp0ch(text, file) };
    if (dirname(folder) === folder) return undefined;
  }
}

/** `$HOME`, `/` and a folder directly under `/` (`/tmp`, `/opt`) never give their name to an outline. */
export function tooBroadToName(folder: string, home: string): boolean {
  const parent = dirname(folder);
  return folder === resolve(home) || parent === folder || dirname(parent) === parent;
}

/**
 * The guess offered at init: the git repository's root (`.git` a folder or a worktree's file) when the folder is in
 * one, else the folder itself; its name as an outline name, and the folder `.ep0ch` goes in when it's accepted.
 * None for a folder too broad to name an outline after.
 */
export function guessOutline(folderInput: string, home: string, fs: LocationReader): { name: string; folder: string } | undefined {
  const folder = resolve(folderInput);
  let repository: string | undefined;
  for (let d = folder; ; d = dirname(d)) {
    if (fs.exists(join(d, ".git"))) { repository = d; break; }
    if (dirname(d) === d) break;
  }
  const candidate = repository && !tooBroadToName(repository, home) ? repository : folder;
  if (tooBroadToName(candidate, home)) return undefined;
  return { name: slugifyOutlineName(basename(candidate)), folder: candidate };
}

export type WhichOutline =
  | { kind: "named"; name: string; source: "flag" | "env" | "file"; file?: string; folder?: string }
  | { kind: "unnamed"; folder: string; guess?: { name: string; folder: string }; reason: string };

/** The rule, first match wins: `flag` (`--ws`), then `env` (EP0CH_WS), then the nearest `.ep0ch`; else unnamed. */
export function whichOutline(o: { flag?: string; env?: string; folder: string; home: string; fs: LocationReader }): WhichOutline {
  const flag = o.flag?.trim(), env = o.env?.trim();
  if (flag) {
    if (!isOutlineName(flag)) throw new Error(`--ws ${JSON.stringify(flag)} isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
    return { kind: "named", name: flag, source: "flag" };
  }
  if (env) {
    if (!isOutlineName(env)) throw new Error(`EP0CH_WS=${JSON.stringify(env)} isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
    return { kind: "named", name: env, source: "env" };
  }
  const folder = resolve(o.folder);
  const dot = nearestDotEp0ch(folder, o.fs);
  if (dot) return { kind: "named", name: dot.name, source: "file", file: dot.file, folder: dot.folder };
  const guess = guessOutline(folder, o.home, o.fs);
  return {
    kind: "unnamed", folder, ...(guess ? { guess } : {}),
    reason: `no outline is named for ${folder}: no --ws, no EP0CH_WS and no ${DOT_EP0CH} here or above`,
  };
}

/** Where outlines live: EP0CH_OUTLINES, else `~/outlines`. */
export function outlinesFolder(env: { EP0CH_OUTLINES?: string }, home: string): string {
  return resolve(env.EP0CH_OUTLINES?.trim() || join(home, "outlines"));
}

/**
 * Everything under the outlines folder. Only `<name>.sqlite` and `<name>/` are outlines; the dot folders are the
 * host's: `.host/` (mode 0700: its socket and lock), `.clients/<name>/` (a client's own files for an outline, such
 * as editor drafts), `.deleted/` (where a deleted outline is moved; nothing is erased) and `.publish/` (the
 * publisher's cache).
 */
export function outlineLayout(outlines: string) {
  const root = resolve(outlines);
  return {
    root,
    hostDir: join(root, ".host"),
    socket: join(root, ".host", "host.sock"),
    lock: join(root, ".host", "host.lock"),
    deleted: join(root, ".deleted"),
    publish: join(root, ".publish"),
    database: (name: string) => join(root, `${name}.sqlite`),
    folder: (name: string) => join(root, name),
    clientDir: (name: string) => join(root, ".clients", name),
  };
}
