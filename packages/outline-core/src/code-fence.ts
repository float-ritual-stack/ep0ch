// The one code fence rule (CommonMark): which line opens a fence, which closes it, and which lines a fence holds
// (in list items too).
// Every reader that finds code asks it: the property parser and reference scanner (code-ranges.ts), component
// blocks and callouts, the door's reader and Detail's headings. Pure: no I/O.

/** A code fence's opening line: its character, its run's length, its indent in columns and its info string. */
export interface CodeFence { char: "`" | "~"; length: number; indent: number; info: string }

/** Leading blanks as columns (a tab runs to the next multiple of four), and where they end. */
export function leadingColumns(line: string): { columns: number; at: number } {
  let columns = 0, at = 0;
  for (; at < line.length; at++) {
    if (line[at] === " ") columns += 1;
    else if (line[at] === "\t") columns += 4 - columns % 4;
    else break;
  }
  return { columns, at };
}

/** The line without a trailing `\r` (a CRLF line split on `\n`). */
const content = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/**
 * The code fence `line` opens, or null (CommonMark): three or more backticks or tildes, indented zero to three
 * columns past `contentIndent` (a list item's content column; four is indented code), and after backticks an info
 * string with no backtick (otherwise the line is a code span).
 */
export function codeFenceOpen(line: string, contentIndent = 0): CodeFence | null {
  const text = content(line);
  const { columns, at } = leadingColumns(text);
  if (columns < contentIndent || columns - contentIndent > 3) return null;
  const char = text[at];
  if (char !== "`" && char !== "~") return null;
  let end = at;
  while (end < text.length && text[end] === char) end++;
  const length = end - at;
  if (length < 3) return null;
  const info = text.slice(end).replace(/^[ \t]+|[ \t]+$/g, "");
  if (char === "`" && info.includes("`")) return null;
  return { char, length, indent: columns, info };
}

/** Whether `line` closes `fence` (CommonMark): the same character, at least as many, then only blanks. */
export function closesCodeFence(line: string, fence: CodeFence, contentIndent = 0): boolean {
  const closing = codeFenceOpen(line, contentIndent);
  return !!closing && closing.char === fence.char && closing.length >= fence.length && closing.info === "";
}

/**
 * The last line of the fence `fence` opened on line `start` (a fence outside any list item): its closing line, or, never
 * closed, the line before the first blank line or fence opener after it (PIE-669), or the last line (`codeBlocks` says when it is
 * known never closed). The one bound for a reader that
 * walks a note's lines itself and meets a fence (`codeBlocks` is the whole-note scan).
 */
export function fenceEnd(lines: readonly string[], start: number, fence: CodeFence): { end: number; closed: boolean } {
  let stop = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (closesCodeFence(line, fence)) return { end: i, closed: true };
    const other = codeFenceOpen(line);
    if (stop < 0 && (/^[ \t]*\r?$/.test(line) || other)) stop = i;
    if (other && other.char === fence.char && other.length >= fence.length && other.info !== "") return { end: stop - 1, closed: false };
  }
  return { end: stop >= 0 ? stop - 1 : lines.length - 1, closed: false };
}

/** A fenced code block in a note's lines: its first and last line (inclusive), whether a closing line ends it, its fence. */
export interface CodeFenceBlock { start: number; end: number; closed: boolean; fence: CodeFence }

interface ListContainer { indent: number; contentIndent: number; contentOffset: number }

function listMarker(line: string): ListContainer | null {
  const match = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(line);
  if (!match) return null;
  const indent = leadingColumns(match[1]!).columns;
  // The marker and the blanks after it, counted from column zero as the service always has.
  const marker = match[0].slice(match[1]!.length).replace(/[^ \t]/g, " ");
  return { indent, contentIndent: indent + leadingColumns(marker).columns, contentOffset: match[0].length };
}

/**
 * The code blocks of a note's lines as CommonMark's block structure reads them: its fenced code (a fence in a list
 * item counts from the item's content column, so a fence nested under a bullet is code) and its indented code lines
 * (four columns past their container, after a blank line).
 *
 * One deviation (Blockdown, PIE-669): an unclosed fence ends at its paragraph, the line before the first blank line or
 * fence opener after it (or at the end of the list item it is in, if that comes first), never at the end of the note. What follows
 * is read as it would be without the fence, so a half-typed or half-streamed fence can't turn the rest of a note into
 * code. Only a fence with no blank line before the note's end runs to the end. A line that opens another fence like it
 * with an info string (```` ```ts ```` in a ```` ``` ```` fence) also says it was never closed: typed above a code
 * block, a fence doesn't pair with that block's closing line.
 */
export function codeBlocks(lines: readonly string[]): { fences: CodeFenceBlock[]; indented: number[] } {
  const fences: CodeFenceBlock[] = [], indented: number[] = [];
  let listContainers: ListContainer[] = [];
  let active: { block: CodeFenceBlock; contentIndent: number; resume: { listContainers: ListContainer[] } } | null = null;
  let activeIndentedCode = false;
  let canStartIndentedCode = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // A fence in a list item ends with the item: a nonblank line left of the item's content column ends both, and is
    // read as what it is.
    if (active && active.contentIndent > 0 && line.trim() && leadingColumns(line).columns < active.contentIndent) active = null;
    if (active) {
      active.block.end = i;
      const fence = active.block.fence;
      if (closesCodeFence(line, fence, active.contentIndent)) {
        active.block.closed = true;
        active = null;
        canStartIndentedCode = true;
        continue;
      }
      // Never closed: it ends at its paragraph, and the scan goes on from there as if it weren't there. A fence is
      // known never closed at the note's end, or at a line that opens another fence like it with an info string
      // (```` ```ts ````): in a fence that line would close it and leave its own code outside.
      const reopens = i < lines.length - 1 && (() => {
        const other = codeFenceOpen(line, active!.contentIndent);
        return !!other && other.char === fence.char && other.length >= fence.length && other.info !== "";
      })();
      if (reopens || i === lines.length - 1) {
        // Its paragraph: up to the first blank line, or the first line that opens a fence of its own (a code block it
        // was typed above keeps its opening line).
        const contentIndent = active.contentIndent;
        const stop = lines.findIndex((candidate, at) => at > active!.block.start && at <= i &&
          (/^[ \t]*\r?$/.test(candidate) || !!codeFenceOpen(candidate, contentIndent)));
        const end = stop >= 0 ? stop - 1 : i;
        if (end < i) {
          active.block.end = end;
          listContainers = active.resume.listContainers;
          active = null;
          i = end;
        }
      }
      continue;
    }
    if (/^[ \t]*\r?$/.test(line)) {
      canStartIndentedCode = true;
      continue;
    }
    const indent = leadingColumns(line).columns;
    while (listContainers.length > 0 && indent < listContainers[listContainers.length - 1]!.contentIndent) listContainers.pop();

    const marker = listMarker(line);
    const parent = listContainers[listContainers.length - 1];
    const startsListItem = marker !== null && (parent ? marker.indent - parent.contentIndent <= 3 : marker.indent <= 3);
    let contentIndent = parent?.contentIndent ?? 0;
    let openingLine = line;
    if (startsListItem) {
      listContainers.push(marker);
      activeIndentedCode = false;
      contentIndent = marker.contentIndent;
      openingLine = line.slice(marker.contentOffset);
    }

    const fence = codeFenceOpen(openingLine, startsListItem ? 0 : contentIndent);
    if (fence) {
      const block = { start: i, end: i, closed: false, fence };
      fences.push(block);
      active = { block, contentIndent, resume: { listContainers: [...listContainers] } };
      activeIndentedCode = false;
    } else if (!startsListItem) {
      const isIndented = indent - contentIndent >= 4;
      if (isIndented && (activeIndentedCode || canStartIndentedCode)) {
        indented.push(i);
        activeIndentedCode = true;
      } else if (!isIndented) {
        activeIndentedCode = false;
      }
    }
    canStartIndentedCode = false;
  }
  return { fences, indented };
}

/**
 * Each line's fence, by line: the index of the line that opened the fenced code block it is part of (its opening
 * and closing lines included), or -1 outside one (`codeBlocks`' fences).
 */
export function codeFenceLines(lines: readonly string[]): number[] {
  const out = new Array<number>(lines.length).fill(-1);
  for (const block of codeBlocks(lines).fences) for (let i = block.start; i <= block.end; i++) out[i] = block.start;
  return out;
}
