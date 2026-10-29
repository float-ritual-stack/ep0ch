// Deep search (PIE-1200): Jev finds candidates the text match never surfaced. Reranking can't recover a note no
// word of the query is in; this reads the notes themselves. The pool (every live note a search may show, or what
// `where` keeps) is cut into windows of at most WINDOW notes, each one request: a Choice over its notes (each by its
// title, type and first line) and a Noul, "is the note wanted among these?". Windows run a few at a time and merge by
// probability, the Choice's weighed by its window's Noul. Code keeps the top `limit`; search-ranking.ts then scores
// them beside the text's candidates as it scores those. Twins at filing and the groom (work-twins.ts, work-groom.ts)
// call it with their own pool.
import { headedTitle, workIdOf } from "@ep0ch/outline-core/work-id-title";
import { loadDeepPrompt, type PromptRevision } from "./ai-prompts";
import { askJev, jevKey, type JevOptions, type JevReading } from "./jev";
import { blockDisplayTitle } from "./references";
import { jevOff } from "./work-jev";
import type { Block } from "./types";

/** A Choice takes at most 255 options (docs.typesafe.ai, line-by-line search). */
export const WINDOW = 250;
/** Windows asked at once: Jev's rate limit is per organisation, and a search shouldn't take it all. */
export const DEEP_AT_ONCE = 4;
/** A note is a candidate when its window's weighed probability reaches this. */
export const DEEP_MIN = 0.02;
/** At most this many from one window: a window whose Noul is unsure spreads its probability thin. */
const PER_WINDOW = 5;

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
  const type = block.properties.find(p => p.key === "type")?.value;
  const body = block.text.split("\n").slice(1).join(" ").replace(/\[[^\]]*::[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return [title, type ? `(${type})` : "", body ? `: ${body}` : ""].filter(Boolean).join(" ");
}

/** The notes deep search reads: live, not a comment, not the tools' bookkeeping. */
export function deepPool(blocks: Iterable<Block>, where?: (b: Block) => boolean): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.deletedAt || b.effectiveDeletedRootId) continue;
    const type = b.properties.find(p => p.key === "type")?.value;
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
 * throws. `timeoutMs` bounds the whole search: a caller that waits (a filing) gets `unavailable` past it, never half.
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
  if (await Promise.race([run.then(() => "done" as const), timer]) === "late") return { unavailable: "Jev didn't read every note in time" };
  if (failed) return { unavailable: failed };
  found.sort((a, b) => b.p - a.p);
  return {
    candidates: found.slice(0, o.limit ?? 20), exists, windows: windows.length, elapsedMs: Math.round(performance.now() - started),
    reading: { model: model ?? "unknown", prompt: prompt.revisions, questions: windows.length * 2, usage: { input, output } },
  };
}
