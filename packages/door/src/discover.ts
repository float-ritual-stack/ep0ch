// Which outline service `ep0ch` talks to when none is named: EP0CH_SOCKET, else the service of the workspace
// the current directory is in (the nearest ancestor with a live service, hashed as `--ws` hashes it), else the
// only live service. Several live services and none of them the current directory's: ask for --ws.
// With an outline host running (PIE-457), outlines are named like Herdr sessions: see `resolveTarget`.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { hostRequest, type HostStatus, OUTLINE_NAME, SocketBoard } from "./socket";

export const stateBase = () => process.env.OUTLINER_STATE_DIR ?? join(homedir(), ".local/state/pi-herdr-outliner");
/** A workspace root's service socket: state/<sha256(root)[0:12]>/outliner.sock, as the outliner keeps it. */
export const socketOf = (root: string, base = stateBase()) =>
  join(base, createHash("sha256").update(resolve(root.replace(/^~/, homedir()))).digest("hex").slice(0, 12), "outliner.sock");

/** The candidates in order: the current directory and its ancestors first, then every other socket. */
export function candidates(cwd: string, base = stateBase()): { path: string; nearest: boolean }[] {
  const out: { path: string; nearest: boolean }[] = [];
  const seen = new Set<string>();
  for (let d = resolve(cwd); ; d = dirname(d)) {
    const p = socketOf(d, base);
    if (existsSync(p) && !seen.has(p)) { seen.add(p); out.push({ path: p, nearest: true }); }
    if (dirname(d) === d) break;
  }
  if (existsSync(base)) {
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const p = join(base, e.name, "outliner.sock");
      if (e.isDirectory() && existsSync(p) && !seen.has(p)) { seen.add(p); out.push({ path: p, nearest: false }); }
    }
  }
  return out;
}

/** A service answering there: its workspace, or why the door refuses it (older than the door); null when none answers. */
async function live(path: string): Promise<{ workspace: string } | { refused: string } | null> {
  const b = new SocketBoard(path, 1500);
  try { const i: any = await b.info(); return { workspace: String(i?.workspace ?? "?") }; }
  catch (e) { return e instanceof Error && e.message.includes("is older than this door") ? { refused: e.message } : null; }
  finally { b.close(); }
}

export type Discovery = { path: string; why: string } | { error: string };

/** The socket to use, and why; or why none could be chosen. */
export async function discoverSocket(cwd = process.cwd(), base = stateBase()): Promise<Discovery> {
  if (process.env.EP0CH_SOCKET) return { path: process.env.EP0CH_SOCKET, why: "EP0CH_SOCKET" };
  const all = candidates(cwd, base);
  for (const c of all.filter(c => c.nearest)) {
    const l = await live(c.path);
    // The outline this directory is in, but older than the door: say so, never pick another one instead.
    if (l && "refused" in l) return { error: l.refused };
    if (l) return { path: c.path, why: `the workspace ${l.workspace}, which this directory is in` };
  }
  const answered = await Promise.all(all.filter(c => !c.nearest).map(async c => ({ c, l: await live(c.path) })));
  const others = answered.flatMap(x => (x.l && "workspace" in x.l ? [{ c: x.c, l: x.l }] : []));
  const refused = answered.flatMap(x => (x.l && "refused" in x.l ? [x.l.refused] : []));
  if (others.length === 1 && !refused.length) return { path: others[0]!.c.path, why: `the only running outline, ${others[0]!.l.workspace}` };
  if (!others.length && refused.length === 1) return { error: refused[0]! };
  if (!others.length && !refused.length) return { error: `no outline service is running (looked in ${base}); start one, or pass --ws <workspace root> or a socket path` };
  if (!others.length) return { error: `every running outline is older than this door:\n${refused.map(r => `  ${r}`).join("\n")}` };
  return { error: `several outlines are running; pick one with --ws:\n${others.map(x => `  ep0ch --ws ${x.l!.workspace}`).join("\n")}` };
}

/** The outline host's socket under a state root (the outliner's outlineHostPaths). */
export const hostSocketOf = (base = stateBase()) => join(base, "outliner.sock");

/**
 * What the host at `path` says about itself, or null when nothing answers there or it isn't a host. It asks
 * `outlines.list`, which only a host answers, and which works when the default outline is missing or
 * can't open (a plain `ping` then goes to that default and fails).
 */
export async function hostLive(path: string, timeoutMs = 1500): Promise<HostStatus | null> {
  if (!existsSync(path)) return null;
  try {
    const list = await hostRequest<{ defaultOutline?: string; outlines: { name: string }[] }>(path, "outlines.list", {}, timeoutMs);
    return { socket: path, ...(list.defaultOutline ? { defaultOutline: list.defaultOutline } : {}), outlines: list.outlines.map(o => o.name) };
  } catch { return null; }
}

/** A folder's name as an outline name: the outliner's slugifyOutlineName. */
export function slugOutlineName(text: string): string {
  const slug = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return slug || "outline";
}

/** The folder's `client.json`, where the outliner keeps its connection choice (its resolveClientConfigPath). */
export function clientConfigOf(root: string, env: Record<string, string | undefined> = process.env): string {
  if (env.OUTLINER_CONFIG_PATH?.trim()) return env.OUTLINER_CONFIG_PATH.trim();
  const full = resolve(root);
  const readable = (basename(full) || "root").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const key = createHash("sha256").update(full).digest("hex").slice(0, 12);
  return join(env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), "pi-herdr-outliner", "projects", `${readable}--${key}`, "client.json");
}

/** What a folder's config chose: an outline on the host, some other connection, or nothing (undefined). */
export function bindingOf(root: string, env: Record<string, string | undefined> = process.env): { outline: string } | { other: string } | undefined {
  let value: any;
  try { value = JSON.parse(readFileSync(clientConfigOf(root, env), "utf8")); } catch { return undefined; }
  if (typeof value?.outline === "string" && OUTLINE_NAME.test(value.outline) && (value.mode === undefined || value.mode === "host")) return { outline: value.outline };
  return typeof value?.mode === "string" ? { other: value.mode } : undefined;
}

/**
 * Where the door connects: a socket, the outline it names there (on a host), and whether to attach first.
 * `attach`: the door is a session opener, so it asks the host for the outline with `create` (like
 * `herdr --session <name>`); `created` then says so on screen.
 */
export type Target = {
  path: string; why: string; outline?: string; attach?: boolean;
  /** The folder the outline belongs to, sent with `outlines.attach` so a created outline records it. */
  root?: string;
  /** Something the door says on screen when it opens (an unnamed folder that got the default). */
  notice?: string;
} | { error: string };

/** The nearest folder from `folder` up holding `.git` (a folder, or a worktree's file). */
function repositoryRoot(folder: string): string | undefined {
  for (let current = folder; ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) return current;
    if (dirname(current) === current) return undefined;
  }
}

/** `$HOME`, `/` and a folder directly under `/` (`/tmp`, `/opt`) never give their name to an outline. */
function tooBroadToName(folder: string, home: string): boolean {
  const parent = dirname(folder);
  return folder === home || parent === folder || dirname(parent) === parent;
}

/** The folder `outlines/<name>.json` records for a host outline; undefined when none, "" when unreadable. */
function recordedRoot(base: string, name: string): string | undefined {
  let text: string;
  try { text = readFileSync(join(base, "outlines", `${name}.json`), "utf8"); }
  catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? undefined : ""; }
  try {
    const root = (JSON.parse(text) as { root?: unknown }).root;
    if (root === undefined) return undefined;
    return typeof root === "string" && root.startsWith("/") ? resolve(root) : "";
  } catch { return ""; }
}

/** Where a folder's own hash database would be (its single-outline service's). */
const hashDatabaseOf = (folder: string, base: string) => join(dirname(socketOf(folder, base)), "outliner.sqlite");

/** What the folder rule decides; `root` is the folder the outline belongs to (sent with attach). */
export type FolderOutline =
  | { kind: "outline"; outline: string; root: string; why: string }
  | { kind: "other"; folder: string; why: string }
  | { kind: "unnamed"; reason: string };

/**
 * Which outline a folder opens on the host: pi-herdr-outliner's `resolveFolderOutline` and the folder part
 * of its `resolveClientPaths` (PIE-457, 5c5a14b), mirrored here and kept in this one function.
 *
 * 1. The nearest bound folder, walking up, decides: an `outline` binding opens it; a `local` or `remote`
 *    choice keeps the folder off the host. A folder's own hash database wins over an ancestor's binding.
 * 2. Otherwise a folder with its own hash database keeps it (off the host).
 * 3. Otherwise a guess: the git repository root's name (`.git` a folder or a file), else the folder's own
 *    name; a repository root that still has its own hash database keeps it.
 * 4. `$HOME`, `/` and folders directly under `/` are `unnamed` (a repository rooted at `$HOME` falls through
 *    to the folder's own name), and so is a guess whose outline records another folder.
 */
export function outlineForFolder(folderInput: string, env: Record<string, string | undefined> = process.env, base = stateBase()): FolderOutline {
  const folder = resolve(folderInput);
  const explicit = env.OUTLINER_CONFIG_PATH?.trim();
  const { OUTLINER_CONFIG_PATH: _explicit, ...walkEnv } = env;
  let bound: { dir: string; binding: { outline: string } | { other: string } } | undefined;
  if (explicit) {
    const binding = bindingOf(folder, env);
    if (binding) bound = { dir: folder, binding };
  } else {
    for (let dir = folder; ; dir = dirname(dir)) {
      const binding = bindingOf(dir, walkEnv);
      if (binding) { bound = { dir, binding }; break; }
      if (dirname(dir) === dir) break;
    }
    if (bound && bound.dir !== folder && existsSync(hashDatabaseOf(folder, base))) bound = undefined;
  }
  if (bound) {
    if ("outline" in bound.binding) {
      const { outline } = bound.binding;
      return { kind: "outline", outline, root: bound.dir, why: bound.dir === folder ? `the outline ${outline}, which ${folder} is bound to` : `the outline ${outline}, which ${bound.dir} (above ${folder}) is bound to` };
    }
    return { kind: "other", folder: bound.dir, why: `${bound.dir} chose a ${bound.binding.other} connection` };
  }
  if (explicit) return { kind: "other", folder, why: "OUTLINER_CONFIG_PATH names no outline" };
  if (existsSync(hashDatabaseOf(folder, base))) return { kind: "other", folder, why: `${folder} has its own outline database` };
  const home = resolve(env.HOME?.trim() || homedir());
  const repository = repositoryRoot(folder);
  const candidate = repository && !tooBroadToName(repository, home) ? { dir: repository, from: "repository" } : { dir: folder, from: "folder" };
  if (tooBroadToName(candidate.dir, home)) return { kind: "unnamed", reason: `${folder} is too broad to name an outline after` };
  if (candidate.dir !== folder && existsSync(hashDatabaseOf(candidate.dir, base))) return { kind: "other", folder: candidate.dir, why: `${candidate.dir} has its own outline database` };
  const outline = slugOutlineName(basename(candidate.dir));
  const recorded = recordedRoot(base, outline);
  if (recorded !== undefined && recorded !== candidate.dir) {
    return { kind: "unnamed", reason: `the outline "${outline}" belongs to ${recorded || "a folder its record does not say"}, not ${candidate.dir}` };
  }
  return { kind: "outline", outline, root: candidate.dir, why: `the outline ${outline}, named after ${candidate.from === "repository" ? "the repository at " : ""}${candidate.dir}` };
}

/** Whether an outline host is set up under the state root (its `outlines/` folder), as the outliner decides. */
export const hostConfigured = (base = stateBase()) => existsSync(join(base, "outlines"));

/**
 * The target, Herdr-style:
 * 1. `--ws <name>`: that outline on EP0CH_SOCKET or a named socket when given (a host elsewhere), else
 *    on this machine's host.
 * 2. A socket path argument, then EP0CH_SOCKET: explicit overrides, as before (a host reached that way
 *    with no outline named serves its default).
 * 3. With an outline host set up: the folder (`--ws <root>`, a value with `/`, else the current directory)
 *    by `outlineForFolder`. An `unnamed` folder with no `--ws` opens the host's default outline and says
 *    so (`notice`); the outliner refuses instead, but the door is interactive and shows the name.
 * 4. Otherwise (or a folder that keeps its own connection): `--ws <root>` is that folder's hash socket,
 *    and otherwise `discoverSocket`, as before.
 */
export async function resolveTarget(args: readonly string[], env: Record<string, string | undefined> = process.env, cwd = process.cwd(), base = stateBase()): Promise<Target> {
  const wsAt = args.indexOf("--ws");
  const ws = wsAt >= 0 ? args[wsAt + 1] : undefined;
  if (wsAt >= 0 && (!ws || ws.startsWith("--"))) return { error: "--ws needs an outline name or a workspace root" };
  const pathArg = args.find((a, i) => a.includes("/") && !["--board", "--ws", "--root"].includes(args[i - 1] ?? ""));
  const explicit = pathArg ?? env.EP0CH_SOCKET;
  const hostSocket = hostSocketOf(base);
  if (ws && !ws.includes("/") && OUTLINE_NAME.test(ws)) {
    if (explicit) return { path: explicit, outline: ws, attach: true, why: `the outline ${ws} on ${explicit}` };
    if (!hostConfigured(base) && !(await hostLive(hostSocket))) {
      return { error: `no outline host is running at ${hostSocket}, so there is no outline "${ws}" to open; start the host (pi-herdr-outliner: bun run host), or name a folder root: --ws <root>` };
    }
    return { path: hostSocket, outline: ws, attach: true, why: `the outline ${ws}` };
  }
  if (pathArg) return { path: pathArg, why: "the socket named" };
  if (env.EP0CH_SOCKET) return { path: env.EP0CH_SOCKET, why: "EP0CH_SOCKET" };
  if (hostConfigured(base)) {
    const folder = ws ? resolve(cwd, ws.replace(/^~(?=\/|$)/, homedir())) : resolve(cwd);
    const chosen = outlineForFolder(folder, env, base);
    if (chosen.kind === "outline") return { path: hostSocket, outline: chosen.outline, root: chosen.root, attach: true, why: chosen.why };
    if (chosen.kind === "unnamed") {
      const host = await hostLive(hostSocket);
      if (!host) return { error: `the outline host at ${hostSocket} isn't answering (${chosen.reason})` };
      if (host.defaultOutline) {
        const shown = folder === resolve(env.HOME?.trim() || homedir()) ? "~" : folder;
        return { path: hostSocket, outline: host.defaultOutline, why: `the host's default outline, ${host.defaultOutline} (${chosen.reason})`,
          notice: `no outline for ${shown}, opened the default: ${host.defaultOutline}` };
      }
      return { error: `${chosen.reason}, and the outline host at ${hostSocket} has no default outline; pick one with --ws <name> (ep0ch outline list)` };
    }
    // The folder keeps its own connection: as without a host.
  }
  if (ws) return { path: socketOf(ws, base), why: `the workspace ${ws}` };
  return discoverSocket(cwd, base);
}
