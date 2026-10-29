import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
export { userFolderInUse, userFolderOf } from "./extension-folders";

/**
 * Installed copies of the built-in extensions, and whether each follows the built-in (PIE-861).
 *
 * `ext add <name>` copies a built-in from the repo's `extensions/` into the user folder or an outline's own
 * `extensions/` (forkable source, never run in place). Beside the copy's config.json it writes `.installed.json`:
 * which built-in, its version, the commit it came from and a hash of its files. A copy is then
 *
 * - **current**: its files are the built-in's now;
 * - **stale**: its files are still what was installed (or, for a copy made before the record, some earlier version of
 *   the built-in in git history), and the built-in has moved on: `ext update` and `ep0ch install` refresh it in place;
 * - **forked**: someone changed it. It is left alone and listed with what's new; `ext update <name>` shows the diff
 *   and asks.
 *
 * A copy's files are what `ext add` copies: everything but config.json, node_modules and the dotfiles at its top
 * (your own files there, and this record). The hash is over each file's git blob id, so a version in git history
 * hashes the same as the same files on disk.
 */

export const INSTALL_RECORD = ".installed.json";

export interface InstallRecord {
  /** The built-in's id: the folder in the repo's extensions/. */
  builtIn: string;
  version: number;
  /** The files' hash (filesHash) as installed. */
  hash: string;
  /** The checkout's commit when it was installed, when it is a git checkout. */
  commit?: string;
  at: string;
}

export type CopyState = "current" | "stale" | "forked";

export interface InstalledCopy {
  id: string;
  /** The copy's folder. */
  dir: string;
  /** "user", or the outline whose own folder it is in. */
  where: string;
  state: CopyState;
  /** Whether it has an install record (one made before PIE-861 hasn't, until it is refreshed). */
  recorded: boolean;
  /** Whether its record matches its files as they are now. */
  recordCurrent: boolean;
  /** The commit it was installed from (the record's, or the one in history its files match), when known. */
  base?: string;
  /** The built-in's commits since `base`, oldest first; empty when `base` isn't known. */
  news: BuiltInNews[];
  /** The files that differ between the copy and the built-in now (added, changed or gone). */
  differs: string[];
  /** The built-in's version now, and the copy's. */
  version: { builtIn: number | null; copy: number | null };
}

/** What `ext update` did with one installed copy. */
export interface CopyUpdate {
  id: string;
  where: string;
  dir: string;
  state: CopyState;
  /** current: nothing to take; updated: refreshed in place; kept: left as it is (forked, not taken); took: a forked copy replaced, its files kept in `forkKept`. */
  done: "current" | "updated" | "kept" | "took";
  news: BuiltInNews[];
  differs: string[];
  forkKept?: string;
}

/** A folder to look in: the user folder, or one outline's own. */
export interface CopyRoot { path: string; where: string }

const SKIP_TOP = (entry: string) => entry === "config.json" || entry === "node_modules" || entry.startsWith(".");

/** A file's git blob id: what `git hash-object` says, so files on disk compare with any version in history. */
function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Each of an extension folder's files (relative path → blob id), as `ext add` copies them. */
export function folderFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string, top: boolean) => {
    for (const entry of readdirSync(at).sort()) {
      // node_modules below the top counts: a refresh replaces the folder it's in, so a copy with one isn't unchanged.
      if (top && SKIP_TOP(entry)) continue;
      const path = join(at, entry);
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(path, false);
      else if (st.isFile()) files.set(relative(dir, path), blobId(readFileSync(path)));
    }
  };
  walk(dir, true);
  return files;
}

/** One hash for a set of files: each path and blob id, in order. */
export function filesHash(files: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const path of [...files.keys()].sort()) hash.update(`${path}\0${files.get(path)}\n`);
  return hash.digest("hex");
}

function git(repo: string, args: string[]): string | null {
  try {
    const r = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  } catch {
    return null;
  }
}

/** The git checkout the built-ins are in, or null when they aren't in one. */
export function repoOf(builtIns: string): string | null {
  return git(builtIns, ["rev-parse", "--show-toplevel"])?.trim() || null;
}

export interface BuiltInNews { commit: string; subject: string }

export interface BuiltInVersion { commit: string; subject: string; hash: string }

/** The built-in's folder in the checkout, and before the outliner moved into packages/outliner (its own `extensions/<id>`). */
function historyPaths(repo: string, builtIns: string, id: string): string[] {
  const now = relative(repo, join(builtIns, id));
  return [now, ...(now.startsWith("packages/outliner/") ? [now.slice("packages/outliner/".length)] : [])];
}

/**
 * Every version of a built-in in the checkout's history: each commit that touched its folder (under either path), and
 * the hash of its files in that commit's own tree, read with `git ls-tree`.
 */
export function builtInHistory(repo: string, builtIns: string, id: string): BuiltInVersion[] {
  const paths = historyPaths(repo, builtIns, id);
  const log = git(repo, ["log", "--format=%H %s", "--", ...paths]);
  if (!log) return [];
  const versions: BuiltInVersion[] = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const at = line.indexOf(" ");
    const commit = line.slice(0, at), subject = line.slice(at + 1);
    for (const path of paths) {
      // <mode> blob <sha>\t<path>, for every file under the folder in that commit.
      const tree = git(repo, ["ls-tree", "-r", "--full-tree", commit, "--", `${path}/`]);
      if (!tree?.trim()) continue;
      const files = new Map<string, string>();
      for (const entry of tree.split("\n")) {
        const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(entry);
        if (m && m[1]!.startsWith("100")) files.set(m[3]!.slice(path.length + 1), m[2]!);
      }
      versions.push({ commit, subject, hash: filesHash(topFiltered(files)) });
      break;
    }
  }
  return versions;
}

/** The built-in's commits after `base` (not reachable from it), oldest first. */
function builtInNews(repo: string, builtIns: string, id: string, base: string): BuiltInNews[] {
  const out = git(repo, ["log", "--reverse", "--format=%H %s", `${base}..HEAD`, "--", ...historyPaths(repo, builtIns, id)]);
  return (out ?? "").split("\n").filter(Boolean).map((line) => ({ commit: line.slice(0, line.indexOf(" ")), subject: line.slice(line.indexOf(" ") + 1) }));
}

/** The same files without what a copy never has (config.json, node_modules, dotfiles at its top). */
function topFiltered(files: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...files].filter(([path]) => !SKIP_TOP(path.split("/")[0]!)));
}

function readRecord(dir: string): InstallRecord | null {
  try {
    const record = JSON.parse(readFileSync(join(dir, INSTALL_RECORD), "utf8")) as InstallRecord;
    return typeof record.hash === "string" && typeof record.builtIn === "string" ? record : null;
  } catch {
    return null;
  }
}

function manifestVersion(dir: string): number | null {
  try {
    const version = JSON.parse(readFileSync(join(dir, "extension.json"), "utf8")).version;
    return typeof version === "number" ? version : null;
  } catch {
    return null;
  }
}

/** What the built-in `id` is now, read once per id. */
interface BuiltInNow { files: Map<string, string>; hash: string; history: BuiltInVersion[] | null; version: number | null }

/** The built-ins as read once: each one's files now, and its history when a copy needs it. */
class BuiltIns {
  private readonly known = new Map<string, BuiltInNow>();
  readonly real: string;
  constructor(readonly dir: string, readonly repo: string | null) {
    this.real = realpathSync(dir);
  }
  now(id: string): BuiltInNow {
    let now = this.known.get(id);
    if (!now) {
      const files = folderFiles(join(this.dir, id));
      now = { files, hash: filesHash(files), history: null, version: manifestVersion(join(this.dir, id)) };
      this.known.set(id, now);
    }
    return now;
  }
  history(id: string): BuiltInVersion[] {
    const now = this.now(id);
    now.history ??= this.repo ? builtInHistory(this.repo, this.dir, id) : [];
    return now.history;
  }
  /** Whether `dir` (named `id`) is an installed copy of a built-in: a built-in has that name, and it isn't the built-in's own folder. */
  copies(dir: string, id: string): boolean {
    if (!existsSync(join(dir, "extension.json")) || !existsSync(join(this.dir, id, "extension.json"))) return false;
    try { return !within(realpathSync(dir), this.real); } catch { return false; }
  }
}

const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** The one check of an installed copy against its built-in: current, stale (unchanged, behind) or forked (changed here). */
function copyOf(builtIns: BuiltIns, dir: string, id: string, where: string, news: boolean): InstalledCopy {
  const now = builtIns.now(id);
  const files = folderFiles(dir);
  const hash = filesHash(files);
  const record = readRecord(dir);
  const differs = [...new Set([...files.keys(), ...now.files.keys()])].filter((path) => files.get(path) !== now.files.get(path)).sort();
  let state: CopyState;
  let base = record?.commit;
  if (hash === now.hash) state = "current";
  else if (record) state = record.hash === hash ? "stale" : "forked";
  else {
    // Made before the record: unchanged when it is some earlier version of the built-in (the newest that matches;
    // git log lists newest first).
    const match = builtIns.history(id).find((version) => version.hash === hash);
    state = match ? "stale" : "forked";
    base = match?.commit;
  }
  // The commits since the base that touched it; a base this checkout doesn't have says none.
  const since = news && state !== "current" && base && builtIns.repo ? builtInNews(builtIns.repo, builtIns.dir, id, base) : [];
  return {
    id, dir, where, state, recorded: !!record, recordCurrent: record?.hash === hash, ...(base ? { base } : {}), news: since, differs,
    version: { builtIn: now.version, copy: manifestVersion(dir) },
  };
}

/**
 * Every installed copy of a built-in in `roots`, with its state. A folder whose name isn't a built-in's is someone's
 * own extension and isn't listed. Read-only.
 */
export function installedCopies(roots: readonly CopyRoot[], builtIns: string, options: { repo?: string | null } = {}): InstalledCopy[] {
  const known = new BuiltIns(builtIns, options.repo === undefined ? repoOf(builtIns) : options.repo);
  const copies: InstalledCopy[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    // Real paths: a folder that is (or links to) the checkout's built-ins is never a copy of them, and a root reached
    // twice is read once.
    let real: string;
    try { real = realpathSync(root.path); } catch { continue; }
    if (seen.has(real) || within(real, known.real)) continue;
    seen.add(real);
    for (const id of readdirSync(root.path).sort()) {
      const dir = join(root.path, id);
      if (known.copies(dir, id)) copies.push(copyOf(known, dir, id, root.where, true));
    }
  }
  return copies;
}

/**
 * The copy check for one extension folder as the registry lists it (PIE-1283): the built-in it is a copy of and its
 * state, or null when it is no built-in's copy. Memoized on the folder's files, so a reload that changed nothing in it
 * reads no git history again.
 */
export class BuiltInCopies {
  private known: BuiltIns | null | undefined;
  private memo = new Map<string, { hash: string; state: CopyState }>();
  constructor(private readonly builtIns: string) {}
  of(dir: string, id: string): { directory: string; state: CopyState } | null {
    if (this.known === undefined) {
      try { this.known = existsSync(this.builtIns) ? new BuiltIns(this.builtIns, repoOf(this.builtIns)) : null; } catch { this.known = null; }
    }
    if (!this.known?.copies(dir, id)) return null;
    const hash = filesHash(folderFiles(dir)) + (readRecord(dir)?.hash ?? "");
    const key = `${id}\0${dir}`;
    let seen = this.memo.get(key);
    if (seen?.hash !== hash) {
      seen = { hash, state: copyOf(this.known, dir, id, "", false).state };
      this.memo.set(key, seen);
    }
    return { directory: join(this.builtIns, id), state: seen.state };
  }
}

/** Writes the install record for a copy just made from the built-in `id` (its files now). */
export async function writeInstallRecord(dir: string, builtIns: string, id: string): Promise<void> {
  const repo = repoOf(builtIns);
  const commit = repo ? git(repo, ["rev-parse", "HEAD"])?.trim() : undefined;
  const record: InstallRecord = {
    builtIn: id,
    version: manifestVersion(dir) ?? 0,
    hash: filesHash(folderFiles(dir)),
    ...(commit ? { commit } : {}),
    at: new Date().toISOString(),
  };
  await writeFile(join(dir, INSTALL_RECORD), `${JSON.stringify(record, null, 2)}\n`);
}

/** The folders installed copies are in: the user folder (when this process reads one) and each outline's own. */
export function copyRoots(options: { user: string | null; outlines: string; outlineFolder?: string }): CopyRoot[] {
  if (options.outlineFolder) return [{ path: join(options.outlineFolder, "extensions"), where: outlineName(options.outlineFolder) }];
  const roots: CopyRoot[] = options.user ? [{ path: options.user, where: "user" }] : [];
  if (existsSync(options.outlines)) {
    for (const name of readdirSync(options.outlines).sort()) {
      if (name.startsWith(".")) continue;
      const folder = join(options.outlines, name, "extensions");
      if (existsSync(folder) && statSync(folder).isDirectory()) roots.push({ path: folder, where: name });
    }
  }
  return roots;
}

function outlineName(folder: string): string {
  return resolve(folder).split("/").filter(Boolean).at(-1) ?? folder;
}

/** A copy by name: its id, with the outline when it's an outline's own. */
export const copyName = (copy: { id: string; where: string }) => (copy.where === "user" ? copy.id : `${copy.id} (${copy.where})`);

/** What's new, for one line: each commit's subject. */
export const newsWords = (news: readonly BuiltInNews[]) => news.map((n) => n.subject).join("; ");

/** "the user folder" or "pie's folder", for people. */
export const whereWords = (where: string) => (where === "user" ? "the user folder" : `${where}'s folder`);

/** The `ext remove` that takes a copy away, so the built-in can be installed fresh (an outline's own names its folder). */
export const removeCommand = (copy: { id: string; where: string; dir: string }) =>
  `ext remove ${copy.id}${copy.where === "user" ? "" : ` --outline-folder ${resolve(copy.dir, "..", "..")}`}`;

/** ", your copy v1, the built-in v2" when the versions differ, else nothing. */
export const versionWords = (copy: Pick<InstalledCopy, "version">) =>
  copy.version.copy !== copy.version.builtIn ? `, your copy v${copy.version.copy ?? "?"}, the built-in v${copy.version.builtIn ?? "?"}` : "";

/**
 * What a copy of a built-in says on its row (PIE-1283): that it is what runs, and how it stands against the built-in.
 * A copy with the built-in's own files is how installing one works (PIE-1399), so it says nothing: it is installed.
 */
export function overrideWords(id: string, builtIn: { readonly state: CopyState }): string {
  if (builtIn.state === "current") return "";
  return `your copy overrides the built-in (${builtIn.state === "stale" ? `behind it: ep0ch ext update ${id}` : "changed here"})`;
}

/** One line for a copy's state, with what to run when there is something to take. */
export function copyLine(copy: InstalledCopy): string {
  const at = `${copy.id} (${whereWords(copy.where)})`;
  const news = copy.news.length ? `: ${copy.news.length} change${copy.news.length === 1 ? "" : "s"} since it was installed` : "";
  if (copy.state === "current") return `${at} is current`;
  if (copy.state === "stale") return `${at} is an unchanged copy, behind the built-in${news}`;
  return `${at} was changed here (forked); the built-in differs in ${copy.differs.join(", ")}${news}: ep0ch ext update ${copy.id} shows the diff and asks`;
}
