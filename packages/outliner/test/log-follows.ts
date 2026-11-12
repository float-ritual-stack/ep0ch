// A follower built from a store's change log alone (ADR 0009, PIE-1751), for a test of a write path to say the write
// reached the log: the follower equals its home row for row, and the entries the write made are there to name.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { applyRange, canonicalDump, type LogEntry } from "../src/change-log";
import { openFollowerSchema, SCHEMA_VERSION } from "../src/schema";
import type { OutlinerStore } from "../src/store";

/**
 * The entries `store`'s log holds after `after` (a `store.log.cursor().lsn` read before the write), once a follower
 * built from the whole log alone is checked to equal the home. A write that missed the log fails here.
 */
export function followedSince(store: OutlinerStore, after: number): LogEntry[] {
  const follower = new Database(":memory:");
  try {
    openFollowerSchema(follower, store.log.cursor().logId);
    for (;;) {
      const at = (follower.query("SELECT COALESCE(MAX(lsn), 0) AS lsn FROM change_log").get() as { lsn: number }).lsn;
      const range = store.log.range(at);
      applyRange(follower, range, SCHEMA_VERSION);
      if (range.complete) break;
    }
    expect(canonicalDump(follower)).toBe(canonicalDump(store.database));
  } finally { follower.close(); }
  const entries: LogEntry[] = [];
  for (let at = after; ;) {
    const range = store.log.range(at);
    entries.push(...range.entries);
    if (range.complete) return entries;
    at = range.entries.at(-1)!.lsn;
  }
}

/** The entries of `table` whose primary key names `id` (a block's row, its properties' rows). */
export const entriesFor = (entries: readonly LogEntry[], table: string, id: string): LogEntry[] =>
  entries.filter(e => e.tbl === table && !!e.key?.includes(`"${id}"`));

/** The store transactions the entries were written in: one request's write is one. */
export const txnsOf = (entries: readonly LogEntry[]): number[] => [...new Set(entries.map(e => e.txn))];
