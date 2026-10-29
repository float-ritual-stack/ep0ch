// The workboard's Jev loops (PIE-1258, pie's "Jev first" capability): code finds the candidates, Jev answers one Noul per
// candidate in one request over one state, and code decides. Three loops share this:
//
// - twins at filing (work-twins.ts): is a new ticket the same work as an open one?
// - the groom (work-groom.ts): has a queued ticket shipped already, been made unnecessary, or does it repeat another?
// - what to try (work-try.ts): which actions and which of a ticket's lines a validator would use.
//
// Every pass is a `jev-run` record with its tokens and what they cost, one experiment per loop, so Jev's suggestions page
// shows what each loop costs. Jev selects; it never writes the words a person reads, and it never closes anything.
import { loadWorkJevPrompt, type PromptRevision, type WorkJevPrompt } from "./ai-prompts";
import { askJevQuestions } from "./write-review";
import { writeRecord, type RecordWho, type RecordWriter } from "./records";
import type { Block, VisibleBlockCollection } from "./types";

/** Jev's price, dollars per million input tokens (output is free): docs.typesafe.ai/go/models, Jev 1.13 and 1.14. */
export const JEV_DOLLARS_PER_MTOK = 0.042;
/** A Noul at or over this reads as yes; under NO as no (the skill's starting thresholds). */
export const YES = 0.7, NO = 0.3;
/** The groom acts on a verdict only at or over this: a note on the ticket for the verifier. */
export const CONFIDENT = 0.8;

export interface JevOptions {
  apiKey?: string; endpoint?: string; timeoutMs?: number; promptDirectory?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  env?: NodeJS.ProcessEnv;
}

/** What a pass cost: the model, the prompt and the tokens Jev says it read. */
export interface JevReading { model: string; prompt: PromptRevision[]; usage?: { input: number; output: number }; questions: number }
export type JevAnswers = Record<string, { noul?: number }>;

/** Whether Jev may be asked here: `OUTLINER_FIGURE_FIT=off` (the tests' default) says no for every loop, as for the write review. */
export const jevOff = (env: NodeJS.ProcessEnv = process.env) => env.OUTLINER_FIGURE_FIT === "off";

/**
 * One request: `state` and Nouls built from the prompt file (`{candidate}` filled in per question). Never throws:
 * a failed call is `unavailable` with why, never read as a no.
 */
export async function askNouls(
  state: Record<string, unknown>,
  questions: Record<string, { ask: keyof Omit<WorkJevPrompt, "revisions">; candidate: string }>,
  o: JevOptions = {},
): Promise<{ answers: JevAnswers; reading: JevReading } | { unavailable: string }> {
  const env = o.env ?? process.env;
  if (!o.apiKey && jevOff(env)) return { unavailable: "off" };
  if (!Object.keys(questions).length) return { unavailable: "nothing to ask" };
  let prompt: WorkJevPrompt;
  try { prompt = await loadWorkJevPrompt(o.promptDirectory); } catch (e) { return { unavailable: `Jev: ${(e as Error).message}` }; }
  const asked = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "noul", instructions: prompt[q.ask].replace("{candidate}", () => q.candidate) }]));
  // The one Jev client (the write review's), its reading stamped with this loop's own prompt file.
  const answer = await askJevQuestions(state, asked, { timeoutMs: 8000, ...o });
  return "answers" in answer ? { answers: answer.answers, reading: { ...answer.reading, prompt: prompt.revisions } } : answer;
}

/** A Noul's value when it reads as a probability, else undefined. */
export const noul = (answers: JevAnswers | undefined, id: string): number | undefined => {
  const n = answers?.[id]?.noul;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
};

/** Text clipped for Jev's state or a record: one line, at most `max` characters. */
export const clip = (text: string, max = 300) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };

/** Dollars for `tokens` input tokens, as a chip shows them. */
export const costOf = (tokens: number) => (tokens * JEV_DOLLARS_PER_MTOK / 1_000_000).toFixed(6);

// ── Records ────────────────────────────────────────────────────────────────

export interface WorkJevClient { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> }
export const board = (client: WorkJevClient): RecordWriter => ({ request: (action, params) => client.request({ action, ...params }) });
/** Jev's loops write as themselves; who the pass was for is a field. */
export const jevWho = (loop: string): RecordWho => ({ author: "agent", provenance: { actorId: `jev/${loop}` } });

/** A value written as a property chip: one line, nothing that reads as a bracket or a `::` opener. */
export const chipValue = (v: string) => v.replace(/[\[\]\r\n]+/g, " ").replace(/:{2,}/g, ":").trim().slice(0, 200) || "none";
export const chips = (props: Record<string, string>) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, chipValue(v)]));

const promptRev = (r?: JevReading) => r?.prompt.map(p => `${p.path.split("/").pop()}:${p.sha256.slice(0, 12)}`).join(" ") || "unknown";

/**
 * A pass's `jev-run`: the loop (`experiment`), what it read (`items`), the tokens and their cost. An outline whose
 * jev-run template predates `cost` gets the chip added to the record, so the suggestions page reads it everywhere.
 * `run` names the pass (a day, or a time).
 */
export async function recordRun(client: WorkJevClient, loop: string, run: string, counts: Record<string, number>, reading: JevReading | undefined): Promise<string> {
  const tokensIn = reading?.usage?.input ?? 0;
  const props = chips({
    experiment: loop, run, model: reading?.model ?? "none", "prompt-rev": promptRev(reading),
    items: String(counts.items ?? 0), suggested: String(counts.suggested ?? 0), quiet: String(counts.quiet ?? 0), unavailable: String(counts.unavailable ?? 0),
    // An eval's run says how often Jev agreed with the labels (search-eval.ts): agreed, agreement, different, ignored.
    ...Object.fromEntries(["agreed", "agreement", "different", "ignored"].filter(k => counts[k] !== undefined).map(k => [k, String(counts[k])])),
    "tokens-in": String(tokensIn), "tokens-out": String(reading?.usage?.output ?? 0), cost: costOf(tokensIn),
  });
  const made = await writeRecord(board(client), "jev-run", props, jevWho(loop), { title: `${loop} ${run}` });
  await addMissingChips(client, made.id, { cost: props.cost! });
  return made.id;
}

/**
 * One loop's run for the day, counted up in place (twins are asked once per filing, a run per filing would be a log):
 * found or made, then its items, suggested and tokens added to. A conflicting write loses a count rather than looping.
 */
export async function tallyRun(client: WorkJevClient, loop: string, day: string, add: { items?: number; suggested?: number; quiet?: number; unavailable?: number }, reading?: JevReading): Promise<void> {
  const find = async () => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `type=jev-run experiment=${loop} run=${day}`, machinery: "show", limit: 1 } })).blocks[0];
  let run = await find();
  if (!run) { await recordRun(client, loop, day, {}, undefined); run = await find(); }
  if (!run) return;
  const n = (key: string) => Number(new RegExp(`\\[${key}::(\\d+(?:\\.\\d+)?)\\]`).exec(run!.text)?.[1]) || 0;
  const tokens = n("tokens-in") + (reading?.usage?.input ?? 0);
  const next: Record<string, string> = {
    items: String(n("items") + (add.items ?? 0)), suggested: String(n("suggested") + (add.suggested ?? 0)), quiet: String(n("quiet") + (add.quiet ?? 0)), unavailable: String(n("unavailable") + (add.unavailable ?? 0)),
    "tokens-in": String(tokens), "tokens-out": String(n("tokens-out") + (reading?.usage?.output ?? 0)), cost: costOf(tokens),
    ...(reading ? { model: reading.model, "prompt-rev": chipValue(promptRev(reading)) } : {}),
  };
  let text = run.text;
  for (const [key, value] of Object.entries(next)) {
    const chip = new RegExp(`\\[${key}::[^\\]]*\\]`);
    text = chip.test(text) ? text.replace(chip, () => `[${key}::${value}]`) : `${text}\n[${key}::${value}]`;
  }
  if (text !== run.text) await client.request<Block>({ action: "update", blockId: run.id, text, expectedRevision: run.revision, mutation: { author: "agent", actorId: `jev/${loop}` } });
}

async function addMissingChips(client: WorkJevClient, id: string, want: Record<string, string>): Promise<void> {
  const block = await client.request<Block>({ action: "get", blockId: id });
  const missing = Object.entries(want).filter(([key]) => !new RegExp(`\\[${key}::`).test(block.text));
  if (!missing.length) return;
  await client.request<Block>({ action: "update", blockId: id, text: `${block.text}\n${missing.map(([k, v]) => `[${k}::${v}]`).join("\n")}`, expectedRevision: block.revision, mutation: { author: "agent", actorId: "jev/records" } });
}

export const dayOf = (at: Date | number = Date.now()) => new Date(at).toISOString().slice(0, 10);

/**
 * The suggestions page's section for the workboard's loops (Jev's suggestions, pie 893c51f5, and SUGGESTIONS_PAGE): what
 * each pass read and cost, the twins offered and what became of them, and the groom's confident "solved" for the
 * verifier. Every number is a live figure over the records; the dollars are the `cost` chip each run carries.
 */
export const LOOPS_SECTION = [
  "## The workboard's loops: what each costs",
  "::graph-table",
  "---",
  "title: every pass, newest first (cost in dollars)",
  "query: type=jev-run (experiment=work-groom OR experiment=work-twins OR experiment=work-try)",
  "machinery: show",
  "columns: [experiment, run, items, suggested, tokens-in, cost]",
  "sort: created",
  "direction: desc",
  "limit: 20",
  "---",
  "::",
  "",
  "::graph-stat",
  "---",
  "title: twins at filing, 30 days",
  'items: [{ label: offered, query: "type=work-twin outcome=offered created >= -30d", machinery: show }, { label: attached, query: "type=work-twin outcome=attached created >= -30d", machinery: show, accent: true }, { label: filed anyway, query: "type=work-twin outcome=filed-anyway created >= -30d", machinery: show }, { label: Jev thinks done, query: "type=groom-verdict verdict=solved created >= -30d", machinery: show }]',
  "---",
  "::",
  "",
  "::graph-table",
  "---",
  "title: Jev thinks these are done (a verifier confirms; keeping Jev's comment counts it right)",
  "query: type=groom-verdict verdict=solved",
  "machinery: show",
  "columns: [item, confidence, evidence, by]",
  "sort: created",
  "direction: desc",
  "limit: 20",
  "---",
  "::",
].join("\n");
