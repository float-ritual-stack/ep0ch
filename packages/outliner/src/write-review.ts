// The review every agent write gets (PIE-1388): the note measured against the house rules in code (outline-core's
// write-shape, with ready patches), and judged by Jev against Evan's rubric and the outline's whole kit, then answered
// ship or fix. Code decides the verdict; Jev answers narrow questions about each section the write changed:
//
// - kit: which of the outline's components (figures, layout, site: every schema `components.schemas` answers, never a
//   list here) would show the section best, with the two figure-fit gates as its companions (a Choice always picks);
// - dense, mixed, context: the rubric's judgments per section; argues: about the note's opening;
// - title: is the title line the content rather than its name (asked when it has several clauses);
// - asks and unclear: per line below the top that may ask Evan something, does it, and is the ask clear.
//
// Jev reads prose too: no shape decides first. What Jev can't be asked (no key, a timeout) leaves code's findings alone.
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { componentGist, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { blockNameOf } from "@ep0ch/outline-core/component-warnings";
import { calloutBlocks, quoteDepth, stripQuotes } from "@ep0ch/outline-core/callouts";
import { figurePatch } from "@ep0ch/outline-core/figure-patch";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { FIX_BEFORE_DONE, RUBRIC_OF, shapeNext, SHAPE_LIMITS, splitPoints, writeShape, type Rubric, type ShapeFacet, type ShapePatch } from "@ep0ch/outline-core/write-shape";
import { loadWriteReviewPrompt, type PromptRevision, type WriteReviewPrompt } from "./ai-prompts";
import { FIGURE_FIT_THRESHOLDS } from "./figure-fit";
import { JEV_ENDPOINT, JEV_MODEL, jevKey } from "./search-ranking";
import type { QuestionFacet } from "@ep0ch/outline-core/protocol";

/** A Noul at or over this reads as yes; under `NO` as no (the skill's starting thresholds). */
export const REVIEW_THRESHOLDS = { yes: 0.7, no: 0.3, ...FIGURE_FIT_THRESHOLDS };
/** Sections a review asks Jev about, and how much of each it sends. */
const MAX_SECTIONS = 8, MAX_SECTION = 1500, MAX_ASKS = 5;

export interface ReviewFinding {
  /** Code's rule (`stacked`, `count`, …) or Jev's judgment (`kit`, `dense`, `mixed`, `context`, `argues`, `unclear`). */
  rule: string;
  /** Evan's rubric item it is filed under. */
  rubric: Rubric;
  /** Stable for the same problem in the same place: how a later write is checked for it. */
  key: string;
  say: string;
  line?: number;
  /** The passage it is about, as written (clipped). */
  passage: string;
  /** False for one the note already had before this write (carried, not this write's to fix). */
  new: boolean;
  by: "code" | "jev";
  /** A kit finding's component. */
  component?: string;
  patch?: ShapePatch[];
}

export interface WriteReview {
  /** `fix` when this write left something new to fix; `ship` otherwise. Code's call, over code's and Jev's findings. */
  verdict: "ship" | "fix";
  findings: ReviewFinding[];
  /** Whether Jev read it: `asked`, `not asked` (nothing it would judge changed), or why it couldn't be. */
  jev: string;
  next: string;
}

/** Jev's answers for one review, kept for the records: the model, the prompt and the tokens. */
export interface ReviewReading { model: string; prompt: PromptRevision[]; usage?: { input: number; output: number }; questions: number }

interface Section { id: string; heading: string; line: number; end: number; text: string }

const clip = (text: string, max = 200) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.*)$/;

/** The note's sections: what comes before its first heading, then each heading's lines, outside code and components. */
export function sectionsOf(text: string): Section[] {
  const lines = text.split("\n"), structure = noteStructure(lines), title = headerLine(text).line;
  const out: Section[] = [];
  let open: Section = { id: "s0", heading: "(the top)", line: title + 1, end: title, text: "" };
  const close = () => { open.text = lines.slice(open.line, open.end + 1).join("\n").trim(); if (open.text) out.push(open); };
  lines.forEach((line, i) => {
    if (i <= title) return;
    const h = structure[i] === -1 ? HEADING.exec(stripQuotes(line, quoteDepth(line).depth)) : null;
    if (h) { close(); open = { id: `s${out.length + 1}`, heading: h[1]!.trim(), line: i, end: i, text: "" }; return; }
    open.end = i;
  });
  close();
  return out.map((s, k) => ({ ...s, id: `s${k}` }));
}

/** The lines below the top that may ask Evan something: a question mark or a decision word, outside code and components. */
function askCandidates(text: string): number[] {
  const lines = text.split("\n"), structure = noteStructure(lines);
  return lines.flatMap((line, i) => i >= SHAPE_LIMITS.top && structure[i] === -1 && (/\?\s*$|\?\s+\S/.test(line) || /\b(?:decide|should we|which (?:one|do)|can you|do you want)\b/i.test(line)) ? [i] : []).slice(0, MAX_ASKS);
}

/** The components a review may name: every one the outline has in its figures, layout and site groups, each by its own description. */
export function kitOptions(schemas: readonly ComponentSchema[]): Record<string, string> {
  return Object.fromEntries(schemas.filter(s => ["figures", "layout", "site"].includes(s.group)).map(s => [s.id, `${s.title.replace(/\s*\(.*$/, "").trim() || s.id}: ${componentGist(s, 160)}`]));
}

/** The components a text holds, by id: every `::name` the outline's schemas know, and its callouts and headings. */
export function kitIn(text: string, schemas: readonly ComponentSchema[]): Set<string> {
  const lines = text.split("\n");
  const byName = new Map(schemas.flatMap(s => { const name = blockNameOf(s); return name ? [[name, s.id] as const] : []; }));
  const held = new Set(componentBlocks(lines).map(b => byName.get(b.name) ?? b.name));
  if (calloutBlocks(lines).length) held.add("callout");
  if (lines.some(l => HEADING.test(l))) held.add("heading-style");
  return held;
}

interface Asked { reading: ReviewReading; answers: Record<string, { choice?: string; confidence?: number; noul?: number }> }

/** One request: the state (title, opening, the changed sections, the candidate ask lines) and every question about it. */
export function reviewRequest(text: string, sections: readonly Section[], asks: readonly number[], options: Record<string, string>, prompt: WriteReviewPrompt, o: { title: boolean; opening: boolean }) {
  const lines = text.split("\n");
  const fill = (q: string, path: string) => q.replace(/\{section\}|\{line\}/g, path);
  const questions: Record<string, unknown> = {};
  for (const s of sections) {
    const path = `sections.${s.id}.text`;
    if (Object.keys(options).length >= 2) questions[`kit::${s.id}`] = { type: "choice", instructions: fill(prompt.kit, path), criteria: options };
    for (const q of ["structured", "prose", "dense", "mixed", "context"] as const) questions[`${q}::${s.id}`] = { type: "noul", instructions: fill(prompt[q], path) };
  }
  for (const i of asks) for (const q of ["asks", "unclear"] as const) questions[`${q}::L${i}`] = { type: "noul", instructions: fill(prompt[q], `asks.L${i}`) };
  if (o.title) questions.title = { type: "noul", instructions: prompt.title };
  if (o.opening) questions.argues = { type: "noul", instructions: prompt.argues };
  const header = headerLine(text);
  const opening = sections[0]?.id === "s0" ? sections[0].text : sectionsOf(text)[0]?.text ?? "";
  return {
    model: JEV_MODEL,
    state: {
      title: header.prose.trim().slice(0, 300),
      ...(o.opening ? { opening: opening.slice(0, 800) } : {}),
      ...(sections.length ? { sections: Object.fromEntries(sections.map(s => [s.id, { heading: s.heading, text: s.text.length > MAX_SECTION ? `${s.text.slice(0, MAX_SECTION)}\n…` : s.text }])) } : {}),
      ...(asks.length ? { asks: Object.fromEntries(asks.map(i => [`L${i}`, lines[i]!.trim()])) } : {}),
    },
    questions,
  };
}

export interface ReviewOptions {
  apiKey?: string; endpoint?: string; timeoutMs?: number; promptDirectory?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  env?: NodeJS.ProcessEnv;
}

/** Jev's answers about the parts of `text` this write changed, or why it couldn't be asked. Never throws. */
async function askJev(text: string, sections: readonly Section[], asks: readonly number[], schemas: readonly ComponentSchema[], ask: { title: boolean; opening: boolean }, o: ReviewOptions): Promise<Asked | { unavailable: string }> {
  const apiKey = o.apiKey ?? await jevKey(o.env);
  if (!apiKey) return { unavailable: "Jev is not configured: with-secrets --add typesafe TYPESAFE_API_KEY" };
  try {
    const prompt = await loadWriteReviewPrompt(o.promptDirectory);
    const request = reviewRequest(text, sections, asks, kitOptions(schemas), prompt, ask);
    const response = await (o.fetch ?? fetch)(o.endpoint ?? (o.env ?? process.env).OUTLINER_JEV_ENDPOINT ?? JEV_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify(request), signal: AbortSignal.timeout(o.timeoutMs ?? 2500),
    });
    if (!response.ok) return { unavailable: `Jev HTTP ${response.status}` };
    const body = await response.json() as { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; answers?: Asked["answers"] };
    if (!body.answers || typeof body.answers !== "object") return { unavailable: "Jev's review answer didn't read" };
    const usage = Number.isFinite(body.usage?.input_tokens) && Number.isFinite(body.usage?.output_tokens) ? { input: body.usage!.input_tokens!, output: body.usage!.output_tokens! } : undefined;
    return { answers: body.answers, reading: { model: body.model ?? JEV_MODEL, prompt: prompt.revisions, questions: Object.keys(request.questions).length, ...(usage ? { usage } : {}) } };
  } catch (e) {
    return { unavailable: (e as Error).name === "TimeoutError" ? "Jev didn't answer in time" : `Jev: ${(e as Error).message}` };
  }
}

const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** Jev's findings from its answers: code's truth table over them, one finding per judgment that holds. */
function jevFindings(text: string, sections: readonly Section[], asked: Asked, schemas: readonly ComponentSchema[], code: readonly { line?: number; rubric: Rubric }[]): ReviewFinding[] {
  const a = asked.answers, out: ReviewFinding[] = [], t = REVIEW_THRESHOLDS;
  const lines = text.split("\n");
  const yes = (id: string) => unit(a[id]?.noul) && a[id]!.noul! >= t.yes;
  const codeIn = (s: Section, rubric: Rubric) => code.some(f => f.rubric === rubric && f.line !== undefined && f.line - 1 >= s.line && f.line - 1 <= s.end);
  for (const s of sections) {
    const where = s.id === "s0" ? "the top of the note" : `the section "${clip(s.heading, 40)}"`;
    const base = { line: s.line + 1, passage: clip(s.text), new: true, by: "jev" as const };
    const kit = a[`kit::${s.id}`], structured = a[`structured::${s.id}`]?.noul, prose = a[`prose::${s.id}`]?.noul;
    if (kit?.choice && unit(kit.confidence) && unit(structured) && unit(prose) && (structured + (1 - prose)) / 2 >= t.gate && kit.confidence >= t.confidence) {
      const schema = schemas.find(x => x.id === kit.choice);
      // A section that draws a figure already chose one: it isn't told about another.
      const held = kitIn(s.text, schemas);
      if (schema && !held.has(schema.id) && ![...held].some(id => schemas.some(x => x.id === id && x.group === "figures"))) {
        const name = blockNameOf(schema);
        const made = figurePatch(s.text, schema.id);
        const patch = "patch" in made && made.patch.every(p => text.split(p.observed).length === 2) ? made.patch : undefined;
        out.push({
          ...base, rule: "kit", rubric: "format", key: `kit:${schema.id}:${clip(s.heading, 24)}`, component: schema.id,
          say: `${where} reads as a ${(schema.title.replace(/\s*\(.*$/, "").trim() || schema.id).toLowerCase()}: ${name ? `::${name}` : schema.id} would show it (${componentGist(schema)}); ${patch ? "the patch draws it" : `outline_components ${schema.id} gives its properties and an example`}`,
          ...(patch ? { patch } : {}),
        });
      }
    }
    if (yes(`dense::${s.id}`) && !codeIn(s, "dense")) out.push({ ...base, rule: "dense", rubric: "dense", key: `dense:${clip(s.heading, 24)}`, say: `${where} packs several points into one paragraph or item: one point per line, a heading over each part` });
    if (yes(`mixed::${s.id}`)) out.push({ ...base, rule: "mixed", rubric: "mixed", key: `mixed:${clip(s.heading, 24)}`, say: `${where} mixes what's true, what was decided and what's still open: give each its own section, decisions in a ::graph-decision` });
    if (yes(`context::${s.id}`) && !codeIn(s, "context")) out.push({ ...base, rule: "context", rubric: "context", key: `context:${clip(s.heading, 24)}`, say: `${where} leans on today's context ("as discussed", "the issue above", a bare id or jargon): name the thing, or link it as ((id|label)), so it reads without this session` });
  }
  for (const [id, answer] of Object.entries(a)) {
    const m = /^unclear::L(\d+)$/.exec(id);
    if (!m || !yes(`asks::L${m[1]}`) || !unit(answer.noul) || answer.noul > t.no) continue;
    const i = Number(m[1]);
    out.push({ rule: "unclear", rubric: "unclear", key: `unclear:${clip(lines[i] ?? "", 40)}`, line: i + 1, passage: clip(lines[i] ?? ""), new: true, by: "jev", say: `line ${i + 1} asks Evan something, but not so it can be answered in a line: say the decision and the choices ("- [ ] Ship X today, or wait for Y?")` });
  }
  if (yes("argues")) {
    const opening = sections.find(s => s.id === "s0") ?? sectionsOf(text)[0];
    out.push({ rule: "argues", rubric: "argues", key: "argues", line: (opening?.line ?? 0) + 1, passage: clip(opening?.text ?? ""), new: true, by: "jev", say: "the note builds a case before its point: put the conclusion first, in one line, then the reasons under it" });
  }
  return out;
}

export interface ReviewInput {
  text: string;
  /** The note's text before this write; none for a new note (all of it is new). */
  before?: string;
  /** The note written: the next check names it. */
  id: string;
  schemas: readonly ComponentSchema[] | null;
  facets?: readonly ShapeFacet[];
  /** Whether Jev is asked at all (OUTLINER_FIGURE_FIT=off, the tests' default, says no). */
  jev: boolean;
}

/**
 * The review of a write: code's findings (new ones, and the ones the note already had as carried), Jev's on what this
 * write changed, and the verdict. `reading` when Jev answered, for the records.
 */
export async function reviewWrite(input: ReviewInput, o: ReviewOptions = {}): Promise<{ review: WriteReview; reading?: ReviewReading }> {
  const { text, before } = input;
  const lines = text.split("\n");
  const changed = before === undefined ? sectionsOf(text) : sectionsOf(text).filter(s => !before.includes(s.text));
  const titleNow = headerLine(text).prose.trim(), titleWas = before === undefined ? undefined : headerLine(before).prose.trim();
  const asks = askCandidates(text).filter(i => before === undefined || !before.split("\n").includes(lines[i]!));
  const ask = { title: titleNow !== titleWas && splitPoints(titleNow).length > 1, opening: before === undefined || changed.some(s => s.id === "s0") };
  let asked: Asked | { unavailable: string } | null = null;
  const sections = changed.filter(s => s.text.split("\n").filter(l => l.trim()).length >= 1).slice(0, MAX_SECTIONS);
  if (input.jev && input.schemas && (sections.length || asks.length || ask.title)) asked = await askJev(text, sections, asks, input.schemas, ask, o);
  const answers = asked && "answers" in asked ? asked.answers : undefined;
  const judged = answers ? {
    asks: new Set(askCandidates(text).filter(i => (answers[`asks::L${i}`]?.noul ?? 0) >= REVIEW_THRESHOLDS.yes)),
    ...(unit(answers.title?.noul) ? { titleIsContent: answers.title!.noul! >= REVIEW_THRESHOLDS.yes } : {}),
  } : {};
  const shape = { facets: input.facets, ...judged };
  const had = new Map<string, number>();
  for (const f of before === undefined ? [] : writeShape(before, shape)) had.set(f.key, (had.get(f.key) ?? 0) + 1);
  const code: ReviewFinding[] = writeShape(text, shape).map(f => {
    const n = had.get(f.key) ?? 0;
    if (n) had.set(f.key, n - 1);
    return { rule: f.rule, rubric: RUBRIC_OF[f.rule], key: f.key, say: f.say, ...(f.line ? { line: f.line } : {}), passage: clip(f.line ? lines[f.line - 1] ?? "" : text), new: !n, by: "code" as const, ...(f.patch ? { patch: f.patch } : {}) };
  });
  const jev = answers ? jevFindings(text, sections, asked as Asked, input.schemas ?? [], code) : [];
  const findings = [...code, ...jev];
  const review: WriteReview = {
    verdict: findings.some(f => f.new) ? "fix" : "ship",
    findings,
    jev: !input.jev ? "off" : asked === null ? "not asked: nothing it judges changed" : "answers" in asked ? "asked" : asked.unavailable,
    next: findings.some(f => f.new && f.patch)
      ? `apply the patches with outline_patch (each finding's patch, as written), fix the rest, then ${shapeNext(input.id)}`
      : shapeNext(input.id),
  };
  return { review, ...(asked && "reading" in asked ? { reading: asked.reading } : {}) };
}

/** A review's new findings as the write answer's warnings, each worded as a gate. */
export const reviewWarnings = (review: WriteReview) => review.findings.filter(f => f.new).map(f => FIX_BEFORE_DONE + f.say);

/**
 * The outline's property values, for the count-in-prose rule: a number typed before one of them is a count a query
 * keeps true. One `blocks.query` for every key's values (machinery left out); none when it can't be asked.
 */
export async function outlineFacets(client: { request<T>(input: { action: "blocks.query"; query: Record<string, unknown> }): Promise<T> }): Promise<ShapeFacet[]> {
  try {
    const r = await client.request<{ facets?: QuestionFacet[] }>({ action: "blocks.query", query: { where: "", facets: true, facetKeys: 300, facetValues: 200, limit: 1 } });
    return (r.facets ?? []).flatMap(f => f.values.map(v => ({ key: f.key, value: v.value, count: v.count, values: f.values.length + (f.more ?? 0) })));
  } catch { return []; }
}
