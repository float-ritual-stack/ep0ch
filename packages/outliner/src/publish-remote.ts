// Another machine's outline in the web client: `<webRoot>/o/<name>@<machine>/` (`/pub/o/float-hub@laptop/`), for each
// outline `EP0CH_MCP_MIRRORS` names (the one list, read by the MCP gateway too). Its pages are a Publisher like any
// other outline's (the same pages, routes, marks, comments, @margin, quotes and read marks), over one of two
// connections:
//
// - live: the machine's own host through the shared ssh forward (`<outlines>/.remote/<machine>.sock`, machine-forward.ts
//   `forwardFor`, the one every client of that machine uses), started on demand and reused. Pages say
//   `float-hub · laptop · live`. Writes follow the outline's own `mcp access` there: `propose` and `full` take them,
//   `read` and `none` show its pages with no write controls (the one rule the MCP gateway keeps too).
// - its copy: when the machine doesn't answer within a few seconds (asleep, off the network), the read-only mirror on
//   this machine (outline-mirror.ts, the gateway's copies), said as `… · as of <time> (laptop asleep)`, with no write
//   controls.
//
// Light on the other machine: nothing is asked of it until a page is opened; while one is, its own long poll and a
// liveness check at most every CHECK_MS (outlines.list, one line) are all; a machine that didn't answer is tried again
// at most every RETRY_MS. The forward is never ended here (other clients share it).
import { OutlinerClient } from "./client";
import { hostAnswers } from "./machine-forward";
import { OutlineMirror } from "./outline-mirror";
import type { Publisher } from "./publish";
import { SCHEMA_VERSION } from "./schema";
import type { McpAccessStatus } from "@ep0ch/outline-core/protocol";

/** How long a page waits for the machine before it is read from its copy. */
const FAST_MS = 4_000;
/** A machine that didn't answer is asked again at most this often (a page meanwhile reads its copy). */
const RETRY_MS = 30_000;
/** A live connection is checked at most this often, when a page is asked for; a check waits this long. */
const CHECK_MS = 10_000;
const CHECK_WAIT_MS = 3_000;
/** A request through the forward gives up after this: a machine that fell asleep mid-page doesn't hold the page long. */
const LIVE_REQUEST_MS = 10_000;
/** The outline's MCP access is asked again after this. */
const ACCESS_MS = 30_000;

/** Where the outline was last read from: its machine, its copy here, or not yet asked. */
export type RemoteState = "live" | "copy" | "unknown";

/** What its pages are given: what heads them, why they take no writes, and whether presence can be kept. */
export interface RemotePageOptions { provenance: () => string; writes: (fresh: boolean) => Promise<string | null>; presence: boolean }

export interface RemoteOutlineOptions {
  outline: string;
  machine: string;
  /** The machine's forward, answering (`forwardFor(...).socket`); throws with why when it can't be. */
  forward: () => Promise<string>;
  /** The mirrors folder (`EP0CH_MCP_MIRROR_DIR`, else ~/outline-mirrors): the copy read while the machine is away. */
  mirrors: string;
  /** A publisher over `client`, mounted at this outline's base path. */
  publisher: (client: OutlinerClient, page: RemotePageOptions) => Publisher;
  log?: (line: string) => void;
  now?: () => number;
  fastMs?: number;
  retryMs?: number;
}

/** A copy's generation as the web client reads it: its host's socket. */
interface CopySocket { socket: string }

export class RemoteOutline {
  readonly outline: string;
  readonly machine: string;
  private live: { publisher: Publisher; socket: string; checkedAt: number } | null = null;
  private going: { since: number; started: Promise<Publisher> } | null = null;
  private failed: { at: number; why: string } | null = null;
  private readonly mirror: OutlineMirror<CopySocket>;
  private copy: { socket: string; publisher: Promise<Publisher>; asOf: string } | null = null;
  private access: { at: number; level: McpAccessStatus["level"] } | null = null;
  private stopped = false;
  private readonly log: (line: string) => void;
  private readonly now: () => number;

  constructor(private readonly options: RemoteOutlineOptions) {
    this.outline = options.outline;
    this.machine = options.machine;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? Date.now;
    this.mirror = new OutlineMirror<CopySocket>(this.outline, this.machine, options.mirrors, {
      label: "web mirror", log: this.log, now: this.now, schema: () => SCHEMA_VERSION,
      attach: async (socket, outline) => {
        const client = new OutlinerClient(socket, 90_000, outline);
        const index = await client.request<{ blocks: { updatedAt?: number }[] }>({ action: "tree.index" });
        let newest = 0;
        for (const block of index.blocks) if (Number.isFinite(block.updatedAt) && block.updatedAt! > newest) newest = block.updatedAt!;
        return { board: { socket }, newest, close: () => {} };
      },
    });
  }

  /** Where its pages are read from now: the machine while it answers, else the copy, else not asked yet. */
  get state(): RemoteState {
    return this.live ? "live" : this.copy ? "copy" : "unknown";
  }

  /** `name@machine`, as the outlines list and its address say it. */
  get address(): string {
    return `${this.outline}@${this.machine}`;
  }

  /**
   * The publisher a page is served by now: the machine's own host when it answers within a few seconds, else its copy
   * here; or why neither can be read.
   */
  async publisher(): Promise<Publisher | { error: string }> {
    if (this.stopped) return { error: "the web client is stopping" };
    const live = this.live;
    if (live && await this.stillLive(live)) return live.publisher;
    const retryMs = this.options.retryMs ?? RETRY_MS;
    if (!this.failed || this.now() - this.failed.at >= retryMs) {
      // A start that has hung past the retry window is left to itself (what it makes when it lands is used or stopped)
      // and a new one tried: a machine that woke meanwhile answers that.
      if (this.going && this.now() - this.going.since >= retryMs) this.going = null;
      if (!this.going) {
        const going = { since: this.now(), started: this.goLive() };
        void going.started.catch(() => {}).finally(() => { if (this.going === going) this.going = null; });
        this.going = going;
      }
      const won = await Promise.race([this.going.started.catch(() => null), Bun.sleep(this.options.fastMs ?? FAST_MS).then(() => null)]);
      if (won) return won;
      // No answer in time: the copy, and the machine isn't waited on again before the retry window (the start goes on).
      if (!this.live) this.failed = { at: this.now(), why: this.failed?.why ?? `no answer within ${(this.options.fastMs ?? FAST_MS) / 1000} s` };
    }
    return this.fromCopy();
  }

  /** Whether the live connection still answers: its feed connected, and the host answering when it hasn't been asked lately. */
  private async stillLive(live: NonNullable<RemoteOutline["live"]>): Promise<boolean> {
    let ok = live.publisher.isConnected;
    if (ok && this.now() - live.checkedAt >= CHECK_MS) {
      ok = await hostAnswers(live.socket, CHECK_WAIT_MS);
      if (ok) live.checkedAt = this.now();
    }
    if (ok) return true;
    // Gone (asleep, off the network): its pages are read from the copy until it answers again.
    if (this.live === live) this.live = null;
    this.failed = { at: this.now(), why: "it stopped answering" };
    this.log(`publish: ${this.address}: ${this.machine} stopped answering; reading its copy`);
    void live.publisher.stop();
    return false;
  }

  private async goLive(): Promise<Publisher> {
    try {
      const socket = await this.options.forward();
      const client = new OutlinerClient(socket, LIVE_REQUEST_MS, this.outline);
      const publisher = this.options.publisher(client, {
        provenance: () => `${this.outline} · ${this.machine} · live`,
        writes: fresh => this.liveWrites(client, fresh),
        presence: true,
      });
      await publisher.start();
      if (this.stopped) { await publisher.stop(); throw new Error("the web client is stopping"); }
      // An earlier start that hung and landed late may have made one already: that one stays.
      if (this.live) { await publisher.stop(); return this.live.publisher; }
      this.live = { publisher, socket, checkedAt: this.now() };
      this.failed = null;
      return publisher;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.failed = { at: this.now(), why };
      this.log(`publish: ${this.address}: not live: ${why}`);
      throw error;
    }
  }

  /**
   * The outline's MCP access on its machine: `propose` and `full` take a page's writes, `read` and `none` don't. Asked
   * afresh before a write (`fresh`), so a revoke holds at once; what a page shows may be ACCESS_MS old.
   */
  private async liveWrites(client: OutlinerClient, fresh: boolean): Promise<string | null> {
    if (fresh || !this.access || this.now() - this.access.at >= ACCESS_MS) {
      try {
        // The owner's setting, not yolo's (PIE-973): a page's writes are a reader's, which the agent gate never lifted.
        const status = await client.request<McpAccessStatus>({ action: "mcp.access.status" });
        this.access = { at: this.now(), level: status.configured ?? status.level };
      } catch (error) {
        return `${this.machine} didn't say what ${this.outline} takes (${error instanceof Error ? error.message : String(error)})`;
      }
    }
    const level = this.access.level;
    return level === "propose" || level === "full" ? null
      : `${this.outline} is at MCP access ${level} on ${this.machine}, so pages here only read it. On ${this.machine}: ep0ch mcp access full --ws ${this.outline}`;
  }

  /** The copy's publisher, whether or not the machine answers: a snapshot link minted from the copy is its (PIE-1091). */
  copyPublisher(): Promise<Publisher | { error: string }> {
    return this.stopped ? Promise.resolve({ error: "the web client is stopping" }) : this.fromCopy();
  }

  /** The read-only copy here, its publisher started for the generation now served (a newer copy gets a new one). */
  private async fromCopy(): Promise<Publisher | { error: string }> {
    const away = this.failed?.why ?? "it didn't answer";
    const read = await this.mirror.read();
    if ("error" in read) {
      return { error: `${this.machine} doesn't answer (${away}), and its copy here ${read.error}` };
    }
    if (this.copy?.socket !== read.board.socket) {
      const before = this.copy;
      const asOf = read.asOf;
      const publisher = this.options.publisher(new OutlinerClient(read.board.socket, 30_000, this.outline), {
        provenance: () => `${this.outline} · ${this.machine} · as of ${asOf.slice(0, 16).replace("T", " ")} UTC (${this.machine} asleep)`,
        writes: async () => `${this.machine} is asleep: this is its copy as of ${asOf.slice(0, 16).replace("T", " ")} UTC, read-only. Comments and marks are taken again when ${this.machine} answers.`,
        // Kept beside the mirror (outline-mirror.ts), where the gateway's reader_view reads it.
        presence: true,
      });
      const started = publisher.start().then(() => publisher);
      started.catch(() => { if (this.copy?.publisher === started) this.copy = null; void publisher.stop(); });
      this.copy = { socket: read.board.socket, publisher: started, asOf };
      if (before) void before.publisher.then(p => p.stop(), () => {});
    }
    try {
      return await this.copy.publisher;
    } catch (error) {
      return { error: `${this.machine} doesn't answer (${away}), and its copy here can't be served: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // A start still under way stops what it made when it lands; it isn't waited on (a machine may never answer).
    await Promise.race([this.going?.started.catch(() => {}), Bun.sleep(1_000)]);
    const live = this.live, copy = this.copy;
    this.live = null;
    this.copy = null;
    await live?.publisher.stop();
    await copy?.publisher.then(p => p.stop(), () => {});
    await this.mirror.close();
  }
}
