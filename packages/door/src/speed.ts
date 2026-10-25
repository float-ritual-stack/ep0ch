// How fast the door keeps up with the person (a475084a, PIE-1300, PIE-1309): what it counts about itself, always on
// and nearly free, read by `peek` (`.speed`, `ep0ch peek speed`) and said in the status bar when it slips.
//
// The counters show work saved (reports handled against frames drawn, hover reports folded into a newer one). The
// **settle** is the measure that says whether it feels fast: the time from the last input of a burst to the frame that
// shows it. A burst is inputs less than BURST_GAP_MS apart, and only one a redraw was asked for counts (a key that did
// nothing has no frame to wait for). Kept over a ring of the latest bursts, with the time each ended.

/** Inputs closer together than this are one burst: the settle is measured from the last of them. */
export const BURST_GAP_MS = 100;
/** An input older than this is no longer being handled: a redraw asked now is not for it. */
const STALE_MS = 1000;
/** The bursts kept. */
export const SETTLE_RING = 200;
/** A settle slower than this is slow. */
export const SETTLE_BUDGET_MS = 100;
/** The bursts of this long a window decide whether the door is slow, and it must stay so this long before the status bar says it. */
export const SETTLE_WINDOW_MS = 60_000;
/** Fewer bursts than this in the window say nothing: one slow paint is not a slow door. */
export const SETTLE_MIN_BURSTS = 5;

/** The settle over some bursts, in milliseconds: the median, the 95th percentile and the worst; nulls when none. */
export interface Settle { p50: number | null; p95: number | null; worst: number | null; n: number }

/** The value at quantile `q` (0..1) of an ascending list, nearest rank. */
const rank = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

export function settleOf(ms: readonly number[]): Settle {
  if (!ms.length) return { p50: null, p95: null, worst: null, n: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return { p50: rank(sorted, 0.5), p95: rank(sorted, 0.95), worst: sorted.at(-1)!, n: sorted.length };
}

export class SpeedMeter {
  /** Frames painted. */
  frames = 0;
  /** Input reports handed to the door: keys, clicks, wheel and hover. */
  reports = 0;
  /** Hover reports folded into a newer one before they were handled (PIE-1300). */
  motionCoalesced = 0;
  /** When the counts began (the clock's now). */
  readonly since: number;
  /** Finished bursts: when each ended and how long it took to show. */
  private ring: { at: number; ms: number }[] = [];
  /** The burst in progress: its last input, whether a redraw was asked for it, and how long until a frame showed it. */
  private burst: { last: number; asked: boolean; shown: number | null } | null = null;

  constructor(private readonly now: () => number = Date.now) { this.since = now(); }

  /** An input report arrived. */
  input(): void {
    const t = this.now();
    this.reports++;
    if (this.burst && t - this.burst.last > BURST_GAP_MS) this.close();
    // The newest input is the one the frame has to show: what was shown of the burst before it no longer counts.
    this.burst = { last: t, asked: this.burst?.asked ?? false, shown: null };
  }
  /**
   * A redraw was asked while an input was being handled: a frame will show it. Only for an input that is still being
   * handled: a burst nothing was drawn for stays unshown, and a later redraw (a batch of replies, a timer) is not its.
   */
  asked(): void { if (this.burst && this.burst.shown === null && this.now() - this.burst.last <= STALE_MS) this.burst.asked = true; }
  /** A frame was drawn. */
  frame(): void {
    this.frames++;
    if (this.burst?.asked && this.burst.shown === null) this.burst.shown = Math.max(0, this.now() - this.burst.last);
  }

  private close(): void {
    const b = this.burst;
    this.burst = null;
    if (b?.shown == null) return;
    this.ring.push({ at: b.last + b.shown, ms: b.shown });
    if (this.ring.length > SETTLE_RING) this.ring.shift();
  }
  /**
   * A burst that has been shown and quiet for its gap is over. One not yet shown is not: a slow paint is itself longer than
   * the gap, and reading the meter while it draws (the status bar does) must not end the burst it is measuring.
   */
  private settled(): void {
    if (!this.burst) return;
    const quiet = this.now() - this.burst.last;
    if (this.burst.shown !== null ? quiet > BURST_GAP_MS : quiet > STALE_MS) this.close();
  }

  /** The settle over the bursts kept. */
  settle(): Settle { this.settled(); return settleOf(this.ring.map(b => b.ms)); }

  /** What `peek` gives as `.speed`. */
  describe() {
    return { since: new Date(this.since).toISOString(), frames: this.frames, reports: this.reports, motionCoalesced: this.motionCoalesced, settle: this.settle() };
  }

  /** Since when the last minute's bursts have been over the budget, while they have been (asked for by `slow`). */
  private overSince: number | null = null;
  /**
   * The status bar's word when the door has been slow for a minute: the p95 of the bursts of the last minute (at least
   * SETTLE_MIN_BURSTS of them) has been over the budget since a minute ago. Asked for on every tick, so a slowdown that
   * ends sooner says nothing, and null again once the minute's bursts are fast or there are too few to say.
   */
  slow(budgetMs = SETTLE_BUDGET_MS): string | null {
    this.settled();
    const now = this.now(), from = now - SETTLE_WINDOW_MS;
    const s = settleOf(this.ring.filter(b => b.at >= from).map(b => b.ms));
    if (s.n < SETTLE_MIN_BURSTS || s.p95! <= budgetMs) { this.overSince = null; return null; }
    this.overSince ??= now;
    return now - this.overSince >= SETTLE_WINDOW_MS ? `slow: ${s.p95} ms to settle` : null;
  }
}
