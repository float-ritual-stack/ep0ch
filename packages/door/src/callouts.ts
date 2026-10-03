// The outline's callout types in the door (PIE-538): the one list (outline-core's built-ins plus what the
// outline declares, `callouts.types`) that the reader draws callouts with, the completer offers after `> [!`, and
// the type picker lists. Asked in the background, kept per connection, asked again after the outline changes
// (at most once a second); until the answer lands the built-ins (or the last answer) stand.
import { BUILTIN_CALLOUT_REGISTRY, calloutRegistry, type CalloutRegistry, type CalloutTone, type CalloutType } from "@ep0ch/outline-core/callouts";
import { anyChangeSince, changeClock } from "./refs";
import { C } from "./style";

interface Kept { registry: CalloutRegistry; raw: string; problems: string[]; at: number; when: number; asking: boolean; waking?: boolean; answer?: Promise<unknown> }
const keptBy = new WeakMap<object, Kept>();
/** How soon after an answer a change asks again: a burst of edits makes one more question, not one each. */
const AGAIN_MS = 1000;

/** What a connection can be asked (SocketBoard has it; a test double may not). */
type CalloutBoard = { calloutTypes?: () => Promise<{ types: CalloutType[]; problems: string[] }> };

/** The outline's callout types for this connection: the built-ins until (and unless) the service answers. */
export function calloutsOf(src: { board: unknown; redraw(): void } | null | undefined): CalloutRegistry {
  const b = src?.board as CalloutBoard | undefined;
  if (!src || !b || typeof b.calloutTypes !== "function") return BUILTIN_CALLOUT_REGISTRY;
  const hit = keptBy.get(b);
  if (hit && (hit.asking || !anyChangeSince(hit.at) || Date.now() - hit.when < AGAIN_MS)) {
    // A change inside the second after an answer: one redraw once it's over asks again.
    if (!hit.asking && !hit.waking && anyChangeSince(hit.at)) { hit.waking = true; setTimeout(() => { hit.waking = false; src.redraw(); }, AGAIN_MS).unref?.(); }
    return hit.registry;
  }
  const at = changeClock(), entry: Kept = { registry: hit?.registry ?? BUILTIN_CALLOUT_REGISTRY, raw: hit?.raw ?? "[]", problems: hit?.problems ?? [], at, when: Date.now(), asking: true };
  keptBy.set(b, entry);
  entry.answer = b.calloutTypes().then(
    r => {
      const raw = JSON.stringify(r.types), same = raw === entry.raw;
      keptBy.set(b, { registry: same ? entry.registry : calloutRegistry(r.types), raw, problems: r.problems, at, when: Date.now(), asking: false });
      if (!same) src.redraw();
    },
    () => keptBy.set(b, { ...entry, asking: false, when: Date.now() }),
  );
  return entry.registry;
}

/** Which answer `calloutsOf` gives now, for a cache of what was drawn with it (a reader's layout). */
let gen = 0;
const genOf = new WeakMap<CalloutRegistry, number>();
export function calloutsStamp(registry: CalloutRegistry): number {
  let n = genOf.get(registry);
  if (n === undefined) genOf.set(registry, (n = ++gen));
  return n;
}

/**
 * The outline's callout types once the question out now (if any) is answered: what the completer offers, so the
 * first `> [!` typed already lists the outline's own types.
 */
export async function calloutsReady(src: { board: unknown; redraw(): void }): Promise<CalloutRegistry> {
  calloutsOf(src);
  await keptBy.get(src.board as object)?.answer?.catch(() => {});
  return calloutsOf(src);
}

/** What's wrong with the outline's callout declarations, as the service last said. */
export const calloutProblems = (board: object): string[] => keptBy.get(board)?.problems ?? [];

/** A tone in the door's 16 colours. */
export const TONE: Readonly<Record<CalloutTone, number>> = { blue: C.lcyan, green: C.lgreen, violet: C.lmagenta, amber: C.yellow, coral: C.lred, neutral: C.grey };
