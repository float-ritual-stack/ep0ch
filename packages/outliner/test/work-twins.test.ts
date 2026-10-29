// PIE-1258: a new ticket is offered its open twin before it is filed. Made-up items on a scratch service, with a fake Jev
// answering by question (or none: Jev off, where a strong title match is a twin on its own).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { scratchOutline } from "./scratch-outline";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { twinCandidates, twinVerdict } from "../src/work-twins";

const cleanups: Array<() => Promise<void>> = [];
const saved = { ...process.env };
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const k of ["OUTLINER_FIGURE_FIT", "TYPESAFE_API_KEY", "OUTLINER_JEV_ENDPOINT"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

type Question = { type: string; instructions: string };
const until = async (ok: () => Promise<boolean>, ms = 5000) => { const end = Date.now() + ms; while (!(await ok())) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(25); } };
/** The fake Jev: `same` says yes for candidates whose instructions name `twin`; everything else no. */
async function setup(o: { jev?: (id: string, q: Question) => number | undefined } = {}) {
  const asked: { state: Record<string, unknown>; questions: Record<string, Question> }[] = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as { state: Record<string, unknown>; questions: Record<string, Question> };
      asked.push(body);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: o.jev?.(id, q) ?? 0.05 }]));
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 1000, output_tokens: 0 } });
    },
  });
  if (o.jev) Object.assign(process.env, { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` });
  else process.env.OUTLINER_FIGURE_FIT = "off";
  const root = mkdtempSync(join(tmpdir(), "outliner-work-twins-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  store.configureWorkIdPrefix("PIE");
  store.create("Work [type::work-queue] [project::garden]");
  const seed = (title: string, stage = "queued", body = "") => store.createRoadmapItem({ title, project: "garden", arc: "beds", tracks: ["beds"], priority: "medium", workStage: stage as "queued", ...(body ? { body } : {}) });
  seed("Water the tomato beds every morning", "doing", "Evan opens the garden board and sees which beds were watered.");
  seed("Paint the shed door blue");
  seed("Prune the apple tree before spring", "queued");
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(paths.socket);
  const records = async (type: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `type=${type}`, machinery: "show" } })).blocks
    .map(b => Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string>);
  const agent = { author: "agent" as const, provenance: { actorId: "loki/claude-code@float-box" } };
  const create = (title: string, extra: Record<string, unknown> = {}, who: object = agent) => client.request<{ workId: string; block: Block }>({
    action: "roadmap.items.create", input: { title, project: "garden", arc: "beds", tracks: ["beds"], priority: "low", ...extra }, ...who,
  });
  return { store, client, records, create, asked, agent };
}

test("an agent's ticket for work already open is refused, naming the twin and the two calls", async () => {
  const { create, records, asked } = await setup({ jev: (id, q) => id.startsWith("same::") && q.instructions.includes("tomato") ? 0.92 : undefined });
  const refused = await create("Water tomato beds each morning automatically").then(() => null, (e: Error) => e.message);
  expect(refused).toContain("PIE-001 (doing) Water the tomato beds every morning · same work, Jev 0.92");
  expect(refused).toContain('attach: "PIE-001"');
  expect(refused).toContain("new: true");
  // One request for every candidate, each candidate in its own question.
  expect(asked).toHaveLength(1);
  expect(Object.keys(asked[0]!.questions).filter(id => id.startsWith("same::")).length).toBeGreaterThan(0);
  const [offer] = await records("work-twin");
  expect(offer).toMatchObject({ outcome: "offered", twin: "PIE-001", same: "0.92", by: "jev" });
  expect((await records("jev-run")).find(r => r.experiment === "work-twins")).toMatchObject({ "tokens-in": "1000", cost: "0.000042" });
});

test("new: true files it anyway, beside its twin; attach adds the ask under the twin, dated, in its words", async () => {
  const { create, client, records, store, agent } = await setup({ jev: (id, q) => id.startsWith("same::") && q.instructions.includes("tomato") ? 0.92 : undefined });
  const filed = await create("Water tomato beds each morning automatically", { new: true });
  expect(filed.block.text).toContain("Filed beside [[PIE-001]]");
  expect(filed.block.properties.filter(p => p.key === "related-to")).toHaveLength(1);
  const attached = await client.request<{ attached: string; block: Block }>({ action: "roadmap.items.attach", input: { item: "PIE-001", title: "Also water the basil", body: "It wilts by noon." }, ...agent });
  expect(attached.attached).toBe("PIE-001");
  expect(attached.block.text).toMatch(/- \*\*Asked again, \w+ \d+\*\* \(by loki\): Also water the basil\n {2}It wilts by noon\.$/);
  expect((await records("work-twin")).map(r => r.outcome).sort()).toEqual(["attached", "filed-anyway"]);
  // Attach never reopens finished work.
  const now = store.require(filed.block.id);
  await client.request({ action: "update", blockId: now.id, text: now.text.replace("[work-stage::unprioritized]", `[work-stage::superseded] [superseded-by::${attached.block.id}]`), expectedRevision: now.revision, mutation: { author: "user" } });
  const done = await client.request({ action: "roadmap.items.attach", input: { item: filed.workId, title: "one more" }, ...agent }).then(() => null, (e: Error) => e.message);
  expect(done).toContain("never reopens it");
  // Nor writes into a note that isn't a roadmap item.
  const note = store.create("Seed order for spring");
  const notItem = await client.request({ action: "roadmap.items.attach", input: { item: note.id, title: "one more" }, ...agent }).then(() => null, (e: Error) => e.message);
  expect(notItem).toContain("isn't a roadmap item");
});

test("a person's own create is never refused; similar answers the candidates for the door's hint", async () => {
  const { create, client, records } = await setup({ jev: (id, q) => id.startsWith("same::") && q.instructions.includes("shed") ? 0.88 : undefined });
  const mine = await create("Paint the shed door a darker blue", {}, { author: "user" });
  expect(mine.workId).toBe("PIE-004");
  const similar = await client.request<{ twins: string[]; candidates: { workId: string; verdict: string }[]; jev: string }>({ action: "roadmap.items.similar", input: { title: "Paint the shed door blue again" } });
  expect(similar.jev).toBe("asked");
  expect(similar.twins).toContain("PIE-002");
  expect(similar.candidates.find(c => c.workId === "PIE-002")).toMatchObject({ verdict: "same", said: "PIE-002 (queued) Paint the shed door blue · same work, Jev 0.88" });
  // The person's offer is counted, as an agent's is.
  await until(async () => (await records("work-twin")).some(r => r.outcome === "offered" && r.writer === "person"));
});

test("with Jev off, a strong title match is a twin on its own, said as a text match; unrelated work files", async () => {
  const { create } = await setup();
  const refused = await create("Paint the shed door blue").then(() => null, (e: Error) => e.message);
  expect(refused).toContain("PIE-002 (queued) Paint the shed door blue · the title matches (text match; Jev not asked)");
  expect((await create("Build a compost bin")).workId).toBe("PIE-004");
});

test("the truth table: Jev's no outranks a shared title; a step of it is attach, not a twin", () => {
  expect(twinVerdict({ match: "title-terms", same: 0.1, part: 0.1 })).toBe("related");
  expect(twinVerdict({ match: "some-terms", same: 0.75 })).toBe("same");
  expect(twinVerdict({ match: "some-terms", same: 0.4, part: 0.8 })).toBe("part");
  expect(twinVerdict({ match: "title-terms", same: 0.5 })).toBe("text");
  expect(twinVerdict({ match: "partial-terms", inTitle: 0.8 })).toBe("text");
  expect(twinVerdict({ match: "partial-terms", inTitle: 0.5 })).toBe("related");
  const open = [{ id: "a", text: "PIE-9 — Paint the shed [work-id::PIE-9] [work-stage::later]", properties: [{ key: "work-id", value: "PIE-9" }, { key: "work-stage", value: "later" }] }] as Block[];
  expect(twinCandidates(open, "shed paint")[0]).toMatchObject({ workId: "PIE-9", title: "Paint the shed", stage: "later" });
});
