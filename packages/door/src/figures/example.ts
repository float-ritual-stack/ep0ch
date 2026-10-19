// `::graph-example`: real commands and what each does (PIE-1032): an action line drawn as code, `→` what happens under
// it, and a quiet `safe` beside one an agent may run as it is. An action's page shows its examples with it, an
// extension's page its actions'. The row grammar is outline-core's (`exampleRow`).
//
//   ::graph-example                                     examples:                         (the YAML form)
//   ---                                                   - { act: layout.move tile=notes to=right,
//   prompt: ep0ch act                                         does: puts the notes tile to the right of it }
//   ---
//   - `layout.move tile=notes to=right` → puts the notes tile to the right of it
//   - `bar.open query=garden` → lists what matches garden (safe)
//   ::
import { exampleRow } from "@ep0ch/outline-core/figure-props";
import { fg, pad, RESET, width as vwidth } from "../style";
import { rowLines } from "../text";
import { ACCENT, DIM, HI, INK, records, rowLink, type Props, type RowLink } from "./palette";

/** One example: the command, what it does, whether an agent may run it as it is. */
export interface ExampleRow { act: string; does?: string; safe?: boolean; block?: string }

const SAFE = "safe";

export function drawExample(p: Props, w: number, link?: RowLink): string[] {
  // A YAML row may be written as the Markdown one (`- "`a b` → c"`).
  const rows: ExampleRow[] = records(p.examples).map(r => r as ExampleRow).concat(
    (Array.isArray(p.examples) ? p.examples : []).flatMap((r: unknown) => (typeof r === "string" ? [exampleRow(r)].filter(Boolean) as ExampleRow[] : [])));
  if (!rows.length) return [fg(DIM) + "no examples" + RESET];
  // A prompt that would leave the command less than half the width is left out.
  const prompt = p.prompt && vwidth(String(p.prompt)) + 1 <= w / 2 ? String(p.prompt) + " " : "";
  const out: string[] = [];
  rows.forEach((r, n) => {
    if (n) out.push("");
    const mark = r.safe ? SAFE : "";
    const room = Math.max(8, w - vwidth(prompt) - (mark ? vwidth(mark) + 2 : 0));
    const lines = rowLines(rowLink(link, r.block, String(r.act ?? "")), room);
    lines.forEach((l, i) => {
      const lead = i ? " ".repeat(vwidth(prompt)) : fg(DIM) + prompt;
      const text = fg(HI) + l;
      out.push(lead + text + RESET + (i === 0 && mark ? " ".repeat(Math.max(2, room - vwidth(l) + 2)) + fg(ACCENT) + mark + RESET : ""));
    });
    if (r.does) rowLines(String(r.does), Math.max(8, w - 4)).forEach((l, i) => out.push((i ? "    " : "  " + fg(DIM) + "→ ") + fg(INK) + l + RESET));
  });
  return out.map(l => (vwidth(l) > w ? pad(l, w) : l));
}
