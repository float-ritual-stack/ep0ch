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
import { BOLD, ellipsize, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, records, rowLink, tier, type Props, type RowLink } from "./palette";

export interface Entry { label: string; cells: string[]; accent?: boolean; muted?: boolean; block?: string }

export function drawCompare(p: Props, w: number, link?: RowLink): string[] {
  const entries: Entry[] = records(p.entries).map((e: Props) => ({ label: String(e.label ?? ""), cells: (Array.isArray(e.cells) ? e.cells : [e.cells ?? ""]).map(String), accent: !!e.accent, muted: !!e.muted, ...(typeof e.block === "string" ? { block: e.block } : {}) }));
  // As many columns as `columns:` names (two or three), else the widest row; a short row's missing cells are blank.
  const named: string[] = Array.isArray(p.columns) && p.columns.length ? p.columns.map(String).slice(0, 3) : [];
  const n = Math.max(2, Math.min(3, named.length || Math.max(0, ...entries.map(e => e.cells.length))));
  const columns = named.length ? named : Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  if (!entries.length) return wrap("no rows: `- label: a | b`", w).map(l => fg(DIM) + l + RESET);
  const ink = (e: Entry) => (e.accent ? fg(ACCENT) + BOLD : e.muted ? fg(DIM) : fg(INK));
  // Stacked when narrow, and when three columns have less than the cozy width (the shared tiers; 3 wide needs 80).
  const stacked = tier(w) === "narrow" || w < 60 || (n === 3 && w < 80);
  if (stacked) {
    const cl = Math.min(Math.max(...columns.map(vwidth)), Math.max(4, w >> 1));
    return entries.flatMap((e, i) => [
      ...(i ? [""] : []),
      ...wrap(e.label, w).map((l, j) => ink(e) + (j ? l : rowLink(link, e.block, l)) + UNBOLD + RESET),
      ...columns.flatMap((c, k) => wrap(e.cells[k] || " ", Math.max(4, w - cl - 4)).map((l, j) => "  " + fg(HI) + pad(j ? "" : ellipsize(c, cl), cl) + "  " + fg(INK) + l + RESET)),
    ]);
  }
  const lw = Math.min(Math.max(...entries.map(e => vwidth(e.label))), Math.max(8, Math.floor(w * 0.3)));
  const cw = Math.max(6, Math.floor((w - lw - 3 * n) / n));
  const head = pad("", lw) + columns.map(c => fg(DIM) + " ┊ " + fg(HI) + pad(ellipsize(c, cw), cw)).join("") + RESET;
  const rule = fg(DIM) + "·".repeat(Math.min(w, lw + (cw + 3) * n)) + RESET;
  const body = entries.flatMap(e => {
    const labels = wrap(e.label, lw), cells = columns.map((_, k) => wrap(e.cells[k] ?? "", cw));
    const lines = Math.max(labels.length, ...cells.map(c => c.length));
    return Array.from({ length: lines }, (_, i) =>
      ink(e) + pad(i ? labels[i] ?? "" : rowLink(link, e.block, labels[0] ?? ""), lw) + UNBOLD + RESET
      + cells.map(c => fg(DIM) + " ┊ " + fg(INK) + pad(c[i] ?? "", cw)).join("") + RESET);
  });
  return [head, rule, ...body];
}

/** `- label: a | b | c`: the cells between `|`s. The YAML's `columns:` names them. */
export function compareMarkdown(md: Markdown): Props {
  return md.rows.length
    ? { entries: md.rows.map(r => ({ label: r.label ?? r.text, cells: (r.label === null ? "" : r.value).split(/\s*\|\s*/).map(s => s.trim()), accent: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block })) }
    : {};
}
