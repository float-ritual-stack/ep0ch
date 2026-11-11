// PIE-1251: Jev's suggestions leave records, and whether each was followed is derived from the note's later writes.
// Made-up notes against a scratch service with a fake Jev, as the mod's CLI writes them.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { applyWrite } from "../src/mcp-write";
import { afterOf, judgeSuggestion, problemOf, stampSettled, tallyAsk, tallyDay, settleOpen, writerOf } from "../src/jev-suggestions";
import { asksFor } from "../src/jev-asks";
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

async function setup(o: { hostDelayMs?: number } = {}) {
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    // Jev as a write's review asks it (write-review.ts): every section a timeline, surely; every other judgment a no.
    async fetch(request) {
      const { questions } = await request.json() as { questions: Record<string, { type: string }> };
      const answers = Object.fromEntries(Object.entries(questions).map(([id]) => [id,
        id.startsWith("kit::") ? { type: "choice", choice: "graph-timeline", confidence: 0.85, probabilities: {} }
          : { type: "noul", noul: id.startsWith("structured::") ? 0.92 : id.startsWith("prose::") ? 0.05 : 0.1 }]));
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 120, output_tokens: 12 } });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "outliner-jev-records-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  // A host slow to write (pie on float-2 took 0.4 to 1 s to create a note under load): the writes it is asked, whoever asks.
  if (o.hostDelayMs) {
    const real = server.handleAsync.bind(server);
    (server as unknown as { handleAsync: typeof real }).handleAsync = async (request, ...rest) => {
      if (["create", "update", "move", "template.stamp"].includes(request.action)) await Bun.sleep(o.hostDelayMs!);
      return real(request, ...rest);
    };
  }
  cleanups.push(async () => { fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const cliEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(HERDR_|OUTLINER_|EP0CH_)/.test(k)) cliEnv[k] = v;
  // PIE-1739: the CLI's answer carries the note drawn by a second `ep0ch show` process unless the preload's
  // OUTLINER_WRITE_VIEW=off reaches it (stripped with the rest of OUTLINER_*): these writes are about their records.
  Object.assign(cliEnv, env, { OUTLINER_WRITE_VIEW: "off", OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` });
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
  // The day's run is written at most every 15 minutes (PIE-1546): a test that reads its counts writes it first.
  const run = async (day = new Date().toISOString().slice(0, 10)) => { await tallyDay(client, day, asksFor(root)); return (await records("jev-run")).find(r => r.run === day); };
  return { store, agent, records, client, run, env: { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` } };
}

test("a write that gets a suggestion leaves a record, and later writes decide whether it was followed, a different figure, or ignored", async () => {
  const { store, agent, records, client, run } = await setup();
  const first = await agent("create", { parent: "root", text: SEASON });
  expect(first.exitCode, first.stderr).toBe(0);
  const [fact] = await records("review-finding");
  expect(fact).toMatchObject({ note: first.json.id, revision: "1", writer: "loki", harness: "claude-code", component: "graph-timeline", rule: "kit", rubric: "format", patch: "ready", source: "write" });
  // The day's run counts it: one ask, suggested, nothing settled yet, and Jev's tokens.
  const today = new Date().toISOString().slice(0, 10);
  expect((await records("jev-run")).find(r => r.run === today)).toMatchObject({ experiment: "figure-fit-live", model: "jev-1.13.0", items: "1", suggested: "1", agreed: "0", "tokens-in": "120", "tokens-out": "12" });
  expect((await records("jev-run")).find(r => r.run === today)!["prompt-rev"]).toContain("write-review.json:");
  // Nothing is judged yet: the note hasn't been written again.
  expect(await records("suggestion-outcome")).toEqual([]);

  // A later write adds the figure suggested: followed.
  const note = store.require(first.json.id);
  const grown = await agent("edit", { ref: note.id, expectedRevision: note.revision, text: TIMELINE });
  expect(grown.exitCode, grown.stderr).toBe(0);
  const [outcome] = await records("suggestion-outcome");
  expect(outcome).toMatchObject({ suggestion: fact!.id, note: note.id, outcome: "followed", component: "graph-timeline", writer: "loki", harness: "claude-code", day: today });
  expect(await run()).toMatchObject({ suggested: "1", agreed: "1", agreement: "1", different: "0", ignored: "0" });
  // PIE-1539: the finding itself reads whole: its title is the problem, and settling stamped what the writer did, the
  // passage after and the write that settled it, without making it news.
  const [stamped] = await records("review-finding");
  expect(stamped!.text.split("\n", 1)[0]).toStartWith(`fix: ${problemOf(fact!.said!)} [`);
  expect(stamped).toMatchObject({ outcome: "followed", "settled-at": "2" });
  expect(stamped!.after).toContain("::graph-timeline");
  expect(store.require(fact!.id).updatedAt).toBe((await client.request<Block>({ action: "get", blockId: fact!.id })).updatedAt);

  // Another note whose next write adds another figure: a different figure, once the window has closed (the suggested one
  // could still follow). Settled once, however often the note is written.
  const second = await agent("create", { parent: "root", text: SEASON.replace("Garden year", "Bed rotation") });
  const other = store.require(second.json.id);
  const swapped = await agent("edit", { ref: other.id, expectedRevision: other.revision, text: CHECK.replace("Garden year", "Bed rotation") });
  expect(swapped.exitCode, swapped.stderr).toBe(0);
  expect((await records("suggestion-outcome")).filter(o => o.note === other.id)).toEqual([]);
  const schemas = (await client.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" })).schemas;
  expect(await settleOpen(client, schemas, Date.now() + 25 * 3600_000)).toBeGreaterThan(0);
  const settled = (await records("suggestion-outcome")).filter(o => o.note === other.id);
  expect(settled).toHaveLength(1);
  expect(settled[0]).toMatchObject({ outcome: "different" });
  expect((await records("review-finding")).find(f => f.note === other.id)).toMatchObject({ outcome: "different" });
  await agent("edit", { ref: other.id, expectedRevision: store.require(other.id).revision, text: `${CHECK.replace("Garden year", "Bed rotation")}\nmore` });
  expect((await records("suggestion-outcome")).filter(o => o.note === other.id)).toHaveLength(1);
});

test("a suggestion nobody acted on within a day is ignored when the next pass settles; a quiet ask is counted on the day's tally, not noted each time", async () => {
  const { agent, records, client } = await setup();
  const made = await agent("create", { parent: "root", text: SEASON });
  expect(made.exitCode, made.stderr).toBe(0);
  const schemas = (await client.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" })).schemas;
  expect(await settleOpen(client, schemas, Date.now())).toBe(0);
  // A finding from before PIE-1539 is titled by its rubric ("fix: format in Garden year"): settling it names the problem
  // from what Jev said, so its row reads on its own.
  const [found] = await records("review-finding");
  const cut = found!.text.indexOf(" [type::review-finding]");
  const old = await client.request<Block>({ action: "get", blockId: found!.id });
  await client.request({ action: "update", blockId: found!.id, text: `fix: format in Garden year${found!.text.slice(cut)}`, expectedRevision: old.revision, mutation: { author: "user" } });
  expect(await settleOpen(client, schemas, Date.now() + 25 * 60 * 60 * 1000)).toBe(1);
  expect(await records("suggestion-outcome")).toEqual([expect.objectContaining({ outcome: "ignored", note: made.json.id })]);
  const [retitled] = await records("review-finding");
  expect(retitled!.text.split("\n", 1)[0]).toStartWith(`fix: ${problemOf(found!.said!)} [type::review-finding]`);
  expect(retitled).toMatchObject({ outcome: "ignored", after: "unchanged" });

  // The day's run: one note per day with the lab's run-level keys; quiet and unavailable asks are counted on it.
  const day = new Date("2026-10-20T10:00:00Z");
  await tallyAsk(client, "quiet", undefined, day); await tallyAsk(client, "quiet", undefined, day); await tallyAsk(client, "unavailable", undefined, day);
  const runs = (await records("jev-run")).filter(t => t.run === "2026-10-20");
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ experiment: "figure-fit-live", quiet: "2", unavailable: "1", items: "2", suggested: "0", agreement: "0" });
  expect(runs[0]!.text.split("\n", 1)[0]).toStartWith("figure-fit 2026-10-20 [type::jev-run]");
});

const schemas = [{ id: "graph-timeline", title: "Timeline (::graph-timeline)", group: "figures", source: { use: "::graph-timeline" } }, { id: "graph-check", title: "Checklist (::graph-check)", group: "figures", source: { use: "::graph-check" } }] as unknown as ComponentSchema[];
const at = Date.parse("2026-10-25T10:00:00Z");
const later = (hours: number, text: string, revision = 2) => ({ revision, savedAt: new Date(at + hours * 3600_000).toISOString(), text });

// PIE-1539 review: one capped read handed every pass the same first page, so a settled finding past it was never stamped.
test("settled findings are stamped past the first page of findings", async () => {
  const { client, records } = await setup();
  const mutation = { author: "agent" as const, actorId: "jev" };
  const make = async (i: number, stamped: boolean) => {
    const finding = await client.request<Block>({ action: "create", parentId: null, text: `fix: dense in Plot ${i} [type::review-finding] [note::plot-${i}] [said::the plot list runs on: split it]${stamped ? " [outcome::ignored]" : ""}`, mutation } as never);
    await client.request({ action: "create", parentId: null, text: `outcome ${i} [type::suggestion-outcome] [suggestion::${finding.id}] [outcome::ignored] [because::nothing changed]`, mutation } as never);
    return finding.id;
  };
  await make(1, true); await make(2, true);
  const last = await make(3, false);
  await stampSettled(client as never, 2);
  const found = (await records("review-finding")).find(f => f.id === last)!;
  expect(found).toMatchObject({ outcome: "ignored", after: "not kept", "settled-at": "none" });
  expect(found.text.split("\n", 1)[0]).toStartWith("fix: the plot list runs on [type::review-finding]");
});

test("the rule: followed, different, ignored, still open, and a Kept margin thread", () => {
  const s = { component: "graph-timeline", at };
  expect(judgeSuggestion(s, SEASON, [later(1, TIMELINE)], schemas, at + 2 * 3600_000)).toMatchObject({ outcome: "followed" });
  expect(judgeSuggestion(s, SEASON, [later(1, CHECK)], schemas, at + 2 * 3600_000)).toBeNull();
  expect(judgeSuggestion(s, SEASON, [later(1, CHECK)], schemas, at + 25 * 3600_000)).toMatchObject({ outcome: "different" });
  // Open while the window runs; ignored when the day is out or five writes passed without a figure.
  expect(judgeSuggestion(s, SEASON, [later(1, `${SEASON}\nx`)], schemas, at + 2 * 3600_000)).toBeNull();
  expect(judgeSuggestion(s, SEASON, [], schemas, at + 25 * 3600_000)).toMatchObject({ outcome: "ignored" });
  expect(judgeSuggestion(s, SEASON, [1, 2, 3, 4, 5].map(n => later(n, `${SEASON}\n${n}`, n + 1)), schemas, at + 6 * 3600_000)).toMatchObject({ outcome: "ignored" });
  // The figure arriving after the day is too late; a Kept thread counts as followed whatever the text says.
  expect(judgeSuggestion(s, SEASON, [later(30, TIMELINE)], schemas, at + 31 * 3600_000)).toMatchObject({ outcome: "ignored" });
  expect(judgeSuggestion(s, SEASON, [], schemas, at + 3600_000, "kept")).toMatchObject({ outcome: "followed" });
  // The suggested figure anywhere in the window is followed, even when another figure came first (CHECK is the first write).
  expect(judgeSuggestion(s, SEASON, [later(1, CHECK), later(2, `${CHECK}\n${TIMELINE.split("\n").slice(4).join("\n")}`, 3)], schemas, at + 3 * 3600_000)).toMatchObject({ outcome: "followed" });
  // A figure the note already had is not an answer.
  expect(judgeSuggestion(s, TIMELINE, [later(1, `${TIMELINE}\nx`)], schemas, at + 3600_000)).toBeNull();
});

test("an actor id with property brackets cannot add properties to the record", async () => {
  const { agent, records } = await setup();
  const made = await agent("create", { parent: "root", text: SEASON }, "eve] [publish::public] [x::y/cli");
  expect(made.exitCode, made.stderr).toBe(0);
  const [fact] = await records("review-finding");
  expect(fact).toBeDefined();
  expect(fact!.publish).toBeUndefined();
});

test("a writer's actor id splits into the persona and the harness", () => {
  expect(writerOf("loki/claude-code@float-box")).toEqual({ writer: "loki", harness: "claude-code" });
  expect(writerOf("garden-agent")).toEqual({ writer: "garden-agent", harness: "unknown" });
});

/** Polls until `check` holds (the host finishes what the one-shot CLI left it), up to `ms`. */
async function until(check: () => Promise<boolean>, ms = 20_000) {
  const stop = Date.now() + ms;
  while (Date.now() < stop) { if (await check()) return true; await Bun.sleep(100); }
  return false;
}

// PIE-1251, the real path (pie, Oct 25): loki's outline_create answered "this reads as a stat", and pie held no record. The Claude
// mod runs `ep0ch agent create`, a one-shot CLI that exits when the answer is printed; the first write seeded the Records
// page's templates one slow create at a time from the CLI and was cut off after two of them. The host writes the record, so
// the CLI's exit costs nothing, and a second write finds the templates there.
test("a write on a slow host leaves its record and the day's run after the one-shot CLI has exited, cold start included", async () => {
  const { agent, records } = await setup({ hostDelayMs: 500 });
  const today = new Date().toISOString().slice(0, 10);
  const made = await agent("create", { parent: "root", text: SEASON });
  expect(made.exitCode, made.stderr).toBe(0);
  expect(made.json.warnings.some((w: string) => w.includes("graph-timeline")), "the writer was told").toBe(true);
  const landed = await until(async () => (await records("review-finding")).length === 1 && (await records("jev-run")).some(r => r.run === today && r.suggested === "1"));
  expect(landed, "the finding and the day's run").toBe(true);
  expect(await records("review-finding")).toEqual([expect.objectContaining({ note: made.json.id, writer: "loki", harness: "claude-code", component: "graph-timeline" })]);
}, 40_000);

// The MCP gateway runs in the host's machine and stays up, but a write through it reaches the same place: `applyWrite`
// (mcp-write.ts) makes the note with the agent operation the mod's CLI runs, so the same records are made, by the service.
test("a write through the MCP gateway's entry leaves the same record, with the writer the connector named", async () => {
  const { client, records, env } = await setup({ hostDelayMs: 300 });
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const board = {
      request: (action: string, args?: Record<string, unknown>) => client.request({ action, ...args } as never),
      info: () => client.requireCompatibleService(),
      comments: async () => [],
    };
    const outcome = await applyWrite(board as never, { tool: "outline_create", blockId: (await client.request<{ id: string }>({ action: "create", text: "Garden", parentId: null, author: "user" })).id, input: { text: SEASON } },
      { level: "full", actor: { actorId: "mcp:loki/claude.ai", author: "agent" } as never, uri: id => `ep0ch://scratch/${id}` });
    expect(outcome.outcome).toBe("applied");
    expect(await until(async () => (await records("review-finding")).length === 1)).toBe(true);
    expect(await records("review-finding")).toEqual([expect.objectContaining({ writer: "mcp:loki", harness: "claude.ai", component: "graph-timeline", source: "write" })]);
  } finally {
    for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}, 40_000);

test("two writers' first suggestions of the day at once leave one run for the day, counting both", async () => {
  const { agent, records, run } = await setup({ hostDelayMs: 150 });
  const [one, two] = await Promise.all([
    agent("create", { parent: "root", text: SEASON }),
    agent("create", { parent: "root", text: SEASON.replace("Garden year", "Bed rotation") }),
  ]);
  expect([one.exitCode, two.exitCode], `${one.stderr}${two.stderr}`).toEqual([0, 0]);
  expect(await until(async () => (await records("review-finding")).length === 2 && (await run())?.suggested === "2")).toBe(true);
  expect(await records("jev-run")).toHaveLength(1);
}, 40_000);

// PIE-1388, a verifier on main (Oct 29): two sections both told to become a checklist; applying the patch in one listed
// the other followed too, because the rule read the component anywhere in the note.
test("a kit finding is followed only when its own section draws the component", () => {
  const baseline = ["Plot plan", "", "## Jobs", "- [ ] dig", "- [ ] sow", "- [x] mulch", "", "## Compare", "- [ ] old bed", "- [ ] new bed", "- [x] path"].join("\n");
  const checkedCompare = baseline.replace("## Compare\n- [ ] old bed\n- [ ] new bed\n- [x] path", "## Compare\n::graph-check\n- [ ] old bed\n- [ ] new bed\n- [x] path\n::");
  const jobs = { component: "graph-check", at, rule: "kit", key: "kit:Jobs", line: 3 };
  const compare = { component: "graph-check", at, rule: "kit", key: "kit:Compare", line: 8 };
  expect(judgeSuggestion(compare, baseline, [later(1, checkedCompare)], schemas, at + 2 * 3600_000)).toMatchObject({ outcome: "followed" });
  expect(judgeSuggestion(jobs, baseline, [later(1, checkedCompare)], schemas, at + 2 * 3600_000)).toBeNull();
});

// PIE-1388: pie's page was shaped by hand; a new section and column reach it on their own, added and never rewritten.
test("an existing suggestions page gains the quiet writes' table, with when, keeping its own order", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const old = SUGGESTIONS_PAGE.replace(/## Reviewed, nothing to fix\n[\s\S]*?\n::\n\n/, "").replace("columns: [note, passage, after, outcome, writer]", "columns: [note, outcome, passage, after, writer]");
  expect(old).not.toContain("review-quiet");
  const up = upgradeSuggestionsPage(old);
  expect(up).toContain("columns: [note, outcome, passage, after, writer]");
  expect(up).toContain("columns: [run, quiet, items, unavailable, tokens-in]");
  expect(up.indexOf("## Reviewed, nothing to fix")).toBeLessThan(up.indexOf("## Was Jev right?"));
  expect(up.split("\n").filter(l => l === "::").length).toBe(old.split("\n").filter(l => l === "::").length + 1);
  expect(upgradeSuggestionsPage(up)).toBe(up);
  expect(upgradeSuggestionsPage(SUGGESTIONS_PAGE)).toBe(SUGGESTIONS_PAGE);
});

// PIE-1546: quiet asks are no longer blocks, so the table that listed them becomes the day's counts, where it stood.
test("a page's table of review-quiet notes becomes the quiet count a day a row, in its place", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const listed = ["## Reviewed, nothing to fix", "::graph-table", "---", "title: writes the review passed", "query: type=review-quiet NOT source=backfill", "machinery: show", "columns: [note, writer, revision, created]", "link: note", "at: revision", "sort: created", "direction: desc", "limit: 30", "---", "::", ""].join("\n");
  const old = SUGGESTIONS_PAGE.replace(/## Reviewed, nothing to fix\n[\s\S]*?\n::\n\n/, `${listed}\n`);
  expect(old).toContain("review-quiet");
  const up = upgradeSuggestionsPage(old);
  expect(up).toBe(SUGGESTIONS_PAGE);
  expect(upgradeSuggestionsPage(up)).toBe(up);
});

// PIE-1433: a review row opens its note at the revision the review read; pie's page gains `at: revision` on its own.
test("an existing suggestions page gains at: revision on its review tables, and only those", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const old = SUGGESTIONS_PAGE.split("\n").filter(l => l !== "at: revision").join("\n");
  const up = upgradeSuggestionsPage(old);
  expect(up).toBe(SUGGESTIONS_PAGE);
  const tables = up.split("::graph-table").slice(1).map(t => t.slice(0, t.indexOf("\n::")));
  for (const t of tables) expect(t.includes("at: revision")).toBe(/query: type=review-finding\b/.test(t) && t.includes("link: note"));
  expect(tables.filter(t => t.includes("at: revision")).length).toBe(1);
  expect(upgradeSuggestionsPage(up)).toBe(up);
});

test("a review table that names its own at: keeps it, wherever it is written", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const own = SUGGESTIONS_PAGE.split("\n").filter(l => l !== "at: revision").join("\n").replace("title: the problem, the passage before and after, and what the writer did", "title: the problem, the passage before and after, and what the writer did\nat: seen-at");
  const up = upgradeSuggestionsPage(own);
  const first = up.split("::graph-table")[1]!;
  expect(first.slice(0, first.indexOf("\n::")).match(/^at:/gm)).toEqual(["at:"]);
  expect(first).toContain("at: seen-at");
});

// PIE-1539, Evan (Nov 3): "having a hard time telling what jev said, and what was changed as a result if anything".
test("a finding's row names the problem in its own words, before Jev's advice", () => {
  expect(problemOf("the title line is 74 characters (keep it under 70): make it a short name, \"Bed…\", and move the rest under it")).toBe("the title line is 74 characters (keep it under 70)");
  expect(problemOf("the section \"Plan\" would read better as ::graph-tree: if it fits, outline_components graph-tree gives its properties")).toBe("the section \"Plan\" would read better as ::graph-tree");
  expect(problemOf("the note builds a case before its point")).toBe("the note builds a case before its point");
});

test("the passage after: the section by its heading, the lines a write added nearest the finding, the patch, or unchanged", () => {
  const before = ["Plot plan", "", "## Jobs", "- dig, sow and mulch the long bed before the frost", "", "## Notes", "- the hose leaks"].join("\n");
  const split = before.replace("- dig, sow and mulch the long bed before the frost", "- dig the long bed\n- sow it\n- mulch before the frost");
  // A section's finding: the section as it reads now.
  expect(afterOf({ line: 3 }, before, split, {})).toBe("## Jobs - dig the long bed - sow it - mulch before the frost");
  // A line's finding (no heading at that line): the lines the write added nearest it.
  expect(afterOf({ line: 4 }, before, split, {})).toBe("- dig the long bed / - sow it / - mulch before the frost");
  expect(afterOf({ line: 4 }, before, before.replace("- dig, sow and mulch the long bed before the frost\n", ""), {})).toBe("removed");
  expect(afterOf({ line: 4, fix: ["- dig", "- sow"] }, before, split, { patched: true })).toBe("- dig ⋯ - sow");
  expect(afterOf({ line: 4 }, before, undefined, {})).toBe("unchanged");
  // Only the change at the finding's passage counts (PIE-1539 review): the flagged line deleted and another edited
  // elsewhere is "removed", never the other edit.
  const elsewhere = before.replace("- dig, sow and mulch the long bed before the frost\n", "").replace("- the hose leaks", "- the hose is fixed");
  expect(afterOf({ line: 4 }, before, elsewhere, {})).toBe("removed");
  // An edit somewhere else entirely leaves the flagged line as it was.
  expect(afterOf({ line: 4 }, before, before.replace("- the hose leaks", "- the hose is fixed"), {})).toBe("- dig, sow and mulch the long bed before the frost");
});

test("a page with the joined table from before rows opened the finding gains row: record, once", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const old = SUGGESTIONS_PAGE.split("\n").filter(l => l !== "row: record").join("\n");
  expect(old).not.toContain("row: record");
  const up = upgradeSuggestionsPage(old);
  expect(up).toBe(SUGGESTIONS_PAGE);
  expect(upgradeSuggestionsPage(up)).toBe(up);
});

test("a page from before PIE-1539 gets the one joined table where its findings table was, and loses the outcome table", async () => {
  const { SUGGESTIONS_PAGE, upgradeSuggestionsPage } = await import("../src/jev-suggestions");
  const split = ["## Each finding, newest first", "::graph-table", "---", "title: what each writer was told", "query: type=review-finding NOT source=backfill", "machinery: show", "columns: [note, said, passage, rubric, patch, writer]", "link: note", "at: revision", "---", "::", ""].join("\n");
  const did = ["## What the writer did", "::graph-table", "---", "title: followed, patched or ignored", "query: type=suggestion-outcome", "machinery: show", "columns: [note, outcome, because, said, patched, writer]", "---", "::", ""].join("\n");
  const joined = SUGGESTIONS_PAGE.slice(SUGGESTIONS_PAGE.indexOf("## What Jev said"), SUGGESTIONS_PAGE.indexOf("## Reviewed, nothing to fix"));
  const old = SUGGESTIONS_PAGE.replace(joined, split).replace("## Was Jev right?", `${did}## Was Jev right?`);
  expect(old).toContain("## What the writer did");
  const up = upgradeSuggestionsPage(old);
  expect(up).toBe(SUGGESTIONS_PAGE);
  expect(up).not.toContain("type=suggestion-outcome\n");
  expect(upgradeSuggestionsPage(up)).toBe(up);
});
