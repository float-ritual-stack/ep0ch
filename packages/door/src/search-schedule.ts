// One search scheduler (PIE-1382): what asks the host as the person types or the outline changes (the power bar's
// sources, the completer's lookup, a query tile's reload) goes through a `SearchSchedule`, which owns the pause, the
// latest-wins rule and stopping what a newer ask replaced. A path holds no timer or generation counter of its own: it
// begins a turn, asks with the turn's `signal`, and keeps an answer only while the turn is `alive`.
// The clock is one for the door: tests swap in a `FakeSearchClock` and run the pauses out on their own time.

/** When a pause runs out: the door's real timers, or a test's fake. `after` answers a function that cancels it. */
export interface SearchClock { after(ms: number, run: () => void): () => void }

const realClock: SearchClock = { after(ms, run) { const t = setTimeout(run, ms); return () => clearTimeout(t); } };
let clock: SearchClock = realClock;

/** Every schedule's pauses run on `c` until the answer is called (a test's fake clock). */
export function useSearchClock(c: SearchClock): () => void {
  const was = clock;
  clock = c;
  return () => { clock = was; };
}

/** The pause after a typed key before the host is asked (the power bar's sources, the completer's lookup). */
export const TYPING_PAUSE_MS = 150;
/** The pause after an answer before Jev is asked to re-order it (the notes search, `((`). */
export const JEV_PAUSE_MS = 300;
/** The pause after an outline change before a query tile reads its notes again: once per burst. */
export const RELOAD_PAUSE_MS = 300;

/**
 * One ask and what follows from it, until a newer one replaces it. `signal` goes with each request it makes to the
 * host (aborted, the board stops waiting for the answer); `alive` says whether an answer may still be used.
 */
export class SearchTurn {
  private readonly ctl = new AbortController();
  private readonly timers = new Set<() => void>();
  /** What this turn still waits on (a bar's sources by id): `settled` resolves when it's empty. */
  readonly pending = new Set<string>();
  private waiters: (() => void)[] = [];
  readonly signal = this.ctl.signal;
  alive(): boolean { return !this.signal.aborted; }

  /** `run` once `ms` passed, unless the turn ended first (Jev re-ordering what this turn found). */
  after(ms: number, run: () => void): void {
    if (!this.alive()) return;
    const cancel = clock.after(ms, () => { this.timers.delete(cancel); if (this.alive()) run(); });
    this.timers.add(cancel);
  }

  /** What `after` waits to run is dropped, the turn kept (more rows asked: Jev's re-order of the first ones is stale). */
  dropAfter(): void { for (const cancel of this.timers) cancel(); this.timers.clear(); }

  /** `id` was asked; `answered(id)` when its answer (or failure) came. */
  asking(id: string): void { this.pending.add(id); }
  answered(id: string): void {
    this.pending.delete(id);
    if (!this.pending.size) this.wake();
  }

  /** Resolves once nothing is pending, or the turn ended. */
  idle(): Promise<void> { return this.pending.size && this.alive() ? new Promise(r => this.waiters.push(r)) : Promise.resolve(); }

  /** Replaced or put away: requests still out are aborted, timers cleared, waiters let go. */
  end(): void {
    if (!this.alive()) return;
    this.ctl.abort();
    this.dropAfter();
    this.wake();
  }

  private wake() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
}

/**
 * The scheduler for one path (a bar, a draft's completer, a query tile): one turn at a time, the newest. `begin`
 * replaces the turn; `pause` waits `pauseMs` for typing (or a burst of changes) to stop before it runs; `now` ends
 * that pause at once; `cancel` puts it all away.
 */
export class SearchSchedule {
  turn: SearchTurn | null = null;
  private paused: { run: () => void; cancel: () => void } | null = null;
  constructor(readonly pauseMs: number) {}

  /** A new turn: the one before it ends (its requests aborted) and a waiting pause is dropped. */
  begin(): SearchTurn {
    this.drop();
    this.turn?.end();
    return this.turn = new SearchTurn();
  }

  /** `run` once nothing new came for `pauseMs`; a newer `pause`, `begin` or `cancel` drops it. */
  pause(run: () => void): void {
    this.drop();
    const p = { run, cancel: clock.after(this.pauseMs, () => { if (this.paused === p) { this.paused = null; run(); } }) };
    this.paused = p;
  }

  /** A pause is running. */
  get waiting(): boolean { return this.paused !== null; }

  /** The pause ends now: what it waited to run runs. False when none was waiting. */
  now(): boolean {
    const p = this.paused;
    if (!p) return false;
    this.drop();
    p.run();
    return true;
  }

  /** Put away: no pause runs, the turn ends. */
  cancel(): void {
    this.drop();
    this.turn?.end();
  }

  /**
   * Resolves once the turn's pending asks have all answered (or `ms` passed: a deadline on the wall clock, not a pause):
   * those still out, if any.
   */
  async settled(ms = 5000): Promise<string[]> {
    const t = this.turn;
    if (!t?.pending.size) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([t.idle(), new Promise<void>(r => { timer = setTimeout(r, ms); })]);
    clearTimeout(timer);
    return [...t.pending];
  }

  private drop() { this.paused?.cancel(); this.paused = null; }
}

/** A clock that moves only when told: `advance` runs what falls due, `runOut` everything waiting (and what that starts). */
export class FakeSearchClock implements SearchClock {
  private due: { at: number; run: () => void }[] = [];
  now = 0;
  after(ms: number, run: () => void): () => void {
    const t = { at: this.now + ms, run };
    this.due.push(t);
    return () => { this.due = this.due.filter(x => x !== t); };
  }
  /** Pauses still waiting. */
  get pending(): number { return this.due.length; }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const next = this.due.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.due = this.due.filter(t => t !== next);
      this.now = next.at;
      next.run();
    }
    this.now = end;
  }
  /** Every pause waiting runs out, in order; true when any did. */
  runOut(): boolean {
    let ran = false;
    for (let i = 0; this.due.length && i < 100; i++) { ran = true; this.advance(Math.max(0, Math.min(...this.due.map(t => t.at)) - this.now)); }
    return ran;
  }
}
