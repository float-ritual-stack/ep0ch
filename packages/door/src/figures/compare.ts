// `::graph-compare` (PIE-577): two or three columns of Markdown rows, aligned by their label, so "A against B"
// reads across instead of as two notes or a wide table.
//
//   ::graph-compare
//   ---
//   title: beds
//   columns: [Raised beds, Grow bags]
//   ---
//   - cost: £60 of boards | £12 a bag
//   - drainage: good on clay | fine
//   - **lasts: ten years | two seasons**
//   ::
//
// A cell is the text between `|`s; a bold row is the accent. Under 60 columns the block stacks: each row is its
// label, then one line per column.
import { BOLD, drawEllipsized, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { rowLines, wrap } from "../text";
import { ACCENT, DIM, HI, INK, presentRow, records, rowLink, tier, type Props, type RowInline, type RowLink } from "./palette";

export interface Entry { label: string; cells: string[]; accent?: boolean; muted?: boolean; block?: string }

export function drawCompare(p: Props, w: number, link?: RowLink, ui?: { rows?: RowInline }): string[] {
  const entries: Entry[] = records(p.entries).map((e: Props) => ({ label: String(e.label ?? ""), cells: (Array.isArray(e.cells) ? e.cells : [e.cells ?? ""]).map(String), accent: !!e.accent, muted: !!e.muted, ...(typeof e.block === "string" ? { block: e.block } : {}) }));
  // As many columns as `columns:` names (two or three), else the widest row; a short row's missing cells are blank.
  const named: string[] = Array.isArray(p.columns) && p.columns.length ? p.columns.map(String).slice(0, 3) : [];
  const n = Math.max(2, Math.min(3, named.length || Math.max(0, ...entries.map(e => e.cells.length))));
  const columns = named.length ? named : Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  if (!entries.length) return wrap("no rows: `- label: a | b`", w).map(l => fg(DIM) + l + RESET);
  const ink = (e: Entry) => (e.accent ? fg(ACCENT) + BOLD : e.muted ? fg(DIM) : fg(INK));
  // A label's and a cell's words drawn as the note's line (PIE-1334): its links labelled and followable, its code and
  // bold as prose draws them. A label that is its note's link draws the links in it as links, not elements of their own.
  const tone = (e: Entry) => (e.accent ? ACCENT : e.muted ? DIM : INK);
  const label = (e: Entry) => ink(e) + rowLink(link, e.block, presentRow(e.label, tone(e), ui?.rows, !!link && typeof e.block === "string"));
  const cell = (e: Entry, text: string) => presentRow(text, e.muted ? DIM : INK, ui?.rows);
  // Stacked when narrow, and when three columns have less than the cozy width (the shared tiers; 3 wide needs 80).
  const stacked = tier(w) === "narrow" || w < 60 || (n === 3 && w < 80);
  if (stacked) {
    const cl = Math.min(Math.max(...columns.map(vwidth)), Math.max(4, w >> 1));
    return entries.flatMap((e, i) => [
      ...(i ? [""] : []),
      ...rowLines(label(e), w).map(l => ink(e) + l + UNBOLD + RESET),
      ...columns.flatMap((c, k) => rowLines(cell(e, e.cells[k] || " "), Math.max(4, w - cl - 4)).map((l, j) => "  " + fg(HI) + pad(j ? "" : drawEllipsized(c, cl), cl) + "  " + fg(INK) + l + RESET)),
    ]);
  }
  const lw = Math.min(Math.max(...entries.map(e => vwidth(label(e)))), Math.max(8, Math.floor(w * 0.3)));
  const cw = Math.max(6, Math.floor((w - lw - 3 * n) / n));
  const head = pad("", lw) + columns.map(c => fg(DIM) + " ┊ " + fg(HI) + pad(drawEllipsized(c, cw), cw)).join("") + RESET;
  const rule = fg(DIM) + "·".repeat(Math.min(w, lw + (cw + 3) * n)) + RESET;
  const body = entries.flatMap(e => {
    const labels = rowLines(label(e), lw), cells = columns.map((_, k) => rowLines(cell(e, e.cells[k] ?? ""), cw));
    const lines = Math.max(labels.length, ...cells.map(c => c.length));
    return Array.from({ length: lines }, (_, i) =>
      ink(e) + pad(labels[i] ?? "", lw) + UNBOLD + RESET
      + cells.map(c => fg(DIM) + " ┊ " + fg(INK) + pad(c[i] ?? "", cw)).join("") + RESET);
  });
  return [head, rule, ...body];
}

