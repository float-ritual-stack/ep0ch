import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, VisibleBlockCollection } from "../src/types";
import type { QueryWords } from "@ep0ch/outline-core/query-words";
import { ReferenceCompletionSession, referenceCompletionProvider } from "../src/reference-completion";
import { TextBuffer } from "../src/text-buffer";
import { completionTargetAtCursor } from "@ep0ch/outline-core/completion-triggers";
import type { CompletionRowsResult } from "@ep0ch/outline-core/protocol";
import { scratchOutline } from "./scratch-outline";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";

const root = mkdtempSync(join(tmpdir(), "query-words-"));
const paths = scratchOutline(root);
const store = new OutlinerStore(paths.database, { workspaceRoot: root });
const server = new OutlinerServer(store, paths.socket);
const client = new OutlinerClient(paths.socket);
let trellis: Block;
beforeAll(async () => {
  await server.start();
  trellis = await client.request<Block>({ action: "create", text: "Trellis plans [stage::ready] [tag::trellises]\nCopper supports for the garden." });
  await client.request({ action: "create", text: "Fence plans [stage::ready] [tag::fences]\nCopper hinges." });
  await client.request({ action: "create", text: "Old trellis [stage::shipped] [tag::trellises]" });
});
afterAll(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });

test("query words extend the selection, keep unmatched text, and learn only after acceptance", async () => {
  const previous = { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.OUTLINER_JEV_ENDPOINT };
  let calls = 0;
  const jev = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    calls++;
    const payload = await request.json() as { state: { request: string }; questions: Record<string, { type: string; criteria: Record<string, string | string[]> }> };
    expect(JSON.stringify(payload)).not.toContain("Copper supports");
    const answers = Object.fromEntries(Object.entries(payload.questions).map(([id, q]) => {
      if (q.type === "noul") return [id, { type: "noul", noul: id === "gate:tag" || id === "negate:tag" && payload.state.request.startsWith("not ") ? 0.96 : 0.02 }];
      const selected = Object.entries(q.criteria).find(([, value]) => value === "trellises")?.[0] ?? "none";
      const alternative = Object.entries(q.criteria).find(([, value]) => value === "fences")?.[0] ?? "none";
      return [id, { type: "choice", choice: id === "pick:tag" || id === "words:tag" ? selected : "none", confidence: 0.55, probabilities: { [selected]: 0.58, [alternative]: 0.4, none: 0.02 } }];
    }));
    return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 10 } });
  } });
  process.env.TYPESAFE_API_KEY = "recorded-answer";
  process.env.OUTLINER_JEV_ENDPOINT = `http://127.0.0.1:${jev.port}`;
  try {
    const negative = await client.request<QueryWords>({ action: "query.suggest", text: "not trellises", where: "stage=ready" });
    const excluded = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: negative.where } });
    expect(excluded.blocks.map(b => b.text.split(" [")[0])).toEqual(["Fence plans"]);
    const result = await client.request<QueryWords>({ action: "query.suggest", text: "the ones about trellises copper", where: "stage=ready", zone: "America/Toronto" });
    expect(result.where).toContain("stage=ready");
    expect(result.text).toEqual(["copper"]);
    const matches = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: result.where } });
    expect(matches.blocks.map(b => b.id)).toEqual([trellis.id]);
    const aliases = () => client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "rule-name=query-words" } });
    expect((await aliases()).blocks).toHaveLength(0);
    const offers = await client.request<CompletionRowsResult>({ action: "completion.rows", target: { kind: "query", query: result.input, where: result.base }, semantic: true, zone: "America/Toronto" });
    const alternate = offers.answers.flatMap(a => a.rows).flatMap(r => r.variations ?? []).find(r => r.queryCorrections?.[0]?.clause === "#fences")!;
    expect(alternate.querySuggestion?.clauses.some(c => c.pick?.value === "fences")).toBe(true);
    await client.request({ action: "query.suggest", text: result.input, suggestion: alternate.querySuggestion, outcome: "edited", corrections: alternate.queryCorrections });
    const corrected = await client.request<QueryWords>({ action: "query.suggest", text: "trellises", where: "stage=ready" });
    expect((await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: corrected.where } })).blocks.map(b => b.text.split(" [")[0])).toEqual(["Fence plans"]);

    await client.request({ action: "query.suggest", outcome: "accepted", suggestion: result, text: "the ones about trellises copper", where: "stage=ready", mutation: { author: "user" } });
    const alias = (await aliases()).blocks[0]!;
    expect(alias.text).toContain("[alias::trellises=");
    expect(alias.author).toBe("user");
    const paidCalls = calls;
    const instant = await client.request<CompletionRowsResult>({ action: "completion.rows", target: { kind: "query", query: "trellises", where: "stage=ready" } });
    expect(instant.answers.flatMap(a => a.rows).some(r => r.querySuggestion?.where.includes("#trellises"))).toBe(true);
    const again = await client.request<QueryWords>({ action: "query.suggest", text: "trellises", where: "stage=ready" });
    expect(again.where).toContain("trellises");
    expect(calls).toBe(paidCalls);
    const across = await client.request<QueryWords>({ action: "query.suggest", text: "trellises" });
    expect((await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: across.where } })).blocks.some(b => b.id === alias.id)).toBe(false);
    await client.request({ action: "query.suggest", text: negative.input, outcome: "accepted", suggestion: negative });
    const positive = await client.request<QueryWords>({ action: "query.suggest", text: "trellises", where: "stage=ready" });
    expect((await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: positive.where } })).blocks.map(b => b.id)).toEqual([trellis.id]);
    for (const text of ["[query::trellises", "::graph-table\n---\nquery: trellises"]) {
      const buffer = new TextBuffer(text); buffer.placeCursor(buffer.lines.length - 1, buffer.lines.at(-1)!.length);
      const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "detail"), () => buffer, () => {}, () => true);
      await session.refresh();
      const end = Date.now() + 3000;
      while (!session.state?.items.some(i => i.querySuggestion) && Date.now() < end) await Bun.sleep(20);
      expect(buffer.text).toBe(text);
      expect(await session.accept(session.state?.items.findIndex(i => !!i.querySuggestion))).toBe(true);
      expect(buffer.text).toContain("#trellises");
      session.dismiss();
    }
    const target = completionTargetAtCursor('[query::sta', '[query::sta'.length)!;
    const plain = await client.request<CompletionRowsResult>({ action: "completion.rows", target, semantic: true });
    expect(plain.answers.flatMap(a => a.rows).some(r => String(r.insert).includes("stage="))).toBe(true);
    expect(calls).toBe(paidCalls);
  } finally {
    jev.stop(true);
    for (const [key, value] of [["TYPESAFE_API_KEY", previous.key], ["OUTLINER_JEV_ENDPOINT", previous.endpoint]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("rare values survive the facet limit and a value named none remains selectable", async () => {
  const samples = store.create("Finish samples " + Array.from({ length: 1005 }, (_, n) => `[finish::aaa-${n}]`).join(" "), null, "user");
  const rare = store.create("Kiln sample [finish::lunar-kiln]", null, "user");
  const none = store.create("Unfinished sample [finish::none]", null, "user");
  const previous = { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.OUTLINER_JEV_ENDPOINT };
  const jev = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const { state, questions } = await request.json();
    const wanted = state.request === "none" ? "none" : state.request === "aaa" ? "aaa-900" : "lunar-kiln";
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      const q = question as { type: string; criteria: Record<string, string | string[]> };
      if (q.type === "noul") return [id, { noul: id === "gate:finish" ? 0.99 : 0.01 }];
      expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(255);
      const word = id.startsWith("words:") ? state.request : wanted;
      const selected = Object.entries(q.criteria).find(([, value]) => Array.isArray(value) ? value.includes(word) : value === word)?.[0] ?? "none";
      return [id, { choice: id.endsWith(":finish") ? selected : "none", confidence: 0.95, probabilities: { [selected]: 0.99, none: 0.01 } }];
    }));
    return Response.json({ answers });
  } });
  process.env.TYPESAFE_API_KEY = "recorded-answer";
  process.env.OUTLINER_JEV_ENDPOINT = `http://127.0.0.1:${jev.port}`;
  try {
    for (const [text, note] of [["lunar kil", rare], ["none", none], ["aaa", samples]] as const) {
      const answer = await client.request<QueryWords>({ action: "query.suggest", text });
      const matched = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: answer.where } });
      expect(matched.blocks.map(b => b.id)).toEqual([note.id]);
    }
  } finally {
    jev.stop(true);
    for (const [key, value] of [["TYPESAFE_API_KEY", previous.key], ["OUTLINER_JEV_ENDPOINT", previous.endpoint]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

const query = (where: string) => client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show" } });

test("an OR alias keeps both projects inside the following date bounds", async () => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::courtyards=project=garden OR project=yard]\n[alias::future=updated >= 2100-01-01 AND updated <= 2100-12-31]');
  const garden = store.create("Garden bed [project::garden]");
  const yard = store.create("Yard bed [project::yard]");
  try {
    const answer = await client.request<QueryWords>({ action: "query.suggest", text: "courtyards future" });
    expect((await query(answer.where)).blocks).toEqual([]);
  } finally { store.delete(rule.id); store.delete(garden.id); store.delete(yard.id); }
});

test("negating an excluding alias selects the tag again", async () => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::unfenced=NOT #fences]');
  try {
    const answer = await client.request<QueryWords>({ action: "query.suggest", text: "not unfenced", where: "stage=ready" });
    expect((await query(answer.where)).blocks.map(b => b.text.split(" [")[0])).toEqual(["Fence plans"]);
  } finally { store.delete(rule.id); }
});

test.each(["bad] [tag::injected", "bad=word", "bad\nword", "bad\rword", "unparseable"])("acceptance keeps the outcome but skips an unlearnable alias: %j", async from => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::boundaries=#fences]');
  const suggestion = await client.request<QueryWords>({ action: "query.suggest", text: "boundaries", where: "stage=ready" });
  store.delete(rule.id);
  const answer = await client.request<QueryWords>({ action: "query.suggest", text: suggestion.input, suggestion, outcome: "accepted",
    corrections: [{ from: [from], clause: from === "unparseable" ? "(" : "#fences" }, { from: ["boundaries"], clause: "#fences" }] });
  expect(answer.warning).toContain("Skipped learning");
  const aliases = (await query("rule-name=query-words")).blocks.flatMap(b => parsePropertyRecords(b.text));
  expect(aliases.some(p => p.key === "alias" && p.value === "boundaries=#fences")).toBe(true);
  expect(aliases.some(p => p.key === "alias" && p.value.startsWith(`${from}=`))).toBe(false);
  expect(aliases.some(p => p.key === "tag" && p.value === "injected")).toBe(false);
  expect((await query(`type=suggestion-outcome suggestion=${suggestion.id} because=accepted`)).blocks).toHaveLength(1);
});

test("saved views exclude suggestion records and repeated words reuse the paid answer", async () => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::cachewarm=#fences]');
  await client.request({ action: "query.suggest", text: "cachewarm" });
  store.delete(rule.id);
  const view = store.create('Canopy [type::virtual-branch] [page::canopy] [query::tag=trellises]');
  const history = store.create('Past interpretation [type::suggestion] [query::tag=fences]');
  const previous = { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.OUTLINER_JEV_ENDPOINT };
  let calls = 0;
  const offered: string[] = [];
  const jev = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    calls++;
    const { state, questions } = await request.json();
    offered.push(...(state.candidates.view ?? []).map((v: { value: string }) => v.value));
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      const q = question as { type: string; criteria: Record<string, string> };
      if (q.type === "noul") return [id, { noul: id === "gate:view" ? 0.99 : 0.01 }];
      const selected = Object.entries(q.criteria).find(([, value]) => value === "canopy")?.[0] ?? "none";
      return [id, { choice: id.endsWith(":view") ? selected : "none", confidence: 0.95, probabilities: { [selected]: 0.99 } }];
    }));
    return Response.json({ answers });
  } });
  process.env.TYPESAFE_API_KEY = "recorded-answer";
  process.env.OUTLINER_JEV_ENDPOINT = `http://127.0.0.1:${jev.port}`;
  try {
    const first = await client.request<QueryWords>({ action: "query.suggest", text: "canopy" });
    const second = await client.request<QueryWords>({ action: "query.suggest", text: "canopy" });
    expect((await query(second.where)).blocks.map(b => b.id)).toContain(trellis.id);
    expect(first.id).not.toBe(second.id);
    expect(offered).not.toContain("Past interpretation");
    expect(calls).toBe(1);
  } finally {
    jev.stop(true); store.delete(view.id); store.delete(history.id);
    for (const [key, value] of [["TYPESAFE_API_KEY", previous.key], ["OUTLINER_JEV_ENDPOINT", previous.endpoint]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("facet search over many distinct values leaves the host responsive", async () => {
  const values = Array.from({ length: 2000 }, (_, i) => `specimen-${(i * 7919 % 2003).toString(36)}-bronze`);
  const notes = store.database.transaction(() => Array.from({ length: 200 }, (_, i) =>
    store.create("Facet load [type::facet-load] " + values.slice(i * 10, i * 10 + 10).flatMap(value => ["sample", "accession", "inventory", "label"].map(key => `[${key}::${value}]`)).join(" "))))();
  try {
    const request = { action: "blocks.query" as const, query: { where: "type=facet-load", facets: true as const, facetValues: 1000, facetKeys: 1000, facetSearch: "restoration bronzework sketches", limit: 1 } };
    await client.request(request);
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const answer = await client.request<VisibleBlockCollection>(request);
      times.push(performance.now() - start);
      expect(notes.some(note => note.id === answer.blocks[0]?.id)).toBe(true);
      expect(answer.facets?.find(f => f.key === "sample")?.values[0]?.value).toStartWith("specimen-");
    }
    const median = times.sort((a, b) => a - b)[1]!;
    console.log(`facet search: 2000 values on four keys, median ${Math.round(median)}ms`);
    expect(median).toBeLessThan(400);
  } finally { store.database.transaction(() => notes.forEach(note => store.delete(note.id)))(); }
}, 15_000);

test.each(["refresh", "missing target", "accepting"])("Detail records ignored only when an offer leaves: %s", async mode => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::lattice=#fences]');
  const buffer = new TextBuffer("[query::lattice"); buffer.moveEnd();
  const provider = referenceCompletionProvider(client, "detail");
  const pending: Promise<unknown>[] = [];
  const write = provider.querySuggest!;
  const held = Promise.withResolvers<void>();
  provider.querySuggest = input => {
    const result = write(input); pending.push(result);
    return input.outcome === "accepted" ? result.then(async answer => { await held.promise; return answer; }) : result;
  };
  const session = new ReferenceCompletionSession(provider, () => buffer, () => {}, () => true);
  try {
    await session.refresh();
    const suggestion = session.state!.items.find(i => i.querySuggestion)!.querySuggestion!;
    if (mode === "missing target") buffer.replaceCurrentLine(0, buffer.text.length, "plain words");
    const accepting = mode === "accepting" ? session.accept() : undefined;
    await session.refresh();
    held.resolve(); if (accepting) expect(await accepting).toBe(true);
    await Promise.all(pending);
    const outcomes = (await query(`type=suggestion-outcome suggestion=${suggestion.id}`)).blocks;
    const ignored = outcomes.filter(b => parsePropertyRecords(b.text).some(p => p.key === "because" && p.value === "ignored"));
    expect(ignored).toHaveLength(mode === "missing target" ? 1 : 0);
    if (mode === "accepting") expect(outcomes.some(b => b.text.startsWith("accepted:"))).toBe(true);
  } finally { held.resolve(); session.dismiss(); await Promise.all(pending); store.delete(rule.id); }
});

test("Detail keeps the moved row when the delayed semantic lookup finishes", async () => {
  const rule = store.create('Query words [rule-name::query-words]\n[alias::lattices=#fences]');
  const buffer = new TextBuffer("[query::lattices st"); buffer.moveEnd();
  const provider = referenceCompletionProvider(client, "detail");
  const rows = provider.completionRows;
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>();
  // Hold real host answers at delivery so the person can move while one is in flight.
  provider.completionRows = async input => {
    const answer = await rows(input);
    if (input.semantic) { started.resolve(); await release.promise; }
    return answer;
  };
  let released = false;
  const session = new ReferenceCompletionSession(provider, () => buffer, () => { if (released) finished.resolve(); }, () => true);
  try {
    await session.refresh();
    // This source's pending pass can offer grammar rows while Jev reads the words.
    expect(session.state?.items.length).toBeGreaterThan(1);
    await started.promise;
    session.move(1);
    const selected = session.state!.items[session.state!.index]!.insertion;
    released = true; release.resolve(); await finished.promise;
    expect(session.state!.items[session.state!.index]!.insertion).toBe(selected);
    expect(await session.accept()).toBe(true);
    expect(buffer.text).toContain(selected);
  } finally { release.resolve(); session.dismiss(); store.delete(rule.id); }
}, 10_000);
