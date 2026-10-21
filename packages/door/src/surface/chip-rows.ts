import { fullText } from "../overflow";
import { C, chip, fg, RESET, width } from "../style";

interface Hit { from: number; to: number; action: string; args?: Record<string, unknown> }
export interface ChipRow { text: string; hits?: Hit[] }

/** A row of chips, wrapped to `w`: each its label, lit when `on`, the cursor's marked, a click running its action. */
export function chipRows(items: { label: string; on: boolean; cursor?: boolean; hint?: string; hit: Omit<Hit, "from" | "to"> }[], w: number, lead = ""): ChipRow[] {
  const rows: ChipRow[] = [];
  let text = lead, hits: Hit[] = [], at = width(lead);
  for (const it of items) {
    const label = ` ${it.label} `, n = width(label);
    if (at + n + 1 > w && at > width(lead)) { rows.push({ text, hits }); text = " ".repeat(width(lead)); hits = []; at = width(lead); }
    const look = it.on ? chip(C.blue) : it.cursor ? fg(C.white) : fg(C.grey);
    const marked = it.cursor ? `\x1b[4m${label}\x1b[24m` : label;
    text += look + (it.hint ? fullText(it.hint, marked) : marked) + RESET + " ";
    hits.push({ from: at, to: at + n, ...it.hit });
    at += n + 1;
  }
  rows.push({ text, hits });
  return rows;
}
