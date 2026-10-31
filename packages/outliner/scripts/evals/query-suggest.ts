// with-secrets typesafe -- bun packages/outliner/scripts/evals/query-suggest.ts
// A fresh SQLite outline and real Jev; every name, property and phrase is made up.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerStore } from "../../src/store";
import { OutlinerServer } from "../../src/server";
import { OutlinerClient } from "../../src/client";
import { jevKey, NOT_CONFIGURED, JEV_MODEL } from "../../src/jev";
import { QUERY_SUGGEST_THRESHOLDS } from "../../src/query-suggest";
import type { Block, VisibleBlockCollection } from "../../src/types";
import type { QuerySuggestAnswer } from "@ep0ch/outline-core/query-words";

const root = mkdtempSync(join(tmpdir(), "query-suggest-eval-"));
const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: root });
const server = new OutlinerServer(store, join(root, "service.sock"));
const client = new OutlinerClient(join(root, "service.sock"));
const fixtures = [
  ["Trellis", "Trellis [stage::merged] [tag::trellises] [project::garden]\nCopper supports.", "heron"],
  ["Fence", "Fence [stage::ready] [tag::fences] [project::garden]\nCopper hinges.", "user"],
  ["Old trellis", "Old trellis [stage::ready] [tag::trellises] [project::archive]\nWooden supports.", "heron"],
  ["Rare", "Rare [stage::ready] [tag::lunar-kiln] [project::studio]\nA kiln firing.", "user"],
] as const;
const cases = [
  { text: "things heron merged about trellises", wants: ["Trellis"] },
  { text: "trellises copper", wants: ["Trellis"] },
  { text: "fences", where: "project=garden", wants: ["Fence"] },
  { text: "not trellises", where: "project=garden", wants: ["Fence"] },
  { text: "mine", where: "project=garden", wants: ["Fence"] },
  { text: "lunar kil", wants: ["Rare"] },
  { text: "ready", where: "project=archive", wants: ["Old trellis"] },
  { text: "things updated today about fences", wants: ["Fence"] },
  { text: "the ones since Tuesday about fences", wants: ["Fence"] },
  { text: "fences last week", wants: [], date: true },
  { text: "aardvark zeppelins", wants: [], none: true },
  { text: "which invoice is paid", wants: [], none: true },
  { text: "sort my dinner by tastiness", wants: [], none: true },
];

try {
  if (!await jevKey()) { console.log(NOT_CONFIGURED); process.exitCode = 2; }
  else {
    await server.start();
    const names = new Map<string, string>();
    for (const [name, text, actor] of fixtures) {
      const block = await client.request<Block>({ action: "create", text, author: actor === "user" ? "user" : "agent", ...(actor === "user" ? {} : { provenance: { actorId: actor } }) });
      names.set(block.id, name);
    }
    const scores = [];
    for (const c of cases) {
      const answer = await client.request<QuerySuggestAnswer>({ action: "query.suggest", text: c.text, where: c.where, zone: "America/Toronto" });
      if ("unavailable" in answer) { scores.push({ text: c.text, unavailable: answer.unavailable, pass: false }); continue; }
      let result: VisibleBlockCollection;
      try { result = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: answer.where } }); }
      catch (error) { scores.push({ text: c.text, where: answer.where, error: String(error), pass: false }); continue; }
      const found = result.blocks.map(b => names.get(b.id) ?? b.text.split("\n")[0]).sort();
      const none = !answer.clauses.some(clause => clause.learn !== false);
      const pass = JSON.stringify(found) === JSON.stringify([...c.wants].sort()) && (!c.none || none) && (!c.date || answer.where.includes("updated >="));
      scores.push({ text: c.text, where: answer.where, found, wanted: c.wants, ...(c.none ? { gateNone: none } : {}), pass });
    }
    console.log(JSON.stringify({ model: JEV_MODEL, thresholds: QUERY_SUGGEST_THRESHOLDS, cases: scores.length, passed: scores.filter(s => s.pass).length, unavailable: scores.filter(s => "unavailable" in s).length, none: { passed: scores.filter(s => "gateNone" in s && s.gateNone).length, total: cases.filter(c => c.none).length }, scores }, null, 2));
    process.exitCode = scores.every(s => s.pass) ? 0 : 1;
  }
} finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
