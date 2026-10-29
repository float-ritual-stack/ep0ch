// PIE-1258 step 1: the groom's first pass over queued tickets, against a made-up CHANGELOG and made-up tickets on a
// scratch service, with a fake Jev answering by question. Jev never closes; a confident "solved" is a comment for the verifier.
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
import { changelogSections, groom, groomCandidates, groomSummary, groomVerdict, keepGroom, latestLines, namedIn, originalFirst } from "../src/work-groom";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const CHANGELOG = [
  "# Changelog", "", "## [Unreleased]", "",
  "### The garden board shows which beds were watered (GDN-7)", "", "- **A drop on each bed** watered today.", "",
  "### Compost bins fill from the kitchen", "", "- **Scraps go to the nearest bin** with room, and the bin says how full it is.", "",
  "## Before", "", "### Old entry", "- gone",
].join("\n");

test("the CHANGELOG reads as sections; a ticket's own id in one is named", () => {
  const sections = changelogSections(CHANGELOG);
  expect(sections.map(s => s.title)).toEqual(["The garden board shows which beds were watered (GDN-7)", "Compost bins fill from the kitchen", "Old entry"]);
  expect(namedIn("GDN-7", sections).map(s => s.title)).toEqual(["The garden board shows which beds were watered (GDN-7)"]);
  expect(namedIn("GDN-70", sections)).toEqual([]);
});

// The calibration cases (loki, Oct 29): merged under the ticket's id, then found wrong in use, its newest paragraph
// saying so. Each is open, never solved, however sure Jev is that the change shipped.
const MERGED_THEN_WRONG = [
  "**Used in the app, Oct 29:** two buttons work on the desk; in the river a click does nothing. Finishing in GDN-12.",
  "**Used in the app:** completion answers, but its rows carry noise. Finishing in GDN-12.",
  "**Seen in use:** the narrow column clips text under its scrollbar. Continues in GDN-13.",
  "Validate sweep: folding works; the narrow column still fails at 36 columns, back to queued.",
  "**Used in the app:** right in the tile bar; the library's selected row is not fixed.",
];

test("merged, then found wrong in use, is open: the five calibration cases", () => {
  const c = { shipped: [{ id: "c0", kind: "changelog" as const, title: "The thing (GDN-7)", text: "it ships" }], tickets: [] };
  for (const latest of MERGED_THEN_WRONG) {
    const v = groomVerdict(c, { "ships::0": 0.95, unfinished: 0.2 }, latest);
    expect({ latest, verdict: v.verdict }).toEqual({ latest, verdict: "open" });
    expect(v.evidence).toStartWith("merged, then found unfinished");
  }
  // Jev's own reading of the newest lines counts too, with no telling words.
  expect(groomVerdict(c, { "ships::0": 0.95, unfinished: 0.85 }, "Tried it: the drop shows on the wrong bed.").verdict).toBe("open");
  expect(groomVerdict(c, { "ships::0": 0.95, unfinished: 0.1 }, "Done when: each bed shows a drop.").verdict).toBe("solved");
  expect(latestLines("T [type::roadmap-item]\n\nFirst.\n\nDone when: X.\n\n**Used:** Finishing in GDN-12.")).toBe("**Used:** Finishing in GDN-12.");
});

test("with Jev unreachable, a ticket with candidates is unjudged, never called open", async () => {
  const t = { id: "b1", revision: 1, text: "GDN-5 — Compost bins fill from the kitchen [type::roadmap-item] [work-stage::queued] [work-id::GDN-5]\n\nScraps to bins.", properties: [{ key: "work-id", value: "GDN-5" }, { key: "work-stage", value: "queued" }] } as unknown as Block;
  const client = { request: async <T>() => ({ blocks: [t] }) as T };
  const report = await groom(client, { changelog: CHANGELOG, prs: [] }, { apiKey: "fake", endpoint: "http://127.0.0.1:9/v1/systemone", timeoutMs: 500 });
  expect(report.rows[0]).toMatchObject({ verdict: "unjudged", by: "none" });
  expect(report.counts.unjudged).toBe(1);
});

test("the truth table: ships, then replaces, then duplicate; under 0.8 is open with the near miss said", () => {
  const c = { shipped: [{ id: "c0", kind: "pr" as const, title: "Bins (#4)", text: "" }], tickets: [{ id: "t", workId: "GDN-3", title: "Bins fill", stage: "done", closed: true }] };
  expect(groomVerdict(c, { "ships::0": 0.9 })).toMatchObject({ verdict: "solved", confidence: 0.9, evidence: "pull request: Bins (#4)" });
  expect(groomVerdict(c, { "replaces::0": 0.85 })).toMatchObject({ verdict: "superseded" });
  expect(groomVerdict(c, { "duplicate::0": 0.88 })).toMatchObject({ verdict: "duplicate", of: "GDN-3" });
  expect(groomVerdict(c, { "ships::0": 0.75 }).evidence).toStartWith("close but under 0.8: pull request: Bins (#4)");
  expect(groomVerdict(c, { "ships::0": 0.1 })).toMatchObject({ verdict: "open", confidence: 0.9 });
});

test("a pass over a scratch board: one request per ticket, a comment on the confident solved, records, the view and the cost", async () => {
  const asked: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[] = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as typeof asked[number];
      asked.push(body);
      const ticket = (body.state.ticket as { title: string }).title;
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul:
        id.startsWith("ships::") && /compost/i.test(ticket) && q.instructions.includes("Compost bins fill") ? 0.9 : 0.05 }]));
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 2000, output_tokens: 0 } });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "outliner-work-groom-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  store.configureWorkIdPrefix("GDN");
  store.create("Work [type::work-queue] [project::garden]");
  const seed = (title: string, body = "") => store.createRoadmapItem({ title, project: "garden", arc: "beds", tracks: ["beds"], priority: "medium", workStage: "queued", ...(body ? { body } : {}) });
  seed("Kitchen scraps fill the compost bins", "Compost bins should fill from the kitchen.");
  seed("Paint the shed door blue");
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(paths.socket);
  const c = { request: <T>(input: { action: string } & Record<string, unknown>) => client.request<T>(input as never) };
  const report = await groom(c, { changelog: CHANGELOG, prs: [] }, { apiKey: "fake", endpoint: `http://127.0.0.1:${fake.port}/v1/systemone` });
  expect(report.rows.map(r => [r.ticket, r.verdict])).toEqual([["GDN-001", "solved"], ["GDN-002", "open"]]);
  expect(report.tokens).toBe(2000);
  // Each ticket alone: its own state, each candidate in its own question, and its newest lines asked about.
  expect(asked).toHaveLength(1);
  expect(Object.keys(asked[0]!.questions)).toContain("unfinished");
  // Read only: nothing written until it's kept.
  expect((await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=groom-verdict", machinery: "show" } })).blocks).toHaveLength(0);
  const kept = await keepGroom(c, report);
  expect(kept).toMatchObject({ verdicts: 2, comments: 1 });
  const props = async (where: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, machinery: "show" } })).blocks.map(b => Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string>);
  const solved = (await props("type=groom-verdict verdict=solved"))[0]!;
  expect(solved).toMatchObject({ item: "GDN-001", confidence: "0.90", by: "jev" });
  expect(solved.thread).not.toBe("none");
  const ticket = store.require(report.rows[0]!.id);
  expect(ticket.properties.find(p => p.key === "work-stage")?.value).toBe("queued");
  expect(await props("system-view=jev-done")).toHaveLength(1);
  expect((await props("type=jev-run experiment=work-groom"))[0]).toMatchObject({ items: "2", suggested: "1", "tokens-in": "2000", cost: "0.000084" });
});

// PIE-1402, found in use: a groom that judged everything open printed counts only, and a duplicate filed in other words
// was never a candidate (the matcher read the title alone).
test("a ticket's candidates come from its body too; the summary lists every open ticket with what it was read against", () => {
  const block = (id: string, title: string, body: string, stage = "queued") => ({ id, text: `${id} — ${title} [work-id::${id}] [work-stage::${stage}]\n\n${body}`, properties: [{ key: "work-id", value: id }, { key: "work-stage", value: stage }] }) as unknown as Block;
  const ticket = block("PIE-30", "Daily irrigation for the vegetable plot", "Each morning the tomato beds get watered.");
  const twin = block("PIE-3", "Water the tomato beds every morning", "Evan sees which beds were watered.");
  const c = groomCandidates(ticket, [{ id: "pr:0", kind: "pr", title: "Tomato beds watered on a timer (#12)", text: "Tomato beds watered on a timer" }], [ticket, twin]);
  expect(c.tickets.map(t => t.workId)).toContain("PIE-3");
  expect(c.shipped.map(s => s.title)).toContain("Tomato beds watered on a timer (#12)");
  const summary = groomSummary({
    rows: [
      { ticket: "PIE-30", id: "a", title: "Daily irrigation for the vegetable plot", verdict: "open", confidence: 0.4, evidence: "close but under 0.8: PIE-3: Water the tomato beds every morning", by: "jev" },
      { ticket: "PIE-31", id: "b", title: "Build a compost bin", verdict: "open", confidence: 1, evidence: "nothing shipped or filed does it", by: "jev" },
    ],
    counts: { solved: 0, superseded: 0, duplicate: 0, open: 2, unjudged: 0 }, tokens: 10, cost: "0.000001", jev: "asked",
  });
  const open = summary.split("\n").slice(summary.split("\n").indexOf("open (what each was read against):") + 1);
  expect(open[0]).toContain("PIE-30 0.40 Daily irrigation for the vegetable plot · close but under 0.8: PIE-3");
  expect(open[1]).toContain("PIE-31");
});

test("of two twins the newer is the duplicate; the original stays open and names it", () => {
  const dup = { verdict: "duplicate" as const, confidence: 0.9, evidence: "PIE-6 (queued): Turn the heaps", of: "PIE-6" };
  expect(originalFirst("PIE-2", dup)).toMatchObject({ verdict: "open", evidence: expect.stringContaining("the original: PIE-6 repeats it") });
  expect(originalFirst("PIE-9", dup)).toEqual(dup);
  // A twin already done did the work; one with no Work ID says nothing of which came first.
  expect(originalFirst("PIE-2", dup, true)).toEqual(dup);
  expect(originalFirst("PIE-2", { ...dup, of: "a1b2c3d4" })).toEqual({ ...dup, of: "a1b2c3d4" });
});
