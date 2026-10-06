// `::graph-matrix` (PIE-576): counts over two properties, a heatmap. `down:` names the property that makes the rows,
// `across:` the columns; live, each cell counts the results with that pair (or sums `value:`); static, a row
// `- row: col=3 col2=1`.
//
//   ::graph-matrix                              ::graph-matrix
//   ---                                         ---
//   title: who catches what                     title: house jobs (live)
//   ---                                         query: "type=roadmap-item project=house"
//   - CodeRabbit: edges=80 identity=2           down: arc
//   - ultrareview: identity=4 parsers=1         across: work-stage
//   ::                                          order-across: [doing, review, queued, done]
//                                               ---
//                                               ::
//
// Cells are toned by their share of the largest; an empty cell is a dot. Narrow, the column heads are cut to fit.
import { ellipsize, fg, pad, RESET, width as vwidth } from "../style";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, ordered, type Props } from "./palette";

const SHADES = ["·", "░", "▒", "▓", "█"];
const shade = (n: number, max: number) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / Math.max(1, max)) * 4))));

export function drawMatrix(p: Props, w: number): string[] {
  // Cells as a map of maps, whatever the YAML gave (a row named `constructor` is a row, not Object's).
  const cells = cellsOf(p.cells);
  const rows = ordered(p["order-down"], [...cells.keys()]);
  const cols = ordered(p["order-across"], [...cells.values()].flatMap(r => [...r.keys()]));
  if (!rows.length || !cols.length) return [fg(DIM) + "no cells: rows are `- row: col=n …`, or down: and across: name two properties" + RESET];
  const lw = Math.min(Math.max(...rows.map(vwidth)), Math.max(6, Math.floor(w / 3)));
  const cw = Math.max(3, Math.min(12, Math.floor((w - lw - 1) / cols.length)));
  const at = (r: string, c: string) => cells.get(r)?.get(c) ?? 0;
  const max = Math.max(1, ...rows.flatMap(r => cols.map(c => at(r, c))));
  // A cell's number is cut to its column too (`pad` ends it with …), so a big sum never shifts its neighbours.
  const head = " ".repeat(lw + 1) + cols.map(c => fg(HI) + pad(ellipsize(c, cw - 1), cw)).join("") + RESET;
  const body = rows.map(r => fg(HI) + pad(ellipsize(r, lw), lw) + " " + cols.map(c => {
    const n = at(r, c), s = shade(n, max);
    const tone = s >= 4 ? ACCENT : s >= 2 ? HI : s ? INK : DIM;
    return fg(tone) + pad(n ? `${SHADES[s]} ${n}` : "·", cw);
  }).join("") + RESET);
  const totals = cols.map(c => rows.reduce((a, r) => a + at(r, c), 0));
  const foot = fg(DIM) + pad("", lw + 1) + totals.map(t => pad(String(t), cw)).join("") + RESET;
  return [head, ...body, fg(DIM) + "·".repeat(Math.min(w, lw + 1 + cw * cols.length)) + RESET, foot];
}

export type Cells = Map<string, Map<string, number>>;

/** `cells` as a map of maps, from a Map, a YAML map of maps, or nothing. */
export function cellsOf(v: unknown): Cells {
  if (v instanceof Map) return v as Cells;
  const out: Cells = new Map();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [r, cols] of Object.entries(v as Record<string, unknown>)) {
      if (!cols || typeof cols !== "object" || Array.isArray(cols)) continue;
      out.set(r, new Map(Object.entries(cols as Record<string, unknown>).map(([c, n]) => [c, Number(n) || 0])));
    }
  }
  return out;
}

/** Add `n` to a cell, making its row and column as needed. */
export function addCell(cells: Cells, row: string, col: string, n: number): void {
  const r = cells.get(row) ?? new Map<string, number>();
  cells.set(row, r);
  r.set(col, (r.get(col) ?? 0) + n);
}

/** `- row: col=3 col2=1`: a cell per `name=n`; a bare number is the `value` column. */
export function matrixMarkdown(md: Markdown): Props {
  if (!md.rows.length) return {};
  const cells: Cells = new Map();
  for (const r of md.rows) {
    const row = r.label ?? r.text;
    for (const tok of r.values) {
      const m = /^(.+?)=(-?\d+(?:\.\d+)?)$/.exec(tok);
      if (m) addCell(cells, row, m[1]!, Number(m[2]));
      else if (tok && Number.isFinite(Number(tok))) addCell(cells, row, "value", Number(tok));
    }
  }
  return { cells };
}
