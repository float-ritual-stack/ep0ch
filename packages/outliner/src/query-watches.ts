// Watched questions (ADR 0004 contract 1): a client asks a read once with `watch: <key>`, and the service tells that
// connection when its answer changed, instead of every client dropping its answers on any change and asking again.
//
// - The answer that registers a watch is generation 0. After changes, every watch is evaluated again at most every
//   250 ms (the burst settles) and at least once a second under steady writes; a watch whose answer's hash changed gets
//   the next generation, and its connection one `queries.changed` event naming them.
// - The newest answer is kept: asked again with a generation (or none), the watch is answered from it, never evaluated
//   again. A different question under the same key replaces the watch.
// - Bounds: 64 watches per connection and 512 per service; past them the oldest goes, announced `dropped: true`. A
//   connection's watches end with it.
//
// It doesn't know what it watches: the server passes how to answer a request (its own `handle`), so `blocks.query`,
// `views.read`, `blocks.authored-links`, `references.backlinks` and `query.matches` are watched alike (outline-core WATCHABLE_ACTIONS).
import { QUERIES_CHANGED, WATCHABLE_ACTIONS, WATCH_LIMITS, type OutlinerResponse, type QueryChange } from "@ep0ch/outline-core/protocol";

/** Where a watch's changes go: the connection that asked (a socket). */
export interface WatchConnection {
  write(line: string): unknown;
  readonly destroyed?: boolean;
}

type Request = { id: string; action: string; watch?: unknown; generation?: unknown; outline?: unknown } & Record<string, unknown>;

interface Watch {
  connection: WatchConnection;
  key: string;
  /** The request as asked, without its id, watch and generation. */
  request: Record<string, unknown>;
  /** What identifies the question: a different one under the same key replaces the watch. */
  signature: string;
  generation: number;
  hash: string;
  response: OutlinerResponse;
}

export const isWatchable = (action: string): boolean => (WATCHABLE_ACTIONS as readonly string[]).includes(action);

/** An answer's identity: everything in it but the service's sequence, which moves on every write. */
function hashOf(response: OutlinerResponse): string {
  const body = response.ok
    ? (response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? { ...(response.result as Record<string, unknown>), sequence: undefined }
      : response.result)
    : { error: response.error };
  return Bun.hash(stable(body)).toString(36);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface QueryWatchOptions {
  /** Answer a request now, as the service would (its `handle`). */
  answer(request: Request): OutlinerResponse;
  /** The service's sequence, stamped on the event. */
  sequence(): number;
  settleMs?: number;
  maxWaitMs?: number;
  perConnection?: number;
  perService?: number;
  /** Told how long an evaluation pass took and how many watches it read (the host's timing). */
  timed?(ms: number, watches: number): void;
}

export class QueryWatches {
  /** Every watch, oldest first (a Map keeps insertion order). */
  private readonly all = new Map<string, Watch>();
  private readonly connections = new Map<WatchConnection, number>();
  private nextConnection = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingSince = 0;
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  private readonly perConnection: number;
  private readonly perService: number;

  constructor(private readonly options: QueryWatchOptions) {
    this.settleMs = options.settleMs ?? WATCH_LIMITS.settleMs;
    this.maxWaitMs = options.maxWaitMs ?? WATCH_LIMITS.maxWaitMs;
    this.perConnection = options.perConnection ?? WATCH_LIMITS.perConnection;
    this.perService = options.perService ?? WATCH_LIMITS.perService;
  }

  get size(): number { return this.all.size; }

  private id(connection: WatchConnection): number {
    let id = this.connections.get(connection);
    if (id === undefined) this.connections.set(connection, id = this.nextConnection++);
    return id;
  }

  /**
   * Answer `request` (a watchable read with `watch`) for `connection`: from the kept answer when the same question is
   * already watched under that key, else evaluated and registered as generation 0. A refused question isn't kept.
   */
  ask(connection: WatchConnection, request: Request): OutlinerResponse {
    const key = request.watch;
    if (typeof key !== "string" || !key || key.length > 200) {
      return { id: request.id, ok: false, error: "watch is a key of 1 to 200 characters the client chooses, like \"links:3f2a\"", sequence: this.options.sequence() };
    }
    if (request.generation !== undefined && (!Number.isSafeInteger(request.generation) || (request.generation as number) < 0)) {
      return { id: request.id, ok: false, error: "generation is the number a queries.changed event gave for this watch", sequence: this.options.sequence() };
    }
    const { id: _id, watch: _watch, generation: _generation, ...question } = request;
    const signature = stable(question);
    const slot = `${this.id(connection)}\0${key}`;
    const held = this.all.get(slot);
    if (held && held.signature === signature) return this.reply(request.id, held);
    const response = this.options.answer({ ...question, id: request.id } as Request);
    if (!response.ok) return response;
    if (held) this.all.delete(slot);
    const watch: Watch = { connection, key, request: question, signature, generation: 0, hash: hashOf(response), response };
    this.all.set(slot, watch);
    this.bound(connection);
    return this.reply(request.id, watch);
  }

  private reply(id: string, watch: Watch): OutlinerResponse {
    const response = watch.response;
    if (!response.ok) return { ...response, id };
    const result = response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? { ...(response.result as Record<string, unknown>), generation: watch.generation }
      : response.result;
    return { ...response, id, result };
  }

  /** Past the bounds, the oldest watches go: the connection's own first, then the service's. Each is told. */
  private bound(connection: WatchConnection): void {
    const dropped = new Map<WatchConnection, QueryChange[]>();
    const drop = (slot: string, watch: Watch) => {
      this.all.delete(slot);
      const list = dropped.get(watch.connection) ?? [];
      list.push({ key: watch.key, generation: watch.generation, dropped: true });
      dropped.set(watch.connection, list);
    };
    const own = [...this.all].filter(([, watch]) => watch.connection === connection);
    for (const [slot, watch] of own.slice(0, Math.max(0, own.length - this.perConnection))) drop(slot, watch);
    while (this.all.size > this.perService) {
      const [slot, watch] = this.all.entries().next().value!;
      drop(slot, watch);
    }
    for (const [to, changes] of dropped) this.send(to, changes);
  }

  /** The outline changed: evaluate every watch once the burst settles, and at least once a second while it doesn't. */
  changed(): void {
    if (this.all.size === 0) return;
    const now = Date.now();
    if (!this.timer) this.pendingSince = now;
    else clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.settleMs, this.pendingSince + this.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  /** Evaluate every watch now; tell each connection which of its answers changed. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const started = performance.now();
    const changes = new Map<WatchConnection, QueryChange[]>();
    for (const watch of this.all.values()) {
      if (watch.connection.destroyed) continue;
      const response = this.options.answer({ ...watch.request, id: "watch" } as Request);
      const hash = hashOf(response);
      if (hash === watch.hash) continue;
      watch.generation += 1;
      watch.hash = hash;
      watch.response = response;
      const list = changes.get(watch.connection) ?? [];
      list.push({ key: watch.key, generation: watch.generation });
      changes.set(watch.connection, list);
    }
    for (const [connection, list] of changes) this.send(connection, list);
    this.options.timed?.(performance.now() - started, this.all.size);
  }

  private send(connection: WatchConnection, changes: QueryChange[]): void {
    if (connection.destroyed || !changes.length) return;
    const event = { id: crypto.randomUUID(), domain: "queries", action: QUERIES_CHANGED, sequence: this.options.sequence(), changes };
    try { connection.write(`${JSON.stringify({ event })}\n`); } catch { /* a closing connection: its watches end with it */ }
  }

  /** A connection closed: its watches end with it. */
  closed(connection: WatchConnection): void {
    const id = this.connections.get(connection);
    if (id === undefined) return;
    this.connections.delete(connection);
    for (const [slot, watch] of this.all) if (watch.connection === connection) this.all.delete(slot);
  }

  /** The service is stopping. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.all.clear();
    this.connections.clear();
  }
}
