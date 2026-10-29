// The search eval (PIE-1197): ranked search measured on real queries before its thresholds are set or its model moves.
//
// - Harvest: the queries agents searched with (Claude Code's session logs, read only) and the note each then opened,
//   and the rows Evan opened from a search (`search.picked`), become `search-eval-case` records in the outline. A
//   search that opened none of its rows and made a note instead is a case whose answer is `none`.
// - Run: each case's candidates from the outline's own search (tree.search, as the person gets them), the one request
//   search-ranking.ts builds, asked of each model, cached by the request: hit@1 and hit@5 against the label, the
//   lexical order as the baseline, and the "is it among these?" Noul on cases that have an answer and those that don't,
//   which is where SEARCH_THRESHOLDS come from. A `jev-run` per model (`experiment::search-eval`) carries the tokens.
// Real queries and the notes they name stay in the outline: nothing here copies them anywhere else but the cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadGotoPrompt, type PromptRevision } from "./ai-prompts";
import { askJev, type JevOptions } from "./jev";
import { promptRevOf, setChip } from "./jev-suggestions";
import { writeRecord, type RecordWho } from "./records";
import { recordRun } from "./work-jev";
import { certaintyOf, readSearchAnswers, searchRequest, SEARCH_THRESHOLDS, type SearchShape } from "./search-ranking";
import { deepCandidates } from "./search-deep";
import type { SearchPick } from "./search-records";
import type { Block, GotoSearchCollection, GotoSearchMatch, VisibleBlockCollection } from "./types";

export const EVAL_EXPERIMENT = "search-eval";
const EVAL: RecordWho = { author: "agent", provenance: { actorId: "jev/search-eval" } };

export interface EvalCase {
  query: string;
  outline: string;
  /** The notes that should come first, or none when nothing in the outline answers it. */
  expect: string[] | "none";
  /**
   * Who said what should come first: an agent's open after the search (`agent-read`), the note it made when the search
   * had none (`agent-made`), Evan's pick (`evan-pick`), or none: the query asked of the outline it wasn't about
   * (`other-outline`, made by the run, never kept). `paraphrase`: a note's subject asked in none of its words, written by
   * hand to measure finding by meaning (PIE-1200), since a search's next open is a word search's answer.
   */
  source: "agent-read" | "agent-made" | "evan-pick" | "other-outline" | "paraphrase";
  surface?: string;
  rank?: number;
  asked?: string;
}

// ── Harvest ────────────────────────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** A read this many tool calls after a search still counts as what the search was for. */
const FOLLOW = 8;
const OPENS = /(?:outline_read|outline_edit|outline_patch|outline_comment|door_open|__show|outline_set_property|outline_move)$/;
const MAKES = /outline_create$/;
/** Opened after searches in this many sessions, a note is read whatever was searched. */
export const AMBIENT_SESSIONS = 4;

/**
 * A search an agent made, what it found, the rows it opened next (`opened`), and the note it made instead when it
 * opened none (`made`: the search found nothing it wanted, and this note is the answer now). Before the outline is known.
 */
export interface SessionSearch { query: string; outlineHint?: string; found: string[]; opened: string[]; made?: string; at?: string; cwd?: string; session?: string }

type Use = { id: string; name: string; input: Record<string, unknown>; at?: string; cwd?: string };

/** What an outline_find asked, when it was a search by words alone (a property, a query or a view isn't one). */
function queryOf(use: Use): { query: string; outlineHint?: string } | null {
  if (!/outline_find$/.test(use.name)) return null;
  const i = use.input;
  if (["property", "hasKey", "view", "under"].some(k => typeof i[k] === "string" && (i[k] as string).trim())) return null;
  // The gateway's `query` is words; the mod's is the views' grammar.
  const gateway = use.name.includes("claude_ai_ep0ch");
  const words = typeof i.text === "string" ? i.text : gateway && typeof i.query === "string" ? i.query : undefined;
  if (!gateway && typeof i.query === "string" && i.query.trim()) return null;
  if (!words || words.trim().length < 3 || words.length > 200) return null;
  const hint = typeof i.outline === "string" ? i.outline.split("@")[0] : undefined;
  return { query: words.trim(), ...(hint ? { outlineHint: hint } : {}) };
}

/** The searches in one session log (Claude Code's JSONL), each with what it found and the note opened after it. */
export function sessionSearches(text: string, session?: string): SessionSearch[] {
  const uses: Use[] = [], results = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.includes("tool_")) continue;
    let row: { message?: { content?: unknown }; timestamp?: string; cwd?: string };
    try { row = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(row.message?.content) ? row.message!.content as Record<string, unknown>[] : [];
    for (const c of content) {
      if (c.type === "tool_use" && typeof c.id === "string" && typeof c.name === "string") uses.push({ id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown>, at: row.timestamp, cwd: row.cwd });
      if (c.type === "tool_result" && typeof c.tool_use_id === "string") results.set(c.tool_use_id, typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? ""));
    }
  }
  const searches: (SessionSearch & { index: number })[] = [];
  uses.forEach((use, index) => {
    const q = queryOf(use);
    if (!q) return;
    const found = [...new Set((results.get(use.id) ?? "").match(UUID) ?? [])];
    searches.push({ ...q, found, opened: [], at: use.at, cwd: use.cwd, ...(session ? { session } : {}), index });
  });
  // Each open goes to the latest search before it, within FOLLOW calls, whose rows held it.
  uses.forEach((use, index) => {
    const opens = OPENS.test(use.name), makes = MAKES.test(use.name);
    if (!opens && !makes) return;
    const named = JSON.stringify(use.input).match(UUID) ?? [];
    const before = searches.filter(s => s.index < index && index - s.index <= FOLLOW);
    for (const id of named) {
      const owner = [...before].reverse().find(s => s.found.includes(id));
      if (owner) { if (!owner.opened.includes(id)) owner.opened.push(id); return; }
    }
    // A note made under none of the rows: the searches before it that opened nothing were looking for it.
    const made = makes ? (results.get(use.id) ?? "").match(UUID)?.[0] : undefined;
    if (made) for (const s of before) if (!s.opened.length && !s.made) s.made = made;
  });
  return searches.map(({ index: _index, ...s }) => s);
}

/**
 * The cases a set of session searches gives, once each labelling note is placed: `outlineOf` says which outline holds
 * an id (only the ones the eval may read: pie and gurgle, never a client's; a search whose note is elsewhere is left
 * out). Deduped by query and outline; one already kept (`have`) isn't made again.
 */
export function casesFrom(searches: readonly SessionSearch[], outlineOf: (id: string) => string | undefined, have: ReadonlySet<string> = new Set()): EvalCase[] {
  const out = new Map<string, EvalCase>();
  // A note opened after searches in many sessions is read for orientation (the workboard's contract, Reorient here),
  // whatever was searched: it labels none of them.
  const sessionsOpening = new Map<string, Set<string>>();
  for (const s of searches) for (const id of s.opened) if (s.session) (sessionsOpening.get(id) ?? sessionsOpening.set(id, new Set()).get(id)!).add(s.session);
  for (const s of searches) {
    const opened = s.opened.filter(id => (sessionsOpening.get(id)?.size ?? 0) < AMBIENT_SESSIONS);
    const expect = opened.length ? opened : s.opened.length ? [] : s.made ? [s.made] : [];
    if (!expect.length) continue;
    const outline = outlineOf(expect[0]!);
    if (!outline || (s.outlineHint && s.outlineHint !== outline)) continue;
    const key = caseKey(s.query, outline);
    if (have.has(key) || out.has(key)) continue;
    out.set(key, { query: s.query, outline, expect: expect.filter(id => outlineOf(id) === outline), source: opened.length ? "agent-read" : "agent-made", ...(s.at ? { asked: s.at.slice(0, 10) } : {}) });
  }
  return [...out.values()];
}

/** The cases Evan's picks give: the row he opened is what the words were for. */
export function casesFromPicks(picks: readonly SearchPick[], outline: string, have: ReadonlySet<string> = new Set()): EvalCase[] {
  const out = new Map<string, EvalCase>();
  for (const p of [...picks].reverse()) {
    const key = caseKey(p.query, outline);
    if (have.has(key) || out.has(key) || p.query.trim().length < 3) continue;
    out.set(key, { query: p.query, outline, expect: [p.blockId], source: "evan-pick", surface: p.surface, rank: p.rank, asked: p.at.slice(0, 10) });
  }
  return [...out.values()];
}

export const caseKey = (query: string, outline: string) => `${outline}\u0000${query.trim().toLowerCase().replace(/\s+/g, " ")}`;

// ── Run ────────────────────────────────────────────────────────────────────

export interface CaseResult {
  case: EvalCase;
  /** The candidates, in the outline search's order (the lexical baseline). */
  lexical: string[];
  /** Jev's order, its top Score and its Noul; absent when Jev wasn't asked (an exact match, or no candidates). */
  ranked?: string[]; top?: number; exists?: number;
  /** Jev couldn't be asked for this one. */
  unavailable?: string;
  cached?: boolean;
  usage?: { input: number; output: number };
}

export interface ModelRun { model: string; /** What else the run varied: the request's shape, the deep pass. */ variant?: string; results: CaseResult[]; promptRev: string; prompt: PromptRevision[] }

export interface EvalClient { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> }

/** One case's candidates, as tree.search gives them to the ranking (all of them, not the 30 shown). */
export async function candidatesOf(client: EvalClient, query: string): Promise<GotoSearchCollection> {
  return client.request<GotoSearchCollection>({ action: "tree.search", query, limit: 80 });
}

/** Every case asked of one model: the request search sends, cached under `cacheDir` by the request itself. */
export async function runModel(model: string, cases: readonly { case: EvalCase; candidates: GotoSearchCollection }[], o: JevOptions & { cacheDir: string; promptDirectory?: string; atOnce?: number; shape?: SearchShape; variant?: string }): Promise<ModelRun> {
  const prompt = await loadGotoPrompt(o.promptDirectory);
  mkdirSync(o.cacheDir, { recursive: true });
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: o.atOnce ?? 4 }, async () => {
    for (let i = next++; i < cases.length; i = next++) {
      const { case: c, candidates } = cases[i]!;
      const matches = candidates.matches;
      const lexical = matches.map(m => m.block.id);
      if (!matches.length || matches[0]!.exact) { results[i] = { case: c, lexical }; continue; }
      const request = searchRequest(c.query, matches, prompt, undefined, o.shape);
      const file = join(o.cacheDir, `${createHash("sha256").update(JSON.stringify({ model, ...request })).digest("hex")}.json`);
      let answers: Record<string, unknown> | undefined, usage: CaseResult["usage"], cached = false;
      if (existsSync(file)) { ({ answers, usage } = JSON.parse(readFileSync(file, "utf8"))); cached = true; }
      else {
        const asked = await askJev(request.state, request.questions, prompt.revisions, { timeoutMs: 30_000, ...o, model });
        if ("unavailable" in asked) { results[i] = { case: c, lexical, unavailable: asked.unavailable }; continue; }
        answers = asked.answers; usage = asked.reading.usage;
        writeFileSync(file, JSON.stringify({ model: asked.reading.model, answers, usage }));
      }
      try {
        const read = readSearchAnswers(matches.length, answers as never);
        const order = matches.map((m, k) => ({ id: m.block.id, score: read.scores[k]!, k })).sort((a, b) => b.score - a.score || a.k - b.k);
        results[i] = { case: c, lexical, ranked: order.map(x => x.id), top: order[0]!.score, ...(read.exists !== undefined ? { exists: read.exists } : {}), cached, ...(usage ? { usage } : {}) };
      } catch (e) { results[i] = { case: c, lexical, unavailable: (e as Error).message }; }
    }
  }));
  return { model, ...(o.variant ? { variant: o.variant } : {}), results, promptRev: promptRevOf({ prompt: prompt.revisions }), prompt: prompt.revisions };
}

/** A fetch that answers a request it has seen from `cacheDir` (by its body), and keeps each new answer there. */
export function cachingFetch(cacheDir: string, real: (url: string, init: RequestInit) => Promise<Response> = fetch): (url: string, init: RequestInit) => Promise<Response> {
  mkdirSync(cacheDir, { recursive: true });
  return async (url, init) => {
    const file = join(cacheDir, `${createHash("sha256").update(String(init.body)).digest("hex")}.json`);
    if (existsSync(file)) return new Response(readFileSync(file, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
    const response = await real(url, init);
    if (!response.ok) return response;
    const text = await response.text();
    writeFileSync(file, text);
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  };
}

/**
 * Each case's candidates with deep search's finds added (PIE-1200), as tree.search's deep pass adds them: the pool is
 * the outline's own notes (`pools`, one per outline). The deep pass runs on every case here, sure or not, so its effect
 * on the cases the text never reached can be read; `deep` says what it added and what it cost.
 */
export async function withDeep(cases: readonly { case: EvalCase; candidates: GotoSearchCollection }[], pools: Record<string, { blocks: () => Block[]; matches: (ids: string[], query: string) => GotoSearchMatch[] }>, o: JevOptions & { promptDirectory?: string }): Promise<{ case: EvalCase; candidates: GotoSearchCollection; deep?: { added: number; tokens: number; ms: number; unavailable?: string } }[]> {
  const out = [];
  for (const c of cases) {
    const pool = pools[c.case.outline];
    if (!pool || c.candidates.matches[0]?.exact) { out.push(c); continue; }
    const found = await deepCandidates(pool.blocks(), c.case.query, { jev: { timeoutMs: 120_000, ...o } });
    if ("unavailable" in found) { out.push({ ...c, deep: { added: 0, tokens: 0, ms: 0, unavailable: found.unavailable } }); continue; }
    const have = new Set(c.candidates.matches.map(m => m.block.id));
    const added = pool.matches(found.candidates.map(x => x.id).filter(id => !have.has(id)), c.case.query);
    // Jev's finds first, as the deep pass puts them: the Noul reads the first candidates.
    out.push({ ...c, candidates: { ...c.candidates, matches: [...added, ...c.candidates.matches] }, deep: { added: added.length, tokens: found.reading?.usage?.input ?? 0, ms: found.elapsedMs } });
  }
  return out;
}

const hitAt = (order: readonly string[] | undefined, expect: readonly string[], n: number) => !!order && order.slice(0, n).some(id => expect.includes(id));
const pct = (a: number, b: number) => b ? Math.round(a / b * 100) : 0;
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 : null;

export interface ModelScore {
  model: string;
  cases: number; positives: number; reachable: number; negatives: number; asked: number; unavailable: number;
  hit1: number; hit5: number; lexHit1: number; lexHit5: number;
  /** The Noul on cases whose answer is among the candidates, and on those where it isn't (none, or not reached). */
  existsAnswered: number | null; existsNot: number | null;
  /**
   * At SEARCH_THRESHOLDS: said sure over the right top (`sureRight`), over another note when one was wanted
   * (`sureWrong`), and when nothing was there (`sureNothing`, the confident wrong answer this is for); said "no strong
   * match" over a wrong top or nothing (`quietRight`) and over the right one (`quietWrong`).
   */
  sureRight: number; sureWrong: number; sureNothing: number; quietRight: number; quietWrong: number;
  /** Tokens this run asked for (a cached answer costs none); `setIn`/`setOut` the whole set's, cached or not: what ranking it costs. */
  tokensIn: number; tokensOut: number; setIn: number; setOut: number;
}

/** A model's numbers on the set, with the thresholds' verdict on each case read against its label. */
export function scoreRun(run: ModelRun, t = SEARCH_THRESHOLDS): ModelScore {
  const r = run.results.filter(x => !x.unavailable);
  const pos = r.filter(x => x.case.expect !== "none"), neg = r.filter(x => x.case.expect === "none");
  const expectOf = (x: CaseResult) => x.case.expect === "none" ? [] : x.case.expect;
  const reach = pos.filter(x => x.lexical.some(id => expectOf(x).includes(id)));
  const order = (x: CaseResult) => x.ranked ?? x.lexical;
  let sureRight = 0, sureWrong = 0, sureNothing = 0, quietRight = 0, quietWrong = 0;
  for (const x of r) {
    if (!x.ranked) continue;
    const right = hitAt(x.ranked, expectOf(x), 1);
    const verdict = certaintyOf({ title: "", score: x.top! }, x.exists, t).verdict;
    if (verdict === "strong") x.case.expect === "none" ? sureNothing++ : right ? sureRight++ : sureWrong++;
    else right ? quietWrong++ : quietRight++;
  }
  const answered = r.filter(x => x.ranked && x.exists !== undefined && reach.includes(x)).map(x => x.exists!);
  const not = r.filter(x => x.ranked && x.exists !== undefined && !reach.includes(x)).map(x => x.exists!);
  return {
    model: run.variant ? `${run.model} · ${run.variant}` : run.model, cases: run.results.length, positives: pos.length, reachable: reach.length, negatives: neg.length,
    asked: r.filter(x => x.ranked).length, unavailable: run.results.length - r.length,
    hit1: pos.filter(x => hitAt(order(x), expectOf(x), 1)).length, hit5: pos.filter(x => hitAt(order(x), expectOf(x), 5)).length,
    lexHit1: pos.filter(x => hitAt(x.lexical, expectOf(x), 1)).length, lexHit5: pos.filter(x => hitAt(x.lexical, expectOf(x), 5)).length,
    existsAnswered: avg(answered), existsNot: avg(not),
    sureRight, sureWrong, sureNothing, quietRight, quietWrong,
    tokensIn: r.reduce((a, x) => a + (x.cached ? 0 : x.usage?.input ?? 0), 0), tokensOut: r.reduce((a, x) => a + (x.cached ? 0 : x.usage?.output ?? 0), 0),
    setIn: r.reduce((a, x) => a + (x.usage?.input ?? 0), 0), setOut: r.reduce((a, x) => a + (x.usage?.output ?? 0), 0),
  };
}

/** Thresholds tried over the cached answers (no request): how often each would be sure and right, sure and wrong. */
export function sweep(run: ModelRun): { exists: number; strong: number; sureRight: number; sureWrong: number; sureNothing: number; quietWrong: number }[] {
  const rows = [];
  for (const exists of [0.5, 0.6, 0.7, 0.8, 0.9]) for (const strong of [1.5, 2, 2.5]) {
    const s = scoreRun(run, { ...SEARCH_THRESHOLDS, exists: { ...SEARCH_THRESHOLDS.exists, yes: exists }, strong });
    rows.push({ exists, strong, sureRight: s.sureRight, sureWrong: s.sureWrong, sureNothing: s.sureNothing, quietWrong: s.quietWrong });
  }
  return rows;
}

/** The run as a note: both models side by side, the sweep for the current one, and the live figure of every run. */
export function reportNote(scores: readonly ModelScore[], sweeps: Record<string, ReturnType<typeof sweep>>, meta: { day: string; outlines: string[]; promptRev: string; current: string }): string {
  const row = (label: string, f: (s: ModelScore) => string) => `| ${label} | ${scores.map(f).join(" | ")} |`;
  const s0 = scores[0]!, pinned = scores.find(s => s.model === meta.current) ?? s0, next = scores.find(s => s !== pinned);
  // The finding first: does Jev's order beat the text's, and does the next model beat the pinned one (the pin's question).
  const better = next && (next.hit1 > pinned.hit1 || (next.hit1 === pinned.hit1 && next.sureNothing < pinned.sureNothing));
  const lines = [
    `Search eval ${meta.day}: ${next ? (better ? `${next.model} beats ${pinned.model}` : `${pinned.model} stays pinned`) : pinned.model}, hit@1 ${pct(pinned.hit1, pinned.positives)}% [type::snapshot] [experiment::${EVAL_EXPERIMENT}] [run::${meta.day}]`,
    "",
    `> [!summary] ${next ? `${next.model} hit@1 ${next.hit1}/${next.positives}, sure with nothing there ${next.sureNothing}; ${pinned.model} ${pinned.hit1}/${pinned.positives} and ${pinned.sureNothing}: ${better ? "the next model does better" : "no reason to move the pin"}.` : ""}`,
    `> Jev's order against the text order on hit@1: ${pinned.hit1} against ${pinned.lexHit1} of ${pinned.positives}.`,
    `> ${s0.cases} real queries from ${meta.outlines.join(" and ")}, ranked by each model with the same prompt (${meta.promptRev}).`,
    "",
    "> [!note] How to read it",
    "> - **Labels are what was opened next:** an agent's read after its search, or Evan's pick. A right answer it didn't open counts as a miss, so hit@1 undercounts.",
    "> - **\"Nothing there\" is a query asked of the other outline:** pie and gurgle share some topics, so a few of those have an answer after all.",
    "",
    "## Both models",
    `| | ${scores.map(s => s.model + (s.model === meta.current ? " (pinned)" : "")).join(" | ")} |`,
    `|---|${scores.map(() => "---").join("|")}|`,
    row("hit@1", s => `${s.hit1}/${s.positives} (${pct(s.hit1, s.positives)}%)`),
    row("hit@5", s => `${s.hit5}/${s.positives} (${pct(s.hit5, s.positives)}%)`),
    row("text order hit@1 · hit@5", s => `${s.lexHit1} · ${s.lexHit5}`),
    row("answer among candidates", s => `${s.reachable}/${s.positives}`),
    row("Noul when it's there · when it isn't", s => `${s.existsAnswered ?? "—"} · ${s.existsNot ?? "—"}`),
    row("sure: right · another note · nothing there", s => `${s.sureRight} · ${s.sureWrong} · ${s.sureNothing}`),
    row("\"no strong match\" right · wrong", s => `${s.quietRight} · ${s.quietWrong}`),
    row("tokens in: the set · new this run", s => `${s.setIn} · ${s.tokensIn}`),
    "",
    `## Thresholds tried on ${meta.current}`,
    "Over the cached answers: when search would say it's sure, and when it would say \"no strong match\" over a right top.",
    "| Noul yes | top Score | sure, right | sure, another note | sure, nothing there | \"no strong match\", top right |",
    "|---|---|---|---|---|---|",
    ...(sweeps[meta.current] ?? []).map(r => `| ${r.exists} | ${r.strong} | ${r.sureRight} | ${r.sureWrong} | ${r.sureNothing} | ${r.quietWrong} |`),
    "",
    `In use: Noul yes ${SEARCH_THRESHOLDS.exists.yes}, no ${SEARCH_THRESHOLDS.exists.no}, top Score ${SEARCH_THRESHOLDS.strong} (search-ranking.ts \`SEARCH_THRESHOLDS\`).`,
  ];
  return lines.join("\n");
}

/** The live table's headers: a page that has them is current. */
const EVALS_FIGURE = "headers: [model, cases, hit@1, hit@5, sure, wrong, cost $]";
/** The page every run lands under, made once: what the eval is and every run's numbers, live. */
export const EVALS_PAGE = [
  "Search evals [page::search-evals] [system-view::search-evals]",
  "",
  "> [!summary] Ranked search measured on real queries before its thresholds or its Jev model change.",
  "> - **Cases:** agents' searches and the note opened next; Evan's picks once they're kept.",
  "> - **Run it:** `ep0ch search harvest`, then `ep0ch search eval --into pie`.",
  "> - **hit@1, hit@5:** of the cases with an answer, how often it came first, and in the first five.",
  "> - **sure, wrong:** of every search asked (the ones with nothing there too), how often it said sure, and how often that sure was wrong: the answer the thresholds are set against. **cost $** is what the run spent (a cached answer costs nothing).",
  "",
  "::graph-table",
  "---",
  "title: every run, newest first",
  "query: type=jev-run experiment=search-eval",
  "machinery: show",
  "columns: [model, items, agreed, hit5, quiet, different, cost]",
  EVALS_FIGURE,
  "sort: created",
  "direction: desc",
  "---",
  "::",
  "",
  "## Cases by source",
  "::graph-stat",
  "---",
  "title: the labelled set",
  'items: [{ label: agents read, query: "type=search-eval-case source=agent-read", machinery: show }, { label: Evan picked, query: "type=search-eval-case source=evan-pick", machinery: show, accent: true }, { label: the note made after, query: "type=search-eval-case source=agent-made", machinery: show }, { label: in none of its words, query: "type=search-eval-case source=paraphrase", machinery: show }]',
  "---",
  "::",
].join("\n");

const read = async (client: EvalClient, where: string, limit = 1) => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit } })).blocks;

/** The cases kept in `into`, as the eval reads them, each with its record. */
export async function keptCases(client: EvalClient): Promise<(EvalCase & { record: { id: string; revision: number; text: string } })[]> {
  const blocks = await read(client, "type=search-eval-case", 1000);
  const prop = (b: { properties?: { key: string; value: string }[] }, k: string) => b.properties?.find(p => p.key === k)?.value;
  // The query is written in the record's body (it can hold brackets and colons a chip can't).
  return blocks.flatMap(b => {
    const query = /^Query: (.*)$/m.exec(b.text)?.[1]?.trim() ?? prop(b, "query");
    const outline = prop(b, "outline"), expect = prop(b, "expect"), source = prop(b, "source") as EvalCase["source"] | undefined;
    if (!query || !outline || !expect || !source) return [];
    return [{ query, outline, expect: expect === "none" ? "none" as const : expect.split(/[ ,]+/).filter(Boolean), source, record: { id: b.id, revision: b.revision, text: b.text } }];
  });
}

/** A case kept as a record in `into`. */
export async function keepCase(client: EvalClient, c: EvalCase): Promise<void> {
  const board = { request: (action: string, params?: Record<string, unknown>) => client.request({ action, ...params } as never) };
  const { id } = await writeRecord(board as never, "search-eval-case", {
    query: "(in the body)", outline: c.outline, expect: c.expect === "none" ? "none" : c.expect.join(" "), source: c.source,
    surface: c.surface ?? "unknown", rank: String(c.rank ?? "unknown"), asked: c.asked ?? "unknown", note: c.expect === "none" ? "none" : `((${c.expect[0]}))`,
  }, EVAL, { title: `search case: ${c.query.slice(0, 60)}` });
  const block = await client.request<{ id: string; text: string; revision: number }>({ action: "get", blockId: id });
  await client.request({ action: "update", blockId: id, text: `${block.text}\nQuery: ${c.query.replace(/\n/g, " ")}`, expectedRevision: block.revision, mutation: { author: "agent", actorId: EVAL.provenance!.actorId! } });
}

/** A kept case brought up to a later harvest's label (its record rewritten in place, as the day's run is). */
export async function refreshCase(client: EvalClient, kept: { record: { id: string; revision: number; text: string } }, c: EvalCase): Promise<boolean> {
  let text = kept.record.text;
  const expect = c.expect === "none" ? "none" : c.expect.join(" ");
  text = setChip(setChip(setChip(text, "expect", expect), "source", c.source), "note", c.expect === "none" ? "none" : `((${c.expect[0]}))`);
  if (text === kept.record.text) return false;
  await client.request({ action: "update", blockId: kept.record.id, text, expectedRevision: kept.record.revision, mutation: { author: "agent", actorId: EVAL.provenance!.actorId! } });
  return true;
}

/**
 * Cases whose answer is "nothing here": each labelled query asked of the other outline, which doesn't hold its note
 * (pie is the machine room, gurgle the coffee shop). Made by the run and never kept: they follow the labels.
 */
export function otherOutlineCases(cases: readonly EvalCase[], outlines: readonly string[]): EvalCase[] {
  return cases.flatMap(c => c.expect === "none" ? [] : outlines.filter(o => o !== c.outline).map(o => ({ query: c.query, outline: o, expect: "none" as const, source: "other-outline" as const })));
}

/** The run kept in `into`: the page (once), a `jev-run` per model, and the report under the page. */
export async function keepRun(client: EvalClient, scores: readonly ModelScore[], runs: readonly ModelRun[], note: string, day: string): Promise<string> {
  let page = (await read(client, "system-view=search-evals"))[0];
  if (!page) { await client.request({ action: "create", text: EVALS_PAGE, parentId: null, ...EVAL }); page = (await read(client, "system-view=search-evals"))[0]; }
  // A page made before its figure read in plain words is brought up to it; one already current is left as it is.
  else if (!page.text.includes(EVALS_FIGURE)) await client.request({ action: "update", blockId: page.id, text: EVALS_PAGE, expectedRevision: page.revision, mutation: { author: "agent", actorId: EVAL.provenance!.actorId! } });
  for (const [i, s] of scores.entries()) {
    // Scores come in the runs' order; a variant's score is named "<model> · <variant>".
    const run = runs[i]!;
    await recordRun(client, EVAL_EXPERIMENT, day, {
      // The run-level keys in the meaning search's own runs give them (search-records.ts): quiet the searches said sure,
      // suggested the ones that named the closest and didn't claim it; over every search asked, the ones with nothing
      // there too. items the cases with an answer, agreed Jev's top was the label (hit@1), hit5 it was in the first
      // five, different it said sure and was wrong (another note, or nothing there; PIE-1409).
      items: s.positives, agreed: s.hit1, agreement: s.positives ? Math.round(s.hit1 / s.positives * 100) / 100 : 0, hit5: s.hit5,
      suggested: s.quietRight + s.quietWrong, quiet: s.sureRight + s.sureWrong + s.sureNothing, different: s.sureWrong + s.sureNothing, unavailable: s.unavailable,
    }, { model: s.model, prompt: run.prompt, questions: s.asked, usage: { input: s.tokensIn, output: s.tokensOut } });
  }
  const made = await client.request<{ id: string }>({ action: "create", text: note, parentId: page!.id, ...EVAL });
  return made.id;
}

/**
 * An outline's copy opened for the eval (`ep0ch outline snapshot … --out`, never a live outline): its own service in
 * this process, so the candidates are this checkout's search, and its notes for the deep pass.
 */
export async function openSnapshot(path: string): Promise<{ client: EvalClient; blocks: () => Block[]; matches: (ids: string[], query: string) => GotoSearchMatch[]; close: () => Promise<void> }> {
  const { OutlinerStore } = await import("./store");
  const { OutlinerServer } = await import("./server");
  const { OutlinerClient } = await import("./client");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "search-eval-"));
  const store = new OutlinerStore(path, { workspaceRoot: dir });
  const socket = join(dir, "host.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  const client = new OutlinerClient(socket);
  return {
    client: { request: <T>(input: { action: string } & Record<string, unknown>) => client.request<T>(input as never) },
    blocks: () => store.searchPool(), matches: (ids, query) => store.searchMatches(ids, query),
    close: async () => { await server.close(); store.close(); },
  };
}
