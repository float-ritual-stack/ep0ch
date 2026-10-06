// Slice A of the Effect 4 spike (not for merge): outline-core's `ensureForward` (src/machine.ts there) rewritten on
// Effect. The rule is the same; what changes is how the world is reached and how failures travel:
//
// - `MachineIO` is a service (Context.Service) instead of a parameter. The rule asks for it in its requirements
//   (`R`), and the caller provides a Layer: the outliner's Node one, or a test's fake. No I/O is imported here, so
//   this file keeps outline-core's "no I/O" rule: Effect's core is pure, the I/O arrives through the Layer.
// - The clock is Effect's. `now()` and `sleep()` leave `MachineIO`; tests drive time with TestClock.
// - Each refusal is a Schema.TaggedError with the facts as fields and the exact command as `command`, and a
//   `message` that reads as the original did. The CLI prints `message`; the door can act on `_tag`.
// - The lock file is `Effect.acquireRelease` under a Scope: it is let go on success, failure or interruption,
//   including the two-minute wait giving up. The waiting is `Effect.retry` on a Schedule.
// - "Does the host answer within N ms" is `Effect.repeat` on a Schedule bounded by `upTo`.
//
// Pure helpers that are only data (`sshArgv`, `REMOTE_STATUS`) are imported from outline-core as they are.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { isMachineName, MACHINE_NAME_PATTERN, outlineLayout } from "@ep0ch/outline-core/outline-location";
import { type ForwardPaths, type MachineIO as LegacyMachineIO, type RemoteStatus, sshArgv } from "@ep0ch/outline-core/machine";

// ---- the world, as a service ------------------------------------------------------------------------------------

export interface RunResult { code: number; out: string; err: string }

/** `privateDir` refused: the folder isn't this user's alone. */
export class PrivateDirRefused extends Schema.TaggedError<PrivateDirRefused>()("PrivateDirRefused", { dir: Schema.String }) {
  get message() { return `${this.dir} isn't yours alone (it needs mode 700): no forward`; }
  get command() { return `chmod 700 ${this.dir}`; }
}

export interface MachineIOShape {
  /** Run a program to its end (never fails for a non-zero exit). `detached`: leaves a process behind (`ssh -f`). */
  run(argv: string[], timeoutMs: number, o?: { detached?: boolean }): Effect.Effect<RunResult>;
  /** Whether an outline host answers on this socket (a request answered, not only a connect). */
  answers(socket: string): Effect.Effect<boolean>;
  /** Make the folder, mode 0700; refuse when it's someone else's or others can reach it. */
  privateDir(dir: string): Effect.Effect<void, PrivateDirRefused>;
  read(path: string): Effect.Effect<string | null>;
  remove(path: string): Effect.Effect<void>;
  /** Create the file with `text` only when there is none (O_EXCL): whether this call made it. The lock. */
  createExclusive(path: string, text: string): Effect.Effect<boolean>;
  readonly pid: number;
  alive(pid: number): Effect.Effect<boolean>;
}

export class MachineIO extends Context.Service<MachineIO, MachineIOShape>()("ep0ch/effect-spike/MachineIO") {
  /**
   * The existing Promise-based `MachineIO` (outline-core's interface, the outliner's `nodeMachineIO`) as a Layer:
   * how an edge adopts Effect without rewriting the I/O underneath it first.
   */
  static fromLegacy(io: LegacyMachineIO): Layer.Layer<MachineIO> {
    return Layer.succeed(MachineIO, MachineIO.of({
      run: (argv, ms, o) => Effect.promise(() => io.run(argv, ms, o)),
      answers: socket => Effect.promise(() => io.answers(socket)),
      privateDir: dir => Effect.try({ try: () => io.privateDir(dir), catch: () => new PrivateDirRefused({ dir }) }),
      read: path => Effect.sync(() => io.read(path)),
      remove: path => Effect.sync(() => io.remove(path)),
      createExclusive: (path, text) => Effect.sync(() => io.createExclusive(path, text)),
      pid: io.pid,
      alive: pid => Effect.sync(() => io.alive(pid)),
    }));
  }
}

// ---- refusals: facts as fields, the command to run as `command`, the sentence as `message` ----------------------

export class NotAMachineName extends Schema.TaggedError<NotAMachineName>()("NotAMachineName", { machine: Schema.String }) {
  get message() { return `"${this.machine}" isn't an ssh config name (${MACHINE_NAME_PATTERN.source})`; }
}
export class SocketPathTooLong extends Schema.TaggedError<SocketPathTooLong>()("SocketPathTooLong", { path: Schema.String, length: Schema.Int }) {
  get message() { return `${this.path} is too long for a socket's path (${this.length} bytes): a shorter outlines folder (EP0CH_OUTLINES) or machine name`; }
}
/** The machine could not be asked: no ssh login, no ep0ch there, or ep0ch there said no. */
export class MachineRefused extends Schema.TaggedError<MachineRefused>()("MachineRefused", {
  machine: Schema.String,
  reason: Schema.Literals(["unreachable", "no-ep0ch", "says"]),
  said: Schema.String,
}) {
  get command() {
    return this.reason === "unreachable" ? `ssh ${this.machine} true` : this.reason === "no-ep0ch" ? `ssh ${this.machine} ep0ch install --apply` : undefined;
  }
  get message() {
    if (this.reason === "unreachable") return `can't reach ${this.machine} over ssh (${this.said || "no answer"}) · \`${this.command}\` should work without asking anything (a key, or an agent)`;
    if (this.reason === "no-ep0ch") return `${this.machine} has no ep0ch on a login shell's PATH (${this.said}) · install it there (ep0ch install --apply)`;
    return `${this.machine} says: ${this.said}`;
  }
}
/** `ep0ch status --json` there answered, but not with a host socket this side can forward. */
export class BadRemoteStatus extends Schema.TaggedError<BadRemoteStatus>()("BadRemoteStatus", {
  machine: Schema.String,
  problem: Schema.Literals(["no-socket", "colon-in-path"]),
  answered: Schema.String,
}) {
  get message() {
    return this.problem === "no-socket"
      ? `${this.machine} didn't say where its outline host is (ep0ch status --json there answered ${JSON.stringify(this.answered.trim().slice(0, 120))})`
      : `${this.machine}'s host socket ${this.answered} has a ":" in its path, which an ssh forward can't name`;
  }
}
/** ssh could not set up the forward. */
export class ForwardFailed extends Schema.TaggedError<ForwardFailed>()("ForwardFailed", { machine: Schema.String, remoteSocket: Schema.String, said: Schema.String }) {
  get message() { return `ssh ${this.machine} couldn't forward its host socket ${this.remoteSocket}: ${this.said}`; }
}
/** The forward is up (found connected, or just started) but no outline host answers through it. */
export class HostSilent extends Schema.TaggedError<HostSilent>()("HostSilent", {
  machine: Schema.String,
  how: Schema.Literals(["connected", "started"]),
  control: Schema.String,
  remoteSocket: Schema.optional(Schema.String),
}) {
  get command() { return `ssh ${this.machine} ep0ch status`; }
  get message() {
    return this.how === "connected"
      ? `connected to ${this.machine}, but no outline host answers through the forward (it may be restarting: \`${this.command}\`; if its socket moved, \`ssh -S ${this.control} -O exit ${this.machine}\` and the next client forwards it again)`
      : `the forward to ${this.machine} is up, but no outline host answers through it (at ${this.remoteSocket} there)`;
  }
}
/** Another client has held the start lock for two minutes. */
export class LockHeld extends Schema.TaggedError<LockHeld>()("LockHeld", { holder: Schema.Int, path: Schema.String }) {
  get message() { return `another client (pid ${this.holder}) has been starting this forward for two minutes (${this.path})`; }
  get command() { return `rm ${this.path}`; }
}

export type ForwardError = NotAMachineName | SocketPathTooLong | PrivateDirRefused | MachineRefused | BadRemoteStatus | ForwardFailed | HostSilent | LockHeld;

// ---- the rule ---------------------------------------------------------------------------------------------------

const SOCKET_ROOM = 104 - 17;

export const forwardPaths = Effect.fnUntraced(function*(outlines: string, machine: string) {
  if (!isMachineName(machine)) return yield* new NotAMachineName({ machine });
  const layout = outlineLayout(outlines), at = layout.remote(machine);
  if (at.control.length >= SOCKET_ROOM) return yield* new SocketPathTooLong({ path: at.control, length: at.control.length });
  return { machine, dir: layout.remoteDir, ...at, log: at.control.replace(/\.ctl$/, ".log") } satisfies ForwardPaths;
});

/** `ep0ch status --json`'s answer, read past a motd before it and words after it. */
export const parseRemoteStatus = Effect.fnUntraced(function*(text: string, machine: string) {
  const end = text.lastIndexOf("}");
  let o: any = null;
  for (const m of text.matchAll(/^\{/gm)) {
    try { o = JSON.parse(text.slice(m.index, end + 1)); break; } catch { o = null; }
  }
  if (!o || typeof o.socket !== "string" || !o.socket.startsWith("/")) return yield* new BadRemoteStatus({ machine, problem: "no-socket", answered: text });
  if (o.socket.includes(":")) return yield* new BadRemoteStatus({ machine, problem: "colon-in-path", answered: o.socket });
  const outlines: string[] = Array.isArray(o.outlines) ? o.outlines.map((x: any) => x?.name).filter((n: unknown): n is string => typeof n === "string") : [];
  return { socket: o.socket, outlines } satisfies RemoteStatus;
});

const lastLine = (s: string | null) => (s ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";

const statusRefusal = (machine: string, r: RunResult) => {
  const said = lastLine(r.err) || lastLine(r.out);
  if (r.code === 255) return new MachineRefused({ machine, reason: "unreachable", said });
  if (r.code === 127 || /not found/.test(said)) return new MachineRefused({ machine, reason: "no-ep0ch", said });
  return new MachineRefused({ machine, reason: "says", said: said || `exit ${r.code}` });
};

export type ForwardHow = "up" | "started";
export interface Forward { socket: string; how: ForwardHow; remote?: RemoteStatus }
export interface ForwardOptions { ssh: string; outlines: string; /** How long a start waits for the host to answer through it (ms). */ waitMs?: number }

/** A start takes about a minute at most; a waiter gives up after twice that. */
const LOCK_WAIT = "2 minutes";

class LockBusy extends Schema.TaggedError<LockBusy>()("LockBusy", { holder: Schema.Int }) {}

/**
 * The lock file at `path` (it holds the holder's pid), held for the Scope: one start of a machine's forward at a
 * time, across processes. A lock whose holder has gone is taken over, only while it still names that holder. A live
 * holder is waited for on the clock, then `LockHeld`. Released on every exit, interruption included.
 */
const lock = (path: string) => Effect.acquireRelease(
  Effect.gen(function*() {
    const io = yield* MachineIO;
    const mine = String(io.pid);
    const once: Effect.Effect<void, LockBusy> = Effect.gen(function*() {
      if (yield* io.createExclusive(path, mine)) return;
      const held = ((yield* io.read(path)) ?? "").trim(), holder = Number(held);
      if (Number.isInteger(holder) && holder > 0 && (yield* io.alive(holder))) return yield* new LockBusy({ holder });
      // A holder that died: take its lock over, but only the lock it left (not one a third client just made), at once.
      if (((yield* io.read(path)) ?? "").trim() === held) yield* io.remove(path);
      return yield* once;
    });
    return yield* once.pipe(
      // A live holder is asked again every 100 ms, for two minutes of the clock.
      Effect.retry({ schedule: Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: LOCK_WAIT })) }),
      Effect.catchTag("LockBusy", e => new LockHeld({ holder: e.holder, path })),
      Effect.as(path),
    );
  }),
  () => Effect.gen(function*() {
    const io = yield* MachineIO;
    if (((yield* io.read(path)) ?? "").trim() === String(io.pid)) yield* io.remove(path);
  }),
);

/** Whether the host answers on `socket` within `ms` of the clock: asked at once, then every 100 ms. */
const answersWithin = (socket: string, ms: number) => Effect.gen(function*() {
  const io = yield* MachineIO;
  return yield* io.answers(socket).pipe(
    Effect.repeat({ until: ok => ok, schedule: Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: `${ms} millis` })) }),
  );
});

/**
 * The machine's forward, answering: found up, or started (asking the machine for its socket first). Fails with a
 * `ForwardError` that says what went wrong and what to do. Safe from any number of clients at once: one starts
 * it, the rest wait and find it. A connection that is up but whose host doesn't answer is left as it is (and said).
 */
export const ensureForward = Effect.fn("ensureForward")(function*(machine: string, o: ForwardOptions) {
  const io = yield* MachineIO;
  const p = yield* forwardPaths(o.outlines, machine);
  if (yield* io.answers(p.socket)) return { socket: p.socket, how: "up" } satisfies Forward;
  yield* io.privateDir(p.dir);
  return yield* Effect.scoped(Effect.gen(function*() {
    yield* lock(`${p.control}.lock`);
    if (yield* io.answers(p.socket)) return { socket: p.socket, how: "up" } satisfies Forward;
    if ((yield* io.run(sshArgv.check(o.ssh, p), 5000)).code === 0) {
      if (yield* answersWithin(p.socket, 2000)) return { socket: p.socket, how: "up" } satisfies Forward;
      return yield* new HostSilent({ machine, how: "connected", control: p.control });
    }
    // A control socket left by a connection that died would turn the new one's -M off.
    yield* io.remove(p.control);
    const asked = yield* io.run(sshArgv.status(o.ssh, machine), 30_000);
    if (asked.code !== 0) return yield* statusRefusal(machine, asked);
    const remote = yield* parseRemoteStatus(asked.out, machine);
    yield* io.remove(p.log);
    const started = yield* io.run(sshArgv.forward(o.ssh, p, remote.socket), 30_000, { detached: true });
    if (started.code !== 0) return yield* new ForwardFailed({ machine, remoteSocket: remote.socket, said: lastLine(yield* io.read(p.log)) || `exit ${started.code}` });
    if (!(yield* answersWithin(p.socket, o.waitMs ?? 5000))) return yield* new HostSilent({ machine, how: "started", control: p.control, remoteSocket: remote.socket });
    return { socket: p.socket, how: "started", remote } satisfies Forward;
  }));
});

/** A machine's forward as it is now, without starting anything: for `ep0ch doctor`. */
export interface ForwardState { machine: string; socket: string; answers: boolean; connected: boolean }

export const forwardState = Effect.fn("forwardState")(function*(machine: string, o: ForwardOptions) {
  const io = yield* MachineIO;
  const p = yield* forwardPaths(o.outlines, machine);
  const [answers, check] = yield* Effect.all([io.answers(p.socket), io.run(sshArgv.check(o.ssh, p), 5000)], { concurrency: 2 });
  return { machine, socket: p.socket, answers, connected: check.code === 0 } satisfies ForwardState;
});
