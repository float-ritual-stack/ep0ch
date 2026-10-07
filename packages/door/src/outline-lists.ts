// What an outline declares in its notes and the door draws by (PIE-538 callout types, PIE-599 heading styles): one
// list a connection asks the service for in the background, keeps, and asks again after the outline changes (at most
// once a second). Until the answer lands the built-ins (or the last answer) stand. Each kind is one `outlineList`.
import { anyChangeSince, changeClock } from "./refs";

/** How soon after an answer a change asks again: a burst of edits makes one more question, not one each. */
const AGAIN_MS = 1000;

interface Kept<R> { registry: R; raw: string; problems: string[]; at: number; when: number; asking: boolean; waking?: boolean; answer?: Promise<unknown> }

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
}

/**
 * One kind of declared list: `ask` is the connection's question (absent on a test double: the built-ins stand), `build`
 * turns its answer into a registry, `builtin` is what stands until then.
 */
export function outlineList<T, R extends object>(ask: (board: any) => (() => Promise<{ items: T[]; problems: string[] }>) | undefined, build: (items: T[]) => R, builtin: R): OutlineList<R> {
  const keptBy = new WeakMap<object, Kept<R>>();
  const of = (src: ListSource | null | undefined): R => {
    const b = src?.board as object | undefined;
    const question = b && ask(b);
    if (!src || !b || !question) return builtin;
    const hit = keptBy.get(b);
    if (hit && (hit.asking || !anyChangeSince(hit.at) || Date.now() - hit.when < AGAIN_MS)) {
      // A change inside the second after an answer: one redraw once it's over asks again.
      if (!hit.asking && !hit.waking && anyChangeSince(hit.at)) { hit.waking = true; setTimeout(() => { hit.waking = false; src.redraw(); }, AGAIN_MS).unref?.(); }
      return hit.registry;
    }
    const at = changeClock(), entry: Kept<R> = { registry: hit?.registry ?? builtin, raw: hit?.raw ?? "[]", problems: hit?.problems ?? [], at, when: Date.now(), asking: true };
    keptBy.set(b, entry);
    entry.answer = question().then(
      r => {
        const raw = JSON.stringify(r.items), same = raw === entry.raw;
        keptBy.set(b, { registry: same ? entry.registry : build(r.items), raw, problems: r.problems, at, when: Date.now(), asking: false });
        if (!same) src.redraw();
      },
      () => keptBy.set(b, { ...entry, asking: false, when: Date.now() }),
    );
    return entry.registry;
  };
  let gen = 0;
  const genOf = new WeakMap<R, number>();
  return {
    of,
    async ready(src) { of(src); await keptBy.get(src.board as object)?.answer?.catch(() => {}); return of(src); },
    stamp(registry) { let n = genOf.get(registry); if (n === undefined) genOf.set(registry, (n = ++gen)); return n; },
    problems: board => keptBy.get(board)?.problems ?? [],
  };
}
