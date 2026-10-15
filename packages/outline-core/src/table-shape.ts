// A Markdown table, read as the cells it has and where each sits in the text (PIE-593): the one place that answers "what
// are this row's cells", for the reader that draws a table and the edit that changes one in place. Pure: no drawing,
// no draft. Spans are UTF-16 offsets into the line, the same unit the draft's `col` is.
//
// The rule rich edit keeps (floatty's table lost data by rebuilding the block): the text stays the only truth and an
// edit changes the bytes it must. A cell's new value replaces only the cell's own span, padding and separators stay as
// written; a row or column op touches the rows it must and keeps every other segment as it was.
//
// A table is a pipe row, a separator row (`| --- | :-: |`), then pipe rows. The detection is the reader's (src/doc.ts).

export type TableAlign = "l" | "c" | "r";

/** One cell: `text` as written (`\|` is `|`), `start`..`end` its trimmed content in the line (empty: where typing begins); `paddingEnd` is the following delimiter. */
export interface TableCell { text: string; start: number; end: number; paddingEnd: number }

/** A row's line, taken apart: what sits before the first pipe, the segments between pipes (padding kept), and what follows. */
export interface RowParts { indent: string; lead: boolean; segs: string[]; trail: boolean; tail: string }

/** `lines[i]` starts a table: a pipe row, then a separator row. */
export function startsTable(lines: readonly string[], i: number): boolean {
  return /^\s*\|/.test(lines[i] ?? "") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "");
}

/** The index after the last row of the table starting at `i` (every pipe row that follows the separator). */
export function tableEnd(lines: readonly string[], i: number): number {
  let end = i + 2;
  while (end < lines.length && /^\s*\|/.test(lines[end]!)) end++;
  return end;
}

/** The offsets of the unescaped pipes in `line`. */
function pipes(line: string): number[] {
  const at: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "|") at.push(i);
  }
  return at;
}

/** A row's line as parts: `join(parts(line)) === line`. */
export function rowParts(line: string): RowParts {
  const trimmed = line.trim();
  const indent = line.slice(0, line.length - line.trimStart().length), tail = line.slice(line.trimEnd().length);
  const at = pipes(trimmed);
  const lead = trimmed.startsWith("|"), trail = trimmed.endsWith("|") && at.length > 0 && at.at(-1) === trimmed.length - 1 && (at.length > 1 || !lead);
  const cuts = [...(lead ? [] : [-1]), ...at, ...(trail ? [] : [trimmed.length])];
  const segs: string[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) segs.push(trimmed.slice(cuts[k]! + 1, cuts[k + 1]!));
  return { indent, lead, segs, trail, tail };
}

/** The line a row's parts make. */
export function joinRow(p: RowParts): string {
  return `${p.indent}${p.lead ? "|" : ""}${p.segs.join("|")}${p.trail ? "|" : ""}${p.tail}`;
}

/** `\|` and `\\` read as the character they escape, as the reader does. */
export const cellEscapes = /\\[\s\S]/gu;
export const decodeCell = (raw: string): string => raw.replace(cellEscapes, escape => escape.slice(1));
/** A value as a cell writes it: `|` and `\` escaped, a line break a space. */
export const encodeCell = (value: string): string => value.replace(/\r?\n/g, " ").replace(/[\\|]/g, "\\$&");

/** A row's cells with their spans in `line`. */
export function tableCells(line: string): TableCell[] {
  const p = rowParts(line);
  const out: TableCell[] = [];
  let at = p.indent.length + (p.lead ? 1 : 0);
  for (const seg of p.segs) {
    const lead = seg.length - seg.trimStart().length, body = seg.trim();
    // An empty cell: typing begins after one space of padding when there is one, else at the pipe.
    const start = body ? at + lead : at + Math.min(1, seg.length), end = body ? start + body.length : start;
    out.push({ text: decodeCell(body), start, end, paddingEnd: at + seg.length });
    at += seg.length + 1;
  }
  return out;
}

/** A table block's alignments, from its separator row. */
export function tableAligns(separator: string): TableAlign[] {
  return tableCells(separator).map(c => (c.text.startsWith(":") && c.text.endsWith(":") ? "c" : c.text.endsWith(":") ? "r" : "l"));
}

/** How many columns the table has: the widest row. */
export function tableColumns(rows: readonly string[]): number {
  return Math.max(0, ...rows.map(r => tableCells(r).length));
}

/** The cell `col` of `line` with its value replaced: only its span changes; a row short of `col` is left alone. */
export function setCell(line: string, col: number, value: string): string {
  const cell = tableCells(line)[col];
  return cell ? line.slice(0, cell.start) + encodeCell(value) + line.slice(cell.end) : line;
}

const SEP_SEG = " --- ";
const EMPTY_SEG = "  ";

/** The row a new body row is: empty cells, written as the header's row is (indent, leading and trailing pipe). */
export function newRow(header: string, columns: number): string {
  const p = rowParts(header);
  return joinRow({ ...p, segs: Array.from({ length: Math.max(1, columns) }, () => EMPTY_SEG), tail: "" });
}

/**
 * `rows` is a table block (header, separator, body). Each op returns the new rows, and the row and column the caret
 * should be in after it (body rows count from 0 = the header). The separator is never a target; the header is never
 * removed or moved.
 */
export interface TableEdit { rows: string[]; row: number; col: number }

/** An empty row at `at` (a body position: 2 and up); the caret goes to its first cell. */
export function insertRow(rows: readonly string[], at: number): TableEdit {
  const to = Math.max(2, Math.min(rows.length, at));
  const next = [...rows];
  next.splice(to, 0, newRow(rows[0]!, tableColumns(rows)));
  return { rows: next, row: to, col: 0 };
}

/** Body row `at` taken out; the caret goes to the row now there (the one above at the end), nothing left: the header. */
export function removeRow(rows: readonly string[], at: number): TableEdit | null {
  if (at < 2 || at >= rows.length) return null;
  const next = rows.filter((_, i) => i !== at);
  return { rows: next, row: Math.min(at, next.length - 1) < 2 ? 0 : Math.min(at, next.length - 1), col: 0 };
}

/** Body row `from` moved to `to` (both body positions). */
export function moveRow(rows: readonly string[], from: number, to: number): TableEdit | null {
  if (from < 2 || from >= rows.length || to < 2 || to >= rows.length || from === to) return null;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return { rows: next, row: to, col: 0 };
}

const withSegs = (rows: readonly string[], change: (p: RowParts, i: number) => RowParts) => rows.map((line, i) => joinRow(change(rowParts(line), i)));

/** An empty column before column `at` (columns count from 0; `at` = the column count appends). */
export function insertColumn(rows: readonly string[], at: number): TableEdit {
  const cols = tableColumns(rows), to = Math.max(0, Math.min(cols, at));
  const next = withSegs(rows, (p, i) => {
    const segs = [...p.segs];
    while (segs.length < cols) segs.push(i === 1 ? SEP_SEG : EMPTY_SEG);
    segs.splice(to, 0, i === 1 ? SEP_SEG : EMPTY_SEG);
    return { ...p, segs, lead: true, trail: p.trail || to >= p.segs.length };
  });
  return { rows: next, row: 0, col: to };
}

/** Column `at` taken out of every row; the last column cannot be (a table has one). */
export function removeColumn(rows: readonly string[], at: number): TableEdit | null {
  const cols = tableColumns(rows);
  if (cols < 2 || at < 0 || at >= cols) return null;
  const next = withSegs(rows, p => ({ ...p, segs: p.segs.filter((_, k) => k !== at) }));
  return { rows: next, row: 0, col: Math.min(at, cols - 2) };
}

/** Column `from` moved to `to`. */
export function moveColumn(rows: readonly string[], from: number, to: number): TableEdit | null {
  const cols = tableColumns(rows);
  if (from < 0 || to < 0 || from >= cols || to >= cols || from === to) return null;
  const next = withSegs(rows, p => {
    const segs = [...p.segs];
    while (segs.length < cols) segs.push(EMPTY_SEG);
    const [seg] = segs.splice(from, 1);
    segs.splice(to, 0, seg!);
    return { ...p, segs };
  });
  return { rows: next, row: 0, col: to };
}
