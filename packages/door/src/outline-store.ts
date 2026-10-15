// What the door keeps about the outline beyond what a screen draws: a count the status bar shows and a list a tile
// lists, kept from the service's events (the change feed's, or a list the service answers). One shape for them:
// `heard(event)` takes the service's events, `count()` and `list()` say what is kept, `subscribe` tells whoever draws
// it. `WhatChanged` (src/desk/what-changed.ts) reads the feed's records; `ServiceList` is the other kind, a list the
// service answers (`agents.held`, src/held-asks.ts), read again once the outline is quiet. Both are read-only copies:
// the service decides what is in them.
import type { OutlineEvent } from "./socket";

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
 */
export abstract class ServiceList<Row, Board = unknown> extends OutlineStore {
  private rows: readonly Row[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private board: Board | null = null;
  private asked = 0;
  /** Wait this long after an event before asking again. */
  constructor(private readonly quietMs = 400) { super(); }

  /** Ask the service. */
  protected abstract read(board: Board): Promise<readonly Row[]>;
  /** Whether this event may have changed the list. */
  protected abstract wants(e: OutlineEvent): boolean;

  list(): readonly Row[] { return this.rows; }
  count(): number { return this.rows.length; }

  /** Read it now, and keep reading it as the outline changes. */
  async seed(board: Board): Promise<void> {
    this.board = board;
    await this.refresh();
  }

  heard(e: OutlineEvent): void {
    if (!this.board || !this.wants(e)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, this.quietMs);
  }

  private async refresh(): Promise<void> {
    const board = this.board;
    if (!board) return;
    const n = ++this.asked;
    const next = await this.read(board).catch(() => null);
    if (!next || n !== this.asked || JSON.stringify(next) === JSON.stringify(this.rows)) return;
    this.rows = next;
    this.notify();
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.board = null; }
}
