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
import { askNouls, chips, clip, dayOf, jevWho, NO, noul, tallyRun, YES, board, type JevOptions, type JevReading, type WorkJevClient } from "./work-jev";
import { writeRecord } from "./records";
import type { TwinAnswer as WireTwinAnswer, TwinCandidate } from "@ep0ch/outline-core/protocol";
import type { Block, BlockAuthor, BlockProvenance, VisibleBlockCollection } from "./types";

/** Candidates Jev is asked about, at most. */
export const TWIN_CANDIDATES = 5;
/** How long a filing waits for Jev before it goes on with the text match alone. */
export const TWIN_JEV_MS = 4000;
const LOOP = "work-twins";

/** Title matches strong enough to be a twin with no Jev: the phrase, or every term, in the title. */
const STRONG: ReadonlySet<string> = new Set<SearchMatchKind>(["exact-title", "title-prefix", "title-contains", "title-terms"]);
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

/** Open items like `title`, best first: code's candidates before Jev reads any. Pure. */
export function twinCandidates(open: readonly Block[], title: string, limit = TWIN_CANDIDATES): (Omit<TwinCandidate, "verdict" | "said"> & { block: Block })[] {
  const docs = open.map(b => ({ id: b.id, title: itemTitle(b), text: b.text, block: b }));
  return rankTextSearchMatches(docs, title).filter(m => !WEAK.has(m.kind) && (m.kind !== "some-terms" || (m.inTitle ?? 0) >= 0.5)).slice(0, limit).map(m => ({
    id: m.document.id, workId: workIdOf(m.document.block) ?? m.document.id.slice(0, 8), title: m.document.title, stage: propOf(m.document.block, "work-stage") ?? "unknown", match: m.kind, inTitle: Math.round(m.inTitle * 100) / 100, block: m.document.block,
  }));
}

/** Code's call over Jev's answers (or none): the truth table, in one place. Pure. */
export function twinVerdict(c: Pick<TwinCandidate, "match" | "same" | "part"> & { inTitle?: number }): TwinCandidate["verdict"] {
  if (c.same !== undefined && c.same >= YES) return "same";
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
  const found = twinCandidates(await openItems(client), input.title, o.limit);
  if (!found.length) return { candidates: [], twins: [], jev: "not asked: no open item shares its words" };
  const questions = Object.fromEntries(found.flatMap((c, i) => {
    const candidate = JSON.stringify({ id: c.workId, title: c.title, stage: c.stage, body: bodyOf(c.block, 500) });
    return [[`same::${i}`, { ask: "same" as const, candidate }], [`part::${i}`, { ask: "part" as const, candidate }]];
  }));
  const asked = await askNouls({ new: { title: input.title, ...(input.body?.trim() ? { body: clip(input.body, 800) } : {}) } }, questions, o);
  const answers = "answers" in asked ? asked.answers : undefined;
  const candidates: TwinCandidate[] = found.map(({ block: _block, ...c }, i) => {
    const same = noul(answers, `same::${i}`), part = noul(answers, `part::${i}`);
    const withJev = { ...c, ...(same === undefined ? {} : { same }), ...(part === undefined ? {} : { part }) };
    const judged = { ...withJev, verdict: twinVerdict(withJev) };
    return { ...judged, said: twinLine(judged) };
  });
  const order = (v: TwinCandidate["verdict"]) => ["same", "text", "part", "related"].indexOf(v);
  candidates.sort((a, b) => order(a.verdict) - order(b.verdict) || (b.same ?? 0) - (a.same ?? 0));
  return {
    candidates,
    twins: candidates.filter(c => c.verdict === "same" || c.verdict === "text").map(c => c.workId),
    jev: "answers" in asked ? "asked" : asked.unavailable,
    ...("reading" in asked ? { reading: asked.reading } : {}),
  };
}

/** One candidate as an agent or a hint row reads it: `PIE-12 (doing) Title · same work 0.86`. */
export function twinLine(c: Omit<TwinCandidate, "said">): string {
  const why = c.verdict === "same" ? `same work, Jev ${c.same!.toFixed(2)}` : c.verdict === "part" ? `a step of it, Jev ${c.part!.toFixed(2)}`
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
