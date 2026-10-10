// Exact selection to source (ADR 0004 contract 5, PIE-735 B4): where the words a reader drew are in the note's source.
//
// A reader draws a link by its label, bold without its stars, a page link without its brackets. A selection of drawn
// words is found in the source lines it covers by reading those lines as they're drawn: every character the reader
// hides (a reference's `((id|` and `))`, a page link's `[[`, a Markdown link's `](url)`, emphasis marks, a fragment
// anchor) is skipped, the rest is compared with what was selected (blanks as one space, since a wrapped line reads with
// a space where it broke). Found once, its offsets in the source are the passage's; a selection that starts or ends
// inside a link takes the whole link, so the quote is always source text that reads whole. A link drawn by its target's
// title (`((id))` with no label) has nothing in the source to match: that selection isn't exact, and a passage action
// says so instead of guessing. Mapping a drawn selection to source offsets stays the door's (ADR 0004); the passage it
// becomes is outline-core's.

import { fragmentAnchorMatch, linkOccurrences } from "@ep0ch/outline-core/link-syntax";

/** For each source character: drawn (true) or hidden by the reader (false); and the tokens a passage takes whole. */
function visibility(span: string): { shown: boolean[]; tokens: { start: number; end: number }[] } {
  const shown = new Array<boolean>(span.length).fill(true);
  const hide = (a: number, b: number) => { for (let i = Math.max(0, a); i < Math.min(span.length, b); i++) shown[i] = false; };
  const tokens: { start: number; end: number }[] = [];
  for (const l of linkOccurrences(span)) {
    tokens.push({ start: l.start, end: l.end });
    const raw = span.slice(l.start, l.end);
    if (l.kind === "markdown") {
      // `[text](url)`: only the text is drawn.
      hide(l.start, l.start + 1);
      hide(l.start + 1 + l.text.length, l.end);
    } else if (l.kind === "page") {
      // `[[address|label]]`: the label, else the address.
      const bar = raw.indexOf("|");
      hide(l.start, l.start + 2); hide(l.end - 2, l.end);
      if (bar >= 0) hide(l.start + 2, l.start + bar + 1);
    } else {
      // `((id|label))`: the label; `((id))` draws its target's title, which isn't in the source at all.
      const bar = raw.indexOf("|");
      if (bar >= 0) { hide(l.start, l.start + bar + 1); hide(l.end - 2, l.end); }
    }
  }
  // Emphasis and code marks are drawn as style, not characters.
  for (const m of span.matchAll(/\*\*|__|~~|`/g)) hide(m.index!, m.index! + m[0].length);
  // A fragment anchor at a line's end isn't drawn.
  let at = 0;
  for (const line of span.split("\n")) {
    const a = fragmentAnchorMatch(line);
    if (a) hide(at + a.index!, at + line.length);
    at += line.length + 1;
  }
  return { shown, tokens };
}

/**
 * Where `seen` (drawn text) is in `span` (source text): offsets into `span`, widened to whole links at either edge;
 * null when it isn't there once.
 */
export function sourceSpanOf(span: string, seen: string): { from: number; to: number } | null {
  const want = seen.replace(/\s+/g, " ").trim();
  if (!want) return null;
  const { shown, tokens } = visibility(span);
  // The drawn text, blanks folded to one space, with each character's offset in the source.
  let drawn = "";
  const at: number[] = [];
  let blank = false;
  for (let i = 0; i < span.length; i++) {
    if (!shown[i]) continue;
    if (/\s/.test(span[i]!)) { blank = true; continue; }
    if (blank && drawn) { drawn += " "; at.push(i - 1); }
    blank = false;
    drawn += span[i]; at.push(i);
  }
  const first = drawn.indexOf(want);
  if (first < 0 || drawn.indexOf(want, first + 1) >= 0) return null;
  let from = at[first]!, to = at[first + want.length - 1]! + 1;
  for (const t of tokens) {
    if (from > t.start && from < t.end) from = t.start;
    if (to > t.start && to < t.end) to = t.end;
  }
  // Emphasis marks right at the edges go with the words they style.
  while (from > 0 && !shown[from - 1] && /[*_~`]/.test(span[from - 1]!)) from--;
  while (to < span.length && !shown[to] && /[*_~`]/.test(span[to]!)) to++;
  return { from, to };
}
