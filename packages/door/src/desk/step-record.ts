// The door's steps (PIE-957, PIE-1592): one record for every actor, the person included, of what a ctrl+z can take back. Each
// entry is a change to one desk's shape (a screen's, the drawer's, a group's), with the shape from before it, who made it and
// its transaction, if it has one; a step is one entry, or a transaction's entries across the desks it touched (a carry's two
// layouts). The record answers every question about a step: is this a step, whose is it, which desk and key take it back,
// what stops it, and where the keys go. A desk only puts a tile back (`Desk.undoEntries`, put-back.ts). A transaction is one
// step: the first action carrying `txn=<id>` opens it, the rest join it, and it closes when the run ends, on
// `layout.txn.end`, or after a minute with nothing in it. Pure: no I/O, no desk.
import { keyCaption } from "../surface/actions";
import { hintKey } from "../surface/modes";
import { partyOf, undoStamp } from "../steps";
import type { Actor } from "../socket";
import type { LayoutSpec } from "./tiles";
import { savedNodes } from "./screen-spec";

/** How long a transaction waits with nothing joining it before it closes (ms). */
export const TXN_IDLE_MS = 60_000;
/** Resizes by one actor this close together are one entry (a drag is many commits). */
export const COALESCE_MS = 1500;
/** How many entries the history keeps. */
const KEEP = 50;

export interface LayoutEntry<D = unknown> {
  /** The desk it changed: what its step reads as "which desks it touched". */
  desk?: D;
  /** The place in the door's one undo order (steps.ts `undoStamp`): ctrl+z takes the newest across histories. */
  seq: number;
  /** The screen's shape before this entry, to rebuild from. */
  before: LayoutSpec;
  /** That shape as the desk compares shapes: a later change that lands back on it leaves nothing to take back. */
  shape?: string;
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

/** The tiles a shape names by their identity (`t-…`), a group's own tiles included: what an undo keeps by instance (PIE-1559). */
export function specTileIds(spec: LayoutSpec): string[] {
  const walk = (n: unknown): string[] => savedNodes(n).flatMap(x => (x.t === "leaf" ? [...(typeof x.id === "string" && x.id.startsWith("t-") ? [x.id] : []), ...walk(x.inner?.root)] : []));
  return [...walk(spec.root), ...(spec.floats ?? []).flatMap(f => walk(f.tile))];
}

/** A transaction as the desk tracks it while it is open. */
export interface OpenTxn<D = unknown> { id: string; by: Actor; opened: number; touched: number; start: LayoutSpec; entry: LayoutEntry<D> | null; motion?: string }

/** A change to a desk's shape, as `StepRecord.decide` reads it. `left`: the op said it only followed the keys leaving (a dock shutting). */
export interface Change { shape: string; party: string; op: string; txn: boolean; left: boolean }
/** What a change is: a step to record, nothing to take back, or (`forget`) one that makes the steps before it meaningless. */
export type Verdict = "step" | "none" | "forget";
/** The ops that only followed the keys or the data: a float raised, a tab shown, a source filling its container. */
const NO_STEP = new Set(["focus", "tab", "fill"]);

/** The key that takes back a change on another layout: not ctrl+z, which goes to the tile the person would step to (its own undo, a program). */
const elsewhereKey = () => keyCaption(hintKey({ action: "layout.undo", args: { anywhere: true }, key: "ctrl+w B", label: "" }) ?? "ctrl+w B");

/** One door's steps, every desk's in one order. */
export class StepRecord<D extends object = object> {
  private list: LayoutEntry<D>[] = [];
  private views = new WeakMap<D, DeskSteps<D>>();
  private putting = 0;
  /** The carry that pulled the drawer up with it: its undo puts the drawer down again. */
  private pull: string | null = null;

  /** `desk`'s own entries and open transactions. */
  of(desk: D): DeskSteps<D> { let v = this.views.get(desk); if (!v) this.views.set(desk, v = new DeskSteps(desk, this.list, this.takeOut)); return v; }
  /** A desk gone: nothing can take its steps back now. */
  forget(desk: D) { for (const e of this.list.filter(x => x.desk === desk)) this.takeOut(e); this.views.delete(desk); }
  private takeOut = (e: LayoutEntry<D>) => { const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1); if (e.desk) this.views.get(e.desk)?.dropped(e); };

  // ── is this a step ──
  /** While a step is being put back, what that changes is no new step, on any desk. */
  get puttingBack(): boolean { return this.putting > 0; }
  putBack<T>(run: () => T): T { this.putting++; try { return run(); } finally { this.putting--; } }
  /**
   * What a change of shape on `desk` is (PIE-1574). A change that lands back where the party's newest step began (a dock slid
   * open and shut) takes that step out: nothing is left to take back. One that only followed the keys or the data is none. A
   * container shown another source (the board's `g`) forgets: the steps before it were on tiles it just replaced.
   */
  decide(desk: D, c: Change): Verdict {
    if (this.puttingBack) return "none";
    if (c.op === "source") return "forget";
    const steps = this.of(desk), e = steps.newest();
    if (!c.txn && e && !e.txn && e.party === c.party && e.shape === c.shape) { steps.take(e); return "none"; }
    return c.left || NO_STEP.has(c.op) ? "none" : "step";
  }
  /** `desk`'s steps are gone: so is each carry's other half on `desks`, and what came before it on that desk. The tile stays where it was carried. */
  forgetAll(desk: D, desks: D[]) {
    const seen = new Set<string>(), todo = this.of(desk).clear();
    for (let t = todo.pop(); t !== undefined; t = todo.pop()) if (!seen.has(t)) { seen.add(t); for (const d of desks) todo.push(...this.of(d).forgetThrough(t)); }
  }

  // ── whose, which desk ──
  /** Whose layout a ctrl+z on `desk` takes back (PIE-1569): it or a desk holding it, whichever changed last (a group's gather is its holder's). */
  undoDesk(desk: D, holderOf: (d: D) => D | null | undefined): D {
    let best = desk;
    const at = (d: D) => this.of(d).newest()?.seq ?? -1;
    for (let d = holderOf(desk); d; d = holderOf(d)) if (at(d) > at(best)) best = d;
    return best;
  }
  /** The desk holding the newest change among `desks` (a person's, or `party`'s own): where `layout.undo anywhere=true` acts (PIE-1559). */
  newestDesk(desks: D[], fallback: D, party: string | null): D {
    const at = (d: D) => (party ? this.of(d).last(party) : this.of(d).newest())?.seq ?? -1;
    return desks.reduce((best, d) => (at(d) > at(best) ? d : best), fallback);
  }
  /** What `actor` takes back on `desk` (a transaction's every entry, newest first, or its newest own), or why there's nothing. */
  takeBack(desk: D, actor: Actor, txn?: string): LayoutEntry<D>[] | { refused: string } {
    const steps = this.of(desk), party = partyOf(actor);
    if (txn) {
      const entries = steps.entriesOf(txn).reverse();
      if (!entries.length) return { refused: `no layout change in transaction ${txn} (it was undone, or this desk restarted)` };
      if (actor.kind === "agent" && !entries.every(e => e.party === party || e.owner === party)) return { refused: `transaction ${txn} isn't yours: an agent undoes its own (or a script it asked for)` };
      return entries;
    }
    const mine = actor.kind === "agent" ? steps.last(party) : steps.newest(), newest = steps.newest();
    if (mine) return [mine];
    return { refused: actor.kind === "agent" && newest ? `the newest layout change is ${newest.party === "you" ? "the person's" : `${newest.party}'s`}; an agent undoes only its own` : "nothing to undo on this screen's layout" };
  }
  /** The step `entries` (of `desk`) are part of, as each desk in `desks` holds it: every desk its transactions reached, this one first. */
  stepOf(desk: D, entries: LayoutEntry<D>[], desks: D[]): { sides: [D, LayoutEntry<D>[]][]; txns: Set<string> } {
    const txns = new Set(entries.flatMap(e => (e.txn ? [e.txn] : [])));
    const others = desks.filter(d => d !== desk && [...txns].some(t => this.of(d).forTxn(t)));
    return { txns, sides: [[desk, entries], ...others.map(d => [d, [...txns].flatMap(t => this.of(d).entriesOf(t)).sort((a, b) => b.seq - a.seq)] as [D, LayoutEntry<D>[]])] };
  }
  /** Why `entries` of `desk` can't be taken back by `actor`, the step being taken from `from`: not theirs, or a change since. `name`: what that layout is called. */
  stopped(desk: D, entries: LayoutEntry<D>[], actor: Actor, from: D, name: string): string | null {
    const party = partyOf(actor), steps = this.of(desk);
    if (actor.kind === "agent" && !entries.every(e => e.party === party || e.owner === party)) return `the ${name}'s change isn't yours: an agent undoes its own`;
    for (const entry of entries) {
      const later = steps.after(entry).findLast(e => (entry.txn !== undefined ? e.txn !== entry.txn : e.party !== entry.party));   // the newest: what its undo takes first
      if (!later) continue;
      const who = `${later.party === "you" ? "you" : later.party.replace("agent:", "")} ${later.what}`;
      return desk === from ? `the layout changed since (${who}); undo that first${later.party === "you" ? ": ctrl+z" : ""}` : `${name} changed since (${who}); ${elsewhereKey()} undoes it`;
    }
    return null;
  }
  /** The order that keeps every instance: a desk holding a tile another's shape claims goes first (its tile to the pool, its name free). And what they claim between them. */
  putBackOrder(sides: [D, LayoutEntry<D>[]][], held: (d: D) => string[]): { sides: [D, LayoutEntry<D>[]][]; claims: Set<string> } {
    const own = new Map(sides.map(([d, es]) => [d, new Set(es.flatMap(e => specTileIds(e.before)))]));
    const claims = new Set([...own.values()].flatMap(s => [...s]));
    const gives = (d: D) => held(d).filter(id => claims.has(id) && !own.get(d)!.has(id)).length;
    return { sides: [...sides].sort(([a], [b]) => gives(b) - gives(a)), claims };
  }

  // ── where the keys and the drawer go ──
  /** Where the person's keys go when a step is taken back: `stay` where they are (unless their tile went), or `follow` the tile that moved between layouts. */
  keysAfter(sides: number, actor: Actor, keepKeys: boolean): { stay: boolean; follow: boolean } {
    const across = sides > 1;
    return { stay: keepKeys || across || actor.kind === "agent", follow: across && actor.kind !== "agent" };
  }
  /** The step in transaction `txn` pulled the drawer up with it. */
  pulledDrawer(txn: string | null | undefined) { this.pull = txn ?? null; }
  /** The drawer is the person's own now (they toggled it): no carry's to put down. */
  drawerTaken() { this.pull = null; }
  /** Those transactions are taken back: whether one had pulled the drawer up, so it goes down. */
  pullBack(txns: ReadonlySet<string>): boolean { const pulled = this.pull !== null && txns.has(this.pull); if (pulled) this.pull = null; return pulled; }
}

/** One desk's part of the record. */
export class DeskSteps<D extends object = object> {
  private open = new Map<string, OpenTxn<D>>();
  constructor(private readonly desk: D, private readonly all: LayoutEntry<D>[], private readonly takeOut: (e: LayoutEntry<D>) => void) {}
  private get list(): LayoutEntry<D>[] { return this.all.filter(e => e.desk === this.desk); }
  /** An entry went from the record: an open transaction that was adding to it starts a new entry with its next step. */
  dropped(e: LayoutEntry<D>) { for (const t of this.open.values()) if (t.entry === e) t.entry = null; }

  /**
   * Record a change that left the shape different: `before` is the shape it started from. A transaction's later step joins
   * its entry only while that entry is still this desk's newest: once another actor's change landed after it, the step is an
   * entry of its own (the same txn), so undo stays chronological and never reopens what someone else closed in between.
   */
  record(before: LayoutSpec, by: Actor, what: string, now: number, txn?: string, shape?: string): LayoutEntry<D> {
    const newest = this.newest(), party = partyOf(by);
    if (txn) {
      const t = this.open.get(txn);
      if (t?.entry && t.entry === newest) { t.entry.steps++; t.touched = now; t.entry.what = `${t.entry.steps} steps`; return t.entry; }
    }
    if (!txn && what === "resize" && newest && !newest.txn && newest.what === "resize" && newest.party === party && now - newest.at < COALESCE_MS) { newest.at = now; return newest; }
    const entry: LayoutEntry<D> = { desk: this.desk, seq: undoStamp(), before, ...(shape !== undefined ? { shape } : {}), by, party, owner: by.kind === "agent" && by.for ? by.for : party, what, steps: 1, at: now, ...(txn ? { txn } : {}) };
    this.all.push(entry);
    const mine = this.list;
    if (mine.length > KEEP) this.take(mine[0]!);
    if (txn) { const t = this.open.get(txn); if (t) { t.entry = entry; t.touched = now; } }
    return entry;
  }

  newest(): LayoutEntry<D> | null { return this.list.at(-1) ?? null; }
  /** The newest entry `party` made or asked for, or null. */
  last(party: string): LayoutEntry<D> | null { return this.list.findLast(e => e.party === party || e.owner === party) ?? null; }
  /** Entries made after `e`, by anyone. */
  after(e: LayoutEntry<D>): LayoutEntry<D>[] { return this.list.filter(x => x.seq > e.seq); }
  /** The newest entry of a transaction, or null. */
  forTxn(txn: string): LayoutEntry<D> | null { return this.list.findLast(e => e.txn === txn) ?? null; }
  /** Every entry of a transaction, oldest first (one when nothing landed between its steps). */
  entriesOf(txn: string): LayoutEntry<D>[] { return this.list.filter(e => e.txn === txn); }
  /** Take an entry out (undone). */
  take(e: LayoutEntry<D>) { this.takeOut(e); }
  /** Every entry out; the transactions they were part of, whose other halves are on other desks. */
  clear(): string[] { const mine = this.list, txns = mine.flatMap(e => (e.txn ? [e.txn] : [])); for (const e of mine) this.take(e); return txns; }
  /** Every entry up to this transaction's newest out: their shapes come from before what it carried in, and rebuilding one would lose it. The transactions they were part of. */
  forgetThrough(txn: string): string[] { const last = this.forTxn(txn); if (!last) return []; const out = this.list.filter(e => e.seq <= last.seq); for (const e of out) this.take(e); return out.flatMap(e => (e.txn ? [e.txn] : [])); }
  get size() { return this.list.length; }

  // ── transactions ─────────────────────────────────────────────────────────────

  /** The first action carrying `txn` opens it (`start`: the shape it began from); later ones keep it open. */
  join(txn: string, by: Actor, start: LayoutSpec, now: number, motion?: string): OpenTxn<D> {
    let t = this.open.get(txn);
    if (!t) { t = { id: txn, by, opened: now, touched: now, start, entry: null, ...(motion ? { motion } : {}) }; this.open.set(txn, t); }
    else t.touched = now;
    return t;
  }
  isOpen(txn: string) { return this.open.has(txn); }
  openTxn(txn: string): OpenTxn<D> | undefined { return this.open.get(txn); }
  /** Close it; the transaction as it stood, or null when it wasn't open. */
  close(txn: string): OpenTxn<D> | null { const t = this.open.get(txn); this.open.delete(txn); return t ?? null; }
  /** The open transactions with nothing joining them for `TXN_IDLE_MS`. */
  idle(now: number): OpenTxn<D>[] { return [...this.open.values()].filter(t => now - t.touched >= TXN_IDLE_MS); }
  openIds(): string[] { return [...this.open.keys()]; }
}
