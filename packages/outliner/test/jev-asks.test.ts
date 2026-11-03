// PIE-1546: Jev's bookkeeping wrote a block a second on a busy evening (a `review-quiet` per quiet ask, the day's
// `jev-run` rewritten per ask, two writes per settled finding's stamp). Asks are lines of a day file now, the run is
// written from it at most every 15 minutes, and a pass's stamps are one request. Fictional notes; a scratch service.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { JevAsks, TALLY_EVERY_MS, tallyOf } from "../src/jev-asks";
import { recordReview, stampSettled, tallyDay, type SuggestionKeep } from "../src/jev-suggestions";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, ChangeFeedPage } from "../src/types";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-jev-asks-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const records = async (type: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `type=${type}`, machinery: "show" } })).blocks
    .map(b => ({ id: b.id, text: b.text, ...Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string> }) as { id: string; text: string } & Record<string, string>);
  const changesSince = (sequence: number) => (store.changes.since(sequence) as Extract<ChangeFeedPage, { kind: "changes" }>).changes;
  return { root, store, client, records, changesSince };
}

const quietReview = (i: number): Extract<SuggestionKeep, { kind: "reviewed" }> => ({
  kind: "reviewed", title: `Bean row ${i}`,
  at: { note: `bean-row-${i}`, revision: 1, actorId: "kitty/claude-code@float-box", source: "write" },
  review: { verdict: "ship", findings: [], jev: "asked", next: "" } as never,
  reading: { model: "jev-1.13.0", prompt: [], usage: { input: 100, output: 10 } } as never,
});

test("a burst of quiet reviews writes no block; the day's run is written from the ask file at most every 15 minutes", async () => {
  const { root, store, client, records, changesSince } = await setup();
  let clock = Date.parse("2026-10-20T10:00:00Z");
  const asks = new JevAsks(join(root, "jev"), () => clock);
  const day = new Date(clock);
  // The first ask of the day makes the day's run.
  await recordReview(client, quietReview(0), day, {}, asks);
  expect((await records("jev-run"))[0]).toMatchObject({ quiet: "1", "tokens-in": "100" });
  const before = store.sequence;
  // 20 more, a minute apart: one a minute is what Jev's write review kept up on pie at night.
  for (let i = 1; i <= 20; i++) {
    clock += 60_000;
    await recordReview(client, quietReview(i), day, {}, asks);
  }
  expect(await records("review-quiet")).toEqual([]);
  // One write in 20 asks: the run, when 15 minutes had passed (it was one block and one run update an ask before).
  expect(changesSince(before).map(c => c.kind)).toEqual(["edit"]);
  expect(asks.lines("2026-10-20").filter(l => l.kind === "quiet")).toHaveLength(21);
  expect(asks.lines("2026-10-20").find(l => l.kind === "quiet" && l.note === "bean-row-1")).toMatchObject({ kind: "quiet", note: "bean-row-1", revision: 1, writer: "kitty", harness: "claude-code", source: "write", tokensIn: 100 });
  // Written from the file whenever asked: every ask counted once.
  await tallyDay(client, "2026-10-20", asks);
  expect((await records("jev-run"))[0]).toMatchObject({ quiet: "21", items: "21", "tokens-in": "2100", "tokens-out": "210", model: "jev-1.13.0" });
});

test("a day whose run was counted in place before keeps those counts, once, as the file's base", async () => {
  const lines = new JevAsks();
  lines.append("2026-10-21", { kind: "quiet", at: "x", experiment: "figure-fit-live", tokensIn: 5, tokensOut: 1 });
  expect(tallyOf(lines.lines("2026-10-21"), "figure-fit-live")).toMatchObject({ quiet: 1, tokensIn: 5 });
  lines.append("2026-10-21", { kind: "base", at: "y", experiment: "figure-fit-live", quiet: 40, unavailable: 2, tokensIn: 900, tokensOut: 90 });
  lines.append("2026-10-21", { kind: "quiet", at: "z", experiment: "figure-fit-live", source: "backfill", tokensIn: 7, tokensOut: 0 });
  lines.append("2026-10-21", { kind: "quiet", at: "z", experiment: "figure-fit-live", read: false, tokensIn: 0, tokensOut: 0 });
  // A backfill's ask isn't the live run's; a quiet one code reviewed alone isn't Jev staying quiet.
  expect(tallyOf(lines.lines("2026-10-21"), "figure-fit-live")).toMatchObject({ quiet: 41, unavailable: 2, tokensIn: 905, tokensOut: 91 });
  expect(tallyOf(lines.lines("2026-10-21"), "query-suggest-live")).toBeUndefined();
  let clock = 0;
  const due = new JevAsks(undefined, () => clock);
  expect([due.due("figure-fit-live", "2026-10-21"), due.due("figure-fit-live", "2026-10-21")]).toEqual([true, false]);
  clock += TALLY_EVERY_MS;
  expect(due.due("figure-fit-live", "2026-10-21")).toBe(true);
});

test("a pass's settled findings are stamped in one request", async () => {
  const { client, records } = await setup();
  const mutation = { author: "agent" as const, actorId: "jev" };
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const finding = await client.request<Block>({ action: "create", parentId: null, text: `fix: dense in Plot ${i} [type::review-finding] [note::plot-${i}] [said::the plot list runs on: split it]`, mutation } as never);
    await client.request({ action: "create", parentId: null, text: `outcome ${i} [type::suggestion-outcome] [suggestion::${finding.id}] [outcome::ignored] [because::nothing changed]`, mutation } as never);
    ids.push(finding.id);
  }
  const asked: string[] = [];
  await stampSettled({ request: (input: { action: string }, t?: number) => { asked.push(input.action); return client.request(input as never, t); } } as never);
  expect(asked.filter(a => a !== "blocks.query")).toEqual(["suggestions.stamp"]);
  const stamped = (await records("review-finding")).filter(f => ids.includes(f.id));
  expect(stamped.map(f => f.outcome)).toEqual(["ignored", "ignored", "ignored"]);
  expect(stamped[0]!.text.split("\n", 1)[0]).toStartWith("fix: the plot list runs on [type::review-finding]");
});
