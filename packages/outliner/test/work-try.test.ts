// PIE-1258: what a validator tries for merged tickets. Jev selects among the door's actions and the ticket's own lines;
// the plan is in the parts' words. Made-up tickets and actions, a fake Jev.
import { afterEach, expect, test } from "bun:test";
import type { Block } from "../src/types";
import { actionCandidates, experienceLines, planTries, tryMarkdown } from "../src/work-try";

const fakes: Array<{ stop(force?: boolean): void }> = [];
afterEach(() => { for (const f of fakes.splice(0)) f.stop(true); });

const ticket = (id: string, title: string, body: string) => ({
  id: `b-${id}`, revision: 1, text: `${id} — ${title} [type::roadmap-item] [work-id::${id}]\n\n${body}`, properties: [{ key: "work-id", value: id }],
}) as unknown as Block;

const ACTIONS = [
  { name: "beds.water", summary: "water the selected bed: it shows a drop until tomorrow", keys: "w" },
  { name: "shed.paint", summary: "paint the shed a colour", keys: "p" },
  { name: "board.open", summary: "open the garden board on the desk", examples: [{ act: "board.open name=garden", does: "opens the garden board" }] },
];
const WATER = ticket("GDN-7", "The garden board shows which beds were watered", [
  "Beds get watered and nobody can tell which.",
  "",
  "Done when: Evan opens the garden board and sees a drop on each bed watered today.",
  "```", "evan opens nothing here: code", "```",
].join("\n"));

test("code's candidates: the ticket's lines that say what someone sees, and the actions sharing its words", () => {
  expect(experienceLines(WATER.text)).toContain("Done when: Evan opens the garden board and sees a drop on each bed watered today.");
  expect(experienceLines(WATER.text).join(" ")).not.toContain("code");
  expect(actionCandidates(WATER, ACTIONS).map(c => c.action.name).sort()).toEqual(["beds.water", "board.open"]);
});

test("Jev picks the journeys; the plan is the actions' own words, their keys and act call, and the line that should show", async () => {
  const asked: Record<string, { instructions: string }>[] = [];
  const fake = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(r) {
    const body = await r.json() as { questions: Record<string, { instructions: string }> };
    asked.push(body.questions);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: q.instructions.includes("beds.water") || id.startsWith("shows::") ? 0.9 : 0.2 }]));
    return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 700, output_tokens: 0 } });
  } });
  fakes.push(fake);
  const blank = ticket("GDN-8", "Refactor the bed store", "Internal only.");
  const report = await planTries([WATER, blank], ACTIONS, { apiKey: "fake", endpoint: `http://127.0.0.1:${fake.port}/v1/systemone` });
  expect(asked).toHaveLength(1);
  expect(report.tokens).toBe(700);
  const md = tryMarkdown(report);
  expect(md).toContain("## [[GDN-7]] The garden board shows which beds were watered");
  expect(md).toContain("- [ ] **Try:** water the selected bed · keys w · `ep0ch act beds.water`");
  expect(md).toContain("  - **Should show:** Done when: Evan opens the garden board and sees a drop on each bed watered today.");
  // A ticket that never says what Evan opens and does is a finding, not a blank.
  expect(md).toContain("## [[GDN-8]] Refactor the bed store\n- [ ] **Finding:** the ticket never says what Evan opens and does");
});

test("with Jev off, the matcher's best are the plan, said as text matches", async () => {
  const report = await planTries([WATER], ACTIONS, { jev: false });
  expect(report.plans[0]!.by).toBe("text");
  expect(tryMarkdown(report)).toContain("`ep0ch act board.open name=garden`");
  expect(tryMarkdown(report)).toContain("(text matches: Jev wasn't asked)");
});
