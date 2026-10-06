// A figure's rows from Markdown (outline-core's figure-markdown.ts reads it; this says what each kind makes of it):
// the lines of a `::graph-*` block after its `---` YAML, and the figure block's child bullets (each a row standing
// for its note). The YAML stays the data form: the props made here are under it, so a field the YAML gives wins.
import type { FigureMarkdown, FigureRow } from "@ep0ch/outline-core/figure-markdown";
import { expandRuns, numbersOf } from "@ep0ch/outline-core/figure-markdown";
import type { Props } from "./palette";

/** A row, and the note it stands for when it is a child bullet (a click or ⏎ opens it). */
export type Row = FigureRow & { block?: string };
/** A figure's Markdown, its child bullets' rows among its rows. */
export type Markdown = Omit<FigureMarkdown, "rows"> & { rows: Row[] };

/** The first number in a row's value, else its value as written. */
const valueOf = (r: Row) => numbersOf(r)[0] ?? r.value;

/** What the kinds drawn in src/graphs.ts make of rows. The kinds in this folder say their own (`MARKDOWN` there). */
export const BASE_MARKDOWN: Record<string, (md: Markdown, p: Props) => Props> = {
  // - 2026-03: label   **now**   *next*   — a muted note
  timeline: md => (md.rows.length ? {
    events: md.rows.map(r => ({ date: r.label ?? "", label: r.label === null ? r.text : r.value, state: r.emphasis === "strong" ? "now" : r.emphasis === "em" ? "next" : undefined, note: r.note ?? undefined, block: r.block })),
  } : {}),
  // - [x] done   - [ ] open   - **done** (bold without a box)   — a muted note
  check: md => (md.rows.length ? {
    items: md.rows.map(r => ({ label: r.text, done: r.done ?? r.emphasis === "strong", note: r.note ?? undefined, block: r.block })),
  } : {}),
  // - label: 12   **the accent row**   *a receding one*
  rank: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? r.text, value: valueOf(r), accent: r.emphasis === "strong", muted: r.emphasis === "em" })) } : {}),
  funnel: md => (md.rows.length ? { steps: md.rows.map(r => ({ label: r.label ?? r.text, value: valueOf(r) })) } : {}),
  // - outbox: 18   the bold one is the accent (else the last)
  stat: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? "", value: r.label === null ? r.text : r.value, accent: r.emphasis === "strong" })) } : {}),
  kpi: (md, p) => BASE_MARKDOWN.stat!(md, p),
  // - label: 48   one bar each against the YAML's limit:; the bold one is the accent
  meter: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? "", value: valueOf(r), accent: r.emphasis === "strong" })) } : {}),
  // 2 0 5 11 3*2 (rows or paragraphs); a row each (`- Mon: 2`) labels the points
  spark: md => sparkOf(md),
  plot: md => {
    const s = sparkOf(md);
    const labelled = md.rows.length > 1 && md.rows.every(r => r.label !== null && numbersOf(r).length === 1);
    return labelled ? { ...s, labels: md.rows.map(r => r.label) } : s;
  },
};

/** Every number in the rows' values and the paragraphs, runs spelled out, in order. */
function sparkOf(md: Markdown): Props {
  const data = [...md.rows.flatMap(numbersOf), ...md.paragraphs.flatMap(p => expandRuns(p).map(Number).filter(Number.isFinite))];
  return data.length ? { data } : {};
}
