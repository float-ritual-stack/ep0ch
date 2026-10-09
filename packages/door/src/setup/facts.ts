// What this machine's stack looks like (model.ts's Facts), gathered read-only: git (fetch and ls-remote
// only), Herdr's own answers, the outline host's socket (`ping`, `outlines.list`), the file system. Nothing
// here writes a database, starts a host or changes a config.
import { Database } from "bun:sqlite";
import { drawerProgram } from "../desk/drawer-program";
import { defaultStateDir } from "../state";
import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { hostLive, hostSocketOf, outlinesDir, resolveTarget } from "../discover";
import { machineStatus, usedMachines } from "../machine";
import { binDirOf, extFacts } from "./ext-links";
import { skillLinkFacts } from "./skill-links";
import { outlinerPlugin } from "../skills";
import { packDir, packs } from "../packs";
import { outlineOfFile } from "@ep0ch/outline-core/outline-location";
import { doorAgents } from "../desk/agent-env";
import { hostRequest, type HostedOutline } from "../socket";
import { type Checkout, type DatabaseFacts, type Deps, detectPlatform, type Facts, type HereFacts, type HostFacts, type HostUnit, KEYED_ACTIONS, type McpFacts, PLUGIN_ID, type PluginFacts, type RepoFacts, type SchemaCode, type SchemaFacts, type OutlineSchema, type SessionFact, type UnitState } from "./model";
import { chooseLinkDir, linkCandidates } from "./plan";

type Env = Record<string, string | undefined>;

/** A line of a child's output as it arrives (the progress line under a running step shows the latest). */
export type OnLine = (line: string) => void;

/**
 * The process groups `run` has going: Ctrl+C (setup's SIGINT path) and the door's exit stop them, since a group
 * of its own doesn't get the terminal's SIGINT (a `git pull` left running would hold .git/index.lock).
 */
const liveGroups = new Set<number>();
let exitHooked = false;

/** Stop every command `run` still has going (its whole process group): Ctrl+C during install, and on exit. */
export function stopRunning(sig: NodeJS.Signals = "SIGTERM"): void {
  for (const pid of liveGroups) { try { process.kill(-pid, sig); } catch { /* gone */ } }
}

/**
 * Runs a command to completion; never throws. With `onLine`, its output is read as it arrives and each
 * chunk's latest line (a `\r`-redrawn progress line too) is passed on; the whole output is still returned.
 * Past `timeoutMs` the wait ends (code 124, with what it had written so far): the command runs in its own
 * process group, and the whole group is stopped (TERM, then KILL if it lingers), so a grandchild holding its
 * output open (git fetch's git-remote-https on a hung network) neither keeps the wait going nor outlives it.
 */
export async function run(cmd: string[], opts: { cwd?: string; env?: Env; timeoutMs?: number; onLine?: OnLine } = {}): Promise<{ code: number; out: string; err: string }> {
  const ms = opts.timeoutMs ?? 20_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pid: number | undefined;
  try {
    if (!exitHooked) { exitHooked = true; process.on("exit", () => stopRunning()); }
    const p = Bun.spawn(cmd, { cwd: opts.cwd, env: { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: "0" } as Record<string, string>, stdout: "pipe", stderr: "pipe", stdin: "ignore", detached: true });
    pid = p.pid;
    liveGroups.add(pid);
    const group = (sig: NodeJS.Signals) => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } } };
    const got = { out: "", err: "" };
    const done = Promise.all([drain(p.stdout, opts.onLine, t => { got.out += t; }), drain(p.stderr, opts.onLine, t => { got.err += t; }), p.exited]);
    const late = new Promise<null>(res => { timer = setTimeout(() => res(null), ms); });
    const r = await Promise.race([done, late]);
    if (!r) {
      group("SIGTERM");
      // What ignores TERM is killed; either way the streams close once the group is gone, and the reads end with them.
      let ended = false;
      const gone = () => { ended = true; liveGroups.delete(p.pid); };
      done.then(gone, gone);
      setTimeout(() => { if (!ended) group("SIGKILL"); }, 2000).unref?.();
      pid = undefined;   // still stopping: it stays in liveGroups until its streams close
      return { code: 124, out: got.out.trim(), err: `${got.err.trim()}${got.err.trim() ? "\n" : ""}timed out after ${ms / 1000}s` };
    }
    const [out, err, code] = r;
    return { code, out: out.trim(), err: err.trim() };
  } catch (e) { return { code: 127, out: "", err: (e as Error).message }; }
  finally {
    clearTimeout(timer);
    if (pid !== undefined) liveGroups.delete(pid);
  }
}

/**
 * A stream's text; with `onLine`, read chunk by chunk, each chunk's latest non-blank line passed on as it comes.
 * `got` sees each chunk's text as it's read (what a timed-out command had said).
 */
export async function drain(stream: ReadableStream<Uint8Array>, onLine?: OnLine, got?: (text: string) => void): Promise<string> {
  if (!onLine && !got) return new Response(stream).text();
  const decoder = new TextDecoder();
  let all = "", partial = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    got?.(text);
    if (!onLine) continue;
    const parts = (partial + text).split(/\r\n|\r|\n/);
    partial = parts.pop()!;
    // The last whole line; an unfinished one only when there is nothing else (a prompt, a line still coming).
    const last = [...parts.reverse(), partial].find(l => l.trim());
    if (last) onLine(last);
  }
  return all + decoder.decode();
}

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** What went wrong in git's stderr: its fatal: or error: line, not the progress lines before it. */
const gitError = (s: string) => s.split(/\r|\n/).map(l => l.trim()).find(l => /^(fatal|error):/.test(l)) ?? s.split(/\r|\n/).map(l => l.trim()).filter(Boolean).at(-1) ?? "";

/** git's words for a fetch that lost the ref's lock to another process updating it at the same moment. */
export const fetchRace = (error: string) => /cannot lock ref '[^']+': is at \S+ but expected/.test(error);

/** A checkout against origin/main, fetching first unless `fetch` is false. */
/** How long a `git fetch` may take: a slow link needs more than a few seconds, and the person sees it run. */
export const FETCH_TIMEOUT_MS = 90_000;

export async function inspectCheckout(root: string, fetch = true, env: Env = process.env, onLine?: OnLine): Promise<Checkout> {
  const git = (...args: string[]) => run(["git", "-C", root, ...args], { env });
  const none: Checkout = { root, git: false, branch: null, head: null, upstream: null, ahead: 0, behind: 0, dirty: false };
  if (!existsSync(root) || (await git("rev-parse", "--is-inside-work-tree")).out !== "true") return none;
  let fetchError: string | undefined, fetchRaced = false;
  if (fetch) {
    // --progress: git's counting and receiving lines, for the line under the spinner (stderr isn't a terminal).
    const f = await run(["git", "-C", root, "fetch", "--progress", "origin", "main"], { env, timeoutMs: FETCH_TIMEOUT_MS, onLine });
    if (f.code !== 0) fetchError = gitError(f.err) || `git fetch exited ${f.code}`;
    // Another git process (an editor's, a second install's) fetched at the same moment and wrote origin/main first.
    if (fetchError && fetchRace(fetchError)) { fetchError = undefined; fetchRaced = true; }
  }
  const [branch, head, upstream, status] = await Promise.all([git("symbolic-ref", "--quiet", "--short", "HEAD"), git("rev-parse", "HEAD"), git("rev-parse", "--verify", "--quiet", "origin/main"), git("status", "--porcelain", "--untracked-files=no")]);
  let ahead = 0, behind = 0;
  if (upstream.code === 0) {
    const counts = await git("rev-list", "--left-right", "--count", "HEAD...origin/main");
    [ahead, behind] = counts.out.split(/\s+/).map(Number) as [number, number];
  }
  return { root, git: true, branch: branch.code === 0 ? branch.out : null, head: head.code === 0 ? head.out : null, upstream: upstream.code === 0 ? upstream.out : null,
    ahead: ahead || 0, behind: behind || 0, dirty: status.out.length > 0, ...(fetchError ? { fetchError } : {}), ...(fetchRaced ? { fetchRaced: true as const } : {}) };
}

/**
 * Whether `bun install` is needed: node_modules missing, a declared package missing, or one installed at a
 * version other than bun.lock's. The root's dependencies and every workspace package's (`workspaces: ["dir/*"]`)
 * count; a workspace package's own are found in its node_modules or the root's, as bun's isolated or hoisted
 * installs put them. (Lockfile mtimes aren't enough: an install that changes nothing leaves them.)
 */
export function depsState(root: string): Deps {
  const read = (dir: string): any => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return null; } };
  const pkg = read(root);
  if (!pkg) return { needed: false, why: "no package.json" };
  const members = (Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? []).flatMap((glob: string) => {
    if (!glob.endsWith("/*")) return [glob];
    const dir = glob.slice(0, -2);
    try { return readdirSync(join(root, dir)).map(name => `${dir}/${name}`); } catch { return []; }
  }).flatMap((m: string) => { const p = read(join(root, m)); return p ? [{ where: m, p }] : []; });
  const wants: { name: string; where: string }[] = [];
  for (const { where, p } of [{ where: "", p: pkg }, ...members]) {
    for (const [name, range] of Object.entries({ ...p.dependencies, ...p.devDependencies })) {
      if (!String(range).startsWith("workspace:")) wants.push({ name, where });
    }
  }
  if (!wants.length) return { needed: false, why: "no dependencies" };
  if (!existsSync(join(root, "node_modules"))) return { needed: true, why: "node_modules is missing" };
  let lock = "";
  try { lock = readFileSync(join(root, "bun.lock"), "utf8"); } catch { /* no lockfile: presence only */ }
  for (const { name, where } of wants) {
    const at = where ? ` (${where})` : "";
    let installed: string | undefined;
    for (const dir of where ? [join(root, where), root] : [root]) {
      try { installed = JSON.parse(readFileSync(join(dir, "node_modules", name, "package.json"), "utf8")).version; break; } catch { /* next */ }
    }
    if (installed === undefined) return { needed: true, why: `${name} isn't installed${at}` };
    const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const locked = new RegExp(`"${esc}": \\["${esc}@([^"]+)"`).exec(lock)?.[1];
    if (locked && /^\d/.test(locked) && installed !== locked) return { needed: true, why: `${name} is ${installed}, bun.lock has ${locked}${at}` };
  }
  return { needed: false, why: `${wants.length} packages installed as bun.lock says` };
}

/**
 * The protocol a checkout's code speaks: outline-core's protocol.ts beside `packageRoot` (packages/outliner, or a
 * managed plugin's root), read in a fresh process so a pull that changed it is seen.
 */
export async function pluginCode(packageRoot: string): Promise<{ protocol: number | null }> {
  const file = join(packageRoot, "../outline-core/src/protocol.ts");
  if (!existsSync(file)) return { protocol: null };
  const r = await run([process.execPath, "-e", `const m = await import(${JSON.stringify(file)}); console.log(JSON.stringify({ protocol: m.PROTOCOL ?? null }))`], { timeoutMs: 15_000 });
  try { const v = JSON.parse(r.out); return { protocol: typeof v.protocol === "number" ? v.protocol : null }; }
  catch { return { protocol: null }; }
}

export async function pluginFacts(env: Env, fetch: boolean, onLine?: OnLine): Promise<PluginFacts | null> {
  const p = outlinerPlugin(env);
  if (!p) return null;
  const root: string = p.plugin_root;
  const kind = p.source?.kind === "github" ? "github" : "local";
  const src = p.source ?? {};
  const source = kind === "github" ? { owner: src.owner ?? undefined, repo: src.repo ?? undefined, ref: src.requested_ref ?? undefined, commit: src.resolved_commit ?? undefined } : undefined;
  const isGit = existsSync(join(root, ".git"));
  const [checkout, code, remote] = await Promise.all([
    kind === "local" || isGit ? inspectCheckout(root, fetch && kind === "local", env, onLine) : Promise.resolve(null),
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
  const r = await run(["git", "ls-remote", url, `refs/heads/${ref}`, `refs/tags/${ref}`], { env, timeoutMs: 60_000 });
  if (r.code !== 0) return { commit: null, error: gitError(r.err) || `git ls-remote exited ${r.code}` };
  const commit = r.out.split("\n")[0]?.split(/\s+/)[0];
  return commit ? { commit } : { commit: null, error: `${ref} isn't a branch or tag of ${url}` };
}

/** Chords in Herdr's config.toml that hold ctrl, alt, shift and cmd (or super) together, which Herdr takes before a pane sees them. */
export function herdrHyperChords(configPath: string): string[] {
  let text = "";
  try { text = readFileSync(configPath, "utf8"); } catch { return []; }
  const found = new Set<string>();
  for (const m of text.matchAll(/"([^"\n]*\+[^"\n]*)"/g)) {
    for (const chord of m[1]!.split(/\s*,\s*/)) {
      const parts = chord.toLowerCase().split("+").filter(p => p !== "prefix");
      if (["ctrl", "alt", "shift"].every(x => parts.includes(x)) && (parts.includes("cmd") || parts.includes("super"))) found.add(chord);
    }
  }
  return [...found];
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
 * Only one serving `outlines`, the outlines folder being asked about (its EP0CH_OUTLINES, else ~/outlines): a
 * unit for another folder is another host, and install never restarts it for this one (a scratch host in a test
 * must never restart the person's). What it still sets from before outlines by name is listed in `stale`.
 */
export function hostUnit(platform: Facts["platform"], home: string, outlines = join(home, "outlines")): HostFacts["unit"] {
  const [kind, dir, ext] = platform === "linux" ? ["systemd", join(home, ".config/systemd/user"), ".service"] as const
    : platform === "macos" ? ["launchd", join(home, "Library/LaunchAgents"), ".plist"] as const : [null, "", ""] as const;
  if (!kind || !existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter(n => n.endsWith(ext)).sort()) {
    let text: string;
    try { text = readFileSync(join(dir, file), "utf8"); } catch { continue; /* unreadable: not ours */ }
    if (!text.includes("host-main.ts")) continue;
    const served = resolve(unitEnv(kind, text, "EP0CH_OUTLINES", home) ?? join(home, "outlines"));
    if (served !== resolve(outlines)) continue;
    const label = kind === "launchd" ? /<key>\s*Label\s*<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]?.trim() : undefined;
    const program = /[^\s<>"'=]*host-main\.ts/.exec(text)?.[0];
    const stale = (["OUTLINER_STATE_DIR", "OUTLINER_DEFAULT_OUTLINE"] as const).filter(k => unitEnv(kind, text, k, home) !== null);
    return { kind, path: join(dir, file), name: label || (kind === "launchd" ? file.replace(/\.plist$/, "") : file), ...(program ? { program } : {}), outlines: served, stale };
  }
  return null;
}

/** A variable a unit sets: systemd's Environment= (%h is the home folder), a plist's EnvironmentVariables; null when unset. */
export function unitEnv(kind: "systemd" | "launchd", text: string, name: string, home: string): string | null {
  const found = kind === "systemd"
    ? new RegExp(`^\\s*Environment\\s*=.*?"?${name}=("[^"]*"|[^\\s"]+)`, "m").exec(text)?.[1]
    : new RegExp(`<key>\\s*${name}\\s*</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1];
  return found === undefined ? null : found.replace(/^"|"$/g, "").trim().replace(/%h/g, home);
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

/**
 * The units that run the remote MCP gateway (`… src/main.ts mcp serve --http`): systemd user units, or launchd agents,
 * whose ExecStart (ProgramArguments) runs it; comments and descriptions don't count. `door`: the door folder whose
 * main.ts it runs, from an absolute path in the command, else its WorkingDirectory (%h the home folder) for a relative
 * one; null when that can't be told (then it's never restarted for a checkout).
 */
export function mcpUnits(platform: Facts["platform"], home: string): { kind: "systemd" | "launchd"; path: string; name: string; door: string | null }[] {
  const [kind, dir, ext] = platform === "linux" ? ["systemd", join(home, ".config/systemd/user"), ".service"] as const
    : platform === "macos" ? ["launchd", join(home, "Library/LaunchAgents"), ".plist"] as const : [null, "", ""] as const;
  if (!kind || !existsSync(dir)) return [];
  const expand = (p: string) => p.trim().replace(/%h/g, home).replace(/^~(?=\/)/, home);
  return readdirSync(dir).filter(n => n.endsWith(ext)).sort().flatMap(file => {
    let text: string;
    try { text = readFileSync(join(dir, file), "utf8"); } catch { return []; }
    const command = kind === "systemd"
      ? /^\s*ExecStart\s*=\s*(.+)$/m.exec(text)?.[1]
      : (/<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? "").replace(/<\/?string>/g, " ");
    const run = command ? /(\S*src\/main\.ts)\s+mcp\s+serve\b.*--http/.exec(command) : null;
    if (!run) return [];
    const wd = kind === "systemd" ? /^\s*WorkingDirectory\s*=\s*(.+)$/m.exec(text)?.[1] : /<key>\s*WorkingDirectory\s*<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
    const entry = expand(run[1]!), main = entry.startsWith("/") ? entry : wd ? resolve(expand(wd), entry) : null;
    const label = kind === "launchd" ? /<key>\s*Label\s*<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]?.trim() : undefined;
    return [{ kind, path: join(dir, file), name: label || (kind === "launchd" ? file.replace(/\.plist$/, "") : file), door: main ? resolve(main, "../..") : null }];
  });
}

/**
 * The door a systemd unit runs as systemd loaded it (`systemctl --user show -p ExecStart -p WorkingDirectory`, drop-ins
 * included): its main.ts's folder; null when it doesn't run one it can tell; undefined when systemd didn't answer.
 */
export async function loadedDoor(name: string, home: string): Promise<string | null | undefined> {
  const r = await run(["systemctl", "--user", "show", name, "-p", "ExecStart", "-p", "WorkingDirectory"], { timeoutMs: 5000 });
  return r.code === 0 ? doorOfShown(r.out, home) : undefined;
}
/** systemd's ExecStart (`{ path=… ; argv[]=… ; … }`) and WorkingDirectory as the door folder whose main.ts it runs. */
export function doorOfShown(shown: string, home: string): string | null {
  const argv = /argv\[\]=([^;]*)/.exec(shown)?.[1] ?? "";
  const main = /(\S*src\/main\.ts)\s+mcp\s+serve\b.*--http/.exec(argv)?.[1];
  if (!main) return null;
  const wd = /^WorkingDirectory=(.*)$/m.exec(shown)?.[1]?.trim().replace(/^!/, "").replace(/^~(?=\/|$)/, home);
  const abs = main.startsWith("/") ? main : wd ? resolve(wd, main) : null;
  return abs ? resolve(abs, "../..") : null;
}

/** When process `pid` started, in unix seconds: now less its elapsed time (`ps -o etime=`, [[dd-]hh:]mm:ss). */
export async function processStart(pid: number): Promise<number | undefined> {
  const r = await run(["ps", "-o", "etime=", "-p", String(pid)], { timeoutMs: 5000 });
  return r.code === 0 ? startFromElapsed(r.out, Date.now()) : undefined;
}
/** `ps -o etime=`'s [[dd-]hh:]mm:ss as the start time in unix seconds, `now` being when it was asked. */
export function startFromElapsed(etime: string, now: number): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return undefined;
  return Math.floor(now / 1000) - (Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]));
}

/** HEAD's moves in a checkout, newest first: each commit it moved to and when (unix seconds), from its reflog. */
export async function headMoves(root: string): Promise<{ commit: string; at: number }[]> {
  const r = await run(["git", "-C", root, "log", "-g", "--date=unix", "--format=%H %gd", "HEAD", "-n", "200"], { timeoutMs: 5000 });
  if (r.code !== 0) return [];
  return r.out.split("\n").flatMap(l => { const m = /^([0-9a-f]{40}) HEAD@\{(\d+)\}$/.exec(l.trim()); return m ? [{ commit: m[1]!, at: Number(m[2]) }] : []; });
}

/**
 * The remote MCP gateway as install and doctor see it (McpFacts): its unit (this checkout's when one runs it, else the
 * first), the door it runs, and, while it runs, when it started, the commit the checkout was at then, and whether HEAD
 * is another commit now. A move in the second it started counts as after it (a restart too many is harmless, a missed
 * one isn't); a reflog entry that left HEAD where it was (a no-op reset) doesn't. `behind` is left out when it can't
 * be told (no start time, no reflog).
 */
export async function mcpFacts(platform: Facts["platform"], home: string, repoRoot: string): Promise<McpFacts | null> {
  const door = resolve(repoRoot, "packages/door");
  // systemd's loaded configuration (drop-ins included) says what each unit runs, over its file.
  const all = await Promise.all(mcpUnits(platform, home).map(async x => {
    const loaded = x.kind === "systemd" ? await loadedDoor(x.name, home) : undefined;
    const st = await unitState({ ...x, outlines: "", stale: [] });
    return { ...x, door: loaded !== undefined ? loaded : x.door, state: st };
  }));
  const u = all.find(x => x.door === door && x.state.active) ?? all.find(x => x.door === door) ?? all[0];
  if (!u) return null;
  const { door: runs, state, ...unit } = u;
  const startedAt = state.active && state.pid ? await processStart(state.pid) : undefined;
  if (startedAt === undefined) return { unit: { ...unit, state }, door: runs };
  const moves = await headMoves(repoRoot);
  if (!moves.length) return { unit: { ...unit, state }, door: runs, startedAt };
  return { unit: { ...unit, state }, door: runs, startedAt, ...movedSince(moves, startedAt) };
}

/**
 * Against HEAD's moves (newest first), a process started at `startedAt`: the commit HEAD was at then (its last move
 * before that second), and whether HEAD is another commit now. A move in the second it started counts as after it;
 * an entry that left HEAD where it was doesn't.
 */
export function movedSince(moves: readonly { commit: string; at: number }[], startedAt: number): { runs: string | null; behind?: boolean } {
  const was = moves.find(m => m.at < startedAt)?.commit ?? null;
  // No move before it started (the reflog expired, or holds fewer entries): what it runs can't be told.
  return was === null ? { runs: null } : { runs: was, behind: moves[0]!.commit !== was };
}

type Ping = { protocolVersion?: number };

/** The outline to ping read-only on the host: an open one (a ping to a closed one would open it); null when none is open. */
export function openOutlineToPing(outlines: readonly HostedOutline[]): string | null {
  return outlines.find(o => o.open)?.name ?? null;
}

/**
 * Whether the host at `socket` answers: asked up to `tries` times, `gapMs` apart, each with hostLive's own timeout. A
 * host busy for a moment (just started and connecting to Herdr, under load) isn't taken for one that's down: install
 * would then "start" a unit that runs, and wait for a new process that never comes.
 */
export async function hostAnswers(socket: string, tries = 3, gapMs = 400, live: (s: string) => Promise<unknown> = hostLive): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await live(socket)) return true;
    if (i < tries - 1) await Bun.sleep(gapMs);
  }
  return false;
}

/** The outline host over `folder`: its socket, whether it answers, its outlines, its protocol, its unit. */
export async function hostFacts(folder: string, platform: Facts["platform"], home: string): Promise<HostFacts> {
  const socket = hostSocketOf({ EP0CH_OUTLINES: folder, HOME: home });
  const found = hostUnit(platform, home, folder);
  const [live, state] = await Promise.all([hostAnswers(socket), found ? unitState(found) : Promise.resolve(undefined)]);
  const unit = found && state ? { ...found, state } : found;
  if (!live) return { folder, socket, running: false, outlines: [], unit };
  const list = await hostRequest<{ outlines: HostedOutline[] }>(socket, "outlines.list", {}, 3000).catch(() => ({ outlines: [] as HostedOutline[] }));
  const target = openOutlineToPing(list.outlines);
  const p = target ? await hostRequest<Ping>(socket, "ping", { outline: target }, 1500).catch(() => null) : null;
  return { folder, socket, running: true, outlines: list.outlines, ...(p?.protocolVersion !== undefined ? { protocol: p.protocolVersion } : {}), unit };
}

/** Every outline database in the outlines folder (`<name>.sqlite`), read even when the host is down. */
export function databases(folder: string): DatabaseFacts[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .flatMap(e => { const name = e.isFile() ? outlineOfFile(e.name) : null; return name ? [{ name, path: join(folder, e.name) }] : []; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a checkout keeps its schema version and its migration scripts (PIE-617), from the repo root. */
export const SCHEMA_FILE = "packages/outliner/src/schema.ts";
export const MIGRATIONS_DIR = "packages/outliner/scripts/migrations";

/** The schema a checkout's code opens, from schema.ts's text and the migration folder's file names. */
export function schemaCodeOf(schemaText: string | null, files: readonly string[], error?: string): SchemaCode {
  const version = schemaText === null ? null : Number(/^export const SCHEMA_VERSION = (\d+);/m.exec(schemaText)?.[1] ?? NaN);
  const scripts: Record<number, string> = {};
  for (const f of files) { const m = /^(\d{4})-[\w.-]+\.ts$/.exec(f); if (m) scripts[Number(m[1])] = `${MIGRATIONS_DIR}/${f}`; }
  const read = version !== null && Number.isInteger(version);
  return { version: read ? version : null, scripts, ...(!read ? { error: error ?? `no SCHEMA_VERSION in ${SCHEMA_FILE}` } : {}) };
}

/** The schema the checkout's working tree opens, or, with `commit`, the one that commit's code opens (`git show`, read-only). */
export async function schemaCode(root: string, commit?: string, env?: Env): Promise<SchemaCode> {
  if (!commit) {
    let text: string | null = null, files: string[] = [];
    try { text = readFileSync(join(root, SCHEMA_FILE), "utf8"); } catch { /* said below */ }
    try { files = readdirSync(join(root, MIGRATIONS_DIR)); } catch { /* none */ }
    return schemaCodeOf(text, files, `couldn't read ${join(root, SCHEMA_FILE)}`);
  }
  const [shown, listed] = await Promise.all([
    run(["git", "-C", root, "show", `${commit}:${SCHEMA_FILE}`], { env, timeoutMs: 10_000 }),
    run(["git", "-C", root, "ls-tree", "--name-only", `${commit}:${MIGRATIONS_DIR}`], { env, timeoutMs: 10_000 }),
  ]);
  return schemaCodeOf(shown.code === 0 ? shown.out : null, listed.code === 0 ? listed.out.split("\n") : [], `couldn't read ${SCHEMA_FILE} at ${commit.slice(0, 7)}: ${shown.err || `exit ${shown.code}`}`);
}

/** An outline database's schema version, read-only (a served file too: nothing is written, no lock is taken). */
export function outlineSchema(d: DatabaseFacts): OutlineSchema {
  try {
    const db = new Database(d.path, { readonly: true });
    try {
      db.run("PRAGMA busy_timeout = 2000");
      return { ...d, version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version };
    } finally { db.close(); }
  } catch (e) { return { ...d, version: null, error: (e as Error).message }; }
}

/** The schema the checkout opens now, origin/main's when it's behind, and each outline's. */
export async function schemaFacts(repo: RepoFacts, dbs: readonly DatabaseFacts[], env?: Env): Promise<SchemaFacts> {
  const c = repo.checkout;
  const [head, upstream] = await Promise.all([schemaCode(repo.root), c.git && c.upstream && c.behind > 0 ? schemaCode(repo.root, c.upstream, env) : undefined]);
  return { head, ...(upstream ? { upstream } : {}), outlines: dbs.map(outlineSchema) };
}

/** Which outline `folder` opens, by the rule (`EP0CH_WS`, the nearest `.ep0ch`); never a guess. */
export function hereFacts(folder: string, env: Env): HereFacts {
  const t = resolveTarget([], env, folder);
  if ("error" in t) return { folder, unnamed: t.error };
  const on = t.machine ? { machine: t.machine } : {};
  if ("unnamed" in t) return { folder, unnamed: t.unnamed, ...(t.guess ? { guess: t.guess.name } : {}), ...on };
  return { folder, outline: t.outline, why: t.why, ...on };
}

/** The repo around this door: packages/door is two folders under its root. */
export const repoRootOf = (doorDir = resolve(import.meta.dir, "../..")) => resolve(doorDir, "../..");

/** The Claude mod's folder and its installer in a repo: packages/claude-mod, else packages/outliner/claude-mod. */
export function claudeModIn(root: string): { dir: string | null; installer: string | null } {
  const dir = [join(root, "packages/claude-mod"), join(root, "packages/outliner/claude-mod")].find(d => existsSync(d)) ?? null;
  const installer = [join(root, "packages/claude-mod/scripts/install-claude-mod.ts"), join(root, "packages/outliner/scripts/install-claude-mod.ts")].find(f => existsSync(f)) ?? null;
  return { dir, installer };
}

/** The ep0ch checkout at `root`: the checkout, its packages, the protocol its code speaks. */
export async function repoFacts(root: string, fetch: boolean, env: Env, onLine?: OnLine): Promise<RepoFacts> {
  const outliner = join(root, "packages/outliner");
  const mod = claudeModIn(root);
  const [checkout, code] = await Promise.all([inspectCheckout(root, fetch, env, onLine), pluginCode(outliner)]);
  return { root, checkout, deps: depsState(root), entry: join(root, "packages/door/src/main.ts"), door: join(root, "packages/door"), outliner,
    claudeMod: mod.dir, claudeModInstaller: mod.installer, protocol: code.protocol };
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

/** Which of the facts' parts are still being gathered, for a progress line; each change is reported. */
export interface GatherProgress { done: number; total: number; waiting: string[] }
export interface GatherOptions {
  /** `repoRoot`: the ep0ch checkout (default: the one this door runs from). `cwd`: the folder `here` is about. */
  env?: Env; fetch?: boolean; repoRoot?: string; platform?: string; cwd?: string;
  /** Called as each part (bun, Herdr, the plugin, the door checkout …) is gathered. */
  onProgress?: (p: GatherProgress) => void;
  /** The fetches' output as it arrives, prefixed with what is fetched. */
  onLine?: OnLine;
  /** Doctor: check the backups (backups.ts); `restore` also restores each newest snapshot into a temp folder. */
  backups?: "check" | "restore";
}

export async function gatherFacts(o: GatherOptions = {}): Promise<Facts> {
  const env = o.env ?? process.env;
  const platform = detectPlatform(o.platform);
  const home = resolve(env.HOME || homedir());
  const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const fetch = o.fetch ?? true;
  const repoRoot = o.repoRoot ?? repoRootOf();
  const folder = outlinesDir({ ...env, HOME: home });

  const bunPath = which("bun", pathDirs);
  const herdrPath = env.HERDR_BIN_PATH && existsSync(env.HERDR_BIN_PATH) ? env.HERDR_BIN_PATH : which("herdr", pathDirs);
  const configPath = env.HERDR_CONFIG_PATH || join(env.XDG_CONFIG_HOME || join(home, ".config"), "herdr/config.toml");

  const waiting: string[] = [];
  let done = 0;
  const part = <T>(name: string, p: Promise<T> | T): Promise<T> => {
    waiting.push(name);
    return Promise.resolve(p).finally(() => { waiting.splice(waiting.indexOf(name), 1); done++; o.onProgress?.({ done, total: done + waiting.length, waiting: [...waiting] }); });
  };
  const lines = (what: string): OnLine | undefined => (o.onLine ? l => o.onLine!(`${what}: ${l.trim()}`) : undefined);
  const [bunVersion, herdrVersion, server, plugin, repo, host, agents, sessions, mcp, backups, restic] = await Promise.all([
    part("bun", bunPath ? run([bunPath, "--version"], { env, timeoutMs: 5000 }).then(r => r.code === 0 ? r.out : null) : null),
    part("Herdr", herdrPath ? run([herdrPath, "--version"], { env, timeoutMs: 5000 }).then(r => r.code === 0 ? r.out.replace(/^herdr\s+/, "") : null) : null),
    part("Herdr's server", herdrPath ? run([herdrPath, "status", "server", "--json"], { env, timeoutMs: 5000 }).then(r => { try { return JSON.parse(r.out).running === true; } catch { return false; } }) : null),
    part("the Outliner plugin", herdrPath ? pluginFacts({ ...env, HERDR_BIN_PATH: herdrPath }, fetch, lines("plugin")) : null),
    part("the ep0ch checkout", repoFacts(repoRoot, fetch, env, lines("ep0ch"))),
    part("the outline host", hostFacts(folder, platform, home)),
    part("door agents", doorAgents(env).catch(() => undefined)),
    part("the door sessions", doorSessions(env).catch(() => [])),
    part("the MCP gateway", mcpFacts(platform, home, repoRoot).catch(() => null)),
    o.backups ? part("the backups", import("./backups").then(b => b.gatherBackups({ platform, home, env, run, restore: o.backups === "restore" }))) : undefined,
    part("the backup job", import("../backup/setup").then(b => b.backupSetupFacts({ platform, home, env, bun: bunPath, main: join(repoRoot, "packages/door/src/main.ts"), repoRoot, run, which: n => which(n, pathDirs) })).catch(() => undefined)),
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
  let mentions: { listed: boolean; mode?: string } | undefined;
  try {
    const settingsEnv = JSON.parse(readFileSync(settingsPath, "utf8"))?.env;
    settingsDirs = splitDirs(settingsEnv?.CLAUDE_CODE_PLUGIN_DIRS);
    const mode = typeof settingsEnv?.PI_OUTLINER_MENTIONS_MODE === "string" ? settingsEnv.PI_OUTLINER_MENTIONS_MODE.trim() : "";
    mentions = { listed: /[^\s:,]/.test(String(settingsEnv?.PI_OUTLINER_MENTIONS_WORKSPACES ?? "")), ...(mode ? { mode } : {}) };
  } catch { /* none */ }

  const here = hereFacts(o.cwd ?? process.cwd(), { ...env, HOME: home });
  const named = [...new Set([...(here.machine ? [here.machine] : []), ...usedMachines(env.EP0CH_STATE ?? defaultStateDir(env)).map(m => m.name)])];
  const machines = await part("the machines' forwards", Promise.all(named.map(async m => ({ ...(await machineStatus(m, { ...env, HOME: home })), ...(m === here.machine ? { here: true } : {}) }))));

  const dbs = databases(folder);
  // What install linked (links.ts), one record for every kind of link it owns.
  const record = join(env.EP0CH_STATE ?? defaultStateDir(env), "install-links.json");
  return {
    platform, home, pathDirs,
    bun: { path: bunPath, version: bunVersion },
    herdr: { path: herdrPath, version: herdrVersion, server, configPath, keys: herdrKeys(configPath), hyperChords: herdrHyperChords(configPath) },
    plugin,
    repo,
    ep0ch: { found, target, pointsHere: target === real(repo.entry) },
    linkDirs,
    host,
    databases: dbs,
    schema: await part("the outlines' schema", schemaFacts(repo, dbs, env)),
    here,
    // What this folder's outline's drawer runs: its session's saved choice, else the person's default, as the drawer reads them.
    drawer: await (async () => {
      const root = env.EP0CH_STATE ?? defaultStateDir(env);
      const { placeOf } = await import("../session/place");
      const dir = here?.outline ? placeOf({ outline: here.outline, ...(here.machine ? { machine: here.machine } : {}) }, root, env).dir : null;
      const { cmd, cwd, programWhy, folderWhy } = drawerProgram({ env, outline: here?.outline ?? null, machine: here?.machine ?? null, start: here?.folder ?? process.cwd(), home, dir, state: root });
      return { cmd, cwd, programWhy, folderWhy };
    })(),
    machines,
    drawers: await (async () => {
      const { placeDirs, readPlace } = await import("../session/place");
      const { sessionSlug } = await import("../desk/herdr-agent");
      const root = env.EP0CH_STATE ?? defaultStateDir(env);
      return placeDirs(root).flatMap(dir => {
        const pl = readPlace(dir);
        if (!pl) return [];
        const p = drawerProgram({ env, outline: pl.outline, machine: pl.machine ?? null, dir, state: root, home });
        const session = `${pl.outline}${pl.machine ? `@${pl.machine}` : ""}`;
        return [{ session, cmd: p.cmd, programWhy: p.programWhy, from: p.from, ...(p.herdr ? { pane: sessionSlug(session) } : {}) }];
      });
    })(),
    claude: { settingsPath, settingsDirs, envDirs: splitDirs(env.CLAUDE_CODE_PLUGIN_DIRS), ...(mentions ? { mentions } : {}), ...(env.FORCE_HYPERLINK !== undefined ? { forceHyperlink: env.FORCE_HYPERLINK } : {}), ...(agents ? { agents } : {}) },
    sessions,
    mcp,
    ext: extFacts(join(repo.door, "ext"), { env, home, bin: binDirOf(found, target === real(repo.entry)) ?? chooseLinkDir(linkDirs), which: n => which(n, pathDirs), record }),
    skills: skillLinkFacts({ door: repo.door, outliner: repo.outliner, env, home, record }),
    art: { dir: packDir(env), packs: packs(packDir(env)).length, fromEnv: !!env.EP0CH_PACKS },
    ...(backups ? { backups } : {}),
    ...(restic ? { restic } : {}),
  };
}

/** The door sessions in the person's state dir (EP0CH_STATE, else their default), one per outline, that answer. */
async function doorSessions(env: Record<string, string | undefined>): Promise<SessionFact[]> {
  const { runningSessions } = await import("../session/place");
  const root = env.EP0CH_STATE ?? defaultStateDir(env);
  return (await runningSessions(root)).map(({ info: i }) => ({ outline: i.place.outline, ...(i.place.machine ? { machine: i.place.machine } : {}), ...(i.place.socket ? { socket: i.place.socket } : {}), pid: i.pid, dir: i.code.dir, commit: i.code.commit, clients: i.clients.length, programs: i.terminals.length + (i.kept?.length ?? 0) }));
}

