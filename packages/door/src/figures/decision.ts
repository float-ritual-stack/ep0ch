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
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, rowLink, tier, type Props, type RowLink } from "./palette";

export type DecisionState = "chosen" | "rejected" | "open";

/** A `decision-state` (or an option's `state:`) as one of the three; anything else is open. */
export function decisionState(v: unknown): DecisionState {
  const s = String(v ?? "").trim().toLowerCase();
  if (["chosen", "accepted", "decided", "yes", "picked", "done"].includes(s)) return "chosen";
  if (["rejected", "declined", "no", "dropped", "superseded"].includes(s)) return "rejected";
  return "open";
}

const GLYPH: Record<DecisionState, string> = { chosen: "●", rejected: "×", open: "○" };

export function drawDecision(p: Props, w: number, link?: RowLink): string[] {
  const options: Props[] = p.options ?? [];
  // Narrow (PIE-581): the reason goes under its option, so neither wraps word by word in a thin column.
  const narrow = tier(w) === "narrow";
  const lw = narrow ? w - 2 : Math.min(Math.max(0, ...options.map(o => vwidth(String(o.label ?? "")))), Math.max(8, Math.floor((w - 4) * 0.45)));
  const out: string[] = [];
  for (const o of options) {
    const state = decisionState(o.state), label = String(o.label ?? "");
    const glyph = (state === "chosen" ? fg(ACCENT) : state === "rejected" ? fg(DIM) : fg(INK)) + GLYPH[state];
    const ink = state === "chosen" ? fg(HI) + BOLD : state === "rejected" ? fg(DIM) : fg(INK);
    const labels = wrap(label, lw);
    const reason = o.reason ? wrap(String(o.reason), narrow ? Math.max(6, w - 6) : Math.max(6, w - lw - 6)) : [];
    const n = narrow ? labels.length : Math.max(labels.length, reason.length);
    for (let i = 0; i < n; i++) {
      const l = labels[i] ?? "", head = i ? "  " : glyph + RESET + " ";
      const text = ink + (narrow ? (i ? l : rowLink(link, o.block, l)) : pad(i ? l : rowLink(link, o.block, l), lw)) + UNBOLD + RESET;
      out.push(head + text + (!narrow && reason[i] ? `  ${fg(DIM)}${i ? "  " : "— "}${reason[i]}${RESET}` : ""));
    }
    if (narrow) for (const [i, r] of reason.entries()) out.push(`    ${fg(DIM)}${i ? "  " : "— "}${r}${RESET}`);
  }
  const prose: string[] = Array.isArray(p.text) ? p.text.map(String) : p.text ? [String(p.text)] : [];
  if (prose.length) { out.push(""); for (const para of prose) out.push(...wrap(para, w).map(l => fg(INK) + l + RESET), ...(para === prose.at(-1) ? [] : [""])); }
  const meta = [p.status, p.date].filter(Boolean).map(String);
  if (meta.length) out.push("", fg(DIM) + meta.join(" · ") + RESET);
  return out;
}

/** `- **chosen** — reason`, `- *rejected* — reason`, `- open — reason`; paragraphs after them are the text. */
export function decisionMarkdown(md: Markdown): Props {
  return {
    ...(md.rows.length ? { options: md.rows.map(r => ({ label: r.text, state: r.emphasis === "strong" ? "chosen" : r.emphasis === "em" ? "rejected" : "open", reason: r.note ?? undefined, block: r.block })) } : {}),
    ...(md.paragraphs.length ? { text: md.paragraphs } : {}),
  };
}
