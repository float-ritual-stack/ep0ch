// The outline's callout types in the door (PIE-538): the one list (outline-core's built-ins plus what the
// outline declares, `callouts.types`) that the reader draws callouts with, the completer offers after `> [!`, and
// the type picker lists. Kept per connection by src/outline-lists.ts, as the heading styles are.
import { BUILTIN_CALLOUT_REGISTRY, calloutRegistry, type CalloutRegistry, type CalloutTone, type CalloutType } from "@ep0ch/outline-core/callouts";
import { outlineList } from "./outline-lists";
import { C } from "./style";

/** What a connection can be asked (SocketBoard has it; a test double may not). */
type CalloutBoard = { calloutTypes?: () => Promise<{ types: CalloutType[]; problems: string[] }> };

const CALLOUTS = outlineList<CalloutType, CalloutRegistry>(
  (b: CalloutBoard) => (typeof b.calloutTypes === "function" ? () => b.calloutTypes!().then(r => ({ items: r.types, problems: r.problems })) : undefined),
  calloutRegistry, BUILTIN_CALLOUT_REGISTRY,
);

/** The outline's callout types for this connection: the built-ins until (and unless) the service answers. */
export const calloutsOf = CALLOUTS.of;
/** Which answer `calloutsOf` gives now, for a cache of what was drawn with it (a reader's layout). */
export const calloutsStamp = CALLOUTS.stamp;
/**
 * The outline's callout types once the question out now (if any) is answered: what the completer offers, so the
 * first `> [!` typed already lists the outline's own types.
 */
export const calloutsReady = CALLOUTS.ready;
/** What's wrong with the outline's callout declarations, as the service last said. */
export const calloutProblems = CALLOUTS.problems;

/** A tone in the door's 16 colours. */
export const TONE: Readonly<Record<CalloutTone, number>> = { blue: C.lcyan, green: C.lgreen, violet: C.lmagenta, amber: C.yellow, coral: C.lred, neutral: C.grey };
