// An outline on another machine (`--machine <ssh-name>`, EP0CH_MACHINE, a `.ep0ch`'s `machine`): the ssh forward every
// client keeps to that machine's outline host, one rule for the door, the outliner's Herdr panes and CLI, and the Claude
// mod. It does no I/O of its own: callers pass `MachineIO` (processes, sockets, files, the clock), as `whichOutline`
// takes a reader, so the rule is the same everywhere and testable without ssh. The one Node `MachineIO` is the
// outliner's (packages/outliner/src/machine-forward.ts); the door uses it too.
//
// A machine is an ssh config name. ssh owns its keys, hops and address.
//
// The forward: `<outlines>/.remote/<machine>.sock` (the folder mode 0700) is the local end of the other machine's host
// socket, held by one ssh connection (`-M`, its control socket `<machine>.ctl`, ControlPersist, its log
// `<machine>.log`) that outlives the client that started it, so every client on this machine shares it: the first one
// to need it starts it, the rest find it answering. The other machine's socket isn't assumed: it is asked once per
// start (`ep0ch status --json` there, in a login shell so its PATH is the person's). ExitOnForwardFailure makes a start
// that couldn't forward fail at once; StreamLocalBindUnlink replaces a dead socket file; ServerAlive drops a connection
// whose network went, so the next client to need it starts it again (the door does, as its connection comes back, and
// says so). A connection that is up is never ended here: its host may be restarting, and other clients share it.
import { isMachineName, MACHINE_NAME_PATTERN, outlineLayout } from "./outline-location";

/** What the forward rule does to the world, passed in by each client. */
export interface MachineIO {
  /**
   * Run a program to its end: its exit code and output (never throws for a non-zero exit). `detached`: it leaves a
   * process behind (`ssh -f`), so none of its output is read and it holds nothing of this process's.
   */
  run(argv: string[], timeoutMs: number, o?: { detached?: boolean }): Promise<{ code: number; out: string; err: string }>;
  /**
   * Whether an outline host answers on this socket: a request answered, not only a connect (ssh accepts on a
   * forward's local end even when nothing answers at the other).
   */
  answers(socket: string): Promise<boolean>;
  /** Make the folder, mode 0700; throw when it's someone else's or others can reach it. */
  privateDir(dir: string): void;
  /** A file's text, or null when there's none. */
  read(path: string): string | null;
  /** Remove a file that may not be there. */
  remove(path: string): void;
  /** Create the file with `text` only when there is none (O_EXCL): whether this call made it. The lock. */
  createExclusive(path: string, text: string): boolean;
  /** This process's id, and whether a process runs. */
  pid: number;
  alive(pid: number): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Where a machine's forward is, on this machine. */
export interface ForwardPaths { machine: string; socket: string; control: string; log: string; dir: string }

/** A Unix socket's path, with ssh's temporary suffix for a control socket (`.` and 16 characters), fits macOS's 104 bytes. */
const SOCKET_ROOM = 104 - 17;

export function forwardPaths(outlines: string, machine: string): ForwardPaths {
  if (!isMachineName(machine)) throw new Error(`"${machine}" isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`);
  const layout = outlineLayout(outlines), at = layout.remote(machine);
  if (at.control.length >= SOCKET_ROOM) throw new Error(`${at.control} is too long for a socket's path (${at.control.length} bytes): a shorter outlines folder (EP0CH_OUTLINES) or machine name`);
  return { machine, dir: layout.remoteDir, ...at, log: at.control.replace(/\.ctl$/, ".log") };
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
  /** Start the connection that holds the forward, in the background once the forward listens (`-f`), its messages to its log. */
  forward: (ssh: string, p: ForwardPaths, remoteSocket: string) => [
    ssh, "-f", "-N", "-M", "-S", p.control, "-E", p.log,
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

/**
 * `ep0ch status --json`'s answer, read; what's wrong with it said. A login shell may print before it (a motd) or after
 * it: the answer is the JSON object that starts a line and runs to the last `}`.
 */
export function parseRemoteStatus(text: string, machine: string): RemoteStatus {
  const end = text.lastIndexOf("}");
  let o: any = null;
  for (const m of text.matchAll(/^\{/gm)) {
    try { o = JSON.parse(text.slice(m.index, end + 1)); break; } catch { o = null; }
  }
  if (!o || typeof o.socket !== "string" || !o.socket.startsWith("/")) {
    throw new Error(`${machine} didn't say where its outline host is (ep0ch status --json there answered ${JSON.stringify(text.trim().slice(0, 120))})`);
  }
  if (o.socket.includes(":")) throw new Error(`${machine}'s host socket ${o.socket} has a ":" in its path, which an ssh forward can't name`);
  const outlines = Array.isArray(o.outlines) ? o.outlines.map((x: any) => x?.name).filter((n: unknown): n is string => typeof n === "string") : [];
  return { socket: o.socket, outlines };
}

const lastLine = (s: string | null) => (s ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";

/** Why asking the machine failed, in words with what to do. */
export function statusRefusal(machine: string, r: { code: number; out: string; err: string }): string {
  const said = lastLine(r.err) || lastLine(r.out);
  if (r.code === 255) return `can't reach ${machine} over ssh (${said || "no answer"}) · \`ssh ${machine} true\` should work without asking anything (a key, or an agent)`;
  if (r.code === 127 || /not found/.test(said)) return `${machine} has no ep0ch on a login shell's PATH (${said}) · install it there (ep0ch install --apply)`;
  return `${machine} says: ${said || `exit ${r.code}`}`;
}

/** How a forward came to answer: it already did, or it was started. */
export type ForwardHow = "up" | "started";
export interface Forward { socket: string; how: ForwardHow; remote?: RemoteStatus }

export interface ForwardOptions { ssh: string; outlines: string; io: MachineIO; /** How long a start waits for the host to answer through it. */ waitMs?: number }

/**
 * The machine's forward, answering: found up, or started (asking the machine for its socket first). Throws with what
 * went wrong and what to do. Safe to call from any number of clients at once: one starts it, the rest wait and find it.
 * A connection that is up but whose host doesn't answer is left as it is (and said): its host may be restarting.
 */
export async function ensureForward(machine: string, o: ForwardOptions): Promise<Forward> {
  const p = forwardPaths(o.outlines, machine);
  if (await o.io.answers(p.socket)) return { socket: p.socket, how: "up" };
  o.io.privateDir(p.dir);
  return locked(`${p.control}.lock`, o.io, async () => {
    if (await o.io.answers(p.socket)) return { socket: p.socket, how: "up" as const };
    if ((await o.io.run(sshArgv.check(o.ssh, p), 5000)).code === 0) {
      if (await answersWithin(p.socket, o.io, 2000)) return { socket: p.socket, how: "up" as const };
      throw new Error(`connected to ${machine}, but no outline host answers through the forward (it may be restarting: \`ssh ${machine} ep0ch status\`; if its socket moved, \`ssh -S ${p.control} -O exit ${machine}\` and the next client forwards it again)`);
    }
    // A control socket left by a connection that died would turn the new one's -M off.
    o.io.remove(p.control);
    const asked = await o.io.run(sshArgv.status(o.ssh, machine), 30_000);
    if (asked.code !== 0) throw new Error(statusRefusal(machine, asked));
    const remote = parseRemoteStatus(asked.out, machine);
    o.io.remove(p.log);
    const started = await o.io.run(sshArgv.forward(o.ssh, p, remote.socket), 30_000, { detached: true });
    if (started.code !== 0) throw new Error(`ssh ${machine} couldn't forward its host socket ${remote.socket}: ${lastLine(o.io.read(p.log)) || `exit ${started.code}`}`);
    if (!(await answersWithin(p.socket, o.io, o.waitMs ?? 5000))) throw new Error(`the forward to ${machine} is up, but no outline host answers through it (at ${remote.socket} there)`);
    return { socket: p.socket, how: "started" as const, remote };
  });
}

/** A start takes about a minute at most (asking, forwarding, the first answer); a waiter gives up after twice that. */
const LOCK_WAIT_MS = 120_000;

/**
 * Run `f` holding the lock file at `path` (it holds the holder's pid): one start of a machine's forward at a time,
 * across processes. A lock whose holder has gone is taken over, only while it still names that holder.
 */
async function locked<T>(path: string, io: MachineIO, f: () => Promise<T>): Promise<T> {
  const deadline = io.now() + LOCK_WAIT_MS;
  while (!io.createExclusive(path, String(io.pid))) {
    const held = io.read(path)?.trim() ?? "", holder = Number(held);
    if (!(Number.isInteger(holder) && holder > 0 && io.alive(holder))) {
      if ((io.read(path)?.trim() ?? "") === held) io.remove(path);
      continue;
    }
    if (io.now() > deadline) throw new Error(`another client (pid ${holder}) has been starting this forward for two minutes (${path})`);
    await io.sleep(100);
  }
  try { return await f(); } finally { if (io.read(path)?.trim() === String(io.pid)) io.remove(path); }
}

/** Whether the host answers on `socket` within `ms` of the clock. */
async function answersWithin(socket: string, io: MachineIO, ms: number): Promise<boolean> {
  const deadline = io.now() + ms;
  for (;;) {
    if (await io.answers(socket)) return true;
    if (io.now() >= deadline) return false;
    await io.sleep(100);
  }
}

/** A machine's forward as it is now, without starting anything: for `ep0ch doctor`. */
export interface ForwardState { machine: string; socket: string; answers: boolean; connected: boolean }

export async function forwardState(machine: string, o: ForwardOptions): Promise<ForwardState> {
  const p = forwardPaths(o.outlines, machine);
  const [answers, check] = await Promise.all([o.io.answers(p.socket), o.io.run(sshArgv.check(o.ssh, p), 5000)]);
  return { machine, socket: p.socket, answers, connected: check.code === 0 };
}
