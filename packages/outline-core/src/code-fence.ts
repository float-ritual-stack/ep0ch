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
 * (four columns past their container, after a blank line). An unclosed fence runs to the end.
 */
export function codeBlocks(lines: readonly string[]): { fences: CodeFenceBlock[]; indented: number[] } {
  const fences: CodeFenceBlock[] = [], indented: number[] = [];
  const listContainers: ListContainer[] = [];
  let active: { block: CodeFenceBlock; contentIndent: number } | null = null;
  let activeIndentedCode = false;
  let canStartIndentedCode = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (active) {
      active.block.end = i;
      if (closesCodeFence(line, active.block.fence, active.contentIndent)) {
        active.block.closed = true;
        active = null;
        canStartIndentedCode = true;
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
      active = { block, contentIndent };
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
