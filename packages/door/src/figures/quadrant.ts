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
import { BOLD, ellipsize, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, rowLink, tier, type Props, type RowLink } from "./palette";

export interface Point { x: string; y: string; label: string; accent?: boolean; muted?: boolean; block?: string }

/** The axis values: those listed, then the rest in the order the points give them. */
export function axisValues(listed: unknown, points: readonly Point[], key: "x" | "y"): string[] {
  const given = Array.isArray(listed) ? listed.map(String) : [];
  return [...given, ...points.map(p => p[key]).filter((v, i, a) => v && !given.includes(v) && a.indexOf(v) === i)];
}

export function drawQuadrant(p: Props, w: number, link?: RowLink): string[] {
  const points: Point[] = (p.points ?? []).map((q: Props) => ({ x: String(q.x ?? ""), y: String(q.y ?? ""), label: String(q.label ?? ""), accent: !!q.accent, muted: !!q.muted, ...(typeof q.block === "string" ? { block: q.block } : {}) }));
  const xs = axisValues(p.xs, points, "x"), ys = axisValues(p.ys, points, "y");
  if (!xs.length || !ys.length) return [fg(DIM) + "no points: rows are `- label: x, y`, or x: and y: name two properties" + RESET];
  const yw = Math.min(Math.max(...ys.map(vwidth)), Math.max(4, Math.floor(w / 4)));
  const cw = Math.max(3, Math.floor((w - yw - 2) / xs.length));
  const narrow = tier(w) === "narrow" || cw < 9;
  const corners: string[] = Array.isArray(p.quadrants) ? p.quadrants.map(String) : [];
  const out: string[] = [];
  const plotW = cw * xs.length;
  const cornerLine = (l: string, r: string) => (l || r ? [" ".repeat(yw + 2) + fg(DIM) + pad(l, Math.max(0, plotW - vwidth(r))) + r + RESET] : []);
  out.push(...cornerLine(corners[0] ?? "", corners[1] ?? ""));
  const legend: { n: number; point: Point }[] = [];
  const ink = (q: Point) => (q.accent ? fg(ACCENT) + BOLD : q.muted ? fg(DIM) : fg(INK));
  for (const y of ys) {
    const cells = xs.map(x => points.filter(q => q.x === x && q.y === y));
    const lines = narrow ? 1 : Math.max(1, ...cells.map(c => Math.min(3, c.length)));
    for (let r = 0; r < lines; r++) {
      let line = (r ? " ".repeat(yw) : fg(HI) + pad(ellipsize(y, yw), yw)) + fg(DIM) + (r ? "  " : " │") + RESET;
      for (const c of cells) {
        let cell: string;
        if (narrow) {
          cell = c.map(q => { legend.push({ n: legend.length + 1, point: q }); return ink(q) + rowLink(link, q.block, "●") + UNBOLD + RESET; }).join("");
          cell = c.length > cw - 1 ? fg(INK) + `●${c.length}` + RESET : cell;
        } else if (r === 2 && c.length > 3) cell = fg(DIM) + ellipsize(`+${c.length - 2} more`, cw - 1) + RESET;
        else { const q = c[r]; cell = q ? ink(q) + rowLink(link, q.block, ellipsize(`·${q.label}`, cw - 1)) + UNBOLD + RESET : ""; }
        line += pad(cell, cw);
      }
      out.push(line);
    }
  }
  out.push(" ".repeat(yw) + fg(DIM) + " └" + "─".repeat(plotW) + RESET);
  out.push(" ".repeat(yw + 2) + xs.map(x => fg(HI) + pad(ellipsize(x, cw - 1), cw)).join("") + RESET);
  out.push(...cornerLine(corners[2] ?? "", corners[3] ?? ""));
  if (legend.length) {
    out.push("");
    for (const { point: q } of legend) { const where = ` (${q.x}, ${q.y})`; out.push(ink(q) + rowLink(link, q.block, ellipsize(q.label, Math.max(4, w - vwidth(where)))) + UNBOLD + fg(DIM) + where + RESET); }
  }
  return out;
}

/** `- label: x, y`; a bold row is the accent, an italic one recedes. The YAML's `xs:` and `ys:` order the axes. */
export function quadrantMarkdown(md: Markdown): Props {
  return md.rows.length
    ? { points: md.rows.map(r => ({ label: r.label ?? r.text, x: r.values[0] ?? "", y: r.values[1] ?? "", accent: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block })) }
    : {};
}
