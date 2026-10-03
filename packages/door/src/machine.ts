// Other machines, by their ssh config names: `--machine <name>` (an outline on that machine, through the forward
// outline-core's `ensureForward` keeps: src/machine.ts there has the rule), and `--remote <name>` (this terminal
// attached to the door session running there). Here: the door's side of it (the I/O the rule is given is the
// outliner's, one for both clients: packages/outliner/src/machine-forward.ts), the machines the person has opened
// (`machines.json` in the state dir, for `ep0ch doctor`), and the remote door.
//
// EP0CH_SSH names the ssh to run (tests give a fake one); ssh is the default.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { type Forward, type ForwardState, forwardState } from "@ep0ch/outline-core/machine";
import { forwardFor, forwardOptions } from "@ep0ch/outliner/src/machine-forward";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { hostLive, outlinesDir, resolveTarget } from "./discover";
import { readState, writeState } from "./state";

type Env = Record<string, string | undefined>;

/** The ssh this door runs: EP0CH_SSH, else `ssh`. */
export const sshBin = (env: Env = process.env) => env.EP0CH_SSH?.trim() || "ssh";

const options = (env: Env) => forwardOptions(outlinesDir(env), env as NodeJS.ProcessEnv);

/** The machine's forward, answering (started when it isn't), or why not. */
export function forwardTo(machine: string, env: Env = process.env): Promise<Forward> {
  return forwardFor(machine, outlinesDir(env), env as NodeJS.ProcessEnv);
}

/** What a forward's start was, in a few words for the status bar. */
export function forwardSaying(machine: string, f: Forward): string | null {
  return f.how === "up" ? null : `started the forward to ${machine}`;
}

/** A machine as `ep0ch doctor` shows it: its forward, and its outlines when the forward answers. */
export interface MachineStatus extends ForwardState { outlines: string[] | null }

/** The machine's forward as it is now, and its outlines when it answers: nothing is started. */
export async function machineStatus(machine: string, env: Env = process.env): Promise<MachineStatus> {
  const s = await forwardState(machine, options(env));
  const live = s.answers ? await hostLive(s.socket, 3000) : null;
  return { ...s, outlines: live ? live.outlines : null };
}

// ── the machines the person has opened ──

export interface UsedMachine { name: string; at: number }
const FILE = "machines.json";

/** The machines opened from this state dir (or `dir`), the most recent first. */
export function usedMachines(dir?: string): UsedMachine[] {
  let list: UsedMachine[] | undefined;
  if (dir === undefined) list = readState<{ machines?: UsedMachine[] }>(FILE)?.machines;
  else try { list = JSON.parse(readFileSync(join(dir, FILE), "utf8"))?.machines; } catch { list = undefined; }
  return Array.isArray(list) ? list.filter(m => isMachineName(m?.name)).sort((a, b) => b.at - a.at) : [];
}

/** Keep `name` in the list (moved to the top). */
export function rememberMachine(name: string, now = Date.now()): void {
  if (!isMachineName(name)) return;
  writeState(FILE, { machines: [{ name, at: now }, ...usedMachines().filter(m => m.name !== name)].slice(0, 32) });
}

/** Take `name` off the list (its forward, if one runs, is left as it is). */
export function forgetMachine(name: string): boolean {
  const list = usedMachines();
  if (!list.some(m => m.name === name)) return false;
  writeState(FILE, { machines: list.filter(m => m.name !== name) });
  return true;
}

/**
 * The machines ssh config names: each `Host` alias in ~/.ssh/config and the files it `Include`s, without patterns
 * (`*`, `?`, `!`). What the home base offers to add; ssh itself is what reaches them.
 */
export function sshConfigNames(env: Env = process.env): string[] {
  const home = env.HOME || homedir(), names = new Set<string>(), seen = new Set<string>();
  const read = (file: string, depth: number) => {
    if (depth > 4 || seen.has(file)) return;
    seen.add(file);
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { return; }
    for (const raw of text.split(/\r?\n/)) {
      const m = /^\s*(host|include)(?:\s*=\s*|\s+)(.+?)\s*$/i.exec(raw.replace(/#.*$/, ""));
      if (!m) continue;
      const words = m[2]!.split(/\s+/).map(w => w.replace(/^"|"$/g, ""));
      if (m[1]!.toLowerCase() === "host") { for (const w of words) if (isMachineName(w)) names.add(w); continue; }
      for (const w of words) {
        const pattern = w.replace(/^~(?=\/)/, home), abs = isAbsolute(pattern) ? pattern : join(home, ".ssh", pattern);
        try { for (const f of new Bun.Glob(basename(abs)).scanSync({ cwd: dirname(abs), absolute: true, onlyFiles: true })) read(f, depth + 1); }
        catch { /* a folder that isn't there includes nothing */ }
      }
    }
  };
  read(join(home, ".ssh", "config"), 0);
  return [...names].sort();
}

// ── every outline the person can open from here ──

/** An outline someone can open from here (`machine`: none is this machine), or a machine whose outlines can't be read now (no `name`, a `problem`). */
export interface KnownOutline { name?: string; machine?: string; problem?: string }

/**
 * This machine's host's outlines, then each machine the person has opened (the most recent first) with its outlines,
 * read as the home base and `ep0ch doctor` read them (`hostLive`, `machineStatus`): no forward is started, so a machine
 * not connected now is one row saying so.
 */
export async function everyOutline(socket: string, env: Env = process.env): Promise<KnownOutline[]> {
  const here = hostLive(socket, 3000).then((live): KnownOutline[] => live
    ? live.outlines.map(name => ({ name }))
    : [{ problem: `no outline host answers at ${socket}` }]);
  const there = usedMachines(env.EP0CH_STATE).map(async ({ name: machine }): Promise<KnownOutline[]> => {
    try {
      const s = await machineStatus(machine, env);
      if (s.outlines) return s.outlines.length ? s.outlines.map(name => ({ name, machine })) : [{ machine, problem: "no outlines yet" }];
      return [{ machine, problem: s.connected ? "connected, but no outline host answers" : "not connected" }];
    } catch (e) { return [{ machine, problem: (e as Error).message }]; }
  });
  return (await Promise.all([here, ...there])).flat();
}

// ── the door session on another machine ──

/** A word for a remote shell, as it is: single-quoted. */
export const shellWord = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

/** The variables a door's terminal probing reads, carried to the other machine (ssh -t passes TERM; the rest it doesn't). */
export const REMOTE_TERMINAL_VARS = ["TERM", "COLORTERM", "EP0CH_KITTY", "TERM_PROGRAM", "LANG"] as const;

/**
 * `ep0ch --remote <machine> [door flags]`: this terminal attached to the door session on that machine, `ssh -t <machine>
 * ep0ch [door flags]` in a login shell there, with this terminal's variables. The door runs there, so what it hands a
 * terminal (the drop shell, $EDITOR on a ctrl+e file) runs there too, on its files.
 */
export function remoteDoorArgv(machine: string, args: readonly string[], env: Env = process.env): string[] {
  if (!isMachineName(machine)) throw new Error(`--remote ${JSON.stringify(machine)} isn't an ssh config name`);
  const vars = REMOTE_TERMINAL_VARS.flatMap(k => (env[k] ? [`${k}=${shellWord(env[k]!)}`] : []));
  const door = ["exec", "ep0ch", ...args].map(shellWord).join(" ");
  return [sshBin(env), "-t", "--", machine, ["exec", "env", ...vars, `"\${SHELL:-/bin/sh}"`, "-lc", shellWord(door)].join(" ")];
}

/** `--remote <machine>` out of the arguments: the machine, and the rest for the door there. */
export function remoteOf(args: readonly string[]): { machine: string; rest: string[] } | { error: string } | null {
  const at = args.indexOf("--remote");
  if (at < 0) return null;
  const machine = args[at + 1];
  if (!machine || machine.startsWith("-")) return { error: "--remote needs a machine: an ssh config name (a Host in ~/.ssh/config)" };
  if (!isMachineName(machine)) return { error: `--remote ${JSON.stringify(machine)} isn't an ssh config name` };
  return { machine, rest: args.filter((_, i) => i !== at && i !== at + 1) };
}

/**
 * The door's flags as they go to the machine: the outline this folder names there (its `.ep0ch` says that machine) as
 * `--ws`, when none is given; never `--machine` naming the machine itself (it is the door's own host there).
 */
export function remoteArgs(machine: string, rest: readonly string[], target: ReturnType<typeof resolveTarget>): string[] {
  const own = rest.filter((a, i) => !((a === "--machine" && rest[i + 1] === machine) || (rest[i - 1] === "--machine" && a === machine)));
  if (own.includes("--ws") || "error" in target || !("outline" in target) || target.machine !== machine) return own;
  return ["--ws", target.outline, ...own];
}

/** Run the door there, in this terminal, until it ends: ssh's exit code. */
export async function remoteDoor(machine: string, rest: readonly string[]): Promise<number> {
  rememberMachine(machine);
  const p = Bun.spawn(remoteDoorArgv(machine, remoteArgs(machine, rest, resolveTarget(rest))), { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env } });
  return await p.exited;
}
