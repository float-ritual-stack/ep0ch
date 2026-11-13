// Tab and Shift+Tab in a draft: the lines a level in or out, and where the caret is after (PIE-1542, native H1).
//
// The rule is one, for every place a person writes Blockdown: the door's `Draft.indent` asks it of its lines, and a
// client that can't run this package (the native window's Rust) ports `indentText` once and is held to it by
// fixtures/core-contract.json (`indent`).
//
// - A list item goes under the item above it, by that item's marker and gap (its text's column), or back to its
//   parent's level.
// - Anything else moves two spaces, or one tab where the line is indented with tabs.
// - Every line moves by the first line's step, so the nesting inside a selection is kept; blank lines in a
//   selection of several stay as they are.
// - The caret stays on its text: it moves with its line, and never before the line's start.
// Pure: no I/O.
import { STEP_BOX } from "./checklist-marks";
import type { LocatedSpan } from "./draft-patch-compare";

/** A list item's lead: its indent, marker (`-`, `*`, `+`, `1.`, `1)`), the space after it and a `[ ]` box. */
export interface ListLead { indent: string; marker: string; gap: string; box: string; length: number }
const LIST_LEAD = new RegExp(`^([ \\t]*)([-*+]|\\d{1,9}[.)])([ \\t]+)(${STEP_BOX}(?:[ \\t]+|$))?`);

/** The list item `line` starts, or null. `- ` with nothing after it is an (empty) item; `-` alone isn't. */
export function listLead(line: string): ListLead | null {
  const m = LIST_LEAD.exec(line);
  return m ? { indent: m[1]!, marker: m[2]!, gap: m[3]!, box: m[4] ?? "", length: m[0].length } : null;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];
/** A line above `row` that says where it is: its list lead (none for prose) and how far in it starts. Blank lines say nothing. */
function* above(lines: readonly string[], row: number): Generator<{ lead: ListLead | null; ind: number }> {
  for (let r = row - 1; r >= 0; r--) {
    const l = lines[r]!;
    if (!l.trim()) continue;
    const lead = listLead(l);
    yield { lead, ind: lead ? lead.indent.length : indentOf(l).length };
  }
}

/** The nearest list item above `row` indented less than `than`: the item this one is nested in. */
export function listParent(lines: readonly string[], row: number, than: number): ListLead | null {
  for (const { lead, ind } of above(lines, row)) {
    if (ind < than) return lead;
    if (ind === 0) return null;
  }
  return null;
}

/** The nearest list item above `row` at exactly `indent`: the one this item follows. */
export function listSibling(lines: readonly string[], row: number, indent: number): ListLead | null {
  for (const { lead, ind } of above(lines, row)) {
    if (ind < indent) return null;
    if (lead && ind === indent) return lead;
  }
  return null;
}

/** A line that moves: `by` characters go in at its start (`put`, when positive) or that many of its indent go (negative). */
export interface LineShift { row: number; by: number }
/** What a level in or out does to lines `from`..`to`: what goes in at the start of a line that moves in, and each line that moves. */
export interface Indent { put: string; shifts: LineShift[] }

/**
 * Lines `from`..`to` of `lines` one level in (`dir` 1) or out (-1): which lines move and by how much. Nothing moves
 * when the first line has no level to go to (an outdent at the margin).
 */
export function indentShifts(lines: readonly string[], dir: 1 | -1, from: number, to: number): Indent {
  if (!lines.length) return { put: "", shifts: [] };
  from = Math.max(0, Math.min(lines.length - 1, from)); to = Math.max(from, Math.min(lines.length - 1, to));
  const first = lines[from]!, lead = listLead(first);
  const ind = lead ? lead.indent : indentOf(first);
  const tabs = ind.includes("\t");
  let step: number;
  if (dir > 0) {
    const sib = lead ? listSibling(lines, from, ind.length) : null;
    step = sib && !tabs ? sib.marker.length + sib.gap.length : tabs ? 1 : 2;
  } else {
    const up = lead ? listParent(lines, from, ind.length) : null;
    step = up && !tabs ? ind.length - up.indent.length : Math.min(ind.length, tabs ? 1 : 2);
  }
  const put = tabs ? "\t" : " ".repeat(Math.max(0, step));
  if (step <= 0) return { put, shifts: [] };
  const shifts: LineShift[] = [];
  for (let r = from; r <= to; r++) {
    const l = lines[r]!;
    if (!l.trim() && from !== to) continue;
    const by = dir > 0 ? step : -Math.min(step, indentOf(l).length);
    if (by) shifts.push({ row: r, by });
  }
  return { put, shifts };
}

/** Where a column of a line that moved `by` is after: with its text, and never before the line's start. */
export const shiftedCol = (col: number, by: number): number => Math.max(0, col + by);

/** A text one level in or out, for a client that holds its draft as one text and two offsets (UTF-16). */
export interface IndentedText {
  /** The spans to replace, in order and apart: one at the start of each line that moved. */
  spans: LocatedSpan[];
  /** Where the selection's two ends are once they are replaced. */
  anchor: number;
  cursor: number;
  /** How many lines moved. */
  lines: number;
}

/**
 * The line the cursor is on, or every line the selection touches (from `anchor` to `cursor`, either way round), one
 * level in or out: `indentShifts` over the text's lines, as spans of the text, with both ends kept on their text.
 */
export function indentText(text: string, dir: 1 | -1, anchor: number, cursor: number): IndentedText {
  const lines = text.split("\n"), starts: number[] = [];
  let at = 0;
  for (const line of lines) { starts.push(at); at += line.length + 1; }
  const place = (offset: number) => {
    const o = Math.max(0, Math.min(text.length, offset));
    let row = lines.length - 1;
    while (row > 0 && starts[row]! > o) row--;
    return { row, col: o - starts[row]! };
  };
  const a = place(anchor), c = place(cursor);
  const { put, shifts } = indentShifts(lines, dir, Math.min(a.row, c.row), Math.max(a.row, c.row));
  const spans = shifts.map(({ row, by }): LocatedSpan => by > 0
    ? { start: starts[row]!, end: starts[row]!, replacement: put }
    : { start: starts[row]!, end: starts[row]! - by, replacement: "" });
  const moved = (p: { row: number; col: number }) => {
    let offset = starts[p.row]!, col = p.col;
    for (const { row, by } of shifts) {
      if (row < p.row) offset += by;
      else if (row === p.row) col = shiftedCol(col, by);
    }
    return offset + col;
  };
  return { spans, anchor: moved(a), cursor: moved(c), lines: shifts.length };
}
