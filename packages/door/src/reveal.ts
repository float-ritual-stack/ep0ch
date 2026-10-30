// Where a note should be shown when it is opened from a link (PIE-884): at an anchor the link names (`((id^anchor))`,
// `[[page#heading]]`), or at the line of the linking note that holds the reference (a backlinks row). The opener marks the
// note it read; the reader that shows that note takes the mark once, scrolls to the place and lights it (NoteSurface
// `takeReveal`). A list row, a followed link and `open fragment=` all go through this one place.
import type { Msg } from "./board";
import type { Actor } from "./socket";

/**
 * `fragment`: an anchor or heading id in the note; `at`: a character offset in its text (the line that links), with `label`,
 * the reference as written there, so a note edited since the service read it is searched for it rather than trusted.
 * `says`: why the line is lit, when it is not a link's (a `{{ }}` value shows the line it is written on).
 */
export interface Reveal { fragment?: string; at?: number; label?: string; says?: string;
  /** Open the note at this revision, beside how it is now (PIE-1433: the reader's revision compare). */
  revision?: number }

export const revealOn = new WeakMap<Msg, Reveal & { by: Actor }>();

/** Mark `note` (the object about to be shown) to be revealed at `reveal`, as `by` opened it. */
export function markReveal(note: Msg, reveal: Reveal | undefined, by: Actor): void {
  if (reveal && (reveal.fragment || reveal.at !== undefined || reveal.revision !== undefined)) revealOn.set(note, { ...reveal, by });
}
