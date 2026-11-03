// What the door keeps about the outline beyond what a screen draws: a count the status bar shows and a list a tile
// lists, kept from the service's events (the change feed's, or a list the service answers). One shape for them:
// `heard(event)` takes the service's events, `count()` and `list()` say what is kept, `subscribe` tells whoever draws
// it. `WhatChanged` (src/desk/what-changed.ts) reads the feed's records; `ServiceList` is the other kind, a list the
// service answers (`agents.held`, src/held-asks.ts), read again once the outline is quiet. Both are read-only copies:
// the service decides what is in them.
import type { OutlineEvent } from "./socket";
import { watchedOn, type Watched, type WatchSource } from "./watched";

export abstract class OutlineStore {
  private readonly listeners = new Set<() => void>();
  /** Tell `fn` when what is kept changed (the status bar and the list redraw); returns how to stop. */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  protected notify(): void { for (const fn of this.listeners) fn(); }
  /** A live (or replayed) event from the service. */
  abstract heard(e: OutlineEvent): void;
  /** What the status bar counts. */
  abstract count(): number;
}

/**
 * A list the service answers, kept as it last answered: read once (`seed`) and again `quietMs` after an event that
 * `wants` it (a burst of events is one read). Reads can overlap: only the latest asked is taken, so a slow old answer
 * never puts back what has gone, and one that fails keeps what was there.
 *
 * A list the service can watch (`watched()` names its read, PIE-1546) is never asked again on an event: the service
 * says when its answer changed (src/watched.ts), evaluating it once for every door, and a change no answer can see (a
 * tool's bookkeeping) asks nothing. Only a reconnect reads it again.
 */
export abstract class ServiceList<Row, Board = unknown> extends OutlineStore {
  private rows: readonly Row[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private board: Board | null = null;
  private asked = 0;
  private unlisten: (() => void) | null = null;
  /** Wait this long after an event before asking again. */
  constructor(private readonly quietMs = 400) { super(); }

  /** Ask the service. */
  protected abstract read(board: Board): Promise<readonly Row[]>;
  /** Whether this event may have changed the list. */
  protected abstract wants(e: OutlineEvent): boolean;
  /** The watched read that answers it, when the service watches it: then `read` and `wants` are not used. */
  protected watched(): { action: string; params: Record<string, unknown> } | undefined { return undefined; }

  list(): readonly Row[] { return this.rows; }
  count(): number { return this.rows.length; }

  /** Read it now, and keep reading it as the outline changes. */
  async seed(board: Board): Promise<void> {
    this.board = board;
    const w = this.watched(), source = board as unknown as WatchSource & { watched?: Watched };
    if (w && typeof source?.request === "function") {
      const holder = watchedOn(source);
      this.unlisten?.();
      this.unlisten = holder.listen(() => this.take());
      await holder.answer(w.action, w.params, raw => raw, "", { held: true });
      return this.take();
    }
    await this.refresh();
  }

  /** The watched answer as it stands (asked in the background the first time, and after a reconnect). */
  private take(): void {
    const w = this.watched(), board = this.board as unknown as (WatchSource & { watched?: Watched }) | null;
    if (!w || !board) return;
    const shown = watchedOn(board).read<readonly Row[]>(w.action, w.params, raw => raw as readonly Row[], "", { held: true });
    if (shown.state === "loading" || shown.value === undefined) return;
    this.keep(shown.value);
  }

  private keep(next: readonly Row[]): void {
    if (JSON.stringify(next) === JSON.stringify(this.rows)) return;
    this.rows = next;
    this.notify();
  }

  heard(e: OutlineEvent): void {
    if (!this.board) return;
    if (this.watched()) { if (e.action === "reconnected" || e.action === "reset") this.take(); return; }
    if (!this.wants(e)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, this.quietMs);
  }

  private async refresh(): Promise<void> {
    const board = this.board;
    if (!board) return;
    const n = ++this.asked;
    const next = await this.read(board).catch(() => null);
    if (!next || n !== this.asked) return;
    this.keep(next);
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.board = null; this.unlisten?.(); this.unlisten = null; }
}
