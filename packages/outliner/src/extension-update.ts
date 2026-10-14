import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

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
  /** The commit it was installed from (the record's, or the one in history its files match), when known. */
  base?: string;
  /** The built-in's commits since `base` (`<short sha> <subject>`), newest last; empty when `base` isn't known. */
  news: string[];
  /** The files that differ between the copy and the built-in now (added, changed or gone). */
  differs: string[];
  /** The built-in's version now, and the copy's. */
  version: { builtIn: number | null; copy: number | null };
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
      if (top ? SKIP_TOP(entry) : entry === "node_modules") continue;
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

export interface BuiltInVersion { commit: string; subject: string; hash: string }

/**
 * Every version of a built-in in the checkout's history, oldest first: each commit that touched its folder and the
 * hash of its files after it. Its folder moved once (the outliner's own `extensions/<id>` before it became
 * `packages/outliner/extensions/<id>`), so both paths are followed, replayed from git's raw diffs in one call.
 */
export function builtInHistory(repo: string, builtIns: string, id: string): BuiltInVersion[] {
  const now = relative(repo, join(builtIns, id));
  const paths = [now, ...(now.startsWith("packages/outliner/") ? [now.slice("packages/outliner/".length)] : [])];
  const out = git(repo, ["log", "--topo-order", "--reverse", "--raw", "--no-renames", "--no-abbrev", "--format=C %H %s", "--", ...paths]);
  if (!out) return [];
  const files = new Map<string, string>();
  const versions: BuiltInVersion[] = [];
  let commit: { sha: string; subject: string; changes: [string, string, string][] } | null = null;
  const settle = () => {
    if (!commit) return;
    // Deletions first: the move deletes one path and adds the same file under the other.
    for (const [status, path, sha] of [...commit.changes].sort((a, b) => Number(b[0] === "D") - Number(a[0] === "D"))) {
      if (status === "D") files.delete(path); else files.set(path, sha);
    }
    versions.push({ commit: commit.sha, subject: commit.subject, hash: filesHash(topFiltered(files)) });
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("C ")) {
      settle();
      const [, sha, ...subject] = line.split(" ");
      commit = { sha: sha!, subject: subject.join(" "), changes: [] };
      continue;
    }
    // :100644 100644 <old> <new> M\t<path>
    const m = /^:\d+ (\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])\d*\t(.+)$/.exec(line);
    if (!m || !commit) continue;
    const [, mode, sha, status, path] = m;
    const base = paths.find((p) => path!.startsWith(`${p}/`));
    if (!base || (status !== "D" && !mode!.startsWith("100"))) continue;
    commit.changes.push([status!, path!.slice(base.length + 1), sha!]);
  }
  settle();
  return versions;
}

/** The same files without what a copy never has (config.json, node_modules, top-level dotfiles). */
function topFiltered(files: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...files].filter(([path]) => { const top = path.split("/")[0]!; return !SKIP_TOP(top) && !path.split("/").includes("node_modules"); }));
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

/**
 * Every installed copy of a built-in in `roots`, with its state. A folder whose name isn't a built-in's is someone's
 * own extension and isn't listed. Read-only.
 */
export function installedCopies(roots: readonly CopyRoot[], builtIns: string, options: { repo?: string | null } = {}): InstalledCopy[] {
  const repo = options.repo === undefined ? repoOf(builtIns) : options.repo;
  const known = new Map<string, BuiltInNow>();
  const builtIn = (id: string): BuiltInNow => {
    let now = known.get(id);
    if (!now) {
      const files = folderFiles(join(builtIns, id));
      now = { files, hash: filesHash(files), history: null, version: manifestVersion(join(builtIns, id)) };
      known.set(id, now);
    }
    return now;
  };
  const history = (id: string) => {
    const now = builtIn(id);
    now.history ??= repo ? builtInHistory(repo, builtIns, id) : [];
    return now.history;
  };
  const copies: InstalledCopy[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    let real: string;
    try { real = resolve(root.path); } catch { continue; }
    if (seen.has(real) || real === resolve(builtIns)) continue;
    seen.add(real);
    for (const id of readdirSync(root.path).sort()) {
      const dir = join(root.path, id);
      if (!existsSync(join(dir, "extension.json")) || !existsSync(join(builtIns, id, "extension.json"))) continue;
      const now = builtIn(id);
      const files = folderFiles(dir);
      const hash = filesHash(files);
      const record = readRecord(dir);
      const differs = [...new Set([...files.keys(), ...now.files.keys()])].filter((path) => files.get(path) !== now.files.get(path)).sort();
      let state: CopyState;
      let base = record?.commit;
      if (hash === now.hash) state = "current";
      else if (record) state = record.hash === hash ? "stale" : "forked";
      else {
        // Made before the record: unchanged when it is some earlier version of the built-in (the newest that matches).
        const match = [...history(id)].reverse().find((version) => version.hash === hash);
        state = match ? "stale" : "forked";
        base = match?.commit;
      }
      const versions = state === "current" ? [] : history(id);
      const from = base ? versions.findIndex((version) => version.commit.startsWith(base!) || base!.startsWith(version.commit)) : -1;
      // The commits after the base that touched it; a base that isn't in history (a commit on another branch) says none.
      const news = from >= 0 ? versions.slice(from + 1).map((version) => `${version.commit.slice(0, 8)} ${version.subject}`) : [];
      copies.push({
        id, dir, where: root.where, state, recorded: !!record, ...(base ? { base } : {}), news, differs,
        version: { builtIn: now.version, copy: manifestVersion(dir) },
      });
    }
  }
  return copies;
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

/** The user extensions folder: OUTLINER_EXTENSIONS_DIR, else `$XDG_CONFIG_HOME/pi-herdr-outliner/extensions` (or `~/.config/…`). */
export function userFolderOf(env: Record<string, string | undefined>, home: string): string {
  return env.OUTLINER_EXTENSIONS_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "pi-herdr-outliner", "extensions");
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

/** "the user folder" or "pie's folder", for people. */
export const whereWords = (where: string) => (where === "user" ? "the user folder" : `${where}'s folder`);

/** One line for a copy's state, with what to run when there is something to take. */
export function copyLine(copy: InstalledCopy): string {
  const at = `${copy.id} (${whereWords(copy.where)})`;
  const news = copy.news.length ? `: ${copy.news.length} change${copy.news.length === 1 ? "" : "s"} since it was installed` : "";
  if (copy.state === "current") return `${at} is current`;
  if (copy.state === "stale") return `${at} is an unchanged copy, behind the built-in${news}`;
  return `${at} was changed here (forked); the built-in differs in ${copy.differs.join(", ")}${news}: ep0ch ext update ${copy.id} shows the diff and asks`;
}
