// `::graph-chat`: a few turns of a conversation. The first speaker (or `you:`) gets the `>` prompt; a speaker who
// speaks again isn't named again; an italic turn is an aside, drawn dim. Names stay as written (loki, daddy, shypht).
//
//   ::graph-chat              messages:                       (the YAML form)
//   ---                         - { from: shypht, text: did the backups run? }
//   title: at the board         - { from: loki, text: "yes, at 03:00", aside: false }
//   ---
//   - shypht: did the backups run?
//   - loki: yes, at 03:00
//   - loki: fourteen snapshots
//   - daddy: *goes to make tea*
//   ::
import { BOLD, fg, pad, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, rowLink, type Props, type RowLink } from "./palette";

export function drawChat(p: Props, w: number, link?: RowLink): string[] {
  const turns: Props[] = (p.messages ?? []).map((m: Props) => ({ ...m, from: String(m.from ?? "") }));
  const you = String(p.you ?? turns.find(t => t.from)?.from ?? "");
  const nw = Math.min(14, Math.max(0, ...turns.map(t => vwidth(t.from))));
  const tw = Math.max(8, w - nw - 4);
  const out: string[] = [];
  let last = "";
  for (const t of turns) {
    const mine = t.from === you, again = t.from === last && !t.aside;
    const prompt = mine && !again && !t.aside ? fg(ACCENT) + ">" : " ";
    const name = again || !t.from ? " ".repeat(nw) : (t.aside ? fg(DIM) : mine ? fg(ACCENT) + BOLD : fg(HI)) + pad(t.from, nw) + UNBOLD;
    const lines = wrap(String(t.text ?? ""), tw);
    lines.forEach((l, i) => {
      const text = t.aside ? fg(DIM) + l : fg(INK) + (i ? l : rowLink(link, t.block, l));
      out.push((i ? "  " + " ".repeat(nw) : prompt + RESET + " " + name + RESET) + "  " + text + RESET);
    });
    if (!t.aside) last = t.from;
  }
  return out;
}

/** `- speaker: message`; a row without a speaker is the last one's again; an italic row is an aside. */
export function chatMarkdown(md: Markdown): Props {
  if (!md.rows.length) return {};
  let from = "";
  return {
    messages: md.rows.map(r => {
      if (r.label !== null) from = r.label;
      return { from, text: r.label !== null ? r.value : r.text, aside: r.emphasis === "em", block: r.block };
    }),
  };
}
