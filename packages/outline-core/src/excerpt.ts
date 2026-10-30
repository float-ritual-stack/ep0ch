// A note's excerpt (PIE-1443): the line of preview a list row shows under its title, the words after the header line
// with their markup taken out. The service answers it as the `excerpt` read field, so every client shows the same line.
import { noteTitleLine } from "./property-parse";
import { withoutPropertyTokens } from "./property-grammar";

/** How long an excerpt is when no length is asked: about two rows of a list pane. */
export const EXCERPT_LENGTH = 160;

/** Lines that are structure, not words: fences, components, rules, figure YAML's dashes. */
const SKIP = /^\s*(?:`{3,}|~{3,}|::|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/;
/** A line's lead-in: a heading's hashes, a list's bullet and box, a quote's `>` and a callout's `[!type]`. */
const LEAD = /^\s*(?:#{1,6}\s+|(?:>\s*)+(?:\[![\w-]+\][+-]?\s*)?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

/** The words of `text` after its title, as one line of at most `max` characters (an ellipsis when cut). */
export function noteExcerpt(text: string, max = EXCERPT_LENGTH): string {
  // After the line the title is read from (a first line of properties alone is no title: the next line is).
  const h = noteTitleLine(text);
  if (h.line < 0) return "";
  const words: string[] = [];
  let length = 0, fenced = false;
  for (const raw of text.split("\n").slice(h.line + 1)) {
    if (/^\s*(?:`{3,}|~{3,})/.test(raw)) { fenced = !fenced; continue; }
    if (fenced || SKIP.test(raw)) continue;
    // Tags at a line's end are the note's chips, which a row draws as chips: the excerpt keeps the words.
    const line = withoutPropertyTokens(raw).replace(LEAD, "").replace(/(?:^|\s+)(?:#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_/-]*\s*)+$/u, "")
      .replace(/\(\([^)|]*\|([^)]*)\)\)/g, "$1").replace(/\(\([^)]*\)\)/g, "")
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
      .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2").replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
      .replace(/\s+/g, " ").trim();
    if (!line) continue;
    words.push(line);
    length += line.length + 1;
    if (length > max) break;
  }
  const all = words.join(" ");
  return all.length <= max ? all : `${all.slice(0, max - 1).trimEnd()}…`;
}
