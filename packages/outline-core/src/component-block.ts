// Component blocks (Comark's `::name`, `--- yaml ---`, `::`): a figure such as `::graph-stat` or `::links` written
// into a note. Its lines are the component's question, never Markdown structure: the `---` around its YAML is not
// a setext underline and a `#` inside is not a heading. Every client that finds a note's headings, sections or
// folds asks this rule, so a section that holds a figure ends where Detail, the door and replaceSection all
// agree. Pure: no I/O.

/**
 * The opening line: `::` and a component name, indented at most three spaces (four is code), with or without
 * arguments (`::links ((id))`).
 */
export const COMPONENT_OPEN = /^ {0,3}::([a-z][a-z0-9-]*)(?:[ \t]+(\S[^\n]*?))?[ \t]*$/;
/** The closing line: `::` alone. */
export const COMPONENT_CLOSE = /^[ \t]*::[ \t]*$/;

/** A Markdown heading (`## Rounds`): outside a component's YAML or code fence it ends the component unclosed. */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const YAML_FENCE = /^ {0,3}---[ \t]*$/;
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/**
 * The component block that starts at the beginning of `source`: its name and its raw text through the closing
 * `::` line (and that line's newline). Without arguments it must close (`---` YAML `---` may hold blank lines)
 * before a heading or another `::name` line outside its YAML and code fences; an unclosed one is plain text, so it never swallows the
 * sections after it. With arguments it closes before a blank line, or it is that one line (as the door reads
 * `::links ((id))`). Null when `source` doesn't open one.
 */
export function componentBlockAt(source: string): { name: string; raw: string } | null {
  const firstEnd = source.indexOf("\n");
  const open = COMPONENT_OPEN.exec(source.slice(0, firstEnd < 0 ? source.length : firstEnd).replace(/\r$/, ""));
  if (!open) return null;
  const oneLine = { name: open[1]!, raw: source.slice(0, firstEnd < 0 ? source.length : firstEnd + 1) };
  if (firstEnd < 0) return open[2] ? oneLine : null;
  let at = firstEnd + 1, fence: "yaml" | "code" | null = null, yamlSeen = false;
  while (at < source.length) {
    const next = source.indexOf("\n", at);
    const end = next < 0 ? source.length : next;
    const line = source.slice(at, end).replace(/\r$/, "");
    // `::` alone closes it anywhere but in a code fence (it isn't YAML); a heading only outside both fences.
    if (fence !== "code" && COMPONENT_CLOSE.test(line)) return { name: open[1]!, raw: source.slice(0, next < 0 ? end : end + 1) };
    if (fence === "yaml") { if (YAML_FENCE.test(line)) fence = null; }
    else if (fence === "code") { if (CODE_FENCE.test(line)) fence = null; }
    else {
      if (open[2] && !line.trim()) break;
      // A heading, or another component's first line, before a closing `::`: this one is unclosed (and the scan
      // stays linear: each opener reads at most to the next one).
      if (HEADING.test(line) || COMPONENT_OPEN.test(line)) break;
      if (YAML_FENCE.test(line) && !yamlSeen) { fence = "yaml"; yamlSeen = true; }
      else if (CODE_FENCE.test(line)) fence = "code";
    }
    at = end + 1;
  }
  return open[2] ? oneLine : null;
}
