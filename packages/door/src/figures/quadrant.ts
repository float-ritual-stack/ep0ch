// `::graph-quadrant` (PIE-575): blocks placed by two properties, a cell per (x, y). The verdict is the shape: which
// corner is full, which is empty. Live, a point is a note (opened from its row); static, a row `- label: x, y`.
//
//   ::graph-quadrant                           ::graph-quadrant
//   ---                                        ---
//   title: bug classes                         title: house jobs (live)
//   xs: [cheap, costly]                        query: "type=roadmap-item project=house"
//   ys: [prevents, helps, nothing]             x: priority
//   quadrants: [edges, "", "", the hard ones]  xs: [low, medium, high]
//   ---                                        y: work-stage
//   - untyped wire: cheap, prevents            ys: [done, doing, queued]
//   - **identity by name: costly, nothing**    ---
//   ::                                         ::
//
// `xs:` and `ys:` give the axes' order (first y at the top); values not listed follow in the order seen. Narrow, a
// cell shows a dot per point and the labels move to a legend beneath.
import { BOLD, drawEllipsized, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { rowLines, wrap } from "../text";
import { ACCENT, DIM, HI, INK, ordered, records, rowLink, tier, type Props, type RowLink } from "./palette";

export interface Point { x: string; y: string; label: string; accent?: boolean; muted?: boolean; block?: string }


export function drawQuadrant(p: Props, w: number, link?: RowLink): string[] {
  const points: Point[] = records(p.points).map((q: Props) => ({ x: String(q.x ?? ""), y: String(q.y ?? ""), label: String(q.label ?? ""), accent: !!q.accent, muted: !!q.muted, ...(typeof q.block === "string" ? { block: q.block } : {}) }));
  const allX = ordered(p.xs, points.map(q => q.x)), ys = ordered(p.ys, points.map(q => q.y));
  if (!allX.length || !ys.length) return wrap("no points: rows are `- label: x, y`, or x: and y: name two properties", w).map(l => fg(DIM) + l + RESET);
  const yw = Math.min(Math.max(...ys.map(vwidth)), Math.max(4, Math.floor(w / 4)));
  // As many columns as fit at four cells each; the rest are counted beneath.
  const fit = Math.max(1, Math.floor((w - yw - 2) / 4)), xs = allX.slice(0, fit), dropped = allX.length - xs.length;
  const cw = Math.max(3, Math.floor((w - yw - 2) / xs.length));
  const narrow = tier(w) === "narrow" || cw < 9;
  const corners: string[] = Array.isArray(p.quadrants) ? p.quadrants.map(String) : [];
  const out: string[] = [];
  const plotW = cw * xs.length;
  // Each corner's name gets half the plot's width at most; `pad` cuts what is longer.
  const cornerLine = (l: string, r: string) => (l || r ? [" ".repeat(yw + 2) + fg(DIM) + pad(drawEllipsized(l, Math.max(0, plotW - Math.min(vwidth(r), plotW >> 1))), Math.max(0, plotW - Math.min(vwidth(r), plotW >> 1))) + drawEllipsized(r, plotW >> 1) + RESET] : []);
  out.push(...cornerLine(corners[0] ?? "", corners[1] ?? ""));
  const legend: { n: number; point: Point }[] = [];
  const ink = (q: Point) => (q.accent ? fg(ACCENT) + BOLD : q.muted ? fg(DIM) : fg(INK));
  for (const y of ys) {
    const cells = xs.map(x => points.filter(q => q.x === x && q.y === y));
    const drawn = cells.map(c => {
      if (narrow) return [c.map(q => { legend.push({ n: legend.length + 1, point: q }); return ink(q) + rowLink(link, q.block, "●") + UNBOLD + RESET; }).join("")];
      const shown = c.length > 3 ? c.slice(0, 2) : c;
      const rows = shown.flatMap(q => rowLines(rowLink(link, q.block, `·${q.label}`), cw - 1, undefined, { hang: 1 }).map(line => ink(q) + line + UNBOLD + RESET));
      if (c.length > 3) { rows.push(fg(DIM) + rowLines(`+${c.length - 2} more`, cw - 1, 0)[0]! + RESET); for (const q of c.slice(2)) legend.push({ n: legend.length + 1, point: q }); }
      return rows;
    });
    const labels = rowLines(y, yw);
    const lines = Math.max(1, labels.length, ...drawn.map(c => c.length));
    for (let r = 0; r < lines; r++) out.push(fg(HI) + pad(labels[r] ?? "", yw) + fg(DIM) + (r ? "  " : " │") + drawn.map(c => pad(c[r] ?? "", cw)).join("") + RESET);
  }
  out.push(" ".repeat(yw) + fg(DIM) + " └" + "─".repeat(plotW) + RESET);
  out.push(" ".repeat(yw + 2) + xs.map(x => fg(HI) + pad(drawEllipsized(x, cw - 1), cw)).join("") + RESET);
  out.push(...cornerLine(corners[2] ?? "", corners[3] ?? ""));
  if (dropped) out.push(fg(DIM) + `+${dropped} column${dropped === 1 ? "" : "s"} · widen to see` + RESET);
  if (legend.length) {
    out.push("");
    for (const { point: q } of legend) { const text = rowLink(link, q.block, q.label + ` (${q.x}, ${q.y})`); out.push(...rowLines(text, w).map(line => ink(q) + line + UNBOLD + RESET)); }
  }
  return out;
}

