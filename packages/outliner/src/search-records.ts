// What ranked search leaves behind (PIE-1197, PIE-1198), so its cost and its judgment can be read and measured:
//
// - the day's `jev-run` (`experiment::search-live`), counted up in place as the workboard's loops are (work-jev.ts): `items` searches Jev ranked,
//   `suggested` the ones that said "no strong match", `quiet` the sure ones, `unavailable` the asks Jev couldn't answer,
//   and the tokens. pie's Jev's suggestions page reads every `jev-run`, so the loop's cost shows beside the others.
// - the picks (`search.picked`): the query, the row opened and its place, kept in the outline's metadata (the last
//   PICKS_KEPT, not note content) for the search eval to label a query with what was wanted.
// Best-effort: a search's answer never waits on, or fails for, its bookkeeping.
import type { SearchCertainty, SearchPickedRequest } from "@ep0ch/outline-core/protocol";
import type { JevReading } from "./jev";
import { tallyRun, type WorkJevClient } from "./work-jev";

export const SEARCH_LIVE_EXPERIMENT = "search-live";
export const SEARCH_PICKS_METADATA_KEY = "search.picks";
export const PICKS_KEPT = 500;

export interface SearchPick extends SearchPickedRequest { at: string }

/** The picks kept, oldest first; a value that can't be read is none. */
export function readSearchPicks(raw: string | undefined): SearchPick[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(p => p && typeof p.query === "string" && typeof p.blockId === "string") : []; } catch { return []; }
}

/** The request checked at the boundary: what a pick must carry. */
export function readSearchPicked(input: Record<string, unknown>): SearchPickedRequest {
  const { query, blockId, rank, surface } = input;
  if (typeof query !== "string" || !query.trim() || query.length > 500) throw new Error("search.picked needs query: the words searched (up to 500 characters)");
  if (typeof blockId !== "string" || !blockId) throw new Error("search.picked needs blockId: the row opened");
  if (!Number.isSafeInteger(rank) || (rank as number) < 0) throw new Error("search.picked needs rank: the row's place, 0 first");
  if (typeof surface !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(surface)) throw new Error("search.picked needs surface: where it was opened (power-bar, complete, goto)");
  return { query: query.trim(), blockId, rank: rank as number, surface };
}

export function keepSearchPick(picks: readonly SearchPick[], pick: SearchPickedRequest, now = new Date()): SearchPick[] {
  return [...picks, { ...pick, at: now.toISOString() }].slice(-PICKS_KEPT);
}

export type SearchTally =
  | { kind: "ranked"; sure: SearchCertainty | undefined; reading: JevReading }
  | { kind: "unavailable" };

/**
 * Searches counted in memory and written to the day's run at most once per `SEARCH_TALLY_MS`: a search is a read, and a
 * write per keystroke-settled query would add a revision and wake every subscribed door each time. A host that stops
 * between flushes loses those few counts; the run is a rate, not a log.
 */
export const SEARCH_TALLY_MS = 5 * 60_000;

export class SearchTallies {
  private add = { items: 0, quiet: 0, suggested: 0, unavailable: 0 };
  private usage = { input: 0, output: 0 };
  private reading: JevReading | undefined;
  get pending() { return this.add.items + this.add.unavailable > 0; }
  count(tally: SearchTally): void {
    if (tally.kind === "unavailable") { this.add.unavailable++; return; }
    this.add.items++;
    if (tally.sure) tally.sure.verdict === "strong" ? this.add.quiet++ : this.add.suggested++;
    this.usage.input += tally.reading.usage?.input ?? 0; this.usage.output += tally.reading.usage?.output ?? 0;
    this.reading = tally.reading;
  }
  /** What's counted, written as one change to the day's run. Never throws. */
  async flush(client: WorkJevClient, now = new Date()): Promise<void> {
    if (!this.pending) return;
    const add = this.add, reading = this.reading ? { ...this.reading, usage: this.usage } : undefined;
    this.add = { items: 0, quiet: 0, suggested: 0, unavailable: 0 }; this.usage = { input: 0, output: 0 }; this.reading = undefined;
    try { await tallyRun(client, SEARCH_LIVE_EXPERIMENT, now.toISOString().slice(0, 10), add, reading); } catch { /* best-effort */ }
  }
}
