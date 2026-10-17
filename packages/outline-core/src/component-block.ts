// Component blocks (Comark's `::name`, `--- yaml ---`, `::`): a figure such as `::graph-stat` or `::links` written
// into a note. Its lines are the component's question, never Markdown structure: the `---` around its YAML is not
// a setext underline and a `#` inside is not a heading. Every client that finds a note's headings, sections or
// folds asks this rule, so a section that holds a figure ends where Detail, the door and replaceSection all
// agree. Pure: no I/O.

import { closesCodeFence, codeBlocks, codeFenceOpen, fenceEnd, type CodeFence, type CodeFenceBlock } from "./code-fence";

/**
 * The opening line: `::` and a component name, indented at most three spaces (four is code), with or without
 * arguments (`::links ((id))`), or with attributes straight after the name (`::box{pad=1 list.gap=1}`, PIE-549's
 * block attributes; group 3). One with attributes is a block: it closes with `::`, as one without arguments does.
 */
export const COMPONENT_OPEN = /^ {0,3}::([a-z][a-z0-9-]*)(?:[ \t]+(\S[^\n]*?)|(\{[^{}\n]*\}))?[ \t]*$/;
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

// ── the call-site readers ────────────────────────────────────────────────────────────────────────────
// Two readers, each with one job (PIE-533): `componentAttrs` for the `{…}` after a component's name and a handler
// line's `--option=value` words, and `lineWords` for an action line (`act`, `@name`). Both split words the way a shell
// does, so quoting works the same wherever a person writes arguments.

/** The quotes a typed or pasted line may use, each with the one that closes it (a chat's curly ones too). */
const QUOTES: Record<string, string> = { '"': '"', "'": "'", "\u201c": "\u201d", "\u2018": "\u2019" };

/** One word of a line: what it means (quotes taken out) and what was written (`raw`, for text that isn't ours to read). */
export interface Word { value: string; raw: string }

/**
 * A line split into words as a shell splits a command: spaces between words, and a quote, anywhere in a word, keeps
 * what's inside it in that word without the quotes (`query="#build report"` is `query=#build report`). A backslash
 * keeps the next character as it is (`\ `, `\"`; inside double quotes only `\"` and `\\`, as a shell's), never inside single
 * quotes. An unclosed quote runs to the end. With `shell` off (a component's attributes, a handler line) a quote opens
 * only at the start of a word or right after its `=`, so an apostrophe inside a word (`Bob's`) is just text. A `{{ placeholder }}` is part of its word, spaces and quotes as written
 * (interpolation.ts fills it later, per value). With `lines`, one row per line.
 */
export function splitWords(line: string, lines: boolean, shell = true): Word[][] {
  const rows: Word[][] = [];
  let out: Word[] = [];
  let word = "", inWord = false, close: string | null = null, escaped = false, brace = false, from = 0, at = 0;
  const push = (end: number) => { out.push({ value: word, raw: line.slice(from, end) }); word = ""; inWord = false; };
  for (const c of line) {
    const here = at;
    at += c.length;
    // A placeholder: from its `{{` to its `}}`.
    if (brace) { word += c; if (c === "}" && word.endsWith("}}")) brace = false; continue; }
    if (c === "{" && !close && !escaped && word.endsWith("{") && !word.endsWith("\\{")) { word += c; brace = true; continue; }
    if (escaped) { word += (close && c !== close && c !== "\\") || c === "{" ? `\\${c}` : c; escaped = false; continue; }
    if (c === "\\" && close !== "'" && close !== "\u2019") { if (!inWord) from = here; escaped = true; inWord = true; continue; }
    if (close) { if (c === close) close = null; else word += c; continue; }
    if (QUOTES[c] && (shell || !inWord || word.endsWith("="))) { if (!inWord) from = here; close = QUOTES[c]!; inWord = true; continue; }
    if (/\s/.test(c)) {
      if (inWord) push(here);
      if (lines && c === "\n") { rows.push(out); out = []; }
      continue;
    }
    if (!inWord) from = here;
    word += c; inWord = true;
  }
  if (inWord) push(at);
  rows.push(out);
  return rows;
}

/** An action line's words, quotes taken out: the CLI's, the power bar's, a script's. */
export function lineWords(line: string): string[] { return splitWords(line, false).flat().map(word => word.value); }

/** One attribute word: `.class`, `key=value` (quotes already taken out), or a bare `key` (on). */
const ATTR_KEY = /^[A-Za-z][\w.-]*$/;

/**
 * A component's `{…}` attributes (`::box{pad=1 .accent}`, `::links{query="type=outbox-item" preview=right}`), as
 * written: its classes, and each `key=value` in order (a bare key's value is `on`). Values quote as a shell's words do
 * (`query="a b"`, `'a b'`, `a\ b`, a chat's curly quotes). The one reader of the braces: a box reads them as style
 * tokens, the links component as its own keys; a handler line's `--option=value` words are read by `splitWords` too.
 */
export function componentAttrs(attrs: string): { classes: string[]; pairs: { key: string; value: string }[] } {
  const classes: string[] = [], pairs: { key: string; value: string }[] = [];
  for (const { value: word } of splitWords(attrs, false, false).flat()) {
    const cls = /^\.([A-Za-z][\w-]*)$/.exec(word);
    if (cls) { classes.push(cls[1]!); continue; }
    const eq = word.indexOf("=");
    const key = eq < 0 ? word : word.slice(0, eq);
    if (ATTR_KEY.test(key)) pairs.push({ key, value: eq < 0 ? "on" : word.slice(eq + 1) });
  }
  return { classes, pairs };
}

/** A component block found in a note's lines: its name, its arguments, and its first and last line (inclusive). */
export interface ComponentBlock { name: string; args: string | null; start: number; end: number; attrs?: string }

/**
 * Every component block in a note's lines, in order, each as `componentBlockAt` reads it: `end` is its closing
 * `::` line, or `start` for a one-line opener with arguments. An opener inside a code fence is the code's text,
 * and an unclosed one is plain text. The one place a client finds where a figure or a `::links` starts and ends.
 */
export function componentBlocks(lines: readonly string[]): ComponentBlock[] {
  const out: ComponentBlock[] = [];
  const text = lines.join("\n"), offsets: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) offsets.push(at);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    const open = COMPONENT_OPEN.exec(line);
    const block = open && componentBlockAt(text.slice(offsets[i]));
    if (open && block) {
      const end = i + block.raw.replace(/\n$/, "").split("\n").length - 1;
      out.push({ name: open[1]!, args: open[2] ?? null, start: i, end, ...(open[3] ? { attrs: open[3].slice(1, -1) } : {}) });
      i = end;
      continue;
    }
    // A fence's lines are code, to its close or, unclosed, to its paragraph's end (fenceEnd).
    const fence = codeFenceOpen(line);
    if (fence) i = fenceEnd(lines, i, fence).end;
  }
  return out;
}

/**
 * Which component block or code fence each line of a note is part of (the line that opened it), or -1 for Markdown
 * structure. A fence inside a component is the component's question, and a component opener inside a fence is code.
 */
export function noteStructure(lines: readonly string[]): number[] {
  const block = new Array<number>(lines.length).fill(-1);
  for (const c of componentBlocks(lines)) for (let j = c.start; j <= c.end; j++) block[j] = c.start;
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) block[j] = f.start;
  return block;
}

/** The fenced code blocks of a note's lines outside its component blocks (a fence in a component is its question). */
export function noteCodeFences(lines: readonly string[]): CodeFenceBlock[] {
  const masked = [...lines];
  for (const c of componentBlocks(lines)) for (let j = c.start; j <= c.end; j++) masked[j] = "";
  return codeBlocks(masked).fences;
}

/**
 * `text` with a closing line after each fence it leaves open, where `codeBlocks` ends it (PIE-669: at its paragraph):
 * for a Markdown renderer, which would run an unclosed fence to the end, so the note draws as the service reads it.
 */
export function closeOpenFences(text: string): string {
  const lines = text.split("\n");
  const open = noteCodeFences(lines).filter(block => !block.closed);
  if (!open.length) return text;
  for (const block of [...open].reverse()) lines.splice(block.end + 1, 0, " ".repeat(block.fence.indent) + block.fence.char.repeat(block.fence.length));
  return lines.join("\n");
}
