// A path as a terminal writes it (PIE-1656): a file dropped on a terminal pastes its path with the shell's escapes
// (`/made/up/LATE\ SHIFT.html`) or quoted (`'/made/up/LATE SHIFT.html'`, and `'it'\''s'` for a quote in it). One reader
// for every client: the media line's path (media-line.ts), the door's drop (paste-image.ts) and its file lookup
// (media.ts). Pure: no I/O.

/** `line` read as a shell reads words; `split` false: blanks are part of the one word. Null with a quote left open. */
function read(line: string, split: boolean): string[] | null {
  const words: string[] = [];
  let word = "", inWord = false, quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
      // Inside double quotes a backslash escapes only what a shell lets it: `"`, `\`, `$` and a backquote.
      else if (quote === '"' && c === "\\" && /["\\$`]/.test(line[i + 1] ?? "")) word += line[++i];
      else word += c;
      continue;
    }
    if (split && (c === " " || c === "\t")) { if (inWord) words.push(word); word = ""; inWord = false; continue; }
    inWord = true;
    if (c === "'" || c === '"') quote = c;
    else if (c === "\\" && i + 1 < line.length) word += line[++i];
    else word += c;
  }
  if (quote) return null;
  if (inWord) words.push(word);
  return words;
}

/** A line of a paste as a shell would read it: its words, quoted or with escaped characters; null with a quote left open. */
export const shellWords = (line: string): string[] | null => read(line, true);

/**
 * The file `value` names, read as a shell reads one word: `\ `, `\(` and any other escape stand for the character, and
 * quotes around it (or a part of it) go. A blank a terminal left as it is stays in the name (`/made/up/orbit lamp.html`
 * is one file). A value with no backslash that doesn't start with a quote is taken as written, so a quote inside a name
 * (`/made/up/Robin's page.html`) is never read as quoting; so is one whose quote is left open. Idempotent on a clean path.
 */
export function shellPath(value: string): string {
  const v = value.trim();
  if (!v.includes("\\") && !/^['"]/.test(v)) return v;
  return read(v, false)?.[0] ?? v;
}
