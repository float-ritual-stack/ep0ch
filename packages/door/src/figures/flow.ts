// `::graph-flow` (PIE-579): where things came from and where they went, two stages. A row `- a → b: 7`; live,
// `from:` and `to:` name two properties and each pair is counted.
//
//   ::graph-flow                       ::graph-flow
//   ---                                ---
//   title: the review's findings       title: chores (live)
//   ---                                query: "type=chore"
//   - main → recorded: 5               from: area
//   - main → fixed: 2                  to: stage
//   - Effect → fixed: 4                ---
//   ::                                 ::
//
// Each source is a bar sized by its total, its flows under it, the line's weight by the flow's share of the
// source (═ half or more, ─ a fifth or more, ┄ less); the targets' totals close the figure. The same at any width.
import { BOLD, ellipsize, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, type Props } from "./palette";

export interface Flow { from: string; to: string; value: number; accent?: boolean }

const PATH = /\s*(?:→|->)\s*/;

export function drawFlow(p: Props, w: number): string[] {
  const flows: Flow[] = (p.flows ?? []).map((f: Props) => ({ from: String(f.from ?? ""), to: String(f.to ?? ""), value: Number(f.value) || 0, accent: !!f.accent })).filter((f: Flow) => f.from && f.to);
  if (!flows.length) return [fg(DIM) + "no flows: rows are `- a → b: n`, or from: and to: name two properties" + RESET];
  const sum = (key: "from" | "to") => { const m = new Map<string, number>(); for (const f of flows) m.set(f[key], (m.get(f[key]) ?? 0) + f.value); return [...m].sort((a, b) => b[1] - a[1]); };
  const sources = sum("from"), targets = sum("to");
  const max = Math.max(1, ...sources.map(s => s[1]), ...targets.map(t => t[1]));
  const lw = Math.min(Math.max(...[...sources, ...targets].map(([k]) => vwidth(k))), Math.max(8, Math.floor(w * 0.35)));
  const vw = Math.max(...[...sources, ...targets, ...flows.map(f => [f.to, f.value] as const)].map(([, v]) => String(v).length));
  const bw = Math.max(4, Math.min(20, w - lw - vw - 4));
  const bar = (v: number, tone: number) => fg(tone) + "█".repeat(Math.max(1, Math.round((v / max) * bw))) + RESET;
  const out: string[] = [];
  for (const [src, total] of sources) {
    out.push(fg(HI) + BOLD + pad(ellipsize(src, lw), lw) + UNBOLD + " " + fg(INK) + String(total).padStart(vw) + " " + bar(total, HI));
    for (const f of flows.filter(f => f.from === src).sort((a, b) => b.value - a.value)) {
      const share = f.value / total, line = share >= 0.5 ? "═" : share >= 0.2 ? "─" : "┄";
      const lead = Math.max(2, Math.min(12, Math.round(share * 12)));
      out.push("  " + fg(f.accent ? ACCENT : DIM) + line.repeat(lead) + "▶ " + fg(f.accent ? ACCENT : INK) + ellipsize(f.to, Math.max(4, w - lead - vw - 6)) + fg(DIM) + " " + String(f.value).padStart(vw) + RESET);
    }
  }
  out.push("", fg(DIM) + "→ " + ellipsize(String(p.targets ?? "where they went"), w - 2) + RESET);
  for (const [dst, total] of targets) out.push(fg(HI) + pad(ellipsize(dst, lw), lw) + " " + fg(INK) + String(total).padStart(vw) + " " + bar(total, ACCENT));
  return out;
}

/** `- a → b: 7` (or `->`): a flow of 7; no number is a flow of 1; a bold row is the accent. */
export function flowMarkdown(md: Markdown): Props {
  if (!md.rows.length) return {};
  const flows = md.rows.flatMap(r => {
    const steps = (r.label ?? r.text).split(PATH).map(s => s.trim()).filter(Boolean);
    if (steps.length < 2) return [];
    const value = Number(r.label === null ? 1 : r.values[0]) || 1;
    return steps.slice(1).map((to, i) => ({ from: steps[i]!, to, value, accent: r.emphasis === "strong" }));
  });
  return { flows };
}
