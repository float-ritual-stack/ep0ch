// A throwaway outline host for tests, over its own outlines folder (EP0CH_OUTLINES) with one outline, `scratch`,
// as the host's default, and its own config dir; background agents off, Herdr unset. Never a real outline.
// `restart()` stops it and starts it again on the same folder, the way a deploy would. `seedShowcase()` writes the
// showcase outline (src/showcase/seed.ts) into it.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { HERDR_VARS } from "../src/desk/pty";

/** Jev's key (the outliner's search-ranking.ts reads it): a scratch host never gets it. */
const NO_JEV = ["TYPESAFE_API_KEY"];
/**
 * A scratch host's user extensions folder is its own XDG_CONFIG_HOME's (where the showcase installs Jira and the
 * examples). Run from the repository's root, the outliner's test preload sets OUTLINER_EXTENSIONS_DIR in this
 * process to an empty folder; inherited, the host would look there and find none of them.
 */
const OWN_FOLDERS = ["OUTLINER_EXTENSIONS_DIR"];

/** The outliner package: EP0CH_OUTLINER, else this repository's packages/outliner. */
export const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../outliner")]
  .find(p => p && existsSync(join(p, "src/host-main.ts")));

/**
 * The test's time zone, given to every scratch host: `bun test` runs in UTC while a spawned host would take the
 * machine's zone, and "today" (`wait-until <= today`, PIE-769) would then be a day apart in the evening.
 */
const TEST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};

/** Whether a process with this id runs (EPERM: it does, as another user's). */
export const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
};

/**
 * The pid namespace this process sees its ids in (Linux; "" elsewhere). A run in a container or sandbox that
 * shares /tmp has ids this one can't see: its live run must not look gone.
 */
const pidSpace = () => { try { return readlinkSync("/proc/self/ns/pid"); } catch { return ""; } };

/**
 * Where scratch dirs go: the temp folder, unless it can't hold one. Two things make it unfit, both met under
 * `scripts/agent-env` (TMPDIR=~/.agent-env/<name>/tmp):
 * - a path so long that a session's sockets under it pass the unix socket limit, so its place is hashed into
 *   `sessions/~/` instead of the folder the tests check;
 * - a `.ep0ch` above it (the person's `~/.ep0ch` names their real outline), which a folder that should name no
 *   outline would find walking up.
 * Then a short private folder of /tmp is used: `/tmp/ep0ch-<uid>` (mode 700, this user's).
 */
export function scratchRoot(base = tmpdir()): string {
  // The folder as it is on disk (a symlinked temp folder is checked where it really is), in bytes, as sockets count.
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const named = (dir: string): boolean => existsSync(join(dir, ".ep0ch")) || (dirname(dir) !== dir && named(dirname(dir)));
  const fits = (p: string) => Buffer.byteLength(p) <= SCRATCH_BASE_MAX && !named(real(p));
  if (fits(base) && fits(real(base))) return base;
  const uid = process.getuid?.() ?? 0, dir = `/tmp/ep0ch-${uid}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o077)) throw new Error(`${dir} isn't this user's alone (no access for others): scratch dirs can't go there`);
  if (named(dir)) throw new Error(`a .ep0ch above ${dir} names an outline: scratch dirs can't go under it`);
  return dir;
}
/**
 * The longest temp folder (bytes) a scratch dir goes in: the deepest socket the tests make under it,
 * `<base>/ep0ch-scratch-XXXXXX/door/sessions/socket-<10 hex>/scratch/door-<7 digits>.sock`, is 79 bytes past it, so
 * it stays within 103 (src/session/place.ts SOCKET_MAX).
 */
const SCRATCH_BASE_MAX = 24;

/**
 * A temp dir for a scratch service, named `prefix…`, with the id of the test process that owns it (and the pid
 * namespace that id is in) in its `pid` file. The dirs a killed run left (their `pid` names a process that's
 * gone) are removed first: only this prefix's, only this user's, only ones written from this pid namespace,
 * never one whose process runs or that has no `pid` file.
 */
export function scratchDir(prefix: string): string {
  const uid = process.getuid?.(), space = pidSpace(), base = scratchRoot();
  for (const name of readdirSync(base)) {
    if (!name.startsWith(prefix)) continue;
    const dir = join(base, name);
    try {
      const st = lstatSync(dir);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      const [id, ns = ""] = readFileSync(join(dir, "pid"), "utf8").trim().split("\n");
      const pid = Number(id);
      if (ns === space && Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) rmSync(dir, { recursive: true, force: true });
    } catch { /* no pid file, or gone already: left alone */ }
  }
  const dir = mkdtempSync(join(base, prefix));
  writeFileSync(join(dir, "pid"), `${process.pid}\n${space}`);
  return dir;
}

/**
 * box-test's mark on every process of a run (scripts/box-test-guard): it stops what carries it when the run ends, and
 * sweeps it after a run that was killed. A test that writes its children's environment whole passes it on with
 * `wholeEnv`, or the hosts and sessions it starts outlive the run unseen (PIE-1360: 46 install-test hosts, for days).
 */
const RUN_MARK = "BOX_TEST_RUN_DIR";
export const wholeEnv = (env: Record<string, string>): Record<string, string> =>
  process.env[RUN_MARK] ? { ...env, [RUN_MARK]: process.env[RUN_MARK] } : env;

/** This user's processes tied to `root`: their working folder or EP0CH_OUTLINES under it, or their command line naming it (Linux). */
export function processesUnder(root: string): number[] {
  const under = (p: string) => p === root || p.startsWith(root + "/");
  const uid = process.getuid?.();
  const found: number[] = [];
  let ids: string[] = [];
  try { ids = readdirSync("/proc").filter(n => /^\d+$/.test(n)); } catch { return found; }
  for (const id of ids) {
    const pid = Number(id);
    if (pid === process.pid) continue;
    try {
      if (lstatSync(`/proc/${id}`).uid !== uid) continue;
      const tied = (() => { try { return under(readlinkSync(`/proc/${id}/cwd`)); } catch { return false; } })()
        || readFileSync(`/proc/${id}/cmdline`, "utf8").split("\0").some(under)
        || readFileSync(`/proc/${id}/environ`, "utf8").split("\0").some(kv => kv.startsWith("EP0CH_OUTLINES=") && under(kv.slice(15)));
      if (tied) found.push(pid);
    } catch { /* gone */ }
  }
  return found;
}

/**
 * Stops every process tied to `root`: TERM, up to 3 s to go, then KILL for those still tied to it (a pid freed in
 * between may be another's now). Synchronous, so a signal handler can call it.
 */
export function stopUnder(root: string): void {
  const pids = processesUnder(root);
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
  for (const end = Date.now() + 3000; pids.some(alive) && Date.now() < end;) Bun.sleepSync(50);
  for (const pid of processesUnder(root).filter(p => pids.includes(p))) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

/** The scratch folders this process owns, stopped together by one handler per signal. */
const OWNED = new Set<string>();

/**
 * The test that made `root` owns what runs from it: hosts started with setsid and daemonized sessions leave the test's
 * process tree, so Bun's own cleanup never reaches them, and a TERM, INT or HUP (box-test ending its run, a `timeout`)
 * ends `bun test` without its afterAll. Then they are stopped here before it exits; afterAll calls `stopUnder` itself.
 * A signal waits for a running spawnSync to return; a run that can't wait (box-test's KILL) is the guard's, through `wholeEnv`.
 */
export function ownScratch(root: string): void {
  if (!OWNED.size) {
    for (const [sig, n] of [["SIGTERM", 15], ["SIGINT", 2], ["SIGHUP", 1]] as const) {
      process.once(sig, () => { for (const r of OWNED) stopUnder(r); process.exit(128 + n); });
    }
  }
  OWNED.add(root);
}

/** Where a scratch host's stderr goes: `host.log` in its dir (a restart starts it again). */
const hostLog = (root: string) => Bun.file(join(root, "host.log"));

/**
 * A scratch host that exits while its tests still hold it (nobody called stop) says so on stderr, with its exit
 * code and the end of its log: a test that then can't reach its socket shows why, not only ENOENT.
 */
function watchHost(p: Subprocess, root: string, current: () => Subprocess | null): Subprocess {
  void p.exited.then(code => {
    if (current() !== p) return;
    let tail = "";
    try { tail = readFileSync(join(root, "host.log"), "utf8").split("\n").slice(-30).join("\n"); } catch { /* no log */ }
    // A clean exit (the host stops on SIGTERM) nobody here asked for: most likely Bun's, which ends a file's processes
    // when one of its tests times out ("killed N dangling processes").
    const why = code === 0 || p.signalCode === "SIGTERM" ? ": it was told to stop; a test in this file timing out does that (bun test ends the file's processes)" : "";
    console.error(`scratch host ${root} exited while its tests held it (code ${code}, signal ${p.signalCode ?? "none"}${why}); the next test starts it again (revive), but a request the running one still has open fails. Its log ends:\n${tail}`);
  });
  return p;
}

/** The scratch services this process holds, for the preload's `beforeEach` (`revive`): it can't import this file for every test. */
const HELD = Symbol.for("ep0ch.test.scratches");
const holding = (): { add(s: { revive(): Promise<boolean> }): void; delete(s: { revive(): Promise<boolean> }): void } | undefined => (globalThis as { [k: symbol]: unknown })[HELD] as never;

/**
 * Bun ends every process a file started when one of its tests times out (see watchHost), a scratch host among them, so
 * a timeout would fail each test after it in the file too ("connect ENOENT …/host.sock"), whatever those tests do. Each
 * test starts by asking its host to answer (one round trip); a host that doesn't and has ended is started again on the
 * same folder (its outlines are on disk), so a test's failure stays that test's. A host that doesn't answer but still
 * runs is slow, not gone: it's left alone. `answers`/`start` are the service's own.
 */
async function revived(p: Subprocess | null, root: string, answers: () => Promise<boolean>, start: () => Promise<unknown>): Promise<boolean> {
  if (!p) return false;
  const gone = () => p.exitCode !== null || p.signalCode !== null;
  if (!gone() && await answers()) return false;
  // Bun's kill is a SIGTERM that lands a moment after the timeout, and the host stops gracefully: wait for it, bounded.
  await Promise.race([p.exited, Bun.sleep(8000)]);
  if (!gone()) return false;
  console.error(`scratch host ${root} had ended (Bun ends a file's processes when a test of it times out); started again for the next test`);
  await start();
  return true;
}

export class Scratch {
  readonly root: string;
  sock = "";
  private proc: Subprocess | null = null;
  /** `root`: serve that directory's outlines/config (the layout scripts/try-it.sh --showcase uses) instead of a new temp dir. */
  constructor(root?: string, readonly name = "scratch") {
    this.root = root ?? scratchDir("ep0ch-scratch-");
    for (const d of ["outlines", "config", "door"]) mkdirSync(join(this.root, d), { recursive: true, mode: 0o700 });
    holding()?.add(this);
  }
  /** Its service runs (started, not stopped): one a test file leaves running is named between files (test/preload.ts). */
  get running() { return !!this.proc; }
  /** The outlines folder the host serves. */
  get outlines() { return join(this.root, "outlines"); }
  /** The outline's own folder (`<outlines>/<name>/`): the root its relative file links resolve against. */
  get workspace() { return join(this.outlines, this.name); }
  /** The environment an `ep0ch` (or outliner) command uses to reach this outline. */
  get env(): Record<string, string> { return { EP0CH_OUTLINES: this.outlines, EP0CH_WS: this.name, XDG_CONFIG_HOME: join(this.root, "config") }; }
  /** The service's process id, while it runs. */
  get pid() { return this.proc?.pid; }

  /** Set before start: what the host's environment adds (a fake Jev: OUTLINER_FIGURE_FIT, TYPESAFE_API_KEY, OUTLINER_JEV_ENDPOINT). */
  hostEnv: Record<string, string> = {};

  /** Starts the host (its default outline is this one, so a board that names none reads it) and makes the outline. */
  async start(): Promise<string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      EP0CH_OUTLINES: this.outlines, EP0CH_DEFAULT_WS: this.name, XDG_CONFIG_HOME: join(this.root, "config"),
    };
    // No Jev key: a scratch host answers searches with text matches only, never a paid call.
    for (const k of [...HERDR_VARS, ...NO_JEV, ...OWN_FOLDERS, "EP0CH_SOCKET", "EP0CH_WS"]) delete env[k];
    env.TZ = TEST_ZONE;
    Object.assign(env, this.hostEnv);
    this.proc = watchHost(Bun.spawn(["bun", "src/host-main.ts"], { cwd: outliner!, env, stdout: "ignore", stderr: hostLog(this.root) }), this.root, () => this.proc);
    const path = join(this.outlines, ".host", "host.sock");
    const { hostRequest, SocketBoard } = await import("../src/socket");
    const ping = async () => {
      const b = new SocketBoard(path, 1000);
      try { await b.info(); return true; } catch { return false; } finally { b.close(); }
    };
    const end = Date.now() + 20_000;
    for (;;) {
      if (existsSync(path)) {
        try { await hostRequest(path, "outlines.attach", { name: this.name, create: true }, 2000); } catch { /* not up yet */ }
        if (await ping()) return (this.sock = path);
      }
      if (Date.now() > end) throw new Error("the scratch outline host didn't start");
      await Bun.sleep(50);
    }
  }

  /** SIGTERM, as a deploy would; true when the service shut down by itself within `ms` (else it's killed). */
  async stop(ms = 8000): Promise<boolean> {
    const p = this.proc;
    this.proc = null;
    if (!p) return true;
    p.kill();
    const graceful = await Promise.race([p.exited.then(() => true), Bun.sleep(ms).then(() => false)]);
    if (!graceful) { p.kill(9); await p.exited; }
    return graceful;
  }

  /** Stop and start on the same state. Resolves once the new service answers, with whether the stop was graceful. */
  async restart(): Promise<{ sock: string; graceful: boolean }> { const graceful = await this.stop(); return { sock: await this.start(), graceful }; }

  /** Seed the showcase outline through the service, the way scripts/try-it.sh --showcase does. */
  async seedShowcase() {
    const { SocketBoard } = await import("../src/socket");
    const { seedShowcase } = await import("../src/showcase/seed");
    const b = new SocketBoard(this.sock);
    try { await b.info(); return await seedShowcase(b, { ticketsConfig: join(this.root, "config"), ...(outliner ? { rulesFrom: outliner } : {}) }); } finally { b.close(); }
  }

  /** Starts the host again when it has ended under the tests (Bun's, at a test's timeout); true when it did. The preload asks before every test. */
  async revive(): Promise<boolean> {
    return revived(this.proc, this.root, async () => { const b = new (await import("../src/socket")).SocketBoard(this.sock, 2000); try { await b.info(); return true; } catch { return false; } finally { b.close(); } }, async () => { this.proc = null; await this.start(); });
  }

  async dispose() { holding()?.delete(this); await this.stop(2000); rmSync(this.root, { recursive: true, force: true }); }
}

/** The outliner package with the outline host: EP0CH_OUTLINER_HOST, else `outliner`. */
export const hostOutliner = [process.env.EP0CH_OUTLINER_HOST, outliner]
  .find(p => p && existsSync(join(p, "src/host-main.ts")));

/**
 * A throwaway outline host (one socket, outlines by name) over its own outlines folder, with no outline yet and,
 * unless asked, no default: what a person's machine is like. Background agents off, Herdr unset. `folder(name)`
 * makes a fictional folder beside it for naming tests (a `.ep0ch` there, or none).
 */
export class ScratchHost {
  readonly root: string;
  private proc: Subprocess | null = null;
  private defaultOutline: string | undefined;
  constructor() {
    this.root = scratchDir("ep0ch-host-");
    for (const d of ["outlines", "config", "door", "folders", "home"]) mkdirSync(join(this.root, d), { recursive: true });
    holding()?.add(this);
  }
  /** As `Scratch.running`. */
  get running() { return !!this.proc; }
  get outlines() { return join(this.root, "outlines"); }
  get config() { return join(this.root, "config"); }
  get sock() { return join(this.outlines, ".host", "host.sock"); }
  /** The environment a door or `ep0ch` command uses to find this host (HOME is the scratch's, so no real .ep0ch is read above it). */
  get env(): Record<string, string> {
    // A CLI's fake SSH forward belongs to the test runner, not the short-lived CLI that opens it.
    return { EP0CH_OUTLINES: this.outlines, XDG_CONFIG_HOME: this.config, HOME: join(this.root, "home"), FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE! };
  }
  folder(name: string): string { const p = join(this.root, "folders", name); mkdirSync(p, { recursive: true }); return p; }

  async start(defaultOutline?: string): Promise<string> {
    this.defaultOutline = defaultOutline;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>), ...this.env,
    };
    for (const k of [...HERDR_VARS, ...NO_JEV, ...OWN_FOLDERS, "EP0CH_DEFAULT_WS", "EP0CH_SOCKET", "EP0CH_WS"]) delete env[k];
    if (defaultOutline) env.EP0CH_DEFAULT_WS = defaultOutline;
    env.TZ = TEST_ZONE;
    this.proc = watchHost(Bun.spawn(["bun", "src/host-main.ts"], { cwd: hostOutliner!, env, stdout: "ignore", stderr: hostLog(this.root) }), this.root, () => this.proc);
    const { hostLive } = await import("../src/discover");
    const end = Date.now() + 20_000;
    while (!(await hostLive(this.sock, 1000))) {
      if (Date.now() > end) throw new Error("the scratch outline host didn't start");
      await Bun.sleep(50);
    }
    return this.sock;
  }

  /** A new outline on the host, by name. */
  async create(name: string) {
    const { hostRequest } = await import("../src/socket");
    return hostRequest(this.sock, "outlines.create", { name });
  }

  async stop() {
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    p.kill();
    if (!(await Promise.race([p.exited.then(() => true), Bun.sleep(5000).then(() => false)]))) { p.kill(9); await p.exited; }
  }

  /** As `Scratch.revive`. */
  async revive(): Promise<boolean> {
    return revived(this.proc, this.root, async () => !!(await (await import("../src/discover")).hostLive(this.sock, 2000)), async () => { this.proc = null; await this.start(this.defaultOutline); });
  }

  async dispose() { holding()?.delete(this); await this.stop(); rmSync(this.root, { recursive: true, force: true }); }
}
