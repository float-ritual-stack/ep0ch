// A throwaway outline host for tests, over its own outlines folder (EP0CH_OUTLINES) with one outline, `scratch`,
// as the host's default, and its own config dir; background agents off, Herdr unset. Never a real outline.
// `restart()` stops it and starts it again on the same folder, the way a deploy would. `seedShowcase()` writes the
// showcase outline (src/showcase/seed.ts) into it.
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { HERDR_VARS } from "../src/desk/pty";

/** The outliner package: EP0CH_OUTLINER, else this repository's packages/outliner. */
export const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../outliner")]
  .find(p => p && existsSync(join(p, "src/host-main.ts")));

export const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};

/** Whether a process with this id runs (EPERM: it does, as another user's). */
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
};

/**
 * The pid namespace this process sees its ids in (Linux; "" elsewhere). A run in a container or sandbox that
 * shares /tmp has ids this one can't see: its live run must not look gone.
 */
const pidSpace = () => { try { return readlinkSync("/proc/self/ns/pid"); } catch { return ""; } };

/**
 * A temp dir for a scratch service, named `prefix…`, with the id of the test process that owns it (and the pid
 * namespace that id is in) in its `pid` file. The dirs a killed run left (their `pid` names a process that's
 * gone) are removed first: only this prefix's, only this user's, only ones written from this pid namespace,
 * never one whose process runs or that has no `pid` file.
 */
export function scratchDir(prefix: string): string {
  const uid = process.getuid?.(), space = pidSpace();
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(prefix)) continue;
    const dir = join(tmpdir(), name);
    try {
      const st = lstatSync(dir);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      const [id, ns = ""] = readFileSync(join(dir, "pid"), "utf8").trim().split("\n");
      const pid = Number(id);
      if (ns === space && Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) rmSync(dir, { recursive: true, force: true });
    } catch { /* no pid file, or gone already: left alone */ }
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "pid"), `${process.pid}\n${space}`);
  return dir;
}

export class Scratch {
  readonly root: string;
  sock = "";
  private proc: Subprocess | null = null;
  /** `root`: serve that directory's outlines/config (the layout scripts/try-it.sh --showcase uses) instead of a new temp dir. */
  constructor(root?: string, readonly name = "scratch") {
    this.root = root ?? scratchDir("ep0ch-scratch-");
    for (const d of ["outlines", "config", "door"]) mkdirSync(join(this.root, d), { recursive: true, mode: 0o700 });
  }
  /** The outlines folder the host serves. */
  get outlines() { return join(this.root, "outlines"); }
  /** The outline's own folder (`<outlines>/<name>/`): the root its relative file links resolve against. */
  get workspace() { return join(this.outlines, this.name); }
  /** The environment an `ep0ch` (or outliner) command uses to reach this outline. */
  get env(): Record<string, string> { return { EP0CH_OUTLINES: this.outlines, EP0CH_WS: this.name, XDG_CONFIG_HOME: join(this.root, "config") }; }
  /** The service's process id, while it runs. */
  get pid() { return this.proc?.pid; }

  /** Starts the host (its default outline is this one, so a board that names none reads it) and makes the outline. */
  async start(): Promise<string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      EP0CH_OUTLINES: this.outlines, EP0CH_DEFAULT_WS: this.name, XDG_CONFIG_HOME: join(this.root, "config"),
      OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0",
    };
    for (const k of [...HERDR_VARS, "EP0CH_SOCKET", "EP0CH_WS"]) delete env[k];
    this.proc = Bun.spawn(["bun", "src/host-main.ts"], { cwd: outliner!, env, stdout: "ignore", stderr: "ignore" });
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
    try { await b.info(); return await seedShowcase(b, { ticketsConfig: join(this.root, "config") }); } finally { b.close(); }
  }

  /**
   * Install the outliner's status renderer (its extensions/status-summary manifest) for readers in this
   * process, the way a reader host installs it (PIE-444): a registry under this scratch's config dir, named
   * by OUTLINER_DOCUMENT_RENDERERS. Returns the registry's path, or null without the manifest.
   */
  installRenderers(): string | null {
    const source = join(outliner ?? "", "extensions/status-summary/manifest.json");
    if (!outliner || !existsSync(source)) return null;
    const dir = join(this.root, "config", "pi-herdr-outliner");
    mkdirSync(dir, { recursive: true });
    const manifest = join(dir, "status.json"), registry = join(dir, "document-renderers.json");
    copyFileSync(source, manifest);
    writeFileSync(registry, JSON.stringify({ version: 1, renderers: { status: { manifest, enabled: true } } }));
    process.env.OUTLINER_DOCUMENT_RENDERERS = registry;
    return registry;
  }

  async dispose() { await this.stop(2000); rmSync(this.root, { recursive: true, force: true }); }
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
  constructor() {
    this.root = scratchDir("ep0ch-host-");
    for (const d of ["outlines", "config", "door", "folders", "home"]) mkdirSync(join(this.root, d), { recursive: true });
  }
  get outlines() { return join(this.root, "outlines"); }
  get config() { return join(this.root, "config"); }
  get sock() { return join(this.outlines, ".host", "host.sock"); }
  /** The environment a door or `ep0ch` command uses to find this host (HOME is the scratch's, so no real .ep0ch is read above it). */
  get env(): Record<string, string> { return { EP0CH_OUTLINES: this.outlines, XDG_CONFIG_HOME: this.config, HOME: join(this.root, "home") }; }
  folder(name: string): string { const p = join(this.root, "folders", name); mkdirSync(p, { recursive: true }); return p; }

  async start(defaultOutline?: string): Promise<string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>), ...this.env,
      OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0",
    };
    for (const k of [...HERDR_VARS, "EP0CH_DEFAULT_WS", "EP0CH_SOCKET", "EP0CH_WS"]) delete env[k];
    if (defaultOutline) env.EP0CH_DEFAULT_WS = defaultOutline;
    this.proc = Bun.spawn(["bun", "src/host-main.ts"], { cwd: hostOutliner!, env, stdout: "ignore", stderr: "ignore" });
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

  async dispose() { await this.stop(); rmSync(this.root, { recursive: true, force: true }); }
}
