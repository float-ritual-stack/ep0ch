// The `cloudflare` way to a share (share-sessions.ts): one Cloudflare Quick Tunnel per open share, run by the
// publisher that has the public listener, from a random trycloudflare.com host to that listener. With `allowMail`
// the tunnel is protected (`--allowed-mail`): Cloudflare lets in only those who sign in with a one-time PIN sent to
// one of those emails; without it the tunnel is public and the share's token gates every page, as on the edge.
//
// The publisher owns each process: it starts one when the service says shares changed (or when it connects, or on
// its own clock), says its host back (`shares.tunnel`), and kills it when its share is revoked, killed with all the
// others, or expires. A tunnel that fails to come up, or dies, ends its share (the service marks it failed), so no
// token is left open with nothing behind it. Restarting the publisher kills its tunnels with it (systemd stops the
// unit's processes); a share still open then gets a new tunnel, on a new host.
import type { Subprocess } from "bun";
import type { ShareSession } from "@ep0ch/outline-core/protocol";

/** How long cloudflared has to say its host. */
const START_MS = 40_000;
/** The share list is read again at least this often, so an expiry stops its tunnel without any event. */
const SWEEP_MS = 15_000;
const TRYCLOUDFLARE = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/g;

/** Waits until `host` resolves (at most 20s), so a link isn't handed out before anyone can open it. */
async function resolvable(host: string): Promise<void> {
  if (process.env.EP0CH_TUNNEL_SKIP_DNS === "1") return;
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    try { if ((await Bun.dns.lookup(host)).length) return; } catch { /* not yet */ }
    await Bun.sleep(1000);
  }
}

export const CLOUDFLARED_MISSING = "cloudflared isn't installed here: install it (brew install cloudflared, or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), or set EP0CH_CLOUDFLARED to its path; 2026.9.3 or later for --allowed-mail";

/** cloudflared's path: EP0CH_CLOUDFLARED, else the first on PATH. */
export function cloudflaredPath(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.EP0CH_CLOUDFLARED?.trim() || Bun.which("cloudflared", { PATH: env.PATH ?? "" }) || undefined;
}

interface Running {
  proc: Subprocess;
  host?: string;
}

export interface TunnelHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /** Where the public listener is reached from this machine (`http://127.0.0.1:8791`): every tunnel points there. */
  origin: string;
  log(line: string): void;
  /** cloudflared's path now (tests give a fake). */
  binary?: () => string | undefined;
}

export class ShareTunnels {
  private readonly running = new Map<string, Running>();
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly host: TunnelHost) {}

  /** Hosts of the tunnels that are up, by share id. */
  hostOf(shareId: string): string | undefined {
    return this.running.get(shareId)?.host;
  }

  /** Whether `host` is one of this publisher's tunnels now. */
  serves(host: string): boolean {
    for (const running of this.running.values()) if (running.host === host) return true;
    return false;
  }

  /** Each running tunnel's share and process id (for tests and the log). */
  processes(): { shareId: string; pid: number; host?: string }[] {
    return [...this.running].map(([shareId, running]) => ({ shareId, pid: running.proc.pid, ...(running.host ? { host: running.host } : {}) }));
  }

  /** Reads the open shares and makes the tunnels match: one per open `cloudflare` share, none for any other. One at a time. */
  reconcile(): Promise<void> {
    this.chain = this.chain.then(() => this.match()).catch((error) => this.host.log(`publish: tunnels: ${error instanceof Error ? error.message : String(error)}`));
    return this.chain;
  }

  private async match(): Promise<void> {
    if (this.stopped) return;
    const { shares } = await this.host.request<{ shares: ShareSession[] }>({ action: "shares.list" });
    const now = Date.now();
    const wanted = new Map(shares.filter((share) => share.via === "cloudflare" && share.state === "active" && Date.parse(share.expiresAt) > now).map((share) => [share.id, share]));
    for (const id of [...this.running.keys()]) if (!wanted.has(id)) this.kill(id);
    for (const share of wanted.values()) if (!this.running.has(share.id) && share.tunnel?.state !== "failed") this.open(share);
    // The next expiry stops its tunnel on time; a sweep catches anything else.
    if (this.timer) clearTimeout(this.timer);
    const next = Math.min(SWEEP_MS, ...[...wanted.values()].map((share) => Date.parse(share.expiresAt) - now + 250));
    this.timer = setTimeout(() => { void this.reconcile(); }, Math.max(250, next));
  }

  private open(share: ShareSession): void {
    const binary = (this.host.binary ?? cloudflaredPath)();
    if (!binary) { void this.report(share.id, { error: CLOUDFLARED_MISSING }); return; }
    const args = ["tunnel", "--no-autoupdate", "--url", this.host.origin, ...(share.allowMail?.length ? ["--allowed-mail", share.allowMail.join(",")] : [])];
    let proc: Subprocess;
    try {
      proc = Bun.spawn([binary, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch (error) {
      void this.report(share.id, { error: `cloudflared didn't start (${binary}): ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const running: Running = { proc };
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
          // A new trycloudflare.com name takes a few seconds to resolve: the link is given once it does (or after 20s).
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
      this.running.delete(share.id);
      if (!this.stopped) void this.report(share.id, { error: `cloudflared exited (${code}) ${running.host ? "after" : "before"} its tunnel was up` });
    });
  }

  private kill(shareId: string): void {
    const running = this.running.get(shareId);
    if (!running) return;
    this.running.delete(shareId);
    running.proc.kill();
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

  /** Kills every tunnel (the publisher stops). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const procs = [...this.running.values()].map((running) => running.proc);
    for (const id of [...this.running.keys()]) this.kill(id);
    await Promise.all(procs.map((proc) => proc.exited));
  }
}
