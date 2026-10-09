// Agent sessions (PIE-737): one model for "talk to an agent here", however it was started.
//
// An agent session is a program (claude, codex, pi, …, plus its arguments, from an agent config in the outline or the
// ones installed here), a folder (its cwd) and a persona. The door session owns it: it is a terminal tile's program
// (`PtyPane`), kept by the session's terminal host, so it outlives a detach like any terminal's. Where it is shown now
// (your drawer, a tile on a screen, a Herdr pane its tile attaches) is not what it is: moving the tile moves the same
// process and the same conversation. Nothing here keeps a second registry: the sessions are read off the door's live
// terminals each time they're asked for.
//
// A terminal is a session when:
// - it was started as one (`agent.start`, `ep0ch agent`, the agent panel's new): its PtySpec carries `session`, saved
//   with its tile, so it is one after a restart too;
// - an agent program runs in it, found the way Herdr finds one: the terminal's processes by name (KNOWN_AGENTS), read
//   from /proc (a `claude` typed in a `^W o s` shell is a session from then on, until it exits); without /proc, the
//   tile's own command;
// - it is the drawer's own tab running an agent (the same rule: it runs one).
//
// Identity is the folder plus the program, so resuming is the program's own "continue the last conversation in this
// folder" (`resumeArgs`), whoever started it and however.
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isAgentCmd, KNOWN_AGENTS, programName } from "./drawer-program";
import type { PtyPane } from "./pty";
import { statusMark } from "./program-status";
import { words } from "../text";

/** What a terminal started as a session carries (PtySpec.session, saved with its tile). */
export interface SessionMark {
  /** The program's name (claude, codex, pi; a config's own program by its command's name). */
  program: string;
  /** The persona it writes under (EP0CH_AGENT and OUTLINER_ACTOR in its environment). */
  persona?: string;
  /** The agent config in the outline it was started from (its `agent-config::` name). */
  config?: string;
}

/** An agent found running in a terminal's processes. */
export interface AgentProcess { pid: number; program: string; argv: string[]; cwd: string | null; persona: string | null }

/** Where a session is shown now. */
export type Shown =
  | { in: "drawer"; tile: string; own: boolean; herdr?: string }
  | { in: "screen"; screen: string; tile: string; here: boolean }
  | { in: "nowhere" };

/** What a session is doing: what its program said (OSC 7501), else whether it wrote anything lately. */
export type SessionState = "working" | "waiting" | "idle" | "done" | "failed";

export interface AgentSession {
  /** `<program>:<folder>` (the folder with ~ for home), `#2` on a second one of the same: how `session=` names it. */
  id: string;
  program: string;
  folder: string;
  persona: string | null;
  config: string | null;
  /** How it became one: started as a session, found running in a terminal tile, or the drawer's own tab. */
  how: "started" | "found" | "drawer";
  state: SessionState;
  /** The state in words (`asks you`, `working 40%`). */
  word: string;
  shown: Shown;
  pane: PtyPane;
}

// ── finding an agent in a terminal (Herdr's way: the program, by name) ──

/** The agent `argv` runs, by its program's name (or a script's, run by an interpreter: `node …/claude`), else null. */
export function agentOf(argv: readonly string[]): string | null {
  const known = (a: string | undefined) => KNOWN_AGENTS.find(([, c]) => c === basename(a ?? ""))?.[0] ?? null;
  return known(argv[0]) ?? (INTERPRETERS.test(basename(argv[0] ?? "")) ? known(argv[1]) : null);
}
/** What runs an agent that is a script: its argv[1] is the agent. */
const INTERPRETERS = /^(node|nodejs|bun|deno|sh|bash|dash|zsh|python3?)$/;

const CACHE_MS = 2000;
const found = new Map<number, { at: number; agent: AgentProcess | null }>();

/**
 * The agent running under `pid` (the terminal's own process), looked for down its children (/proc's `children`, the
 * nearest first), with its folder and persona; null when none runs, or there's no /proc (then the tile's command says).
 * Read at most every 2s per terminal.
 */
export function agentIn(pid: number | undefined, proc = "/proc", now = Date.now()): AgentProcess | null {
  if (!pid) return null;
  const hit = found.get(pid);
  if (hit && now - hit.at < CACHE_MS && proc === "/proc") return hit.agent;
  let agent: AgentProcess | null = null;
  const queue = [pid], seen = new Set<number>();
  while (queue.length && seen.size < 64) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    let argv: string[] = [];
    try { argv = readFileSync(`${proc}/${p}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { continue; }
    const name = agentOf(argv);
    if (name) {
      let cwd: string | null = null, persona: string | null = null;
      try { cwd = readlinkSync(`${proc}/${p}/cwd`); } catch { /* someone else's */ }
      try {
        const env = Object.fromEntries(readFileSync(`${proc}/${p}/environ`, "utf8").split("\0").map(kv => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
        persona = env.OUTLINER_ACTOR || env.EP0CH_AGENT || null;
      } catch { /* someone else's */ }
      agent = { pid: p, program: name, argv, cwd, persona };
      break;
    }
    try {
      for (const t of readdirSync(`${proc}/${p}/task`)) {
        for (const c of readFileSync(`${proc}/${p}/task/${t}/children`, "utf8").split(/\s+/)) if (/^\d+$/.test(c)) queue.push(Number(c));
      }
    } catch { /* gone */ }
  }
  if (proc === "/proc") found.set(pid, { at: now, agent });
  return agent;
}

/** There is a /proc to read processes from (Linux). */
const hasProc = () => existsSync("/proc/self/cmdline");

// ── a terminal as a session ──

/** `folder` with ~ for the home folder. */
export const tildeOf = (folder: string, home = process.env.HOME || homedir()) => (home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder);
/** `folder` with ~ read as the home folder. */
export const untilde = (folder: string, home = process.env.HOME || homedir()) => folder.trim().replace(/^~(?=$|\/)/, home);

/** What a terminal's program says it's doing, else whether it wrote anything in the last 1.5s. */
export function stateOf(p: Pick<PtyPane, "status" | "lastOutput">, now = Date.now()): { state: SessionState; word: string } {
  const r = p.status.urgent();
  if (r) {
    const word = statusMark(r, now).word;
    if (r.state === "blocked") return { state: "waiting", word };
    if (r.state === "error") return { state: "failed", word };
    return { state: r.state, word };
  }
  return now - p.lastOutput < 1500 ? { state: "working", word: "working" } : { state: "idle", word: "idle" };
}

/**
 * The terminal as a session, or null when no agent is in it now. `mark` (started as one) wins over what runs: the
 * program it was started as, and its persona; the folder is the agent's own (it may have moved) where /proc says.
 */
export function asSession(p: PtyPane, o: { own?: boolean; proc?: string; now?: number } = {}): Omit<AgentSession, "id" | "shown" | "state" | "word"> | null {
  if (!p.running) return null;
  const mark = p.run.session;
  // The launcher's tile shows an agent that runs in Herdr: its agent is the launcher's --agent, in the tile's folder.
  if (p.herdr) return { program: mark?.program ?? programName(p.run.cmd), folder: p.run.cwd ?? process.cwd(), persona: mark?.persona ?? null, config: mark?.config ?? null, how: o.own ? "drawer" : mark ? "started" : "found", pane: p };
  const proc = o.proc ?? "/proc";
  const live = proc !== "/proc" || hasProc() ? agentIn(p.pid, proc, o.now) : null;
  // Started as one and its agent exited (the wrapper left the person in their shell): not a session now.
  if (mark && p.agentExit !== null && !live) return null;
  if (!mark && !live) {
    // No /proc to look in (macOS): the tile's own command says, while its agent hasn't exited.
    if (proc === "/proc" && hasProc()) return null;
    if (!isAgentCmd(p.run.cmd) || p.agentExit !== null) return null;
  }
  const program = mark?.program ?? live?.program ?? programName(p.run.cmd);
  const folder = live?.cwd ?? p.run.cwd ?? process.cwd();
  return { program, folder, persona: mark?.persona ?? live?.persona ?? null, config: mark?.config ?? null, how: o.own ? "drawer" : mark ? "started" : "found", pane: p };
}

/** Give each session its id: `<program>:<folder>`, a second of the same `#2`. */
export function withIds<T extends { program: string; folder: string }>(rows: T[]): (T & { id: string })[] {
  const n = new Map<string, number>();
  return rows.map(r => {
    const base = `${r.program}:${tildeOf(r.folder)}`;
    const k = (n.get(base) ?? 0) + 1;
    n.set(base, k);
    return { ...r, id: k === 1 ? base : `${base}#${k}` };
  });
}

/**
 * The session `sel` names in `rows`: its id, its program and folder (`claude:~/x`, the folder as given or with ~), a tile
 * name or id it's shown in, or its place in the list (from 1). Null when none.
 */
export function pickSession<T extends AgentSession>(rows: readonly T[], sel: string | number | undefined): T | null {
  if (sel === undefined || sel === "") return null;
  if (typeof sel === "number" || /^\d+$/.test(String(sel))) return rows[Number(sel) - 1] ?? null;
  const s = String(sel);
  const tiled = s.includes(":") ? `${s.slice(0, s.indexOf(":"))}:${tildeOf(untilde(s.slice(s.indexOf(":") + 1)))}` : s;
  return rows.find(r => r.id === s || r.id === tiled)
    ?? rows.find(r => r.shown.in !== "nowhere" && r.shown.tile === s)
    ?? rows.find(r => r.pane.tileId === s)
    ?? null;
}

/** Where it's shown, in words. */
export function shownWords(s: Shown): string {
  if (s.in === "drawer") return `in your drawer${s.own ? " (its own tab)" : ` (${s.tile})`}${s.herdr ? ` · Herdr pane ${s.herdr}` : ""}`;
  if (s.in === "screen") return s.here ? `here (${s.tile})` : `on the ${s.screen} (${s.tile})`;
  return "not shown";
}

/** A session as `agents.list`, `peek` and the panel's `describe` give it. */
export function sessionFacts(s: AgentSession, n?: number): Record<string, unknown> {
  return {
    ...(n !== undefined ? { n } : {}), id: s.id, program: s.program, folder: s.folder, persona: s.persona, ...(s.config ? { config: s.config } : {}),
    how: s.how, state: s.state, word: s.word, shown: s.shown, where: shownWords(s.shown), tile: s.pane.tileId, pid: s.pane.pid ?? null,
  };
}

// ── starting one: the program, its arguments, resuming ──

/** An agent config in the outline: a note with `[agent-config::<name>]`, its `program::`, `args::`, `persona::` and `folder::`. */
export interface AgentConfig { name: string; program: string; args: string[]; persona?: string; folder?: string; id?: string }

/** The agent configs from the notes that hold `agent-config::` (the service's query; their properties as written). */
export function configsOf(notes: readonly { id: string; props: Record<string, string> }[]): AgentConfig[] {
  const out: AgentConfig[] = [];
  for (const m of notes) {
    const name = m.props["agent-config"]?.trim();
    if (!name || out.some(c => c.name === name)) continue;
    const program = m.props.program?.trim() || name;
    out.push({ name, program, args: words(m.props.args ?? ""), ...(m.props.persona?.trim() ? { persona: m.props.persona.trim() } : {}), ...(m.props.folder?.trim() ? { folder: m.props.folder.trim() } : {}), id: m.id });
  }
  return out;
}

/** Claude Code's folder for a working folder's conversations: every character but letters and digits a dash. */
export const claudeProjectDir = (folder: string, env: Record<string, string | undefined> = process.env, home = env.HOME || homedir()) =>
  join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects", folder.replace(/[^A-Za-z0-9]/g, "-"));
/** Pi's folder for a working folder's sessions: `--<the path, slashes dashes>--`. */
export const piSessionDir = (folder: string, home: string) => join(home, ".pi", "agent", "sessions", `--${folder.replace(/^\//, "").replace(/\//g, "-")}--`);

const hasEntry = (dir: string, test: (name: string) => boolean = () => true) => { try { return readdirSync(dir).some(test); } catch { return false; } };

/** Whether Codex recorded a session in `folder` (the `cwd` of its session files, the newest 300 read). */
function codexHas(folder: string, home: string): boolean {
  const root = join(home, ".codex", "sessions"), files: { path: string; at: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      if (depth < 3) walk(p, depth + 1);
      else if (n.endsWith(".jsonl")) { try { files.push({ path: p, at: statSync(p).mtimeMs }); } catch { /* gone */ } }
    }
  };
  walk(root, 0);
  const want = `"cwd":${JSON.stringify(folder)}`;
  for (const f of files.sort((a, b) => b.at - a.at).slice(0, 300)) {
    try { if (readFileSync(f.path, "utf8").slice(0, 4096).includes(want)) return true; } catch { /* gone */ }
  }
  return false;
}

/**
 * What continues `program`'s last conversation in `folder`, when it has one there: claude `--continue`, pi
 * `--continue`, codex `resume --last` (its own pick is by folder too). Nothing when there's none to continue (claude
 * refuses `--continue` with none) or the program has no such word.
 */
export function resumeArgs(program: string, folder: string, env: Record<string, string | undefined> = process.env, home = env.HOME || homedir()): string[] {
  if (program === "claude") return hasEntry(claudeProjectDir(folder, env, home), n => n.endsWith(".jsonl")) ? ["--continue"] : [];
  if (program === "pi") return hasEntry(piSessionDir(folder, home)) ? ["--continue"] : [];
  if (program === "codex") return codexHas(folder, home) ? ["resume", "--last"] : [];
  return [];
}

/** The arguments `cmd` already resumes with (it was told what to continue): none are added. */
const RESUMES = new Set(["-c", "--continue", "-r", "--resume", "resume"]);
export const resumesAlready = (args: readonly string[]) => args.some(a => RESUMES.has(a) || a.startsWith("--resume="));

/** A session's command: the program, its arguments, then what resumes its last conversation in `folder`. */
export function sessionCommand(program: string, args: readonly string[], folder: string, env: Record<string, string | undefined> = process.env): string[] {
  const name = agentOf([program]) ?? basename(program);
  return [program, ...args, ...(resumesAlready(args) ? [] : resumeArgs(name, folder, env))];
}
