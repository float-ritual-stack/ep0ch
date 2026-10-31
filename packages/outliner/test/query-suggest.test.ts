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
