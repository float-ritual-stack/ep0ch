// `ep0ch agent ls` and `ep0ch agent restart`: the person-facing front door for scripts/agent-restart, the one
// implementation of restarting a background Claude Code session (it resolves the name, waits for a safe moment, stops,
// resumes). This is argument handling, the ssh hop and the words: here the script runs from the installed checkout, on
// another machine `ep0ch agent …` runs there (its own checkout's script) through the ssh the CLI already uses for a
// remote `ep0ch` (mcp-netmail's `ssh`, EP0CH_SSH for tests). Only `--machine` names the machine: EP0CH_MACHINE and a
// `.ep0ch`'s machine name an outline's, and a restart must never follow the outline to float-2 by accident.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { isLocalMachine } from "@ep0ch/outliner/machine-name";

type Env = Record<string, string | undefined>;
export interface Ran { code: number; out: string; err: string }
/** Runs `argv` (a script here), or `ep0ch <rest>` on `machine`, and answers what it printed. */
export interface FleetIO {
  local(argv: string[], env: Env): Promise<Ran>;
  remote(machine: string, command: string, env: Env): Promise<Ran>;
  /** The installed checkout's scripts/agent-restart. */
  script(): string;
}

export const REMOTE_LOG = "~/.local/state/ep0ch/agent-restart.log";
const VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One row of `scripts/agent-restart --ls`. */
export interface SessionRow {
  name: string; id: string; sessionId: string; status: string; cwd: string;
  /** `background` (the daemon's job: restartable here) or `interactive` (a terminal owns it). */
  kind: string;
  /** Where an interactive session's process runs, when its parents say (a door terminal tile and its outline, a Herdr pane…). */
  place: string | null;
  running: string | null; installed: string; behind: boolean;
}

const RESTART_USAGE = "ep0ch agent restart <name | short id | --all> [--if-update] [--fresh-daemon] [--check-env <VAR>] [--now] [--dry-run] [--machine <ssh-name>]";
const LS_USAGE = "ep0ch agent ls [--machine <ssh-name>] [--json]";

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The machine flag, taken out of `argv`; or what's wrong with it. */
function takeMachine(argv: readonly string[], usage: string): { machine?: string; rest: string[] } | { error: string } {
  const rest: string[] = [];
  let machine: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--machine") { rest.push(argv[i]!); continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith("-")) return { error: `--machine needs an ssh config name (a Host in ~/.ssh/config) · ${usage}` };
    if (!isMachineName(v)) return { error: `--machine ${JSON.stringify(v)} isn't an ssh config name (letters, digits, . _ -, up to 32) · ${usage}` };
    machine = v;
  }
  return { ...(machine ? { machine } : {}), rest };
}

/**
 * What `ep0ch agent restart` asks of the script: its arguments, or what's wrong. `dry`: a dry run says its plan to the
 * caller, so it is not detached; anything else runs with --bg (`detached`), here or by the `ep0ch` on the machine.
 */
export function restartArgs(argv: readonly string[]): { machine?: string; args: string[]; dry: boolean } | { error: string } {
  const m = takeMachine(argv, RESTART_USAGE);
  if ("error" in m) return { error: `ep0ch agent restart: ${m.error}` };
  const targets: string[] = [], flags: string[] = [];
  let dry = false;
  for (let i = 0; i < m.rest.length; i++) {
    const a = m.rest[i]!;
    if (a === "--check-env") {
      const v = m.rest[++i];
      if (v === undefined || !VAR.test(v)) return { error: `ep0ch agent restart: --check-env needs an environment variable's name (OTEL_TRACES_EXPORTER) · ${RESTART_USAGE}` };
      flags.push(a, v);
    } else if (["--if-update", "--fresh-daemon", "--now", "--when-idle"].includes(a)) flags.push(a);
    else if (a === "--dry-run") { dry = true; flags.push(a); }
    else if (a === "--all") targets.push(a);
    else if (a.startsWith("--")) return { error: `ep0ch agent restart: no flag ${a} · ${RESTART_USAGE}` };
    else targets.push(a);
  }
  if (targets.length === 0) return { error: `ep0ch agent restart: which session? A name or short id (\`ep0ch agent ls${m.machine ? ` --machine ${m.machine}` : ""}\` lists them), or --all · ${RESTART_USAGE}` };
  if (targets.length > 1) return { error: `ep0ch agent restart: one session at a time, or --all (got ${targets.map(t => JSON.stringify(t)).join(", ")}) · quote a name with spaces: ep0ch agent restart "loki-sr (2)" · ${RESTART_USAGE}` };
  return { ...(m.machine ? { machine: m.machine } : {}), args: [targets[0]!, ...flags], dry };
}

/** The sessions, one line each: name, id, kind, state, the version it runs, and whether that is behind the installed one. */
export function formatSessions(rows: readonly SessionRow[], machine?: string): string {
  const where = machine ?? "this machine";
  if (!rows.length) return `no Claude sessions on ${where} (claude agents lists them)`;
  const w = (f: (r: SessionRow) => string) => Math.max(...rows.map(r => f(r).length));
  const nameW = w(r => r.name || "(unnamed)"), kindW = w(r => r.kind), stateW = w(r => r.status || "?");
  const lines = rows.map(r => `${(r.name || "(unnamed)").padEnd(nameW)}  ${r.id}  ${r.kind.padEnd(kindW)}  ${(r.status || "?").padEnd(stateW)}  ${(r.running ?? "?").padEnd(8)}${r.behind ? `  behind ${r.installed}` : r.running ? "  current" : "  (its process can't be read)"}${r.place ? ` · ${r.place}` : ""}`);
  const m = machine ? ` --machine ${machine}` : "";
  const behind = rows.filter(r => r.behind && r.kind === "background"), terminals = rows.filter(r => r.behind && r.kind !== "background");
  if (behind.length || terminals.length) lines.push("");
  if (behind.length) lines.push(`${behind.length} background behind the installed ${behind[0]!.installed}: ep0ch agent restart --all --if-update${m}`);
  if (terminals.length) lines.push(`${terminals.length} interactive behind (${terminals.map(r => r.name || r.id).join(", ")}): a terminal owns each, so restart the program there: /exit, then claude --continue`);
  return lines.join("\n");
}

const unreachable = (machine: string, r: Ran) =>
  `ep0ch agent: can't reach ${machine} over ssh (${r.err.trim().split("\n").at(-1) || `exit ${r.code}`}) · ssh ${machine} true shows what ssh says`;

/** A remote run that didn't go through, in words with the command to run; null when it ran (its own code and words stand). */
function remoteProblem(machine: string, r: Ran): string | null {
  if (r.code === 255) return unreachable(machine, r);
  if (r.code === 127 && /ep0ch/.test(r.err)) return `ep0ch agent: no ep0ch on ${machine}'s login PATH (${r.err.trim().split("\n").at(-1)}) · ssh ${machine} 'command -v ep0ch' shows where it looks; install it there (git clone, bun install, ep0ch install --apply)`;
  if (/no flag (ls|restart)\b|no flag "?(ls|restart)/.test(r.err)) return `ep0ch agent: ${machine} runs an ep0ch from before \`agent ls\` and \`agent restart\` · update it there: ssh ${machine} ep0ch install --apply`;
  return null;
}

async function checkout(io: FleetIO): Promise<{ script: string } | { error: string }> {
  const script = io.script();
  return existsSync(script) ? { script } : { error: `ep0ch agent: no ${script} in this ep0ch checkout · it is older than this command: ep0ch install --apply fast-forwards it` };
}

export async function agentLs(argv: readonly string[], env: Env, io: FleetIO, out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const m = takeMachine(argv.filter(a => a !== "--json"), LS_USAGE);
  const json = argv.includes("--json");
  if ("error" in m) { err(`ep0ch agent ls: ${m.error}`); return 2; }
  if (m.rest.length) { err(`ep0ch agent ls: no argument ${m.rest[0]} · ${LS_USAGE}`); return 2; }
  const far = m.machine && !isLocalMachine(m.machine, env as NodeJS.ProcessEnv) ? m.machine : undefined;
  let r: Ran;
  if (far) {
    r = await io.remote(far, "ep0ch agent ls --json", env);
    const problem = remoteProblem(far, r);
    if (problem) { err(problem); return 1; }
  } else {
    const c = await checkout(io);
    if ("error" in c) { err(c.error); return 1; }
    r = await io.local([c.script, "--ls"], env);
  }
  if (r.code !== 0) { err(r.err.trim() || `ep0ch agent ls: exit ${r.code}${far ? ` on ${far}` : ""}`); return r.code === 127 ? 1 : r.code; }
  let rows: SessionRow[];
  try { rows = JSON.parse(r.out); if (!Array.isArray(rows)) throw new Error("not a list"); } catch { err(`ep0ch agent ls: ${far ?? "the script"} answered something that isn't a list of sessions: ${r.out.trim().slice(0, 200)}`); return 1; }
  out(json ? JSON.stringify(rows) : formatSessions(rows, far));
  return 0;
}

export async function agentRestart(argv: readonly string[], env: Env, io: FleetIO, out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const a = restartArgs(argv);
  if ("error" in a) { err(a.error); return 2; }
  const far = a.machine && !isLocalMachine(a.machine, env as NodeJS.ProcessEnv) ? a.machine : undefined;
  let r: Ran;
  if (far) {
    r = await io.remote(far, `ep0ch agent restart ${a.args.map(shq).join(" ")}`, env);
    const problem = remoteProblem(far, r);
    if (problem) { err(problem); return 1; }
  } else {
    const c = await checkout(io);
    if ("error" in c) { err(c.error); return 1; }
    r = await io.local([c.script, ...a.args, ...(a.dry ? [] : ["--bg"])], env);
  }
  // The script's own words (what it will do, or why it won't) stand, with the machine named.
  const say = (s: string) => s.split("\n").filter(Boolean).map(l => (far ? `${far}: ${l}` : l)).join("\n");
  if (r.out.trim()) out(say(r.out.trim()));
  if (r.code !== 0) { err(r.err.trim() ? say(r.err.trim()) : `ep0ch agent restart: exit ${r.code}${far ? ` on ${far}` : ""}`); return r.code; }
  if (r.out.includes("running in the background")) out(`follow it: ${far ? `ssh ${far} ` : ""}tail -f ${REMOTE_LOG}`);
  return 0;
}

/** The real thing: the installed checkout's script, and ssh through the CLI's one remote-`ep0ch` helper. */
export const realFleetIO: FleetIO = {
  script: () => resolve(import.meta.dir, "../../../scripts/agent-restart"),
  async local(argv, env) {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
  },
  async remote(machine, command, env) {
    const { ssh } = await import("./mcp-netmail");
    return ssh(env, machine, command, undefined, 120_000).catch(e => ({ code: 255, out: "", err: (e as Error).message }));
  },
};
