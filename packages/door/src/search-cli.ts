// `ep0ch search harvest|eval` (PIE-1197): ranked search measured on real queries (the outliner's search-eval.ts).
// harvest reads Claude Code's session logs (read only) and the picks the outlines kept, and keeps what it finds as
// `search-eval-case` records in --into; eval runs the kept cases against each model and, with --into, keeps the run.
// Only pie's and gurgle's notes become cases: a search whose note is in another outline (a client's) is left out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { boardFor } from "./notes-cli";

type Client = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
/** The outliner's module, loaded by name: its sources are the outliner's to type-check (as review-cli loads the backfill). */
type Case = { query: string; outline: string; source: string; expect: string[] | "none" };
type Kept = Case & { record: { id: string; revision: number; text: string } };
type Search = { opened: string[]; made?: string; outlineHint?: string; cwd?: string };
type Run = { model: string; promptRev: string; results: { unavailable?: string }[] };
type Score = { asked: number; unavailable: number };
interface Eval {
  sessionSearches(text: string, session?: string): Search[];
  casesFrom(searches: Search[], outlineOf: (id: string) => string | undefined, have?: Set<string>): Case[];
  refreshCase(client: Client, kept: Kept, c: Case): Promise<boolean>;
  otherOutlineCases(cases: Case[], outlines: string[]): Case[];
  casesFromPicks(picks: unknown[], outline: string, have: Set<string>): Case[];
  caseKey(query: string, outline: string): string;
  keptCases(client: Client): Promise<Kept[]>;
  keepCase(client: Client, c: Case): Promise<void>;
  candidatesOf(client: Client, query: string): Promise<unknown>;
  runModel(model: string, cases: { case: Case; candidates: unknown }[], o: { cacheDir: string }): Promise<Run>;
  scoreRun(run: Run): Score;
  sweep(run: Run): unknown;
  reportNote(scores: Score[], sweeps: Record<string, unknown>, meta: { day: string; outlines: string[]; promptRev: string; current: string }): string;
  keepRun(client: Client, scores: Score[], runs: Run[], note: string, day: string): Promise<string>;
}
const EVAL = "@ep0ch/outliner/search-eval";

/** The outlines whose searches may become cases. */
export const EVAL_OUTLINES = ["pie", "gurgle"];

export const SEARCH_USAGE = `  ep0ch search harvest [--into pie] [--logs <dir>] [--dry-run] [--json] [--machine <ssh-name>]
                                   agents' searches in Claude Code's session logs (~/.claude/projects, read only) and the
                                   note each opened next, and Evan's picks from a search, kept as search-eval-case
                                   records in --into (pie by default); only pie's and gurgle's notes become cases.
  ep0ch search eval [--models jev-1.13.0,jev-1.14.0] [--into pie] [--json] [--machine <ssh-name>]
                                   the kept cases' candidates from each outline's own search, ranked by each model as
                                   search ranks them (cached by request): hit@1, hit@5, the Noul's spread, thresholds
                                   tried; --into keeps a jev-run per model and the report under pie's Search evals page.`;

const VALUED = ["--into", "--logs", "--models", "--machine", "--cache"];
const SOLO = ["--dry-run", "--json"];

function sessionFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const path = join(dir, name);
    let st; try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) { for (const f of readdirSync(path)) if (f.endsWith(".jsonl")) out.push(join(path, f)); }
    else if (name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

export async function searchCommand(args: string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  const verb = args[1];
  if (verb !== "harvest" && verb !== "eval") { io.err(SEARCH_USAGE); return 2; }
  const rest = args.slice(2), opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (SOLO.includes(a)) continue;
    if (!VALUED.includes(a) || rest[i + 1] === undefined) { io.err(`ep0ch search ${verb}: ${a} ${VALUED.includes(a) ? "needs a value" : "isn't a flag it takes"}\n${SEARCH_USAGE}`); return 2; }
    opts[a] = rest[++i]!;
  }
  const machine = opts["--machine"] ? ["--machine", opts["--machine"]] : [];
  const open = async (name: string) => boardFor(["--ws", name, ...machine]);
  const boards = new Map<string, Awaited<ReturnType<typeof boardFor>>>();
  const board = async (name: string) => { if (!boards.has(name)) boards.set(name, await open(name)); const b = boards.get(name)!; if ("error" in b) throw new Error(`${name}: ${b.error}`); return b; };
  const client = (b: Exclude<Awaited<ReturnType<typeof boardFor>>, { error: string }>): Client => ({ request: <T>(input: { action: string } & Record<string, unknown>) => { const { action, ...params } = input; return b.request<T>(action, params, 120_000); } });
  try {
    const e = await import(EVAL) as Eval;
    const into = client(await board(opts["--into"] ?? "pie"));
    if (verb === "harvest") {
      const searches = sessionFiles(opts["--logs"] ?? join(homedir(), ".claude", "projects")).flatMap(f => { try { return e.sessionSearches(readFileSync(f, "utf8"), f); } catch { return []; } });
      // Which outline holds each opened note: asked of pie and gurgle only.
      const ids = [...new Set(searches.flatMap(s => [...s.opened, ...(s.made ? [s.made] : [])]))];
      const home = new Map<string, string>();
      for (const name of EVAL_OUTLINES) {
        const b = await board(name);
        for (let i = 0; i < ids.length; i += 100) {
          const { records } = await b.records(ids.slice(i, i + 100).filter(id => !home.has(id)));
          for (const r of records) home.set(r.id, name);
        }
      }
      const kept = new Map((await e.keptCases(into)).map(c => [e.caseKey(c.query, c.outline), c]));
      const have = new Set(kept.keys());
      const harvested = e.casesFrom(searches, id => home.get(id));
      // A case kept before takes this harvest's label (more rows opened, a note made since).
      let refreshed = 0;
      for (const c of harvested) { const k = kept.get(e.caseKey(c.query, c.outline)); if (k && !rest.includes("--dry-run") && await e.refreshCase(into, k, c)) refreshed++; }
      const cases = harvested.filter(c => !have.has(e.caseKey(c.query, c.outline)));
      for (const name of EVAL_OUTLINES) {
        const { picks } = await (await board(name)).searchPicks().catch(() => ({ picks: [] }));
        cases.push(...e.casesFromPicks(picks, name, new Set([...have, ...cases.map(c => e.caseKey(c.query, c.outline))])));
      }
      if (!rest.includes("--dry-run")) for (const c of cases) await e.keepCase(into, c);
      const by = (k: string) => cases.filter(c => c.source === k).length;
      io.out(rest.includes("--json") ? JSON.stringify({ searches: searches.length, cases: cases.length, kept: rest.includes("--dry-run") ? 0 : cases.length }, null, 2)
        : `${searches.length} searches read; ${cases.length} new cases (${by("agent-read")} an agent opened, ${by("agent-made")} answered by the note made after, ${by("evan-pick")} Evan picked)${rest.includes("--dry-run") ? ", none kept (--dry-run)" : `, kept in ${opts["--into"] ?? "pie"}`}; ${have.size} were already kept, ${refreshed} relabelled`);
      return 0;
    }
    const models = (opts["--models"] ?? "jev-1.13.0,jev-1.14.0").split(",").map(m => m.trim()).filter(Boolean);
    const labelled = await e.keptCases(into);
    if (!labelled.length) { io.err("ep0ch search eval: no cases kept yet; run ep0ch search harvest first"); return 1; }
    const cases = [...labelled, ...e.otherOutlineCases(labelled, EVAL_OUTLINES)];
    const withCandidates = [];
    for (const c of cases) {
      if (!EVAL_OUTLINES.includes(c.outline)) continue;
      withCandidates.push({ case: c, candidates: await e.candidatesOf(client(await board(c.outline)), c.query) });
    }
    const cacheDir = opts["--cache"] ?? join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ep0ch", "search-eval");
    const runs = [];
    for (const model of models) runs.push(await e.runModel(model, withCandidates, { cacheDir }));
    const scores = runs.map(r => e.scoreRun(r));
    const sweeps = Object.fromEntries(runs.map(r => [r.model, e.sweep(r)]));
    const day = new Date().toISOString().slice(0, 10);
    const { JEV_MODEL } = await import("@ep0ch/outliner/jev") as { JEV_MODEL: string };
    const note = e.reportNote(scores, sweeps, { day, outlines: [...new Set(withCandidates.map(c => c.case.outline))], promptRev: runs[0]!.promptRev, current: JEV_MODEL });
    if (scores.every(s => s.asked === 0 && s.unavailable > 0)) { io.err(`ep0ch search eval: Jev couldn't be asked (${runs[0]!.results.find(r => r.unavailable)?.unavailable})`); return 1; }
    const kept = opts["--into"] ? await e.keepRun(into, scores, runs, note, day) : undefined;
    io.out(rest.includes("--json") ? JSON.stringify({ scores, sweeps, ...(kept ? { note: kept } : {}) }, null, 2) : `${note}${kept ? `\n\nkept: ((${kept}))` : ""}`);
    return 0;
  } catch (err) {
    io.err(`ep0ch search ${verb}: ${(err as Error).message}`);
    return 1;
  } finally {
    for (const b of boards.values()) if (!("error" in b)) b.close();
  }
}
