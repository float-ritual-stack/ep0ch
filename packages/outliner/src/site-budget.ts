// The time budget of one `site.answer` (PIE-1047). One outline host serves every outline and every client on one event
// loop, so an answer that computes for long makes every other request wait (on Oct 18 one held pie's host for 57 s and
// the publishers timed out). Each unit of work (a row checked, a placeholder read, a figure item asked) spends from the
// request's budget; past it the answer stops and says "still counting", and the reader draws that and asks again.

/** How long one `site.answer` may hold the host's loop before it answers "still counting" (PIE-1047). */
export const SITE_ANSWER_BUDGET_MS = 2_000;

/**
 * A `site.answer` past its time budget (PIE-1047): one host serves every outline and client, so an answer that would hold
 * the loop longer stops and says so (`problem.code: "still-counting"`), and the reader draws "still counting" in its place.
 */
export class StillCounting extends Error {
  readonly problem;
  constructor(readonly budgetMs: number, readonly what: string) {
    super(`still counting: ${what} took more than ${budgetMs / 1000} s, so the outline host stopped it to answer other requests; try again in a moment`);
    this.name = "StillCounting";
    this.problem = { code: "still-counting" as const, message: this.message };
  }
}

/** A time budget, spent by each unit of work (a row checked, a placeholder read, a figure item asked). */
export interface SiteBudget { deadline: number; ms: number }

export function siteBudget(ms = SITE_ANSWER_BUDGET_MS, now = performance.now()): SiteBudget {
  return { deadline: now + ms, ms };
}
