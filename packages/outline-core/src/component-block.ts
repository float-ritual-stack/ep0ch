// Component blocks (Comark's `::name`, `--- yaml ---`, `::`): a figure such as `::graph-stat` or `::links` written
// into a note. Its lines are the component's question, never Markdown structure: the `---` around its YAML is not
// a setext underline and a `#` inside is not a heading. Every client that finds a note's headings, sections or
// folds asks this rule, so a section that holds a figure ends where Detail, the door and replaceSection all
// agree. Pure: no I/O.

import { isEscapedAt } from "./property-grammar";
import { closesCodeFence, codeBlocks, codeFenceOpen, fenceEnd, type CodeFence, type CodeFenceBlock } from "./code-fence";

/**
 * The opening line: `::` and a component name, indented at most three spaces (four is code), with or without
 * arguments (`::links ((id))`), or with attributes straight after the name (`::box{pad=1 list.gap=1}`, PIE-549's
 * block attributes; group 3; a `{{ placeholder }}` may be inside them, `::status-card{status={{parent.status}}}`, and so may a button's `{slot}`, `::button{act="tile.zoom tile={target}" target=}`). One with attributes is a block: it closes with `::`, as one without arguments does.
 * A `^name` at the end of the line (group 4, PIE-747) is the component's id inside its note: `::links{query="…"} ^orders`.
 * It is the line anchor `((note^orders))` already points at, and the key a list's view state is kept under.
 */
export const COMPONENT_OPEN = /^ {0,3}::([a-z][a-z0-9-]*)(?:[ \t]+(?!\^[A-Za-z0-9][\w-]{0,63}[ \t]*$)(\S[^\n]*?)|(\{(?:[^{}\n]|\{\{[^\n]*?\}\}|\{[A-Za-z][\w.-]*\})*\}))?(?:[ \t]+\^([A-Za-z0-9][\w-]{0,63}))?[ \t]*$/;
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
  function* lines() {
    for (let at = 0; at < source.length;) {
      const next = source.indexOf("\n", at);
      yield source.slice(at, next < 0 ? source.length : next);
      if (next < 0) break;
      at = next + 1;
    }
  }
  const block = scanComponents(lines(), true).find(block => block.start === 0);
  if (!block) return null;
  let end = 0;
  for (let i = 0; i <= block.end; i++) {
    const next = source.indexOf("\n", end);
    end = next < 0 ? source.length : next + 1;
  }
  return { name: block.name, raw: source.slice(0, end) };
}

// ── the call-site readers ────────────────────────────────────────────────────────────────────────────
// Two readers, each with one job (PIE-533): `componentAttrs` for the `{…}` after a component's name and a handler
// line's `--option=value` words, and `lineWords` for an action line (`act`, `@name`). Both split words the way a shell
// does, so quoting works the same wherever a person writes arguments.

/** The quotes a typed or pasted line may use, each with the one that closes it (a chat's curly ones too). */
const QUOTES: Record<string, string> = { '"': '"', "'": "'", "\u201c": "\u201d", "\u2018": "\u2019" };

/** One word of a line: what it means (quotes taken out) and what was written (`raw`, for text that isn't ours to read). */
export interface Word { value: string; raw: string; quote?: string }

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
  let word = "", inWord = false, close: string | null = null, escaped = false, brace = false, list = false, from = 0, at = 0;
  const push = (end: number) => { out.push({ value: word, raw: line.slice(from, end), ...(close ? { quote: close } : {}) }); word = ""; inWord = false; };
  for (const c of line) {
    const here = at;
    at += c.length;
    // A placeholder: from its `{{` to its `}}`.
    // An unfinished one ends with its line: it never swallows the next action.
    if (brace && c === "\n") brace = false;
    if (brace) { word += c; if (c === "}" && word.endsWith("}}")) brace = false; continue; }
    if (c === "{" && !close && !escaped && word.endsWith("{") && !word.endsWith("\\{")) { word += c; brace = true; continue; }
    if (!shell && !close && !escaped && c === "[" && word.endsWith("=")) list = true;
    if (list) {
      word += c;
      if (escaped) { escaped = false; continue; }
      if (c === "\\" && close !== "'") { escaped = true; continue; }
      if (close) { if (c === close) close = null; }
      else if (c === '"' || c === "'") close = c;
      else if (c === "]") list = false;
      continue;
    }
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

/** `lineWords`'s inverse: a command's words as one line, a word with a space, a quote or a backslash quoted, an empty one `""`. */
export function commandLine(argv: readonly string[]): string { return argv.map(w => (w === "" || /[\s"'$\\]/.test(w) ? JSON.stringify(w) : w)).join(" "); }

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

/**
 * The attribute name or value being written; closed quotes and braces leave completion. A component call
 * (`::board{where="…"`) and a handler line (`board:: where="…"`, PIE-1472) are two spellings of one call to a script, so both
 * read here and `component` is the script's name either way.
 */
export function componentAttributeAtCursor(line: string, column: number): {
  component: string; kind: "attribute" | "attribute-value"; start: number; end: number; query: string;
  key?: string; quote?: string; existingValue?: boolean; attrs: { key: string; value: string }[];
} | null {
  const opening = /^ {0,3}(?:::([a-z][a-z0-9-]*)\{|(?:[-*+] {1,3})?([a-z][a-z0-9-]*):: )/.exec(line);
  if (!opening || column < opening[0].length) return null;
  const name = opening[1] ?? opening[2]!, braced = opening[1] !== undefined;
  const from = opening[0].length, before = line.slice(from, column);
  // A property chip inside a handler line (`img:: /tmp/a.jpg [size::4`) is the property's to complete, not a slot's.
  if (!braced && /\[[^\]]*$/.test(before)) return null;
  const words = splitWords(before, false, false).flat();
  const last = words.at(-1);
  const active = last && before.endsWith(last.raw) ? last : null;
  const start = active ? column - active.raw.length : column;
  const raw = active?.raw ?? "";
  const eq = raw.indexOf("=");
  const keyEnd = column + /^[\w.-]*/.exec(line.slice(column))![0].length;
  const rest = line.slice(start);
  const word = /^\s/.test(rest) ? undefined : splitWords(rest, false, false).flat()[0];
  const wordEnd = word ? start + word.raw.length : start;
  // Exclude the active word, but keep the producer and used keys on either side of it.
  const after = line.slice(wordEnd).replace(/}\s*$/, "");
  const attrs = componentAttrs(before.slice(0, start - from) + " " + after).pairs;
  if (braced && words.some(w => w.raw.endsWith("}") && !w.raw.endsWith("}}") && !w.quote)) return null;
  if (eq < 0) {
    return { component: name, kind: "attribute", start, end: keyEnd, query: active?.value ?? "", existingValue: line[keyEnd] === "=", attrs };
  }
  const key = raw.slice(0, eq), value = raw.slice(eq + 1), quote = QUOTES[value[0]!];
  if (quote && !active?.quote) return null;
  const valueStart = start + eq + 1 + Number(!!quote);
  const tail = line.slice(column);
  let remaining = quote ? tail.indexOf(quote) : tail.search(/[\s}]/);
  while (quote && remaining >= 0 && isEscapedAt(line, column + remaining)) remaining = tail.indexOf(quote, remaining + 1);
  const end = remaining < 0 ? line.length : column + remaining + Number(!!quote);
  return { component: name, kind: "attribute-value", start: valueStart, end, query: active!.value.slice(key.length + 1), key, quote, attrs };
}

/** A component block found in a note's lines: its name, its arguments, and its first and last line (inclusive). */
export interface ComponentBlock { name: string; args: string | null; start: number; end: number; attrs?: string; /** Its `^name` (PIE-747): the id it has inside its note. */ id?: string }

/**
 * Every component block in a note's lines, in order, each as `componentBlockAt` reads it: `end` is its closing
 * `::` line, or `start` for a one-line opener with arguments. An opener inside a code fence is the code's text,
 * and an unclosed one is plain text. The one place a client finds where a figure or a `::links` starts and ends.
 */
export function componentBlocks(lines: readonly string[]): ComponentBlock[] {
  const fenceStop = (start: number, fence: CodeFence) => fenceEnd(lines, start, fence).end;
  // A braced `::name{…}` may be a one-line call (a note component's, `::fields{…}`) or a block closed by `::`; only
  // the names say which. When reading it as a block takes the `::` an enclosing box needed, leaving the box
  // unclosed, it is the one-line call: read again with it inline, until every enclosing frame closes.
  const inlineAt = new Set<number>();
  for (;;) {
    const frames = scanFrames(lines, false, fenceStop, inlineAt);
    const taker = [...frames].reverse().find(f => f.closed && f.block.args === null && f.block.attrs !== undefined &&
      f.block.end > f.block.start && f.parent && !f.parent.closed);
    if (!taker) return frames.filter(frame => frame.closed).map(frame => frame.block);
    inlineAt.add(taker.block.start);
  }
}

/** One forward walk owns nesting for both the whole-note reader and the prefix reader. */
function scanComponents(lines: Iterable<string>, firstOnly = false, fenceStop?: (start: number, fence: CodeFence) => number): ComponentBlock[] {
  return scanFrames(lines, firstOnly, fenceStop).filter(frame => frame.closed).map(frame => frame.block);
}

type Frame = { block: ComponentBlock; fence: CodeFence | "yaml" | null; yamlSeen: boolean; closed: boolean; parent?: Frame };

/** The walk itself: every frame it opened, closed or not, each with the frame it sits in. `inlineAt`: openers read as one line. */
function scanFrames(lines: Iterable<string>, firstOnly: boolean, fenceStop?: (start: number, fence: CodeFence) => number, inlineAt?: ReadonlySet<number>): Frame[] {
  const frames: Frame[] = [], stack: Frame[] = [];
  const finish = (end?: number) => {
    const frame = stack.pop()!;
    if (end !== undefined) { frame.block.end = end; frame.closed = true; }
    else if (frame.block.args !== null) frame.closed = true;
  };
  let i = -1, skipThrough = -1;
  scan: for (const raw of lines) {
    i++;
    if (i <= skipThrough) continue;
    const line = raw.replace(/\r$/, "");
    let parent = stack.at(-1);
    if (parent) {
      if (parent.fence !== null && parent.fence !== "yaml") {
        if (closesCodeFence(line, parent.fence)) parent.fence = null;
        continue;
      }
      if (COMPONENT_CLOSE.test(line)) {
        finish(i);
        if (firstOnly && !stack.length) break;
        continue;
      }
      if (parent.fence === "yaml") {
        if (YAML_FENCE.test(line)) parent.fence = null;
        continue;
      }
    }
    const open = COMPONENT_OPEN.exec(line);
    while (parent && (parent.block.args !== null && !line.trim() ||
      parent.block.name !== "box" && (HEADING.test(line) || open))) {
      finish();
      if (firstOnly && !stack.length) break scan;
      parent = stack.at(-1);
    }
    if (open) {
      const block: ComponentBlock = { name: open[1]!, args: open[2] ?? null, start: i, end: i,
        ...(open[3] ? { attrs: open[3].slice(1, -1) } : {}), ...(open[4] ? { id: open[4] } : {}) };
      const inline = block.name === "use" || inlineAt?.has(i) || block.name === "button" && block.attrs !== undefined &&
        componentAttrs(block.attrs).pairs.some(p => p.key.toLowerCase() === "act" || p.key.toLowerCase() === "of");
      const frame: Frame = { block, fence: null, yamlSeen: false, closed: !!inline, ...(parent ? { parent } : {}) };
      frames.push(frame);
      if (!inline) stack.push(frame);
      else if (firstOnly && !stack.length) break;
      continue;
    }
    if (parent) {
      if (parent.block.name !== "box" && YAML_FENCE.test(line) && !parent.yamlSeen) {
        parent.fence = "yaml";
        parent.yamlSeen = true;
      } else parent.fence = codeFenceOpen(line);
    } else {
      if (firstOnly) break;
      const fence = codeFenceOpen(line);
      if (fence) skipThrough = fenceStop!(i, fence);
    }
  }
  // Unclosed components stay plain text; no suffix is retried for an unfinished child.
  while (stack.length) finish();
  return frames;
}

/**
 * Which component question or code fence each line belongs to, or -1 for note content. A box's body is note content;
 * only its opening and closing lines are structural. A component opener inside a fence is code.
 */
export function noteStructure(lines: readonly string[]): number[] {
  const block = new Array<number>(lines.length).fill(-1);
  for (const c of componentBlocks(lines)) {
    if (c.name === "box") { block[c.start] = c.start; block[c.end] = c.start; }
    else for (let j = c.start; j <= c.end; j++) block[j] = c.start;
  }
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) block[j] = f.start;
  return block;
}

/** Fences in note content, including box bodies; other components own their fences as input. */
export function noteCodeFences(lines: readonly string[]): CodeFenceBlock[] {
  const masked = [...lines];
  for (const c of componentBlocks(lines)) {
    if (c.name === "box") { masked[c.start] = ""; masked[c.end] = ""; }
    else for (let j = c.start; j <= c.end; j++) masked[j] = "";
  }
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
