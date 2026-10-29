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

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

type Question = { type: string; instructions: unknown; criteria?: Record<string, string> };
type Answer = { type: string; choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };
/** What the fake Jev says to a question: by default a choice of its first option, unsure, and every noul a no. */
type Answers = (id: string, q: Question, state: Record<string, unknown>) => Answer | undefined;

async function setup(answers: Answers = () => undefined) {
  const asked: { state: Record<string, unknown>; questions: Record<string, Question> }[] = [];
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json() as { state: Record<string, unknown>; questions: Record<string, Question> };
      asked.push(body);
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
  return { store, agent, records, client, asked };
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

type Review = { verdict: "ship" | "fix"; findings: { rule: string; say: string; new: boolean; patch?: { observed: string; replacement: string }[] }[]; next: string };

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
  expect(store.require(note.id).text).toContain("::graph-stat");
  expect((patched.json.review as Review).verdict).toBe("ship");
});
