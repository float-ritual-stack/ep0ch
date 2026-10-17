// One layout history for every actor, the person included (PIE-957, S7 of the self-reference wave; design §4.9). The desk
// records each change to its screen's shape at its state setter (every checked commit and every layout it builds), with the
// shape from before it, who made it and its transaction, if it has one. `layout.undo` rebuilds from the newest entry. A
// transaction is one entry: the first action carrying `txn=<id>` opens it, the rest join it, and it closes when the run
// ends, on `layout.txn.end`, or after a minute with nothing in it. Pure: no I/O, no desk.
import { partyOf, undoStamp } from "../steps";
import type { Actor } from "../socket";
import type { LayoutSpec } from "./tiles";

/** How long a transaction waits with nothing joining it before it closes (ms). */
export const TXN_IDLE_MS = 60_000;
/** Resizes by one actor this close together are one entry (a drag is many commits). */
export const COALESCE_MS = 1500;
/** How many entries the history keeps. */
const KEEP = 50;

export interface LayoutEntry {
  /** The place in the door's one undo order (steps.ts `undoStamp`): ctrl+z takes the newest across histories. */
  seq: number;
  /** The screen's shape before this entry, to rebuild from. */
  before: LayoutSpec;
  /** Who made it, and the party it undoes for (`you`, or `agent:<id>`). */
  by: Actor;
  party: string;
  /** Who asked for it, when a script run made it for someone (`you` for a press): they may undo it too. */
  owner: string;
  /** What it was, in words: `resize`, `close`, `laid out review`; a transaction says how many steps it joined. */
  what: string;
  txn?: string;
  /** Actions that joined this entry (a transaction's count). */
  steps: number;
  at: number;
}

/** A transaction as the desk tracks it while it is open. */
export interface OpenTxn { id: string; by: Actor; opened: number; touched: number; start: LayoutSpec; entry: LayoutEntry | null; motion?: string }

export class LayoutHistory {
  private list: LayoutEntry[] = [];
  private open = new Map<string, OpenTxn>();

  /**
   * Record a change that left the shape different: `before` is the shape it started from. A transaction's later step joins
   * its entry only while that entry is still the newest: once another actor's change landed after it, the step is an entry of
   * its own (the same txn), so undo stays chronological and never reopens what someone else closed in between.
   */
  record(before: LayoutSpec, by: Actor, what: string, now: number, txn?: string): LayoutEntry {
    const newest = this.list.at(-1), party = partyOf(by);
    if (txn) {
      const t = this.open.get(txn);
      if (t?.entry && t.entry === newest) { t.entry.steps++; t.touched = now; t.entry.what = `${t.entry.steps} steps`; return t.entry; }
    }
    if (!txn && what === "resize" && newest && !newest.txn && newest.what === "resize" && newest.party === party && now - newest.at < COALESCE_MS) { newest.at = now; return newest; }
    const entry: LayoutEntry = { seq: undoStamp(), before, by, party, owner: by.kind === "agent" && by.for ? by.for : party, what, steps: 1, at: now, ...(txn ? { txn } : {}) };
    this.list.push(entry);
    if (this.list.length > KEEP) this.list.shift();
    if (txn) { const t = this.open.get(txn); if (t) { t.entry = entry; t.touched = now; } }
    return entry;
  }

  newest(): LayoutEntry | null { return this.list.at(-1) ?? null; }
  /** The newest entry `party` made or asked for, or null. */
  last(party: string): LayoutEntry | null { return this.list.findLast(e => e.party === party || e.owner === party) ?? null; }
  /** Entries made after `e`, by anyone. */
  after(e: LayoutEntry): LayoutEntry[] { return this.list.filter(x => x.seq > e.seq); }
  /** The newest entry of a transaction, or null. */
  forTxn(txn: string): LayoutEntry | null { return this.list.findLast(e => e.txn === txn) ?? null; }
  /** Every entry of a transaction, oldest first (one when nothing landed between its steps). */
  entriesOf(txn: string): LayoutEntry[] { return this.list.filter(e => e.txn === txn); }
  /** Take an entry out (undone): an open transaction that was adding to it starts a new entry with its next step. */
  take(e: LayoutEntry) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    for (const t of this.open.values()) if (t.entry === e) t.entry = null;
  }
  get size() { return this.list.length; }

  // ── transactions ─────────────────────────────────────────────────────────────

  /** The first action carrying `txn` opens it (`start`: the shape it began from); later ones keep it open. */
  join(txn: string, by: Actor, start: LayoutSpec, now: number, motion?: string): OpenTxn {
    let t = this.open.get(txn);
    if (!t) { t = { id: txn, by, opened: now, touched: now, start, entry: null, ...(motion ? { motion } : {}) }; this.open.set(txn, t); }
    else t.touched = now;
    return t;
  }
  isOpen(txn: string) { return this.open.has(txn); }
  openTxn(txn: string): OpenTxn | undefined { return this.open.get(txn); }
  /** Close it; the transaction as it stood, or null when it wasn't open. */
  close(txn: string): OpenTxn | null { const t = this.open.get(txn); this.open.delete(txn); return t ?? null; }
  /** The open transactions with nothing joining them for `TXN_IDLE_MS`. */
  idle(now: number): OpenTxn[] { return [...this.open.values()].filter(t => now - t.touched >= TXN_IDLE_MS); }
  openIds(): string[] { return [...this.open.keys()]; }
}
