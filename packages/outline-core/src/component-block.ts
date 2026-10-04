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

/**
 * The component block that starts at the beginning of `source`: its name and its raw text through the closing
 * `::` line (and that line's newline). Without arguments it must close (`---` YAML `---` may hold blank lines); an
 * unclosed one is plain text. With arguments it closes before a blank line, or it is that one line (as the door
 * reads `::links ((id))`). Null when `source` doesn't open one.
 */
export function componentBlockAt(source: string): { name: string; raw: string } | null {
  const firstEnd = source.indexOf("\n");
  const open = COMPONENT_OPEN.exec(source.slice(0, firstEnd < 0 ? source.length : firstEnd).replace(/\r$/, ""));
  if (!open) return null;
  const oneLine = { name: open[1]!, raw: source.slice(0, firstEnd < 0 ? source.length : firstEnd + 1) };
  if (firstEnd < 0) return open[2] ? oneLine : null;
  let at = firstEnd + 1;
  while (at < source.length) {
    const next = source.indexOf("\n", at);
    const end = next < 0 ? source.length : next;
    const line = source.slice(at, end).replace(/\r$/, "");
    if (COMPONENT_CLOSE.test(line)) return { name: open[1]!, raw: source.slice(0, next < 0 ? end : end + 1) };
    if (open[2] && !line.trim()) break;
    at = end + 1;
  }
  return open[2] ? oneLine : null;
}
