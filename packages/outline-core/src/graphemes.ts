// Where a cursor may stop in a line of text (PIE-1290): on a grapheme boundary, so one backspace, delete or arrow
// takes a whole character a person sees ("e" with its accent, a flag, a family emoji with its joiners), never half a
// surrogate pair or a dangling joiner. Every place a person types steps with these: the door's Draft (and the one
// line field built on it), the outliner's TextBuffer and its one-line filters. Columns are UTF-16 offsets.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** The start of the grapheme before `column`: where backspace and ← land. */
export function previousGraphemeStart(line: string, column: number): number {
  if (column <= 0) return 0;
  return graphemes.segment(line).containing(Math.min(column - 1, line.length - 1))?.index ?? 0;
}

/** The end of the grapheme at `column`: where delete erases to and → lands. */
export function nextGraphemeEnd(line: string, column: number): number {
  if (column >= line.length) return line.length;
  const g = graphemes.segment(line).containing(Math.max(0, column));
  return g ? g.index + g.segment.length : line.length;
}

/** `column` moved back to the start of the grapheme it falls in (and into the line). */
export function clampToGraphemeStart(line: string, column: number): number {
  const clamped = Math.max(0, Math.min(column, line.length));
  if (clamped === line.length) return clamped;
  return graphemes.segment(line).containing(clamped)?.index ?? clamped;
}

/** Whether `value` is one grapheme (a typed character, however many code units). */
export function isSingleGrapheme(value: string): boolean {
  if (!value) return false;
  const it = graphemes.segment(value)[Symbol.iterator]();
  const first = it.next();
  return !first.done && it.next().done === true;
}

/** `line` with the grapheme before `column` taken out, and where the cursor lands: one backspace. */
export function eraseBack(line: string, column: number): { text: string; column: number } {
  const at = previousGraphemeStart(line, column);
  return { text: line.slice(0, at) + line.slice(column), column: at };
}

/** Where ctrl+w (and alt+backspace) erases back to from `column`: the word before it and the spaces after that word, as a shell does. */
export function wordEraseStart(line: string, column: number): number {
  return line.slice(0, column).replace(/\S+\s*$/, "").length;
}

/** The first word's start in `line`, or null when it has none. */
export function firstWordStart(line: string): number | null {
  for (const w of words.segment(line)) if (w.isWordLike) return w.index;
  return null;
}

/** The last word's start in `line`, or null when it has none. */
export function lastWordStart(line: string): number | null {
  let start: number | null = null;
  for (const w of words.segment(line)) if (w.isWordLike) start = w.index;
  return start;
}

/** The start of the word `column` is in or after: where alt+← lands. */
export function wordStartBefore(line: string, column: number): number | null {
  let previous: number | null = null;
  for (const w of words.segment(line)) {
    if (!w.isWordLike) continue;
    const end = w.index + w.segment.length;
    if (w.index < column && end >= column) return w.index;
    if (w.index >= column) break;
    previous = w.index;
  }
  return previous;
}

/** The start of the next word after `column`: where alt+→ lands. */
export function wordStartAfter(line: string, column: number): number | null {
  for (const w of words.segment(line)) if (w.isWordLike && w.index > column) return w.index;
  return null;
}
