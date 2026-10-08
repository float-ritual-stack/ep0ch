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
import { ACCENT, DIM, HI, INK, records, type Props } from "./palette";
import { wrap } from "../text";

export interface Flow { from: string; to: string; value: number; accent?: boolean }

const PATH = /\s*(?:→|->)\s*/;

export function drawFlow(p: Props, w: number): string[] {
  const flows: Flow[] = records(p.flows).map((f: Props) => ({ from: String(f.from ?? ""), to: String(f.to ?? ""), value: Math.max(0, Number(f.value) || 0), accent: !!f.accent })).filter((f: Flow) => f.from && f.to);
  if (!flows.length) return wrap("no flows: rows are `- a → b: n`, or from: and to: name two properties", w).map(l => fg(DIM) + l + RESET);
  const sum = (key: "from" | "to") => { const m = new Map<string, number>(); for (const f of flows) m.set(f[key], (m.get(f[key]) ?? 0) + f.value); return [...m].sort((a, b) => b[1] - a[1]); };
  const sources = sum("from"), targets = sum("to");
  const max = Math.max(1, ...sources.map(s => s[1]), ...targets.map(t => t[1]));
  const lw = Math.min(Math.max(...[...sources, ...targets].map(([k]) => vwidth(k))), Math.max(8, Math.floor(w * 0.35)));
  const vw = Math.max(...[...sources, ...targets, ...flows.map(f => [f.to, f.value] as const)].map(([, v]) => String(v).length));
  const bw = Math.max(4, Math.min(20, w - lw - vw - 4));
  const bar = (v: number, tone: number) => fg(tone) + (v > 0 ? "█".repeat(Math.max(1, Math.round((v / max) * bw))) : fg(DIM) + "·") + RESET;
  const out: string[] = [];
  for (const [src, total] of sources) {
    const names = wrap(src, lw);
    out.push(fg(HI) + BOLD + pad(names[0] ?? "", lw) + UNBOLD + " " + fg(INK) + String(total).padStart(vw) + " " + bar(total, HI));
    for (const l of names.slice(1)) out.push(fg(HI) + BOLD + l + UNBOLD + RESET);
    for (const f of flows.filter(f => f.from === src).sort((a, b) => b.value - a.value)) {
      const share = total > 0 ? f.value / total : 0, line = share >= 0.5 ? "═" : share >= 0.2 ? "─" : "┄";
      const lead = Math.max(2, Math.min(12, Math.round(share * 12)));
      // The target wraps under itself, the count on its first line.
      const to = wrap(f.to, Math.max(4, w - lead - vw - 6)), hang = " ".repeat(lead + 4);
      out.push("  " + fg(f.accent ? ACCENT : DIM) + line.repeat(lead) + "▶ " + fg(f.accent ? ACCENT : INK) + to[0] + fg(DIM) + " " + String(f.value).padStart(vw) + RESET);
      for (const l of to.slice(1)) out.push(hang + fg(f.accent ? ACCENT : INK) + l + RESET);
    }
  }
  out.push("", fg(DIM) + "→ " + ellipsize(String(p.targets ?? "where they went"), w - 2) + RESET);
  for (const [dst, total] of targets) {
    const names = wrap(dst, lw);
    out.push(fg(HI) + pad(names[0] ?? "", lw) + " " + fg(INK) + String(total).padStart(vw) + " " + bar(total, ACCENT));
    for (const l of names.slice(1)) out.push(fg(HI) + l + RESET);
  }
  return out;
}

/** `- a → b: 7` (or `->`): a flow of 7; no number is a flow of 1; a bold row is the accent. */
export function flowMarkdown(md: Markdown): Props {
  if (!md.rows.length) return {};
  const flows = md.rows.flatMap(r => {
    const steps = (r.label ?? r.text).split(PATH).map(s => s.trim()).filter(Boolean);
    if (steps.length < 2) return [];
    // No number is a flow of 1; a written 0 stays 0.
    const given = r.label === null ? undefined : r.values[0];
    const value = given === undefined || given === "" ? 1 : Number.isFinite(Number(given)) ? Math.max(0, Number(given)) : 1;
    return steps.slice(1).map((to, i) => ({ from: steps[i]!, to, value, accent: r.emphasis === "strong" }));
  });
  return { flows };
}
