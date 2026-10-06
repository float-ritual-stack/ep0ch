// An edit opened by mistake: `e`, then a `j` or `q` meant for the reader, became text. Esc closes such an edit at once
// instead of putting it aside as unsent (src/draft-session.ts), so accidental edits don't pile up `■ unsent` lines.
// No imports: the draft (src/edit.ts) asks it.

/** An edit open this briefly (ms), changed only by a few typed characters, was opened by mistake. */
export const STRAY_MS = 10_000;
/** At most this many characters typed into it, nothing taken out. */
export const STRAY_MAX = 3;

/**
 * The characters a stray edit picked up, or null when it's a real edit. Stray: open under STRAY_MS, and the text is the
 * one it opened on with one to STRAY_MAX characters typed into it and nothing deleted (an `e` that opened it, then a `j`
 * or `q` meant for the reader, became text). Esc closes such an edit at once, without putting it aside.
 */
export function strayKeys(original: string, text: string, openMs: number): string | null {
  const extra = text.length - original.length;
  if (openMs >= STRAY_MS || extra < 1 || extra > STRAY_MAX) return null;
  let i = 0, typed = "";
  for (let j = 0; j < text.length; j++) {
    if (i < original.length && text[j] === original[i]) i++;
    else typed += text[j];
  }
  return i === original.length && typed.length === extra ? typed : null;
}

/** "dropped 2 stray characters" */
export const strayWords = (typed: string) => `dropped ${typed.length} stray character${typed.length === 1 ? "" : "s"}`;
