// What an outline declares in its notes and the door draws by (PIE-538 callout types, PIE-599 heading styles): one
// list a connection asks the service for in the background and keeps. On a connection with watched reads (a
// SocketBoard) the service says when the list changed (PIE-1546: it was asked again after every change, a tool's
// bookkeeping included); elsewhere it's asked again after the outline changes (once per burst). Until the answer
// lands the built-ins (or the last answer) stand. Each kind is one `outlineList`.
import { anyChangeSince, AskAgain, changeClock } from "./search-schedule";
import type { Watched } from "./watched";

interface Kept<R> { registry: R; raw: string; problems: string[]; at: number; asking: boolean; src: ListSource; again: AskAgain<{ items: unknown[]; problems: string[] }>; answer?: Promise<unknown> }

/** A source a reader has: its connection, and what repaints when an answer changes the list. */
export interface ListSource { board: unknown; redraw(): void }

export interface OutlineList<R> {
  /** The list for this connection: the built-ins until (and unless) the service answers. */
  of(src: ListSource | null | undefined): R;
  /** The list once the question out now (if any) is answered. */
  ready(src: ListSource): Promise<R>;
  /** Which answer `of` gives now, for a cache of what was drawn with it (a reader's layout). */
  stamp(registry: R): number;
  /** What's wrong with the outline's declarations, as the service last said. */
  problems(board: object): string[];
  /** Ask again at the next `of`, keeping the last answer until the new one lands (what it lists changed without an outline change). */
  stale(board: object): void;
}

/**
 * One kind of declared list: `ask` is the connection's question (absent on a test double: the built-ins stand), `build`
 * turns its answer into a registry, `builtin` is what stands until then.
 */
export function outlineList<T, R extends object>(ask: (board: any) => (() => Promise<{ items: T[]; problems: string[] }>) | undefined, build: (items: T[]) => R, builtin: R, watch?: { action: string; pick: (raw: any) => { items: T[]; problems: string[] } }): OutlineList<R> {
  const keptBy = new WeakMap<object, Kept<R>>();
  type Answer = { registry: R; problems: string[] };
  const derive = (raw: unknown): Answer => { const r = watch!.pick(raw); return { registry: build(r.items), problems: r.problems }; };
  const watchedOf = (b: object | undefined): Watched | undefined => (watch ? (b as { watched?: Watched } | undefined)?.watched : undefined);
  /**
   * Per connection: what `of` gives (the watched answer, or a read made after this door's own write to a declaration,
   * until the service tells a newer one), the watched answer last taken, and the reader that drew it last.
   */
  interface Shown { registry: R; problems: string[]; watched?: R; src: ListSource; fresh?: Promise<void> }
  const shownOf = new WeakMap<object, Shown>();
  const shownBy = (b: object, src: ListSource, w: Watched): Shown => {
    let kept = shownOf.get(b);
    if (!kept) {
      const made: Shown = { registry: builtin, problems: [], src };
      shownOf.set(b, kept = made);
      // The service told a newer answer: it stands, and the reader that drew last draws it.
      w.listen(() => { if (take(made, w)) made.src.redraw(); });
    }
    kept.src = src;
    take(kept, w);
    return kept;
  };
  /** The watched answer, when it moved since it was last taken: true when it did. */
  const take = (kept: Shown, w: Watched): boolean => {
    const now = w.read<Answer>(watch!.action, {}, derive, "", { held: true }).value;
    if (!now || now.registry === kept.watched) return false;
    kept.watched = now.registry; kept.registry = now.registry; kept.problems = now.problems;
    return true;
  };
  const of = (src: ListSource | null | undefined): R => {
    const b = src?.board as object | undefined;
    const w = watchedOf(b);
    if (src && b && w) return shownBy(b, src, w).registry;
    const question = b && ask(b);
    if (!src || !b || !question) return builtin;
    const hit = keptBy.get(b) ?? startKept(b, question, src);
    hit.src = src;
    // What's asked at draw time: the clock says something changed since this answer, so one read for the burst.
    if (!hit.asking && !hit.again.waiting && anyChangeSince(hit.at)) hit.again.soon();
    return hit.registry;
  };
  const startKept = (b: object, question: () => Promise<{ items: T[]; problems: string[] }>, src: ListSource): Kept<R> => {
    const kept: Kept<R> = { registry: builtin, raw: "[]", problems: [], at: changeClock(), asking: true, src, again: new AskAgain<{ items: unknown[]; problems: string[] }>({
      read: () => { kept.at = changeClock(); kept.asking = true; return question(); },
      show: r => {
        kept.asking = false;
        const raw = JSON.stringify(r.items), same = raw === kept.raw;
        kept.problems = r.problems;
        if (!same) { kept.raw = raw; kept.registry = build(r.items as T[]); kept.src.redraw(); }
      },
      fail: () => { kept.asking = false; },
    }) };
    keptBy.set(b, kept);
    kept.answer = kept.again.now();
    return kept;
  };
  let gen = 0;
  const genOf = new WeakMap<R, number>();
  return {
    of,
    async ready(src) {
      const b = src.board as object, w = watchedOf(b);
      if (w) { await w.answer(watch!.action, {}, derive, "", { held: true }); await shownOf.get(b)?.fresh; return of(src); }
      of(src); await keptBy.get(b)?.answer?.catch(() => {}); return of(src);
    },
    stamp(registry) { let n = genOf.get(registry); if (n === undefined) genOf.set(registry, (n = ++gen)); return n; },
    problems: board => (watchedOf(board) ? shownOf.get(board)?.problems ?? [] : keptBy.get(board)?.problems ?? []),
    stale(board) {
      // After this door's own write to a declaration (a tune saved): read it now, not when the service next tells.
      const kept = shownOf.get(board), question = ask(board);
      if (watchedOf(board)) {
        if (kept && question) kept.fresh = question().then(r => { kept.registry = build(r.items); kept.problems = r.problems; kept.src.redraw(); }, () => {});
        return;
      }
      const k = keptBy.get(board); if (k && !k.asking) k.answer = k.again.now();
    },
  };
}
