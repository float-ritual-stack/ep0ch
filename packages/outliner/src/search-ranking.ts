import {loadGotoPrompt,PromptFileError,type PromptRevision} from './ai-prompts';
import {readGroupSecret} from './extension-secrets';
import type {BlockCollectionCompleteness,GotoSearchCollection} from './types';
export interface SearchExcerpt {title:string;path:string;snippet:string;exact:boolean}
export interface SearchCollection<T extends SearchExcerpt> {matches:T[];completeness:BlockCollectionCompleteness;semantic:GotoSearchCollection['semantic']}
/** The Jev model and endpoint every judgment in the service asks (search's ranking, figure-fit.ts). */
export const JEV_MODEL = 'jev-1.13.0';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = JEV_MODEL;

/**
 * Jev's key: the environment's, else the `typesafe` with-secrets group's, as the service reads every other key
 * (`readGroupSecret`; a host under systemd or launchd has no shell environment). Found once per process; a miss is
 * looked for again after a minute, so adding the key needs no restart.
 */
let found: { key: string | undefined; at: number } | null = null;
export async function jevKey(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY;
  if (found && (found.key || Date.now() - found.at < 60_000)) return found.key;
  let key: string | undefined;
  try { key = await readGroupSecret("typesafe", "TYPESAFE_API_KEY", "ranked search", undefined, env); } catch { key = undefined; }
  found = { key, at: Date.now() };
  return key;
}
/** Forget the key looked up (a test, or after the person changes it). */
export function resetJevKey() { found = null; }
/** HTTP and model output stay outside the synchronous SQLite read transaction. */
export async function rankSearchWithJev<T extends SearchExcerpt>(
  query: string,
  candidates: SearchCollection<T>,
  options: {
    apiKey?: string; endpoint?: string; fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; promptDirectory?: string;
    /** The note the person is writing in or searching from (`contextBlockId`): Jev judges what they mean from there. */
    note?: { title: string; path: string };
    /** Where the key is looked up (`TYPESAFE_API_KEY`, `WITH_SECRETS_DIR`); a test passes its own. */
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<SearchCollection<T>> {
  const apiKey = options.apiKey ?? await jevKey(options.env);
  if (!apiKey) return { ...candidates, semantic: { status: "unavailable", message: "Jev is not configured; showing text matches · add its key: with-secrets --add typesafe TYPESAFE_API_KEY" } };
  if (query.trim().length < 3 || candidates.matches.length === 0 || candidates.matches[0]?.exact) return candidates;
  const started = performance.now();
  let promptRevisions: PromptRevision[] | undefined;
  try {
    const prompt = await loadGotoPrompt(options.promptDirectory);
    promptRevisions = prompt.revisions;
    const questions = Object.fromEntries(candidates.matches.map(({title, path, snippet}, index) => [`candidate_${index}`, {
      type: "score",
      instructions: `${prompt.ranking.instructions}\nCandidate: ${JSON.stringify({title, path, text: snippet})}`,
      criteria: prompt.ranking.criteria,
    }]));
    const response = await (options.fetch ?? fetch)(options.endpoint ?? JEV_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({ model: MODEL, state: { query, ...(options.note ? { note: options.note } : {}) }, questions }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 2200),
    });
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
    const result = await response.json() as { answers?: Record<string, { type?: string; score?: number }>; model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    const scored = candidates.matches.map((match, index) => {
      const answer = result.answers?.[`candidate_${index}`];
      if (answer?.type !== "score" || typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 3) throw new Error("Invalid Jev ranking response");
      return { match, score: answer.score, index };
    });
    scored.sort((a, b) => Number(b.match.exact) - Number(a.match.exact) || b.score - a.score || a.index - b.index);
    return { ...candidates, matches: scored.map(({ match }) => match), semantic: {
      status: "ranked", model: result.model ?? MODEL, elapsedMs: Math.round(performance.now() - started),
      candidateCount: scored.length, promptRevisions,
      ...(Number.isFinite(result.usage?.input_tokens) ? { inputTokens: result.usage!.input_tokens } : {}),
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
