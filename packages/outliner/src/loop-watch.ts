/*
 * What holds the host's event loop (PIE-625). One process serves every client of every outline, so anything that
 * runs long on the loop (a slow request, a start-up scan, a fan-out) makes every other client wait, and a client
 * gives up after 3 s. Two records go to the host's log, as JSON lines:
 *
 * - `loop_stalled`: the loop didn't get back to a timer for `ms` (sampled every 50 ms; reported from 100 ms), with
 *   the requests that ran in that window, summed by action, the longest first;
 * - `slow_request`: one request that took `ms` from its line arriving to its answer written: `queuedMs` behind the
 *   requests before it on its connection, `handleMs` handling it, and `publishMs` sending its change to subscribers.
 *
 * The host turns it on; a test or a CLI that opens a store never does.
 *
 * And whose turn it is (`Turns`): the service gives each request its turn on the loop, the whole-outline reads last.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface LoopStall {
  status: "loop_stalled";
  ms: number;
  /** The work that ran in the stall, summed by label, longest first: `label ms (n×)`. */
  during: string[];
}

export interface SlowWork {
  label: string;
  ms: number;
  /** When it ended (performance.now()). */
  at: number;
}

const SAMPLE_MS = 50;
export const STALL_REPORT_MS = 100;
/** Work shorter than this isn't kept; many short pieces in one stall are summed by label. */
const KEEP_MS = 2;
const RECENT_LIMIT = 512;

let recent: SlowWork[] = [];
let watching = false;

/** Records work that ran on the loop (a request's handling, its fan-out), while the loop is watched. */
export function noteWork(label: string, ms: number): void {
  if (!watching || ms < KEEP_MS) return;
  recent.push({ label, ms, at: performance.now() });
  if (recent.length > RECENT_LIMIT) recent = recent.slice(-RECENT_LIMIT);
}

export interface LoopWatch {
  stop(): void;
}

/** Samples the loop's lag and reports stalls; one per process. */
export function watchEventLoop(report: (stall: LoopStall) => void, options: { sampleMs?: number; reportMs?: number } = {}): LoopWatch {
  const sampleMs = options.sampleMs ?? SAMPLE_MS;
  const reportMs = options.reportMs ?? STALL_REPORT_MS;
  watching = true;
  let expected = performance.now() + sampleMs;
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    expected = now + sampleMs;
    if (lag < reportMs) return;
    const since = now - lag - sampleMs;
    const byLabel = new Map<string, { ms: number; count: number }>();
    for (const work of recent) {
      if (work.at < since) continue;
      const sum = byLabel.get(work.label) ?? { ms: 0, count: 0 };
      sum.ms += work.ms;
      sum.count += 1;
      byLabel.set(work.label, sum);
    }
    const during = [...byLabel].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)
      .map(([label, sum]) => `${label} ${Math.round(sum.ms)}${sum.count > 1 ? ` (${sum.count}×)` : ""}`);
    recent = [];
    report({ status: "loop_stalled", ms: Math.round(lag), during });
  }, sampleMs);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      watching = false;
      recent = [];
    },
  };
}

/** Whether the loop is watched: request timing is only measured then. */
export function loopWatched(): boolean {
  return watching;
}

/**
 * Reads that walk the whole outline (PIE-625). A client asks for many at once (Tree reads the tree and every saved
 * view after each change; five Details read their styles), and one outline's are each a few milliseconds: they wait
 * behind every other request, so a note read, a write or a ping is never queued behind a burst of them, on another
 * connection or on its own (they don't hold their connection's queue, PIE-1413). Only reads go here.
 */
export const WHOLE_OUTLINE_READS: ReadonlySet<string> = new Set([
  "tree.index", "tree.query", "tree.focus", "tree.search", "views.read", "blocks.query", "blocks.records", "site.answer", "workspace.snapshot",
  "callouts.types", "headings.styles", "styles.list", "components.schemas", "references.backlinks", "checklist.search", "fragments.candidates",
  "pages.complete", "properties.catalog", "properties.inventory", "query.matches", "activity.recent",
  // A board asks these of every lane after each change (PIE-1413).
  "views.planWrite", "blocks.authored-links", "blocks.facets",
]);

/**
 * Whose turn it is on the loop (PIE-625). Every request waits for a turn; one is given per pass of the event loop, so
 * the loop reads the sockets between any two (a request that arrives mid-burst is in line at once), and the other
 * requests go before the whole-outline reads. A turn ends where its request first waits (I/O, a child process); the
 * order within one connection is kept by its own queue. A whole-outline read still gets one turn in LAST_EVERY + 1 while
 * other requests keep coming.
 *
 * And fair between who asks (PIE-1413): each turn names who it is for (a connection, an agent by its actor id, the
 * service's own jobs), each is charged the loop time its turns took (`charge`, halved every second), and of those
 * waiting in a lane the one that has used the loop least goes first. A ping or a note read between an import's
 * thousands of writes waits for one of them at most, never behind every one already in line; the import still gets
 * every turn nobody else wants. No job is throttled: only who goes next changes.
 */
const LAST_EVERY = 8;
/** How fast what someone used of the loop is forgotten: halved each this long. */
const USAGE_HALF_LIFE_MS = 1_000;

/** Which lane a request waits in: the whole-outline reads last. */
const laneOf = (action: unknown): "first" | "last" => (WHOLE_OUTLINE_READS.has(String(action)) ? "last" : "first");

/** Who a turn is for: a connection, an `actor:<id>`, the service's `own` jobs, its `watches`. */
export type TurnKey = object | string;

/** Whose request this work is for: what the service asks itself while answering one goes as that one's (`own`). */
export const turnOwner = new AsyncLocalStorage<TurnKey>();

interface Waiting { resolve: () => void; key: TurnKey }

export class Turns {
  private readonly first: Waiting[] = [];
  private readonly last: Waiting[] = [];
  private scheduled = false;
  /** Turns given in a row to other requests while a whole-outline read waited. */
  private passedOver = 0;
  private charges = 0;
  /** What each one asking used of the loop lately, decayed, with when it was last brought up to date. */
  /**
   * What each one asking used of the loop lately, decayed, per lane: a door's lane reads count against its other reads,
   * never against its note read or its save, so a busy board doesn't put its own person at the back (PIE-1413).
   */
  private readonly usage = { first: new Map<TurnKey, { ms: number; at: number }>(), last: new Map<TurnKey, { ms: number; at: number }>() };

  constructor(private readonly now: () => number = () => performance.now()) {}

  next(action: unknown, key: TurnKey = "anonymous"): Promise<void> {
    return new Promise(resolve => {
      (laneOf(action) === "last" ? this.last : this.first).push({ resolve, key });
      this.schedule();
    });
  }

  /** `key`'s turn took `ms` of the loop (its handling and what it set off). */
  charge(key: TurnKey, ms: number, action?: unknown): void {
    if (!(ms > 0)) return;
    const lane = laneOf(action);
    const used = this.used(key, this.now(), lane);
    this.usage[lane].set(key, { ms: used + ms, at: this.now() });
    // Those who stopped asking are forgotten (a closed connection is let go).
    if (++this.charges % 512 === 0) for (const l of ["first", "last"] as const) for (const known of [...this.usage[l].keys()]) this.used(known, this.now(), l);
  }

  /** What `key` has used of the loop, forgetting as it goes (as of `now`: one moment for a whole choice). */
  used(key: TurnKey, now = this.now(), lane: "first" | "last" = "first"): number {
    const entry = this.usage[lane].get(key);
    if (!entry) return 0;
    const ms = entry.ms * 2 ** (-(now - entry.at) / USAGE_HALF_LIFE_MS);
    if (ms < 0.01) { this.usage[lane].delete(key); return 0; }
    return ms;
  }

  /** The one waiting in `lane` that has used the loop least (the longest waiting among equals). */
  private take(lane: Waiting[], which: "first" | "last"): Waiting | undefined {
    if (lane.length <= 1) return lane.shift();
    const now = this.now();
    let best = 0, bestUsed = this.used(lane[0]!.key, now, which);
    for (let i = 1; i < lane.length; i++) {
      const used = this.used(lane[i]!.key, now, which);
      if (used < bestUsed) { best = i; bestUsed = used; }
    }
    return lane.splice(best, 1)[0];
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      // Never starved: after LAST_EVERY turns to other requests, a whole-outline read gets one.
      const fromLast = this.last.length > 0 && (this.first.length === 0 || this.passedOver >= LAST_EVERY);
      this.passedOver = fromLast || this.last.length === 0 ? 0 : this.passedOver + 1;
      this.take(fromLast ? this.last : this.first, fromLast ? "last" : "first")?.resolve();
      if (this.first.length || this.last.length) this.schedule();
    });
  }
}

/**
 * Whether work begun now is still in the same pass of the loop: a request that never waited for anything outside it
 * ran its continuations in this pass, so all of it held the loop, not only what ran before its first await.
 */
export function thisTurn(): () => boolean {
  let same = true;
  setImmediate(() => { same = false; });
  return () => same;
}

/** Who a request line is for, for its turn: the agent it names (`actorId`), else the connection it came on. */
export function turnKeyOf(line: string, connection: object): TurnKey {
  const actor = /"actorId"\s*:\s*"([^"]{1,120})"/.exec(line)?.[1];
  return actor ? `actor:${actor}` : connection;
}

/** The action a request line names, read without parsing the line (it is parsed once, when its turn comes). */
export function actionOf(line: string): string | undefined {
  return /"action"\s*:\s*"([^"]{1,80})"/.exec(line)?.[1];
}

/** The most of a query or path a slow request's log line carries. */
const SUBJECT_TEXT = 160;
const clip = (text: string) => text.length > SUBJECT_TEXT ? `${text.slice(0, SUBJECT_TEXT)}…` : text;

/**
 * What a request was computing, for its `slow_request` line and its stall's `during` (PIE-1047): the note, view or
 * block it names, and for `site.answer` the producer, figure kind, query or view, script line and paths it asked. A
 * draft's or a write's text is never logged.
 */
export function requestSubject(request: unknown): Record<string, string | number | boolean> {
  if (!request || typeof request !== "object") return {};
  const r = request as Record<string, any>;
  const out: Record<string, string | number | boolean> = {};
  for (const key of ["blockId", "viewId", "parentId", "block"] as const) if (typeof r[key] === "string") out[key] = clip(r[key]);
  if (typeof r.query?.where === "string") out.where = clip(r.query.where);
  if (typeof r.query?.subtreeRootId === "string") out.subtreeRootId = r.query.subtreeRootId;
  if (r.action !== "site.answer") return out;
  const produce = r.produce;
  if (produce && typeof produce === "object") {
    out.produce = String(produce.kind);
    if (typeof produce.figure === "string") out.figure = produce.figure;
    const props = produce.props && typeof produce.props === "object" ? produce.props : {};
    if (props.query !== undefined) out.query = clip(String(props.query));
    if (props.view !== undefined) out.view = clip(String(props.view));
    if (props.group !== undefined) out.group = clip(String(props.group));
    if (Array.isArray(props.items)) out.items = props.items.length;
    if (typeof produce.where === "string") out.where = clip(produce.where);
    if (typeof produce.key === "string") out.key = clip(produce.key);
    if (Array.isArray(produce.ids)) out.ids = produce.ids.length;
  }
  if (Number.isInteger(r.scriptLine)) out.scriptLine = r.scriptLine;
  if (r.sources) out.sources = true;
  if (Array.isArray(r.paths)) out.paths = clip(r.paths.map(String).join(" ; "));
  if (r.interpolate) out.interpolate = true;
  if (r.draft) out.draft = true;
  if (Array.isArray(r.hidden)) out.hidden = r.hidden.length;
  if (Array.isArray(r.chain) && r.chain.length) out.chain = r.chain.length;
  return out;
}

/** A slow request's label in a stall's `during`: its action and the note and figure it was computing. */
export function subjectLabel(action: string, subject: Record<string, string | number | boolean>): string {
  const note = typeof subject.blockId === "string" ? ` ((${subject.blockId.slice(0, 8)}))` : typeof subject.viewId === "string" ? ` view ((${subject.viewId.slice(0, 8)}))` : "";
  const what = subject.figure ? ` graph-${subject.figure}` : subject.produce ? ` ${subject.produce}` : subject.scriptLine !== undefined ? ` script line ${subject.scriptLine}` : subject.sources ? " sources" : "";
  return `${action}${note}${what}`;
}
