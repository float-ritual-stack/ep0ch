/*
 * What holds the host's event loop (PIE-625). One process serves every client of every outline, so anything that
 * runs long on the loop (a slow request, a start-up scan, a fan-out) makes every other client wait, and a client
 * gives up after 3 s. Two records go to the host's log, as JSON lines:
 *
 * - `loop_stalled`: the loop didn't get back to a timer for `ms` (sampled every 50 ms; reported from 100 ms), with
 *   the requests that ran in that window, summed by action, the longest first;
 * - `slow_request`: one request that took `ms` from its line arriving to its answer written: `queuedMs` behind the
 *   requests before it on its connection, `handleMs` handling it, `publishMs` sending its change to subscribers, and
 *   `who` asked;
 * - `queued_minute`: who was queued over a second in that minute, as actor × action counts (PIE-1546), so the next pile-up
 *   reads off one line: `scripts/host-queue-minutes.ts` reads a log's worth.
 *
 * What a stall can't name: the work a request does after a wait (a laptop's answer, a copy's snapshot) runs on the loop
 * with nobody timing it. Whatever is left of a stall after the named work goes to the requests waiting at that moment,
 * shared, as `<action> after a wait` (PIE-1567): that is the only work that can have run, except a timer's.
 *
 * The host turns it on; a test or a CLI that opens a store never does.
 *
 * And whose turn it is (`Turns`): the service gives each request its turn on the loop, the whole-outline reads last.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { isWholeOutlineRead } from "./actions";

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

/** A request that is waiting for something off the loop, and what its work between the waits held the loop for. */
export interface InFlight { action: string; heldMs: number; landed?: true }
const inFlight = new Set<InFlight>();

/** A request's handler is about to be waited for; `forget` it once its timing is written. */
export function inFlightRequest(action: string): InFlight {
  const flight: InFlight = { action, heldMs: 0 };
  if (watching) inFlight.add(flight);
  return flight;
}
/** It answered. Its last stretch of work ended just now, before the sampler could run: the next stall still counts it. */
export const landed = (flight: InFlight): void => { flight.landed = true; };
export const forget = (flight: InFlight): void => { inFlight.delete(flight); };

/** Times synchronous work that isn't a request (an outline opening, a rule's baseline), so a stall can name it. */
export function heldBy<T>(label: string, work: () => T): T {
  const started = performance.now();
  try { return work(); } finally { noteWork(label, performance.now() - started); }
}

/** A request waited this long for its turn, over the line a client notices. */
export const QUEUED_MS = 1_000;
const LANE_ROWS = 12;

/** Who was queued in one minute: actor × action counts (PIE-1546, the request's "a lane that says who is queued"). */
export interface QueuedMinute { status: "queued_minute"; minute: string; over1s: number; worstMs: number; who: string[] }
export class QueueLane {
  private minute = "";
  private rows = new Map<string, { n: number; worst: number }>();
  /** `at`: the minute it happened in, `2026-11-06T09:41`. A new minute hands back the one that ended. */
  note(who: string, action: string, queuedMs: number, at: string): QueuedMinute | undefined {
    const ended = at === this.minute ? undefined : this.flush();
    this.minute = at;
    const key = `${who} × ${action}`, row = this.rows.get(key) ?? { n: 0, worst: 0 };
    row.n += 1;
    row.worst = Math.max(row.worst, queuedMs);
    this.rows.set(key, row);
    return ended;
  }
  /** The minute so far, and the lane emptied. */
  flush(): QueuedMinute | undefined {
    if (!this.rows.size) return undefined;
    const rows = [...this.rows].sort((a, b) => b[1].n - a[1].n || b[1].worst - a[1].worst);
    const done: QueuedMinute = {
      status: "queued_minute", minute: this.minute, over1s: rows.reduce((sum, [, row]) => sum + row.n, 0), worstMs: Math.round(Math.max(...rows.map(([, row]) => row.worst))),
      who: rows.slice(0, LANE_ROWS).map(([key, row]) => `${key} ${row.n} (worst ${Math.round(row.worst)} ms)`),
    };
    this.rows = new Map();
    return done;
  }
  /** The minute `now` is in, as the log's lines read. */
  static minuteOf(now = new Date()): string {
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }
}
const lane = new QueueLane();
let laneReport: ((minute: QueuedMinute) => void) | undefined;

/** A request's turn came after `queuedMs`: it joins this minute's lane when that's over the line. */
export function noteQueued(who: string, action: string, queuedMs: number): void {
  if (!watching || queuedMs < QUEUED_MS) return;
  const ended = lane.note(who, action, queuedMs, QueueLane.minuteOf());
  if (ended) laneReport?.(ended);
}

/** Samples the loop's lag and reports stalls; one per process. */
export function watchEventLoop(report: (stall: LoopStall) => void, options: { sampleMs?: number; reportMs?: number; lane?: (minute: QueuedMinute) => void } = {}): LoopWatch {
  const sampleMs = options.sampleMs ?? SAMPLE_MS;
  const reportMs = options.reportMs ?? STALL_REPORT_MS;
  watching = true;
  laneReport = options.lane;
  let expected = performance.now() + sampleMs;
  let lastMinute = QueueLane.minuteOf();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    expected = now + sampleMs;
    // A quiet minute after a busy one still says what the busy one held.
    const minute = QueueLane.minuteOf();
    if (minute !== lastMinute) { lastMinute = minute; const ended = lane.flush(); if (ended) laneReport?.(ended); }
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
    // What nothing named: the work of the requests waiting right now, after their waits, shared.
    const named = [...byLabel.values()].reduce((sum, { ms }) => sum + ms, 0), share = (lag - named) / inFlight.size;
    if (inFlight.size && share >= KEEP_MS) for (const flight of inFlight) {
      flight.heldMs += share;
      const label = `${flight.action} after a wait`, sum = byLabel.get(label) ?? { ms: 0, count: 0 };
      sum.ms += share;
      sum.count += 1;
      byLabel.set(label, sum);
    }
    for (const flight of inFlight) if (flight.landed) inFlight.delete(flight);
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
      inFlight.clear();
      const ended = lane.flush();
      if (ended) laneReport?.(ended);
      laneReport = undefined;
    },
  };
}

/** Whether the loop is watched: request timing is only measured then. */
export function loopWatched(): boolean {
  return watching;
}


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
const laneOf = (action: unknown): "first" | "last" => (isWholeOutlineRead(action) ? "last" : "first");

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

  /** Whether anyone is waiting for a turn. */
  get waiting(): boolean { return this.first.length > 0 || this.last.length > 0; }

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

/** One request's timing, for the host's log. */
export interface RequestTiming {
  request: { action?: unknown } | undefined;
  outline: string | undefined;
  /** The agent it names, the extension it's from, else the client on its connection. */
  who: string;
  subscribers: number;
  received: number; started: number; answered: number;
  /** What it held the loop for that was timed; a stall adds what it did after a wait (`flight`). */
  loopMs: number;
  flight: InFlight | undefined;
  publishMs: number;
}

/**
 * A request that took long is logged and named in a stall (PIE-625, 1047), and one that waited over a second joins its
 * minute's lane. After a wait, the sampler goes first (already due, if this held the loop) and says what it held.
 */
export function timeRequest(t: RequestTiming): void {
  if (t.flight && t.answered - t.started >= STALL_REPORT_MS) setTimeout(() => writeTiming(t), 1);
  else writeTiming(t);
}

function writeTiming(t: RequestTiming): void {
  if (t.flight) forget(t.flight);
  const afterWait = t.flight?.heldMs ?? 0, action = String(t.request?.action ?? "invalid"), ms = t.answered - t.received;
  noteQueued(t.who, action, t.started - t.received);
  // A request that held the loop is named by what it computed (PIE-1047), so a stall points at its note and figure.
  const subject = t.loopMs >= STALL_REPORT_MS || ms >= QUEUED_MS ? requestSubject(t.request) : undefined;
  noteWork(subject && t.loopMs >= STALL_REPORT_MS ? subjectLabel(action, subject) : action, t.loopMs);
  noteWork(`${action} fan-out`, t.publishMs);
  // Its own work held the loop, or it waited long enough for a client to notice (a third of the 3 s timeout).
  if (t.loopMs + afterWait < STALL_REPORT_MS && t.publishMs < STALL_REPORT_MS && ms < QUEUED_MS) return;
  console.log(JSON.stringify({
    status: "slow_request", outline: t.outline, action, who: t.who, ms: Math.round(ms),
    queuedMs: Math.round(t.started - t.received), handleMs: Math.round(t.answered - t.started), loopMs: Math.round(t.loopMs + afterWait),
    publishMs: Math.round(t.publishMs), subscribers: t.subscribers, ...(subject ?? requestSubject(t.request)),
  }));
}
