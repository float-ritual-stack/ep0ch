// Which outline a client opens, and where outlines live (PIE-530). One rule for every client: the door, the
// outliner's Herdr panes and CLI, the Claude mod. It does no I/O of its own: callers pass a reader for files, so the
// rule is the same everywhere and testable without a disk.
//
// Which outline (first match wins):
// 1. `--ws <name>`, from anywhere.
// 2. `EP0CH_WS=<name>`, for shells and scripts.
// 3. The nearest `.ep0ch` walking up from the folder (like `.git` or `.nvmrc`). It holds only names
//    (`ws = "float-hub"`, and `machine = "float-2"` for an outline on another machine), never a path or a hash.
// 4. Nothing: the client offers init (with a guess: the folder's name, or its repository's), pick or import.
//    Accepting the guess writes `.ep0ch`, so renaming the folder later changes nothing.
//
// On which machine (first match wins): `--machine <ssh-name>`, then `EP0CH_MACHINE`, then the `machine` of the
// `.ep0ch` that named the outline (a `.ep0ch` is read whole: an outline named by `--ws` or EP0CH_WS takes no machine
// from a file that named another). None: this machine. A machine is an ssh config name (a `Host` alias in
// `~/.ssh/config`); ssh owns its keys, hops and address, and there is no registry of machines here. A client reaches
// it through an ssh forward to that machine's host socket, at `<outlines>/.remote/<machine>.sock` (src/machine.ts).
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

/** The outline a file in the outlines folder is, by its name (`pie.sqlite` → `pie`), or null for anything else there. */
export function outlineOfFile(file: string): string | null {
  const name = file.endsWith(".sqlite") ? file.slice(0, -".sqlite".length) : "";
  return isOutlineName(name) ? name : null;
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

/**
 * A machine's name: an ssh config name (a `Host` alias such as `float-2` or `laptop`), never a path, a user@ or an
 * option (`-o…`): letters, digits, `.`, `_` and `-`, starting with a letter or digit, up to 64.
 */
export const MACHINE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function isMachineName(name: unknown): name is string {
  return typeof name === "string" && MACHINE_NAME_PATTERN.test(name);
}

/** The file that names a folder's outline. */
export const DOT_EP0CH = ".ep0ch";

/** `.ep0ch`'s text: the outline's name, and the machine it is on when that isn't this one. */
export function formatDotEp0ch(name: string, machine?: string): string {
  if (!isOutlineName(name)) throw new Error(`"${name}" isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
  if (machine !== undefined && !isMachineName(machine)) throw new Error(`"${machine}" isn't a machine name: an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  return `ws = "${name}"\n${machine ? `machine = "${machine}"\n` : ""}`;
}

/** What a `.ep0ch` holds: the outline's name, and its machine when it is on another one. */
export interface DotEp0chNames { name: string; machine?: string }

/**
 * The names a `.ep0ch` holds: one `ws = "<name>"` and at most one `machine = "<ssh-name>"`. Blank lines and `#`
 * comments are allowed; anything else is refused, so a typo is said, never read as "no outline" or "this machine".
 */
export function parseDotEp0ch(text: string, file: string): DotEp0chNames {
  let name: string | undefined, machine: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(ws|machine)\s*=\s*"([^"]*)"$/.exec(line);
    if (!m || (m[1] === "ws" ? name : machine) !== undefined) throw new Error(`${file} must hold ws = "<name>" and at most one machine = "<ssh-name>"; it has ${JSON.stringify(line)}`);
    if (m[1] === "ws") {
      if (!isOutlineName(m[2])) throw new Error(`${file} names "${m[2]}", which isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
      name = m[2];
    } else {
      if (!isMachineName(m[2])) throw new Error(`${file} names the machine "${m[2]}", which isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`);
      machine = m[2];
    }
  }
  if (name === undefined) throw new Error(`${file} names no outline; it must hold ws = "<name>"`);
  return { name, ...(machine ? { machine } : {}) };
}

/** What the rule reads from disk: a file's text, or undefined when there is none. */
export interface LocationReader {
  readFile(path: string): string | undefined;
  exists(path: string): boolean;
}

export interface DotEp0ch extends DotEp0chNames { folder: string; file: string }

/** The nearest `.ep0ch` from `folder` up to `/`. A malformed one throws (it names its file). */
export function nearestDotEp0ch(folderInput: string, fs: LocationReader): DotEp0ch | undefined {
  for (let folder = resolve(folderInput); ; folder = dirname(folder)) {
    const file = join(folder, DOT_EP0CH);
    const text = fs.readFile(file);
    if (text !== undefined) return { folder, file, ...parseDotEp0ch(text, file) };
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

/** The machine an outline is on, and what named it; absent in a result means this machine. */
export interface OnMachine { machine?: string; machineSource?: "flag" | "env" | "file" }

export type WhichOutline =
  | ({ kind: "named"; name: string; source: "flag" | "env" | "file"; file?: string; folder?: string } & OnMachine)
  | ({ kind: "unnamed"; folder: string; guess?: { name: string; folder: string }; reason: string } & OnMachine);

/**
 * The rule, first match wins: `flag` (`--ws`), then `env` (EP0CH_WS), then the nearest `.ep0ch`; else unnamed. The
 * machine: `machineFlag` (`--machine`), then `machineEnv` (EP0CH_MACHINE), then the `.ep0ch` that named the outline.
 */
export function whichOutline(o: { flag?: string; env?: string; machineFlag?: string; machineEnv?: string; folder: string; home: string; fs: LocationReader }): WhichOutline {
  const flag = o.flag?.trim(), env = o.env?.trim(), mflag = o.machineFlag?.trim(), menv = o.machineEnv?.trim();
  if (mflag && !isMachineName(mflag)) throw new Error(`--machine ${JSON.stringify(mflag)} isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  if (menv && !isMachineName(menv)) throw new Error(`EP0CH_MACHINE=${JSON.stringify(menv)} isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  const on = (fromFile?: string): OnMachine =>
    mflag ? { machine: mflag, machineSource: "flag" } : menv ? { machine: menv, machineSource: "env" } : fromFile ? { machine: fromFile, machineSource: "file" } : {};
  if (flag) {
    if (!isOutlineName(flag)) throw new Error(`--ws ${JSON.stringify(flag)} isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
    return { kind: "named", name: flag, source: "flag", ...on() };
  }
  if (env) {
    if (!isOutlineName(env)) throw new Error(`EP0CH_WS=${JSON.stringify(env)} isn't an outline name (${OUTLINE_NAME_PATTERN.source})`);
    return { kind: "named", name: env, source: "env", ...on() };
  }
  const folder = resolve(o.folder);
  const dot = nearestDotEp0ch(folder, o.fs);
  if (dot) return { kind: "named", name: dot.name, source: "file", file: dot.file, folder: dot.folder, ...on(dot.machine) };
  const guess = guessOutline(folder, o.home, o.fs);
  return {
    kind: "unnamed", folder, ...(guess ? { guess } : {}), ...on(),
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
 * publisher's cache); and the clients': `.remote/` (mode 0700: each machine's forward, `<machine>.sock`, and the
 * ssh connection that holds it, `<machine>.ctl`).
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
    remoteDir: join(root, ".remote"),
    /** A machine's forward: the local end of its host socket, and the ssh control socket of the connection holding it. */
    remote: (machine: string) => ({ socket: join(root, ".remote", `${machine}.sock`), control: join(root, ".remote", `${machine}.ctl`) }),
  };
}
