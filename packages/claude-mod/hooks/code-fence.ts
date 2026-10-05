// A copy of outline-core's src/code-fence.ts: a hooks module can't import outside the plugin. outline-core's test/code-fence.test.ts keeps it identical.
// The one code fence rule (CommonMark): which line opens a fence, which closes it, and which lines a fence holds.
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
  const info = text.slice(end).trim();
  if (char === "`" && info.includes("`")) return null;
  return { char, length, indent: columns, info };
}

/** Whether `line` closes `fence` (CommonMark): the same character, at least as many, then only blanks. */
export function closesCodeFence(line: string, fence: CodeFence, contentIndent = 0): boolean {
  const closing = codeFenceOpen(line, contentIndent);
  return !!closing && closing.char === fence.char && closing.length >= fence.length && closing.info === "";
}

/**
 * Each line's fence, by line: the index of the line that opened the fence it is part of (its opening and closing
 * lines included), or -1 outside code. An unclosed fence runs to the end, as CommonMark reads it.
 */
export function codeFenceLines(lines: readonly string[]): number[] {
  const out: number[] = [];
  let open: CodeFence | null = null, at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (open) {
      out.push(at);
      if (closesCodeFence(lines[i]!, open)) open = null;
      continue;
    }
    open = codeFenceOpen(lines[i]!);
    at = open ? i : -1;
    out.push(at);
  }
  return out;
}
