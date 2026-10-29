// PIE-1198 and PIE-1197: a ranked search says how sure it is, counts itself on the day's jev-run, keeps the person's
// picks, and the eval turns agents' searches into labelled cases. Made-up notes, a scratch service and a fake Jev.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { casesFrom, otherOutlineCases, runModel, scoreRun, sessionSearches } from "../src/search-eval";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";
import type { Block, GotoSearchCollection } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** Jev as search asks it: a Score per candidate by whether its text holds `best`, and the Noul as given. */
function fakeJev(o: { best: string; exists: number }) {
  const asked: { model: string; questions: Record<string, { type: string; instructions: string }> }[] = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as (typeof asked)[number];
      asked.push(body);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, id === "exists"
        ? { type: "noul", noul: o.exists }
        : { type: "score", score: q.instructions.includes(o.best) ? 2.8 : 0.4 }]));
      return Response.json({ model: body.model, answers, usage: { input_tokens: 500, output_tokens: 3 } });
    },
  });
  return { fake, asked, endpoint: `http://127.0.0.1:${fake.port}/v1/systemone` };
}

async function setup(jev: { best: string; exists: number }) {
  const { fake, asked, endpoint } = fakeJev(jev);
  const was = { on: process.env.OUTLINER_FIGURE_FIT, key: process.env.TYPESAFE_API_KEY, at: process.env.OUTLINER_JEV_ENDPOINT };
  // The service is in this process: its Jev is the fake for this test only.
  Object.assign(process.env, { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: endpoint });
  const root = mkdtempSync(join(tmpdir(), "outliner-search-sure-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  cleanups.push(async () => {
    fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
    for (const [k, v] of [["OUTLINER_FIGURE_FIT", was.on], ["TYPESAFE_API_KEY", was.key], ["OUTLINER_JEV_ENDPOINT", was.at]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  const records = async (type: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `type=${type}`, machinery: "show" } })).blocks
    .map(b => Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string>);
  return { store, client, asked, records, endpoint };
}

const until = async (check: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await check()) return true; await Bun.sleep(20); } return false; };

test("a search whose top answers it says so, scores each row, and counts itself on the day's run", async () => {
  const { store, client, asked, records } = await setup({ best: "Compost turning", exists: 0.93 });
  store.create("Compost turning schedule\nTurn the heap every two weeks in summer.");
  store.create("Compost bin repairs\nThe lid hinge on the compost bin.");
  const r = await client.request<GotoSearchCollection>({ action: "tree.search", query: "when to turn the compost", semantic: true });
  expect(r.matches[0]!.title).toBe("Compost turning schedule");
  expect(r.matches[0]!.score).toBe(2.8);
  expect(r.matches.slice(1).every(m => m.score === 0.4)).toBe(true);
  expect(r.semantic).toMatchObject({ status: "ranked", verdict: "strong", exists: 0.93, top: 2.8 });
  expect(r.semantic.said).toBe("strong match: “Compost turning schedule” (2.8 of 3, sure 0.9)");
  // One request: a Score per candidate and the Noul over them.
  expect(asked).toHaveLength(1);
  expect(Object.keys(asked[0]!.questions)).toEqual([...r.matches.map((_, i) => `candidate_${i}`), "exists"]);
  expect(await until(async () => (await records("jev-run")).some(run => run.experiment === "search-live" && run.items === "1"))).toBe(true);
  expect((await records("jev-run")).find(run => run.experiment === "search-live")).toMatchObject({ quiet: "1", suggested: "0", "tokens-in": "500", model: "jev-1.13.0" });
});

test("a search with nothing that answers it says no strong match instead of a confident #1", async () => {
  const { store, client, records } = await setup({ best: "Compost turning", exists: 0.1 });
  store.create("Compost turning schedule\nTurn the heap every two weeks in summer.");
  store.create("Compost bin repairs\nThe lid hinge on the compost bin.");
  const r = await client.request<GotoSearchCollection>({ action: "tree.search", query: "compost tea recipe for tomatoes", semantic: true });
  expect(r.semantic).toMatchObject({ status: "ranked", verdict: "none", said: "no strong match: nothing here looks like what was asked for" });
  expect(await until(async () => (await records("jev-run")).some(run => run.experiment === "search-live" && run.suggested === "1"))).toBe(true);
});

test("the person's pick from a search is kept with the words, and read back for the eval", async () => {
  const { store, client } = await setup({ best: "x", exists: 0.5 });
  const note = store.create("Seed swap list");
  await client.request({ action: "search.picked", query: "seed swap", blockId: note.id, rank: 0, surface: "power-bar" });
  const { picks } = await client.request<{ picks: { query: string; blockId: string; surface: string }[] }>({ action: "search.picks" });
  expect(picks).toMatchObject([{ query: "seed swap", blockId: note.id, rank: 0, surface: "power-bar" }]);
  await expect(client.request({ action: "search.picked", query: "seed swap", blockId: note.id, rank: -1, surface: "power-bar" })).rejects.toThrow(/rank/);
});

// ── The eval ───────────────────────────────────────────────────────────────

const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002", C = "cccccccc-0000-4000-8000-000000000003", MADE = "dddddddd-0000-4000-8000-000000000004";
const use = (id: string, name: string, input: unknown) => JSON.stringify({ type: "assistant", timestamp: "2026-10-20T10:00:00Z", cwd: "/home/x/ep0ch", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, text: string) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });

test("a session's searches are labelled by the rows opened next, each by the latest search that found it", () => {
  const log = [
    use("f1", "mcp__ep0ch__outline_find", { text: "seed swap" }), result("f1", JSON.stringify({ blocks: [{ id: A }, { id: C }] })),
    use("f2", "mcp__ep0ch__outline_find", { text: "bean trellis" }), result("f2", JSON.stringify({ blocks: [{ id: B }, { id: C }] })),
    use("r1", "mcp__ep0ch__outline_read", { ref: A }), use("r2", "mcp__ep0ch__outline_read", { ref: C }),
    use("f3", "mcp__ep0ch__outline_find", { text: "pond liner" }), result("f3", JSON.stringify({ blocks: [{ id: B }] })),
    use("c1", "mcp__ep0ch__outline_create", { parent: "root", text: "Pond liner" }), result("c1", JSON.stringify({ id: MADE })),
    // A property find isn't a search by words.
    use("f4", "mcp__ep0ch__outline_find", { property: "crop=bean" }),
  ].join("\n");
  const searches = sessionSearches(log, "s1");
  expect(searches.map(s => s.query)).toEqual(["seed swap", "bean trellis", "pond liner"]);
  // C was in both lists: the later search owns it.
  expect(searches.map(s => s.opened)).toEqual([[A], [C], []]);
  expect(searches[2]!.made).toBe(MADE);
  const home = new Map([[A, "pie"], [C, "pie"], [MADE, "pie"]]);
  const cases = casesFrom(searches, id => home.get(id));
  expect(cases).toMatchObject([
    { query: "seed swap", outline: "pie", expect: [A], source: "agent-read" },
    { query: "bean trellis", outline: "pie", expect: [C], source: "agent-read" },
    { query: "pond liner", outline: "pie", expect: [MADE], source: "agent-made" },
  ]);
  // A note that isn't in an outline the eval may read (a client's) makes no case.
  expect(casesFrom(searches, id => id === A ? "pie" : undefined).map(c => c.query)).toEqual(["seed swap"]);
  expect(otherOutlineCases(cases.slice(0, 1), ["pie", "gurgle"])).toEqual([{ query: "seed swap", outline: "gurgle", expect: "none", source: "other-outline" }]);
});

test("a note opened after searches in many sessions is orientation, not an answer", () => {
  const sessions = ["s1", "s2", "s3", "s4"].map((s, i) => sessionSearches([
    use(`f${i}`, "mcp__ep0ch__outline_find", { text: `query ${i}` }), result(`f${i}`, JSON.stringify({ blocks: [{ id: A }] })),
    use(`r${i}`, "mcp__ep0ch__outline_read", { ref: A }),
  ].join("\n"), s)).flat();
  expect(casesFrom(sessions, () => "pie")).toEqual([]);
});

test("each model is asked the request search sends, cached by it, and scored against the labels", async () => {
  const { endpoint, asked } = (() => { const j = fakeJev({ best: "Seed swap", exists: 0.9 }); cleanups.push(async () => { j.fake.stop(true); }); return j; })();
  const cacheDir = mkdtempSync(join(tmpdir(), "search-eval-cache-"));
  cleanups.push(async () => rmSync(cacheDir, { recursive: true, force: true }));
  const candidates = (ids: string[]): GotoSearchCollection => ({ completeness: { kind: "complete" }, semantic: { status: "lexical" }, matches: ids.map((id, i) => ({ block: { id, revision: 1 }, title: id === A ? "Seed swap list" : `Other ${i}`, path: "", snippet: id === A ? "Seed swap list" : "beans", exact: false })) });
  const cases = [
    { case: { query: "the seed swap", outline: "pie", expect: [A], source: "agent-read" as const }, candidates: candidates([B, A]) },
    { case: { query: "the seed swap", outline: "gurgle", expect: "none" as const, source: "other-outline" as const }, candidates: candidates([B, C]) },
  ];
  const o = { cacheDir, apiKey: "fake-key", endpoint };
  const run = await runModel("jev-1.14.0", cases, o);
  expect(asked.map(a => a.model)).toEqual(["jev-1.14.0", "jev-1.14.0"]);
  const s = scoreRun(run);
  expect(s).toMatchObject({ positives: 1, negatives: 1, hit1: 1, lexHit1: 0, sureRight: 1 });
  // The second run reads the cache: nothing asked again.
  await runModel("jev-1.14.0", cases, o);
  expect(asked).toHaveLength(2);
});
