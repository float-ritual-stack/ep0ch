// What @tidy does to one line, kept apart from tidy.ts (which reads its request from stdin) so the
// service's `outliner patch-demo` uses the same rules instead of a copy. Fences are outline-core's (the bundle).
import { blockReferenceOccurrences, codeFenceLines } from "./link-grammar.js";

/** Page links, anchors, properties and code: tidying never goes inside one. Block references are the grammar's (below). */
const PROTECTED = /\[\[[^\]\r\n]*\]\]|\[[A-Za-z][A-Za-z0-9_.-]*::[^\]\r\n]*\]|(?<=\s)\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$|`[^`\r\n]*`/g;

/** What tidying leaves as written in `text`, in order: PROTECTED's spans and every `((…))` (embeds' `!` too), label and all. */
function protectedSpans(text: string): { start: number; end: number }[] {
  const spans = [
    ...[...text.matchAll(PROTECTED)].map(m => ({ start: m.index!, end: m.index! + m[0].length })),
    ...blockReferenceOccurrences(text, []).map(r => ({ start: text[r.start - 1] === "!" ? r.start - 1 : r.start, end: r.end })),
  ].sort((a, b) => a.start - b.start);
  const kept: { start: number; end: number }[] = [];
  for (const span of spans) if (!kept.length || span.start >= kept.at(-1)!.end) kept.push(span);
  return kept;
}

function tidyGap(text: string): string {
  return text.replace(/\*\*\s+([^*\n]*?)\s+\*\*/g, "**$1**").replace(/ {2,}/g, " ");
}

export const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+/;

/** One line: bullets as `-`, one space after a list marker and a heading's `#`, no runs of spaces, no trailing space. */
export function tidyLine(line: string): string {
  let out = line.replace(/\s+$/, "");
  out = out.replace(/^(\s*)[*+](\s+)/, "$1-$2").replace(/^(\s*)([-]|\d{1,9}[.)])\s{2,}/, "$1$2 ");
  out = out.replace(/^(#{1,6})(?=[^#\s])/, "$1 ");
  const lead = /^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?/.exec(out)![0];
  let body = "";
  let cursor = lead.length;
  for (const span of protectedSpans(out.slice(lead.length))) {
    const at = lead.length + span.start;
    body += tidyGap(out.slice(cursor, at)) + out.slice(at, lead.length + span.end);
    cursor = lead.length + span.end;
  }
  return lead + body + tidyGap(out.slice(cursor));
}

/** Keep relative parent/child order, normalizing each increase to one two-space level. */
/** `fenced`: each line's fence as `codeFenceLines` reads the whole note (a passage cut from inside a fence can't tell). */
export function tidyPassage(lines: string[], fenced: readonly number[] = codeFenceLines(lines)): { replacement: string; message: string } {
  const indents: { indent: number; shift: number }[] = [];
  let nested = 0, trimmed = 0, formatted = 0;
  // Fenced code is code, by outline-core's one fence grammar: a `js` line inside a fence never closes it.
  const replacement = lines.map((line, at) => {
    const fence = fenced[at]! >= 0;
    const lead = /^\s*/.exec(line)![0].replaceAll("\t", "  ").length;
    const item = LIST_ITEM.exec(line);
    const parent = [...indents].reverse().find(item => item.indent < lead);
    // A continuation belongs to its item even across a blank line or inside a fenced example.
    if ((!item || fence) && parent && line.trim() && lead > parent.indent) {
      line = " ".repeat(Math.max(0, lead + parent.shift)) + line.trimStart();
    } else if (!item && line.trim() && lead === 0) indents.length = 0;
    if (fence) return line;
    let out = tidyLine(line);
    if (/\s+$/.test(line)) trimmed++;
    if (out !== line.trimEnd()) formatted++;
    if (item) {
      const indent = item[1]!.replaceAll("\t", "  ").length;
      while (indents.length && indent < indents.at(-1)!.indent) indents.pop();
      if (!indents.length || indent > indents.at(-1)!.indent) indents.push({ indent, shift: indents.length * 2 - indent });
      const lead = "  ".repeat(indents.length - 1);
      if (lead !== item[1]) { out = lead + out.slice(item[1]!.length); nested++; }
    } else if (out && !/^\s/.test(out)) indents.length = 0;
    return out;
  }).join("\n");
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const changes = [nested ? `fixed nesting in ${count(nested, "item")}` : "", trimmed ? `trimmed ${count(trimmed, "line")}` : "", formatted ? `formatted ${count(formatted, "line")}` : ""].filter(Boolean);
  return { replacement, message: changes.join(", ") || "nothing to tidy above" };
}
