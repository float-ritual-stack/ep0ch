// PIE-1810: a search answers the first time, however slow Jev is. An agent's find (the mod's outline_find: the CLI's
// `agent find`) asked for the ranked search with its deep pass on a keypress's 3 s wait, while the service's own stages
// (rank, deep pass, rank again) could take 24 s between them: a slow first answer failed the call with "Outliner request
// timed out after 3000ms". Made-up notes, a scratch service, and a fake Jev that is slow or never answers.
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SEARCH_BUDGET_MS, SEARCH_WAIT_MS } from "@ep0ch/outline-core/search-wait";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchDir, scratchOutline } from "./scratch-outline";
import type { GotoSearchCollection } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

type Asked = "rank" | "deep";
/**
 * Jev as a search asks it, each request answered after `wait(kind, nth)` ms (never, when it says so): the ranking scores
 * a candidate holding `best` 2.8 and isn't sure (so the deep pass runs), and the deep pass finds the note holding `deep`.
 */
function fakeJev(o: { best: string; deep: string; wait: (kind: Asked, nth: number) => number | "never" }) {
  const asked: Asked[] = [];
  const hung: Array<() => void> = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1", idleTimeout: 0,
    async fetch(request) {
      const body = await request.json() as { model: string; questions: Record<string, { instructions: string; criteria: Record<string, string> }> };
      const kind: Asked = body.questions.which ? "deep" : "rank";
      asked.push(kind);
      const wait = o.wait(kind, asked.filter(k => k === kind).length);
      if (wait === "never") await new Promise<void>(resolve => hung.push(resolve));
      else if (wait) await Bun.sleep(wait);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, id === "exists" ? { type: "noul", noul: 0.5 }
        : id === "which" ? { type: "choice", probabilities: Object.fromEntries(Object.entries(q.criteria).map(([n, d]) => [n, d.includes(o.deep) ? 0.9 : 0.0004])) }
        : { type: "score", score: q.instructions.includes(o.best) ? 2.8 : 0.4 }]));
      return Response.json({ model: body.model, answers, usage: { input_tokens: 500, output_tokens: 3 } });
    },
  });
  return { asked, endpoint: `http://127.0.0.1:${fake.port}/v1/systemone`, stop: () => { for (const free of hung) free(); return fake.stop(true); } };
}

async function setup(wait: (kind: Asked, nth: number) => number | "never", budgetMs?: number) {
  const jev = fakeJev({ best: "Compost turning", deep: "Heap rota", wait });
  const keys = ["OUTLINER_FIGURE_FIT", "TYPESAFE_API_KEY", "OUTLINER_JEV_ENDPOINT", "OUTLINER_SEARCH_TALLY_MS", "OUTLINER_SEARCH_BUDGET_MS"] as const;
  const was = keys.map(key => [key, process.env[key]] as const);
  // The service is in this process: its Jev is the fake, for this test only.
  Object.assign(process.env, { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: jev.endpoint, OUTLINER_SEARCH_TALLY_MS: "600000" });
  if (budgetMs !== undefined) process.env.OUTLINER_SEARCH_BUDGET_MS = String(budgetMs);
  const root = scratchDir("outliner-search-budget-");
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => {
    await jev.stop(); await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
    for (const [key, value] of was) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  store.create("Compost turning schedule\nTurn the heap every two weeks in summer.");
  store.create("Compost bin repairs\nThe lid hinge on the compost bin.");
  // No word of the search is in this one: only the deep pass finds it.
  store.create("Heap rota\nWho forks it over each fortnight.");
  /** `agent find` as the mod runs it: the installed CLI, its input on stdin, the wait a client has when nobody names one. */
  const find = async (text: string) => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", "find", "--stdin"], {
      cwd: join(import.meta.dir, ".."), stdin: new Blob([JSON.stringify({ text })]), stdout: "pipe", stderr: "pipe",
      // The outlines folder and the outline's name, no socket: this machine's own host, as the laptop's is to its Claude
      // (EP0CH_SOCKET would make it another machine's, whose clients wait 30 s).
      env: { PATH: process.env.PATH!, HOME: root, ...env, OUTLINER_FIGURE_FIT: "off", OUTLINER_WRITE_VIEW: "off" },
    });
    const started = performance.now();
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stderr, ms: performance.now() - started, json: exitCode === 0 ? JSON.parse(stdout) as { blocks: { title: string; score?: number; byMeaning?: boolean }[]; search: { status: string; said: string; verdict?: string; deep?: { status: string; message?: string; found?: number } } } : undefined };
  };
  return { client: new OutlinerClient(paths.socket), find, asked: jev.asked };
}

const QUERY = "when to turn the compost";
const titles = (r: GotoSearchCollection) => r.matches.map(m => m.title);

test("an agent's find answers when the search takes longer than a keypress waits", async () => {
  // A first search after a quiet spell: Jev's three answers take 3.4 s between them, the deep pass most of it (each
  // ranking well inside its own 2.2 s, so a busy box doesn't turn this into the skipped ranking of the next test).
  const { find, asked } = await setup(kind => kind === "deep" ? 2800 : 300);
  const found = await find(QUERY);
  expect(found.stderr).not.toContain("timed out");
  expect(found.exitCode).toBe(0);
  expect(asked).toEqual(["rank", "deep", "rank"]);
  expect(found.ms).toBeGreaterThan(3000);
  expect(found.json!.search).toMatchObject({ status: "ranked", deep: { status: "found", found: 1 } });
  expect(found.json!.blocks[0]).toMatchObject({ title: "Compost turning schedule", score: 2.8 });
  expect(found.json!.blocks.find(b => b.title === "Heap rota")).toMatchObject({ byMeaning: true, score: 0.4 });
}, 30_000);

test("a ranking Jev doesn't answer inside the search's budget is skipped: the text matches, said, never a failure", async () => {
  // The test's budget, far under the 20 s a search has: the answer comes at the budget, not at each stage's own wait.
  const { client, find, asked } = await setup(() => "never", 400);
  const started = performance.now();
  const r = await client.request<GotoSearchCollection>({ action: "tree.search", query: QUERY, semantic: true, deep: true }, SEARCH_WAIT_MS);
  expect(performance.now() - started).toBeLessThan(SEARCH_BUDGET_MS / 2);
  expect(titles(r)).toEqual(expect.arrayContaining(["Compost turning schedule", "Compost bin repairs"]));
  expect(titles(r)).not.toContain("Heap rota");
  expect(r.matches.every(m => m.score === undefined)).toBe(true);
  expect(r.semantic).toMatchObject({ status: "unavailable", message: "Jev didn't answer in time, so the ranking was skipped; showing text matches" });
  // The deep pass isn't asked of a Jev that just didn't answer: the search is over when its ranking is.
  expect(asked).toEqual(["rank"]);
  const found = await find(QUERY);
  expect(found.exitCode).toBe(0);
  expect(found.json!.search).toEqual({ status: "unavailable", said: "text matches only (Jev didn't answer in time, so the ranking was skipped; showing text matches)" });
  expect(found.json!.blocks.map(b => b.title)).toEqual(titles(r));
}, 30_000);

test("a deep pass past the budget leaves the ranked answer, saying it was skipped", async () => {
  const { client, asked } = await setup(kind => kind === "deep" ? "never" : 0, 1500);
  const started = performance.now();
  const r = await client.request<GotoSearchCollection>({ action: "tree.search", query: QUERY, semantic: true, deep: true }, SEARCH_WAIT_MS);
  expect(performance.now() - started).toBeLessThan(SEARCH_BUDGET_MS / 2);
  expect(asked).toEqual(["rank", "deep"]);
  expect(r.matches[0]).toMatchObject({ title: "Compost turning schedule", score: 2.8 });
  expect(r.matches.every(m => m.score !== undefined)).toBe(true);
  expect(titles(r)).not.toContain("Heap rota");
  expect(r.semantic).toMatchObject({ status: "ranked", verdict: "weak", deep: { status: "unavailable", message: "Jev didn't read every note in time, so the deep search was skipped" } });
});

test("finds the second ranking has no time to score are left out, and the first ranking stays", async () => {
  const { client, asked } = await setup((kind, nth) => kind === "rank" && nth === 2 ? "never" : 0, 1500);
  const r = await client.request<GotoSearchCollection>({ action: "tree.search", query: QUERY, semantic: true, deep: true }, SEARCH_WAIT_MS);
  expect(asked).toEqual(["rank", "deep", "rank"]);
  expect(r.matches[0]).toMatchObject({ title: "Compost turning schedule", score: 2.8 });
  expect(r.matches.every(m => m.score !== undefined)).toBe(true);
  expect(titles(r)).not.toContain("Heap rota");
  expect(r.semantic).toMatchObject({ status: "ranked", verdict: "weak", deep: { status: "unavailable", message: "Jev didn't score what the deep search found (1) in time, so it was left out" } });
});

test("a search's caller waits longer than the search may take", () => {
  expect(SEARCH_WAIT_MS).toBeGreaterThan(SEARCH_BUDGET_MS);
  // …and under the minute the mod gives the CLI (the mod's runOutlinerCli), with room to read the hits.
  expect(SEARCH_WAIT_MS).toBeLessThanOrEqual(30_000);
});
