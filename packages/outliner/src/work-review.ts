// The workboard's own rules where agents act (PIE-1388, loki for Evan, Oct 29: "how do we ensure this is regularly
// something you check? adding it to your memories seems to never be the answer"): work_complete and work_create are
// reviewed like a note write, code first and Jev second, and answered ship or fix in the same words.
//
// - `validation`: a completion whose proof names only tests (and the ticket isn't test-only or a refactor). Validation
//   is an agent that didn't build it running the app and judging the experience; a passing test is not validation.
// - `experience`: a new ticket whose done-when doesn't say what Evan will open and do.
// - `qa-for-evan`: a note that asks Evan to try or check things himself (write-review.ts finds those; this words them).
//
// What each says comes from the outline: a note carrying `[house-rule::<name>]` words it (its first lines, linked), so
// the rule is tuned in the outline without a deploy; the words here are only for an outline that has none. Never refuses:
// the completion and the ticket have landed.
import { headerLine } from "@ep0ch/outline-core/header-line";
import { shapeNext, type Rubric } from "@ep0ch/outline-core/write-shape";
import { loadWriteReviewPrompt } from "./ai-prompts";
import { QA_RULE, REVIEW_THRESHOLDS, type ReviewFinding, type ReviewReading, type WriteReview } from "./write-review";
import { JEV_ENDPOINT, JEV_MODEL, jevKey } from "./search-ranking";

export interface HouseRuleClient { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> }

/** The words each rule uses when the outline has no note for it. */
export const HOUSE_RULE_DEFAULTS = {
  validation: "validation is an agent that didn't build it running the app and judging the experience; a passing test is not validation",
  experience: "write the one sentence of what Evan will open and do when it's done, and gather every ticket that sentence needs",
  "qa-for-evan": QA_RULE,
} as const;
export type HouseRule = keyof typeof HOUSE_RULE_DEFAULTS;

const clip = (text: string, max = 240) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };

/**
 * A rule's words as the outline has them: the note carrying `[house-rule::<name>]` (its first paragraph under the title,
 * or its title), with a link to it; the default otherwise, saying how to word it in the outline.
 */
export async function houseRule(client: HouseRuleClient, name: HouseRule): Promise<string> {
  try {
    const [note] = (await client.request<{ blocks: { id: string; text: string }[] }>({ action: "blocks.query", query: { where: `house-rule=${name}`, propertyScope: "all", limit: 1 } })).blocks;
    if (note) {
      const header = headerLine(note.text);
      const body = note.text.split("\n").slice(header.line + 1).join("\n").split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith("::") && !p.startsWith("```"));
      return `${clip((body ?? header.prose).replace(/^>\s*(?:\[![^\]]+\][+-]?\s*)?/gm, ""))} ((${note.id}))`;
    }
  } catch { /* the default words */ }
  return `${HOUSE_RULE_DEFAULTS[name]} (tag a note [house-rule::${name}] to word it in this outline)`;
}

const TESTS = /\b(?:tests?|bun test|test run|passing|green|box-test|CI|suite|specs?|exit (?:code )?0|typecheck|bun run check)\b/i;
const DROVE = /\b(?:drove|driven|driving|drive it|ran the (?:app|door)|in the door|real pane|peek|snap(?:shot)?|screenshot|walked|clicked|typed|headless|chromium|on the page|opened it|used it|in daily use|daily use|by hand)\b/i;
const NOT_A_FEATURE = /\b(?:refactor|test[- ]only|flak[ey]|flake|tests? (?:go|goes|went) red|red (?:test|run)|ci\b)/i;
const SAYS_EXPERIENCE = /\b(?:evan|he|a person|the person)\s+(?:opens?|can|sees?|reads?|clicks?|types?|finds?|gets?)\b|\bdone[- ]when\b/i;

/** One Noul asked of Jev over `state`, or null when it can't be. */
async function askNoul(state: Record<string, unknown>, question: string, env?: NodeJS.ProcessEnv): Promise<{ noul: number; reading: ReviewReading } | null> {
  if ((env ?? process.env).OUTLINER_FIGURE_FIT === "off") return null;
  const apiKey = await jevKey(env);
  if (!apiKey) return null;
  try {
    const prompt = await loadWriteReviewPrompt();
    const response = await fetch((env ?? process.env).OUTLINER_JEV_ENDPOINT ?? JEV_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify({ model: JEV_MODEL, state, questions: { q: { type: "noul", instructions: prompt[question as "proof" | "experience"] } } }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const body = await response.json() as { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; answers?: { q?: { noul?: number } } };
    const noul = body.answers?.q?.noul;
    if (typeof noul !== "number" || noul < 0 || noul > 1) return null;
    return { noul, reading: { model: body.model ?? JEV_MODEL, prompt: prompt.revisions, questions: 1, ...(Number.isFinite(body.usage?.input_tokens) ? { usage: { input: body.usage!.input_tokens!, output: body.usage!.output_tokens ?? 0 } } : {}) } };
  } catch { return null; }
}

function verdictOf(id: string, finding: ReviewFinding | null, asked: boolean): WriteReview {
  return { verdict: finding ? "fix" : "ship", findings: finding ? [finding] : [], jev: asked ? "asked" : "not asked: code settled it", next: finding ? `fix it, then ${shapeNext(id)}` : shapeNext(id) };
}

/**
 * A completion's review: its proof names tests and nothing driven, on a ticket that isn't about tests, is a fix. Code
 * finds both kinds of words; when it finds neither, or only tests, Jev judges whether the proof shows the change used.
 */
export async function reviewCompletion(client: HouseRuleClient, input: { ticket: { id: string; text: string }; proof: string }, env?: NodeJS.ProcessEnv): Promise<{ review: WriteReview; reading?: ReviewReading }> {
  const title = headerLine(input.ticket.text).prose;
  if (NOT_A_FEATURE.test(title) || DROVE.test(input.proof)) return { review: verdictOf(input.ticket.id, null, false) };
  const jev = await askNoul({ ticket: clip(input.ticket.text, 1500), proof: clip(input.proof, 2500) }, "proof", env);
  const testsOnly = jev ? jev.noul < 0.5 : TESTS.test(input.proof);
  const finding: ReviewFinding | null = testsOnly ? {
    rule: "proof-only-tests", rubric: "qa-for-evan" as Rubric, key: "proof-only-tests", passage: clip(input.proof, 200), new: true, by: jev ? "jev" : "code",
    say: `the proof names tests and nothing driven: ${await houseRule(client, "validation")}`,
  } : null;
  return { review: verdictOf(input.ticket.id, finding, !!jev), ...(jev ? { reading: jev.reading } : {}) };
}

/** A new ticket's review: a body that doesn't say what Evan will open and do is a fix (code's words first, then Jev). */
export async function reviewTicket(client: HouseRuleClient, ticket: { id: string; text: string }, env?: NodeJS.ProcessEnv): Promise<{ review: WriteReview; reading?: ReviewReading }> {
  if (SAYS_EXPERIENCE.test(ticket.text)) return { review: verdictOf(ticket.id, null, false) };
  const jev = await askNoul({ ticket: clip(ticket.text, 3000) }, "experience", env);
  const missing = jev ? jev.noul < REVIEW_THRESHOLDS.yes - 0.2 : true;
  const finding: ReviewFinding | null = missing ? {
    rule: "no-experience", rubric: "experience" as Rubric, key: "no-experience", passage: clip(ticket.text, 200), new: true, by: jev ? "jev" : "code",
    say: `the ticket doesn't say what Evan will open and do: ${await houseRule(client, "experience")}`,
  } : null;
  return { review: verdictOf(ticket.id, finding, !!jev), ...(jev ? { reading: jev.reading } : {}) };
}
