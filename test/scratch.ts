// A throwaway outliner service for tests: its own state, workspace and config dirs, background agents
// off, Herdr unset. Never a real outline. `restart()` stops it and starts it again on the same state,
// the way a deploy would. `seedShowcase()` writes the showcase outline (src/showcase/seed.ts) into it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";

export const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../pi-herdr-outliner")]
  .find(p => p && existsSync(join(p, "src/server-main.ts")));

export const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};

export class Scratch {
  readonly root: string;
  sock = "";
  private proc: Subprocess | null = null;
  /** `root`: serve that directory's ws/state/config (the layout scripts/try-it.sh --showcase uses) instead of a new temp dir. */
  constructor(root?: string) {
    this.root = root ?? mkdtempSync(join(tmpdir(), "ep0ch-scratch-"));
    for (const d of ["ws", "state", "config", "door"]) mkdirSync(join(this.root, d), { recursive: true });
  }
  get workspace() { return join(this.root, "ws"); }
  /** The service's process id, while it runs. */
  get pid() { return this.proc?.pid; }

  async start(): Promise<string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      OUTLINER_STATE_DIR: join(this.root, "state"), OUTLINER_WORKSPACE_ROOT: this.workspace, XDG_CONFIG_HOME: join(this.root, "config"),
      OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0",
    };
    for (const k of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID"]) delete env[k];
    this.proc = Bun.spawn(["bun", "src/server-main.ts"], { cwd: outliner!, env, stdout: "ignore", stderr: "ignore" });
    const ping = async (path: string) => {
      const { SocketBoard } = await import("../src/socket");
      const b = new SocketBoard(path, 1000);
      try { await b.info(); return true; } catch { return false; } finally { b.close(); }
    };
    const end = Date.now() + 20_000;
    for (;;) {
      const dirs = existsSync(join(this.root, "state")) ? readdirSync(join(this.root, "state")) : [];
      const path = dirs.map(d => join(this.root, "state", d, "outliner.sock")).find(existsSync);
      if (path && await ping(path)) return (this.sock = path);
      if (Date.now() > end) throw new Error("the scratch service didn't start");
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
    try { await b.info(); return await seedShowcase(b); } finally { b.close(); }
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
