// Where words selected on a published page are in the outline (PIE-774): the page sends what the reader selected as
// drawn (the quote, with the drawn words around it), and this finds them in the source of the blocks the page shows.
// Contract 5's passage is exact source text, so a selection is mapped, never guessed: found once (the drawn words
// around it pick among repeats), or refused with why.
//
// How a block's source reads as drawn, and which source each drawn word came from, is outline-core's to say
// (drawn-passage.ts, the one owner: a comment from any other client asks it too). What is the page's own is here: a
// page shows several blocks, so the words are looked for in each, and among repeats the one whose drawn words either
// side agree most with what the page sent is the place. A reference drawn as another note's title has no words of
// its own on a page's reading: a selection across it isn't found. Pure: no I/O.

import { drawnPlaces, drawnSpan, drawnText, quoteReadings, type DrawnText } from "@ep0ch/outline-core/drawn-passage";
import { passageAt, type Passage } from "@ep0ch/outline-core/passage";

/** One block the page shows: its id, revision and source. */
export interface ShownBlock {
  id: string;
  revision: number;
  text: string;
}

/** What the page sends: the words as selected, and the drawn words either side. */
export interface DrawnSelection {
  quote: string;
  prefix?: string;
  suffix?: string;
}

export type FoundPassage = { ok: true; block: ShownBlock; passage: Passage } | { ok: false; why: string };

/** How many characters of `a`'s end and `b`'s end agree (or of their starts, `fromStart`). */
function agreement(a: string, b: string, fromStart: boolean): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && (fromStart ? a[n] === b[n] : a[a.length - 1 - n] === b[b.length - 1 - n])) n += 1;
  return n;
}

/**
 * The passage in `blocks` that a selection on the page is: the source the selected words were drawn from. Found once,
 * or once among repeats by the drawn words around it; anything else is refused with why.
 */
export function findPagePassage(blocks: readonly ShownBlock[], selection: DrawnSelection): FoundPassage {
  if (!quoteReadings(selection.quote).length) return { ok: false, why: "nothing is selected: select some words first" };
  // The words around are read as the quote is: as they are, and as the source is read (a selection's edge may be mid-line).
  const prefixes = quoteReadings(selection.prefix ?? ""), suffixes = quoteReadings(selection.suffix ?? "");
  const most = (readings: string[], agrees: (words: string) => number) => Math.max(0, ...readings.map(agrees));
  type Hit = { block: ShownBlock; drawn: DrawnText; index: number; length: number; score: number };
  const hits: Hit[] = [];
  for (const block of blocks) {
    const drawn = drawnText(block.text), { words, places } = drawnPlaces(drawn, selection.quote);
    if (words.length > 4000) return { ok: false, why: "that selection is too long to mark: select at most a few paragraphs" };
    for (const index of places) {
      const score = most(prefixes, prefix => agreement(drawn.text.slice(Math.max(0, index - prefix.length), index).trimEnd(), prefix, false))
        + most(suffixes, suffix => agreement(drawn.text.slice(index + words.length, index + words.length + suffix.length).trimStart(), suffix, true));
      hits.push({ block, drawn, index, length: words.length, score });
    }
  }
  if (!hits.length) {
    return { ok: false, why: "those words aren't in this page's text as written (a selection across a link to another note, an embed or a figure can't be marked): select words in one passage" };
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > 1 && hits[0]!.score === hits[1]!.score) {
    return { ok: false, why: `those words are on this page ${hits.length} times: select a few more words around them` };
  }
  const { block, drawn, index, length } = hits[0]!;
  const { start, end } = drawnSpan(block.text, drawn, index, index + length);
  return { ok: true, block, passage: passageAt(block.text, start, end, block.id, block.revision) };
}
