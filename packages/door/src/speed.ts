// How fast the door keeps up with the person (a475084a, PIE-1300, PIE-1309): what it counts about itself, always on
// and nearly free, read by `peek` (`.speed`, `ep0ch peek speed`) and said in the status bar when it slips.
//
// The counters show work saved (reports handled against frames drawn, hover reports folded into a newer one). The
// **settle** is the measure that says whether it feels fast: the time from the last input of a burst to the frame that
// shows it. A burst is inputs less than BURST_GAP_MS apart, and only one a redraw was asked for counts (a key that did
// nothing has no frame to wait for). Kept over a ring of the latest bursts, with the time each ended.

/** Inputs closer together than this are one burst: the settle is measured from the last of them. */
export const BURST_GAP_MS = 100;
/** The bursts kept. */
export const SETTLE_RING = 200;
/** A settle slower than this is slow. */
export const SETTLE_BUDGET_MS = 100;
/** The bursts of this long a window decide whether the door has been slow (and so whether the status bar says it). */
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
  /** A redraw was asked while an input was being handled: a frame will show it. */
  asked(): void { if (this.burst && this.burst.shown === null) this.burst.asked = true; }
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
  /** A burst that has been quiet for its gap is over. */
  private settled(): void { if (this.burst && this.now() - this.burst.last > BURST_GAP_MS) this.close(); }

  /** The settle over the bursts kept. */
  settle(): Settle { this.settled(); return settleOf(this.ring.map(b => b.ms)); }

  /** What `peek` gives as `.speed`. */
  describe() {
    return { since: new Date(this.since).toISOString(), frames: this.frames, reports: this.reports, motionCoalesced: this.motionCoalesced, settle: this.settle() };
  }

  /**
   * The status bar's word when the door has been slow: the p95 of the bursts of the last minute, once there are enough of
   * them and it is over the budget. Null while it is fine, and again once a minute passes without a slow one.
   */
  slow(budgetMs = SETTLE_BUDGET_MS): string | null {
    this.settled();
    const from = this.now() - SETTLE_WINDOW_MS;
    const s = settleOf(this.ring.filter(b => b.at >= from).map(b => b.ms));
    return s.n >= SETTLE_MIN_BURSTS && s.p95! > budgetMs ? `slow: ${s.p95} ms to settle` : null;
  }
}
