// What this machine's stack looks like (model.ts's Facts), gathered read-only: git (fetch and ls-remote
// only), Herdr's own answers, the outline sockets (`ping`, `outlines.list`), the file system. Nothing here
// writes a database, starts a service or changes a config.
import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { hostConfigured, hostLive, hostSocketOf } from "../discover";
import { outlinerPlugin } from "../skills";
import { hostRequest, type HostedOutline, OUTLINE_CAPABILITIES } from "../socket";
import { type Checkout, type DatabaseFacts, type Deps, detectPlatform, type Facts, type HostFacts, type HostUnit, KEYED_ACTIONS, PLUGIN_ID, type PluginFacts, type ServiceFacts, type UnitState } from "./model";
import { linkCandidates } from "./plan";

type Env = Record<string, string | undefined>;

/** Runs a command to completion; never throws. */
export async function run(cmd: string[], opts: { cwd?: string; env?: Env; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  try {
    const p = Bun.spawn(cmd, { cwd: opts.cwd, env: { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: "0" } as Record<string, string>, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => p.kill(), opts.timeoutMs ?? 20_000);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    return { code: p.signalCode ? 124 : code, out: out.trim(), err: (p.signalCode ? `timed out after ${(opts.timeoutMs ?? 20_000) / 1000}s` : err).trim() };
  } catch (e) { return { code: 127, out: "", err: (e as Error).message }; }
}

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const firstLine = (s: string) => s.split("\n").find(l => l.trim())?.trim() ?? s;

/** A checkout against origin/main, fetching first unless `fetch` is false. */
export async function inspectCheckout(root: string, fetch = true, env: Env = process.env): Promise<Checkout> {
  const git = (...args: string[]) => run(["git", "-C", root, ...args], { env });
  const none: Checkout = { root, git: false, branch: null, head: null, upstream: null, ahead: 0, behind: 0, dirty: false };
  if (!existsSync(root) || (await git("rev-parse", "--is-inside-work-tree")).out !== "true") return none;
  let fetchError: string | undefined;
  if (fetch) {
    const f = await run(["git", "-C", root, "fetch", "--quiet", "origin", "main"], { env, timeoutMs: 20_000 });
    if (f.code !== 0) fetchError = firstLine(f.err) || `git fetch exited ${f.code}`;
  }
  const [branch, head, upstream, status] = await Promise.all([git("symbolic-ref", "--quiet", "--short", "HEAD"), git("rev-parse", "HEAD"), git("rev-parse", "--verify", "--quiet", "origin/main"), git("status", "--porcelain", "--untracked-files=no")]);
  let ahead = 0, behind = 0;
  if (upstream.code === 0) {
    const counts = await git("rev-list", "--left-right", "--count", "HEAD...origin/main");
    [ahead, behind] = counts.out.split(/\s+/).map(Number) as [number, number];
  }
  return { root, git: true, branch: branch.code === 0 ? branch.out : null, head: head.code === 0 ? head.out : null, upstream: upstream.code === 0 ? upstream.out : null,
    ahead: ahead || 0, behind: behind || 0, dirty: status.out.length > 0, ...(fetchError ? { fetchError } : {}) };
}

/**
 * Whether `bun install` is needed: node_modules missing, a declared package missing, or one installed at a
 * version other than bun.lock's. (Lockfile mtimes aren't enough: an install that changes nothing leaves them.)
 */
export function depsState(root: string): Deps {
  let pkg: any;
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { return { needed: false, why: "no package.json" }; }
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  if (!names.length) return { needed: false, why: "no dependencies" };
  if (!existsSync(join(root, "node_modules"))) return { needed: true, why: "node_modules is missing" };
  let lock = "";
  try { lock = readFileSync(join(root, "bun.lock"), "utf8"); } catch { /* no lockfile: presence only */ }
  for (const name of names) {
    let installed: string | undefined;
    try { installed = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version; }
    catch { return { needed: true, why: `${name} isn't installed` }; }
    const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const locked = new RegExp(`"${esc}": \\["${esc}@([^"]+)"`).exec(lock)?.[1];
    if (locked && /^\d/.test(locked) && installed !== locked) return { needed: true, why: `${name} is ${installed}, bun.lock has ${locked}` };
  }
  return { needed: false, why: `${names.length} packages installed as bun.lock says` };
}

/** The installed Outliner code's protocol and service capabilities, from its src/types.ts (a fresh process). */
export async function pluginCode(root: string): Promise<{ protocol: number | null; capabilities: string[] | null }> {
  const types = join(root, "src/types.ts");
  if (!existsSync(types)) return { protocol: null, capabilities: null };
  const r = await run([process.execPath, "-e", `const m = await import(${JSON.stringify(types)}); console.log(JSON.stringify({ protocol: m.OUTLINER_PROTOCOL_VERSION ?? null, capabilities: m.OUTLINER_CAPABILITIES ?? null }))`], { timeoutMs: 15_000 });
  try { const v = JSON.parse(r.out); return { protocol: typeof v.protocol === "number" ? v.protocol : null, capabilities: Array.isArray(v.capabilities) ? v.capabilities : null }; }
  catch { return { protocol: null, capabilities: null }; }
}

export async function pluginFacts(env: Env, fetch: boolean): Promise<PluginFacts | null> {
  const p = outlinerPlugin(env);
  if (!p) return null;
  const root: string = p.plugin_root;
  const kind = p.source?.kind === "github" ? "github" : "local";
  const src = p.source ?? {};
  const source = kind === "github" ? { owner: src.owner ?? undefined, repo: src.repo ?? undefined, ref: src.requested_ref ?? undefined, commit: src.resolved_commit ?? undefined } : undefined;
  const isGit = existsSync(join(root, ".git"));
  const [checkout, code, remote] = await Promise.all([
    kind === "local" || isGit ? inspectCheckout(root, fetch && kind === "local", env) : Promise.resolve(null),
    pluginCode(root),
    kind === "github" && fetch && source?.owner && source.repo ? lsRemote(`https://github.com/${source.owner}/${source.repo}.git`, "main", env) : Promise.resolve(kind === "github" ? { commit: null, error: fetch ? "Herdr recorded no source repository" : "not fetched" } : undefined),
  ]);
  return { id: PLUGIN_ID, kind, root, manifestPath: p.manifest_path ?? join(root, "herdr-plugin.toml"), enabled: p.enabled !== false, ...(source ? { source } : {}),
    checkout, ...(remote ? { remote } : {}), ...code, deps: existsSync(root) ? depsState(root) : null,
    actions: Array.isArray(p.actions) ? p.actions.map((a: any) => String(a?.id)) : [] };
}

/** A ref's commit on a remote; a full commit id is its own answer. */
async function lsRemote(url: string, ref: string, env: Env): Promise<{ commit: string | null; error?: string }> {
  if (/^[0-9a-f]{40}$/.test(ref)) return { commit: ref };
  const r = await run(["git", "ls-remote", url, `refs/heads/${ref}`, `refs/tags/${ref}`], { env, timeoutMs: 15_000 });
  if (r.code !== 0) return { commit: null, error: firstLine(r.err) || `git ls-remote exited ${r.code}` };
  const commit = r.out.split("\n")[0]?.split(/\s+/)[0];
  return commit ? { commit } : { commit: null, error: `${ref} isn't a branch or tag of ${url}` };
}

/** The key bound to each of the plugin's keyed actions in Herdr's config.toml. */
export function herdrKeys(configPath: string): Record<string, string> {
  let text = "";
  try { text = readFileSync(configPath, "utf8"); } catch { return {}; }
  const keys: Record<string, string> = {};
  for (const block of text.split(/^\s*\[\[\s*keys\s*\.\s*command\s*\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\s*\[/m)[0]!;
    const key = /^\s*key\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    const command = /^\s*command\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    const action = command?.startsWith(`${PLUGIN_ID}.`) ? command.slice(PLUGIN_ID.length + 1) : undefined;
    if (key && action && (KEYED_ACTIONS as readonly string[]).includes(action) && !keys[action]) keys[action] = key;
  }
  return keys;
}

/**
 * A unit that runs the outline host (host-main.ts): a systemd user unit on Linux, a launchd agent on macOS.
 * Only one serving `base`, the state folder whose socket is being asked about (its OUTLINER_STATE_DIR, else
 * the host's default): a unit for another state folder is another host, and install never restarts it for
 * this one (a scratch host in a test must never restart the person's).
 */
export function hostUnit(platform: Facts["platform"], home: string, base = join(home, ".local/state/pi-herdr-outliner")): HostFacts["unit"] {
  const [kind, dir, ext] = platform === "linux" ? ["systemd", join(home, ".config/systemd/user"), ".service"] as const
    : platform === "macos" ? ["launchd", join(home, "Library/LaunchAgents"), ".plist"] as const : [null, "", ""] as const;
  if (!kind || !existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter(n => n.endsWith(ext)).sort()) {
    let text: string;
    try { text = readFileSync(join(dir, file), "utf8"); } catch { continue; /* unreadable: not ours */ }
    if (!text.includes("host-main.ts")) continue;
    if (resolve(unitStateDir(kind, text, home) ?? join(home, ".local/state/pi-herdr-outliner")) !== resolve(base)) continue;
    const label = kind === "launchd" ? /<key>\s*Label\s*<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]?.trim() : undefined;
    const program = /[^\s<>"'=]*host-main\.ts/.exec(text)?.[0];
    return { kind, path: join(dir, file), name: label || (kind === "launchd" ? file.replace(/\.plist$/, "") : file), ...(program ? { program } : {}) };
  }
  return null;
}

/** The OUTLINER_STATE_DIR a unit sets: systemd's Environment= (%h is the home folder), a plist's EnvironmentVariables. */
function unitStateDir(kind: "systemd" | "launchd", text: string, home: string): string | null {
  const found = kind === "systemd"
    ? /^\s*Environment\s*=.*?"?OUTLINER_STATE_DIR=("[^"]*"|[^\s"]+)/m.exec(text)?.[1]
    : /<key>\s*OUTLINER_STATE_DIR\s*<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
  return found ? found.replace(/^"|"$/g, "").trim().replace(/%h/g, home) : null;
}

/** launchd's answer to `launchctl print gui/<uid>/<label>`: its own state, pid and last exit (the job's top-level lines). */
export function launchdState(printed: string | null): UnitState {
  if (printed === null) return { active: false, detail: "not loaded in launchd" };
  const top = (key: string) => new RegExp(`^\t${key} = (.+)$`, "m").exec(printed)?.[1]?.trim();
  const state = top("state"), pid = Number(top("pid")), lastExit = top("last exit code");
  return { active: state === undefined ? null : state === "running", ...(pid > 0 ? { pid } : {}), ...(lastExit ? { lastExit } : {}),
    detail: `launchd: ${state ?? "state unknown"}${pid > 0 ? `, pid ${pid}` : ""}${lastExit && lastExit !== "(never exited)" ? `, last exit ${lastExit}` : ""}` };
}

/** systemd's answer to `systemctl --user show <unit> -p ActiveState,SubState,MainPID,ExecMainStatus`. */
export function systemdState(shown: string | null): UnitState {
  if (shown === null) return { active: null, detail: "systemd didn't answer" };
  const v = Object.fromEntries(shown.split("\n").map(l => l.split("=", 2) as [string, string]).filter(([k, x]) => k && x !== undefined));
  const pid = Number(v.MainPID);
  return { active: v.ActiveState === undefined ? null : v.ActiveState === "active", ...(pid > 0 ? { pid } : {}), ...(v.ExecMainStatus && v.ExecMainStatus !== "0" ? { lastExit: v.ExecMainStatus } : {}),
    detail: `systemd: ${v.ActiveState ?? "state unknown"}${v.SubState ? ` (${v.SubState})` : ""}${pid > 0 ? `, pid ${pid}` : ""}${v.ExecMainStatus && v.ExecMainStatus !== "0" ? `, last exit ${v.ExecMainStatus}` : ""}` };
}

/** What launchd or systemd says about the host's unit now. Read-only. */
export async function unitState(unit: HostUnit, uid = process.getuid?.() ?? 0): Promise<UnitState> {
  if (unit.kind === "launchd") {
    const r = await run(["launchctl", "print", `gui/${uid}/${unit.name}`], { timeoutMs: 5000 });
    return launchdState(r.code === 0 ? r.out : null);
  }
  const r = await run(["systemctl", "--user", "show", unit.name, "-p", "ActiveState,SubState,MainPID,ExecMainStatus"], { timeoutMs: 5000 });
  return systemdState(r.code === 0 ? r.out : null);
}

type Ping = { protocolVersion?: number; capabilities?: string[]; location?: { workspaceRoot?: string }; outline?: { name?: string } };
const ping = (socket: string, params: Record<string, unknown> = {}) => hostRequest<Ping>(socket, "ping", params, 1500).catch(() => null);

/**
 * The outline a read-only `ping` may go to on the host: the default when it is open, else any open one.
 * A plain `ping` goes to the default outline, and the host opens it when it's closed; so a closed outline
 * is never pinged (with none open, the host's protocol stays unknown).
 */
export function openOutlineToPing(outlines: readonly HostedOutline[]): string | null {
  return (outlines.find(o => o.open && o.default) ?? outlines.find(o => o.open))?.name ?? null;
}

export async function hostFacts(base: string, platform: Facts["platform"], home: string): Promise<HostFacts> {
  const socket = hostSocketOf(base);
  const found = hostUnit(platform, home, base);
  const [live, state] = await Promise.all([hostLive(socket), found ? unitState(found) : Promise.resolve(undefined)]);
  const unit = found && state ? { ...found, state } : found;
  if (!live) return { socket, configured: hostConfigured(base), running: false, outlines: [], unit };
  const list = await hostRequest<{ outlines: HostedOutline[] }>(socket, "outlines.list", {}, 3000).catch(() => ({ outlines: [] as HostedOutline[] }));
  const target = openOutlineToPing(list.outlines);
  const p = target ? await ping(socket, { outline: target }) : null;
  return { socket, configured: true, running: true, ...(live.defaultOutline ? { defaultOutline: live.defaultOutline } : {}), outlines: list.outlines,
    ...(p?.protocolVersion !== undefined ? { protocol: p.protocolVersion } : {}), capabilities: p?.capabilities ?? null, unit };
}

/** Each `<state>/<hash>/` with a socket or a database: a per-folder outline service. */
export async function serviceFacts(base: string): Promise<ServiceFacts[]> {
  if (!existsSync(base)) return [];
  const dirs = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && /^[0-9a-f]{12}$/.test(d.name)).map(d => join(base, d.name));
  const found = await Promise.all(dirs.map(async (stateDir): Promise<ServiceFacts | null> => {
    const socket = join(stateDir, "outliner.sock"), db = join(stateDir, "outliner.sqlite");
    if (!existsSync(socket) && !existsSync(db)) return null;
    const answer = existsSync(socket) ? await ping(socket) : null;
    let name: string | undefined, root: string | undefined, paneId: string | undefined;
    try { const o = JSON.parse(readFileSync(join(stateDir, "outline.json"), "utf8")); name = o.name; root = o.root; } catch { /* none */ }
    try { paneId = JSON.parse(readFileSync(join(stateDir, "service-pane.json"), "utf8")).paneId; } catch { /* none */ }
    root = answer?.location?.workspaceRoot ?? root;
    name = answer?.outline?.name ?? name ?? (root ? root.split("/").filter(Boolean).pop() : undefined);
    return { stateDir, socket, database: existsSync(db) ? real(db) : null, running: !!answer, ...(name ? { name } : {}), ...(root ? { root } : {}),
      ...(answer?.protocolVersion !== undefined ? { protocol: answer.protocolVersion } : {}), ...(answer ? { capabilities: answer.capabilities ?? null } : {}), ...(paneId ? { paneId } : {}) };
  }));
  return found.filter((s): s is ServiceFacts => !!s);
}


/**
 * Every local outline database, once: the host's outlines (by name; `outlines/*.sqlite`, links for adopted
 * ones, read even when the host is down) first, then each folder service's that isn't one of them.
 */
export function databases(base: string, host: HostFacts, services: ServiceFacts[]): DatabaseFacts[] {
  const out: DatabaseFacts[] = [];
  const seen = new Set<string>();
  const add = (name: string, path: string, from: DatabaseFacts["from"]) => {
    if (!existsSync(path)) return;
    const r = real(path);
    if (seen.has(r)) return;
    seen.add(r); out.push({ name, path: r, from });
  };
  for (const o of host.outlines) add(o.name, o.database, "host");
  const dir = join(base, "outlines");
  if (existsSync(dir)) for (const f of readdirSync(dir).filter(n => n.endsWith(".sqlite")).sort()) add(f.replace(/\.sqlite$/, ""), join(dir, f), "host");
  for (const s of services) if (s.database) add(s.name ?? s.stateDir.split("/").pop()!, s.database, "folder");
  return out;
}

const splitDirs = (v: unknown) => (typeof v === "string" ? v.split(delimiter).map(d => d.trim()).filter(Boolean) : null);

/** The first `name` on PATH that is an executable file. */
function which(name: string, pathDirs: string[]): string | null {
  for (const d of pathDirs) {
    const p = join(d, name);
    try { if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return p; } } catch { /* next */ }
  }
  return null;
}

export interface GatherOptions { env?: Env; fetch?: boolean; doorRoot?: string; platform?: string }

export async function gatherFacts(o: GatherOptions = {}): Promise<Facts> {
  const env = o.env ?? process.env;
  const platform = detectPlatform(o.platform);
  const home = resolve(env.HOME || homedir());
  const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const fetch = o.fetch ?? true;
  const doorRoot = o.doorRoot ?? resolve(import.meta.dir, "../..");
  const entry = join(doorRoot, "src/main.ts");
  const base = env.OUTLINER_STATE_DIR ?? join(home, ".local/state/pi-herdr-outliner");

  const bunPath = which("bun", pathDirs);
  const herdrPath = env.HERDR_BIN_PATH && existsSync(env.HERDR_BIN_PATH) ? env.HERDR_BIN_PATH : which("herdr", pathDirs);
  const configPath = env.HERDR_CONFIG_PATH || join(env.XDG_CONFIG_HOME || join(home, ".config"), "herdr/config.toml");

  const [bunVersion, herdrVersion, server, plugin, doorCheckout, host, services] = await Promise.all([
    bunPath ? run([bunPath, "--version"], { env, timeoutMs: 5000 }).then(r => r.code === 0 ? r.out : null) : null,
    herdrPath ? run([herdrPath, "--version"], { env, timeoutMs: 5000 }).then(r => r.code === 0 ? r.out.replace(/^herdr\s+/, "") : null) : null,
    herdrPath ? run([herdrPath, "status", "server", "--json"], { env, timeoutMs: 5000 }).then(r => { try { return JSON.parse(r.out).running === true; } catch { return false; } }) : null,
    herdrPath ? pluginFacts({ ...env, HERDR_BIN_PATH: herdrPath }, fetch) : null,
    inspectCheckout(doorRoot, fetch, env),
    hostFacts(base, platform, home),
    serviceFacts(base),
  ]);

  const found = which("ep0ch", pathDirs);
  const target = found ? real(found) : null;
  const linkDirs = linkCandidates(home).map(dir => {
    const onPath = pathDirs.some(p => real(p) === real(dir));
    let writable = false;
    try { writable = statSync(dir).isDirectory(); accessSync(dir, constants.W_OK); } catch { writable = false; }
    let existing: "link" | "broken-link" | "file" | undefined;
    try { const l = lstatSync(join(dir, "ep0ch")); existing = l.isSymbolicLink() ? (existsSync(join(dir, "ep0ch")) ? "link" : "broken-link") : "file"; } catch { /* none */ }
    return { dir, onPath, writable, ...(existing ? { existing } : {}) };
  });

  const settingsPath = join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json");
  let settingsDirs: string[] | null = null;
  try { settingsDirs = splitDirs(JSON.parse(readFileSync(settingsPath, "utf8"))?.env?.CLAUDE_CODE_PLUGIN_DIRS); } catch { /* none */ }

  return {
    platform, home, pathDirs,
    bun: { path: bunPath, version: bunVersion },
    herdr: { path: herdrPath, version: herdrVersion, server, configPath, keys: herdrKeys(configPath), inside: env.HERDR_ENV === "1" },
    plugin,
    door: { checkout: doorCheckout, deps: depsState(doorRoot), entry },
    ep0ch: { found, target, pointsHere: target === real(entry) },
    linkDirs,
    host,
    services,
    databases: databases(base, host, services),
    claude: { settingsPath, settingsDirs, envDirs: splitDirs(env.CLAUDE_CODE_PLUGIN_DIRS), ...(env.FORCE_HYPERLINK !== undefined ? { forceHyperlink: env.FORCE_HYPERLINK } : {}) },
    expected: plugin?.capabilities ?? [...OUTLINE_CAPABILITIES],
  };
}

