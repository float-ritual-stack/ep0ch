// Where a note should be shown when it is opened from a link (PIE-884): at an anchor the link names (`((id^anchor))`,
// `[[page#heading]]`), or at the line of the linking note that holds the reference (a backlinks row). The opener marks the
// note it read; the reader that shows that note takes the mark once, scrolls to the place and lights it (NoteSurface
// `takeReveal`). A list row, a followed link and `open fragment=` all go through this one place.
import type { Msg } from "./board";
import type { Actor } from "./socket";

/** `fragment`: an anchor or heading id in the note; `at`: a character offset in its text (the line that links). */
export interface Reveal { fragment?: string; at?: number }

export const revealOn = new WeakMap<Msg, Reveal & { by: Actor }>();

/** Mark `note` (the object about to be shown) to be revealed at `reveal`, as `by` opened it. */
export function markReveal(note: Msg, reveal: Reveal | undefined, by: Actor): void {
  if (reveal && (reveal.fragment || reveal.at !== undefined)) revealOn.set(note, { ...reveal, by });
}
