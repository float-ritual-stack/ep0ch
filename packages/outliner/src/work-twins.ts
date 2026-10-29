// Twins at filing (PIE-1258, "Built in, not remembered": Evan, Oct 24, "you are about to file a ticket, is there an
// existing one this could be attached to instead? (that's still open, not reopen an old one)"). The service answers
// `roadmap.items.similar` for every client: the search matcher finds open items like the new one (code), Jev answers two
// Nouls per candidate in one request (the same work? one more step of it?), and code decides which are twins. With Jev
// off or unreachable, a strong title match is a twin on its own and is said to be a text match.
//
// An agent's `roadmap.items.create` with a twin is refused, naming them and the two calls (attach, or `new: true`);
// a person's never is (the door shows a hint row instead). `roadmap.items.attach` adds the new ask under the twin in its
// writer's words, dated, the way Evan's asks gather under an idea. Every offer and what became of it is a `work-twin`
// record, so "attached vs filed anyway" and how often Jev was right are countable.
import { headerLine } from "@ep0ch/outline-core/header-line";
import { rankTextSearchMatches, type SearchMatchKind } from "@ep0ch/outline-core/search-match";
import { workIdOf, workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { parseWorkId } from "@ep0ch/outline-core/work-ids";
import { deepCandidates } from "./search-deep";
import { askNouls, chips, clip, dayOf, jevWho, NO, noul, tallyRun, YES, board, type JevOptions, type JevReading, type WorkJevClient } from "./work-jev";
import { writeRecord } from "./records";
import type { TwinAnswer as WireTwinAnswer, TwinCandidate } from "@ep0ch/outline-core/protocol";
import type { Block, BlockAuthor, BlockProvenance, VisibleBlockCollection } from "./types";

/**
 * Candidates Jev is asked about, at most. Wide on purpose (PIE-1402): a twin filed in other words may share no word with
 * its original, so the matcher's title and body candidates are joined by deep search's (by meaning), and Jev's same and
 * part Nouls, in one request, decide.
 */
export const TWIN_CANDIDATES = 12;
/** How long a filing waits for Jev before it goes on with the text match alone. */
export const TWIN_JEV_MS = 6000;
const LOOP = "work-twins";

/** Title matches strong enough to be a twin with no Jev: the phrase, or every term, in the title. */
const STRONG: ReadonlySet<string> = new Set<SearchMatchKind>(["exact-title", "title-prefix", "title-contains", "title-terms"]);
/** How many items deep search adds by meaning, and how long it may take of a filing's wait. */
const DEEP_TWINS = 6, DEEP_TWIN_MS = 2500;
/** At or over this (and under YES) Jev hasn't settled whether it's the same work: offered, for the writer to say. */
export const UNSURE = 0.45;
/** Kinds that are evidence at all; the fuzzy ones match letters, not words. */
const WEAK: ReadonlySet<SearchMatchKind> = new Set(["title-fuzzy", "text-fuzzy"]);

export type { TwinCandidate };
/** The answer, with Jev's reading for the run's tokens. */
export type TwinAnswer = Omit<WireTwinAnswer, "tokens"> & { reading?: JevReading };

const propOf = (b: Block, key: string) => b.properties.find(p => p.key === key)?.value;

/** An item's title without its Work ID. */
export function itemTitle(b: Pick<Block, "text" | "properties">): string {
  return workIdTitle(headerLine(b.text).prose.trim(), workIdOf(b) ?? null).title;
}

/** The body under an item's title and property lines, clipped for Jev. */
const bodyOf = (b: Block, max = 600) => clip(b.text.split("\n").slice(headerLine(b.text).line + 1).filter(l => !/^\s*\[[^\]]+::[^\]]*\]\s*$/.test(l)).join("\n"), max);

/**
 * Open items like the new one, best first: code's candidates before Jev reads any. The matcher over the new title and,
 * when one is given, its body (a paraphrase shares the body's words, not the title's), each item's best match kept.
 * Pure.
 */
export function twinCandidates(open: readonly Block[], title: string, limit = TWIN_CANDIDATES, body?: string, o: { meant?: readonly string[] } = {}): (Omit<TwinCandidate, "verdict" | "said"> & { block: Block; filler?: true })[] {
  const docs = open.map(b => ({ id: b.id, title: itemTitle(b), text: b.text, block: b }));
  const best = new Map<string, ReturnType<typeof rankTextSearchMatches<typeof docs[number]>>[number]>();
  // The title's matches first (they outrank any of the body's at the same rung), then the body's first sentences.
  for (const query of [title, ...(body?.trim() ? [clip(body, 160)] : [])]) {
    for (const m of rankTextSearchMatches(docs, query)) if (!WEAK.has(m.kind) && !best.has(m.document.id)) best.set(m.document.id, m);
  }
  // Then the items deep search found by meaning (`meant`, search-deep.ts: a paraphrase shares no word with its twin),
  // best first; code never calls one of these a twin, only Jev's sure yes can (findTwins).
  const byId = new Map(docs.map(d => [d.id, d]));
  const meant = (o.meant ?? []).flatMap(id => { const d = byId.get(id); return d && !best.has(id) ? [d] : []; });
  // Room for what meaning found: the matcher's weakest give way to it.
  const words = [...best.values()].slice(0, Math.max(limit - meant.length, Math.ceil(limit / 2)));
  const filled = [...words, ...meant.map(d => ({ document: d, kind: "some-terms" as const, score: 0, title: d.title, inTitle: 0, filler: true as const }))];
  return filled.slice(0, limit).map(m => ({ ...("filler" in m ? { filler: true as const } : {}),
    id: m.document.id, workId: workIdOf(m.document.block) ?? m.document.id.slice(0, 8), title: m.document.title, stage: propOf(m.document.block, "work-stage") ?? "unknown", match: m.kind, inTitle: Math.round(m.inTitle * 100) / 100, block: m.document.block,
  }));
}

/** Code's call over Jev's answers (or none): the truth table, in one place. Pure. */
export function twinVerdict(c: Pick<TwinCandidate, "match" | "same" | "part"> & { inTitle?: number }): TwinCandidate["verdict"] {
  if (c.same !== undefined && c.same >= YES) return "same";
  // Between yes and no (a paraphrase whose words differ, PIE-1402): the state doesn't settle it, so the writer does.
  if (c.same !== undefined && c.same >= UNSURE) return "unsure";
  if (c.part !== undefined && c.part >= YES) return "part";
  // Jev read it and said no to both: a title that shares words is no twin.
  if (c.same !== undefined && c.same < NO && (c.part ?? 0) < NO) return "related";
  // All its words in the title, or all but one of four or more.
  return STRONG.has(c.match) || (c.match === "partial-terms" && (c.inTitle ?? 0) >= 0.75) ? "text" : "related";
}

/** The open items (every stage but done and superseded). */
export async function openItems(client: WorkJevClient): Promise<Block[]> {
  return (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "type=roadmap-item NOT work-stage=done NOT work-stage=superseded", limit: 1000 } })).blocks;
}

/** The candidates and twins for a new item: code finds, Jev reads, code decides. Never throws for Jev. */
export async function findTwins(client: WorkJevClient, input: { title: string; body?: string }, o: JevOptions & { limit?: number } = {}): Promise<TwinAnswer> {
  // A filing waits on it: Jev gets a short budget, so the caller's own timeout never fires first.
  o = { timeoutMs: TWIN_JEV_MS, ...o };
  const open = await openItems(client);
  // By meaning too (search-deep.ts): a twin filed in other words. Its budget is part of the filing's; past it, words alone.
  const started = Date.now();
  const deep = await deepCandidates(open, [input.title, input.body?.trim()].filter(Boolean).join("\n\n"), { limit: DEEP_TWINS, jev: { ...o, timeoutMs: Math.min(DEEP_TWIN_MS, o.timeoutMs!) } });
  // The Nouls get what's left of the budget, so the two together never pass it.
  o = { ...o, timeoutMs: Math.max(1500, o.timeoutMs! - (Date.now() - started)) };
  const found = twinCandidates(open, input.title, o.limit, input.body, { meant: "candidates" in deep ? deep.candidates.map(c => c.id) : [] });
  if (!found.length) return { candidates: [], twins: [], jev: "not asked: no open item shares its words" };
  const questions = Object.fromEntries(found.flatMap((c, i) => {
    const candidate = JSON.stringify({ id: c.workId, title: c.title, stage: c.stage, body: bodyOf(c.block, 500) });
    return [[`same::${i}`, { ask: "same" as const, candidate }], [`part::${i}`, { ask: "part" as const, candidate }]];
  }));
  const asked = await askNouls({ new: { title: input.title, ...(input.body?.trim() ? { body: clip(input.body, 800) } : {}) } }, questions, o);
  const answers = "answers" in asked ? asked.answers : undefined;
  const candidates: TwinCandidate[] = found.flatMap(({ block: _block, filler, ...c }, i) => {
    const same = noul(answers, `same::${i}`), part = noul(answers, `part::${i}`);
    const withJev = { ...c, ...(same === undefined ? {} : { same }), ...(part === undefined ? {} : { part }) };
    const judged = { ...withJev, verdict: twinVerdict(withJev) };
    // A pool filler that shares no words is a candidate only when Jev is sure it's the same work, or a step of it.
    return filler && (judged.verdict === "related" || judged.verdict === "unsure") ? [] : [{ ...judged, said: twinLine(judged) }];
  });
  const order = (v: TwinCandidate["verdict"]) => ["same", "text", "unsure", "part", "related"].indexOf(v);
  // Twins oldest first (PIE-1402: a near-duplicate named the newer twin, which was itself filed beside the original):
  // the original is the one to attach to; the rest by Jev's confidence.
  const twin = (c: TwinCandidate) => TWIN.has(c.verdict);
  // A sure twin before an unsure one; among twins as sure, the original first.
  const sure = (c: TwinCandidate) => (c.verdict === "unsure" ? 1 : 0);
  candidates.sort((a, b) => Number(twin(b)) - Number(twin(a)) || (twin(a) ? sure(a) - sure(b) || olderFirst(a.workId, b.workId) : 0) || order(a.verdict) - order(b.verdict) || (b.same ?? 0) - (a.same ?? 0));
  return {
    candidates,
    twins: candidates.filter(twin).map(c => c.workId),
    jev: "answers" in asked ? "asked" : asked.unavailable,
    ...("reading" in asked ? { reading: asked.reading } : {}),
  };
}

/** The verdicts an agent's create is refused over: a twin, sure or not, is the writer's to attach to or file beside. */
const TWIN: ReadonlySet<TwinCandidate["verdict"]> = new Set(["same", "text", "unsure"]);

/**
 * Which of two items is the original: the lower Work ID number (PIE-12 before PIE-120); negative when `a` is. 0 when either
 * has no Work ID (nothing says which came first). The one answer twins at filing and the groom both use.
 */
export function olderFirst(a: string, b: string): number {
  const x = parseWorkId(a)?.number, y = parseWorkId(b)?.number;
  return x === undefined || y === undefined ? 0 : x - y;
}

/** One candidate as an agent or a hint row reads it: `PIE-12 (doing) Title · same work 0.86`. */
export function twinLine(c: Omit<TwinCandidate, "said">): string {
  const why = c.verdict === "same" ? `same work, Jev ${c.same!.toFixed(2)}` : c.verdict === "unsure" ? `maybe the same work, Jev unsure (${c.same!.toFixed(2)})` : c.verdict === "part" ? `a step of it, Jev ${c.part!.toFixed(2)}`
    : c.verdict === "text" ? `the title matches${c.same === undefined ? " (text match; Jev not asked)" : ` (Jev unsure, ${c.same.toFixed(2)})`}` : "shares words";
  return `${c.workId} (${c.stage}) ${c.title} · ${why}`;
}

/**
 * The refusal an agent's create gets when the new item has twins: the candidates, then the two calls with real values.
 * Errors teach the right call.
 */
export function twinRefusal(answer: TwinAnswer, title: string): string {
  const top = answer.candidates.filter(c => answer.twins.includes(c.workId));
  const first = top[0]!.workId;
  return [
    `not filed: "${clip(title, 80)}" looks like open work already:`,
    ...top.slice(0, 3).map(c => `  - ${c.said}`),
    `Attach it there (its words, dated, under the item): work_create with attach: "${first}" (CLI: work create … --attach ${first}).`,
    `Or file it anyway, said in the item as filed beside ${top.map(c => c.workId).join(", ")}: work_create with new: true (CLI: --new).`,
  ].join("\n");
}

// ── Records ────────────────────────────────────────────────────────────────

/**
 * An offer and what became of it, as a fact; the day's twins run counts the tokens. An offer to the person (the door's
 * hint, `roadmap.items.similar` with twins) is `offered` with writer `person`. Never throws.
 */
export async function recordTwin(client: WorkJevClient, answer: TwinAnswer, at: { title: string; outcome: "offered" | "filed-anyway" | "attached"; item?: string; actorId?: string; twin?: string }): Promise<void> {
  try {
    const twin = at.twin ?? answer.twins[0] ?? answer.candidates[0]?.workId;
    const c = answer.candidates.find(x => x.workId === twin);
    await writeRecord(board(client), "work-twin", chips({
      day: dayOf(), title: clip(at.title, 160), twin: twin ?? "none", same: c?.same === undefined ? "unknown" : c.same.toFixed(2),
      outcome: at.outcome, item: at.item ?? "none", writer: at.actorId ?? "person", by: answer.jev === "asked" ? "jev" : "text match",
    }), jevWho(LOOP), { title: `${at.outcome}: ${clip(at.title, 80)}` });
    if (at.outcome !== "attached") await tallyTwins(client, answer);
  } catch { /* the item has landed or been refused already; the record is bookkeeping */ }
}

/** A check that found nothing (or an attach, which asked nothing): only the day's run counts it, with its tokens. Never throws. */
export async function tallyTwins(client: WorkJevClient, answer: TwinAnswer): Promise<void> {
  // A check Jev wasn't asked for and that found nothing cost nothing and says nothing: no run for it.
  if (answer.jev !== "asked" && !answer.twins.length) return;
  try {
    await tallyRun(client, LOOP, dayOf(), { items: 1, suggested: answer.twins.length ? 1 : 0, ...(answer.jev === "asked" || /^not asked|^off/.test(answer.jev) ? {} : { unavailable: 1 }) }, answer.reading);
  } catch { /* bookkeeping */ }
}

// ── Attach ─────────────────────────────────────────────────────────────────

export interface AttachInput {
  /** The open item to add to: a Work ID or block id. */
  item: string;
  title: string;
  body?: string;
  /** The note the ask came from (a request copy): linked from the line. */
  sourceBlockId?: string;
}

/**
 * The ask added under its twin, in its writer's words and dated (daddy on PIE-1258: "asking again is signal"): a line at
 * the end of the item, `- **Asked again, Oct 29** (by loki): <title>`, its body indented under it. Revision-checked;
 * read again once when the item changed while it was being written.
 */
export function attachText(itemText: string, input: AttachInput, by: string, now = new Date()): string {
  const when = now.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const source = input.sourceBlockId ? ` ((${input.sourceBlockId}|source))` : "";
  const body = (input.body ?? "").trim().split("\n").filter(l => l.trim()).map(l => `  ${l}`);
  return `${itemText.replace(/\s+$/, "")}\n\n- **Asked again, ${when}** (by ${by}): ${input.title.trim()}${source}${body.length ? `\n${body.join("\n")}` : ""}`;
}

export const writerName = (author: BlockAuthor | undefined, provenance?: BlockProvenance) => author === "agent" ? (provenance?.actorId?.split("/")[0] || "an agent") : "Evan";
