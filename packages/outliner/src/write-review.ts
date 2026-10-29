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
import { calloutBlocks, quoteDepth } from "@ep0ch/outline-core/callouts";
import { figurePatch } from "@ep0ch/outline-core/figure-patch";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { asksEvan, FIX_BEFORE_DONE, RUBRIC_OF, shapeNext, splitPoints, writeShape, type Rubric, type ShapeFacet, type ShapePatch } from "@ep0ch/outline-core/write-shape";
import { loadWriteReviewPrompt, type WriteReviewPrompt } from "./ai-prompts";
import { FIGURE_FIT_THRESHOLDS } from "./figure-fit";
import { chipValue } from "./records";
import { askJev as askJevRequest, JEV_MODEL, jevKey, NOT_CONFIGURED, type JevAsked, type JevOptions, type JevReading } from "./jev";
import type { QuestionFacet } from "@ep0ch/outline-core/protocol";

/** A Noul at or over this reads as yes; under `NO` as no (the skill's starting thresholds). */
export const REVIEW_THRESHOLDS = { yes: 0.7, no: 0.3, ...FIGURE_FIT_THRESHOLDS };

/**
 * What a section must be before Jev's judgment of it stands (code's half of the truth table): a short, clear passage
 * is never pushed into a component or called dense, whatever Jev says. A component needs rows to draw (or a wall of
 * prose it could replace); dense and mixed need room to be either.
 */
export const REVIEW_SIZES = { kitRows: 3, kitProse: 400, dense: 300, denseUnit: 200, mixed: 400 };
/** Sections a review asks Jev about, and how much of each it sends. */
const MAX_SECTIONS = 8, MAX_SECTION = 1500, MAX_ASKS = 8;

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
  /**
   * Advice, not a gate: a component Jev would draw the section with that code can't build (no ready patch). Said and
   * recorded, never what makes the verdict `fix` (PIE-1402: a short status note was told "fix" to become a timeline).
   */
  advice?: true;
  patch?: ShapePatch[];
}

export interface WriteReview {
  /** `fix` when this write left something new to fix; `ship` otherwise. Code's call, over code's and Jev's findings. */
  verdict: "ship" | "fix";
  findings: ReviewFinding[];
  /**
   * What Jev read and judged this time (`jevScope` of a key): a later write's review that judged a finding's scope and
   * didn't say it again is how the finding is known fixed, not a quiet Jev on a part it never read (PIE-1402).
   */
  judged?: string[];
  /** Whether Jev read it: `asked`, `not asked` (nothing it would judge changed), or why it couldn't be. */
  jev: string;
  next: string;
}

/** Jev's answers for one review, kept for the records: the model, the prompt and the tokens. */
export type ReviewReading = JevReading;

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
    // A heading at the top level, as outline_edit's replaceSection finds one (one inside a callout is the callout's).
    const h = structure[i] === -1 && quoteDepth(line).depth === 0 ? HEADING.exec(line) : null;
    if (h) { close(); open = { id: `s${out.length + 1}`, heading: h[1]!.trim(), line: i, end: i, text: "" }; return; }
    open.end = i;
  });
  close();
  return out.map((s, k) => ({ ...s, id: `s${k}` }));
}

/** The lines below the top that may ask Evan something: a question mark or a decision word, outside code and components. */
function askCandidates(text: string): number[] {
  const lines = text.split("\n"), structure = noteStructure(lines), title = headerLine(text).line;
  return lines.flatMap((line, i) => i > title && structure[i] === -1 && (/\?/.test(line) || /\b(?:evan|you|your|decide|decision|should|please|let me know|approve|confirm|pick|choose|sign off)\b/i.test(line)) ? [i] : []);
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


/** One request: the state (title, opening, the changed sections, the candidate ask lines) and every question about it. */
export function reviewRequest(text: string, sections: readonly Section[], asks: readonly number[], options: Record<string, string>, prompt: WriteReviewPrompt, o: { title: boolean; opening: boolean }) {
  const lines = text.split("\n");
  const fill = (q: string, path: string) => q.replace(/\{section\}|\{line\}/g, path);
  const questions: Record<string, unknown> = {};
  for (const s of sections) {
    const path = `sections.${s.id}.text`;
    if (Object.keys(options).length >= 2) questions[`kit::${s.id}`] = { type: "choice", instructions: fill(prompt.kit, path), criteria: options };
    for (const q of ["structured", "prose", "dense", "mixed", "context", "qa"] as const) questions[`${q}::${s.id}`] = { type: "noul", instructions: fill(prompt[q], path) };
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

export type ReviewOptions = JevOptions & { promptDirectory?: string };
export type Asked = JevAsked;

/**
 * One request to Jev with the write review's prompt as its revision (the write review's, and the work tools' in
 * work-review.ts): jev.ts's askJev. Never throws.
 */
export async function askJevQuestions(state: Record<string, unknown>, questions: Record<string, unknown>, o: ReviewOptions = {}): Promise<Asked | { unavailable: string }> {
  try {
    const apiKey = o.apiKey ?? await jevKey(o.env);
    if (!apiKey) return { unavailable: NOT_CONFIGURED };
    return await askJevRequest(state, questions, (await loadWriteReviewPrompt(o.promptDirectory)).revisions, { ...o, apiKey });
  } catch (e) {
    return { unavailable: `Jev: ${(e as Error).message}` };
  }
}

/** Jev's answers about the parts of `text` this write changed, or why it couldn't be asked. Never throws. */
async function askJev(text: string, sections: readonly Section[], asks: readonly number[], schemas: readonly ComponentSchema[], ask: { title: boolean; opening: boolean }, o: ReviewOptions): Promise<Asked | { unavailable: string }> {
  try {
    const request = reviewRequest(text, sections, asks, kitOptions(schemas), await loadWriteReviewPrompt(o.promptDirectory), ask);
    return await askJevQuestions(request.state, request.questions, o);
  } catch (e) {
    return { unavailable: `Jev: ${(e as Error).message}` };
  }
}

const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Words that lean on the session the note was written in ("as discussed", "the issue above"): where a context finding
 * points, so it quotes the phrase rather than its section's opening.
 */
const CONTEXT_CUE = /\b(?:as (?:we )?(?:discussed|said|agreed|mentioned|planned)|discussed (?:above|earlier|before)|(?:the|that|this) (?:issue|note|point|thing|item|bug|fix|plan|idea|change|one) (?:above|earlier|from before)|(?:see|per) above|like (?:before|last time)|same as before|the usual|you know the|per our)\b/i;

/** The line of a section that holds a context cue, and the cue: the passage a context finding quotes. */
function contextCue(s: Section, lines: readonly string[]): { line: number; phrase: string; text: string } | undefined {
  for (let i = s.line; i <= s.end; i++) {
    const m = CONTEXT_CUE.exec(lines[i] ?? "");
    if (m) return { line: i, phrase: m[0], text: lines[i]! };
  }
  return undefined;
}

/** What a key's judgment was about, as a review's `judged` lists it: a section by its heading, a line by its words, the opening. */
export function jevScope(key: string): string {
  if (key === "argues") return "argues";
  const unclear = /^unclear:(.*)$/s.exec(key);
  if (unclear) return `line:${unclear[1]}`;
  const parts = key.split(":");
  return `section:${parts.slice(1).join(":")}`;
}

/** Jev's findings from its answers: code's truth table over them, one finding per judgment that holds. */
function jevFindings(text: string, sections: readonly Section[], asked: Asked, schemas: readonly ComponentSchema[], code: readonly { line?: number; rubric: Rubric }[], qaRule = QA_RULE): ReviewFinding[] {
  const a = asked.answers, out: ReviewFinding[] = [], t = REVIEW_THRESHOLDS;
  const lines = text.split("\n");
  const yes = (id: string) => unit(a[id]?.noul) && a[id]!.noul! >= t.yes;
  const codeIn = (s: Section, rubric: Rubric) => code.some(f => f.rubric === rubric && f.line !== undefined && f.line - 1 >= s.line && f.line - 1 <= s.end);
  for (const s of sections) {
    const where = s.id === "s0" ? "the top of the note" : `the section "${clip(s.heading, 40)}"`;
    const base = { line: s.line + 1, passage: clip(s.text), new: true, by: "jev" as const };
    const kit = a[`kit::${s.id}`], structured = a[`structured::${s.id}`]?.noul, prose = a[`prose::${s.id}`]?.noul;
    // Rows a figure could draw: list items, table rows, dated lines, a callout's body lines (as figure-fit counts them).
    const rows = s.text.split("\n").filter(l => /^[ \t>]*(?:[-*+]|\d+[.)]|\||\d{4}-\d{2})\s*\S/.test(l) || /^[ \t]*>[ \t]*(?!\[!)\S/.test(l)).length;
    const roomy = (n: number) => s.text.length > n;
    if ((rows >= REVIEW_SIZES.kitRows || roomy(REVIEW_SIZES.kitProse)) && kit?.choice && unit(kit.confidence) && unit(structured) && unit(prose) && (structured + (1 - prose)) / 2 >= t.gate && kit.confidence >= t.confidence) {
      const schema = schemas.find(x => x.id === kit.choice);
      // A section that draws a figure already chose one: it isn't told about another.
      const held = kitIn(s.text, schemas);
      if (schema && !held.has(schema.id) && ![...held].some(id => schemas.some(x => x.id === id && x.group === "figures"))) {
        const name = blockNameOf(schema);
        const made = figurePatch(s.text, schema.id);
        const patch = "patch" in made && made.patch.every(p => text.split(p.observed).length === 2) ? made.patch : undefined;
        out.push({
          // One kit nudge a section (its key names the section, not the component): a rewrite that makes Jev name another
          // component is the same nudge, carried, not a new one each write.
          ...base, rule: "kit", rubric: "format", key: `kit:${clip(s.heading, 24)}`, component: schema.id,
          say: `${where} reads as a ${(schema.title.replace(/\s*\(.*$/, "").trim() || schema.id).toLowerCase()}: ${name ? `::${name}` : schema.id} would show it (${componentGist(schema)}); ${patch ? "the patch draws it" : `if it fits, outline_components ${schema.id} gives its properties and an example`}`,
          ...(patch ? { patch } : { advice: true as const }),
        });
      }
    }
    // Dense needs a unit long enough to be: a section of short items (a wall's patch, a list) is never told it.
    const longest = Math.max(0, ...s.text.split(/\n\s*\n|\n(?=[ \t>]*(?:[-*+]|\d+[.)])[ \t])/).map(u => u.replace(/\s+/g, " ").trim().length));
    if (yes(`dense::${s.id}`) && roomy(REVIEW_SIZES.dense) && longest > REVIEW_SIZES.denseUnit && !codeIn(s, "dense")) out.push({ ...base, rule: "dense", rubric: "dense", key: `dense:${clip(s.heading, 24)}`, say: `${where} packs several points into one paragraph or item: one point per line, a heading over each part` });
    if (yes(`mixed::${s.id}`) && roomy(REVIEW_SIZES.mixed)) out.push({ ...base, rule: "mixed", rubric: "mixed", key: `mixed:${clip(s.heading, 24)}`, say: `${where} mixes what's true, what was decided and what's still open: give each its own section, decisions in a ::graph-decision` });
    if (yes(`qa::${s.id}`) && !codeIn(s, "qa-for-evan")) out.push({ ...base, rule: "qa-for-evan", rubric: "qa-for-evan", key: `qa:${clip(s.heading, 24)}`, say: `${where} asks Evan to try or check something himself: ${qaRule}` });
    if (yes(`context::${s.id}`) && !codeIn(s, "context")) {
      // The phrase it leans on, quoted where code finds one; else the section's opening, said as such.
      const cue = contextCue(s, lines);
      out.push({
        ...base, ...(cue ? { line: cue.line + 1, passage: clip(cue.text) } : {}), rule: "context", rubric: "context", key: `context:${clip(s.heading, 24)}`,
        say: cue
          ? `line ${cue.line + 1} leans on today's context ("${cue.phrase}"): name the thing it means, or link it as ((id|label)), so it reads without this session`
          : `${where} leans on today's context (a bare id, jargon, or a thing named as if known): name the thing, or link it as ((id|label)), so it reads without this session`,
      });
    }
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
  /** The outline's property values for the count rule; a promise is awaited only after Jev is asked, so a slow read never holds Jev up. */
  facets?: readonly ShapeFacet[] | Promise<readonly ShapeFacet[]>;
  /** Why Jev isn't asked, said in the answer's `jev` (a review answered without it); `off` only when the setting says so. */
  jevWhy?: string;
  /** Whether Jev is asked at all (OUTLINER_FIGURE_FIT=off, the tests' default, says no). */
  jev: boolean;
  /** How the outline words its validation rule (work-review.ts houseRule), for a finding that asks Evan to check things. */
  qaRule?: string;
  /**
   * The keys this note's writer was already told (its `review-finding` records): told once, a finding is carried after,
   * so a write that fixed everything else can ship (PIE-1402: Jev's findings were new on every write).
   */
  told?: ReadonlySet<string>;
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
  const asks = askCandidates(text).filter(i => before === undefined || !before.split("\n").includes(lines[i]!)).slice(0, MAX_ASKS);
  const ask = { title: titleNow !== titleWas && splitPoints(titleNow).length > 1, opening: before === undefined || changed.some(s => s.id === "s0") };
  let asked: Asked | { unavailable: string } | null = null;
  const sections = changed.filter(s => s.text.split("\n").filter(l => l.trim()).length >= 1).slice(0, MAX_SECTIONS);
  if (input.jev && input.schemas && (sections.length || asks.length || ask.title)) asked = await askJev(text, sections, asks, input.schemas, ask, o);
  const answers = asked && "answers" in asked ? asked.answers : undefined;
  const judged = answers ? {
    // Jev's yes where it was asked, and the word heuristic's (Evan named, with a question or a decision word) either way:
    // a line that names Evan and asks is an ask whatever Jev said (PIE-1402: "Should Evan pick up…?" went unflagged).
    asks: new Set(lines.flatMap((line, i) => asksEvan(line) || (answers[`asks::L${i}`]?.noul ?? 0) >= REVIEW_THRESHOLDS.yes ? [i] : [])),
    ...(unit(answers.title?.noul) ? { titleIsContent: answers.title!.noul! >= REVIEW_THRESHOLDS.yes } : {}),
  } : {};
  const shape = { facets: await input.facets, ...judged };
  const had = new Map<string, number>();
  for (const f of before === undefined ? [] : writeShape(before, shape)) had.set(f.key, (had.get(f.key) ?? 0) + 1);
  const code: ReviewFinding[] = writeShape(text, shape).map(f => {
    const n = had.get(f.key) ?? 0;
    if (n) had.set(f.key, n - 1);
    return { rule: f.rule, rubric: RUBRIC_OF[f.rule], key: f.key, say: f.say, ...(f.line ? { line: f.line } : {}), passage: clip(f.passage ?? (f.line ? lines[f.line - 1] ?? "" : text)), new: !n && !toldOf(input.told, f.key), by: "code" as const, ...(f.patch ? { patch: f.patch } : {}) };
  });
  const qaRule = input.qaRule ?? QA_RULE;
  code.push(...qaFindings(text, before, qaRule).map(f => toldOf(input.told, f.key) ? { ...f, new: false } : f));
  const jev = (answers ? jevFindings(text, sections, asked as Asked, input.schemas ?? [], code, qaRule) : []).map(f => toldOf(input.told, f.key) ? { ...f, new: false } : f);
  const findings = withoutOverlaps(text, [...code, ...jev]);
  const review: WriteReview = {
    verdict: findings.some(f => f.new && !f.advice) ? "fix" : "ship",
    findings,
    ...(answers ? { judged: [...sections.map(s => `section:${clip(s.heading, 24)}`), ...asks.map(i => `line:${clip(lines[i] ?? "", 40)}`), ...(ask.opening ? ["argues"] : [])] } : {}),
    jev: !input.jev ? input.jevWhy ?? "off" : asked === null ? "not asked: nothing it judges changed" : "answers" in asked ? "asked" : asked.unavailable,
    next: findings.some(f => f.new && f.patch)
      ? `apply the patches with outline_patch (each finding's patch, as written), fix the rest, then ${shapeNext(input.id)}`
      : shapeNext(input.id),
  };
  return { review, ...(asked && "reading" in asked ? { reading: asked.reading } : {}) };
}

/** Whether a key was told: its record holds it as a chip holds it (records.ts chipValue). */
const toldOf = (told: ReadonlySet<string> | undefined, key: string) => !!told && (told.has(key) || told.has(chipValue(key)));

/** What a finding that asks Evan to validate says, unless the outline words it (house rules, work-review.ts). */
export const QA_RULE = "validation is the agents' job, never Evan's: drive it yourself (a scratch door, a headless page) and tell him what you saw";

const ASKS_QA = /\b(?:can you|could you|please|would you|evan[,:]?)\s+(?:try|test|verify|check|confirm)\b|\bneeds? evan to\s+(?:try|test|verify|check|confirm)\b/i;

/** Lines that ask Evan to try or check something himself, found by their words (Jev judges the rest per section). */
function qaFindings(text: string, before: string | undefined, qaRule: string): ReviewFinding[] {
  const lines = text.split("\n"), structure = noteStructure(lines), had = new Set(before?.split("\n") ?? []);
  return lines.flatMap((line, i) => structure[i] === -1 && ASKS_QA.test(line) ? [{
    rule: "qa-for-evan", rubric: "qa-for-evan" as Rubric, key: `qa:${clip(line, 40)}`, line: i + 1, passage: clip(line), new: !had.has(line), by: "code" as const,
    say: `line ${i + 1} asks Evan to try or check something: ${qaRule}`,
  }] : []);
}

/**
 * The findings with patches that can all be applied together: one whose patch touches the text another's already
 * touches (a stacked bullet that also types a count, a list a kit figure would replace) keeps its finding and says to
 * review again after the first is applied, so "apply every patch as written" always works.
 */
function withoutOverlaps(text: string, findings: ReviewFinding[]): ReviewFinding[] {
  const taken: [number, number][] = [];
  // The ask's patch is placed first: moving a buried question to the top matters more than splitting the paragraph it was in.
  const order = [...findings.keys()].sort((a, b) => Number(findings[b]!.rubric === "buried") - Number(findings[a]!.rubric === "buried"));
  const placed = new Map<number, ReviewFinding>();
  for (const k of order) placed.set(k, place(findings[k]!));
  return findings.map((_, k) => placed.get(k)!);
  function place(f: ReviewFinding): ReviewFinding {
    if (!f.patch || !f.new) return f;
    const spans = f.patch.map(p => { const at = text.indexOf(p.observed); return [at, at + p.observed.length] as [number, number]; });
    const clashes = spans.some(([a, b]) => a < 0 || taken.some(([c, d]) => a < d && c < b));
    if (clashes) { const { patch: _, ...rest } = f; return { ...rest, say: `${f.say} (after the other patches: its own comes with the next review)` }; }
    taken.push(...spans);
    return f;
  }
}

/** A review's new findings as the write answer's warnings, each worded as a gate; advice as advice. */
export const reviewWarnings = (review: WriteReview) => review.findings.filter(f => f.new).map(f => (f.advice ? "consider: " : FIX_BEFORE_DONE) + f.say);

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
