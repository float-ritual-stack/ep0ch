// What @tidy does to one line, kept apart from tidy.ts (which reads its request from stdin) so the
// service's `outliner patch-demo` uses the same rules instead of a copy.

/** Links, references, anchors, properties and code: tidying never goes inside one. */
const PROTECTED = /\[\[[^\]\r\n]*\]\]|!?\(\([^)\r\n]*\)\)|\[[A-Za-z][A-Za-z0-9_.-]*::[^\]\r\n]*\]|(?<=\s)\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$|`[^`\r\n]*`/g;

function tidyGap(text: string): string {
  return text.replace(/\*\*\s+([^*\n]*?)\s+\*\*/g, "**$1**").replace(/ {2,}/g, " ");
}

/** One line: bullets as `-`, one space after a list marker and a heading's `#`, no runs of spaces, no trailing space. */
export function tidyLine(line: string): string {
  let out = line.replace(/\s+$/, "");
  out = out.replace(/^(\s*)[*+](\s+)/, "$1-$2").replace(/^(\s*)([-]|\d{1,9}[.)])\s{2,}/, "$1$2 ");
  out = out.replace(/^(#{1,6})(?=[^#\s])/, "$1 ");
  const lead = /^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?/.exec(out)![0];
  let body = "";
  let cursor = lead.length;
  for (const match of out.slice(lead.length).matchAll(PROTECTED)) {
    const at = lead.length + match.index!;
    body += tidyGap(out.slice(cursor, at)) + match[0];
    cursor = at + match[0].length;
  }
  return lead + body + tidyGap(out.slice(cursor));
}

/** Keep relative parent/child order, normalizing each increase to one two-space level. */
export function tidyPassage(lines: string[]): { replacement: string; message: string } {
  const indents: number[] = [];
  let nested = 0, trimmed = 0, formatted = 0;
  let fence = "";
  let parent: { indent: number; shift: number } | null = null;
  const replacement = lines.map(line => {
    const lead = /^\s*/.exec(line)![0].replaceAll("\t", "  ").length;
    const item = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+/.exec(line);
    // A continuation belongs to its item even across a blank line or inside a fenced example.
    if ((!item || fence) && parent && line.trim() && lead > parent.indent) {
      line = " ".repeat(Math.max(0, lead + parent.shift)) + line.trimStart();
    } else if (!item && line.trim() && lead === 0) parent = null;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""; return line; }
    if (fence) return line;
    let out = tidyLine(line);
    if (/\s+$/.test(line)) trimmed++;
    if (out !== line.trimEnd()) formatted++;
    if (item) {
      const indent = item[1]!.replaceAll("\t", "  ").length;
      while (indents.length && indent < indents.at(-1)!) indents.pop();
      if (!indents.length || indent > indents.at(-1)!) indents.push(indent);
      const lead = "  ".repeat(indents.length - 1);
      parent = { indent, shift: lead.length - indent };
      if (lead !== item[1]) { out = lead + out.slice(item[1]!.length); nested++; }
    } else if (out && !/^\s/.test(out)) indents.length = 0;
    return out;
  }).join("\n");
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const changes = [nested ? `fixed nesting in ${count(nested, "item")}` : "", trimmed ? `trimmed ${count(trimmed, "line")}` : "", formatted ? `formatted ${count(formatted, "line")}` : ""].filter(Boolean);
  return { replacement, message: changes.join(", ") || "nothing to tidy above" };
}
