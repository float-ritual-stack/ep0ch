// The door's side of watched reads (ADR 0004 contract 1): a figure, an inline ::links or anything else drawn from the
// outline asks its read once with `watch`, and the service says when the answer changed (`queries.changed` on the
// board's request connection). Nothing here drops answers on any change or asks again on paint: an answer is asked
// again only when the service says its generation moved, and what was shown stays until the new one comes.
//
// One holder per connection (`watchedOn(board)`). A read is identified by what it asks (action and params) and by
// `extra` (what the caller derives from it, when that differs); the service knows it by a short key of its own.
import type { QueryChange } from "@ep0ch/outline-core/protocol";

export type Watching<T> =
  | { state: "loading"; value?: undefined; error?: undefined }
  | { state: "ready"; value: T; error?: undefined }
  /** The read was refused or failed; `value` is the last answer, when there was one. */
  | { state: "error"; value?: T; error: string };

/** What a holder asks through: a connection's `request` (a SocketBoard, or a test's fake). */
export interface WatchSource { request<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T> }

interface Entry {
  key: string;
  signature: string;
  action: string;
  params: Record<string, unknown>;
  derive: (raw: any) => unknown;
  generation: number;
  /** Registered on the current connection: false after it closed, until asked again. */
  registered: boolean;
  shown: Watching<unknown>;
  /** A newer generation to ask for once the read in flight comes back. */
  again: number | null;
  asking: boolean;
  used: number;
  /** After a refusal or a failure, when a read may ask again (a refused question isn't kept, so nothing tells it). */
  retryAt: number;
}

/** How long a refused or failed read waits before a read asks again. */
export const RETRY_MS = 2000;

/** The most reads a door keeps watched on one connection (the service keeps 64; it drops the oldest past that). */
const KEEP = 60;

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export class Watched {
  private readonly entries = new Map<string, Entry>();
  private readonly byKey = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private next = 0;
  private clock = 0;

  constructor(private readonly source: WatchSource) {}

  /** Told when any answer arrives or a watch goes, until the returned function is called. */
  listen(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private told() { for (const fn of [...this.listeners]) fn(); }

  /**
   * The newest answer to `action` with `params`, `derive`d (it may ask more of the service), asked for in the
   * background the first time (and again after the connection was lost). Synchronous, for a renderer.
   */
  read<T>(action: string, params: Record<string, unknown>, derive: (raw: any) => T | Promise<T>, extra = ""): Watching<T> {
    const signature = `${action}\0${stable(params)}\0${extra}`;
    let entry = this.entries.get(signature);
    if (!entry) {
      entry = { key: `w${++this.next}`, signature, action, params, derive, generation: 0, registered: false, shown: { state: "loading" }, again: null, asking: false, used: 0, retryAt: 0 };
      this.entries.set(signature, entry);
      this.byKey.set(entry.key, entry);
    }
    entry.used = ++this.clock;
    this.trim(entry);
    if (!entry.registered && !entry.asking && Date.now() >= entry.retryAt) this.ask(entry);
    return entry.shown as Watching<T>;
  }

  /** Past KEEP, the reads least recently drawn are forgotten (never `keep`, the one being read, nor one in flight). */
  private trim(keep: Entry) {
    if (this.entries.size <= KEEP) return;
    const oldest = [...this.entries.values()].filter(e => e !== keep && !e.asking).sort((a, b) => a.used - b.used);
    for (const e of oldest.slice(0, this.entries.size - KEEP)) this.forget(e);
  }

  private forget(entry: Entry) {
    this.entries.delete(entry.signature);
    this.byKey.delete(entry.key);
  }

  /** Bumped when the connection is lost: an answer asked on the connection before is never taken as registered on this one. */
  private epoch = 0;

  private ask(entry: Entry, generation?: number) {
    entry.asking = true;
    entry.registered = true;
    const epoch = this.epoch;
    const asked = (async () => {
      try {
        const raw = await this.source.request<Record<string, unknown>>(entry.action, { ...entry.params, watch: entry.key, ...(generation !== undefined ? { generation } : {}) });
        // The generation is the answer's, known before deriving: a change told meanwhile is compared with it.
        if (epoch === this.epoch && typeof raw?.generation === "number") entry.generation = raw.generation;
        const value = await entry.derive(raw);
        entry.shown = { state: "ready", value };
      } catch (e) {
        entry.registered = false;
        entry.retryAt = Date.now() + RETRY_MS;
        const error = e instanceof Error ? e.message : String(e);
        entry.shown = { state: "error", error, ...(entry.shown.value !== undefined ? { value: entry.shown.value } : {}) } as Watching<unknown>;
      } finally {
        entry.asking = false;
      }
      // Asked on a connection that has since closed: the answer stands, the watch is registered again on the next read.
      if (epoch !== this.epoch) entry.registered = false;
      if (!this.byKey.has(entry.key)) return;
      if (entry.registered && entry.again !== null && entry.again > entry.generation) { const g = entry.again; entry.again = null; this.ask(entry, g); }
      else entry.again = null;
      this.told();
    })();
    this.inFlight.add(asked);
    void asked.finally(() => this.inFlight.delete(asked));
  }

  /**
   * The service's `queries.changed`: ask again what moved. A watch it dropped (past its bounds) keeps its answer and is
   * registered again by a read after RETRY_MS, so readers past the service's bounds never take turns evicting each other
   * on every paint.
   */
  changed(changes: readonly QueryChange[]) {
    for (const change of changes) {
      const entry = this.byKey.get(change.key);
      if (!entry) continue;
      if (change.dropped) { entry.registered = false; entry.again = null; entry.generation = 0; entry.retryAt = Date.now() + RETRY_MS; continue; }
      if (change.generation <= entry.generation) continue;
      if (entry.asking) entry.again = Math.max(entry.again ?? 0, change.generation);
      else this.ask(entry, change.generation);
    }
  }

  /** The connection closed: its watches ended with it. Each is registered again (from generation 0) when next read. */
  lost() {
    this.epoch += 1;
    for (const entry of this.entries.values()) { entry.registered = false; entry.generation = 0; entry.again = null; }
  }

  /** Once every answer asked for so far has come (and any those asked for in turn), or `ms` passed. */
  async settled(ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    while (this.inFlight.size && Date.now() < end) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all([...this.inFlight]), new Promise(r => { timer = setTimeout(r, Math.max(0, end - Date.now())); })]);
      clearTimeout(timer);
    }
  }
}

/** Holders for sources without one of their own (a test's fake board): reads are asked once, never told of changes. */
const fallback = new WeakMap<object, Watched>();

/** The holder of `board`'s watched reads: its own (a SocketBoard's), else one made for it. */
export function watchedOn(board: WatchSource & { watched?: Watched }): Watched {
  if (board.watched) return board.watched;
  let held = fallback.get(board);
  if (!held) fallback.set(board, held = new Watched(board));
  return held;
}
