// `::graph-decision`: the options weighed, which was chosen (●), which rejected (×), which are still open (○), each
// with its reason, then what was decided in prose and its status and date.
//
//   ::graph-decision                     ::graph-decision
//   ---                                  ---
//   title: one repo                      title: open decisions (live)
//   status: decided                      query: "type=decision"
//   date: 2026-10-03                     reason: why             (the property a row's reason is in)
//   ---                                  ---
//   - **Bun workspaces** — one lockfile   ::
//   - *pnpm + turbo* — two tools
//   - nx — not tried                     A live row is a decision note; its `decision-state` property
//                                        (chosen, rejected, open) picks its glyph.
//   We chose what we already run.
//   ::
import { BOLD, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import { decisionState, type DecisionState } from "@ep0ch/outline-core/figure-props";
export { decisionState, type DecisionState };
import { ACCENT, DIM, HI, INK, inlineRows, rowLink, tier, type Props, type RowInline, type RowLink } from "./palette";

const GLYPH: Record<DecisionState, string> = { chosen: "●", rejected: "×", open: "○" };

export function drawDecision(p: Props, w: number, link?: RowLink, ui?: { rows?: RowInline }): string[] {
  const options: Props[] = p.options ?? [];
  // Narrow (PIE-581): the reason goes under its option, so neither wraps word by word in a thin column.
  const narrow = tier(w) === "narrow";
  const lw = narrow ? w - 2 : Math.min(Math.max(0, ...options.map(o => vwidth(String(o.label ?? "")))), Math.max(8, Math.floor((w - 4) * 0.45)));
  const out: string[] = [];
  for (const o of options) {
    const state = decisionState(o.state), label = String(o.label ?? "");
    const glyph = (state === "chosen" ? fg(ACCENT) : state === "rejected" ? fg(DIM) : fg(INK)) + GLYPH[state];
    const strong = state === "chosen" ? BOLD : "";
    // Its words, reason and prose through the reader's inline drawing (PIE-864), as a check row's are.
    const labels = inlineRows(label, lw, state === "chosen" ? HI : state === "rejected" ? DIM : INK, ui?.rows, typeof o.block === "string");
    const reason = o.reason ? inlineRows(String(o.reason), narrow ? Math.max(6, w - 6) : Math.max(6, w - lw - 6), DIM, ui?.rows) : [];
    const n = narrow ? labels.length : Math.max(labels.length, reason.length);
    for (let i = 0; i < n; i++) {
      const l = labels[i] ?? "", head = i ? "  " : glyph + RESET + " ";
      const text = strong + (narrow ? (i ? l : rowLink(link, o.block, l)) : pad(i ? l : rowLink(link, o.block, l), lw)) + UNBOLD + RESET;
      out.push(head + text + (!narrow && reason[i] ? `  ${fg(DIM)}${i ? "  " : "— "}${reason[i]}${RESET}` : ""));
    }
    if (narrow) for (const [i, r] of reason.entries()) out.push(`    ${fg(DIM)}${i ? "  " : "— "}${r}${RESET}`);
  }
  const prose: string[] = Array.isArray(p.text) ? p.text.map(String) : p.text ? [String(p.text)] : [];
  if (prose.length) { out.push(""); for (const para of prose) out.push(...inlineRows(para, w, INK, ui?.rows), ...(para === prose.at(-1) ? [] : [""])); }
  const meta = [p.status, p.date].filter(Boolean).map(String);
  if (meta.length) out.push("", fg(DIM) + meta.join(" · ") + RESET);
  return out;
}

