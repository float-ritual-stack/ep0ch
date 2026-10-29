// The review run over what agents already wrote (PIE-1388, Evan, Oct 29: "for the last N period of time of posts, run them
// past jev, see what gets flagged and what doesn't … get some stats based on what's already there instead of relying on
// net new only to tune things"). The eval the thresholds are tuned from: every note an agent last wrote in the window,
// reviewed whole as a new write would be, counted by Evan's rubric and by writer, with a sample of each rubric item.
//
// It reads the source outline only. With `into`, it keeps what it found there as records of its own experiment
// (`review-finding` with `source::backfill`, and a `jev-run` with `experiment::write-review-backfill`), so the
// suggestions page shows the stats beside the live reviews and Evan can mark rows right or wrong.
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { RUBRIC, type Rubric } from "@ep0ch/outline-core/write-shape";
import type { Block } from "@ep0ch/outline-core/protocol";
import { promptRevOf, writerOf, type SuggestionClient } from "./jev-suggestions";
import { writeRecord } from "./records";
import { outlineFacets, reviewWrite, type ReviewOptions, type WriteReview } from "./write-review";

export const BACKFILL_EXPERIMENT = "write-review-backfill";
/** Notes reviewed at once: Jev answers each in about a second. */
const AT_ONCE = 4;
/** Samples kept per rubric item, for the report and the page. */
const SAMPLES = 5;

export interface BackfillSample { note: string; title: string; writer: string; rule: string; passage: string; said: string }

export interface BackfillReport {
  outline?: string;
  since: string;
  /** Notes in the window, those an agent wrote last, and those reviewed (the rest left out by `limit`). */
  read: number; byAgents: number; reviewed: number;
  /** Notes left out because `into` already holds their findings (a rerun after a run that was stopped). */
  skipped: number;
  /** The window held more changed notes than one read takes (1000): the newest were read; narrow `since` for the rest. */
  truncated: boolean;
  flagged: number; passed: number; findings: number;
  /** Jev's answers: how many reviews it answered, and its tokens over the run. */
  jev: { asked: number; unavailable: number; tokensIn: number; tokensOut: number; model?: string; promptRev?: string; why?: string };
  byRubric: Record<Rubric, number>;
  /** By rule (code's and Jev's), so a rubric item's parts can be told apart. */
  byRule: Record<string, number>;
  byWriter: Record<string, { reviewed: number; flagged: number; findings: number }>;
  samples: Record<Rubric, BackfillSample[]>;
  /** The run note written in `into`, when one was. */
  run?: string;
}

export interface BackfillOptions {
  /** How far back, as the query grammar says it: `7d`. */
  since?: string;
  limit?: number;
  /** Where to keep the records; none prints the stats only. */
  into?: SuggestionClient;
  outline?: string;
  jev?: boolean;
  review?: ReviewOptions;
  now?: Date;
}

/** Every note an agent last wrote in the window, reviewed whole; nothing in `source` is written. */
export async function reviewBackfill(source: SuggestionClient, o: BackfillOptions = {}): Promise<BackfillReport> {
  const since = (o.since ?? "7d").replace(/^-/, "");
  if (!/^\d+[dhw]$/.test(since)) throw new Error(`since is a count of days, hours or weeks (7d, 12h, 2w), not ${JSON.stringify(o.since)}`);
  const schemas = (await source.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" }).catch(() => null))?.schemas ?? null;
  const facets = await outlineFacets(source as never);
  const answer = await source.request<{ blocks: Block[]; completeness?: { kind: string } }>({ action: "blocks.query", query: { where: `updated >= -${since} NOT type=annotation NOT type=peer-message`, sort: "updated desc", limit: 1000 } });
  const found = answer.blocks;
  // An extension's own pages (`ext:<name>`) and Jev's (`jev/…`: the suggestions page, its rule) are code's output, not an
  // agent's writing.
  const byAgents = found.filter(b => b.author === "agent" && b.actorId && !/^(?:ext:|jev\/)/.test(b.actorId) && b.text.trim());
  // A rerun picks up where a stopped run left off: a note `into` already holds backfill findings of is done.
  const kept = o.into ? await keptNotes(o.into) : new Set<string>();
  const window = byAgents.slice(0, o.limit ?? 500);
  const notes = window.filter(b => !kept.has(b.id));
  const report: BackfillReport = {
    ...(o.outline ? { outline: o.outline } : {}), since, read: found.length, byAgents: byAgents.length, reviewed: 0, skipped: window.length - notes.length, truncated: answer.completeness?.kind === "truncated" || found.length >= 1000, flagged: 0, passed: 0, findings: 0,
    jev: { asked: 0, unavailable: 0, tokensIn: 0, tokensOut: 0 },
    byRubric: Object.fromEntries(RUBRIC.map(r => [r, 0])) as Record<Rubric, number>, byRule: {}, byWriter: {},
    samples: Object.fromEntries(RUBRIC.map(r => [r, []])) as unknown as Record<Rubric, BackfillSample[]>,
  };
  const reviewOne = async (block: Block) => {
    const { review, reading } = await reviewWrite({ text: block.text, id: block.id, schemas, facets, jev: o.jev ?? true }, { timeoutMs: 15_000, ...o.review });
    return { block, review, reading };
  };
  for (let i = 0; i < notes.length; i += AT_ONCE) {
    for (const { block, review, reading } of await Promise.all(notes.slice(i, i + AT_ONCE).map(reviewOne))) {
      const { writer } = writerOf(block.actorId!);
      const title = headerLine(block.text).prose.trim() || "untitled";
      const w = report.byWriter[writer] ??= { reviewed: 0, flagged: 0, findings: 0 };
      report.reviewed++; w.reviewed++;
      if (review.verdict === "fix") { report.flagged++; w.flagged++; } else report.passed++;
      report.findings += review.findings.length; w.findings += review.findings.length;
      if (review.jev === "asked") report.jev.asked++; else if (!/^(?:off|not asked)/.test(review.jev)) { report.jev.unavailable++; report.jev.why = review.jev; }
      if (reading) {
        report.jev.tokensIn += reading.usage?.input ?? 0; report.jev.tokensOut += reading.usage?.output ?? 0;
        report.jev.model = reading.model; report.jev.promptRev = promptRevOf(reading);
      }
      for (const f of review.findings) {
        report.byRubric[f.rubric]++;
        report.byRule[f.rule] = (report.byRule[f.rule] ?? 0) + 1;
        if (report.samples[f.rubric].length < SAMPLES) report.samples[f.rubric].push({ note: block.id, title, writer, rule: f.rule, passage: f.passage, said: f.say });
      }
      // Every note, quiet ones too (kept as such, so a rerun doesn't ask Jev about them again).
      if (o.into) await keep(o.into, block, title, review);
    }
  }
  if (o.into) report.run = await keepRun(o.into, report, o.now ?? new Date());
  return report;
}

/**
 * A note's findings kept as it goes, in one request: the service makes the records in its own process (`suggestions.keep`,
 * PIE-1402: one record took ~3 s of round trips over a forward, and a week of pie, ~2,500 records, never finished). Sent
 * as each note is reviewed, so a run that is stopped keeps what it did.
 */
async function keep(into: SuggestionClient, block: Block, title: string, review: WriteReview): Promise<void> {
  await into.request({ action: "suggestions.keep", keep: { kind: "reviewed", at: { note: block.id, revision: block.revision, actorId: block.actorId!, source: "backfill" }, title, review } } as never, 120_000);
}

/** Every note `into` already holds a backfill's findings or quiet verdict of, by the service's groups (one answer, however many records). */
async function keptNotes(into: SuggestionClient): Promise<Set<string>> {
  const found = await into.request<{ groups?: { value: string | null }[] }>({ action: "blocks.query", query: { where: "(type=review-finding OR type=review-quiet) source=backfill", machinery: "show", limit: 1, group: "note" } } as never).catch(() => ({ groups: [] }));
  return new Set((found.groups ?? []).flatMap(g => (g.value ? [g.value] : [])));
}

/**
 * The run as a `jev-run` note in `into`, with the lab's run-level keys read for a review run: `items` notes reviewed,
 * `suggested` notes flagged, `quiet` notes passed, `agreement` the share flagged, and the tokens.
 */
async function keepRun(into: SuggestionClient, r: BackfillReport, now: Date): Promise<string> {
  // One row a run (PIE-1402: a stopped run and its rerun made a pile): the day and the window name it, and a rerun adds
  // what it did to the row the first pass left.
  const run = `${now.toISOString().slice(0, 10)}/${r.since}`;
  const counts: Record<string, number> = { items: r.reviewed, suggested: r.flagged, quiet: r.passed, unavailable: r.jev.unavailable, "tokens-in": r.jev.tokensIn, "tokens-out": r.jev.tokensOut };
  const had = (await into.request<{ blocks: { id: string; text: string; revision: number }[] }>({ action: "blocks.query", query: { where: `type=jev-run experiment=${BACKFILL_EXPERIMENT} run=${run}`, machinery: "show", limit: 1 } } as never)).blocks[0];
  if (had) {
    let text = had.text;
    const chip = (key: string) => Number(new RegExp(`\\[${key}::(\\d+(?:\\.\\d+)?)\\]`).exec(text)?.[1]) || 0;
    const set = (key: string, value: string | number) => { text = text.replace(new RegExp(`\\[${key}::[^\\]]*\\]`), () => `[${key}::${value}]`); };
    for (const [key, n] of Object.entries(counts)) set(key, chip(key) + n);
    set("agreement", chip("items") ? Math.round(chip("suggested") / chip("items") * 100) / 100 : 0);
    if (r.jev.model) set("model", r.jev.model);
    await into.request({ action: "update", blockId: had.id, text, expectedRevision: had.revision, mutation: { author: "agent", actorId: "jev/write-review" } } as never);
    return had.id;
  }
  const written = await writeRecord({ request: (action, params) => into.request({ action, ...params } as never) }, "jev-run", {
    experiment: BACKFILL_EXPERIMENT, run, model: r.jev.model ?? "unknown", "prompt-rev": r.jev.promptRev ?? "unknown",
    items: String(r.reviewed), agreed: "0", agreement: String(r.reviewed ? Math.round(r.flagged / r.reviewed * 100) / 100 : 0), suggested: String(r.flagged),
    different: "0", ignored: "0", quiet: String(r.passed), unavailable: String(r.jev.unavailable), "tokens-in": String(r.jev.tokensIn), "tokens-out": String(r.jev.tokensOut),
  }, { author: "agent", provenance: { actorId: "jev/write-review" } }, { title: `write-review backfill${r.outline ? ` of ${r.outline}` : ""}, ${r.since} to ${now.toISOString().slice(0, 10)}` });
  return written.id;
}

/** The report as a person reads it in a terminal: the numbers first, then a sample of each rubric item. */
export function backfillSummary(r: BackfillReport): string {
  const pct = (n: number) => (r.reviewed ? `${Math.round(n / r.reviewed * 100)}%` : "0%");
  const lines = [
    `${r.outline ?? "outline"} · last ${r.since}: ${r.read}${r.truncated ? "+ (the newest; narrow --since for the rest)" : ""} notes changed, ${r.byAgents} last written by an agent, ${r.reviewed} reviewed${r.skipped ? `, ${r.skipped} kept by an earlier run` : ""}${r.reviewed + r.skipped < r.byAgents ? ` (the newest; --limit for more)` : ""}`,
    `flagged ${r.flagged} (${pct(r.flagged)}) · passed ${r.passed} · ${r.findings} findings`,
    `jev: ${r.jev.asked} asked, ${r.jev.unavailable} unavailable${r.jev.why ? ` (${r.jev.why})` : ""} · ${r.jev.tokensIn} tokens in, ${r.jev.tokensOut} out${r.jev.model ? ` · ${r.jev.model}` : ""}`,
    "",
    "by rubric:",
    ...RUBRIC.map(k => `  ${k.padEnd(8)} ${String(r.byRubric[k]).padStart(5)}`),
    "by rule:",
    ...Object.entries(r.byRule).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k.padEnd(16)} ${String(n).padStart(5)}`),
    "by writer (reviewed · flagged · findings):",
    ...Object.entries(r.byWriter).sort((a, b) => b[1].reviewed - a[1].reviewed).map(([k, w]) => `  ${k.padEnd(20)} ${String(w.reviewed).padStart(5)} ${String(w.flagged).padStart(5)} ${String(w.findings).padStart(6)}`),
  ];
  for (const k of RUBRIC) {
    if (!r.samples[k].length) continue;
    lines.push("", `${k}:`);
    for (const s of r.samples[k]) lines.push(`  ${s.title.slice(0, 60)} (${s.writer}, ${s.rule}) · ${s.note.slice(0, 8)}`, `    "${s.passage.slice(0, 120)}"`, `    → ${s.said.slice(0, 160)}`);
  }
  if (r.run) lines.push("", `kept as records, run ${r.run}`);
  return lines.join("\n");
}
