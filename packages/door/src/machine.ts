// Other machines, by their ssh config names: `--machine <name>` (an outline on that machine, through the forward
// outline-core's `ensureForward` keeps: src/machine.ts there has the rule), and `--remote <name>` (this terminal
// attached to the door session running there). Here: the door's side of it, the I/O the rule is given, the machines
// the person has opened (`machines.json` in the state dir, for the home base and `ep0ch doctor`), and the remote door.
//
// EP0CH_SSH names the ssh to run (tests give a fake one); ssh is the default.
import { closeSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureForward, type Forward, type ForwardState, forwardState, type MachineIO } from "@ep0ch/outline-core/machine";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { hostLive, outlinesDir } from "./discover";
import { privateDir, readState, writeState } from "./state";

type Env = Record<string, string | undefined>;

/** The ssh this door runs: EP0CH_SSH, else `ssh`. */
export const sshBin = (env: Env = process.env) => env.EP0CH_SSH?.trim() || "ssh";

/** The world, as the forward rule touches it: processes, the host socket, the lock. */
export const machineIO: MachineIO = {
  async run(argv, timeoutMs) {
    try {
      // The environment as it is now (EP0CH_SSH's fake in a test reads what the test set), not as the process began.
      const p = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
      const timer = setTimeout(() => p.kill(), timeoutMs);
      // `ssh -f` leaves its connection running with these pipes: read until it exits, not until they close.
      const out = new Response(p.stdout).text(), err = new Response(p.stderr).text();
      const code = await p.exited;
      clearTimeout(timer);
      const settle = (t: Promise<string>) => Promise.race([t, Bun.sleep(200).then(() => "")]);
      return { code, out: await settle(out), err: await settle(err) };
    } catch (e) { return { code: 127, out: "", err: (e as Error).message }; }
  },
  answers: async socket => !!(await hostLive(socket, 3000)),
  privateDir(dir) { if (!privateDir(dir, true)) throw new Error(`${dir} isn't yours alone (it needs mode 700): no forward`); },
  remove(path) { rmSync(path, { force: true }); },
  createExclusive(path) {
    try { closeSync(openSync(path, "wx", 0o600)); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
  },
  ageMs(path) { try { return Date.now() - statSync(path).mtimeMs; } catch { return null; } },
  sleep: ms => Bun.sleep(ms),
};

const forwardOptions = (env: Env) => ({ ssh: sshBin(env), outlines: outlinesDir(env), io: machineIO });

/** The machine's forward, answering (started when it isn't), or why not. */
export function forwardTo(machine: string, env: Env = process.env): Promise<Forward> {
  return ensureForward(machine, forwardOptions(env));
}

/** What a forward's start was, in a few words for the status bar. */
export function forwardSaying(machine: string, f: Forward): string | null {
  return f.how === "up" ? null : f.how === "restarted" ? `the forward to ${machine} was replaced` : `started the forward to ${machine}`;
}

/** A machine as the home base and `ep0ch doctor` show it: its forward, and its outlines when the forward answers. */
export interface MachineStatus extends ForwardState { outlines: string[] | null }

/** The machine's forward as it is now, and its outlines when it answers: nothing is started. */
export async function machineStatus(machine: string, env: Env = process.env): Promise<MachineStatus> {
  const s = await forwardState(machine, forwardOptions(env));
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

/** Run the door there, in this terminal, until it ends: ssh's exit code. */
export async function remoteDoor(machine: string, rest: readonly string[]): Promise<number> {
  rememberMachine(machine);
  const p = Bun.spawn(remoteDoorArgv(machine, rest), { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env } });
  return await p.exited;
}
