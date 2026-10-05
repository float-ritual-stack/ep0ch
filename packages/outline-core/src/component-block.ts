// Component blocks (Comark's `::name`, `--- yaml ---`, `::`): a figure such as `::graph-stat` or `::links` written
// into a note. Its lines are the component's question, never Markdown structure: the `---` around its YAML is not
// a setext underline and a `#` inside is not a heading. Every client that finds a note's headings, sections or
// folds asks this rule, so a section that holds a figure ends where Detail, the door and replaceSection all
// agree. Pure: no I/O.

import { closesCodeFence, codeFenceOpen, type CodeFence } from "./code-fence";

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
  // `fence` is "yaml" in the YAML, or the code fence it is in.
  let at = firstEnd + 1, fence: CodeFence | "yaml" | null = null, yamlSeen = false;
  while (at < source.length) {
    const next = source.indexOf("\n", at);
    const end = next < 0 ? source.length : next;
    const line = source.slice(at, end).replace(/\r$/, "");
    // `::` alone closes it anywhere but in a code fence (it isn't YAML); a heading only outside both fences.
    if ((fence === null || fence === "yaml") && COMPONENT_CLOSE.test(line)) return { name: open[1]!, raw: source.slice(0, next < 0 ? end : end + 1) };
    if (fence === "yaml") { if (YAML_FENCE.test(line)) fence = null; }
    else if (fence !== null) { if (closesCodeFence(line, fence)) fence = null; }
    else {
      if (open[2] && !line.trim()) break;
      // A heading, or another component's first line, before a closing `::`: this one is unclosed (and the scan
      // stays linear: each opener reads at most to the next one).
      if (HEADING.test(line) || COMPONENT_OPEN.test(line)) break;
      if (YAML_FENCE.test(line) && !yamlSeen) { fence = "yaml"; yamlSeen = true; }
      else fence = codeFenceOpen(line);
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
  let fence: CodeFence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (fence !== null) { if (closesCodeFence(line, fence)) fence = null; continue; }
    const open = COMPONENT_OPEN.exec(line);
    const block = open && componentBlockAt(text.slice(offsets[i]));
    if (open && block) {
      const end = i + block.raw.replace(/\n$/, "").split("\n").length - 1;
      out.push({ name: open[1]!, args: open[2] ?? null, start: i, end });
      i = end;
      continue;
    }
    fence = codeFenceOpen(line);
  }
  return out;
}

/**
 * Which component block or code fence each line of a note is part of (the line that opened it), or -1 for Markdown
 * structure. A fence inside a component is the component's question, and a component opener inside a fence is code.
 */
export function noteStructure(lines: readonly string[]): number[] {
  const block: number[] = [];
  const components = new Map(componentBlocks(lines).map(c => [c.start, c.end]));
  let fence: CodeFence | null = null, at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fence) { block.push(at); if (closesCodeFence(lines[i]!, fence)) fence = null; continue; }
    const end = components.get(i);
    if (end !== undefined) { for (let j = i; j <= end; j++) block.push(i); i = end; continue; }
    fence = codeFenceOpen(lines[i]!);
    at = fence ? i : -1;
    block.push(at);
  }
  return block;
}
