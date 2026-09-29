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

async function live(path: string): Promise<{ workspace: string } | null> {
  const b = new SocketBoard(path, 1500);
  try { const i: any = await b.info(); return { workspace: String(i?.workspace ?? "?") }; }
  catch { return null; }
  finally { b.close(); }
}

export type Discovery = { path: string; why: string } | { error: string };

/** The socket to use, and why; or why none could be chosen. */
export async function discoverSocket(cwd = process.cwd(), base = stateBase()): Promise<Discovery> {
  if (process.env.EP0CH_SOCKET) return { path: process.env.EP0CH_SOCKET, why: "EP0CH_SOCKET" };
  const all = candidates(cwd, base);
  for (const c of all.filter(c => c.nearest)) {
    const l = await live(c.path);
    if (l) return { path: c.path, why: `the workspace ${l.workspace}, which this directory is in` };
  }
  const others = (await Promise.all(all.filter(c => !c.nearest).map(async c => ({ c, l: await live(c.path) })))).filter(x => x.l);
  if (others.length === 1) return { path: others[0]!.c.path, why: `the only running outline, ${others[0]!.l!.workspace}` };
  if (!others.length) return { error: `no outline service is running (looked in ${base}); start one, or pass --ws <workspace root> or a socket path` };
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
export type Target = { path: string; why: string; outline?: string; attach?: boolean } | { error: string };

/**
 * Which host outline a folder opens: the outliner's rule for a folder (pi-herdr-outliner PIE-457, kept in
 * this one function so the two stay aligned). The nearest config, from the folder up, decides: one that
 * binds an outline (`{ outline }`) opens it; one that chose another connection (`local`, `remote`) keeps
 * the folder off the host. With none, the outline named after the folder; never for the home folder or
 * `/`, which name no outline (the caller uses the host's default).
 */
export function outlineForFolder(folder: string, env: Record<string, string | undefined> = process.env):
  { outline: string; why: string } | { other: string; why: string } | { none: string } {
  const start = resolve(folder);
  for (let dir = start; ; dir = dirname(dir)) {
    const binding = bindingOf(dir, env);
    if (binding && "outline" in binding) {
      return { outline: binding.outline, why: dir === start ? `the outline ${binding.outline}, which ${start} is bound to` : `the outline ${binding.outline}, which ${dir} (above ${start}) is bound to` };
    }
    if (binding) return { other: binding.other, why: `${dir} chose a ${binding.other} connection` };
    if (dirname(dir) === dir) break;
  }
  if (start === resolve(homedir()) || start === "/") return { none: `${start} names no outline` };
  const name = slugOutlineName(basename(start));
  return { outline: name, why: `the outline ${name}, named after ${start}` };
}

/**
 * The target, Herdr-style:
 * 1. `--ws <name>`: that outline on EP0CH_SOCKET or a named socket when given (a host elsewhere), else
 *    on this machine's host.
 * 2. A socket path argument, then EP0CH_SOCKET: explicit overrides, as before (a host reached that way
 *    with no outline named serves its default).
 * 3. With a host running: the folder (`--ws <root>`, a value with `/`, else the current directory) by
 *    `outlineForFolder`; the home folder or `/` gets the host's default outline.
 * 4. Without a host: `--ws <root>` is that folder's hash socket, and otherwise `discoverSocket`, as before.
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
    if (!(await hostLive(hostSocket))) {
      return { error: `no outline host is running at ${hostSocket}, so there is no outline "${ws}" to open; start the host (pi-herdr-outliner: bun run host), or name a folder root: --ws <root>` };
    }
    return { path: hostSocket, outline: ws, attach: true, why: `the outline ${ws}` };
  }
  if (pathArg) return { path: pathArg, why: "the socket named" };
  if (env.EP0CH_SOCKET) return { path: env.EP0CH_SOCKET, why: "EP0CH_SOCKET" };
  const host = await hostLive(hostSocket);
  if (host) {
    const folder = ws ? resolve(cwd, ws.replace(/^~(?=\/|$)/, homedir())) : resolve(cwd);
    const chosen = outlineForFolder(folder, env);
    if ("outline" in chosen) return { path: hostSocket, outline: chosen.outline, attach: true, why: chosen.why };
    if ("none" in chosen) {
      if (host.defaultOutline) return { path: hostSocket, outline: host.defaultOutline, why: `the host's default outline, ${host.defaultOutline} (${chosen.none})` };
      return { error: `the outline host at ${hostSocket} has no default outline, and ${chosen.none}; pick one with --ws <name> (ep0ch outline list)` };
    }
    // The folder chose another connection: as without a host.
  }
  if (ws) return { path: socketOf(ws, base), why: `the workspace ${ws}` };
  return discoverSocket(cwd, base);
}
