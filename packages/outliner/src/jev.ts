// One request to Jev, for every judgment the service asks (search's ranking and its "anything here answers it?", the
// write review, the work tools): the model and endpoint, the key, and the answers and reading (model, tokens) back, or
// why it couldn't be asked. figure-fit.ts still sends its own.
import { readGroupSecret } from "./extension-secrets";
import type { PromptRevision } from "./ai-prompts";

/** The Jev model every judgment in the service asks; the search eval (scripts/evals/search.ts) compares it with the next. */
export const JEV_MODEL = "jev-1.13.0";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

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

export const NOT_CONFIGURED = "Jev is not configured: with-secrets --add typesafe TYPESAFE_API_KEY";

export interface JevAnswer { type?: string; score?: number; choice?: string; confidence?: number; noul?: number; probabilities?: Record<string, number> }
/** What one request cost and who answered: kept on the day's `jev-run` record. */
export interface JevReading { model: string; prompt: PromptRevision[]; usage?: { input: number; output: number }; questions: number }
export interface JevAsked { reading: JevReading; answers: Record<string, JevAnswer> }

export interface JevOptions {
  apiKey?: string; endpoint?: string; timeoutMs?: number;
  /** The model to ask (an eval's); the pin otherwise. */
  model?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Where the key (`TYPESAFE_API_KEY`, `WITH_SECRETS_DIR`) and a test's endpoint (`OUTLINER_JEV_ENDPOINT`) are read. */
  env?: NodeJS.ProcessEnv;
}

/** One request: the state and every question about it, the answers back. Never throws; a failure is `unavailable`, never an answer. */
export async function askJev(state: Record<string, unknown>, questions: Record<string, unknown>, prompt: PromptRevision[], o: JevOptions = {}): Promise<JevAsked | { unavailable: string }> {
  try {
    const apiKey = o.apiKey ?? await jevKey(o.env);
    if (!apiKey) return { unavailable: NOT_CONFIGURED };
    const model = o.model ?? JEV_MODEL;
    const response = await (o.fetch ?? fetch)(o.endpoint ?? (o.env ?? process.env).OUTLINER_JEV_ENDPOINT ?? JEV_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify({ model, state, questions }), signal: AbortSignal.timeout(o.timeoutMs ?? 2500),
    });
    // Provider error bodies can echo request content: only the status is said.
    if (!response.ok) return { unavailable: `Jev HTTP ${response.status}` };
    const body = await response.json() as { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; answers?: JevAsked["answers"] };
    if (!body.answers || typeof body.answers !== "object") return { unavailable: "Jev's answer didn't read" };
    const usage = Number.isFinite(body.usage?.input_tokens) ? { input: body.usage!.input_tokens!, output: Number.isFinite(body.usage?.output_tokens) ? body.usage!.output_tokens! : 0 } : undefined;
    return { answers: body.answers, reading: { model: body.model ?? model, prompt, questions: Object.keys(questions).length, ...(usage ? { usage } : {}) } };
  } catch (e) {
    return { unavailable: (e as Error).name === "TimeoutError" ? "Jev didn't answer in time" : `Jev: ${(e as Error).message}` };
  }
}
