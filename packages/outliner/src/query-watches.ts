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
// - A watched answer may name the notes it was computed from (`deps` in its result: `site.answer`'s). It is evaluated
//   again only when a change touched one of them (the changed note, or its parent before or after); an answer that says
//   `anyChange` (something it looked for isn't there yet) and one with no `deps` are evaluated after every change.
// - Machinery (PIE-1546): a question that leaves out what tools stamp `[machine::…]` (every reader's default) isn't
//   evaluated again for a change to a stamped note, unless its answer lists that note or the note's parent, or its
//   question names it (the service says which, `machineryBlind`). Write-review records and health samples came about
//   once a second and each one evaluated every watch; the door's reads queued behind those passes for seconds.
// - An answer that changes by the clock alone within the day (`clock: "minute"`, a `now.time`) is evaluated again each minute.
// - A question can name the day (`wait-until <= today`, `due <= +3d`, PIE-769): when the machine's day turns, every
//   watch is evaluated again with no change at all, so a view of what's waiting until today fills at midnight.
//
// - The same question asked by several connections at one sequence (doors reconnecting after a restart) is answered once.
// - Fair to everyone else (PIE-1413): with `turn`, a pass is evaluated a watch at a time, each waiting its turn on the
//   loop like a client's request, so a pass over hundreds of watches never holds the loop (a backfill's 441 ms passes
//   once a second did). One pass runs at a time; what changes meanwhile is evaluated by the next. A question watched
//   on several connections (two doors on one page) is answered once a pass. Its changes are told at the pass's end, or
//   every TELL_EVERY_MS while a long one goes on.
//
// It doesn't know what it watches: the server passes how to answer a request (its own `handle`), so `blocks.query`,
// `views.read`, `blocks.authored-links`, `references.backlinks` and `query.matches` are watched alike (their `watch` row in actions.ts).
import { refusalEnvelope } from "./request-envelope";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { QUERIES_CHANGED, WATCH_LIMITS, type OutlinerResponse, type QueryChange } from "@ep0ch/outline-core/protocol";
import { stableJson } from "@ep0ch/outline-core/stable-json";

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
  /** The notes the answer was computed from; absent: any change may change it. */
  deps?: ReadonlySet<string>;
  /** The answer changes by the clock alone, each minute (`now.time`). */
  minute?: true;
  /** The question leaves machinery out: a stamped note's change reaches it only through these notes. */
  blind?: ReadonlySet<string>;
}

const isMinute = (response: OutlinerResponse): boolean =>
  response.ok && !!response.result && typeof response.result === "object" && (response.result as { clock?: unknown }).clock === "minute";

/** The notes a watched answer says it depends on, or undefined when any change may change it. */
function depsOf(response: OutlinerResponse): ReadonlySet<string> | undefined {
  if (!response.ok || !response.result || typeof response.result !== "object") return undefined;
  const result = response.result as { deps?: unknown; anyChange?: unknown };
  if (result.anyChange === true || !Array.isArray(result.deps) || result.deps.some(id => typeof id !== "string")) return undefined;
  return new Set(result.deps as string[]);
}

/** The notes a committed change touched: the changed note, and its parent before and after. */
export interface ChangedNotes {
  blockId?: string; parentId?: string | null; previousParentId?: string | null;
  /** The changed note carries `[machine::…]` after the change: a question that leaves machinery out can't see it. */
  machinery?: boolean;
}

/** In a pass taking longer than this, what changed so far is told without waiting for the rest. */
const TELL_EVERY_MS = 100;
/** How long an answer serves the same question asked by another connection, while the outline hasn't changed. */
const MEMO_MS = 2_000;


/** An answer's identity: everything in it but the service's sequence, which moves on every write. */
function hashOf(response: OutlinerResponse): string {
  const body = response.ok
    ? (response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? { ...(response.result as Record<string, unknown>), sequence: undefined }
      : response.result)
    : { error: response.error };
  return Bun.hash(stableJson(body)).toString(36);
}

export interface QueryWatchOptions {
  /** Answer a request now, as the service would (its `handle`). */
  answer(request: Request): OutlinerResponse;
  /** The service's sequence, stamped on the event. */
  sequence(): number;
  settleMs?: number;
  /** How often a minute-clock answer is evaluated again (tests); the default is each minute's turn. */
  minuteMs?: number;
  maxWaitMs?: number;
  perConnection?: number;
  perService?: number;
  /** Told how long evaluating took on the loop and how many watches it read (the host's timing). */
  timed?(ms: number, watches: number): void;
  /** Wait for a turn on the loop before evaluating a watch (the host's Turns); without it a pass runs at once. */
  turn?(action: string): Promise<void>;
  /**
   * When a question leaves machinery out, the notes its answer could still change through: the ones it lists and the
   * ones it names. Undefined when a stamped note may be in it (or its count of what it left out is).
   */
  machineryBlind?(request: Request, response: OutlinerResponse): ReadonlySet<string> | undefined;
}

export class QueryWatches {
  /** Every watch, oldest first (a Map keeps insertion order). */
  private readonly all = new Map<string, Watch>();
  private readonly connections = new Map<WatchConnection, number>();
  private nextConnection = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dayTimer: ReturnType<typeof setTimeout> | null = null;
  private minuteTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSince = 0;
  /** What changed since the last evaluation: every note named, or everything (a change that names no note). */
  private pendingIds = new Set<string>();
  /** Whether a change since then touched a note that isn't machinery (or named none): blind questions see it too. */
  private pendingPlain = false;
  private pendingAll = false;
  /** A pass is being evaluated in turns (or waits for one): a flush now leaves its changes to the next. */
  private passing = false;
  private passes = 0;
  private chain: Promise<void> = Promise.resolve();
  /** What was answered at one sequence, a moment ago, for the next connection asking the same (`asked`). */
  private memo?: { sequence: number; at: number; answers: Map<string, OutlinerResponse> };
  private readonly settleMs: number;
  private readonly minuteMs: number;
  private readonly maxWaitMs: number;
  private readonly perConnection: number;
  private readonly perService: number;

  constructor(private readonly options: QueryWatchOptions) {
    this.settleMs = options.settleMs ?? WATCH_LIMITS.settleMs;
    this.minuteMs = options.minuteMs ?? 60_000;
    this.maxWaitMs = options.maxWaitMs ?? WATCH_LIMITS.maxWaitMs;
    this.perConnection = options.perConnection ?? WATCH_LIMITS.perConnection;
    this.perService = options.perService ?? WATCH_LIMITS.perService;
    this.awaitDayTurn();
  }

  /** At the next midnight on this machine's clock (a second past), evaluate every watch: today has moved. */
  private awaitDayTurn(): void {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime();
    this.dayTimer = setTimeout(() => { if (this.all.size) { this.pendingAll = true; this.flush(); } this.awaitDayTurn(); }, midnight - now.getTime());
    (this.dayTimer as { unref?: () => void }).unref?.();
  }

  /** While a watched answer changes by the minute, evaluate those at each minute's turn. */
  private armMinute(): void {
    if (this.minuteTimer || ![...this.all.values()].some(w => w.minute)) return;
    const now = Date.now();
    this.minuteTimer = setTimeout(() => {
      this.minuteTimer = null;
      this.evaluate(w => !!w.minute, new Set(), true, true);
      this.armMinute();
    }, this.minuteMs === 60_000 ? 60_000 - (now % 60_000) + 500 : this.minuteMs);
    (this.minuteTimer as { unref?: () => void }).unref?.();
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
      return refusalEnvelope(request.id, new Refusal("invalid", "watch is a key of 1 to 200 characters the client chooses, like \"links:3f2a\""), this.options.sequence());
    }
    if (request.generation !== undefined && (!Number.isSafeInteger(request.generation) || (request.generation as number) < 0)) {
      return refusalEnvelope(request.id, new Refusal("invalid", "generation is the number a queries.changed event gave for this watch"), this.options.sequence());
    }
    const { id: _id, watch: _watch, generation: _generation, ...question } = request;
    const signature = stableJson(question);
    const slot = `${this.id(connection)}\0${key}`;
    const held = this.all.get(slot);
    if (held && held.signature === signature) return this.reply(request.id, held);
    const response = this.asked(signature, question, request.id);
    if (!response.ok) return response;
    if (held) this.all.delete(slot);
    const deps = depsOf(response);
    const blind = this.options.machineryBlind?.(question as Request, response);
    const watch: Watch = { connection, key, request: question, signature, generation: 0, hash: hashOf(response), response, ...(deps ? { deps } : {}), ...(isMinute(response) ? { minute: true as const } : {}), ...(blind ? { blind } : {}) };
    this.all.set(slot, watch);
    this.bound(connection);
    this.armMinute();
    return this.reply(request.id, watch);
  }

  /**
   * The answer to a question being registered: one a connection asked at this sequence moments ago if there is one. Doors
   * reconnecting after a restart all ask the same reads at once; on float-2 three of them queued up to 10 s behind each
   * other's copies of the same reads (PIE-1546). A watched read answers from the outline and the clock alone, so the same
   * question at the same sequence has the same answer; `MEMO_MS` keeps the clock's part honest.
   */
  private asked(signature: string, question: Record<string, unknown>, id: string): OutlinerResponse {
    const sequence = this.options.sequence(), now = performance.now();
    if (this.memo?.sequence !== sequence || now - this.memo.at > MEMO_MS) this.memo = { sequence, at: now, answers: new Map() };
    const held = this.memo.answers.get(signature);
    if (held) return { ...held, id };
    const response = this.options.answer({ ...question, id } as Request);
    if (response.ok) this.memo.answers.set(signature, response);
    return response;
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

  /**
   * The outline changed: evaluate the watches it may have changed once the burst settles, and at least once a second
   * while it doesn't. `touched` names the notes the change touched; without it (a change that names none), every watch.
   */
  changed(touched?: ChangedNotes): void {
    if (this.all.size === 0) return;
    if (!touched || touched.blockId === undefined) this.pendingAll = true;
    else {
      for (const id of [touched.blockId, touched.parentId, touched.previousParentId]) if (id) this.pendingIds.add(id);
      if (!touched.machinery) this.pendingPlain = true;
    }
    const now = Date.now();
    if (!this.timer) this.pendingSince = now;
    else clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.settleMs, this.pendingSince + this.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  /** Evaluate the watches the changes may have changed now; tell each connection which of its answers changed. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // The pass in progress flushes again when it ends, with everything noted since.
    if (this.passing) return;
    // A flush with nothing noted (a caller flushing by hand) evaluates everything, as before.
    const all = this.pendingAll || this.pendingIds.size === 0, touched = this.pendingIds, plain = this.pendingPlain;
    this.pendingAll = false;
    this.pendingPlain = false;
    this.pendingIds = new Set();
    this.evaluate(() => true, touched, all, plain);
  }

  /** Evaluate the selected watches: at once, or (with `turn`) a watch a turn, after any pass still going. */
  private evaluate(select: (watch: Watch) => boolean, touched: ReadonlySet<string>, all: boolean, plain: boolean): void {
    if (!this.options.turn) {
      const started = performance.now();
      const changes = new Map<WatchConnection, QueryChange[]>();
      for (const watch of this.all.values()) {
        const change = this.wanted(watch, select, touched, all, plain) && this.update(watch, this.options.answer({ ...watch.request, id: "watch" } as Request));
        if (!change) continue;
        const list = changes.get(watch.connection) ?? [];
        list.push(change);
        changes.set(watch.connection, list);
      }
      for (const [connection, list] of changes) this.send(connection, list);
      this.options.timed?.(performance.now() - started, this.all.size);
      return;
    }
    // One pass at a time, the clock's too: a pass never applies an answer older than one another pass gave.
    this.passing = true;
    this.passes += 1;
    this.chain = this.chain.then(() => this.inTurns(select, touched, all, plain)).catch(() => {}).finally(() => {
      if (--this.passes > 0) return;
      this.passing = false;
      if (!this.pendingAll && this.pendingIds.size === 0) return;
      // What changed during the pass: the next one, once it settles.
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.settleMs);
    });
  }

  private async inTurns(select: (watch: Watch) => boolean, touched: ReadonlySet<string>, all: boolean, plain: boolean): Promise<void> {
    // One answer per question a pass: the same read watched on two connections is evaluated once.
    const answered = new Map<string, OutlinerResponse>();
    // What changed, told each connection in one event: at the end of the pass, or sooner in a long one. A watch
    // replaced, dropped or moved on since is left out: only a generation the watch still has is told.
    const told = new Map<WatchConnection, Array<{ slot: string; watch: Watch; change: QueryChange }>>();
    let toldAt = performance.now();
    const tell = () => {
      for (const [connection, list] of told) {
        this.send(connection, list.filter(({ slot, watch, change }) => this.all.get(slot) === watch && watch.generation === change.generation).map(({ change }) => change));
      }
      told.clear();
      toldAt = performance.now();
    };
    const current = (slot: string, watch: Watch) => this.all.get(slot) === watch && !watch.connection.destroyed;
    for (const [slot, watch] of [...this.all]) {
      if (!current(slot, watch) || !this.wanted(watch, select, touched, all, plain)) continue;
      let response = answered.get(watch.signature);
      if (!response) {
        await this.options.turn!(String(watch.request.action));
        // Replaced, dropped or closed while it waited.
        if (!current(slot, watch)) continue;
        const started = performance.now();
        try { response = this.options.answer({ ...watch.request, id: "watch" } as Request); }
        catch (error) { response = refusalEnvelope("watch", error, this.options.sequence()); }
        this.options.timed?.(performance.now() - started, 1);
        answered.set(watch.signature, response);
      }
      const change = this.update(watch, response);
      if (change) told.set(watch.connection, [...(told.get(watch.connection) ?? []), { slot, watch, change }]);
      if (told.size && performance.now() - toldAt > TELL_EVERY_MS) tell();
    }
    tell();
  }

  private wanted(watch: Watch, select: (watch: Watch) => boolean, touched: ReadonlySet<string>, all: boolean, plain: boolean): boolean {
    if (watch.connection.destroyed || !select(watch)) return false;
    if (all) return true;
    if (watch.deps) return [...touched].some(id => watch.deps!.has(id));
    // Only stamped notes changed: a question that leaves them out sees it only through a note it lists or names.
    if (!plain && watch.blind) return [...touched].some(id => watch.blind!.has(id));
    return true;
  }

  /** Keep a watch's new answer; its change when the answer is different. */
  private update(watch: Watch, response: OutlinerResponse): QueryChange | undefined {
    const hash = hashOf(response);
    const deps = depsOf(response);
    if (deps) watch.deps = deps; else delete watch.deps;
    if (isMinute(response)) watch.minute = true; else delete watch.minute;
    const blind = this.options.machineryBlind?.(watch.request as Request, response);
    if (blind) watch.blind = blind; else delete watch.blind;
    if (hash === watch.hash) return undefined;
    watch.generation += 1;
    watch.hash = hash;
    watch.response = response;
    return { key: watch.key, generation: watch.generation };
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
    if (this.dayTimer) clearTimeout(this.dayTimer);
    if (this.minuteTimer) clearTimeout(this.minuteTimer);
    this.timer = null;
    this.dayTimer = null;
    this.minuteTimer = null;
    this.all.clear();
    this.connections.clear();
  }
}
