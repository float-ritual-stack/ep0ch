// PIE-1421: a groom never parks what's decided, high priority or new, and what it parked comes back when it's wanted
// again (a comment, a new note naming it, live work linking it), with a line saying why. Made-up garden tickets on a
// scratch service; Jev is a fake answering by question, or off.
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
import { keptBecause, laterSummary, park, parkedAt, revive } from "../src/work-later";
import { setWorkStage } from "../src/work-tools";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const item = (text: string, createdDaysAgo: number, priority = "medium") => ({ text, createdAt: ago(createdDaysAgo), properties: [{ key: "priority", value: priority }] }) as unknown as Block;

test("kept: high priority, under 14 days old, or decided; anything else may be parked", () => {
  expect(keptBecause(item("GDN-1 — Water the beds [type::roadmap-item]", 60, "high"))).toBe("high priority");
  expect(keptBecause(item("GDN-2 — Paint the shed [type::roadmap-item]", 3))).toBe("3 days old (under 14)");
  expect(keptBecause(item("GDN-3 — Compost [type::roadmap-item]\n\n- [x] bins by the gate, not the shed", 60))).toBe("decided: bins by the gate, not the shed");
  expect(keptBecause(item("GDN-4 — Hoses\n\n::graph-decision\n---\ntitle: which hose\nstatus: decided\n---\n- ● green\n::", 60))).toBe("decided: a decision figure says so");
  // An open box is a question, not a decision; plain bullets are a plan.
  expect(keptBecause(item("GDN-5 — Gate\n\n- [ ] fix the latch?\n- oil the hinge", 60))).toBeNull();
  expect(parkedAt({ properties: [{ key: "wreckage", value: "2026-03-04" }] } as unknown as Block)?.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  expect(parkedAt({ properties: [{ key: "wreckage", value: "2026-03-04" }, { key: "parked-at", value: "2026-03-04T10:13:00.000Z" }] } as unknown as Block)?.toISOString()).toBe("2026-03-04T10:13:00.000Z");
});

async function garden() {
  const root = mkdtempSync(join(tmpdir(), "outliner-work-later-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  store.configureWorkIdPrefix("GDN");
  store.create("Work [type::work-queue] [project::garden]");
  const seed = (title: string, o: { body?: string; priority?: "high" | "medium"; stage?: "queued" | "later"; days: number }) => {
    const { block: b } = store.createRoadmapItem({ title, project: "garden", arc: "beds", tracks: ["beds"], priority: o.priority ?? "medium", workStage: o.stage ?? "queued", ...(o.body ? { body: o.body } : {}) });
    // Made old as a groom finds them: created and last touched `days` ago.
    store.database.query("UPDATE blocks SET created_at = ?, updated_at = ? WHERE id = ?").run(ago(o.days), ago(o.days), b.id);
    return store.require(b.id);
  };
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(paths.socket);
  const c = { request: <T>(input: { action: string } & Record<string, unknown>) => client.request<T>(input as never) };
  const stage = (id: string) => store.require(id).properties.find(p => p.key === "work-stage")?.value;
  const records = async (where: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, machinery: "show" } })).blocks.map(b => Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string>);
  return { store, seed, c, stage, records };
}

test("the cut parks only the stale item nobody holds; a decided, a high and a 3-day-old one stay queued, each saying why", async () => {
  const { store, seed, c, stage, records } = await garden();
  const decided = seed("Compost bins by the gate", { body: "- [x] by the gate, Evan said", days: 60 });
  const high = seed("Water the tomatoes daily", { priority: "high", days: 60 });
  const fresh = seed("Label the seed trays", { days: 3 });
  const stale = seed("Paint the shed door blue", { days: 60 });
  const read = await park(c, {});
  expect(read.rows.map(r => [r.ticket, r.outcome])).toEqual([[decided.properties.find(p => p.key === "work-id")!.value, "kept"], [expect.any(String), "kept"], [expect.any(String), "parked"]]);
  // Under the stale cutoff (30 days by default), the 3-day-old one isn't a candidate at all; with none, it's kept by age.
  expect((await park(c, { olderThanDays: 0 })).rows.find(r => r.id === fresh.id)).toMatchObject({ outcome: "kept", why: "3 days old (under 14)" });
  expect(stage(stale.id)).toBe("queued");
  const done = await park(c, { apply: true });
  expect(laterSummary(done)).toContain("1 parked · 2 kept");
  expect(laterSummary(done)).toContain("decided: by the gate, Evan said");
  for (const kept of [decided, high, fresh]) expect(stage(kept.id)).toBe("queued");
  expect(stage(stale.id)).toBe("later");
  expect(parkedAt(store.require(stale.id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  expect((await records("type=groom-later outcome=parked"))).toHaveLength(1);
  expect((await records("type=groom-later outcome=kept"))).toHaveLength(2);
  // By hand it's the writer's call: set anyway, and said back.
  const moved = await setWorkStage(c, high.id, "later", { author: "agent", actorId: "loki" });
  expect(moved.warning).toStartWith("parked though high priority");
});

test("a parked item comes back when a new note links it, with a line saying why; one nobody asked for stays", async () => {
  const { store, seed, c, stage, records } = await garden();
  const wanted = seed("Net the strawberries", { stage: "later", days: 90 });
  const quiet = seed("Repaint the gnome", { stage: "later", days: 90 });
  const nudged = seed("Mulch the paths", { stage: "later", days: 90 });
  const wrong = seed("Water the tomatoes daily", { stage: "later", priority: "high", days: 90 });
  const parkedDay = ago(10).slice(0, 10);
  for (const b of [wanted, quiet, nudged, wrong]) {
    const fresh = store.require(b.id);
    store.update(b.id, fresh.text.replace("[work-stage::later]", `[work-stage::later]\n[wreckage::${parkedDay}]`), fresh.revision);
  }
  const workId = (b: Block) => b.properties.find(p => p.key === "work-id")!.value;
  // Before anything asks: nothing comes back; the one parked against the rule is listed with its restore command.
  const before = await revive(c, { jev: false });
  expect(before.rows.map(r => [r.ticket, r.outcome])).toEqual([[workId(wanted), "stays"], [workId(quiet), "stays"], [workId(nudged), "stays"], [workId(wrong), "misparked"]]);
  expect(laterSummary(before)).toContain(`parked though high priority: ep0ch work stage ${workId(wrong)} queued`);
  // A new note names one; another gets a comment; an old note and a machine record naming the quiet one don't count.
  const note = store.create(`Saturday plan: birds got the fruit again, net them first: [[${workId(wanted)}]]`);
  store.create(`Groom pass [machine::record]\n${workId(quiet)} stays`);
  await c.request({ action: "annotations.batch", requestId: crypto.randomUUID(), author: "user", operations: [{ operationId: "n", type: "block-comment", input: { blockId: nudged.id, expectedRevision: store.require(nudged.id).revision, source: "user", body: "still want this before winter" } }] });
  const report = await revive(c, { jev: false, apply: true });
  expect(report.rows.map(r => [r.ticket, r.outcome])).toEqual([[workId(wanted), "restored"], [workId(quiet), "stays"], [workId(nudged), "restored"], [workId(wrong), "misparked"]]);
  expect(stage(wanted.id)).toBe("queued");
  expect(stage(quiet.id)).toBe("later");
  const back = store.require(wanted.id).text;
  expect(back).toContain("**Back from later,");
  expect(back.split("\n").every(l => !/^\s+\[\w[\w-]*::/.test(l))).toBe(true);
  expect(back).toContain("named in a note since");
  expect(back).toContain(`((${note.id}))`);
  expect(store.require(nudged.id).text).toContain("nudged: a comment");
  expect(stage(wrong.id)).toBe("later");
  // As the Oct 25 audit restored: `wreckage` means parked now, so it comes off and `restored` says when and why.
  expect(store.require(wanted.id).properties.find(p => p.key === "wreckage")).toBeUndefined();
  expect(store.require(wanted.id).properties.find(p => p.key === "restored")?.value).toMatch(/^\d{4}-\d{2}-\d{2}: named in a note since, work-later$/);
  expect(store.database.query("SELECT actor_id FROM block_edit_activity WHERE block_id = ? ORDER BY activity_id DESC LIMIT 1").get(wanted.id)).toEqual({ actor_id: "jev/work-later" });
  expect(await records("type=groom-later outcome=restored")).toHaveLength(2);
  expect((await records("type=jev-run experiment=work-later"))[0]).toMatchObject({ items: "4", suggested: "2" });
});

test("Jev reads the new note: only cited (a list of what was parked) stays, asked for comes back", async () => {
  const fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json() as { questions: Record<string, { instructions: string }> };
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: /net them first/.test(q.instructions) ? 0.9 : 0.1 }]));
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 500, output_tokens: 0 } });
    },
  });
  cleanups.push(async () => { fake.stop(true); });
  const { store, seed, c, stage } = await garden();
  const wanted = seed("Net the strawberries", { stage: "later", days: 90 });
  const cited = seed("Repaint the gnome", { stage: "later", days: 90 });
  for (const b of [wanted, cited]) { const f = store.require(b.id); store.update(b.id, f.text.replace("[work-stage::later]", `[work-stage::later] [wreckage::${ago(10).slice(0, 10)}]`), f.revision); }
  const workId = (b: Block) => b.properties.find(p => p.key === "work-id")!.value;
  store.create(`Saturday: birds again, net them first ${workId(wanted)}`);
  store.create(`What the spring cut parked, for the record: ${workId(cited)}, among others`);
  const report = await revive(c, { apiKey: "fake", endpoint: `http://127.0.0.1:${fake.port}/v1/systemone`, apply: true });
  expect(report.rows.map(r => [r.ticket, r.outcome, r.by])).toEqual([[workId(wanted), "restored", "jev"], [workId(cited), "stays", "jev"]]);
  expect(report.tokens).toBe(1000);
  expect(stage(wanted.id)).toBe("queued");
  expect(stage(cited.id)).toBe("later");
});
