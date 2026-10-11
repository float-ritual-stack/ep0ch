// The `cloudflare` way to a share (share-sessions.ts): one Cloudflare Quick Tunnel per open share, run by the
// publisher, on a random trycloudflare.com host. With `allowMail` the tunnel is protected (`--allowed-mail`):
// Cloudflare lets in only those who sign in with a one-time PIN sent to one of those emails; without it the tunnel is
// public and the share's token gates every page, as on the edge.
//
// Each tunnel has an ingress of its own: a listener on 127.0.0.1 (a free port) that answers that one share and
// nothing else, and cloudflared points there. A `cloudflare` share is never answered on the public listener, so its
// email gate can't be walked around by sending its link there with the tunnel's Host (a header proves nothing).
//
// The publisher owns each process: it starts one when the service says shares changed (or when it connects, or on its
// own clock), says its host back (`shares.tunnel`) once the name resolves, and kills it when its share is revoked,
// killed with all the others, or expires (by the service's list, and by its own clock should the service not answer).
// A tunnel that fails to come up, or dies, ends its share (the service marks it failed), so no token is left open with
// nothing behind it. Restarting the publisher kills its tunnels with it; a share still open gets a new tunnel, on a new
// host.
import type { Subprocess } from "bun";
import type { ShareSession } from "@ep0ch/outline-core/protocol";

/** How long cloudflared has to say its host. */
const START_MS = 40_000;
/** The share list is read again at least this often, and again this soon after a read that failed. */
const SWEEP_MS = 15_000;
/** A cloudflared that ignores the first signal gets SIGKILL after this. */
const KILL_GRACE_MS = 5_000;
const TRYCLOUDFLARE = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/g;

export const CLOUDFLARED_MISSING = "cloudflared isn't installed here: install it (brew install cloudflared, or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), or set EP0CH_CLOUDFLARED to its path; 2026.9.3 or later for --allowed-mail";

/** cloudflared's path: EP0CH_CLOUDFLARED, else the first on PATH. */
export function cloudflaredPath(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.EP0CH_CLOUDFLARED?.trim() || Bun.which("cloudflared", { PATH: env.PATH ?? "" }) || undefined;
}

/** Waits until `host` resolves (at most 15s), so a link isn't handed out before anyone can open it. */
async function resolvable(host: string): Promise<void> {
  if (process.env.EP0CH_TUNNEL_SKIP_DNS === "1") return;
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try { if ((await Bun.dns.lookup(host)).length) return; } catch { /* not yet */ }
    await Bun.sleep(1000);
  }
}

/** A tunnel's own ingress: a loopback listener answering one share. */
export interface TunnelIngress {
  port: number;
  stop(): void;
}

interface Running {
  proc: Subprocess;
  ingress: TunnelIngress;
  expiresAt: number;
  host?: string;
  /** Its own clock: killed at its expiry even if the service never says so. */
  expiry: ReturnType<typeof setTimeout>;
}

export interface TunnelHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /** Opens a share's own ingress (the publisher answering that share alone) on 127.0.0.1. */
  ingress(shareId: string): TunnelIngress;
  log(line: string): void;
  /** cloudflared's path now (tests give a fake). */
  binary?: () => string | undefined;
  /** How often the list is read again (tests shorten it). */
  sweepMs?: number;
}

export class ShareTunnels {
  private readonly running = new Map<string, Running>();
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly host: TunnelHost) {}

  /** Each running tunnel's share, process id, ingress port and host (for the log and tests). */
  processes(): { shareId: string; pid: number; port: number; host?: string }[] {
    return [...this.running].map(([shareId, running]) => ({ shareId, pid: running.proc.pid, port: running.ingress.port, ...(running.host ? { host: running.host } : {}) }));
  }

  /** Reads the open shares and makes the tunnels match: one per open `cloudflare` share, none for any other. One at a time. */
  reconcile(): Promise<void> {
    this.chain = this.chain.then(() => this.match()).catch((error) => {
      this.host.log(`publish: tunnels: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => this.schedule());
    return this.chain;
  }

  /** The next read: at the soonest expiry, else after the sweep (a failed read is tried again then too). */
  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    const next = Math.min(this.host.sweepMs ?? SWEEP_MS, ...[...this.running.values()].map((running) => running.expiresAt - now + 250));
    this.timer = setTimeout(() => { void this.reconcile(); }, Math.max(100, next));
  }

  private async match(): Promise<void> {
    if (this.stopped) return;
    const { shares } = await this.host.request<{ shares: ShareSession[] }>({ action: "shares.list" });
    // Stopped while the list was on its way: nothing new is started.
    if (this.stopped) return;
    const now = Date.now();
    const wanted = new Map(shares.filter((share) => share.via === "cloudflare" && share.state === "active" && Date.parse(share.expiresAt) > now).map((share) => [share.id, share]));
    for (const id of [...this.running.keys()]) if (!wanted.has(id)) this.kill(id);
    for (const share of wanted.values()) if (!this.running.has(share.id) && share.tunnel?.state !== "failed") this.open(share);
  }

  private open(share: ShareSession): void {
    const binary = (this.host.binary ?? cloudflaredPath)();
    if (!binary) { void this.report(share.id, { error: CLOUDFLARED_MISSING }); return; }
    const ingress = this.host.ingress(share.id);
    const args = ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${ingress.port}`, ...(share.allowMail?.length ? ["--allowed-mail", share.allowMail.join(",")] : [])];
    let proc: Subprocess;
    try {
      proc = Bun.spawn([binary, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch (error) {
      ingress.stop();
      void this.report(share.id, { error: `cloudflared didn't start (${binary}): ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const expiresAt = Date.parse(share.expiresAt);
    const running: Running = { proc, ingress, expiresAt, expiry: setTimeout(() => this.kill(share.id), Math.max(0, expiresAt - Date.now())) };
    this.running.set(share.id, running);
    this.host.log(`publish: tunnel for share ${share.id}: cloudflared pid ${proc.pid}${share.allowMail?.length ? `, allowed ${share.allowMail.length} email(s)` : ", public"}`);
    const deadline = setTimeout(() => {
      if (running.host || this.running.get(share.id) !== running) return;
      this.kill(share.id);
      void this.report(share.id, { error: `cloudflared said no trycloudflare.com host within ${START_MS / 1000}s` });
    }, START_MS);
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      let tail = "";
      for await (const chunk of stream) {
        if (running.host) continue; // drained, so cloudflared never blocks on a full pipe
        tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
        // Its own API's host comes first in what it says; the tunnel's is the other one.
        const found = [...tail.matchAll(TRYCLOUDFLARE)].map((match) => match[1]!).find((candidate) => candidate !== "api.trycloudflare.com");
        if (found && this.running.get(share.id) === running) {
          running.host = found;
          clearTimeout(deadline);
          // A new trycloudflare.com name takes a few seconds to resolve: the link is given once it does (or after 15s).
          void resolvable(found).then(() => { if (this.running.get(share.id) === running) void this.report(share.id, { host: found, pid: proc.pid }); });
        }
      }
    };
    void read(proc.stdout as ReadableStream<Uint8Array>).catch(() => {});
    void read(proc.stderr as ReadableStream<Uint8Array>).catch(() => {});
    void proc.exited.then((code) => {
      clearTimeout(deadline);
      // Killed by us: already gone from the map. Died on its own: its share ends, said why.
      if (this.running.get(share.id) !== running) return;
      this.forget(share.id, running);
      if (!this.stopped) void this.report(share.id, { error: `cloudflared exited (${code}) ${running.host ? "after" : "before"} its tunnel was up` });
    });
  }

  private forget(shareId: string, running: Running): void {
    this.running.delete(shareId);
    clearTimeout(running.expiry);
    running.ingress.stop();
  }

  private kill(shareId: string): void {
    const running = this.running.get(shareId);
    if (!running) return;
    this.forget(shareId, running);
    running.proc.kill();
    const hard = setTimeout(() => { if (running.proc.exitCode === null && running.proc.signalCode === null) running.proc.kill("SIGKILL"); }, KILL_GRACE_MS);
    void running.proc.exited.then(() => clearTimeout(hard));
    this.host.log(`publish: tunnel for share ${shareId} stopped (cloudflared pid ${running.proc.pid})`);
  }

  private async report(shareId: string, said: { host?: string; pid?: number; error?: string }): Promise<void> {
    if (said.error) this.host.log(`publish: tunnel for share ${shareId}: ${said.error}`);
    try {
      await this.host.request({ action: "shares.tunnel", shareId, ...said });
    } catch (error) {
      this.host.log(`publish: shares.tunnel: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Kills every tunnel (the publisher stops), after any read in flight, so nothing it starts outlives this. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.chain;
    const procs = [...this.running.values()].map((running) => running.proc);
    for (const id of [...this.running.keys()]) this.kill(id);
    await Promise.all(procs.map((proc) => proc.exited));
  }
}
