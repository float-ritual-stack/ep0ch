// A door agent's environment, and what a running agent knows (the ▲ claude chip, `ep0ch doctor`).
//
// One function, `agentVars`, builds the variables that tell an agent which door and tile it runs in. All three
// ways a person starts one use it:
// - a terminal tile (`^W o s`, then `claude`): `tileEnv` (src/desk/pty.ts);
// - the drawer's agent (the ▲ claude chip, alt+a: the host layer's, PIE-513, with no tile on any screen): a
//   `PtyPane`, so `tileEnv` too;
// - the Herdr launcher (scripts/door-agent-herdr.ts), for the pane it makes for the agent: `agentConfig`
//   (src/desk/herdr-agent.ts), with EP0CH_CONTROL naming the link it points at the attached door.
//
// The Outliner's Claude mod reads these once, as a session starts: it registers its `door_*` tools only when
// EP0CH_CONTROL is set, and its `ep0ch where` context needs EP0CH_NEST and EP0CH_TILE. A running Claude never
// picks up a new mod or new variables, so an agent started before either has to be restarted. `judgeAgent`
// says whether it does, from the agent's own environment (/proc on Linux, `ps eww` on macOS) and its start
// time against the newest file of the mod Claude loads.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

/** The drawer agent's tile id (src/drawer.ts): what EP0CH_TILE_ID tells its program, in a tile or its Herdr pane. */
export const DRAWER_TILE_ID = "drawer.agent";
/** The host layer's agent tile's name: what `EP0CH_TILE` tells its program (`open from=claude`). */
export const DRAWER_NAME = "claude";

/** What every door agent gets: the door's control socket, its tile's name and id, the nest, and that it's in a door. */
export const AGENT_VARS = ["EP0CH_CONTROL", "EP0CH_TILE", "EP0CH_TILE_ID", "EP0CH_NEST", "EP0CH_IN_DOOR"] as const;
/**
 * How a door was opened: a door started inside a tile or the agent's pane mustn't repeat it (the daily agent,
 * the landing). EP0CH_AGENT_CONTINUE is a restart's word to the Herdr launcher (`agent.restart`): that start only.
 */
export const DOOR_START_VARS = ["EP0CH_DAILY_AGENT", "EP0CH_LANDING", "EP0CH_AGENT_CONTINUE"] as const;
/** Passed on as they are when the door has them, so the agent's `ep0ch` uses the door's state and outline. */
export const CARRIED_VARS = ["EP0CH_STATE", "EP0CH_SOCKET"] as const;

export interface AgentAt {
  /** The tile's name (EP0CH_TILE). */
  tile: string;
  /** The control socket `ep0ch act` from the agent reaches (null: none, as in a door without one). */
  control: string | null | undefined;
  /** The tile's id (`t<n>`, `drawer.agent`). */
  tileId?: string | null;
  /** The whole nest, this layer included (src/nest.ts). */
  nest: string;
}

/** The one place a door agent's variables are made. `env`: the door's (or the launcher's) own, for CARRIED_VARS. */
export function agentVars(env: Record<string, string | undefined>, at: AgentAt): Record<string, string> {
  const out: Record<string, string> = { EP0CH_TILE: at.tile, EP0CH_IN_DOOR: "1", EP0CH_NEST: at.nest };
  if (at.tileId) out.EP0CH_TILE_ID = at.tileId;
  if (at.control) out.EP0CH_CONTROL = at.control;
  for (const k of CARRIED_VARS) { const v = env[k]; if (v) out[k] = v; }
  return out;
}

// ── restarting: the conversation is kept ──

const CONTINUES = new Set(["-c", "--continue", "-r", "--resume"]);
/**
 * A command run again by a restart: a bare `claude` gets `--continue`, so the conversation comes back (as
 * a restart's own continuing). Anything else, and a `claude` already told what to resume, runs as it was.
 */
export function withContinue(cmd: string[]): string[] {
  if (basename(cmd[0] ?? "") !== "claude" || cmd.slice(1).some(a => CONTINUES.has(a) || a.startsWith("--resume="))) return cmd;
  return [...cmd, "--continue"];
}
/** The same for a command line a shell runs (the Herdr launcher's `exec <cmd>`). */
export function lineWithContinue(line: string): string {
  const words = line.trim().split(/\s+/);
  return withContinue(words).length > words.length ? `${line.trim()} --continue` : line;
}

// ── the agent process ──

export interface AgentProc {
  pid: number;
  /** When it started (ms), from `ps -o lstart`; null when that couldn't be read. */
  startedAt: number | null;
  /** Its environment as it started; null when it couldn't be read (gone, or someone else's). */
  env: Record<string, string> | null;
}

/** The environment a process started with: /proc/<pid>/environ on Linux, `ps eww` (the EP0CH_ ones) elsewhere. */
export async function procEnv(pid: number, platform: string = process.platform): Promise<Record<string, string> | null> {
  if (platform === "linux") {
    try {
      const out: Record<string, string> = {};
      for (const kv of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) { const i = kv.indexOf("="); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); }
      return out;
    } catch { return null; }
  }
  const r = await quiet(["ps", "eww", "-o", "command=", "-p", String(pid)]);
  if (r === null || !r.trim()) return null;
  const out: Record<string, string> = {};
  for (const m of r.matchAll(/(?:^|\s)(EP0CH_[A-Z_]+)=(\S*)/g)) out[m[1]!] = m[2]!;
  return out;
}

/**
 * When a process started (ms since the epoch): on Linux from /proc (its start in clock ticks after boot, and the
 * boot time); elsewhere `ps -o lstart` in UTC (whole seconds).
 */
export async function procStart(pid: number, platform: string = process.platform): Promise<number | null> {
  if (platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // The command (field 2) may hold spaces and parentheses: the fields after it start past the last `)`.
      const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      const btime = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
      if (Number.isFinite(ticks) && btime > 0) return btime * 1000 + Math.round((ticks / CLK_TCK) * 1000);
    } catch { /* gone: ps says so too */ }
  }
  const r = await quiet(["ps", "-o", "lstart=", "-p", String(pid)], { TZ: "UTC" });
  const t = r ? Date.parse(`${r.trim().replace(/\s+/g, " ")} GMT`) : NaN;
  return Number.isFinite(t) ? t : null;
}
/** Clock ticks per second in /proc's times: 100 on every Linux the door runs on (USER_HZ). */
const CLK_TCK = 100;

export async function readAgent(pid: number): Promise<AgentProc> {
  const [env, startedAt] = await Promise.all([procEnv(pid), procStart(pid)]);
  return { pid, env, startedAt };
}

async function quiet(cmd: string[], more: Record<string, string> = {}): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, LC_ALL: "C", ...more } });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 3000);
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch { return null; }
}

// ── the installed mod ──

export interface ModStamp {
  /** The mod's folder (`…/claude-mod`). */
  dir: string;
  /** Its newest code file's mtime (ms): hooks/ and .claude-plugin/plugin.json, what a session loads. */
  at: number;
  /** That file. */
  file: string;
}

/**
 * The Outliner mod folders Claude Code loads: CLAUDE_CODE_PLUGIN_DIRS in its settings (what new sessions read),
 * then in this environment; the ones named `claude-mod`, as `ep0ch doctor`'s claude-mod check reads them.
 */
export function modDirs(env: Record<string, string | undefined> = process.env): string[] {
  const settings = join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"), "settings.json");
  const split = (v: unknown) => (typeof v === "string" ? v.split(delimiter).map(d => d.trim()).filter(Boolean) : []);
  let fromSettings: string[] = [];
  try { fromSettings = split(JSON.parse(readFileSync(settings, "utf8"))?.env?.CLAUDE_CODE_PLUGIN_DIRS); } catch { /* none */ }
  return [...new Set([...fromSettings, ...split(env.CLAUDE_CODE_PLUGIN_DIRS)])].filter(d => /claude-mod\/?$/.test(d) && existsSync(d));
}

/** The newest code file in these mod folders (null: none found). */
export function modStamp(dirs: string[]): ModStamp | null {
  let best: ModStamp | null = null;
  const consider = (dir: string, file: string) => {
    try { const at = statSync(file).mtimeMs; if (!best || at > best.at) best = { dir, at, file }; } catch { /* gone */ }
  };
  const walk = (dir: string, from: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(from); } catch { return; }
    for (const n of names) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const p = join(from, n);
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir) { if (depth < 3) walk(dir, p, depth + 1); } else consider(dir, p);
    }
  };
  for (const dir of dirs) {
    walk(dir, join(dir, "hooks"), 0);
    consider(dir, join(dir, ".claude-plugin", "plugin.json"));
  }
  return best;
}

// ── what it knows ──

/**
 * - `current`: started in a door (EP0CH_CONTROL and the rest): it has the door tools. A mod changed since doesn't
 *   matter: Claude Code reloads mods into a running session.
 * - `stale`: started by an older door that left variables out: a restart fixes it.
 * - `no-door`: started without EP0CH_CONTROL, so the mod gave it no door tools.
 * - `unknown`: its environment couldn't be read (gone, or not this user's), or Claude loads no Outliner mod.
 */
export type AgentKnows =
  | { state: "current"; why: string }
  | { state: "stale"; why: string }
  | { state: "no-door"; why: string }
  | { state: "unknown"; why: string };

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);


export function judgeAgent(proc: AgentProc | null, mod: ModStamp | null): AgentKnows {
  if (!proc?.env) return { state: "unknown", why: proc ? `couldn't read pid ${proc.pid}'s environment` : "no agent process" };
  // No Outliner mod for Claude to load: no door tools to have or miss, whenever it started.
  if (!mod) return { state: "unknown", why: "no Outliner Claude mod in CLAUDE_CODE_PLUGIN_DIRS to compare with" };
  const env = proc.env;
  if (!env.EP0CH_CONTROL) return { state: "no-door", why: "it started without EP0CH_CONTROL, so it has no door tools" };
  const missing = AGENT_VARS.filter(k => !env[k]);
  if (missing.length) return { state: "stale", why: `it was started by an older door, without ${missing.join(", ")}` };
  // A newer mod is not staleness: Claude Code hot-reloads its mods into a running session (2.1.287+), so only
  // what a session can't pick up live, its environment, needs a restart.
  return { state: "current", why: `started in a door; the Claude mod (${mod.dir}, last changed ${hhmm(mod.at)}) reloads into it live` };
}

/** What the chip adds for it (after the agent's state): `door tools`, or what's wrong and ⟳ to restart. */
export const RESTART_GLYPH = "⟳";
export function knowsLabel(k: AgentKnows | null): string {
  if (!k) return "";
  if (k.state === "current") return "door tools";
  if (k.state === "stale") return `started before update ${RESTART_GLYPH}`;
  if (k.state === "no-door") return `no door tools ${RESTART_GLYPH}`;
  return "";
}

// ── every door agent on this machine (`ep0ch doctor`) ──

export interface DoorAgent extends AgentProc {
  /** Its command line. */
  cmd: string;
  knows: AgentKnows;
}

/** A process is a door agent when it's a `claude` (or runs one: a script named claude) started with EP0CH_TILE. */
const isClaude = (argv: string[]) => argv.slice(0, 2).some(a => basename(a) === "claude");

/**
 * The Claude processes started in a door tile or a door's Herdr pane, each judged against the installed mod.
 * Linux reads /proc; elsewhere `ps`. Read-only.
 */
export async function doorAgents(env: Record<string, string | undefined> = process.env, platform: string = process.platform, dirs: string[] = modDirs(env)): Promise<DoorAgent[]> {
  const mod = modStamp(dirs);
  const procs: { pid: number; argv: string[] }[] = [];
  if (platform === "linux") {
    let names: string[] = [];
    try { names = readdirSync("/proc").filter(n => /^\d+$/.test(n)); } catch { /* no /proc */ }
    for (const n of names) {
      try { const argv = readFileSync(`/proc/${n}/cmdline`, "utf8").split("\0").filter(Boolean); if (isClaude(argv)) procs.push({ pid: Number(n), argv }); } catch { /* gone */ }
    }
  } else {
    const out = await quiet(["ps", "-axo", "pid=,command="]);
    for (const l of (out ?? "").split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(l);
      if (m && isClaude(m[2]!.split(/\s+/))) procs.push({ pid: Number(m[1]), argv: m[2]!.split(/\s+/) });
    }
  }
  const out: DoorAgent[] = [];
  for (const p of procs) {
    if (p.pid === process.pid) continue;
    const a = await readAgent(p.pid);
    if (!a.env?.EP0CH_TILE && !a.env?.EP0CH_CONTROL && !a.env?.EP0CH_NEST) continue;
    out.push({ ...a, cmd: p.argv.join(" ").slice(0, 200), knows: judgeAgent(a, mod) });
  }
  return out;
}
