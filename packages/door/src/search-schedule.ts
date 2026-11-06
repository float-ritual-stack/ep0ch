// One search scheduler (PIE-1382): what asks the host as the person types or the outline changes goes through a
// `SearchSchedule`, which owns the pause, the latest-wins rule and stopping what a newer ask replaced. Its users: the
// power bar's sources, the completer's lookup, a query tile's reload, and every read again after an outline change
// (the board's lanes, Matches, the links tile, the tree, a reader pinned to a page, a list the service answers;
// PIE-1395). A path holds no timer or generation counter of its own: it begins a turn, asks with the turn's `signal`
// (where the request takes one), and keeps an answer only while the turn is `alive`.
// The clock is one for the door: tests swap in a `FakeSearchClock` and run the pauses out on their own time.
//
// When to ask the host again is decided here too (PIE-1593). A tile that repeats a read holds an `AskAgain`: it names its
// read and its notes, never a timer or an event kind. Its notes are a question the host watches (the host says when the
// answer moved, PROTOCOL 309: no pause here, the host settled the burst), or the ids it shows (`Notes`: the door hears
// every change and `heardBy` says whether it touches them), or both. The change clock below is the same fact for what's
// asked at draw time (embeds, projections, steps, references): `changedSince` instead of a read of its own.
import type { Watched } from "./watched";

/** When a pause runs out: the door's real timers, or a test's fake. `after` answers a function that cancels it. */
export interface SearchClock { after(ms: number, run: () => void): () => void }

const realClock: SearchClock = { after(ms, run) { const t = setTimeout(run, ms); t.unref?.(); return () => clearTimeout(t); } };
let clock: SearchClock = realClock;

/**
 * A wait on the door's clock for what no note and no question can say: the outside world (a deploy elsewhere, a repo
 * card asking how it went). `after` answers a function that cancels it. Anything the outline can say goes through `AskAgain`.
 */
export const outsideAfter = (ms: number, run: () => void): (() => void) => clock.after(ms, run);

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
 * replaces the turn; `pause` waits `pauseMs` for typing (or a burst of changes) to stop before it runs (a path that
 * asks on purpose, Tab or Ctrl+Space, asks without one); `cancel` puts it all away.
 */
export class SearchSchedule {
  turn: SearchTurn | null = null;
  private paused: { run: () => void; cancel: () => void } | null = null;
  constructor(readonly pauseMs: number) {}

  /** A pause is waiting to run (a burst still coming in): what was read may already be older than the outline. */
  get waiting(): boolean { return this.paused !== null; }

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"late">(r => { timer = setTimeout(() => r("late"), ms); });
    // A newer turn begun meanwhile is waited on in its place: what's asked now, not what it replaced.
    for (let t = this.turn; t?.pending.size; t = this.turn) {
      if (await Promise.race([t.idle(), deadline]) === "late" || t === this.turn) break;
    }
    clearTimeout(timer);
    return [...(this.turn?.pending ?? [])];
  }

  private drop() { this.paused?.cancel(); this.paused = null; }
}

// ── what a change touched ──

/** The part of an outline event this module reads; the rest of the door never needs to look at its kind. */
export interface HeardChange {
  action?: string;
  blockId?: string;
  /** A tool's bookkeeping, before and after: only what shows that very note looks again (PIE-1546). */
  hidden?: true;
  change?: { kind: string; blockId?: string | null; parentId?: string | null; previousParentId?: string | null };
}

/**
 * Which notes a tile shows: an id it shows, or one whose children it lists (a change under a note names that note
 * too; `null` is the top level). `"any"`: anything may change the read (last callers, an area's counts), but a tool's
 * bookkeeping on notes it doesn't name.
 */
export type Notes = "any" | ((id: string | null) => boolean);
/** Every change there is, a tool's bookkeeping too (what links here may be one); a draft still isn't one. */
export const EVERY_CHANGE: Notes = () => true;

/**
 * Does this change touch `notes`? The one place that reads an event for this: a draft is no change to what's stored; an
 * event naming no note (a reset, a reconnect) could be anything.
 */
export function heardBy(e: HeardChange, notes: Notes): boolean {
  const c = e.change;
  if (c?.kind === "draft") return false;
  const named = [e.blockId, c?.blockId, c?.parentId, c?.previousParentId].filter((id): id is string | null => id !== undefined);
  if (!named.length) return true;
  if (notes === "any") return !e.hidden;
  return named.some(id => notes(id));
}

// ── the change clock: did it change since this was asked, for what's asked as it's drawn ──

let tick = 0, allAt = 0, anyAt = 0, configAt = 0;
const changedAt = new Map<string, number>();
/**
 * The outline changed. `ids`: the blocks a change record names (an edit, a create), so only answers
 * about them are asked again (plus the ones any change can alter: missing pages, views, failures).
 * null: anything may have changed (a move or trash takes a subtree along; a reset; a service without
 * change records). `config`: the workspace may differ too (a reconnect), so its Work-ID prefix is re-read.
 */
export function outlineChanged(ids: readonly string[] | null, config = false) {
  tick++; anyAt = tick;
  if (config) configAt = tick;
  if (!ids || changedAt.size > 5000) { allAt = tick; changedAt.clear(); }
  for (const id of ids ?? []) { changedAt.delete(id); changedAt.set(id, tick); }
}
/** The kinds whose record names everything they touched; the rest take a subtree along. */
const SCOPED = new Set(["edit", "create", "annotate", "reorder"]);
/** The clock hears an outline's event: every connection's, one rule. A draft is no change to what's stored. */
export function outlineHeard(e: HeardChange) {
  const c = e.change;
  if (c?.kind === "draft") return;
  // A block made under a note changes what is drawn beside it (a proposal, PIE-725): the note is named too.
  if (c) outlineChanged(c.blockId && SCOPED.has(c.kind) ? [c.blockId, ...(c.kind === "create" && c.parentId ? [c.parentId] : [])] : null);
  else if (e.action === "reconnected") outlineChanged([], true);   // the missed changes were replayed first
  else outlineChanged(null, e.action === "reset");
}
/** Now, for an answer being asked: later changes make it stale. */
export const changeClock = () => tick;
/** Did a block in `ids` (or everything) change after `at`? */
export function changedSince(at: number, ids: Iterable<string>): boolean {
  if (allAt > at) return true;
  for (const id of ids) if ((changedAt.get(id) ?? 0) > at) return true;
  return false;
}
/** Did anything change after `at`? */
export const anyChangeSince = (at: number) => anyAt > at;
/** Did the workspace change (a reconnect, a reset) after `at`? */
export const configChangedSince = (at: number) => configAt > at;

// ── asking again ──

/** What a tile says about a read it repeats. */
export interface AskSpec<T> {
  /** The read. It may pass `turn.signal` to its requests; a newer ask makes its answer go nowhere. */
  read(turn: SearchTurn): Promise<T>;
  /** The newest answer, only while no newer ask replaced it. */
  show(answer: T): void;
  /** The newest read failed: the tile says so (the host's next word, or the next change, asks again). */
  fail?(e: unknown): void;
  /** The ids it shows (or "any"): a change to them asks again, once per burst. Left out: only a reset or a reconnect does. */
  notes?: Notes;
  /** The questions the host watches for it, and the holder that hears them: an answer moving asks again, at once. */
  told?: { by: Watched; answers(): readonly unknown[] } | undefined;
}

/**
 * One read a tile repeats: the pause, latest-wins, cancellation and did-my-notes-change, in one place. `heard` is the
 * tile's pipe from `onEvent`; `now` is the first read, or the person's reload; `cancel` is the tile going away.
 */
export class AskAgain<T> {
  private readonly schedule = new SearchSchedule(RELOAD_PAUSE_MS);
  private seen: readonly unknown[] = [];
  private unlisten: (() => void) | null = null;
  private failed = false;
  constructor(private readonly spec: AskSpec<T>) {
    const told = spec.told;
    if (!told) return;
    this.seen = told.answers();
    this.unlisten = told.by.listen(() => {
      const now = told.answers(), moved = now.some((a, i) => a !== undefined && a !== this.seen[i]);
      // A first answer is what the first read is waiting for already, unless that read failed.
      const again = moved && (this.failed || now.some((a, i) => a !== undefined && this.seen[i] !== undefined && a !== this.seen[i]));
      this.seen = now;
      if (again) void this.now();
    });
  }

  /** A pause runs (a burst still coming in), so what's shown may be older than the outline. */
  get waiting(): boolean { return this.schedule.waiting; }

  /** The outline changed: asks again once the burst is over, when the change touches this read's notes. */
  heard(e: HeardChange): void { if (heardBy(e, this.spec.notes ?? (() => false))) this.soon(); }

  /** Asks again once the burst is over, whatever changed (the tile knows something else moved). */
  soon(): void { this.schedule.pause(() => void this.now()); }

  /** Asks now, replacing any read out; resolved once its answer is shown, or a newer ask replaced it. */
  async now(): Promise<void> {
    const turn = this.schedule.begin();
    try {
      const answer = await this.spec.read(turn);
      if (!turn.alive()) return;
      this.failed = false;
      this.spec.show(answer);
    } catch (e) {
      if (!turn.alive()) return;
      this.failed = true;
      this.spec.fail?.(e);
    }
  }

  /** Put away: no pause runs, an answer out goes nowhere, the host's word is no longer heard. */
  cancel(): void { this.schedule.cancel(); this.unlisten?.(); this.unlisten = null; }
}

/**
 * A tile's `AskAgain` for the place it's in now: a tile can move (a group spilled, a tile dropped in the drawer), and what
 * it read and repaints is that place's. A new place puts the old one's away and starts again from what the host says now.
 */
export class AskAgainAt<P, T> {
  private on: P | undefined;
  private again: AskAgain<T> | null = null;
  constructor(private readonly spec: (at: P) => AskSpec<T>) {}
  at(place: P): AskAgain<T> {
    if (!this.again || place !== this.on) { this.again?.cancel(); this.on = place; this.again = new AskAgain(this.spec(place)); }
    return this.again;
  }
  cancel(): void { this.again?.cancel(); this.again = null; }
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
