// The groom's first pass (PIE-1258 step 1, "Jev first"): each queued ticket against what shipped (the CHANGELOG, merged
// pull requests) and against other tickets (closed and open), so the backlog is real before anyone reads it by hand.
//
// Code first: what shipped under the ticket's own Work ID (a CHANGELOG heading, a merged pull request) is always a
// candidate, and the search matcher adds a few of each kind; Jev answers one Noul per candidate in one request over the
// ticket (ships it? makes it unnecessary? the same work?), plus one about the ticket's newest lines: merged and then found
// wrong in use ("Finishing in PIE-n", a validate note) is open, never solved (loki, Oct 29: five merged tickets had
// failed in use an hour before the first pass called them solved). The verdict is code's truth table. Jev never closes: a
// confident "solved" leaves a comment on the ticket for the verifier, whose keeping it is how often Jev was right.
//
// Read-only unless `into` names where to keep it: a `groom-verdict` per ticket, the comment on each confident "solved",
// the "Jev thinks these are done" view, and the pass's `jev-run` with its tokens and cost.
import { rankTextSearchMatches } from "@ep0ch/outline-core/search-match";
import { workIdOf } from "@ep0ch/outline-core/work-id-title";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { askNouls, board, chips, clip, CONFIDENT, costOf, jevWho, noul, recordRun, YES, type JevOptions, type JevReading, type WorkJevClient } from "./work-jev";
import { itemTitle } from "./work-twins";
import { writeRecord } from "./records";
import type { Block, VisibleBlockCollection } from "./types";

const LOOP = "work-groom";

/** Something shipped: a CHANGELOG section or a merged pull request. */
export interface Shipped { id: string; kind: "changelog" | "pr"; title: string; text: string }
export interface GroomEvidence { changelog: string; prs: { ref: string; title: string; body?: string }[] }

export type Verdict = "solved" | "superseded" | "duplicate" | "open" | "unjudged";
export interface GroomRow {
  ticket: string;
  id: string;
  title: string;
  verdict: Verdict;
  confidence: number;
  /** What it rests on, in a line: the shipped change or the other ticket. */
  evidence: string;
  /** The other ticket a duplicate repeats. */
  of?: string;
  by: "code" | "jev" | "none";
}

export interface GroomReport { rows: GroomRow[]; counts: Record<Verdict, number>; tokens: number; cost: string; jev: string; reading?: JevReading }

/** The CHANGELOG's sections (`### …` with what follows), each something shipped. Pure. */
export function changelogSections(text: string): Shipped[] {
  const out: Shipped[] = [];
  let open: { title: string; lines: string[] } | null = null;
  const close = () => { if (open) out.push({ id: `changelog:${out.length}`, kind: "changelog", title: open.title, text: clip(open.lines.join(" "), 700) }); };
  for (const line of text.split("\n")) {
    const h = /^###\s+(.*)$/.exec(line);
    if (h) { close(); open = { title: h[1]!.trim(), lines: [] }; continue; }
    if (/^##?\s/.test(line)) { close(); open = null; continue; }
    open?.lines.push(line);
  }
  close();
  return out;
}

const WORK_ID = /\b([A-Z][A-Z0-9]*-\d+)\b/g;
const idsIn = (text: string) => new Set([...text.matchAll(WORK_ID)].map(m => m[1]!));

/** Where a ticket shipped under its own id: the CHANGELOG headings and merged pull request titles naming it. Pure. */
export function namedIn(ticket: string, shipped: readonly Shipped[]): Shipped[] {
  return shipped.filter(s => idsIn(s.title).has(ticket));
}

/** Words in a ticket's newest lines that say it shipped and isn't done: code's half of "merged, then found wrong". */
const UNFINISHED = /\b(?:finish(?:ing|ed)? in|continues? in|failed in use|back to (?:queued|doing)|still (?:broken|wrong|fails?)|reopen(?:ed)?|not (?:fixed|done)|what's left)\b/i;

/** A ticket's newest lines: its last paragraph, where findings after a merge are appended. Pure. */
export function latestLines(text: string, max = 600): string {
  const paragraphs = text.split("\n").slice(headerLine(text).line + 1).join("\n").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return clip(paragraphs.at(-1) ?? "", max);
}

const propOf = (b: Block, key: string) => b.properties.find(p => p.key === key)?.value;
const bodyOf = (b: Block) => clip(b.text.split("\n").slice(headerLine(b.text).line + 1).filter(l => !/^\s*\[[^\]]+::[^\]]*\]\s*$/.test(l)).join("\n"), 800);
const describe = (s: Shipped) => `${s.kind === "pr" ? "pull request" : "CHANGELOG"}: ${s.title}`;

interface Candidates { shipped: Shipped[]; tickets: { id: string; workId: string; title: string; stage: string; closed: boolean }[] }

/** A few candidates of each kind for one ticket, by the search matcher over its title. Pure. */
export function groomCandidates(ticket: Block, shipped: readonly Shipped[], others: readonly Block[]): Candidates {
  const title = itemTitle(ticket), named = namedIn(workIdOf(ticket) ?? "", shipped).slice(0, 3);
  const top = <T extends { id: string; title: string; text: string }>(docs: readonly T[], n: number) => rankTextSearchMatches(docs, title).filter(m => m.kind !== "title-fuzzy" && m.kind !== "text-fuzzy").slice(0, n).map(m => m.document);
  const changelog = top(shipped.filter(s => s.kind === "changelog"), 3), prs = top(shipped.filter(s => s.kind === "pr"), 3);
  const docs = others.filter(b => b.id !== ticket.id).map(b => ({ id: b.id, title: itemTitle(b), text: b.text, block: b }));
  const stageOf = (b: Block) => propOf(b, "work-stage") ?? "unknown";
  const closed = top(docs.filter(d => ["done", "superseded"].includes(stageOf(d.block))), 3), open = top(docs.filter(d => !["done", "superseded"].includes(stageOf(d.block))), 2);
  return {
    shipped: [...named, ...[...changelog, ...prs].filter(s => !named.includes(s))],
    tickets: [...closed, ...open].map(d => ({ id: d.id, workId: workIdOf(d.block) ?? d.id.slice(0, 8), title: d.title, stage: stageOf(d.block), closed: ["done", "superseded"].includes(stageOf(d.block)) })),
  };
}

/** Code's verdict over Jev's answers for one ticket: the truth table, in one place. Pure. */
export function groomVerdict(c: Candidates, answers: Record<string, number | undefined>, latest = ""): Pick<GroomRow, "verdict" | "confidence" | "evidence" | "of"> {
  const unfinished = answers.unfinished;
  if (UNFINISHED.test(latest) || (unfinished !== undefined && unfinished >= YES)) {
    return { verdict: "open", confidence: Math.max(unfinished ?? 0, UNFINISHED.test(latest) ? 0.9 : 0), evidence: `merged, then found unfinished: ${clip(latest, 160)}` };
  }
  const best = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ i, p: answers[`${prefix}::${i}`] })).filter((x): x is { i: number; p: number } => x.p !== undefined).sort((a, b) => b.p - a.p)[0];
  const ships = best("ships", c.shipped.length), replaces = best("replaces", c.shipped.length), dup = best("duplicate", c.tickets.length);
  if (ships && ships.p >= CONFIDENT) return { verdict: "solved", confidence: ships.p, evidence: describe(c.shipped[ships.i]!) };
  if (replaces && replaces.p >= CONFIDENT) return { verdict: "superseded", confidence: replaces.p, evidence: describe(c.shipped[replaces.i]!) };
  if (dup && dup.p >= CONFIDENT) {
    const t = c.tickets[dup.i]!;
    return { verdict: "duplicate", confidence: dup.p, evidence: `${t.workId} (${t.stage}): ${t.title}`, of: t.workId };
  }
  const top = Math.max(ships?.p ?? 0, replaces?.p ?? 0, dup?.p ?? 0);
  const near = top >= YES ? [ships, replaces].some(x => x?.p === top) ? describe(c.shipped[(top === ships?.p ? ships : replaces)!.i]!) : `${c.tickets[dup!.i]!.workId}: ${c.tickets[dup!.i]!.title}` : "nothing shipped or filed does it";
  return { verdict: "open", confidence: Math.round((1 - top) * 100) / 100, evidence: top >= YES ? `close but under ${CONFIDENT}: ${near}` : near };
}

export interface GroomOptions extends JevOptions {
  /** Which tickets: a query in the views' grammar (default every queued ticket). */
  where?: string;
  limit?: number;
  /** Whether Jev is asked at all. */
  jev?: boolean;
  /** Said as the pass progresses. */
  progress?: (line: string) => void;
}

/** The pass over `source`'s tickets. Reads only. */
export async function groom(source: WorkJevClient, evidence: GroomEvidence, o: GroomOptions = {}): Promise<GroomReport> {
  const where = o.where ?? "type=roadmap-item work-stage=queued";
  const tickets = (await source.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, limit: Math.min(o.limit ?? 1000, 1000) } })).blocks;
  const others = (await source.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "type=roadmap-item", limit: 1000 } })).blocks;
  const shipped: Shipped[] = [...changelogSections(evidence.changelog), ...evidence.prs.map((p, i) => ({ id: `pr:${i}`, kind: "pr" as const, title: `${p.title} (${p.ref})`, text: clip(`${p.title} ${p.body ?? ""}`, 500) }))];
  const rows: GroomRow[] = [];
  let tokens = 0, jev = o.jev === false ? "off" : "not asked", reading: JevReading | undefined;
  for (const [n, t] of tickets.entries()) {
    const ticket = workIdOf(t) ?? t.id.slice(0, 8), title = itemTitle(t);
    const c = groomCandidates(t, shipped, others), latest = latestLines(t.text), named = namedIn(ticket, shipped)[0];
    // With Jev off, code says what it can: named in what shipped, unless its newest lines say it isn't done.
    const codeOnly = (why: string): GroomRow => named && !UNFINISHED.test(latest)
      ? { ticket, id: t.id, title, verdict: "solved", confidence: 0.8, evidence: `shipped under its id: ${describe(named)}`, by: "code" }
      : { ticket, id: t.id, title, verdict: o.jev === false || named ? "unjudged" : "open", confidence: 0, evidence: named ? `named in ${describe(named)}, but its newest lines: ${clip(latest, 120)}` : why, by: "none" };
    if (o.jev === false) { rows.push(codeOnly("Jev off")); continue; }
    if (!c.shipped.length && !c.tickets.length) { rows.push(codeOnly("nothing shipped or filed shares its words")); continue; }
    const questions = Object.fromEntries([
      ["unfinished", { ask: "unfinished" as const, candidate: "" }] as const,
      ...c.shipped.flatMap((s, i) => {
        const candidate = JSON.stringify({ title: s.title, what: s.text });
        return [[`ships::${i}`, { ask: "ships" as const, candidate }], [`replaces::${i}`, { ask: "replaces" as const, candidate }]] as const;
      }),
      ...c.tickets.map((x, i) => [`duplicate::${i}`, { ask: "duplicate" as const, candidate: JSON.stringify({ id: x.workId, title: x.title, stage: x.stage }) }] as const),
    ]);
    const asked = await askNouls({ ticket: { id: ticket, title, body: bodyOf(t), latest } }, questions, o);
    if ("unavailable" in asked) {
      jev = asked.unavailable;
      rows.push(codeOnly(asked.unavailable));
      continue;
    }
    jev = "asked"; reading = asked.reading; tokens += asked.reading.usage?.input ?? 0;
    const answers = Object.fromEntries(Object.keys(questions).map(id => [id, noul(asked.answers, id)]));
    rows.push({ ticket, id: t.id, title, ...groomVerdict(c, answers, latest), by: "jev" });
    o.progress?.(`${n + 1}/${tickets.length} ${ticket} ${rows.at(-1)!.verdict}`);
  }
  const counts = { solved: 0, superseded: 0, duplicate: 0, open: 0, unjudged: 0 } as Record<Verdict, number>;
  for (const r of rows) counts[r.verdict]++;
  const usage = reading ? { ...reading, usage: { input: tokens, output: 0 } } : undefined;
  return { rows, counts, tokens, cost: costOf(tokens), jev, ...(usage ? { reading: usage } : {}) };
}

/** The view a verifier starts from: every ticket Jev confidently thinks is done, with its evidence. */
export const JEV_DONE_VIEW = [
  "Jev thinks these are done [system-view::jev-done] [machine::record]",
  "",
  "> [!summary] Queued tickets Jev's groom reads as already shipped, with what shipped.",
  "> A verifier confirms each on today's main and closes it with proof. Jev never closes; keeping its comment counts it right.",
  "",
  "::graph-table",
  "---",
  "title: confident it shipped, newest pass first",
  `query: type=groom-verdict verdict=solved`,
  "machinery: show",
  "columns: [item, confidence, evidence, by]",
  "sort: created",
  "direction: desc",
  "limit: 50",
  "---",
  "::",
].join("\n");

/** Keeps a report in `into`: verdicts, the comment on each confident "solved", the view, the run. Returns what it wrote. */
export async function keepGroom(into: WorkJevClient, report: GroomReport, o: { pass?: string } = {}): Promise<{ verdicts: number; comments: number; run: string }> {
  const pass = o.pass ?? new Date().toISOString().slice(0, 16);
  let verdicts = 0, comments = 0;
  const views = await into.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "system-view=jev-done", machinery: "show", limit: 1 } });
  if (!views.blocks.length) await into.request({ action: "create", text: JEV_DONE_VIEW, parentId: null, ...jevWho(LOOP) });
  for (const r of report.rows) {
    let thread = "none";
    if (r.verdict === "solved" && r.confidence >= CONFIDENT) {
      const ticket = await into.request<Block>({ action: "get", blockId: r.id }).catch(() => null);
      if (ticket) {
        const receipt = await into.request<{ annotations: { block: { id: string } }[] }>({
          action: "annotations.batch", requestId: crypto.randomUUID(), ...jevWho(LOOP),
          operations: [{ operationId: "groom", type: "block-comment", input: { blockId: ticket.id, expectedRevision: ticket.revision, source: "agent", properties: { kind: "jev-groom" },
            body: `Jev thinks this is done (${r.confidence.toFixed(2)}): ${r.evidence}. Not closed: a verifier confirms it on today's main and closes it with proof; keep this comment when Jev was right.` } }],
        }).catch(() => null);
        if (receipt) { thread = receipt.annotations[0]!.block.id; comments++; }
      }
    }
    await writeRecord(board(into), "groom-verdict", chips({ item: r.ticket, verdict: r.verdict, confidence: r.confidence.toFixed(2), evidence: r.of ? `${r.of}: ${r.evidence}` : r.evidence, by: r.by, pass, thread }), jevWho(LOOP), { title: `${r.ticket} ${r.verdict}` });
    verdicts++;
  }
  const run = await recordRun(into, LOOP, pass, { items: report.rows.length, suggested: report.counts.solved + report.counts.superseded + report.counts.duplicate, unavailable: report.counts.unjudged }, report.reading);
  return { verdicts, comments, run };
}

/** The report as a person reads it: counts first, then each judged ticket. */
export function groomSummary(report: GroomReport): string {
  const c = report.counts;
  const lines = [
    `${report.rows.length} queued tickets · ${c.solved} solved · ${c.superseded} superseded · ${c.duplicate} duplicate · ${c.open} open${c.unjudged ? ` · ${c.unjudged} unjudged (${report.jev})` : ""}`,
    `Jev: ${report.jev} · ${report.tokens} tokens in · $${report.cost}`,
  ];
  for (const verdict of ["solved", "superseded", "duplicate"] as const) {
    const rows = report.rows.filter(r => r.verdict === verdict);
    if (!rows.length) continue;
    lines.push("", `${verdict}:`);
    for (const r of rows) lines.push(`  ${r.ticket} ${r.confidence.toFixed(2)} ${clip(r.title, 70)} · ${r.by === "code" ? "" : "Jev: "}${clip(r.evidence, 120)}`);
  }
  return lines.join("\n");
}
