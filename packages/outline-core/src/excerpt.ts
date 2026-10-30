// A note's excerpt (PIE-1443): the line of preview a list row shows under its title, the words after the header line
// with their markup taken out. The service answers it as the `excerpt` read field, so every client shows the same line.
import { noteTitleLine } from "./property-parse";
import { withoutPropertyTokens } from "./property-grammar";
import { blockReferenceOccurrences, labelBar, pageLinkSpans } from "./link-syntax";

/** A line's links as their words, by the one link scan: `((id|label))` its label, `((id))` and `!((id))` nothing, `[[page|label]]` its label, `[[page]]` the page. */
function linkWords(line: string): string {
  const spans = [
    ...blockReferenceOccurrences(line).map(r => ({ start: line[r.start - 1] === "!" ? r.start - 1 : r.start, end: r.end, words: r.label?.trim() ?? "" })),
    ...pageLinkSpans(line).filter(p => p.depth === 0).map(p => { const inside = line.slice(p.start + 2, p.end - 2), bar = labelBar(inside); return { start: p.start, end: p.end, words: bar < 0 ? inside : inside.slice(bar + 1) }; }),
  ].sort((a, b) => b.start - a.start);
  let out = line;
  for (const s of spans) out = out.slice(0, s.start) + s.words + out.slice(s.end);
  return out;
}

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
  let component = false;
  const lines = text.split("\n").slice(h.line + 1);
  for (const [i, raw] of lines.entries()) {
    if (/^\s*(?:`{3,}|~{3,})/.test(raw)) { fenced = !fenced; continue; }
    // A component whose body is YAML (`::graph-stat` then `---` … `::`) is a figure, not words; a container's
    // (`::box` then prose) are words.
    if (!fenced && /^\s*::[\w-]+\s*$/.test(raw) && /^\s*---\s*$/.test(lines[i + 1] ?? "")) { component = true; continue; }
    if (component) { if (/^\s*::\s*$/.test(raw)) component = false; continue; }
    if (fenced || SKIP.test(raw)) continue;
    // Tags at a line's end are the note's chips, which a row draws as chips: the excerpt keeps the words.
    // Nothing a terminal acts on (an escape pasted into a note) reaches a row.
    const line = linkWords(withoutPropertyTokens(raw).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(LEAD, "").replace(/(?:^|\s+)(?:#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_/-]*\s*)+$/u, ""))
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
