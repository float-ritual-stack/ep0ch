// Ranked search (PIE-230, PIE-1198): code finds the candidates, Jev judges them in one request (a Score per candidate,
// and one Noul over the list: "is the note the person means among these?"), and code decides what the answer says.
// The request is built and read here for the service and for the search eval alike (scripts/evals/search.ts), so the
// eval measures exactly what search asks.
import { loadGotoPrompt, PromptFileError, type ExistsQuestion, type PromptRevision } from "./ai-prompts";
import { askJev, jevKey, type JevAnswer, type JevOptions } from "./jev";
import { jevOff } from "./work-jev";
import type { BlockCollectionCompleteness, GotoSearchCollection, SearchCertainty } from "./types";
export { JEV_ENDPOINT, JEV_MODEL, jevKey, resetJevKey } from "./jev";

export interface SearchExcerpt {title:string;path:string;snippet:string;exact:boolean;score?:number}
export interface SearchCollection<T extends SearchExcerpt> {matches:T[];completeness:BlockCollectionCompleteness;semantic:GotoSearchCollection['semantic']}

/**
 * What a ranked search says, decided in code over Jev's answers (the truth table in `certaintyOf`). Set from the search
 * eval (pie's Search evals page, `type=jev-run experiment=search-eval`; `ep0ch search eval` runs it again): on 168 real
 * queries, a Noul yes at 0.8 rather than the skill's 0.7 cut the searches called sure with nothing there from 10 to 4,
 * for 3 fewer sure right answers. `exists` is the Noul's yes and no (between them it isn't settled); `strong` the top
 * Score (0–3) a sure answer needs; under `floor` the top isn't a match at all, whatever the Noul says.
 */
export const SEARCH_THRESHOLDS = { exists: { yes: 0.8, no: 0.3 }, strong: 2, floor: 1 };
/** The Noul reads the first candidates, each cut short: enough to judge "is it among these", not the whole of each. */
export const EXISTS_CANDIDATES = 30, EXISTS_SNIPPET = 240;

type Prompt = { ranking: { instructions: string; criteria: string[] }; exists: ExistsQuestion; revisions: PromptRevision[] };

/** The one request a search sends: state `{query, note?}`, a Score per candidate (its text in its own question) and the `exists` Noul. */
export function searchRequest(query: string, matches: readonly SearchExcerpt[], prompt: Prompt, note?: { title: string; path: string }) {
  const questions: Record<string, unknown> = Object.fromEntries(matches.map(({ title, path, snippet }, index) => [`candidate_${index}`, {
    type: "score",
    instructions: `${prompt.ranking.instructions}\nCandidate: ${JSON.stringify({ title, path, text: snippet })}`,
    criteria: prompt.ranking.criteria,
  }]));
  const listed = matches.slice(0, EXISTS_CANDIDATES).map(({ title, path, snippet }) => ({ title, path, text: snippet.length > EXISTS_SNIPPET ? `${snippet.slice(0, EXISTS_SNIPPET)}…` : snippet }));
  questions.exists = { type: "noul", instructions: `${prompt.exists.instructions}\nNotes: ${JSON.stringify(listed)}`, criteria: { true: prompt.exists.true, false: prompt.exists.false } };
  return { state: { query, ...(note ? { note } : {}) }, questions };
}

/** Each candidate's Score and the Noul, from the answers; a Score that isn't one throws (the ranking is then not used). */
export function readSearchAnswers(count: number, answers: Record<string, JevAnswer>): { scores: number[]; exists?: number } {
  const scores = Array.from({ length: count }, (_, index) => {
    const answer = answers[`candidate_${index}`];
    if (answer?.type !== "score" || typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 3) throw new Error("Invalid Jev ranking response");
    return answer.score;
  });
  const noul = answers.exists?.noul;
  return { scores, ...(typeof noul === "number" && Number.isFinite(noul) && noul >= 0 && noul <= 1 ? { exists: noul } : {}) };
}

const quoted = (title: string) => `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”`;
const figure = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The truth table: Jev's top Score and its Noul in, what the search says out. Sure only when both agree; nothing here
 * when the Noul says no or the top is no match; otherwise the closest is named and not claimed. A Noul that didn't come
 * back leaves the Score to decide alone.
 */
export function certaintyOf(top: { title: string; score: number } | undefined, exists: number | undefined, t = SEARCH_THRESHOLDS): SearchCertainty {
  const sure = exists === undefined || exists >= t.exists.yes;
  if (!top || top.score < t.floor || (exists !== undefined && exists < t.exists.no)) {
    return { verdict: "none", said: "no strong match: nothing here looks like what was asked for", ...(exists !== undefined ? { exists } : {}), ...(top ? { top: top.score } : {}) };
  }
  if (top.score >= t.strong && sure) {
    return { verdict: "strong", said: `strong match: ${quoted(top.title)} (${figure(top.score)} of 3${exists !== undefined ? `, sure ${figure(exists)}` : ""})`, ...(exists !== undefined ? { exists } : {}), top: top.score };
  }
  return { verdict: "weak", said: `no strong match: the closest is ${quoted(top.title)} (${figure(top.score)} of 3)`, ...(exists !== undefined ? { exists } : {}), top: top.score };
}

/** HTTP and model output stay outside the synchronous SQLite read transaction. */
export async function rankSearchWithJev<T extends SearchExcerpt>(
  query: string,
  candidates: SearchCollection<T>,
  options: JevOptions & {
    promptDirectory?: string;
    /** The note the person is writing in or searching from (`contextBlockId`): Jev judges what they mean from there. */
    note?: { title: string; path: string };
  } = {},
): Promise<SearchCollection<T & { score?: number }>> {
  // OUTLINER_FIGURE_FIT=off (the tests' default) turns every Jev loop off, search's too: a scratch host never asks.
  if (!options.apiKey && jevOff(options.env)) return { ...candidates, semantic: { status: "unavailable", message: "Jev is off here (OUTLINER_FIGURE_FIT=off); showing text matches" } };
  const apiKey = options.apiKey ?? await jevKey(options.env);
  if (!apiKey) return { ...candidates, semantic: { status: "unavailable", message: "Jev is not configured; showing text matches · add its key: with-secrets --add typesafe TYPESAFE_API_KEY" } };
  if (query.trim().length < 3 || candidates.matches.length === 0 || candidates.matches[0]?.exact) return candidates;
  const started = performance.now();
  let promptRevisions: PromptRevision[] | undefined;
  try {
    const prompt = await loadGotoPrompt(options.promptDirectory);
    promptRevisions = prompt.revisions;
    const request = searchRequest(query, candidates.matches, prompt, options.note);
    const asked = await askJev(request.state, request.questions, prompt.revisions, { timeoutMs: 2200, ...options, apiKey });
    if ("unavailable" in asked) throw new Error(asked.unavailable);
    const read = readSearchAnswers(candidates.matches.length, asked.answers);
    const scored = candidates.matches.map((match, index) => ({ match: { ...match, score: read.scores[index]! }, index }));
    scored.sort((a, b) => Number(b.match.exact) - Number(a.match.exact) || b.match.score - a.match.score || a.index - b.index);
    const top = scored[0]?.match;
    const usage = asked.reading.usage;
    return { ...candidates, matches: scored.map(({ match }) => match), semantic: {
      status: "ranked", model: asked.reading.model, elapsedMs: Math.round(performance.now() - started),
      candidateCount: scored.length, promptRevisions,
      ...(usage ? { inputTokens: usage.input, outputTokens: usage.output } : {}),
      ...certaintyOf(top ? { title: top.title, score: top.score } : undefined, read.exists),
    } };
  } catch (error) {
    // Provider error bodies can echo request content. Keep them out of UI/logs.
    return { ...candidates, semantic: {
      status: "unavailable",
      message: error instanceof PromptFileError ? `${error.message}; showing text matches` : "Jev unavailable; showing text matches",
      ...(promptRevisions ? { promptRevisions } : {}),
    } };
  }
}
