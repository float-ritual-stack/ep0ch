// PIE-1388: every agent write is reviewed against the whole kit and answered ship or fix, with ready patches. Made-up
// notes against a scratch service, written through the CLI the Claude mod runs, with a fake Jev answering by question.
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
import { asksFor } from "../src/jev-asks";
import { writeScope } from "../src/write-review";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

type Question = { type: string; instructions: unknown; criteria?: Record<string, string> };
type Answer = { type: string; choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };
/** What the fake Jev says to a question: by default a choice of its first option, unsure, and every noul a no. */
type Answers = (id: string, q: Question, state: Record<string, unknown>) => Answer | undefined;

/**
 * `view`: each write also comes back drawn, as the door draws it (a second `ep0ch show` per write). Off for the tests
 * about the review's words: the outliner's preload turns it off, and the CLI's env drops every OUTLINER_ (PIE-1762).
 */
async function setup(answers: Answers = () => undefined, o: { facetsDelayMs?: number; jevDelayMs?: number; view?: boolean } = {}) {
  const asked: { state: Record<string, unknown>; questions: Record<string, Question> }[] = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as { state: Record<string, unknown>; questions: Record<string, Question> };
      asked.push(body);
      if (o.jevDelayMs) await Bun.sleep(o.jevDelayMs);
      const out: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(body.questions)) {
        out[id] = answers(id, q, body.state) ?? (q.type === "choice"
          ? { type: "choice", choice: Object.keys(q.criteria ?? {})[0], confidence: 0.1, probabilities: {} }
          : { type: "noul", noul: 0.1 });
      }
      return Response.json({ model: "jev-1.13.0", answers: out, usage: { input_tokens: 300, output_tokens: 20 } });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "outliner-write-review-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  // A big outline's facets are slow (pie answered them in 2 to 7 s, Oct 29): the read every count rule asks.
  if (o.facetsDelayMs) {
    const real = server.handleAsync.bind(server);
    (server as unknown as { handleAsync: typeof real }).handleAsync = async (request, ...rest) => {

      if (request.action === "blocks.query" && (request as { query?: { facets?: unknown } }).query?.facets) await Bun.sleep(o.facetsDelayMs!);
      return real(request, ...rest);
    };
  }
  cleanups.push(async () => { fake.stop(true); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const cliEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(HERDR_|OUTLINER_|EP0CH_)/.test(k)) cliEnv[k] = v;
  Object.assign(cliEnv, env, { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` }, o.view ? {} : { OUTLINER_WRITE_VIEW: "off" });
  const agent = async (operation: string, input: unknown, actor = "loki/claude-code@float-box", extraEnv: Record<string, string> = {}) => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", operation, "--stdin", "--actor", actor, "--session", "s-9"], {
      cwd: join(import.meta.dir, ".."), env: { ...cliEnv, ...extraEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stderr, json: exitCode === 0 ? JSON.parse(stdout) : undefined };
  };
  const client = new OutlinerClient(paths.socket);
  const records = async (type: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `type=${type}`, machinery: "show" } })).blocks
    .map(b => ({ id: b.id, text: b.text, ...Object.fromEntries(parsePropertyRecords(b.text).map(p => [p.key, p.value])) as Record<string, string> } as { id: string; text: string } & Record<string, string>));
  // Jev's asks, as the service keeps them in the outline's folder (PIE-1546): a quiet ask is a line there, never a block.
  const asks = (kind?: string) => asksFor(root).find(a => kind === undefined || a.kind === kind);
  return { store, agent, records, client, asked, asks };
}

/** A board with things in it, so a count typed in prose has a query that counts it. */
function seedBoard(store: OutlinerStore) {
  for (const t of ["Sow the beans", "Mend the fence", "Order the jars"]) store.create(`${t} [type::roadmap-item] [work-stage::queued]`);
  for (const t of ["Label the seeds", "Sweep the shed"]) store.create(`${t} [type::roadmap-item] [work-stage::review]`);
}

/** A typical agent wall: a status note with stacked bullets and counts typed in. */
const WALL = [
  "Status tonight [type::status]",
  "",
  "- The swap table went up at nine and the jars were sorted by size. The labels ran out halfway, which slowed the line. Then the second box arrived and nothing was lost.",
  "- Board: 3 queued and 2 in review, with more coming tomorrow.",
].join("\n");

type Review = { verdict: "ship" | "fix"; findings: { rule: string; rubric: string; say: string; passage: string; new: boolean; patch?: { observed: string; replacement: string }[] }[]; next: string };

test("an agent's wall of stacked bullets and pasted counts is answered fix, with patches that make it ship", async () => {
  const { store, agent } = await setup();
  seedBoard(store);
  const made = await agent("create", { parent: "root", text: WALL });
  expect(made.exitCode, made.stderr).toBe(0);
  const review = made.json.review as Review;
  expect(review?.verdict).toBe("fix");
  const rules = review.findings.map(f => f.rule);
  expect(rules).toContain("stacked");
  expect(rules).toContain("count");
  const stacked = review.findings.find(f => f.rule === "stacked")!;
  expect(stacked.say).toContain("3 points");
  expect(stacked.patch?.length).toBeGreaterThan(0);
  const count = review.findings.find(f => f.rule === "count")!;
  expect(count.say).toContain("work-stage=queued");
  expect(review.next).toContain(`ep0ch show ${made.json.id}`);
  // The same findings are said as gates in warnings, for a writer that reads those.
  expect(made.json.warnings.some((w: string) => w.startsWith("fix before you call this done: ") && w.includes("points in one item"))).toBe(true);

  // Applying the ready patches leaves a note that ships.
  const note = store.require(made.json.id);
  const patches = review.findings.flatMap(f => f.patch ?? []);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches });
  expect(patched.exitCode, patched.stderr).toBe(0);
  expect(store.require(note.id).text).toContain("- The labels ran out halfway, which slowed the line.");
  // The count it was told about stays the writer's call (no patch); it's carried, not new, so the patched note ships.
  expect((patched.json.review as Review).verdict).toBe("ship");
});

test("each finding the writer was told is a record with its passage and what was said, and applying its patch settles it followed", async () => {
  const { store, agent, records, client } = await setup();
  seedBoard(store);
  const made = await agent("create", { parent: "root", text: WALL });
  const told = await records("review-finding");
  expect(told.map(r => r.rule).sort()).toEqual(["count", "stacked"]);
  const stacked = told.find(r => r.rule === "stacked")!;
  expect(stacked).toMatchObject({ note: made.json.id, rubric: "dense", title: "Status tonight", patch: "ready", writer: "loki", source: "write" });
  expect(stacked.passage).toContain("The swap table went up at nine");
  expect(stacked.said).toContain("3 points in one item");
  // The page is made with the first finding; its table names the note by its title, which every reader links.
  const pages = (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "system-view=jev-suggestions" } })).blocks;
  expect(pages).toHaveLength(1);
  const answer = await client.request<{ produced: { titles?: Record<string, string> } }>({ action: "site.answer", blockId: pages[0]!.id, produce: { kind: "figure", figure: "table", props: { query: "type=review-finding NOT source=backfill", machinery: "show", columns: ["note", "rubric", "said"] } } });
  expect(answer.produced.titles?.[made.json.id]).toBe("Status tonight");
  // A record opened on its own reads: titled as a sentence, and a card of what it says, its note by title and linked.
  const finding = (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=review-finding rule=stacked", machinery: "show" } })).blocks[0]!;
  // Its title is the problem, in the review's own words (PIE-1539); the whole advice is the record's `said`.
  expect(finding.text.split("\n", 1)[0]).toMatch(/^fix: line \d+ stacks 3 points in one item \[/);
  // The fix offered is kept on the record, in a fence so its chips stay the note's, never the record's (PIE-1402).
  expect(finding.text).toContain("\nfix:\n```text\n- The swap table went up at nine and the jars were sorted by size.\n- The labels ran out halfway");
  expect(finding.properties.some(p => p.key === "needs")).toBe(false);
  const read = await client.request<{ decorations?: { view?: { type: string; link?: string; children?: { children?: { label: string; value: string }[] }[] } }[] }>({ action: "resources.projection.read", blockId: finding.id });
  const card = read.decorations!.find(d => d.view?.type === "card")!.view!;
  expect(card.link).toBe(made.json.id);
  const fields = Object.fromEntries(card.children![0]!.children!.map(c => [c.label, c.value]));
  expect(fields).toMatchObject({ note: "Status tonight", rubric: "dense" });
  expect(fields.said).toContain("3 points in one item");

  const note = store.require(made.json.id);
  const review = made.json.review as Review;
  await agent("patch", { ref: note.id, revision: note.revision, patches: review.findings.flatMap(f => f.patch ?? []) });
  const outcomes = await records("suggestion-outcome");
  expect(outcomes.map(o => [o.rule, o.outcome, o.patched])).toEqual([["stacked", "followed", "yes"]]);
  expect(outcomes.find(o => o.rule === "stacked")!.said).toContain("3 points in one item");
  // The day's run counts the review's tokens.
  const today = new Date().toISOString().slice(0, 10);
  expect(Number((await records("jev-run")).find(r => r.run === today)!["tokens-in"])).toBeGreaterThan(0);
});

test("prose reaches Jev with no shape gate: the rubric's judgments are findings of their own, a clean note ships", async () => {
  const argue = "Prose that argues";
  const { agent, asked, store, records } = await setup((id, _q, state) => {
    const title = String(state.title);
    if (title !== argue) return undefined;
    if (id === "argues" || id.startsWith("mixed::") || id.startsWith("context::")) return { type: "noul", noul: 0.9 };
    // Mixed holds as far as its lines say so (PIE-588): the second paragraph is what was settled, the first what happened.
    const at = /^kind::(L\d+)$/.exec(id)?.[1];
    if (at) { const kind = /settled/.test(String((state.lines as Record<string, string>)[at])) ? "decision" : "fact"; return { type: "choice", choice: kind, confidence: 0.8, probabilities: { [kind]: 0.9 } }; }
    return undefined;
  });
  const essay = [argue, "", "To understand why the beds moved, it helps to go back to the spring, when the light along the north fence was poor all morning and the soil there stayed heavy and cold well into May. We tried two rows of beans there and both came up late and thin.", "", "As discussed, the issue above is settled now: the beds face south from next year, and the north strip becomes the compost and the water butts, which never minded the shade."].join("\n");
  const made = await agent("create", { parent: "root", text: essay });
  expect(made.exitCode, made.stderr).toBe(0);
  const review = made.json.review as Review & { jev: string };
  expect(review.jev).toBe("asked");
  expect(review.verdict).toBe("fix");
  expect(review.findings.map(f => f.rule).sort()).toEqual(["argues", "context", "mixed"]);
  // Prose was asked about, every rubric question in one request over one state.
  expect(asked).toHaveLength(1);
  expect(Object.keys(asked[0]!.questions)).toEqual(expect.arrayContaining(["argues", "kit::s0", "dense::s0", "mixed::s0", "context::s0"]));

  // The context finding quotes the phrase it leans on, not its section's opening (PIE-1402).
  const context = review.findings.find(f => f.rule === "context")!;
  expect(context.say).toContain(`("As discussed")`);
  expect(context.passage).toStartWith("As discussed, the issue above");

  // A rewrite Jev still says it of isn't "followed", and isn't told again: the writer heard it once, so it is carried
  // (PIE-1402). Only the mixed finding stays the writer's, as any told finding with a ready patch not yet applied does
  // (PIE-1388): its patch puts the settled paragraph under a heading of its own (PIE-588).
  const note = store.require(made.json.id);
  const repeat = await agent("edit", { ref: note.id, expectedRevision: note.revision, text: essay.replace("north fence", "north wall") });
  expect((repeat.json.review as Review).findings.filter(f => f.new).map(f => f.rule)).toEqual(["mixed"]);
  expect((repeat.json.review as Review).findings.find(f => f.rule === "mixed")!.patch![0]!.replacement).toContain("## Decided\nAs discussed");
  expect((await records("suggestion-outcome")).filter(o => o.rule === "argues")).toEqual([]);
  expect((await records("review-finding")).filter(r => r.rule === "argues")).toHaveLength(1);
  const again = store.require(note.id);
  await agent("edit", { ref: again.id, expectedRevision: again.revision, text: "Beds moved south\n\nThey moved for the light." });
  expect((await records("suggestion-outcome")).filter(o => o.rule === "argues").map(o => [o.outcome, o.because])).toEqual([["followed", expect.stringContaining("Jev, reading it again, didn't say it")]]);

  const clean = await agent("create", { parent: "root", text: "Bean rows\n\n- Three rows sown on Saturday.\n- Watered at nine." });
  expect((clean.json.review as Review).verdict).toBe("ship");
});

test("a list Jev reads as a timeline comes with the figure built from its lines, and an unchanged section isn't asked again", async () => {
  const { store, agent, asked } = await setup((id, q) => {
    if (id.startsWith("kit::")) return { type: "choice", choice: "graph-timeline", confidence: 0.8, probabilities: {} };
    if (id.startsWith("structured::")) return { type: "noul", noul: 0.9 };
    if (id.startsWith("prose::")) return { type: "noul", noul: 0.1 };
    return q.type === "noul" ? { type: "noul", noul: 0.1 } : undefined;
  });
  const season = ["Garden year", "", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden"].join("\n");
  const made = await agent("create", { parent: "root", text: season });
  const kit = (made.json.review as Review).findings.find(f => f.rule === "kit")!;
  expect(kit.say).toContain("::graph-timeline");
  expect(kit.patch![0]!.replacement).toBe(["::graph-timeline", "---", "---", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden", "::"].join("\n"));
  const note = store.require(made.json.id);
  const applied = await agent("patch", { ref: note.id, revision: note.revision, patches: kit.patch });
  expect(applied.exitCode, applied.stderr).toBe(0);
  expect(store.require(note.id).text).toContain("::graph-timeline");
  // An append under a heading asks about the new section only.
  const later = store.require(note.id);
  await agent("edit", { ref: later.id, expectedRevision: later.revision, append: "## Next year\n\nMore beans." });
  const last = asked.at(-1)!;
  expect(Object.keys((last.state.sections ?? {}) as object)).toEqual(["s1"]);
});

test("the backfill reviews what agents already wrote, read only, and keeps its stats as its own experiment when asked", async () => {
  const { store, client, records, asks } = await setup();
  const count = async () => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "", machinery: "show", limit: 1000 } })).blocks.length;
  seedBoard(store);
  const by = (actorId: string) => ({ actorId });
  store.create(WALL, null, "agent", by("loki/claude-code@float-box"));
  store.create("Long story\n\nFirst some background on beans. Then the point.", null, "agent", by("daddy/claude-code@float-box"));
  store.create("Bean rows\n\n- Three rows sown.", null, "agent", by("daddy/claude-code@float-box"));
  store.create("A person's own note\n\n- 3 queued and more. Many points. In one item. Stacked.", null, "user");
  const before = await count();
  const { reviewBackfill } = await import("../src/write-review-backfill");
  const report = await reviewBackfill(client as never, { since: "7d", jev: false });
  expect(report).toMatchObject({ byAgents: 3, reviewed: 3, flagged: 1, passed: 2 });
  expect(report.byRubric).toMatchObject({ dense: 1, format: 1 });
  expect(report.byWriter.loki).toMatchObject({ reviewed: 1, flagged: 1 });
  expect(report.samples.dense[0]).toMatchObject({ writer: "loki", rule: "stacked" });
  expect(await count()).toBe(before);

  // Kept: a finding per record, marked as the backfill's, and the run with its counts.
  const kept = await reviewBackfill(client as never, { since: "7d", jev: false, into: client as never, outline: "scratch" });
  expect((await records("review-finding")).every(r => r.source === "backfill")).toBe(true);
  expect(await records("review-finding")).toHaveLength(2);
  const run = (await records("jev-run")).find(r => r.experiment === "write-review-backfill")!;
  expect(run).toMatchObject({ items: "3", suggested: "1", quiet: "2" });
  expect(kept.run).toBe(run.id);

  // PIE-1402: each note's findings go in one request as it is reviewed (a week of pie never finished one record a round
  // trip at a time), and a rerun skips the notes already kept.
  store.create("Shed tonight\n\n- The roof went on at nine and the felt was cut. The tacks ran out halfway; we borrowed some. Then the rain held off.", null, "agent", by("kitty/claude-code@float-box"));
  const keeps: string[] = [];
  const counting = { request: (input: { action: string }, t?: number) => { keeps.push(input.action); return client.request(input as never, t); } };
  const again = await reviewBackfill(client as never, { since: "7d", jev: false, into: counting as never, outline: "scratch" });
  // Jev was off, so the quiet notes weren't kept as read: they're read again, with the new one; the flagged note isn't.
  expect(again).toMatchObject({ reviewed: 3, skipped: 1, flagged: 1 });
  expect(asks("quiet")).toHaveLength(0);
  // One request for the note with findings, and no record stamped from the client: the service makes them.
  expect(keeps.filter(a => a === "suggestions.keep")).toHaveLength(3);
  expect((await records("review-finding")).filter(r => r.writer === "kitty")).not.toHaveLength(0);
  // Nothing stamped from here: the run's row was already there.
  expect(keeps.filter(a => a === "template.stamp")).toHaveLength(0);
  const runs = (await records("jev-run")).filter(r => r.experiment === "write-review-backfill");
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ items: "6", suggested: "2" });
  // A note Jev read and said nothing of is kept as quiet (PIE-1402), so a rerun doesn't ask Jev again; edited, it's new.
  const quiet = store.create("Pea rows\n\n- Sown on Monday.", null, "agent", by("kitty/claude-code@float-box"));
  await client.request({ action: "suggestions.keep", keep: { kind: "reviewed", at: { note: quiet.id, revision: quiet.revision, actorId: "kitty/claude-code@float-box", source: "backfill" }, title: "Pea rows", review: { verdict: "ship", findings: [], jev: "asked", next: "" } } } as never);
  expect(asks("quiet").map(a => [a.note, a.source])).toEqual([[quiet.id, "backfill"]]);
  expect(await records("review-quiet")).toHaveLength(0);
  const third = await reviewBackfill(client as never, { since: "7d", jev: false, into: client as never, outline: "scratch" });
  expect(third.skipped).toBe(3);
  store.update(quiet.id, "Pea rows\n\n- Sown on Monday.\n- Netted on Tuesday.", quiet.revision, { author: "agent", actorId: "kitty/claude-code@float-box" } as never);
  expect((await reviewBackfill(client as never, { since: "7d", jev: false, outline: "scratch", into: client as never })).skipped).toBe(2);
});

test("a note asking Evan to try something himself is told validation is the agents' job", async () => {
  const { agent } = await setup();
  const made = await agent("create", { parent: "root", text: "Seed list sorted\n\n- Sorted by sowing month.\n- Evan, can you try it on your phone and check the order?" });
  const qa = (made.json.review as Review).findings.find(f => f.rule === "qa-for-evan")!;
  expect(qa.say).toContain("validation is the agents' job");
});

// PIE-1388's done-when (Evan's Oct 17 intent): future Evan opens an agent's note and finds its point, what's known or
// undecided, and what needs him, without the conversation that produced it. Two acceptance cases.
const ASK = "Evan, should we keep the cedar beds or switch to stone before the frost?";
const THREE_PARAGRAPHS = [
  "Garden beds after the autumn",
  "",
  "The beds along the south fence held up well through the wet weeks, although the cedar on the corner bed has started to soften where the soil sits against it. The stone edging on the herb bed has not moved at all. The paths between the beds drained better than last year, mostly because the gravel was topped up in September. Nothing needs doing to the paths before spring.",
  "",
  "The compost bays are full and the second bay has turned well. The first bay still smells sour, which usually means it is too wet and needs more brown material. Leaves from the street trees would do, and there will be plenty of those in a fortnight. The bins by the shed are empty and can take the overflow if needed.",
  "",
  `The seed order for next year is half done, with the beans and peas chosen and the squash still open. The cedar on the corner bed will need replacing within a year or two at this rate, and stone would last longer but costs more and takes a weekend to lay. The garlic goes in next week either way. ${ASK}`,
].join("\n");

test("acceptance: three long paragraphs with the ask hidden in the last sentence: Jev reads it, the ask is buried with its exact words and moved to the top, the paragraphs are dense", async () => {
  const { store, agent, asked, records } = await setup((id, _q, state) => {
    const line = (state.asks as Record<string, string> | undefined)?.[id.split("::")[1] ?? ""] ?? "";
    if (id.startsWith("asks::")) return { type: "noul", noul: line.includes("cedar beds or switch") ? 0.95 : 0.05 };
    if (id.startsWith("unclear::")) return { type: "noul", noul: 0.9 };
    return undefined;
  });
  const made = await agent("create", { parent: "root", text: THREE_PARAGRAPHS });
  expect(made.exitCode, made.stderr).toBe(0);
  expect(asked).toHaveLength(1);
  const review = made.json.review as Review;
  expect(review.verdict).toBe("fix");
  const buried = review.findings.find(f => f.rubric === "buried")!;
  expect(buried.passage).toBe(ASK);
  expect(review.findings.filter(f => f.rubric === "dense").length).toBeGreaterThanOrEqual(3);
  // The concise fix: the ask alone moves to the top as one "- [ ]", and the note is marked for Evan.
  const note = store.require(made.json.id);
  await agent("patch", { ref: note.id, revision: note.revision, patches: buried.patch });
  const fixed = store.require(note.id).text;
  expect(fixed.split("\n").slice(0, 3)).toEqual([`Garden beds after the autumn [needs::sysop: ${ASK}]`, "", `- [ ] ${ASK}`]);
  expect(fixed).toContain("costs more and takes a weekend to lay.");
  // Moved, not copied: the chip names it and the box holds it, and the paragraph it was in no longer does.
  expect(fixed.split(`- [ ] ${ASK}`)).toHaveLength(2);
  expect(fixed.split("\n").slice(3).join("\n")).not.toContain(ASK);
  // The patch applied as written reads as patched (PIE-1402: it read patched=no, the patch made again without Jev's asks).
  expect((await records("suggestion-outcome")).filter(o => o.rule === "question").map(o => [o.outcome, o.patched])).toEqual([["followed", "yes"]]);
});

test("acceptance: a short, clear, self-contained note ships, pushed into no component it doesn't need", async () => {
  const { agent } = await setup();
  const made = await agent("create", { parent: "root", text: "Cedar beds stay this winter\n\nThe corner bed's cedar is soft but holds until spring.\n\n- Stone costs more and takes a weekend.\n- We revisit it in March." });
  expect((made.json.review as Review).verdict).toBe("ship");
  expect((made.json.review as Review).findings).toEqual([]);
});

// Live on pie (Oct 29): every answer said jev "off". The outline's facets took 5 s, the whole review ran past its budget,
// and the code-only answer hid why. Jev is never held up by the facets, and an answer without Jev says why.
test("a slow facets read never keeps Jev from answering; an answer without Jev says why, never 'off'", async () => {
  const { agent, store } = await setup((id) => (id === "argues" ? { type: "noul", noul: 0.95 } : undefined), { facetsDelayMs: 2800, jevDelayMs: 1500 });
  const made = await agent("create", { parent: "root", text: "Why the beds moved\n\nTo understand it, go back to the spring: 3 queued then." });
  expect(made.exitCode, made.stderr).toBe(0);
  const review = made.json.review as Review & { jev: string };
  expect(review.jev).toBe("asked");
  expect(review.findings.map(f => f.rule)).toContain("argues");
  // A patch's review is the same review: Jev heard there too (loki saw a create say asked and a patch say off).
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "go back to the spring", replacement: "go back to the wet spring" }] });
  expect((patched.json.review as { jev: string }).jev).toBe("asked");
}, 20_000);

test("with no Jev key the answer says so", async () => {
  const { agent } = await setup();
  const made = await agent("create", { parent: "root", text: "Bean rows\n\n- Sown." }, undefined, { TYPESAFE_API_KEY: "", WITH_SECRETS_DIR: "/nonexistent" });
  expect((made.json.review as { jev: string }).jev).toMatch(/^Jev is not configured/);
});

test("a quoted question comes back with no ask and no needs::sysop patch even when Jev says yes, and a line with no words of its own isn't put to Jev (PIE-1597)", async () => {
  const { agent, asked } = await setup(id => (id.startsWith("asks::") ? { type: "noul", noul: 0.95 } : undefined));
  const quoted = 'Evan: "anything the crew should take a deeper look at?"';
  const made = await agent("create", { parent: "root", text: `Crew recon [type::note]\n\nThe beds are set for spring.\n\n## Evidence\n- ${quoted}\n- The sign reads "who left the gate open?"\n- Ran \`is_ready?\` on the bins.\n\n\`\`\`text\nwho has the ladder?\n\`\`\`\n- Oct 6: seeds ordered.` });
  const review = made.json.review as Review;
  expect(review.findings.map(f => f.rule)).not.toContain("question");
  expect(JSON.stringify(review)).not.toContain("needs::sysop");
  const put = asked.map(call => JSON.stringify(call.state.asks ?? {})).join();
  for (const unasked of ["who left the gate", "is_ready", "who has the ladder"]) expect(put).not.toContain(unasked);
});

// PIE-1419: a verifier's walk (Oct 29), every patch applied as written. A question at the bottom that doesn't name Evan
// is buried unless Jev says firmly it asks nothing; the wall under a chip line keeps its chips; a callout is named as one.
test("a prose question at the bottom is buried while Jev is unsure, and not when Jev says it asks nothing", async () => {
  const unsure = "Compost bins, unsure", firm = "Compost bins, rhetorical";
  const { agent, store } = await setup((id, _q, state) => {
    if (!id.startsWith("asks::")) return undefined;
    return { type: "noul", noul: String(state.title) === firm ? 0.05 : 0.5 };
  });
  const body = ["", "The three bins now sit behind the shed, out of the wind.", "", "The old spot by the fence is bare and can take the new bed. The ground is heavy, so it wants grit first. Do we order the grit this week or wait for spring?"].join("\n");
  const made = await agent("create", { parent: "root", text: unsure + body });
  const review = made.json.review as Review;
  expect(review.verdict).toBe("fix");
  const question = review.findings.find(f => f.rule === "question")!;
  expect(question.passage).toBe("Do we order the grit this week or wait for spring?");
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: question.patch });
  expect(store.require(note.id).text.split("\n").slice(0, 3)).toEqual([`${unsure} [needs::sysop: Do we order the grit this week or wait for spring?]`, "", "- [ ] Do we order the grit this week or wait for spring?"]);
  expect((patched.json.review as Review).findings.filter(f => f.new && f.rule === "question")).toEqual([]);
  const rhetorical = await agent("create", { parent: "root", text: firm + body });
  expect((rhetorical.json.review as Review).findings.map(f => f.rule)).not.toContain("question");
});

test("a wall under a chip line, patched as written, keeps its chips as chips and ships; a callout is named as one", async () => {
  const { agent, store } = await setup((id) => {
    if (id.startsWith("kit::")) return { type: "choice", choice: "callout", confidence: 0.9, probabilities: {} };
    if (id.startsWith("structured::")) return { type: "noul", noul: 0.9 };
    if (id.startsWith("prose::")) return { type: "noul", noul: 0.1 };
    return undefined;
  });
  const text = ["Seed swap recap", "[type::note] [area::garden]", "The swap opened at nine and the tables filled within the hour. Most people brought beans and squash. The labels ran out halfway, which slowed the line. Then the second box arrived from the library and nothing was lost, though the queue had reached the gate by then. Next year we start with two boxes, a sign-up sheet at the door and a second table for the rare tomatoes, which drew the longest queue of the morning."].join("\n");
  const made = await agent("create", { parent: "root", text });
  const review = made.json.review as Review;
  const kit = review.findings.find(f => f.rule === "kit");
  expect(kit?.say).toContain("would read better as a callout: ");
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: review.findings.flatMap(f => f.new ? f.patch ?? [] : []) });
  const now = store.require(note.id);
  expect(now.text.split("\n").slice(0, 3)).toEqual(["Seed swap recap", "[type::note] [area::garden]", ""]);
  expect(now.properties.map(p => p.key)).toEqual(expect.arrayContaining(["type", "area"]));
  expect((patched.json.review as Review).verdict).toBe("ship");
});

// PIE-1428, a verifier's walk (Oct 29, Jev answering): an instruction the note gives was called a QA ask of Evan; a
// four-sentence paragraph ending in a question never shipped after its question patch; an answered checkbox was an ask.

test("a note's own instructions are not a QA ask of Evan, even when Jev reads them as one; an ask addressed to him is", async () => {
  const { agent } = await setup(id => (id.startsWith("qa::") ? { type: "noul", noul: 0.95 } : undefined));
  const jobs = await agent("create", { parent: "root", text: "Plot jobs\n\n- Turn the compost bay.\n- Oil the gate latch.\n- Check the water butt level; write it on the shed door so the next person knows." });
  expect((jobs.json.review as Review).findings.map(f => f.rule)).not.toContain("qa-for-evan");
  expect((jobs.json.review as Review).verdict).toBe("ship");
  const keys = await agent("create", { parent: "root", text: "Keys window rebuilt\n\n- Rows are sorted by screen.\n- Try it at 40 columns and tell me whether the rows read right." });
  expect((keys.json.review as Review).findings.map(f => f.rule)).toContain("qa-for-evan");
});

test("a four-sentence paragraph ending in a question ships once the patches it is given are applied as written", async () => {
  // Jev unsure whether the question asks Evan (as it was in use), sure the paragraph is dense.
  const { agent, store } = await setup(id => (id.startsWith("dense::") ? { type: "noul", noul: 0.95 } : id.startsWith("asks::") ? { type: "noul", noul: 0.5 } : undefined));
  const made = await agent("create", { parent: "root", text: "Greenhouse watering\n\nThe rota covers mornings only at the moment, and the evening watering has fallen to whoever happens to be passing. Two people have said they would take Tuesdays and Thursdays. The tap near the bench drips, and the washer has not been replaced since spring. Should we move the watering to a fixed evening slot and put the washer on the order?" });
  let review = made.json.review as Review;
  // The wall's patch waits for the question's, and says so without claiming one it doesn't carry.
  const wall = review.findings.find(f => f.rule === "wall")!;
  expect(wall.patch).toBeUndefined();
  expect(wall.say).not.toContain("the patch makes it a list");
  for (let round = 0; round < 3 && review.verdict === "fix"; round++) {
    const patches = review.findings.flatMap(f => f.new ? f.patch ?? [] : []);
    expect(patches.length, `round ${round}: ${JSON.stringify(review.findings)}`).toBeGreaterThan(0);
    const note = store.require(made.json.id);
    review = (await agent("patch", { ref: note.id, revision: note.revision, patches })).json.review as Review;
  }
  expect(review.verdict).toBe("ship");
  const text = store.require(made.json.id).text;
  expect(text).toContain("- [ ] Should we move the watering");
  expect(text).toContain("- Two people have said they would take Tuesdays and Thursdays.");
});

test("an answered checkbox is no ask: no buried finding, Jev isn't asked about it, and [needs::sysop] is never put back", async () => {
  const { agent, asked } = await setup(id => (id.startsWith("asks::") ? { type: "noul", noul: 0.95 } : undefined));
  const text = "PIE-9 · Downloads work on a phone [type::roadmap-item] [work-stage::done]\n\n- [x] Does Save to Files appear when you tap CSV? Evan, Oct 29: \"sharing that way works\".\n\n## Why\nThe link was a data URL, and phones ignore those.";
  const made = await agent("create", { parent: "root", text });
  const review = made.json.review as Review;
  expect(review.findings.map(f => f.rule)).not.toContain("question");
  expect(JSON.stringify(review.findings)).not.toContain("needs::sysop");
  expect(asked.flatMap(a => Object.keys(a.questions)).filter(q => q.startsWith("asks::"))).toEqual([]);
});

// PIE-1417: a build-log time still to come is told before the line lands; one already past isn't.
test("a build log's timeline row ten minutes ahead is a finding with the time now; one ten minutes back is none", async () => {
  const { agent } = await setup();
  // The reviewing process's own zone is the outline's: the CLI is given one, and the test reads its clock in the same.
  const TZ = "America/Toronto";
  const at = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d).map(p => [p.type, p.value]));
  const now = at(new Date()), day = `${now.year}-${now.month}-${now.day}`;
  const shift = (minutes: number) => { const d = at(new Date(Date.now() + minutes * 60_000)); return d.day === now.day ? `${d.hour}:${d.minute} ${d.dayPeriod}` : minutes > 0 ? "11:59 PM" : "12:00 AM"; };
  const log = (time: string) => `Build log [type::build-log] [day::${day}]\n\n::graph-timeline\n---\ntitle: what landed\n---\n- ${time}: the hedge cut\n::`;
  const ahead = (await agent("create", { parent: "root", text: log(shift(10)) }, undefined, { TZ })).json.review as Review;
  const time = ahead.findings.find(f => f.rule === "time");
  expect(time?.say).toContain(shift(10));
  expect(time?.say).toContain(`it's ${shift(0)} now`);
  expect(ahead.verdict).toBe("fix");
  const back = (await agent("create", { parent: "root", text: log(shift(-10)) }, undefined, { TZ })).json.review as Review;
  expect(back.findings.filter(f => f.rule === "time").map(f => f.say)).toEqual([]);
});

// PIE-1388, a verifier on main (Oct 29): two long walls, one patched, answered ship while it still listed both.
test("a ready patch the writer was told and hasn't applied keeps the verdict fix: the verdict and the list agree", async () => {
  const { agent, store } = await setup();
  const wall = (w: string) => Array.from({ length: 8 }, (_, i) => `The ${w} row ${i + 1} was weeded on Sunday and the beds along the fence were mulched with straw before the rain.`).join(" ");
  const made = await agent("create", { parent: "root", text: `Allotment walls\n\n${wall("bean")}\n\n${wall("pea")}` });
  let review = made.json.review as Review;
  expect(review.findings.filter(f => f.rule === "wall" && f.patch)).toHaveLength(2);
  const note = store.require(made.json.id);
  review = (await agent("patch", { ref: note.id, revision: note.revision, patches: review.findings.find(f => f.rule === "wall")!.patch })).json.review as Review;
  const left = review.findings.filter(f => f.rule === "wall");
  expect(left).toHaveLength(1);
  expect([review.verdict, left[0]!.new]).toEqual(["fix", true]);
  const now = store.require(note.id);
  review = (await agent("patch", { ref: now.id, revision: now.revision, patches: left[0]!.patch })).json.review as Review;
  expect(review.verdict).toBe("ship");
});

// PIE-1388: a live write the review passed left nothing to find it by; only the backfill kept its quiet notes. PIE-1546:
// kept as a line of the day's ask file, not a block, and the suggestions page counts them a day a row.
test("a live write that ships is kept as quiet, counted on the suggestions page by day", async () => {
  const { agent, asks, records } = await setup();
  await agent("create", { parent: "root", text: "Bean rows [type::note]\n\n- Sown on Monday.\n- Netted on Tuesday." });
  const sore = await agent("create", { parent: "root", text: "Seed list sorted\n\n- Evan, can you check the order on your phone?" });
  const quiet = asks("quiet");
  expect(quiet.map(q => [q.source, q.writer, q.harness])).toEqual([["write", "loki", "claude-code"]]);
  expect(quiet[0]!.note).not.toBe(sore.json.id);
  expect(await records("review-quiet")).toHaveLength(0);
  const { SUGGESTIONS_PAGE } = await import("../src/jev-suggestions");
  expect(SUGGESTIONS_PAGE).toContain("query: type=jev-run experiment=figure-fit-live");
  expect(SUGGESTIONS_PAGE).toContain("columns: [run, quiet, items, unavailable, tokens-in]");
});

test("Jev's dense finding with its ready patch stays the writer's to apply across writes, as code's do", async () => {
  const { agent, store } = await setup(id => (id.startsWith("dense::") ? { type: "noul", noul: 0.95 } : undefined));
  const made = await agent("create", { parent: "root", text: "Shed roof\n\nThe felt along the north edge has split where the batten lifted in the storm last week, and water now runs down the inside wall onto the potting bench. The supplier holds the price on new felt until the end of the month, then it goes up by a fifth. The roofer can start the week after the order lands, weather allowing.\n\nThe gutter is fine." });
  const dense = (made.json.review as Review).findings.find(f => f.rule === "dense")!;
  expect(dense.patch?.length).toBeGreaterThan(0);
  const note = store.require(made.json.id);
  const again = (await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "The gutter is fine.", replacement: "The gutter is fine and clear." }] })).json.review as Review;
  expect([again.verdict, again.findings.find(f => f.rule === "dense")?.new]).toEqual(["fix", true]);
});

// PIE-1657: a choice an agent leaves Evan is a box he can tick, never a proposed decision he can only read.
test("a note whose decision is still proposed is answered fix with boxes at the top, and the patched note ships with its boxes", async () => {
  const { store, agent } = await setup();
  const text = [
    "Which wood for the fence [type::review]",
    "",
    "The north posts rotted over winter.",
    "",
    "::graph-decision",
    "---",
    "title: wood for the north posts",
    "status: proposed",
    "---",
    "- Cedar — lasts twenty years",
    "- Larch — half the price",
    "::",
  ].join("\n");
  const made = await agent("create", { parent: "root", text });
  expect(made.exitCode, made.stderr).toBe(0);
  const review = made.json.review as Review;
  expect(review.verdict).toBe("fix");
  const choice = review.findings.find(f => f.rule === "choice")!;
  expect(choice.rubric).toBe("buried");
  expect(choice.patch?.length).toBeGreaterThan(0);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: choice.patch });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const after = store.require(note.id).text;
  expect(after.split("\n").slice(0, 4)).toEqual(["Which wood for the fence [type::review] [needs::sysop: wood for the north posts]", "", "- [ ] Cedar — lasts twenty years", "- [ ] Larch — half the price"]);
  expect((patched.json.review as Review).verdict).toBe("ship");
});

test("with Jev naming a decision figure for the top, the boxes the choice patch put there are never folded back into one", async () => {
  const sure: Answers = (id, q) => id.startsWith("kit::") ? { type: "choice", choice: Object.keys(q.criteria ?? {}).includes("graph-decision") ? "graph-decision" : Object.keys(q.criteria ?? {})[0], confidence: 0.95, probabilities: {} }
    : /^structured::/.test(id) ? { type: "noul", noul: 0.95 } : undefined;
  const { store, agent } = await setup(sure);
  const text = [
    "Which wood for the gate [type::review]",
    "",
    "The gate posts rotted over winter.",
    "",
    "## The options",
    "",
    "::graph-decision",
    "---",
    "title: wood for the gate posts",
    "status: proposed",
    "---",
    "- Cedar — lasts twenty years",
    "- Larch — half the price",
    "- Oak — what the old gate was",
    "::",
  ].join("\n");
  const made = await agent("create", { parent: "root", text });
  expect(made.exitCode, made.stderr).toBe(0);
  const choice = (made.json.review as Review).findings.find(f => f.rule === "choice")!;
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: choice.patch });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const review = patched.json.review as Review;
  expect(store.require(note.id).text).toContain("- [ ] Oak — what the old gate was");
  expect(review.findings.filter(f => f.rule === "kit" && f.new)).toEqual([]);
  expect(review.verdict).toBe("ship");
});

/** A section that mixes what happened, what was decided and what's still open, a line each (made up). */
const MIXED = [
  "Shed roof plan",
  "## Where it stands",
  "- The felt on the north slope tore in the storm on Tuesday, and the rain got in over the potting bench and two trays of seedlings.",
  "- The joists under the tear are dry and sound: only the felt and two battens need replacing, the rest of the roof held.",
  "- We decided to replace the whole north slope with corrugated sheets rather than patch the felt again this winter.",
  "- Still open: whether the gutter on that side can stay, or has to move to take the new sheets' overhang.",
].join("\n");

/** A fake Jev that reads each line's kind by its words, and says every section asked about mixes them. */
const kindsByWords: Answers = (id, _q, state) => {
  if (id.startsWith("mixed::")) return { type: "noul", noul: 0.9 };
  const at = /^kind::(L\d+)$/.exec(id)?.[1];
  if (!at) return undefined;
  const line = String((state.lines as Record<string, string>)[at]);
  const kind = /decided/i.test(line) ? "decision" : /open|\?/i.test(line) ? "open" : "fact";
  return { type: "choice", choice: kind, confidence: 0.8, probabilities: { [kind]: 0.9 } };
};

test("a mixed section answers with the note as drawn and a finding naming its fact, decision and open lines; its patch clears it (PIE-588)", async () => {
  const { store, agent, asked } = await setup(kindsByWords, { view: true });
  const made = await agent("create", { parent: "root", text: MIXED });
  expect(made.exitCode, made.stderr).toBe(0);
  // Each written line of the section was asked what it records, on its own.
  expect(Object.keys(asked[0]!.questions)).toEqual(expect.arrayContaining(["kind::L2", "kind::L3", "kind::L4", "kind::L5"]));
  const mixed = (made.json.review as Review).findings.find(f => f.rule === "mixed")!;
  expect(mixed.say).toContain("what's true on lines 3–4; what was decided on line 5; what's still open on line 6");
  expect(mixed.patch).toHaveLength(1);
  // The answer holds the note as the door draws it, and says to read it there.
  expect(made.json.viewError).toBeUndefined();
  expect(made.json.view.join("\n")).toContain("Shed roof plan");
  expect(made.json.view.join("\n")).toContain("Where it stands");
  expect(made.json.next).toContain("read `view`");

  // Applying it as told moves each line under its heading, and the section isn't mixed any more.
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: mixed.patch });
  expect(patched.exitCode, patched.stderr).toBe(0);
  expect(store.require(note.id).text).toContain("### Decided\n- We decided to replace");
  expect(store.require(note.id).text).toContain("### Open\n- Still open:");
  const after = patched.json.review as Review;
  expect(after.findings.filter(f => f.rule === "mixed" && f.new)).toEqual([]);
  // The patch's drawing is the part it changed, from its section's heading.
  expect(patched.json.viewOf).toStartWith("lines 2–10 of 10");
  expect(patched.json.view.join("\n")).toContain("Decided");
});

test("a patch in one section is judged there alone: judged names only it, and a mixed section it didn't touch says nothing (PIE-1715)", async () => {
  const { store, agent, asked } = await setup(kindsByWords);
  const other = [
    "## The greenhouse",
    "- The glass on the south side cracked in the frost on Monday night, and the tomato seedlings by it were lost to the cold.",
    "- The frame itself is sound and the door still closes: only three panes and their putty need replacing this month.",
    "- We decided to use polycarbonate for the three panes rather than glass, so the next frost can't crack them again.",
    "- Still open: whether to move the seedling bench away from the south side until the new panes are in.",
  ].join("\n");
  const made = await agent("create", { parent: "root", text: `${MIXED}\n\n${other}` });
  expect(made.exitCode, made.stderr).toBe(0);
  expect((made.json.review as Review).findings.filter(f => f.rule === "mixed")).toHaveLength(2);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "only three panes and their putty", replacement: "only three panes and their old putty" }] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const review = patched.json.review as Review & { judged?: string[] };
  expect(review.judged).toEqual(["section:The greenhouse"]);
  // Jev was asked about the patched section only, and the untouched one carries no mixed finding, new or old.
  expect(Object.keys((asked.at(-1)!.state.sections ?? {}) as object)).toHaveLength(1);
  const mixed = review.findings.filter(f => f.rule === "mixed");
  expect(mixed.map(f => f.say)).toEqual([expect.stringContaining('the section "The greenhouse"')]);
});

test("a patch in one section leaves the old findings in another carried: the review speaks of the section it changed (PIE-1715)", async () => {
  const { agent, store } = await setup();
  const wall = Array.from({ length: 8 }, (_, i) => `The bean row ${i + 1} was weeded on Sunday and the beds along the fence were mulched with straw before the rain.`).join(" ");
  const made = await agent("create", { parent: "root", text: `Allotment log\n\n## Beans\n\n${wall}\n\n## Tools\n\nThe spade is in the shed.` });
  expect((made.json.review as Review).findings.filter(f => f.rule === "wall" && f.patch)).toHaveLength(1);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "The spade is in the shed.", replacement: "The spade and the fork are in the shed." }] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const review = patched.json.review as Review;
  // The wall in Beans is the note's, carried: still listed, never this write's to fix, so the patch ships.
  expect(review.findings.filter(f => f.rule === "wall").map(f => f.new)).toEqual([false]);
  expect(review.verdict).toBe("ship");
  expect((patched.json.warnings ?? []).join("\n")).not.toContain("wall");
});

test("two walls in two sections, one patched: the other is the note's, listed and carried, and the patch ships (PIE-1715, against PIE-1388's one-section case)", async () => {
  const { agent, store } = await setup();
  const wall = (w: string) => Array.from({ length: 8 }, (_, i) => `The ${w} row ${i + 1} was weeded on Sunday and the beds along the fence were mulched with straw before the rain.`).join(" ");
  const made = await agent("create", { parent: "root", text: `Allotment walls\n\n## Beans\n\n${wall("bean")}\n\n## Peas\n\n${wall("pea")}` });
  const walls = (made.json.review as Review).findings.filter(f => f.rule === "wall" && f.patch);
  expect(walls).toHaveLength(2);
  const note = store.require(made.json.id);
  const review = (await agent("patch", { ref: note.id, revision: note.revision, patches: walls[0]!.patch })).json.review as Review;
  expect(review.findings.filter(f => f.rule === "wall").map(f => f.new)).toEqual([false]);
  expect(review.verdict).toBe("ship");
});

test("a section a write copies is in its scope, the copy only: the one already there stays out (PIE-1715)", () => {
  const before = "Shed\n\n## Tools\n\nThe spade is in the shed.";
  const scope = writeScope(`${before}\n\n## Tools\n\nThe spade is in the shed.`, before);
  expect(scope.sections.map(s => [s.heading, s.line])).toEqual([["Tools", 6]]);
  expect(writeScope(before, before).sections).toEqual([]);
});

test("deleting the line above an old ask leaves the ask the note's, not the write's (PIE-1715)", async () => {
  const { agent, store } = await setup();
  const made = await agent("create", { parent: "root", text: "Seed order\n\nThe beans are in.\nEvan, can you check the order on your phone?" });
  expect((made.json.review as Review).findings.find(f => f.rule === "qa-for-evan")?.new).toBe(true);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "The beans are in.\n", replacement: "" }] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const review = patched.json.review as Review & { judged?: string[] };
  expect(review.findings.filter(f => f.rule === "qa-for-evan").map(f => f.new)).toEqual([false]);
  // Nor is it put to Jev again as a line this write wrote.
  expect((review.judged ?? []).filter(j => j.startsWith("line:"))).toEqual([]);
});

test("an id written bare is quoted with its link, and the patch that links it clears the finding (PIE-588)", async () => {
  const { store, agent } = await setup();
  // A note whose id's first 8 characters have a digit and a letter: an all-digit or all-letter prefix reads as a word.
  let rota: { json: { id: string } } | undefined;
  for (let k = 0; k < 20 && !rota; k++) {
    const made = await agent("create", { parent: "root", text: `Compost rota ${k + 1}\n\nTurn it on Sundays.` });
    if (/\d/.test(made.json.id.slice(0, 8)) && /[a-f]/.test(made.json.id.slice(0, 8))) rota = made;
  }
  const short = rota!.json.id.slice(0, 8), title = store.require(rota!.json.id).text.split("\n")[0]!;
  const made = await agent("create", { parent: "root", text: `Garden jobs\n\nTurn the heap before the beds, the order is in ${short}.` });
  expect(made.exitCode, made.stderr).toBe(0);
  const context = (made.json.review as Review).findings.find(f => f.rule === "context")!;
  expect(context.say).toContain(`names ${short} bare`);
  expect(context.say).toContain(`((${rota!.json.id}|${title}))`);
  expect(context.patch).toEqual([{ observed: `Turn the heap before the beds, the order is in ${short}.`, replacement: `Turn the heap before the beds, the order is in ((${rota!.json.id}|${title})).` }]);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: context.patch });
  expect((patched.json.review as Review).findings.filter(f => f.rule === "context")).toEqual([]);

  // A whole id written bare is write-shape's bare-id finding, said once: never a second context finding beside it.
  const whole = await agent("create", { parent: "root", text: `Shed jobs\n\nThe rota is ${rota!.json.id}.` });
  const rules = (whole.json.review as Review).findings.map(f => f.rule);
  expect(rules).toContain("bare-id");
  expect(rules).not.toContain("context");
});

test("a figure write comes back with the figure as the door draws it, and its live count answered (PIE-721, PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  for (const t of ["North bed [type::bed]", "South bed [type::bed]"]) store.create(t);
  const figure = ["Bean beds", "", "::graph-stat", "---", "title: beds this week", "items: [{ label: beds, query: \"type=bed\" }, { label: sown, query: \"type=bed sown=yes\" }]", "---", "::"].join("\n");
  const started = Date.now();
  const made = await agent("create", { parent: "root", text: figure });
  const took = Date.now() - started;
  expect(made.exitCode, made.stderr).toBe(0);
  // A live count that matched nothing is a warning, so the answer is drawn: the figure's frame and its tiles.
  expect(made.json.warnings.some((w: string) => w.includes("sown"))).toBe(true);
  const drawn = made.json.view.join("\n");
  expect(drawn).toContain("[ BEDS THIS WEEK ]");
  expect(drawn).toMatch(/2 +0/);
  expect(made.json.viewOf).toBe("the note, as the door draws it at 44 columns");
  expect(took).toBeLessThan(15_000);
}, 30_000);

test("a patch deep in a long section is drawn: its rows, under the section's heading if it's near, within the budget (PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  const rows = Array.from({ length: 60 }, (_, k) => `- Row ${k + 1}: the bed by the fence was weeded and watered.`);
  const made = await agent("create", { parent: "root", text: ["Bed log", "## Weeding", ...rows].join("\n") });
  expect(made.exitCode, made.stderr).toBe(0);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [{ observed: "- Row 57: the bed by the fence was weeded and watered.", replacement: "- Row 57: the bed by the fence went to seed." }] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const drawn = patched.json.view.join("\n");
  expect(drawn).toMatch(/went to\s+seed/);
  expect(drawn).toContain("Bed log");
  expect(patched.json.view.length).toBeLessThanOrEqual(40);
}, 30_000);

test("a patch in two sections far apart draws each change under its own heading, within the budget (PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  const rows = (what: string) => Array.from({ length: 30 }, (_, k) => `- ${what} ${k + 1}: done by the shed.`);
  const made = await agent("create", { parent: "root", text: ["Bed log", "## Weeding", ...rows("Weed"), "## Sowing", ...rows("Sow")].join("\n") });
  expect(made.exitCode, made.stderr).toBe(0);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [
    { observed: "- Weed 2: done by the shed.", replacement: "- Weed 2: the nettles came back." },
    { observed: "- Sow 28: done by the shed.", replacement: "- Sow 28: the carrots came up thin." },
  ] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  expect(patched.json.viewError).toBeUndefined();
  const view = patched.json.view as string[], drawn = view.join("\n");
  expect(drawn).toMatch(/nettles\s+came\s+back/);
  expect(drawn).toMatch(/carrots\s+came\s+up\s+thin/);
  // Each change under its heading: Sowing's is far above its change, so it's drawn as a line of its own.
  expect(view.findIndex(l => l.includes("Weeding"))).toBeLessThan(view.findIndex(l => /nettles/.test(l)));
  const sowing = view.findIndex(l => l.includes("Sowing"));
  expect(sowing).toBeGreaterThan(view.findIndex(l => /nettles/.test(l)));
  expect(sowing).toBeLessThan(view.findIndex(l => /carrots/.test(l)));
  expect(drawn).not.toContain("Sow 10:");
  expect(view.length).toBeLessThanOrEqual(40);
  expect(patched.json.viewOf).toStartWith("lines 2–4, 33, 61–63 of 63");
}, 30_000);

test("a patch inside a figure's source far from another change draws the figure and the other change (PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  for (const t of ["North bed [type::bed]", "South bed [type::bed]"]) store.create(t);
  const rows = Array.from({ length: 40 }, (_, k) => `- Row ${k + 1}: weeded and watered.`);
  const figure = ["::graph-stat", "---", "title: beds this week", "items: [{ label: beds, query: \"type=bed\" }]", "---", "::"];
  const made = await agent("create", { parent: "root", text: ["Bed log", ...rows, "", ...figure].join("\n") });
  expect(made.exitCode, made.stderr).toBe(0);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [
    { observed: "- Row 2: weeded and watered.", replacement: "- Row 2: the rhubarb bolted." },
    { observed: "title: beds this week", replacement: "title: beans this week" },
  ] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  expect(patched.json.viewError).toBeUndefined();
  const drawn = (patched.json.view as string[]).join("\n");
  expect(drawn).toMatch(/rhubarb\s+bolted/);
  expect(drawn).toContain("[ BEANS THIS WEEK ]");
  expect(drawn).not.toContain("Row 20:");
}, 30_000);

test("a patch inside a figure's source and the line after it draws the figure too (PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  for (const t of ["North bed [type::bed]", "South bed [type::bed]"]) store.create(t);
  const rows = Array.from({ length: 30 }, (_, k) => `- Row ${k + 1}: weeded and watered.`);
  const figure = ["::graph-stat", "---", "title: beds this week", "items: [{ label: beds, query: \"type=bed\" }]", "---", "::"];
  // Far below the note's top, so nothing but the figure itself can start the part.
  const made = await agent("create", { parent: "root", text: ["Bed log", ...rows, "", ...figure, "Then the beans went in.", ...rows].join("\n") });
  expect(made.exitCode, made.stderr).toBe(0);
  const note = store.require(made.json.id);
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: [
    { observed: "title: beds this week", replacement: "title: beans this week" },
    { observed: "Then the beans went in.", replacement: "Then the beans went in by the fence." },
  ] });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const drawn = (patched.json.view as string[]).join("\n");
  expect(drawn).toMatch(/by\s+the\s+fence/);
  expect(drawn).toContain("[ BEANS THIS WEEK ]");
}, 30_000);

test("a patch in more places than the drawing holds names the ones it left out (PIE-588)", async () => {
  const { store, agent } = await setup(undefined, { view: true });
  const rows = Array.from({ length: 90 }, (_, k) => `- Row ${k + 1}: weeded and watered.`);
  const made = await agent("create", { parent: "root", text: ["Bed log", ...rows].join("\n") });
  const note = store.require(made.json.id);
  const at = [5, 20, 35, 50, 65, 80];
  const patched = await agent("patch", { ref: note.id, revision: note.revision, patches: at.map(k => ({ observed: `- Row ${k}: weeded and watered.`, replacement: `- Row ${k}: mulched.` })) });
  expect(patched.exitCode, patched.stderr).toBe(0);
  const drawn = (patched.json.view as string[]).join("\n");
  for (const k of at.slice(0, 4)) expect(drawn).toContain(`Row ${k}: mulched.`);
  expect(drawn).not.toContain("Row 80: mulched.");
  expect(patched.json.viewOf).toContain("lines 66, 81 not drawn");
  expect(patched.json.viewOf).toContain(`--lines 66,81`);
}, 30_000);
