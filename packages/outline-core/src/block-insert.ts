// A block of lines put into a note after one of its lines, as a block of its own (PIE-1357): a blank line before it
// and after it, unless one is there already or it starts or ends the note. The one spacing rule for a part dropped
// into a note, whether the service patches the saved note or the door edits the person's own draft. Pure: no I/O.

/** What line `after` of `lines` becomes with `block` put after it: that line, then the block, blank lines around it. */
export function blockAfter(lines: readonly string[], after: number, block: string): string {
  const line = lines[after] ?? "", next = lines[after + 1];
  const lead = line.trim() ? "\n" : "";
  const tail = next !== undefined && next.trim() ? "\n" : "";
  return `${line}\n${lead}${block}${tail}`;
}
