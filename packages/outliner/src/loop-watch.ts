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
 * behind every other request, so a note read, a write or a ping is never queued behind a burst of them.
 */
export const WHOLE_OUTLINE_READS: ReadonlySet<string> = new Set([
  "tree.index", "tree.query", "tree.focus", "tree.search", "views.read", "blocks.query", "blocks.records", "workspace.snapshot",
  "callouts.types", "headings.styles", "components.schemas", "references.backlinks", "checklist.search", "fragments.candidates",
  "pages.complete", "properties.catalog", "properties.inventory", "query.matches", "activity.recent",
]);

/**
 * Whose turn it is on the loop (PIE-625). Every request waits for a turn; one is given per pass of the event loop, so
 * the loop reads the sockets between any two (a request that arrives mid-burst is in line at once), and the other
 * requests go before the whole-outline reads. A turn ends where its request first waits (I/O, a child process); the
 * order within one connection is kept by its own queue.
 */
export class Turns {
  private readonly first: Array<() => void> = [];
  private readonly last: Array<() => void> = [];
  private scheduled = false;

  next(action: unknown): Promise<void> {
    return new Promise(resolve => {
      (WHOLE_OUTLINE_READS.has(String(action)) ? this.last : this.first).push(resolve);
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      (this.first.shift() ?? this.last.shift())?.();
      if (this.first.length || this.last.length) this.schedule();
    });
  }
}

/** The action a request line names, read without parsing the line (it is parsed once, when its turn comes). */
export function actionOf(line: string): string | undefined {
  return /"action"\s*:\s*"([^"]{1,80})"/.exec(line)?.[1];
}
