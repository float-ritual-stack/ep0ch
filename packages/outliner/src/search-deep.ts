// Deep search (PIE-1200): Jev finds candidates the text match never surfaced. Reranking can't recover a note no
// word of the query is in; this reads the notes themselves. The pool (every live note a search may show, or what
// `where` keeps) is cut into windows of at most WINDOW notes, each one request: a Choice over its notes (each by its
// title, type and first line) and a Noul, "is the note wanted among these?". Windows run a few at a time and merge by
// probability, the Choice's weighed by its window's Noul. Code keeps the top `limit`; search-ranking.ts then scores
// them beside the text's candidates as it scores those. Twins at filing and the groom (work-twins.ts, work-groom.ts)
// call it with their own pool.
import { headedTitle, workIdOf } from "@ep0ch/outline-core/work-id-title";
import { loadDeepPrompt, type PromptRevision } from "./ai-prompts";
import { askJev, JEV_LATE, jevKey, type JevOptions, type JevReading } from "./jev";
import { blockDisplayTitle } from "./references";
import { jevOff } from "./work-jev";
import { RANK_TIMEOUT_MS, RANKING_SKIPPED, rankSearchWithJev, searchBudget } from "./search-ranking";
import type { Block, GotoSearchCollection, GotoSearchMatch } from "./types";
import { getProperty } from "./properties";

/** A Choice takes at most 255 options (docs.typesafe.ai, line-by-line search). */
export const WINDOW = 250;
/** Windows asked at once: Jev's rate limit is per organisation, and a search shouldn't take it all. */
export const DEEP_AT_ONCE = 4;
/** A note is a candidate when its window's weighed probability reaches this. */
export const DEEP_MIN = 0.02;
/** At most this many from one window: a window whose Noul is unsure spreads its probability thin. */
const PER_WINDOW = 5;
/** A deep pass is asked only with this much of its search's budget left: less and no window would be read. */
export const DEEP_LEAST_MS = 250;
/** What a deep pass that ran out of time says. */
export const DEEP_LATE = "Jev didn't read every note in time";
/** Whether `unavailable` is a deep pass (or one of its windows) out of time, rather than Jev refusing or missing. */
export const deepLate = (unavailable: string) => unavailable === DEEP_LATE || unavailable === JEV_LATE;

export interface DeepCandidate { id: string; p: number }
export interface DeepAnswer {
  candidates: DeepCandidate[];
  /** The highest of the windows' Nouls: whether the note wanted is anywhere in the pool. */
  exists: number | undefined;
  windows: number;
  elapsedMs: number;
  reading?: JevReading;
}

/** A note as one option reads: its title (with its work id), its type, and the start of what's under the title. */
export function optionOf(block: Block): string {
  const title = headedTitle(blockDisplayTitle(block), workIdOf(block)).slice(0, 100);
  const type = getProperty(block.properties, "type");
  const body = block.text.split("\n").slice(1).join(" ").replace(/\[[^\]]*::[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return [title, type ? `(${type})` : "", body ? `: ${body}` : ""].filter(Boolean).join(" ");
}

/** The notes deep search reads: live, not a comment, not the tools' bookkeeping. */
export function deepPool(blocks: Iterable<Block>, where?: (b: Block) => boolean): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.deletedAt || b.effectiveDeletedRootId) continue;
    const type = getProperty(b.properties, "type");
    if (type === "annotation" || type === "annotation-reply" || type === "annotations-root" || b.properties.some(p => p.key === "machine")) continue;
    if (where && !where(b)) continue;
    out.push(b);
  }
  return out;
}

type Prompt = { choice: string; exists: { instructions: string; true: string; false: string }; revisions: PromptRevision[] };

/** One window's request: the query in the state, a Choice over its notes and the Noul. */
export function windowRequest(query: string, window: readonly Block[], prompt: Prompt) {
  const options = Object.fromEntries(window.map((b, k) => [`n${k}`, optionOf(b)]));
  return {
    state: { query },
    questions: {
      which: { type: "choice", instructions: prompt.choice, criteria: options },
      exists: { type: "noul", instructions: `${prompt.exists.instructions}\nNotes: ${JSON.stringify(Object.values(options))}`, criteria: { true: prompt.exists.true, false: prompt.exists.false } },
    },
  };
}

/**
 * The notes Jev finds for `query` in `blocks` (narrowed by `where`), best first, or why it couldn't be asked. Never
 * throws. `timeoutMs` bounds the whole pass: a caller that waits (a filing, a search with what its budget leaves) gets
 * `unavailable` past it, never half.
 */
export async function deepCandidates(blocks: Iterable<Block>, query: string, o: { where?: (b: Block) => boolean; limit?: number; jev?: JevOptions & { promptDirectory?: string } } = {}): Promise<DeepAnswer | { unavailable: string }> {
  const jev = o.jev ?? {};
  if (!jev.apiKey && jevOff(jev.env)) return { unavailable: "Jev is not configured here (OUTLINER_FIGURE_FIT=off)" };
  const apiKey = jev.apiKey ?? await jevKey(jev.env);
  if (!apiKey) return { unavailable: "Jev is not configured: with-secrets --add typesafe TYPESAFE_API_KEY" };
  const started = performance.now();
  let prompt: Prompt;
  try { prompt = await loadDeepPrompt(jev.promptDirectory); } catch (e) { return { unavailable: `Jev: ${(e as Error).message}` }; }
  const pool = deepPool(blocks, o.where);
  if (!pool.length) return { candidates: [], exists: undefined, windows: 0, elapsedMs: 0 };
  const windows: Block[][] = [];
  for (let i = 0; i < pool.length; i += WINDOW) windows.push(pool.slice(i, i + WINDOW));
  const deadline = jev.timeoutMs ?? 20_000;
  const found: DeepCandidate[] = [];
  let exists: number | undefined, input = 0, output = 0, model: string | undefined, failed: string | undefined, next = 0;
  const run = Promise.all(Array.from({ length: Math.min(DEEP_AT_ONCE, windows.length) }, async () => {
    for (let w = next++; w < windows.length && !failed; w = next++) {
      const window = windows[w]!;
      const r = windowRequest(query, window, prompt);
      const asked = await askJev(r.state, r.questions, prompt.revisions, { ...jev, apiKey, timeoutMs: Math.max(1000, deadline - (performance.now() - started)) });
      if ("unavailable" in asked) { failed = asked.unavailable; return; }
      model = asked.reading.model; input += asked.reading.usage?.input ?? 0; output += asked.reading.usage?.output ?? 0;
      const noul = asked.answers.exists?.noul;
      const weight = typeof noul === "number" && noul >= 0 && noul <= 1 ? noul : 1;
      if (typeof noul === "number") exists = Math.max(exists ?? 0, noul);
      const probabilities = asked.answers.which?.probabilities ?? {};
      Object.entries(probabilities).map(([name, p]) => ({ k: Number(name.slice(1)), p: p * weight })).filter(x => Number.isInteger(x.k) && window[x.k] && x.p >= DEEP_MIN)
        .sort((a, b) => b.p - a.p).slice(0, PER_WINDOW).forEach(x => found.push({ id: window[x.k]!.id, p: x.p }));
    }
  }));
  const timer = new Promise<"late">(resolve => setTimeout(() => resolve("late"), deadline).unref?.());
  if (await Promise.race([run.then(() => "done" as const), timer]) === "late") return { unavailable: DEEP_LATE };
  if (failed) return { unavailable: failed };
  found.sort((a, b) => b.p - a.p);
  return {
    candidates: found.slice(0, o.limit ?? 20), exists, windows: windows.length, elapsedMs: Math.round(performance.now() - started),
    reading: { model: model ?? "unknown", prompt: prompt.revisions, questions: windows.length * 2, usage: { input, output } },
  };
}

// ─── The service's searches over the pass ────────────────────────────────────

type Semantic = GotoSearchCollection["semantic"];
type Deep = NonNullable<Semantic["deep"]>;
/** What a search's deep pass reads from the service, and where it counts what it asked. */
export interface DeepSearch {
  /** Every live note (the store's `searchPool`). */
  pool(): Block[];
  /** Notes the pass found, as search rows (the store's `searchMatches`). */
  matches(ids: readonly string[], query: string): GotoSearchMatch[];
  promptDirectory?: string;
  /** The day's run counts each request asked (the service's `tallySearch`). */
  tally(semantic: Semantic): void;
}

/**
 * The one deep pass both searches take, `/`'s notes and `[[`'s pages (`where`): asked when the ranked search isn't
 * sure, the ids Jev found that the words didn't (`have`), or why it wasn't asked. Counted on the day's run. With a
 * search's `budget`, what's left of it is the pass's whole wait, and with none left it isn't asked.
 */
export async function deepFinds(s: DeepSearch, query: string, semantic: Semantic, exact: boolean | undefined, have: ReadonlySet<string>, where?: (b: Block) => boolean, budget?: { left(): number }): Promise<{ ids: string[]; deep: Deep } | Deep> {
  if (query.trim().length < 3 || exact || semantic.verdict === "strong") return { status: "skipped" };
  const left = budget?.left(), skipped = `${DEEP_LATE}, so the deep search was skipped`;
  if (left !== undefined && left < DEEP_LEAST_MS) return { status: "unavailable", message: skipped };
  const found = await deepCandidates(s.pool(), query, { ...(where ? { where } : {}), jev: { ...(s.promptDirectory ? { promptDirectory: s.promptDirectory } : {}), ...(left !== undefined ? { timeoutMs: left } : {}) } });
  if ("unavailable" in found) return { status: "unavailable", message: deepLate(found.unavailable) ? skipped : found.unavailable };
  if (found.reading) s.tally({ status: "ranked", model: found.reading.model, promptRevisions: found.reading.prompt, candidateCount: found.windows, ...(found.reading.usage ? { inputTokens: found.reading.usage.input, outputTokens: found.reading.usage.output } : {}) });
  const ids = found.candidates.map(c => c.id).filter(id => !have.has(id));
  return { ids, deep: { status: "found", windows: found.windows, found: ids.length, elapsedMs: found.elapsedMs, ...(found.reading?.usage ? { inputTokens: found.reading.usage.input } : {}) } };
}

/**
 * A search with Jev (`tree.search` with `semantic`): the text's candidates ranked and, with `deep`, the deep pass asked
 * when that ranking isn't sure (or found nothing by its words), its finds added and the whole ranked again, so they're
 * scored and said as any hit is. Never throws. Every request in it shares one budget (PIE-1810, `searchBudget`): past
 * it the answer is what's in hand, saying what was skipped (the text matches when the ranking was late, the ranked ones
 * when the deep pass or its second ranking was), never a caller left waiting for the sum of each stage's own wait.
 */
export async function searchWithJev(s: DeepSearch, query: string, candidates: GotoSearchCollection, note: { note?: { title: string; path: string } }, deep: boolean): Promise<GotoSearchCollection> {
  const budget = searchBudget();
  const rank = (from: GotoSearchCollection) => rankSearchWithJev(query, from, { ...(s.promptDirectory ? { promptDirectory: s.promptDirectory } : {}), ...note, timeoutMs: Math.min(RANK_TIMEOUT_MS, budget.left()) });
  const ranked = await rank(candidates);
  // Jev didn't give the ranking just now (late, or down): its deep pass isn't asked, since nothing would score its finds.
  if (!deep || ranked.semantic.status === "unavailable") return ranked;
  const found = await deepFinds(s, query, ranked.semantic, ranked.matches[0]?.exact, new Set(ranked.matches.map(m => m.block.id)), undefined, budget);
  if (!("ids" in found)) return { ...ranked, semantic: { ...ranked.semantic, deep: found } };
  const added = s.matches(found.ids, query), said = { ...found.deep, found: added.length };
  if (!added.length) return { ...ranked, semantic: { ...ranked.semantic, deep: said } };
  // Jev's finds first: the "is it among these?" Noul reads the first candidates, and these are the ones it hasn't seen.
  const again = await rank({ ...ranked, matches: [...added, ...ranked.matches.map(({ score: _s, ...m }) => m)] });
  if (again.semantic.status === "ranked") return { ...again, semantic: { ...again.semantic, deep: said } };
  // The finds went unscored: the first ranking stays as it was said, without them.
  const late = again.semantic.message === RANKING_SKIPPED;
  return { ...ranked, semantic: { ...ranked.semantic, deep: { status: "unavailable", message: `Jev ${late ? "didn't score" : "couldn't score"} what the deep search found (${added.length})${late ? " in time" : ""}, so it was left out` } } };
}
