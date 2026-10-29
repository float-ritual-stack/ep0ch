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
// - its program says which agent it is: the `app` of its latest OSC 7501 report (the tile's `status.app`; the Claude mod
//   reports once when a session starts, so an idle claude is known too), until it clears its report, exits, or a prompt
//   begins (`agentOfApp`, the same on every machine);
// - an agent program that reports nothing (codex, pi) runs in it, found the way Herdr finds one: the terminal's
//   processes by name (KNOWN_AGENTS), read from /proc (a `claude` typed in a `^W o s` shell is a session from then on,
//   until it exits); without /proc, the tile's own command;
// - it is an agent tab the drawer opened (role agent) running an agent (the same rule: it runs one);
// - it is a program the session's terminal host keeps that no tile has (PIE-1432: a layout that lost its leaf, a key an
//   older door used): listed as "no tile" with when it last wrote, so it is never dropped without a word, and put back
//   in a tile (agents.go, agents.drawer, agents.dock) by adopting its key, the same process.
//
// Identity is the folder plus the program, so resuming is the program's own "continue the last conversation in this
// folder" (`resumeArgs`), whoever started it and however.
import { prop } from "../props";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isAgentCmd, KNOWN_AGENTS, programName } from "./drawer-program";
import type { PtyPane } from "./pty";
import { statusMark } from "./program-status";
import { ago, words } from "../text";

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
  | { in: "drawer"; tile: string; name: string; herdr?: string }
  | { in: "screen"; screen: string; tile: string; name: string; here: boolean }
  /** Kept by the session's terminal host under `key`, with no tile; `at`: when it last wrote (null: not since this door started). */
  | { in: "no tile"; key: string; at: number | null }
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
  /** How it became one: started as a session, an agent tab the drawer opened (role agent), found running in a terminal tile, or kept by the terminal host with no tile. */
  how: "started" | "found" | "drawer" | "kept";
  state: SessionState;
  /** The state in words (`asks you`, `working 40%`). */
  word: string;
  shown: Shown;
  /** Its terminal tile; null for one the terminal host keeps with no tile (`shown.in` "no tile"). */
  pane: PtyPane | null;
  pid: number | null;
}

// ── finding an agent in a terminal (Herdr's way: the program, by name) ──

/** The agent `argv` runs, by its program's name (or a script's, run by an interpreter: `node …/claude`), else null. */
export function agentOf(argv: readonly string[]): string | null {
  const known = (a: string | undefined) => KNOWN_AGENTS.find(([, c]) => c === basename(a ?? ""))?.[0] ?? null;
  return known(argv[0]) ?? (INTERPRETERS.test(basename(argv[0] ?? "")) ? known(argv[1]) : null);
}
/**
 * The agent an OSC 7501 report's `app` names (`claude-code` is claude; a program that names itself by its own name,
 * `codex`, is that), else null: the door's own report (`ep0ch`), a build job's are no agent. The one place the word an
 * agent reports with becomes the program the door calls it.
 */
export function agentOfApp(app: string | null | undefined): string | null {
  return app ? KNOWN_AGENTS.find(([name, , reports]) => app === name || app === reports)?.[0] ?? null : null;
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

/** The folder process `pid` runs in (/proc's `cwd`), else null (gone, someone else's, no /proc). */
export function cwdOf(pid: number | null | undefined, proc = "/proc"): string | null {
  if (!pid) return null;
  try { return readlinkSync(`${proc}/${pid}/cwd`); } catch { return null; }
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
export function asSession(p: PtyPane, o: { own?: boolean; proc?: string; now?: number } = {}): Omit<AgentSession, "id" | "shown" | "state" | "word" | "pid"> & { pane: PtyPane } | null {
  if (!p.running) return null;
  // The mark is the launch's: once the agent it started has exited, what runs in the shell left is read as it is.
  const mark = p.agentExit === null ? p.run.session : undefined;
  // The launcher's tile shows an agent that runs in Herdr: its agent is the launcher's --agent, in the tile's folder.
  if (p.herdr) return { program: mark?.program ?? programName(p.run.cmd), folder: p.run.cwd ?? process.cwd(), persona: mark?.persona ?? null, config: mark?.config ?? null, how: mark ? "started" : o.own ? "drawer" : "found", pane: p };
  const proc = o.proc ?? "/proc";
  // What the program says it is (OSC 7501's app, kept by the tile) is the answer; its processes are looked at only for
  // what they know that a report doesn't (the folder it runs in, its persona) and for programs that send no reports.
  const said = agentOfApp(p.status.app);
  let live = proc !== "/proc" || hasProc() ? agentIn(p.pid, proc, o.now) : null;
  if (said && live && live.program !== said) live = null;
  if (!mark && !live && !said) {
    // No /proc to look in (macOS): the tile's own command says, while its agent hasn't exited.
    if (proc === "/proc" && hasProc()) return null;
    if (!isAgentCmd(p.run.cmd) || p.agentExit !== null) return null;
  }
  const program = mark?.program ?? said ?? live?.program ?? programName(p.run.cmd);
  const folder = live?.cwd ?? p.run.cwd ?? process.cwd();
  return { program, folder, persona: mark?.persona ?? live?.persona ?? null, config: mark?.config ?? null, how: mark ? "started" : o.own ? "drawer" : "found", pane: p };
}

/** Each terminal's number among sessions, given once and kept wherever it moves: a second of the same is told apart by it. */
const SEQ = new WeakMap<object, number>();
let seqs = 0;
const seqOf = (pane: object) => { let n = SEQ.get(pane); if (n === undefined) { n = ++seqs; SEQ.set(pane, n); } return n; };
/** A program kept with no tile stands for itself by its key until a tile adopts it (then its number is the tile's). */
const KEPT_REF = new Map<string, object>();
const keptRef = (key: string) => { let r = KEPT_REF.get(key); if (!r) { r = { key }; KEPT_REF.set(key, r); } return r; };
/** What a session's number is kept on: its terminal, else (no tile) its key. */
const refOf = (r: { pane: object | null; shown?: Shown }) => r.pane ?? keptRef(r.shown?.in === "no tile" ? r.shown.key : "");

/**
 * Give each session its id: `<program>:<folder>`, and when another of the same runs, `#<its number>`, a number kept for
 * the terminal's life: an id an agent was given never names another session after one docks, exits or moves.
 */
export function withIds<T extends { program: string; folder: string; pane: object | null; shown?: Shown }>(rows: T[]): (T & { id: string })[] {
  const base = (r: T) => `${r.program}:${tildeOf(r.folder)}`;
  const count = new Map<string, number>();
  for (const r of rows) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  return rows.map(r => ({ ...r, id: count.get(base(r))! > 1 ? `${base(r)}#${seqOf(refOf(r))}` : base(r) }));
}

/**
 * The session `sel` names in `rows`: its id, its program and folder (`claude:~/x`, the folder as given or with ~), a tile
 * name or id it's shown in, or its place in the list (from 1). Null when none.
 */
export function pickSession<T extends AgentSession>(rows: readonly T[], sel: string | number | undefined): T | null {
  if (sel === undefined || sel === "") return null;
  if (typeof sel === "number" || /^\d+$/.test(String(sel))) return rows[Number(sel) - 1] ?? null;
  const s = String(sel);
  const seq = /#(\d+)$/.exec(s), plain = seq ? s.slice(0, seq.index) : s;
  const tiled = plain.includes(":") ? `${plain.slice(0, plain.indexOf(":"))}:${tildeOf(untilde(plain.slice(plain.indexOf(":") + 1)))}` : plain;
  // `#n` is that terminal's own number: it still names it when it's the only one left (its id is plain then).
  if (seq) return rows.find(r => r.id.replace(/#\d+$/, "") === tiled && seqOf(refOf(r)) === Number(seq[1])) ?? null;
  return rows.find(r => r.id === s || r.id === tiled)
    ?? rows.find(r => (r.shown.in === "drawer" || r.shown.in === "screen") && (r.shown.tile === s || r.shown.name === s))
    ?? rows.find(r => r.pane?.tileId === s)
    ?? rows.find(r => r.shown.in === "no tile" && r.shown.key === s)
    ?? null;
}

/** Where it's shown, in words. */
export function shownWords(s: Shown, now = Date.now()): string {
  if (s.in === "drawer") return `in your drawer (${s.name})${s.herdr ? ` · Herdr pane ${s.herdr}` : ""}`;
  if (s.in === "screen") return s.here ? `here (${s.name})` : `on the ${s.screen} (${s.name})`;
  if (s.in === "no tile") return `no tile · ${s.at ? `wrote ${ago(s.at, now)} ago` : "quiet since the restart"}`;
  return "not shown";
}

/** A session as `agents.list`, `peek` and the panel's `describe` give it. */
export function sessionFacts(s: AgentSession, n?: number): Record<string, unknown> {
  return {
    ...(n !== undefined ? { n } : {}), id: s.id, program: s.program, folder: s.folder, persona: s.persona, ...(s.config ? { config: s.config } : {}),
    how: s.how, state: s.state, word: s.word, shown: s.shown, where: shownWords(s.shown), tile: s.pane?.tileId ?? null, pid: s.pid,
  };
}

// ── starting one: the program, its arguments, resuming ──

/** An agent config in the outline: a note with `[agent-config::<name>]`, its `program::`, `args::`, `persona::` and `folder::`. */
export interface AgentConfig { name: string; program: string; args: string[]; persona?: string; folder?: string; id?: string }

/** The agent configs from the notes that hold `agent-config::` (the service's query; their properties as written). */
export function configsOf(notes: readonly { id: string; properties: { key: string; value: string }[] }[]): AgentConfig[] {
  const out: AgentConfig[] = [];
  for (const m of notes) {
    const name = prop(m, "agent-config")?.trim();
    if (!name || out.some(c => c.name === name)) continue;
    const program = prop(m, "program")?.trim() || name, persona = prop(m, "persona")?.trim(), folder = prop(m, "folder")?.trim();
    out.push({ name, program, args: words(prop(m, "args") ?? ""), ...(persona ? { persona } : {}), ...(folder ? { folder } : {}), id: m.id });
  }
  return out;
}

/** Claude Code's folder for a working folder's conversations: every character but letters and digits a dash. */
export const claudeProjectDir = (folder: string, env: Record<string, string | undefined> = process.env, home = env.HOME || homedir()) =>
  join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects", folder.replace(/[^A-Za-z0-9]/g, "-"));
/** Pi's folder for a working folder's sessions: `--<the path, slashes dashes>--`. */
export const piSessionDir = (folder: string, home: string) => join(home, ".pi", "agent", "sessions", `--${folder.replace(/^\//, "").replace(/\//g, "-")}--`);

const hasEntry = (dir: string, test: (name: string) => boolean = () => true) => { try { return readdirSync(dir).some(test); } catch { return false; } };

/** The first `n` bytes of a file (a session file's metadata line), never the whole transcript. */
function head(path: string, n: number): string {
  const fd = openSync(path, "r");
  try { const buf = Buffer.alloc(n); const got = readSync(fd, buf, 0, n, 0); return buf.subarray(0, got).toString("utf8"); } finally { closeSync(fd); }
}

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
    try { if (head(f.path, 4096).includes(want)) return true; } catch { /* gone */ }
  }
  return false;
}

/**
 * Whether Claude kept a conversation for `folder` that an interactive `claude --continue` takes: one of the newest
 * twenty transcripts has a user turn that isn't from a non-interactive run (`claude -p`, `"entrypoint":"sdk-cli"`).
 * Measured with Claude Code 2.1.310: `--continue` answers "No conversation found to continue" for a folder holding only
 * settings lines (`last-prompt`, `agent-setting`, `mode`: a start closed before a prompt) or only `-p` runs, and takes
 * a folder one interactive claude already holds (no lock).
 */
function claudeHas(folder: string, env: Record<string, string | undefined>, home: string): boolean {
  const dir = claudeProjectDir(folder, env, home), files: { path: string; at: number }[] = [];
  try {
    for (const n of readdirSync(dir)) if (n.endsWith(".jsonl")) { const path = join(dir, n); try { files.push({ path, at: statSync(path).mtimeMs }); } catch { /* gone */ } }
  } catch { return false; }
  for (const f of files.sort((a, b) => b.at - a.at).slice(0, 20)) {
    try { if (head(f.path, 65536).split("\n").some(l => l.includes('"type":"user"') && !l.includes('"entrypoint":"sdk-cli"'))) return true; } catch { /* gone */ }
  }
  return false;
}

/**
 * The one answer to "has `program` a conversation to continue in `folder`": claude a transcript with an interactive user turn in its
 * project folder, pi a session file for the folder, codex a session whose cwd is it. A restart and a start both ask this.
 */
export function hasConversation(program: string, folder: string, env: Record<string, string | undefined> = process.env, home = env.HOME || homedir()): boolean {
  if (program === "claude") return claudeHas(folder, env, home);
  if (program === "pi") return hasEntry(piSessionDir(folder, home));
  if (program === "codex") return codexHas(folder, home);
  return false;
}

/**
 * What continues `program`'s last conversation in `folder`, when it has one there: claude `--continue`, pi
 * `--continue`, codex `resume --last` (its own pick is by folder too). Nothing when there's none to continue (claude
 * refuses `--continue` with none) or the program has no such word.
 */
export function resumeArgs(program: string, folder: string, env: Record<string, string | undefined> = process.env, home = env.HOME || homedir()): string[] {
  if (!hasConversation(program, folder, env, home)) return [];
  return program === "codex" ? ["resume", "--last"] : ["--continue"];
}

/**
 * `program` was told what to continue already (none is added then), by its own words: claude and pi `-c`, `--continue`,
 * `-r`, `--resume[=…]`; codex a first word `resume` (its `-c` is a config override, not a continue).
 */
export function resumesAlready(program: string, args: readonly string[]): boolean {
  if (program === "codex") return args[0] === "resume" || args[0] === "fork";
  if (program === "claude" || program === "pi") return args.some(a => ["-c", "--continue", "-r", "--resume"].includes(a) || a.startsWith("--resume="));
  return false;
}

/** A session's command: the program, its arguments, then what resumes its last conversation in `folder`. */
export function sessionCommand(program: string, args: readonly string[], folder: string, env: Record<string, string | undefined> = process.env): string[] {
  const name = agentOf([program]) ?? basename(program);
  if (resumesAlready(name, args)) return [program, ...args];
  const more = resumeArgs(name, folder, env);
  // codex's resume is a subcommand: it comes first, the config's own options after it.
  return name === "codex" && more.length ? [program, ...more, ...args] : [program, ...args, ...more];
}
