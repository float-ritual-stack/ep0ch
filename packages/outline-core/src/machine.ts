// An outline on another machine (`--machine <ssh-name>`, EP0CH_MACHINE, a `.ep0ch`'s `machine`): the ssh forward every
// client keeps to that machine's outline host, one rule for the door, the outliner's Herdr panes and CLI, and the Claude
// mod. It does no I/O of its own: callers pass `MachineIO` (processes, sockets, a lock), as `whichOutline` takes a
// reader, so the rule is the same everywhere and testable without ssh.
//
// A machine is an ssh config name. ssh owns its keys, hops and address; nothing here keeps a registry of machines.
//
// The forward: `<outlines>/.remote/<machine>.sock` (the folder mode 0700) is the local end of the other machine's host
// socket, held by one ssh connection (`-M`, its control socket `<machine>.ctl`, ControlPersist) that outlives the client
// that started it, so every client on this machine shares it: the first one to need it starts it, the rest find it
// answering. The other machine's socket isn't assumed: it is asked once per start (`ep0ch status --json` there, in a
// login shell so its PATH is the person's). ExitOnForwardFailure makes a start that couldn't forward fail at once;
// StreamLocalBindUnlink replaces a dead socket file; ServerAlive drops a connection whose network went, so the next
// client to need it starts it again (the door does, as its connection comes back, and says so).
import { isMachineName, MACHINE_NAME_PATTERN, outlineLayout } from "./outline-location";

/** What the forward rule does to the world, passed in by each client. */
export interface MachineIO {
  /** Run a program to its end: its exit code and output (never throws for a non-zero exit). */
  run(argv: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }>;
  /**
   * Whether an outline host answers on this socket: a request answered, not only a connect (ssh accepts on a
   * forward's local end even when nothing answers at the other).
   */
  answers(socket: string): Promise<boolean>;
  /** Make the folder, mode 0700; throw when it's someone else's or others can reach it. */
  privateDir(dir: string): void;
  /** Remove a file that may not be there. */
  remove(path: string): void;
  /** Create the file only when there is none (O_EXCL): whether this call made it. The lock. */
  createExclusive(path: string): boolean;
  /** How long ago the file was last changed, or null when there's none. */
  ageMs(path: string): number | null;
  sleep(ms: number): Promise<void>;
}

/** Where a machine's forward is, on this machine. */
export interface ForwardPaths { machine: string; socket: string; control: string; dir: string }

export function forwardPaths(outlines: string, machine: string): ForwardPaths {
  if (!isMachineName(machine)) throw new Error(`"${machine}" isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  const layout = outlineLayout(outlines);
  return { machine, dir: layout.remoteDir, ...layout.remote(machine) };
}

/** Every ssh this module runs: no prompt (it runs where nobody can answer one), and a bounded wait to connect. */
const QUIET = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

/**
 * What the other machine is asked, in its login shell: its own host's socket and outlines. EP0CH_SOCKET and
 * EP0CH_MACHINE are unset, so a machine that reaches a third one through either still answers for its own host.
 */
export const REMOTE_STATUS = `exec env -u EP0CH_SOCKET -u EP0CH_MACHINE "\${SHELL:-/bin/sh}" -lc 'ep0ch status --json'`;

export const sshArgv = {
  /** Ask the machine where its host's socket is (`ep0ch status --json` there). */
  status: (ssh: string, machine: string) => [ssh, ...QUIET, "--", machine, REMOTE_STATUS],
  /** Start the connection that holds the forward, in the background once the forward listens (`-f`). */
  forward: (ssh: string, p: ForwardPaths, remoteSocket: string) => [
    ssh, "-f", "-N", "-M", "-S", p.control,
    "-o", "ControlPersist=yes", "-o", "ExitOnForwardFailure=yes", "-o", "StreamLocalBindUnlink=yes", "-o", "StreamLocalBindMask=0177",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", ...QUIET,
    "-L", `${p.socket}:${remoteSocket}`, "--", p.machine,
  ],
  /** Whether that connection is alive (exit 0), and ending it. */
  check: (ssh: string, p: ForwardPaths) => [ssh, "-S", p.control, "-O", "check", "--", p.machine],
  exit: (ssh: string, p: ForwardPaths) => [ssh, "-S", p.control, "-O", "exit", "--", p.machine],
};

/** What the other machine said about its host: its socket, and the outlines it serves. */
export interface RemoteStatus { socket: string; outlines: string[] }

/** `ep0ch status --json`'s answer, read; what's wrong with it said. */
export function parseRemoteStatus(text: string, machine: string): RemoteStatus {
  let o: any;
  try { o = JSON.parse(text.slice(text.indexOf("{"))); } catch { o = null; }
  if (!o || typeof o.socket !== "string" || !o.socket.startsWith("/")) {
    throw new Error(`${machine} didn't say where its outline host is (ep0ch status --json there answered ${JSON.stringify(text.trim().slice(0, 120))})`);
  }
  if (o.socket.includes(":")) throw new Error(`${machine}'s host socket ${o.socket} has a ":" in its path, which an ssh forward can't name`);
  const outlines = Array.isArray(o.outlines) ? o.outlines.map((x: any) => x?.name).filter((n: unknown): n is string => typeof n === "string") : [];
  return { socket: o.socket, outlines };
}

const lastLine = (s: string) => s.trim().split("\n").filter(Boolean).at(-1) ?? "";

/** Why asking the machine failed, in words with what to do. */
export function statusRefusal(machine: string, r: { code: number; out: string; err: string }): string {
  const said = lastLine(r.err) || lastLine(r.out);
  if (r.code === 255) return `can't reach ${machine} over ssh (${said || "no answer"}) · \`ssh ${machine} true\` should work without asking anything (a key, or an agent)`;
  if (r.code === 127 || /not found/.test(said)) return `${machine} has no ep0ch on a login shell's PATH (${said}) · install it there (ep0ch install --apply)`;
  return `${machine} says: ${said || `exit ${r.code}`}`;
}

/** How a forward came to answer: it already did, it was started, or a connection that had stopped forwarding was replaced. */
export type ForwardHow = "up" | "started" | "restarted";
export interface Forward { socket: string; how: ForwardHow; remote?: RemoteStatus }

export interface ForwardOptions { ssh: string; outlines: string; io: MachineIO; /** How long a start waits for the host to answer through it. */ waitMs?: number }

/**
 * The machine's forward, answering: found up, or started (asking the machine for its socket first). Throws with what
 * went wrong and what to do. Safe to call from any number of clients at once: one starts it, the rest wait and find it.
 */
export async function ensureForward(machine: string, o: ForwardOptions): Promise<Forward> {
  const p = forwardPaths(o.outlines, machine);
  if (await o.io.answers(p.socket)) return { socket: p.socket, how: "up" };
  o.io.privateDir(p.dir);
  return locked(`${p.control}.lock`, o.io, async () => {
    if (await o.io.answers(p.socket)) return { socket: p.socket, how: "up" as const };
    let how: ForwardHow = "started";
    if ((await o.io.run(sshArgv.check(o.ssh, p), 5000)).code === 0) {
      // A connection is up but its forward didn't answer: its host may be restarting. Given a moment, then replaced.
      if (await answersWithin(p.socket, o.io, 2000)) return { socket: p.socket, how: "up" as const };
      await o.io.run(sshArgv.exit(o.ssh, p), 5000);
      how = "restarted";
    }
    // A control socket left by a connection that died would turn the new one's -M off.
    o.io.remove(p.control);
    const asked = await o.io.run(sshArgv.status(o.ssh, machine), 30_000);
    if (asked.code !== 0) throw new Error(statusRefusal(machine, asked));
    const remote = parseRemoteStatus(asked.out, machine);
    const started = await o.io.run(sshArgv.forward(o.ssh, p, remote.socket), 30_000);
    if (started.code !== 0) throw new Error(`ssh ${machine} couldn't forward its host socket ${remote.socket}: ${lastLine(started.err) || `exit ${started.code}`}`);
    if (!(await answersWithin(p.socket, o.io, o.waitMs ?? 5000))) throw new Error(`the forward to ${machine} is up, but no outline host answers through it (at ${remote.socket} there)`);
    return { socket: p.socket, how, remote };
  });
}

/** A start takes at most about a minute (asking, forwarding, the first answer); a lock older than that was left by a client that died. */
const STALE_LOCK_MS = 90_000;

/** Run `f` holding the lock file at `path`: one start of a machine's forward at a time, across processes. */
async function locked<T>(path: string, io: MachineIO, f: () => Promise<T>): Promise<T> {
  for (let waited = 0; !io.createExclusive(path); waited += 100) {
    const age = io.ageMs(path);
    if (age !== null && age > STALE_LOCK_MS) { io.remove(path); continue; }
    if (waited > STALE_LOCK_MS) throw new Error(`another client has been starting this forward for over a minute (${path})`);
    await io.sleep(100);
  }
  try { return await f(); } finally { io.remove(path); }
}

async function answersWithin(socket: string, io: MachineIO, ms: number): Promise<boolean> {
  for (let waited = 0; ; waited += 100) {
    if (await io.answers(socket)) return true;
    if (waited >= ms) return false;
    await io.sleep(100);
  }
}

/** A machine's forward as it is now, without starting anything: for `ep0ch doctor` and the home base. */
export interface ForwardState { machine: string; socket: string; answers: boolean; connected: boolean }

export async function forwardState(machine: string, o: ForwardOptions): Promise<ForwardState> {
  const p = forwardPaths(o.outlines, machine);
  const [answers, check] = await Promise.all([o.io.answers(p.socket), o.io.run(sshArgv.check(o.ssh, p), 5000)]);
  return { machine, socket: p.socket, answers, connected: check.code === 0 };
}
