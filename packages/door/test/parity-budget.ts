// How long a parity scenario may take (PIE-1307), and what its failure says. One scenario ran 570 s against its 600 s limit and took the
// next scenario with it, in a shard that hung with no output for 205 s: a scenario past its budget fails by its own name, with the
// slowest key it pressed and the slowest screen it built, as soon as it is over, not when the test's own timeout ends the run.
// Times come from `performance.now()`: the parity run moves `Date.now` two days on.

export interface Cost { builds: number; buildMs: number; seconds: number }

export class ScenarioBudget {
  private t0 = 0;
  private slowest = { key: "", ms: 0 };
  private slowestBuild = 0;
  /** `limitMs`: what a scenario may take; `now`: the clock (a test's own). */
  constructor(readonly limitMs: number, private readonly now: () => number = () => performance.now()) {}

  /** A scenario starts. */
  start(): void { this.t0 = this.now(); this.slowest = { key: "", ms: 0 }; this.slowestBuild = 0; }
  /** Milliseconds since `start`. */
  elapsed(): number { return this.now() - this.t0; }
  /** A key (or two, or a click) took `ms`, pressing it and waiting out what it started. */
  key(name: string, ms: number): void { if (ms > this.slowest.ms) this.slowest = { key: name, ms }; }
  /** A screen built, in `ms`. */
  build(ms: number): void { this.slowestBuild = Math.max(this.slowestBuild, ms); }
  /** The slowest key and build so far, for the scenario's log line. */
  worst(): { key: string; keyMs: number; buildMs: number } { return { key: this.slowest.key, keyMs: this.slowest.ms, buildMs: this.slowestBuild }; }

  /** Throws when the scenario is past its budget: its name, what it was doing, how its time went, and the slowest key. */
  check(label: string, doing: string, cost: Cost): void {
    const took = this.elapsed();
    if (took <= this.limitMs) return;
    const w = this.worst();
    throw new Error(
      `parity scenario "${label}" took over ${this.limitMs / 1000} s (${(took / 1000).toFixed(1)} s: ${cost.builds} builds taking ${(cost.buildMs / 1000).toFixed(1)} s, ${cost.seconds} second checks) at ${doing}: ` +
      `its slowest key took ${w.keyMs.toFixed(0)} ms (${w.key || "none yet"}) and its slowest build ${w.buildMs.toFixed(0)} ms. ` +
      `Find where the time goes with PARITY_KEYS=<file> (each key's milliseconds) and PARITY_LOG=<file> (the totals); the budget is PARITY_BUDGET_MS.`,
    );
  }
}
