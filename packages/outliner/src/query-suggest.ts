import { randomUUID } from "node:crypto";
import { clauseText, type Clause } from "@ep0ch/outline-core/query-clauses";
import { queryDateWords } from "@ep0ch/outline-core/query-date-words";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { matchesSearchText } from "@ep0ch/outline-core/search-match";
import type { QuestionFacet } from "@ep0ch/outline-core/protocol";
import { queryWordsWhere, type QuerySuggestAnswer, type QuerySuggestRequest, type QueryWordClause, type QueryWords } from "@ep0ch/outline-core/query-words";
import { expressionPropertyKeys, parseQueryExpression, queryClausePick } from "./block-query";
import { blockDisplayTitle } from "./references";
import { loadQuerySuggestPrompt } from "./ai-prompts";
import { askJev, type JevAnswer, type JevOptions, type JevReading } from "./jev";
import { recordQueryWords, SuggestionWrites, type SuggestionClient } from "./jev-suggestions";
import type { RecordCache } from "./records";
import type { Block, VisibleBlockCollection, OutlinerResponse, OutlinerRequest } from "./types";

export async function querySuggestReply(suggester: QuerySuggester, request: Extract<OutlinerRequest, { action: "query.suggest" }>, sequence: () => number): Promise<OutlinerResponse> {
  try {
    if (typeof request.text !== "string" || (request.where !== undefined && typeof request.where !== "string")) throw new Error("query.suggest needs text and an optional where query");
    if (request.zone !== undefined) new Intl.DateTimeFormat("en", { timeZone: request.zone });
    if (request.outcome && (!request.suggestion || !["accepted", "edited", "ignored"].includes(request.outcome))) throw new Error("query.suggest outcome needs its suggestion and accepted, edited or ignored");
    return { id: request.id, ok: true, result: await suggester.run(request), sequence: sequence() };
  } catch (error) { return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error), sequence: sequence() }; }
}

/** Scored by scripts/evals/query-suggest.ts: uncertain clauses remain offers, with their runner-up. */
export const QUERY_SUGGEST_THRESHOLDS = { gate: 0.7, probability: 0.35, confident: 0.7, negation: 0.7 };
export const QUERY_SUGGEST_BUDGET_MS = 1500;
// The kitchen sink has hundreds of keys: asking four questions about every one exceeds Jev's context.
const COMMON_KEYS = 8, COMMON_VALUES = 20;
const CONNECTING = new Set("a an the things thing notes note ones ones show find me about with from of on in that those these please and or".split(" "));
const wordsOf = (text: string) => text.match(/[\p{L}\p{N}_@./'-]+/gu) ?? [];
const meaningful = (text: string) => wordsOf(text).filter(w => !CONNECTING.has(w.toLowerCase()));
const quote = (text: string) => JSON.stringify(text);
const textClause = (word: string) => `text~${quote(word)}`;
const spanPattern = (span: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu");
const hasSpan = (text: string, span: string) => spanPattern(span).test(text);
const without = (text: string, spans: readonly string[]) => spans.reduce((s, w) => s.replace(spanPattern(w), " "), text);
const props = (text: string, key: string) => parsePropertyRecords(text).filter(p => p.key === key).map(p => p.value);
const NEGATION = /^(?:not|without|except)$/i;

interface Candidate { value: string; clause: string; pick?: Clause; widens: boolean }
interface Axis { key: string; candidates: Candidate[] }
interface Read { answer: QueryWords; reading?: JevReading }
type Prompt = Awaited<ReturnType<typeof loadQuerySuggestPrompt>>;

/** The service owns candidates, interpretation and acceptance; clients only show and insert its answer. */
export class QuerySuggester {
  private cache = new Map<string, QueryWords>();
  private records: RecordCache = {};
  constructor(private readonly client: SuggestionClient, private readonly writes = new SuggestionWrites()) {}

  private async notes(where: string): Promise<Block[]> {
    return (await this.client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit: 1000 } })).blocks;
  }

  async run(request: QuerySuggestRequest, options: JevOptions = {}): Promise<QuerySuggestAnswer> {
    if (request.outcome) return this.writes.run(() => this.finish(request));
    const text = request.text.trim(), base = request.where?.trim() ?? "";
    const zone = request.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rules = await this.notes("rule-name=query-words");
    const aliases = rules.flatMap(note => props(note.text, "alias")).flatMap(line => {
      const eq = line.indexOf("=");
      if (eq < 1) return [];
      const from = line.slice(0, eq), clause = line.slice(eq + 1);
      try { parseQueryExpression(clause); return [{ from, clause }]; } catch { return []; }
    }).sort((a, b) => b.from.length - a.from.length);
    let rest = text;
    const clauses: QueryWordClause[] = [];
    for (const alias of aliases) if (hasSpan(rest, alias.from)) {
      const negative = ["not", "without", "except"].map(n => `${n} ${alias.from}`).find(from => hasSpan(rest, from));
      const from = negative ?? alias.from, clause = negative ? `NOT (${alias.clause})` : alias.clause;
      const pick = queryClausePick(parseQueryExpression(clause));
      clauses.push({ clause, confidence: 1, alternatives: [], from: [from], ...(pick ? { pick } : {}) });
      rest = without(rest, [from]);
    }
    const dates = queryDateWords(rest, zone);
    const terms = meaningful(without(rest, dates.map(d => d.words)));
    if (!terms.length && clauses.length && !dates.length) return this.keep({ answer: this.assemble(text, base, clauses, []) }, request);
    const facetQuery = { facets: true as const, facetValues: 1000, facetKeys: 1000, facetSearch: terms.join(" "), limit: 1 };
    const all = (await this.client.request<VisibleBlockCollection>({ action: "blocks.query", query: facetQuery })).facets ?? [];
    const selected = base ? (await this.client.request<VisibleBlockCollection>({ action: "blocks.query", query: { ...facetQuery, where: base } })).facets ?? [] : all;
    const keys = new Set(all.map(f => f.key));
    // Complete a grammar prefix in code. Bare unknown words are a request, even though the parser can read them as keys.
    if (!clauses.length && !dates.length && this.grammar(text, keys)) return { id: "", input: text, base, where: text, clauses: [], text: [], grammar: true };
    const settings = await this.notes("type=settings OR page=settings");
    if (settings.some(note => props(note.text, "query-suggest").includes("off"))) return { unavailable: "Query words are off in this outline's settings note ([query-suggest::off])." };

    const likely = new Set((base ? selected : all.slice(0, COMMON_KEYS)).map(f => f.key));
    const hits = (value: string) => terms.some(word => matchesSearchText(word.replace(/['’]s$/, ""), [value]));
    const axes = all.filter(f => likely.has(f.key) || hits(f.key) || f.values.some(v => hits(v.value))).map(f => this.axis(f, selected, hits));
    const census = await this.client.request<{ actors: { key: string }[] }>({ action: "blocks.census" });
    const people = census.actors.map(a => a.key).filter(a => a !== "unknown");
    axes.push({ key: "by", candidates: [...new Set(["user", ...people])].map(value => ({ value, clause: `by:${value}`, widens: false })) });
    const views = await this.notes("query");
    if (views.length) axes.push({ key: "view", candidates: views.map(v => ({ value: props(v.text, "page")[0] ?? blockDisplayTitle(v), clause: props(v.text, "query")[0]!, widens: false })) });
    const signature = JSON.stringify([text, base, zone, axes, aliases, dates]);
    const cached = this.cache.get(signature);
    if (cached) return this.keep({ answer: { ...cached, id: randomUUID() } }, request);
    if (request.semantic === false) return { id: "", input: text, base, where: text, clauses: [], text: [], pending: true };
    const read = await this.choose(text, rest, base, axes, dates, clauses, options);
    if ("unavailable" in read) return read;
    this.cache.set(signature, read.answer);
    return this.keep(read, request);
  }

  private grammar(text: string, keys: Set<string>): boolean {
    if (!text) return true;
    if (!/\s/.test(text) && [...keys].some(key => key.startsWith(text))) return true;
    try {
      const parsed = parseQueryExpression(text);
      return expressionPropertyKeys(parsed).every(key => keys.has(key)) && (/[:=~#<>]/.test(text) || keys.has(text));
    } catch { return /[=~:#<>]/.test(text) && !/\s/.test(text); }
  }

  private axis(f: QuestionFacet, selected: QuestionFacet[], hits: (value: string) => boolean): Axis {
    const here = selected.find(s => s.key === f.key)?.values ?? [], inside = new Set(here.map(v => v.value));
    const common = (values: QuestionFacet["values"]) => [...values].sort((a, b) => b.count - a.count).slice(0, COMMON_VALUES).map(v => v.value);
    const offered = new Set([...common(here), ...common(f.values)]);
    return { key: f.key, candidates: f.values.filter(v => offered.has(v.value) || hits(v.value)).map(v => {
      const pick: Clause = { key: f.key, value: v.value, mode: "include" };
      return { value: v.value, clause: clauseText(pick), pick, widens: !inside.has(v.value) };
    }).sort((a, b) => Number(a.widens) - Number(b.widens)) };
  }

  private async choose(text: string, rest: string, base: string, axes: Axis[], dates: { words: string; clause: string }[], clauses: QueryWordClause[], options: JevOptions): Promise<Read | { unavailable: string }> {
    const prompt = await loadQuerySuggestPrompt();
    const tokens = meaningful(without(rest, dates.map(d => d.words)));
    const spans = [...new Set([...tokens.filter(t => !NEGATION.test(t)), ...axes.flatMap(axis => axis.candidates.flatMap(candidate => {
      const value = candidate.value.toLowerCase().replace(/[-_]/g, " "), size = value.split(/\s+/).length;
      return tokens.flatMap((_, i) => { const span = tokens.slice(i, i + size).join(" "); return size > 1 && value.startsWith(span.toLowerCase()) ? [span] : []; });
    }))])];
    const questions: Record<string, unknown> = {};
    const choices = new Map<string, { instructions: string; values: string[]; groups?: string[][] }>();
    const choice = (id: string, instructions: string, values: string[]) => {
      const groups = values.length > 254 ? chunks(values, 254) : undefined;
      choices.set(id, { instructions, values, groups });
      return { type: "choice", instructions, criteria: { ...Object.fromEntries((groups ?? values).map((value, i) => [`v${i}`, value])), none: "None of these expresses the request" } };
    };
    const valueOf = (id: string, selected: string | undefined) => selected?.startsWith("v") ? choices.get(id)?.values[Number(selected.slice(1))] : undefined;
    const state = { request: text, candidates: Object.fromEntries(axes.map(a => [a.key, a.candidates.map(c => ({ value: c.value, selection: !c.widens }))])) };
    for (const axis of axes) {
      const instructions = (question: keyof Omit<Prompt, "revisions">) => ({ question: prompt[question], key: axis.key });
      questions[`gate:${axis.key}`] = { type: "noul", instructions: instructions("gate") };
      questions[`negate:${axis.key}`] = { type: "noul", instructions: instructions("negate") };
      questions[`words:${axis.key}`] = choice(`words:${axis.key}`, `${prompt.words} Key: ${axis.key}`, spans);
      questions[`pick:${axis.key}`] = choice(`pick:${axis.key}`, `${prompt.pick} Key: ${axis.key}. When choices are groups, select the group containing that value.`, axis.candidates.map(c => c.value));
    }
    if (dates.length) {
      questions.date = choice("date", prompt.date, dates.map(d => d.words));
      questions.dateGate = { type: "noul", instructions: prompt.dateGate };
    }
    for (const span of spans) questions[`text:${span}`] = { type: "noul", instructions: { question: prompt.text, span } };
    const started = Date.now();
    const response = await askJev(state, questions, prompt.revisions, { ...options, timeoutMs: options.timeoutMs ?? QUERY_SUGGEST_BUDGET_MS });
    if ("unavailable" in response) return response;
    const second: Record<string, unknown> = {};
    for (const [id, plan] of choices) if (plan.groups) {
      const selected = response.answers[id]?.choice;
      const candidates = selected?.startsWith("v") ? plan.groups[Number(selected.slice(1))] : undefined;
      if (candidates) second[id] = choice(id, plan.instructions, candidates);
    }
    if (Object.keys(second).length) {
      const remaining = (options.timeoutMs ?? QUERY_SUGGEST_BUDGET_MS) - (Date.now() - started);
      if (remaining <= 0) return { unavailable: "Jev didn't answer in time" };
      const next = await askJev(state, second, prompt.revisions, { ...options, timeoutMs: remaining });
      if ("unavailable" in next) return next;
      Object.assign(response.answers, next.answers);
      response.reading.questions += next.reading.questions;
      if (next.reading.usage) response.reading.usage = { input: (response.reading.usage?.input ?? 0) + next.reading.usage.input, output: (response.reading.usage?.output ?? 0) + next.reading.usage.output };
    }
    const used = new Set<string>();
    for (const axis of axes) {
      const pick = response.answers[`pick:${axis.key}`];
      if (!yes(response.answers[`gate:${axis.key}`]) || !pick?.choice || pick.choice === "none") continue;
      const candidate = axis.candidates.find(c => c.value === valueOf(`pick:${axis.key}`, pick.choice));
      if (!candidate || (pick.probabilities?.[pick.choice] ?? 0) < QUERY_SUGGEST_THRESHOLDS.probability) continue;
      const said = valueOf(`words:${axis.key}`, response.answers[`words:${axis.key}`]?.choice);
      let from = said && spans.includes(said) ? [said] : spans.filter(s => matchesSearchText(s.replace(/['’]s$/, ""), [candidate.value]));
      if (!from.length) continue;
      const negative = yes(response.answers[`negate:${axis.key}`], QUERY_SUGGEST_THRESHOLDS.negation);
      const negator = negative && tokens.find(w => NEGATION.test(w));
      if (negator) from = [negator, ...from];
      const clause = negative ? `NOT (${candidate.clause})` : candidate.clause;
      const alternatives = Object.entries(pick.probabilities ?? {}).filter(([value]) => value !== pick.choice && value !== "none")
        .sort((a, b) => b[1] - a[1]).slice(0, 1).flatMap(([id]) => axis.candidates.filter(c => c.value === valueOf(`pick:${axis.key}`, id)).map(c => negative ? `NOT (${c.clause})` : c.clause));
      const asText = from.filter(w => !NEGATION.test(w)).map(textClause).join(" AND ");
      if (from.some(s => yes(response.answers[`text:${s}`]))) {
        clauses.push({ clause: negative ? `NOT (${asText})` : asText, from, confidence: response.answers[`text:${from[0]}`]?.noul ?? 1, alternatives: [clause] });
      } else clauses.push({ clause, from, confidence: pick.confidence ?? 0, alternatives: (pick.confidence ?? 0) < QUERY_SUGGEST_THRESHOLDS.confident ? [...alternatives, negative ? `NOT (${asText})` : asText] : [], ...(candidate.pick ? { pick: { ...candidate.pick, mode: negative ? "exclude" : "include" } } : {}), ...(candidate.widens ? { widens: true } : {}) });
      from.forEach(w => used.add(w));
    }
    const date = yes(response.answers.dateGate) ? dates.find(d => d.words === valueOf("date", response.answers.date?.choice)) : undefined;
    if (date) { clauses.push({ clause: date.clause, from: [date.words], confidence: response.answers.date?.confidence ?? 1, alternatives: [], learn: false }); rest = without(rest, [date.words]); }
    const leftover = meaningful(without(rest, [...used]));
    return { answer: this.assemble(text, base, clauses, leftover), reading: response.reading };
  }

  private assemble(input: string, base: string, clauses: QueryWordClause[], text: string[]): QueryWords {
    for (const clause of clauses) {
      clause.alternativePicks = Object.fromEntries(clause.alternatives.flatMap(alternative => {
        const pick = queryClausePick(parseQueryExpression(alternative));
        return pick ? [[alternative, pick]] : [];
      }));
    }
    const all = [...clauses, ...text.map(word => ({ clause: textClause(word), confidence: 1, alternatives: [], from: [word], learn: false as const }))];
    const query = queryWordsWhere("", all), where = queryWordsWhere(base, all);
    return { id: randomUUID(), input, base, where, clauses: all, text,
      ...(base && query ? { replacement: query } : {}) };
  }

  private async keep(read: Read, request: QuerySuggestRequest): Promise<QueryWords> {
    read.answer.id = await this.writes.run(() => recordQueryWords(this.client, read.answer, "suggested", request.mutation?.actorId ?? "user", read.reading, this.records));
    return read.answer;
  }

  private async finish(request: QuerySuggestRequest): Promise<QueryWords> {
    const suggestion = request.suggestion!;
    if (request.outcome === "accepted" || request.corrections) {
      const mappings = request.corrections ?? suggestion.clauses.filter(c => c.learn !== false).map(c => ({ from: c.from, clause: c.clause }));
      if (mappings.length) {
        const note = (await this.notes("rule-name=query-words"))[0];
        let text = note?.text ?? "Query words [type::rule] [rule-name::query-words]\nAccepted words and their queries. Edit an alias to teach the next completion.\n";
        for (const mapping of mappings) {
          const from = mapping.from.join(" ");
          const line = `[alias::${from}=${mapping.clause.replace(/\]/g, "\\]")}]`;
          const existing = props(text, "alias").find(a => a.startsWith(`${from}=`));
          text = existing ? text.replace(`[alias::${existing}]`, line) : `${text}\n${line}`;
        }
        const mutation = request.mutation ?? { author: "user" as const };
        if (note) await this.client.request({ action: "update", blockId: note.id, text, expectedRevision: note.revision, mutation });
        else await this.client.request({ action: "create", text, author: mutation.author, ...(mutation.author === "agent" && mutation.actorId ? { provenance: { actorId: mutation.actorId } } : {}) });
      }
    }
    await recordQueryWords(this.client, { ...suggestion, where: request.acceptedWhere ?? suggestion.where }, request.outcome!, request.mutation?.actorId ?? "user", undefined, this.records);
    return suggestion;
  }
}

const yes = (answer: JevAnswer | undefined, threshold = QUERY_SUGGEST_THRESHOLDS.gate) => (answer?.noul ?? 0) >= threshold;
function chunks<T>(items: T[], size: number): T[][] { return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size)); }
