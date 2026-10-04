// A page names its own title (PIE-544). A note whose first line is only property tokens, one of them `[page::x]`,
// has no title of its own: it gets `x`, the page value as written, before the tokens (`[page::2026-09-30]` becomes
// `2026-09-30 [page::2026-09-30]`). The tokens stay. A first line with any other text keeps it, so a title that's
// already there is never overwritten. This file is the one rule: the service applies it to the texts clients write
// (`create`, `update`, `notes.create`, `capture.create`, `edit-recovery.commit`; not a quick-capture draft's idle saves), so the door, Detail, the CLI and agents agree, and the door's editor
// applies it as ⏎ leaves the first line. A change to what it matches bumps PROTOCOL (protocol.ts).
import { isPropertyTokenLine, propertyTokensInLine } from "./property-grammar";

/** The first line with the page's title put in front, or null when it has a title already (or names no page). */
export function pageTitleLine(line: string): string | null {
  if (!isPropertyTokenLine(line)) return null;
  const page = propertyTokensInLine(line).find(token => token.key === "page");
  if (!page?.value) return null;
  const indent = /^[ \t]*/.exec(line)![0];
  return `${indent}${page.value} ${line.slice(indent.length)}`;
}

/** `text` with its first line titled from its `[page::x]` when that line is only property tokens; else as it was. */
export function withPageTitle(text: string): string {
  const end = text.indexOf("\n");
  const first = end < 0 ? text : text.slice(0, end);
  const titled = pageTitleLine(first.endsWith("\r") ? first.slice(0, -1) : first);
  if (titled === null) return text;
  return titled + (first.endsWith("\r") ? "\r" : "") + (end < 0 ? "" : text.slice(end));
}
