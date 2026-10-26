// A block of lines put into a note after one of its lines, as a block of its own (PIE-1357): a blank line before it
// and after it, unless one is there already or it starts or ends the note. The one spacing rule for a part dropped
// into a note, whether the service patches the saved note or the door edits the person's own draft. Pure: no I/O.

import { codeBlocks } from "./code-fence";
import { componentBlocks } from "./component-block";

/**
 * The line a part dropped on line `line` goes after (PIE-1357): the end of the block it's in, its lines down to the one
 * before a blank line, and never inside a code fence or a component (a blank line in one doesn't end it: its closing
 * line does).
 */
export function landingLine(lines: readonly string[], line: number): number {
  let at = Math.max(0, Math.min(line, lines.length - 1));
  const holders = [...codeBlocks(lines).fences.map(f => ({ start: f.start, end: f.end })), ...componentBlocks(lines)];
  for (;;) {
    const holder = holders.find(h => at >= h.start && at < h.end);
    if (holder) { at = holder.end; continue; }
    if (at + 1 < lines.length && (lines[at] ?? "").trim() && (lines[at + 1] ?? "").trim()) { at++; continue; }
    return at;
  }
}

/** What line `after` of `lines` becomes with `block` put after it: that line, then the block, blank lines around it. */
export function blockAfter(lines: readonly string[], after: number, block: string): string {
  const line = lines[after] ?? "", next = lines[after + 1];
  const lead = line.trim() ? "\n" : "";
  const tail = next !== undefined && next.trim() ? "\n" : "";
  return `${line}\n${lead}${block}${tail}`;
}
