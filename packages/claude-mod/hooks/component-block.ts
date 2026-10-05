// A copy of outline-core's src/component-block.ts: a hooks module can't import outside the plugin. outline-core's test/component-block.test.ts keeps it identical.
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
/** A code fence's opening line: its run of backticks or tildes (an info string after backticks has none). */
const CODE_FENCE = /^ {0,3}(`{3,}(?!.*`)|~{3,})/;

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
  // `fence` is "yaml" in the YAML, or a code fence's opening run (```, ~~~~): only that character, as many or more, closes it.
  let at = firstEnd + 1, fence: string | null = null, yamlSeen = false;
  while (at < source.length) {
    const next = source.indexOf("\n", at);
    const end = next < 0 ? source.length : next;
    const line = source.slice(at, end).replace(/\r$/, "");
    // `::` alone closes it anywhere but in a code fence (it isn't YAML); a heading only outside both fences.
    if ((fence === null || fence === "yaml") && COMPONENT_CLOSE.test(line)) return { name: open[1]!, raw: source.slice(0, next < 0 ? end : end + 1) };
    if (fence === "yaml") { if (YAML_FENCE.test(line)) fence = null; }
    else if (fence !== null) { if (closesFence(line, fence)) fence = null; }
    else {
      if (open[2] && !line.trim()) break;
      // A heading, or another component's first line, before a closing `::`: this one is unclosed (and the scan
      // stays linear: each opener reads at most to the next one).
      if (HEADING.test(line) || COMPONENT_OPEN.test(line)) break;
      if (YAML_FENCE.test(line) && !yamlSeen) { fence = "yaml"; yamlSeen = true; }
      else { const code = CODE_FENCE.exec(line); if (code) fence = code[1]!; }
    }
    at = end + 1;
  }
  return open[2] ? oneLine : null;
}

/** A component block found in a note's lines: its name, its arguments, and its first and last line (inclusive). */
export interface ComponentBlock { name: string; args: string | null; start: number; end: number }

/**
 * Every component block in a note's lines, in order, each as `componentBlockAt` reads it: `end` is its closing
 * `::` line, or `start` for a one-line opener with arguments. An opener inside a code fence is the code's text,
 * and an unclosed one is plain text. The one place a client finds where a figure or a `::links` starts and ends.
 */
export function componentBlocks(lines: readonly string[]): ComponentBlock[] {
  const out: ComponentBlock[] = [];
  const text = lines.join("\n"), offsets: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) offsets.push(at);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (fence !== null) { if (closesFence(line, fence)) fence = null; continue; }
    const open = COMPONENT_OPEN.exec(line);
    const block = open && componentBlockAt(text.slice(offsets[i]));
    if (open && block) {
      const end = i + block.raw.replace(/\n$/, "").split("\n").length - 1;
      out.push({ name: open[1]!, args: open[2] ?? null, start: i, end });
      i = end;
      continue;
    }
    const code = CODE_FENCE.exec(line);
    if (code) fence = code[1]!;
  }
  return out;
}

/** A line that closes the code fence `opened` (CommonMark): the same character, at least as many, then only spaces. */
function closesFence(line: string, opened: string): boolean {
  const run = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
  return !!run && run[0] === opened[0] && run.length >= opened.length;
}
