// PIE-1251: Jev's suggestions leave records, and whether each was followed is derived from the note's later writes.
// Made-up notes against a scratch service with a fake Jev, as the mod's CLI writes them.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { judgeSuggestion, tallyAsk, settleOpen, writerOf } from "../src/jev-suggestions";
import { scratchOutline } from "./scratch-outline";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const SEASON = ["Garden year", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden"].join("\n");
const TIMELINE = `${SEASON}\n::graph-timeline\n---\n---\n- 2026-10: seed collecting\n::`;
const CHECK = `${SEASON}\n::graph-check\n- [ ] sow\n::`;

async function setup() {
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: () => Response.json({ model: "jev-1.13.0", answers: {
      which: { type: "choice", choice: "graph-timeline", confidence: 0.85, probabilities: {} },
      "gate::structured": { type: "noul", noul: 0.92 }, "gate::prose": { type: "noul", noul: 0.05 },
    } }),
  });
  const root = mkdtempSync(join(tmpdir(), "outliner-jev-records-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const cliEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(HERDR_|OUTLINER_|EP0CH_)/.test(k)) cliEnv[k] = v;
  Object.assign(cliEnv, env, { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` });
  const agent = async (operation: string, input: unknown, actor = "loki/claude-code@float-box") => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", operation, "--stdin", "--actor", actor, "--session", "s-9"], {
      cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stderr, json: exitCode === 0 ? JSON.parse(stdout) : undefined };
  };
  const client = new OutlinerClient(paths.socket);
  const records = async (type: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `type=${type}`, machinery: "show" } })).blocks
    .map(b => ({ id: b.id, text: b.text, ...Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string> } as { id: string; text: string } & Record<string, string>));
  return { store, agent, records, client };
}

test("a write that gets a suggestion leaves a record, and later writes decide whether it was followed, a different figure, or ignored", async () => {
  const { store, agent, records } = await setup();
  const first = await agent("create", { parent: "root", text: SEASON });
  expect(first.exitCode, first.stderr).toBe(0);
  const [fact] = await records("suggestion");
  expect(fact).toMatchObject({ note: first.json.id, revision: "1", writer: "loki", harness: "claude-code", component: "graph-timeline", gate: "0.94", confidence: "0.85", callout: "none", source: "write" });
  expect(fact!.prompt).toContain("figure-fit.json:");
  // Nothing is judged yet: the note hasn't been written again.
  expect(await records("suggestion-outcome")).toEqual([]);

  // A later write adds the figure suggested: followed.
  const note = store.require(first.json.id);
  const grown = await agent("edit", { ref: note.id, expectedRevision: note.revision, text: TIMELINE });
  expect(grown.exitCode, grown.stderr).toBe(0);
  const [outcome] = await records("suggestion-outcome");
  expect(outcome).toMatchObject({ suggestion: fact!.id, note: note.id, outcome: "followed", component: "graph-timeline", writer: "loki", harness: "claude-code" });

  // Another note whose next write adds another figure: a different figure. Settled once, however often the note is written.
  const second = await agent("create", { parent: "root", text: SEASON.replace("Garden year", "Bed rotation") });
  const other = store.require(second.json.id);
  const swapped = await agent("edit", { ref: other.id, expectedRevision: other.revision, text: CHECK.replace("Garden year", "Bed rotation") });
  expect(swapped.exitCode, swapped.stderr).toBe(0);
  const settled = (await records("suggestion-outcome")).filter(o => o.note === other.id);
  expect(settled).toHaveLength(1);
  expect(settled[0]).toMatchObject({ outcome: "different" });
  await agent("edit", { ref: other.id, expectedRevision: store.require(other.id).revision, text: `${CHECK.replace("Garden year", "Bed rotation")}\nmore` });
  expect((await records("suggestion-outcome")).filter(o => o.note === other.id)).toHaveLength(1);
});

test("a suggestion nobody acted on within a day is ignored when the next pass settles; a quiet ask is counted on the day's tally, not noted each time", async () => {
  const { agent, records, client } = await setup();
  const made = await agent("create", { parent: "root", text: SEASON });
  expect(made.exitCode, made.stderr).toBe(0);
  const schemas = (await client.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" })).schemas;
  expect(await settleOpen(client, schemas, Date.now())).toBe(0);
  expect(await settleOpen(client, schemas, Date.now() + 25 * 60 * 60 * 1000)).toBe(1);
  expect(await records("suggestion-outcome")).toEqual([expect.objectContaining({ outcome: "ignored", note: made.json.id })]);

  const day = new Date("2026-10-25T10:00:00Z");
  await tallyAsk(client, "quiet", day); await tallyAsk(client, "quiet", day); await tallyAsk(client, "unavailable", day);
  const tallies = (await records("suggestion-day")).filter(t => t.day === "2026-10-25");
  expect(tallies).toHaveLength(1);
  expect(tallies[0]).toMatchObject({ quiet: "2", unavailable: "1" });
});

const schemas = [{ id: "graph-timeline", title: "Timeline (::graph-timeline)", group: "figures", source: { use: "::graph-timeline" } }, { id: "graph-check", title: "Checklist (::graph-check)", group: "figures", source: { use: "::graph-check" } }] as unknown as ComponentSchema[];
const at = Date.parse("2026-10-25T10:00:00Z");
const later = (hours: number, text: string, revision = 2) => ({ revision, savedAt: new Date(at + hours * 3600_000).toISOString(), text });

test("the rule: followed, different, ignored, still open, and a Kept margin thread", () => {
  const s = { component: "graph-timeline", at };
  expect(judgeSuggestion(s, SEASON, [later(1, TIMELINE)], schemas, at + 2 * 3600_000)).toMatchObject({ outcome: "followed" });
  expect(judgeSuggestion(s, SEASON, [later(1, CHECK)], schemas, at + 2 * 3600_000)).toMatchObject({ outcome: "different" });
  // Open while the window runs; ignored when the day is out or five writes passed without a figure.
  expect(judgeSuggestion(s, SEASON, [later(1, `${SEASON}\nx`)], schemas, at + 2 * 3600_000)).toBeNull();
  expect(judgeSuggestion(s, SEASON, [], schemas, at + 25 * 3600_000)).toMatchObject({ outcome: "ignored" });
  expect(judgeSuggestion(s, SEASON, [1, 2, 3, 4, 5].map(n => later(n, `${SEASON}\n${n}`, n + 1)), schemas, at + 6 * 3600_000)).toMatchObject({ outcome: "ignored" });
  // The figure arriving after the day is too late; a Kept thread counts as followed whatever the text says.
  expect(judgeSuggestion(s, SEASON, [later(30, TIMELINE)], schemas, at + 31 * 3600_000)).toMatchObject({ outcome: "ignored" });
  expect(judgeSuggestion(s, SEASON, [], schemas, at + 3600_000, "kept")).toMatchObject({ outcome: "followed" });
  // A figure the note already had is not an answer.
  expect(judgeSuggestion(s, TIMELINE, [later(1, `${TIMELINE}\nx`)], schemas, at + 3600_000)).toBeNull();
});

test("a writer's actor id splits into the persona and the harness", () => {
  expect(writerOf("loki/claude-code@float-box")).toEqual({ writer: "loki", harness: "claude-code" });
  expect(writerOf("garden-agent")).toEqual({ writer: "garden-agent", harness: "unknown" });
});
