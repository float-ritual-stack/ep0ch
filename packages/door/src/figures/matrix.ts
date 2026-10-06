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
import { ACCENT, DIM, HI, INK, type Props } from "./palette";

const SHADES = ["·", "░", "▒", "▓", "█"];
const shade = (n: number, max: number) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / Math.max(1, max)) * 4))));

/** The names listed first (`order-down:`, `order-across:`), then the rest in the order the cells give them. */
export function ordered(listed: unknown, seen: readonly string[]): string[] {
  const given = Array.isArray(listed) ? listed.map(String) : [];
  return [...given, ...seen.filter((v, i, a) => !given.includes(v) && a.indexOf(v) === i)];
}

export function drawMatrix(p: Props, w: number): string[] {
  const cells: Record<string, Record<string, number>> = p.cells ?? {};
  const rows = ordered(p["order-down"], Object.keys(cells));
  const cols = ordered(p["order-across"], Object.values(cells).flatMap(r => Object.keys(r)));
  if (!rows.length || !cols.length) return [fg(DIM) + "no cells: rows are `- row: col=n …`, or down: and across: name two properties" + RESET];
  const lw = Math.min(Math.max(...rows.map(vwidth)), Math.max(6, Math.floor(w / 3)));
  const cw = Math.max(3, Math.min(12, Math.floor((w - lw - 1) / cols.length)));
  const max = Math.max(1, ...rows.flatMap(r => cols.map(c => Number(cells[r]?.[c]) || 0)));
  const head = " ".repeat(lw + 1) + cols.map(c => fg(HI) + pad(ellipsize(c, cw - 1), cw)).join("") + RESET;
  const body = rows.map(r => fg(HI) + pad(ellipsize(r, lw), lw) + " " + cols.map(c => {
    const n = Number(cells[r]?.[c]) || 0, s = shade(n, max);
    const tone = s >= 4 ? ACCENT : s >= 2 ? HI : s ? INK : DIM;
    return fg(tone) + pad(n ? `${SHADES[s]} ${n}` : "·", cw);
  }).join("") + RESET);
  const totals = cols.map(c => rows.reduce((a, r) => a + (Number(cells[r]?.[c]) || 0), 0));
  const foot = fg(DIM) + pad("", lw + 1) + totals.map(t => pad(String(t), cw)).join("") + RESET;
  return [head, ...body, fg(DIM) + "·".repeat(Math.min(w, lw + 1 + cw * cols.length)) + RESET, foot];
}

/** `- row: col=3 col2=1`: a cell per `name=n`; a bare number is the `value` column. */
export function matrixMarkdown(md: Markdown): Props {
  if (!md.rows.length) return {};
  const cells: Record<string, Record<string, number>> = {};
  for (const r of md.rows) {
    const row = r.label ?? r.text, into = (cells[row] ??= {});
    for (const tok of r.values) {
      const m = /^(.+?)=(-?\d+(?:\.\d+)?)$/.exec(tok);
      if (m) into[m[1]!] = (into[m[1]!] ?? 0) + Number(m[2]);
      else if (Number.isFinite(Number(tok))) into.value = (into.value ?? 0) + Number(tok);
    }
  }
  return { cells };
}
