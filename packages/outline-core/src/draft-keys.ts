// What an editor's keys do to a draft's Blockdown, beside Tab's rule (draft-indent.ts): Return on a list, lines moved,
// copied and deleted, a selection wrapped, a bracket paired and typed over, a checklist's box, the line, word or text
// selected, a line erased to its edge (native K3; the door's from PIE-1542 and PIE-1607).
//
// Each rule is one, for every place a person writes Blockdown. It takes the text and the selection's two ends (UTF-16
// offsets: `anchor` where it started, `cursor` where the caret is; the same place with nothing selected) and answers
// the text after, where the two ends are then, and the one span that makes the change. The door's `Draft` asks them of
// its text, and a client that can't run this package (the native window's Rust) ports each once and is held to it by
// fixtures/core-contract.json (`newline`, `lines`, `wrap`, `typed`, `select`, `erase`, `check`).
// Pure: no I/O.
import { CHECKLIST_MARKS, STEP_BOX, boxStatus } from "./checklist-marks";
import { COMPONENT_OPEN, componentBlocks, noteCodeFences } from "./component-block";
import { listLead, listParent } from "./draft-indent";
import type { LocatedSpan } from "./draft-patch-compare";
import { wordIn } from "./graphemes";
import { pageTitleLine } from "./page-title";

/** A draft after a key: its text, where the selection's two ends are, and the span that makes it from the text before (none: only the selection moved). */
export interface Keyed { text: string; anchor: number; cursor: number; spans: LocatedSpan[] }

/**
 * The one span that turns `before` into `after`: what is between their common start and their common end, never
 * splitting a character (a surrogate pair stays whole, so the span reads the same counted in bytes).
 */
export function changeSpan(before: string, after: string): LocatedSpan[] {
  if (before === after) return [];
  const low = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
  const most = Math.min(before.length, after.length);
  let start = 0;
  while (start < most && before[start] === after[start]) start++;
  if (start < most && low(before, start) && start > 0) start--;
  let tail = 0;
  while (tail < most - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  if (tail > 0 && low(before, before.length - tail)) tail--;
  return [{ start, end: before.length - tail, replacement: after.slice(start, after.length - tail) }];
}

/** A text as lines, and an offset as a row and a column of them. */
function rowsOf(text: string) {
  const lines = text.split("\n");
  const start = (row: number) => { let at = 0; for (let r = 0; r < row; r++) at += lines[r]!.length + 1; return at; };
  const place = (offset: number) => {
    let o = Math.max(0, Math.min(text.length, offset)), row = 0;
    while (row < lines.length - 1 && o > lines[row]!.length) { o -= lines[row]!.length + 1; row++; }
    return { row, col: o };
  };
  return { lines, start, place };
}
const offsetIn = (lines: readonly string[], row: number, col: number) => { let at = 0; for (let r = 0; r < row; r++) at += lines[r]!.length + 1; return at + Math.min(col, lines[row]!.length); };
const keyed = (before: string, lines: readonly string[], anchor: { row: number; col: number }, cursor: { row: number; col: number }): Keyed => {
  const text = lines.join("\n");
  return { text, anchor: offsetIn(lines, anchor.row, anchor.col), cursor: offsetIn(lines, cursor.row, cursor.col), spans: changeSpan(before, text) };
};
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];

/** The marker after `m`: the same bullet, or the next number with the same closer. */
export const nextMarker = (m: string) => (/^\d/.test(m) ? `${Number.parseInt(m, 10) + 1}${m.at(-1)}` : m);
/** An indent one level less: a tab, or two spaces. */
export const outdentBy = (ind: string) => (ind.endsWith("\t") ? ind.slice(0, -1) : ind.slice(0, Math.max(0, ind.length - 2)));

/** Whether line `row` opens a component with a body (not a one-line call) that no `::` closes yet, outside code. */
export function opensComponent(lines: readonly string[], row: number): boolean {
  const open = COMPONENT_OPEN.exec(lines[row]!);
  if (!open || open[2] !== undefined) return false;
  if (noteCodeFences(lines).some(f => row > f.start && row <= f.end)) return false;
  // Unclosed when a `::` after it closes one more component than the note has now: a closer already below may be an
  // inner component's (a box typed inside a box), so whether this line is paired isn't asked alone.
  const closer = [...lines.slice(0, row + 1), "::", ...lines.slice(row + 1)];
  return componentBlocks(closer).length > componentBlocks(lines).length;
}

/** What Return also does where a client can: `titles` a note whose first line is only `[page::x]`, and closes a component its line opens (`components`). */
export interface NewlineOptions { plain?: boolean; titles?: boolean; components?: boolean }

/**
 * Return at the cursor (a selection goes first). On a list item (`-`, `*`, `+`, `1.`, `1)`, with or without a `[ ]`
 * box, at any indent) the words after the cursor go to a new item: the same indent, the next marker, the same gap and
 * a fresh box. On an empty item it goes up to its parent's level instead (continuing the parent's numbering), and at
 * the top level the marker goes and the list ends. The cursor on the marker itself: the break goes before the item.
 * Any other line keeps its indent on the new one; a line of only blanks steps back a level. `plain`: just the break
 * (Shift+Return, Alt+Return).
 */
export function newlineText(text: string, anchor: number, cursor: number, options: NewlineOptions = {}): Keyed {
  const from = Math.min(anchor, cursor), to = Math.max(anchor, cursor);
  const { lines, place } = rowsOf(text.slice(0, from) + text.slice(to));
  let { row, col } = place(from);
  const plain = !!options.plain;
  const at = (r: number, c: number) => keyed(text, lines, { row: r, col: c }, { row: r, col: c });
  if (options.titles && row === 0 && col >= lines[0]!.trimEnd().length) {
    const titled = pageTitleLine(lines[0]!);
    if (titled !== null) { lines[0] = titled; col = titled.length; }
  }
  const line = lines[row]!;
  const lead = plain ? null : listLead(line);
  const c = lead && col < lead.length ? 0 : col;
  const rest = line.slice(c);
  if (lead && c >= lead.length) {
    if (!line.slice(lead.length).trim()) {
      const up = listParent(lines, row, lead.indent.length);
      const next = up ? up.indent + nextMarker(up.marker) + up.gap + (lead.box ? "[ ] " : "")
        : lead.indent ? outdentBy(lead.indent) + lead.marker + lead.gap + lead.box : "";
      lines[row] = next;
      return at(row, next.length);
    }
    const next = lead.indent + nextMarker(lead.marker) + lead.gap + (lead.box ? "[ ] " : "");
    lines[row] = line.slice(0, c);
    lines.splice(row + 1, 0, next + rest.replace(/^[ \t]+/, ""));
    return at(row + 1, next.length);
  }
  const indent = plain ? "" : indentOf(line);
  if (indent && !line.trim() && c === line.length) {
    lines[row] = outdentBy(indent);
    return at(row, lines[row]!.length);
  }
  const keep = indent && c >= indent.length ? indent : "";
  const closes = !plain && !!options.components && !rest.trim() && opensComponent(lines, row);
  lines[row] = line.slice(0, c);
  lines.splice(row + 1, 0, keep + (keep ? rest.replace(/^[ \t]+/, "") : rest));
  if (closes) lines.splice(row + 2, 0, indent + "::");
  return at(row + 1, keep.length);
}

/** What a line key does to the lines at the cursor. */
export const LINE_OPS = ["up", "down", "copy-up", "copy-down", "delete"] as const;
export type LineOp = (typeof LINE_OPS)[number];

/** The whole lines a line key acts on: the selection's (one that ends at a line's very start leaves that line out), else the cursor's. */
function wholeLines(a: { row: number; col: number }, c: { row: number; col: number }): [number, number] {
  const [first, last] = a.row < c.row || (a.row === c.row && a.col <= c.col) ? [a, c] : [c, a];
  return [first.row, last.col === 0 && last.row > first.row ? last.row - 1 : last.row];
}

/**
 * The cursor's line, or every whole line the selection touches: moved a line `up` or `down` (the selection with
 * them; nothing at the text's edge), written again above (`copy-up`: the cursor stays on the upper) or below
 * (`copy-down`: it goes to the copy), or taken out (`delete`: the cursor stays at its column on what comes up).
 */
export function lineOpText(text: string, anchor: number, cursor: number, op: LineOp): Keyed {
  const { lines, place } = rowsOf(text);
  const a = place(anchor), c = place(cursor);
  const [first, last] = wholeLines(a, c), n = last - first + 1;
  if (op === "up" || op === "down") {
    const by = op === "up" ? -1 : 1;
    if (first + by < 0 || last + by > lines.length - 1) return { text, anchor, cursor, spans: [] };
    lines.splice(first + by, 0, ...lines.splice(first, n));
    return keyed(text, lines, { row: a.row + by, col: a.col }, { row: c.row + by, col: c.col });
  }
  if (op === "copy-up" || op === "copy-down") {
    lines.splice(last + 1, 0, ...lines.slice(first, last + 1));
    const by = op === "copy-down" ? n : 0;
    return keyed(text, lines, { row: a.row + by, col: a.col }, { row: c.row + by, col: c.col });
  }
  lines.splice(first, n);
  if (!lines.length) lines.push("");
  const row = Math.min(first, lines.length - 1), at = { row, col: Math.min(c.col, lines[row]!.length) };
  return keyed(text, lines, at, at);
}

/**
 * What wraps a selection when typed over it (PIE-1607), as VS Code's Markdown does, with its closer: the inner text
 * stays selected, so `[[`, `((` and `**` are the key twice. Not `<` and `$`: no Blockdown form uses them, and typing
 * one over a word mostly means to replace it.
 */
export const WRAPS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}", "\"": "\"", "'": "'", "`": "`", "*": "*", "_": "_", "~": "~" };
/** What a bracket typed with nothing selected brings its closer with: the three that open a Blockdown form. Quotes and marks don't pair (an apostrophe, a bullet, a code fence are typed alone far more often). */
export const PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set(Object.values(PAIRS));

/** The selection between `open` and its closer (its mirror: `[[` closes with `]]`), the same text left selected, so the key again wraps again. Null with nothing selected. */
export function wrapText(text: string, anchor: number, cursor: number, open: string): Keyed | null {
  if (anchor === cursor || !open) return null;
  const from = Math.min(anchor, cursor), to = Math.max(anchor, cursor);
  const close = [...open].reverse().map(ch => WRAPS[ch] ?? ch).join("");
  const after = text.slice(0, from) + open + text.slice(from, to) + close + text.slice(to);
  return { text: after, anchor: anchor + open.length, cursor: cursor + open.length, spans: changeSpan(text, after) };
}

/** An empty item with a marker typed after it: `- -`, `  1. 2.`, `- [ ] *` (indent, the typed marker). */
const TYPED_MARKER = new RegExp(`^([ \\t]*)(?:[-*+]|\\d{1,9}[.)])[ \\t]+(?:${STEP_BOX}[ \\t]+)?([-*+]|\\d{1,9}[.)])$`);
/** A line that is an empty item with another marker typed on it, as that marker's own item (`- *` is `*`): what a space typed at its end makes of it. Null: any other line. */
export function typedMarker(line: string): string | null {
  const m = TYPED_MARKER.exec(line);
  return m ? m[1]! + m[2]! : null;
}

/**
 * One character typed, where it does more than go in at the cursor; null where it is only text (the editor types it).
 *
 * - Over a selection the person made, a wrap character wraps it (`wrapText`). Over one a client filled in for typing
 *   over (`filled`: a completion's example value), it replaces it as any character does.
 * - With nothing selected, a space at the end of an empty item that has another marker typed on it makes that marker
 *   the item's (`- ` then `* ` is `* `, never `- * `).
 * - A closing bracket typed where the same one stands is typed over: the cursor steps past it.
 * - An opening bracket typed before the line's end, a blank or a closing bracket brings its closer, the cursor
 *   between them. So `[[` is `[[]]` with the cursor inside, where a completion's token ends at the closer that is
 *   already there and writes none again.
 */
export function typedText(text: string, anchor: number, cursor: number, ch: string, filled = false): Keyed | null {
  if (anchor !== cursor) return !filled && Object.hasOwn(WRAPS, ch) ? wrapText(text, anchor, cursor, ch) : null;
  const next = text[cursor];
  const put = (after: string, at: number): Keyed => ({ text: after, anchor: at, cursor: at, spans: changeSpan(text, after) });
  if (ch === " " && (next === undefined || next === "\n")) {
    const start = text.lastIndexOf("\n", cursor - 1) + 1, made = typedMarker(text.slice(start, cursor));
    if (made !== null) return put(text.slice(0, start) + made + " " + text.slice(cursor), start + made.length + 1);
  }
  if (CLOSERS.has(ch) && next === ch) return { text, anchor: cursor + 1, cursor: cursor + 1, spans: [] };
  if (Object.hasOwn(PAIRS, ch) && (next === undefined || /\s/.test(next) || CLOSERS.has(next))) return put(text.slice(0, cursor) + ch + PAIRS[ch] + text.slice(cursor), cursor + 1);
  return null;
}

/** What `selectText` selects, and where `goText` goes. */
export const SELECTS = ["word", "line", "all"] as const;
export type SelectWhat = (typeof SELECTS)[number];
export const LINE_GOES = ["line-start", "line-end", "doc-start", "doc-end"] as const;
export type LineGo = (typeof LINE_GOES)[number];

/**
 * The word the cursor is on (a run of non-blanks, or the blank run it is in), its line (with whole lines already
 * selected: the next line too) or the whole text, selected: the anchor at its start, the cursor at its end.
 */
export function selectText(text: string, anchor: number, cursor: number, what: SelectWhat): { anchor: number; cursor: number } {
  if (what === "all") return { anchor: 0, cursor: text.length };
  const { lines, start, place } = rowsOf(text);
  const a = place(anchor), c = place(cursor);
  if (what === "word") { const w = wordIn(lines[c.row]!, c.col), at = start(c.row); return { anchor: at + w.start, cursor: at + w.end }; }
  const [first, last] = a.row < c.row || (a.row === c.row && a.col <= c.col) ? [a, c] : [c, a];
  const whole = anchor !== cursor && first.col === 0 && last.col === lines[last.row]!.length;
  const end = Math.min(whole ? last.row + 1 : last.row, lines.length - 1);
  return { anchor: start(first.row), cursor: start(end) + lines[end]!.length };
}

/** Where the cursor goes for a motion the text alone answers: its line's start or end (the line as written, however it wraps), the text's start or end. `extend` keeps the anchor where it was. */
export function goText(text: string, anchor: number, cursor: number, to: LineGo, extend = false): { anchor: number; cursor: number } {
  const at = Math.max(0, Math.min(text.length, cursor));
  const end = text.indexOf("\n", at);
  const landed = to === "doc-start" ? 0 : to === "doc-end" ? text.length : to === "line-start" ? text.lastIndexOf("\n", at - 1) + 1 : end < 0 ? text.length : end;
  return { anchor: extend ? anchor : landed, cursor: landed };
}

/** The selection taken out; with none, what is between the cursor and its line's start or end (nothing at that edge already). */
export function eraseText(text: string, anchor: number, cursor: number, to: "line-start" | "line-end"): Keyed {
  const edge = goText(text, cursor, cursor, to).cursor;
  const from = anchor !== cursor ? Math.min(anchor, cursor) : Math.min(edge, cursor), until = anchor !== cursor ? Math.max(anchor, cursor) : Math.max(edge, cursor);
  const after = text.slice(0, from) + text.slice(until);
  return { text: after, anchor: from, cursor: from, spans: changeSpan(text, after) };
}

/**
 * A checklist's box on the cursor's line, or on every line the selection touches (blank lines of several stay): an
 * open step (`[ ]`) is done (`[x]`), and a step in any other state is open again; a list item with no box gets an
 * open one; any other line becomes an item with one. Several lines all go where the first goes. The selection's two
 * ends stay on their text.
 */
export function checkText(text: string, anchor: number, cursor: number): Keyed {
  const { lines, place } = rowsOf(text);
  const a = place(anchor), c = place(cursor);
  const [first, last] = wholeLines(a, c);
  const boxOf = (line: string) => { const lead = listLead(line); return lead?.box ? lead.box.slice(0, 3) : null; };
  const firstBox = boxOf(lines[first]!);
  const mark = firstBox !== null && boxStatus(firstBox) === "todo" ? CHECKLIST_MARKS.done : CHECKLIST_MARKS.todo;
  const moved = (p: { row: number; col: number }, row: number, from: number, by: number) => { if (p.row === row && p.col >= from) p.col += by; };
  for (let row = first; row <= last; row++) {
    const line = lines[row]!;
    if (!line.trim() && first !== last) continue;
    const lead = listLead(line);
    if (lead?.box) {
      const at = lead.indent.length + lead.marker.length + lead.gap.length;
      lines[row] = line.slice(0, at) + mark + line.slice(at + 3);
    } else {
      const at = lead ? lead.length : indentOf(line).length, put = lead ? `${mark} ` : `- ${mark} `;
      lines[row] = line.slice(0, at) + put + line.slice(at);
      moved(a, row, at, put.length);
      if (c !== a) moved(c, row, at, put.length);
    }
  }
  return keyed(text, lines, a, c);
}
