// The figure-fit eval (PIE-721): how often figure-fit.ts names the figure a note would read best as, scored on the
// outline's own notes before it says anything to anyone. Pure: the labelled set and the scores; scripts/evals/figure-fit.ts
// reads an outline's copy, asks Jev (cached) and prints the report.
//
//   positives   a note that already draws a `::graph-<kind>` from rows of its own: the figure taken away and its rows
//               left as plain lines, which is how the note would read had nobody known the figure. The label is the
//               figure it had.
//   shaped      a note with a figure's shape (figure-fit's figureShape) and no figure: unlabelled. What is suggested
//               here is listed for a person to judge, and the rate says how chatty a threshold is.
//   hand        a label a person gave (`--labels`: block id → a figure's id, or `none`), over either of the above: the
//               notes someone pointed at and said "don't we have a component for this", and the ones that are fine.
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { figureSource, graphKind } from "@ep0ch/outline-core/figure-props";
import { figureShape, fitOf, type FigureFitReading, type FigureFitThresholds } from "./figure-fit";

export interface EvalItem {
  id: string;
  title: string;
  /** What is sent: the note, or for a positive the note with its figure taken back to rows. */
  text: string;
  /** The figure it should be (`graph-timeline`), `none`, or null: unlabelled. */
  label: string | null;
  source: "figure" | "shaped" | "hand";
}

/** A figure needs this many rows of its own before taking it away leaves a note that has its shape. */
const MIN_ROWS = 3;

/** The note with its first figure taken back to its rows, the others left out, and that figure's id; null when no figure has rows. */
export function defigure(text: string): { text: string; figure: string } | null {
  const lines = text.split("\n");
  const blocks = componentBlocks(lines).filter(b => graphKind(b));
  const first = blocks.find(b => figureSource(lines.slice(b.start + 1, b.end)).markdown!.filter(l => l.trim()).length >= MIN_ROWS);
  if (!first) return null;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const b = blocks.find(x => x.start === i);
    if (!b) { out.push(lines[i]!); continue; }
    if (b === first) out.push(...figureSource(lines.slice(b.start + 1, b.end)).markdown!.filter(l => l.trim()));
    i = b.end;
  }
  return { text: out.join("\n"), figure: first.name };
}

/**
 * The labelled set from an outline's notes: positives from its figures, the shaped notes unlabelled, hand labels over
 * both. A figure written whole in its YAML (no rows) isn't a positive: taken away, nothing of the note's shape is left.
 */
export function evalSet(blocks: readonly { id: string; text: string }[], labels: Record<string, string> = {}, schemas: readonly ComponentSchema[] = []): EvalItem[] {
  const items: EvalItem[] = [];
  for (const b of blocks) {
    const title = b.text.split("\n", 1)[0]!.slice(0, 120);
    const hand = labels[b.id];
    const taken = defigure(b.text);
    if (taken && figureShape(taken.text, schemas) === "shaped") items.push({ id: b.id, title, text: taken.text, label: hand ?? taken.figure, source: hand ? "hand" : "figure" });
    else if (figureShape(b.text, schemas) === "shaped") items.push({ id: b.id, title, text: b.text, label: hand ?? null, source: hand ? "hand" : "shaped" });
    else if (hand) items.push({ id: b.id, title, text: b.text, label: hand, source: "hand" });
  }
  return items;
}

export interface EvalScore {
  thresholds: FigureFitThresholds;
  /** Notes that should be a figure: how often Jev's choice was it, and how often it was suggested. */
  positives: { n: number; top1: number; suggested: number; correct: number };
  perKind: Record<string, { n: number; top1: number; correct: number }>;
  /** Labelled `none`: how often something was suggested anyway. */
  none: { n: number; suggested: number };
  /** Unlabelled shaped notes: how often a suggestion is made, and what (for a person to judge). */
  shaped: { n: number; suggested: number; examples: { id: string; title: string; component: string; confidence: number }[] };
  /** The label and the choice where they differ, most frequent first. */
  confusion: { label: string; choice: string; n: number }[];
}

/**
 * The scores of readings at one pair of thresholds, as the live path would tell: a note without a figure's shape
 * (a hand label on prose, or on a note that draws one) is never told, and needs no reading. A shaped item with no
 * reading (Jev unavailable) is left out.
 */
export function scoreReadings(items: readonly (EvalItem & { reading?: FigureFitReading })[], schemas: readonly ComponentSchema[], thresholds: FigureFitThresholds): EvalScore {
  const score: EvalScore = {
    thresholds, positives: { n: 0, top1: 0, suggested: 0, correct: 0 }, perKind: {}, none: { n: 0, suggested: 0 },
    shaped: { n: 0, suggested: 0, examples: [] }, confusion: [],
  };
  const confused = new Map<string, number>();
  for (const item of items) {
    const shaped = figureShape(item.text, schemas) === "shaped";
    if (shaped && !item.reading) continue;
    const answer = shaped ? fitOf(item.reading!, schemas, thresholds) : null;
    const fit = answer && "fit" in answer ? answer.fit : null;
    if (item.label === null) {
      score.shaped.n++;
      if (fit) { score.shaped.suggested++; score.shaped.examples.push({ id: item.id, title: item.title, component: fit.component, confidence: fit.confidence }); }
    } else if (item.label === "none") {
      score.none.n++;
      if (fit) score.none.suggested++;
    } else {
      const kind = (score.perKind[item.label] ??= { n: 0, top1: 0, correct: 0 });
      score.positives.n++; kind.n++;
      if (item.reading?.choice === item.label) { score.positives.top1++; kind.top1++; }
      else if (item.reading) confused.set(`${item.label}\t${item.reading.choice}`, (confused.get(`${item.label}\t${item.reading.choice}`) ?? 0) + 1);
      if (fit) score.positives.suggested++;
      if (fit?.component === item.label) { score.positives.correct++; kind.correct++; }
    }
  }
  score.shaped.examples.sort((a, b) => b.confidence - a.confidence);
  score.confusion = [...confused].map(([k, n]) => { const [label, choice] = k.split("\t") as [string, string]; return { label, choice, n }; }).sort((a, b) => b.n - a.n);
  return score;
}

/** The same readings at every pair of thresholds: correct suggestions on positives against how often shaped notes hear one. */
export function sweepThresholds(items: readonly (EvalItem & { reading?: FigureFitReading })[], schemas: readonly ComponentSchema[], gates = [0.5, 0.6, 0.7], confidences = [0.3, 0.4, 0.5, 0.6]) {
  return gates.flatMap(gate => confidences.map(confidence => {
    const s = scoreReadings(items, schemas, { gate, confidence });
    // Precision over every labelled note told: a suggestion on a note labelled `none` is a wrong one.
    return { gate, confidence, recall: ratio(s.positives.correct, s.positives.n), precision: ratio(s.positives.correct, s.positives.suggested + s.none.suggested), shapedRate: ratio(s.shaped.suggested, s.shaped.n), noneRate: ratio(s.none.suggested, s.none.n) };
  }));
}

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : null);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const cell = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").slice(0, 60));

/** The report as a note an outline draws (its figures the eval's own subject), to paste or create where the work is tracked. */
export function reportNote(score: EvalScore, sweep: ReturnType<typeof sweepThresholds>, meta: { outline: string; model: string; prompt: string; asked: number; cached: number; unavailable: number }, unseen: readonly string[] = []): string {
  const p = score.positives;
  const kinds = Object.entries(score.perKind).sort((a, b) => b[1].n - a[1].n);
  return [
    `Figure-fit eval: ${meta.outline} [type::eval] [eval::figure-fit] [model::${meta.model}] [prompt::${meta.prompt.slice(0, 12)}]`,
    "",
    "::graph-stat",
    "---",
    "title: at the thresholds in use",
    `items: [{ value: "${pct(p.correct, p.n)}", label: right figure suggested }, { value: "${pct(p.top1, p.n)}", label: right figure first }, { value: "${pct(score.shaped.suggested, score.shaped.n)}", label: shaped notes told }, { value: "${pct(score.none.suggested, score.none.n)}", label: told when none }]`,
    "---",
    "::",
    "",
    `${p.n} notes that draw a figure, taken back to rows; ${score.shaped.n} shaped notes with none; ${score.none.n} labelled none. Jev asked ${meta.asked} times, ${meta.cached} answers from the cache, ${meta.unavailable} unavailable. Thresholds: gate ${score.thresholds.gate}, confidence ${score.thresholds.confidence}. The figures offered are the built-in ones (a copy holds no extensions).`,
    "",
    "::graph-table",
    "---",
    "title: by figure",
    "headers: [Figure, Notes, First, Suggested right]",
    `rows: [${kinds.map(([k, v]) => `[${cell(k)}, ${v.n}, "${pct(v.top1, v.n)}", "${pct(v.correct, v.n)}"]`).join(", ")}]`,
    "align: [left, right, right, right]",
    "---",
    "::",
    "",
    "::graph-table",
    "---",
    "title: every threshold, from the same answers",
    "headers: [Gate, Confidence, Recall, Precision, Shaped told, None told]",
    `rows: [${sweep.map(r => `[${r.gate}, ${r.confidence}, "${r.recall ?? "—"}", "${r.precision ?? "—"}", "${r.shapedRate ?? "—"}", "${r.noneRate ?? "—"}"]`).join(", ")}]`,
    "align: [right, right, right, right, right, right]",
    "---",
    "::",
    "",
    ...(unseen.length ? [`No notes to score these on (label some with --labels): ${unseen.join(", ")}.`, ""] : []),
    ...(score.confusion.length ? ["Mixed up most:", ...score.confusion.slice(0, 8).map(c => `- ${c.label} read as ${c.choice}: ${c.n}`), ""] : []),
    ...(score.shaped.examples.length ? ["Shaped notes it would tell, most sure first (label the wrong ones `none` with --labels):", ...score.shaped.examples.slice(0, 15).map(e => `- ((${e.id}|${e.title.replace(/[|()\]]/g, " ").trim().slice(0, 60)})) → ${e.component} (${e.confidence})`)] : []),
  ].join("\n");
}
